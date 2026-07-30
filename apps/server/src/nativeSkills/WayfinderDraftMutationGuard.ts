import { SkillRunId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export interface DraftGuardActivity {
  readonly kind: string;
  readonly payload: unknown;
}

const DraftActivityPayload = Schema.Struct({ skillRunId: SkillRunId });
const decodeDraftActivityPayload = Schema.decodeUnknownOption(DraftActivityPayload);

interface DraftAuthorityState {
  readonly active: boolean;
  readonly skillRunId: string | null;
  readonly approvalSkillRunId: string | null;
}

const projectDraftAuthority = (
  activities: ReadonlyArray<DraftGuardActivity>,
): DraftAuthorityState => {
  let skillRunId: string | null = null;
  let approvalSkillRunId: string | null = null;
  let active = false;
  for (const activity of activities) {
    const payload = decodeDraftActivityPayload(activity.payload);
    if (activity.kind === "wayfinder.draft.started") {
      active = true;
      skillRunId = Option.isSome(payload) ? payload.value.skillRunId : null;
      approvalSkillRunId = null;
    }
    if (activity.kind === "wayfinder.publication.approval-requested") {
      approvalSkillRunId = Option.isSome(payload) ? payload.value.skillRunId : null;
    }
    if (activity.kind === "wayfinder.draft.published") {
      active = false;
      skillRunId = null;
      approvalSkillRunId = null;
    }
  }
  return { active, skillRunId, approvalSkillRunId };
};

export const hasActiveWayfinderDraftAuthority = (
  activities: ReadonlyArray<DraftGuardActivity>,
): boolean => projectDraftAuthority(activities).active;

export const activeWayfinderDraftSkillRunId = (
  activities: ReadonlyArray<DraftGuardActivity>,
): string | null => projectDraftAuthority(activities).skillRunId;

export const approvedWayfinderPublicationSkillRunId = (
  activities: ReadonlyArray<DraftGuardActivity>,
): string | null => projectDraftAuthority(activities).approvalSkillRunId;
