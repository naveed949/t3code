import {
  ApprovalRequestId,
  SkillRunId,
  TrimmedNonEmptyString,
  UserInputQuestion,
  type OrchestrationThreadActivity,
  type SkillInvocation,
  type WayfinderDecisionProposal,
  type WayfinderDraft,
} from "@t3tools/contracts";
import {
  isNativeWayfinderDraftInvocation,
  parseWayfinderDecisionTarget,
} from "@t3tools/shared/wayfinderDraft";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

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

export const findLatestWayfinderDraftInvocation = (
  skillRuns: ReadonlyArray<SkillInvocation>,
  threadId: SkillInvocation["threadId"] | null | undefined,
): SkillInvocation | null => {
  if (threadId === null || threadId === undefined) return null;
  let latest: SkillInvocation | null = null;
  for (const invocation of skillRuns) {
    if (invocation.threadId !== threadId || !isNativeWayfinderDraftInvocation(invocation)) continue;
    if (
      latest === null ||
      invocation.createdAt.localeCompare(latest.createdAt) > 0 ||
      (invocation.createdAt === latest.createdAt &&
        invocation.skillRunId.localeCompare(latest.skillRunId) > 0)
    ) {
      latest = invocation;
    }
  }
  return latest;
};

/**
 * Rebuilds the unpublished map from its durable invocation snapshot and
 * structured-input transcript. Proposals stay tentative until the matching
 * resolved activity supplies the receipt and answer.
 */
export const deriveWayfinderDraft = (
  invocation: SkillInvocation | null | undefined,
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): WayfinderDraft | null => {
  if (!isNativeWayfinderDraftInvocation(invocation)) {
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
