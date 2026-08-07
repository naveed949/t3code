import type {
  WayfinderWorkflowOutlineNode,
  WayfinderWorkflowViewModel,
} from "@t3tools/client-runtime/state/wayfinder-workflow";
import type { ThreadId } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";

function WorkflowNodeInspector(props: {
  readonly node: WayfinderWorkflowOutlineNode;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly onStartTicketImplementation?: (nodeId: string) => void;
}) {
  const canonicalEvidence = props.node.evidence.find((evidence) => evidence.url !== undefined);
  const implementation = props.node.ticketImplementation ?? null;
  const implementationAction = props.node.allowedActions.find(
    (action) => action.id === "start-ticket-implementation" && action.enabled,
  );
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={`Node Inspector. ${props.node.accessibilityLabel}`}
      className="gap-3 rounded-xl border border-border bg-card p-4"
    >
      <View>
        <Text className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          Node Inspector
        </Text>
        <Text accessibilityRole="header" className="mt-1 text-base font-semibold text-foreground">
          #{props.node.number} {props.node.title}
        </Text>
        <Text className="mt-1 text-xs text-foreground-muted">
          {props.node.state.label} · {props.node.classification}
          {props.node.attention.kind === "none" ? "" : ` · ${props.node.attention.label}`}
        </Text>
      </View>

      <View>
        <Text accessibilityRole="header" className="text-xs font-semibold text-foreground">
          Evidence
        </Text>
        {canonicalEvidence?.url ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Open canonical ticket"
            className="mt-1 self-start"
            onPress={() => void tryOpenExternalUrl(canonicalEvidence.url!, "wayfinder")}
          >
            <Text className="text-xs font-semibold text-foreground underline">
              {canonicalEvidence.label}
            </Text>
          </Pressable>
        ) : null}
        {props.node.evidence
          .filter((evidence) => evidence.url === undefined)
          .map((evidence) => (
            <Text key={evidence.label} className="mt-1 text-xs text-foreground-muted">
              {evidence.label}
            </Text>
          ))}
      </View>

      <View>
        <Text accessibilityRole="header" className="text-xs font-semibold text-foreground">
          History
        </Text>
        {props.node.history.map((entry) => (
          <Text key={entry} className="mt-1 text-xs text-foreground-muted">
            {entry}
          </Text>
        ))}
      </View>

      <View>
        <Text accessibilityRole="header" className="text-xs font-semibold text-foreground">
          Lineage
        </Text>
        <Text className="mt-1 text-xs text-foreground-muted">
          {props.node.lineage.blockedBy.length > 0
            ? `Blocked by ${props.node.lineage.blockedBy.map((number) => `#${number}`).join(", ")}.`
            : "No predecessor nodes."}{" "}
          {props.node.lineage.enables.length > 0
            ? `Enables ${props.node.lineage.enables.map((number) => `#${number}`).join(", ")}.`
            : "No dependent nodes."}
        </Text>
      </View>

      <View>
        <Text accessibilityRole="header" className="text-xs font-semibold text-foreground">
          Linked thread
        </Text>
        {props.node.linkedThreadId ? (
          <Pressable
            accessibilityRole="button"
            className="mt-1 self-start rounded-lg border border-border px-3 py-2"
            onPress={() => props.onOpenThread(props.node.linkedThreadId!)}
          >
            <Text className="text-xs font-semibold text-foreground">Open linked thread</Text>
          </Pressable>
        ) : (
          <Text className="mt-1 text-xs text-foreground-muted">No linked thread.</Text>
        )}
      </View>

      <View>
        <Text accessibilityRole="header" className="text-xs font-semibold text-foreground">
          Ticket implementation
        </Text>
        {implementation ? (
          <View className="mt-1 gap-1">
            <Text className="text-xs font-semibold text-foreground">
              Milestone: {implementation.status.replaceAll("-", " ")}
            </Text>
            <Text className="text-xs text-foreground-muted">
              Fixed Point: {implementation.fixedPoint}
            </Text>
            <Text className="text-xs text-foreground-muted">
              Implementation thread: {implementation.implementationThreadId ?? "Pending"}
            </Text>
            <Text className="text-xs text-foreground-muted">
              Worktree: {implementation.worktreePath ?? "Pending"}
            </Text>
            <Text className="text-xs text-foreground-muted">
              Branch: {implementation.branch ?? "Pending"}
            </Text>
            <Text className="text-xs text-foreground-muted">
              Diff:{" "}
              {implementation.diff
                ? `${implementation.diff.files.length} files, +${implementation.diff.additions} -${implementation.diff.deletions}`
                : "Not captured."}
            </Text>
            <Text className="text-xs text-foreground-muted">
              Validation:{" "}
              {implementation.validation.length === 0
                ? "Not recorded."
                : implementation.validation
                    .map((evidence) => `${evidence.name}: ${evidence.status}`)
                    .join(", ")}
            </Text>
            {implementation.review ? (
              <View className="rounded border border-border p-2">
                <Text className="text-xs font-semibold text-foreground">
                  Code Review: {implementation.review.status}
                </Text>
                <Text className="mt-1 text-xs text-foreground-muted">
                  {implementation.review.summary}
                </Text>
                {implementation.review.findings.map((finding) => (
                  <Text
                    key={`${finding.severity}:${finding.summary}`}
                    className="mt-1 text-xs text-foreground-muted"
                  >
                    {finding.severity}: {finding.summary}
                  </Text>
                ))}
              </View>
            ) : (
              <Text className="text-xs text-foreground-muted">
                Code Review: Pending structured evidence.
              </Text>
            )}
          </View>
        ) : (
          <Text className="mt-1 text-xs text-foreground-muted">Not started.</Text>
        )}
        {implementation?.implementationThreadId ? (
          <Pressable
            accessibilityRole="button"
            className="mt-2 self-start rounded-lg border border-border px-3 py-2"
            onPress={() => props.onOpenThread(implementation.implementationThreadId!)}
          >
            <Text className="text-xs font-semibold text-foreground">
              Open implementation thread
            </Text>
          </Pressable>
        ) : null}
        {implementationAction && props.onStartTicketImplementation ? (
          <Pressable
            accessibilityRole="button"
            className="mt-2 self-start rounded-lg border border-border px-3 py-2"
            onPress={() => props.onStartTicketImplementation?.(props.node.id)}
          >
            <Text className="text-xs font-semibold text-foreground">
              {implementationAction.label}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View
        accessibilityRole="summary"
        accessibilityLabel={`Allowed Actions: ${props.node.allowedActions
          .map((action) => `${action.label}${action.enabled ? "" : " unavailable"}`)
          .join(", ")}`}
      >
        <Text accessibilityRole="header" className="text-xs font-semibold text-foreground">
          Allowed Actions
        </Text>
        <View className="mt-1 flex-row flex-wrap gap-2">
          {props.node.allowedActions.map((action) => (
            <Text
              key={action.id}
              className={
                action.enabled
                  ? "rounded border border-border px-2 py-1 text-xs text-foreground-muted"
                  : "rounded border border-border px-2 py-1 text-xs text-foreground-muted opacity-60"
              }
            >
              {action.label}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

export function WorkflowPanel(props: {
  readonly model: WayfinderWorkflowViewModel;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly onStartTicketImplementation?: (nodeId: string) => void;
}) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const selectedNode = props.model.outline.find((node) => node.id === selectedNodeId) ?? null;

  useEffect(() => {
    if (selectedNodeId !== null && selectedNode === null) setSelectedNodeId(null);
  }, [selectedNode, selectedNodeId]);

  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel="Workflow Panel. Workstream-scoped server projection; the thread Plan remains separate."
      className="gap-4 rounded-xl border border-border bg-card p-4"
    >
      <View>
        <Text className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          Development Workflow
        </Text>
        <Text accessibilityRole="header" className="mt-1 text-base font-semibold text-foreground">
          Workflow Panel
        </Text>
        <Text className="mt-1 text-xs leading-5 text-foreground-muted">
          Workstream-scoped state from the canonical server projection. Thread Plan remains
          separate.
        </Text>
      </View>

      <View className="gap-2">
        <Text accessibilityRole="header" className="text-xs font-semibold text-foreground">
          Stage spine
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {props.model.panel.stageSpine.map((stage) => (
            <Text
              key={stage.id}
              className="rounded border border-border px-2 py-1 text-xs text-foreground-muted"
            >
              {stage.label} · {stage.state}
            </Text>
          ))}
        </View>
      </View>

      <View className="gap-1">
        <Text accessibilityRole="header" className="text-xs font-semibold text-foreground">
          Milestone
        </Text>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open milestone #${props.model.panel.milestone.number}`}
          className="self-start"
          onPress={() => void tryOpenExternalUrl(props.model.panel.milestone.url, "wayfinder")}
        >
          <Text className="text-xs font-semibold text-foreground underline">
            #{props.model.panel.milestone.number} {props.model.panel.milestone.title}
          </Text>
        </Pressable>
      </View>

      <View className="gap-1">
        <Text accessibilityRole="header" className="text-xs font-semibold text-foreground">
          Current checkpoint or attention
        </Text>
        <Text
          accessibilityRole={props.model.panel.attention.kind === "recovery" ? "alert" : "text"}
          className="text-xs leading-5 text-foreground-muted"
        >
          {props.model.panel.attention.label}
        </Text>
      </View>

      <View className="gap-1">
        <Text accessibilityRole="header" className="text-xs font-semibold text-foreground">
          Active runs
        </Text>
        {props.model.panel.activeRuns.length === 0 ? (
          <Text className="text-xs text-foreground-muted">No active runs.</Text>
        ) : (
          props.model.panel.activeRuns.map((run) => (
            <Text key={`${run.kind}:${run.ticketNumber}`} className="text-xs text-foreground-muted">
              {run.label}
            </Text>
          ))
        )}
      </View>

      <View className="gap-1">
        <Text accessibilityRole="header" className="text-xs font-semibold text-foreground">
          Progress
        </Text>
        <Text className="text-xs text-foreground-muted">{props.model.panel.progress.label}</Text>
      </View>

      <View className="gap-1">
        <Text accessibilityRole="header" className="text-xs font-semibold text-foreground">
          Ticket Frontier
        </Text>
        {props.model.panel.ticketFrontier.length === 0 ? (
          <Text className="text-xs text-foreground-muted">No runnable tickets.</Text>
        ) : (
          <View className="flex-row flex-wrap gap-2">
            {props.model.panel.ticketFrontier.map((ticket) => (
              <Pressable
                key={ticket.id}
                accessibilityRole="button"
                accessibilityLabel={`Inspect frontier ticket #${ticket.number}: ${ticket.title}`}
                className="rounded-lg border border-border px-3 py-2"
                onPress={() => setSelectedNodeId(ticket.id)}
              >
                <Text className="text-xs font-semibold text-foreground">
                  #{ticket.number} {ticket.title}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <View
        accessibilityRole="summary"
        accessibilityLabel={props.model.accessibilitySummary}
        className="gap-2"
      >
        <Text accessibilityRole="header" className="text-sm font-semibold text-foreground">
          Workflow Outline
        </Text>
        <Text className="text-xs leading-5 text-foreground-muted">
          Complete projected nodes and relationships. Selecting a node opens its inspector and any
          eligible implementation action.
        </Text>
        <View className="gap-2">
          {props.model.outline.map((node) => (
            <Pressable
              key={node.id}
              accessibilityRole="button"
              accessibilityLabel={node.accessibilityLabel}
              accessibilityState={{ selected: selectedNodeId === node.id }}
              className={
                selectedNodeId === node.id
                  ? "rounded-lg border border-foreground bg-background p-3"
                  : "rounded-lg border border-border bg-background p-3"
              }
              onPress={() => setSelectedNodeId(node.id)}
            >
              <Text className="text-sm font-semibold text-foreground">
                #{node.number} {node.title}
              </Text>
              <Text className="mt-1 text-xs text-foreground-muted">
                {node.state.label} · {node.classification}
                {node.lineage.blockedBy.length > 0
                  ? ` · Blocked by ${node.lineage.blockedBy.map((number) => `#${number}`).join(", ")}`
                  : ""}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {selectedNode ? (
        <WorkflowNodeInspector
          node={selectedNode}
          onOpenThread={props.onOpenThread}
          {...(props.onStartTicketImplementation
            ? { onStartTicketImplementation: props.onStartTicketImplementation }
            : {})}
        />
      ) : (
        <Text className="text-xs text-foreground-muted">
          Select a workflow node to inspect evidence, history, lineage, linked threads, and Allowed
          Actions.
        </Text>
      )}
    </View>
  );
}
