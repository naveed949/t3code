import {
  CommandId,
  MessageId,
  ThreadId,
  isBlockingWorkflowCodeReviewFinding,
  WORKFLOW_MAX_AUTOMATIC_CORRECTION_CYCLES,
  type OrchestrationEvent,
  type OrchestrationThread,
  type WorkflowDiffEvidence,
  type WorkflowBaselineRefresh,
  type WorkflowValidationEvidence,
  type WorkflowTrackerProjection,
  type WorkflowTicketImplementation,
  type WayfinderMapProjection,
  type WorkstreamId,
} from "@t3tools/contracts";
import {
  workflowTicketImplementationBranch,
  workflowTicketImplementationThreadId,
} from "@t3tools/shared/workflowTicketImplementation";
import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import {
  GitWorkflowService,
  type GitBaselineRefreshPreview,
} from "../../git/GitWorkflowService.ts";
import { IssueTracker } from "../../nativeSkills/IssueTracker.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBus } from "../Services/RuntimeReceiptBus.ts";
import { parseWorkflowTicketImplementationReviewResult } from "../WorkflowTicketImplementationReview.ts";
import * as Cause from "effect/Cause";
import {
  selectWorkflowTicketFrontier,
  type WorkflowSchedulerWorkstream,
  type WorkflowTicketFrontierDispatch,
} from "../WorkflowTicketFrontierScheduler.ts";
import { stableStringify } from "@t3tools/shared/relaySigning";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

type TicketImplementationRequestedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.workflow-ticket-implementation-requested" }
>;
type TicketImplementationUpdatedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.workflow-ticket-implementation-updated" }
>;
type TicketImplementationRecoveryRequestedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.workflow-ticket-implementation-recovery-requested" }
>;
type TicketImplementationCheckpointedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.workflow-ticket-implementation-checkpointed" }
>;
type SessionSetEvent = Extract<OrchestrationEvent, { type: "thread.session-set" }>;
type RevertedEvent = Extract<OrchestrationEvent, { type: "thread.reverted" }>;
type TurnStartRequestedEvent = Extract<OrchestrationEvent, { type: "thread.turn-start-requested" }>;
type WorkflowRunAutomationEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.workflow-run-started"
      | "thread.workflow-run-resumed"
      | "thread.workflow-run-draining";
  }
>;
type WorkflowBaselineRefreshRequestedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.workflow-baseline-refresh-requested" }
>;
type WorkflowBaselineRefreshUpdatedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.workflow-baseline-refresh-updated" }
>;
type WorkflowRunPausedEvent = Extract<OrchestrationEvent, { type: "thread.workflow-run-paused" }>;
type WorkflowTicketImplementationEvent =
  | TicketImplementationRequestedEvent
  | TicketImplementationUpdatedEvent
  | TicketImplementationRecoveryRequestedEvent
  | SessionSetEvent
  | RevertedEvent
  | TicketImplementationCheckpointedEvent
  | TurnStartRequestedEvent
  | WorkflowRunAutomationEvent
  | WorkflowRunPausedEvent
  | WorkflowBaselineRefreshRequestedEvent
  | WorkflowBaselineRefreshUpdatedEvent;

function implementationById(
  thread: OrchestrationThread,
  implementationId: string,
): {
  readonly originThread: OrchestrationThread;
  readonly implementation: WorkflowTicketImplementation;
} | null {
  const implementation = thread.workflowAttachment?.ticketImplementations?.find(
    (candidate) => candidate.id === implementationId,
  );
  return implementation === undefined ? null : { originThread: thread, implementation };
}

