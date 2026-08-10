import type {
  WorkflowAttachment,
  WorkflowGraphNode,
  WorkflowPublication,
  WorkflowPublicationAction,
  WorkflowPublicationCommit,
} from "@t3tools/contracts";
import {
  hasPendingWorkflowStaleness,
  isIntegratedWorkflowTrackerTicket,
} from "@t3tools/shared/workflowGraph";

export const WORKFLOW_PUBLICATION_AUTHORITY = {
  pushBaseline: true,
  createDraftPullRequest: true,
} as const;

export function splitWorkflowRemoteTarget(remoteTarget: string): {
  readonly remote: string;
  readonly targetBranch: string;
} {
  const separator = remoteTarget.indexOf("/");
  if (separator <= 0 || separator === remoteTarget.length - 1) {
    return { remote: remoteTarget, targetBranch: remoteTarget };
  }
  return {
    remote: remoteTarget.slice(0, separator),
    targetBranch: remoteTarget.slice(separator + 1),
  };
}

function trackerProjection(attachment: WorkflowAttachment) {
  return attachment.trackerProjection ?? attachment.ticketingStage?.trackerProjection;
}

function canonicalReference(attachment: WorkflowAttachment) {
  return (
    trackerProjection(attachment)?.canonicalReference ??
    attachment.backfilledWayfinderData.wayfinderMap?.canonicalReference
  );
}

function inScopeTicketNodes(
  attachment: WorkflowAttachment,
): ReadonlyArray<Extract<WorkflowGraphNode, { readonly kind: "ticket" }>> {
  const scope = new Set(attachment.workflowRun?.configuration.runScope.map((item) => item.nodeId));
  return (attachment.workflowGraph?.nodes ?? []).filter(
    (node): node is Extract<WorkflowGraphNode, { readonly kind: "ticket" }> =>
      node.kind === "ticket" && node.includedInRun && scope.has(node.id),
  );
}

export function workflowPublicationBlockers(attachment: WorkflowAttachment): ReadonlyArray<string> {
  const blockers: Array<string> = [];
  const workflowRun = attachment.workflowRun;
  if (workflowRun?.status !== "confirmed") {
    blockers.push("The Workstream requires a confirmed Workflow Run.");
  }
  const tracker = trackerProjection(attachment);
  if (tracker?.status !== "healthy") {
    blockers.push("Tracker synchronization is not healthy.");
  }
  const canonical = canonicalReference(attachment);
  if (canonical === undefined) {
    blockers.push("The Workflow PRD canonical tracker reference is unavailable.");
  } else if (canonical.state !== "open") {
    blockers.push("The Workflow PRD must remain open until the Workstream pull request merges.");
  }
  if (hasPendingWorkflowStaleness(attachment)) {
    blockers.push("The Workstream has unresolved stale nodes.");
  }
  if (
    attachment.baselineRefresh !== undefined &&
    attachment.baselineRefresh.status !== "completed"
  ) {
    blockers.push("Baseline Refresh must be completed before Workstream publication.");
  }
  if (workflowRun?.automationStatus === "running" || workflowRun?.automationStatus === "draining") {
    blockers.push("The Workflow Run must be idle or paused before publication.");
  }
  const targetVerification = workflowRun?.configuration.targetVerification;
  if (
    targetVerification === undefined ||
    targetVerification.fixedPoint !== "verified" ||
    targetVerification.workstreamBaseline !== "verified" ||
    targetVerification.remoteTarget !== "verified"
  ) {
    blockers.push("The fixed point, Workstream Baseline, and remote target must be verified.");
  }

  const ticketNodes = inScopeTicketNodes(attachment);
  if (ticketNodes.length === 0) {
    blockers.push("The Workstream has no integrated in-scope Ticket nodes.");
  }
  const trackerTickets = new Map(
    (tracker?.tickets ?? []).map((ticket) => [ticket.number, ticket] as const),
  );
  const implementations = new Map(
    (attachment.ticketImplementations ?? []).map((implementation) => [
      implementation.nodeId,
      implementation,
    ]),
  );
  for (const node of ticketNodes) {
    const ticket = trackerTickets.get(node.ticketNumber);
    if (ticket === undefined || !isIntegratedWorkflowTrackerTicket(ticket)) {
      blockers.push(
        `Ticket #${node.ticketNumber} is not integrated in the synchronized tracker projection.`,
      );
    }
    const implementation = implementations.get(node.id);
    if (implementation?.status !== "integrated") {
      blockers.push(`Ticket #${node.ticketNumber} does not have an integrated implementation.`);
    }
  }
  return [...new Set(blockers)];
}

export function workflowPublicationTitle(attachment: WorkflowAttachment): string {
  const canonical = canonicalReference(attachment);
  return `Workflow: ${canonical?.title ?? attachment.workflowGoal}`;
}

export function workflowPublicationBody(attachment: WorkflowAttachment): string {
  const canonical = canonicalReference(attachment);
  const ticketNodes = inScopeTicketNodes(attachment).toSorted((left, right) => {
    if (left.ticketNumber !== right.ticketNumber) return left.ticketNumber - right.ticketNumber;
    return left.id.localeCompare(right.id);
  });
  const tickets =
    ticketNodes.length === 0
      ? "- No in-scope Ticket nodes were projected."
      : ticketNodes.map((node) => `- #${node.ticketNumber} — ${node.title}`).join("\n");
  const relationship =
    canonical === undefined
      ? "The Workflow PRD closing relationship is unavailable until tracker synchronization succeeds."
      : `Closes #${canonical.number}`;
  return [
    "## Workstream",
    "",
    attachment.workflowGoal,
    "",
    "## Integrated tickets",
    "",
    tickets,
    "",
    relationship,
  ].join("\n");
}

export function workflowPublicationActions(
  publication: Pick<
    WorkflowPublication,
    "status" | "baselineCommit" | "commits" | "authorityGranted"
  >,
): ReadonlyArray<WorkflowPublicationAction> {
  const actions: Array<WorkflowPublicationAction> = [];
  if (["blocked", "ready", "needs-recovery"].includes(publication.status)) {
    actions.push({
      id: "preflight",
      label: publication.status === "needs-recovery" ? "Retry preview" : "Preview publication",
      enabled: true,
      reason: null,
    });
  }
  if (
    ((publication.status === "ready" && !publication.authorityGranted) ||
      publication.status === "needs-recovery") &&
    publication.baselineCommit !== null &&
    publication.commits.length > 0
  ) {
    actions.push({
      id: "confirm",
      label: "Publish draft pull request",
      enabled: true,
      reason: null,
    });
  }
  if (["publishing", "published-for-review", "needs-recovery"].includes(publication.status)) {
    actions.push({
      id: "reconcile",
      label: "Reconcile publication",
      enabled: true,
      reason: null,
    });
  }
  return actions;
}

export function withWorkflowPublicationActions(
  publication: WorkflowPublication,
): WorkflowPublication {
  return {
    ...publication,
    allowedActions: workflowPublicationActions(publication),
  };
}

export function workflowPublicationCommits(
  commits: ReadonlyArray<{ readonly sha: string; readonly title: string }>,
): ReadonlyArray<WorkflowPublicationCommit> {
  return commits.map((commit) => ({ sha: commit.sha, title: commit.title }));
}
