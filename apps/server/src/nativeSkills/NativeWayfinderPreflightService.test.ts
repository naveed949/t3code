import * as NodePath from "@effect/platform-node/NodePath";
import { assert, it } from "@effect/vitest";
import { ProviderDriverKind } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";

import * as GitHubPreflightInspector from "./GitHubPreflightInspector.ts";
import * as IssueTracker from "./IssueTracker.ts";
import * as NativeWayfinderPreflightService from "./NativeWayfinderPreflightService.ts";
import { VERIFIED_WAYFINDER_CONTENT_DIGEST } from "./WayfinderPreflight.ts";

const tracker = Layer.mock(IssueTracker.IssueTracker)({
  resolveProjectRepository: () =>
    Effect.succeed({ canonicalKey: "github.com/t3tools/t3code", owner: "t3tools", name: "t3code" }),
  inspectCapabilities: () =>
    Effect.succeed({
      supportsIssues: true,
      canWriteIssues: true,
      supportsChildRelationships: true,
      supportsBlockingRelationships: true,
      labels: ["wayfinder:map", "wayfinder:decision"],
    }),
  resolveIssue: () => Effect.succeed(null),
  loadWayfinderMap: () => Effect.succeed({ kind: "not-wayfinder-map" as const }),
});

const testLayer = Layer.mergeAll(
  tracker,
  Layer.mock(GitHubPreflightInspector.GitHubPreflightInspector)({
    inspectCli: () => Effect.succeed({ available: true, authenticated: true }),
  }),
  FileSystem.layerNoop({ exists: () => Effect.succeed(false) }),
  NodePath.layer,
);

it.effect("returns a ready native preflight from server-owned tracker observations", () =>
  Effect.gen(function* () {
    const preflight = yield* NativeWayfinderPreflightService.make();
    const result = yield* preflight.check({
      workspaceRoot: "/project",
      provider: ProviderDriverKind.make("codex"),
      skillDigest: VERIFIED_WAYFINDER_CONTENT_DIGEST,
      action: { id: "new-map" },
    });
    assert.deepStrictEqual(result, { kind: "ready" });
  }).pipe(Effect.provide(testLayer)),
);

it.effect("requires an explicit launch choice and a resolvable continuation issue", () =>
  Effect.gen(function* () {
    const preflight = yield* NativeWayfinderPreflightService.make();
    const base = {
      workspaceRoot: "/project",
      provider: ProviderDriverKind.make("codex"),
      skillDigest: VERIFIED_WAYFINDER_CONTENT_DIGEST,
    };
    const missingChoice = yield* preflight.check(base);
    assert.strictEqual(missingChoice.kind, "blocked");
    if (missingChoice.kind === "blocked") {
      assert.strictEqual(missingChoice.blockers[0]?.check, "launch-selection");
    }
    const missingIssue = yield* preflight.check({
      ...base,
      action: { id: "continue-map", reference: "42" },
    });
    assert.strictEqual(missingIssue.kind, "blocked");
    if (missingIssue.kind === "blocked") {
      assert.strictEqual(missingIssue.blockers[0]?.check, "continuation-issue");
    }
  }).pipe(Effect.provide(testLayer)),
);
