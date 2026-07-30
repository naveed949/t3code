import type { ProviderDriverKind } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import * as IssueTracker from "./IssueTracker.ts";
import { preflightWayfinderLaunch, type WayfinderPreflightResult } from "./WayfinderPreflight.ts";

export class NativeWayfinderPreflightService extends Context.Service<
  NativeWayfinderPreflightService,
  {
    readonly check: (input: {
      readonly workspaceRoot: string;
      readonly provider: ProviderDriverKind;
      readonly skillDigest: string;
      readonly repositoryInstructionsLoaded: boolean;
    }) => Effect.Effect<WayfinderPreflightResult>;
  }
>()("t3/nativeSkills/NativeWayfinderPreflightService") {}

export const make = Effect.fn("NativeWayfinderPreflightService.make")(function* () {
  const issueTracker = yield* IssueTracker.IssueTracker;

  const check = Effect.fn("NativeWayfinderPreflightService.check")(function* (input: {
    readonly workspaceRoot: string;
    readonly provider: ProviderDriverKind;
    readonly skillDigest: string;
    readonly repositoryInstructionsLoaded: boolean;
  }) {
    const repository = yield* issueTracker.resolveProjectRepository(input.workspaceRoot);
    const tracker = repository
      ? yield* issueTracker.inspectCapabilities({ cwd: input.workspaceRoot, repository })
      : {
          supportsIssues: false,
          canWriteIssues: false,
          supportsChildRelationships: false,
          supportsBlockingRelationships: false,
          labels: [],
        };
    const githubCli = yield* issueTracker.inspectGitHubCli(input.workspaceRoot);
    return preflightWayfinderLaunch({
      skillDigest: input.skillDigest,
      provider: input.provider,
      repository: repository ? { canonicalKey: repository.canonicalKey, provider: "github" } : null,
      githubCli,
      tracker,
      repositoryInstructions: {
        applicable: input.repositoryInstructionsLoaded,
        loaded: input.repositoryInstructionsLoaded,
      },
    });
  });

  return NativeWayfinderPreflightService.of({ check });
});
