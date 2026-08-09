import {
  CommandId,
  type ThreadId,
  type WorkflowGraph,
  type WorkflowRun,
  type WorkflowTicketImplementationDispatchMode,
  type WorkflowTicketImplementationStatus,
  type WorkflowTrackerProjection,
  type WorkstreamId,
} from "@t3tools/contracts";
import { isIntegratedWorkflowTrackerTicket } from "@t3tools/shared/workflowGraph";

export type WorkflowSchedulerImplementation = {
  readonly nodeId: string;
  readonly status: WorkflowTicketImplementationStatus;
  readonly recoveryPhase?: "implementation" | "review" | "integration";
  readonly dispatchMode?: WorkflowTicketImplementationDispatchMode;
};

export type WorkflowSchedulerWorkstream = {
  readonly workstreamId: WorkstreamId;
  readonly originThreadId: ThreadId;
  readonly workflowRun: WorkflowRun;
  readonly workflowGraph: WorkflowGraph;
  readonly trackerProjection?: WorkflowTrackerProjection;
  readonly implementations: ReadonlyArray<WorkflowSchedulerImplementation>;
  /** Provider turns not represented by a Ticket Implementation in this Workstream. */
  readonly activeProviderRuns?: number;
  readonly workflowVersion?: number;
  readonly isolationAvailable?: boolean;
};

export type WorkflowTicketFrontierDispatch = {
  readonly workstreamId: WorkstreamId;
  readonly originThreadId: ThreadId;
  readonly ticketNodeId: string;
  readonly actionIdentity: CommandId;
  readonly expectedWorkstreamVersion: number;
};

export type WorkflowTicketFrontierSelection = {
  readonly dispatches: ReadonlyArray<WorkflowTicketFrontierDispatch>;
  readonly nextLastServedWorkstreamId: WorkstreamId | null;
};

const activeStatuses = new Set<WorkflowTicketImplementationStatus>([
  "dispatching",
  "implementing",
  "reviewing",
  "stopping",
  "integrating",
  "needs-recovery",
]);

function selectedProviderInstanceId(workstream: WorkflowSchedulerWorkstream, nodeId: string) {
  return (
    workstream.workflowRun.configuration.providerOverrides.find(
      (override) => override.nodeId === nodeId,
    )?.providerInstanceId ?? workstream.workflowRun.configuration.defaultProviderInstanceId
  );
}

function hasPinnedCapabilities(workstream: WorkflowSchedulerWorkstream, nodeId: string): boolean {
  const requiredSkills = workstream.workflowRun.configuration.requiredSkills;
  const providerInstanceId = selectedProviderInstanceId(workstream, nodeId);
  const hasSkill = (stage: string, name: string) =>
    requiredSkills.some(
      (candidate) =>
        candidate.providerInstanceId === providerInstanceId &&
        candidate.stage === stage &&
        candidate.skill.name === name &&
        candidate.status === "available" &&
        candidate.skill.path !== undefined &&
        candidate.skill.contentDigest !== undefined &&
        (candidate.nodeId === nodeId || candidate.nodeId === `workflow:${workstream.workstreamId}`),
    );
  return hasSkill("implementation", "implement") && hasSkill("review", "code-review");
}

function canonicalBlockersIntegrated(
  trackerProjection: WorkflowTrackerProjection,
  blockedBy: ReadonlyArray<number>,
): boolean {
  const ticketsByNumber = new Map(
    trackerProjection.tickets.map((ticket) => [ticket.number, ticket]),
  );
  return blockedBy.every((blockerNumber) => {
    const ticket = ticketsByNumber.get(blockerNumber);
    return ticket !== undefined && isIntegratedWorkflowTrackerTicket(ticket);
  });
}

function candidateNode(
  workstream: WorkflowSchedulerWorkstream,
  node: WorkflowGraph["nodes"][number],
): WorkflowTicketFrontierDispatch | null {
  if (
    workstream.workflowRun.automationStatus !== "running" ||
    workstream.isolationAvailable === false ||
    node.kind !== "ticket" ||
    node.state !== "current" ||
    node.held === true ||
    node.includedInRun !== true ||
    !workstream.workflowRun.configuration.runScope.some((scope) => scope.nodeId === node.id)
  ) {
    return null;
  }

  const trackerProjection = workstream.trackerProjection;
  const trackerTicket = trackerProjection?.tickets.find(
    (ticket) =>
      ticket.number === node.ticketNumber && (ticket.key === null || ticket.key === node.ticketKey),
  );
  if (
    trackerProjection?.status !== "healthy" ||
    trackerTicket === undefined ||
    trackerTicket.state !== "open" ||
    trackerTicket.includedInRun !== true ||
    trackerTicket.body === undefined ||
    !canonicalBlockersIntegrated(trackerProjection, trackerTicket.blockedBy) ||
    !hasPinnedCapabilities(workstream, node.id)
  ) {
    return null;
  }

  return {
    workstreamId: workstream.workstreamId,
    originThreadId: workstream.originThreadId,
    ticketNodeId: node.id,
    actionIdentity: CommandId.make(
      `workflow-frontier:${workstream.workflowRun.dispatchIdentity}:${node.id}`,
    ),
    expectedWorkstreamVersion: workstream.workflowVersion ?? 0,
  };
}

