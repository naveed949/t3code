import type { WayfinderDraft } from "@t3tools/contracts";

export const wayfinderDecisionStep = <Question extends { readonly id: string }>(
  questions: ReadonlyArray<Question>,
  drafts: Readonly<
    Record<string, { readonly selectedOptionLabel?: string; readonly customAnswer?: string }>
  >,
  questionIndex: number,
) => {
  const activeQuestion = questions[questionIndex] ?? null;
  const activeDraft = activeQuestion ? drafts[activeQuestion.id] : undefined;
  const answered =
    Boolean(activeDraft?.selectedOptionLabel) || Boolean(activeDraft?.customAnswer?.trim());
  return {
    activeQuestion,
    visibleQuestions: activeQuestion ? [activeQuestion] : [],
    canAdvance: questionIndex < questions.length - 1 && answered,
  };
};

export const wayfinderDraftPresentation = (draft: WayfinderDraft) => ({
  authorityLabel: "Unpublished Wayfinder draft",
  safetyLabel: "Non-canonical · nothing has been written to GitHub",
  progressLabel: `${draft.confirmedDecisions.length} confirmed${
    draft.proposedDecisions.length > 0 ? " · 1 agent proposal" : ""
  }`,
  pendingProposal: draft.proposedDecisions[0] ?? null,
});
