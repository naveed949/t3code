import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";
import * as Struct from "effect/Struct";
import { ProviderOptionSelections } from "./model.ts";
import { RepositoryIdentity } from "./environment.ts";
import {
  ApprovalRequestId,
  CheckpointRef,
  CommandId,
  EventId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ProviderItemId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
  TurnId,
  WorkstreamId,
  SkillRunId,
} from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import { UserInputQuestion } from "./providerRuntime.ts";
import {
  OptionalWayfinderDraft,
  OptionalWayfinderMutation,
  OptionalWayfinderResearchState,
  OptionalWayfinderPublication,
  WayfinderMutation,
  WayfinderMutationAction,
  WayfinderResearchAction,
  WayfinderResearchState,
  WayfinderPublication,
} from "./nativeSkills.ts";

export const ORCHESTRATION_WS_METHODS = {
  dispatchCommand: "orchestration.dispatchCommand",
  getTurnDiff: "orchestration.getTurnDiff",
  getFullThreadDiff: "orchestration.getFullThreadDiff",
  searchThreads: "orchestration.searchThreads",
  getArchivedShellSnapshot: "orchestration.getArchivedShellSnapshot",
  subscribeShell: "orchestration.subscribeShell",
  subscribeThread: "orchestration.subscribeThread",
} as const;

export const ProviderApprovalPolicy = Schema.Literals([
  "untrusted",
  "on-failure",
  "on-request",
  "never",
]);
export type ProviderApprovalPolicy = typeof ProviderApprovalPolicy.Type;
export const ProviderSandboxMode = Schema.Literals([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);
export type ProviderSandboxMode = typeof ProviderSandboxMode.Type;

/**
 * `ModelSelection` — selection of a model on a configured provider instance.
 *
 * The routing key is `instanceId` (a user-defined slug identifying one
 * configured provider instance). Drivers, credentials, working-directory
 * bindings, and any other per-instance state are recovered from the
 * runtime registry via the instance id.
 *
 * Wire legacy: persisted selections produced before the driver/instance
 * split carried a `provider: <driver-id>` field instead. The schema absorbs
 * that shape via a pre-decoding transform — `{provider, model}` is promoted
 * to `{instanceId: defaultInstanceIdForDriver(provider), model}`. No
 * post-decode compatibility code lives in the runtime; the transform is the
 * only compat surface.
 */
const ModelSelectionWire = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(ProviderOptionSelections),
});

// Source shape for persisted legacy payloads. Fields are typed as
// `Schema.Unknown` so malformed drafts still make it into the transform and
// fail validation through the target schema (with proper error messages)
// rather than at the source-struct layer where the error is less actionable.
const ModelSelectionSource = Schema.Struct({
  provider: Schema.optional(Schema.Unknown),
  instanceId: Schema.optional(Schema.Unknown),
  model: Schema.Unknown,
  options: Schema.optional(Schema.Unknown),
});

export const ModelSelection = ModelSelectionSource.pipe(
  Schema.decodeTo(
    ModelSelectionWire,
    SchemaTransformation.transformOrFail({
      decode: (raw) => {
        // Resolve the routing key: prefer an explicit `instanceId`; fall
        // back to promoting the legacy `provider` slug (the canonical
        // `defaultInstanceIdForDriver` mapping) so persisted rollout-era
        // payloads decode without data loss. The target schema brands the
        // string as `ProviderInstanceId`.
        const instanceIdSource =
          raw.instanceId !== undefined
            ? raw.instanceId
            : typeof raw.provider === "string"
              ? raw.provider
              : undefined;
        const base: Record<string, unknown> = {
          instanceId: instanceIdSource,
          model: raw.model,
        };
        if (raw.options !== undefined) base.options = raw.options;
        return Effect.succeed(base as typeof ModelSelectionWire.Encoded);
      },
      encode: (value) => {
        const base: Record<string, unknown> = {
          model: value.model,
          instanceId: value.instanceId,
        };
        if (value.options !== undefined) base.options = value.options;
        return Effect.succeed(base as typeof ModelSelectionSource.Encoded);
      },
    }),
  ),
);
export type ModelSelection = typeof ModelSelection.Type;

export const RuntimeMode = Schema.Literals([
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
]);
export type RuntimeMode = typeof RuntimeMode.Type;
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";
export const ProviderInteractionMode = Schema.Literals(["default", "plan"]);
export type ProviderInteractionMode = typeof ProviderInteractionMode.Type;
export const DEFAULT_PROVIDER_INTERACTION_MODE: ProviderInteractionMode = "default";
export const ProviderRequestKind = Schema.Literals(["command", "file-read", "file-change"]);
export type ProviderRequestKind = typeof ProviderRequestKind.Type;
export const AssistantDeliveryMode = Schema.Literals(["buffered", "streaming"]);
export type AssistantDeliveryMode = typeof AssistantDeliveryMode.Type;
export const ProviderApprovalDecision = Schema.Literals([
  "accept",
  "acceptForSession",
  "decline",
  "cancel",
]);
export type ProviderApprovalDecision = typeof ProviderApprovalDecision.Type;
export const ProviderUserInputAnswers = Schema.Record(Schema.String, Schema.Unknown);
export type ProviderUserInputAnswers = typeof ProviderUserInputAnswers.Type;

export const PROVIDER_SEND_TURN_MAX_INPUT_CHARS = 120_000;
export const PROVIDER_SEND_TURN_MAX_ATTACHMENTS = 8;
export const PROVIDER_SEND_TURN_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS = 14_000_000;
const CHAT_ATTACHMENT_ID_MAX_CHARS = 128;
// Correlation id is command id by design in this model.
export const CorrelationId = CommandId;
export type CorrelationId = typeof CorrelationId.Type;

const ChatAttachmentId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(CHAT_ATTACHMENT_ID_MAX_CHARS),
  Schema.isPattern(/^[a-z0-9_-]+$/i),
);
export type ChatAttachmentId = typeof ChatAttachmentId.Type;

export const ChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  id: ChatAttachmentId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
});
export type ChatImageAttachment = typeof ChatImageAttachment.Type;

const UploadChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
  dataUrl: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS),
  ),
});
export type UploadChatImageAttachment = typeof UploadChatImageAttachment.Type;

export const ChatAttachment = Schema.Union([ChatImageAttachment]);
export type ChatAttachment = typeof ChatAttachment.Type;
const UploadChatAttachment = Schema.Union([UploadChatImageAttachment]);
export type UploadChatAttachment = typeof UploadChatAttachment.Type;

export const SkillInvocationAction = Schema.Union([
  Schema.Struct({ id: Schema.Literal("new-map") }),
  Schema.Struct({ id: Schema.Literal("continue-map"), reference: TrimmedNonEmptyString }),
  Schema.Struct({
    id: Schema.Literal("handoff-to-spec"),
    sourceSkillRunId: SkillRunId,
    sourceThreadId: ThreadId,
    canonicalReference: Schema.Struct({
      number: Schema.Int.check(Schema.isGreaterThan(0)),
      url: TrimmedNonEmptyString,
    }),
    wayfinderSynchronizedAt: IsoDateTime,
    acknowledgedIncomplete: Schema.Boolean,
  }),
  Schema.Struct({
    id: Schema.Literal("handoff-to-tickets"),
    sourceSkillRunId: SkillRunId,
    sourceThreadId: ThreadId,
    sourceWorkflowPrdArtifactId: TrimmedNonEmptyString,
    sourceWorkflowPrdVersion: Schema.Int.check(Schema.isGreaterThan(0)),
  }),
  Schema.Struct({
    id: Schema.Literal("work-ticket"),
    ticketNumber: Schema.Int.check(Schema.isGreaterThan(0)),
    sourceSkillRunId: SkillRunId,
    sourceThreadId: Schema.optional(ThreadId),
  }),
]);
export type SkillInvocationAction = typeof SkillInvocationAction.Type;

export const SkillInvocationRequest = Schema.Struct({
  skillName: TrimmedNonEmptyString,
  skillPath: TrimmedNonEmptyString,
  arguments: Schema.optional(TrimmedNonEmptyString),
  action: Schema.optional(SkillInvocationAction),
  executionPreference: Schema.optional(Schema.Literal("generic")),
});
export type SkillInvocationRequest = typeof SkillInvocationRequest.Type;

export const PinnedSkillIdentity = Schema.Struct({
  name: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  contentDigest: TrimmedNonEmptyString.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/)),
});
export type PinnedSkillIdentity = typeof PinnedSkillIdentity.Type;

export const NativeSkillExecution = Schema.Struct({
  mode: Schema.Literal("native"),
  adapterId: TrimmedNonEmptyString,
  adapterVersion: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});
export type NativeSkillExecution = typeof NativeSkillExecution.Type;

export const GenericSkillExecution = Schema.Struct({
  mode: Schema.Literal("generic"),
  reason: Schema.Literals([
    "unsupported-provider",
    "unsupported-digest",
    "unregistered-skill",
    "user-selected-generic",
  ]),
});
export type GenericSkillExecution = typeof GenericSkillExecution.Type;

export const SkillExecution = Schema.Union([NativeSkillExecution, GenericSkillExecution]);
export type SkillExecution = typeof SkillExecution.Type;

export const WayfinderTicketState = Schema.Literals(["open", "closed"]);
export type WayfinderTicketState = typeof WayfinderTicketState.Type;

export const WayfinderTicketClassification = Schema.Literals([
  "research",
  "prototype",
  "grilling",
  "task",
  "out-of-scope",
  "unknown",
]);
export type WayfinderTicketClassification = typeof WayfinderTicketClassification.Type;

export const WayfinderReconcileReason = Schema.Literals([
  "open",
  "reconnect",
  "focus",
  "manual",
  "mutation",
  "poll",
  "resume",
]);
export type WayfinderReconcileReason = typeof WayfinderReconcileReason.Type;

export const WayfinderSynchronizationState = Schema.Struct({
  status: Schema.Literals(["synchronizing", "healthy", "unavailable", "conflict"]),
  reason: WayfinderReconcileReason,
  lastAttemptedAt: IsoDateTime,
  lastSuccessfulAt: Schema.optional(IsoDateTime),
  canMutate: Schema.Boolean,
  expectedRevision: Schema.optional(TrimmedNonEmptyString),
  actualRevision: Schema.optional(TrimmedNonEmptyString),
  message: Schema.optional(TrimmedNonEmptyString),
});
export type WayfinderSynchronizationState = typeof WayfinderSynchronizationState.Type;

export const WayfinderMapProjection = Schema.Struct({
  canonicalReference: Schema.Struct({
    number: Schema.Int.check(Schema.isGreaterThan(0)),
    title: TrimmedNonEmptyString,
    url: TrimmedNonEmptyString,
    state: WayfinderTicketState,
    commentCount: Schema.optional(NonNegativeInt),
  }),
  revision: Schema.optional(TrimmedNonEmptyString),
  destination: Schema.String,
  notes: Schema.String,
  decisionsSoFar: Schema.Array(
    Schema.Struct({
      title: TrimmedNonEmptyString,
      url: Schema.NullOr(TrimmedNonEmptyString),
      summary: Schema.String,
    }),
  ),
  fogOfWar: Schema.Array(TrimmedNonEmptyString),
  outOfScope: Schema.Array(TrimmedNonEmptyString),
  tickets: Schema.Array(
    Schema.Struct({
      number: Schema.Int.check(Schema.isGreaterThan(0)),
      title: TrimmedNonEmptyString,
      url: TrimmedNonEmptyString,
      state: WayfinderTicketState,
      classification: WayfinderTicketClassification,
      claimedBy: Schema.NullOr(TrimmedNonEmptyString),
      blockedBy: Schema.Array(Schema.Int.check(Schema.isGreaterThan(0))),
      blocks: Schema.Array(Schema.Int.check(Schema.isGreaterThan(0))),
      commentCount: Schema.optional(NonNegativeInt),
      lastCommentedAt: Schema.optional(IsoDateTime),
    }),
  ),
  frontier: Schema.Array(Schema.Int.check(Schema.isGreaterThan(0))),
  lastSynchronizedAt: IsoDateTime,
});
export type WayfinderMapProjection = typeof WayfinderMapProjection.Type;

