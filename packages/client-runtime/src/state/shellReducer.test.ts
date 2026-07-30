import { describe, expect, it } from "vite-plus/test";

import {
  ProjectId,
  ProviderInstanceId,
  SkillRunId,
  ThreadId,
  TurnId,
  WorkstreamId,
} from "@t3tools/contracts";
import type { OrchestrationShellSnapshot, OrchestrationShellStreamEvent } from "@t3tools/contracts";

import { applyShellStreamEvent } from "./shellReducer.ts";

const baseSnapshot: OrchestrationShellSnapshot = {
  snapshotSequence: 0,
  projects: [],
  threads: [],
  updatedAt: "2026-04-01T00:00:00.000Z",
};

const stubProject = {
  id: ProjectId.make("project-1"),
  title: "Test Project",
  workspaceRoot: "/workspace/test",
  repositoryIdentity: null,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
} as const;

const stubThread = {
  id: ThreadId.make("thread-1"),
  projectId: ProjectId.make("project-1"),
  title: "Test Thread",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  session: null,
} as const;

describe("applyShellStreamEvent", () => {
  it("ignores stale project upserts without mutating the snapshot", () => {
    const snapshotWithProject: OrchestrationShellSnapshot = {
      ...baseSnapshot,
      snapshotSequence: 4,
      projects: [stubProject],
    };

    for (const sequence of [3, 4]) {
      const next = applyShellStreamEvent(snapshotWithProject, {
        kind: "project-upserted",
        sequence,
        project: { ...stubProject, title: "Stale Title" },
      });

      expect(next).toBe(snapshotWithProject);
      expect(next.snapshotSequence).toBe(4);
      expect(next.projects[0]?.title).toBe("Test Project");
    }
  });

  describe("project-upserted", () => {
    it("adds a new project", () => {
      const event: OrchestrationShellStreamEvent = {
        kind: "project-upserted",
        sequence: 1,
        project: stubProject,
      };

      const next = applyShellStreamEvent(baseSnapshot, event);

      expect(next.projects).toHaveLength(1);
      expect(next.projects[0]?.id).toBe("project-1");
      expect(next.snapshotSequence).toBe(1);
    });

    it("updates an existing project", () => {
      const snapshotWithProject: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        projects: [stubProject],
      };

      const updatedProject = { ...stubProject, title: "Updated Title" };
      const event: OrchestrationShellStreamEvent = {
        kind: "project-upserted",
        sequence: 2,
        project: updatedProject,
      };

      const next = applyShellStreamEvent(snapshotWithProject, event);

      expect(next.projects).toHaveLength(1);
      expect(next.projects[0]?.title).toBe("Updated Title");
      expect(next.snapshotSequence).toBe(2);
    });
  });

  describe("project-removed", () => {
    it("removes a project by id", () => {
      const snapshotWithProject: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        projects: [stubProject],
      };

      const event: OrchestrationShellStreamEvent = {
        kind: "project-removed",
        sequence: 3,
        projectId: ProjectId.make("project-1"),
      };

      const next = applyShellStreamEvent(snapshotWithProject, event);

      expect(next.projects).toHaveLength(0);
      expect(next.snapshotSequence).toBe(3);
    });
  });

  describe("thread-upserted", () => {
    it("adds a new thread", () => {
      const event: OrchestrationShellStreamEvent = {
        kind: "thread-upserted",
        sequence: 4,
        thread: stubThread,
      };

      const next = applyShellStreamEvent(baseSnapshot, event);

      expect(next.threads).toHaveLength(1);
      expect(next.threads[0]?.id).toBe("thread-1");
      expect(next.snapshotSequence).toBe(4);
    });

    it("updates an existing thread", () => {
      const snapshotWithThread: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        threads: [stubThread],
      };

      const updatedThread = { ...stubThread, title: "Updated Thread" };
      const event: OrchestrationShellStreamEvent = {
        kind: "thread-upserted",
        sequence: 5,
        thread: updatedThread,
      };

      const next = applyShellStreamEvent(snapshotWithThread, event);

      expect(next.threads).toHaveLength(1);
      expect(next.threads[0]?.title).toBe("Updated Thread");
    });

    it("retains a Skill Run after an ordinary follow-up becomes the latest turn", () => {
      const skillInvocation = {
        workstreamId: WorkstreamId.make("workstream:1"),
        skillRunId: SkillRunId.make("skill-run:1"),
        projectId: ProjectId.make("project-1"),
        threadId: ThreadId.make("thread-1"),
        skill: {
          name: "wayfinder",
          path: "/skills/wayfinder/SKILL.md",
          contentDigest: "sha256:257e40665b28ae959ffdcb97d7a72b074360f4a3d201bd84786505308546e434",
        },
        execution: {
          mode: "native" as const,
          adapterId: "wayfinder",
          adapterVersion: 1,
        },
        createdAt: "2026-04-01T00:00:01.000Z",
      };
      const withSkillRun = applyShellStreamEvent(baseSnapshot, {
        kind: "thread-upserted",
        sequence: 1,
        thread: {
          ...stubThread,
          latestTurn: {
            turnId: TurnId.make("turn-skill"),
            state: "running",
            requestedAt: skillInvocation.createdAt,
            startedAt: skillInvocation.createdAt,
            completedAt: null,
            assistantMessageId: null,
            skillInvocation,
          },
        },
      });

      const afterFollowUp = applyShellStreamEvent(withSkillRun, {
        kind: "thread-upserted",
        sequence: 2,
        thread: {
          ...stubThread,
          latestTurn: {
            turnId: TurnId.make("turn-follow-up"),
            state: "running",
            requestedAt: "2026-04-01T00:00:02.000Z",
            startedAt: "2026-04-01T00:00:02.000Z",
            completedAt: null,
            assistantMessageId: null,
          },
        },
      });

      expect(afterFollowUp.skillRuns).toEqual([skillInvocation]);
    });

    it("keeps only the latest Skill Run summary for each thread", () => {
      const firstInvocation = {
        workstreamId: WorkstreamId.make("workstream:1"),
        skillRunId: SkillRunId.make("skill-run:1"),
        projectId: ProjectId.make("project-1"),
        threadId: ThreadId.make("thread-1"),
        skill: {
          name: "wayfinder",
          path: "/skills/wayfinder/SKILL.md",
          contentDigest: "sha256:first",
        },
        execution: { mode: "generic" as const, reason: "unsupported-provider" as const },
        createdAt: "2026-04-01T00:00:01.000Z",
      };
      const latestInvocation = {
        ...firstInvocation,
        workstreamId: WorkstreamId.make("workstream:2"),
        skillRunId: SkillRunId.make("skill-run:2"),
        createdAt: "2026-04-01T00:00:02.000Z",
      };
      const withFirstRun = applyShellStreamEvent(baseSnapshot, {
        kind: "thread-upserted",
        sequence: 1,
        thread: {
          ...stubThread,
          latestTurn: {
            turnId: TurnId.make("turn-1"),
            state: "completed",
            requestedAt: firstInvocation.createdAt,
            startedAt: firstInvocation.createdAt,
            completedAt: firstInvocation.createdAt,
            assistantMessageId: null,
            skillInvocation: firstInvocation,
          },
        },
      });

      const withLatestRun = applyShellStreamEvent(withFirstRun, {
        kind: "thread-upserted",
        sequence: 2,
        thread: {
          ...stubThread,
          latestTurn: {
            turnId: TurnId.make("turn-2"),
            state: "running",
            requestedAt: latestInvocation.createdAt,
            startedAt: latestInvocation.createdAt,
            completedAt: null,
            assistantMessageId: null,
            skillInvocation: latestInvocation,
          },
        },
      });

      expect(withLatestRun.skillRuns).toEqual([latestInvocation]);
    });

    it("retains one map-bearing run when a same-thread reconnect is compact", () => {
      const mapInvocation = {
        workstreamId: WorkstreamId.make("workstream:map"),
        skillRunId: SkillRunId.make("skill-run:map"),
        projectId: ProjectId.make("project-1"),
        threadId: ThreadId.make("thread-1"),
        skill: {
          name: "wayfinder",
          path: "/skills/wayfinder/SKILL.md",
          contentDigest: "sha256:map",
        },
        execution: {
          mode: "native" as const,
          adapterId: "wayfinder",
          adapterVersion: 1,
        },
        wayfinderMap: {
          canonicalReference: {
            number: 42,
            title: "Release map",
            url: "https://github.com/t3tools/t3code/issues/42",
            state: "open" as const,
          },
          destination: "Ship it.",
          notes: "",
          decisionsSoFar: [],
          fogOfWar: [],
          outOfScope: [],
          tickets: [],
          frontier: [],
          lastSynchronizedAt: "2026-04-01T00:00:01.000Z",
        },
        createdAt: "2026-04-01T00:00:01.000Z",
      };
      const { wayfinderMap: _wayfinderMap, ...compactInvocationFields } = mapInvocation;
      const compactInvocation = {
        ...compactInvocationFields,
        skillRunId: SkillRunId.make("skill-run:reconnect"),
        wayfinderSynchronizedAt: "2026-04-01T00:00:02.000Z",
        createdAt: "2026-04-01T00:00:02.000Z",
      };
      const withMap = applyShellStreamEvent(baseSnapshot, {
        kind: "thread-upserted",
        sequence: 1,
        thread: {
          ...stubThread,
          latestTurn: {
            turnId: TurnId.make("turn-map"),
            state: "completed",
            requestedAt: mapInvocation.createdAt,
            startedAt: mapInvocation.createdAt,
            completedAt: mapInvocation.createdAt,
            assistantMessageId: null,
            skillInvocation: mapInvocation,
          },
        },
      });
      const reconnected = applyShellStreamEvent(withMap, {
        kind: "thread-upserted",
        sequence: 2,
        thread: {
          ...stubThread,
          latestTurn: {
            turnId: TurnId.make("turn-reconnect"),
            state: "running",
            requestedAt: compactInvocation.createdAt,
            startedAt: compactInvocation.createdAt,
            completedAt: null,
            assistantMessageId: null,
            skillInvocation: compactInvocation,
          },
        },
      });

      expect(reconnected.skillRuns?.map((run) => run.skillRunId)).toEqual([
        mapInvocation.skillRunId,
        compactInvocation.skillRunId,
      ]);
    });
  });

  describe("thread-removed", () => {
    it("removes a thread by id", () => {
      const snapshotWithThread: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        threads: [stubThread],
      };

      const event: OrchestrationShellStreamEvent = {
        kind: "thread-removed",
        sequence: 6,
        threadId: ThreadId.make("thread-1"),
      };

      const next = applyShellStreamEvent(snapshotWithThread, event);

      expect(next.threads).toHaveLength(0);
      expect(next.snapshotSequence).toBe(6);
    });
  });

  it("returns original snapshot for unrecognized event kinds", () => {
    const unknownEvent = { kind: "unknown-future-event", sequence: 99 } as any;
    const next = applyShellStreamEvent(baseSnapshot, unknownEvent);
    expect(next).toBe(baseSnapshot);
  });
});
