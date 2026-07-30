export interface DraftGuardActivity {
  readonly kind: string;
  readonly payload: unknown;
}

export const hasActiveWayfinderDraftAuthority = (
  activities: ReadonlyArray<DraftGuardActivity>,
): boolean => {
  let active = false;
  for (const activity of activities) {
    if (activity.kind === "wayfinder.draft.started") active = true;
    if (activity.kind === "wayfinder.draft.published") active = false;
  }
  return active;
};