function implementationPhase(
  implementation: WorkflowTicketImplementation,
  fallback: "worktree" | "implementation" | "review" | "integration" = "implementation",
): "worktree" | "implementation" | "review" | "integration" {
  if (implementation.status === "dispatching") return "worktree";
  if (
    implementation.status === "integrating" ||
    implementation.status === "integration-failed" ||
    implementation.status === "integrated"
  ) {
    return "integration";
  }
  if (
    implementation.status === "reviewing" ||
    implementation.status === "reviewed" ||
    implementation.status === "needs-correction" ||
    (implementation.status === "needs-recovery" && implementation.recoveryPhase === "review") ||
    (implementation.status === "needs-recovery" &&
      implementation.recoveryPhase === "integration") ||
    implementation.status === "needs-decision"
  ) {
    return implementation.status === "needs-recovery" &&
      implementation.recoveryPhase === "integration"
      ? "integration"
      : "review";
  }
  return fallback;
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isIntegrationMergeConflict(error: unknown): boolean {
  return /conflict|automatic merge failed|merge failed/i.test(failureMessage(error));
}

export function baselineRefreshImpacts(
  attachment:
    | Pick<
        NonNullable<OrchestrationThread["workflowAttachment"]>,
        "ticketImplementations" | "workflowGraph"
      >
    | null
    | undefined,
  preview: GitBaselineRefreshPreview,
): WorkflowBaselineRefresh["affectedTickets"] {
  if (attachment === undefined || attachment === null) return [];
  const incomingPaths = new Set(preview.incomingFiles.map((file) => file.path));
  const impacts = new Map<string, WorkflowBaselineRefresh["affectedTickets"][number]>();
  for (const implementation of attachment.ticketImplementations ?? []) {
    if (implementation.status !== "integrated") continue;
    const changed =
      implementation.diff?.files.some((file) => incomingPaths.has(file.path)) ?? false;
    if (!changed) continue;
    impacts.set(implementation.nodeId, {
      nodeId: implementation.nodeId,
      ticketNumber: implementation.ticketNumber,
      state: "integrated",
      reason: "Incoming baseline commits overlap the integrated Ticket diff.",
    });
  }
  for (const node of attachment.workflowGraph?.nodes ?? []) {
    if (node.kind !== "ticket" || node.state !== "stale") continue;
    impacts.set(node.id, {
      nodeId: node.id,
      ticketNumber: node.ticketNumber,
      state: "stale",
      reason: "The Ticket is already stale and must remain visible during refresh.",
    });
  }
  return [...impacts.values()].toSorted((left, right) => left.ticketNumber - right.ticketNumber);
}

function trackerProjectionFromMap(input: {
  readonly map: WayfinderMapProjection;
  readonly previous: WorkflowTrackerProjection;
  readonly synchronizedAt: string;
}): WorkflowTrackerProjection {
  const previousByNumber = new Map(
    input.previous.tickets.map((ticket) => [ticket.number, ticket] as const),
  );
  const mapByNumber = new Map(input.map.tickets.map((ticket) => [ticket.number, ticket] as const));
  return {
    status: "healthy",
    canonicalReference: {
      number: input.map.canonicalReference.number,
      title: input.map.canonicalReference.title,
      url: input.map.canonicalReference.url,
      state: input.map.canonicalReference.state,
    },
    ...(input.map.revision !== undefined
      ? { revision: input.map.revision }
      : input.previous.revision !== undefined
        ? { revision: input.previous.revision }
        : {}),
    ...(input.previous.batchId !== undefined ? { batchId: input.previous.batchId } : {}),
    tickets: input.map.tickets.map((ticket) => {
      const previous = previousByNumber.get(ticket.number);
      return {
        key: previous?.key ?? null,
        number: ticket.number,
        title: ticket.title,
        url: ticket.url,
        state: ticket.state,
        ...(previous?.body !== undefined ? { body: previous.body } : {}),
        parentNumber: previous?.parentNumber ?? input.map.canonicalReference.number,
        blockedBy: ticket.blockedBy.filter((number) => mapByNumber.get(number)?.state !== "closed"),
        blocks: ticket.blocks,
        includedInRun: previous?.includedInRun ?? false,
      };
    }),
    synchronizedAt: input.synchronizedAt,
  };
}

function correctionCycleNumber(implementation: WorkflowTicketImplementation): number {
  return implementation.correctionCycles?.at(-1)?.cycle ?? 0;
}

function implementationMessage(
  implementation: WorkflowTicketImplementation,
  phase: "implementation" | "review" | "repair",
): string {
  if (phase === "repair") {
    const baselineBranch = implementation.integration?.baselineBranch ?? "the Workstream Baseline";
    return [
      `Run the pinned /implement child as the single automatic Integration Repair Run for ticket #${implementation.ticketNumber}.`,
      `The Workstream Baseline merge conflicted. In the existing ticket worktree, merge ${baselineBranch} into the ticket branch, resolve only the conflicts caused by the current baseline drift, preserve the original ticket scope, and commit the repaired result.`,
      "Do not start a second repair run or rewrite the Workstream Baseline. The repaired combined diff must pass focused validation and the pinned /code-review child before integration continues.",
      implementation.acceptanceCriteria,
    ].join("\n\n");
  }
  if (phase === "review") {
    return [
      `Run the pinned /code-review child for ticket #${implementation.ticketNumber}.`,
      `Review the current worktree changes against the original Fixed Point ${implementation.fixedPoint}.`,
      "Only structured review evidence may complete this gate; prose alone is not workflow authority.",
      "Finish with exactly one result wrapped in <t3-ticket-implementation-review-result> tags.",
      `The JSON shape is {"status":"passed"|"must-fix","summary":"...","findings":[{"severity":"must-fix"|"suggestion","source":"repository-standards"|"ticket-specification","summary":"...","file":"optional","line":1}],"validation":[{"name":"...","status":"passed"|"failed"|"not-run","command":"optional","detail":"optional"}]}.`,
    ].join("\n\n");
  }
  const correction = implementation.correctionCycles?.at(-1);
  return [
    correction === undefined
      ? `Implement ticket #${implementation.ticketNumber} against Fixed Point ${implementation.fixedPoint}.`
      : `Run Correction Cycle ${correction.cycle} for ticket #${implementation.ticketNumber} in the existing ticket worktree against Fixed Point ${implementation.fixedPoint}.`,
    "",
    implementation.acceptanceCriteria,
    ...(correction === undefined
      ? []
      : [
          "",
          "Correct only these verified Must-Fix Findings:",
          ...correction.findings.map(
            (finding) =>
              `- [${finding.source ?? "unclassified"}] ${finding.summary}${finding.file ? ` (${finding.file}${finding.line ? `:${finding.line}` : ""})` : ""}`,
          ),
        ]),
    "",
    "The pinned /code-review child is required before this Ticket Implementation can be marked reviewed.",
  ].join("\n");
}

const workflowStageSkills = new Set(["wayfinder", "to-spec", "to-tickets"]);

function isCountableProviderTurn(thread: OrchestrationThread): boolean {
  if (thread.latestTurn === null || thread.latestTurn === undefined) return false;
  if (
    thread.latestTurn?.skillInvocation?.skill.name !== undefined &&
    workflowStageSkills.has(thread.latestTurn.skillInvocation.skill.name)
  ) {
    return false;
  }
  return (
    thread.latestTurn?.state === "running" ||
    thread.session?.status === "starting" ||
    thread.session?.status === "running"
  );
}

export const makeWorkflowTicketImplementationProcessor = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const git = yield* GitWorkflowService;
  const tracker = yield* IssueTracker;
  const receipts = yield* RuntimeReceiptBus;
  let lastServedWorkstreamId: WorkstreamId | null = null;

  const resolveIntegrationWorkspace = Effect.fn(
    "WorkflowTicketImplementationReactor.resolveIntegrationWorkspace",
  )(function* (input: { readonly cwd: string; readonly baselineBranch: string }) {
    const refsResult = yield* git
      .listRefs({
        cwd: input.cwd,
        query: input.baselineBranch,
        includeMatchingRemoteRefs: false,
        refKind: "local",
        refresh: true,
      })
      .pipe(Effect.result);
    if (Result.isFailure(refsResult)) return null;
    const baselineRef = refsResult.success.refs.find((ref) => ref.name === input.baselineBranch);
    if (baselineRef === undefined) return null;
    if (baselineRef.worktreePath !== null) return baselineRef.worktreePath;
    const worktreeResult = yield* git
      .createWorktree({ cwd: input.cwd, refName: input.baselineBranch, path: null })
      .pipe(Effect.result);
    return Result.isSuccess(worktreeResult) ? worktreeResult.success.worktree.path : null;
  });

  const serverCommandId = Effect.fn("WorkflowTicketImplementationReactor.serverCommandId")(
    function* (tag: string) {
      return CommandId.make(`server:${tag}:${yield* crypto.randomUUIDv4}`);
    },
  );

  const publishProgress = Effect.fn("WorkflowTicketImplementationReactor.publishProgress")(
    function* (input: {
      readonly implementation: WorkflowTicketImplementation;
      readonly message: string | null;
      readonly phase?: "worktree" | "implementation" | "review" | "integration";
    }) {
      yield* receipts.publish({
        type: "workflow.ticket-implementation.progress",
        threadId: input.implementation.originThreadId,
        ticketNodeId: input.implementation.nodeId,
        implementationId: input.implementation.id,
        actionIdentity: input.implementation.actionIdentity,
        phase: input.phase ?? implementationPhase(input.implementation),
        status: input.implementation.status,
        createdAt: input.implementation.updatedAt,
        message: input.message,
      });
    },
  );

  const publishBaselineRefreshProgress = Effect.fn(
    "WorkflowTicketImplementationReactor.publishBaselineRefreshProgress",
  )(function* (input: {
    readonly threadId: ThreadId;
    readonly baselineRefresh: WorkflowBaselineRefresh;
    readonly message: string | null;
  }) {
    yield* receipts.publish({
      type: "workflow.baseline-refresh.progress",
      threadId: input.threadId,
      status: input.baselineRefresh.status,
      createdAt: input.baselineRefresh.updatedAt,
      message: input.message,
    });
  });

  const scheduleFrontier = Effect.fn("WorkflowTicketImplementationReactor.scheduleFrontier")(
    function* (input: { readonly createdAt: string }) {
      const snapshot = yield* snapshots.getSnapshot();
      const implementationThreadIds = new Set(
        snapshot.threads.flatMap(
          (thread) =>
            thread.workflowAttachment?.ticketImplementations
              ?.map((implementation) => implementation.implementationThreadId)
              .filter((threadId): threadId is ThreadId => threadId !== null) ?? [],
        ),
      );
      const workstreams: Array<WorkflowSchedulerWorkstream> = snapshot.threads.flatMap((thread) => {
        const attachment = thread.workflowAttachment;
        if (
          attachment?.originThreadId !== thread.id ||
          attachment.workflowRun === undefined ||
          attachment.workflowGraph === undefined
        ) {
          return [];
        }
        const trackerProjection =
          attachment.trackerProjection ?? attachment.ticketingStage?.trackerProjection;
        const activeProviderRuns = snapshot.threads.filter((candidate) => {
          if (implementationThreadIds.has(candidate.id)) return false;
          if (!isCountableProviderTurn(candidate)) return false;
          return (
            candidate.id === thread.id ||
            candidate.latestTurn?.skillInvocation?.reconnectWorkstreamId === attachment.workstreamId
          );
        }).length;
        return [
          {
            workstreamId: attachment.workstreamId,
            originThreadId: thread.id,
            workflowRun: attachment.workflowRun,
            workflowGraph: attachment.workflowGraph,
            ...(trackerProjection === undefined ? {} : { trackerProjection }),
            isolationAvailable:
              resolveThreadWorkspaceCwd({ thread, projects: snapshot.projects }) !== undefined,
            implementations: (attachment.ticketImplementations ?? []).map((implementation) => ({
              nodeId: implementation.nodeId,
              status: implementation.status,
              ...(implementation.recoveryPhase === undefined
                ? {}
                : { recoveryPhase: implementation.recoveryPhase }),
              ...(implementation.dispatchMode === undefined
                ? {}
                : { dispatchMode: implementation.dispatchMode }),
            })),
            activeProviderRuns,
            ...(attachment.workflowVersion === undefined
              ? {}
              : { workflowVersion: attachment.workflowVersion }),
          },
        ];
      });

      for (const workstream of workstreams) {
        if (
          workstream.workflowRun.automationStatus === "draining" &&
          !workstream.implementations.some(
            (implementation) =>
              ["dispatching", "implementing", "reviewing", "stopping", "integrating"].includes(
                implementation.status,
              ) ||
              (implementation.status === "needs-recovery" &&
                implementation.recoveryPhase === "integration"),
          )
        ) {
          yield* orchestrationEngine.dispatch({
            type: "thread.workflow.run.drain.complete",
            commandId: CommandId.make(
              [
                "server",
                "workflow-run",
                workstream.workflowRun.dispatchIdentity,
                "drain",
                String(workstream.workflowVersion ?? 0),
              ].join(":"),
            ),
            threadId: workstream.originThreadId,
            expectedWorkstreamVersion: workstream.workflowVersion ?? 0,
            createdAt: input.createdAt,
          });
        }
      }

      const selection = selectWorkflowTicketFrontier({
        workstreams,
        lastServedWorkstreamId,
      });
      lastServedWorkstreamId = selection.nextLastServedWorkstreamId;
      const scheduled: Array<WorkflowTicketFrontierDispatch> = [];
      for (const dispatch of selection.dispatches) {
        const currentSnapshot = yield* snapshots.getSnapshot();
        const currentAttachment = currentSnapshot.threads.find(
          (thread) => thread.id === dispatch.originThreadId,
        )?.workflowAttachment;
        if (currentAttachment?.workflowRun?.automationStatus !== "running") continue;
        const dispatchResult = yield* orchestrationEngine
          .dispatch({
            type: "thread.workflow.ticket-implementation.start",
            commandId: CommandId.make(
              ["server", "workflow-frontier", dispatch.actionIdentity].join(":"),
            ),
            threadId: dispatch.originThreadId,
            ticketNodeId: dispatch.ticketNodeId,
            actionIdentity: dispatch.actionIdentity,
            expectedWorkstreamVersion: currentAttachment.workflowVersion ?? 0,
            dispatchMode: "automatic",
            confirmed: true,
            createdAt: input.createdAt,
          })
          .pipe(Effect.result);
        if (Result.isFailure(dispatchResult)) {
          yield* receipts.publish({
            type: "workflow.ticket-frontier.dispatch-failed",
            workstreamId: dispatch.workstreamId,
            ticketNodeId: dispatch.ticketNodeId,
            actionIdentity: dispatch.actionIdentity,
            createdAt: input.createdAt,
            message: String(dispatchResult.failure),
          });
          continue;
        }
        scheduled.push(dispatch);
      }

      const ticketNodeIdsByWorkstream = new Map<WorkstreamId, Array<string>>();
      for (const dispatch of scheduled) {
        const nodeIds = ticketNodeIdsByWorkstream.get(dispatch.workstreamId) ?? [];
        nodeIds.push(dispatch.ticketNodeId);
        ticketNodeIdsByWorkstream.set(dispatch.workstreamId, nodeIds);
      }
      for (const [workstreamId, ticketNodeIds] of ticketNodeIdsByWorkstream) {
        yield* receipts.publish({
          type: "workflow.ticket-frontier.scheduled",
          workstreamId,
          ticketNodeIds,
          createdAt: input.createdAt,
        });
      }
    },
  );

  const updateImplementation = Effect.fn(
    "WorkflowTicketImplementationReactor.updateImplementation",
  )(function* (input: {
    readonly implementationId: string;
    readonly patch: Partial<WorkflowTicketImplementation>;
    readonly trackerProjection?: WorkflowTrackerProjection;
  }) {
    const snapshot = yield* snapshots.getSnapshot();
    const originThread = snapshot.threads.find((thread) =>
      thread.workflowAttachment?.ticketImplementations?.some(
        (implementation) => implementation.id === input.implementationId,
      ),
    );
    const current = originThread?.workflowAttachment?.ticketImplementations?.find(
      (implementation) => implementation.id === input.implementationId,
    );
    const attachment = originThread?.workflowAttachment;
    if (originThread === undefined || current === undefined || attachment === undefined) {
      return null;
    }
    const next: WorkflowTicketImplementation = {
      ...current,
      ...input.patch,
      id: current.id,
      originThreadId: current.originThreadId,
      updatedAt: input.patch.updatedAt ?? current.updatedAt,
    };
    if (stableStringify(next) === stableStringify(current)) return current;
    yield* orchestrationEngine.dispatch({
      type: "thread.workflow.ticket-implementation.update",
      commandId: yield* serverCommandId("ticket-implementation-update"),
      threadId: originThread.id,
      implementationId: current.id,
      implementation: next,
      ...(input.trackerProjection !== undefined
        ? { trackerProjection: input.trackerProjection }
        : {}),
      expectedWorkstreamVersion: attachment.workflowVersion ?? 0,
      createdAt: next.updatedAt,
    });
    return next;
  });

  const updateBaselineRefresh = Effect.fn(
    "WorkflowTicketImplementationReactor.updateBaselineRefresh",
  )(function* (input: {
    readonly threadId: ThreadId;
    readonly baselineRefresh: WorkflowBaselineRefresh;
    readonly staleNodeIds?: ReadonlyArray<string>;
  }) {
    const snapshot = yield* snapshots.getSnapshot();
    const thread = snapshot.threads.find((candidate) => candidate.id === input.threadId);
    const attachment = thread?.workflowAttachment;
    if (thread === undefined || attachment === undefined) return;
    yield* orchestrationEngine.dispatch({
      type: "thread.workflow.baseline-refresh.update",
      commandId: yield* serverCommandId("baseline-refresh-update"),
      threadId: input.threadId,
      baselineRefresh: input.baselineRefresh,
      ...(input.staleNodeIds === undefined ? {} : { staleNodeIds: input.staleNodeIds }),
      expectedWorkstreamVersion: attachment.workflowVersion ?? 0,
      createdAt: input.baselineRefresh.updatedAt,
    });
  });

  const processBaselineRefreshRequested = Effect.fn(
    "WorkflowTicketImplementationReactor.processBaselineRefreshRequested",
  )(function* (event: WorkflowBaselineRefreshRequestedEvent) {
    const requested = event.payload.attachment.baselineRefresh;
    if (requested === undefined || requested.status !== "previewing") return;
    const snapshot = yield* snapshots.getSnapshot();
    const originThread = snapshot.threads.find((thread) => thread.id === event.payload.threadId);
    if (originThread === undefined) return;
    yield* publishBaselineRefreshProgress({
      threadId: originThread.id,
      baselineRefresh: requested,
      message: "Previewing incoming baseline commits and affected integrated tickets.",
    });
    const failed = (failure: string): WorkflowBaselineRefresh => ({
      ...requested,
      status: "needs-recovery",
      failure,
      updatedAt: event.occurredAt,
    });
    const cwd = resolveThreadWorkspaceCwd({
      thread: originThread,
      projects: snapshot.projects,
    });
    if (cwd === undefined) {
      const baselineRefresh = failed("The Origin Thread has no resolvable project workspace.");
      yield* updateBaselineRefresh({
        threadId: originThread.id,
        baselineRefresh,
      });
      yield* publishBaselineRefreshProgress({
        threadId: originThread.id,
        baselineRefresh,
        message: baselineRefresh.failure,
      });
      return;
    }
    const integrationCwd = yield* resolveIntegrationWorkspace({
      cwd,
      baselineBranch: requested.baselineBranch,
    });
    if (integrationCwd === null) {
      const baselineRefresh = failed(
        `The Workstream Baseline ${requested.baselineBranch} has no dedicated integration workspace.`,
      );
      yield* updateBaselineRefresh({
        threadId: originThread.id,
        baselineRefresh,
      });
      yield* publishBaselineRefreshProgress({
        threadId: originThread.id,
        baselineRefresh,
        message: baselineRefresh.failure,
      });
      return;
    }
    const previewResult = yield* git
      .previewBaselineRefresh({
        cwd: integrationCwd,
        baselineBranch: requested.baselineBranch,
        remoteTarget: requested.remoteTarget,
      })
      .pipe(Effect.result);
    if (Result.isFailure(previewResult)) {
      const baselineRefresh = failed(failureMessage(previewResult.failure));
      yield* updateBaselineRefresh({
        threadId: originThread.id,
        baselineRefresh,
      });
      yield* publishBaselineRefreshProgress({
        threadId: originThread.id,
        baselineRefresh,
        message: baselineRefresh.failure,
      });
      return;
    }
    const preview = previewResult.success;
    const baselineRefresh: WorkflowBaselineRefresh = {
      ...requested,
      status: "ready",
      currentCommit: preview.currentCommit,
      sourceCommit: preview.sourceCommit,
      incomingCommits: preview.incomingCommits,
      incomingFiles: preview.incomingFiles,
      affectedTickets: baselineRefreshImpacts(originThread.workflowAttachment, preview),
      validations: [],
      failure: null,
      updatedAt: event.occurredAt,
    };
    yield* updateBaselineRefresh({
      threadId: originThread.id,
      baselineRefresh,
    });
    yield* publishBaselineRefreshProgress({
      threadId: originThread.id,
      baselineRefresh,
      message: `Preview ready: ${preview.incomingCommits.length} incoming commit${preview.incomingCommits.length === 1 ? "" : "s"}.`,
    });
  });

  const processBaselineRefresh = Effect.fn(
    "WorkflowTicketImplementationReactor.processBaselineRefresh",
  )(function* (event: WorkflowRunPausedEvent) {
    const requested = event.payload.attachment.baselineRefresh;
    if (requested === undefined || requested.status !== "refreshing") return;
    const snapshot = yield* snapshots.getSnapshot();
    const originThread = snapshot.threads.find((thread) => thread.id === event.payload.threadId);
    if (originThread === undefined) return;
    yield* publishBaselineRefreshProgress({
      threadId: originThread.id,
      baselineRefresh: requested,
      message: "Drained active work; refreshing the confirmed baseline.",
    });
    const failed = (
      failure: string,
      validations = requested.validations,
    ): WorkflowBaselineRefresh => ({
      ...requested,
      status: "needs-recovery",
      validations,
      failure,
      updatedAt: event.occurredAt,
    });
    const cwd = resolveThreadWorkspaceCwd({
      thread: originThread,
      projects: snapshot.projects,
    });
    if (cwd === undefined) {
      const baselineRefresh = failed("The Origin Thread has no resolvable project workspace.");
      yield* updateBaselineRefresh({
        threadId: originThread.id,
        baselineRefresh,
      });
      yield* publishBaselineRefreshProgress({
        threadId: originThread.id,
        baselineRefresh,
        message: baselineRefresh.failure,
      });
      return;
    }
    const integrationCwd = yield* resolveIntegrationWorkspace({
      cwd,
      baselineBranch: requested.baselineBranch,
    });
    if (integrationCwd === null) {
      const baselineRefresh = failed(
        `The Workstream Baseline ${requested.baselineBranch} has no dedicated integration workspace.`,
      );
      yield* updateBaselineRefresh({
        threadId: originThread.id,
        baselineRefresh,
      });
      yield* publishBaselineRefreshProgress({
        threadId: originThread.id,
        baselineRefresh,
        message: baselineRefresh.failure,
      });
      return;
    }
    if (requested.sourceCommit === null) {
      const baselineRefresh = failed(
        "The Baseline Refresh has no confirmed source commit; no baseline update was attempted.",
      );
      yield* updateBaselineRefresh({
        threadId: originThread.id,
        baselineRefresh,
      });
      yield* publishBaselineRefreshProgress({
        threadId: originThread.id,
        baselineRefresh,
        message: baselineRefresh.failure,
      });
      return;
    }
    const refreshResult = yield* git
      .refreshBaseline({
        cwd: integrationCwd,
        baselineBranch: requested.baselineBranch,
        remoteTarget: requested.remoteTarget,
        expectedSourceCommit: requested.sourceCommit,
      })
      .pipe(Effect.result);
    if (Result.isFailure(refreshResult)) {
      const baselineRefresh = failed(failureMessage(refreshResult.failure));
      yield* updateBaselineRefresh({
        threadId: originThread.id,
        baselineRefresh,
      });
      yield* publishBaselineRefreshProgress({
        threadId: originThread.id,
        baselineRefresh,
        message: baselineRefresh.failure,
      });
      return;
    }

    const validations: Array<WorkflowBaselineRefresh["validations"][number]> = [];
    const staleNodeIds: string[] = [];
    let validationFailure: string | null = null;
    for (const impact of requested.affectedTickets) {
      if (impact.state !== "integrated") continue;
      const implementation = (originThread.workflowAttachment?.ticketImplementations ?? []).find(
        (candidate) => candidate.nodeId === impact.nodeId && candidate.status === "integrated",
      );
      if (implementation === undefined) {
        const detail = `Integrated Ticket #${impact.ticketNumber} has no retained implementation evidence.`;
        validations.push({
          nodeId: impact.nodeId,
          status: "failed",
          detail,
          recordedAt: event.occurredAt,
        });
        staleNodeIds.push(impact.nodeId);
        validationFailure ??= detail;
        continue;
      }
      const validationResult = yield* git
        .validateIntegration({
          cwd: integrationCwd,
          fixedPoint: implementation.fixedPoint,
        })
        .pipe(Effect.result);
      if (Result.isFailure(validationResult)) {
        const detail = failureMessage(validationResult.failure);
        validations.push({
          nodeId: impact.nodeId,
          status: "failed",
          detail,
          recordedAt: event.occurredAt,
        });
        staleNodeIds.push(impact.nodeId);
        validationFailure ??= detail;
      } else {
        validations.push({
          nodeId: impact.nodeId,
          status: "passed",
          detail: `Revalidated the integrated Ticket against ${requested.baselineBranch} at ${refreshResult.success.commitSha}.`,
          recordedAt: event.occurredAt,
        });
      }
    }
    const baselineRefresh: WorkflowBaselineRefresh = {
      ...requested,
      status: validationFailure === null ? "completed" : "needs-recovery",
      currentCommit: refreshResult.success.commitSha,
      validations,
      failure: validationFailure,
      updatedAt: event.occurredAt,
    };
    yield* updateBaselineRefresh({
      threadId: originThread.id,
      baselineRefresh,
      ...(staleNodeIds.length === 0 ? {} : { staleNodeIds }),
    });
    yield* publishBaselineRefreshProgress({
      threadId: originThread.id,
      baselineRefresh,
      message:
        baselineRefresh.status === "completed"
          ? `Baseline refreshed at ${refreshResult.success.commitSha}; ${validations.length} affected Ticket validation${validations.length === 1 ? "" : "s"} recorded.`
          : baselineRefresh.failure,
    });
  });

  const worktreeForImplementation = Effect.fn(
    "WorkflowTicketImplementationReactor.worktreeForImplementation",
  )(function* (input: {
    readonly cwd: string;
    readonly implementation: WorkflowTicketImplementation;
  }) {
    const branch =
      input.implementation.branch ??
      workflowTicketImplementationBranch({
        ticketNumber: input.implementation.ticketNumber,
        actionIdentity: input.implementation.actionIdentity,
      });
    const refs = yield* git.listRefs({
      cwd: input.cwd,
      query: branch,
      refKind: "local",
      includeMatchingRemoteRefs: false,
    });
    const existing = refs.refs.find(
      (ref) => ref.name === branch && ref.worktreePath !== null,
    )?.worktreePath;
    if (existing !== undefined && existing !== null) {
      return { branch, path: existing };
    }
    const worktree = yield* git.createWorktree({
      cwd: input.cwd,
      refName: refs.refs.some((ref) => ref.name === branch)
        ? branch
        : input.implementation.fixedPoint,
      ...(refs.refs.some((ref) => ref.name === branch) ? {} : { newRefName: branch }),
      baseRefName: input.implementation.fixedPoint,
      path: null,
    });
    return { branch, path: worktree.worktree.path };
  });

  const ensureImplementationThread = Effect.fn(
    "WorkflowTicketImplementationReactor.ensureImplementationThread",
  )(function* (input: {
    readonly originThread: OrchestrationThread;
    readonly implementation: WorkflowTicketImplementation;
  }) {
    const snapshot = yield* snapshots.getSnapshot();
    const threadId =
      input.implementation.implementationThreadId ??
      ThreadId.make(
        workflowTicketImplementationThreadId({
          workstreamId: input.implementation.workstreamId,
          ticketNumber: input.implementation.ticketNumber,
          actionIdentity: input.implementation.actionIdentity,
        }),
      );
    const existing = snapshot.threads.find((thread) => thread.id === threadId);
    if (existing === undefined) {
      yield* orchestrationEngine.dispatch({
        type: "thread.create",
        commandId: yield* serverCommandId("ticket-implementation-thread-create"),
        threadId,
        projectId: input.originThread.projectId,
        title: `Implement #${input.implementation.ticketNumber}: ${input.implementation.title}`,
        modelSelection: {
          ...input.originThread.modelSelection,
          instanceId: input.implementation.providerInstanceId,
        },
        runtimeMode: input.originThread.runtimeMode,
        interactionMode: input.originThread.interactionMode,
        branch: input.implementation.branch,
        worktreePath: input.implementation.worktreePath,
        createdAt: input.implementation.updatedAt,
      });
    } else if (
      existing.worktreePath !== input.implementation.worktreePath ||
      existing.branch !== input.implementation.branch
    ) {
      yield* orchestrationEngine.dispatch({
        type: "thread.meta.update",
        commandId: yield* serverCommandId("ticket-implementation-thread-meta"),
        threadId,
        expectedBranch: existing.branch,
        branch: input.implementation.branch,
        worktreePath: input.implementation.worktreePath,
      });
    }
    return threadId;
  });

  const startSkillTurn = Effect.fn("WorkflowTicketImplementationReactor.startSkillTurn")(
    function* (input: {
      readonly originThread: OrchestrationThread;
      readonly implementation: WorkflowTicketImplementation;
      readonly phase: "implementation" | "review" | "repair";
    }) {
      const threadId = input.implementation.implementationThreadId;
      if (threadId === null) return null;
      const snapshot = yield* snapshots.getSnapshot();
      const thread = snapshot.threads.find((candidate) => candidate.id === threadId);
      const cycle = correctionCycleNumber(input.implementation);
      const recordedSkillRunId =
        input.phase === "implementation"
          ? input.implementation.implementationSkillRunId
          : input.phase === "repair"
            ? (input.implementation.integration?.repair?.skillRunId ?? null)
            : input.implementation.reviewSkillRunId;
      if (recordedSkillRunId !== null) return recordedSkillRunId;
      const expectedSkill =
        input.phase === "implementation" || input.phase === "repair"
          ? input.implementation.implementSkill
          : input.implementation.reviewSkill;
      const latestTurn = thread?.latestTurn;
      if (
        cycle === 0 &&
        input.phase !== "repair" &&
        latestTurn !== null &&
        latestTurn !== undefined &&
        latestTurn.skillInvocation?.skill.name === expectedSkill.name &&
        latestTurn.skillInvocation.skill.path === expectedSkill.path &&
        latestTurn.state !== "error" &&
        latestTurn.state !== "interrupted"
      ) {
        return latestTurn.skillInvocation.skillRunId;
      }
      const recoveryAttempt = input.implementation.recoveryAttempt ?? 0;
      const cycleSuffix = cycle === 0 ? "" : `:cycle-${cycle}`;
      const recoverySuffix = recoveryAttempt === 0 ? "" : `:recovery-${recoveryAttempt}`;
      const messageId = MessageId.make(
        `${input.implementation.id}:message:${input.phase}${cycleSuffix}${recoverySuffix}`,
      );
      const commandId = CommandId.make(
        `server:ticket-implementation:${input.implementation.id}:${input.phase}:turn-start${cycleSuffix}${recoverySuffix}`,
      );
      yield* orchestrationEngine.dispatch({
        type: "thread.turn.start",
        commandId,
        threadId,
        message: {
          messageId,
          role: "user",
          text: implementationMessage(input.implementation, input.phase),
          attachments: [],
        },
        modelSelection: {
          ...(thread?.modelSelection ?? input.originThread.modelSelection),
          instanceId: input.implementation.providerInstanceId,
        },
        runtimeMode: thread?.runtimeMode ?? input.originThread.runtimeMode,
        interactionMode: thread?.interactionMode ?? input.originThread.interactionMode,
        skillInvocation: {
          skill: expectedSkill,
          execution: { mode: "generic", reason: "unregistered-skill" },
          reconnectWorkstreamId: input.implementation.workstreamId,
        },
        createdAt: input.implementation.updatedAt,
      });
      const afterStart = yield* snapshots.getSnapshot();
      if (cycle > 0) return null;
      return (
        afterStart.threads.find((candidate) => candidate.id === threadId)?.latestTurn
          ?.skillInvocation?.skillRunId ?? null
      );
    },
  );

  const startCorrectionImplementation = Effect.fn(
    "WorkflowTicketImplementationReactor.startCorrectionImplementation",
  )(function* (input: {
    readonly originThread: OrchestrationThread;
    readonly implementation: WorkflowTicketImplementation;
  }) {
    if (
      input.implementation.status !== "implementing" ||
      (input.implementation.correctionCycles?.length ?? 0) === 0 ||
      input.implementation.implementationSkillRunId !== null
    ) {
      return;
    }
    const skillRunId = yield* startSkillTurn({
      originThread: input.originThread,
      implementation: input.implementation,
      phase: "implementation",
    });
    const updated = yield* updateImplementation({
      implementationId: input.implementation.id,
      patch: {
        ...(skillRunId !== null ? { implementationSkillRunId: skillRunId } : {}),
        updatedAt: input.implementation.updatedAt,
      },
    });
    if (updated !== null) {
      yield* publishProgress({
        implementation: updated,
        message: `Correction Cycle ${input.implementation.correctionCycles?.at(-1)?.cycle ?? 0} dispatched in the existing ticket worktree.`,
        phase: "implementation",
      });
    }
  });

  const processRequested = Effect.fn("WorkflowTicketImplementationReactor.processRequested")(
    function* (event: TicketImplementationRequestedEvent) {
      const snapshot = yield* snapshots.getSnapshot();
      const originThread = snapshot.threads.find((thread) => thread.id === event.payload.threadId);
      const implementation = originThread
        ? implementationById(originThread, event.payload.implementation.id)?.implementation
        : undefined;
      if (originThread === undefined || implementation === undefined) return;
      if (
        implementation.status !== "dispatching" ||
        implementation.implementationThreadId !== null ||
        implementation.implementationSkillRunId !== null
      ) {
        yield* publishProgress({
          implementation,
          message: "Existing Ticket Implementation retained; no duplicate run was created.",
        });
        return;
      }
      const cwd = resolveThreadWorkspaceCwd({
        thread: originThread,
        projects: snapshot.projects,
      });
      if (cwd === undefined) {
        const failed = yield* updateImplementation({
          implementationId: implementation.id,
          patch: {
            status: "failed",
            failure: "The Origin Thread has no resolvable project workspace.",
            updatedAt: event.payload.createdAt,
          },
        });
        if (failed) yield* publishProgress({ implementation: failed, message: failed.failure });
        return;
      }
      const worktree =
        implementation.worktreePath === null
          ? yield* worktreeForImplementation({ cwd, implementation })
          : { branch: implementation.branch!, path: implementation.worktreePath };
      const implementing = yield* updateImplementation({
        implementationId: implementation.id,
        patch: {
          status: "implementing",
          branch: worktree.branch,
          worktreePath: worktree.path,
          failure: null,
          updatedAt: event.payload.createdAt,
        },
      });
      if (implementing === null) return;
      const threadId = yield* ensureImplementationThread({
        originThread,
        implementation: implementing,
      });
      const withThread = yield* updateImplementation({
        implementationId: implementing.id,
        patch: {
          implementationThreadId: threadId,
          updatedAt: event.payload.createdAt,
        },
      });
      if (withThread === null) return;
      const skillRunId = yield* startSkillTurn({
        originThread,
        implementation: withThread,
        phase: "implementation",
      });
      const updated = yield* updateImplementation({
        implementationId: withThread.id,
        patch: {
          status: "implementing",
          ...(skillRunId !== null ? { implementationSkillRunId: skillRunId } : {}),
          updatedAt: event.payload.createdAt,
        },
      });
      if (updated !== null) {
        yield* publishProgress({
          implementation: updated,
          message: "Pinned /implement dispatched in the isolated ticket worktree.",
        });
      }
    },
  );

  const processSessionSet = Effect.fn("WorkflowTicketImplementationReactor.processSessionSet")(
    function* (event: SessionSetEvent) {
      const snapshot = yield* snapshots.getSnapshot();
      const originThread = snapshot.threads.find((thread) =>
        thread.workflowAttachment?.ticketImplementations?.some(
          (implementation) => implementation.implementationThreadId === event.payload.threadId,
        ),
      );
      const implementation = originThread?.workflowAttachment?.ticketImplementations?.find(
        (candidate) => candidate.implementationThreadId === event.payload.threadId,
      );
      const implementationThread = snapshot.threads.find(
        (thread) => thread.id === event.payload.threadId,
      );
      if (
        originThread === undefined ||
        implementation === undefined ||
        implementationThread === undefined
      ) {
        return;
      }
      const terminal = ["error", "stopped", "interrupted"].includes(event.payload.session.status);
      const integrationRepairRunning = implementation.integration?.repair?.status === "running";
      if (
        terminal &&
        (implementation.status === "implementing" ||
          implementation.status === "reviewing" ||
          implementation.status === "stopping" ||
          integrationRepairRunning)
      ) {
        const readyCheckpoints = implementationThread.checkpoints.filter(
          (checkpoint) => checkpoint.status === "ready",
        );
        const latestCheckpointTurnCount = readyCheckpoints.reduce(
          (maxTurnCount, checkpoint) => Math.max(maxTurnCount, checkpoint.checkpointTurnCount),
          0,
        );
        const recoveryPhase = integrationRepairRunning
          ? "integration"
          : (implementation.recoveryPhase ??
            (implementation.status === "reviewing" ? "review" : "implementation"));
        const failed = yield* updateImplementation({
          implementationId: implementation.id,
          patch: {
            status: "needs-recovery",
            recoveryPhase,
            ...(integrationRepairRunning && implementation.integration?.repair !== undefined
              ? {
                  integration: {
                    ...implementation.integration,
                    status: "failed" as const,
                    failurePhase: "repair" as const,
                    failure:
                      event.payload.session.lastError ??
                      "The Integration Repair Run stopped before its review milestone.",
                    repair: {
                      ...implementation.integration.repair,
                      status: "failed" as const,
                      failure:
                        event.payload.session.lastError ??
                        "The Integration Repair Run stopped before its review milestone.",
                      updatedAt: event.payload.session.updatedAt,
                    },
                    updatedAt: event.payload.session.updatedAt,
                  },
                }
              : {}),
            ...(readyCheckpoints.length > 0
              ? { recoveryCheckpointTurnCount: latestCheckpointTurnCount }
              : {}),
            failure:
              event.payload.session.lastError ??
              "The accepted provider run stopped before the workflow milestone completed.",
            updatedAt: event.payload.session.updatedAt,
          },
        });
        if (failed) yield* publishProgress({ implementation: failed, message: failed.failure });
        return;
      }
      if (
        implementation.status === "integrating" &&
        implementation.integration?.repair?.status === "running" &&
        event.payload.session.status === "ready" &&
        implementationThread.latestTurn?.state === "completed"
      ) {
        if (implementation.worktreePath === null) {
          const failed = yield* failIntegrationRepair({
            implementation,
            failure: "The Integration Repair Run completed without a retained ticket worktree.",
            updatedAt: event.payload.session.updatedAt,
          });
          if (failed !== null)
            yield* publishProgress({
              implementation: failed,
              phase: "integration",
              message: failed.failure,
            });
          return;
        }
        const localStatus = yield* git.localStatus({ cwd: implementation.worktreePath });
        if (localStatus.workingTree.files.length > 0) {
          const failed = yield* failIntegrationRepair({
            implementation,
            failure:
              "The Integration Repair Run must commit its repaired combined diff before review.",
            updatedAt: event.payload.session.updatedAt,
          });
          if (failed !== null)
            yield* publishProgress({
              implementation: failed,
              phase: "integration",
              message: failed.failure,
            });
          return;
        }
        const focusedValidation = yield* git
          .validateIntegration({
            cwd: implementation.worktreePath,
            fixedPoint: implementation.fixedPoint,
          })
          .pipe(Effect.result);
        if (Result.isFailure(focusedValidation)) {
          const failed = yield* failIntegrationRepair({
            implementation,
            failure: `Focused validation of the repaired combined diff failed: ${failureMessage(focusedValidation.failure)}`,
            updatedAt: event.payload.session.updatedAt,
          });
          if (failed !== null)
            yield* publishProgress({
              implementation: failed,
              phase: "integration",
              message: failed.failure,
            });
          return;
        }
        const diffSummary = yield* git
          .diffFromFixedPoint({
            cwd: implementation.worktreePath,
            fixedPoint: implementation.fixedPoint,
          })
          .pipe(Effect.result);
        if (Result.isFailure(diffSummary)) {
          const failed = yield* failIntegrationRepair({
            implementation,
            failure: `The repaired combined diff could not be captured: ${failureMessage(diffSummary.failure)}`,
            updatedAt: event.payload.session.updatedAt,
          });
          if (failed !== null)
            yield* publishProgress({
              implementation: failed,
              phase: "integration",
              message: failed.failure,
            });
          return;
        }
        const diff: WorkflowDiffEvidence = {
          fixedPoint: implementation.fixedPoint,
          files: diffSummary.success.files,
          additions: diffSummary.success.additions,
          deletions: diffSummary.success.deletions,
          capturedAt: event.payload.session.updatedAt,
        };
        const repairValidation: WorkflowValidationEvidence = {
          name: "integration-repair-diff-check",
          status: "passed",
          command: `git diff --check ${implementation.fixedPoint}..HEAD`,
          detail: "Validated the committed repaired combined diff before Code Review.",
          recordedAt: event.payload.session.updatedAt,
        };
        const validation = [
          ...implementation.validation.filter(
            (evidence) => evidence.name !== repairValidation.name,
          ),
          repairValidation,
        ];
        const reviewing = yield* updateImplementation({
          implementationId: implementation.id,
          patch: {
            status: "reviewing",
            recoveryPhase: "integration",
            reviewSkillRunId: null,
            integration: {
              ...implementation.integration,
              repair: {
                ...implementation.integration.repair,
                status: "reviewing",
                skillRunId: null,
                failure: null,
                updatedAt: event.payload.session.updatedAt,
              },
              failurePhase: null,
              failure: null,
              updatedAt: event.payload.session.updatedAt,
            },
            diff,
            validation,
            failure: null,
            updatedAt: event.payload.session.updatedAt,
          },
        });
        if (reviewing === null) return;
        const reviewSkillRunId = yield* startSkillTurn({
          originThread,
          implementation: reviewing,
          phase: "review",
        });
        const updated = yield* updateImplementation({
          implementationId: reviewing.id,
          patch: {
            status: "reviewing",
            ...(reviewSkillRunId !== null ? { reviewSkillRunId } : {}),
            updatedAt: event.payload.session.updatedAt,
          },
        });
        if (updated !== null) {
          yield* publishProgress({
            implementation: updated,
            message: "Pinned /code-review dispatched against the repaired combined diff.",
            phase: "review",
          });
        }
        return;
      }
      if (implementation.status === "reviewing") {
        if (
          event.payload.session.status !== "ready" ||
          implementationThread.latestTurn?.state !== "completed" ||
          implementation.reviewSkillRunId === null
        ) {
          return;
        }
        const assistantMessageId = implementationThread.latestTurn.assistantMessageId;
        const output =
          (assistantMessageId === null
            ? null
            : implementationThread.messages.find((message) => message.id === assistantMessageId)
          )?.text ??
          implementationThread.messages
            .filter((message) => message.role === "assistant")
            .toSorted((left, right) => left.updatedAt.localeCompare(right.updatedAt))
            .at(-1)?.text ??
          "";
        const result = parseWorkflowTicketImplementationReviewResult(output);
        if (result === null) {
          yield* publishProgress({
            implementation,
            message:
              "Code Review completed without a structured result; the Ticket Implementation remains in review.",
            phase: "review",
          });
          return;
        }
        const attachment = originThread.workflowAttachment;
        if (attachment === undefined) return;
        const reviewValidation = result.validation.map((evidence) => ({
          ...evidence,
          recordedAt: event.payload.session.updatedAt,
        }));
        const repairValidation =
          implementation.integration?.repair?.status === "reviewing"
            ? implementation.validation.filter(
                (evidence) => evidence.name === "integration-repair-diff-check",
              )
            : [];
        yield* orchestrationEngine.dispatch({
          type: "thread.workflow.ticket-implementation.review.record",
          commandId: CommandId.make(
            `server:ticket-implementation:${implementation.id}:${implementation.reviewSkillRunId}:review-record`,
          ),
          threadId: originThread.id,
          implementationId: implementation.id,
          expectedWorkstreamVersion: attachment.workflowVersion ?? 0,
          review: {
            status: result.status,
            skillRunId: implementation.reviewSkillRunId,
            fixedPoint: implementation.fixedPoint,
            summary: result.summary,
            findings: result.findings,
            completedAt: event.payload.session.updatedAt,
          },
          validation: [...repairValidation, ...reviewValidation],
          createdAt: event.payload.session.updatedAt,
        });
        return;
      }
      if (
        implementation.status !== "implementing" ||
        event.payload.session.status !== "ready" ||
        implementationThread.latestTurn?.state !== "completed"
      ) {
        return;
      }
      const localStatus =
        implementation.worktreePath === null
          ? null
          : yield* git.localStatus({ cwd: implementation.worktreePath });
      const diff: WorkflowDiffEvidence | null =
        localStatus === null
          ? null
          : {
              fixedPoint: implementation.fixedPoint,
              files: localStatus.workingTree.files.map((file) => ({
                path: file.path,
                additions: file.insertions,
                deletions: file.deletions,
              })),
              additions: localStatus.workingTree.insertions,
              deletions: localStatus.workingTree.deletions,
              capturedAt: event.payload.session.updatedAt,
            };
      const reviewing = yield* updateImplementation({
        implementationId: implementation.id,
        patch: {
          status: "reviewing",
          diff,
          failure: null,
          updatedAt: event.payload.session.updatedAt,
        },
      });
      if (reviewing === null) return;
      const reviewSkillRunId = yield* startSkillTurn({
        originThread,
        implementation: reviewing,
        phase: "review",
      });
      const updated = yield* updateImplementation({
        implementationId: reviewing.id,
        patch: {
          status: "reviewing",
          ...(reviewSkillRunId !== null ? { reviewSkillRunId } : {}),
          updatedAt: event.payload.session.updatedAt,
        },
      });
      if (updated !== null) {
        yield* publishProgress({
          implementation: updated,
          message: "Pinned /code-review dispatched against the original Fixed Point.",
          phase: "review",
        });
      }
    },
  );

  const processRecoveryRequested = Effect.fn(
    "WorkflowTicketImplementationReactor.processRecoveryRequested",
  )(function* (event: TicketImplementationRecoveryRequestedEvent) {
    const snapshot = yield* snapshots.getSnapshot();
    const originThread = snapshot.threads.find((thread) => thread.id === event.payload.threadId);
    const implementation = originThread?.workflowAttachment?.ticketImplementations?.find(
      (candidate) => candidate.id === event.payload.implementationId,
    );
    if (originThread === undefined || implementation === undefined) return;

    if (event.payload.action === "resume") {
      const phase = implementation.recoveryPhase ?? "implementation";
      const skillRunId = yield* startSkillTurn({
        originThread,
        implementation,
        phase: phase === "integration" ? "repair" : phase,
      });
      const updated = yield* updateImplementation({
        implementationId: implementation.id,
        patch: {
          status:
            phase === "review"
              ? "reviewing"
              : phase === "integration"
                ? "integrating"
                : "implementing",
          recoveryPhase: phase,
          failure: null,
          ...(phase === "implementation" && skillRunId !== null
            ? { implementationSkillRunId: skillRunId }
            : {}),
          ...(phase === "review" && skillRunId !== null ? { reviewSkillRunId: skillRunId } : {}),
          ...(phase === "integration" && implementation.integration?.repair !== undefined
            ? {
                integration: {
                  ...implementation.integration,
                  status: "integrating" as const,
                  failurePhase: null,
                  failure: null,
                  repair: {
                    ...implementation.integration.repair,
                    status: "running" as const,
                    ...(skillRunId === null ? {} : { skillRunId }),
                    failure: null,
                    updatedAt: event.payload.createdAt,
                  },
                  updatedAt: event.payload.createdAt,
                },
              }
            : {}),
          updatedAt: event.payload.createdAt,
        },
      });
      if (updated !== null) {
        yield* publishProgress({
          implementation: updated,
          message: `Explicitly resumed the retained ${phase} run in its existing ticket worktree.`,
          phase,
        });
      }
      return;
    }

    yield* publishProgress({
      implementation,
      message:
        event.payload.action === "cancel-with-changes"
          ? "Cancelled while retaining the linked thread, worktree, checkpoints, and diff."
          : `Restore to checkpoint turn ${event.payload.checkpointTurnCount ?? 0} was requested explicitly.`,
    });
  });

  const processReverted = Effect.fn("WorkflowTicketImplementationReactor.processReverted")(
    function* (event: RevertedEvent) {
      const snapshot = yield* snapshots.getSnapshot();
      const originThread = snapshot.threads.find((thread) =>
        thread.workflowAttachment?.ticketImplementations?.some(
          (implementation) => implementation.implementationThreadId === event.payload.threadId,
        ),
      );
      const implementation = originThread?.workflowAttachment?.ticketImplementations?.find(
        (candidate) => candidate.implementationThreadId === event.payload.threadId,
      );
      if (
        originThread === undefined ||
        implementation === undefined ||
        implementation.status !== "needs-recovery" ||
        implementation.recoveryCheckpointTurnCount !== event.payload.turnCount
      ) {
        return;
      }
      const restored = yield* updateImplementation({
        implementationId: implementation.id,
        patch: {
          failure: null,
          updatedAt: event.occurredAt,
        },
      });
      if (restored !== null) {
        yield* publishProgress({
          implementation: restored,
          message: `Checkpoint turn ${event.payload.turnCount} restored; the run still needs an explicit next action.`,
        });
      }
    },
  );

  const failIntegration = Effect.fn("WorkflowTicketImplementationReactor.failIntegration")(
    function* (input: {
      readonly originThread: OrchestrationThread;
      readonly implementation: WorkflowTicketImplementation;
      readonly phase: "merge" | "validation" | "tracker";
      readonly failure: string;
      readonly updatedAt: string;
    }) {
      const integration = input.implementation.integration;
      if (integration === undefined) return null;
      const failed = yield* updateImplementation({
        implementationId: input.implementation.id,
        patch: {
          status: "integration-failed",
          integration: {
            ...integration,
            status: "failed",
            failurePhase: input.phase,
            failure: input.failure,
            updatedAt: input.updatedAt,
          },
          failure: input.failure,
          updatedAt: input.updatedAt,
        },
      });
      return failed;
    },
  );

  const failIntegrationRepair = Effect.fn(
    "WorkflowTicketImplementationReactor.failIntegrationRepair",
  )(function* (input: {
    readonly implementation: WorkflowTicketImplementation;
    readonly failure: string;
    readonly updatedAt: string;
  }) {
    const integration = input.implementation.integration;
    const repair = integration?.repair;
    if (integration === undefined || repair === undefined) return null;
    return yield* updateImplementation({
      implementationId: input.implementation.id,
      patch: {
        status: "needs-recovery",
        recoveryPhase: "integration",
        integration: {
          ...integration,
          status: "failed",
          failurePhase: "repair",
          failure: input.failure,
          repair: {
            ...repair,
            status: "failed",
            failure: input.failure,
            updatedAt: input.updatedAt,
          },
          updatedAt: input.updatedAt,
        },
        failure: input.failure,
        updatedAt: input.updatedAt,
      },
    });
  });

  const processIntegration = Effect.fn("WorkflowTicketImplementationReactor.processIntegration")(
    function* (input: {
      readonly originThread: OrchestrationThread;
      readonly implementation: WorkflowTicketImplementation;
    }) {
      const attachment = input.originThread.workflowAttachment;
      const integration = input.implementation.integration;
      if (
        attachment === undefined ||
        integration === undefined ||
        input.implementation.status !== "integrating"
      ) {
        return;
      }
      const workflowRun = attachment.workflowRun;
      if (workflowRun?.configuration.authority.mutateTracker !== true) {
        return;
      }
      const snapshot = yield* snapshots.getSnapshot();
      const cwd = resolveThreadWorkspaceCwd({
        thread: input.originThread,
        projects: snapshot.projects,
      });
      if (cwd === undefined) {
        yield* failIntegration({
          originThread: input.originThread,
          implementation: input.implementation,
          phase: "merge",
          failure: "The Origin Thread has no resolvable project workspace for integration.",
          updatedAt: input.implementation.updatedAt,
        });
        return;
      }
      const integrationCwd = yield* resolveIntegrationWorkspace({
        cwd,
        baselineBranch: integration.baselineBranch,
      });
      if (integrationCwd === null) {
        yield* failIntegration({
          originThread: input.originThread,
          implementation: input.implementation,
          phase: "merge",
          failure: `The Workstream Baseline ${integration.baselineBranch} has no dedicated integration workspace.`,
          updatedAt: input.implementation.updatedAt,
        });
        return;
      }

      const repair = integration.repair;
      if (repair?.status === "pending") {
        const skillRunId = yield* startSkillTurn({
          originThread: input.originThread,
          implementation: input.implementation,
          phase: "repair",
        });
        const running = yield* updateImplementation({
          implementationId: input.implementation.id,
          patch: {
            status: "integrating",
            recoveryPhase: "integration",
            integration: {
              ...integration,
              repair: {
                ...repair,
                status: "running",
                ...(skillRunId === null ? {} : { skillRunId }),
                failure: null,
                updatedAt: input.implementation.updatedAt,
              },
              updatedAt: input.implementation.updatedAt,
            },
            failure: null,
            updatedAt: input.implementation.updatedAt,
          },
        });
        if (running !== null) {
          yield* publishProgress({
            implementation: running,
            phase: "integration",
            message: `Baseline merge conflict detected; automatic Integration Repair Run ${repair.attempt} is now running under the existing ticket authority.`,
          });
        }
        return;
      }
      if (repair?.status === "running" || repair?.status === "reviewing") return;
      if (repair?.status === "failed") return;

      let baselineCommit = integration.baselineCommit;
      if (
        integration.status === "integrating" &&
        baselineCommit === null &&
        input.implementation.branch === null
      ) {
        yield* failIntegration({
          originThread: input.originThread,
          implementation: input.implementation,
          phase: "merge",
          failure: "The reviewed Ticket Implementation has no branch to integrate.",
          updatedAt: input.implementation.updatedAt,
        });
        return;
      }
      if (integration.status === "integrating") {
        if (baselineCommit === null) {
          const mergeResult = yield* git
            .integrateBranch({
              cwd: integrationCwd,
              targetBranch: integration.baselineBranch,
              sourceBranch: input.implementation.branch!,
            })
            .pipe(Effect.result);
          if (Result.isFailure(mergeResult)) {
            if (isIntegrationMergeConflict(mergeResult.failure)) {
              const aborted = yield* git.abortIntegrationMerge(integrationCwd).pipe(Effect.result);
              const repairFailure = Result.isFailure(aborted)
                ? failureMessage(aborted.failure)
                : null;
              if (repair !== undefined) {
                const failure =
                  repairFailure ??
                  "The repaired baseline merge conflicted again; no second automatic Integration Repair Run will start.";
                const needsRecovery = yield* failIntegrationRepair({
                  implementation: input.implementation,
                  failure,
                  updatedAt: input.implementation.updatedAt,
                });
                if (needsRecovery !== null) {
                  yield* publishProgress({
                    implementation: needsRecovery,
                    phase: "integration",
                    message: failure,
                  });
                }
                return;
              }
              const repairRecord: NonNullable<
                WorkflowTicketImplementation["integration"]
              >["repair"] = {
                attempt: 1,
                status: repairFailure === null ? "pending" : "failed",
                skillRunId: null,
                failure: repairFailure,
                startedAt: input.implementation.updatedAt,
                updatedAt: input.implementation.updatedAt,
              };
              const repaired = yield* updateImplementation({
                implementationId: input.implementation.id,
                patch: {
                  status: repairFailure === null ? "integrating" : "needs-recovery",
                  recoveryPhase: repairFailure === null ? "integration" : "integration",
                  integration: {
                    ...integration,
                    status: repairFailure === null ? "integrating" : "failed",
                    failurePhase: "repair",
                    failure:
                      repairFailure ??
                      "The baseline merge conflicted; the existing merge state was safely aborted.",
                    repair: repairRecord,
                    updatedAt: input.implementation.updatedAt,
                  },
                  failure:
                    repairFailure ??
                    "The baseline merge conflicted; the existing merge state was safely aborted.",
                  updatedAt: input.implementation.updatedAt,
                },
              });
              if (repaired !== null) {
                yield* publishProgress({
                  implementation: repaired,
                  phase: "integration",
                  message:
                    repairFailure === null
                      ? "The baseline merge conflict was isolated and safely aborted; one automatic Integration Repair Run is queued."
                      : repairFailure,
                });
              }
              return;
            }
            yield* failIntegration({
              originThread: input.originThread,
              implementation: input.implementation,
              phase: "merge",
              failure: failureMessage(mergeResult.failure),
              updatedAt: input.implementation.updatedAt,
            });
            return;
          }
          baselineCommit = mergeResult.success.commitSha;
          const mergeRecorded = yield* updateImplementation({
            implementationId: input.implementation.id,
            patch: {
              status: "integrating",
              integration: {
                ...integration,
                baselineCommit,
                failurePhase: null,
                failure: null,
                updatedAt: input.implementation.updatedAt,
              },
              failure: null,
              updatedAt: input.implementation.updatedAt,
            },
          });
          if (mergeRecorded === null) return;
        }
        const validationResult = yield* git
          .validateIntegration({
            cwd: integrationCwd,
            fixedPoint: input.implementation.fixedPoint,
          })
          .pipe(Effect.result);
        if (Result.isFailure(validationResult)) {
          yield* failIntegration({
            originThread: input.originThread,
            implementation: {
              ...input.implementation,
              integration: { ...integration, baselineCommit },
            },
            phase: "validation",
            failure: failureMessage(validationResult.failure),
            updatedAt: input.implementation.updatedAt,
          });
          return;
        }
        const integrationValidation: WorkflowValidationEvidence = {
          name: "integration-diff-check",
          status: "passed",
          command: `git diff --check ${input.implementation.fixedPoint}..HEAD`,
          detail: `Validated ${integration.baselineBranch} at ${baselineCommit}.`,
          recordedAt: input.implementation.updatedAt,
        };
        const validation = [
          ...input.implementation.validation.filter(
            (evidence) => evidence.name !== integrationValidation.name,
          ),
          integrationValidation,
        ];
        const trackerClosing = yield* updateImplementation({
          implementationId: input.implementation.id,
          patch: {
            status: "integrating",
            integration: {
              ...integration,
              status: "tracker-closing",
              baselineCommit,
              failurePhase: null,
              failure: null,
              updatedAt: input.implementation.updatedAt,
            },
            validation,
            failure: null,
            updatedAt: input.implementation.updatedAt,
          },
        });
        if (trackerClosing !== null) {
          yield* publishProgress({
            implementation: trackerClosing,
            phase: "integration",
            message:
              "Baseline integration and fixed-point validation passed; synchronizing the tracker.",
          });
        }
        return;
      }

      if (integration.status !== "tracker-closing") return;
      const previousProjection =
        attachment.trackerProjection ?? attachment.ticketingStage?.trackerProjection;
      const repositoryResult = yield* tracker
        .resolveProjectRepository(integrationCwd)
        .pipe(Effect.result);
      if (Result.isFailure(repositoryResult) || repositoryResult.success === null) {
        yield* failIntegration({
          originThread: input.originThread,
          implementation: input.implementation,
          phase: "tracker",
          failure: "The Workstream Baseline is not linked to a writable issue tracker.",
          updatedAt: input.implementation.updatedAt,
        });
        return;
      }
      if (previousProjection === undefined) {
        yield* failIntegration({
          originThread: input.originThread,
          implementation: input.implementation,
          phase: "tracker",
          failure: "Tracker closure requires the prior healthy Workflow Tracker Projection.",
          updatedAt: input.implementation.updatedAt,
        });
        return;
      }
      const repository = repositoryResult.success;
      const currentMap = yield* tracker.loadWayfinderMap({
        cwd: integrationCwd,
        repository,
        issueNumber: previousProjection.canonicalReference.number,
        synchronizedAt: input.implementation.updatedAt,
      });
      const currentTicket =
        currentMap.kind === "loaded"
          ? currentMap.map.tickets.find(
              (ticket) => ticket.number === input.implementation.ticketNumber,
            )
          : undefined;
      if (currentTicket?.state !== "closed") {
        const closeResult = yield* tracker
          .setIssueState({
            cwd: integrationCwd,
            repository,
            issueNumber: input.implementation.ticketNumber,
            state: "closed",
          })
          .pipe(Effect.result);
        if (Result.isFailure(closeResult)) {
          yield* failIntegration({
            originThread: input.originThread,
            implementation: input.implementation,
            phase: "tracker",
            failure: failureMessage(closeResult.failure),
            updatedAt: input.implementation.updatedAt,
          });
          return;
        }
      }
      const reconciliationResult = yield* tracker
        .reconcileWayfinderMap({
          cwd: integrationCwd,
          repository,
          issueNumber: previousProjection.canonicalReference.number,
          synchronizedAt: input.implementation.updatedAt,
          ...(previousProjection.revision !== undefined
            ? { currentRevision: previousProjection.revision }
            : {}),
        })
        .pipe(Effect.result);
      let map: WayfinderMapProjection | null = null;
      if (
        Result.isSuccess(reconciliationResult) &&
        reconciliationResult.success.kind === "loaded"
      ) {
        map = reconciliationResult.success.map;
      } else if (
        Result.isSuccess(reconciliationResult) &&
        reconciliationResult.success.kind === "unchanged"
      ) {
        const loadedResult = yield* tracker
          .loadWayfinderMap({
            cwd: integrationCwd,
            repository,
            issueNumber: previousProjection.canonicalReference.number,
            synchronizedAt: input.implementation.updatedAt,
          })
          .pipe(Effect.result);
        if (Result.isSuccess(loadedResult) && loadedResult.success.kind === "loaded") {
          map = loadedResult.success.map;
        }
      }
      const trackerTicket = map?.tickets.find(
        (ticket) => ticket.number === input.implementation.ticketNumber,
      );
      if (map === null || trackerTicket?.state !== "closed") {
        yield* failIntegration({
          originThread: input.originThread,
          implementation: input.implementation,
          phase: "tracker",
          failure:
            "Tracker closure did not synchronize a healthy projection with the integrated ticket closed.",
          updatedAt: input.implementation.updatedAt,
        });
        return;
      }
      const projection = trackerProjectionFromMap({
        map,
        previous: previousProjection,
        synchronizedAt: input.implementation.updatedAt,
      });
      yield* updateImplementation({
        implementationId: input.implementation.id,
        patch: {
          status: "integrated",
          integration: {
            ...integration,
            status: "integrated",
            failurePhase: null,
            failure: null,
            updatedAt: input.implementation.updatedAt,
          },
          failure: null,
          updatedAt: input.implementation.updatedAt,
        },
        trackerProjection: projection,
      });
    },
  );
  const processUpdated = Effect.fn("WorkflowTicketImplementationReactor.processUpdated")(function* (
    event: TicketImplementationUpdatedEvent | TicketImplementationCheckpointedEvent,
  ) {
    const snapshot = yield* snapshots.getSnapshot();
    const located = snapshot.threads
      .map((thread) => ({
        thread,
        implementation: thread.workflowAttachment?.ticketImplementations?.find(
          (candidate) => candidate.id === event.payload.implementation.id,
        ),
      }))
      .find((candidate) => candidate.implementation !== undefined);
    const implementation = event.payload.implementation;
    const originThread =
      located?.thread ??
      snapshot.threads.find((thread) => thread.id === implementation.originThreadId);
    const currentImplementation = located?.implementation ?? implementation;

    if (originThread !== undefined && currentImplementation.status === "integrating") {
      yield* processIntegration({
        originThread,
        implementation: currentImplementation,
      });
      return;
    }

    if (
      originThread?.workflowAttachment?.workflowRun?.configuration.authority.mutateTracker ===
        true &&
      currentImplementation.status === "reviewed" &&
      currentImplementation.review?.status === "passed" &&
      currentImplementation.validation.every((evidence) => evidence.status === "passed") &&
      currentImplementation.review.findings.filter(isBlockingWorkflowCodeReviewFinding).length === 0
    ) {
      const attachment = originThread.workflowAttachment;
      const repairedIntegration =
        currentImplementation.integration?.repair?.status === "ready"
          ? {
              ...currentImplementation.integration,
              status: "integrating" as const,
              baselineCommit: null,
              failurePhase: null,
              failure: null,
              updatedAt: currentImplementation.updatedAt,
            }
          : null;
      const integration = yield* updateImplementation({
        implementationId: currentImplementation.id,
        patch: {
          status: "integrating",
          integration: repairedIntegration ?? {
            status: "integrating",
            baselineBranch: attachment.workflowRun!.configuration.workstreamBaseline,
            baselineCommit: null,
            failurePhase: null,
            failure: null,
            startedAt: currentImplementation.updatedAt,
            updatedAt: currentImplementation.updatedAt,
          },
          failure: null,
          updatedAt: currentImplementation.updatedAt,
        },
      });
      if (integration === null) return;
      return;
    }

    if (
      implementation.status === "needs-correction" &&
      originThread?.workflowAttachment !== undefined
    ) {
      const findings =
        implementation.review?.findings.filter(isBlockingWorkflowCodeReviewFinding) ?? [];
      const nextCycle = (implementation.correctionCycles?.length ?? 0) + 1;
      if (findings.length > 0 && nextCycle <= WORKFLOW_MAX_AUTOMATIC_CORRECTION_CYCLES) {
        yield* orchestrationEngine.dispatch({
          type: "thread.workflow.ticket-implementation.correction.start",
          commandId: CommandId.make(
            `server:ticket-implementation:${implementation.id}:correction-cycle-${nextCycle}:start`,
          ),
          threadId: originThread.id,
          implementationId: implementation.id,
          correctionCycle: nextCycle,
          findings,
          expectedWorkstreamVersion: originThread.workflowAttachment.workflowVersion ?? 0,
          createdAt: implementation.updatedAt,
        });
        return;
      }
    }

    if (
      implementation.status === "implementing" &&
      (implementation.correctionCycles?.length ?? 0) > 0 &&
      implementation.implementationSkillRunId === null &&
      originThread !== undefined
    ) {
      yield* startCorrectionImplementation({
        originThread,
        implementation,
      });
      return;
    }

    yield* publishProgress({
      implementation: currentImplementation,
      message:
        currentImplementation.status === "checkpointed"
          ? "Ticket Implementation reached a Workflow Checkpoint; automatic dispatch remains paused."
          : currentImplementation.status === "reviewed"
            ? "Structured Code Review evidence recorded; integration remains a downstream milestone."
            : currentImplementation.status === "integration-failed"
              ? `Integration failed during ${currentImplementation.integration?.failurePhase ?? "an unknown phase"}; retry is available without replaying a successful integration.`
              : currentImplementation.status === "integrated"
                ? "Baseline integration and tracker synchronization completed; the Ticket is now Integrated."
                : currentImplementation.status === "needs-recovery"
                  ? "The accepted run needs recovery; retained execution evidence is available for inspection."
                  : currentImplementation.status === "cancelled"
                    ? "The run was cancelled without deleting its retained changes."
                    : currentImplementation.status === "needs-decision"
                      ? "Automatic Correction Cycles are exhausted; Needs Decision preserves the final Must-Fix evidence."
                      : null,
      phase: implementationPhase(currentImplementation),
    });
  });

  const recoverAfterProcessorFailure = Effect.fn(
    "WorkflowTicketImplementationReactor.recoverAfterProcessorFailure",
  )(function* (input: {
    readonly implementationId: string;
    readonly cause: Cause.Cause<unknown>;
    readonly updatedAt: string;
  }) {
    const snapshot = yield* snapshots.getSnapshot();
    const originThread = snapshot.threads.find((thread) =>
      thread.workflowAttachment?.ticketImplementations?.some(
        (implementation) => implementation.id === input.implementationId,
      ),
    );
    const implementation = originThread?.workflowAttachment?.ticketImplementations?.find(
      (candidate) => candidate.id === input.implementationId,
    );
    if (
      originThread === undefined ||
      implementation === undefined ||
      implementation.status === "cancelled" ||
      implementation.status === "reviewed"
    ) {
      return;
    }
    const recovered = yield* updateImplementation({
      implementationId: implementation.id,
      patch: {
        status: "needs-recovery",
        recoveryPhase:
          implementation.recoveryPhase ??
          (implementation.integration?.repair?.status === "running"
            ? "integration"
            : implementation.status === "reviewing"
              ? "review"
              : "implementation"),
        ...(implementation.integration?.repair?.status === "running"
          ? {
              integration: {
                ...implementation.integration,
                status: "failed" as const,
                failurePhase: "repair" as const,
                failure: `Ticket implementation effect failed before its milestone completed: ${Cause.pretty(input.cause)}`,
                repair: {
                  ...implementation.integration.repair,
                  status: "failed" as const,
                  failure: `Ticket implementation effect failed before its milestone completed: ${Cause.pretty(input.cause)}`,
                  updatedAt: input.updatedAt,
                },
                updatedAt: input.updatedAt,
              },
            }
          : {}),
        failure: `Ticket implementation effect failed before its milestone completed: ${Cause.pretty(input.cause)}`,
        updatedAt: input.updatedAt,
      },
    });
    if (recovered !== null) {
      yield* publishProgress({ implementation: recovered, message: recovered.failure });
    }
  });

  const processTurnStartRequested = Effect.fn(
    "WorkflowTicketImplementationReactor.processTurnStartRequested",
  )(function* (event: TurnStartRequestedEvent) {
    const skillInvocation = event.payload.skillInvocation;
    if (skillInvocation === undefined) return;
    const snapshot = yield* snapshots.getSnapshot();
    const implementation = snapshot.threads
      .flatMap((thread) => thread.workflowAttachment?.ticketImplementations ?? [])
      .find((candidate) => candidate.implementationThreadId === event.payload.threadId);
    if (implementation === undefined) return;
    if (skillInvocation.skill.name === implementation.implementSkill.name) {
      if (
        implementation.status === "integrating" &&
        implementation.integration?.repair !== undefined &&
        (implementation.integration.repair.status === "pending" ||
          implementation.integration.repair.status === "running")
      ) {
        yield* updateImplementation({
          implementationId: implementation.id,
          patch: {
            integration: {
              ...implementation.integration,
              repair: {
                ...implementation.integration.repair,
                status: "running",
                skillRunId: skillInvocation.skillRunId,
                updatedAt: event.payload.createdAt,
              },
              updatedAt: event.payload.createdAt,
            },
            updatedAt: event.payload.createdAt,
          },
        });
        return;
      }
      yield* updateImplementation({
        implementationId: implementation.id,
        patch: {
          implementationSkillRunId: skillInvocation.skillRunId,
          updatedAt: event.payload.createdAt,
        },
      });
      return;
    }
    if (skillInvocation.skill.name === implementation.reviewSkill.name) {
      yield* updateImplementation({
        implementationId: implementation.id,
        patch: {
          reviewSkillRunId: skillInvocation.skillRunId,
          updatedAt: event.payload.createdAt,
        },
      });
    }
  });

  return Effect.fn("WorkflowTicketImplementationReactor.processEvent")(function* (
    event: WorkflowTicketImplementationEvent,
  ) {
    switch (event.type) {
      case "thread.workflow-ticket-implementation-requested":
        yield* processRequested(event).pipe(
          Effect.catchCause((cause) =>
            recoverAfterProcessorFailure({
              implementationId: event.payload.implementation.id,
              cause,
              updatedAt: event.payload.createdAt,
            }),
          ),
        );
        yield* scheduleFrontier({ createdAt: event.occurredAt });
        return;
      case "thread.workflow-ticket-implementation-updated":
        yield* processUpdated(event);
        yield* scheduleFrontier({ createdAt: event.occurredAt });
        return;
      case "thread.workflow-ticket-implementation-checkpointed":
        yield* processUpdated(event);
        yield* scheduleFrontier({ createdAt: event.occurredAt });
        return;
      case "thread.workflow-ticket-implementation-recovery-requested":
        yield* processRecoveryRequested(event).pipe(
          Effect.catchCause((cause) =>
            recoverAfterProcessorFailure({
              implementationId: event.payload.implementationId,
              cause,
              updatedAt: event.payload.createdAt,
            }),
          ),
        );
        return;
      case "thread.session-set":
        yield* processSessionSet(event);
        yield* scheduleFrontier({ createdAt: event.occurredAt });
        return;
      case "thread.reverted":
        yield* processReverted(event);
        return;
      case "thread.turn-start-requested":
        yield* processTurnStartRequested(event);
        yield* scheduleFrontier({ createdAt: event.occurredAt });
        return;
      case "thread.workflow-run-started":
      case "thread.workflow-run-resumed":
      case "thread.workflow-run-draining":
        yield* scheduleFrontier({ createdAt: event.occurredAt });
        return;
      case "thread.workflow-run-paused":
        yield* processBaselineRefresh(event);
        yield* scheduleFrontier({ createdAt: event.occurredAt });
        return;
      case "thread.workflow-baseline-refresh-requested":
        yield* processBaselineRefreshRequested(event);
        return;
      case "thread.workflow-baseline-refresh-updated":
        yield* scheduleFrontier({ createdAt: event.occurredAt });
        return;
    }
  });
});
