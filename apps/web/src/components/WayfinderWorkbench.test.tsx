import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { WayfinderWorkbench } from "./WayfinderWorkbench.tsx";
import { ThreadId } from "@t3tools/contracts";

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

  it("renders start, return, release, and partial-recovery ticket actions", () => {
    const linkedThreadId = ThreadId.make("wayfinder-ticket:workstream:release:44");
    const markup = renderToStaticMarkup(
      <WayfinderWorkbench
        map={{
          ...map,
          tickets: [
            { ...map.tickets[0]!, claimedBy: "alice" },
            { ...map.tickets[1]!, claimedBy: "alice" },
            {
              ...map.tickets[1]!,
              number: 45,
              title: "Implement release",
              url: "https://github.com/t3tools/t3code/issues/45",
            },
          ],
          frontier: [45],
        }}
        mutation={{
          actionId: "claim:43",
          action: { kind: "claim-ticket", ticketNumber: 43 },
          status: "failed",
          error: "The linked thread is incomplete.",
          updatedAt: "2026-01-02T00:01:00.000Z",
        }}
        ticketThreads={[{ ticketNumber: 44, threadId: linkedThreadId }]}
        onMutate={() => undefined}
        onReturnToThread={() => undefined}
        synchronization={null}
        connected
        onReconcile={() => undefined}
      />,
    );

    expect(markup).toContain("Start work");
    expect(markup).toContain("Return to thread");
    expect(markup).toContain("Release");
    expect(markup).toContain("Retry thread linkage");
  });

  it("renders focused completion and resumable artifact state only for the assigned HITL ticket", () => {
    const action = {
      kind: "complete-hitl-ticket" as const,
      ticketNumber: 43,
      outcome: "resolved" as const,
      resolution: "Use the environment-owned path.",
      contextPointer: "https://github.com/t3tools/t3code/issues/43#issuecomment-1",
      graduatedFog: [],
    };
    const markup = renderToStaticMarkup(
      <WayfinderWorkbench
        map={{
          ...map,
          tickets: map.tickets.map((ticket) =>
            ticket.number === 43 ? { ...ticket, claimedBy: "alice" } : ticket,
          ),
          frontier: [44],
        }}
        mutation={{
          actionId: "resolve:43",
          action,
          status: "failed",
          artifacts: [
            {
              kind: "resolution-comment",
              ticketNumber: 43,
              contextPointer: action.contextPointer,
            },
          ],
          nextStep: "record decision context pointer",
          error: "The HITL resolution is partially applied.",
          updatedAt: "2026-01-02T00:01:00.000Z",
        }}
        assignedTicketNumber={43}
        onMutate={() => undefined}
        onCompleteHitl={() => undefined}
        synchronization={null}
        connected
        onReconcile={() => undefined}
      />,
    );

    expect(markup).toContain("Resolve assigned decision");
    expect(markup).toContain("Complete only #43 Research hosting");
    expect(markup).toContain('aria-label="Verified resolution"');
    expect(markup).toContain('aria-label="Resolution context pointer"');
    expect(markup).toContain("Graduate fog into a ticket");
    expect(markup).toContain("Resume resolution");
    expect(markup).toContain("Next: record decision context pointer");
    expect(markup).not.toContain("Structured actions");
    expect(markup).not.toContain("Start work");
  });
});
