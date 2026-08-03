import type { ProviderDriverKind, SkillInvocationAction } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as GitHubPreflightInspector from "./GitHubPreflightInspector.ts";
import * as IssueTracker from "./IssueTracker.ts";
import { preflightWayfinderLaunch, type WayfinderPreflightResult } from "./WayfinderPreflight.ts";

export class NativeWayfinderPreflightService extends Context.Service<
  NativeWayfinderPreflightService,
  {
    readonly check: (input: {
      readonly workspaceRoot: string;
      readonly provider: ProviderDriverKind;
      readonly skillDigest: string;
      readonly action?: SkillInvocationAction;
    }) => Effect.Effect<WayfinderPreflightResult>;
  }
>()("t3/nativeSkills/NativeWayfinderPreflightService") {}

export const make = Effect.fn("NativeWayfinderPreflightService.make")(function* () {
  const githubPreflight = yield* GitHubPreflightInspector.GitHubPreflightInspector;
  const issueTracker = yield* IssueTracker.IssueTracker;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const inspectRepositoryInstructions = Effect.fn(
    "NativeWayfinderPreflightService.inspectRepositoryInstructions",
  )(function* (workspaceRoot: string) {
    const candidates = ["AGENTS.md", "CLAUDE.md"].map((name) => path.join(workspaceRoot, name));
    let applicable = false;
    let loaded = true;
    for (const candidate of candidates) {
      const exists = yield* fileSystem.exists(candidate).pipe(Effect.option);
      if (exists._tag === "None") {
        applicable = true;
        loaded = false;
      } else if (exists.value) {
        applicable = true;
        const contents = yield* fileSystem.readFileString(candidate).pipe(Effect.option);
        if (contents._tag === "None") loaded = false;
      }
    }
    return { applicable, loaded };
  });

  const check = Effect.fn("NativeWayfinderPreflightService.check")(function* (input: {
    readonly workspaceRoot: string;
    readonly provider: ProviderDriverKind;
    readonly skillDigest: string;
    readonly action?: SkillInvocationAction;
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
    const githubCli = yield* githubPreflight.inspectCli(input.workspaceRoot);
    const repositoryInstructions = yield* inspectRepositoryInstructions(input.workspaceRoot);
    const environmentResult = preflightWayfinderLaunch({
      skillDigest: input.skillDigest,
      provider: input.provider,
      repository: repository ? { canonicalKey: repository.canonicalKey, provider: "github" } : null,
      githubCli,
      tracker,
      repositoryInstructions,
    });
    const blockers = environmentResult.kind === "blocked" ? [...environmentResult.blockers] : [];
    if (input.action?.id !== "new-map" && input.action?.id !== "continue-map") {
      blockers.unshift({
        check: "launch-selection",
        remediation: "Choose whether to start a new map or continue an existing issue.",
      });
    }
    let wayfinderMap;
    if (input.action?.id === "continue-map") {
      const issue = repository
        ? yield* issueTracker.resolveIssue({
            cwd: input.workspaceRoot,
            repository,
            reference: input.action.reference,
          })
        : null;
      if (issue === null) {
        blockers.unshift({
          check: "continuation-issue",
          remediation: "Choose one issue number or GitHub issue URL from this project.",
        });
      } else if (repository) {
        const synchronizedAt = DateTime.formatIso(yield* DateTime.now);
        const mapResult = yield* issueTracker.loadWayfinderMap({
          cwd: input.workspaceRoot,
          repository,
          issueNumber: issue.number,
          synchronizedAt,
        });
        if (mapResult.kind === "loaded") {
          wayfinderMap = mapResult.map;
        } else if (mapResult.kind === "truncated") {
          blockers.unshift({
            check: "continuation-issue",
            remediation:
              "This read-only slice supports up to 100 child tickets, labels, assignees, or dependencies per connection; split the map before continuing it.",
          });
        } else if (mapResult.kind === "over-budget") {
          blockers.unshift({
            check: "continuation-issue",
            remediation:
              "This map exceeds the 256 KiB shared projection budget; reduce oversized map sections or dependency density before continuing it.",
          });
        } else {
          blockers.unshift({
            check: "continuation-issue",
            remediation: "Refresh the GitHub map after its native relationships are available.",
          });
        }
      }
    }
    return blockers.length === 0
      ? { kind: "ready" as const, ...(wayfinderMap ? { wayfinderMap } : {}) }
      : { kind: "blocked" as const, blockers };
  });

  return NativeWayfinderPreflightService.of({ check });
});

export const layer = Layer.effect(NativeWayfinderPreflightService, make());
