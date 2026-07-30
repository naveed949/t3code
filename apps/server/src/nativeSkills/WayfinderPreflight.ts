import type { ProviderDriverKind } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

export const VERIFIED_WAYFINDER_CONTENT_DIGEST =
  "sha256:257e40665b28ae959ffdcb97d7a72b074360f4a3d201bd84786505308546e434";

const REQUIRED_WAYFINDER_LABELS = ["wayfinder:map", "wayfinder:decision"] as const;
const NATIVE_WAYFINDER_PROVIDERS = new Set(["codex", "claudeAgent"]);

export type WayfinderLaunchIntent =
  | { readonly kind: "new-map" }
  | { readonly kind: "continue-map"; readonly reference?: string };

export type ResolvedWayfinderLaunch =
  | { readonly kind: "new-map" }
  | { readonly kind: "continue-map"; readonly issueNumber: number }
  | { readonly kind: "chooser"; readonly reason: "continuation-reference-required" };

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

/**
 * Provider-neutral read model for issue trackers. It deliberately has no
 * change-request methods: Wayfinder maps are made of Issues and their native
 * relationships, not pull requests.
 */
export interface WayfinderIssueTracker {
  readonly resolveProjectRepository: (
    cwd: string,
  ) => Effect.Effect<WayfinderPreflightSnapshot["repository"], never>;
  readonly inspectPreflight: (
    repository: NonNullable<WayfinderPreflightSnapshot["repository"]>,
  ) => Effect.Effect<WayfinderPreflightSnapshot["tracker"], never>;
}

export type WayfinderPreflightCheck =
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
  | { readonly kind: "ready" }
  | { readonly kind: "blocked"; readonly blockers: ReadonlyArray<WayfinderPreflightBlocker> };

function resolveIssueNumber(reference: string | undefined): number | null {
  const trimmed = reference?.trim() ?? "";
  const directMatch = /^#?(\d+)$/u.exec(trimmed);
  if (directMatch?.[1]) return Number(directMatch[1]);

  try {
    const url = new URL(trimmed);
    const issueMatch = /^\/[^/]+\/[^/]+\/issues\/(\d+)\/?$/u.exec(url.pathname);
    return url.hostname === "github.com" && issueMatch?.[1] ? Number(issueMatch[1]) : null;
  } catch {
    return null;
  }
}

export function resolveWayfinderLaunch(intent: WayfinderLaunchIntent): ResolvedWayfinderLaunch {
  if (intent.kind === "new-map") return { kind: "new-map" };
  const issueNumber = resolveIssueNumber(intent.reference);
  return issueNumber === null
    ? { kind: "chooser", reason: "continuation-reference-required" }
    : { kind: "continue-map", issueNumber };
}

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
  if (!NATIVE_WAYFINDER_PROVIDERS.has(snapshot.provider)) {
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

/**
 * Server-side preflight boundary. The injected tracker intentionally exposes
 * only read operations, making it impossible for a failed preflight to create
 * canonical GitHub state through this seam.
 */
export const runWayfinderPreflight = Effect.fn("runWayfinderPreflight")(function* (input: {
  readonly cwd: string;
  readonly skillDigest: string;
  readonly provider: ProviderDriverKind;
  readonly githubCli: WayfinderPreflightSnapshot["githubCli"];
  readonly repositoryInstructions: WayfinderPreflightSnapshot["repositoryInstructions"];
  readonly issueTracker: WayfinderIssueTracker;
}) {
  const repository = yield* input.issueTracker.resolveProjectRepository(input.cwd);
  const tracker = repository
    ? yield* input.issueTracker.inspectPreflight(repository)
    : {
        supportsIssues: false,
        canWriteIssues: false,
        supportsChildRelationships: false,
        supportsBlockingRelationships: false,
        labels: [],
      };
  return preflightWayfinderLaunch({
    skillDigest: input.skillDigest,
    provider: input.provider,
    repository,
    githubCli: input.githubCli,
    tracker,
    repositoryInstructions: input.repositoryInstructions,
  });
});

export function createGenericWayfinderFallback() {
  return {
    execution: "generic" as const,
    message: "Continue with generic Wayfinder execution",
  };
}
