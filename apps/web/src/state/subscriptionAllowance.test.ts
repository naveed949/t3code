import { describe, expect, it } from "vite-plus/test";

import { ProviderInstanceId, type EnvironmentId } from "@t3tools/contracts";

import { flattenSubscriptionAllowances } from "./subscriptionAllowance";

describe("flattenSubscriptionAllowances", () => {
  it("keeps environment identity while exposing provider snapshots to the view", () => {
    const allowance = {
      provider: "codex" as const,
      instanceId: ProviderInstanceId.make("codex"),
      status: "available" as const,
      windows: [{ scope: "primary" as const, usedPercent: 20 }],
    };

    expect(
      flattenSubscriptionAllowances([
        {
          environmentId: "environment-1" as EnvironmentId,
          label: "Laptop",
          isPending: false,
          error: null,
          snapshot: { readAt: "2026-08-11T12:00:00.000Z", allowances: [allowance] },
        },
        {
          environmentId: "environment-2" as EnvironmentId,
          label: "Desktop",
          isPending: false,
          error: "This environment could not report subscription usage.",
          snapshot: null,
        },
      ]),
    ).toEqual([
      {
        environmentId: "environment-1",
        environmentLabel: "Laptop",
        allowance,
      },
    ]);
  });
});
