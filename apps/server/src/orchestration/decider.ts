import {
  ApprovalRequestId,
  CommandId,
  EventId,
  SkillRunId,
  ThreadId,
  TrimmedNonEmptyString,
  UserInputQuestion,
  WayfinderMutationAction,
  WorkstreamId,
  WorkflowTicketBatch as WorkflowTicketBatchSchema,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type ProviderInstanceId,
  type SkillInvocation,
  type WorkflowArtifactSourceStage,
  type WorkflowAttachmentWayfinderData,
  type WorkflowAttachment,
  type WorkflowCheckpointRequest,
  type WorkflowRunConfiguration,
  type WorkflowRunRequiredSkill,
  type WorkflowSpecificationStage,
  type WorkflowTicketBatch,
  type WorkflowTicketBatchPublication,
  type WorkflowTicketImplementation,
  type WorkflowTicketImplementationAvailability,
  type WorkflowCodeReviewEvidence,
  type WorkflowCodeReviewFinding,
  type WorkflowValidationEvidence,
  type WorkflowTicketImplementationStatus,
  type WorkflowBaselineRefresh,
  type WorkflowTicketingCheckpointRequest,
  type WorkflowTicketingStage,
  isBlockingWorkflowCodeReviewFinding,
  WORKFLOW_MAX_AUTOMATIC_CORRECTION_CYCLES,
} from "@t3tools/contracts";
import { createEmptyWayfinderDraft } from "@t3tools/shared/wayfinderDraft";
import { deriveWayfinderReadiness } from "@t3tools/shared/wayfinderReadiness";
import { stableStringify } from "@t3tools/shared/relaySigning";
import {
  workflowTicketImplementationBranch,
  workflowTicketImplementationId,
} from "@t3tools/shared/workflowTicketImplementation";
import {
  acknowledgeWorkflowArtifact,
  completeWorkflowSpecification,
  completeWorkflowTicketing,
  hasPendingWorkflowStaleness,
  initializeWorkflowGraph,
  isIntegratedWorkflowTrackerTicket,
  markWorkflowBaselineRefreshStale,
  resolveWorkflowStaleness,
  synchronizeWorkflowAttachmentWayfinderData,
  viewWorkflowArtifacts,
  workflowSpecificationArtifactDetail,
} from "@t3tools/shared/workflowGraph";
import * as DateTime from "effect/DateTime";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import { OrchestrationCommandInvariantError } from "./Errors.ts";
import {
  activeWayfinderDraftSkillRunId,
  approvedWayfinderPublicationSkillRunId,
  hasActiveWayfinderDraftAuthority,
} from "../nativeSkills/WayfinderDraftMutationGuard.ts";
import {
  listThreadsByProjectId,
  requireActiveProjectWorkspaceRootAbsent,
  requireProject,
  requireProjectAbsent,
  requireThread,
  requireThreadArchived,
  requireThreadAbsent,
  requireThreadNotArchived,
} from "./commandInvariants.ts";
import { projectEvent } from "./projector.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
const decodePublishedWayfinderPayload = Schema.decodeUnknownOption(
  Schema.Struct({ skillRunId: SkillRunId }),
);
const decodeWayfinderMutationApprovalPayload = Schema.decodeUnknownOption(
  Schema.Struct({
    skillRunId: SkillRunId,
    actionId: Schema.String,
    action: WayfinderMutationAction,
  }),
);
const decodeWorkflowCheckpointActivityPayload = Schema.decodeUnknownOption(
  Schema.Struct({
    requestId: ApprovalRequestId,
    skillRunId: SkillRunId,
    questions: Schema.Array(UserInputQuestion),
  }),
);
const decodeWorkflowTicketingCheckpointActivityPayload = Schema.decodeUnknownOption(
  Schema.Struct({
    requestId: ApprovalRequestId,
    skillRunId: SkillRunId,
    batch: WorkflowTicketBatchSchema,
    questions: Schema.Array(UserInputQuestion),
  }),
);
const decodeActivityRequestMetadata = Schema.decodeUnknownOption(
  Schema.Struct({ requestId: Schema.optional(ApprovalRequestId) }),
);
const decodeRuntimeErrorActivityPayload = Schema.decodeUnknownOption(
  Schema.Struct({ message: Schema.optional(TrimmedNonEmptyString) }),
);

function isWorkflowAttachableWayfinderInvocation(invocation: SkillInvocation): boolean {
  return (
    invocation.skill.name === "wayfinder" &&
    invocation.execution.mode === "native" &&
    invocation.action?.id !== "work-ticket" &&
    (invocation.wayfinderMap !== undefined || invocation.wayfinderDraft !== undefined)
  );
}

function backfillWorkflowAttachmentWayfinderData(
  invocation: SkillInvocation,
): WorkflowAttachmentWayfinderData {
  return {
    ...(invocation.wayfinderMap !== undefined ? { wayfinderMap: invocation.wayfinderMap } : {}),
    ...(invocation.wayfinderDraft !== undefined
      ? { wayfinderDraft: invocation.wayfinderDraft }
      : {}),
    ...(invocation.wayfinderPublication !== undefined
      ? { wayfinderPublication: invocation.wayfinderPublication }
      : {}),
    ...(invocation.wayfinderSynchronizedAt !== undefined
      ? { wayfinderSynchronizedAt: invocation.wayfinderSynchronizedAt }
      : {}),
    ...(invocation.wayfinderSynchronization !== undefined
      ? { wayfinderSynchronization: invocation.wayfinderSynchronization }
      : {}),
  };
}

function isCompatibleWorkflowWayfinderSource(input: {
  readonly thread: OrchestrationThread;
  readonly skillRunId: SkillInvocation["skillRunId"];
  readonly sourceInvocation?: SkillInvocation;
}): boolean {
  const attachment = input.thread.workflowAttachment;
  if (attachment === undefined) {
    return false;
  }
  const invocation = input.sourceInvocation ?? input.thread.latestTurn?.skillInvocation;
  if (invocation?.skillRunId !== input.skillRunId) {
    // The source can outlive being the latest turn. Only the originally
    // attached run or the last persisted observer cursor may continue without
    // a currently projected native invocation to validate.
    return (
      attachment.sourceSkillRunId === input.skillRunId ||
      attachment.observationCursor.sourceSkillRunId === input.skillRunId
    );
  }
  return (
    invocation.skill.name === "wayfinder" &&
    invocation.execution.mode === "native" &&
    invocation.action?.id !== "work-ticket" &&
    invocation.workstreamId === attachment.workstreamId
  );
}

function staleWorkflowAttachmentForInvocation(
  readModel: OrchestrationReadModel,
  invocation:
    | Pick<SkillInvocation, "skill" | "action" | "execution" | "reconnectWorkstreamId">
    | undefined,
) {
  if (
    invocation === undefined ||
    (invocation.skill.name === "wayfinder" &&
      invocation.execution.mode === "native" &&
      invocation.action?.id !== "work-ticket")
  ) {
    return undefined;
  }
  const sourceSkillRunId =
    invocation.action?.id === "handoff-to-spec" || invocation.action?.id === "work-ticket"
      ? invocation.action.sourceSkillRunId
      : undefined;
  return readModel.threads
    .map((thread) => thread.workflowAttachment)
    .find(
      (attachment) =>
        attachment !== undefined &&
        hasPendingWorkflowStaleness(attachment) &&
        (attachment.sourceSkillRunId === sourceSkillRunId ||
          attachment.observationCursor.sourceSkillRunId === sourceSkillRunId ||
          attachment.workstreamId === invocation.reconnectWorkstreamId),
    );
}

function sameWayfinderMutationAction(
  left: WayfinderMutationAction,
  right: WayfinderMutationAction,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "update-map-field":
      return right.kind === left.kind && left.field === right.field && left.value === right.value;
    case "create-ticket":
      return (
        right.kind === left.kind &&
        left.title === right.title &&
        left.classification === right.classification
      );
    case "rename-ticket":
      return (
        right.kind === left.kind &&
        left.ticketNumber === right.ticketNumber &&
        left.title === right.title
      );
    case "classify-ticket":
      return (
        right.kind === left.kind &&
        left.ticketNumber === right.ticketNumber &&
        left.classification === right.classification
      );
    case "add-dependency":
    case "remove-dependency":
      return (
        right.kind === left.kind &&
        left.blockerNumber === right.blockerNumber &&
        left.blockedNumber === right.blockedNumber
      );
    case "resolve-ticket":
      return (
        right.kind === left.kind &&
        left.ticketNumber === right.ticketNumber &&
        left.resolution === right.resolution
      );
    case "close-ticket":
    case "reopen-ticket":
    case "claim-ticket":
    case "release-ticket":
      return right.kind === left.kind && left.ticketNumber === right.ticketNumber;
    case "complete-hitl-ticket":
      return (
        right.kind === left.kind &&
        left.ticketNumber === right.ticketNumber &&
        left.outcome === right.outcome &&
        left.resolution === right.resolution &&
        left.contextPointer === right.contextPointer &&
        left.graduatedFog.length === right.graduatedFog.length &&
        left.graduatedFog.every((ticket, ticketIndex) => {
          const candidate = right.graduatedFog[ticketIndex];
          return (
            candidate !== undefined &&
            ticket.key === candidate.key &&
            ticket.fog === candidate.fog &&
            ticket.title === candidate.title &&
            ticket.classification === candidate.classification &&
            ticket.blockedBy.length === candidate.blockedBy.length &&
            ticket.blockedBy.every((blocker, blockerIndex) => {
              const candidateBlocker = candidate.blockedBy[blockerIndex];
              return (
                candidateBlocker !== undefined &&
                blocker.kind === candidateBlocker.kind &&
                (blocker.kind === "ticket"
                  ? candidateBlocker.kind === "ticket" &&
                    blocker.ticketNumber === candidateBlocker.ticketNumber
                  : candidateBlocker.kind === "graduated" && blocker.key === candidateBlocker.key)
              );
            })
          );
        })
      );
  }
}

// Session adoption takes seconds; a user message still unadopted after this
// window is a failed/stale start, not pending work. Mirrors the client's
// QUEUED_TURN_START_GRACE_MS in client-runtime threadSettled.ts.
const QUEUED_TURN_START_GRACE_MS = 2 * 60 * 1_000;

/**
 * Blocked-on-you work derived from the thread's retained activities: an
 * approval or user-input request with no later resolution for the same
 * requestId. The server-side twin of the shell's hasPendingApprovals /
 * hasPendingUserInput flags, which the decider read model does not carry.
 * The clearing rules MUST match ProjectionPipeline's pending accounting —
 * resolved activities always clear, respond.failed clears only when the
 * failure detail marks the request stale/unknown — or settle would be
 * rejected on threads whose shell flags read as clear.
 */
function isStaleRequestFailureDetail(payload: Record<string, unknown> | null): boolean {
  const detail = typeof payload?.detail === "string" ? payload.detail.toLowerCase() : null;
  if (detail === null) return false;
  return (
    detail.includes("stale pending approval request") ||
    detail.includes("unknown pending approval request") ||
    detail.includes("unknown pending permission request") ||
    detail.includes("stale pending user-input request") ||
    detail.includes("unknown pending user-input request") ||
    detail.includes("unknown pending user input request") ||
    detail.includes("unknown pending codex user input request")
  );
}

// Scans the read model's activities, which the projector caps at the most
// recent 500. That bound is safe here: an OPEN approval/user-input request
// blocks its turn, so the thread cannot accumulate hundreds of later
// activities while one is outstanding — a request that has scrolled out of
// the window is one whose turn kept running, i.e. it was resolved or went
// stale. (The projection pipeline's pendingApprovalCount reads the same
// capped stream and stays consistent with this view.)
function hasOpenBlockingRequest(thread: {
  readonly activities: ReadonlyArray<{ readonly kind: string; readonly payload: unknown }>;
}): boolean {
  const openRequestIds = new Set<string>();
  for (const activity of thread.activities) {
    const payload =
      typeof activity.payload === "object" && activity.payload !== null
        ? (activity.payload as Record<string, unknown>)
        : null;
    const requestId = typeof payload?.requestId === "string" ? payload.requestId : null;
    if (requestId === null) continue;
    if (activity.kind === "approval.requested" || activity.kind === "user-input.requested") {
      openRequestIds.add(requestId);
    } else if (activity.kind === "approval.resolved" || activity.kind === "user-input.resolved") {
      openRequestIds.delete(requestId);
    } else if (
      (activity.kind === "provider.approval.respond.failed" ||
        activity.kind === "provider.user-input.respond.failed") &&
      isStaleRequestFailureDetail(payload)
    ) {
      openRequestIds.delete(requestId);
    }
  }
  return openRequestIds.size > 0;
}

/**
 * A queued turn start — a user message no turn has picked up yet — is work
 * in flight even though session is still null (turn.start emits
 * message-sent + turn-start-requested; the session arrives later). Detection
 * mirrors the client's hasQueuedTurnStart: the newest user message is
 * strictly newer than every latestTurn timestamp (adoption stamps the new
 * turn's requestedAt with the message time, clearing this), and only within
 * the adoption grace window — historical threads whose last user message
 * postdates their turn timestamps (older-server data, mid-turn messages)
 * must not be blocked forever. A failed session start (status "error")
 * clears the block immediately.
 *
 * The age check is bounded on BOTH sides: message timestamps are
 * client-supplied, so a client clock ahead of the server yields a negative
 * age. Without the lower bound that negative age satisfies `<= grace` for
 * as long as the skew lasts, extending the block far past the intended two
 * minutes.
 */
function threadHasQueuedTurnStart(
  thread: {
    readonly messages: ReadonlyArray<{ readonly role: string; readonly createdAt: string }>;
    readonly latestTurn: {
      readonly requestedAt: string;
      readonly startedAt: string | null;
      readonly completedAt: string | null;
    } | null;
    readonly session: { readonly status: string } | null;
  },
  occurredAt: string,
): boolean {
  const latestUserMessageAtMs = thread.messages.reduce(
    (latest, message) =>
      message.role === "user" ? Math.max(latest, Date.parse(message.createdAt)) : latest,
    Number.NEGATIVE_INFINITY,
  );
  const latestTurnAtMs =
    thread.latestTurn === null
      ? Number.NEGATIVE_INFINITY
      : Math.max(
          ...[
            thread.latestTurn.requestedAt,
            thread.latestTurn.startedAt,
            thread.latestTurn.completedAt,
          ].map((candidate) =>
            candidate == null ? Number.NEGATIVE_INFINITY : Date.parse(candidate),
          ),
        );
  const queuedAgeMs = Date.parse(occurredAt) - latestUserMessageAtMs;
  return (
    thread.session?.status !== "error" &&
    Number.isFinite(latestUserMessageAtMs) &&
    latestUserMessageAtMs > latestTurnAtMs &&
    Math.abs(queuedAgeMs) <= QUEUED_TURN_START_GRACE_MS
  );
}

function withEventBase(
  input: Pick<OrchestrationCommand, "commandId"> & {
    readonly aggregateKind: OrchestrationEvent["aggregateKind"];
    readonly aggregateId: OrchestrationEvent["aggregateId"];
    readonly occurredAt: string;
    readonly metadata?: OrchestrationEvent["metadata"];
  },
): Effect.Effect<
  Omit<OrchestrationEvent, "sequence" | "type" | "payload">,
  PlatformError.PlatformError,
  Crypto.Crypto
> {
  return Crypto.Crypto.pipe(
    Effect.flatMap((crypto) =>
      crypto.randomUUIDv4.pipe(
        Effect.map((eventId) => ({
          eventId: EventId.make(eventId),
          aggregateKind: input.aggregateKind,
          aggregateId: input.aggregateId,
          occurredAt: input.occurredAt,
          commandId: input.commandId,
          causationEventId: null,
          correlationId: input.commandId,
          metadata: input.metadata ?? {},
        })),
      ),
    ),
  );
}

type PlannedOrchestrationEvent = Omit<OrchestrationEvent, "sequence">;

type DecideOrchestrationCommandResult =
  | PlannedOrchestrationEvent
  | ReadonlyArray<PlannedOrchestrationEvent>;

const WORKFLOW_RUN_AUTHORITY = {
  createWorktree: true,
  runProvider: true,
  mutateTracker: true,
  pushBaseline: false,
  createDraftPullRequest: false,
} as const;

const WORKFLOW_RUN_READ_ONLY_AUTHORITY = {
  ...WORKFLOW_RUN_AUTHORITY,
  mutateTracker: false,
} as const;

function workflowRunBlockers(
  configuration: WorkflowRunConfiguration,
  attachment: OrchestrationThread["workflowAttachment"],
): ReadonlyArray<string> {
  const scopeIds = new Set(configuration.runScope.map((node) => node.nodeId));
  const blockers: Array<string> = [];
  const projectedNodeIds = new Set(attachment?.workflowGraph?.nodes.map((node) => node.id) ?? []);
  if (configuration.runScope.some((node) => !projectedNodeIds.has(node.nodeId))) {
    blockers.push("Run Scope contains a node that is not in the projected Workflow Graph.");
  }
  if (
    new Set(configuration.runScope.map((node) => node.nodeId)).size !==
    configuration.runScope.length
  ) {
    blockers.push("Run Scope contains duplicate node identities.");
  }
  if (configuration.executionLimit > configuration.environmentAutomationCapacity) {
    blockers.push("Execution Limit exceeds Environment Automation Capacity.");
  }
  if (
    stableStringify(configuration.authority) !== stableStringify(WORKFLOW_RUN_AUTHORITY) &&
    stableStringify(configuration.authority) !== stableStringify(WORKFLOW_RUN_READ_ONLY_AUTHORITY)
  ) {
    blockers.push(
      "Run authority must request the server-supported worktree/provider/tracker capabilities without push or pull-request authority.",
    );
  }
  if (!/^[0-9a-f]{40}$/i.test(configuration.fixedPoint)) {
    blockers.push("Fixed Point must be a full commit SHA.");
  }
  if (!/^[^\s/]+(?:\/[^\s/]+)*$/.test(configuration.workstreamBaseline)) {
    blockers.push("Workstream Baseline must be a branch name.");
  }
  if (!/^[^\s/]+\/\S+$/.test(configuration.remoteTarget)) {
    blockers.push("Remote Target must be remote/branch.");
  }
  const targetVerification = configuration.targetVerification;
  if (targetVerification === undefined || targetVerification.fixedPoint !== "verified") {
    blockers.push("Fixed Point was not verified by the server against the repository.");
  }
  if (targetVerification === undefined || targetVerification.workstreamBaseline !== "verified") {
    blockers.push("Workstream Baseline was not verified from the Fixed Point.");
  }
  if (targetVerification === undefined || targetVerification.remoteTarget !== "verified") {
    blockers.push("Remote Target was not verified by the server.");
  }
  for (const override of configuration.providerOverrides) {
    if (!scopeIds.has(override.nodeId)) {
      blockers.push(`Provider override ${override.nodeId} is outside the exact Run Scope.`);
    }
  }
  const requiredSkillIdentities = new Set<string>();
  for (const skill of configuration.requiredSkills) {
    const expectedProvider =
      configuration.providerOverrides.find((override) => override.nodeId === skill.nodeId)
        ?.providerInstanceId ?? configuration.defaultProviderInstanceId;
    if (!scopeIds.has(skill.nodeId)) {
      blockers.push(`Required Skill ${skill.skill.name} is outside the exact Run Scope.`);
    }
    if (skill.providerInstanceId !== expectedProvider) {
      blockers.push(`Required Skill ${skill.skill.name} is not pinned to its selected provider.`);
    }
    const identity = `${skill.nodeId}:${skill.providerInstanceId}:${skill.stage}:${skill.skill.name}`;
    if (!requiredSkillIdentities.add(identity)) {
      blockers.push(`Required Skill ${skill.skill.name} has a duplicate dispatch identity.`);
    }
    if (skill.status !== "available") {
      blockers.push(`Required Skill ${skill.skill.name} is ${skill.status}.`);
    }
    if (skill.status === "available" && skill.skill.contentDigest === undefined) {
      blockers.push(`Required Skill ${skill.skill.name} has no server-pinned content digest.`);
    }
  }
  return blockers;
}

interface WorkflowSpecificationDispatchContext {
  readonly originThread: OrchestrationThread;
  readonly attachment: WorkflowAttachment;
  readonly requiredSkill: WorkflowRunRequiredSkill;
  readonly providerInstanceId: ProviderInstanceId;
  readonly capabilityBlocked?: string;
}

type WorkflowSpecificationDispatchValidation =
  | { readonly context: WorkflowSpecificationDispatchContext }
  | { readonly detail: string }
  | null;

