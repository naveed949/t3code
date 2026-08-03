import type { WayfinderReconcileReason } from "@t3tools/contracts";

export const WAYFINDER_CONDITIONAL_REFRESH_INTERVAL_MS = 60_000;

export interface WayfinderReconciliationLifecycle {
  readonly connected: boolean;
  readonly visible: boolean;
  readonly hasOpened: boolean;
}

export type WayfinderReconciliationLifecycleEvent =
  | { readonly type: "visibility"; readonly visible: boolean }
  | { readonly type: "connection"; readonly connected: boolean }
  | { readonly type: "manual" }
  | { readonly type: "poll" };

export function advanceWayfinderReconciliationLifecycle(
  lifecycle: WayfinderReconciliationLifecycle,
  event: WayfinderReconciliationLifecycleEvent,
): {
  readonly lifecycle: WayfinderReconciliationLifecycle;
  readonly reason: WayfinderReconcileReason | null;
} {
  switch (event.type) {
    case "visibility": {
      if (event.visible === lifecycle.visible) return { lifecycle, reason: null };
      return {
        lifecycle: {
          ...lifecycle,
          visible: event.visible,
          hasOpened: lifecycle.hasOpened || event.visible,
        },
        reason: event.visible ? (lifecycle.hasOpened ? "focus" : "open") : null,
      };
    }
    case "connection": {
      return {
        lifecycle: { ...lifecycle, connected: event.connected },
        reason: !lifecycle.connected && event.connected && lifecycle.visible ? "reconnect" : null,
      };
    }
    case "manual":
    case "poll":
      return {
        lifecycle,
        reason: lifecycle.connected && lifecycle.visible ? event.type : null,
      };
  }
}