function sortedWorkstreams(
  workstreams: ReadonlyArray<WorkflowSchedulerWorkstream>,
): ReadonlyArray<WorkflowSchedulerWorkstream> {
  return [...workstreams].toSorted((left, right) =>
    left.workstreamId.localeCompare(right.workstreamId),
  );
}

export function selectWorkflowTicketFrontier(input: {
  readonly workstreams: ReadonlyArray<WorkflowSchedulerWorkstream>;
  readonly lastServedWorkstreamId?: WorkstreamId | null;
}): WorkflowTicketFrontierSelection {
  const workstreams = sortedWorkstreams(input.workstreams);
  if (workstreams.length === 0) {
    return { dispatches: [], nextLastServedWorkstreamId: null };
  }

  const environmentCapacity = Math.min(
    ...workstreams.map(
      (workstream) => workstream.workflowRun.configuration.environmentAutomationCapacity,
    ),
  );
  const activeCount = workstreams.reduce(
    (count, workstream) =>
      count +
      workstream.implementations.filter((implementation) =>
        activeStatuses.has(implementation.status),
      ).length +
      (workstream.activeProviderRuns ?? 0),
    0,
  );
  const availableSlots = Math.max(0, environmentCapacity - activeCount);
  if (availableSlots === 0) {
    return {
      dispatches: [],
      nextLastServedWorkstreamId: input.lastServedWorkstreamId ?? null,
    };
  }

  const candidates = workstreams.map((workstream) => ({
    workstream,
    values: workstream.workflowGraph.nodes
      .toSorted((left, right) => left.id.localeCompare(right.id))
      .map((node) => candidateNode(workstream, node))
      .filter((candidate): candidate is WorkflowTicketFrontierDispatch => candidate !== null)
      .filter(
        (candidate) =>
          !workstream.implementations.some(
            (implementation) => implementation.nodeId === candidate.ticketNodeId,
          ),
      ),
    activeCount:
      workstream.implementations.filter((implementation) =>
        activeStatuses.has(implementation.status),
      ).length + (workstream.activeProviderRuns ?? 0),
    nextIndex: 0,
  }));

  const startIndex =
    input.lastServedWorkstreamId === undefined || input.lastServedWorkstreamId === null
      ? (() => {
          const userWorkstreamIndex = workstreams.findIndex((workstream) =>
            workstream.implementations.some(
              (implementation) =>
                implementation.dispatchMode === "user" && activeStatuses.has(implementation.status),
            ),
          );
          return userWorkstreamIndex < 0 ? 0 : (userWorkstreamIndex + 1) % workstreams.length;
        })()
      : Math.max(
          0,
          (workstreams.findIndex(
            (workstream) => workstream.workstreamId === input.lastServedWorkstreamId,
          ) +
            1) %
            workstreams.length,
        );
  const dispatches: Array<WorkflowTicketFrontierDispatch> = [];
  let cursor = startIndex;
  let nextLastServedWorkstreamId = input.lastServedWorkstreamId ?? null;

  while (dispatches.length < availableSlots) {
    let selectedInRound = false;
    for (let offset = 0; offset < workstreams.length; offset += 1) {
      const index = (cursor + offset) % workstreams.length;
      const group = candidates[index]!;
      const executionLimit = group.workstream.workflowRun.configuration.executionLimit;
      if (
        group.activeCount +
          dispatches.filter((dispatch) => dispatch.workstreamId === group.workstream.workstreamId)
            .length >=
        executionLimit
      ) {
        continue;
      }
      const candidate = group.values[group.nextIndex];
      if (candidate === undefined) continue;
      group.nextIndex += 1;
      dispatches.push(candidate);
      nextLastServedWorkstreamId = group.workstream.workstreamId;
      selectedInRound = true;
      if (dispatches.length >= availableSlots) break;
    }
    if (!selectedInRound) break;
    cursor =
      (workstreams.findIndex(
        (workstream) => workstream.workstreamId === nextLastServedWorkstreamId,
      ) +
        1) %
      workstreams.length;
  }

  return { dispatches, nextLastServedWorkstreamId };
}
