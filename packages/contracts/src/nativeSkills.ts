import * as Schema from "effect/Schema";
import { ApprovalRequestId, IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { UserInputQuestion } from "./providerRuntime.ts";

export const WayfinderDraftItem = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  detail: Schema.optional(TrimmedNonEmptyString),
});
export type WayfinderDraftItem = typeof WayfinderDraftItem.Type;

export const WayfinderProposedDependencyEdge = Schema.Struct({
  from: TrimmedNonEmptyString,
  to: TrimmedNonEmptyString,
});
export type WayfinderProposedDependencyEdge = typeof WayfinderProposedDependencyEdge.Type;

export const WayfinderDecisionProposal = Schema.Struct({
  requestId: ApprovalRequestId,
  question: UserInputQuestion,
  recommendation: Schema.optional(TrimmedNonEmptyString),
  reasoning: Schema.optional(TrimmedNonEmptyString),
  proposedAt: IsoDateTime,
});
export type WayfinderDecisionProposal = typeof WayfinderDecisionProposal.Type;

export const WayfinderConfirmedDecision = Schema.Struct({
  requestId: ApprovalRequestId,
  questionId: TrimmedNonEmptyString,
  question: TrimmedNonEmptyString,
  answer: TrimmedNonEmptyString,
  confirmedAt: IsoDateTime,
});
export type WayfinderConfirmedDecision = typeof WayfinderConfirmedDecision.Type;

export const WayfinderDecisionReceipt = Schema.Struct({
  requestId: ApprovalRequestId,
  answers: Schema.Record(Schema.String, Schema.Unknown),
  recordedAt: IsoDateTime,
});
export type WayfinderDecisionReceipt = typeof WayfinderDecisionReceipt.Type;

export const WayfinderDraft = Schema.Struct({
  authority: Schema.Literal("unpublished-draft"),
  canonical: Schema.Literal(false),
  destination: Schema.NullOr(TrimmedNonEmptyString),
  notes: Schema.Array(TrimmedNonEmptyString),
  confirmedDecisions: Schema.Array(WayfinderConfirmedDecision),
  proposedDecisions: Schema.Array(WayfinderDecisionProposal),
  candidateTickets: Schema.Array(WayfinderDraftItem),
  fogOfWar: Schema.Array(WayfinderDraftItem),
  outOfScope: Schema.Array(WayfinderDraftItem),
  proposedDependencyEdges: Schema.Array(WayfinderProposedDependencyEdge),
  decisionReceipts: Schema.Array(WayfinderDecisionReceipt),
  updatedAt: IsoDateTime,
});
export type WayfinderDraft = typeof WayfinderDraft.Type;

export const emptyWayfinderDraft = (createdAt: string): WayfinderDraft => ({
  authority: "unpublished-draft",
  canonical: false,
  destination: null,
  notes: [],
  confirmedDecisions: [],
  proposedDecisions: [],
  candidateTickets: [],
  fogOfWar: [],
  outOfScope: [],
  proposedDependencyEdges: [],
  decisionReceipts: [],
  updatedAt: IsoDateTime.make(createdAt),
});

export const OptionalWayfinderDraft = Schema.optional(WayfinderDraft);
