import * as Schema from "effect/Schema";
import { ApprovalRequestId, IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { UserInputQuestion } from "./providerRuntime.ts";

export const WayfinderDraftItem = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  detail: Schema.optional(TrimmedNonEmptyString),
});
export type WayfinderDraftItem = typeof WayfinderDraftItem.Type;

export const WayfinderDraftTicketClassification = Schema.Literals([
  "research",
  "prototype",
  "grilling",
  "task",
]);
export type WayfinderDraftTicketClassification = typeof WayfinderDraftTicketClassification.Type;

export const WayfinderDecisionTicket = Schema.Struct({
  ...WayfinderDraftItem.fields,
  classification: Schema.optional(WayfinderDraftTicketClassification),
});
export type WayfinderDecisionTicket = typeof WayfinderDecisionTicket.Type;

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

export const WayfinderDecisionTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("destination") }),
  Schema.Struct({ kind: Schema.Literal("note"), id: TrimmedNonEmptyString }),
  Schema.Struct({
    kind: Schema.Literal("candidate-ticket"),
    id: TrimmedNonEmptyString,
    classification: Schema.optional(WayfinderDraftTicketClassification),
  }),
  Schema.Struct({ kind: Schema.Literal("fog-of-war"), id: TrimmedNonEmptyString }),
  Schema.Struct({ kind: Schema.Literal("out-of-scope"), id: TrimmedNonEmptyString }),
  Schema.Struct({
    kind: Schema.Literal("proposed-dependency"),
    from: TrimmedNonEmptyString,
    to: TrimmedNonEmptyString,
  }),
]);
export type WayfinderDecisionTarget = typeof WayfinderDecisionTarget.Type;

export const WayfinderDraft = Schema.Struct({
  authority: Schema.Literal("unpublished-draft"),
  canonical: Schema.Literal(false),
  destination: Schema.NullOr(TrimmedNonEmptyString),
  notes: Schema.Array(TrimmedNonEmptyString),
  confirmedDecisions: Schema.Array(WayfinderConfirmedDecision),
  proposedDecisions: Schema.Array(WayfinderDecisionProposal),
  candidateTickets: Schema.Array(WayfinderDecisionTicket),
  fogOfWar: Schema.Array(WayfinderDraftItem),
  outOfScope: Schema.Array(WayfinderDraftItem),
  proposedDependencyEdges: Schema.Array(WayfinderProposedDependencyEdge),
  decisionReceipts: Schema.Array(WayfinderDecisionReceipt),
  updatedAt: IsoDateTime,
});
export type WayfinderDraft = typeof WayfinderDraft.Type;

export const OptionalWayfinderDraft = Schema.optional(WayfinderDraft);

export const WayfinderPublicationArtifact = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("label"),
    name: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("issue"),
    key: TrimmedNonEmptyString,
    number: Schema.Int.check(Schema.isGreaterThan(0)),
    url: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("child"),
    key: TrimmedNonEmptyString,
    parentNumber: Schema.Int.check(Schema.isGreaterThan(0)),
    childNumber: Schema.Int.check(Schema.isGreaterThan(0)),
  }),
  Schema.Struct({
    kind: Schema.Literal("blocked-by"),
    key: TrimmedNonEmptyString,
    blockedNumber: Schema.Int.check(Schema.isGreaterThan(0)),
    blockerNumber: Schema.Int.check(Schema.isGreaterThan(0)),
  }),
]);
export type WayfinderPublicationArtifact = typeof WayfinderPublicationArtifact.Type;

export const WayfinderPublication = Schema.Struct({
  status: Schema.Literals(["awaiting-approval", "publishing", "failed", "synchronized"]),
  artifacts: Schema.Array(WayfinderPublicationArtifact),
  nextStep: Schema.NullOr(TrimmedNonEmptyString),
  error: Schema.optional(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});
export type WayfinderPublication = typeof WayfinderPublication.Type;

export const OptionalWayfinderPublication = Schema.optional(WayfinderPublication);

const WayfinderTicketNumber = Schema.Int.check(Schema.isGreaterThan(0));

export const WayfinderGraduatedFogBlocker = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("ticket"),
    ticketNumber: WayfinderTicketNumber,
  }),
  Schema.Struct({
    kind: Schema.Literal("graduated"),
    key: TrimmedNonEmptyString,
  }),
]);
export type WayfinderGraduatedFogBlocker = typeof WayfinderGraduatedFogBlocker.Type;

