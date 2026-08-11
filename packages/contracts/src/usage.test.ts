import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";

import { SubscriptionAllowanceSnapshot, USAGE_CONTRACT_VERSION } from "./usage.ts";

const decodeSnapshot = Schema.decodeUnknownSync(SubscriptionAllowanceSnapshot);

describe("subscription allowance contract", () => {
  it("accepts provider-reported fields without requiring inferred values", () => {
    const snapshot = decodeSnapshot({
      readAt: "2026-08-11T12:00:00.000Z",
      allowances: [
        {
          provider: "codex",
          instanceId: "codex",
          status: "available",
          windows: [
            {
              scope: "primary",
              usedPercent: 23,
              windowDurationMins: 300,
              resetsAt: "2026-08-11T17:00:00.000Z",
            },
          ],
        },
        {
          provider: "claude",
          instanceId: "claude",
          status: "available",
          windows: [
            {
              scope: "seven_day_opus",
              usedPercent: null,
              resetsAt: null,
            },
          ],
          extraUsage: {
            isEnabled: true,
            monthlyLimit: null,
            usedCredits: 2.5,
            utilization: null,
            currency: "USD",
          },
        },
      ],
    });

    expect(snapshot.allowances[0]).not.toHaveProperty("credits");
    expect(snapshot.allowances[0]).not.toHaveProperty("spendingControl");
    expect(snapshot.allowances[1]?.windows[0]?.scope).toBe("seven_day_opus");
    expect(snapshot.allowances[1]?.extraUsage?.usedCredits).toBe(2.5);
  });

  it("keeps historical usage contract versioning independent", () => {
    expect(USAGE_CONTRACT_VERSION).toBe(3);
    expect(SubscriptionAllowanceSnapshot).toBeDefined();
  });
});
