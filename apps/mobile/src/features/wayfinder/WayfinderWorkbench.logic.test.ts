import { describe, expect, it } from "vite-plus/test";

import { buildMobileWayfinderPresentation } from "./WayfinderWorkbench.logic";

const map = {
  canonicalReference: {
    number: 42,
    title: "Release map",
    url: "https://github.com/t3tools/t3code/issues/42",
    state: "open" as const,
  },
  destination: "A release plan.",
  notes: "",
  decisionsSoFar: [],
  fogOfWar: [],
  outOfScope: [],
  tickets: [
    {
      number: 44,
      title: "Choose deployment",
      url: "https://github.com/t3tools/t3code/issues/44",
      state: "open" as const,
      classification: "grilling" as const,
      claimedBy: null,
      blockedBy: [43],
      blocks: [],
    },
    {
      number: 43,
      title: "Research hosting",
      url: "https://github.com/t3tools/t3code/issues/43",
      state: "open" as const,
      classification: "research" as const,
      claimedBy: null,
      blockedBy: [],
      blocks: [44],
    },
  ],
  frontier: [43],
  lastSynchronizedAt: "2026-01-02T00:00:00.000Z",
};

describe("buildMobileWayfinderPresentation", () => {
  it("keeps the dependency-aware list frontier-first and exposes compact graph rows", () => {
    const presentation = buildMobileWayfinderPresentation(map);
    expect(presentation.tickets.map((ticket) => ticket.number)).toEqual([43, 44]);
    expect(presentation.graphRows).toEqual([
      { ticketNumber: 43, depth: 0, dependsOn: [] },
      { ticketNumber: 44, depth: 1, dependsOn: [43] },
    ]);
    expect(presentation.graphAccessibilityLabel).toContain(
      "Research hosting enables Choose deployment",
    );
  });
});
