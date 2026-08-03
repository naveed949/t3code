import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  SkillRunId,
  ThreadId,
  TurnId,
  WorkstreamId,
} from "@t3tools/contracts";

import {
  deriveEnvironmentWorkstreams,
  deriveProjectWorkstreams,
  findThreadWayfinderWorkstream,
  findWayfinderReconciliationInvocation,
} from "./skillRuns.ts";

const invocation = {
  workstreamId: WorkstreamId.make("workstream:1"),
  skillRunId: SkillRunId.make("skill-run:1"),
  projectId: ProjectId.make("project-1"),
  threadId: ThreadId.make("thread-1"),
  skill: {
    name: "wayfinder",
    path: "/skills/wayfinder/SKILL.md",
    contentDigest: "sha256:257e40665b28ae959ffdcb97d7a72b074360f4a3d201bd84786505308546e434",
  },
  arguments: "chart a release",
  execution: {
    mode: "native" as const,
    adapterId: "wayfinder",
    adapterVersion: 1,
  },
  createdAt: "2026-01-01T00:00:00.000Z",
};

it("derives durable project Workstreams from shared Skill Run state", () => {
  expect(deriveProjectWorkstreams(ProjectId.make("project-1"), [invocation])).toEqual([
    {
      id: WorkstreamId.make("workstream:1"),
      projectId: ProjectId.make("project-1"),
      status: "active",
      linkedThreadIds: [ThreadId.make("thread-1")],
      ticketThreads: [],
      skillRuns: [invocation],
      wayfinderMap: null,
      wayfinderSynchronization: null,
      workflowAttachment: null,
      readiness: {
        ready: false,
        blockers: [
          { kind: "canonical-map-missing" },
          { kind: "tracker-synchronization-unhealthy", status: "unknown" },
        ],
      },
    },
  ]);
});

it("keeps an explicitly attached workflow reopenable from durable thread state", () => {
  const synchronizedAt = "2026-08-03T12:00:00.000Z";
  const originThread = {
    id: ThreadId.make("thread-workflow-origin"),
    projectId: ProjectId.make("project-workflow"),
    title: "Workflow origin",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: synchronizedAt,
    updatedAt: synchronizedAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    workflowAttachment: {
      originThreadId: ThreadId.make("thread-workflow-origin"),
      workstreamId: WorkstreamId.make("workstream:workflow-origin"),
      sourceSkillRunId: SkillRunId.make("skill-run:workflow-origin"),
      workflowGoal: "Ship the workflow.",
      backfilledWayfinderData: {
        wayfinderMap: {
          canonicalReference: {
            number: 29,
            title: "Development Workflow",
            url: "https://github.com/t3tools/t3code/issues/29",
            state: "open" as const,
          },
          destination: "Ship the workflow.",
          notes: "",
          decisionsSoFar: [],
          fogOfWar: [],
          outOfScope: [],
          tickets: [],
          frontier: [],
          lastSynchronizedAt: synchronizedAt,
        },
        wayfinderSynchronizedAt: synchronizedAt,
        wayfinderSynchronization: {
          status: "healthy" as const,
          reason: "resume" as const,
          lastAttemptedAt: synchronizedAt,
          lastSuccessfulAt: synchronizedAt,
          canMutate: true,
        },
      },
      observationCursor: {
        sourceSkillRunId: SkillRunId.make("skill-run:workflow-origin"),
        observedAt: synchronizedAt,
        wayfinderSynchronizedAt: synchronizedAt,
      },
      attachedAt: synchronizedAt,
    },
  };

  const [workstream] = deriveProjectWorkstreams(originThread.projectId, [], [originThread]);

  expect(workstream?.id).toBe("workstream:workflow-origin");
  expect(workstream?.workflowAttachment?.originThreadId).toBe(originThread.id);
  expect(workstream?.wayfinderMap?.canonicalReference.number).toBe(29);
  expect(workstream?.wayfinderSynchronization?.status).toBe("healthy");
  expect(workstream?.linkedThreadIds).toEqual([originThread.id]);
  expect(
    deriveEnvironmentWorkstreams(EnvironmentId.make("environment:workflow"), [], [originThread]),
  ).toMatchObject([
    {
      environmentId: "environment:workflow",
      projectId: originThread.projectId,
      id: "workstream:workflow-origin",
    },
  ]);
});