export const ResolvedSkillInvocation = Schema.Struct({
  skill: PinnedSkillIdentity,
  arguments: Schema.optional(TrimmedNonEmptyString),
  action: Schema.optional(SkillInvocationAction),
  execution: SkillExecution,
  wayfinderMap: Schema.optional(WayfinderMapProjection),
  wayfinderSynchronizedAt: Schema.optional(IsoDateTime),
  wayfinderSynchronization: Schema.optional(WayfinderSynchronizationState),
  reconnectWorkstreamId: Schema.optional(WorkstreamId),
});
export type ResolvedSkillInvocation = typeof ResolvedSkillInvocation.Type;

export const SkillInvocation = Schema.Struct({
  ...ResolvedSkillInvocation.fields,
  workstreamId: WorkstreamId,
  skillRunId: SkillRunId,
  projectId: ProjectId,
  threadId: ThreadId,
  createdAt: IsoDateTime,
  wayfinderDraft: OptionalWayfinderDraft,
  wayfinderPublication: OptionalWayfinderPublication,
  wayfinderMutation: OptionalWayfinderMutation,
  wayfinderResearch: OptionalWayfinderResearchState,
});
export type SkillInvocation = typeof SkillInvocation.Type;

/**
 * Structured Wayfinder state that can safely seed an explicitly attached
 * Development Workflow. This deliberately contains only native Wayfinder
 * projection data; assistant prose and generic-skill output never become
 * workflow authority.
 */
export const WorkflowAttachmentWayfinderData = Schema.Struct({
  wayfinderMap: Schema.optional(WayfinderMapProjection),
  wayfinderDraft: OptionalWayfinderDraft,
  wayfinderPublication: OptionalWayfinderPublication,
  wayfinderSynchronizedAt: Schema.optional(IsoDateTime),
  wayfinderSynchronization: Schema.optional(WayfinderSynchronizationState),
});
export type WorkflowAttachmentWayfinderData = typeof WorkflowAttachmentWayfinderData.Type;

export const WorkflowRunNodeScope = Schema.Struct({
  nodeId: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
});
export type WorkflowRunNodeScope = typeof WorkflowRunNodeScope.Type;

export const WorkflowRunProviderAssignment = Schema.Struct({
  nodeId: TrimmedNonEmptyString,
  providerInstanceId: ProviderInstanceId,
});
export type WorkflowRunProviderAssignment = typeof WorkflowRunProviderAssignment.Type;

export const WorkflowRunTargetVerification = Schema.Struct({
  fixedPoint: Schema.Literals(["verified", "missing", "unverified"]),
  workstreamBaseline: Schema.Literals(["verified", "missing", "unverified"]),
  remoteTarget: Schema.Literals(["verified", "missing", "unverified"]),
});
export type WorkflowRunTargetVerification = typeof WorkflowRunTargetVerification.Type;

export const WorkflowRunRequiredSkill = Schema.Struct({
  nodeId: TrimmedNonEmptyString,
  providerInstanceId: ProviderInstanceId,
  stage: TrimmedNonEmptyString,
  skill: Schema.Struct({
    name: TrimmedNonEmptyString,
    // A missing provider capability has no path. Never invent a path merely
    // to make a client-supplied capability look discovered.
    path: Schema.optional(TrimmedNonEmptyString),
    contentDigest: Schema.optional(TrimmedNonEmptyString),
  }),
  status: Schema.Literals(["available", "missing", "changed"]),
});
export type WorkflowRunRequiredSkill = typeof WorkflowRunRequiredSkill.Type;

export const WorkflowRunAuthority = Schema.Struct({
  createWorktree: Schema.Boolean,
  runProvider: Schema.Boolean,
  mutateTracker: Schema.Boolean,
  pushBaseline: Schema.Boolean,
  createDraftPullRequest: Schema.Boolean,
});
export type WorkflowRunAuthority = typeof WorkflowRunAuthority.Type;

export const WorkflowRunConfiguration = Schema.Struct({
  workflowGoal: TrimmedNonEmptyString,
  runScope: Schema.Array(WorkflowRunNodeScope).check(Schema.isMinLength(1)),
  defaultProviderInstanceId: ProviderInstanceId,
  providerOverrides: Schema.Array(WorkflowRunProviderAssignment),
  requiredSkills: Schema.Array(WorkflowRunRequiredSkill),
  fixedPoint: TrimmedNonEmptyString,
  workstreamBaseline: TrimmedNonEmptyString,
  remoteTarget: TrimmedNonEmptyString,
  targetVerification: Schema.optional(WorkflowRunTargetVerification),
  // The environment owns this ceiling. A client can choose a lower execution
  // limit but cannot claim a larger capacity during preflight.
  environmentAutomationCapacity: Schema.Literal(2),
  executionLimit: Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(2)),
  authority: WorkflowRunAuthority,
});
export type WorkflowRunConfiguration = typeof WorkflowRunConfiguration.Type;

export const WorkflowRunPreview = Schema.Struct({
  configuration: WorkflowRunConfiguration,
  status: Schema.Literals(["ready-for-confirmation", "blocked"]),
  blockers: Schema.Array(TrimmedNonEmptyString),
  authorityGranted: Schema.Literal(false),
  generatedAt: IsoDateTime,
});
export type WorkflowRunPreview = typeof WorkflowRunPreview.Type;

export const WorkflowRunAutomationStatus = Schema.Literals([
  "idle",
  "running",
  "draining",
  "paused",
]);
export type WorkflowRunAutomationStatus = typeof WorkflowRunAutomationStatus.Type;

export const WorkflowRun = Schema.Struct({
  configuration: WorkflowRunConfiguration,
  status: Schema.Literal("confirmed"),
  authorityGranted: Schema.Literal(true),
  confirmedAt: IsoDateTime,
  // The command identity is retained with the immutable configuration so a
  // replay cannot silently create a second dispatch for the same run.
  dispatchIdentity: CommandId,
  immutableAtDispatch: IsoDateTime,
  // Older confirmed runs remain readable and are treated as idle until an
  // explicit Run workflow operation starts automation.
  automationStatus: Schema.optional(WorkflowRunAutomationStatus),
});
export type WorkflowRun = typeof WorkflowRun.Type;

/**
 * The structured stage that supplied a durable Wayfinder artifact. Keeping
 * this explicit prevents generic assistant prose from acquiring workflow
 * authority during synchronization.
 */
export const WorkflowArtifactSourceStage = Schema.Literals([
  "attachment",
  "publication",
  "mutation",
  "reconciliation",
  "specification",
]);
export type WorkflowArtifactSourceStage = typeof WorkflowArtifactSourceStage.Type;

export const WorkflowArtifactLineage = Schema.Struct({
  workstreamId: WorkstreamId,
  sourceSkillRunId: SkillRunId,
  sourceStage: WorkflowArtifactSourceStage,
  upstreamVersion: TrimmedNonEmptyString,
  upstreamArtifactId: Schema.optional(TrimmedNonEmptyString),
});
export type WorkflowArtifactLineage = typeof WorkflowArtifactLineage.Type;

export const WorkflowArtifactMarkerKind = Schema.Literals(["new", "changed"]);
export type WorkflowArtifactMarkerKind = typeof WorkflowArtifactMarkerKind.Type;

export const WorkflowArtifactMarkerState = Schema.Literals(["unread", "viewed", "acknowledged"]);
export type WorkflowArtifactMarkerState = typeof WorkflowArtifactMarkerState.Type;

/**
 * Retained artifact markers live outside client caches, while the graph keeps
 * an aggregate for markers that age out of its bounded lineage window.
 */
export const WorkflowArtifactMarker = Schema.Struct({
  kind: WorkflowArtifactMarkerKind,
  state: WorkflowArtifactMarkerState,
  markedAt: IsoDateTime,
  viewedAt: Schema.optional(IsoDateTime),
  acknowledgedAt: Schema.optional(IsoDateTime),
});
export type WorkflowArtifactMarker = typeof WorkflowArtifactMarker.Type;

const WorkflowArtifactBaseFields = {
  id: TrimmedNonEmptyString,
  logicalId: TrimmedNonEmptyString,
  state: Schema.Literals(["current", "superseded"]),
  lineage: WorkflowArtifactLineage,
  upstreamSynchronizedAt: IsoDateTime,
  importedAt: IsoDateTime,
  marker: WorkflowArtifactMarker,
} as const;

export const WorkflowPrdDocument = Schema.Struct({
  version: Schema.Int.check(Schema.isGreaterThan(0)),
  title: TrimmedNonEmptyString,
  problemStatement: TrimmedNonEmptyString,
  solution: TrimmedNonEmptyString,
  userStories: Schema.Array(TrimmedNonEmptyString).check(Schema.isMinLength(1)),
  implementationDecisions: Schema.Array(TrimmedNonEmptyString).check(Schema.isMinLength(1)),
  testingDecisions: Schema.Array(TrimmedNonEmptyString).check(Schema.isMinLength(1)),
  outOfScope: Schema.Array(TrimmedNonEmptyString),
  furtherNotes: Schema.optional(TrimmedNonEmptyString),
});
export type WorkflowPrdDocument = typeof WorkflowPrdDocument.Type;

export const WorkflowArtifact = Schema.Union([
  Schema.Struct({
    ...WorkflowArtifactBaseFields,
    kind: Schema.Literal("wayfinder-map"),
  }),
  Schema.Struct({
    ...WorkflowArtifactBaseFields,
    kind: Schema.Literal("workflow-prd"),
    version: Schema.Int.check(Schema.isGreaterThan(0)),
  }),
]);
export type WorkflowArtifact = typeof WorkflowArtifact.Type;

/**
 * Full artifact content is loaded separately from the bounded graph metadata.
 * Completion events retain this detail for a lazy Node Inspector query without
 * putting the whole PRD into every workflow snapshot or graph delta.
 */
export const WorkflowArtifactDetail = Schema.Struct({
  artifactId: TrimmedNonEmptyString,
  kind: Schema.Literal("workflow-prd"),
  document: WorkflowPrdDocument,
});
export type WorkflowArtifactDetail = typeof WorkflowArtifactDetail.Type;

export const WorkflowSpecificationStageStatus = Schema.Literals([
  "running",
  "checkpoint",
  "completed",
  "stopped",
  "failed",
  "capability-blocked",
]);
export type WorkflowSpecificationStageStatus = typeof WorkflowSpecificationStageStatus.Type;

export const WorkflowCheckpointRequestStatus = Schema.Literals(["pending", "resolved", "stale"]);
export type WorkflowCheckpointRequestStatus = typeof WorkflowCheckpointRequestStatus.Type;

export const WorkflowCheckpointRequest = Schema.Struct({
  requestId: ApprovalRequestId,
  kind: Schema.Literal("specification-test-seam"),
  workstreamId: WorkstreamId,
  originThreadId: ThreadId,
  specificationThreadId: ThreadId,
  skillRunId: SkillRunId,
  questions: Schema.Array(UserInputQuestion).check(Schema.isMinLength(1)),
  status: WorkflowCheckpointRequestStatus,
  requestedAt: IsoDateTime,
  resolvedAt: Schema.optional(IsoDateTime),
  answers: Schema.optional(ProviderUserInputAnswers),
});
export type WorkflowCheckpointRequest = typeof WorkflowCheckpointRequest.Type;

