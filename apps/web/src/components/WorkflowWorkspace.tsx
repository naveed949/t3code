import type { WorkflowGraph } from "@t3tools/contracts";
import {
  deriveWorkflowWorkspaceModel,
  type WorkflowWorkspaceFilter,
  type WorkflowWorkspaceNode,
  type WorkflowWorkspaceStageId,
} from "@t3tools/client-runtime/state/workflow-workspace";
import type { WayfinderWorkflowViewModel } from "@t3tools/client-runtime/state/wayfinder-workflow";
import { memo, useCallback, useMemo, useRef, useState } from "react";

import { cn } from "~/lib/utils";

const FILTER_OPTIONS: ReadonlyArray<{
  readonly value: WorkflowWorkspaceFilter;
  readonly label: string;
}> = [
  { value: "frontier", label: "Frontier and nearby" },
  { value: "all", label: "All projected nodes" },
  { value: "active", label: "Active and nearby" },
  { value: "attention", label: "Attention and nearby" },
];

function stateClasses(state: string): string {
  switch (state) {
    case "active":
    case "current":
      return "border-sky-500/50 bg-sky-500/10";
    case "blocked":
      return "border-amber-500/50 bg-amber-500/10";
    case "stale":
      return "border-orange-500/60 bg-orange-500/10";
    case "attention":
      return "border-purple-500/60 bg-purple-500/10";
    case "completed":
      return "border-border bg-muted/40";
    default:
      return "border-border/80 bg-card";
  }
}

function attentionClasses(kind: string): string {
  switch (kind) {
    case "checkpoint":
      return "ring-1 ring-amber-500/70";
    case "decision":
      return "ring-1 ring-purple-500/70";
    case "recovery":
      return "ring-1 ring-rose-500/70";
    default:
      return "";
  }
}

function markerClasses(marker: WorkflowWorkspaceNode["marker"]): string {
  switch (marker) {
    case "new":
      return "border-emerald-500/60 bg-emerald-500/10";
    case "changed":
      return "border-blue-500/60 bg-blue-500/10";
    default:
      return "";
  }
}

function nodeDescription(node: WorkflowWorkspaceNode): string {
  const marker = node.marker === null ? "" : ` ${node.marker}.`;
  const attention = node.attention.kind === "none" ? "" : ` ${node.attention.label}`;
  return `${node.title}. ${node.state.label}.${marker}${attention}`;
}

