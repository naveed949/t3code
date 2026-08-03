import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { ThreadId } from "@t3tools/contracts";
import { deriveWayfinderWorkflowViewModel } from "@t3tools/client-runtime/state/wayfinder-workflow";

import { nextWorkflowOutlineIndex, WorkflowPanel } from "./WorkflowPanel.tsx";

const model = deriveWayfinderWorkflowViewModel({
  map: {
    canonicalReference: {
      number: 42,
      title: "Release workflow",
      url: "https://github.com/t3tools/t3code/issues/42",
      state: "open",
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
        state: "open",
        classification: "research",
        claimedBy: null,
        blockedBy: [],
        blocks: [44],
      },
      {
        number: 44,
        title: "Choose deployment",
        url: "https://github.com/t3tools/t3code/issues/44",
        state: "open",
        classification: "grilling",
        claimedBy: null,
        blockedBy: [43],
        blocks: [],
      },
    ],
    frontier: [43],
    lastSynchronizedAt: "2026-01-02T00:00:00.000Z",
  },
  mutation: null,
  research: {
    automaticLaunchesPaused: false,
    concurrencyLimit: 2,
    tickets: [
      {
        ticketNumber: 43,
        launchMode: "automatic",
        status: "active",
        updatedAt: "2026-01-03T00:00:00.000Z",
      },
    ],
    updatedAt: "2026-01-03T00:00:00.000Z",
  },
  ticketThreads: [{ ticketNumber: 43, threadId: ThreadId.make("wayfinder-ticket:release:43") }],
  synchronization: null,
  readiness: {
    ready: false,
    blockers: [{ kind: "open-decision-tickets", ticketNumbers: [43, 44] }],
  },
  mutationsEnabled: true,
});

describe("WorkflowPanel", () => {
  it("renders the workstream projection, complete accessible outline, and selected inspector", () => {
    const markup = renderToStaticMarkup(
      <WorkflowPanel model={model} initialSelectedNodeId="ticket:44" />,
    );

    expect(markup).toContain('data-workflow-panel="server-projection"');
    expect(markup).toContain('data-workflow-scope="workstream"');
    expect(markup).toContain("Stage spine");
    expect(markup).toContain("Current checkpoint or attention");
    expect(markup).toContain("Research #43 is active.");
    expect(markup).toContain("Ticket Frontier");
    expect(markup).toContain('role="tree"');
    expect(markup).toContain('data-workflow-outline="complete"');
    expect(markup).toContain('role="treeitem"');
    expect(markup).toContain("Blocked by #43");
    expect(markup).toContain('data-workflow-node-inspector="ticket:44"');
    expect(markup).toContain("Evidence");
    expect(markup).toContain("History");
    expect(markup).toContain("Lineage");
    expect(markup).toContain("Linked thread");
    expect(markup).toContain("Allowed Actions");
    expect(markup).not.toContain("Plan Step");
  });

  it("moves through every outline node with standard keyboard commands", () => {
    expect(nextWorkflowOutlineIndex("ArrowDown", 0, 2)).toBe(1);
    expect(nextWorkflowOutlineIndex("ArrowUp", 1, 2)).toBe(0);
    expect(nextWorkflowOutlineIndex("Home", 1, 2)).toBe(0);
    expect(nextWorkflowOutlineIndex("End", 0, 2)).toBe(1);
    expect(nextWorkflowOutlineIndex("Enter", 0, 2)).toBeNull();
  });
});