it("derives durable ticket-to-thread links from pinned linked-ticket runs", () => {
  const linkedInvocation = {
    ...invocation,
    skillRunId: SkillRunId.make("skill-run:ticket-43"),
    threadId: ThreadId.make("wayfinder-ticket:workstream:1:43"),
    action: {
      id: "work-ticket" as const,
      ticketNumber: 43,
      sourceSkillRunId: invocation.skillRunId,
    },
  };

  expect(
    deriveProjectWorkstreams(invocation.projectId, [invocation, linkedInvocation])[0]
      ?.ticketThreads,
  ).toEqual([
    {
      ticketNumber: 43,
      threadId: linkedInvocation.threadId,
      skillRunId: linkedInvocation.skillRunId,
      sourceSkillRunId: invocation.skillRunId,
      status: "active",
    },
  ]);
});

it("recomputes linked HITL thread state from the canonical ticket projection", () => {
  const source = {
    ...invocation,
    wayfinderMap: {
      canonicalReference: {
        number: 42,
        title: "Release map",
        url: "https://github.com/t3tools/t3code/issues/42",
        state: "open" as const,
      },
      destination: "Choose a safe release path.",
      notes: "",
      decisionsSoFar: [],
      fogOfWar: [],
      outOfScope: ["Deferred packaging"],
      tickets: [
        {
          number: 43,
          title: "Choose hosting",
          url: "https://github.com/t3tools/t3code/issues/43",
          state: "closed" as const,
          classification: "out-of-scope" as const,
          claimedBy: "alice",
          blockedBy: [],
          blocks: [],
        },
      ],
      frontier: [],
      lastSynchronizedAt: "2026-01-02T00:00:00.000Z",
    },
  };
  const linked = {
    ...source,
    wayfinderMap: undefined,
    skillRunId: SkillRunId.make("skill-run:ticket-43"),
    threadId: ThreadId.make("wayfinder-ticket:workstream:1:43"),
    action: {
      id: "work-ticket" as const,
      ticketNumber: 43,
      sourceSkillRunId: source.skillRunId,
    },
  };

  expect(
    deriveProjectWorkstreams(source.projectId, [source, linked])[0]?.ticketThreads[0]?.status,
  ).toBe("out-of-scope");
});

describe("deriveProjectWorkstreams", () => {
  it("keeps runs discoverable independently of a thread's latest turn", () => {
    expect(
      deriveProjectWorkstreams(ProjectId.make("project-2"), [
        {
          ...invocation,
          projectId: ProjectId.make("project-1"),
        },
      ]),
    ).toEqual([]);
  });
});

it("marks a reconciled map completed and keeps its canonical projection discoverable", () => {
  const wayfinderMap = {
    canonicalReference: {
      number: 42,
      title: "Release map",
      url: "https://github.com/t3tools/t3code/issues/42",
      state: "closed" as const,
    },
    destination: "A release plan.",
    notes: "",
    decisionsSoFar: [],
    fogOfWar: [],
    outOfScope: [],
    tickets: [],
    frontier: [],
    lastSynchronizedAt: "2026-01-02T00:00:00.000Z",
  };
  const refreshedAt = "2026-01-03T00:00:00.000Z";
  expect(
    deriveProjectWorkstreams(ProjectId.make("project-1"), [
      { ...invocation, wayfinderMap },
      {
        ...invocation,
        skillRunId: SkillRunId.make("skill-run:2"),
        createdAt: refreshedAt,
        wayfinderSynchronizedAt: refreshedAt,
        wayfinderSynchronization: {
          status: "healthy" as const,
          reason: "manual" as const,
          lastAttemptedAt: refreshedAt,
          lastSuccessfulAt: refreshedAt,
          canMutate: true,
        },
      },
    ]),
  ).toMatchObject([
    {
      status: "completed",
      wayfinderMap: { ...wayfinderMap, lastSynchronizedAt: refreshedAt },
    },
  ]);
});

