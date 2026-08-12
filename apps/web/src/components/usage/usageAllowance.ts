import type { SubscriptionAllowanceWindowScope } from "@t3tools/contracts";

export function formatAllowanceWindowScope(scope: SubscriptionAllowanceWindowScope): string {
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

export function formatAllowanceUpdatedAt(
  updatedAt: string | null | undefined,
  now = Date.now(),
): string | null {
  if (updatedAt === null || updatedAt === undefined) return null;
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return null;

  const elapsedMinutes = Math.max(0, Math.floor((now - date.getTime()) / 60_000));
  if (elapsedMinutes < 1) return "Updated just now";
  if (elapsedMinutes < 60) return `Updated ${elapsedMinutes}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `Updated ${elapsedHours}h ago`;

  return `Updated ${Math.floor(elapsedHours / 24)}d ago`;
}
