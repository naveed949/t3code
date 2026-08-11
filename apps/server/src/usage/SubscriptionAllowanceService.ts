import {
  type ProviderInstanceId,
  type ProviderRuntimeEvent,
  type SubscriptionAllowance,
  type SubscriptionAllowanceSnapshot,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import {
  CLAUDE_SUBSCRIPTION_ALLOWANCE_UNAVAILABLE_MESSAGE,
  type ProviderAllowanceReader,
} from "../provider/Services/ProviderAllowanceReader.ts";
import {
  PROVIDER_RUNTIME_EVENT_SOURCE,
  ProviderService,
} from "../provider/Services/ProviderService.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import { subscribeBeforeSnapshot } from "../utils/subscribeBeforeSnapshot.ts";

export const SUBSCRIPTION_ALLOWANCE_REFRESH_INTERVAL_MS = 5 * 60_000;

export interface SubscriptionAllowanceProviderInstance {
  readonly instanceId: ProviderInstanceId;
  readonly enabled: boolean;
  readonly allowanceReader?: ProviderAllowanceReader;
}

type ReadableSubscriptionAllowanceProviderInstance = SubscriptionAllowanceProviderInstance & {
  readonly allowanceReader: ProviderAllowanceReader;
};

interface AllowanceServiceState {
  readonly snapshot: SubscriptionAllowanceSnapshot;
  readonly instances: ReadonlyMap<ProviderInstanceId, ProviderInstance>;
  readonly demandCount: number;
  readonly liveScope: Option.Option<Scope.Closeable>;
}

type RefreshFlight = Deferred.Deferred<Exit.Exit<SubscriptionAllowanceSnapshot, never>>;

const unavailableAllowance = (input: {
  readonly instanceId: ProviderInstanceId;
  readonly provider: SubscriptionAllowance["provider"];
  readonly message: string;
}): SubscriptionAllowance => ({
  provider: input.provider,
  instanceId: input.instanceId,
  status: "unavailable",
  windows: [],
  message: input.message,
});

const unavailableMessage = (provider: ProviderAllowanceReader["provider"]): string =>
  provider === "claude"
    ? CLAUDE_SUBSCRIPTION_ALLOWANCE_UNAVAILABLE_MESSAGE
    : "Codex subscription usage is unavailable.";

const isUsableAllowance = (allowance: SubscriptionAllowance | undefined): boolean =>
  allowance?.status === "available";

const markFresh = (allowance: SubscriptionAllowance, updatedAt: string): SubscriptionAllowance => ({
  ...allowance,
  freshness: "fresh",
  updatedAt,
});

const markStale = (allowance: SubscriptionAllowance): SubscriptionAllowance => ({
  ...allowance,
  freshness: "stale",
});

const hasPassedReset = (
  allowance: SubscriptionAllowance,
  snapshotReadAt: string,
  nowMs: number,
): boolean =>
  allowance.status === "available" &&
  allowance.windows.some((window) => {
    if (window.resetsAt === undefined || window.resetsAt === null) return false;
    const resetMs = Date.parse(window.resetsAt);
    if (!Number.isFinite(resetMs) || resetMs > nowMs) return false;

    const observedMs = Date.parse(allowance.updatedAt ?? snapshotReadAt);
    return !Number.isFinite(observedMs) || observedMs <= resetMs;
  });

export function markSubscriptionAllowanceSnapshotStale(
  snapshot: SubscriptionAllowanceSnapshot,
  nowMs: number,
): SubscriptionAllowanceSnapshot {
  const allowances = snapshot.allowances.map((allowance) =>
    hasPassedReset(allowance, snapshot.readAt, nowMs) ? markStale(allowance) : allowance,
  );
  return allowances.every((allowance, index) => allowance === snapshot.allowances[index])
    ? snapshot
    : { ...snapshot, allowances };
}

/**
 * Fold one provider-native sparse observation into the last complete record.
 * Provider fields omitted from the sparse update remain untouched; explicit
 * nulls still clear the previous provider value.
 */
export function foldSubscriptionAllowance(
  previous: SubscriptionAllowance | undefined,
  update: SubscriptionAllowance,
): SubscriptionAllowance {
  if (!isUsableAllowance(update) || previous === undefined || !isUsableAllowance(previous)) {
    return update;
  }

  const windowsByScope = new Map(previous.windows.map((window) => [window.scope, window] as const));
  for (const window of update.windows) {
    windowsByScope.set(window.scope, {
      ...windowsByScope.get(window.scope),
      ...window,
    });
  }
  const windows = Array.from(windowsByScope.values());

  return {
    ...previous,
    ...update,
    windows,
  };
}

/**
 * Reads the enabled materialized provider readers in settings order. A broken
 * provider read becomes an explicit unavailable allowance so one provider
 * cannot turn a multi-provider snapshot into a misleading empty response.
 */
export const readSubscriptionAllowances = Effect.fn("readSubscriptionAllowances")(function* (
  instances: ReadonlyArray<SubscriptionAllowanceProviderInstance>,
  readAt: string,
) {
  const allowances = yield* Effect.forEach(
    instances.filter(
      (instance): instance is ReadableSubscriptionAllowanceProviderInstance =>
        instance.enabled && instance.allowanceReader !== undefined,
    ),
    (instance) => {
      const reader = instance.allowanceReader;
      return reader.read.pipe(
        Effect.catchCause(() =>
          Effect.logWarning("Provider allowance read failed", {
            provider: reader.provider,
            instanceId: instance.instanceId,
          }).pipe(
            Effect.andThen(
              Effect.succeed(
                unavailableAllowance({
                  provider: reader.provider,
                  instanceId: instance.instanceId,
                  message: unavailableMessage(reader.provider),
                }),
              ),
            ),
          ),
        ),
      );
    },
  );

  return {
    readAt,
    allowances,
  } satisfies SubscriptionAllowanceSnapshot;
});

export class SubscriptionAllowanceService extends Context.Service<
  SubscriptionAllowanceService,
  {
    /** One-shot compatibility read. It also updates the server-owned cache. */
    readonly read: Effect.Effect<SubscriptionAllowanceSnapshot>;
    readonly latest: Effect.Effect<SubscriptionAllowanceSnapshot>;
    readonly changes: Stream.Stream<SubscriptionAllowanceSnapshot>;
    readonly subscribe: Effect.Effect<
      {
        readonly latest: SubscriptionAllowanceSnapshot;
        readonly changes: Stream.Stream<SubscriptionAllowanceSnapshot>;
      },
      never,
      Scope.Scope
    >;
    /** Manual refresh bypasses freshness but shares any active acquisition. */
    readonly refresh: Effect.Effect<SubscriptionAllowanceSnapshot>;
  }
>()("t3/usage/SubscriptionAllowanceService") {}

export const make = Effect.gen(function* () {
  const registry = yield* ProviderInstanceRegistry;
  const providerService = yield* Effect.serviceOption(ProviderService);
  const stateMutex = yield* Semaphore.make(1);
  const liveMutex = yield* Semaphore.make(1);
  const changes = yield* PubSub.sliding<SubscriptionAllowanceSnapshot>(8);
  const initialReadAt = DateTime.formatIso(yield* DateTime.now);
  const initialInstances = yield* registry.listInstances;
  const state = yield* Ref.make<AllowanceServiceState>({
    snapshot: { readAt: initialReadAt, allowances: [] },
    instances: new Map(
      initialInstances.map((instance) => [instance.instanceId, instance] as const),
    ),
    demandCount: 0,
    liveScope: Option.none(),
  });
  const refreshFlight = yield* Ref.make<Option.Option<RefreshFlight>>(Option.none());

  const publishUnlocked = (snapshot: SubscriptionAllowanceSnapshot) =>
    Effect.gen(function* () {
      const current = yield* Ref.get(state);
      const nextSnapshot = markSubscriptionAllowanceSnapshotStale(
        snapshot,
        yield* Clock.currentTimeMillis,
      );
      yield* Ref.set(state, { ...current, snapshot: nextSnapshot });
      if (current.demandCount > 0) {
        yield* PubSub.publish(changes, nextSnapshot);
      }
      return nextSnapshot;
    });
  const publish = (snapshot: SubscriptionAllowanceSnapshot) =>
    stateMutex.withPermits(1)(publishUnlocked(snapshot));

  const readCurrentSnapshot = Effect.fn("SubscriptionAllowanceService.readCurrentSnapshot")(
    function* (
      instances: ReadonlyArray<SubscriptionAllowanceProviderInstance>,
      previous: SubscriptionAllowanceSnapshot,
      readAt: string,
    ) {
      const previousByInstance = new Map(
        previous.allowances.map((allowance) => [allowance.instanceId, allowance] as const),
      );
      const readableInstances = instances.filter(
        (instance): instance is ReadableSubscriptionAllowanceProviderInstance =>
          instance.enabled && instance.allowanceReader !== undefined,
      );

      const allowances = yield* Effect.forEach(readableInstances, (instance) =>
        instance.allowanceReader.read.pipe(
          Effect.result,
          Effect.map((result) => {
            if (Result.isSuccess(result)) {
              return markFresh(result.success, readAt);
            }

            const previousAllowance = previousByInstance.get(instance.instanceId);
            return previousAllowance !== undefined && isUsableAllowance(previousAllowance)
              ? markStale(previousAllowance)
              : markFresh(
                  unavailableAllowance({
                    provider: instance.allowanceReader.provider,
                    instanceId: instance.instanceId,
                    message: unavailableMessage(instance.allowanceReader.provider),
                  }),
                  readAt,
                );
          }),
          Effect.tap((allowance) =>
            allowance.freshness === "stale"
              ? Effect.logWarning("Provider allowance refresh failed; retaining stale snapshot", {
                  provider: allowance.provider,
                  instanceId: allowance.instanceId,
                })
              : Effect.void,
          ),
        ),
      );

      return { readAt, allowances } satisfies SubscriptionAllowanceSnapshot;
    },
  );

  const refreshUnshared = Effect.gen(function* () {
    const instances = yield* registry.listInstances;
    const previous = yield* Ref.get(state);
    const readAt = DateTime.formatIso(yield* DateTime.now);
    const candidate = yield* readCurrentSnapshot(instances, previous.snapshot, readAt);
    const currentInstances = yield* registry.listInstances;
    const capturedById = new Map(
      instances.map((instance) => [instance.instanceId, instance] as const),
    );
    const currentState = yield* Ref.get(state);
    const allowancesById = new Map(
      candidate.allowances.map((allowance) => [allowance.instanceId, allowance]),
    );
    const acceptedAllowances = currentInstances.flatMap((instance) => {
      const candidateInstance = capturedById.get(instance.instanceId);
      if (
        candidateInstance === instance &&
        currentState.instances.get(instance.instanceId) === instance
      ) {
        const allowance = allowancesById.get(instance.instanceId);
        return allowance === undefined ? [] : [allowance];
      }

      // A provider instance was replaced while the read was in flight. Do not
      // let the old generation publish into the new one; its registry change
      // will trigger a new demand-scoped refresh.
      const previousInstance = currentState.instances.get(instance.instanceId);
      if (previousInstance === instance) {
        const allowance = currentState.snapshot.allowances.find(
          (candidateAllowance) => candidateAllowance.instanceId === instance.instanceId,
        );
        return allowance === undefined ? [] : [allowance];
      }
      return [];
    });
    return yield* publish({ readAt, allowances: acceptedAllowances });
  });

  const refresh: Effect.Effect<SubscriptionAllowanceSnapshot> = Effect.uninterruptibleMask(
    (restore) =>
      Effect.gen(function* () {
        const flight = yield* Deferred.make<Exit.Exit<SubscriptionAllowanceSnapshot, never>>();
        const existing = yield* Ref.modify(refreshFlight, (current) =>
          Option.match(current, {
            onNone: () => [Option.none<RefreshFlight>(), Option.some(flight)] as const,
            onSome: (active) => [Option.some(active), current] as const,
          }),
        );
        if (Option.isSome(existing)) {
          return yield* restore(
            existing.value.pipe(
              Deferred.await,
              Effect.flatMap((exit) =>
                Exit.match(exit, {
                  onFailure: (cause) => Effect.failCause(cause),
                  onSuccess: Effect.succeed,
                }),
              ),
            ),
          );
        }

        const result = yield* Effect.exit(restore(refreshUnshared));
        yield* Deferred.succeed(flight, result);
        yield* Ref.set(refreshFlight, Option.none());
        return yield* Exit.match(result, {
          onFailure: (cause) => Effect.failCause(cause),
          onSuccess: Effect.succeed,
        });
      }),
  );

  const handleProviderUpdate = (event: ProviderRuntimeEvent) =>
    stateMutex.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(state);
        const instanceId = event.providerInstanceId;
        if (instanceId === undefined) return;
        const instance = current.instances.get(instanceId);
        const eventSource = (
          event as ProviderRuntimeEvent & {
            readonly [PROVIDER_RUNTIME_EVENT_SOURCE]?: unknown;
          }
        )[PROVIDER_RUNTIME_EVENT_SOURCE];
        if (eventSource !== undefined && eventSource !== instance?.adapter) return;
        const update = instance?.allowanceReader?.update?.(event);
        if (update === undefined) return;
        const previous = current.snapshot.allowances.find(
          (allowance) => allowance.instanceId === instanceId,
        );
        if (previous === undefined && update.status === "available") {
          // A sparse event cannot become the first public record. The next
          // complete acquisition remains the source of truth for first demand.
          return;
        }
        const updatedAt = event.createdAt;
        const folded = markFresh(foldSubscriptionAllowance(previous, update), updatedAt);
        const allowances = current.snapshot.allowances.some(
          (allowance) => allowance.instanceId === instanceId,
        )
          ? current.snapshot.allowances.map((allowance) =>
              allowance.instanceId === instanceId ? folded : allowance,
            )
          : [...current.snapshot.allowances, folded];
        yield* publishUnlocked({ readAt: updatedAt, allowances });
      }),
    );

  const syncInstances = Effect.gen(function* () {
    const instances = yield* registry.listInstances;
    const nextById = new Map(instances.map((instance) => [instance.instanceId, instance] as const));
    const refreshScope = yield* stateMutex.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(state);
        const changed = Array.from(nextById).some(
          ([instanceId, instance]) => current.instances.get(instanceId) !== instance,
        );
        if (!changed && nextById.size === current.instances.size)
          return Option.none<Scope.Closeable>();

        const allowances = current.snapshot.allowances.filter(
          (allowance) =>
            current.instances.get(allowance.instanceId) === nextById.get(allowance.instanceId),
        );
        yield* Ref.set(state, {
          ...current,
          instances: nextById,
          snapshot: { ...current.snapshot, allowances },
        });
        return current.demandCount > 0 ? current.liveScope : Option.none();
      }),
    );
    if (Option.isSome(refreshScope)) {
      yield* refresh.pipe(Effect.ignore, Effect.forkIn(refreshScope.value));
    }
  });

  const acquireDemand = liveMutex.withPermits(1)(
    Effect.gen(function* () {
      const current = yield* Ref.get(state);
      if (current.demandCount > 0) {
        yield* Ref.set(state, { ...current, demandCount: current.demandCount + 1 });
        return;
      }

      const liveScope = yield* Scope.make();
      yield* Ref.set(state, {
        ...current,
        demandCount: 1,
        liveScope: Option.some(liveScope),
      });

      if (Option.isSome(providerService)) {
        yield* providerService.value.streamEvents.pipe(
          Stream.filter((event) => event.type === "account.rate-limits.updated"),
          Stream.runForEach(handleProviderUpdate),
          Effect.catchCause((cause) =>
            Effect.logWarning("Subscription allowance provider update stream stopped", { cause }),
          ),
          Effect.forkIn(liveScope),
        );
      }
      const registryChanges = yield* registry.subscribeChanges.pipe(
        Effect.provideService(Scope.Scope, liveScope),
      );
      yield* Stream.runForEach(Stream.fromSubscription(registryChanges), () => syncInstances).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Subscription allowance registry stream stopped", { cause }),
        ),
        Effect.forkIn(liveScope),
      );
      yield* Effect.forever(
        Effect.sleep(`${SUBSCRIPTION_ALLOWANCE_REFRESH_INTERVAL_MS} millis`).pipe(
          Effect.andThen(refresh.pipe(Effect.ignore)),
        ),
      ).pipe(Effect.forkIn(liveScope));
      yield* refresh.pipe(Effect.ignore, Effect.forkIn(liveScope, { startImmediately: true }));
    }),
  );

  const releaseDemand = liveMutex.withPermits(1)(
    Effect.gen(function* () {
      const current = yield* Ref.get(state);
      if (current.demandCount > 1) {
        yield* Ref.set(state, { ...current, demandCount: current.demandCount - 1 });
        return;
      }
      yield* Ref.set(state, { ...current, demandCount: 0, liveScope: Option.none() });
      if (Option.isSome(current.liveScope)) {
        yield* Scope.close(current.liveScope.value, Exit.void).pipe(Effect.ignore);
      }
    }),
  );

  const read = Effect.scoped(
    Effect.gen(function* () {
      yield* Effect.acquireRelease(acquireDemand, () => releaseDemand);
      return yield* refresh;
    }),
  );

  const latestUnlocked = Effect.gen(function* () {
    const current = yield* Ref.get(state);
    const nextSnapshot = markSubscriptionAllowanceSnapshotStale(
      current.snapshot,
      yield* Clock.currentTimeMillis,
    );
    if (nextSnapshot !== current.snapshot) {
      yield* Ref.set(state, { ...current, snapshot: nextSnapshot });
    }
    return nextSnapshot;
  });
  const latest = stateMutex.withPermits(1)(latestUnlocked);
  const subscribe = subscribeBeforeSnapshot(
    changes,
    Effect.gen(function* () {
      yield* Effect.acquireRelease(acquireDemand, () => releaseDemand);
      return yield* latestUnlocked;
    }),
    stateMutex,
  );

  return SubscriptionAllowanceService.of({
    read,
    latest,
    changes: Stream.fromPubSub(changes),
    subscribe,
    refresh,
  });
});

export const layer = Layer.effect(SubscriptionAllowanceService, make);

const emptySnapshot: SubscriptionAllowanceSnapshot = {
  readAt: "1970-01-01T00:00:00.000Z",
  allowances: [],
};

export const layerTest = Layer.succeed(
  SubscriptionAllowanceService,
  SubscriptionAllowanceService.of({
    read: Effect.succeed(emptySnapshot),
    latest: Effect.succeed(emptySnapshot),
    changes: Stream.empty,
    subscribe: Effect.succeed({ latest: emptySnapshot, changes: Stream.empty }),
    refresh: Effect.succeed(emptySnapshot),
  }),
);
