import type { WorkflowArtifact, WorkflowGraph } from "@t3tools/contracts";

import type {
  WayfinderWorkflowAttention,
  WayfinderWorkflowOutlineNode,
  WayfinderWorkflowViewModel,
} from "./wayfinderWorkflow.ts";

export const WORKFLOW_VISUAL_NODE_LIMIT = 48;
export const WORKFLOW_VISUAL_EDGE_LIMIT = 96;
export const WORKFLOW_VISUAL_ARTIFACT_LIMIT = 8;

const WORKFLOW_COLUMN_WIDTH = 256;
const WORKFLOW_NODE_ROW_HEIGHT = 78;
const WORKFLOW_STAGE_HEADER_HEIGHT = 54;
const WORKFLOW_STAGE_PADDING = 16;

export const WORKFLOW_STAGE_DEFINITIONS = [
  { id: "wayfinder", label: "Wayfinder", order: 0 },
  { id: "specification", label: "Specification", order: 1 },
  { id: "ticketing", label: "Ticketing", order: 2 },
  { id: "implementation", label: "Implementation + Review", order: 3 },
  { id: "publication", label: "Publication", order: 4 },
] as const;

export type WorkflowWorkspaceStageId = (typeof WORKFLOW_STAGE_DEFINITIONS)[number]["id"];
export type WorkflowWorkspaceFilter = "all" | "frontier" | "active" | "attention";
export type WorkflowWorkspaceNodeKind = "stage" | "milestone" | "ticket" | "run" | "artifact";
export type WorkflowWorkspaceEdgeKind =
  | "stage"
  | "contains"
  | "dependency"
  | "execution"
  | "lineage";
export type WorkflowWorkspaceMarker = "new" | "changed" | null;
export type WorkflowWorkspaceStageState =
  | "pending"
  | "current"
  | "attention"
  | "completed"
  | "stale"
  | "unprojected";

export interface WorkflowWorkspacePosition {
  readonly x: number;
  readonly y: number;
}

export interface WorkflowWorkspaceNode {
  readonly id: string;
  readonly kind: WorkflowWorkspaceNodeKind;
  readonly stageId: WorkflowWorkspaceStageId;
  readonly title: string;
  readonly subtitle: string;
  readonly number: number | null;
  readonly state: {
    readonly kind: WorkflowWorkspaceStageState | WayfinderWorkflowOutlineNode["state"]["kind"];
    readonly label: string;
  };
  readonly attention: WayfinderWorkflowAttention;
  readonly marker: WorkflowWorkspaceMarker;
  readonly sourceNodeId: string | null;
  readonly position: WorkflowWorkspacePosition;
}

export interface WorkflowWorkspaceStage {
  readonly id: WorkflowWorkspaceStageId;
  readonly label: string;
  readonly order: number;
  readonly state: WorkflowWorkspaceStageState;
  readonly nodeIds: ReadonlyArray<string>;
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

export interface WorkflowWorkspaceEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: WorkflowWorkspaceEdgeKind;
}

export interface WorkflowWorkspaceBoundary {
  readonly direction: "upstream" | "downstream";
  readonly hiddenNodeCount: number;
  readonly label: string;
}

export interface WorkflowWorkspaceVisualProjection {
  readonly selectedNodeId: string | null;
  readonly filter: WorkflowWorkspaceFilter;
  readonly expandedStageIds: ReadonlyArray<WorkflowWorkspaceStageId>;
  readonly visibleNodeIds: ReadonlyArray<string>;
  readonly visibleEdgeIds: ReadonlyArray<string>;
  readonly hiddenNodeCount: number;
  readonly boundaries: ReadonlyArray<WorkflowWorkspaceBoundary>;
}

export interface WorkflowWorkspaceModel {
  readonly stages: ReadonlyArray<WorkflowWorkspaceStage>;
  readonly nodes: ReadonlyArray<WorkflowWorkspaceNode>;
  readonly edges: ReadonlyArray<WorkflowWorkspaceEdge>;
  readonly outline: ReadonlyArray<WayfinderWorkflowOutlineNode>;
  readonly visualProjection: WorkflowWorkspaceVisualProjection;
  readonly width: number;
  readonly height: number;
  readonly accessibilitySummary: string;
}

