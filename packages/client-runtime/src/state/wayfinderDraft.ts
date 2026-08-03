import type { SkillInvocation } from "@t3tools/contracts";
import { isNativeWayfinderDraftInvocation } from "@t3tools/shared/wayfinderDraft";

export { deriveWayfinderDraft } from "@t3tools/shared/wayfinderDraft";

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