function workflowSpecificationContextForHandoff(input: {
  readonly readModel: OrchestrationReadModel;
  readonly action: Extract<SkillInvocation["action"], { readonly id: "handoff-to-spec" }>;
  readonly workstreamId: WorkstreamId;
  readonly providerInstanceId: ProviderInstanceId;
  readonly invocation: Pick<SkillInvocation, "skill">;
}): WorkflowSpecificationDispatchValidation {
  const originThread = input.readModel.threads.find(
    (thread) => thread.id === input.action.sourceThreadId,
  );
  const attachment = originThread?.workflowAttachment;
  if (originThread === undefined || attachment === undefined) return null;
  if (attachment.workstreamId !== input.workstreamId) {
    return { detail: "Specification provenance does not match the attached Workflow Run." };
  }
  const workflowRun = attachment.workflowRun;
  if (workflowRun === undefined || workflowRun.status !== "confirmed") {
    return { detail: "Specification dispatch requires a confirmed Workflow Run." };
  }
  const scopeIds = new Set(workflowRun.configuration.runScope.map((node) => node.nodeId));
  const specificationSkills = workflowRun.configuration.requiredSkills.filter(
    (candidate) =>
      candidate.stage === "specification" &&
      candidate.skill.name === input.invocation.skill.name &&
      scopeIds.has(candidate.nodeId),
  );
  if (specificationSkills.length === 0) {
    return {
      context: {
        originThread,
        attachment,
        providerInstanceId: input.providerInstanceId,
        requiredSkill: {
          nodeId: `workflow:${input.workstreamId}`,
          providerInstanceId: input.providerInstanceId,
          stage: "specification",
          skill: {
            name: input.invocation.skill.name,
            ...(input.invocation.skill.path !== undefined
              ? { path: input.invocation.skill.path }
              : {}),
            ...(input.invocation.skill.contentDigest !== undefined
              ? { contentDigest: input.invocation.skill.contentDigest }
              : {}),
          },
          status: "missing",
        },
        capabilityBlocked: "The confirmed Run has no pinned to-spec capability.",
      },
    };
  }
  const requiredSkill = specificationSkills.find(
    (candidate) => candidate.providerInstanceId === input.providerInstanceId,
  );
  if (requiredSkill === undefined) {
    return {
      context: {
        originThread,
        attachment,
        providerInstanceId: input.providerInstanceId,
        requiredSkill: {
          ...specificationSkills[0]!,
          providerInstanceId: input.providerInstanceId,
          status: "missing",
        },
        capabilityBlocked: "The selected Specification provider has no pinned to-spec capability.",
      },
    };
  }
  const capabilityBlocked =
    requiredSkill.status !== "available"
      ? `The pinned Specification Required Skill is ${requiredSkill.status}.`
      : requiredSkill.skill.path === undefined || requiredSkill.skill.contentDigest === undefined
        ? "The pinned Specification Required Skill has no verified capability identity."
        : requiredSkill.skill.path !== input.invocation.skill.path ||
            requiredSkill.skill.contentDigest !== input.invocation.skill.contentDigest
          ? "The requested to-spec skill does not match the immutable pinned Required Skill."
          : undefined;
  const existingStage = attachment.specificationStage;
  if (
    existingStage !== undefined &&
    existingStage.status !== "failed" &&
    existingStage.status !== "stopped" &&
    existingStage.status !== "capability-blocked"
  ) {
    return {
      detail: `Specification stage is already ${existingStage.status} and cannot be dispatched again.`,
    };
  }
  return {
    context: {
      originThread,
      attachment,
      requiredSkill,
      providerInstanceId: input.providerInstanceId,
      ...(capabilityBlocked !== undefined ? { capabilityBlocked } : {}),
    },
  };
}

interface WorkflowTicketingDispatchContext {
  readonly originThread: OrchestrationThread;
  readonly attachment: WorkflowAttachment;
  readonly requiredSkill: WorkflowRunRequiredSkill;
  readonly providerInstanceId: ProviderInstanceId;
  readonly sourceWorkflowPrdArtifactId: string;
  readonly capabilityBlocked?: string;
}

type WorkflowTicketingDispatchValidation =
  | { readonly context: WorkflowTicketingDispatchContext }
  | { readonly detail: string }
  | null;

function workflowTicketingContextForHandoff(input: {
  readonly readModel: OrchestrationReadModel;
  readonly action: Extract<SkillInvocation["action"], { readonly id: "handoff-to-tickets" }>;
  readonly workstreamId: WorkstreamId;
  readonly providerInstanceId: ProviderInstanceId;
  readonly invocation: Pick<SkillInvocation, "skill">;
}): WorkflowTicketingDispatchValidation {
  const sourceThread = input.readModel.threads.find(
    (thread) => thread.id === input.action.sourceThreadId,
  );
  const originThread =
    sourceThread?.workflowAttachment !== undefined
      ? sourceThread
      : input.readModel.threads.find(
          (thread) => thread.workflowAttachment?.workstreamId === input.workstreamId,
        );
  const attachment = originThread?.workflowAttachment;
  if (sourceThread === undefined || originThread === undefined || attachment === undefined) {
    return null;
  }
  if (attachment.workstreamId !== input.workstreamId) {
    return { detail: "Ticketing provenance does not match the attached Workflow Run." };
  }
  const specificationStage = attachment.specificationStage;
  if (
    specificationStage === undefined ||
    specificationStage.specificationThreadId !== sourceThread.id ||
    specificationStage.skillRunId !== input.action.sourceSkillRunId ||
    specificationStage.status !== "completed" ||
    specificationStage.artifactId !== input.action.sourceWorkflowPrdArtifactId
  ) {
    return { detail: "Ticketing provenance must reference the completed Specification Skill Run." };
  }
  const workflowRun = attachment.workflowRun;
  if (workflowRun === undefined || workflowRun.status !== "confirmed") {
    return { detail: "Ticketing dispatch requires a confirmed Workflow Run." };
  }
  const currentPrd = attachment.workflowGraph?.artifacts.find(
    (artifact) =>
      artifact.kind === "workflow-prd" &&
      artifact.state === "current" &&
      artifact.id === input.action.sourceWorkflowPrdArtifactId &&
      artifact.version === input.action.sourceWorkflowPrdVersion,
  );
  if (currentPrd === undefined) {
    return {
      detail:
        "Ticketing provenance must name the current authorized Workflow PRD artifact and version.",
    };
  }
  const scopeIds = new Set(workflowRun.configuration.runScope.map((node) => node.nodeId));
  const ticketingSkills = workflowRun.configuration.requiredSkills.filter(
    (candidate) =>
      candidate.stage === "ticketing" &&
      candidate.skill.name === input.invocation.skill.name &&
      scopeIds.has(candidate.nodeId),
  );
  if (ticketingSkills.length === 0) {
    return {
      context: {
        originThread,
        attachment,
        providerInstanceId: input.providerInstanceId,
        sourceWorkflowPrdArtifactId: currentPrd.id,
        requiredSkill: {
          nodeId: `workflow:${input.workstreamId}`,
          providerInstanceId: input.providerInstanceId,
          stage: "ticketing",
          skill: {
            name: input.invocation.skill.name,
            ...(input.invocation.skill.path !== undefined
              ? { path: input.invocation.skill.path }
              : {}),
            ...(input.invocation.skill.contentDigest !== undefined
              ? { contentDigest: input.invocation.skill.contentDigest }
              : {}),
          },
          status: "missing",
        },
        capabilityBlocked: "The confirmed Run has no pinned to-tickets capability.",
      },
    };
  }
  const requiredSkill = ticketingSkills.find(
    (candidate) => candidate.providerInstanceId === input.providerInstanceId,
  );
  if (requiredSkill === undefined) {
    return {
      context: {
        originThread,
        attachment,
        providerInstanceId: input.providerInstanceId,
        sourceWorkflowPrdArtifactId: currentPrd.id,
        requiredSkill: {
          ...ticketingSkills[0]!,
          providerInstanceId: input.providerInstanceId,
          status: "missing",
        },
        capabilityBlocked: "The selected Ticketing provider has no pinned to-tickets capability.",
      },
    };
  }
  const capabilityBlocked =
    requiredSkill.status !== "available"
      ? `The pinned Ticketing Required Skill is ${requiredSkill.status}.`
      : requiredSkill.skill.path === undefined || requiredSkill.skill.contentDigest === undefined
        ? "The pinned Ticketing Required Skill has no verified capability identity."
        : requiredSkill.skill.path !== input.invocation.skill.path ||
            requiredSkill.skill.contentDigest !== input.invocation.skill.contentDigest
          ? "The requested to-tickets skill does not match the immutable pinned Required Skill."
          : undefined;
  const existingStage = attachment.ticketingStage;
  if (
    existingStage !== undefined &&
    existingStage.status !== "failed" &&
    existingStage.status !== "stopped" &&
    existingStage.status !== "capability-blocked"
  ) {
    return {
      detail: `Ticketing stage is already ${existingStage.status} and cannot be dispatched again.`,
    };
  }
  return {
    context: {
      originThread,
      attachment,
      requiredSkill,
      providerInstanceId: input.providerInstanceId,
      sourceWorkflowPrdArtifactId: currentPrd.id,
      ...(capabilityBlocked !== undefined ? { capabilityBlocked } : {}),
    },
  };
}

function workflowSpecificationForThread(
  readModel: OrchestrationReadModel,
  thread: OrchestrationThread,
): {
  readonly originThread: OrchestrationThread;
  readonly attachment: WorkflowAttachment;
  readonly stage: WorkflowSpecificationStage;
} | null {
  const originThread = readModel.threads.find(
    (candidate) =>
      candidate.workflowAttachment?.specificationStage?.specificationThreadId === thread.id,
  );
  const attachment = originThread?.workflowAttachment;
  const stage = attachment?.specificationStage;
  if (
    originThread === undefined ||
    attachment === undefined ||
    stage === undefined ||
    stage.specificationThreadId !== thread.id
  ) {
    return null;
  }
  return { originThread, attachment, stage };
}

function workflowTicketingForThread(
  readModel: OrchestrationReadModel,
  thread: OrchestrationThread,
): {
  readonly originThread: OrchestrationThread;
  readonly attachment: WorkflowAttachment;
  readonly stage: WorkflowTicketingStage;
} | null {
  const originThread = readModel.threads.find(
    (candidate) => candidate.workflowAttachment?.ticketingStage?.ticketingThreadId === thread.id,
  );
  const attachment = originThread?.workflowAttachment;
  const stage = attachment?.ticketingStage;
  if (
    originThread === undefined ||
    attachment === undefined ||
    stage === undefined ||
    stage.ticketingThreadId !== thread.id
  ) {
    return null;
  }
  return { originThread, attachment, stage };
}

function workflowTicketImplementations(attachment: WorkflowAttachment) {
  return attachment.ticketImplementations ?? [];
}

function workflowAutomationStatus(attachment: WorkflowAttachment) {
  return attachment.workflowRun?.automationStatus ?? "idle";
}

function workflowBaselineRefreshBlocksAutomation(attachment: WorkflowAttachment): boolean {
  return (
    attachment.baselineRefresh?.status === "previewing" ||
    attachment.baselineRefresh?.status === "ready" ||
    attachment.baselineRefresh?.status === "draining" ||
    attachment.baselineRefresh?.status === "refreshing" ||
    attachment.baselineRefresh?.status === "needs-recovery"
  );
}

function withWorkflowBaselineRefreshActions(
  refresh: WorkflowBaselineRefresh,
): WorkflowBaselineRefresh {
  const canPreflight = ["ready", "needs-recovery", "completed"].includes(refresh.status);
  const canConfirm =
    refresh.status === "ready" && refresh.currentCommit !== null && refresh.sourceCommit !== null;
  return {
    ...refresh,
    allowedActions: [
      ...(canPreflight
        ? [
            {
              id: "preflight" as const,
              label: refresh.status === "needs-recovery" ? "Retry preview" : "Refresh preview",
              enabled: true,
              reason: null,
            },
          ]
        : []),
      ...(canConfirm
        ? [
            {
              id: "confirm" as const,
              label: "Confirm baseline refresh",
              enabled: true,
              reason: null,
            },
          ]
        : []),
    ],
  };
}

function workflowIntegrationLaneBusy(
  attachment: WorkflowAttachment,
  exceptImplementationId?: string,
): boolean {
  return workflowTicketImplementations(attachment).some(
    (implementation) =>
      implementation.id !== exceptImplementationId &&
      (implementation.status === "integrating" ||
        (implementation.status === "stopping" && implementation.recoveryPhase === "integration") ||
        (implementation.status === "needs-recovery" &&
          implementation.recoveryPhase === "integration")),
  );
}

function canonicalWorkflowBlockersIntegrated(
  attachment: WorkflowAttachment,
  blockedBy: ReadonlyArray<number>,
): boolean {
  const trackerProjection =
    attachment.trackerProjection ?? attachment.ticketingStage?.trackerProjection;
  if (trackerProjection?.status !== "healthy") return false;
  const ticketsByNumber = new Map(
    trackerProjection.tickets.map((ticket) => [ticket.number, ticket]),
  );
  return blockedBy.every((blockerNumber) => {
    const ticket = ticketsByNumber.get(blockerNumber);
    return ticket !== undefined && isIntegratedWorkflowTrackerTicket(ticket);
  });
}

const activeTicketImplementationStatuses = new Set<WorkflowTicketImplementationStatus>([
  "dispatching",
  "implementing",
  "reviewing",
  "stopping",
]);
const workflowStageSkills = new Set(["wayfinder", "to-spec", "to-tickets"]);

function isActiveProviderTurn(thread: OrchestrationThread): boolean {
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

function automaticDispatchCapacity(
  readModel: OrchestrationReadModel,
  attachment: WorkflowAttachment,
): {
  readonly available: boolean;
  readonly reason: string | null;
} {
  const workflowThreads = readModel.threads.filter(
    (thread) =>
      thread.workflowAttachment?.originThreadId === thread.id &&
      thread.workflowAttachment.workflowRun !== undefined,
  );
  if (workflowThreads.length === 0) {
    return { available: false, reason: "No confirmed Workflow Run capacity is available." };
  }

  const environmentCapacity = Math.min(
    ...workflowThreads.map(
      (thread) =>
        thread.workflowAttachment!.workflowRun!.configuration.environmentAutomationCapacity,
    ),
  );
  const implementationThreadIds = new Set(
    workflowThreads.flatMap(
      (thread) =>
        thread
          .workflowAttachment!.ticketImplementations?.map(
            (implementation) => implementation.implementationThreadId,
          )
          .filter((threadId): threadId is ThreadId => threadId !== null) ?? [],
    ),
  );
  const activeImplementations = workflowThreads.reduce(
    (count, thread) =>
      count +
      (thread.workflowAttachment!.ticketImplementations ?? []).filter((implementation) =>
        activeTicketImplementationStatuses.has(implementation.status),
      ).length,
    0,
  );
  const activeUnmodeledTurns = readModel.threads.filter((thread) => {
    if (implementationThreadIds.has(thread.id) || !isActiveProviderTurn(thread)) return false;
    return workflowThreads.some((origin) => {
      const workstreamId = origin.workflowAttachment!.workstreamId;
      return (
        thread.id === origin.id ||
        thread.latestTurn?.skillInvocation?.reconnectWorkstreamId === workstreamId
      );
    });
  }).length;
  if (activeImplementations + activeUnmodeledTurns >= environmentCapacity) {
    return {
      available: false,
      reason: `Environment Automation Capacity ${environmentCapacity} is already reserved by active provider runs.`,
    };
  }

  const workstreamThreads = workflowThreads.filter(
    (thread) => thread.workflowAttachment!.workstreamId === attachment.workstreamId,
  );
  const workstreamActiveImplementations = workstreamThreads.reduce(
    (count, thread) =>
      count +
      (thread.workflowAttachment!.ticketImplementations ?? []).filter((implementation) =>
        activeTicketImplementationStatuses.has(implementation.status),
      ).length,
    0,
  );
  const workstreamActiveUnmodeledTurns = readModel.threads.filter((thread) => {
    if (implementationThreadIds.has(thread.id) || !isActiveProviderTurn(thread)) return false;
    return workstreamThreads.some(
      (origin) =>
        thread.id === origin.id ||
        thread.latestTurn?.skillInvocation?.reconnectWorkstreamId === attachment.workstreamId,
    );
  }).length;
  const executionLimit = Math.min(
    ...workstreamThreads.map(
      (thread) => thread.workflowAttachment!.workflowRun!.configuration.executionLimit,
    ),
  );
  if (workstreamActiveImplementations + workstreamActiveUnmodeledTurns >= executionLimit) {
    return {
      available: false,
      reason: `Workstream execution limit ${executionLimit} is already reserved by active provider runs.`,
    };
  }
  return { available: true, reason: null };
}

function workflowTicketImplementationCorrectionCycles(
  implementation: WorkflowTicketImplementation,
) {
  return implementation.correctionCycles ?? [];
}

function blockingReviewFindings(
  review: WorkflowCodeReviewEvidence | null,
): ReadonlyArray<WorkflowCodeReviewFinding> {
  return review?.findings.filter(isBlockingWorkflowCodeReviewFinding) ?? [];
}

function implementationRequiredSkill(input: {
  readonly attachment: WorkflowAttachment;
  readonly nodeId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly stage: "implementation" | "review";
  readonly skillName: "implement" | "code-review";
}): WorkflowRunRequiredSkill | null {
  const workflowRun = input.attachment.workflowRun;
  if (workflowRun === undefined) return null;
  const candidates = workflowRun.configuration.requiredSkills.filter(
    (candidate) =>
      candidate.stage === input.stage &&
      candidate.skill.name === input.skillName &&
      candidate.providerInstanceId === input.providerInstanceId &&
      candidate.status === "available" &&
      candidate.skill.path !== undefined &&
      candidate.skill.contentDigest !== undefined &&
      (candidate.nodeId === input.nodeId ||
        candidate.nodeId === `workflow:${input.attachment.workstreamId}`),
  );
  return candidates[0] ?? null;
}

function ticketImplementationAvailability(input: {
  readonly attachment: WorkflowAttachment;
  readonly node: Extract<
    NonNullable<WorkflowAttachment["workflowGraph"]>["nodes"][number],
    {
      readonly kind: "ticket";
    }
  >;
}): WorkflowTicketImplementationAvailability {
  const implementation = workflowTicketImplementations(input.attachment).find(
    (candidate) => candidate.nodeId === input.node.id,
  );
  if (implementation !== undefined) {
    switch (implementation.status) {
      case "dispatching":
      case "implementing":
      case "reviewing":
      case "integrating":
        return {
          status: "active",
          canStart: false,
          reason: `Ticket Implementation is ${implementation.status}.`,
        };
      case "stopping":
        return {
          status: "stopping",
          canStart: false,
          reason: "Provider interruption is still awaiting a typed terminal outcome.",
        };
      case "needs-recovery":
        return {
          status: "needs-recovery",
          canStart: false,
          reason: "The accepted Ticket Implementation needs an explicit recovery action.",
        };
      case "cancelled":
        return {
          status: "cancelled",
          canStart: false,
          reason: "The cancelled Ticket Implementation does not satisfy required work.",
        };
      case "checkpointed":
        return {
          status: "checkpointed",
          canStart: false,
          reason: "Ticket Implementation reached a native Workflow Checkpoint and awaits recovery.",
        };
      case "reviewed":
        return {
          status: "reviewed",
          canStart: false,
          reason: "Ticket Implementation is reviewed and awaits downstream integration.",
        };
      case "integration-failed":
        return {
          status: "integration-failed",
          canStart: false,
          reason: "Tracker synchronization failed after integration; retry tracker closure.",
        };
      case "integrated":
        return {
          status: "integrated",
          canStart: false,
          reason: "Ticket Implementation is integrated and tracker synchronization is confirmed.",
        };
      case "needs-correction":
        return {
          status: "needs-correction",
          canStart: true,
          reason: "A fresh correction cycle may retry this Ticket Implementation.",
        };
      case "needs-decision":
        return {
          status: "needs-decision",
          canStart: false,
          reason: "Automatic correction cycles are exhausted; a user decision is required.",
        };
      case "failed":
        return {
          status: "failed",
          canStart: true,
          reason: "The previous Ticket Implementation failed before its review gate.",
        };
    }
  }
  if (input.node.state !== "current" || input.node.held === true) {
    return {
      status: "blocked",
      canStart: false,
      reason: "The ticket is stale or held.",
    };
  }
  const workflowRun = input.attachment.workflowRun;
  if (workflowRun?.status !== "confirmed") {
    return {
      status: "blocked",
      canStart: false,
      reason: "A confirmed Workflow Run is required.",
    };
  }
  const inScope = workflowRun.configuration.runScope.some(
    (scope) => scope.nodeId === input.node.id,
  );
  if (!inScope || !input.node.includedInRun) {
    return {
      status: "blocked",
      canStart: false,
      reason: "The ticket is outside the confirmed Workflow Run scope.",
    };
  }
  const trackerProjection =
    input.attachment.trackerProjection ?? input.attachment.ticketingStage?.trackerProjection;
  const trackerTicket = trackerProjection?.tickets.find(
    (ticket) =>
      ticket.number === input.node.ticketNumber &&
      (ticket.key === null || ticket.key === input.node.ticketKey),
  );
  if (trackerProjection?.status !== "healthy" || trackerTicket === undefined) {
    return {
      status: "blocked",
      canStart: false,
      reason: "A healthy tracker projection is required.",
    };
  }
  if (
    trackerTicket.state !== "open" ||
    !canonicalWorkflowBlockersIntegrated(input.attachment, trackerTicket.blockedBy) ||
    trackerTicket.includedInRun !== true ||
    trackerTicket.body === undefined
  ) {
    return {
      status: "blocked",
      canStart: false,
      reason:
        "The ticket must be open, have only Integrated Ticket blockers, be in scope, and carry acceptance criteria.",
    };
  }
  const providerInstanceId =
    workflowRun.configuration.providerOverrides.find(
      (override) => override.nodeId === input.node.id,
    )?.providerInstanceId ?? workflowRun.configuration.defaultProviderInstanceId;
  if (
    implementationRequiredSkill({
      attachment: input.attachment,
      nodeId: input.node.id,
      providerInstanceId,
      stage: "implementation",
      skillName: "implement",
    }) === null ||
    implementationRequiredSkill({
      attachment: input.attachment,
      nodeId: input.node.id,
      providerInstanceId,
      stage: "review",
      skillName: "code-review",
    }) === null
  ) {
    return {
      status: "blocked",
      canStart: false,
      reason: "The confirmed provider must expose pinned implementation and review skills.",
    };
  }
  return {
    status: "available",
    canStart: true,
    reason: "The ticket is an executable Workflow Frontier node.",
  };
}

function refreshTicketImplementationAvailability(
  attachment: WorkflowAttachment,
): WorkflowAttachment {
  const graph = attachment.workflowGraph;
  if (graph === undefined) return attachment;
  return {
    ...attachment,
    workflowGraph: {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.kind === "ticket"
          ? {
              ...node,
              implementationAvailability: ticketImplementationAvailability({ attachment, node }),
            }
          : node,
      ),
    },
  };
}

