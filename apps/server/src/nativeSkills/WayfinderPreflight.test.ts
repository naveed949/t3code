import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind } from "@t3tools/contracts";

import {
  VERIFIED_WAYFINDER_CONTENT_DIGEST,
  preflightWayfinderLaunch,
  type WayfinderPreflightSnapshot,
} from "./WayfinderPreflight.ts";

const readySnapshot = (): WayfinderPreflightSnapshot => ({
  skillDigest: VERIFIED_WAYFINDER_CONTENT_DIGEST,
  provider: ProviderDriverKind.make("codex"),
  repository: { canonicalKey: "github.com/t3tools/t3code", provider: "github" },
  githubCli: { available: true, authenticated: true },
  tracker: {
    supportsIssues: true,
    canWriteIssues: true,
    supportsChildRelationships: true,
    supportsBlockingRelationships: true,
    labels: ["wayfinder:map", "wayfinder:decision"],
  },
  repositoryInstructions: { applicable: true, loaded: true },
});

describe("preflightWayfinderLaunch", () => {
  it.each([
    [
      "skill digest",
      (snapshot: WayfinderPreflightSnapshot) => ({ ...snapshot, skillDigest: "sha256:modified" }),
      "compatible-skill-digest",
    ],
    [
      "provider",
      (snapshot: WayfinderPreflightSnapshot) => ({
        ...snapshot,
        provider: ProviderDriverKind.make("cursor"),
      }),
      "supported-provider",
    ],
    [
      "repository",
      (snapshot: WayfinderPreflightSnapshot) => ({ ...snapshot, repository: null }),
      "github-repository",
    ],
    [
      "GitHub CLI",
      (snapshot: WayfinderPreflightSnapshot) => ({
        ...snapshot,
        githubCli: { available: false, authenticated: false },
      }),
      "github-cli",
    ],
    [
      "GitHub authentication",
      (snapshot: WayfinderPreflightSnapshot) => ({
        ...snapshot,
        githubCli: { available: true, authenticated: false },
      }),
      "github-authentication",
    ],
    [
      "issue capability",
      (snapshot: WayfinderPreflightSnapshot) => ({
        ...snapshot,
        tracker: { ...snapshot.tracker, supportsIssues: false },
      }),
      "issue-capability",
    ],
    [
      "write permission",
      (snapshot: WayfinderPreflightSnapshot) => ({
        ...snapshot,
        tracker: { ...snapshot.tracker, canWriteIssues: false },
      }),
      "issue-write-permission",
    ],
    [
      "required labels",
      (snapshot: WayfinderPreflightSnapshot) => ({
        ...snapshot,
        tracker: { ...snapshot.tracker, labels: [] },
      }),
      "required-labels",
    ],
    [
      "child relationships",
      (snapshot: WayfinderPreflightSnapshot) => ({
        ...snapshot,
        tracker: { ...snapshot.tracker, supportsChildRelationships: false },
      }),
      "native-child-relationships",
    ],
    [
      "blocking relationships",
      (snapshot: WayfinderPreflightSnapshot) => ({
        ...snapshot,
        tracker: { ...snapshot.tracker, supportsBlockingRelationships: false },
      }),
      "native-blocking-relationships",
    ],
    [
      "repository instructions",
      (snapshot: WayfinderPreflightSnapshot) => ({
        ...snapshot,
        repositoryInstructions: { applicable: true, loaded: false },
      }),
      "repository-instructions",
    ],
  ])("reports an actionable blocker for missing %s", (_name, change, check) => {
    const result = preflightWayfinderLaunch(change(readySnapshot()));

    expect(result).toMatchObject({ kind: "blocked" });
    if (result.kind !== "blocked") return;
    expect(result.blockers).toContainEqual(
      expect.objectContaining({ check, remediation: expect.any(String) }),
    );
  });

  it.each(["codex", "claudeAgent"] as const)(
    "passes a fully capable %s environment",
    (provider) => {
      const result = preflightWayfinderLaunch({
        ...readySnapshot(),
        provider: ProviderDriverKind.make(provider),
      });

      expect(result).toEqual({ kind: "ready" });
    },
  );
});
