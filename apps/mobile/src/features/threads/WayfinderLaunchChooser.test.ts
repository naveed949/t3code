import { describe, expect, it } from "vite-plus/test";

import { showsWayfinderLaunchChooser } from "./WayfinderLaunchChooser.logic.ts";

describe("showsWayfinderLaunchChooser", () => {
  it("shows only for a selected Wayfinder token that still needs a launch choice", () => {
    expect(showsWayfinderLaunchChooser("$wayfinder ")).toBe(true);
    expect(showsWayfinderLaunchChooser(" $wayfinder")).toBe(true);
    expect(showsWayfinderLaunchChooser("$wayfinder new-map")).toBe(false);
    expect(showsWayfinderLaunchChooser("Explain $wayfinder")).toBe(false);
  });
});
