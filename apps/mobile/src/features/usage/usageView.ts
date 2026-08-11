export type UsageView = "subscription" | "historical";

export const USAGE_VIEW_OPTIONS = [
  { value: "subscription" as const, label: "Subscription" },
  { value: "historical" as const, label: "Historical" },
] as const;

export type SubscriptionViewPhase = "loading" | "partial" | "ready";

/**
 * A partial projection can still render the sources that already answered.
 * Only an empty first response needs the blocking loading state.
 */
export function subscriptionViewPhase(input: {
  readonly isPending: boolean;
  readonly isPartial: boolean;
  readonly groupCount: number;
}): SubscriptionViewPhase {
  if (input.isPending || (input.isPartial && input.groupCount === 0)) return "loading";
  return input.isPartial ? "partial" : "ready";
}
