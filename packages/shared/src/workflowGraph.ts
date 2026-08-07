import { sha256 } from "@noble/hashes/sha2";
import type {
  WayfinderMapProjection,
  WorkflowArtifact,
  WorkflowArtifactDetail,
  WorkflowArtifactSourceStage,
  WorkflowAttachment,
  WorkflowAttachmentWayfinderData,
  WorkflowGraph,
  WorkflowGraphNode,
  WorkflowPrdDocument,
  WorkflowSpecificationStage,
  WorkflowStaleResolution,
} from "@t3tools/contracts";
import * as Encoding from "effect/Encoding";

import { stableStringify } from "./relaySigning.ts";

/**
 * A compact attachment graph must never grow with every upstream refresh. The
 * current artifact and the most recent historical lineage entries are enough
 * to explain staleness and recover a connected client after a missed delta.
 */
export const WORKFLOW_GRAPH_ARTIFACT_LIMIT = 32;

interface WorkflowWayfinderSynchronizationInput {
  readonly attachment: WorkflowAttachment;
  readonly sourceSkillRunId: WorkflowAttachment["sourceSkillRunId"];
  readonly sourceStage: WorkflowArtifactSourceStage;
  readonly observedAt: string;
  readonly data: WorkflowAttachmentWayfinderData;
}

function upstreamVersion(map: WayfinderMapProjection): string {
  if (map.revision !== undefined) {
    return `revision:${map.revision}`;
  }
  const { lastSynchronizedAt: _lastSynchronizedAt, ...content } = map;
  // Some tracker responses do not expose a revision. Preserve a canonical
  // SHA-256 content version in that case instead of trusting timestamp order
  // or a collision-prone short fingerprint.
  return `content:sha256:${Encoding.encodeHex(
    sha256(new TextEncoder().encode(stableStringify(content))),
  )}`;
}

function mapLogicalId(map: WayfinderMapProjection): string {
  return `wayfinder-map:${map.canonicalReference.number}`;
}

function mapArtifact(input: {
  readonly attachment: WorkflowAttachment;
  readonly sourceSkillRunId: WorkflowAttachment["sourceSkillRunId"];
  readonly map: WayfinderMapProjection;
  readonly sourceStage: WorkflowArtifactSourceStage;
  readonly importedAt: string;
  readonly marker: WorkflowArtifact["marker"]["kind"];
}): WorkflowArtifact {
  const logicalId = mapLogicalId(input.map);
  const version = upstreamVersion(input.map);
  return {
    id: `${logicalId}:${version}`,
    logicalId,
    kind: "wayfinder-map",
    state: "current",
    lineage: {
      workstreamId: input.attachment.workstreamId,
      sourceSkillRunId: input.sourceSkillRunId,
      sourceStage: input.sourceStage,
      upstreamVersion: version,
    },
    upstreamSynchronizedAt: input.map.lastSynchronizedAt,
    importedAt: input.importedAt,
    marker: {
      kind: input.marker,
      state: "unread",
      markedAt: input.importedAt,
    },
  };
}

function workstreamNode(input: {
  readonly attachment: WorkflowAttachment;
  readonly sourceArtifactId: string | null;
}): WorkflowGraphNode {
  return {
    id: `workflow:${input.attachment.workstreamId}`,
    kind: "workstream",
    state: "current",
    sourceArtifactId: input.sourceArtifactId,
    resolution: { status: "not-required" },
  };
}

function latestCurrentMapArtifact(graph: WorkflowGraph): WorkflowArtifact | null {
  return (
    graph.artifacts
      .filter((artifact) => artifact.kind === "wayfinder-map" && artifact.state === "current")
      .sort(
        (left, right) =>
          right.upstreamSynchronizedAt.localeCompare(left.upstreamSynchronizedAt) ||
          right.importedAt.localeCompare(left.importedAt) ||
          right.id.localeCompare(left.id),
      )[0] ?? null
  );
}

