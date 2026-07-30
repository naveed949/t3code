import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { WayfinderWorkbench } from "./WayfinderWorkbench.tsx";

const map = {
  canonicalReference: {
    number: 42,
    title: "Release map",
    url: "https://github.com/t3tools/t3code/issues/42",
    state: "open" as const,
  },
  destination: "A release plan ready for specification.",
  notes: "Planning only.",
  decisionsSoFar: [],
  fogOfWar: ["Deployment ownership"],
  outOfScope: ["Building the release"],
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

describe("WayfinderWorkbench", () => {
  it("renders the canonical map, frontier first, and a non-animated dependency graph", () => {
    const markup = renderToStaticMarkup(
      <WayfinderWorkbench
        map={map}
        synchronization={null}
        connected
        onReconcile={() => undefined}
      />,
    );
    expect(markup).toContain('aria-label="Release map. 1 frontier ticket');
    expect(markup).toContain('href="https://github.com/t3tools/t3code/issues/42"');
    expect(markup.indexOf("Research hosting")).toBeLessThan(markup.indexOf("Choose deployment"));
    expect(markup).toContain('data-wayfinder-dependency-graph="stable"');
    expect(markup).toContain('data-wayfinder-edge="43:44"');
    expect(markup).not.toMatch(/animate-|transition-/u);
  });

  it("exposes Wayfinder-specific actions and the active approval state", () => {
    const markup = renderToStaticMarkup(
      <WayfinderWorkbench
        map={map}
        mutation={{
          actionId: "action:close",
          action: { kind: "close-ticket", ticketNumber: 43 },
          status: "awaiting-approval",
          error: null,
          updatedAt: "2026-01-02T00:01:00.000Z",
        }}
        onMutate={() => undefined}
        synchronization={null}
        connected
        onReconcile={() => undefined}
      />,
    );

    expect(markup).toContain("Structured actions");
    expect(markup).toContain("Confirm GitHub change");
    expect(markup).toContain('aria-label="Wayfinder destination"');
    expect(markup).toContain('aria-label="New ticket title"');
    expect(markup).toContain('aria-label="Blocker ticket"');
    expect(markup).toContain('href="https://github.com/t3tools/t3code/issues/42"');
  });

  it("keeps the cached map visible and mutations disabled during a GitHub outage", () => {
    const markup = renderToStaticMarkup(
      <WayfinderWorkbench
        map={map}
        synchronization={{
          status: "unavailable",
          reason: "poll",
          lastAttemptedAt: "2026-01-02T00:01:00.000Z",
          lastSuccessfulAt: "2026-01-02T00:00:00.000Z",
          canMutate: false,
          message: "GitHub is temporarily unavailable.",
        }}
        connected
        onReconcile={() => undefined}
      />,
    );

    expect(markup).toContain("Cached read-only map");
    expect(markup).toContain("GitHub is temporarily unavailable.");
    expect(markup).toContain('data-wayfinder-mutations-enabled="false"');
    expect(markup).toContain("Research hosting");
  });
});
