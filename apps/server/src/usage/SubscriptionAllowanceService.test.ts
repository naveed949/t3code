import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { ProviderInstanceId } from "@t3tools/contracts";

import {
  ProviderAllowanceReadError,
  type ProviderAllowanceReader,
} from "../provider/Services/ProviderAllowanceReader.ts";
import {
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

const reader = (read: ProviderAllowanceReader["read"]): ProviderAllowanceReader => ({
  provider: "codex",
  read,
});

const instance = (
  input: Partial<SubscriptionAllowanceProviderInstance>,
): SubscriptionAllowanceProviderInstance => ({
  instanceId,
  enabled: true,
  ...input,
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
});