it("finds the freshest Wayfinder Workstream linked to a thread", () => {
  const workstreams = deriveProjectWorkstreams(ProjectId.make("project-1"), [
    {
      ...invocation,
      wayfinderMap: {
        canonicalReference: {
          number: 41,
          title: "Older map",
          url: "https://github.com/t3tools/t3code/issues/41",
          state: "open",
        },
        destination: "Older",
        notes: "",
        decisionsSoFar: [],
        fogOfWar: [],
        outOfScope: [],
        tickets: [],
        frontier: [],
        lastSynchronizedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    {
      ...invocation,
      workstreamId: WorkstreamId.make("workstream:2"),
      skillRunId: SkillRunId.make("skill-run:2"),
      wayfinderMap: {
        canonicalReference: {
          number: 42,
          title: "Current map",
          url: "https://github.com/t3tools/t3code/issues/42",
          state: "open",
        },
        destination: "Current",
        notes: "",
        decisionsSoFar: [],
        fogOfWar: [],
        outOfScope: [],
        tickets: [],
        frontier: [],
        lastSynchronizedAt: "2026-01-02T00:00:00.000Z",
      },
    },
  ]);
  expect(
    findThreadWayfinderWorkstream(ThreadId.make("thread-1"), workstreams)?.wayfinderMap
      ?.canonicalReference.number,
  ).toBe(42);
});

it("reconciles through the map-owning linked thread after a newer continuation run", () => {
  const mapOwner = {
    ...invocation,
    threadId: ThreadId.make("thread:map-owner"),
    wayfinderMap: {
      canonicalReference: {
        number: 42,
        title: "Current map",
        url: "https://github.com/t3tools/t3code/issues/42",
        state: "open" as const,
      },
      destination: "Current",
      notes: "",
      decisionsSoFar: [],
      fogOfWar: [],
      outOfScope: [],
      tickets: [],
      frontier: [],
      lastSynchronizedAt: "2026-01-02T00:00:00.000Z",
    },
  };
  const continuation = {
    ...invocation,
    skillRunId: SkillRunId.make("skill-run:continuation"),
    threadId: ThreadId.make("thread:continuation"),
    createdAt: "2026-01-03T00:00:00.000Z",
    wayfinderSynchronizedAt: "2026-01-03T00:00:00.000Z",
  };
  const [workstream] = deriveProjectWorkstreams(ProjectId.make("project-1"), [
    mapOwner,
    continuation,
  ]);

  expect(findWayfinderReconciliationInvocation(workstream ?? null, continuation)).toMatchObject({
    skillRunId: mapOwner.skillRunId,
    threadId: mapOwner.threadId,
  });
});

it("routes linked-ticket work back through its published source map run", () => {
  const wayfinderMap = {
    canonicalReference: {
      number: 42,
      title: "Current map",
      url: "https://github.com/t3tools/t3code/issues/42",
      state: "open" as const,
    },
    destination: "Current",
    notes: "",
    decisionsSoFar: [],
    fogOfWar: [],
    outOfScope: [],
    tickets: [],
    frontier: [],
    lastSynchronizedAt: "2026-01-02T00:00:00.000Z",
  };
  const source = { ...invocation, wayfinderMap };
  const linked = {
    ...source,
    skillRunId: SkillRunId.make("skill-run:ticket-43"),
    threadId: ThreadId.make("wayfinder-ticket:workstream:1:43"),
    createdAt: "2026-01-03T00:00:00.000Z",
    action: {
      id: "work-ticket" as const,
      ticketNumber: 43,
      sourceSkillRunId: source.skillRunId,
    },
  };
  const [workstream] = deriveProjectWorkstreams(source.projectId, [source, linked]);

  expect(findWayfinderReconciliationInvocation(workstream ?? null, linked)).toMatchObject({
    skillRunId: source.skillRunId,
    threadId: source.threadId,
  });
});

it("does not report completion until reconciliation is healthy and reactivates reopened work", () => {
  const synchronizedAt = "2026-01-04T00:00:00.000Z";
  const baseMap = {
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
        number: 43,
        title: "Choose hosting",
        url: "https://github.com/t3tools/t3code/issues/43",
        state: "open" as const,
        classification: "grilling" as const,
        claimedBy: null,
        blockedBy: [],
        blocks: [],
      },
    ],
    frontier: [43],
    lastSynchronizedAt: synchronizedAt,
  };
  const [workstream] = deriveProjectWorkstreams(ProjectId.make("project-1"), [
    {
      ...invocation,
      wayfinderMap: baseMap,
      wayfinderSynchronization: {
        status: "healthy" as const,
        reason: "resume" as const,
        lastAttemptedAt: synchronizedAt,
        lastSuccessfulAt: synchronizedAt,
        canMutate: true,
      },
    },
  ]);

  expect(workstream?.status).toBe("active");
  const [unavailableWorkstream] = deriveProjectWorkstreams(ProjectId.make("project-1"), [
    {
      ...invocation,
      wayfinderMap: {
        ...baseMap,
        canonicalReference: { ...baseMap.canonicalReference, state: "closed" as const },
        tickets: baseMap.tickets.map((ticket) => ({ ...ticket, state: "closed" as const })),
        frontier: [],
      },
      wayfinderSynchronization: {
        status: "unavailable" as const,
        reason: "resume" as const,
        lastAttemptedAt: synchronizedAt,
        lastSuccessfulAt: synchronizedAt,
        canMutate: false,
        message: "GitHub unavailable",
      },
    },
  ]);
  expect(unavailableWorkstream?.status).toBe("active");
  expect(unavailableWorkstream?.readiness.blockers).toContainEqual({
    kind: "tracker-synchronization-unhealthy",
    status: "unavailable",
  });
});