function boundedArtifacts(
  artifacts: ReadonlyArray<WorkflowArtifact>,
): ReadonlyArray<WorkflowArtifact> {
  const current = artifacts.filter((artifact) => artifact.state === "current");
  const historical = artifacts
    .filter((artifact) => artifact.state !== "current")
    .sort(
      (left, right) =>
        right.upstreamSynchronizedAt.localeCompare(left.upstreamSynchronizedAt) ||
        right.importedAt.localeCompare(left.importedAt) ||
        right.id.localeCompare(left.id),
    )
    .slice(0, Math.max(0, WORKFLOW_GRAPH_ARTIFACT_LIMIT - current.length));
  return [...current, ...historical].sort(
    (left, right) =>
      left.upstreamSynchronizedAt.localeCompare(right.upstreamSynchronizedAt) ||
      left.importedAt.localeCompare(right.importedAt) ||
      left.id.localeCompare(right.id),
  );
}

function latestCurrentArtifact(
  graph: WorkflowGraph,
  kind: WorkflowArtifact["kind"],
): WorkflowArtifact | null {
  return (
    graph.artifacts
      .filter((artifact) => artifact.kind === kind && artifact.state === "current")
      .sort(
        (left, right) =>
          right.importedAt.localeCompare(left.importedAt) || right.id.localeCompare(left.id),
      )[0] ?? null
  );
}

function mergeWayfinderData(input: {
  readonly previous: WorkflowAttachmentWayfinderData;
  readonly next: WorkflowAttachmentWayfinderData;
}): WorkflowAttachmentWayfinderData {
  return {
    ...input.previous,
    ...(input.next.wayfinderMap !== undefined ? { wayfinderMap: input.next.wayfinderMap } : {}),
    ...(input.next.wayfinderDraft !== undefined
      ? { wayfinderDraft: input.next.wayfinderDraft }
      : {}),
    ...(input.next.wayfinderPublication !== undefined
      ? { wayfinderPublication: input.next.wayfinderPublication }
      : {}),
    ...(input.next.wayfinderSynchronizedAt !== undefined
      ? { wayfinderSynchronizedAt: input.next.wayfinderSynchronizedAt }
      : {}),
    ...(input.next.wayfinderSynchronization !== undefined
      ? { wayfinderSynchronization: input.next.wayfinderSynchronization }
      : {}),
  };
}

function observationCursor(input: WorkflowWayfinderSynchronizationInput) {
  const incomingSynchronizedAt =
    input.data.wayfinderSynchronizedAt ?? input.data.wayfinderMap?.lastSynchronizedAt;
  const previousSynchronizedAt = input.attachment.observationCursor.wayfinderSynchronizedAt;
  const synchronizedAt =
    incomingSynchronizedAt !== undefined &&
    (previousSynchronizedAt === undefined || incomingSynchronizedAt >= previousSynchronizedAt)
      ? incomingSynchronizedAt
      : previousSynchronizedAt;
  return {
    sourceSkillRunId: input.sourceSkillRunId,
    observedAt: input.observedAt,
    ...(synchronizedAt !== undefined ? { wayfinderSynchronizedAt: synchronizedAt } : {}),
  };
}

function isOlderThanCursor(input: WorkflowWayfinderSynchronizationInput): boolean {
  const incomingSynchronizedAt =
    input.data.wayfinderSynchronizedAt ?? input.data.wayfinderMap?.lastSynchronizedAt;
  const previousSynchronizedAt = input.attachment.observationCursor.wayfinderSynchronizedAt;
  return (
    incomingSynchronizedAt !== undefined &&
    previousSynchronizedAt !== undefined &&
    incomingSynchronizedAt < previousSynchronizedAt
  );
}

/** Create a graph from the persisted attachment backfill without inference from prose. */
export function initializeWorkflowGraph(attachment: WorkflowAttachment): WorkflowGraph {
  const map = attachment.backfilledWayfinderData.wayfinderMap;
  const artifact =
    map === undefined
      ? null
      : mapArtifact({
          attachment,
          sourceSkillRunId: attachment.sourceSkillRunId,
          map,
          sourceStage: "attachment",
          importedAt: attachment.attachedAt,
          marker: "new",
        });
  return {
    artifacts: artifact === null ? [] : [artifact],
    nodes: [
      workstreamNode({
        attachment,
        sourceArtifactId: artifact?.id ?? null,
      }),
    ],
    unreadArtifactCount: artifact === null ? 0 : 1,
    updatedAt: attachment.attachedAt,
  };
}

/**
 * Apply one server-authorized native Wayfinder observation. The caller's
 * compatibility gate and this monotonic cursor make it safe to replay after a
 * process restart.
 */
