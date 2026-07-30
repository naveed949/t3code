import type { ServerProviderSkill, SkillInvocationRequest } from "@t3tools/contracts";
import {
  createSkillInvocationRequest,
  resolveLeadingSkillInvocationRequest,
} from "@t3tools/shared/composerInlineTokens";

type SelectableSkill = Pick<ServerProviderSkill, "name" | "path" | "enabled">;

export type NativeSkillRunInvocationIntent =
  | {
      readonly kind: "leading-token";
      readonly text: string;
      readonly skills: ReadonlyArray<SelectableSkill>;
    }
  | {
      readonly kind: "picker-selection" | "native-action";
      readonly skill: SelectableSkill;
      readonly arguments?: string;
    };

/**
 * Canonical client seam for every explicit way into a native Skill Run.
 * Callers send the resulting request with `thread.turn.start`; the server owns
 * validation, digest pinning, and durable Workstream / Skill Run identities.
 */
export function resolveNativeSkillRunInvocation(
  intent: NativeSkillRunInvocationIntent,
): SkillInvocationRequest | null {
  if (intent.kind === "leading-token") {
    return resolveLeadingSkillInvocationRequest(intent.text, intent.skills);
  }
  if (!intent.skill.enabled) {
    return null;
  }
  return createSkillInvocationRequest(intent.skill, intent.arguments);
}
