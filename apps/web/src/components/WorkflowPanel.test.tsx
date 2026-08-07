import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import {
  ProviderInstanceId,
  SkillRunId,
  ThreadId,
  WorkflowTicketImplementation,
  WorkstreamId,
} from "@t3tools/contracts";
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

const implementation = {
  id: "workflow-ticket-implementation:44",
  workstreamId: WorkstreamId.make("workstream:release"),
  nodeId: "ticket:44",
  ticketKey: "choose-deployment",
  ticketNumber: 44,
  title: "Choose deployment",
  actionIdentity: "web:implementation-44",
  status: "reviewed",
  originThreadId: ThreadId.make("workflow-origin:release"),
  implementationThreadId: ThreadId.make("workflow-ticket-implementation-thread:44"),
  worktreePath: "/tmp/workflow-ticket-44",
  branch: "codex/workflow/ticket-44",
  fixedPoint: "194ab170154225877be85c58fcdf615faed8a8f3",
  acceptanceCriteria: "The implementation has structured review evidence.",
  providerInstanceId: ProviderInstanceId.make("codex"),
  implementSkill: {
    name: "implement",
    path: ".agents/skills/implement/SKILL.md",
    contentDigest: `sha256:${"a".repeat(64)}`,
  },
  reviewSkill: {
    name: "code-review",
    path: ".agents/skills/code-review/SKILL.md",
    contentDigest: `sha256:${"b".repeat(64)}`,
  },
  implementationSkillRunId: SkillRunId.make("skill-run:implement-44"),
  reviewSkillRunId: SkillRunId.make("skill-run:review-44"),
  validation: [
    {
      name: "focused tests",
      status: "passed",
      command: "vp test run",
      recordedAt: "2026-01-04T00:00:00.000Z",
    },
  ],
  diff: {
    fixedPoint: "194ab170154225877be85c58fcdf615faed8a8f3",
    files: [{ path: "src/release.ts", additions: 4, deletions: 1 }],
    additions: 4,
    deletions: 1,
    capturedAt: "2026-01-04T00:00:00.000Z",
  },
  review: {
    status: "passed",
    skillRunId: SkillRunId.make("skill-run:review-44"),
    fixedPoint: "194ab170154225877be85c58fcdf615faed8a8f3",
    summary: "The implementation meets the ticket acceptance criteria.",
    findings: [],
    completedAt: "2026-01-04T00:00:00.000Z",
  },
  failure: null,
  startedAt: "2026-01-04T00:00:00.000Z",
  updatedAt: "2026-01-04T00:00:00.000Z",
} satisfies WorkflowTicketImplementation;

const modelWithImplementation = {
  ...model,
  outline: model.outline.map((node) =>
    node.id === "ticket:44" ? { ...node, ticketImplementation: implementation } : node,
  ),
};

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
    expect(markup).toContain('data-workflow-workspace-toggle="true"');
    expect(markup).toContain("Open workspace");
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

  it("exposes implementation milestones and structured review evidence in the inspector", () => {
    const markup = renderToStaticMarkup(
      <WorkflowPanel model={modelWithImplementation} initialSelectedNodeId="ticket:44" />,
    );

    expect(markup).toContain("Ticket implementation");
    expect(markup).toContain("Milestone: reviewed");
    expect(markup).toContain("Fixed Point: 194ab170154225877be85c58fcdf615faed8a8f3");
    expect(markup).toContain("Diff: 1 files, +4 -1");
    expect(markup).toContain("focused tests: passed");
    expect(markup).toContain("Code Review: passed");
    expect(markup).toContain("The implementation meets the ticket acceptance criteria.");
  });
});