export const WorkflowSpecificationStage = Schema.Struct({
  status: WorkflowSpecificationStageStatus,
  workstreamId: WorkstreamId,
  nodeId: TrimmedNonEmptyString,
  originThreadId: ThreadId,
  specificationThreadId: ThreadId,
  skillRunId: SkillRunId,
  providerInstanceId: ProviderInstanceId,
  skill: PinnedSkillIdentity,
  checkpoint: Schema.optional(WorkflowCheckpointRequest),
  artifactId: Schema.optional(TrimmedNonEmptyString),
  failure: Schema.optional(TrimmedNonEmptyString),
  startedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkflowSpecificationStage = typeof WorkflowSpecificationStage.Type;

export const WorkflowTicketBatchTicket = Schema.Struct({
  key: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  body: Schema.String,
  parentKey: Schema.NullOr(TrimmedNonEmptyString),
});
export type WorkflowTicketBatchTicket = typeof WorkflowTicketBatchTicket.Type;

export const WorkflowTicketBatchBlockerEdge = Schema.Struct({
  blockedKey: TrimmedNonEmptyString,
  blockerKey: TrimmedNonEmptyString,
});
export type WorkflowTicketBatchBlockerEdge = typeof WorkflowTicketBatchBlockerEdge.Type;

export const WorkflowTicketBatch = Schema.Struct({
  id: TrimmedNonEmptyString,
  sourceWorkflowPrdArtifactId: TrimmedNonEmptyString,
  sourceWorkflowPrdVersion: Schema.Int.check(Schema.isGreaterThan(0)),
  tickets: Schema.Array(WorkflowTicketBatchTicket).check(Schema.isMinLength(1)),
  blockerEdges: Schema.Array(WorkflowTicketBatchBlockerEdge),
});
export type WorkflowTicketBatch = typeof WorkflowTicketBatch.Type;

export const WorkflowTicketIdentity = Schema.Struct({
  key: TrimmedNonEmptyString,
  number: Schema.Int.check(Schema.isGreaterThan(0)),
  url: TrimmedNonEmptyString,
});
export type WorkflowTicketIdentity = typeof WorkflowTicketIdentity.Type;

export const WorkflowTicketBatchPublicationStatus = Schema.Literals([
  "requested",
  "publishing",
  "succeeded",
  "reconciled",
  "failed",
]);
export type WorkflowTicketBatchPublicationStatus = typeof WorkflowTicketBatchPublicationStatus.Type;

export const WorkflowTicketBatchPublication = Schema.Struct({
  status: WorkflowTicketBatchPublicationStatus,
  batchId: TrimmedNonEmptyString,
  identities: Schema.Array(WorkflowTicketIdentity),
  requestedAt: IsoDateTime,
  updatedAt: IsoDateTime,
  failure: Schema.optional(TrimmedNonEmptyString),
});
export type WorkflowTicketBatchPublication = typeof WorkflowTicketBatchPublication.Type;

export const WorkflowTrackerTicket = Schema.Struct({
  key: Schema.NullOr(TrimmedNonEmptyString),
  number: Schema.Int.check(Schema.isGreaterThan(0)),
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  state: WayfinderTicketState,
  body: Schema.optional(Schema.String),
  parentNumber: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  blockedBy: Schema.Array(Schema.Int.check(Schema.isGreaterThan(0))),
  blocks: Schema.Array(Schema.Int.check(Schema.isGreaterThan(0))),
  includedInRun: Schema.Boolean,
  integration: Schema.optional(
    Schema.Struct({
      status: Schema.Literal("integrated"),
      baseline: TrimmedNonEmptyString,
      reviewedAt: IsoDateTime,
      synchronizedAt: IsoDateTime,
    }),
  ),
});
export type WorkflowTrackerTicket = typeof WorkflowTrackerTicket.Type;

export const WorkflowTrackerProjection = Schema.Struct({
  status: Schema.Literals(["synchronizing", "healthy", "unavailable", "conflict"]),
  canonicalReference: Schema.Struct({
    number: Schema.Int.check(Schema.isGreaterThan(0)),
    title: TrimmedNonEmptyString,
    url: TrimmedNonEmptyString,
    state: WayfinderTicketState,
  }),
  revision: Schema.optional(TrimmedNonEmptyString),
  batchId: Schema.optional(TrimmedNonEmptyString),
  tickets: Schema.Array(WorkflowTrackerTicket),
  synchronizedAt: IsoDateTime,
  message: Schema.optional(TrimmedNonEmptyString),
});
export type WorkflowTrackerProjection = typeof WorkflowTrackerProjection.Type;

export const WorkflowTicketingCheckpointRequest = Schema.Struct({
  requestId: ApprovalRequestId,
  kind: Schema.Literal("ticketing-granularity-blockers"),
  workstreamId: WorkstreamId,
  originThreadId: ThreadId,
  ticketingThreadId: ThreadId,
  skillRunId: SkillRunId,
  sourceWorkflowPrdArtifactId: TrimmedNonEmptyString,
  approvedBatch: WorkflowTicketBatch,
  questions: Schema.Array(UserInputQuestion).check(Schema.isMinLength(1)),
  status: WorkflowCheckpointRequestStatus,
  requestedAt: IsoDateTime,
  resolvedAt: Schema.optional(IsoDateTime),
  answers: Schema.optional(ProviderUserInputAnswers),
});
export type WorkflowTicketingCheckpointRequest = typeof WorkflowTicketingCheckpointRequest.Type;

export const WorkflowTicketingStageStatus = Schema.Literals([
  "running",
  "checkpoint",
  "publishing",
  "completed",
  "stopped",
  "failed",
  "capability-blocked",
]);
export type WorkflowTicketingStageStatus = typeof WorkflowTicketingStageStatus.Type;

export const WorkflowTicketingStage = Schema.Struct({
  status: WorkflowTicketingStageStatus,
  workstreamId: WorkstreamId,
  nodeId: TrimmedNonEmptyString,
  originThreadId: ThreadId,
  ticketingThreadId: ThreadId,
  skillRunId: SkillRunId,
  providerInstanceId: ProviderInstanceId,
  skill: PinnedSkillIdentity,
  sourceWorkflowPrdArtifactId: TrimmedNonEmptyString,
  checkpoint: Schema.optional(WorkflowTicketingCheckpointRequest),
  approvedBatch: Schema.optional(WorkflowTicketBatch),
  publication: Schema.optional(WorkflowTicketBatchPublication),
  trackerProjection: Schema.optional(WorkflowTrackerProjection),
  failure: Schema.optional(TrimmedNonEmptyString),
  startedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkflowTicketingStage = typeof WorkflowTicketingStage.Type;

export const WorkflowTicketImplementationStatus = Schema.Literals([
  "dispatching",
  "implementing",
  "reviewing",
  "checkpointed",
  "reviewed",
  "needs-correction",
  "needs-decision",
  "failed",
  "integrating",
  "integration-failed",
  "integrated",
]);
export type WorkflowTicketImplementationStatus = typeof WorkflowTicketImplementationStatus.Type;
export const WORKFLOW_MAX_AUTOMATIC_CORRECTION_CYCLES = 4;

export const WorkflowTicketImplementationDispatchMode = Schema.Literals(["user", "automatic"]);
export type WorkflowTicketImplementationDispatchMode =
  typeof WorkflowTicketImplementationDispatchMode.Type;

export const WorkflowTicketImplementationAvailability = Schema.Struct({
  status: Schema.Literals([
    "available",
    "blocked",
    "active",
    "checkpointed",
    "reviewed",
    "needs-correction",
    "needs-decision",
    "failed",
    "integrating",
    "integration-failed",
    "integrated",
  ]),
  canStart: Schema.Boolean,
  reason: TrimmedNonEmptyString,
});
export type WorkflowTicketImplementationAvailability =
  typeof WorkflowTicketImplementationAvailability.Type;

export const WorkflowValidationEvidence = Schema.Struct({
  name: TrimmedNonEmptyString,
  status: Schema.Literals(["passed", "failed", "not-run"]),
  command: Schema.optional(TrimmedNonEmptyString),
  detail: Schema.optional(Schema.String),
  recordedAt: IsoDateTime,
});
export type WorkflowValidationEvidence = typeof WorkflowValidationEvidence.Type;
const WorkflowTicketImplementationValidationList = Schema.Array(WorkflowValidationEvidence).check(
  Schema.isMaxLength(128),
);

export const WorkflowTicketIntegrationFailurePhase = Schema.Literals([
  "merge",
  "validation",
  "tracker",
]);
export type WorkflowTicketIntegrationFailurePhase =
  typeof WorkflowTicketIntegrationFailurePhase.Type;

export const WorkflowTicketIntegrationStatus = Schema.Literals([
  "integrating",
  "tracker-closing",
  "failed",
  "integrated",
]);
export type WorkflowTicketIntegrationStatus = typeof WorkflowTicketIntegrationStatus.Type;

export const WorkflowTicketIntegration = Schema.Struct({
  status: WorkflowTicketIntegrationStatus,
  baselineBranch: TrimmedNonEmptyString,
  baselineCommit: Schema.NullOr(TrimmedNonEmptyString),
  failurePhase: Schema.NullOr(WorkflowTicketIntegrationFailurePhase),
  failure: Schema.NullOr(TrimmedNonEmptyString),
  startedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkflowTicketIntegration = typeof WorkflowTicketIntegration.Type;

export const WorkflowDiffEvidenceFile = Schema.Struct({
  path: TrimmedNonEmptyString,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
});
export type WorkflowDiffEvidenceFile = typeof WorkflowDiffEvidenceFile.Type;
const WorkflowTicketImplementationDiffFiles = Schema.Array(WorkflowDiffEvidenceFile).check(
  Schema.isMaxLength(512),
);

export const WorkflowDiffEvidence = Schema.Struct({
  fixedPoint: TrimmedNonEmptyString,
  files: WorkflowTicketImplementationDiffFiles,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  capturedAt: IsoDateTime,
});
export type WorkflowDiffEvidence = typeof WorkflowDiffEvidence.Type;

export const WorkflowCodeReviewFinding = Schema.Struct({
  severity: Schema.Literals(["must-fix", "suggestion"]),
  // Older review receipts may omit grounding. Such findings remain visible,
  // but only explicitly grounded findings can block integration.
  source: Schema.optional(Schema.Literals(["repository-standards", "ticket-specification"])),
  summary: TrimmedNonEmptyString,
  file: Schema.optional(TrimmedNonEmptyString),
  line: Schema.optional(PositiveInt),
});
export type WorkflowCodeReviewFinding = typeof WorkflowCodeReviewFinding.Type;

export function isBlockingWorkflowCodeReviewFinding(finding: WorkflowCodeReviewFinding): boolean {
  return finding.severity === "must-fix" && finding.source !== undefined;
}

const WorkflowTicketImplementationAcceptanceCriteria = Schema.String.check(
  Schema.isMaxLength(32_000),
);
const WorkflowTicketImplementationReviewFindings = Schema.Array(WorkflowCodeReviewFinding).check(
  Schema.isMaxLength(128),
);

export const WorkflowCodeReviewEvidence = Schema.Struct({
  status: Schema.Literals(["passed", "must-fix"]),
  skillRunId: SkillRunId,
  fixedPoint: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  findings: WorkflowTicketImplementationReviewFindings,
  completedAt: IsoDateTime,
});
export type WorkflowCodeReviewEvidence = typeof WorkflowCodeReviewEvidence.Type;

export const WorkflowCorrectionCycle = Schema.Struct({
  cycle: PositiveInt,
  findings: WorkflowTicketImplementationReviewFindings,
  review: WorkflowCodeReviewEvidence,
  startedAt: IsoDateTime,
});
export type WorkflowCorrectionCycle = typeof WorkflowCorrectionCycle.Type;
const WorkflowTicketImplementationCorrectionCycles = Schema.Array(WorkflowCorrectionCycle).check(
  Schema.isMaxLength(WORKFLOW_MAX_AUTOMATIC_CORRECTION_CYCLES),
);

/**
 * Projection-owned evidence for one ticket implementation. A `reviewed`
 * implementation is deliberately not a completed ticket: integration and
 * publication remain downstream workflow stages.
 */
export const WorkflowTicketImplementation = Schema.Struct({
  id: TrimmedNonEmptyString,
  workstreamId: WorkstreamId,
  nodeId: TrimmedNonEmptyString,
  ticketKey: TrimmedNonEmptyString,
  ticketNumber: PositiveInt,
  title: TrimmedNonEmptyString,
  actionIdentity: TrimmedNonEmptyString,
  status: WorkflowTicketImplementationStatus,
  dispatchMode: Schema.optional(WorkflowTicketImplementationDispatchMode),
  originThreadId: ThreadId,
  implementationThreadId: Schema.NullOr(ThreadId),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  fixedPoint: TrimmedNonEmptyString,
  acceptanceCriteria: WorkflowTicketImplementationAcceptanceCriteria,
  providerInstanceId: ProviderInstanceId,
  implementSkill: PinnedSkillIdentity,
  reviewSkill: PinnedSkillIdentity,
  implementationSkillRunId: Schema.NullOr(SkillRunId),
  reviewSkillRunId: Schema.NullOr(SkillRunId),
  validation: WorkflowTicketImplementationValidationList,
  diff: Schema.NullOr(WorkflowDiffEvidence),
  review: Schema.NullOr(WorkflowCodeReviewEvidence),
  integration: Schema.optional(WorkflowTicketIntegration),
  correctionCycles: Schema.optional(WorkflowTicketImplementationCorrectionCycles),
  failure: Schema.NullOr(TrimmedNonEmptyString),
  startedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkflowTicketImplementation = typeof WorkflowTicketImplementation.Type;

export const WorkflowStaleResolution = Schema.Literal("accept-upstream");
export type WorkflowStaleResolution = typeof WorkflowStaleResolution.Type;

export const WorkflowGraphNodeResolution = Schema.Union([
  Schema.Struct({ status: Schema.Literal("not-required") }),
  Schema.Struct({
    status: Schema.Literal("required"),
    allowed: Schema.Array(WorkflowStaleResolution).check(Schema.isMinLength(1)),
  }),
  Schema.Struct({
    status: Schema.Literal("resolved"),
    resolution: WorkflowStaleResolution,
    resolvedAt: IsoDateTime,
  }),
]);
export type WorkflowGraphNodeResolution = typeof WorkflowGraphNodeResolution.Type;

/**
 * The initial graph deliberately has one downstream Workstream node. Future
 * workflow stages can add nodes without changing the source-of-truth boundary
 * or artifact lineage shape introduced here.
 */
export const WorkflowGraphNode = Schema.Union([
  Schema.Struct({
    id: TrimmedNonEmptyString,
    kind: Schema.Literal("workstream"),
    state: Schema.Literals(["current", "stale"]),
    sourceArtifactId: Schema.NullOr(TrimmedNonEmptyString),
    resolution: WorkflowGraphNodeResolution,
    staleAt: Schema.optional(IsoDateTime),
  }),
  Schema.Struct({
    id: TrimmedNonEmptyString,
    kind: Schema.Literal("ticket"),
    ticketKey: TrimmedNonEmptyString,
    ticketNumber: Schema.Int.check(Schema.isGreaterThan(0)),
    title: TrimmedNonEmptyString,
    state: Schema.Literals(["current", "stale"]),
    sourceArtifactId: Schema.NullOr(TrimmedNonEmptyString),
    includedInRun: Schema.Boolean,
    held: Schema.optional(Schema.Boolean),
    implementationAvailability: Schema.optional(WorkflowTicketImplementationAvailability),
    resolution: WorkflowGraphNodeResolution,
    staleAt: Schema.optional(IsoDateTime),
  }),
]);
export type WorkflowGraphNode = typeof WorkflowGraphNode.Type;

export const WorkflowGraphEdge = Schema.Struct({
  fromNodeId: TrimmedNonEmptyString,
  toNodeId: TrimmedNonEmptyString,
  kind: Schema.Literals(["contains", "blocks"]),
});
export type WorkflowGraphEdge = typeof WorkflowGraphEdge.Type;

/**
 * Compact graph data sent through the normal sequenced shell stream. Server
 * code retains a bounded history of artifacts and a durable unread aggregate
 * before persisting this shape.
 */
export const WorkflowGraph = Schema.Struct({
  artifacts: Schema.Array(WorkflowArtifact),
  nodes: Schema.Array(WorkflowGraphNode),
  edges: Schema.optional(Schema.Array(WorkflowGraphEdge)),
  // Historical artifacts are deliberately capped for socket payloads. This
  // aggregate preserves unread marker state even after an older artifact has
  // aged out of that bounded lineage window.
  unreadArtifactCount: NonNegativeInt,
  updatedAt: IsoDateTime,
});
export type WorkflowGraph = typeof WorkflowGraph.Type;

/**
 * A durable point from which an attached workflow can resume observing its
 * native Wayfinder source. The source run and synchronized timestamp are
 * intentionally retained instead of inferred from conversation text.
 */
export const WorkflowAttachmentObservationCursor = Schema.Struct({
  sourceSkillRunId: SkillRunId,
  observedAt: IsoDateTime,
  wayfinderSynchronizedAt: Schema.optional(IsoDateTime),
});
export type WorkflowAttachmentObservationCursor = typeof WorkflowAttachmentObservationCursor.Type;

export const WorkflowAttachmentHint = Schema.Struct({
  status: Schema.Literals(["available", "dismissed", "attached"]),
  sourceSkillRunId: SkillRunId,
  workstreamId: WorkstreamId,
  backfilledWayfinderData: WorkflowAttachmentWayfinderData,
  offeredAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkflowAttachmentHint = typeof WorkflowAttachmentHint.Type;

export const WorkflowAttachment = Schema.Struct({
  originThreadId: ThreadId,
  workstreamId: WorkstreamId,
  sourceSkillRunId: SkillRunId,
  workflowGoal: TrimmedNonEmptyString,
  backfilledWayfinderData: WorkflowAttachmentWayfinderData,
  observationCursor: WorkflowAttachmentObservationCursor,
  // Optional so persisted attachments created before graph synchronization
  // remain readable. The server materializes a graph on their next compatible
  // structured Wayfinder observation.
  workflowGraph: Schema.optional(WorkflowGraph),
  workflowRunPreview: Schema.optional(WorkflowRunPreview),
  workflowRun: Schema.optional(WorkflowRun),
  specificationStage: Schema.optional(WorkflowSpecificationStage),
  ticketingStage: Schema.optional(WorkflowTicketingStage),
  trackerProjection: Schema.optional(WorkflowTrackerProjection),
  ticketImplementations: Schema.optional(Schema.Array(WorkflowTicketImplementation)),
  // The optimistic command version is optional for attachments written before
  // the Specification stage existed; those attachments start at version 0.
  workflowVersion: Schema.optional(NonNegativeInt),
  attachedAt: IsoDateTime,
});
export type WorkflowAttachment = typeof WorkflowAttachment.Type;

/**
 * Projection-only state kept on an Origin Thread. Native Wayfinder runs
 * continue to own their map; this state only records an explicit user choice
 * to attach one run as a Development Workflow Workstream.
 */
export const WorkflowAttachmentState = Schema.Struct({
  hint: Schema.optional(WorkflowAttachmentHint),
  attachment: Schema.optional(WorkflowAttachment),
});
export type WorkflowAttachmentState = typeof WorkflowAttachmentState.Type;

export const ProjectScriptIcon = Schema.Literals([
  "play",
  "test",
  "lint",
  "configure",
  "build",
  "debug",
]);
export type ProjectScriptIcon = typeof ProjectScriptIcon.Type;

export const ProjectScript = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  icon: ProjectScriptIcon,
  runOnWorktreeCreate: Schema.Boolean,
  /**
   * URL to open in the in-app browser preview when this script runs (or
   * when the user explicitly requests a preview). Optional; only honored on
   * the desktop build.
   */
  previewUrl: Schema.optional(TrimmedNonEmptyString),
  /**
   * When true, automatically open the preview panel pointed at `previewUrl`
   * the moment this script starts. Ignored without `previewUrl` or on web.
   */
  autoOpenPreview: Schema.optional(Schema.Boolean),
});
export type ProjectScript = typeof ProjectScript.Type;

export const OrchestrationProject = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationProject = typeof OrchestrationProject.Type;

export const OrchestrationMessageRole = Schema.Literals(["user", "assistant", "system"]);
export type OrchestrationMessageRole = typeof OrchestrationMessageRole.Type;

export const OrchestrationMessage = Schema.Struct({
  id: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationMessage = typeof OrchestrationMessage.Type;

export const OrchestrationProposedPlanId = TrimmedNonEmptyString;
export type OrchestrationProposedPlanId = typeof OrchestrationProposedPlanId.Type;

export const OrchestrationProposedPlan = Schema.Struct({
  id: OrchestrationProposedPlanId,
  turnId: Schema.NullOr(TurnId),
  planMarkdown: TrimmedNonEmptyString,
  implementedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  implementationThreadId: Schema.NullOr(ThreadId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationProposedPlan = typeof OrchestrationProposedPlan.Type;

const SourceProposedPlanReference = Schema.Struct({
  threadId: ThreadId,
  planId: OrchestrationProposedPlanId,
});

export const OrchestrationSessionStatus = Schema.Literals([
  "idle",
  "starting",
  "running",
  "ready",
  "interrupted",
  "stopped",
  "error",
]);
export type OrchestrationSessionStatus = typeof OrchestrationSessionStatus.Type;

export const OrchestrationSession = Schema.Struct({
  threadId: ThreadId,
  status: OrchestrationSessionStatus,
  providerName: Schema.NullOr(TrimmedNonEmptyString),
  providerInstanceId: Schema.optional(ProviderInstanceId),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  activeTurnId: Schema.NullOr(TurnId),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});
export type OrchestrationSession = typeof OrchestrationSession.Type;

export const OrchestrationCheckpointFile = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: TrimmedNonEmptyString,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
});
export type OrchestrationCheckpointFile = typeof OrchestrationCheckpointFile.Type;

export const OrchestrationCheckpointStatus = Schema.Literals(["ready", "missing", "error"]);
export type OrchestrationCheckpointStatus = typeof OrchestrationCheckpointStatus.Type;

export const OrchestrationCheckpointSummary = Schema.Struct({
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});
export type OrchestrationCheckpointSummary = typeof OrchestrationCheckpointSummary.Type;

export const OrchestrationThreadActivityTone = Schema.Literals([
  "info",
  "tool",
  "approval",
  "error",
]);
export type OrchestrationThreadActivityTone = typeof OrchestrationThreadActivityTone.Type;

export const OrchestrationThreadActivity = Schema.Struct({
  id: EventId,
  tone: OrchestrationThreadActivityTone,
  kind: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  payload: Schema.Unknown,
  turnId: Schema.NullOr(TurnId),
  sequence: Schema.optional(NonNegativeInt),
  createdAt: IsoDateTime,
});
export type OrchestrationThreadActivity = typeof OrchestrationThreadActivity.Type;

const OrchestrationLatestTurnState = Schema.Literals([
  "running",
  "interrupted",
  "completed",
  "error",
]);
export type OrchestrationLatestTurnState = typeof OrchestrationLatestTurnState.Type;

export const OrchestrationLatestTurn = Schema.Struct({
  turnId: TurnId,
  state: OrchestrationLatestTurnState,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  skillInvocation: Schema.optional(SkillInvocation),
});
export type OrchestrationLatestTurn = typeof OrchestrationLatestTurn.Type;

export const ThreadTitleRegeneration = Schema.Struct({
  requestId: CommandId,
  startedAt: IsoDateTime,
});
export type ThreadTitleRegeneration = typeof ThreadTitleRegeneration.Type;

export const OrchestrationThread = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  settledOverride: Schema.NullOr(Schema.Literals(["settled", "active"])).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  settledAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  // Snooze is an overlay on the active lifecycle, not a fourth destination:
  // a snoozed thread stays "active" in the model and is only suppressed from
  // the inbox until snoozedUntil passes (or the thread raises its hand).
  // Optional so payloads from pre-snooze servers still decode.
  snoozedUntil: Schema.optional(Schema.NullOr(IsoDateTime)),
  snoozedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  // Pending-only state. Optional so older servers remain compatible.
  titleRegeneration: Schema.optional(Schema.NullOr(ThreadTitleRegeneration)),
  // Explicit Development Workflow state. Optional preserves compatibility
  // with pre-attachment snapshots and does not make every Wayfinder run a
  // workflow attachment.
  workflowAttachmentHint: Schema.optional(WorkflowAttachmentHint),
  workflowAttachment: Schema.optional(WorkflowAttachment),
  deletedAt: Schema.NullOr(IsoDateTime),
  messages: Schema.Array(OrchestrationMessage),
  proposedPlans: Schema.Array(OrchestrationProposedPlan).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  activities: Schema.Array(OrchestrationThreadActivity),
  checkpoints: Schema.Array(OrchestrationCheckpointSummary),
  session: Schema.NullOr(OrchestrationSession),
});
export type OrchestrationThread = typeof OrchestrationThread.Type;

export const OrchestrationReadModel = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProject),
  threads: Schema.Array(OrchestrationThread),
  updatedAt: IsoDateTime,
});
export type OrchestrationReadModel = typeof OrchestrationReadModel.Type;

export const OrchestrationProjectShell = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationProjectShell = typeof OrchestrationProjectShell.Type;

export const OrchestrationThreadShell = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  settledOverride: Schema.NullOr(Schema.Literals(["settled", "active"])).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  settledAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  snoozedUntil: Schema.optional(Schema.NullOr(IsoDateTime)),
  snoozedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  titleRegeneration: Schema.optional(Schema.NullOr(ThreadTitleRegeneration)),
  workflowAttachmentHint: Schema.optional(WorkflowAttachmentHint),
  workflowAttachment: Schema.optional(WorkflowAttachment),
  session: Schema.NullOr(OrchestrationSession),
  latestUserMessageAt: Schema.NullOr(IsoDateTime),
  hasPendingApprovals: Schema.Boolean,
  hasPendingUserInput: Schema.Boolean,
  hasActionableProposedPlan: Schema.Boolean,
});
export type OrchestrationThreadShell = typeof OrchestrationThreadShell.Type;

export const OrchestrationShellSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProjectShell),
  threads: Schema.Array(OrchestrationThreadShell),
  skillRuns: Schema.optional(Schema.Array(SkillInvocation)),
  updatedAt: IsoDateTime,
});
export type OrchestrationShellSnapshot = typeof OrchestrationShellSnapshot.Type;

export const OrchestrationShellStreamEvent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("project-upserted"),
    sequence: NonNegativeInt,
    project: OrchestrationProjectShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("project-removed"),
    sequence: NonNegativeInt,
    projectId: ProjectId,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread-upserted"),
    sequence: NonNegativeInt,
    thread: OrchestrationThreadShell,
    skillRuns: Schema.optional(Schema.Array(SkillInvocation)),
  }),
  Schema.Struct({
    kind: Schema.Literal("thread-removed"),
    sequence: NonNegativeInt,
    threadId: ThreadId,
  }),
]);
export type OrchestrationShellStreamEvent = typeof OrchestrationShellStreamEvent.Type;

