import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import {
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";

import {
  ProviderAllowanceReadError,
  type ProviderAllowanceReader,
} from "../provider/Services/ProviderAllowanceReader.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import {
  foldSubscriptionAllowance,
  make,
  markSubscriptionAllowanceSnapshotStale,
  type SubscriptionAllowanceProviderInstance,
} from "./SubscriptionAllowanceService.ts";

const readAt = "2026-08-11T12:00:00.000Z";
const instanceId = ProviderInstanceId.make("codex");

const allowance = {
  provider: "codex" as const,
  instanceId,
  status: "available" as const,
  windows: [{ scope: "primary" as const, usedPercent: 20 }],
};

const reader = (
  read: ProviderAllowanceReader["read"],
  provider: ProviderAllowanceReader["provider"] = "codex",
): ProviderAllowanceReader => ({
  provider,
  read,
});

const instance = (
  input: Partial<SubscriptionAllowanceProviderInstance>,
): SubscriptionAllowanceProviderInstance => ({
  instanceId,
  enabled: true,
  ...input,
});

const registryLayerFor = (providerInstance: SubscriptionAllowanceProviderInstance) =>
  Layer.succeed(ProviderInstanceRegistry, {
    getInstance: () => Effect.succeed(undefined),
    listInstances: Effect.succeed([
      providerInstance as unknown as ProviderInstance,
    ] as ReadonlyArray<ProviderInstance>),
    listUnavailable: Effect.succeed([]),
    streamChanges: Stream.empty,
    subscribeChanges: Effect.flatMap(PubSub.unbounded<void>(), (pubsub) =>
      PubSub.subscribe(pubsub),
    ),
  });

const providerServiceLayerFor = (events: Stream.Stream<ProviderRuntimeEvent> = Stream.empty) =>
  Layer.succeed(ProviderService, { streamEvents: events } as ProviderService["Service"]);

const makeService = (
  registryLayer: Layer.Layer<ProviderInstanceRegistry>,
  events: Stream.Stream<ProviderRuntimeEvent> = Stream.empty,
) => make.pipe(Effect.provide(Layer.mergeAll(registryLayer, providerServiceLayerFor(events))));

describe("subscription allowance lifecycle helpers", () => {
  it("folds sparse windows without dropping a previously complete record", () => {
    const previous = {
      ...allowance,
      windows: [
        { scope: "primary" as const, usedPercent: 20, windowDurationMins: 300 },
        { scope: "secondary" as const, usedPercent: 5, windowDurationMins: 1_440 },
      ],
      credits: { balance: "10", hasCredits: true, unlimited: false },
    };
    const update = {
      provider: "codex" as const,
      instanceId,
      status: "available" as const,
      windows: [{ scope: "primary" as const, usedPercent: 31 }],
      credits: null,
    };

    expect(foldSubscriptionAllowance(previous, update)).toEqual({
      provider: "codex",
      instanceId,
      status: "available",
      windows: [
        { scope: "primary", usedPercent: 31, windowDurationMins: 300 },
        { scope: "secondary", usedPercent: 5, windowDurationMins: 1_440 },
      ],
      credits: null,
    });
  });

  it("marks a usable record stale after its provider reset without changing utilization", () => {
    const snapshot = {
      readAt,
      allowances: [
        {
          ...allowance,
          windows: [{ scope: "primary" as const, usedPercent: 42, resetsAt: readAt }],
          freshness: "fresh" as const,
          updatedAt: readAt,
        },
      ],
    };

    expect(markSubscriptionAllowanceSnapshotStale(snapshot, Date.parse(readAt))).toEqual({
      ...snapshot,
      allowances: [{ ...snapshot.allowances[0], freshness: "stale" }],
    });
  });

  it("keeps a replacement observation fresh after the previous reset", () => {
    const snapshot = {
      readAt: "2026-08-11T18:00:00.000Z",
      allowances: [
        {
          ...allowance,
          windows: [{ scope: "primary" as const, usedPercent: 7, resetsAt: readAt }],
          freshness: "fresh" as const,
          updatedAt: "2026-08-11T18:00:00.000Z",
        },
      ],
    };

    expect(markSubscriptionAllowanceSnapshotStale(snapshot, Date.parse(snapshot.readAt))).toBe(
      snapshot,
    );
  });
});

