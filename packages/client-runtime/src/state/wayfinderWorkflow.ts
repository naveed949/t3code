import type {
  ThreadId,
  WayfinderMapProjection,
  WayfinderMutation,
  WayfinderResearchState,
  WayfinderSynchronizationState,
  WorkflowAttachment,
  WorkflowTicketImplementation,
} from "@t3tools/contracts";
import {
  describeWayfinderReadinessBlocker,
  type WayfinderReadiness,
} from "@t3tools/shared/wayfinderReadiness";

import {
  deriveWayfinderResearchModel,
  deriveWayfinderTicketClaimActions,
} from "./wayfinderWorkbench.ts";

export type WayfinderWorkflowAttentionKind = "checkpoint" | "decision" | "none" | "recovery";

export interface WayfinderWorkflowAttention {
  readonly kind: WayfinderWorkflowAttentionKind;
  readonly label: string;
}

export interface WayfinderWorkflowAction {
  readonly id:
    | "cancel-research"
    | "cancel-ticket-implementation"
    | "inspect-ticket-implementation"
    | "open-canonical-ticket"
    | "open-linked-thread"
    | "reclaim-ticket"
    | "release-ticket"
    | "retry-research"
    | "retry-thread-linkage"
    | "restore-ticket-implementation"
    | "resume-ticket-implementation"
    | "start-research"
    | "start-ticket-implementation"
    | "stop-ticket-implementation"
    | "start-work";
  readonly label: string;
  readonly enabled: boolean;
}

export interface WayfinderWorkflowOutlineNode {
  readonly id: `ticket:${number}`;
  readonly number: number;
  readonly title: string;
  readonly classification: string;
  readonly state: {
    readonly kind: "active" | "blocked" | "completed" | "runnable";
    readonly label: "Active" | "Blocked" | "Completed" | "Runnable";
  };
  readonly attention: WayfinderWorkflowAttention;
  readonly evidence: ReadonlyArray<{ readonly label: string; readonly url?: string }>;
  readonly history: ReadonlyArray<string>;
  readonly lineage: {
    readonly blockedBy: ReadonlyArray<number>;
    readonly enables: ReadonlyArray<number>;
  };
  readonly ticketImplementation?: WorkflowTicketImplementation | null;
  readonly linkedThreadId: ThreadId | null;
  readonly allowedActions: ReadonlyArray<WayfinderWorkflowAction>;
  readonly accessibilityLabel: string;
}

export interface WayfinderWorkflowViewModel {
  readonly panel: {
    readonly stageSpine: ReadonlyArray<{
      readonly id: "wayfinder";
      readonly label: "Wayfinder";
      readonly state: "attention" | "completed" | "current";
    }>;
    readonly milestone: {
      readonly number: number;
      readonly title: string;
      readonly url: string;
    };
    readonly attention: WayfinderWorkflowAttention;
    readonly activeRuns: ReadonlyArray<{
      readonly kind: "research" | "ticket";
      readonly ticketNumber: number;
      readonly label: string;
    }>;
    readonly ticketFrontier: ReadonlyArray<{
      readonly id: `ticket:${number}`;
      readonly number: number;
      readonly title: string;
    }>;
    readonly progress: {
      readonly completed: number;
      readonly total: number;
      readonly label: string;
    };
  };
  readonly outline: ReadonlyArray<WayfinderWorkflowOutlineNode>;
  readonly accessibilitySummary: string;
}

type TicketThread = {
  readonly ticketNumber: number;
  readonly threadId: ThreadId;
  readonly status?: "active" | "out-of-scope" | "resolved";
};

const ACTIVE_RESEARCH_STATUSES = new Set(["claiming", "active", "cancelling", "resolving"]);

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function ticketNumberFromMutation(mutation: WayfinderMutation | null): number | null {
  return mutation && "ticketNumber" in mutation.action ? mutation.action.ticketNumber : null;
}

