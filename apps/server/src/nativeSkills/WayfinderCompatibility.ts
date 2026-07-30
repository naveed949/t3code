import type { ProviderDriverKind } from "@t3tools/contracts";

export const VERIFIED_WAYFINDER_CONTENT_DIGEST =
  "sha256:257e40665b28ae959ffdcb97d7a72b074360f4a3d201bd84786505308546e434";

const nativeProviders: ReadonlySet<string> = new Set(["codex", "claudeAgent"]);

export function supportsNativeWayfinderProvider(provider: ProviderDriverKind): boolean {
  return nativeProviders.has(provider);
}
