import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { ProviderInstanceId } from "@t3tools/contracts";

import {
  CLAUDE_SUBSCRIPTION_ALLOWANCE_UNAVAILABLE_MESSAGE,
  ProviderAllowanceReadError,
  type ProviderAllowanceReader,
} from "../provider/Services/ProviderAllowanceReader.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import {
  foldSubscriptionAllowance,
  make,
  markSubscriptionAllowanceSnapshotStale,
  readSubscriptionAllowances,
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

describe("readSubscriptionAllowances", () => {
  it.effect("omits disabled instances and contains an unavailable receipt for a failed read", () =>
    Effect.gen(function* () {
      const snapshot = yield* readSubscriptionAllowances(
        [
          instance({ allowanceReader: reader(Effect.succeed(allowance)) }),
          instance({ enabled: false, allowanceReader: reader(Effect.succeed(allowance)) }),
          instance({
            instanceId: ProviderInstanceId.make("codex-failing"),
            allowanceReader: reader(
              Effect.fail(new ProviderAllowanceReadError({ detail: "provider failure" })),
            ),
          }),
        ],
        readAt,
      );

      expect(snapshot).toEqual({
        readAt,
        allowances: [
          allowance,
          {
            provider: "codex",
            instanceId: ProviderInstanceId.make("codex-failing"),
            status: "unavailable",
            windows: [],
            message: "Codex subscription usage is unavailable.",
          },
        ],
      });
    }),
  );

  it.effect("keeps the Claude unavailable presentation stable when acquisition fails", () =>
    Effect.gen(function* () {
      const snapshot = yield* readSubscriptionAllowances(
        [
          instance({
            instanceId: ProviderInstanceId.make("claude"),
            allowanceReader: reader(
              Effect.fail(new ProviderAllowanceReadError({ detail: "provider failure" })),
              "claude",
            ),
          }),
        ],
        readAt,
      );

      expect(snapshot.allowances).toEqual([
        {
          provider: "claude",
          instanceId: ProviderInstanceId.make("claude"),
          status: "unavailable",
          windows: [],
          message: CLAUDE_SUBSCRIPTION_ALLOWANCE_UNAVAILABLE_MESSAGE,
        },
      ]);
    }),
  );
});

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
      const service = yield* make.pipe(Effect.provide(registryLayerFor(providerInstance)));

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
      const service = yield* make.pipe(Effect.provide(registryLayerFor(providerInstance)));

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
});
