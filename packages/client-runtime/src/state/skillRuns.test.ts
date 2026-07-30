import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, SkillRunId, ThreadId, WorkstreamId } from "@t3tools/contracts";

import {
  deriveEnvironmentWorkstreams,
  deriveProjectWorkstreams,
  findThreadWayfinderWorkstream,
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
      skillRuns: [invocation],
      wayfinderMap: null,
    },
  ]);
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
