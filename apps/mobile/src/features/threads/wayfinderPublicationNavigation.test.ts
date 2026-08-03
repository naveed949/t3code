import { describe, expect, it } from "vite-plus/test";

import { shouldOpenSynchronizedWayfinderMap } from "./wayfinderPublicationNavigation";

describe("shouldOpenSynchronizedWayfinderMap", () => {
  it("opens the Workbench when publication reconciliation completes", () => {
    expect(
      shouldOpenSynchronizedWayfinderMap({
        previousStatus: "publishing",
        status: "synchronized",
        hasThread: true,
        hasMap: true,
      }),
    ).toBe(true);
  });

  it("does not reopen an already synchronized map or navigate before the map arrives", () => {
    expect(
      shouldOpenSynchronizedWayfinderMap({
        previousStatus: "synchronized",
        status: "synchronized",
        hasThread: true,
        hasMap: true,
      }),
    ).toBe(false);
    expect(
      shouldOpenSynchronizedWayfinderMap({
        previousStatus: "publishing",
        status: "synchronized",
        hasThread: true,
        hasMap: false,
      }),
    ).toBe(false);
  });
});