function GraphNode(props: {
  readonly node: WorkflowWorkspaceNode;
  readonly selected: boolean;
  readonly onSelect: (nodeId: string) => void;
}) {
  const node = props.node;
  const selectNode = () => props.onSelect(node.sourceNodeId ?? node.id);
  if (node.kind === "milestone" || node.kind === "artifact") {
    return (
      <div
        className={cn(
          "absolute w-56 rounded-md border p-2 text-left shadow-sm",
          stateClasses(node.state.kind),
          attentionClasses(node.attention.kind),
          markerClasses(node.marker),
        )}
        style={{ left: node.position.x, top: node.position.y }}
        data-workflow-graph-node={node.id}
        data-workflow-node-kind={node.kind}
        data-workflow-node-state={node.state.kind}
        data-workflow-node-attention={node.attention.kind}
        data-workflow-node-marker={node.marker ?? undefined}
        role="group"
        aria-label={nodeDescription(node)}
      >
        <p className="truncate text-xs font-semibold text-foreground">{node.title}</p>
        <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{node.subtitle}</p>
        {node.marker ? (
          <span className="mt-1 inline-block text-[10px] font-medium uppercase tracking-wide text-foreground">
            {node.marker}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={cn(
        "absolute w-56 rounded-md border p-2 text-left shadow-sm hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        stateClasses(node.state.kind),
        attentionClasses(node.attention.kind),
        markerClasses(node.marker),
        props.selected && "ring-2 ring-ring",
      )}
      style={{ left: node.position.x, top: node.position.y }}
      data-workflow-graph-node={node.id}
      data-workflow-node-kind={node.kind}
      data-workflow-node-state={node.state.kind}
      data-workflow-node-attention={node.attention.kind}
      data-workflow-node-marker={node.marker ?? undefined}
      aria-pressed={props.selected}
      aria-label={nodeDescription(node)}
      onClick={selectNode}
    >
      <span className="block truncate text-xs font-semibold text-foreground">{node.title}</span>
      <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
        {node.subtitle}
      </span>
      <span className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span>{node.state.label}</span>
        <span className="font-medium uppercase">
          {node.marker ?? (node.attention.kind === "none" ? "" : node.attention.kind)}
        </span>
      </span>
    </button>
  );
}

export const WorkflowWorkspace = memo(function WorkflowWorkspace(props: {
  readonly model: WayfinderWorkflowViewModel;
  readonly workflowGraph?: WorkflowGraph | null;
  readonly selectedNodeId: string | null;
  readonly onSelectNode: (nodeId: string) => void;
}) {
  const [filter, setFilter] = useState<WorkflowWorkspaceFilter>("frontier");
  const [expandedStageIds, setExpandedStageIds] = useState<ReadonlySet<WorkflowWorkspaceStageId>>(
    () => new Set(["wayfinder"]),
  );
  const previousPositions = useRef<Record<string, { readonly x: number; readonly y: number }>>({});
  const workspace = useMemo(() => {
    const next = deriveWorkflowWorkspaceModel({
      viewModel: props.model,
      ...(props.workflowGraph !== undefined ? { workflowGraph: props.workflowGraph } : {}),
      selectedNodeId: props.selectedNodeId,
      expandedStageIds,
      filter,
      previousPositions: previousPositions.current,
    });
    previousPositions.current = Object.fromEntries(
      next.nodes.map((node) => [node.id, node.position] as const),
    );
    return next;
  }, [expandedStageIds, filter, props.model, props.selectedNodeId, props.workflowGraph]);

  const toggleStage = useCallback((stageId: WorkflowWorkspaceStageId) => {
    setExpandedStageIds((current) => {
      const next = new Set(current);
      if (next.has(stageId)) next.delete(stageId);
      else next.add(stageId);
      return next;
    });
  }, []);

  const expandAllStages = useCallback(() => {
    setExpandedStageIds(new Set(workspace.stages.map((stage) => stage.id)));
  }, [workspace.stages]);

  const visibleNodeIds = new Set(workspace.visualProjection.visibleNodeIds);
  const nodesById = new Map(workspace.nodes.map((node) => [node.id, node] as const));
  const visibleEdges = workspace.edges.filter((edge) =>
    workspace.visualProjection.visibleEdgeIds.includes(edge.id),
  );

  return (
    <section
      aria-labelledby="workflow-workspace-heading"
      className="space-y-3 rounded-lg border border-border/70 p-3"
      data-workflow-workspace="expanded"
      data-workflow-layout="deterministic"
      data-workflow-motion="static"
    >
      <header className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Compound Workflow Graph
            </p>
            <h3 id="workflow-workspace-heading" className="text-sm font-semibold text-foreground">
              Workflow Workspace
            </h3>
          </div>
          <span className="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground">
            {workspace.visualProjection.visibleNodeIds.length} visible
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          The canvas is a bounded visual projection. The complete Workflow Outline remains the
          accessible source of graph state.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-foreground">
          Visual region
          <select
            aria-label="Visual projection filter"
            className="ml-2 rounded-md border border-border bg-background px-2 py-1 text-xs font-normal"
            value={filter}
            onChange={(event) => setFilter(event.target.value as WorkflowWorkspaceFilter)}
          >
            {FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground"
          onClick={() => toggleStage("ticketing")}
          aria-expanded={expandedStageIds.has("ticketing")}
          data-workflow-expand="ticketing"
        >
          {expandedStageIds.has("ticketing") ? "Collapse tickets" : "Expand tickets"}
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground"
          onClick={expandAllStages}
          data-workflow-expand="all"
        >
          Expand all regions
        </button>
      </div>

      <div
        className="relative overflow-x-auto rounded-md border border-border/70 bg-muted/10"
        data-workflow-visual-projection="bounded"
        aria-label={workspace.accessibilitySummary}
      >
        <div className="relative" style={{ width: workspace.width, height: workspace.height }}>
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-0"
            width={workspace.width}
            height={workspace.height}
          >
            {visibleEdges.map((edge) => {
              const from = nodesById.get(edge.from);
              const to = nodesById.get(edge.to);
              if (!from || !to) return null;
              return (
                <line
                  key={edge.id}
                  x1={from.position.x + 112}
                  y1={from.position.y + 34}
                  x2={to.position.x + 112}
                  y2={to.position.y + 34}
                  stroke="currentColor"
                  strokeOpacity={
                    edge.kind === "dependency" || edge.kind === "lineage" ? 0.55 : 0.25
                  }
                  strokeDasharray={
                    edge.kind === "dependency" || edge.kind === "lineage" ? undefined : "4 4"
                  }
                  data-workflow-edge={edge.id}
                  data-workflow-edge-kind={edge.kind}
                />
              );
            })}
          </svg>

          {workspace.stages.map((stage) => {
            const visibleChildren = stage.nodeIds.filter((nodeId) => visibleNodeIds.has(nodeId));
            return (
              <section
                key={stage.id}
                aria-labelledby={`workflow-stage-${stage.id}`}
                className={cn(
                  "absolute z-10 rounded-lg border border-dashed border-border/70 bg-background/60 p-2",
                  stage.state === "stale" && "border-orange-500/70",
                  stage.state === "attention" && "border-purple-500/70",
                )}
                style={{
                  left: stage.bounds.x,
                  top: stage.bounds.y,
                  width: stage.bounds.width,
                  height: stage.bounds.height,
                }}
                data-workflow-stage-container={stage.id}
                data-workflow-stage-state={stage.state}
                data-workflow-stage-expanded={expandedStageIds.has(stage.id)}
              >
                <button
                  type="button"
                  className="flex w-full items-start justify-between gap-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  aria-expanded={expandedStageIds.has(stage.id)}
                  onClick={() => toggleStage(stage.id)}
                >
                  <span>
                    <span id={`workflow-stage-${stage.id}`} className="block text-xs font-semibold">
                      {stage.label}
                    </span>
                    <span className="block text-[10px] text-muted-foreground">
                      {stage.state} · {visibleChildren.length}/{stage.nodeIds.length} visible
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-xs text-muted-foreground">
                    {expandedStageIds.has(stage.id) ? "−" : "+"}
                  </span>
                </button>
              </section>
            );
          })}

          {workspace.nodes
            .filter((node) => node.kind !== "stage" && visibleNodeIds.has(node.id))
            .map((node) => (
              <GraphNode
                key={node.id}
                node={node}
                selected={
                  props.selectedNodeId === node.sourceNodeId || props.selectedNodeId === node.id
                }
                onSelect={props.onSelectNode}
              />
            ))}
        </div>
      </div>

      <section aria-labelledby="workflow-boundaries-heading" data-workflow-boundaries>
        <h4 id="workflow-boundaries-heading" className="text-xs font-semibold text-foreground">
          Visual Projection boundaries
        </h4>
        <p className="mt-1 text-xs text-muted-foreground">
          {workspace.visualProjection.hiddenNodeCount === 0
            ? "No hidden ticket regions."
            : `${workspace.visualProjection.hiddenNodeCount} ticket${workspace.visualProjection.hiddenNodeCount === 1 ? "" : "s"} outside the selected projection.`}
        </p>
        {workspace.visualProjection.boundaries.length > 0 ? (
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {workspace.visualProjection.boundaries.map((boundary) => (
              <li
                key={boundary.direction}
                className="rounded border border-border px-2 py-1 text-xs text-muted-foreground"
                data-workflow-boundary={boundary.direction}
                data-workflow-hidden-count={boundary.hiddenNodeCount}
              >
                {boundary.label}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-1 text-[11px] text-muted-foreground">
          Expand a stage or change the filter to reveal more regions intentionally.
        </p>
      </section>
    </section>
  );
});