export const WayfinderGraduatedFogTicket = Schema.Struct({
  key: TrimmedNonEmptyString,
  fog: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  classification: WayfinderDraftTicketClassification,
  blockedBy: Schema.Array(WayfinderGraduatedFogBlocker),
});
export type WayfinderGraduatedFogTicket = typeof WayfinderGraduatedFogTicket.Type;

export const WayfinderMapField = Schema.Literals([
  "destination",
  "notes",
  "fog-of-war",
  "out-of-scope",
]);
export type WayfinderMapField = typeof WayfinderMapField.Type;

export const WayfinderMutationAction = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("update-map-field"),
    field: WayfinderMapField,
    value: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("create-ticket"),
    title: TrimmedNonEmptyString,
    classification: WayfinderDraftTicketClassification,
  }),
  Schema.Struct({
    kind: Schema.Literal("rename-ticket"),
    ticketNumber: WayfinderTicketNumber,
    title: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("classify-ticket"),
    ticketNumber: WayfinderTicketNumber,
    classification: WayfinderDraftTicketClassification,
  }),
  Schema.Struct({
    kind: Schema.Literal("add-dependency"),
    blockedNumber: WayfinderTicketNumber,
    blockerNumber: WayfinderTicketNumber,
  }),
  Schema.Struct({
    kind: Schema.Literal("remove-dependency"),
    blockedNumber: WayfinderTicketNumber,
    blockerNumber: WayfinderTicketNumber,
  }),
  Schema.Struct({
    kind: Schema.Literal("resolve-ticket"),
    ticketNumber: WayfinderTicketNumber,
    resolution: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("close-ticket"),
    ticketNumber: WayfinderTicketNumber,
  }),
  Schema.Struct({
    kind: Schema.Literal("reopen-ticket"),
    ticketNumber: WayfinderTicketNumber,
  }),
  Schema.Struct({
    kind: Schema.Literal("claim-ticket"),
    ticketNumber: WayfinderTicketNumber,
  }),
  Schema.Struct({
    kind: Schema.Literal("release-ticket"),
    ticketNumber: WayfinderTicketNumber,
  }),
  Schema.Struct({
    kind: Schema.Literal("complete-hitl-ticket"),
    ticketNumber: WayfinderTicketNumber,
    outcome: Schema.Literals(["resolved", "out-of-scope"]),
    resolution: TrimmedNonEmptyString,
    contextPointer: TrimmedNonEmptyString,
    graduatedFog: Schema.Array(WayfinderGraduatedFogTicket),
  }),
]);
export type WayfinderMutationAction = typeof WayfinderMutationAction.Type;

export const WayfinderResolutionArtifact = Schema.Union([
  WayfinderPublicationArtifact,
  Schema.Struct({
    kind: Schema.Literal("resolution-comment"),
    ticketNumber: WayfinderTicketNumber,
    contextPointer: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("decision-pointer"),
    ticketNumber: WayfinderTicketNumber,
    contextPointer: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("fog-graduated"),
    key: TrimmedNonEmptyString,
    fog: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("out-of-scope"),
    ticketNumber: WayfinderTicketNumber,
    contextPointer: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("ticket-closed"),
    ticketNumber: WayfinderTicketNumber,
  }),
]);
export type WayfinderResolutionArtifact = typeof WayfinderResolutionArtifact.Type;

export const WayfinderMutation = Schema.Struct({
  actionId: TrimmedNonEmptyString,
  action: WayfinderMutationAction,
  status: Schema.Literals(["awaiting-approval", "mutating", "failed", "synchronized"]),
  artifacts: Schema.optional(Schema.Array(WayfinderResolutionArtifact)),
  nextStep: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  error: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});
export type WayfinderMutation = typeof WayfinderMutation.Type;

export const OptionalWayfinderMutation = Schema.optional(WayfinderMutation);
