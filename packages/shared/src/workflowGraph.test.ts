import {
  SkillRunId,
  ThreadId,
  WorkstreamId,
  type WayfinderMapProjection,
  type WorkflowAttachment,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import {
  WORKFLOW_GRAPH_ARTIFACT_LIMIT,
  acknowledgeWorkflowArtifact,
  hasPendingWorkflowStaleness,
  resolveWorkflowStaleness,
  synchronizeWorkflowAttachmentWayfinderData,
  viewWorkflowArtifacts,
} from "./workflowGraph.ts";

const firstSynchronizedAt = "2026-08-03T12:00:00.000Z";
const secondSynchronizedAt = "2026-08-03T12:05:00.000Z";
const sourceSkillRunId = SkillRunId.make("skill-run:workflow-source");
const continuedSourceSkillRunId = SkillRunId.make("skill-run:workflow-continuation");
const workstreamId = WorkstreamId.make("workstream:workflow-source");

function map(input: {
  readonly revision: string;
  readonly synchronizedAt: string;
  readonly destination?: string;
}): WayfinderMapProjection {
  return {
    canonicalReference: {
      number: 29,
      title: "Development Workflow",
      url: "https://github.com/naveed949/t3code/issues/29",
      state: "open",
    },
    ...(input.revision ? { revision: input.revision } : {}),
    destination: input.destination ?? "Ship the workflow safely.",
    notes: "",
    decisionsSoFar: [],
    fogOfWar: [],
    outOfScope: [],
    tickets: [],
    frontier: [],
    lastSynchronizedAt: input.synchronizedAt,
  };
}

const attachment: WorkflowAttachment = {
  originThreadId: ThreadId.make("thread-workflow-origin"),
  workstreamId,
  sourceSkillRunId,
  workflowGoal: "Ship the workflow safely.",
  backfilledWayfinderData: {
    wayfinderMap: map({ revision: "revision:one", synchronizedAt: firstSynchronizedAt }),
    wayfinderSynchronizedAt: firstSynchronizedAt,
  },
  observationCursor: {
    sourceSkillRunId,
    observedAt: firstSynchronizedAt,
    wayfinderSynchronizedAt: firstSynchronizedAt,
  },
  attachedAt: firstSynchronizedAt,
};

it("preserves bounded map lineage, deduplicates replay, and durably gates stale workflow work", () => {
  const synchronized = synchronizeWorkflowAttachmentWayfinderData({
    attachment,
    sourceSkillRunId,
    sourceStage: "reconciliation",
    observedAt: secondSynchronizedAt,
    data: {
      wayfinderMap: map({
        revision: "revision:two",
        synchronizedAt: secondSynchronizedAt,
        destination: "Ship the synchronized workflow safely.",
      }),
      wayfinderSynchronizedAt: secondSynchronizedAt,
    },
  });

  expect(synchronized.workflowGraph?.artifacts).toHaveLength(2);
  expect(synchronized.workflowGraph?.unreadArtifactCount).toBe(2);
  expect(synchronized.workflowGraph?.artifacts.at(-1)).toMatchObject({
    kind: "wayfinder-map",
    state: "current",
    lineage: {
      workstreamId,
      sourceSkillRunId,
      sourceStage: "reconciliation",
      upstreamVersion: expect.stringContaining("revision:two"),
    },
    marker: { kind: "changed", state: "unread" },
  });
  expect(synchronized.workflowGraph?.nodes).toMatchObject([
    {
      kind: "workstream",
      state: "stale",
      resolution: { status: "required", allowed: ["accept-upstream"] },
    },
  ]);
  expect(hasPendingWorkflowStaleness(synchronized)).toBe(true);

  const replayed = synchronizeWorkflowAttachmentWayfinderData({
    attachment: synchronized,
    sourceSkillRunId,
    sourceStage: "reconciliation",
    observedAt: secondSynchronizedAt,
    data: {
      wayfinderMap: map({
        revision: "revision:two",
        synchronizedAt: secondSynchronizedAt,
        destination: "Ship the synchronized workflow safely.",
      }),
      wayfinderSynchronizedAt: secondSynchronizedAt,
    },
  });
  expect(replayed.workflowGraph?.artifacts).toHaveLength(2);

  const latestArtifactId = replayed.workflowGraph?.artifacts.at(-1)?.id;
  if (!latestArtifactId) throw new Error("Expected a current workflow artifact.");
  const acknowledged = acknowledgeWorkflowArtifact(
    replayed,
    latestArtifactId,
    secondSynchronizedAt,
  );
  expect(acknowledged.workflowGraph?.unreadArtifactCount).toBe(1);
  const viewed = viewWorkflowArtifacts(acknowledged, secondSynchronizedAt);
  expect(viewed.workflowGraph?.artifacts.at(-1)?.marker).toMatchObject({ state: "acknowledged" });
  expect(viewed.workflowGraph?.unreadArtifactCount).toBe(0);

  const resolved = resolveWorkflowStaleness(viewed, "accept-upstream", secondSynchronizedAt);
  expect(hasPendingWorkflowStaleness(resolved)).toBe(false);
  expect(resolved.workflowGraph?.nodes).toMatchObject([
    {
      state: "current",
      resolution: { status: "resolved", resolution: "accept-upstream" },
    },
  ]);
});

it("retains unread marker state when the bounded lineage evicts older artifacts", () => {
  let synchronized = attachment;
  for (let index = 0; index <= WORKFLOW_GRAPH_ARTIFACT_LIMIT; index += 1) {
    const synchronizedAt = `2026-08-03T13:${String(index).padStart(2, "0")}:00.000Z`;
    synchronized = synchronizeWorkflowAttachmentWayfinderData({
      attachment: synchronized,
      sourceSkillRunId,
      sourceStage: "reconciliation",
      observedAt: synchronizedAt,
      data: {
        wayfinderMap: map({
          revision: `revision:bounded-${index}`,
          synchronizedAt,
        }),
        wayfinderSynchronizedAt: synchronizedAt,
      },
    });
  }

  expect(synchronized.workflowGraph?.artifacts).toHaveLength(WORKFLOW_GRAPH_ARTIFACT_LIMIT);
  expect(synchronized.workflowGraph?.unreadArtifactCount).toBe(WORKFLOW_GRAPH_ARTIFACT_LIMIT + 2);

  const viewed = viewWorkflowArtifacts(synchronized, "2026-08-03T14:00:00.000Z");
  expect(viewed.workflowGraph?.unreadArtifactCount).toBe(0);
  expect(
    viewed.workflowGraph?.artifacts.every((artifact) => artifact.marker.state !== "unread"),
  ).toBe(true);
});

it("does not reimport a retained historical version when replay timestamps tie", () => {
  const synchronized = synchronizeWorkflowAttachmentWayfinderData({
    attachment,
    sourceSkillRunId,
    sourceStage: "reconciliation",
    observedAt: secondSynchronizedAt,
    data: {
      wayfinderMap: map({ revision: "revision:two", synchronizedAt: secondSynchronizedAt }),
      wayfinderSynchronizedAt: secondSynchronizedAt,
    },
  });
  const replayedHistoricalVersion = synchronizeWorkflowAttachmentWayfinderData({
    attachment: synchronized,
    sourceSkillRunId,
    sourceStage: "reconciliation",
    observedAt: secondSynchronizedAt,
    data: {
      wayfinderMap: map({ revision: "revision:one", synchronizedAt: secondSynchronizedAt }),
      wayfinderSynchronizedAt: secondSynchronizedAt,
    },
  });

  expect(replayedHistoricalVersion).toBe(synchronized);
  expect(replayedHistoricalVersion.workflowGraph?.artifacts).toHaveLength(2);
  expect(replayedHistoricalVersion.workflowGraph?.artifacts.at(-1)?.lineage.upstreamVersion).toBe(
    "revision:revision:two",
  );
});

it("records the continued native run in artifact lineage and the observation cursor", () => {
  const continuedAt = "2026-08-03T12:10:00.000Z";
  const synchronized = synchronizeWorkflowAttachmentWayfinderData({
    attachment,
    sourceSkillRunId: continuedSourceSkillRunId,
    sourceStage: "reconciliation",
    observedAt: continuedAt,
    data: {
      wayfinderMap: map({
        revision: "continued",
        synchronizedAt: continuedAt,
      }),
      wayfinderSynchronizedAt: continuedAt,
    },
  });

  expect(synchronized.observationCursor.sourceSkillRunId).toBe(continuedSourceSkillRunId);
  expect(synchronized.workflowGraph?.artifacts.at(-1)?.lineage).toMatchObject({
    workstreamId,
    sourceSkillRunId: continuedSourceSkillRunId,
    sourceStage: "reconciliation",
    upstreamVersion: "revision:continued",
  });
});

it("uses a canonical content version when the upstream map has no revision", () => {
  const source = {
    ...attachment,
    backfilledWayfinderData: {
      wayfinderMap: map({ revision: "", synchronizedAt: firstSynchronizedAt }),
      wayfinderSynchronizedAt: firstSynchronizedAt,
    },
  } satisfies WorkflowAttachment;
  const synchronized = synchronizeWorkflowAttachmentWayfinderData({
    attachment: source,
    sourceSkillRunId,
    sourceStage: "reconciliation",
    observedAt: secondSynchronizedAt,
    data: {
      wayfinderMap: map({
        revision: "",
        synchronizedAt: secondSynchronizedAt,
        destination: "A distinct version without tracker revision.",
      }),
      wayfinderSynchronizedAt: secondSynchronizedAt,
    },
  });

  expect(synchronized.workflowGraph?.artifacts.at(-1)?.lineage.upstreamVersion).toMatch(
    /^content:sha256:[a-f0-9]{64}$/,
  );
});
