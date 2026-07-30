import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import {
  findAuthenticatedGitHubAccount,
  parseGitHubAuthStatus,
} from "../sourceControl/gitHubAuthStatus.ts";

export class GitHubPreflightInspector extends Context.Service<
  GitHubPreflightInspector,
  {
    readonly inspectCli: (cwd: string) => Effect.Effect<{
      readonly available: boolean;
      readonly authenticated: boolean;
    }>;
  }
>()("t3/nativeSkills/GitHubPreflightInspector") {}

export const layer = Layer.effect(
  GitHubPreflightInspector,
  Effect.gen(function* () {
    const github = yield* GitHubCli.GitHubCli;
    return GitHubPreflightInspector.of({
      inspectCli: Effect.fn("GitHubPreflightInspector.inspectCli")(function* (cwd) {
        const available = yield* github.execute({ cwd, args: ["--version"] }).pipe(Effect.option);
        if (Option.isNone(available)) return { available: false, authenticated: false };
        const authentication = yield* github
          .execute({ cwd, args: ["auth", "status", "--json", "hosts"] })
          .pipe(Effect.option);
        const authenticated = Option.match(authentication, {
          onNone: () => false,
          onSome: (result) =>
            findAuthenticatedGitHubAccount(parseGitHubAuthStatus(result.stdout).accounts) !==
            undefined,
        });
        return { available: true, authenticated };
      }),
    });
  }),
);
