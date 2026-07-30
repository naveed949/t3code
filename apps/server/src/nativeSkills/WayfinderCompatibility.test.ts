import { describe, expect, it } from "vite-plus/test";

import { renderNativeWayfinderArguments } from "./WayfinderCompatibility.ts";

describe("renderNativeWayfinderArguments", () => {
  it("keeps new-map execution unpublished and one decision at a time", () => {
    const rendered = renderNativeWayfinderArguments({
      skill: { name: "wayfinder" },
      action: { id: "new-map" },
      arguments: "new-map",
    });

    expect(rendered).toContain("new-map");
    expect(rendered).toContain("one decision at a time");
    expect(rendered).toContain("(Recommended)");
    expect(rendered).toContain("Do not create or mutate any GitHub");
  });

  it("does not instrument continuation or another native skill", () => {
    expect(
      renderNativeWayfinderArguments({
        skill: { name: "wayfinder" },
        action: { id: "continue-map", reference: "5" },
        arguments: "continue-map 5",
      }),
    ).toBe("continue-map 5");
    expect(
      renderNativeWayfinderArguments({
        skill: { name: "research" },
        arguments: "topic",
      }),
    ).toBe("topic");
  });
});