export const OrchestrationShellStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("synchronized"),
  }),
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationShellSnapshot,
  }),
  OrchestrationShellStreamEvent,
]);
export type OrchestrationShellStreamItem = typeof OrchestrationShellStreamItem.Type;

export const OrchestrationSubscribeShellInput = Schema.Struct({
  /**
   * When provided, the server skips the initial full shell snapshot and instead
   * replays shell events after this sequence before streaming live events.
   * Clients that already hold a cached (or HTTP-loaded) shell snapshot pass its
   * sequence here so the subscription resumes without re-sending the entire
   * projects/threads list (overlapping events are deduped by sequence on the
   * client).
   */
  afterSequence: Schema.optionalKey(NonNegativeInt),
  /**
   * Requests an explicit marker after the subscription has emitted its initial
   * snapshot or catch-up replay and before it begins emitting live events.
   */
  requestCompletionMarker: Schema.optionalKey(Schema.Boolean),
});
export type OrchestrationSubscribeShellInput = typeof OrchestrationSubscribeShellInput.Type;

export const OrchestrationSubscribeThreadInput = Schema.Struct({
  threadId: ThreadId,
  /**
   * When provided, the server skips the initial snapshot frame and instead
   * replays events after this sequence before streaming live events. Clients
   * that load the snapshot over HTTP pass the snapshot's sequence here so the
   * live subscription resumes without a gap (overlapping events are deduped by
   * sequence on the client).
   */
  afterSequence: Schema.optionalKey(NonNegativeInt),
  /**
   * Requests an explicit marker after the subscription has emitted its initial
   * snapshot or catch-up replay and before it begins emitting live events.
   */
  requestCompletionMarker: Schema.optionalKey(Schema.Boolean),
});
export type OrchestrationSubscribeThreadInput = typeof OrchestrationSubscribeThreadInput.Type;

export const OrchestrationThreadDetailSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  thread: OrchestrationThread,
});
export type OrchestrationThreadDetailSnapshot = typeof OrchestrationThreadDetailSnapshot.Type;

export const ProjectCreateCommand = Schema.Struct({
  type: Schema.Literal("project.create"),
  commandId: CommandId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  createWorkspaceRootIfMissing: Schema.optional(Schema.Boolean),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  createdAt: IsoDateTime,
});

const ProjectMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("project.meta.update"),
  commandId: CommandId,
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
});

const ProjectDeleteCommand = Schema.Struct({
  type: Schema.Literal("project.delete"),
  commandId: CommandId,
  projectId: ProjectId,
  force: Schema.optional(Schema.Boolean),
});

const ThreadCreateCommand = Schema.Struct({
  type: Schema.Literal("thread.create"),
  commandId: CommandId,
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});

const ThreadDeleteCommand = Schema.Struct({
  type: Schema.Literal("thread.delete"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadArchiveCommand = Schema.Struct({
  type: Schema.Literal("thread.archive"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadUnarchiveCommand = Schema.Struct({
  type: Schema.Literal("thread.unarchive"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadSettleCommand = Schema.Struct({
  type: Schema.Literal("thread.settle"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadUnsettleCommand = Schema.Struct({
  type: Schema.Literal("thread.unsettle"),
  commandId: CommandId,
  threadId: ThreadId,
  // Commands only carry "user": activity un-settles are decided server-side
  // (the decider emits thread.unsettled(reason: "activity") events directly,
  // never through this command), so a client cannot forge the neutral reset.
  reason: Schema.Literal("user"),
});

const ThreadSnoozeCommand = Schema.Struct({
  type: Schema.Literal("thread.snooze"),
  commandId: CommandId,
  threadId: ThreadId,
  // The wake time. Event-based wake conditions (PR merged, review posted)
  // will arrive as an optional condition field alongside this; time-based
  // snooze is just the first kind of condition.
  snoozedUntil: IsoDateTime,
});

const ThreadUnsnoozeCommand = Schema.Struct({
  type: Schema.Literal("thread.unsnooze"),
  commandId: CommandId,
  threadId: ThreadId,
  // Commands only carry "user": activity wakes are decided server-side (the
  // decider emits thread.unsnoozed(reason: "activity") directly), and timer
  // wakes need no event at all — clients derive visibility from snoozedUntil,
  // so a passed wake time simply stops classifying as snoozed.
  reason: Schema.Literal("user"),
});

const ThreadMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("thread.meta.update"),
  commandId: CommandId,
  threadId: ThreadId,
  title: Schema.optional(TrimmedNonEmptyString),
  regenerateTitle: Schema.optional(Schema.Literal(true)),
  modelSelection: Schema.optional(ModelSelection),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  expectedBranch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
}).check(
  Schema.makeFilter(
    (input) =>
      !(input.title !== undefined && input.regenerateTitle === true) ||
      "title and regenerateTitle cannot be specified together",
  ),
);

const ThreadRuntimeModeSetCommand = Schema.Struct({
  type: Schema.Literal("thread.runtime-mode.set"),
  commandId: CommandId,
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  createdAt: IsoDateTime,
});

const ThreadInteractionModeSetCommand = Schema.Struct({
  type: Schema.Literal("thread.interaction-mode.set"),
  commandId: CommandId,
  threadId: ThreadId,
  interactionMode: ProviderInteractionMode,
  createdAt: IsoDateTime,
});

const ThreadTurnStartBootstrapCreateThread = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});

const ThreadTurnStartBootstrapPrepareWorktree = Schema.Struct({
  projectCwd: TrimmedNonEmptyString,
  baseBranch: TrimmedNonEmptyString,
  branch: Schema.optional(TrimmedNonEmptyString),
  startFromOrigin: Schema.optional(Schema.Boolean),
});

const ThreadTurnStartBootstrap = Schema.Struct({
  createThread: Schema.optional(ThreadTurnStartBootstrapCreateThread),
  prepareWorktree: Schema.optional(ThreadTurnStartBootstrapPrepareWorktree),
  runSetupScript: Schema.optional(Schema.Boolean),
});

export type ThreadTurnStartBootstrap = typeof ThreadTurnStartBootstrap.Type;

export const ThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  commandId: CommandId,
  threadId: ThreadId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    attachments: Schema.Array(ChatAttachment),
  }),
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  bootstrap: Schema.optional(ThreadTurnStartBootstrap),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  skillInvocation: Schema.optional(ResolvedSkillInvocation),
  createdAt: IsoDateTime,
});

const ClientThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  commandId: CommandId,
  threadId: ThreadId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    attachments: Schema.Array(UploadChatAttachment),
  }),
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  bootstrap: Schema.optional(ThreadTurnStartBootstrap),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  skillInvocationRequest: Schema.optional(SkillInvocationRequest),
  createdAt: IsoDateTime,
});

const ThreadTurnInterruptCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.interrupt"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadApprovalRespondCommand = Schema.Struct({
  type: Schema.Literal("thread.approval.respond"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
});