describe("SubscriptionAllowanceService", () => {
  it.effect("acquires providers materialized before first demand", () =>
    Effect.gen(function* () {
      const changes = yield* PubSub.unbounded<void>();
      const instances = yield* Ref.make<ReadonlyArray<ProviderInstance>>([]);
      const registryLayer = Layer.succeed(ProviderInstanceRegistry, {
        getInstance: () => Effect.succeed(undefined),
        listInstances: Ref.get(instances),
        listUnavailable: Effect.succeed([]),
        streamChanges: Stream.fromPubSub(changes),
        subscribeChanges: PubSub.subscribe(changes),
      });
      const service = yield* makeService(registryLayer);
      yield* Ref.set(instances, [
        instance({ allowanceReader: reader(Effect.succeed(allowance)) }) as ProviderInstance,
      ]);

      yield* Effect.scoped(
        Effect.gen(function* () {
          const subscription = yield* service.subscribe;
          const published = Option.getOrThrow(yield* Stream.runHead(subscription.changes));

          expect(published.allowances).toHaveLength(1);
          expect(published.allowances[0]?.instanceId).toBe(allowance.instanceId);
        }),
      );
    }),
  );

  it.effect("publishes complete snapshot provenance through the subscription seam", () =>
    Effect.gen(function* () {
      const providerInstance = instance({
        allowanceReader: reader(Effect.succeed(allowance)),
      });
      const service = yield* makeService(registryLayerFor(providerInstance));

      yield* Effect.scoped(
        Effect.gen(function* () {
          const subscription = yield* service.subscribe;
          const published = yield* Stream.runHead(subscription.changes);

          expect(Option.getOrThrow(published).allowances[0]).toMatchObject({
            completeness: "complete",
            observationSource: "snapshot",
            deliverySource: "live",
          });
        }),
      );
    }),
  );

  it.effect("identifies a retained reconnect snapshot as cache delivery", () =>
    Effect.gen(function* () {
      const providerInstance = instance({
        allowanceReader: reader(Effect.succeed(allowance)),
      });
      const service = yield* makeService(registryLayerFor(providerInstance));

      yield* Effect.scoped(
        Effect.gen(function* () {
          const subscription = yield* service.subscribe;
          yield* Stream.runHead(subscription.changes);
        }),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const subscription = yield* service.subscribe;
          expect(subscription.latest.allowances[0]?.deliverySource).toBe("cache");
        }),
      );
    }),
  );

  it.effect("starts one demand-scoped acquisition and shares concurrent refreshes", () =>
    Effect.gen(function* () {
      const readStarted = yield* Deferred.make<void>();
      const releaseRead = yield* Deferred.make<void>();
      let readCount = 0;
      const providerInstance = instance({
        allowanceReader: reader(
          Effect.gen(function* () {
            readCount += 1;
            yield* Deferred.succeed(readStarted, undefined);
            yield* Deferred.await(releaseRead);
            return allowance;
          }),
        ),
      });
      const service = yield* makeService(registryLayerFor(providerInstance));

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* service.subscribe;
          yield* Deferred.await(readStarted);
          expect(readCount).toBe(1);

          const concurrentRefreshes = yield* Effect.all([service.refresh, service.refresh], {
            concurrency: "unbounded",
          }).pipe(Effect.forkChild({ startImmediately: true }));
          yield* Deferred.succeed(releaseRead, undefined);
          const [snapshot] = yield* Fiber.join(concurrentRefreshes);

          expect(readCount).toBe(1);
          expect(snapshot.allowances[0]).toMatchObject(allowance);
          expect(snapshot.allowances[0]?.freshness).toBe("fresh");
        }),
      );
    }),
  );

  it.effect("keeps shared live demand active when refresh overlaps a second subscriber", () =>
    Effect.gen(function* () {
      const publishBlocked = yield* Deferred.make<void>();
      const releasePublish = yield* Deferred.make<void>();
      const providerEventHandled = yield* Deferred.make<void>();
      const providerEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
      const firstReady = yield* Deferred.make<void>();
      const releaseFirst = yield* Deferred.make<void>();
      const secondReady = yield* Deferred.make<void>();
      const releaseSecond = yield* Deferred.make<void>();
      let callsUntilBlock: number | undefined;
      const now = Date.parse(readAt);
      const controlledClock: Clock.Clock = {
        currentTimeMillisUnsafe: () => now,
        currentTimeMillis: Effect.suspend(() => {
          if (callsUntilBlock === undefined) return Effect.succeed(now);
          callsUntilBlock -= 1;
          if (callsUntilBlock > 0) return Effect.succeed(now);
          callsUntilBlock = undefined;
          return Deferred.succeed(publishBlocked, undefined).pipe(
            Effect.andThen(Deferred.await(releasePublish)),
            Effect.as(now),
          );
        }),
        currentTimeNanosUnsafe: () => BigInt(now) * 1_000_000n,
        currentTimeNanos: Effect.succeed(BigInt(now) * 1_000_000n),
        monotonicTimeNanosUnsafe: () => BigInt(now) * 1_000_000n,
        monotonicTimeNanos: Effect.succeed(BigInt(now) * 1_000_000n),
        sleep: () => Effect.never,
      };
      yield* Effect.gen(function* () {
        const providerInstance = instance({
          allowanceReader: {
            provider: "codex",
            read: Effect.succeed(allowance),
            update: () => allowance,
          },
        });
        const service = yield* makeService(
          registryLayerFor(providerInstance),
          Stream.fromQueue(providerEvents).pipe(
            Stream.tap(() => Deferred.succeed(providerEventHandled, undefined)),
          ),
        );
        const first = yield* Effect.scoped(
          Effect.gen(function* () {
            const subscription = yield* service.subscribe;
            yield* Stream.runHead(subscription.changes);
            yield* Deferred.succeed(firstReady, undefined);
            yield* Deferred.await(releaseFirst);
          }),
        ).pipe(Effect.forkChild({ startImmediately: true }));
        yield* Deferred.await(firstReady);

        callsUntilBlock = 2;
        const refresh = yield* service.refresh.pipe(Effect.forkChild({ startImmediately: true }));
        yield* Deferred.await(publishBlocked);
        const second = yield* Effect.scoped(
          Effect.gen(function* () {
            yield* service.subscribe;
            yield* Deferred.succeed(secondReady, undefined);
            yield* Deferred.await(releaseSecond);
          }),
        ).pipe(Effect.forkChild({ startImmediately: true }));
        yield* Effect.yieldNow;
        yield* Deferred.succeed(releasePublish, undefined);
        yield* Fiber.join(refresh);
        yield* Deferred.await(secondReady);

        yield* Deferred.succeed(releaseFirst, undefined);
        yield* Fiber.join(first);
        yield* Queue.offer(providerEvents, {
          type: "account.rate-limits.updated",
          eventId: EventId.make("allowance-live-demand-overlap"),
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: instanceId,
          threadId: ThreadId.make("allowance-thread"),
          createdAt: "2026-08-11T13:00:00.000Z",
          payload: { rateLimits: {} },
        });
        yield* Deferred.await(providerEventHandled);
        yield* Deferred.succeed(releaseSecond, undefined);
        yield* Fiber.join(second);
      }).pipe(Effect.provideService(Clock.Clock, controlledClock));
    }).pipe(Effect.scoped),
  );

  it.effect("acquires a replacement provider generation immediately", () =>
    Effect.gen(function* () {
      const oldReadStarted = yield* Deferred.make<void>();
      const releaseOldRead = yield* Deferred.make<void>();
      const registryObservedReplacement = yield* Deferred.make<void>();
      const newReadStarted = yield* Deferred.make<void>();
      const changes = yield* PubSub.unbounded<void>();
      const oldInstance = instance({
        allowanceReader: reader(
          Effect.gen(function* () {
            yield* Deferred.succeed(oldReadStarted, undefined);
            yield* Deferred.await(releaseOldRead);
            return allowance;
          }),
        ),
      }) as ProviderInstance;
      const replacementAllowance = {
        ...allowance,
        windows: [{ scope: "primary" as const, usedPercent: 90 }],
      };
      const newInstance = instance({
        allowanceReader: reader(
          Effect.gen(function* () {
            yield* Deferred.succeed(newReadStarted, undefined);
            return replacementAllowance;
          }),
        ),
      }) as ProviderInstance;
      const instances = yield* Ref.make<ReadonlyArray<ProviderInstance>>([oldInstance]);
      const registryLayer = Layer.succeed(ProviderInstanceRegistry, {
        getInstance: () => Effect.succeed(undefined),
        listInstances: Ref.get(instances).pipe(
          Effect.tap((current) =>
            current[0] === newInstance
              ? Deferred.succeed(registryObservedReplacement, undefined)
              : Effect.void,
          ),
        ),
        listUnavailable: Effect.succeed([]),
        streamChanges: Stream.fromPubSub(changes),
        subscribeChanges: PubSub.subscribe(changes),
      });
      const service = yield* makeService(registryLayer);

      yield* Effect.scoped(
        Effect.gen(function* () {
          const subscription = yield* service.subscribe;
          yield* Deferred.await(oldReadStarted);
          const replacementSnapshot = yield* subscription.changes.pipe(
            Stream.filter((snapshot) =>
              snapshot.allowances.some((item) => item.windows[0]?.usedPercent === 90),
            ),
            Stream.runHead,
            Effect.forkChild({ startImmediately: true }),
          );

          yield* Ref.set(instances, [newInstance]);
          yield* PubSub.publish(changes, undefined);
          yield* Deferred.await(registryObservedReplacement);
          yield* Deferred.succeed(releaseOldRead, undefined);
          const published = Option.getOrThrow(yield* Fiber.join(replacementSnapshot));

          expect(Option.isSome(yield* Deferred.poll(newReadStarted))).toBe(true);
          expect(published.allowances[0]?.windows[0]?.usedPercent).toBe(90);
        }),
      );
    }),
  );

  it.effect("refreshes on the controllable interval and stops after demand teardown", () =>
    Effect.gen(function* () {
      const automaticRefresh = yield* Deferred.make<void>();
      let readCount = 0;
      let baseline = Number.POSITIVE_INFINITY;
      const providerInstance = instance({
        allowanceReader: reader(
          Effect.sync(() => {
            readCount += 1;
            return allowance;
          }).pipe(
            Effect.tap(() =>
              readCount > baseline ? Deferred.succeed(automaticRefresh, undefined) : Effect.void,
            ),
          ),
        ),
      });
      const service = yield* makeService(registryLayerFor(providerInstance));

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* service.subscribe;
          yield* service.refresh;
          baseline = readCount;
          yield* TestClock.adjust(Duration.minutes(5));
          yield* Deferred.await(automaticRefresh);
          expect(readCount).toBe(baseline + 1);
        }),
      );

      const afterTeardown = readCount;
      yield* TestClock.adjust(Duration.minutes(5));
      expect(readCount).toBe(afterTeardown);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("attaches the demand-scoped provider event stream", () =>
    Effect.gen(function* () {
      const providerEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
      const eventStream = Stream.fromQueue(providerEvents);
      const providerInstance = instance({
        allowanceReader: {
          provider: "codex",
          read: Effect.succeed(allowance),
          update: () => ({
            ...allowance,
            windows: [{ scope: "primary", usedPercent: 55 }],
          }),
        },
      });
      const service = yield* makeService(registryLayerFor(providerInstance), eventStream);

      yield* Effect.scoped(
        Effect.gen(function* () {
          const subscription = yield* service.subscribe;
          yield* Stream.runHead(subscription.changes);
          const liveUpdate = yield* subscription.changes.pipe(
            Stream.filter((snapshot) => snapshot.allowances[0]?.observationSource === "liveUpdate"),
            Stream.runHead,
            Effect.forkChild({ startImmediately: true }),
          );
          const event = {
            type: "account.rate-limits.updated",
            eventId: EventId.make("allowance-live-update"),
            provider: ProviderDriverKind.make("codex"),
            providerInstanceId: instanceId,
            threadId: ThreadId.make("allowance-thread"),
            createdAt: "2026-08-11T13:00:00.000Z",
            payload: { rateLimits: {} },
          } satisfies Extract<ProviderRuntimeEvent, { type: "account.rate-limits.updated" }>;

          yield* Queue.offer(providerEvents, event);
          const published = Option.getOrThrow(yield* Fiber.join(liveUpdate));

          expect(published.allowances[0]).toMatchObject({
            observationSource: "liveUpdate",
            deliverySource: "live",
            windows: [{ scope: "primary", usedPercent: 55 }],
          });
        }),
      );
    }),
  );

  it.effect("does not seed an available allowance from a sparse update after failure", () =>
    Effect.gen(function* () {
      const emitUpdate = yield* Deferred.make<void>();
      const updateHandled = yield* Deferred.make<void>();
      const event = {
        type: "account.rate-limits.updated",
        eventId: EventId.make("allowance-sparse-after-failure"),
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: instanceId,
        threadId: ThreadId.make("allowance-thread"),
        createdAt: "2026-08-11T13:00:00.000Z",
        payload: { rateLimits: {} },
      } satisfies Extract<ProviderRuntimeEvent, { type: "account.rate-limits.updated" }>;
      const providerEvents = Stream.fromEffect(Deferred.await(emitUpdate)).pipe(
        Stream.map(() => event),
        Stream.ensuring(Deferred.succeed(updateHandled, undefined)),
      );
      const providerInstance = instance({
        allowanceReader: {
          provider: "codex",
          read: Effect.fail(
            new ProviderAllowanceReadError({
              provider: "codex",
              instanceId,
              operation: "read",
              cause: "unavailable",
            }),
          ),
          update: () => ({
            ...allowance,
            windows: [{ scope: "primary", usedPercent: 55 }],
          }),
        },
      });
      const service = yield* makeService(registryLayerFor(providerInstance), providerEvents);

      yield* Effect.scoped(
        Effect.gen(function* () {
          const subscription = yield* service.subscribe;
          const initial = Option.getOrThrow(yield* Stream.runHead(subscription.changes));
          expect(initial.allowances[0]?.status).toBe("unavailable");

          yield* Deferred.succeed(emitUpdate, undefined);
          yield* Deferred.await(updateHandled);
          const afterUpdate = yield* service.subscribe;

          expect(afterUpdate.latest.allowances[0]?.status).toBe("unavailable");
        }),
      );
    }),
  );
});
