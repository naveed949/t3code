import type { ProviderDriverKind, SkillInvocation } from "@t3tools/contracts";

export const VERIFIED_WAYFINDER_CONTENT_DIGEST =
  "sha256:257e40665b28ae959ffdcb97d7a72b074360f4a3d201bd84786505308546e434";

const nativeProviders: ReadonlySet<string> = new Set(["codex", "claudeAgent"]);

export function supportsNativeWayfinderProvider(provider: ProviderDriverKind): boolean {
  return nativeProviders.has(provider);
}

const NEW_MAP_NATIVE_CONTRACT = [
  "T3 native unpublished-draft contract:",
  "- Keep the map non-canonical and ask exactly one decision at a time through structured user input.",
  '- Mark the recommended choice with "(Recommended)" and put its reasoning in the choice description.',
  "- Keep agent proposals tentative until the user answers; always allow a free-form answer.",
  '- Use structured question ids to update the map: "destination", "note:<id>", "ticket:<id>", "fog:<id>", "out-of-scope:<id>", or "dependency:<from>-><to>".',
  "- Do not create or mutate any GitHub issue, label, assignment, comment, or relationship.",
].join("\n");

export function renderNativeWayfinderArguments(input: {
  readonly skill: Pick<SkillInvocation["skill"], "name">;
  readonly action?: SkillInvocation["action"] | undefined;
  readonly arguments?: SkillInvocation["arguments"] | undefined;
}): string | undefined {
  if (input.skill.name !== "wayfinder" || input.action?.id !== "new-map") {
    return input.arguments;
  }
  return [input.arguments ?? "new-map", NEW_MAP_NATIVE_CONTRACT].join("\n\n");
}