it("recomputes completion only after linked runtime work is no longer active", () => {
  const synchronizedAt = "2026-01-04T00:00:00.000Z";
  const completedInvocation = {
    ...invocation,
    wayfinderMap: {
      canonicalReference: {
        number: 42,
        title: "Release map",
        url: "https://github.com/t3tools/t3code/issues/42",
        state: "closed" as const,
      },
      destination: "A release plan.",
      notes: "",
      decisionsSoFar: [],
      fogOfWar: [],
      outOfScope: [],
      tickets: [],
      frontier: [],
      lastSynchronizedAt: synchronizedAt,
    },
    wayfinderSynchronization: {
      status: "healthy" as const,
      reason: "resume" as const,
      lastAttemptedAt: synchronizedAt,
      lastSuccessfulAt: synchronizedAt,
      canMutate: true,
    },
  };
  const linkedInvocation = {
    ...completedInvocation,
    wayfinderMap: undefined,
    skillRunId: SkillRunId.make("skill-run:ticket-43"),
    threadId: ThreadId.make("thread-ticket-43"),
    action: {
      id: "work-ticket" as const,
      ticketNumber: 43,
      sourceSkillRunId: completedInvocation.skillRunId,
    },
  };
  const runningThread = {
    id: linkedInvocation.threadId,
    projectId: invocation.projectId,
    title: "Linked Wayfinder run",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5",
    },
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    branch: null,
    worktreePath: null,
    latestTurn: {
      turnId: TurnId.make("turn:linked"),
      state: "running" as const,
      requestedAt: synchronizedAt,
      startedAt: synchronizedAt,
      completedAt: null,
      assistantMessageId: null,
    },
    createdAt: synchronizedAt,
    updatedAt: synchronizedAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: synchronizedAt,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };

  expect(
    deriveProjectWorkstreams(
      invocation.projectId,
      [completedInvocation, linkedInvocation],
      [runningThread],
    )[0]?.status,
  ).toBe("active");
  expect(
    deriveProjectWorkstreams(
      invocation.projectId,
      [completedInvocation, linkedInvocation],
      [runningThread],
    )[0]?.readiness.blockers,
  ).toContainEqual({ kind: "active-linked-ticket-threads", ticketNumbers: [43] });
  expect(
    deriveProjectWorkstreams(
      invocation.projectId,
      [completedInvocation, linkedInvocation],
      [{ ...runningThread, latestTurn: { ...runningThread.latestTurn, state: "completed" } }],
    )[0]?.status,
  ).toBe("completed");
});