function workflowTicketImplementationStatusTransitionAllowed(
  current: WorkflowTicketImplementationStatus,
  next: WorkflowTicketImplementationStatus,
): boolean {
  if (current === next) return true;
  switch (current) {
    case "dispatching":
      return next === "implementing" || next === "failed";
    case "implementing":
      return (
        next === "reviewing" || next === "checkpointed" || next === "failed" || next === "stopping"
      );
    case "reviewing":
      return next === "checkpointed" || next === "failed" || next === "stopping";
    case "stopping":
      return next === "needs-recovery";
    case "needs-recovery":
      return (
        next === "implementing" ||
        next === "reviewing" ||
        next === "integrating" ||
        next === "cancelled"
      );
    case "cancelled":
    case "checkpointed":
      return false;
    case "reviewed":
      return next === "integrating";
    case "integrating":
      return (
        next === "integrating" ||
        next === "integration-failed" ||
        next === "integrated" ||
        next === "needs-recovery"
      );
    case "integration-failed":
      return next === "integrating";
    case "needs-correction":
    case "needs-decision":
    case "failed":
    case "integrated":
      return false;
  }
}

function workflowTicketImplementationEventBase(input: {
  readonly command: Extract<
    OrchestrationCommand,
    | { readonly type: "thread.workflow.ticket-implementation.start" }
    | { readonly type: "thread.workflow.ticket-implementation.update" }
    | { readonly type: "thread.workflow.ticket-integration.retry" }
    | { readonly type: "thread.workflow.ticket-implementation.checkpoint" }
    | { readonly type: "thread.workflow.ticket-implementation.review.record" }
    | { readonly type: "thread.workflow.ticket-implementation.stop" }
    | { readonly type: "thread.workflow.ticket-implementation.recover" }
    | { readonly type: "thread.workflow.ticket-implementation.correction.start" }
  >;
  readonly attachment: WorkflowAttachment;
  readonly implementation: WorkflowTicketImplementation;
  readonly eventType:
    | "thread.workflow-ticket-implementation-requested"
    | "thread.workflow-ticket-implementation-updated"
    | "thread.workflow-ticket-implementation-checkpointed";
}): Effect.Effect<PlannedOrchestrationEvent, PlatformError.PlatformError, Crypto.Crypto> {
  return withEventBase({
    aggregateKind: "thread",
    aggregateId: input.command.threadId,
    occurredAt: input.command.createdAt,
    commandId: input.command.commandId,
  }).pipe(
    Effect.map(
      (eventBase) =>
        ({
          ...eventBase,
          type: input.eventType,
          payload:
            input.eventType === "thread.workflow-ticket-implementation-requested"
              ? {
                  threadId: input.command.threadId,
                  implementation: input.implementation,
                  attachment: input.attachment,
                  createdAt: input.command.createdAt,
                }
              : {
                  threadId: input.command.threadId,
                  implementation: input.implementation,
                  attachment: input.attachment,
                },
        }) as PlannedOrchestrationEvent,
    ),
  );
}

function workflowTicketImplementationRecoveryEventBase(input: {
  readonly command: Extract<
    OrchestrationCommand,
    { readonly type: "thread.workflow.ticket-implementation.recover" }
  >;
  readonly attachment: WorkflowAttachment;
  readonly implementation: WorkflowTicketImplementation;
  readonly action: Extract<
    OrchestrationCommand,
    { readonly type: "thread.workflow.ticket-implementation.recover" }
  >["action"];
  readonly checkpointTurnCount?: number;
}): Effect.Effect<PlannedOrchestrationEvent, PlatformError.PlatformError, Crypto.Crypto> {
  return withEventBase({
    aggregateKind: "thread",
    aggregateId: input.command.threadId,
    occurredAt: input.command.createdAt,
    commandId: input.command.commandId,
  }).pipe(
    Effect.map(
      (eventBase) =>
        ({
          ...eventBase,
          type: "thread.workflow-ticket-implementation-recovery-requested",
          payload: {
            threadId: input.command.threadId,
            implementationId: input.implementation.id,
            implementationThreadId: input.implementation.implementationThreadId!,
            action: input.action,
            ...(input.checkpointTurnCount === undefined
              ? {}
              : { checkpointTurnCount: input.checkpointTurnCount }),
            implementation: input.implementation,
            attachment: input.attachment,
            createdAt: input.command.createdAt,
          },
        }) as PlannedOrchestrationEvent,
    ),
  );
}

function incrementWorkflowVersion(attachment: WorkflowAttachment): WorkflowAttachment {
  return {
    ...attachment,
    workflowVersion: (attachment.workflowVersion ?? 0) + 1,
  };
}

function workflowAutomationEvent(input: {
  readonly command: {
    readonly commandId: CommandId;
    readonly threadId: ThreadId;
    readonly createdAt: string;
  };
  readonly attachment: WorkflowAttachment;
  readonly eventType:
    | "thread.workflow-run-started"
    | "thread.workflow-run-draining"
    | "thread.workflow-run-paused"
    | "thread.workflow-run-resumed"
    | "thread.workflow-node-held"
    | "thread.workflow-node-released";
}): Effect.Effect<PlannedOrchestrationEvent, PlatformError.PlatformError, Crypto.Crypto> {
  return withEventBase({
    aggregateKind: "thread",
    aggregateId: input.command.threadId,
    occurredAt: input.command.createdAt,
    commandId: input.command.commandId,
  }).pipe(
    Effect.map(
      (eventBase) =>
        ({
          ...eventBase,
          type: input.eventType,
          payload: {
            threadId: input.command.threadId,
            attachment: input.attachment,
          },
        }) as PlannedOrchestrationEvent,
    ),
  );
}

function workflowTicketBatchValidation(batch: WorkflowTicketBatch): string | null {
  const keys = new Set<string>();
  for (const ticket of batch.tickets) {
    if (!keys.add(ticket.key)) return `Ticket Batch contains duplicate ticket key '${ticket.key}'.`;
    if (ticket.parentKey === ticket.key) {
      return `Ticket '${ticket.key}' cannot be its own parent.`;
    }
  }
  for (const ticket of batch.tickets) {
    if (ticket.parentKey !== null && !keys.has(ticket.parentKey)) {
      return `Ticket '${ticket.key}' names unknown parent '${ticket.parentKey}'.`;
    }
  }
  const edges = new Set<string>();
  for (const edge of batch.blockerEdges) {
    if (edge.blockedKey === edge.blockerKey) {
      return `Ticket '${edge.blockedKey}' cannot block itself.`;
    }
    if (!keys.has(edge.blockedKey) || !keys.has(edge.blockerKey)) {
      return `Ticket Batch contains a blocker edge outside the exact approved batch.`;
    }
    const edgeKey = `${edge.blockedKey}:${edge.blockerKey}`;
    if (!edges.add(edgeKey)) return `Ticket Batch contains duplicate blocker edge '${edgeKey}'.`;
  }
  return null;
}

function workflowCheckpointFromActivity(input: {
  readonly activity: OrchestrationThread["activities"][number];
  readonly stage: WorkflowSpecificationStage;
}): WorkflowCheckpointRequest | null {
  if (input.activity.kind !== "user-input.requested") return null;
  if (input.activity.turnId === null) return null;
  const payload = Option.getOrUndefined(
    decodeWorkflowCheckpointActivityPayload(input.activity.payload),
  );
  if (payload === undefined || payload.skillRunId !== input.stage.skillRunId) return null;
  if (payload.questions.length === 0) return null;
  return {
    requestId: payload.requestId,
    kind: "specification-test-seam",
    workstreamId: input.stage.workstreamId,
    originThreadId: input.stage.originThreadId,
    specificationThreadId: input.stage.specificationThreadId,
    skillRunId: input.stage.skillRunId,
    questions: payload.questions,
    status: "pending",
    requestedAt: input.activity.createdAt,
  };
}

function workflowTicketingCheckpointFromActivity(input: {
  readonly activity: OrchestrationThread["activities"][number];
  readonly stage: WorkflowTicketingStage;
}): WorkflowTicketingCheckpointRequest | null {
  if (input.activity.kind !== "user-input.requested") return null;
  if (input.activity.turnId === null) return null;
  const payload = Option.getOrUndefined(
    decodeWorkflowTicketingCheckpointActivityPayload(input.activity.payload),
  );
  if (payload === undefined || payload.skillRunId !== input.stage.skillRunId) return null;
  if (payload.questions.length === 0) return null;
  return {
    requestId: payload.requestId,
    kind: "ticketing-granularity-blockers",
    workstreamId: input.stage.workstreamId,
    originThreadId: input.stage.originThreadId,
    ticketingThreadId: input.stage.ticketingThreadId,
    skillRunId: input.stage.skillRunId,
    sourceWorkflowPrdArtifactId: input.stage.sourceWorkflowPrdArtifactId,
    approvedBatch: payload.batch,
    questions: payload.questions,
    status: "pending",
    requestedAt: input.activity.createdAt,
  };
}

function synchronizeWorkflowAttachment(input: {
  readonly command: Pick<OrchestrationCommand, "commandId"> & {
    readonly threadId: OrchestrationThread["id"];
    readonly createdAt: string;
  };
  readonly thread: OrchestrationThread;
  readonly skillRunId: SkillInvocation["skillRunId"];
  readonly sourceInvocation?: SkillInvocation;
  readonly sourceStage: WorkflowArtifactSourceStage;
  readonly data: WorkflowAttachmentWayfinderData;
}): Effect.Effect<PlannedOrchestrationEvent | null, PlatformError.PlatformError, Crypto.Crypto> {
  if (
    !isCompatibleWorkflowWayfinderSource({
      thread: input.thread,
      skillRunId: input.skillRunId,
      ...(input.sourceInvocation !== undefined ? { sourceInvocation: input.sourceInvocation } : {}),
    })
  ) {
    return Effect.succeed(null);
  }
  const currentAttachment = input.thread.workflowAttachment;
  if (currentAttachment === undefined) {
    return Effect.succeed(null);
  }
  const attachment = synchronizeWorkflowAttachmentWayfinderData({
    attachment: currentAttachment,
    sourceSkillRunId: input.skillRunId,
    sourceStage: input.sourceStage,
    observedAt: input.command.createdAt,
    data: input.data,
  });
  if (stableStringify(attachment) === stableStringify(currentAttachment)) {
    return Effect.succeed(null);
  }
  return withEventBase({
    aggregateKind: "thread",
    aggregateId: input.command.threadId,
    occurredAt: input.command.createdAt,
    commandId: input.command.commandId,
  }).pipe(
    Effect.map(
      (eventBase): PlannedOrchestrationEvent => ({
        ...eventBase,
        type: "thread.workflow-synchronized",
        payload: {
          threadId: input.command.threadId,
          attachment,
        },
      }),
    ),
  );
}

