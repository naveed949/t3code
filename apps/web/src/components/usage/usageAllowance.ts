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
