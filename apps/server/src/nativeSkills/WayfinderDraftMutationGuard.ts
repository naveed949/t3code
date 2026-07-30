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

export const activeWayfinderDraftSkillRunId = (
  activities: ReadonlyArray<DraftGuardActivity>,
): string | null => {
  let active: string | null = null;
  for (const activity of activities) {
    if (activity.kind === "wayfinder.draft.started") {
      const payload =
        typeof activity.payload === "object" && activity.payload !== null
          ? (activity.payload as { readonly skillRunId?: unknown })
          : null;
      active = typeof payload?.skillRunId === "string" ? payload.skillRunId : null;
    }
    if (activity.kind === "wayfinder.draft.published") active = null;
  }
  return active;
};