export function synchronizeWorkflowAttachmentWayfinderData(
  input: WorkflowWayfinderSynchronizationInput,
): WorkflowAttachment {
  if (isOlderThanCursor(input)) {
    return input.attachment;
  }

  const graph = input.attachment.workflowGraph ?? initializeWorkflowGraph(input.attachment);
  const nextData = mergeWayfinderData({
    previous: input.attachment.backfilledWayfinderData,
    next: input.data,
  });
  const map = input.data.wayfinderMap;
  if (map === undefined) {
    return {
      ...input.attachment,
      backfilledWayfinderData: nextData,
      observationCursor: observationCursor(input),
      workflowGraph: graph,
    };
  }

  const currentArtifact = latestCurrentMapArtifact(graph);
  const incomingArtifact = mapArtifact({
    attachment: input.attachment,
    sourceSkillRunId: input.sourceSkillRunId,
    map,
    sourceStage: input.sourceStage,
    importedAt: input.observedAt,
    marker: currentArtifact === null ? "new" : "changed",
  });

  const retainedHistoricalArtifact = graph.artifacts.find(
    (artifact) =>
      artifact.id !== currentArtifact?.id &&
      artifact.logicalId === incomingArtifact.logicalId &&
      artifact.lineage.upstreamVersion === incomingArtifact.lineage.upstreamVersion,
  );
  if (retainedHistoricalArtifact !== undefined) {
    return input.attachment;
  }

  if (currentArtifact?.lineage.upstreamVersion === incomingArtifact.lineage.upstreamVersion) {
    return {
      ...input.attachment,
      backfilledWayfinderData: nextData,
      observationCursor: observationCursor(input),
      workflowGraph: graph,
    };
  }

  // An observation with the same timestamp but a distinct structured version
  // is accepted; tracker revisions can differ while retaining timestamp
  // granularity. Strictly older timestamps were rejected above.
  const artifacts = boundedArtifacts([
    ...graph.artifacts.map((artifact) =>
      artifact.id === currentArtifact?.id
        ? { ...artifact, state: "superseded" as const }
        : artifact,
    ),
    incomingArtifact,
  ]);
  const nodes = graph.nodes.map((node) =>
    node.kind !== "workstream"
      ? node
      : currentArtifact === null
        ? {
            ...node,
            state: "current" as const,
            sourceArtifactId: incomingArtifact.id,
            resolution: { status: "not-required" as const },
          }
        : {
            ...node,
            state: "stale" as const,
            sourceArtifactId: incomingArtifact.id,
            resolution: {
              status: "required" as const,
              allowed: ["accept-upstream" as const],
            },
            staleAt: input.observedAt,
          },
  );
  return {
    ...input.attachment,
    backfilledWayfinderData: nextData,
    observationCursor: observationCursor(input),
    workflowGraph: {
      artifacts,
      nodes,
      unreadArtifactCount: graph.unreadArtifactCount + 1,
      updatedAt: input.observedAt,
    },
  };
}

export function hasPendingWorkflowStaleness(attachment: WorkflowAttachment): boolean {
  return attachment.workflowGraph?.nodes.some((node) => node.state === "stale") ?? false;
}

export function viewWorkflowArtifacts(
  attachment: WorkflowAttachment,
  viewedAt: string,
): WorkflowAttachment {
  const graph = attachment.workflowGraph;
  if (!graph || graph.unreadArtifactCount === 0) {
    return attachment;
  }
  return {
    ...attachment,
    workflowGraph: {
      ...graph,
      artifacts: graph.artifacts.map((artifact) =>
        artifact.marker.state === "unread"
          ? {
              ...artifact,
              marker: { ...artifact.marker, state: "viewed" as const, viewedAt },
            }
          : artifact,
      ),
      unreadArtifactCount: 0,
      updatedAt: viewedAt,
    },
  };
}