it("does not let an active non-ticket run block Wayfinder readiness", () => {
  const synchronizedAt = "2026-01-04T00:00:00.000Z";
  const completedInvocation = {
    ...invocation,
    wayfinderMap: {
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
      tickets: [],
      frontier: [],
      lastSynchronizedAt: synchronizedAt,
    },
    wayfinderSynchronization: {
      status: "healthy" as const,
      reason: "resume" as const,
      lastAttemptedAt: synchronizedAt,
      lastSuccessfulAt: synchronizedAt,
      canMutate: true,
    },
  };
  const runningMapThread = {
    id: invocation.threadId,
    projectId: invocation.projectId,
    title: "Shared map",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    branch: null,
    worktreePath: null,
    latestTurn: {
      turnId: TurnId.make("turn:map"),
      state: "running" as const,
      requestedAt: synchronizedAt,
      startedAt: synchronizedAt,
      completedAt: null,
      assistantMessageId: null,
      skillInvocation: completedInvocation,
    },
    createdAt: synchronizedAt,
    updatedAt: synchronizedAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: synchronizedAt,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };

  expect(
    deriveProjectWorkstreams(invocation.projectId, [completedInvocation], [runningMapThread])[0]
      ?.readiness,
  ).toEqual({ ready: true, blockers: [] });
});

it("recovers a provenance-linked to-spec run in the source Workstream", () => {
  const source = {
    ...invocation,
    wayfinderMap: {
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
      tickets: [],
      frontier: [],
      lastSynchronizedAt: "2026-01-02T00:00:00.000Z",
    },
    wayfinderSynchronization: {
      status: "healthy" as const,
      reason: "manual" as const,
      lastAttemptedAt: "2026-01-02T00:00:00.000Z",
      lastSuccessfulAt: "2026-01-02T00:00:00.000Z",
      canMutate: true,
    },
  };
  const handoff = {
    ...invocation,
    skillRunId: SkillRunId.make("skill-run:to-spec"),
    threadId: ThreadId.make("thread-to-spec"),
    skill: {
      ...invocation.skill,
      name: "to-spec",
      path: "/skills/to-spec/SKILL.md",
    },
    execution: { mode: "generic" as const, reason: "user-selected-generic" as const },
    action: {
      id: "handoff-to-spec" as const,
      sourceSkillRunId: source.skillRunId,
      sourceThreadId: source.threadId,
      canonicalReference: { number: 42, url: source.wayfinderMap.canonicalReference.url },
      wayfinderSynchronizedAt: source.wayfinderMap.lastSynchronizedAt,
      acknowledgedIncomplete: false,
    },
  };

  const [workstream] = deriveProjectWorkstreams(source.projectId, [source, handoff]);

  expect(workstream?.skillRuns.map((run) => run.skill.name)).toEqual(["wayfinder", "to-spec"]);
  expect(workstream?.wayfinderMap?.canonicalReference.number).toBe(42);
  expect(workstream?.status).toBe("completed");
});

it("scopes project Workstreams to their owning environment", () => {
  expect(
    deriveEnvironmentWorkstreams(EnvironmentId.make("environment:1"), [invocation]),
  ).toMatchObject([
    {
      environmentId: EnvironmentId.make("environment:1"),
      projectId: ProjectId.make("project-1"),
      status: "active",
    },
  ]);
});