const ThreadUserInputRespondCommand = Schema.Struct({
  type: Schema.Literal("thread.user-input.respond"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
});

const ThreadWayfinderPublishCommand = Schema.Struct({
  type: Schema.Literal("thread.wayfinder.publish"),
  commandId: CommandId,
  threadId: ThreadId,
  skillRunId: SkillRunId,
  confirmed: Schema.Boolean,
  createdAt: IsoDateTime,
});

const ThreadWayfinderMutateCommand = Schema.Struct({
  type: Schema.Literal("thread.wayfinder.mutate"),
  commandId: CommandId,
  threadId: ThreadId,
  skillRunId: SkillRunId,
  actionId: Schema.optional(TrimmedNonEmptyString),
  action: WayfinderMutationAction,
  confirmed: Schema.Boolean,
  createdAt: IsoDateTime,
});

const ThreadWayfinderReconcileCommand = Schema.Struct({
  type: Schema.Literal("thread.wayfinder.reconcile"),
  commandId: CommandId,
  threadId: ThreadId,
  skillRunId: SkillRunId,
  reason: WayfinderReconcileReason,
  expectedRevision: Schema.optional(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});

const ThreadWayfinderResearchCommand = Schema.Struct({
  type: Schema.Literal("thread.wayfinder.research"),
  commandId: CommandId,
  threadId: ThreadId,
  skillRunId: SkillRunId,
  action: WayfinderResearchAction,
  launchMode: Schema.optional(Schema.Literal("automatic")),
  createdAt: IsoDateTime,
});

const ThreadWorkflowAttachmentHintDismissCommand = Schema.Struct({
  type: Schema.Literal("thread.workflow-attachment.hint.dismiss"),
  commandId: CommandId,
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

const ThreadWorkflowAttachCommand = Schema.Struct({
  type: Schema.Literal("thread.workflow.attach"),
  commandId: CommandId,
  threadId: ThreadId,
  originThreadId: ThreadId,
  workflowGoal: TrimmedNonEmptyString,
  // Attachment is always an explicit confirmation. Keeping the literal in
  // the wire contract prevents a client default from silently attaching.
  confirmed: Schema.Literal(true),
  createdAt: IsoDateTime,
});

const ThreadWorkflowRunPreflightCommand = Schema.Struct({
  type: Schema.Literal("thread.workflow.run.preflight"),
  commandId: CommandId,
  threadId: ThreadId,
  configuration: WorkflowRunConfiguration,
  createdAt: IsoDateTime,
});

const ThreadWorkflowRunConfirmCommand = Schema.Struct({
  type: Schema.Literal("thread.workflow.run.confirm"),
  commandId: CommandId,
  threadId: ThreadId,
  configuration: WorkflowRunConfiguration,
  confirmed: Schema.Literal(true),
  createdAt: IsoDateTime,
});

const ThreadWorkflowRunStartCommand = Schema.Struct({
  type: Schema.Literal("thread.workflow.run.start"),
  commandId: CommandId,
  threadId: ThreadId,
  expectedWorkstreamVersion: NonNegativeInt,
  confirmed: Schema.Literal(true),
  createdAt: IsoDateTime,
});

const ThreadWorkflowRunPauseCommand = Schema.Struct({
  type: Schema.Literal("thread.workflow.run.pause"),
  commandId: CommandId,
  threadId: ThreadId,
  expectedWorkstreamVersion: NonNegativeInt,
  confirmed: Schema.Literal(true),
  createdAt: IsoDateTime,
});

const ThreadWorkflowRunResumeCommand = Schema.Struct({
  type: Schema.Literal("thread.workflow.run.resume"),
  commandId: CommandId,
  threadId: ThreadId,
  expectedWorkstreamVersion: NonNegativeInt,
  confirmed: Schema.Literal(true),
  createdAt: IsoDateTime,
});

const ThreadWorkflowNodeHoldCommand = Schema.Struct({
  type: Schema.Literal("thread.workflow.node.hold"),
  commandId: CommandId,
  threadId: ThreadId,
  ticketNodeId: TrimmedNonEmptyString,
  expectedWorkstreamVersion: NonNegativeInt,
  confirmed: Schema.Literal(true),
  createdAt: IsoDateTime,
});

const ThreadWorkflowNodeReleaseCommand = Schema.Struct({
  type: Schema.Literal("thread.workflow.node.release"),
  commandId: CommandId,
  threadId: ThreadId,
  ticketNodeId: TrimmedNonEmptyString,
  expectedWorkstreamVersion: NonNegativeInt,
  confirmed: Schema.Literal(true),
  createdAt: IsoDateTime,
});

const ThreadWorkflowArtifactsViewCommand = Schema.Struct({
  type: Schema.Literal("thread.workflow.artifacts.view"),
  commandId: CommandId,
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

const ThreadWorkflowArtifactAcknowledgeCommand = Schema.Struct({
  type: Schema.Literal("thread.workflow.artifact.acknowledge"),
  commandId: CommandId,
  threadId: ThreadId,
  artifactId: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});

const ThreadWorkflowStaleResolveCommand = Schema.Struct({
  type: Schema.Literal("thread.workflow.stale.resolve"),
  commandId: CommandId,
  threadId: ThreadId,
  resolution: WorkflowStaleResolution,
  // Resolving staleness changes the authoritative dispatch gate, so it must
  // be an explicit user confirmation rather than a client-side default.
  confirmed: Schema.Literal(true),
  createdAt: IsoDateTime,
});

const ThreadWorkflowSpecificationCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.workflow.specification.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  specificationThreadId: ThreadId,
  skillRunId: SkillRunId,
  expectedWorkstreamVersion: NonNegativeInt,
  sourceWayfinderArtifactId: TrimmedNonEmptyString,
  prd: WorkflowPrdDocument,
  createdAt: IsoDateTime,
});

const ThreadWorkflowTicketingPublishCommand = Schema.Struct({
  type: Schema.Literal("thread.workflow.ticketing.publish"),
  commandId: CommandId,
  threadId: ThreadId,
  ticketingThreadId: ThreadId,
  skillRunId: SkillRunId,
  expectedWorkstreamVersion: NonNegativeInt,
  batch: WorkflowTicketBatch,
  confirmed: Schema.Literal(true),
  createdAt: IsoDateTime,
});

const ThreadWorkflowTicketImplementationStartCommand = Schema.Struct({
  type: Schema.Literal("thread.workflow.ticket-implementation.start"),
  commandId: CommandId,
  threadId: ThreadId,
  ticketNodeId: TrimmedNonEmptyString,
  actionIdentity: TrimmedNonEmptyString,
  expectedWorkstreamVersion: NonNegativeInt,
  dispatchMode: Schema.optional(WorkflowTicketImplementationDispatchMode),
  confirmed: Schema.Literal(true),
  createdAt: IsoDateTime,
});

const ThreadWorkflowTicketIntegrationRetryCommand = Schema.Struct({
  type: Schema.Literal("thread.workflow.ticket-integration.retry"),
  commandId: CommandId,
  threadId: ThreadId,
  implementationId: TrimmedNonEmptyString,
  expectedWorkstreamVersion: NonNegativeInt,
  confirmed: Schema.Literal(true),
  createdAt: IsoDateTime,
});

const ThreadCheckpointRevertCommand = Schema.Struct({
  type: Schema.Literal("thread.checkpoint.revert"),
  commandId: CommandId,
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadSessionStopCommand = Schema.Struct({
  type: Schema.Literal("thread.session.stop"),
  commandId: CommandId,
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

const DispatchableClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  ThreadCreateCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadSettleCommand,
  ThreadUnsettleCommand,
  ThreadSnoozeCommand,
  ThreadUnsnoozeCommand,
  ThreadMetaUpdateCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ThreadTurnStartCommand,
  ThreadTurnInterruptCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadWayfinderPublishCommand,
  ThreadWayfinderMutateCommand,
  ThreadWayfinderReconcileCommand,
  ThreadWayfinderResearchCommand,
  ThreadWorkflowAttachmentHintDismissCommand,
  ThreadWorkflowAttachCommand,
  ThreadWorkflowRunPreflightCommand,
  ThreadWorkflowRunConfirmCommand,
  ThreadWorkflowRunStartCommand,
  ThreadWorkflowRunPauseCommand,
  ThreadWorkflowRunResumeCommand,
  ThreadWorkflowNodeHoldCommand,
  ThreadWorkflowNodeReleaseCommand,
  ThreadWorkflowArtifactsViewCommand,
  ThreadWorkflowArtifactAcknowledgeCommand,
  ThreadWorkflowStaleResolveCommand,
  ThreadWorkflowSpecificationCompleteCommand,
  ThreadWorkflowTicketingPublishCommand,
  ThreadWorkflowTicketImplementationStartCommand,
  ThreadWorkflowTicketIntegrationRetryCommand,
  ThreadCheckpointRevertCommand,
  ThreadSessionStopCommand,
]);
export type DispatchableClientOrchestrationCommand =
  typeof DispatchableClientOrchestrationCommand.Type;

export const ClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  ThreadCreateCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadSettleCommand,
  ThreadUnsettleCommand,
  ThreadSnoozeCommand,
  ThreadUnsnoozeCommand,
  ThreadMetaUpdateCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ClientThreadTurnStartCommand,
  ThreadTurnInterruptCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadWayfinderPublishCommand,
  ThreadWayfinderMutateCommand,
  ThreadWayfinderReconcileCommand,
  ThreadWayfinderResearchCommand,
  ThreadWorkflowAttachmentHintDismissCommand,
  ThreadWorkflowAttachCommand,
  ThreadWorkflowRunPreflightCommand,
  ThreadWorkflowRunConfirmCommand,
  ThreadWorkflowRunStartCommand,
  ThreadWorkflowRunPauseCommand,
  ThreadWorkflowRunResumeCommand,
  ThreadWorkflowNodeHoldCommand,
  ThreadWorkflowNodeReleaseCommand,
  ThreadWorkflowArtifactsViewCommand,
  ThreadWorkflowArtifactAcknowledgeCommand,
  ThreadWorkflowStaleResolveCommand,
  ThreadWorkflowSpecificationCompleteCommand,
  ThreadWorkflowTicketingPublishCommand,
  ThreadWorkflowTicketImplementationStartCommand,
  ThreadWorkflowTicketIntegrationRetryCommand,
  ThreadCheckpointRevertCommand,
  ThreadSessionStopCommand,
]);
export type ClientOrchestrationCommand = typeof ClientOrchestrationCommand.Type;

const ThreadSessionSetCommand = Schema.Struct({
  type: Schema.Literal("thread.session.set"),
  commandId: CommandId,
  threadId: ThreadId,
  session: OrchestrationSession,
  createdAt: IsoDateTime,
});

const ThreadMessageAssistantDeltaCommand = Schema.Struct({
  type: Schema.Literal("thread.message.assistant.delta"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  delta: Schema.String,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadMessageAssistantCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.message.assistant.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadProposedPlanUpsertCommand = Schema.Struct({
  type: Schema.Literal("thread.proposed-plan.upsert"),
  commandId: CommandId,
  threadId: ThreadId,
  proposedPlan: OrchestrationProposedPlan,
  createdAt: IsoDateTime,
});

const ThreadTurnDiffCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.diff.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: TurnId,
  completedAt: IsoDateTime,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.optional(MessageId),
  checkpointTurnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadActivityAppendCommand = Schema.Struct({
  type: Schema.Literal("thread.activity.append"),
  commandId: CommandId,
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
  createdAt: IsoDateTime,
});

const ThreadRevertCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.revert.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadWayfinderPublicationUpdateCommand = Schema.Struct({
  type: Schema.Literal("thread.wayfinder.publication.update"),
  commandId: CommandId,
  threadId: ThreadId,
  skillRunId: SkillRunId,
  publication: WayfinderPublication,
  wayfinderMap: Schema.optional(WayfinderMapProjection),
  createdAt: IsoDateTime,
});

const ThreadWorkflowTicketingPublicationUpdateCommand = Schema.Struct({
  type: Schema.Literal("thread.workflow.ticketing.publication.update"),
  commandId: CommandId,
  threadId: ThreadId,
  ticketingThreadId: ThreadId,
  skillRunId: SkillRunId,
  publication: WorkflowTicketBatchPublication,
  trackerProjection: Schema.optional(WorkflowTrackerProjection),
  createdAt: IsoDateTime,
});

const ThreadWorkflowTicketImplementationUpdateCommand = Schema.Struct({
  type: Schema.Literal("thread.workflow.ticket-implementation.update"),
  commandId: CommandId,
  threadId: ThreadId,
  implementationId: TrimmedNonEmptyString,
  implementation: WorkflowTicketImplementation,
  trackerProjection: Schema.optional(WorkflowTrackerProjection),
  expectedWorkstreamVersion: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadWorkflowTicketImplementationCheckpointCommand = Schema.Struct({
  type: Schema.Literal("thread.workflow.ticket-implementation.checkpoint"),
  commandId: CommandId,
  threadId: ThreadId,
  implementationId: TrimmedNonEmptyString,
  expectedWorkstreamVersion: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadWorkflowRunDrainCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.workflow.run.drain.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  expectedWorkstreamVersion: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadWorkflowTicketImplementationReviewRecordCommand = Schema.Struct({
  type: Schema.Literal("thread.workflow.ticket-implementation.review.record"),
  commandId: CommandId,
  threadId: ThreadId,
  implementationId: TrimmedNonEmptyString,
  expectedWorkstreamVersion: NonNegativeInt,
  review: WorkflowCodeReviewEvidence,
  validation: Schema.Array(WorkflowValidationEvidence),
  createdAt: IsoDateTime,
});

const ThreadWorkflowTicketImplementationCorrectionStartCommand = Schema.Struct({
  type: Schema.Literal("thread.workflow.ticket-implementation.correction.start"),
  commandId: CommandId,
  threadId: ThreadId,
  implementationId: TrimmedNonEmptyString,
  correctionCycle: PositiveInt,
  findings: WorkflowTicketImplementationReviewFindings,
  expectedWorkstreamVersion: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadWayfinderMutationUpdateCommand = Schema.Struct({
  type: Schema.Literal("thread.wayfinder.mutation.update"),
  commandId: CommandId,
  threadId: ThreadId,
  skillRunId: SkillRunId,
  mutation: WayfinderMutation,
  wayfinderMap: Schema.optional(WayfinderMapProjection),
  createdAt: IsoDateTime,
});

const ThreadWayfinderReconciliationUpdateCommand = Schema.Struct({
  type: Schema.Literal("thread.wayfinder.reconciliation.update"),
  commandId: CommandId,
  threadId: ThreadId,
  skillRunId: SkillRunId,
  synchronization: WayfinderSynchronizationState,
  wayfinderMap: Schema.optional(WayfinderMapProjection),
  createdAt: IsoDateTime,
});

const ThreadWayfinderResearchUpdateCommand = Schema.Struct({
  type: Schema.Literal("thread.wayfinder.research.update"),
  commandId: CommandId,
  threadId: ThreadId,
  skillRunId: SkillRunId,
  research: WayfinderResearchState,
  createdAt: IsoDateTime,
});

const ThreadTitleRegenerationCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.title.regeneration.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: CommandId,
  title: Schema.optional(TrimmedNonEmptyString),
});

const InternalOrchestrationCommand = Schema.Union([
  ThreadSessionSetCommand,
  ThreadMessageAssistantDeltaCommand,
  ThreadMessageAssistantCompleteCommand,
  ThreadProposedPlanUpsertCommand,
  ThreadTurnDiffCompleteCommand,
  ThreadActivityAppendCommand,
  ThreadRevertCompleteCommand,
  ThreadWayfinderPublicationUpdateCommand,
  ThreadWorkflowTicketingPublicationUpdateCommand,
  ThreadWorkflowRunDrainCompleteCommand,
  ThreadWorkflowTicketImplementationUpdateCommand,
  ThreadWorkflowTicketImplementationCheckpointCommand,
  ThreadWorkflowTicketImplementationReviewRecordCommand,
  ThreadWorkflowTicketImplementationCorrectionStartCommand,
  ThreadWayfinderMutationUpdateCommand,
  ThreadWayfinderReconciliationUpdateCommand,
  ThreadWayfinderResearchUpdateCommand,
  ThreadTitleRegenerationCompleteCommand,
]);
export type InternalOrchestrationCommand = typeof InternalOrchestrationCommand.Type;

export const OrchestrationCommand = Schema.Union([
  DispatchableClientOrchestrationCommand,
  InternalOrchestrationCommand,
]);
export type OrchestrationCommand = typeof OrchestrationCommand.Type;

export const OrchestrationEventType = Schema.Literals([
  "project.created",
  "project.meta-updated",
  "project.deleted",
  "thread.created",
  "thread.deleted",
  "thread.archived",
  "thread.unarchived",
  "thread.settled",
  "thread.unsettled",
  "thread.snoozed",
  "thread.unsnoozed",
  "thread.meta-updated",
  "thread.runtime-mode-set",
  "thread.interaction-mode-set",
  "thread.message-sent",
  "thread.turn-start-requested",
  "thread.turn-interrupt-requested",
  "thread.approval-response-requested",
  "thread.user-input-response-requested",
  "thread.wayfinder-publication-requested",
  "thread.wayfinder-publication-updated",
  "thread.wayfinder-mutation-requested",
  "thread.wayfinder-mutation-updated",
  "thread.wayfinder-reconciliation-requested",
  "thread.wayfinder-reconciliation-updated",
  "thread.wayfinder-research-requested",
  "thread.wayfinder-research-updated",
  "thread.workflow-attachment-hinted",
  "thread.workflow-attachment-hint-dismissed",
  "thread.workflow-attached",
  "thread.workflow-run-preflighted",
  "thread.workflow-run-confirmed",
  "thread.workflow-run-started",
  "thread.workflow-run-draining",
  "thread.workflow-run-paused",
  "thread.workflow-run-resumed",
  "thread.workflow-node-held",
  "thread.workflow-node-released",
  "thread.workflow-synchronized",
  "thread.workflow-artifacts-viewed",
  "thread.workflow-artifact-acknowledged",
  "thread.workflow-stale-resolved",
  "thread.workflow-specification-dispatched",
  "thread.workflow-specification-checkpointed",
  "thread.workflow-specification-checkpoint-resolved",
  "thread.workflow-specification-completed",
  "thread.workflow-specification-failed",
  "thread.workflow-ticketing-dispatched",
  "thread.workflow-ticketing-checkpointed",
  "thread.workflow-ticketing-checkpoint-resolved",
  "thread.workflow-ticket-batch-publication-requested",
  "thread.workflow-ticket-batch-publication-updated",
  "thread.workflow-ticketing-failed",
  "thread.workflow-ticket-implementation-requested",
  "thread.workflow-ticket-implementation-updated",
  "thread.workflow-ticket-implementation-checkpointed",
  "thread.checkpoint-revert-requested",
  "thread.reverted",
  "thread.session-stop-requested",
  "thread.session-set",
  "thread.proposed-plan-upserted",
  "thread.turn-diff-completed",
  "thread.activity-appended",
]);
export type OrchestrationEventType = typeof OrchestrationEventType.Type;

export const OrchestrationAggregateKind = Schema.Literals(["project", "thread"]);
export type OrchestrationAggregateKind = typeof OrchestrationAggregateKind.Type;
export const OrchestrationActorKind = Schema.Literals(["client", "server", "provider"]);

export const ProjectCreatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ProjectMetaUpdatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
  updatedAt: IsoDateTime,
});

export const ProjectDeletedPayload = Schema.Struct({
  projectId: ProjectId,
  deletedAt: IsoDateTime,
});

export const ThreadCreatedPayload = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadDeletedPayload = Schema.Struct({
  threadId: ThreadId,
  deletedAt: IsoDateTime,
});

export const ThreadArchivedPayload = Schema.Struct({
  threadId: ThreadId,
  archivedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadUnarchivedPayload = Schema.Struct({
  threadId: ThreadId,
  updatedAt: IsoDateTime,
});

export const ThreadSettledPayload = Schema.Struct({
  threadId: ThreadId,
  settledAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadUnsettledPayload = Schema.Struct({
  threadId: ThreadId,
  reason: Schema.Literals(["user", "activity"]),
  updatedAt: IsoDateTime,
});

export const ThreadSnoozedPayload = Schema.Struct({
  threadId: ThreadId,
  snoozedUntil: IsoDateTime,
  snoozedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadUnsnoozedPayload = Schema.Struct({
  threadId: ThreadId,
  // user: explicit "wake now". activity: real work arrived (user message /
  // session coming alive) and the decider cleared the snooze — mirrors
  // thread.unsettled's activity resets. Timer wakes emit no event: clients
  // derive them from snoozedUntil passing.
  reason: Schema.Literals(["user", "activity"]),
  updatedAt: IsoDateTime,
});

export const ThreadMetaUpdatedPayload = Schema.Struct({
  threadId: ThreadId,
  title: Schema.optional(TrimmedNonEmptyString),
  /** Intent marker consumed by the title-generation reactor. Keeping this on
      the existing event lets older clients safely ignore the new field. */
  regenerateTitle: Schema.optional(Schema.Literal(true)),
  /** Title at request time, used to avoid overwriting a later manual rename. */
  previousTitle: Schema.optional(TrimmedNonEmptyString),
  /** Pending state shared with clients. Null clears a matching request. */
  titleRegeneration: Schema.optional(Schema.NullOr(ThreadTitleRegeneration)),
  modelSelection: Schema.optional(ModelSelection),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  updatedAt: IsoDateTime,
});

export const ThreadRuntimeModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  updatedAt: IsoDateTime,
});

export const ThreadInteractionModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  updatedAt: IsoDateTime,
});

export const ThreadMessageSentPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadTurnStartRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  skillInvocation: Schema.optional(SkillInvocation),
  createdAt: IsoDateTime,
});

export const ThreadTurnInterruptRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

export const ThreadApprovalResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
});

const ThreadUserInputResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
});

export const ThreadWayfinderPublicationRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  skillRunId: SkillRunId,
  runtimeMode: RuntimeMode,
  confirmed: Schema.Boolean,
  createdAt: IsoDateTime,
});

export const ThreadWayfinderPublicationUpdatedPayload = Schema.Struct({
  threadId: ThreadId,
  skillRunId: SkillRunId,
  publication: WayfinderPublication,
  wayfinderMap: Schema.optional(WayfinderMapProjection),
});

export const ThreadWayfinderMutationRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  skillRunId: SkillRunId,
  actionId: TrimmedNonEmptyString,
  action: WayfinderMutationAction,
  runtimeMode: RuntimeMode,
  confirmed: Schema.Boolean,
  createdAt: IsoDateTime,
});

export const ThreadWayfinderMutationUpdatedPayload = Schema.Struct({
  threadId: ThreadId,
  skillRunId: SkillRunId,
  mutation: WayfinderMutation,
  wayfinderMap: Schema.optional(WayfinderMapProjection),
});

export const ThreadWayfinderReconciliationRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  skillRunId: SkillRunId,
  reason: WayfinderReconcileReason,
  expectedRevision: Schema.optional(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});

