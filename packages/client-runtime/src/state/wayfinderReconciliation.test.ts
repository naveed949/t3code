import { describe, expect, it } from "vite-plus/test";

import { advanceWayfinderReconciliationLifecycle } from "./wayfinderReconciliation.ts";

describe("advanceWayfinderReconciliationLifecycle", () => {
  it("emits open once and focus after the visible map returns", () => {
    const initial = { connected: true, visible: false, hasOpened: false };
    const opened = advanceWayfinderReconciliationLifecycle(initial, {
      type: "visibility",
      visible: true,
    });
    const hidden = advanceWayfinderReconciliationLifecycle(opened.lifecycle, {
      type: "visibility",
      visible: false,
    });
    const focused = advanceWayfinderReconciliationLifecycle(hidden.lifecycle, {
      type: "visibility",
      visible: true,
    });

    expect(opened.reason).toBe("open");
    expect(hidden.reason).toBeNull();
    expect(focused.reason).toBe("focus");
  });

  it("refreshes on reconnect, manual refresh, and visible polling only", () => {
    const visibleOffline = { connected: false, visible: true, hasOpened: true };
    const reconnected = advanceWayfinderReconciliationLifecycle(visibleOffline, {
      type: "connection",
      connected: true,
    });
    const manual = advanceWayfinderReconciliationLifecycle(reconnected.lifecycle, {
      type: "manual",
    });
    const poll = advanceWayfinderReconciliationLifecycle(reconnected.lifecycle, { type: "poll" });
    const hidden = advanceWayfinderReconciliationLifecycle(
      { ...reconnected.lifecycle, visible: false },
      { type: "poll" },
    );

    expect(reconnected.reason).toBe("reconnect");
    expect(manual.reason).toBe("manual");
    expect(poll.reason).toBe("poll");
    expect(hidden.reason).toBeNull();
  });
});
