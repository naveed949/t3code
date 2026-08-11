import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type { SubscriptionAllowanceGroup } from "@t3tools/client-runtime/state/subscription-allowance";
import type {
  SubscriptionAllowance,
  SubscriptionAllowanceProviderKind,
  SubscriptionAllowanceSpendingControl,
  SubscriptionAllowanceWindow,
} from "@t3tools/contracts";
import { SUBSCRIPTION_ALLOWANCE_COMPATIBILITY_MESSAGE } from "@t3tools/client-runtime/state/subscription-allowance";

import { PROVIDER_LABEL } from "./usageProviderLabels";

export interface MobileAllowanceSourceModel {
  readonly key: string;
  readonly environmentLabel: string;
  readonly instanceId: string;
  readonly connectionLabel: string;
  readonly status: SubscriptionAllowance["status"];
  readonly freshness: "fresh" | "stale";
  readonly isEffective: boolean;
}

export interface MobileAllowanceCardModel {
  readonly key: string;
  readonly provider: SubscriptionAllowanceProviderKind;
  readonly providerLabel: string;
  readonly accountLabel: string | null;
  readonly sourceLabel: string;
  readonly status: SubscriptionAllowance["status"];
  readonly message: string;
  readonly freshness: "fresh" | "stale";
  readonly updatedAt: string | null;
  readonly windows: readonly SubscriptionAllowanceWindow[];
  readonly credits: NonNullable<SubscriptionAllowance["credits"]> | null;
  readonly spendingControl: SubscriptionAllowanceSpendingControl | null;
  readonly extraUsage: NonNullable<SubscriptionAllowance["extraUsage"]> | null;
  readonly hasMultipleReadings: boolean;
  readonly sources: readonly MobileAllowanceSourceModel[];
}

export function formatAllowanceWindowScope(scope: string): string {
  switch (scope) {
    case "primary":
      return "Primary limit";
    case "secondary":
      return "Secondary limit";
    case "five_hour":
      return "5-hour limit";
    case "seven_day":
      return "7-day limit";
    case "seven_day_oauth_apps":
      return "7-day OAuth apps limit";
    case "seven_day_opus":
      return "7-day Opus limit";
    case "seven_day_sonnet":
      return "7-day Sonnet limit";
    default:
      return scope;
  }
}

export function formatAllowanceDuration(minutes: number | null | undefined): string | null {
  if (minutes === null || minutes === undefined) return null;
  if (minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60);
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${minutes} minutes`;
}

export function progressWidthForAllowance(usedPercent: number): number {
  return Math.min(100, Math.max(0, usedPercent));
}

export function formatAllowanceResetAt(resetsAt: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(resetsAt));
}

export function formatAllowanceUpdatedAt(updatedAt: string | null | undefined): string | null {
  if (updatedAt === null || updatedAt === undefined) return null;
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatAllowanceConnectionPhase(phase: EnvironmentConnectionPhase): string {
  switch (phase) {
    case "available":
      return "Available";
    case "offline":
      return "Offline";
    case "connecting":
      return "Connecting";
    case "reconnecting":
      return "Reconnecting";
    case "connected":
      return "Connected";
    case "error":
      return "Connection failed";
  }
}

export function formatAllowanceUnavailableMessage(
  provider: SubscriptionAllowanceProviderKind,
  message: string | undefined,
): string {
  if (message !== undefined) return message;
  return provider === "claude"
    ? "Claude subscription usage is unavailable. Claude did not provide usage limits."
    : "Subscription usage is unavailable.";
}

export function formatAllowanceEnvironmentNotice(environment: {
  readonly label: string;
  readonly connectionPhase: EnvironmentConnectionPhase;
  readonly compatibility?: boolean;
  readonly error: string | null;
  readonly snapshot: unknown;
}): string | null {
  if (environment.compatibility === true) {
    return `${environment.label}: ${SUBSCRIPTION_ALLOWANCE_COMPATIBILITY_MESSAGE}`;
  }
  if (environment.error !== null) {
    return `${environment.label} could not report subscription usage.`;
  }
  if (environment.snapshot === null && environment.connectionPhase !== "connected") {
    return `${environment.label} is ${formatAllowanceConnectionPhase(environment.connectionPhase).toLowerCase()}; subscription usage will return when it reconnects.`;
  }
  return null;
}

export function presentAllowanceGroup(group: SubscriptionAllowanceGroup): MobileAllowanceCardModel {
  const displayedSource = group.effectiveSource ?? group.sources[0];
  if (displayedSource === undefined) {
    throw new Error("Subscription allowance groups must contain a source");
  }

  const allowance = displayedSource.allowance;
  const sourceLabel = [
    displayedSource.environmentLabel,
    allowance.instanceId,
    formatAllowanceConnectionPhase(displayedSource.connectionPhase),
  ].join(" · ");

  return {
    key: group.key,
    provider: allowance.provider,
    providerLabel: PROVIDER_LABEL[allowance.provider],
    accountLabel: group.accountLabel,
    sourceLabel,
    status: allowance.status,
    message: formatAllowanceUnavailableMessage(allowance.provider, allowance.message),
    freshness: allowance.freshness ?? "fresh",
    updatedAt: allowance.updatedAt ?? null,
    windows: allowance.windows,
    credits: allowance.credits ?? null,
    spendingControl: allowance.spendingControl ?? null,
    extraUsage: allowance.extraUsage ?? null,
    hasMultipleReadings: group.hasMultipleReadings,
    sources: group.sources.map((source, index) => ({
      key: `${source.environmentId}:${source.allowance.instanceId}:${index}`,
      environmentLabel: source.environmentLabel,
      instanceId: source.allowance.instanceId,
      connectionLabel: formatAllowanceConnectionPhase(source.connectionPhase),
      status: source.allowance.status,
      freshness: source.allowance.freshness ?? "fresh",
      isEffective: source === displayedSource,
    })),
  };
}