function mutationAttention(mutation: WayfinderMutation | null): WayfinderWorkflowAttention | null {
  if (mutation?.status === "failed") {
    return {
      kind: "recovery",
      label: mutation.error ?? "The native Wayfinder action needs recovery.",
    };
  }
  if (mutation?.status === "awaiting-approval") {
    return { kind: "decision", label: "A native Wayfinder change awaits confirmation." };
  }
  if (mutation?.status === "mutating") {
    return { kind: "none", label: "A native Wayfinder change is in progress." };
  }
  return null;
}

function synchronizationAttention(
  synchronization: WayfinderSynchronizationState | null,
): WayfinderWorkflowAttention | null {
  if (synchronization?.status === "unavailable" || synchronization?.status === "conflict") {
    return {
      kind: "recovery",
      label: synchronization.message ?? "Canonical workflow synchronization needs recovery.",
    };
  }
  if (synchronization?.status === "synchronizing") {
    return { kind: "none", label: "Refreshing the canonical workflow projection." };
  }
  return null;
}

function checkpointAttention(readiness: WayfinderReadiness): WayfinderWorkflowAttention {
  if (readiness.ready) return { kind: "none", label: "No workflow attention is required." };
  const openTickets = readiness.blockers
    .filter((blocker) => blocker.kind === "open-decision-tickets")
    .flatMap((blocker) => blocker.ticketNumbers);
  if (openTickets.length > 0) {
    return {
      kind: "checkpoint",
      label: `Wayfinder checkpoint: ${plural(openTickets.length, "decision ticket")} remain open.`,
    };
  }
  const blocker = readiness.blockers[0];
  return {
    kind: "checkpoint",
    label: blocker
      ? `Wayfinder checkpoint: ${describeWayfinderReadinessBlocker(blocker)}`
      : "Wayfinder checkpoint requires review.",
  };
}

function nodeAttention(input: {
  readonly ticketNumber: number;
  readonly mutation: WayfinderMutation | null;
  readonly synchronization: WayfinderSynchronizationState | null;
  readonly research: ReturnType<typeof deriveWayfinderResearchModel>["tickets"][number] | null;
  readonly ticketImplementation: WorkflowTicketImplementation | null;
}): WayfinderWorkflowAttention {
  if (input.ticketImplementation?.status === "needs-recovery") {
    return {
      kind: "recovery",
      label: `Ticket #${input.ticketNumber} needs recovery; inspect the retained work before resuming, cancelling, or restoring it.`,
    };
  }
  if (input.ticketImplementation?.status === "cancelled") {
    return {
      kind: "decision",
      label: `Ticket #${input.ticketNumber} was cancelled and does not satisfy required work.`,
    };
  }
  if (ticketNumberFromMutation(input.mutation) === input.ticketNumber) {
    return (
      mutationAttention(input.mutation) ?? { kind: "none", label: "No node attention required." }
    );
  }
  if (input.research?.status === "failed" || input.research?.status === "cancelled") {
    return {
      kind: "recovery",
      label: input.research.error ?? `Research for #${input.ticketNumber} needs recovery.`,
    };
  }
  return (
    synchronizationAttention(input.synchronization) ?? {
      kind: "none",
      label: "No node attention required.",
    }
  );
}

function nodeState(input: {
  readonly ticket: WayfinderMapProjection["tickets"][number];
  readonly frontier: ReadonlySet<number>;
  readonly ticketImplementation: WorkflowTicketImplementation | null;
  readonly workflowRunnable: boolean;
}): WayfinderWorkflowOutlineNode["state"] {
  if (
    input.ticketImplementation?.status === "needs-recovery" ||
    input.ticketImplementation?.status === "cancelled"
  ) {
    return { kind: "blocked", label: "Blocked" };
  }
  if (input.ticket.state === "closed") return { kind: "completed", label: "Completed" };
  if (
    input.ticketImplementation?.status === "dispatching" ||
    input.ticketImplementation?.status === "implementing" ||
    input.ticketImplementation?.status === "reviewing" ||
    input.ticketImplementation?.status === "stopping" ||
    input.ticketImplementation?.status === "reviewed"
  ) {
    return { kind: "active", label: "Active" };
  }
  if (input.workflowRunnable) return { kind: "runnable", label: "Runnable" };
  if (input.frontier.has(input.ticket.number)) return { kind: "runnable", label: "Runnable" };
  if (input.ticket.claimedBy !== null) return { kind: "active", label: "Active" };
  return { kind: "blocked", label: "Blocked" };
}

