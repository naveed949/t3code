import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import {
  VERIFIED_WAYFINDER_CONTENT_DIGEST,
  createGenericWayfinderFallback,
  preflightWayfinderLaunch,
  resolveWayfinderLaunch,
  runWayfinderPreflight,
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

describe("resolveWayfinderLaunch", () => {
  it("distinguishes a new map from a resolved issue continuation", () => {
    expect(resolveWayfinderLaunch({ kind: "new-map" })).toEqual({ kind: "new-map" });
    expect(resolveWayfinderLaunch({ kind: "continue-map", reference: "#42" })).toEqual({
      kind: "continue-map",
      issueNumber: 42,
    });
    expect(
      resolveWayfinderLaunch({
        kind: "continue-map",
        reference: "https://github.com/t3tools/t3code/issues/42",
      }),
    ).toEqual({ kind: "continue-map", issueNumber: 42 });
  });

  it.each([undefined, "", "keep working", "42 and 43"])(
    "returns a chooser instead of guessing continuation reference %j",
    (reference) => {
      const intent =
        reference === undefined
          ? { kind: "continue-map" as const }
          : { kind: "continue-map" as const, reference };
      expect(resolveWayfinderLaunch(intent)).toEqual({
        kind: "chooser",
        reason: "continuation-reference-required",
      });
    },
  );
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
    "passes a fully capable %s environment without a canonical mutation",
    (provider) => {
      let canonicalMutations = 0;
      const result = preflightWayfinderLaunch({
        ...readySnapshot(),
        provider: ProviderDriverKind.make(provider),
      });

      expect(result).toEqual({ kind: "ready" });
      expect(canonicalMutations).toBe(0);
    },
  );

  it("keeps an explicit generic Wayfinder continuation available after a blocker", () => {
    expect(createGenericWayfinderFallback()).toEqual({
      execution: "generic",
      message: "Continue with generic Wayfinder execution",
    });
  });

  it("uses only the read-only issue-tracker seam before allowing a native run", () => {
    let repositoryReads = 0;
    let capabilityReads = 0;
    const snapshot = readySnapshot();

    const result = Effect.runSync(
      runWayfinderPreflight({
        cwd: "/project",
        skillDigest: snapshot.skillDigest,
        provider: snapshot.provider,
        githubCli: snapshot.githubCli,
        repositoryInstructions: snapshot.repositoryInstructions,
        issueTracker: {
          resolveProjectRepository: () => {
            repositoryReads += 1;
            return Effect.succeed(snapshot.repository);
          },
          inspectPreflight: () => {
            capabilityReads += 1;
            return Effect.succeed(snapshot.tracker);
          },
        },
      }),
    );

    expect(result).toEqual({ kind: "ready" });
    expect({ repositoryReads, capabilityReads }).toEqual({
      repositoryReads: 1,
      capabilityReads: 1,
    });
  });
});
