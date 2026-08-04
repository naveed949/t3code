import type {
  WayfinderWorkflowOutlineNode,
  WayfinderWorkflowViewModel,
} from "@t3tools/client-runtime/state/wayfinder-workflow";
import type { ThreadId } from "@t3tools/contracts";
import { memo, type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";

export function nextWorkflowOutlineIndex(
  key: string,
  currentIndex: number,
  nodeCount: number,
): number | null {
  if (nodeCount === 0) return null;
  if (key === "ArrowDown") return Math.min(currentIndex + 1, nodeCount - 1);
  if (key === "ArrowUp") return Math.max(currentIndex - 1, 0);
  if (key === "Home") return 0;
  if (key === "End") return nodeCount - 1;
  return null;
}

function WorkflowNodeInspector(props: {
  readonly node: WayfinderWorkflowOutlineNode;
  readonly onOpenThread?: (threadId: ThreadId) => void;
}) {
  return (
    <aside
      aria-labelledby="workflow-node-inspector-heading"
      className="space-y-3 rounded-lg border border-border/70 bg-card p-3"
      data-workflow-node-inspector={props.node.id}
    >
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Node Inspector
        </p>
        <h4
          id="workflow-node-inspector-heading"
          className="mt-1 text-sm font-semibold text-foreground"
        >
          #{props.node.number} {props.node.title}
        </h4>
        <p className="mt-1 text-xs text-muted-foreground">
          {props.node.state.label} · {props.node.classification}
          {props.node.attention.kind === "none" ? "" : ` · ${props.node.attention.label}`}
        </p>
      </div>

      <section aria-labelledby="workflow-node-evidence">
        <h5 id="workflow-node-evidence" className="text-xs font-semibold text-foreground">
          Evidence
        </h5>
        <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
          {props.node.evidence.map((evidence) => (
            <li key={`${evidence.label}:${evidence.url ?? "plain"}`}>
              {evidence.url ? (
                <a
                  href={evidence.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-foreground underline decoration-border underline-offset-2"
                >
                  {evidence.label}
                </a>
              ) : (
                evidence.label
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="workflow-node-history">
        <h5 id="workflow-node-history" className="text-xs font-semibold text-foreground">
          History
        </h5>
        <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
          {props.node.history.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="workflow-node-lineage">
        <h5 id="workflow-node-lineage" className="text-xs font-semibold text-foreground">
          Lineage
        </h5>
        <p className="mt-1 text-xs text-muted-foreground">
          {props.node.lineage.blockedBy.length > 0
            ? `Blocked by ${props.node.lineage.blockedBy.map((number) => `#${number}`).join(", ")}.`
            : "No predecessor nodes."}{" "}
          {props.node.lineage.enables.length > 0
            ? `Enables ${props.node.lineage.enables.map((number) => `#${number}`).join(", ")}.`
            : "No dependent nodes."}
        </p>
      </section>

      <section aria-labelledby="workflow-node-linked-thread">
        <h5 id="workflow-node-linked-thread" className="text-xs font-semibold text-foreground">
          Linked thread
        </h5>
        {props.node.linkedThreadId && props.onOpenThread ? (
          <button
            type="button"
            className="mt-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground"
            onClick={() => props.onOpenThread?.(props.node.linkedThreadId!)}
          >
            Open linked thread
          </button>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">No linked thread.</p>
        )}
      </section>

      <section aria-labelledby="workflow-node-actions">
        <h5 id="workflow-node-actions" className="text-xs font-semibold text-foreground">
          Allowed Actions
        </h5>
        <ul className="mt-1 flex flex-wrap gap-1.5 text-xs">
          {props.node.allowedActions.map((action) => (
            <li
              key={action.id}
              aria-disabled={!action.enabled}
              data-workflow-action={action.id}
              className={cn(
                "rounded border border-border px-2 py-1 text-muted-foreground",
                !action.enabled && "opacity-60",
              )}
            >
              {action.label}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

export const WorkflowPanel = memo(function WorkflowPanel(props: {
  readonly model: WayfinderWorkflowViewModel;
  readonly onOpenThread?: (threadId: ThreadId) => void;
  readonly initialSelectedNodeId?: string | null;
  readonly selectedNodeId?: string | null;
  readonly onSelectNode?: (nodeId: string | null) => void;
  readonly onOpenWorkspace?: () => void;
}) {
  const [internalSelectedNodeId, setInternalSelectedNodeId] = useState<string | null>(
    props.initialSelectedNodeId ?? null,
  );
  const selectedNodeId =
    props.selectedNodeId === undefined ? internalSelectedNodeId : props.selectedNodeId;
  const setSelectedNodeId = useCallback(
    (nodeId: string | null) => {
      if (props.selectedNodeId === undefined) setInternalSelectedNodeId(nodeId);
      props.onSelectNode?.(nodeId);
    },
    [props.onSelectNode, props.selectedNodeId],
  );
  const nodeButtons = useRef(new Map<string, HTMLButtonElement>());
  const nodes = props.model.outline;
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;

  useEffect(() => {
    if (selectedNodeId !== null && selectedNode === null) setSelectedNodeId(null);
  }, [selectedNode, selectedNodeId, setSelectedNodeId]);

  const selectNode = (node: WayfinderWorkflowOutlineNode) => setSelectedNodeId(node.id);
  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const nextIndex = nextWorkflowOutlineIndex(event.key, index, nodes.length);
    if (nextIndex === null) return;
    event.preventDefault();
    const next = nodes[nextIndex];
    if (!next) return;
    selectNode(next);
    nodeButtons.current.get(next.id)?.focus();
  };

  return (
    <section
      aria-labelledby="workflow-panel-heading"
      className="space-y-4 rounded-lg border border-border/70 p-3"
      data-workflow-panel="server-projection"
      data-workflow-scope="workstream"
    >
      <header className="space-y-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Development Workflow
        </p>
        <h3 id="workflow-panel-heading" className="text-sm font-semibold text-foreground">
          Workflow Panel
        </h3>
        <p className="text-xs text-muted-foreground">
          Workstream-scoped state from the canonical server projection. Thread Plan remains
          separate.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <section aria-labelledby="workflow-stage-spine">
          <h4 id="workflow-stage-spine" className="text-xs font-semibold text-foreground">
            Stage spine
          </h4>
          <ol className="mt-1 flex flex-wrap gap-1.5">
            {props.model.panel.stageSpine.map((stage) => (
              <li
                key={stage.id}
                data-workflow-stage={stage.state}
                className="rounded border border-border px-2 py-1 text-xs text-muted-foreground"
              >
                {stage.label} · {stage.state}
              </li>
            ))}
          </ol>
        </section>
        <section aria-labelledby="workflow-milestone">
          <h4 id="workflow-milestone" className="text-xs font-semibold text-foreground">
            Milestone
          </h4>
          <a
            href={props.model.panel.milestone.url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block text-xs font-medium text-foreground underline decoration-border underline-offset-2"
          >
            #{props.model.panel.milestone.number} {props.model.panel.milestone.title}
          </a>
        </section>
      </div>

      <section aria-labelledby="workflow-attention">
        <h4 id="workflow-attention" className="text-xs font-semibold text-foreground">
          Current checkpoint or attention
        </h4>
        <p
          role={props.model.panel.attention.kind === "recovery" ? "alert" : "status"}
          className="mt-1 text-xs text-muted-foreground"
        >
          {props.model.panel.attention.label}
        </p>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <section aria-labelledby="workflow-active-runs">
          <h4 id="workflow-active-runs" className="text-xs font-semibold text-foreground">
            Active runs
          </h4>
          {props.model.panel.activeRuns.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">No active runs.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
              {props.model.panel.activeRuns.map((run) => (
                <li key={`${run.kind}:${run.ticketNumber}`}>{run.label}</li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="workflow-progress">
          <h4 id="workflow-progress" className="text-xs font-semibold text-foreground">
            Progress
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">{props.model.panel.progress.label}</p>
        </section>
      </div>

      <section aria-labelledby="workflow-ticket-frontier">
        <h4 id="workflow-ticket-frontier" className="text-xs font-semibold text-foreground">
          Ticket Frontier
        </h4>
        {props.model.panel.ticketFrontier.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">No runnable tickets.</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {props.model.panel.ticketFrontier.map((ticket) => (
              <li key={ticket.id}>
                <button
                  type="button"
                  className="rounded border border-border px-2 py-1 text-left text-xs font-medium text-foreground"
                  onClick={() => {
                    const node = nodes.find((candidate) => candidate.id === ticket.id);
                    if (node) selectNode(node);
                  }}
                >
                  #{ticket.number} {ticket.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="workflow-workspace-toggle-heading" className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h4
              id="workflow-workspace-toggle-heading"
              className="text-xs font-semibold text-foreground"
            >
              Workflow Workspace
            </h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Open the bounded graph when you need visual context beyond the compact panel.
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground"
            disabled={!props.onOpenWorkspace}
            data-workflow-workspace-toggle="true"
            onClick={props.onOpenWorkspace}
          >
            Open workspace
          </button>
        </div>
      </section>

      <section aria-labelledby="workflow-outline-heading" className="space-y-2">
        <div>
          <h4 id="workflow-outline-heading" className="text-xs font-semibold text-foreground">
            Workflow Outline
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Complete projected nodes and relationships. Select a node to inspect it; selection does
            not dispatch workflow work.
          </p>
        </div>
        <ol
          role="tree"
          aria-label={props.model.accessibilitySummary}
          className="space-y-1 rounded-md border border-border/70 p-2"
          data-workflow-outline="complete"
        >
          {nodes.map((node, index) => (
            <li key={node.id} role="none">
              <button
                ref={(element) => {
                  if (element) nodeButtons.current.set(node.id, element);
                  else nodeButtons.current.delete(node.id);
                }}
                type="button"
                role="treeitem"
                aria-level={1}
                aria-selected={selectedNodeId === node.id}
                aria-label={node.accessibilityLabel}
                tabIndex={
                  selectedNodeId === null
                    ? index === 0
                      ? 0
                      : -1
                    : selectedNodeId === node.id
                      ? 0
                      : -1
                }
                className={cn(
                  "flex w-full items-start justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  selectedNodeId === node.id && "bg-accent",
                )}
                onClick={() => selectNode(node)}
                onKeyDown={(event) => moveFocus(event, index)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">
                    #{node.number} {node.title}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {node.state.label} · {node.classification}
                    {node.lineage.blockedBy.length > 0
                      ? ` · Blocked by ${node.lineage.blockedBy.map((number) => `#${number}`).join(", ")}`
                      : ""}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">Inspect</span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      {selectedNode ? (
        <WorkflowNodeInspector
          node={selectedNode}
          {...(props.onOpenThread ? { onOpenThread: props.onOpenThread } : {})}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          Select a workflow node to inspect evidence, history, lineage, linked threads, and Allowed
          Actions.
        </p>
      )}
    </section>
  );
});
