import { describe, expect, it } from "vite-plus/test";
import {
  ProjectId,
  SkillRunId,
  ThreadId,
  WorkstreamId,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";

import { deriveProjectWorkstreams } from "./skillRuns.ts";

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

it("derives durable project Workstreams from shared thread state", () => {
  const thread = {
    id: ThreadId.make("thread-1"),
    projectId: ProjectId.make("project-1"),
    latestTurn: {
      turnId: "turn-1",
      state: "running",
      requestedAt: invocation.createdAt,
      startedAt: invocation.createdAt,
      completedAt: null,
      assistantMessageId: null,
      skillInvocation: invocation,
    },
  } as OrchestrationThreadShell;

  expect(deriveProjectWorkstreams(ProjectId.make("project-1"), [thread])).toEqual([
    {
      id: WorkstreamId.make("workstream:1"),
      projectId: ProjectId.make("project-1"),
      linkedThreadIds: [ThreadId.make("thread-1")],
      skillRuns: [invocation],
    },
  ]);
});

describe("deriveProjectWorkstreams", () => {
  it("ignores ordinary turns and invocations owned by another project", () => {
    expect(
      deriveProjectWorkstreams(ProjectId.make("project-2"), [
        {
          projectId: ProjectId.make("project-1"),
          latestTurn: { skillInvocation: invocation },
        } as OrchestrationThreadShell,
        {
          projectId: ProjectId.make("project-2"),
          latestTurn: null,
        } as OrchestrationThreadShell,
      ]),
    ).toEqual([]);
  });
});