function action(input: {
  readonly id: WayfinderWorkflowAction["id"];
  readonly label: string;
  readonly enabled: boolean;
}): WayfinderWorkflowAction {
  return input;
}

function allowedActions(input: {
  readonly ticket: WayfinderMapProjection["tickets"][number];
  readonly frontier: ReadonlyArray<number>;
  readonly linkedThreadId: ThreadId | null;
  readonly mutation: WayfinderMutation | null;
  readonly research: ReturnType<typeof deriveWayfinderResearchModel>["tickets"][number] | null;
  readonly ticketImplementation: WorkflowTicketImplementation | null;
  readonly workflowRunnable: boolean;
  readonly mutationsEnabled: boolean;
}): ReadonlyArray<WayfinderWorkflowAction> {
  const actions: WayfinderWorkflowAction[] = [
    action({ id: "open-canonical-ticket", label: "Open canonical ticket", enabled: true }),
  ];
  if (input.linkedThreadId !== null) {
    actions.push(action({ id: "open-linked-thread", label: "Open linked thread", enabled: true }));
  }
  if (input.ticket.classification === "research") {
    if (input.research?.canStart) {
      actions.push(
        action({ id: "start-research", label: "Start research", enabled: input.mutationsEnabled }),
      );
    }
    if (input.research?.canCancel) {
      actions.push(
        action({
          id: "cancel-research",
          label: "Cancel research",
          enabled: input.mutationsEnabled,
        }),
      );
    }
    if (input.research?.canRetry) {
      actions.push(
        action({ id: "retry-research", label: "Retry research", enabled: input.mutationsEnabled }),
      );
    }
    return actions;
  }
  const claim = deriveWayfinderTicketClaimActions({
    ticket: input.ticket,
    frontier: input.frontier,
    linkedThreadId: input.linkedThreadId,
    mutation: input.mutation,
  });
  if (claim.canClaim) {
    actions.push(
      action({
        id: claim.claimLabel === "Reclaim" ? "reclaim-ticket" : "start-work",
        label: claim.claimLabel,
        enabled: input.mutationsEnabled,
      }),
    );
  }
  if (claim.canRetry) {
    actions.push(
      action({
        id: "retry-thread-linkage",
        label: "Retry thread linkage",
        enabled: input.mutationsEnabled,
      }),
    );
  }
  if (
    input.workflowRunnable &&
    (input.ticketImplementation === null ||
      input.ticketImplementation.status === "failed" ||
      input.ticketImplementation.status === "needs-correction")
  ) {
    actions.push(
      action({
        id: "start-ticket-implementation",
        label:
          input.ticketImplementation === null ? "Start implementation" : "Retry implementation",
        enabled: input.mutationsEnabled,
      }),
    );
  }
  if (input.ticketImplementation?.status === "stopping") {
    actions.push(
      action({
        id: "stop-ticket-implementation",
        label: "Stop requested",
        enabled: false,
      }),
    );
  } else if (
    (input.ticketImplementation?.status === "dispatching" ||
      input.ticketImplementation?.status === "implementing" ||
      input.ticketImplementation?.status === "reviewing") &&
    input.ticketImplementation.implementationThreadId !== null
  ) {
    actions.push(
      action({
        id: "stop-ticket-implementation",
        label: "Stop",
        enabled: input.mutationsEnabled,
      }),
    );
  }
  if (input.ticketImplementation?.status === "needs-recovery") {
    actions.push(
      action({
        id: "inspect-ticket-implementation",
        label: "Inspect retained work",
        enabled: input.ticketImplementation.implementationThreadId !== null,
      }),
      action({
        id: "resume-ticket-implementation",
        label: "Resume",
        enabled: input.mutationsEnabled,
      }),
      action({
        id: "cancel-ticket-implementation",
        label: "Cancel with changes",
        enabled: input.mutationsEnabled,
      }),
    );
    if (input.ticketImplementation.recoveryCheckpointTurnCount !== undefined) {
      actions.push(
        action({
          id: "restore-ticket-implementation",
          label: `Restore checkpoint ${input.ticketImplementation.recoveryCheckpointTurnCount}`,
          enabled: input.mutationsEnabled,
        }),
      );
    }
  }
  if (claim.canRelease) {
    actions.push(
      action({ id: "release-ticket", label: "Release", enabled: input.mutationsEnabled }),
    );
  }
  return actions;
}

