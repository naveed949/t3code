import { describe, expect, it } from "vite-plus/test";
import {
  ProviderInstanceId,
  SkillRunId,
  ThreadId,
  WorkstreamId,
  type WorkflowAttachment,
  type WorkflowTicketImplementation,
} from "@t3tools/contracts";

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

  it("surfaces exhausted correction cycles as a decision without a retry action", () => {
    const implementation = {
      id: "workflow-ticket-implementation:44",
      workstreamId: WorkstreamId.make("workstream:release"),
      nodeId: "ticket:44",
      ticketKey: "choose-deployment",
      ticketNumber: 44,
      title: "Choose deployment",
      actionIdentity: "client:implementation-44",
      status: "needs-decision",
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
      validation: [],
      diff: null,
      review: null,
      failure: null,
      startedAt: "2026-01-04T00:00:00.000Z",
      updatedAt: "2026-01-04T00:00:00.000Z",
    } satisfies WorkflowTicketImplementation;
    const workflowAttachment = {
      originThreadId: ThreadId.make("workflow-origin:release"),
      workstreamId: WorkstreamId.make("workstream:release"),
      sourceSkillRunId: SkillRunId.make("skill-run:wayfinder-release"),
      workflowGoal: "Ship the release.",
      backfilledWayfinderData: {},
      observationCursor: {
        sourceSkillRunId: SkillRunId.make("skill-run:wayfinder-release"),
        observedAt: "2026-01-04T00:00:00.000Z",
      },
      ticketImplementations: [implementation],
      attachedAt: "2026-01-04T00:00:00.000Z",
    } satisfies WorkflowAttachment;
    const model = deriveWayfinderWorkflowViewModel({
      map,
      mutation: null,
      research: null,
      ticketThreads: [],
      synchronization: null,
      readiness: { ready: true, blockers: [] },
      mutationsEnabled: true,
      workflowAttachment,
    });

    const node = model.outline.find((candidate) => candidate.number === 44);
    expect(node?.state).toEqual({ kind: "blocked", label: "Blocked" });
    expect(node?.attention).toEqual({
      kind: "decision",
      label: "Ticket #44 needs a decision after the automatic correction-cycle limit was reached.",
    });
    expect(node?.allowedActions).not.toEqual(
      expect.arrayContaining([{ id: "start-ticket-implementation" }]),
    );
    expect(node?.accessibilityLabel).toContain("needs a decision");
  });

  it("exposes tracker-closure recovery without replaying implementation", () => {
    const implementation = {
      id: "workflow-ticket-implementation:44",
      workstreamId: WorkstreamId.make("workstream:release"),
      nodeId: "ticket:44",
      ticketKey: "choose-deployment",
      ticketNumber: 44,
      title: "Choose deployment",
      actionIdentity: "client:implementation-44",
      status: "integration-failed" as const,
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
      validation: [],
      diff: null,
      review: null,
      integration: {
        status: "failed" as const,
        baselineBranch: "feature/development-workflow",
        baselineCommit: "integration-commit",
        failurePhase: "tracker" as const,
        failure: "Tracker closure failed.",
        startedAt: "2026-01-04T00:00:00.000Z",
        updatedAt: "2026-01-04T00:00:00.000Z",
      },
      failure: "Tracker closure failed.",
      startedAt: "2026-01-04T00:00:00.000Z",
      updatedAt: "2026-01-04T00:00:00.000Z",
    } satisfies WorkflowTicketImplementation;
    const workflowAttachment = {
      originThreadId: ThreadId.make("workflow-origin:release"),
      workstreamId: WorkstreamId.make("workstream:release"),
      sourceSkillRunId: SkillRunId.make("skill-run:wayfinder-release"),
      workflowGoal: "Ship the release.",
      backfilledWayfinderData: {},
      observationCursor: {
        sourceSkillRunId: SkillRunId.make("skill-run:wayfinder-release"),
        observedAt: "2026-01-04T00:00:00.000Z",
      },
      ticketImplementations: [implementation],
      attachedAt: "2026-01-04T00:00:00.000Z",
    } satisfies WorkflowAttachment;

    const model = deriveWayfinderWorkflowViewModel({
      map,
      mutation: null,
      research: null,
      ticketThreads: [],
      synchronization: null,
      readiness: { ready: true, blockers: [] },
      mutationsEnabled: true,
      workflowAttachment,
    });
    const node = model.outline.find((candidate) => candidate.number === 44);
    expect(node?.attention).toEqual({ kind: "recovery", label: "Tracker closure failed." });
    expect(node?.allowedActions).toEqual(
      expect.arrayContaining([
        { id: "retry-ticket-integration", label: "Retry tracker closure", enabled: true },
      ]),
    );
  });
});
