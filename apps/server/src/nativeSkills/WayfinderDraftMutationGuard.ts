export interface DraftGuardActivity {
  readonly kind: string;
  readonly payload: unknown;
}

export const hasActiveWayfinderDraft = (activities: ReadonlyArray<DraftGuardActivity>): boolean => {
  let active = false;
  for (const activity of activities) {
    if (activity.kind === "wayfinder.draft.started") active = true;
    if (activity.kind === "wayfinder.draft.published") active = false;
  }
  return active;
};

/**
 * The server cannot prove an arbitrary command or tool is read-only. While a
 * draft is active it therefore rejects every executable approval, leaving
 * structured user-input responses as the only accepted interaction.
 */
export const blockedWayfinderDraftApprovalDetail = (
  activities: ReadonlyArray<DraftGuardActivity>,
): string | null => (hasActiveWayfinderDraft(activities) ? "provider action" : null);
