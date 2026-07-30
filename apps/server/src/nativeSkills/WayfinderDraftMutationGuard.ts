import { ApprovalRequestId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const ApprovalPayload = Schema.Struct({
  requestId: ApprovalRequestId,
  requestKind: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
});
const decodeApprovalPayload = Schema.decodeUnknownOption(ApprovalPayload);

const GITHUB_MUTATION_COMMANDS = [
  /\bgh\s+issue\s+(?:create|edit|close|reopen|delete|comment|pin|unpin|lock|unlock|transfer|develop)\b/iu,
  /\bgh\s+api\b(?=[^\n]*(?:(?:--method|-X)\s*(?:POST|PUT|PATCH|DELETE)|(?:-f|-F|--field|--raw-field|--input)\b))/iu,
  /\bcurl\b(?=[^\n]*api\.github\.com)(?=[^\n]*(?:(?:-X|--request)\s*(?:POST|PUT|PATCH|DELETE)|(?:-d|--data|--data-raw|--data-binary)\b))/iu,
  /\b(?:create|update|edit|close|reopen|delete|comment|label|assign|link)[_-](?:github[_-])?issue\b/iu,
] as const;

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

export const blockedGitHubMutationDetail = (
  activities: ReadonlyArray<DraftGuardActivity>,
  requestId: ApprovalRequestId,
): string | null => {
  if (!hasActiveWayfinderDraft(activities)) return null;
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (activity?.kind !== "approval.requested") continue;
    const payload = decodeApprovalPayload(activity.payload);
    if (
      Option.isSome(payload) &&
      payload.value.requestId === requestId &&
      payload.value.detail &&
      GITHUB_MUTATION_COMMANDS.some((pattern) => pattern.test(payload.value.detail ?? ""))
    ) {
      return payload.value.detail;
    }
  }
  return null;
};
