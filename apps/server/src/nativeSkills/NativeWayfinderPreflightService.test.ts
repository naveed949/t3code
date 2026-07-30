import { assert, it } from "@effect/vitest";
import { ProviderDriverKind } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as IssueTracker from "./IssueTracker.ts";
import * as NativeWayfinderPreflightService from "./NativeWayfinderPreflightService.ts";
import { VERIFIED_WAYFINDER_CONTENT_DIGEST } from "./WayfinderPreflight.ts";

const tracker = Layer.mock(IssueTracker.IssueTracker)({
  inspectGitHubCli: () => Effect.succeed({ available: true, authenticated: true }),
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
});

it.effect("returns a ready native preflight from server-owned tracker observations", () =>
  Effect.gen(function* () {
    const preflight = yield* NativeWayfinderPreflightService.make();
    const result = yield* preflight.check({
      workspaceRoot: "/project",
      provider: ProviderDriverKind.make("codex"),
      skillDigest: VERIFIED_WAYFINDER_CONTENT_DIGEST,
      repositoryInstructionsLoaded: true,
    });
    assert.deepStrictEqual(result, { kind: "ready" });
  }).pipe(Effect.provide(tracker)),
);
