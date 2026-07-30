import {
  ApprovalRequestId,
  IsoDateTime,
  SkillRunId,
  TrimmedNonEmptyString,
  UserInputQuestion,
  type OrchestrationThreadActivity,
  type SkillInvocation,
  type WayfinderDecisionProposal,
  WayfinderDecisionTarget,
  type WayfinderDecisionTarget as WayfinderDecisionTargetType,
  type WayfinderDraft,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const isWayfinderDecisionTarget = Schema.is(WayfinderDecisionTarget);
const RECOMMENDED_SUFFIX = /\s*\(Recommended\)\s*$/iu;
const RequestedDecisionPayload = Schema.Struct({
  requestId: ApprovalRequestId,
  skillRunId: SkillRunId,
  questions: Schema.Array(UserInputQuestion).check(Schema.isMinLength(1)),
});
const ResolvedDecisionPayload = Schema.Struct({
  requestId: ApprovalRequestId,
  skillRunId: SkillRunId,
  answers: Schema.Record(Schema.String, Schema.Unknown),
});
const DecisionAnswer = Schema.Union([
  TrimmedNonEmptyString,
  Schema.Array(TrimmedNonEmptyString).check(Schema.isMinLength(1)),
]);
const decodeRequestedDecision = Schema.decodeUnknownOption(RequestedDecisionPayload);
const decodeResolvedDecision = Schema.decodeUnknownOption(ResolvedDecisionPayload);
const decodeDecisionAnswer = Schema.decodeUnknownOption(DecisionAnswer);

export const createEmptyWayfinderDraft = (createdAt: string): WayfinderDraft => ({
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

export function parseWayfinderDecisionTarget(id: string): WayfinderDecisionTargetType | null {
  if (id === "destination") return { kind: "destination" };
  for (const [prefix, kind] of [
    ["note:", "note"],
    ["ticket:", "candidate-ticket"],
    ["fog:", "fog-of-war"],
    ["out-of-scope:", "out-of-scope"],
  ] as const) {
    if (id.startsWith(prefix) && id.length > prefix.length) {
      const target = { kind, id: id.slice(prefix.length) };
      return isWayfinderDecisionTarget(target) ? target : null;
    }
  }
  const dependency = /^dependency:(.+)->(.+)$/u.exec(id);
  const target =
    dependency?.[1] && dependency[2]
      ? { kind: "proposed-dependency" as const, from: dependency[1], to: dependency[2] }
      : null;
  return target !== null && isWayfinderDecisionTarget(target) ? target : null;
}

export const isNativeWayfinderDraftInvocation = (
  invocation: SkillInvocation | null | undefined,
): invocation is SkillInvocation & { readonly wayfinderDraft: WayfinderDraft } =>
  invocation?.skill.name === "wayfinder" &&
  invocation.execution.mode === "native" &&
  invocation.action?.id === "new-map" &&
  invocation.wayfinderDraft !== undefined;

const proposalFor = (
  requestId: ApprovalRequestId,
  question: UserInputQuestion,
  proposedAt: string,
): WayfinderDecisionProposal => {
  const recommended = question.options.find((option) => RECOMMENDED_SUFFIX.test(option.label));
  return {
    requestId,
    question,
    ...(recommended
      ? {
          recommendation: recommended.label.replace(RECOMMENDED_SUFFIX, ""),
          reasoning: recommended.description,
        }
      : {}),
    proposedAt,
  };
};

const answerText = (answer: unknown): string | null => {
  const decoded = decodeDecisionAnswer(answer);
  return Option.isNone(decoded)
    ? null
    : typeof decoded.value === "string"
      ? decoded.value
      : decoded.value.join(", ");
};

/**
 * Rebuilds the unpublished map from its durable invocation snapshot and
 * structured-input transcript. Shared by clients and the publication reactor
 * so GitHub writes can never trust a client-supplied draft snapshot.
 */
export const deriveWayfinderDraft = (
  invocation: SkillInvocation | null | undefined,
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): WayfinderDraft | null => {
  if (
    !isNativeWayfinderDraftInvocation(invocation) ||
    invocation.wayfinderPublication?.status === "synchronized"
  ) {
    return null;
  }

  const requested = new Map<
    ApprovalRequestId,
    { readonly questions: ReadonlyArray<UserInputQuestion>; readonly createdAt: string }
  >();
  const resolved = new Map<
    ApprovalRequestId,
    { readonly answers: Readonly<Record<string, unknown>>; readonly createdAt: string }
  >();

  for (const activity of [...activities].sort(
    (left, right) =>
      (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER) ||
      left.createdAt.localeCompare(right.createdAt),
  )) {
    if (activity.kind === "user-input.requested") {
      const payload = decodeRequestedDecision(activity.payload);
      if (Option.isSome(payload) && payload.value.skillRunId === invocation.skillRunId) {
        requested.set(payload.value.requestId, {
          questions: payload.value.questions,
          createdAt: activity.createdAt,
        });
      }
    }
    if (activity.kind === "user-input.resolved") {
      const payload = decodeResolvedDecision(activity.payload);
      if (Option.isSome(payload) && payload.value.skillRunId === invocation.skillRunId) {
        resolved.set(payload.value.requestId, {
          answers: payload.value.answers,
          createdAt: activity.createdAt,
        });
      }
    }
  }

  const proposedDecisions: WayfinderDecisionProposal[] = [];
  const confirmedDecisions = [...invocation.wayfinderDraft.confirmedDecisions];
  const decisionReceipts = [...invocation.wayfinderDraft.decisionReceipts];
  let destination = invocation.wayfinderDraft.destination;
  const notes = [...invocation.wayfinderDraft.notes];
  const candidateTickets = [...invocation.wayfinderDraft.candidateTickets];
  const fogOfWar = [...invocation.wayfinderDraft.fogOfWar];
  const outOfScope = [...invocation.wayfinderDraft.outOfScope];
  const proposedDependencyEdges = [...invocation.wayfinderDraft.proposedDependencyEdges];
  let updatedAt = invocation.wayfinderDraft.updatedAt;

  for (const [requestId, request] of requested) {
    const receipt = resolved.get(requestId);
    if (!receipt) {
      proposedDecisions.push(
        ...request.questions.map((question) => proposalFor(requestId, question, request.createdAt)),
      );
      updatedAt = request.createdAt;
      continue;
    }

    decisionReceipts.push({
      requestId,
      answers: receipt.answers,
      recordedAt: receipt.createdAt,
    });
    for (const question of request.questions) {
      const answer = answerText(receipt.answers[question.id]);
      if (answer === null) continue;
      confirmedDecisions.push({
        requestId,
        questionId: question.id,
        question: question.question,
        answer,
        confirmedAt: receipt.createdAt,
      });
      const target = parseWayfinderDecisionTarget(question.id);
      switch (target?.kind) {
        case "destination":
          destination = answer;
          break;
        case "note":
          notes.push(answer);
          break;
        case "candidate-ticket":
          candidateTickets.push({ id: target.id, title: answer });
          break;
        case "fog-of-war":
          fogOfWar.push({ id: target.id, title: answer });
          break;
        case "out-of-scope":
          outOfScope.push({ id: target.id, title: answer });
          break;
        case "proposed-dependency":
          proposedDependencyEdges.push({ from: target.from, to: target.to });
          break;
      }
    }
    updatedAt = receipt.createdAt;
  }

  return {
    ...invocation.wayfinderDraft,
    destination,
    notes,
    proposedDecisions,
    confirmedDecisions,
    candidateTickets,
    fogOfWar,
    outOfScope,
    proposedDependencyEdges,
    decisionReceipts,
    updatedAt,
  };
};
