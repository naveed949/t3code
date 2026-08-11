import {
  type ProviderInstanceId,
  type SubscriptionAllowance,
  type SubscriptionAllowanceSnapshot,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { ProviderAllowanceReader } from "../provider/Services/ProviderAllowanceReader.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";

export interface SubscriptionAllowanceProviderInstance {
  readonly instanceId: ProviderInstanceId;
  readonly enabled: boolean;
  readonly allowanceReader?: ProviderAllowanceReader;
}

type ReadableSubscriptionAllowanceProviderInstance = SubscriptionAllowanceProviderInstance & {
  readonly allowanceReader: ProviderAllowanceReader;
};

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
                  message:
                    reader.provider === "codex"
                      ? "Codex subscription usage is unavailable."
                      : "Provider subscription usage is unavailable.",
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
    readonly read: Effect.Effect<SubscriptionAllowanceSnapshot>;
  }
>()("t3/usage/SubscriptionAllowanceService") {}

export const make = Effect.gen(function* () {
  const registry = yield* ProviderInstanceRegistry;

  const read = Effect.gen(function* () {
    const readAt = DateTime.formatIso(yield* DateTime.now);
    const instances = yield* registry.listInstances;
    return yield* readSubscriptionAllowances(instances, readAt);
  });

  return SubscriptionAllowanceService.of({ read });
});

export const layer = Layer.effect(SubscriptionAllowanceService, make);

export const layerTest = Layer.succeed(
  SubscriptionAllowanceService,
  SubscriptionAllowanceService.of({
    read: Effect.succeed({
      readAt: "1970-01-01T00:00:00.000Z",
      allowances: [],
    }),
  }),
);