export function deriveWayfinderWorkflowViewModel(input: {
  readonly map: WayfinderMapProjection;
  readonly mutation: WayfinderMutation | null;
  readonly research: WayfinderResearchState | null;
  readonly ticketThreads: ReadonlyArray<TicketThread>;
  readonly synchronization: WayfinderSynchronizationState | null;
  readonly readiness: WayfinderReadiness;
  readonly mutationsEnabled: boolean;
  readonly workflowAttachment?: WorkflowAttachment | null;
}): WayfinderWorkflowViewModel {
  const frontier = new Set(input.map.frontier);
  const linkedThreadByTicket = new Map(
    input.ticketThreads.map(
      (ticketThread) => [ticketThread.ticketNumber, ticketThread.threadId] as const,
    ),
  );
  const researchModel = deriveWayfinderResearchModel({
    map: input.map,
    research: input.research,
    ticketThreads: input.ticketThreads,
  });
  const researchByTicket = new Map(
    researchModel.tickets.map((ticket) => [ticket.ticketNumber, ticket] as const),
  );
  const ticketImplementationByNumber = new Map(
    [...(input.workflowAttachment?.ticketImplementations ?? [])]
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .map((implementation) => [implementation.ticketNumber, implementation] as const),
  );
  const workflowTicketNodes = new Map(
    (input.workflowAttachment?.workflowGraph?.nodes ?? [])
      .filter((node): node is Extract<typeof node, { kind: "ticket" }> => node.kind === "ticket")
      .map((node) => [node.ticketNumber, node] as const),
  );
  const attention =
    mutationAttention(input.mutation) ??
    synchronizationAttention(input.synchronization) ??
    checkpointAttention(input.readiness);
  const activeResearch = researchModel.tickets
    .filter((ticket) => ACTIVE_RESEARCH_STATUSES.has(ticket.status))
    .map((ticket) => ({
      kind: "research" as const,
      ticketNumber: ticket.ticketNumber,
      label: `Research #${ticket.ticketNumber} is ${ticket.status}.`,
    }));
  const activeTicketRuns = input.ticketThreads
    .filter(
      (ticketThread) =>
        ticketThread.status === "active" &&
        !activeResearch.some((run) => run.ticketNumber === ticketThread.ticketNumber),
    )
    .map((ticketThread) => ({
      kind: "ticket" as const,
      ticketNumber: ticketThread.ticketNumber,
      label: `Ticket #${ticketThread.ticketNumber} has an active linked thread.`,
    }));
  const activeImplementationRuns = [...ticketImplementationByNumber.values()]
    .filter((implementation) =>
      ["dispatching", "implementing", "reviewing", "stopping"].includes(implementation.status),
    )
    .map((implementation) => ({
      kind: "ticket" as const,
      ticketNumber: implementation.ticketNumber,
      label: `Ticket #${implementation.ticketNumber} implementation is ${implementation.status}.`,
    }));
  const orderedTickets = [...input.map.tickets].sort((left, right) => left.number - right.number);
  const outline = orderedTickets.map((ticket) => {
    const research = researchByTicket.get(ticket.number) ?? null;
    const linkedThreadId = linkedThreadByTicket.get(ticket.number) ?? null;
    const ticketImplementation = ticketImplementationByNumber.get(ticket.number) ?? null;
    const workflowTicketNode = workflowTicketNodes.get(ticket.number);
    const workflowRunnable = workflowTicketNode?.implementationAvailability?.canStart === true;
    const state = nodeState({ ticket, frontier, ticketImplementation, workflowRunnable });
    const attentionForNode = nodeAttention({
      ticketNumber: ticket.number,
      mutation: input.mutation,
      synchronization: input.synchronization,
      research,
      ticketImplementation,
    });
    const blockedBy = [...ticket.blockedBy].sort((left, right) => left - right);
    const enables = [...ticket.blocks].sort((left, right) => left - right);
    const evidence: WayfinderWorkflowOutlineNode["evidence"][number][] = [
      { label: "Canonical ticket", url: ticket.url },
    ];
    if (ticket.commentCount !== undefined) {
      evidence.push({ label: plural(ticket.commentCount, "comment") });
    }
    const history = [
      `Canonical state: ${ticket.state}.`,
      ticket.lastCommentedAt
        ? `Last comment ${ticket.lastCommentedAt}.`
        : `Projection synchronized ${input.map.lastSynchronizedAt}.`,
      ...(research ? [`Research run: ${research.status}.`] : []),
      ...(ticketImplementation
        ? [
            `Ticket implementation: ${ticketImplementation.status}.`,
            `Implementation Fixed Point: ${ticketImplementation.fixedPoint}.`,
          ]
        : []),
    ];
    const relationships = [
      blockedBy.length > 0
        ? `Blocked by ${blockedBy.map((number) => `#${number}`).join(", ")}.`
        : null,
      enables.length > 0 ? `Enables ${enables.map((number) => `#${number}`).join(", ")}.` : null,
      linkedThreadId !== null ? "Has a linked thread." : null,
      ticketImplementation ? `Ticket implementation is ${ticketImplementation.status}.` : null,
      attentionForNode.kind !== "none" ? attentionForNode.label : null,
    ].filter((relationship): relationship is string => relationship !== null);
    return {
      id: `ticket:${ticket.number}` as const,
      number: ticket.number,
      title: ticket.title,
      classification: ticket.classification,
      state,
      attention: attentionForNode,
      evidence,
      history,
      lineage: { blockedBy, enables },
      ticketImplementation,
      linkedThreadId,
      allowedActions: allowedActions({
        ticket,
        frontier: input.map.frontier,
        linkedThreadId,
        mutation: input.mutation,
        research,
        ticketImplementation,
        workflowRunnable,
        mutationsEnabled: input.mutationsEnabled,
      }),
      accessibilityLabel: [
        `Ticket #${ticket.number}: ${ticket.title}.`,
        `${state.label}.`,
        `${ticket.classification} ticket.`,
        ...relationships,
      ].join(" "),
    };
  });
  const completed = outline.filter((node) => node.state.kind === "completed").length;
  const ticketFrontier = outline
    .filter((node) => frontier.has(node.number))
    .map((node) => ({ id: node.id, number: node.number, title: node.title }));
  const stageState =
    attention.kind === "decision" || attention.kind === "recovery"
      ? "attention"
      : input.readiness.ready
        ? "completed"
        : "current";

  return {
    panel: {
      stageSpine: [{ id: "wayfinder", label: "Wayfinder", state: stageState }],
      milestone: {
        number: input.map.canonicalReference.number,
        title: input.map.canonicalReference.title,
        url: input.map.canonicalReference.url,
      },
      attention,
      activeRuns: [...activeResearch, ...activeTicketRuns, ...activeImplementationRuns],
      ticketFrontier,
      progress: {
        completed,
        total: outline.length,
        label: `${plural(completed, "completed ticket")} of ${plural(outline.length, "ticket")}.`,
      },
    },
    outline,
    accessibilitySummary: `${input.map.canonicalReference.title}. Workflow outline with ${plural(
      outline.length,
      "ticket",
    )}; ${plural(ticketFrontier.length, "runnable frontier ticket")}. ${attention.label}`,
  };
}