export const ThreadWayfinderReconciliationUpdatedPayload = Schema.Struct({
  threadId: ThreadId,
  skillRunId: SkillRunId,
  synchronization: WayfinderSynchronizationState,
  wayfinderMap: Schema.optional(WayfinderMapProjection),
});

export const ThreadWayfinderResearchRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  skillRunId: SkillRunId,
  action: WayfinderResearchAction,
  launchMode: Schema.Literals(["automatic", "manual"]),
  createdAt: IsoDateTime,
});

export const ThreadWayfinderResearchUpdatedPayload = Schema.Struct({
  threadId: ThreadId,
  skillRunId: SkillRunId,
  research: WayfinderResearchState,
});

export const ThreadWorkflowAttachmentHintedPayload = Schema.Struct({
  threadId: ThreadId,
  hint: WorkflowAttachmentHint,
});

export const ThreadWorkflowAttachmentHintDismissedPayload = Schema.Struct({
  threadId: ThreadId,
  hint: WorkflowAttachmentHint,
});

export const ThreadWorkflowAttachedPayload = Schema.Struct({
  threadId: ThreadId,
  hint: WorkflowAttachmentHint,
  attachment: WorkflowAttachment,
});

export const ThreadWorkflowRunPreflightedPayload = Schema.Struct({
  threadId: ThreadId,
  attachment: WorkflowAttachment,
});

export const ThreadWorkflowRunConfirmedPayload = Schema.Struct({
  threadId: ThreadId,
  attachment: WorkflowAttachment,
});

export const ThreadWorkflowRunAutomationUpdatedPayload = Schema.Struct({
  threadId: ThreadId,
  attachment: WorkflowAttachment,
});

export const ThreadWorkflowSynchronizedPayload = Schema.Struct({
  threadId: ThreadId,
  attachment: WorkflowAttachment,
});

export const ThreadWorkflowArtifactsViewedPayload = Schema.Struct({
  threadId: ThreadId,
  attachment: WorkflowAttachment,
});

export const ThreadWorkflowArtifactAcknowledgedPayload = Schema.Struct({
  threadId: ThreadId,
  attachment: WorkflowAttachment,
});

export const ThreadWorkflowStaleResolvedPayload = Schema.Struct({
  threadId: ThreadId,
  attachment: WorkflowAttachment,
});

export const ThreadWorkflowSpecificationDispatchedPayload = Schema.Struct({
  threadId: ThreadId,
  attachment: WorkflowAttachment,
});

export const ThreadWorkflowSpecificationCheckpointedPayload = Schema.Struct({
  threadId: ThreadId,
  attachment: WorkflowAttachment,
});

export const ThreadWorkflowSpecificationCheckpointResolvedPayload = Schema.Struct({
  threadId: ThreadId,
  attachment: WorkflowAttachment,
});

export const ThreadWorkflowSpecificationCompletedPayload = Schema.Struct({
  threadId: ThreadId,
  attachment: WorkflowAttachment,
  artifact: WorkflowArtifactDetail,
});

export const ThreadWorkflowSpecificationFailedPayload = Schema.Struct({
  threadId: ThreadId,
  attachment: WorkflowAttachment,
});

export const ThreadWorkflowTicketingDispatchedPayload = Schema.Struct({
  threadId: ThreadId,
  attachment: WorkflowAttachment,
});

export const ThreadWorkflowTicketingCheckpointedPayload = Schema.Struct({
  threadId: ThreadId,
  attachment: WorkflowAttachment,
});

export const ThreadWorkflowTicketingCheckpointResolvedPayload = Schema.Struct({
  threadId: ThreadId,
  attachment: WorkflowAttachment,
});

export const ThreadWorkflowTicketBatchPublicationRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  ticketingThreadId: ThreadId,
  skillRunId: SkillRunId,
  batch: WorkflowTicketBatch,
  publication: WorkflowTicketBatchPublication,
  attachment: WorkflowAttachment,
  createdAt: IsoDateTime,
});

export const ThreadWorkflowTicketBatchPublicationUpdatedPayload = Schema.Struct({
  threadId: ThreadId,
  attachment: WorkflowAttachment,
});

export const ThreadWorkflowTicketingFailedPayload = Schema.Struct({
  threadId: ThreadId,
  attachment: WorkflowAttachment,
});

export const ThreadWorkflowTicketImplementationRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  implementation: WorkflowTicketImplementation,
  attachment: WorkflowAttachment,
  createdAt: IsoDateTime,
});

export const ThreadWorkflowTicketImplementationUpdatedPayload = Schema.Struct({
  threadId: ThreadId,
  implementation: WorkflowTicketImplementation,
  attachment: WorkflowAttachment,
});

export const ThreadWorkflowTicketImplementationCheckpointedPayload =
  ThreadWorkflowTicketImplementationUpdatedPayload;

export const ThreadCheckpointRevertRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

export const ThreadRevertedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
});

