/**
 * RuntimeReceiptBus - Internal checkpoint-reactor synchronization receipts.
 *
 * This service exists to expose short-lived orchestration milestones that are
 * useful in tests and harnesses but are not part of the production runtime
 * event model. `CheckpointReactor` publishes receipts such as baseline capture,
 * diff finalization, and turn-processing quiescence so integration tests can
 * wait for those exact points without inferring them indirectly from persisted
 * state.
 *
 * Production code should only call `publish`. Test code may subscribe via
 * `streamEventsForTest`, which is intentionally named to make the intended
 * usage explicit.
 *
 * @module RuntimeReceiptBus
 */
import {
  CheckpointRef,
  IsoDateTime,
  NonNegativeInt,
  SkillRunId,
  ThreadId,
  TurnId,
  WayfinderReconcileReason,
  WayfinderResearchTicketStatus,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

export const CheckpointBaselineCapturedReceipt = Schema.Struct({
  type: Schema.Literal("checkpoint.baseline.captured"),
  threadId: ThreadId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  createdAt: IsoDateTime,
});
export type CheckpointBaselineCapturedReceipt = typeof CheckpointBaselineCapturedReceipt.Type;

export const CheckpointDiffFinalizedReceipt = Schema.Struct({
  type: Schema.Literal("checkpoint.diff.finalized"),
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: Schema.Literals(["ready", "missing", "error"]),
  createdAt: IsoDateTime,
});
export type CheckpointDiffFinalizedReceipt = typeof CheckpointDiffFinalizedReceipt.Type;

export const TurnProcessingQuiescedReceipt = Schema.Struct({
  type: Schema.Literal("turn.processing.quiesced"),
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});
export type TurnProcessingQuiescedReceipt = typeof TurnProcessingQuiescedReceipt.Type;

export const WayfinderPublicationProgressReceipt = Schema.Struct({
  type: Schema.Literal("wayfinder.publication.progress"),
  threadId: ThreadId,
  skillRunId: SkillRunId,
  status: Schema.Literals(["awaiting-approval", "publishing", "failed", "synchronized"]),
  nextStep: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
});
export type WayfinderPublicationProgressReceipt = typeof WayfinderPublicationProgressReceipt.Type;

export const WayfinderMutationProgressReceipt = Schema.Struct({
  type: Schema.Literal("wayfinder.mutation.progress"),
  threadId: ThreadId,
  skillRunId: SkillRunId,
  actionId: Schema.String,
  status: Schema.Literals(["awaiting-approval", "mutating", "failed", "synchronized"]),
  createdAt: IsoDateTime,
});
export type WayfinderMutationProgressReceipt = typeof WayfinderMutationProgressReceipt.Type;
export const WayfinderReconciliationCompletedReceipt = Schema.Struct({
  type: Schema.Literal("wayfinder.reconciliation.completed"),
  threadId: ThreadId,
  skillRunId: SkillRunId,
  reason: WayfinderReconcileReason,
  status: Schema.Literals(["healthy", "unavailable", "conflict"]),
  createdAt: IsoDateTime,
});
export type WayfinderReconciliationCompletedReceipt =
  typeof WayfinderReconciliationCompletedReceipt.Type;

export const WayfinderResearchProgressReceipt = Schema.Struct({
  type: Schema.Literal("wayfinder.research.progress"),
  threadId: ThreadId,
  skillRunId: SkillRunId,
  ticketNumber: Schema.Int,
  status: WayfinderResearchTicketStatus,
  createdAt: IsoDateTime,
});
export type WayfinderResearchProgressReceipt = typeof WayfinderResearchProgressReceipt.Type;

export const WorkflowTicketBatchPublicationProgressReceipt = Schema.Struct({
  type: Schema.Literal("workflow.ticket-batch.publication.progress"),
  threadId: ThreadId,
  skillRunId: SkillRunId,
  batchId: Schema.String,
  status: Schema.Literals(["publishing", "failed", "synchronized"]),
  ticketCount: NonNegativeInt,
  createdAt: IsoDateTime,
  message: Schema.NullOr(Schema.String),
});
export type WorkflowTicketBatchPublicationProgressReceipt =
  typeof WorkflowTicketBatchPublicationProgressReceipt.Type;

export const OrchestrationRuntimeReceipt = Schema.Union([
  CheckpointBaselineCapturedReceipt,
  CheckpointDiffFinalizedReceipt,
  TurnProcessingQuiescedReceipt,
  WayfinderPublicationProgressReceipt,
  WayfinderMutationProgressReceipt,
  WayfinderReconciliationCompletedReceipt,
  WayfinderResearchProgressReceipt,
  WorkflowTicketBatchPublicationProgressReceipt,
]);
export type OrchestrationRuntimeReceipt = typeof OrchestrationRuntimeReceipt.Type;

export interface RuntimeReceiptBusShape {
  readonly publish: (receipt: OrchestrationRuntimeReceipt) => Effect.Effect<void>;
  readonly streamEventsForTest: Stream.Stream<OrchestrationRuntimeReceipt>;
}

export class RuntimeReceiptBus extends Context.Service<RuntimeReceiptBus, RuntimeReceiptBusShape>()(
  "t3/orchestration/Services/RuntimeReceiptBus",
) {}