export interface DeriveWorkflowWorkspaceInput {
  readonly viewModel: WayfinderWorkflowViewModel;
  readonly workflowGraph?: WorkflowGraph | null;
  readonly selectedNodeId?: string | null;
  readonly expandedStageIds?: ReadonlySet<WorkflowWorkspaceStageId>;
  readonly filter?: WorkflowWorkspaceFilter;
  readonly previousPositions?: Readonly<Record<string, WorkflowWorkspacePosition>>;
}

type WorkflowTicketNodeId = WayfinderWorkflowOutlineNode["id"];
type WorkflowWorkspaceUnpositionedNode = Omit<WorkflowWorkspaceNode, "position">;

function plural(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function stageStateLabel(state: WorkflowWorkspaceStageState): string {
  switch (state) {
    case "pending":
      return "Pending";
    case "current":
      return "Current";
    case "attention":
      return "Attention";
    case "completed":
      return "Completed";
    case "stale":
      return "Stale";
    case "unprojected":
      return "Not projected";
  }
}

function stageStateFromPanel(
  viewModel: WayfinderWorkflowViewModel,
  stageId: WorkflowWorkspaceStageId,
  wayfinderIsStale: boolean,
): WorkflowWorkspaceStageState {
  if (stageId === "wayfinder") {
    if (wayfinderIsStale) return "stale";
    return viewModel.panel.stageSpine[0]?.state ?? "pending";
  }
  // The current projection only carries an authoritative Wayfinder stage. Keep
  // future stage containers explicitly unprojected until the server projects
  // their state; child tickets and runs still expose their own current states.
  return "unprojected";
}

function latestArtifactMarker(graph: WorkflowGraph | null | undefined): WorkflowWorkspaceMarker {
  const current = graph?.artifacts
    .filter((artifact) => artifact.state === "current")
    .sort(
      (left, right) =>
        right.upstreamSynchronizedAt.localeCompare(left.upstreamSynchronizedAt) ||
        right.importedAt.localeCompare(left.importedAt) ||
        right.id.localeCompare(left.id),
    )[0];
  return current?.marker.state === "unread" ? current.marker.kind : null;
}

function wayfinderIsStale(graph: WorkflowGraph | null | undefined): boolean {
  return graph?.nodes.some((node) => node.state === "stale") ?? false;
}

function artifactStageId(
  sourceStage: WorkflowArtifact["lineage"]["sourceStage"],
): WorkflowWorkspaceStageId {
  switch (sourceStage) {
    case "specification":
      return "specification";
    case "publication":
      return "publication";
    case "reconciliation":
      return "implementation";
    case "attachment":
    case "mutation":
      return "wayfinder";
  }
}

function isAttentionNode(node: WayfinderWorkflowOutlineNode): boolean {
  return node.attention.kind !== "none";
}

function containsEdge(from: string, to: string): WorkflowWorkspaceEdge {
  return { id: `contains:${from}:${to}`, from, to, kind: "contains" };
}

function stageEdge(from: WorkflowWorkspaceStageId, to: WorkflowWorkspaceStageId) {
  return {
    id: `stage:${from}:${to}`,
    from: `stage:${from}`,
    to: `stage:${to}`,
    kind: "stage" as const,
  };
}

function layoutNodes(
  nodes: ReadonlyArray<WorkflowWorkspaceUnpositionedNode>,
  previousPositions: Readonly<Record<string, WorkflowWorkspacePosition>> = {},
): {
  readonly nodes: ReadonlyArray<WorkflowWorkspaceNode>;
  readonly stageBounds: ReadonlyMap<WorkflowWorkspaceStageId, WorkflowWorkspaceStage["bounds"]>;
  readonly height: number;
} {
  const positions = new Map<string, WorkflowWorkspacePosition>();
  for (const [index, definition] of WORKFLOW_STAGE_DEFINITIONS.entries()) {
    positions.set(`stage:${definition.id}`, {
      x: index * WORKFLOW_COLUMN_WIDTH,
      y: 0,
    });
  }

  const rowByStage = new Map<WorkflowWorkspaceStageId, number>();
  const freshNodes = nodes
    .filter((node) => node.kind !== "stage")
    .sort(
      (left, right) =>
        WORKFLOW_STAGE_DEFINITIONS.find((stage) => stage.id === left.stageId)!.order -
          WORKFLOW_STAGE_DEFINITIONS.find((stage) => stage.id === right.stageId)!.order ||
        left.id.localeCompare(right.id),
    );

  for (const node of freshNodes) {
    const previous = previousPositions[node.id];
    if (previous !== undefined) {
      positions.set(node.id, previous);
      const previousRow = Math.max(
        0,
        Math.round((previous.y - WORKFLOW_STAGE_HEADER_HEIGHT) / WORKFLOW_NODE_ROW_HEIGHT),
      );
      rowByStage.set(node.stageId, Math.max(rowByStage.get(node.stageId) ?? 0, previousRow + 1));
      continue;
    }
    const row = rowByStage.get(node.stageId) ?? 0;
    const stageOrder = WORKFLOW_STAGE_DEFINITIONS.find((stage) => stage.id === node.stageId)!.order;
    positions.set(node.id, {
      x: stageOrder * WORKFLOW_COLUMN_WIDTH + WORKFLOW_STAGE_PADDING,
      y: WORKFLOW_STAGE_HEADER_HEIGHT + row * WORKFLOW_NODE_ROW_HEIGHT,
    });
    rowByStage.set(node.stageId, row + 1);
  }

  const stageBounds = new Map<WorkflowWorkspaceStageId, WorkflowWorkspaceStage["bounds"]>();
  let maxHeight = 220;
  for (const definition of WORKFLOW_STAGE_DEFINITIONS) {
    const stageNodes = freshNodes.filter((node) => node.stageId === definition.id);
    const maxNodeY = stageNodes.reduce(
      (height, node) => Math.max(height, positions.get(node.id)?.y ?? 0),
      WORKFLOW_STAGE_HEADER_HEIGHT,
    );
    const height = Math.max(184, maxNodeY + WORKFLOW_NODE_ROW_HEIGHT + WORKFLOW_STAGE_PADDING);
    stageBounds.set(definition.id, {
      x: definition.order * WORKFLOW_COLUMN_WIDTH,
      y: 0,
      width: WORKFLOW_COLUMN_WIDTH - WORKFLOW_STAGE_PADDING,
      height,
    });
    maxHeight = Math.max(maxHeight, height);
  }

  return {
    nodes: nodes.map((node) => ({ ...node, position: positions.get(node.id)! })),
    stageBounds,
    height: maxHeight,
  };
}

function collectNearbyTicketIds(
  outline: ReadonlyArray<WayfinderWorkflowOutlineNode>,
  seeds: ReadonlySet<WorkflowTicketNodeId>,
): Set<WorkflowTicketNodeId> {
  const byId = new Map(outline.map((node) => [node.id, node] as const));
  const nearby = new Set(seeds);
  for (const seedId of seeds) {
    const seed = byId.get(seedId);
    if (!seed) continue;
    for (const number of [...seed.lineage.blockedBy, ...seed.lineage.enables]) {
      if (byId.has(`ticket:${number}`)) nearby.add(`ticket:${number}`);
    }
  }
  return nearby;
}

function boundaryDirection(
  hidden: WayfinderWorkflowOutlineNode,
  visibleIds: ReadonlySet<string>,
): "upstream" | "downstream" | null {
  if (hidden.lineage.blockedBy.some((number) => visibleIds.has(`ticket:${number}`))) {
    return "downstream";
  }
  if (hidden.lineage.enables.some((number) => visibleIds.has(`ticket:${number}`))) {
    return "upstream";
  }
  return null;
}

function selectVisibleTickets(input: {
  readonly outline: ReadonlyArray<WayfinderWorkflowOutlineNode>;
  readonly selectedNodeId: string | null;
  readonly expandedStageIds: ReadonlySet<WorkflowWorkspaceStageId>;
  readonly filter: WorkflowWorkspaceFilter;
  readonly maximumNodeCount: number;
}): Set<WorkflowTicketNodeId> {
  const frontierIds = new Set<WorkflowTicketNodeId>(
    input.outline.filter((node) => node.state.kind === "runnable").map((node) => node.id),
  );
  const selected =
    input.selectedNodeId && input.selectedNodeId.startsWith("ticket:")
      ? new Set<WorkflowTicketNodeId>([input.selectedNodeId as WorkflowTicketNodeId])
      : new Set<WorkflowTicketNodeId>();
  const seeds = new Set([...frontierIds, ...selected]);
  const nearby = collectNearbyTicketIds(input.outline, seeds);
  const all = new Set<WorkflowTicketNodeId>(
    input.outline
      .filter((node) =>
        input.filter === "all"
          ? true
          : input.filter === "frontier"
            ? nearby.has(node.id)
            : input.filter === "active"
              ? node.state.kind === "active" || nearby.has(node.id)
              : isAttentionNode(node) || nearby.has(node.id),
      )
      .map((node) => node.id),
  );

  const expanded = input.expandedStageIds.has("ticketing") ? all : new Set(nearby);
  for (const id of selected) expanded.add(id);
  for (const id of frontierIds) expanded.add(id);

  const ordered = input.outline
    .filter((node) => expanded.has(node.id))
    .sort((left, right) => {
      const selectedOrder =
        Number(right.id === input.selectedNodeId) - Number(left.id === input.selectedNodeId);
      const frontierOrder = Number(frontierIds.has(right.id)) - Number(frontierIds.has(left.id));
      return selectedOrder || frontierOrder || left.number - right.number;
    });
  return new Set(ordered.slice(0, input.maximumNodeCount).map((node) => node.id));
}

function selectVisibleArtifacts(input: {
  readonly artifacts: ReadonlyArray<WorkflowWorkspaceUnpositionedNode>;
  readonly expandedStageIds: ReadonlySet<WorkflowWorkspaceStageId>;
  readonly filter: WorkflowWorkspaceFilter;
  readonly maximumNodeCount: number;
}): Set<string> {
  const eligible = input.artifacts
    .filter((node) => input.expandedStageIds.has(node.stageId))
    .filter(
      (node) => input.filter === "all" || node.state.kind === "current" || node.marker !== null,
    )
    .sort(
      (left, right) =>
        Number(right.state.kind === "current") - Number(left.state.kind === "current") ||
        Number(right.marker !== null) - Number(left.marker !== null) ||
        left.id.localeCompare(right.id),
    );
  return new Set(eligible.slice(0, input.maximumNodeCount).map((node) => node.id));
}

function deriveBoundaries(
  outline: ReadonlyArray<WayfinderWorkflowOutlineNode>,
  visibleTicketIds: ReadonlySet<string>,
): ReadonlyArray<WorkflowWorkspaceBoundary> {
  const counts = new Map<WorkflowWorkspaceBoundary["direction"], number>();
  for (const node of outline) {
    if (visibleTicketIds.has(node.id)) continue;
    const direction = boundaryDirection(node, visibleTicketIds);
    if (direction === null) continue;
    counts.set(direction, (counts.get(direction) ?? 0) + 1);
  }
  const directions: ReadonlyArray<WorkflowWorkspaceBoundary["direction"]> = [
    "upstream",
    "downstream",
  ];
  return directions.flatMap((direction) => {
    const hiddenNodeCount = counts.get(direction) ?? 0;
    return hiddenNodeCount === 0
      ? []
      : [
          {
            direction,
            hiddenNodeCount,
            label: `${plural(hiddenNodeCount, "ticket")} hidden ${direction === "upstream" ? "upstream" : "downstream"}`,
          },
        ];
  });
}

export function deriveWorkflowWorkspaceModel(
  input: DeriveWorkflowWorkspaceInput,
): WorkflowWorkspaceModel {
  const selectedNodeId = input.selectedNodeId ?? null;
  const filter = input.filter ?? "frontier";
  const expandedStageIds =
    input.expandedStageIds ?? new Set<WorkflowWorkspaceStageId>(["wayfinder"]);
  const stale = wayfinderIsStale(input.workflowGraph);
  const marker = latestArtifactMarker(input.workflowGraph);
  const stageStates = new Map(
    WORKFLOW_STAGE_DEFINITIONS.map(
      (definition) =>
        [definition.id, stageStateFromPanel(input.viewModel, definition.id, stale)] as const,
    ),
  );
  const stageNodes: WorkflowWorkspaceUnpositionedNode[] = WORKFLOW_STAGE_DEFINITIONS.map(
    (definition) => ({
      id: `stage:${definition.id}`,
      kind: "stage",
      stageId: definition.id,
      title: definition.label,
      subtitle: `${stageStateLabel(stageStates.get(definition.id)!)} stage container`,
      number: null,
      state: {
        kind: stageStates.get(definition.id)!,
        label: stageStateLabel(stageStates.get(definition.id)!),
      },
      attention:
        definition.id === "wayfinder"
          ? input.viewModel.panel.attention
          : { kind: "none", label: "No stage attention required." },
      marker: definition.id === "wayfinder" ? marker : null,
      sourceNodeId: null,
    }),
  );
  const milestoneNode: WorkflowWorkspaceUnpositionedNode = {
    id: `milestone:${input.viewModel.panel.milestone.number}`,
    kind: "milestone",
    stageId: "wayfinder",
    title: input.viewModel.panel.milestone.title,
    subtitle: `#${input.viewModel.panel.milestone.number} workflow milestone`,
    number: input.viewModel.panel.milestone.number,
    state: {
      kind: stageStates.get("wayfinder")!,
      label: stageStateLabel(stageStates.get("wayfinder")!),
    },
    attention: input.viewModel.panel.attention,
    marker,
    sourceNodeId: null,
  };
  const ticketNodes: WorkflowWorkspaceUnpositionedNode[] = input.viewModel.outline.map((node) => ({
    id: node.id,
    kind: "ticket",
    stageId: "ticketing",
    title: `#${node.number} ${node.title}`,
    subtitle: `${node.state.label} · ${node.classification}`,
    number: node.number,
    state: node.state,
    attention: node.attention,
    marker: null,
    sourceNodeId: node.id,
  }));
  const runNodes: WorkflowWorkspaceUnpositionedNode[] = input.viewModel.panel.activeRuns.map(
    (run) => ({
      id: `run:${run.kind}:${run.ticketNumber}`,
      kind: "run",
      stageId: run.kind === "research" ? "wayfinder" : "implementation",
      title: run.label,
      subtitle: `${run.kind} execution run`,
      number: run.ticketNumber,
      state: { kind: "active", label: "Active" },
      attention: { kind: "none", label: "No run attention required." },
      marker: null,
      sourceNodeId: `ticket:${run.ticketNumber}`,
    }),
  );
  const artifactNodes: WorkflowWorkspaceUnpositionedNode[] = (
    input.workflowGraph?.artifacts ?? []
  ).map((artifact) => {
    const stageId = artifactStageId(artifact.lineage.sourceStage);
    const current = artifact.state === "current";
    return {
      id: `artifact:${artifact.id}`,
      kind: "artifact",
      stageId,
      title: `${current ? "Current" : "Superseded"} ${artifact.logicalId}`,
      subtitle: `${artifact.lineage.sourceStage} artifact · upstream ${artifact.lineage.upstreamVersion}`,
      number: null,
      state: { kind: current ? "current" : "completed", label: current ? "Current" : "Superseded" },
      attention: { kind: "none", label: "No artifact attention required." },
      marker: artifact.marker.state === "unread" ? artifact.marker.kind : null,
      sourceNodeId: null,
    };
  });
  const unpositionedNodes = [
    ...stageNodes,
    milestoneNode,
    ...ticketNodes,
    ...runNodes,
    ...artifactNodes,
  ];
  const layout = layoutNodes(unpositionedNodes, input.previousPositions);
  const visualScaffoldNodeCount =
    stageNodes.length + (expandedStageIds.has("wayfinder") ? 1 : 0) + runNodes.length;
  const visibleArtifactIds = selectVisibleArtifacts({
    artifacts: artifactNodes,
    expandedStageIds,
    filter,
    maximumNodeCount: Math.min(
      WORKFLOW_VISUAL_ARTIFACT_LIMIT,
      Math.max(0, WORKFLOW_VISUAL_NODE_LIMIT - visualScaffoldNodeCount),
    ),
  });
  const visibleTicketIds = selectVisibleTickets({
    outline: input.viewModel.outline,
    selectedNodeId,
    expandedStageIds,
    filter,
    maximumNodeCount: Math.max(
      0,
      WORKFLOW_VISUAL_NODE_LIMIT - visualScaffoldNodeCount - visibleArtifactIds.size,
    ),
  });
  const visibleNodeIds = new Set<string>([
    ...stageNodes.map((node) => node.id),
    ...(expandedStageIds.has("wayfinder") ? [milestoneNode.id] : []),
    ...visibleTicketIds,
    ...visibleArtifactIds,
  ]);
  for (const run of runNodes) {
    if (visibleNodeIds.has(run.sourceNodeId ?? "") || expandedStageIds.has(run.stageId)) {
      visibleNodeIds.add(run.id);
    }
  }
  const ticketNumbers = new Set(input.viewModel.outline.map((node) => node.number));
  const edges: WorkflowWorkspaceEdge[] = [
    ...WORKFLOW_STAGE_DEFINITIONS.slice(0, -1).map((stage, index) =>
      stageEdge(stage.id, WORKFLOW_STAGE_DEFINITIONS[index + 1]!.id),
    ),
    ...(visibleNodeIds.has(milestoneNode.id)
      ? [containsEdge("stage:wayfinder", milestoneNode.id)]
      : []),
    ...ticketNodes
      .filter((node) => visibleNodeIds.has(node.id))
      .map((node) => containsEdge("stage:ticketing", node.id)),
    ...runNodes
      .filter((node) => visibleNodeIds.has(node.id))
      .map((node) => containsEdge(`stage:${node.stageId}`, node.id)),
    ...artifactNodes
      .filter((node) => visibleNodeIds.has(node.id))
      .map((node) => containsEdge(`stage:${node.stageId}`, node.id)),
    ...artifactNodes
      .filter((node) => visibleNodeIds.has(node.id))
      .map((node) => {
        const target =
          node.stageId === "wayfinder" && visibleNodeIds.has(milestoneNode.id)
            ? milestoneNode.id
            : `stage:${node.stageId}`;
        return {
          id: `lineage:${node.id}:${target}`,
          from: node.id,
          to: target,
          kind: "lineage" as const,
        };
      }),
    ...input.viewModel.outline.flatMap((node) =>
      !visibleNodeIds.has(node.id)
        ? []
        : node.lineage.blockedBy
            .filter((number) => ticketNumbers.has(number) && visibleNodeIds.has(`ticket:${number}`))
            .map((number) => ({
              id: `dependency:${number}:${node.number}`,
              from: `ticket:${number}`,
              to: node.id,
              kind: "dependency" as const,
            })),
    ),
    ...runNodes
      .filter((node) => visibleNodeIds.has(node.id) && visibleNodeIds.has(node.sourceNodeId ?? ""))
      .map((node) => ({
        id: `execution:${node.sourceNodeId ?? node.id}`,
        from: node.sourceNodeId ?? node.id,
        to: node.id,
        kind: "execution" as const,
      })),
  ]
    .filter((edge, index, all) => all.findIndex((candidate) => candidate.id === edge.id) === index)
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, WORKFLOW_VISUAL_EDGE_LIMIT);
  const boundaries = deriveBoundaries(input.viewModel.outline, visibleTicketIds);
  const stages = WORKFLOW_STAGE_DEFINITIONS.map((definition) => {
    const stageNodeIds = layout.nodes
      .filter((node) => node.stageId === definition.id && node.kind !== "stage")
      .map((node) => node.id);
    return {
      id: definition.id,
      label: definition.label,
      order: definition.order,
      state: stageStates.get(definition.id)!,
      nodeIds: stageNodeIds,
      bounds: layout.stageBounds.get(definition.id)!,
    };
  });

  return {
    stages,
    nodes: layout.nodes,
    edges,
    outline: input.viewModel.outline,
    visualProjection: {
      selectedNodeId,
      filter,
      expandedStageIds: [...expandedStageIds].sort(),
      visibleNodeIds: [...visibleNodeIds].sort(),
      visibleEdgeIds: edges.map((edge) => edge.id),
      hiddenNodeCount: input.viewModel.outline.length - visibleTicketIds.size,
      boundaries,
    },
    width: WORKFLOW_COLUMN_WIDTH * WORKFLOW_STAGE_DEFINITIONS.length,
    height: layout.height,
    accessibilitySummary: `Complete Workflow Outline with ${plural(input.viewModel.outline.length, "ticket")}; visual projection shows ${plural(visibleTicketIds.size, "ticket")} and omits ${plural(input.viewModel.outline.length - visibleTicketIds.size, "ticket")} outside the selected region.`,
  };
}
