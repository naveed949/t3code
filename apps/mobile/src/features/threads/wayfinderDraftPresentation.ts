import type { WayfinderDraft } from "@t3tools/contracts";

export const wayfinderDraftPresentation = (draft: WayfinderDraft) => ({
  authorityLabel: "Unpublished Wayfinder draft",
  safetyLabel: "Non-canonical · nothing has been written to GitHub",
  progressLabel: `${draft.confirmedDecisions.length} confirmed${
    draft.proposedDecisions.length > 0 ? " · 1 agent proposal" : ""
  }`,
  pendingProposal: draft.proposedDecisions[0] ?? null,
});