export const ThreadSessionStopRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

export const ThreadSessionSetPayload = Schema.Struct({
  threadId: ThreadId,
  session: OrchestrationSession,
});

export const ThreadProposedPlanUpsertedPayload = Schema.Struct({
  threadId: ThreadId,
  proposedPlan: OrchestrationProposedPlan,
});

export const ThreadTurnDiffCompletedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});

export const ThreadActivityAppendedPayload = Schema.Struct({
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
});

export const OrchestrationEventMetadata = Schema.Struct({
  providerTurnId: Schema.optional(TrimmedNonEmptyString),
  providerItemId: Schema.optional(ProviderItemId),
  adapterKey: Schema.optional(TrimmedNonEmptyString),
  requestId: Schema.optional(ApprovalRequestId),
  ingestedAt: Schema.optional(IsoDateTime),
});
export type OrchestrationEventMetadata = typeof OrchestrationEventMetadata.Type;

const EventBaseFields = {
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: OrchestrationAggregateKind,
  aggregateId: Schema.Union([ProjectId, ThreadId]),
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  metadata: OrchestrationEventMetadata,
} as const;

export const OrchestrationEvent = Schema.Union([
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.created"),
    payload: ProjectCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.meta-updated"),
    payload: ProjectMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.deleted"),
    payload: ProjectDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.created"),
    payload: ThreadCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.deleted"),
    payload: ThreadDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.archived"),
    payload: ThreadArchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.unarchived"),
    payload: ThreadUnarchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.settled"),
    payload: ThreadSettledPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.unsettled"),
    payload: ThreadUnsettledPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.snoozed"),
    payload: ThreadSnoozedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.unsnoozed"),
    payload: ThreadUnsnoozedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.meta-updated"),
    payload: ThreadMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.runtime-mode-set"),
    payload: ThreadRuntimeModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.interaction-mode-set"),
    payload: ThreadInteractionModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.message-sent"),
    payload: ThreadMessageSentPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-start-requested"),
    payload: ThreadTurnStartRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-interrupt-requested"),
    payload: ThreadTurnInterruptRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.approval-response-requested"),
    payload: ThreadApprovalResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.user-input-response-requested"),
    payload: ThreadUserInputResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.wayfinder-publication-requested"),
    payload: ThreadWayfinderPublicationRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.wayfinder-publication-updated"),
    payload: ThreadWayfinderPublicationUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.wayfinder-mutation-requested"),
    payload: ThreadWayfinderMutationRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.wayfinder-mutation-updated"),
    payload: ThreadWayfinderMutationUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.wayfinder-reconciliation-requested"),
    payload: ThreadWayfinderReconciliationRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.wayfinder-reconciliation-updated"),
    payload: ThreadWayfinderReconciliationUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.wayfinder-research-requested"),
    payload: ThreadWayfinderResearchRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.wayfinder-research-updated"),
    payload: ThreadWayfinderResearchUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-attachment-hinted"),
    payload: ThreadWorkflowAttachmentHintedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-attachment-hint-dismissed"),
    payload: ThreadWorkflowAttachmentHintDismissedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-attached"),
    payload: ThreadWorkflowAttachedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-run-preflighted"),
    payload: ThreadWorkflowRunPreflightedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-run-confirmed"),
    payload: ThreadWorkflowRunConfirmedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-run-started"),
    payload: ThreadWorkflowRunAutomationUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-run-draining"),
    payload: ThreadWorkflowRunAutomationUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-run-paused"),
    payload: ThreadWorkflowRunAutomationUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-run-resumed"),
    payload: ThreadWorkflowRunAutomationUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-node-held"),
    payload: ThreadWorkflowRunAutomationUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-node-released"),
    payload: ThreadWorkflowRunAutomationUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-synchronized"),
    payload: ThreadWorkflowSynchronizedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-artifacts-viewed"),
    payload: ThreadWorkflowArtifactsViewedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-artifact-acknowledged"),
    payload: ThreadWorkflowArtifactAcknowledgedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-stale-resolved"),
    payload: ThreadWorkflowStaleResolvedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-specification-dispatched"),
    payload: ThreadWorkflowSpecificationDispatchedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-specification-checkpointed"),
    payload: ThreadWorkflowSpecificationCheckpointedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-specification-checkpoint-resolved"),
    payload: ThreadWorkflowSpecificationCheckpointResolvedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-specification-completed"),
    payload: ThreadWorkflowSpecificationCompletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-specification-failed"),
    payload: ThreadWorkflowSpecificationFailedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-ticketing-dispatched"),
    payload: ThreadWorkflowTicketingDispatchedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-ticketing-checkpointed"),
    payload: ThreadWorkflowTicketingCheckpointedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-ticketing-checkpoint-resolved"),
    payload: ThreadWorkflowTicketingCheckpointResolvedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-ticket-batch-publication-requested"),
    payload: ThreadWorkflowTicketBatchPublicationRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-ticket-batch-publication-updated"),
    payload: ThreadWorkflowTicketBatchPublicationUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-ticketing-failed"),
    payload: ThreadWorkflowTicketingFailedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-ticket-implementation-requested"),
    payload: ThreadWorkflowTicketImplementationRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-ticket-implementation-updated"),
    payload: ThreadWorkflowTicketImplementationUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.workflow-ticket-implementation-checkpointed"),
    payload: ThreadWorkflowTicketImplementationCheckpointedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.checkpoint-revert-requested"),
    payload: ThreadCheckpointRevertRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.reverted"),
    payload: ThreadRevertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.session-stop-requested"),
    payload: ThreadSessionStopRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.session-set"),
    payload: ThreadSessionSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.proposed-plan-upserted"),
    payload: ThreadProposedPlanUpsertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-diff-completed"),
    payload: ThreadTurnDiffCompletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.activity-appended"),
    payload: ThreadActivityAppendedPayload,
  }),
]);
export type OrchestrationEvent = typeof OrchestrationEvent.Type;

export const OrchestrationThreadStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("synchronized"),
  }),
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationThreadDetailSnapshot,
  }),
  Schema.Struct({
    kind: Schema.Literal("event"),
    event: OrchestrationEvent,
  }),
]);
export type OrchestrationThreadStreamItem = typeof OrchestrationThreadStreamItem.Type;

export const OrchestrationCommandReceiptStatus = Schema.Literals(["accepted", "rejected"]);
export type OrchestrationCommandReceiptStatus = typeof OrchestrationCommandReceiptStatus.Type;

export const TurnCountRange = Schema.Struct({
  fromTurnCount: NonNegativeInt,
  toTurnCount: NonNegativeInt,
}).check(
  Schema.makeFilter(
    (input) =>
      input.fromTurnCount <= input.toTurnCount ||
      new SchemaIssue.InvalidValue(Option.some(input.fromTurnCount), {
        message: "fromTurnCount must be less than or equal to toTurnCount",
      }),
    { identifier: "OrchestrationTurnDiffRange" },
  ),
);

export const ThreadTurnDiff = TurnCountRange.mapFields(
  Struct.assign({
    threadId: ThreadId,
    diff: Schema.String,
  }),
  { unsafePreserveChecks: true },
);

export const ProviderSessionRuntimeStatus = Schema.Literals([
  "starting",
  "running",
  "stopped",
  "error",
]);
export type ProviderSessionRuntimeStatus = typeof ProviderSessionRuntimeStatus.Type;

const ProjectionThreadTurnStatus = Schema.Literals([
  "running",
  "completed",
  "interrupted",
  "error",
]);
export type ProjectionThreadTurnStatus = typeof ProjectionThreadTurnStatus.Type;

const ProjectionCheckpointRow = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});
export type ProjectionCheckpointRow = typeof ProjectionCheckpointRow.Type;

export const ProjectionPendingApprovalStatus = Schema.Literals(["pending", "resolved"]);
export type ProjectionPendingApprovalStatus = typeof ProjectionPendingApprovalStatus.Type;

export const ProjectionPendingApprovalDecision = Schema.NullOr(ProviderApprovalDecision);
export type ProjectionPendingApprovalDecision = typeof ProjectionPendingApprovalDecision.Type;

export const DispatchResult = Schema.Struct({
  sequence: NonNegativeInt,
});
export type DispatchResult = typeof DispatchResult.Type;

export const OrchestrationGetTurnDiffInput = TurnCountRange.mapFields(
  Struct.assign({
    threadId: ThreadId,
    ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
  }),
  { unsafePreserveChecks: true },
);
export type OrchestrationGetTurnDiffInput = typeof OrchestrationGetTurnDiffInput.Type;

export const OrchestrationGetTurnDiffResult = ThreadTurnDiff;
export type OrchestrationGetTurnDiffResult = typeof OrchestrationGetTurnDiffResult.Type;

export const OrchestrationGetFullThreadDiffInput = Schema.Struct({
  threadId: ThreadId,
  toTurnCount: NonNegativeInt,
  ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
});
export type OrchestrationGetFullThreadDiffInput = typeof OrchestrationGetFullThreadDiffInput.Type;

export const OrchestrationGetFullThreadDiffResult = ThreadTurnDiff;
export type OrchestrationGetFullThreadDiffResult = typeof OrchestrationGetFullThreadDiffResult.Type;

export const OrchestrationThreadSearchSource = Schema.Literals(["user", "assistant"]);
export type OrchestrationThreadSearchSource = typeof OrchestrationThreadSearchSource.Type;

// The server's SQLite client is synchronous and single-connection. Bound both
// scan input and response size so a search cannot monopolize that connection.
export const OrchestrationSearchThreadsInput = Schema.Struct({
  query: TrimmedString.check(Schema.isMinLength(2), Schema.isMaxLength(200)),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
});
export type OrchestrationSearchThreadsInput = typeof OrchestrationSearchThreadsInput.Type;

export const OrchestrationThreadSearchMatch = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  source: OrchestrationThreadSearchSource,
  snippet: Schema.String.check(Schema.isMaxLength(240)),
  messageCreatedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationThreadSearchMatch = typeof OrchestrationThreadSearchMatch.Type;

export const OrchestrationSearchThreadsResult = Schema.Struct({
  matches: Schema.Array(OrchestrationThreadSearchMatch),
});
export type OrchestrationSearchThreadsResult = typeof OrchestrationSearchThreadsResult.Type;

export const OrchestrationRpcSchemas = {
  dispatchCommand: {
    input: ClientOrchestrationCommand,
    output: DispatchResult,
  },
  getTurnDiff: {
    input: OrchestrationGetTurnDiffInput,
    output: OrchestrationGetTurnDiffResult,
  },
  getFullThreadDiff: {
    input: OrchestrationGetFullThreadDiffInput,
    output: OrchestrationGetFullThreadDiffResult,
  },
  searchThreads: {
    input: OrchestrationSearchThreadsInput,
    output: OrchestrationSearchThreadsResult,
  },
  getArchivedShellSnapshot: {
    input: Schema.Struct({}),
    output: OrchestrationShellSnapshot,
  },
  subscribeThread: {
    input: OrchestrationSubscribeThreadInput,
    output: OrchestrationThreadStreamItem,
  },
  subscribeShell: {
    input: OrchestrationSubscribeShellInput,
    output: OrchestrationShellStreamItem,
  },
} as const;

export class OrchestrationGetSnapshotError extends Schema.TaggedErrorClass<OrchestrationGetSnapshotError>()(
  "OrchestrationGetSnapshotError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class OrchestrationDispatchCommandError extends Schema.TaggedErrorClass<OrchestrationDispatchCommandError>()(
  "OrchestrationDispatchCommandError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
    preflightBlockers: Schema.optional(
      Schema.Array(
        Schema.Struct({
          check: TrimmedNonEmptyString,
          remediation: TrimmedNonEmptyString,
        }),
      ),
    ),
  },
) {}

export class OrchestrationGetTurnDiffError extends Schema.TaggedErrorClass<OrchestrationGetTurnDiffError>()(
  "OrchestrationGetTurnDiffError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class OrchestrationGetFullThreadDiffError extends Schema.TaggedErrorClass<OrchestrationGetFullThreadDiffError>()(
  "OrchestrationGetFullThreadDiffError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class OrchestrationSearchThreadsError extends Schema.TaggedErrorClass<OrchestrationSearchThreadsError>()(
  "OrchestrationSearchThreadsError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
