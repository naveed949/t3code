import { describe, expect, it } from "vite-plus/test";
import { ThreadId } from "@t3tools/contracts";

import { deriveWayfinderWorkflowViewModel } from "./wayfinderWorkflow.ts";

const map = {
  canonicalReference: {
    number: 42,
    title: "Release workflow",
    url: "https://github.com/t3tools/t3code/issues/42",
    state: "open" as const,
  },
  destination: "Ship the release.",
  notes: "",
  decisionsSoFar: [],
  fogOfWar: [],
  outOfScope: [],
  tickets: [
    {
      number: 43,
      title: "Research hosting",
      url: "https://github.com/t3tools/t3code/issues/43",
      state: "open" as const,
      classification: "research" as const,
      claimedBy: null,
      blockedBy: [],
      blocks: [44],
      commentCount: 2,
      lastCommentedAt: "2026-01-03T00:00:00.000Z",
    },
    {
      number: 44,
      title: "Choose deployment",
      url: "https://github.com/t3tools/t3code/issues/44",
      state: "open" as const,
      classification: "grilling" as const,
      claimedBy: null,
      blockedBy: [43],
      blocks: [45],
    },
    {
      number: 45,
      title: "Implement release",
      url: "https://github.com/t3tools/t3code/issues/45",
      state: "closed" as const,
      classification: "task" as const,
      claimedBy: "maintainer",
      blockedBy: [44],
      blocks: [],
    },
  ],
  frontier: [43],
  lastSynchronizedAt: "2026-01-02T00:00:00.000Z",
};

describe("deriveWayfinderWorkflowViewModel", () => {
  it("keeps the complete server projection in an accessible outline and inspector", () => {
    const linkedThreadId = ThreadId.make("wayfinder-ticket:workstream:release:43");
    const model = deriveWayfinderWorkflowViewModel({
      map,
      mutation: null,
      research: {
        automaticLaunchesPaused: false,
        concurrencyLimit: 2,
        tickets: [
          {
            ticketNumber: 43,
            launchMode: "automatic",
            status: "active",
            threadId: linkedThreadId,
            updatedAt: "2026-01-03T00:00:00.000Z",
          },
        ],
        updatedAt: "2026-01-03T00:00:00.000Z",
      },
      ticketThreads: [{ ticketNumber: 43, threadId: linkedThreadId }],
      synchronization: null,
      readiness: {
        ready: false,
        blockers: [{ kind: "open-decision-tickets", ticketNumbers: [43, 44] }],
      },
      mutationsEnabled: true,
    });

    expect(model.panel.stageSpine).toEqual([
      { id: "wayfinder", label: "Wayfinder", state: "current" },
    ]);
    expect(model.panel.milestone).toMatchObject({ number: 42, title: "Release workflow" });
    expect(model.panel.attention).toEqual({
      kind: "checkpoint",
      label: "Wayfinder checkpoint: 2 decision tickets remain open.",
    });
    expect(model.panel.activeRuns).toEqual([
      {
        kind: "research",
        ticketNumber: 43,
        label: "Research #43 is active.",
      },
    ]);
    expect(model.panel.ticketFrontier).toEqual([
      { id: "ticket:43", number: 43, title: "Research hosting" },
    ]);
    expect(model.outline.map((node) => node.id)).toEqual(["ticket:43", "ticket:44", "ticket:45"]);

    const deployment = model.outline.find((node) => node.number === 44)!;
    expect(deployment.state).toEqual({ label: "Blocked", kind: "blocked" });
    expect(deployment.lineage).toEqual({ blockedBy: [43], enables: [45] });
    expect(deployment.accessibilityLabel).toContain("Blocked by #43");
    expect(deployment.accessibilityLabel).toContain("Enables #45");

    const research = model.outline.find((node) => node.number === 43)!;
    expect(research.evidence).toEqual([
      { label: "Canonical ticket", url: "https://github.com/t3tools/t3code/issues/43" },
      { label: "2 comments" },
    ]);
    expect(research.history).toContain("Last comment 2026-01-03T00:00:00.000Z.");
    expect(research.linkedThreadId).toBe(linkedThreadId);
    expect(research.allowedActions).toEqual(
      expect.arrayContaining([
        { id: "open-canonical-ticket", label: "Open canonical ticket", enabled: true },
        { id: "open-linked-thread", label: "Open linked thread", enabled: true },
      ]),
    );
  });

  it("surfaces recovery from the server projection and never enables mutation controls offline", () => {
    const model = deriveWayfinderWorkflowViewModel({
      map,
      mutation: {
        actionId: "claim:43",
        action: { kind: "claim-ticket", ticketNumber: 43 },
        status: "failed",
        error: "Thread linkage stopped.",
        updatedAt: "2026-01-03T00:00:00.000Z",
      },
      research: null,
      ticketThreads: [],
      synchronization: {
        status: "unavailable",
        reason: "poll",
        lastAttemptedAt: "2026-01-03T00:00:00.000Z",
        canMutate: false,
        message: "GitHub is temporarily unavailable.",
      },
      readiness: { ready: false, blockers: [] },
      mutationsEnabled: false,
    });

    expect(model.panel.attention).toEqual({
      kind: "recovery",
      label: "Thread linkage stopped.",
    });
    expect(model.panel.stageSpine).toEqual([
      { id: "wayfinder", label: "Wayfinder", state: "attention" },
    ]);
    expect(model.outline.find((node) => node.number === 43)?.attention).toEqual({
      kind: "recovery",
      label: "Thread linkage stopped.",
    });
    expect(model.outline.find((node) => node.number === 43)?.allowedActions).toEqual(
      expect.arrayContaining([{ id: "start-research", label: "Start research", enabled: false }]),
    );
  });

  it("keeps native retry and release controls visible in the matching node inspector", () => {
    const model = deriveWayfinderWorkflowViewModel({
      map: {
        ...map,
        tickets: map.tickets.map((ticket) =>
          ticket.number === 44 ? { ...ticket, claimedBy: "maintainer" } : ticket,
        ),
      },
      mutation: {
        actionId: "claim:44",
        action: { kind: "claim-ticket", ticketNumber: 44 },
        status: "failed",
        error: "The linked thread is incomplete.",
        updatedAt: "2026-01-03T00:00:00.000Z",
      },
      research: null,
      ticketThreads: [],
      synchronization: null,
      readiness: { ready: false, blockers: [] },
      mutationsEnabled: true,
    });

    expect(model.outline.find((node) => node.number === 44)?.allowedActions).toEqual(
      expect.arrayContaining([
        { id: "retry-thread-linkage", label: "Retry thread linkage", enabled: true },
        { id: "release-ticket", label: "Release", enabled: true },
      ]),
    );
  });
});
