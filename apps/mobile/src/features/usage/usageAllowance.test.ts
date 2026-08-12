import {
  formatAllowanceEnvironmentNotice,
  formatAllowanceUpdatedAt,
  formatAllowanceWindowScope,
  presentSubscriptionAllowanceGroup,
  progressWidthForAllowance,
  type SubscriptionAllowanceGroup,
} from "@t3tools/client-runtime/state/subscription-allowance";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

const readAt = "2026-08-11T12:00:00.000Z";

function group(overrides: Partial<SubscriptionAllowanceGroup> = {}): SubscriptionAllowanceGroup {
  const source = {
    environmentId: EnvironmentId.make("phone"),
    environmentLabel: "Phone",
    connectionPhase: "connected" as const,
    allowance: {
      provider: "codex" as const,
      instanceId: ProviderInstanceId.make("codex-personal"),
      status: "available" as const,
      freshness: "fresh" as const,
      updatedAt: readAt,
      windows: [{ scope: "primary", usedPercent: 42, windowDurationMins: 300, resetsAt: readAt }],
    },
  };

  return {
    key: "allowance-group:0",
    provider: "codex",
    accountLabel: null,
    status: "available",
    sources: [source],
    effectiveSource: source,
    hasMultipleReadings: false,
    ...overrides,
  };
}

describe("mobile subscription allowance presentation", () => {
  it("keeps provider-native windows and optional values intact", () => {
    const source = group().effectiveSource!;
    const model = presentSubscriptionAllowanceGroup(
      group({
        accountLabel: "n•••@example.com",
        sources: [
          {
            ...source,
            allowance: {
              ...source.allowance,
              spendingControl: {
                reached: false,
                limit: "100",
                remainingPercent: 75,
                used: "25",
              },
              extraUsage: {
                isEnabled: true,
                monthlyLimit: 100,
                usedCredits: 25,
                utilization: 25,
              },
            },
          },
        ],
        effectiveSource: {
          ...source,
          allowance: {
            ...source.allowance,
            spendingControl: {
              reached: false,
              limit: "100",
              remainingPercent: 75,
              used: "25",
            },
            extraUsage: {
              isEnabled: true,
              monthlyLimit: 100,
              usedCredits: 25,
              utilization: 25,
            },
          },
        },
      }),
    );

    expect(model).toMatchObject({
      provider: "codex",
      accountLabel: "n•••@example.com",
      status: "available",
      freshness: "fresh",
      updatedAt: readAt,
      windows: [
        {
          scope: "primary",
          usedPercent: 42,
          windowDurationMins: 300,
          resetsAt: readAt,
        },
      ],
    });
    expect(model).not.toHaveProperty("spendingControl");
    expect(model).not.toHaveProperty("extraUsage");
  });

  it("uses the stable Claude placeholder without inferring account state", () => {
    const source = group().effectiveSource!;
    const claudeSource = {
      ...source,
      allowance: {
        ...source.allowance,
        provider: "claude" as const,
        instanceId: ProviderInstanceId.make("claude-personal"),
        status: "unavailable" as const,
        windows: [],
        updatedAt: undefined,
        message: undefined,
      },
    };

    const model = presentSubscriptionAllowanceGroup(
      group({
        provider: "claude",
        status: "unavailable",
        sources: [claudeSource],
        effectiveSource: claudeSource,
      }),
    );

    expect(model.message).toBe("Claude did not report subscription usage limits.");
    expect(model.windows).toEqual([]);
    expect(model.accountLabel).toBeNull();
  });

  it("retains stale state, source identity, and multiple-reading context", () => {
    const source = group().effectiveSource!;
    const staleSource = {
      ...source,
      connectionPhase: "offline" as const,
      allowance: {
        ...source.allowance,
        freshness: "stale" as const,
      },
    };

    const model = presentSubscriptionAllowanceGroup(
      group({
        sources: [staleSource],
        effectiveSource: staleSource,
        hasMultipleReadings: true,
      }),
    );

    expect(model.freshness).toBe("stale");
    expect(model.hasMultipleReadings).toBe(true);
    expect(model.sources[0]?.isCurrent).toBe(false);
  });

  it("keeps multiple environment sources inspectable without blending them", () => {
    const source = group().effectiveSource!;
    const secondSource = {
      ...source,
      environmentId: EnvironmentId.make("desktop"),
      environmentLabel: "Desktop",
      allowance: {
        ...source.allowance,
        instanceId: ProviderInstanceId.make("codex-work"),
        windows: [{ scope: "secondary", usedPercent: 8 }],
      },
    };

    const model = presentSubscriptionAllowanceGroup(
      group({
        sources: [source, secondSource],
        effectiveSource: source,
        hasMultipleReadings: true,
      }),
    );

    expect(model.windows).toEqual(source.allowance.windows);
    expect(model.sources.map((item) => item.environmentLabel)).toEqual(["Phone", "Desktop"]);
    expect(model.sources.map((item) => item.isEffective)).toEqual([true, false]);
  });

  it("keeps missing values explicit and describes environment connection state", () => {
    expect(formatAllowanceWindowScope("seven_day_opus")).toBe("7-day Opus limit");
    expect(progressWidthForAllowance(-1)).toBe(0);
    expect(progressWidthForAllowance(101)).toBe(100);
    expect(
      formatAllowanceEnvironmentNotice({
        label: "Desktop",
        connectionPhase: "offline",
        error: null,
        snapshot: null,
      }),
    ).toBe("Desktop is offline; subscription usage will return when it reconnects.");
    expect(
      formatAllowanceEnvironmentNotice({
        label: "Desktop",
        connectionPhase: "connected",
        compatibility: true,
        error: "failed",
        snapshot: null,
      }),
    ).toBe(
      "Desktop: Subscription allowance reporting is not supported by this environment version.",
    );
    expect(
      formatAllowanceEnvironmentNotice({
        label: "Desktop",
        connectionPhase: "connected",
        error: "failed",
        snapshot: null,
      }),
    ).toBe("Desktop could not report subscription usage.");
  });

  it("shows relative freshness without exposing a local timestamp", () => {
    const now = Date.parse("2026-08-12T12:00:00.000Z");

    expect(formatAllowanceUpdatedAt("2026-08-12T12:00:00.000Z", now)).toBe("Updated just now");
    expect(formatAllowanceUpdatedAt("2026-08-12T11:57:00.000Z", now)).toBe("Updated 3m ago");
    expect(formatAllowanceUpdatedAt("2026-08-12T10:00:00.000Z", now)).toBe("Updated 2h ago");
  });
});
