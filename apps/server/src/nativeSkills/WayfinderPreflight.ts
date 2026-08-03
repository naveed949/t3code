import type { ProviderDriverKind, WayfinderMapProjection } from "@t3tools/contracts";

import {
  VERIFIED_WAYFINDER_CONTENT_DIGEST,
  supportsNativeWayfinderProvider,
} from "./WayfinderCompatibility.ts";

export { VERIFIED_WAYFINDER_CONTENT_DIGEST } from "./WayfinderCompatibility.ts";

const REQUIRED_WAYFINDER_LABELS = ["wayfinder:map", "wayfinder:decision"] as const;

export interface WayfinderPreflightSnapshot {
  readonly skillDigest: string;
  readonly provider: ProviderDriverKind;
  readonly repository: { readonly canonicalKey: string; readonly provider: "github" } | null;
  readonly githubCli: { readonly available: boolean; readonly authenticated: boolean };
  readonly tracker: {
    readonly supportsIssues: boolean;
    readonly canWriteIssues: boolean;
    readonly supportsChildRelationships: boolean;
    readonly supportsBlockingRelationships: boolean;
    readonly labels: ReadonlyArray<string>;
  };
  readonly repositoryInstructions: { readonly applicable: boolean; readonly loaded: boolean };
}

export type WayfinderPreflightCheck =
  | "launch-selection"
  | "continuation-issue"
  | "compatible-skill-digest"
  | "supported-provider"
  | "github-repository"
  | "github-cli"
  | "github-authentication"
  | "issue-capability"
  | "issue-write-permission"
  | "required-labels"
  | "native-child-relationships"
  | "native-blocking-relationships"
  | "repository-instructions";

export interface WayfinderPreflightBlocker {
  readonly check: WayfinderPreflightCheck;
  readonly remediation: string;
}

export type WayfinderPreflightResult =
  | { readonly kind: "ready"; readonly wayfinderMap?: WayfinderMapProjection }
  | { readonly kind: "blocked"; readonly blockers: ReadonlyArray<WayfinderPreflightBlocker> };

/**
 * Evaluates only read-only environment observations. Canonical tracker writes
 * begin after this returns `ready`, so every failure can safely be surfaced as
 * a remediation instead of a partially-created map.
 */
export function preflightWayfinderLaunch(
  snapshot: WayfinderPreflightSnapshot,
): WayfinderPreflightResult {
  const blockers: WayfinderPreflightBlocker[] = [];
  if (snapshot.skillDigest !== VERIFIED_WAYFINDER_CONTENT_DIGEST) {
    blockers.push({
      check: "compatible-skill-digest",
      remediation:
        "Install the verified Wayfinder skill version or continue with generic execution.",
    });
  }
  if (!supportsNativeWayfinderProvider(snapshot.provider)) {
    blockers.push({
      check: "supported-provider",
      remediation: "Choose a Codex or Claude provider, or continue with generic execution.",
    });
  }
  if (snapshot.repository?.provider !== "github") {
    blockers.push({
      check: "github-repository",
      remediation: "Open a project with a GitHub remote before starting a native map.",
    });
  }
  if (!snapshot.githubCli.available) {
    blockers.push({
      check: "github-cli",
      remediation: "Install the GitHub CLI (`gh`) on the T3 server and retry.",
    });
  } else if (!snapshot.githubCli.authenticated) {
    blockers.push({
      check: "github-authentication",
      remediation: "Run `gh auth login` on the T3 server and retry.",
    });
  }
  if (!snapshot.tracker.supportsIssues) {
    blockers.push({
      check: "issue-capability",
      remediation: "Use a GitHub repository where Issues are enabled.",
    });
  }
  if (!snapshot.tracker.canWriteIssues) {
    blockers.push({
      check: "issue-write-permission",
      remediation:
        "Authenticate the T3 server with an account that can write Issues in this repository.",
    });
  }
  const missingLabels = REQUIRED_WAYFINDER_LABELS.filter(
    (label) => !snapshot.tracker.labels.includes(label),
  );
  if (missingLabels.length > 0) {
    blockers.push({
      check: "required-labels",
      remediation: `Create the required labels: ${missingLabels.join(", ")}.`,
    });
  }
  if (!snapshot.tracker.supportsChildRelationships) {
    blockers.push({
      check: "native-child-relationships",
      remediation:
        "Enable GitHub native sub-issues for this repository before starting a native map.",
    });
  }
  if (!snapshot.tracker.supportsBlockingRelationships) {
    blockers.push({
      check: "native-blocking-relationships",
      remediation: "Use a GitHub repository with native issue blocking relationships enabled.",
    });
  }
  if (snapshot.repositoryInstructions.applicable && !snapshot.repositoryInstructions.loaded) {
    blockers.push({
      check: "repository-instructions",
      remediation: "Make the repository instructions readable on the T3 server and retry.",
    });
  }
  return blockers.length === 0 ? { kind: "ready" } : { kind: "blocked", blockers };
}
