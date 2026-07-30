import {
  ApprovalRequestId,
  type OrchestrationThreadActivity,
  type SkillInvocation,
  type UserInputQuestion,
  type WayfinderDecisionProposal,
  type WayfinderDraft,
} from "@t3tools/contracts";

const RECOMMENDED_SUFFIX = /\s*\(Recommended\)\s*$/iu;

const activityPayload = (
  activity: OrchestrationThreadActivity,
): Readonly<Record<string, unknown>> | null =>
  activity.payload !== null && typeof activity.payload === "object"
    ? (activity.payload as Readonly<Record<string, unknown>>)
    : null;

const parseQuestions = (value: unknown): ReadonlyArray<UserInputQuestion> => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ReadonlyArray<UserInputQuestion> => {
    if (entry === null || typeof entry !== "object") return [];
    const question = entry as Readonly<Record<string, unknown>>;
    if (
      typeof question.id !== "string" ||
      typeof question.header !== "string" ||
      typeof question.question !== "string" ||
      !Array.isArray(question.options)
    ) {
      return [];
    }
    const options = question.options.flatMap((option) => {
      if (option === null || typeof option !== "object") return [];
      const record = option as Readonly<Record<string, unknown>>;
      return typeof record.label === "string" && typeof record.description === "string"
        ? [{ label: record.label, description: record.description }]
        : [];
    });
    if (options.length === 0) return [];
    return [
      {
        id: question.id,
        header: question.header,
        question: question.question,
        options,
        multiSelect: question.multiSelect === true,
      },
    ];
  });
};

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
  if (typeof answer === "string" && answer.trim().length > 0) return answer.trim();
  if (Array.isArray(answer)) {
    const values = answer.filter((entry): entry is string => typeof entry === "string");
    return values.length > 0 ? values.join(", ") : null;
  }
  return null;
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
  if (
    invocation?.skill.name !== "wayfinder" ||
    invocation.execution.mode !== "native" ||
    invocation.action?.id !== "new-map" ||
    invocation.wayfinderDraft === undefined
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
    const payload = activityPayload(activity);
    if (payload === null || typeof payload.requestId !== "string") continue;
    const requestId = ApprovalRequestId.make(payload.requestId);

    if (activity.kind === "user-input.requested") {
      const questions = parseQuestions(payload.questions);
      if (questions.length > 0) {
        requested.set(requestId, { questions, createdAt: activity.createdAt });
      }
    }
    if (
      activity.kind === "user-input.resolved" &&
      payload.answers !== null &&
      typeof payload.answers === "object" &&
      !Array.isArray(payload.answers)
    ) {
      resolved.set(requestId, {
        answers: payload.answers as Readonly<Record<string, unknown>>,
        createdAt: activity.createdAt,
      });
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
      if (question.id === "destination") {
        destination = answer;
      } else if (question.id.startsWith("note:")) {
        notes.push(answer);
      } else if (question.id.startsWith("ticket:")) {
        candidateTickets.push({ id: question.id.slice("ticket:".length), title: answer });
      } else if (question.id.startsWith("fog:")) {
        fogOfWar.push({ id: question.id.slice("fog:".length), title: answer });
      } else if (question.id.startsWith("out-of-scope:")) {
        outOfScope.push({
          id: question.id.slice("out-of-scope:".length),
          title: answer,
        });
      } else {
        const dependency = /^dependency:(.+)->(.+)$/u.exec(question.id);
        if (dependency?.[1] && dependency[2]) {
          proposedDependencyEdges.push({ from: dependency[1], to: dependency[2] });
        }
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