export function acknowledgeWorkflowArtifact(
  attachment: WorkflowAttachment,
  artifactId: string,
  acknowledgedAt: string,
): WorkflowAttachment {
  const graph = attachment.workflowGraph;
  const artifact = graph?.artifacts.find((candidate) => candidate.id === artifactId);
  if (!graph || artifact === undefined || artifact.marker.state === "acknowledged") {
    return attachment;
  }
  return {
    ...attachment,
    workflowGraph: {
      ...graph,
      artifacts: graph.artifacts.map((candidate) =>
        candidate.id === artifactId
          ? {
              ...candidate,
              marker: {
                ...candidate.marker,
                state: "acknowledged" as const,
                ...(candidate.marker.viewedAt === undefined ? { viewedAt: acknowledgedAt } : {}),
                acknowledgedAt,
              },
            }
          : candidate,
      ),
      unreadArtifactCount:
        artifact.marker.state === "unread"
          ? Math.max(0, graph.unreadArtifactCount - 1)
          : graph.unreadArtifactCount,
      updatedAt: acknowledgedAt,
    },
  };
}

/**
 * Store one provider-produced, structured Specification result. The caller
 * must already have checked the exact current Wayfinder artifact; this helper
 * only materializes the bounded lineage and versioned PRD artifact.
 */
export function completeWorkflowSpecification(input: {
  readonly attachment: WorkflowAttachment;
  readonly stage: WorkflowSpecificationStage;
  readonly document: WorkflowPrdDocument;
  readonly sourceWayfinderArtifactId: string;
  readonly completedAt: string;
}): WorkflowAttachment {
  const graph = input.attachment.workflowGraph ?? initializeWorkflowGraph(input.attachment);
  const upstream = graph.artifacts.find(
    (artifact) =>
      artifact.id === input.sourceWayfinderArtifactId &&
      artifact.kind === "wayfinder-map" &&
      artifact.state === "current",
  );
  if (upstream === undefined) return input.attachment;

  const previousPrd = latestCurrentArtifact(graph, "workflow-prd");
  const logicalId = `workflow-prd:${input.attachment.workstreamId}`;
  const artifact: WorkflowArtifact = {
    id: `${logicalId}:v${input.document.version}`,
    logicalId,
    kind: "workflow-prd",
    state: "current",
    version: input.document.version,
    lineage: {
      workstreamId: input.attachment.workstreamId,
      sourceSkillRunId: input.stage.skillRunId,
      sourceStage: "specification",
      upstreamVersion: upstream.lineage.upstreamVersion,
      upstreamArtifactId: upstream.id,
    },
    upstreamSynchronizedAt: upstream.upstreamSynchronizedAt,
    importedAt: input.completedAt,
    marker: {
      kind: previousPrd === null ? "new" : "changed",
      state: "unread",
      markedAt: input.completedAt,
    },
  };

  const artifacts = boundedArtifacts([
    ...graph.artifacts.map((candidate) =>
      candidate.id === previousPrd?.id ? { ...candidate, state: "superseded" as const } : candidate,
    ),
    artifact,
  ]);
  return {
    ...input.attachment,
    workflowVersion: (input.attachment.workflowVersion ?? 0) + 1,
    specificationStage: {
      ...input.stage,
      status: "completed",
      checkpoint:
        input.stage.checkpoint === undefined
          ? undefined
          : { ...input.stage.checkpoint, status: input.stage.checkpoint.status },
      artifactId: artifact.id,
      failure: undefined,
      updatedAt: input.completedAt,
    },
    workflowGraph: {
      ...graph,
      artifacts,
      updatedAt: input.completedAt,
    },
  };
}

export function workflowSpecificationArtifactDetail(input: {
  readonly attachment: WorkflowAttachment;
  readonly document: WorkflowPrdDocument;
}): WorkflowArtifactDetail {
  return {
    artifactId: `workflow-prd:${input.attachment.workstreamId}:v${input.document.version}`,
    kind: "workflow-prd",
    document: input.document,
  };
}

export function resolveWorkflowStaleness(
  attachment: WorkflowAttachment,
  resolution: WorkflowStaleResolution,
  resolvedAt: string,
): WorkflowAttachment {
  const graph = attachment.workflowGraph;
  if (!graph || !hasPendingWorkflowStaleness(attachment)) {
    return attachment;
  }
  const allowed = graph.nodes.some(
    (node) =>
      node.state === "stale" &&
      node.resolution.status === "required" &&
      node.resolution.allowed.includes(resolution),
  );
  if (!allowed) return attachment;
  return {
    ...attachment,
    workflowGraph: {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.state !== "stale"
          ? node
          : {
              ...node,
              state: "current" as const,
              resolution: {
                status: "resolved" as const,
                resolution,
                resolvedAt,
              },
            },
      ),
      updatedAt: resolvedAt,
    },
  };
}
