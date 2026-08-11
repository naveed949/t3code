import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";

import { SubscriptionAllowanceSnapshot, USAGE_CONTRACT_VERSION } from "./usage.ts";

describe("subscription allowance contract", () => {
  it("accepts provider-reported fields without requiring inferred values", () => {
    const snapshot = Schema.decodeUnknownSync(SubscriptionAllowanceSnapshot)({
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
      ],
    });

    expect(snapshot.allowances[0]).not.toHaveProperty("credits");
    expect(snapshot.allowances[0]).not.toHaveProperty("spendingControl");
  });

  it("keeps historical usage contract versioning independent", () => {
    expect(USAGE_CONTRACT_VERSION).toBe(3);
    expect(SubscriptionAllowanceSnapshot).toBeDefined();
  });
});