const decideCommandSequence = Effect.fn("decideCommandSequence")(function* ({
  commands,
  readModel,
}: {
  readonly commands: ReadonlyArray<OrchestrationCommand>;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<
  ReadonlyArray<PlannedOrchestrationEvent>,
  OrchestrationCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  let nextReadModel = readModel;
  let nextSequence = readModel.snapshotSequence;
  const plannedEvents: PlannedOrchestrationEvent[] = [];

  for (const nextCommand of commands) {
    const decided = yield* decideOrchestrationCommand({
      command: nextCommand,
      readModel: nextReadModel,
    });
    const nextEvents = Array.isArray(decided) ? decided : [decided];
    for (const nextEvent of nextEvents) {
      plannedEvents.push(nextEvent);
      nextSequence += 1;
      nextReadModel = yield* projectEvent(nextReadModel, {
        ...nextEvent,
        sequence: nextSequence,
      }).pipe(Effect.orDie);
    }
  }

  return plannedEvents;
});

export const decideOrchestrationCommand = Effect.fn("decideOrchestrationCommand")(function* ({
  command,
  readModel,
}: {
  readonly command: OrchestrationCommand;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<
  DecideOrchestrationCommandResult,
  OrchestrationCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  switch (command.type) {
    case "project.create": {
      yield* requireProjectAbsent({
        readModel,
        command,
        projectId: command.projectId,
      });
      yield* requireActiveProjectWorkspaceRootAbsent({
        readModel,
        command,
        workspaceRoot: command.workspaceRoot,
        exceptProjectId: command.projectId,
      });

      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "project.created",
        payload: {
          projectId: command.projectId,
          title: command.title,
          workspaceRoot: command.workspaceRoot,
          defaultModelSelection: command.defaultModelSelection ?? null,
          scripts: [],
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "project.meta.update": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      if (command.workspaceRoot !== undefined) {
        yield* requireActiveProjectWorkspaceRootAbsent({
          readModel,
          command,
          workspaceRoot: command.workspaceRoot,
          exceptProjectId: command.projectId,
        });
      }

      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "project.meta-updated",
        payload: {
          projectId: command.projectId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.workspaceRoot !== undefined ? { workspaceRoot: command.workspaceRoot } : {}),
          ...(command.defaultModelSelection !== undefined
            ? { defaultModelSelection: command.defaultModelSelection }
            : {}),
          ...(command.scripts !== undefined ? { scripts: command.scripts } : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "project.delete": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const activeThreads = listThreadsByProjectId(readModel, command.projectId).filter(
        (thread) => thread.deletedAt === null,
      );
      if (activeThreads.length > 0 && command.force !== true) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Project '${command.projectId}' is not empty and cannot be deleted without force=true.`,
        });
      }
      if (activeThreads.length > 0) {
        return yield* decideCommandSequence({
          readModel,
          commands: [
            ...activeThreads.map(
              (thread): Extract<OrchestrationCommand, { type: "thread.delete" }> => ({
                type: "thread.delete",
                commandId: command.commandId,
                threadId: thread.id,
              }),
            ),
            {
              type: "project.delete",
              commandId: command.commandId,
              projectId: command.projectId,
            },
          ],
        });
      }

      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "project.deleted" as const,
        payload: {
          projectId: command.projectId,
          deletedAt: occurredAt,
        },
      };
    }

    case "thread.create": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      yield* requireThreadAbsent({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.created",
        payload: {
          threadId: command.threadId,
          projectId: command.projectId,
          title: command.title,
          modelSelection: command.modelSelection,
          runtimeMode: command.runtimeMode,
          interactionMode: command.interactionMode,
          branch: command.branch,
          worktreePath: command.worktreePath,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.delete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.deleted",
        payload: {
          threadId: command.threadId,
          deletedAt: occurredAt,
        },
      };
    }

    case "thread.archive": {
      yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.archived",
        payload: {
          threadId: command.threadId,
          archivedAt: occurredAt,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.unarchive": {
      yield* requireThreadArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.unarchived",
        payload: {
          threadId: command.threadId,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.settle": {
      const thread = yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      // Server-side twin of the client's canSettle session check: a stale
      // or raced client must not settle a thread whose session is coming
      // alive or working.
      if (thread.session?.status === "starting" || thread.session?.status === "running") {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `thread ${command.threadId} has an active session and cannot be settled`,
          }),
        );
      }
      // Pending approval / user-input requests are blocked-on-you work: a
      // raced or stale client must not park them behind a settled override
      // that would surface only after the request resolves.
      if (hasOpenBlockingRequest(thread)) {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `thread ${command.threadId} has a pending approval or user-input request and cannot be settled`,
          }),
        );
      }
      const occurredAt = yield* nowIso;
      // Settling inside the adoption window would hide just-requested work.
      if (threadHasQueuedTurnStart(thread, occurredAt)) {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `thread ${command.threadId} has a queued turn start and cannot be settled`,
          }),
        );
      }
      // Settling an already-settled thread re-emits with the original
      // settledAt: the engine rejects zero-event commands, and bulk-settle /
      // double-click must stay silent no-ops rather than surface errors.
      const alreadySettled = thread.settledOverride === "settled" && thread.settledAt !== null;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.settled",
        payload: {
          threadId: command.threadId,
          settledAt: alreadySettled ? thread.settledAt : occurredAt,
          // A re-emission is a projected no-op: keep the existing updatedAt
          // so duplicate settles neither rewind nor churn ordering. A fresh
          // settle stamps the command time.
          updatedAt: alreadySettled ? thread.updatedAt : occurredAt,
        },
      };
    }

    case "thread.unsettle": {
      const thread = yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      // Idempotent by re-emission (see thread.settle): reducing the event a
      // second time lands on the same override state. A re-emission keeps
      // the existing updatedAt so duplicates do not churn ordering.
      const alreadyPinnedActive = thread.settledOverride === "active";
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.unsettled",
        payload: {
          threadId: command.threadId,
          reason: command.reason,
          updatedAt: alreadyPinnedActive ? thread.updatedAt : occurredAt,
        },
      };
    }

    case "thread.snooze": {
      const thread = yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      // A wake time in the past would create a thread that is snoozed and
      // woken at once — the row would never leave the inbox but still carry
      // snooze state. Reject instead of silently normalizing. The negated
      // comparison also catches unparseable wake times (IsoDateTime is
      // structurally just a string): NaN fails every comparison, and an
      // unparseable snoozedUntil must never persist.
      if (!(Date.parse(command.snoozedUntil) > Date.parse(occurredAt))) {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `thread ${command.threadId} snooze wake time ${command.snoozedUntil} is not in the future`,
          }),
        );
      }
      // Blocked-on-you work must not be snoozed away: a pending approval or
      // user-input request is the agent waiting on the user, and hiding it
      // defeats the request. (A running session IS snoozable — snooze only
      // affects visibility, never the agent.)
      if (hasOpenBlockingRequest(thread)) {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `thread ${command.threadId} has a pending approval or user-input request and cannot be snoozed`,
          }),
        );
      }
      // A queued turn start — a user message no turn has adopted yet — is
      // invisible pending work: no session, no pending flags. Snoozing in
      // that window would hide a just-requested turn exactly the way settle
      // would.
      if (threadHasQueuedTurnStart(thread, occurredAt)) {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `thread ${command.threadId} has a queued turn start and cannot be snoozed`,
          }),
        );
      }
      // Re-snoozing an already-snoozed thread to the SAME wake time is a
      // duplicate (double-click, raced clients): re-emit with the original
      // timestamps so the projection is a no-op. A different wake time is a
      // real change and stamps fresh.
      const existingSnoozedAt =
        thread.snoozedUntil === command.snoozedUntil && thread.snoozedAt != null
          ? thread.snoozedAt
          : null;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.snoozed",
        payload: {
          threadId: command.threadId,
          snoozedUntil: command.snoozedUntil,
          snoozedAt: existingSnoozedAt ?? occurredAt,
          updatedAt: existingSnoozedAt !== null ? thread.updatedAt : occurredAt,
        },
      };
    }

    case "thread.unsnooze": {
      const thread = yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      // Idempotent by re-emission (see thread.settle): waking a thread that
      // is not snoozed lands on the same null state without churning
      // updatedAt.
      const alreadyAwake = thread.snoozedUntil == null;
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.unsnoozed",
        payload: {
          threadId: command.threadId,
          reason: command.reason,
          updatedAt: alreadyAwake ? thread.updatedAt : occurredAt,
        },
      };
    }

    case "thread.meta.update": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const branch =
        command.branch !== undefined &&
        command.expectedBranch !== undefined &&
        thread.branch !== command.expectedBranch
          ? thread.branch
          : command.branch;
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.meta-updated",
        payload: {
          threadId: command.threadId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.regenerateTitle === true
            ? {
                regenerateTitle: true as const,
                previousTitle: thread.title,
                titleRegeneration: {
                  requestId: command.commandId,
                  startedAt: occurredAt,
                },
              }
            : {}),
          ...(command.title !== undefined && thread.titleRegeneration != null
            ? { titleRegeneration: null }
            : {}),
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(branch !== undefined ? { branch } : {}),
          ...(command.worktreePath !== undefined ? { worktreePath: command.worktreePath } : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.title.regeneration.complete": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const requestIsCurrent = thread.titleRegeneration?.requestId === command.requestId;
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.meta-updated",
        payload: {
          threadId: command.threadId,
          ...(requestIsCurrent && command.title !== undefined ? { title: command.title } : {}),
          ...(requestIsCurrent ? { titleRegeneration: null } : {}),
          updatedAt: requestIsCurrent ? occurredAt : thread.updatedAt,
        },
      };
    }

    case "thread.runtime-mode.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.runtime-mode-set",
        payload: {
          threadId: command.threadId,
          runtimeMode: command.runtimeMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.interaction-mode.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.interaction-mode-set",
        payload: {
          threadId: command.threadId,
          interactionMode: command.interactionMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.turn.start": {
      const targetThread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const sourceProposedPlan = command.sourceProposedPlan;
      const sourceThread = sourceProposedPlan
        ? yield* requireThread({
            readModel,
            command,
            threadId: sourceProposedPlan.threadId,
          })
        : null;
      const sourcePlan =
        sourceProposedPlan && sourceThread
          ? sourceThread.proposedPlans.find((entry) => entry.id === sourceProposedPlan.planId)
          : null;
      if (sourceProposedPlan && !sourcePlan) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourceProposedPlan.planId}' does not exist on thread '${sourceProposedPlan.threadId}'.`,
        });
      }
      if (sourceThread && sourceThread.projectId !== targetThread.projectId) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourceProposedPlan?.planId}' belongs to thread '${sourceThread.id}' in a different project.`,
        });
      }
      const requestedSkillInvocation = command.skillInvocation;
      const staleWorkflowAttachment = staleWorkflowAttachmentForInvocation(
        readModel,
        requestedSkillInvocation,
      );
      if (staleWorkflowAttachment !== undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail:
            "This Development Workflow has stale structured Wayfinder data. Accept the upstream update from its Origin Thread before dispatching downstream work.",
        });
      }
      const handoffAction =
        requestedSkillInvocation?.action?.id === "handoff-to-spec"
          ? requestedSkillInvocation.action
          : null;
      const ticketingHandoffAction =
        requestedSkillInvocation?.action?.id === "handoff-to-tickets"
          ? requestedSkillInvocation.action
          : null;
      let handoffWorkstreamId: WorkstreamId | null = null;
      if (handoffAction !== null) {
        if (
          requestedSkillInvocation?.skill.name !== "to-spec" ||
          requestedSkillInvocation.execution.mode !== "generic"
        ) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Wayfinder handoff requires generic to-spec execution.",
          });
        }
        const wayfinderThread = yield* requireThread({
          readModel,
          command,
          threadId: handoffAction.sourceThreadId,
        });
        const wayfinderInvocation = wayfinderThread.latestTurn?.skillInvocation;
        if (wayfinderThread.projectId !== targetThread.projectId) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail:
              "to-spec provenance must reference a native Wayfinder map in the target project.",
          });
        }
        const latestTurnHasSource =
          wayfinderInvocation?.skillRunId === handoffAction.sourceSkillRunId &&
          wayfinderInvocation.skill.name === "wayfinder" &&
          wayfinderInvocation.execution.mode === "native" &&
          wayfinderInvocation.wayfinderMap !== undefined;
        if (!latestTurnHasSource) {
          if (requestedSkillInvocation.reconnectWorkstreamId === undefined) {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: "to-spec provenance must resolve from a durable Wayfinder Skill Run.",
            });
          }
          handoffWorkstreamId = requestedSkillInvocation.reconnectWorkstreamId;
        } else {
          const wayfinderMap = wayfinderInvocation.wayfinderMap;
          const synchronizedAt =
            wayfinderInvocation.wayfinderSynchronizedAt ?? wayfinderMap.lastSynchronizedAt;
          if (
            handoffAction.canonicalReference.number !== wayfinderMap.canonicalReference.number ||
            handoffAction.canonicalReference.url !== wayfinderMap.canonicalReference.url ||
            handoffAction.wayfinderSynchronizedAt !== synchronizedAt
          ) {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: "to-spec provenance does not match the canonical synchronized Wayfinder map.",
            });
          }
          const activeLinkedTicketNumbers = readModel.threads.flatMap((thread) => {
            const invocation = thread.latestTurn?.skillInvocation;
            const action = invocation?.action?.id === "work-ticket" ? invocation.action : null;
            const active =
              thread.latestTurn?.state === "running" ||
              thread.session?.status === "starting" ||
              thread.session?.status === "running";
            return invocation?.workstreamId === wayfinderInvocation.workstreamId &&
              action !== null &&
              active
              ? [action.ticketNumber]
              : [];
          });
          const readiness = deriveWayfinderReadiness({
            map: wayfinderMap,
            synchronization: wayfinderInvocation.wayfinderSynchronization ?? null,
            activeLinkedTicketNumbers,
          });
          if (!readiness.ready && !handoffAction.acknowledgedIncomplete) {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: `Acknowledge the incomplete Wayfinder map before early to-spec handoff. Blockers: ${readiness.blockers.map((blocker) => blocker.kind).join(", ")}.`,
            });
          }
          if (
            requestedSkillInvocation.reconnectWorkstreamId !== undefined &&
            requestedSkillInvocation.reconnectWorkstreamId !== wayfinderInvocation.workstreamId
          ) {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: "to-spec reconnect Workstream does not match its Wayfinder provenance.",
            });
          }
          handoffWorkstreamId = wayfinderInvocation.workstreamId;
        }
      }
      let ticketingWorkstreamId: WorkstreamId | null = null;
      if (ticketingHandoffAction !== null) {
        if (requestedSkillInvocation?.skill.name !== "to-tickets") {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Workflow ticketing handoff requires the to-tickets skill.",
          });
        }
        const specificationThread = yield* requireThread({
          readModel,
          command,
          threadId: ticketingHandoffAction.sourceThreadId,
        });
        if (specificationThread.projectId !== targetThread.projectId) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail:
              "Ticketing provenance must reference the Specification stage in the target project.",
          });
        }
        const specificationInvocation = specificationThread.latestTurn?.skillInvocation;
        if (
          specificationInvocation?.skillRunId === ticketingHandoffAction.sourceSkillRunId &&
          specificationInvocation.workstreamId !== undefined &&
          specificationInvocation.skill.name === "to-spec"
        ) {
          ticketingWorkstreamId = specificationInvocation.workstreamId;
        } else if (requestedSkillInvocation.reconnectWorkstreamId !== undefined) {
          ticketingWorkstreamId = requestedSkillInvocation.reconnectWorkstreamId;
        } else {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Ticketing provenance must resolve from the durable Specification Skill Run.",
          });
        }
      }
      let workflowSpecificationContext: WorkflowSpecificationDispatchContext | null = null;
      if (
        handoffAction !== null &&
        requestedSkillInvocation !== undefined &&
        handoffWorkstreamId !== null
      ) {
        const validation = workflowSpecificationContextForHandoff({
          readModel,
          action: handoffAction,
          workstreamId: handoffWorkstreamId,
          providerInstanceId:
            command.modelSelection?.instanceId ?? targetThread.modelSelection.instanceId,
          invocation: requestedSkillInvocation,
        });
        if (validation !== null && "detail" in validation) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: validation.detail,
          });
        }
        workflowSpecificationContext = validation?.context ?? null;
      }
      let workflowTicketingContext: WorkflowTicketingDispatchContext | null = null;
      if (
        ticketingHandoffAction !== null &&
        requestedSkillInvocation !== undefined &&
        ticketingWorkstreamId !== null
      ) {
        const validation = workflowTicketingContextForHandoff({
          readModel,
          action: ticketingHandoffAction,
          workstreamId: ticketingWorkstreamId,
          providerInstanceId:
            command.modelSelection?.instanceId ?? targetThread.modelSelection.instanceId,
          invocation: requestedSkillInvocation,
        });
        if (validation === null) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Ticketing provenance could not resolve the authorized Workflow Run.",
          });
        }
        if ("detail" in validation) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: validation.detail,
          });
        }
        workflowTicketingContext = validation.context;
      }
      const skillInvocation: SkillInvocation | undefined = requestedSkillInvocation
        ? {
            skill: requestedSkillInvocation.skill,
            ...(requestedSkillInvocation.arguments !== undefined
              ? { arguments: requestedSkillInvocation.arguments }
              : {}),
            ...(requestedSkillInvocation.action !== undefined
              ? { action: requestedSkillInvocation.action }
              : {}),
            execution: requestedSkillInvocation.execution,
            ...(requestedSkillInvocation.wayfinderMap !== undefined
              ? { wayfinderMap: requestedSkillInvocation.wayfinderMap }
              : {}),
            ...(requestedSkillInvocation.wayfinderSynchronizedAt !== undefined
              ? { wayfinderSynchronizedAt: requestedSkillInvocation.wayfinderSynchronizedAt }
              : {}),
            ...(requestedSkillInvocation.wayfinderSynchronization !== undefined
              ? { wayfinderSynchronization: requestedSkillInvocation.wayfinderSynchronization }
              : {}),
            workstreamId:
              handoffWorkstreamId ??
              ticketingWorkstreamId ??
              requestedSkillInvocation.reconnectWorkstreamId ??
              WorkstreamId.make(
                `workstream:${yield* Crypto.Crypto.pipe(Effect.flatMap((crypto) => crypto.randomUUIDv4))}`,
              ),
            skillRunId: SkillRunId.make(
              `skill-run:${yield* Crypto.Crypto.pipe(Effect.flatMap((crypto) => crypto.randomUUIDv4))}`,
            ),
            projectId: targetThread.projectId,
            threadId: command.threadId,
            createdAt: command.createdAt,
            ...(command.skillInvocation.skill.name === "wayfinder" &&
            command.skillInvocation.execution.mode === "native" &&
            command.skillInvocation.action?.id === "new-map"
              ? { wayfinderDraft: createEmptyWayfinderDraft(command.createdAt) }
              : {}),
          }
        : undefined;
      const workflowSpecificationCapabilityBlockedEvent =
        workflowSpecificationContext?.capabilityBlocked !== undefined &&
        skillInvocation !== undefined
          ? yield* withEventBase({
              aggregateKind: "thread",
              aggregateId: workflowSpecificationContext.originThread.id,
              occurredAt: command.createdAt,
              commandId: command.commandId,
            }).pipe(
              Effect.map(
                (eventBase): Omit<OrchestrationEvent, "sequence"> => ({
                  ...eventBase,
                  type: "thread.workflow-specification-failed",
                  payload: {
                    threadId: workflowSpecificationContext.originThread.id,
                    attachment: incrementWorkflowVersion({
                      ...workflowSpecificationContext.attachment,
                      specificationStage: {
                        status: "capability-blocked",
                        workstreamId: workflowSpecificationContext.attachment.workstreamId,
                        nodeId: workflowSpecificationContext.requiredSkill.nodeId,
                        originThreadId: workflowSpecificationContext.originThread.id,
                        specificationThreadId: command.threadId,
                        skillRunId: skillInvocation.skillRunId,
                        providerInstanceId: workflowSpecificationContext.providerInstanceId,
                        skill: skillInvocation.skill,
                        failure: workflowSpecificationContext.capabilityBlocked,
                        startedAt: command.createdAt,
                        updatedAt: command.createdAt,
                      },
                    }),
                  },
                }),
              ),
            )
          : null;
      const workflowTicketingCapabilityBlockedEvent =
        workflowTicketingContext?.capabilityBlocked !== undefined && skillInvocation !== undefined
          ? yield* withEventBase({
              aggregateKind: "thread",
              aggregateId: workflowTicketingContext.originThread.id,
              occurredAt: command.createdAt,
              commandId: command.commandId,
            }).pipe(
              Effect.map(
                (eventBase): Omit<OrchestrationEvent, "sequence"> => ({
                  ...eventBase,
                  type: "thread.workflow-ticketing-failed",
                  payload: {
                    threadId: workflowTicketingContext.originThread.id,
                    attachment: incrementWorkflowVersion({
                      ...workflowTicketingContext.attachment,
                      ticketingStage: {
                        status: "capability-blocked",
                        workstreamId: workflowTicketingContext.attachment.workstreamId,
                        nodeId: workflowTicketingContext.requiredSkill.nodeId,
                        originThreadId: workflowTicketingContext.originThread.id,
                        ticketingThreadId: command.threadId,
                        skillRunId: skillInvocation.skillRunId,
                        providerInstanceId: workflowTicketingContext.providerInstanceId,
                        skill: skillInvocation.skill,
                        sourceWorkflowPrdArtifactId:
                          workflowTicketingContext.sourceWorkflowPrdArtifactId,
                        failure: workflowTicketingContext.capabilityBlocked,
                        startedAt: command.createdAt,
                        updatedAt: command.createdAt,
                      },
                    }),
                  },
                }),
              ),
            )
          : null;
      const userMessageEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          role: "user",
          text: command.message.text,
          attachments: command.message.attachments,
          turnId: null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
      const turnStartRequestedEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        causationEventId: userMessageEvent.eventId,
        type: "thread.turn-start-requested",
        payload: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(command.titleSeed !== undefined ? { titleSeed: command.titleSeed } : {}),
          runtimeMode: targetThread.runtimeMode,
          interactionMode: targetThread.interactionMode,
          ...(sourceProposedPlan !== undefined ? { sourceProposedPlan } : {}),
          ...(skillInvocation !== undefined ? { skillInvocation } : {}),
          createdAt: command.createdAt,
        },
      };
      const draftStartedEvent =
        skillInvocation?.wayfinderDraft !== undefined
          ? yield* withEventBase({
              aggregateKind: "thread",
              aggregateId: command.threadId,
              occurredAt: command.createdAt,
              commandId: command.commandId,
            }).pipe(
              Effect.map(
                (eventBase): Omit<OrchestrationEvent, "sequence"> => ({
                  ...eventBase,
                  causationEventId: turnStartRequestedEvent.eventId,
                  type: "thread.activity-appended",
                  payload: {
                    threadId: command.threadId,
                    activity: {
                      id: eventBase.eventId,
                      tone: "info",
                      kind: "wayfinder.draft.started",
                      summary: "Unpublished Wayfinder draft started",
                      payload: {
                        workstreamId: skillInvocation.workstreamId,
                        skillRunId: skillInvocation.skillRunId,
                        canonical: false,
                      },
                      turnId: null,
                      createdAt: command.createdAt,
                    },
                  },
                }),
              ),
            )
          : null;
      // A Development Workflow attachment is never inferred from prose or
      // from a generic skill. A native, structured Wayfinder invocation can
      // offer exactly one durable hint for this Origin Thread; the later
      // attach command still requires the user to name and confirm the goal.
      const workflowAttachmentHintEvent =
        skillInvocation !== undefined &&
        isWorkflowAttachableWayfinderInvocation(skillInvocation) &&
        targetThread.workflowAttachment === undefined &&
        targetThread.workflowAttachmentHint === undefined
          ? yield* withEventBase({
              aggregateKind: "thread",
              aggregateId: command.threadId,
              occurredAt: command.createdAt,
              commandId: command.commandId,
            }).pipe(
              Effect.map(
                (eventBase): Omit<OrchestrationEvent, "sequence"> => ({
                  ...eventBase,
                  causationEventId: turnStartRequestedEvent.eventId,
                  type: "thread.workflow-attachment-hinted",
                  payload: {
                    threadId: command.threadId,
                    hint: {
                      status: "available",
                      sourceSkillRunId: skillInvocation.skillRunId,
                      workstreamId: skillInvocation.workstreamId,
                      backfilledWayfinderData:
                        backfillWorkflowAttachmentWayfinderData(skillInvocation),
                      offeredAt: command.createdAt,
                      updatedAt: command.createdAt,
                    },
                  },
                }),
              ),
            )
          : null;
      const workflowSynchronized =
        skillInvocation?.wayfinderMap !== undefined
          ? yield* synchronizeWorkflowAttachment({
              command,
              thread: targetThread,
              skillRunId: skillInvocation.skillRunId,
              sourceInvocation: skillInvocation,
              sourceStage: "reconciliation",
              data: {
                wayfinderMap: skillInvocation.wayfinderMap,
                wayfinderSynchronizedAt:
                  skillInvocation.wayfinderSynchronizedAt ??
                  skillInvocation.wayfinderMap.lastSynchronizedAt,
                ...(skillInvocation.wayfinderSynchronization !== undefined
                  ? { wayfinderSynchronization: skillInvocation.wayfinderSynchronization }
                  : {}),
              },
            })
          : null;
      const workflowSpecificationDispatchedEvent =
        workflowSpecificationContext !== null &&
        workflowSpecificationContext.capabilityBlocked === undefined &&
        skillInvocation !== undefined
          ? yield* withEventBase({
              aggregateKind: "thread",
              aggregateId: workflowSpecificationContext.originThread.id,
              occurredAt: command.createdAt,
              commandId: command.commandId,
            }).pipe(
              Effect.map(
                (eventBase): Omit<OrchestrationEvent, "sequence"> => ({
                  ...eventBase,
                  causationEventId: turnStartRequestedEvent.eventId,
                  type: "thread.workflow-specification-dispatched",
                  payload: {
                    threadId: workflowSpecificationContext.originThread.id,
                    attachment: incrementWorkflowVersion({
                      ...workflowSpecificationContext.attachment,
                      specificationStage: {
                        status: "running",
                        workstreamId: workflowSpecificationContext.attachment.workstreamId,
                        nodeId: workflowSpecificationContext.requiredSkill.nodeId,
                        originThreadId: workflowSpecificationContext.originThread.id,
                        specificationThreadId: command.threadId,
                        skillRunId: skillInvocation.skillRunId,
                        providerInstanceId: workflowSpecificationContext.providerInstanceId,
                        skill: skillInvocation.skill,
                        startedAt: command.createdAt,
                        updatedAt: command.createdAt,
                      },
                    }),
                  },
                }),
              ),
            )
          : null;
      const workflowTicketingDispatchedEvent =
        workflowTicketingContext !== null &&
        workflowTicketingContext.capabilityBlocked === undefined &&
        skillInvocation !== undefined
          ? yield* withEventBase({
              aggregateKind: "thread",
              aggregateId: workflowTicketingContext.originThread.id,
              occurredAt: command.createdAt,
              commandId: command.commandId,
            }).pipe(
              Effect.map(
                (eventBase): Omit<OrchestrationEvent, "sequence"> => ({
                  ...eventBase,
                  causationEventId: turnStartRequestedEvent.eventId,
                  type: "thread.workflow-ticketing-dispatched",
                  payload: {
                    threadId: workflowTicketingContext.originThread.id,
                    attachment: incrementWorkflowVersion({
                      ...workflowTicketingContext.attachment,
                      ticketingStage: {
                        status: "running",
                        workstreamId: workflowTicketingContext.attachment.workstreamId,
                        nodeId: workflowTicketingContext.requiredSkill.nodeId,
                        originThreadId: workflowTicketingContext.originThread.id,
                        ticketingThreadId: command.threadId,
                        skillRunId: skillInvocation.skillRunId,
                        providerInstanceId: workflowTicketingContext.providerInstanceId,
                        skill: skillInvocation.skill,
                        sourceWorkflowPrdArtifactId:
                          workflowTicketingContext.sourceWorkflowPrdArtifactId,
                        startedAt: command.createdAt,
                        updatedAt: command.createdAt,
                      },
                    }),
                  },
                }),
              ),
            )
          : null;
      // Real activity resets ANY override: it wakes an explicitly settled
      // thread, and it clears a keep-active pin back to neutral so the
      // thread can auto-settle again after this burst of work goes stale.
      // A snooze clears the same way — sending a message to a snoozed
      // thread is the user re-engaging, so the return ticket is spent.
      const lifecycleResetEvents: Array<Omit<OrchestrationEvent, "sequence">> = [];
      if (targetThread.settledOverride !== null) {
        lifecycleResetEvents.push({
          ...(yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          })),
          type: "thread.unsettled",
          payload: {
            threadId: command.threadId,
            reason: "activity",
            updatedAt: command.createdAt,
          },
        });
      }
      if (targetThread.snoozedUntil != null) {
        lifecycleResetEvents.push({
          ...(yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          })),
          type: "thread.unsnoozed",
          payload: {
            threadId: command.threadId,
            reason: "activity",
            updatedAt: command.createdAt,
          },
        });
      }
      if (workflowSpecificationCapabilityBlockedEvent !== null) {
        return [workflowSpecificationCapabilityBlockedEvent];
      }
      if (workflowTicketingCapabilityBlockedEvent !== null) {
        return [workflowTicketingCapabilityBlockedEvent];
      }
      return [
        ...lifecycleResetEvents,
        userMessageEvent,
        turnStartRequestedEvent,
        ...(draftStartedEvent ? [draftStartedEvent] : []),
        ...(workflowAttachmentHintEvent ? [workflowAttachmentHintEvent] : []),
        ...(workflowSynchronized ? [workflowSynchronized] : []),
        ...(workflowSpecificationDispatchedEvent ? [workflowSpecificationDispatchedEvent] : []),
        ...(workflowTicketingDispatchedEvent ? [workflowTicketingDispatchedEvent] : []),
      ];
    }

    case "thread.turn.interrupt": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.turn-interrupt-requested",
        payload: {
          threadId: command.threadId,
          ...(command.turnId !== undefined ? { turnId: command.turnId } : {}),
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.approval.respond": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const acceptsExecutableAction =
        command.decision === "accept" || command.decision === "acceptForSession";
      if (acceptsExecutableAction && hasActiveWayfinderDraftAuthority(thread.activities)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail:
            "Executable approvals are disabled while the Wayfinder map is an unpublished draft, ensuring GitHub remains unchanged.",
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        })),
        type: "thread.approval-response-requested",
        payload: {
          threadId: command.threadId,
          requestId: command.requestId,
          decision: command.decision,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.user-input.respond": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const workflowCheckpoint = readModel.threads.flatMap((originThread) => {
        const attachment = originThread.workflowAttachment;
        const checkpoint = attachment?.specificationStage?.checkpoint;
        return checkpoint?.requestId === command.requestId
          ? [{ originThread, attachment: attachment as WorkflowAttachment, checkpoint }]
          : [];
      })[0];
      const workflowTicketingCheckpoint = readModel.threads.flatMap((originThread) => {
        const attachment = originThread.workflowAttachment;
        const checkpoint = attachment?.ticketingStage?.checkpoint;
        return checkpoint?.requestId === command.requestId
          ? [{ originThread, attachment: attachment as WorkflowAttachment, checkpoint }]
          : [];
      })[0];
      if (workflowTicketingCheckpoint !== undefined) {
        const stage = workflowTicketingCheckpoint.attachment.ticketingStage;
        if (stage === undefined || stage.ticketingThreadId !== command.threadId) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "The Ticketing checkpoint response targeted the wrong thread.",
          });
        }
        if (workflowTicketingCheckpoint.checkpoint.status !== "pending") {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "The Ticketing checkpoint response is stale or already resolved.",
          });
        }
        const nextAttachment = incrementWorkflowVersion({
          ...workflowTicketingCheckpoint.attachment,
          ticketingStage: {
            ...stage,
            status: "running",
            checkpoint: {
              ...workflowTicketingCheckpoint.checkpoint,
              status: "resolved",
              resolvedAt: command.createdAt,
              answers: command.answers,
            },
            updatedAt: command.createdAt,
          },
        });
        const workflowCheckpointResolvedEvent: Omit<OrchestrationEvent, "sequence"> = {
          ...(yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: workflowTicketingCheckpoint.originThread.id,
            occurredAt: command.createdAt,
            commandId: command.commandId,
            metadata: { requestId: command.requestId },
          })),
          type: "thread.workflow-ticketing-checkpoint-resolved",
          payload: {
            threadId: workflowTicketingCheckpoint.originThread.id,
            attachment: nextAttachment,
          },
        };
        const providerResponseEvent: Omit<OrchestrationEvent, "sequence"> = {
          ...(yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
            metadata: { requestId: command.requestId },
          })),
          type: "thread.user-input-response-requested",
          payload: {
            threadId: command.threadId,
            requestId: command.requestId,
            answers: command.answers,
            createdAt: command.createdAt,
          },
        };
        return [workflowCheckpointResolvedEvent, providerResponseEvent];
      }
      if (workflowCheckpoint !== undefined) {
        const stage = workflowCheckpoint.attachment.specificationStage;
        if (stage === undefined || stage.specificationThreadId !== command.threadId) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "The Specification checkpoint response targeted the wrong thread.",
          });
        }
        if (workflowCheckpoint.checkpoint.status !== "pending") {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "The Specification checkpoint response is stale or already resolved.",
          });
        }
        const nextAttachment = incrementWorkflowVersion({
          ...workflowCheckpoint.attachment,
          specificationStage: {
            ...stage,
            status: "running",
            checkpoint: {
              ...workflowCheckpoint.checkpoint,
              status: "resolved",
              resolvedAt: command.createdAt,
              answers: command.answers,
            },
            updatedAt: command.createdAt,
          },
        });
        const workflowCheckpointResolvedEvent: Omit<OrchestrationEvent, "sequence"> = {
          ...(yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: workflowCheckpoint.originThread.id,
            occurredAt: command.createdAt,
            commandId: command.commandId,
            metadata: { requestId: command.requestId },
          })),
          type: "thread.workflow-specification-checkpoint-resolved",
          payload: {
            threadId: workflowCheckpoint.originThread.id,
            attachment: nextAttachment,
          },
        };
        const providerResponseEvent: Omit<OrchestrationEvent, "sequence"> = {
          ...(yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
            metadata: { requestId: command.requestId },
          })),
          type: "thread.user-input-response-requested",
          payload: {
            threadId: command.threadId,
            requestId: command.requestId,
            answers: command.answers,
            createdAt: command.createdAt,
          },
        };
        return [workflowCheckpointResolvedEvent, providerResponseEvent];
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        })),
        type: "thread.user-input-response-requested",
        payload: {
          threadId: command.threadId,
          requestId: command.requestId,
          answers: command.answers,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.workflow-attachment.hint.dismiss": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const hint = thread.workflowAttachmentHint;
      if (hint === undefined || hint.status !== "available") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "No available structured Wayfinder hint can be dismissed.",
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.workflow-attachment-hint-dismissed",
        payload: {
          threadId: command.threadId,
          hint: {
            ...hint,
            status: "dismissed",
            updatedAt: command.createdAt,
          },
        },
      };
    }

    case "thread.workflow.attach": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      if (command.originThreadId !== thread.id) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Workflow attachment must explicitly confirm this origin thread.",
        });
      }
      if (thread.workflowAttachment !== undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "This origin thread is already attached to a Development Workflow.",
        });
      }
      const hint = thread.workflowAttachmentHint;
      if (hint === undefined || hint.status !== "available") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Workflow attachment requires an available structured Wayfinder hint.",
        });
      }
      const attachmentBase = {
        originThreadId: command.originThreadId,
        workstreamId: hint.workstreamId,
        sourceSkillRunId: hint.sourceSkillRunId,
        workflowGoal: command.workflowGoal,
        backfilledWayfinderData: hint.backfilledWayfinderData,
        observationCursor: {
          sourceSkillRunId: hint.sourceSkillRunId,
          observedAt: command.createdAt,
          ...(hint.backfilledWayfinderData.wayfinderSynchronizedAt !== undefined
            ? {
                wayfinderSynchronizedAt: hint.backfilledWayfinderData.wayfinderSynchronizedAt,
              }
            : {}),
        },
        attachedAt: command.createdAt,
      };
      const attachment = {
        ...attachmentBase,
        workflowGraph: initializeWorkflowGraph(attachmentBase),
      };
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.workflow-attached",
        payload: {
          threadId: command.threadId,
          hint: {
            ...hint,
            status: "attached",
            updatedAt: command.createdAt,
          },
          attachment,
        },
      };
    }

    case "thread.workflow.run.preflight": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const attachment = thread.workflowAttachment;
      if (attachment === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Workflow Run preflight requires an attached Workstream.",
        });
      }
      if (attachment.workflowRun !== undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "This Workstream already has a confirmed Workflow Run.",
        });
      }
      if (command.configuration.workflowGoal !== attachment.workflowGoal) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Workflow Goal must match the attached Workstream Goal.",
        });
      }
      const blockers = workflowRunBlockers(command.configuration, attachment);
      const preview = {
        configuration: command.configuration,
        status: blockers.length === 0 ? ("ready-for-confirmation" as const) : ("blocked" as const),
        blockers,
        authorityGranted: false as const,
        generatedAt: command.createdAt,
      };
      const nextAttachment = { ...attachment, workflowRunPreview: preview };
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.workflow-run-preflighted",
        payload: { threadId: command.threadId, attachment: nextAttachment },
      };
    }

    case "thread.workflow.run.confirm": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const attachment = thread.workflowAttachment;
      const preview = attachment?.workflowRunPreview;
      if (attachment === undefined || preview === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Workflow Run confirmation requires a prior read-only preflight.",
        });
      }
      if (attachment.workflowRun !== undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "This Workstream already has a confirmed Workflow Run.",
        });
      }
      if (stableStringify(preview.configuration) !== stableStringify(command.configuration)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Confirmation must match the exact preflighted Workflow Run.",
        });
      }
      if (preview.status !== "ready-for-confirmation") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: preview.blockers.join(" "),
        });
      }
      const nextAttachment = refreshTicketImplementationAvailability({
        ...attachment,
        workflowRun: {
          configuration: command.configuration,
          status: "confirmed" as const,
          authorityGranted: true as const,
          confirmedAt: command.createdAt,
          dispatchIdentity: command.commandId,
          immutableAtDispatch: command.createdAt,
        },
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.workflow-run-confirmed",
        payload: { threadId: command.threadId, attachment: nextAttachment },
      };
    }

    case "thread.workflow.run.start": {
      const thread = yield* requireThread({ readModel, command, threadId: command.threadId });
      const attachment = thread.workflowAttachment;
      const workflowRun = attachment?.workflowRun;
      if (attachment === undefined || workflowRun?.status !== "confirmed") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Starting a Workflow Run requires a confirmed Workflow Run.",
        });
      }
      if ((attachment.workflowVersion ?? 0) !== command.expectedWorkstreamVersion) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Starting a Workflow Run requires the current Workflow Projection version.",
        });
      }
      if (hasPendingWorkflowStaleness(attachment)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "The Workflow Run cannot start while upstream workflow staleness is unresolved.",
        });
      }
      if (workflowBaselineRefreshBlocksAutomation(attachment)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail:
            "The Workflow Run cannot start while a Baseline Refresh preview, drain, or recovery checkpoint is unresolved.",
        });
      }
      const status = workflowAutomationStatus(attachment);
      if (status === "running") {
        return yield* workflowAutomationEvent({
          command,
          attachment,
          eventType: "thread.workflow-run-started",
        });
      }
      if (status !== "idle") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "A draining or paused Workflow Run must use Resume Workflow Run.",
        });
      }
      return yield* workflowAutomationEvent({
        command,
        attachment: refreshTicketImplementationAvailability(
          incrementWorkflowVersion({
            ...attachment,
            workflowRun: {
              ...workflowRun,
              automationStatus: "running",
            },
          }),
        ),
        eventType: "thread.workflow-run-started",
      });
    }

    case "thread.workflow.run.pause": {
      const thread = yield* requireThread({ readModel, command, threadId: command.threadId });
      const attachment = thread.workflowAttachment;
      const workflowRun = attachment?.workflowRun;
      if (attachment === undefined || workflowRun?.status !== "confirmed") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Pausing a Workflow Run requires a confirmed Workflow Run.",
        });
      }
      if ((attachment.workflowVersion ?? 0) !== command.expectedWorkstreamVersion) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Pausing a Workflow Run requires the current Workflow Projection version.",
        });
      }
      const status = workflowAutomationStatus(attachment);
      if (status === "idle") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "An idle Workflow Run cannot be paused before it starts.",
        });
      }
      if (status === "paused") {
        return yield* workflowAutomationEvent({
          command,
          attachment,
          eventType: "thread.workflow-run-paused",
        });
      }
      if (status === "draining") {
        return yield* workflowAutomationEvent({
          command,
          attachment,
          eventType: "thread.workflow-run-draining",
        });
      }
      return yield* workflowAutomationEvent({
        command,
        attachment: refreshTicketImplementationAvailability(
          incrementWorkflowVersion({
            ...attachment,
            workflowRun: {
              ...workflowRun,
              automationStatus: "draining",
            },
          }),
        ),
        eventType: "thread.workflow-run-draining",
      });
    }

    case "thread.workflow.run.resume": {
      const thread = yield* requireThread({ readModel, command, threadId: command.threadId });
      const attachment = thread.workflowAttachment;
      const workflowRun = attachment?.workflowRun;
      if (attachment === undefined || workflowRun?.status !== "confirmed") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Resuming a Workflow Run requires a confirmed Workflow Run.",
        });
      }
      if ((attachment.workflowVersion ?? 0) !== command.expectedWorkstreamVersion) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Resuming a Workflow Run requires the current Workflow Projection version.",
        });
      }
      if (hasPendingWorkflowStaleness(attachment)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "The Workflow Run cannot resume while upstream workflow staleness is unresolved.",
        });
      }
      if (workflowBaselineRefreshBlocksAutomation(attachment)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail:
            "The Workflow Run cannot resume while the Baseline Refresh checkpoint still needs recovery.",
        });
      }
      if (workflowAutomationStatus(attachment) === "running") {
        return yield* workflowAutomationEvent({
          command,
          attachment,
          eventType: "thread.workflow-run-resumed",
        });
      }
      if (workflowAutomationStatus(attachment) === "idle") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "An idle Workflow Run must use Start Workflow Run before it can be resumed.",
        });
      }
      return yield* workflowAutomationEvent({
        command,
        attachment: refreshTicketImplementationAvailability(
          incrementWorkflowVersion({
            ...attachment,
            workflowRun: {
              ...workflowRun,
              automationStatus: "running",
            },
          }),
        ),
        eventType: "thread.workflow-run-resumed",
      });
    }

    case "thread.workflow.baseline-refresh.preflight": {
      const thread = yield* requireThread({ readModel, command, threadId: command.threadId });
      const attachment = thread.workflowAttachment;
      const workflowRun = attachment?.workflowRun;
      if (attachment === undefined || workflowRun?.status !== "confirmed") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Baseline Refresh preflight requires a confirmed Workflow Run.",
        });
      }
      if ((attachment.workflowVersion ?? 0) !== command.expectedWorkstreamVersion) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Baseline Refresh preflight has a stale Workstream version.",
        });
      }
      if (
        attachment.baselineRefresh !== undefined &&
        ["previewing", "draining", "refreshing"].includes(attachment.baselineRefresh.status)
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "A Baseline Refresh is already in progress for this Workstream.",
        });
      }
      const baselineRefresh = withWorkflowBaselineRefreshActions({
        status: "previewing",
        baselineBranch: workflowRun.configuration.workstreamBaseline,
        remoteTarget: workflowRun.configuration.remoteTarget,
        currentCommit: null,
        sourceCommit: null,
        incomingCommits: [],
        incomingFiles: [],
        affectedTickets: [],
        validations: [],
        failure: null,
        requestedAt: command.createdAt,
        updatedAt: command.createdAt,
      });
      const nextAttachment = incrementWorkflowVersion({ ...attachment, baselineRefresh });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.workflow-baseline-refresh-requested",
        payload: { threadId: command.threadId, attachment: nextAttachment },
      };
    }

    case "thread.workflow.baseline-refresh.confirm": {
      const thread = yield* requireThread({ readModel, command, threadId: command.threadId });
      const attachment = thread.workflowAttachment;
      const workflowRun = attachment?.workflowRun;
      const baselineRefresh = attachment?.baselineRefresh;
      if (attachment === undefined || workflowRun?.status !== "confirmed") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Baseline Refresh confirmation requires a confirmed Workflow Run.",
        });
      }
      if (baselineRefresh?.status !== "ready") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Baseline Refresh confirmation requires a ready preview.",
        });
      }
      if ((attachment.workflowVersion ?? 0) !== command.expectedWorkstreamVersion) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Baseline Refresh confirmation has a stale Workstream version.",
        });
      }
      if (
        baselineRefresh.currentCommit !== command.currentCommit ||
        baselineRefresh.sourceCommit !== command.sourceCommit
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Baseline Refresh confirmation must match the exact previewed commits.",
        });
      }
      const automationStatus = workflowAutomationStatus(attachment);
      if (automationStatus === "draining") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "The Workstream is already draining for a Baseline Refresh.",
        });
      }
      const nextAttachment = incrementWorkflowVersion({
        ...attachment,
        baselineRefresh: withWorkflowBaselineRefreshActions({
          ...baselineRefresh,
          status: "draining",
          failure: null,
          updatedAt: command.createdAt,
        }),
        workflowRun: {
          ...workflowRun,
          automationStatus: "draining",
        },
      });
      return yield* workflowAutomationEvent({
        command,
        attachment: nextAttachment,
        eventType: "thread.workflow-run-draining",
      });
    }

    case "thread.workflow.run.drain.complete": {
      const thread = yield* requireThread({ readModel, command, threadId: command.threadId });
      const attachment = thread.workflowAttachment;
      const workflowRun = attachment?.workflowRun;
      if (attachment === undefined || workflowRun?.status !== "confirmed") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Completing a Workflow Run drain requires a confirmed Workflow Run.",
        });
      }
      if ((attachment.workflowVersion ?? 0) !== command.expectedWorkstreamVersion) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail:
            "Completing a Workflow Run drain requires the current Workflow Projection version.",
        });
      }
      if (workflowAutomationStatus(attachment) !== "draining") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Only a draining Workflow Run can complete its drain.",
        });
      }
      if (
        workflowTicketImplementations(attachment).some(
          (implementation) =>
            ["dispatching", "implementing", "reviewing", "stopping", "integrating"].includes(
              implementation.status,
            ) ||
            (implementation.status === "needs-recovery" &&
              implementation.recoveryPhase === "integration"),
        )
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "A Workflow Run cannot finish draining while Ticket Implementations are active.",
        });
      }
      const baselineRefresh =
        attachment.baselineRefresh?.status === "draining"
          ? {
              ...attachment.baselineRefresh,
              status: "refreshing" as const,
              updatedAt: command.createdAt,
            }
          : attachment.baselineRefresh;
      return yield* workflowAutomationEvent({
        command,
        attachment: refreshTicketImplementationAvailability(
          incrementWorkflowVersion({
            ...attachment,
            ...(baselineRefresh === undefined ? {} : { baselineRefresh }),
            workflowRun: {
              ...workflowRun,
              automationStatus: "paused",
            },
          }),
        ),
        eventType: "thread.workflow-run-paused",
      });
    }

    case "thread.workflow.baseline-refresh.update": {
      const thread = yield* requireThread({ readModel, command, threadId: command.threadId });
      const attachment = thread.workflowAttachment;
      const current = attachment?.baselineRefresh;
      if (attachment === undefined || current === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Baseline Refresh update requires a prior server-owned refresh request.",
        });
      }
      if ((attachment.workflowVersion ?? 0) !== command.expectedWorkstreamVersion) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Baseline Refresh update has a stale Workstream version.",
        });
      }
      const nextBaselineRefresh = withWorkflowBaselineRefreshActions(command.baselineRefresh);
      const sameRefresh = stableStringify(current) === stableStringify(nextBaselineRefresh);
      const validTransition =
        sameRefresh ||
        (current.status === "previewing" &&
          ["ready", "needs-recovery"].includes(nextBaselineRefresh.status)) ||
        (current.status === "refreshing" &&
          ["completed", "needs-recovery"].includes(nextBaselineRefresh.status));
      if (!validTransition) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Baseline Refresh cannot transition from ${current.status} to ${nextBaselineRefresh.status}.`,
        });
      }
      const refreshedAttachment = {
        ...attachment,
        baselineRefresh: nextBaselineRefresh,
      };
      const staleAttachment =
        command.staleNodeIds === undefined
          ? refreshedAttachment
          : markWorkflowBaselineRefreshStale(
              refreshedAttachment,
              new Set(command.staleNodeIds),
              nextBaselineRefresh.updatedAt,
            );
      const nextAttachment = refreshTicketImplementationAvailability(
        incrementWorkflowVersion(staleAttachment),
      );
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.workflow-baseline-refresh-updated",
        payload: { threadId: command.threadId, attachment: nextAttachment },
      };
    }

    case "thread.workflow.node.hold":
    case "thread.workflow.node.release": {
      const thread = yield* requireThread({ readModel, command, threadId: command.threadId });
      const attachment = thread.workflowAttachment;
      if (attachment?.workflowRun?.status !== "confirmed") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Scheduling Holds require a confirmed Workflow Run.",
        });
      }
      if ((attachment.workflowVersion ?? 0) !== command.expectedWorkstreamVersion) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Changing a Scheduling Hold requires the current Workflow Projection version.",
        });
      }
      const graph = attachment.workflowGraph;
      if (
        graph === undefined ||
        !graph.nodes.some((node) => node.kind === "ticket" && node.id === command.ticketNodeId)
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "A Scheduling Hold must target a current ticket in the Workflow Graph.",
        });
      }
      const held = command.type === "thread.workflow.node.hold";
      const nextAttachment = refreshTicketImplementationAvailability(
        incrementWorkflowVersion({
          ...attachment,
          workflowGraph: {
            ...graph,
            nodes: graph.nodes.map((node) =>
              node.kind === "ticket" && node.id === command.ticketNodeId ? { ...node, held } : node,
            ),
          },
        }),
      );
      return yield* workflowAutomationEvent({
        command,
        attachment: nextAttachment,
        eventType: held ? "thread.workflow-node-held" : "thread.workflow-node-released",
      });
    }

    case "thread.workflow.artifacts.view": {
      const thread = yield* requireThread({ readModel, command, threadId: command.threadId });
      const attachment = thread.workflowAttachment;
      if (attachment === undefined || attachment.workflowGraph === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "No durable workflow artifact markers are available to view.",
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.workflow-artifacts-viewed",
        payload: {
          threadId: command.threadId,
          attachment: viewWorkflowArtifacts(attachment, command.createdAt),
        },
      };
    }

    case "thread.workflow.artifact.acknowledge": {
      const thread = yield* requireThread({ readModel, command, threadId: command.threadId });
      const attachment = thread.workflowAttachment;
      const artifact = attachment?.workflowGraph?.artifacts.find(
        (candidate) => candidate.id === command.artifactId,
      );
      if (attachment === undefined || artifact === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "The workflow artifact to acknowledge is not present in the bounded graph.",
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.workflow-artifact-acknowledged",
        payload: {
          threadId: command.threadId,
          attachment: acknowledgeWorkflowArtifact(
            attachment,
            command.artifactId,
            command.createdAt,
          ),
        },
      };
    }

    case "thread.workflow.stale.resolve": {
      const thread = yield* requireThread({ readModel, command, threadId: command.threadId });
      const attachment = thread.workflowAttachment;
      if (attachment === undefined || !hasPendingWorkflowStaleness(attachment)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "This Development Workflow has no stale downstream work to resolve.",
        });
      }
      const resolved = resolveWorkflowStaleness(attachment, command.resolution, command.createdAt);
      if (resolved === attachment) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "This stale workflow does not allow the requested resolution.",
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.workflow-stale-resolved",
        payload: {
          threadId: command.threadId,
          attachment: resolved,
        },
      };
    }

    case "thread.workflow.specification.complete": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const attachment = thread.workflowAttachment;
      const stage = attachment?.specificationStage;
      if (attachment === undefined || stage === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Specification completion requires a dispatched Specification stage.",
        });
      }
      if (
        stage.specificationThreadId !== command.specificationThreadId ||
        stage.skillRunId !== command.skillRunId
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Specification completion does not match the authorized Skill Run.",
        });
      }
      const currentWorkflowVersion = attachment.workflowVersion ?? 0;
      if (command.expectedWorkstreamVersion !== currentWorkflowVersion) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Stale Workstream version ${command.expectedWorkstreamVersion}; current version is ${currentWorkflowVersion}. Refresh the Workflow Projection before retrying.`,
        });
      }
      if (stage.status === "completed") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "The Specification stage is already completed.",
        });
      }
      if (stage.checkpoint?.status !== "resolved") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Specification completion requires the resolved native test-seam checkpoint.",
        });
      }
      const sourceArtifact = attachment.workflowGraph?.artifacts.find(
        (artifact) =>
          artifact.id === command.sourceWayfinderArtifactId &&
          artifact.kind === "wayfinder-map" &&
          artifact.state === "current",
      );
      if (sourceArtifact === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Specification completion must name the current authorized Wayfinder artifact.",
        });
      }
      const previousPrdVersion = attachment.workflowGraph?.artifacts.reduce(
        (version, artifact) =>
          artifact.kind === "workflow-prd" ? Math.max(version, artifact.version) : version,
        0,
      );
      if (previousPrdVersion !== undefined && command.prd.version <= previousPrdVersion) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Workflow PRD versions must increase monotonically.",
        });
      }
      const nextAttachment = completeWorkflowSpecification({
        attachment,
        stage,
        document: command.prd,
        sourceWayfinderArtifactId: sourceArtifact.id,
        completedAt: command.createdAt,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.workflow-specification-completed",
        payload: {
          threadId: command.threadId,
          attachment: nextAttachment,
          artifact: workflowSpecificationArtifactDetail({
            attachment,
            document: command.prd,
          }),
        },
      };
    }

    case "thread.workflow.ticketing.publish": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const attachment = thread.workflowAttachment;
      const stage = attachment?.ticketingStage;
      if (attachment === undefined || stage === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Ticket Batch publication requires a dispatched Ticketing stage.",
        });
      }
      if (
        stage.ticketingThreadId !== command.ticketingThreadId ||
        stage.skillRunId !== command.skillRunId
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Ticket Batch publication does not match the authorized Ticketing Skill Run.",
        });
      }
      const currentWorkflowVersion = attachment.workflowVersion ?? 0;
      if (command.expectedWorkstreamVersion !== currentWorkflowVersion) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Stale Workstream version ${command.expectedWorkstreamVersion}; current version is ${currentWorkflowVersion}. Refresh the Workflow Projection before retrying.`,
        });
      }
      if (stage.status === "completed") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "The Ticketing stage is already completed.",
        });
      }
      if (stage.status === "publishing") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "The approved Ticket Batch is already being published.",
        });
      }
      if (stage.checkpoint?.status !== "resolved") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail:
            "Ticket Batch publication requires the resolved native granularity and blocker checkpoint.",
        });
      }
      if (
        stage.checkpoint.approvedBatch === undefined ||
        stableStringify(stage.checkpoint.approvedBatch) !== stableStringify(command.batch)
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail:
            "Ticket Batch publication must exactly match the batch approved by the native checkpoint.",
        });
      }
      const currentPrd = attachment.workflowGraph?.artifacts.find(
        (artifact) =>
          artifact.kind === "workflow-prd" &&
          artifact.state === "current" &&
          artifact.id === command.batch.sourceWorkflowPrdArtifactId &&
          artifact.version === command.batch.sourceWorkflowPrdVersion,
      );
      if (currentPrd === undefined || currentPrd.id !== stage.sourceWorkflowPrdArtifactId) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail:
            "Ticket Batch publication must name the current authorized Workflow PRD artifact.",
        });
      }
      const batchError = workflowTicketBatchValidation(command.batch);
      if (batchError !== null) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: batchError,
        });
      }
      const publication: WorkflowTicketBatchPublication = {
        status: "publishing",
        batchId: command.batch.id,
        identities: [],
        requestedAt: command.createdAt,
        updatedAt: command.createdAt,
      };
      const nextAttachment = incrementWorkflowVersion({
        ...attachment,
        ticketingStage: {
          ...stage,
          status: "publishing",
          approvedBatch: command.batch,
          publication,
          failure: undefined,
          updatedAt: command.createdAt,
        },
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.workflow-ticket-batch-publication-requested",
        payload: {
          threadId: command.threadId,
          ticketingThreadId: command.ticketingThreadId,
          skillRunId: command.skillRunId,
          batch: command.batch,
          publication,
          attachment: nextAttachment,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.workflow.ticketing.publication.update": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const attachment = thread.workflowAttachment;
      const stage = attachment?.ticketingStage;
      if (attachment === undefined || stage === undefined || stage.approvedBatch === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Ticket Batch publication update requires an approved Ticket Batch.",
        });
      }
      if (
        stage.ticketingThreadId !== command.ticketingThreadId ||
        stage.skillRunId !== command.skillRunId ||
        stage.approvedBatch.id !== command.publication.batchId
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Ticket Batch publication update does not match the authorized publication.",
        });
      }
      if (command.publication.status !== "failed") {
        const expectedKeys = new Set(stage.approvedBatch.tickets.map((ticket) => ticket.key));
        const identityKeys = new Set(
          command.publication.identities.map((identity) => identity.key),
        );
        if (
          expectedKeys.size !== identityKeys.size ||
          [...expectedKeys].some((key) => !identityKeys.has(key))
        ) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail:
              "Successful Ticket Batch publication must return exactly one tracker identity per approved ticket.",
          });
        }
        if (command.trackerProjection?.status !== "healthy") {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Successful Ticket Batch publication requires a healthy Tracker Projection.",
          });
        }
      }
      const alreadyApplied =
        stage.status === "completed" &&
        stableStringify(stage.publication) === stableStringify(command.publication) &&
        (command.trackerProjection === undefined ||
          stableStringify(stage.trackerProjection) === stableStringify(command.trackerProjection));
      const nextAttachment = refreshTicketImplementationAvailability(
        alreadyApplied
          ? attachment
          : command.publication.status === "failed"
            ? incrementWorkflowVersion({
                ...attachment,
                trackerProjection: command.trackerProjection,
                ticketingStage: {
                  ...stage,
                  status: "failed",
                  publication: command.publication,
                  ...(command.trackerProjection !== undefined
                    ? { trackerProjection: command.trackerProjection }
                    : {}),
                  ...(command.publication.failure !== undefined
                    ? { failure: command.publication.failure }
                    : {}),
                  updatedAt: command.createdAt,
                },
              })
            : completeWorkflowTicketing({
                attachment,
                batch: stage.approvedBatch,
                publication: command.publication,
                trackerProjection: command.trackerProjection!,
                completedAt: command.createdAt,
              }),
      );
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.workflow-ticket-batch-publication-updated",
        payload: {
          threadId: command.threadId,
          attachment: nextAttachment,
        },
      };
    }

    case "thread.workflow.ticket-implementation.start": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const attachment = thread.workflowAttachment;
      if (attachment === undefined || attachment.workflowRun?.status !== "confirmed") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Ticket Implementation requires a confirmed Workflow Run.",
        });
      }
      if (hasPendingWorkflowStaleness(attachment)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail:
            "Ticket Implementation cannot start while the attached Workstream has unresolved upstream staleness.",
        });
      }
      if (
        command.dispatchMode === "automatic" &&
        workflowAutomationStatus(attachment) !== "running"
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Automatic Ticket Implementation dispatch requires a running Workflow Run.",
        });
      }

      const existing = workflowTicketImplementations(attachment).find(
        (implementation) => implementation.actionIdentity === command.actionIdentity,
      );
      if (existing !== undefined) {
        if (existing.nodeId !== command.ticketNodeId) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Action Identity is already bound to a different Ticket Implementation.",
          });
        }
        return yield* workflowTicketImplementationEventBase({
          command,
          attachment,
          implementation: existing,
          eventType: "thread.workflow-ticket-implementation-requested",
        });
      }

      if (command.dispatchMode === "automatic") {
        const capacity = automaticDispatchCapacity(readModel, attachment);
        if (!capacity.available) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: capacity.reason ?? "Automatic Ticket Implementation capacity is unavailable.",
          });
        }
      }

      const currentWorkflowVersion = attachment.workflowVersion ?? 0;
      if (command.expectedWorkstreamVersion !== currentWorkflowVersion) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Stale Workstream version ${command.expectedWorkstreamVersion}; current version is ${currentWorkflowVersion}. Refresh the Workflow Projection before retrying.`,
        });
      }

      const graphTicket = attachment.workflowGraph?.nodes.find(
        (node) => node.kind === "ticket" && node.id === command.ticketNodeId,
      );
      if (graphTicket === undefined || graphTicket.kind !== "ticket") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Ticket Implementation must target a ticket in the current Workflow Graph.",
        });
      }
      const runScope = new Set(
        attachment.workflowRun.configuration.runScope.map((scope) => scope.nodeId),
      );
      if (!runScope.has(graphTicket.id) || !graphTicket.includedInRun) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Only an in-scope Ticket Implementation may be dispatched.",
        });
      }
      if (graphTicket.state !== "current" || graphTicket.held === true) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Only a current, unheld Ticket Implementation may be dispatched.",
        });
      }
      const trackerProjection =
        attachment.trackerProjection ?? attachment.ticketingStage?.trackerProjection;
      const trackerTicket = trackerProjection?.tickets.find(
        (ticket) =>
          ticket.number === graphTicket.ticketNumber &&
          (ticket.key === null || ticket.key === graphTicket.ticketKey),
      );
      if (trackerProjection?.status !== "healthy" || trackerTicket === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Ticket Implementation requires a healthy tracker projection for the target.",
        });
      }
      if (
        trackerTicket.state !== "open" ||
        !canonicalWorkflowBlockersIntegrated(attachment, trackerTicket.blockedBy) ||
        trackerTicket.includedInRun !== true ||
        trackerTicket.body === undefined
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail:
            "Only an open, Integrated-blocker-free, in-scope Executable Node with exact acceptance criteria may start.",
        });
      }
      const active = workflowTicketImplementations(attachment).find(
        (implementation) =>
          implementation.nodeId === command.ticketNodeId &&
          ["dispatching", "implementing", "reviewing", "stopping", "needs-recovery"].includes(
            implementation.status,
          ),
      );
      if (active !== undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Ticket Implementation is already ${active.status} for the target node.`,
        });
      }
      const cancelled = workflowTicketImplementations(attachment).find(
        (implementation) =>
          implementation.nodeId === command.ticketNodeId && implementation.status === "cancelled",
      );
      if (cancelled !== undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail:
            "The required Ticket Implementation was cancelled and cannot be replaced by a new run.",
        });
      }

      const providerInstanceId =
        attachment.workflowRun.configuration.providerOverrides.find(
          (override) => override.nodeId === graphTicket.id,
        )?.providerInstanceId ?? attachment.workflowRun.configuration.defaultProviderInstanceId;
      const implementSkill = implementationRequiredSkill({
        attachment,
        nodeId: graphTicket.id,
        providerInstanceId,
        stage: "implementation",
        skillName: "implement",
      });
      const reviewSkill = implementationRequiredSkill({
        attachment,
        nodeId: graphTicket.id,
        providerInstanceId,
        stage: "review",
        skillName: "code-review",
      });
      if (implementSkill === null || reviewSkill === null) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail:
            "The confirmed Workflow Run must pin available implementation and Code Review skills for the selected provider.",
        });
      }

      const implementation: WorkflowTicketImplementation = {
        id: workflowTicketImplementationId({
          workstreamId: attachment.workstreamId,
          nodeId: graphTicket.id,
          actionIdentity: command.actionIdentity,
        }),
        workstreamId: attachment.workstreamId,
        nodeId: graphTicket.id,
        ticketKey: graphTicket.ticketKey,
        ticketNumber: graphTicket.ticketNumber,
        title: graphTicket.title,
        actionIdentity: command.actionIdentity,
        status: "dispatching",
        dispatchMode: command.dispatchMode ?? "user",
        originThreadId: command.threadId,
        implementationThreadId: null,
        worktreePath: null,
        branch: workflowTicketImplementationBranch({
          ticketNumber: graphTicket.ticketNumber,
          actionIdentity: command.actionIdentity,
        }),
        fixedPoint: attachment.workflowRun.configuration.fixedPoint,
        acceptanceCriteria: trackerTicket.body,
        providerInstanceId,
        implementSkill: {
          name: implementSkill.skill.name,
          path: implementSkill.skill.path!,
          contentDigest: implementSkill.skill.contentDigest!,
        },
        reviewSkill: {
          name: reviewSkill.skill.name,
          path: reviewSkill.skill.path!,
          contentDigest: reviewSkill.skill.contentDigest!,
        },
        implementationSkillRunId: null,
        reviewSkillRunId: null,
        validation: [],
        diff: null,
        review: null,
        correctionCycles: [],
        failure: null,
        startedAt: command.createdAt,
        updatedAt: command.createdAt,
      };
      const nextAttachment = refreshTicketImplementationAvailability(
        incrementWorkflowVersion({
          ...attachment,
          ticketImplementations: [...workflowTicketImplementations(attachment), implementation],
        }),
      );
      return yield* workflowTicketImplementationEventBase({
        command,
        attachment: nextAttachment,
        implementation,
        eventType: "thread.workflow-ticket-implementation-requested",
      });
    }

    case "thread.workflow.ticket-integration.retry": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const attachment = thread.workflowAttachment;
      const current = attachment?.ticketImplementations?.find(
        (implementation) => implementation.id === command.implementationId,
      );
      if (attachment === undefined || current === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Integration retry requires an existing Ticket Implementation.",
        });
      }
      if (attachment.workflowRun?.status !== "confirmed") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Integration retry requires a confirmed Workflow Run.",
        });
      }
      if (!attachment.workflowRun.configuration.authority.mutateTracker) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Integration retry requires tracker mutation authority.",
        });
      }
      if (current.status !== "integration-failed" || current.integration?.status !== "failed") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Only a failed integration can be retried.",
        });
      }
      if (command.expectedWorkstreamVersion !== (attachment.workflowVersion ?? 0)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Integration retry has a stale Workstream version.",
        });
      }
      if (workflowIntegrationLaneBusy(attachment, current.id)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail:
            "The serialized Workstream Baseline integration lane is occupied by another Ticket Implementation.",
        });
      }
      const integration = current.integration;
      const implementation: WorkflowTicketImplementation = {
        ...current,
        status: "integrating",
        integration: {
          ...integration,
          status: integration.failurePhase === "tracker" ? "tracker-closing" : "integrating",
          failure: null,
          failurePhase: null,
          updatedAt: command.createdAt,
        },
        failure: null,
        updatedAt: command.createdAt,
      };
      const nextAttachment = refreshTicketImplementationAvailability(
        incrementWorkflowVersion({
          ...attachment,
          ticketImplementations: attachment.ticketImplementations!.map((candidate) =>
            candidate.id === command.implementationId ? implementation : candidate,
          ),
        }),
      );
      return yield* workflowTicketImplementationEventBase({
        command,
        attachment: nextAttachment,
        implementation,
        eventType: "thread.workflow-ticket-implementation-updated",
      });
    }

    case "thread.workflow.ticket-implementation.checkpoint": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const attachment = thread.workflowAttachment;
      const current = attachment?.ticketImplementations?.find(
        (implementation) => implementation.id === command.implementationId,
      );
      if (attachment === undefined || current === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Ticket Implementation checkpoint requires an existing implementation.",
        });
      }
      if (command.expectedWorkstreamVersion !== (attachment.workflowVersion ?? 0)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Ticket Implementation checkpoint has a stale Workstream version.",
        });
      }
      if (current.status === "checkpointed") {
        return yield* workflowTicketImplementationEventBase({
          command,
          attachment,
          implementation: current,
          eventType: "thread.workflow-ticket-implementation-checkpointed",
        });
      }
      if (current.status !== "implementing" && current.status !== "reviewing") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail:
            "A Ticket Implementation can reach a Workflow Checkpoint only while implementing or reviewing.",
        });
      }
      const implementation: WorkflowTicketImplementation = {
        ...current,
        status: "checkpointed",
        updatedAt: command.createdAt,
      };
      const nextAttachment = refreshTicketImplementationAvailability(
        incrementWorkflowVersion({
          ...attachment,
          ticketImplementations: attachment.ticketImplementations!.map((candidate) =>
            candidate.id === command.implementationId ? implementation : candidate,
          ),
        }),
      );
      return yield* workflowTicketImplementationEventBase({
        command,
        attachment: nextAttachment,
        implementation,
        eventType: "thread.workflow-ticket-implementation-checkpointed",
      });
    }

    case "thread.workflow.ticket-implementation.stop": {
      const originThread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const attachment = originThread.workflowAttachment;
      const current = attachment?.ticketImplementations?.find(
        (implementation) => implementation.id === command.implementationId,
      );
      if (attachment === undefined || current === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Stopping a Ticket Implementation requires an existing implementation.",
        });
      }
      if (command.actionIdentity !== current.actionIdentity) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Stop does not match the server-owned Ticket Implementation identity.",
        });
      }
      if (command.expectedWorkstreamVersion !== (attachment.workflowVersion ?? 0)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Stop has a stale Workstream version; refresh the Workflow Projection first.",
        });
      }
      if (current.implementationThreadId === null) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail:
            "A Ticket Implementation can only be stopped after its provider thread is retained.",
        });
      }
      if (
        current.status !== "dispatching" &&
        current.status !== "implementing" &&
        current.status !== "reviewing" &&
        !(current.status === "integrating" && current.integration?.repair?.status === "running")
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Ticket Implementation cannot be stopped from ${current.status}.`,
        });
      }
      const implementationThread = readModel.threads.find(
        (thread) => thread.id === current.implementationThreadId,
      );
      if (
        implementationThread?.session === null ||
        implementationThread?.session === undefined ||
        (implementationThread.session.status !== "starting" &&
          implementationThread.session.status !== "running" &&
          implementationThread.session.status !== "ready")
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "The retained provider thread has no active session to interrupt.",
        });
      }

      const implementation: WorkflowTicketImplementation = {
        ...current,
        status: "stopping",
        recoveryPhase:
          current.status === "integrating"
            ? "integration"
            : current.status === "reviewing"
              ? "review"
              : "implementation",
        failure: null,
        updatedAt: command.createdAt,
      };
      const nextAttachment = refreshTicketImplementationAvailability(
        incrementWorkflowVersion({
          ...attachment,
          ticketImplementations: attachment.ticketImplementations!.map((candidate) =>
            candidate.id === current.id ? implementation : candidate,
          ),
        }),
      );
      const implementationUpdated = yield* workflowTicketImplementationEventBase({
        command,
        attachment: nextAttachment,
        implementation,
        eventType: "thread.workflow-ticket-implementation-updated",
      });
      const stopBase = yield* withEventBase({
        aggregateKind: "thread",
        aggregateId: current.implementationThreadId,
        occurredAt: command.createdAt,
        commandId: command.commandId,
      });
      return [
        implementationUpdated,
        {
          ...stopBase,
          type: "thread.session-stop-requested",
          payload: {
            threadId: current.implementationThreadId,
            createdAt: command.createdAt,
            workflowRecovery: {
              originThreadId: command.threadId,
              implementationId: current.id,
            },
          },
        },
      ];
    }

    case "thread.workflow.ticket-implementation.recover": {
      const originThread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const attachment = originThread.workflowAttachment;
      const current = attachment?.ticketImplementations?.find(
        (implementation) => implementation.id === command.implementationId,
      );
      if (attachment === undefined || current === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Recovery requires an existing Ticket Implementation.",
        });
      }
      if (command.actionIdentity !== current.actionIdentity) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Recovery does not match the server-owned Ticket Implementation identity.",
        });
      }
      if (command.expectedWorkstreamVersion !== (attachment.workflowVersion ?? 0)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Recovery has a stale Workstream version; refresh the Workflow Projection first.",
        });
      }
      if (current.status !== "needs-recovery") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Recovery actions are only available from Needs Recovery, not ${current.status}.`,
        });
      }

      const implementationThreadId = current.implementationThreadId;
      const implementationThread =
        implementationThreadId === null
          ? undefined
          : readModel.threads.find((thread) => thread.id === implementationThreadId);
      if (implementationThreadId === null || implementationThread === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Recovery requires the retained provider thread.",
        });
      }

      let implementation: WorkflowTicketImplementation;
      switch (command.action) {
        case "resume": {
          const recoveryPhase = current.recoveryPhase ?? "implementation";
          if (
            recoveryPhase === "integration" &&
            workflowIntegrationLaneBusy(attachment, current.id)
          ) {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail:
                "The serialized Workstream Baseline integration lane is occupied by another Ticket Implementation.",
            });
          }
          implementation = {
            ...current,
            status:
              recoveryPhase === "review"
                ? "reviewing"
                : recoveryPhase === "integration"
                  ? "integrating"
                  : "implementing",
            implementationSkillRunId:
              recoveryPhase === "implementation" ? null : current.implementationSkillRunId,
            reviewSkillRunId: recoveryPhase === "review" ? null : current.reviewSkillRunId,
            recoveryPhase,
            recoveryAttempt: (current.recoveryAttempt ?? 0) + 1,
            ...(recoveryPhase === "integration" && current.integration?.repair !== undefined
              ? {
                  integration: {
                    ...current.integration,
                    status: "integrating" as const,
                    failurePhase: null,
                    failure: null,
                    repair: {
                      ...current.integration.repair,
                      status: "pending" as const,
                      skillRunId: null,
                      failure: null,
                      updatedAt: command.createdAt,
                    },
                    updatedAt: command.createdAt,
                  },
                }
              : {}),
            failure: null,
            updatedAt: command.createdAt,
          };
          break;
        }
        case "cancel-with-changes":
          implementation = {
            ...current,
            status: "cancelled",
            updatedAt: command.createdAt,
          };
          break;
        case "restore-to-checkpoint": {
          if (command.checkpointTurnCount === undefined) {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: "Restore requires an explicit checkpoint turn count.",
            });
          }
          const checkpointAvailable =
            command.checkpointTurnCount === 0 ||
            implementationThread.checkpoints.some(
              (checkpoint) =>
                checkpoint.checkpointTurnCount === command.checkpointTurnCount &&
                checkpoint.status === "ready",
            );
          if (!checkpointAvailable) {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: `Checkpoint turn ${command.checkpointTurnCount} is not available for explicit restore.`,
            });
          }
          implementation = {
            ...current,
            recoveryCheckpointTurnCount: command.checkpointTurnCount,
            updatedAt: command.createdAt,
          };
          break;
        }
      }

      const nextAttachment = refreshTicketImplementationAvailability(
        incrementWorkflowVersion({
          ...attachment,
          ticketImplementations: attachment.ticketImplementations!.map((candidate) =>
            candidate.id === current.id ? implementation : candidate,
          ),
        }),
      );
      const recoveryRequested = yield* workflowTicketImplementationRecoveryEventBase({
        command,
        attachment: nextAttachment,
        implementation,
        action: command.action,
        ...(command.checkpointTurnCount === undefined
          ? {}
          : { checkpointTurnCount: command.checkpointTurnCount }),
      });
      if (command.action !== "restore-to-checkpoint") {
        return recoveryRequested;
      }

      const checkpointBase = yield* withEventBase({
        aggregateKind: "thread",
        aggregateId: implementationThreadId,
        occurredAt: command.createdAt,
        commandId: command.commandId,
      });
      return [
        recoveryRequested,
        {
          ...checkpointBase,
          type: "thread.checkpoint-revert-requested",
          payload: {
            threadId: implementationThreadId,
            turnCount: command.checkpointTurnCount!,
            createdAt: command.createdAt,
            workflowRecovery: {
              originThreadId: command.threadId,
              implementationId: implementation.id,
            },
          },
        },
      ];
    }

    case "thread.workflow.ticket-implementation.update": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const attachment = thread.workflowAttachment;
      const current = attachment?.ticketImplementations?.find(
        (implementation) => implementation.id === command.implementationId,
      );
      if (attachment === undefined || current === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Ticket Implementation update requires an existing implementation.",
        });
      }
      if (
        command.implementation.id !== current.id ||
        command.implementation.originThreadId !== command.threadId ||
        command.implementation.actionIdentity !== current.actionIdentity
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Ticket Implementation update does not match the server-owned identity.",
        });
      }
      if (
        stableStringify({
          workstreamId: command.implementation.workstreamId,
          nodeId: command.implementation.nodeId,
          ticketKey: command.implementation.ticketKey,
          ticketNumber: command.implementation.ticketNumber,
          title: command.implementation.title,
          actionIdentity: command.implementation.actionIdentity,
          originThreadId: command.implementation.originThreadId,
          fixedPoint: command.implementation.fixedPoint,
          acceptanceCriteria: command.implementation.acceptanceCriteria,
          providerInstanceId: command.implementation.providerInstanceId,
          implementSkill: command.implementation.implementSkill,
          reviewSkill: command.implementation.reviewSkill,
        }) !==
        stableStringify({
          workstreamId: current.workstreamId,
          nodeId: current.nodeId,
          ticketKey: current.ticketKey,
          ticketNumber: current.ticketNumber,
          title: current.title,
          actionIdentity: current.actionIdentity,
          originThreadId: current.originThreadId,
          fixedPoint: current.fixedPoint,
          acceptanceCriteria: current.acceptanceCriteria,
          providerInstanceId: current.providerInstanceId,
          implementSkill: current.implementSkill,
          reviewSkill: current.reviewSkill,
        })
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail:
            "Ticket Implementation provider, skill, acceptance criteria, and Fixed Point identities are immutable after dispatch.",
        });
      }
      if (command.expectedWorkstreamVersion !== (attachment.workflowVersion ?? 0)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Ticket Implementation update has a stale Workstream version.",
        });
      }
      if (
        command.implementation.status === "reviewed" ||
        (command.implementation.review !== null &&
          stableStringify(command.implementation.review) !== stableStringify(current.review))
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail:
            "Structured Code Review evidence must be recorded through the review command; an existing review may only be preserved unchanged.",
        });
      }
      const integration = command.implementation.integration;
      if (
        ["integrating", "integration-failed", "integrated"].includes(
          command.implementation.status,
        ) &&
        integration === undefined
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Integration statuses require server-owned integration evidence.",
        });
      }
      if (
        command.implementation.status === "integration-failed" &&
        integration?.status !== "failed"
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "A failed integration status must preserve a retryable integration failure.",
        });
      }
      if (
        command.implementation.status === "integrating" &&
        integration !== undefined &&
        integration.status !== "integrating" &&
        integration.status !== "tracker-closing"
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "An integrating Ticket Implementation must name its active integration phase.",
        });
      }
      if (
        command.implementation.status === "integrating" &&
        current.status !== "integrating" &&
        workflowIntegrationLaneBusy(attachment, current.id)
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail:
            "The serialized Workstream Baseline integration lane is occupied by another Ticket Implementation.",
        });
      }
      if (
        command.implementation.status === "integrating" &&
        !attachment.workflowRun?.configuration.authority.mutateTracker
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Tracker mutation authority is required before integration can start.",
        });
      }
      if (
        command.trackerProjection !== undefined &&
        command.implementation.status !== "integrated"
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Tracker synchronization can only be attached to an Integrated Ticket.",
        });
      }
      if (command.implementation.status === "integrated") {
        const trackerProjection = command.trackerProjection;
        const trackerTicket = trackerProjection?.tickets.find(
          (ticket) => ticket.number === current.ticketNumber,
        );
        if (
          current.review?.status !== "passed" ||
          current.validation.some((evidence) => evidence.status !== "passed") ||
          integration?.status !== "integrated" ||
          integration.baselineCommit === null ||
          trackerProjection?.status !== "healthy" ||
          trackerTicket?.state !== "closed"
        ) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail:
              "An Integrated Ticket requires passed review, a baseline commit, and a healthy closed tracker projection.",
          });
        }
      }
      if (
        !workflowTicketImplementationStatusTransitionAllowed(
          current.status,
          command.implementation.status,
        )
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Ticket Implementation cannot transition from ${current.status} to ${command.implementation.status}.`,
        });
      }
      const nextAttachment = refreshTicketImplementationAvailability(
        incrementWorkflowVersion({
          ...attachment,
          ...(command.trackerProjection !== undefined
            ? { trackerProjection: command.trackerProjection }
            : {}),
          ticketImplementations: attachment.ticketImplementations!.map((implementation) =>
            implementation.id === command.implementationId
              ? command.implementation
              : implementation,
          ),
        }),
      );
      return yield* workflowTicketImplementationEventBase({
        command,
        attachment: nextAttachment,
        implementation: command.implementation,
        eventType: "thread.workflow-ticket-implementation-updated",
      });
    }

    case "thread.workflow.ticket-implementation.review.record": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const attachment = thread.workflowAttachment;
      const current = attachment?.ticketImplementations?.find(
        (implementation) => implementation.id === command.implementationId,
      );
      if (attachment === undefined || current === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Code Review evidence requires an existing Ticket Implementation.",
        });
      }
      if (
        current.status === "reviewed" &&
        current.review !== null &&
        stableStringify(current.review) === stableStringify(command.review) &&
        stableStringify(current.validation) === stableStringify(command.validation)
      ) {
        return yield* workflowTicketImplementationEventBase({
          command,
          attachment,
          implementation: current,
          eventType: "thread.workflow-ticket-implementation-updated",
        });
      }
      if (current.status !== "reviewing") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Code Review evidence can only complete a reviewing Ticket Implementation.",
        });
      }
      if (current.reviewSkillRunId === null) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Code Review evidence requires the pinned /code-review Skill Run.",
        });
      }
      if (
        command.review.skillRunId !== current.reviewSkillRunId ||
        command.review.fixedPoint !== current.fixedPoint
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Code Review evidence must reference the original Fixed Point and Skill Run.",
        });
      }
      const reviewThread = current.implementationThreadId
        ? readModel.threads.find((candidate) => candidate.id === current.implementationThreadId)
        : undefined;
      const projectedReviewSkillRunId = reviewThread?.latestTurn?.skillInvocation?.skillRunId;
      if (
        reviewThread?.latestTurn?.state !== "completed" ||
        (projectedReviewSkillRunId !== undefined &&
          projectedReviewSkillRunId !== current.reviewSkillRunId)
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail:
            "Code Review evidence requires a completed pinned /code-review turn; the server-owned Skill Run must remain the current child.",
        });
      }
      if (command.validation.length === 0) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Code Review evidence must include structured validation evidence.",
        });
      }
      const blockingFindings = blockingReviewFindings(command.review);
      if (
        command.review.status === "passed" &&
        (command.validation.some((evidence) => evidence.status !== "passed") ||
          blockingFindings.length > 0)
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "A passed Code Review requires only passed validation and no must-fix findings.",
        });
      }
      if (
        command.review.status === "must-fix" &&
        !command.review.findings.some((finding) => finding.severity === "must-fix")
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "A must-fix Code Review must retain at least one structured must-fix finding.",
        });
      }
      if (command.expectedWorkstreamVersion !== (attachment.workflowVersion ?? 0)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Code Review evidence has a stale Workstream version.",
        });
      }
      const correctionCycles = workflowTicketImplementationCorrectionCycles(current);
      const reviewAccepted = command.review.status === "passed" || blockingFindings.length === 0;
      const repairReview = current.integration?.repair?.status === "reviewing";
      const implementation: WorkflowTicketImplementation = {
        ...current,
        status: reviewAccepted
          ? "reviewed"
          : correctionCycles.length >= WORKFLOW_MAX_AUTOMATIC_CORRECTION_CYCLES
            ? "needs-decision"
            : "needs-correction",
        validation: command.validation,
        review: command.review,
        ...(repairReview && current.integration?.repair !== undefined
          ? {
              integration: {
                ...current.integration,
                repair: {
                  ...current.integration.repair,
                  status: reviewAccepted ? ("ready" as const) : ("reviewing" as const),
                  failure: null,
                  updatedAt: command.createdAt,
                },
                updatedAt: command.createdAt,
              },
            }
          : {}),
        failure: null,
        updatedAt: command.createdAt,
      };
      const nextAttachment = refreshTicketImplementationAvailability(
        incrementWorkflowVersion({
          ...attachment,
          ticketImplementations: attachment.ticketImplementations!.map((candidate) =>
            candidate.id === command.implementationId ? implementation : candidate,
          ),
        }),
      );
      return yield* workflowTicketImplementationEventBase({
        command,
        attachment: nextAttachment,
        implementation,
        eventType: "thread.workflow-ticket-implementation-updated",
      });
    }

    case "thread.workflow.ticket-implementation.correction.start": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const attachment = thread.workflowAttachment;
      const current = attachment?.ticketImplementations?.find(
        (implementation) => implementation.id === command.implementationId,
      );
      if (attachment === undefined || current === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Correction Cycle requires an existing Ticket Implementation.",
        });
      }
      const correctionCycles = workflowTicketImplementationCorrectionCycles(current);
      const duplicateCycle = correctionCycles.find(
        (cycle) =>
          cycle.cycle === command.correctionCycle &&
          stableStringify(cycle.findings) === stableStringify(command.findings),
      );
      if (duplicateCycle !== undefined) {
        return yield* workflowTicketImplementationEventBase({
          command,
          attachment,
          implementation: current,
          eventType: "thread.workflow-ticket-implementation-updated",
        });
      }
      if (current.status !== "needs-correction") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail:
            "A Correction Cycle can only start for a Ticket Implementation needing correction.",
        });
      }
      if (current.review === null) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "A Correction Cycle requires preserved Code Review evidence.",
        });
      }
      const blockingFindings = blockingReviewFindings(current.review);
      if (
        blockingFindings.length === 0 ||
        stableStringify(blockingFindings) !== stableStringify(command.findings)
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "A Correction Cycle must use the current grounded Must-Fix Findings.",
        });
      }
      if (command.correctionCycle !== correctionCycles.length + 1) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Correction Cycles must advance one cycle at a time.",
        });
      }
      if (command.correctionCycle > WORKFLOW_MAX_AUTOMATIC_CORRECTION_CYCLES) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "The automatic Correction Cycle limit has been reached.",
        });
      }
      if (command.expectedWorkstreamVersion !== (attachment.workflowVersion ?? 0)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Correction Cycle has a stale Workstream version.",
        });
      }
      const implementation: WorkflowTicketImplementation = {
        ...current,
        status: "implementing",
        implementationSkillRunId: null,
        reviewSkillRunId: null,
        validation: [],
        diff: null,
        correctionCycles: [
          ...correctionCycles,
          {
            cycle: command.correctionCycle,
            findings: command.findings,
            review: current.review,
            startedAt: command.createdAt,
          },
        ],
        failure: null,
        updatedAt: command.createdAt,
      };
      const nextAttachment = refreshTicketImplementationAvailability(
        incrementWorkflowVersion({
          ...attachment,
          ticketImplementations: attachment.ticketImplementations!.map((candidate) =>
            candidate.id === command.implementationId ? implementation : candidate,
          ),
        }),
      );
      return yield* workflowTicketImplementationEventBase({
        command,
        attachment: nextAttachment,
        implementation,
        eventType: "thread.workflow-ticket-implementation-updated",
      });
    }

    case "thread.wayfinder.publish": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      if (activeWayfinderDraftSkillRunId(thread.activities) !== command.skillRunId) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Wayfinder publication requires the matching active unpublished draft.",
        });
      }
      if (
        thread.runtimeMode === "approval-required" &&
        command.confirmed &&
        approvedWayfinderPublicationSkillRunId(thread.activities) !== command.skillRunId
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Wayfinder publication confirmation requires a pending server approval.",
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.wayfinder-publication-requested",
        payload: {
          threadId: command.threadId,
          skillRunId: command.skillRunId,
          runtimeMode: thread.runtimeMode,
          confirmed: command.confirmed,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.wayfinder.mutate": {
      const thread = yield* requireThread({ readModel, command, threadId: command.threadId });
      const actionId = command.actionId ?? command.commandId;
      const invocation = thread.latestTurn?.skillInvocation;
      const map =
        invocation?.skillRunId === command.skillRunId ? invocation.wayfinderMap : undefined;
      const published = thread.activities.some((activity) => {
        if (activity.kind !== "wayfinder.draft.published") return false;
        const payload = decodePublishedWayfinderPayload(activity.payload);
        return Option.isSome(payload) && payload.value.skillRunId === command.skillRunId;
      });
      const workTicketAction = invocation?.action?.id === "work-ticket" ? invocation.action : null;
      if (!published && workTicketAction === null) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Wayfinder editing requires a published canonical map.",
        });
      }
      if (
        workTicketAction !== null &&
        command.action.kind !== "complete-hitl-ticket" &&
        !(
          command.action.kind === "release-ticket" &&
          command.action.ticketNumber === workTicketAction.ticketNumber
        )
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `A linked HITL thread can work only its assigned ticket #${workTicketAction.ticketNumber}.`,
        });
      }
      if (command.action.kind === "complete-hitl-ticket") {
        if (workTicketAction === null) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Wayfinder HITL completion requires a dedicated linked ticket thread.",
          });
        }
        if (command.action.ticketNumber !== workTicketAction.ticketNumber) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `This linked thread can resolve only its assigned ticket #${workTicketAction.ticketNumber}.`,
          });
        }
        const assignedTicket = map?.tickets.find(
          (ticket) => ticket.number === workTicketAction.ticketNumber,
        );
        if (assignedTicket?.state !== "open" || assignedTicket.claimedBy === null) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Wayfinder HITL completion requires the assigned canonical ticket claim.",
          });
        }
        if (command.action.outcome === "out-of-scope" && command.action.graduatedFog.length > 0) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "An out-of-scope ticket cannot graduate new route decisions.",
          });
        }
        if (
          new Set(command.action.graduatedFog.map((graduated) => graduated.key)).size !==
          command.action.graduatedFog.length
        ) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Each graduated fog ticket requires a unique key.",
          });
        }
        if (
          command.action.graduatedFog.some((graduated) => !map?.fogOfWar.includes(graduated.fog))
        ) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Graduated fog must exist in the synchronized canonical map.",
          });
        }
        if (hasOpenBlockingRequest(thread)) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Resolve the current user decision before completing this HITL ticket.",
          });
        }
      }
      if (command.action.kind === "claim-ticket") {
        const action = command.action;
        const ticket = map?.tickets.find((candidate) => candidate.number === action.ticketNumber);
        const recoveringClaim =
          invocation?.wayfinderMutation?.status === "failed" &&
          invocation.wayfinderMutation.action.kind === "claim-ticket" &&
          invocation.wayfinderMutation.action.ticketNumber === action.ticketNumber;
        if (!ticket) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Wayfinder claims require a ticket in the synchronized canonical map.",
          });
        }
        if (ticket.state !== "open") {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Wayfinder ticket #${ticket.number} must be open before it can be claimed.`,
          });
        }
        if (ticket.claimedBy !== null && !recoveringClaim) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Wayfinder ticket #${ticket.number} is already claimed by ${ticket.claimedBy}.`,
          });
        }
        if (!recoveringClaim && !map?.frontier.includes(ticket.number)) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Wayfinder ticket #${ticket.number} is blocked and is not on the runnable frontier.`,
          });
        }
      }
      let approvalRequested = false;
      let approvalResolved = false;
      for (const activity of thread.activities) {
        if (
          activity.kind !== "wayfinder.mutation.approval-requested" &&
          activity.kind !== "wayfinder.mutation.approval-resolved"
        ) {
          continue;
        }
        const payload = decodeWayfinderMutationApprovalPayload(activity.payload);
        const matches =
          Option.isSome(payload) &&
          payload.value.skillRunId === command.skillRunId &&
          payload.value.actionId === actionId &&
          sameWayfinderMutationAction(payload.value.action, command.action);
        if (matches) {
          approvalRequested ||= activity.kind === "wayfinder.mutation.approval-requested";
          approvalResolved ||= activity.kind === "wayfinder.mutation.approval-resolved";
        }
      }
      const pendingApproval = approvalRequested && !approvalResolved;
      if (thread.runtimeMode === "approval-required" && command.confirmed && !pendingApproval) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Wayfinder mutation confirmation requires a pending server approval.",
        });
      }
      const requested: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.wayfinder-mutation-requested",
        payload: {
          threadId: command.threadId,
          skillRunId: command.skillRunId,
          actionId,
          action: command.action,
          runtimeMode: thread.runtimeMode,
          confirmed: command.confirmed,
          createdAt: command.createdAt,
        },
      };
      if (thread.runtimeMode !== "approval-required" || !command.confirmed) return requested;
      return [
        requested,
        {
          ...(yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          })),
          type: "thread.activity-appended",
          payload: {
            threadId: command.threadId,
            activity: {
              id: EventId.make(`wayfinder-mutation-approval-resolved:${command.commandId}`),
              tone: "info",
              kind: "wayfinder.mutation.approval-resolved",
              summary: "Wayfinder change confirmed",
              payload: {
                skillRunId: command.skillRunId,
                actionId,
                action: command.action,
              },
              turnId: null,
              createdAt: command.createdAt,
            },
          },
        },
      ];
    }

    case "thread.wayfinder.reconcile": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.wayfinder-reconciliation-requested",
        payload: {
          threadId: command.threadId,
          skillRunId: command.skillRunId,
          reason: command.reason,
          ...(command.expectedRevision !== undefined
            ? { expectedRevision: command.expectedRevision }
            : {}),
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.wayfinder.research": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const invocation = thread.latestTurn?.skillInvocation;
      if (
        invocation?.skillRunId !== command.skillRunId ||
        invocation.wayfinderMap === undefined ||
        invocation.action?.id === "work-ticket"
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Wayfinder research controls require the canonical shared map run.",
        });
      }
      const action = command.action;
      if ("ticketNumber" in action) {
        const ticket = invocation.wayfinderMap.tickets.find(
          (candidate) => candidate.number === action.ticketNumber,
        );
        if (!ticket) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Wayfinder research controls require a ticket in the canonical map.",
          });
        }
        if (action.kind === "start-ticket") {
          if (ticket.state !== "open") {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: `Wayfinder research ticket #${ticket.number} must be open.`,
            });
          }
          if (ticket.classification !== "research") {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: `Wayfinder ticket #${ticket.number} is not agent-only research.`,
            });
          }
          if (
            ticket.claimedBy !== null ||
            !invocation.wayfinderMap.frontier.includes(ticket.number)
          ) {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: `Wayfinder research ticket #${ticket.number} must be unblocked and unclaimed.`,
            });
          }
        }
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.wayfinder-research-requested",
        payload: {
          threadId: command.threadId,
          skillRunId: command.skillRunId,
          action: command.action,
          launchMode: command.launchMode ?? "manual",
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.checkpoint.revert": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.checkpoint-revert-requested",
        payload: {
          threadId: command.threadId,
          turnCount: command.turnCount,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.session.stop": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.session-stop-requested",
        payload: {
          threadId: command.threadId,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.session.set": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const sessionSetEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {},
        })),
        type: "thread.session-set",
        payload: {
          threadId: command.threadId,
          session: command.session,
        },
      };
      const workflowSpecification = workflowSpecificationForThread(readModel, thread);
      const terminalWorkflowEvent =
        workflowSpecification !== null &&
        workflowSpecification.stage.status !== "completed" &&
        (command.session.status === "stopped" ||
          command.session.status === "interrupted" ||
          command.session.status === "error")
          ? yield* withEventBase({
              aggregateKind: "thread",
              aggregateId: workflowSpecification.originThread.id,
              occurredAt: command.createdAt,
              commandId: command.commandId,
            }).pipe(
              Effect.map(
                (eventBase): Omit<OrchestrationEvent, "sequence"> => ({
                  ...eventBase,
                  causationEventId: sessionSetEvent.eventId,
                  type: "thread.workflow-specification-failed",
                  payload: {
                    threadId: workflowSpecification.originThread.id,
                    attachment: incrementWorkflowVersion({
                      ...workflowSpecification.attachment,
                      specificationStage: {
                        ...workflowSpecification.stage,
                        status:
                          command.session.status === "error"
                            ? ("failed" as const)
                            : ("stopped" as const),
                        ...(workflowSpecification.stage.checkpoint?.status === "pending"
                          ? {
                              checkpoint: {
                                ...workflowSpecification.stage.checkpoint,
                                status: "stale" as const,
                              },
                            }
                          : {}),
                        ...(command.session.lastError !== null
                          ? { failure: command.session.lastError }
                          : {}),
                        updatedAt: command.createdAt,
                      },
                    }),
                  },
                }),
              ),
            )
          : null;
      const workflowTicketing = workflowTicketingForThread(readModel, thread);
      const terminalWorkflowTicketingEvent =
        workflowTicketing !== null &&
        workflowTicketing.stage.status !== "completed" &&
        (command.session.status === "stopped" ||
          command.session.status === "interrupted" ||
          command.session.status === "error")
          ? yield* withEventBase({
              aggregateKind: "thread",
              aggregateId: workflowTicketing.originThread.id,
              occurredAt: command.createdAt,
              commandId: command.commandId,
            }).pipe(
              Effect.map(
                (eventBase): Omit<OrchestrationEvent, "sequence"> => ({
                  ...eventBase,
                  causationEventId: sessionSetEvent.eventId,
                  type: "thread.workflow-ticketing-failed",
                  payload: {
                    threadId: workflowTicketing.originThread.id,
                    attachment: incrementWorkflowVersion({
                      ...workflowTicketing.attachment,
                      ticketingStage: {
                        ...workflowTicketing.stage,
                        status:
                          command.session.status === "error"
                            ? ("failed" as const)
                            : ("stopped" as const),
                        ...(workflowTicketing.stage.checkpoint?.status === "pending"
                          ? {
                              checkpoint: {
                                ...workflowTicketing.stage.checkpoint,
                                status: "stale" as const,
                              },
                            }
                          : {}),
                        ...(command.session.lastError !== null
                          ? { failure: command.session.lastError }
                          : {}),
                        updatedAt: command.createdAt,
                      },
                    }),
                  },
                }),
              ),
            )
          : null;
      // Only a session coming alive is activity worth waking a settled thread
      // for — status writes like ready/stopped/error arrive after the fact and
      // must not fight a user's explicit settle. Snooze is deliberately NOT
      // cleared here: snooze never pauses the agent, so its session starting
      // or erroring is not the user re-engaging. Blocked/failed work still
      // surfaces immediately — effectiveSnoozed refuses to classify a thread
      // with a raised hand (approval / input / failure / fresh completion)
      // as snoozed, without spending the return ticket.
      const isSessionActivity =
        command.session.status === "starting" || command.session.status === "running";
      // Real activity resets ANY override (settled wakes, active unpins).
      if (thread.settledOverride === null || !isSessionActivity) {
        return terminalWorkflowEvent === null && terminalWorkflowTicketingEvent === null
          ? sessionSetEvent
          : [
              sessionSetEvent,
              ...(terminalWorkflowEvent !== null ? [terminalWorkflowEvent] : []),
              ...(terminalWorkflowTicketingEvent !== null ? [terminalWorkflowTicketingEvent] : []),
            ];
      }
      const unsettledEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.unsettled",
        payload: {
          threadId: command.threadId,
          reason: "activity",
          updatedAt: command.createdAt,
        },
      };
      return [
        unsettledEvent,
        sessionSetEvent,
        ...(terminalWorkflowEvent !== null ? [terminalWorkflowEvent] : []),
        ...(terminalWorkflowTicketingEvent !== null ? [terminalWorkflowTicketingEvent] : []),
      ];
    }

    case "thread.message.assistant.delta": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          role: "assistant",
          text: command.delta,
          turnId: command.turnId ?? null,
          streaming: true,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.message.assistant.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          role: "assistant",
          text: "",
          turnId: command.turnId ?? null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.proposed-plan.upsert": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.proposed-plan-upserted",
        payload: {
          threadId: command.threadId,
          proposedPlan: command.proposedPlan,
        },
      };
    }

    case "thread.turn.diff.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.turn-diff-completed",
        payload: {
          threadId: command.threadId,
          turnId: command.turnId,
          checkpointTurnCount: command.checkpointTurnCount,
          checkpointRef: command.checkpointRef,
          status: command.status,
          files: command.files,
          assistantMessageId: command.assistantMessageId ?? null,
          completedAt: command.completedAt,
        },
      };
    }

    case "thread.revert.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.reverted",
        payload: {
          threadId: command.threadId,
          turnCount: command.turnCount,
        },
      };
    }

    case "thread.activity.append": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const decodedRequestMetadata = Option.getOrUndefined(
        decodeActivityRequestMetadata(command.activity.payload),
      );
      const requestId = decodedRequestMetadata?.requestId;
      const activityAppendedEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          ...(requestId !== undefined ? { metadata: { requestId } } : {}),
        })),
        type: "thread.activity-appended",
        payload: {
          threadId: command.threadId,
          activity: command.activity,
        },
      };
      const workflowSpecification = workflowSpecificationForThread(readModel, thread);
      const checkpoint =
        workflowSpecification === null
          ? null
          : workflowCheckpointFromActivity({
              activity: command.activity,
              stage: workflowSpecification.stage,
            });
      const isDuplicateCheckpoint =
        checkpoint !== null &&
        workflowSpecification?.stage.checkpoint?.requestId === checkpoint.requestId;
      const runtimeFailure =
        workflowSpecification !== null && command.activity.kind === "runtime.error"
          ? (Option.getOrUndefined(decodeRuntimeErrorActivityPayload(command.activity.payload))
              ?.message ?? command.activity.summary)
          : null;
      const workflowSpecificationEvent =
        workflowSpecification !== null &&
        ((checkpoint !== null && !isDuplicateCheckpoint) || runtimeFailure !== null)
          ? yield* withEventBase({
              aggregateKind: "thread",
              aggregateId: workflowSpecification.originThread.id,
              occurredAt: command.createdAt,
              commandId: command.commandId,
            }).pipe(
              Effect.map((eventBase): Omit<OrchestrationEvent, "sequence"> => {
                const nextStage: WorkflowSpecificationStage =
                  runtimeFailure !== null
                    ? {
                        ...workflowSpecification.stage,
                        status: "failed",
                        ...(workflowSpecification.stage.checkpoint?.status === "pending"
                          ? {
                              checkpoint: {
                                ...workflowSpecification.stage.checkpoint,
                                status: "stale" as const,
                              },
                            }
                          : {}),
                        failure: runtimeFailure,
                        updatedAt: command.createdAt,
                      }
                    : checkpoint === null
                      ? workflowSpecification.stage
                      : {
                          ...workflowSpecification.stage,
                          status: "checkpoint",
                          checkpoint,
                          updatedAt: command.createdAt,
                        };
                return {
                  ...eventBase,
                  causationEventId: activityAppendedEvent.eventId,
                  type:
                    runtimeFailure !== null
                      ? "thread.workflow-specification-failed"
                      : "thread.workflow-specification-checkpointed",
                  payload: {
                    threadId: workflowSpecification.originThread.id,
                    attachment: incrementWorkflowVersion({
                      ...workflowSpecification.attachment,
                      specificationStage: nextStage,
                    }),
                  },
                };
              }),
            )
          : null;
      const workflowTicketing = workflowTicketingForThread(readModel, thread);
      const ticketingCheckpoint =
        workflowTicketing === null
          ? null
          : workflowTicketingCheckpointFromActivity({
              activity: command.activity,
              stage: workflowTicketing.stage,
            });
      const isDuplicateTicketingCheckpoint =
        ticketingCheckpoint !== null &&
        workflowTicketing?.stage.checkpoint?.requestId === ticketingCheckpoint.requestId;
      const ticketingRuntimeFailure =
        workflowTicketing !== null && command.activity.kind === "runtime.error"
          ? (Option.getOrUndefined(decodeRuntimeErrorActivityPayload(command.activity.payload))
              ?.message ?? command.activity.summary)
          : null;
      const workflowTicketingEvent =
        workflowTicketing !== null &&
        ((ticketingCheckpoint !== null && !isDuplicateTicketingCheckpoint) ||
          ticketingRuntimeFailure !== null)
          ? yield* withEventBase({
              aggregateKind: "thread",
              aggregateId: workflowTicketing.originThread.id,
              occurredAt: command.createdAt,
              commandId: command.commandId,
            }).pipe(
              Effect.map((eventBase): Omit<OrchestrationEvent, "sequence"> => {
                const nextStage: WorkflowTicketingStage =
                  ticketingRuntimeFailure !== null
                    ? {
                        ...workflowTicketing.stage,
                        status: "failed",
                        ...(workflowTicketing.stage.checkpoint?.status === "pending"
                          ? {
                              checkpoint: {
                                ...workflowTicketing.stage.checkpoint,
                                status: "stale" as const,
                              },
                            }
                          : {}),
                        failure: ticketingRuntimeFailure,
                        updatedAt: command.createdAt,
                      }
                    : ticketingCheckpoint === null
                      ? workflowTicketing.stage
                      : {
                          ...workflowTicketing.stage,
                          status: "checkpoint",
                          checkpoint: ticketingCheckpoint,
                          updatedAt: command.createdAt,
                        };
                return {
                  ...eventBase,
                  causationEventId: activityAppendedEvent.eventId,
                  type:
                    ticketingRuntimeFailure !== null
                      ? "thread.workflow-ticketing-failed"
                      : "thread.workflow-ticketing-checkpointed",
                  payload: {
                    threadId: workflowTicketing.originThread.id,
                    attachment: incrementWorkflowVersion({
                      ...workflowTicketing.attachment,
                      ticketingStage: nextStage,
                    }),
                  },
                };
              }),
            )
          : null;
      // An approval or user-input request is blocked-on-you work — it must
      // never stay hidden inside a settled slim row.
      const wakesSettledThread =
        command.activity.kind === "approval.requested" ||
        command.activity.kind === "user-input.requested";
      // Real activity resets ANY override (settled wakes, active unpins).
      if (thread.settledOverride === null || !wakesSettledThread) {
        const workflowEvents = [workflowSpecificationEvent, workflowTicketingEvent].filter(
          (event): event is Omit<OrchestrationEvent, "sequence"> => event !== null,
        );
        return workflowEvents.length === 0
          ? activityAppendedEvent
          : [activityAppendedEvent, ...workflowEvents];
      }
      const unsettledEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.unsettled",
        payload: {
          threadId: command.threadId,
          reason: "activity",
          updatedAt: command.createdAt,
        },
      };
      return [
        unsettledEvent,
        activityAppendedEvent,
        ...(workflowSpecificationEvent !== null ? [workflowSpecificationEvent] : []),
        ...(workflowTicketingEvent !== null ? [workflowTicketingEvent] : []),
      ];
    }

    case "thread.wayfinder.publication.update": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const updated: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.wayfinder-publication-updated",
        payload: {
          threadId: command.threadId,
          skillRunId: command.skillRunId,
          publication: command.publication,
          ...(command.wayfinderMap !== undefined ? { wayfinderMap: command.wayfinderMap } : {}),
        },
      };
      const workflowSynchronized =
        command.publication.status === "synchronized" && command.wayfinderMap !== undefined
          ? yield* synchronizeWorkflowAttachment({
              command,
              thread,
              skillRunId: command.skillRunId,
              sourceStage: "publication",
              data: {
                wayfinderMap: command.wayfinderMap,
                wayfinderPublication: command.publication,
                wayfinderSynchronizedAt: command.wayfinderMap.lastSynchronizedAt,
              },
            })
          : null;
      if (command.publication.status === "awaiting-approval") {
        const approvalRequested: Omit<OrchestrationEvent, "sequence"> = {
          ...(yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          })),
          type: "thread.activity-appended",
          payload: {
            threadId: command.threadId,
            activity: {
              id: EventId.make(`wayfinder-publication-approval:${command.commandId}`),
              tone: "info",
              kind: "wayfinder.publication.approval-requested",
              summary: "Wayfinder publication needs confirmation",
              payload: { skillRunId: command.skillRunId },
              turnId: null,
              createdAt: command.createdAt,
            },
          },
        };
        return [
          updated,
          ...(workflowSynchronized ? [workflowSynchronized] : []),
          approvalRequested,
        ];
      }
      if (command.publication.status !== "synchronized") return updated;
      const published: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.activity-appended",
        payload: {
          threadId: command.threadId,
          activity: {
            id: EventId.make(`wayfinder-publication:${command.commandId}`),
            tone: "info",
            kind: "wayfinder.draft.published",
            summary: "Wayfinder draft published and reconciled",
            payload: {
              skillRunId: command.skillRunId,
              canonicalReference: command.wayfinderMap?.canonicalReference,
            },
            turnId: null,
            createdAt: command.createdAt,
          },
        },
      };
      return [updated, ...(workflowSynchronized ? [workflowSynchronized] : []), published];
    }

    case "thread.wayfinder.mutation.update": {
      const thread = yield* requireThread({ readModel, command, threadId: command.threadId });
      const updated: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.wayfinder-mutation-updated",
        payload: {
          threadId: command.threadId,
          skillRunId: command.skillRunId,
          mutation: command.mutation,
          ...(command.wayfinderMap !== undefined ? { wayfinderMap: command.wayfinderMap } : {}),
        },
      };
      const workflowSynchronized =
        command.mutation.status === "synchronized" && command.wayfinderMap !== undefined
          ? yield* synchronizeWorkflowAttachment({
              command,
              thread,
              skillRunId: command.skillRunId,
              sourceStage: "mutation",
              data: {
                wayfinderMap: command.wayfinderMap,
                wayfinderSynchronizedAt: command.wayfinderMap.lastSynchronizedAt,
              },
            })
          : null;
      if (command.mutation.status !== "awaiting-approval") {
        return workflowSynchronized ? [updated, workflowSynchronized] : updated;
      }
      return [
        updated,
        ...(workflowSynchronized ? [workflowSynchronized] : []),
        {
          ...(yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          })),
          type: "thread.activity-appended",
          payload: {
            threadId: command.threadId,
            activity: {
              id: EventId.make(`wayfinder-mutation-approval:${command.commandId}`),
              tone: "info",
              kind: "wayfinder.mutation.approval-requested",
              summary: "Wayfinder change needs confirmation",
              payload: {
                skillRunId: command.skillRunId,
                actionId: command.mutation.actionId,
                action: command.mutation.action,
              },
              turnId: null,
              createdAt: command.createdAt,
            },
          },
        },
      ];
    }

    case "thread.wayfinder.reconciliation.update": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const updated: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.wayfinder-reconciliation-updated",
        payload: {
          threadId: command.threadId,
          skillRunId: command.skillRunId,
          synchronization: command.synchronization,
          ...(command.wayfinderMap !== undefined ? { wayfinderMap: command.wayfinderMap } : {}),
        },
      };
      const workflowSynchronized =
        command.synchronization.status === "healthy" && command.wayfinderMap !== undefined
          ? yield* synchronizeWorkflowAttachment({
              command,
              thread,
              skillRunId: command.skillRunId,
              sourceStage: "reconciliation",
              data: {
                wayfinderMap: command.wayfinderMap,
                wayfinderSynchronizedAt: command.wayfinderMap.lastSynchronizedAt,
                wayfinderSynchronization: command.synchronization,
              },
            })
          : null;
      return workflowSynchronized ? [updated, workflowSynchronized] : updated;
    }

    case "thread.wayfinder.research.update": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.wayfinder-research-updated",
        payload: {
          threadId: command.threadId,
          skillRunId: command.skillRunId,
          research: command.research,
        },
      };
    }

    default: {
      command satisfies never;
      const fallback = command as never as { type: string };
      return yield* new OrchestrationCommandInvariantError({
        commandType: fallback.type,
        detail: `Unknown command type: ${fallback.type}`,
      });
    }
  }
});
