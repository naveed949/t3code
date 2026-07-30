import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as IssueTracker from "./IssueTracker.ts";

const output = (stdout: string) => ({
  exitCode: ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

const repository = {
  canonicalKey: "github.com/t3tools/t3code",
  locator: {
    source: "git-remote" as const,
    remoteName: "origin",
    remoteUrl: "git@github.com:t3tools/t3code.git",
  },
  provider: "github" as const,
  owner: "t3tools",
  name: "t3code",
};

function layer(input: { readonly execute: GitHubCli.GitHubCli["Service"]["execute"] }) {
  return IssueTracker.GitHubIssueTrackerLive.pipe(
    Layer.provideMerge(Layer.mock(GitHubCli.GitHubCli)({ execute: input.execute })),
    Layer.provideMerge(
      Layer.mock(RepositoryIdentityResolver.RepositoryIdentityResolver)({
        resolve: () => Effect.succeed(repository),
      }),
    ),
  );
}

it.effect("resolves a GitHub project and reads its native issue capabilities", () =>
  Effect.gen(function* () {
    const tracker = yield* IssueTracker.IssueTracker;
    const project = yield* tracker.resolveProjectRepository("/project");
    assert.deepStrictEqual(project, {
      owner: "t3tools",
      name: "t3code",
      canonicalKey: repository.canonicalKey,
    });

    const capabilities = yield* tracker.inspectCapabilities({
      cwd: "/project",
      repository: project!,
    });
    assert.deepStrictEqual(capabilities, {
      supportsIssues: true,
      canWriteIssues: true,
      supportsChildRelationships: true,
      supportsBlockingRelationships: true,
      labels: ["wayfinder:map", "wayfinder:decision"],
    });
  }).pipe(
    Effect.provide(
      layer({
        execute: ({ args }) =>
          args[0] === "repo"
            ? Effect.succeed(
                output(
                  JSON.stringify({
                    hasIssuesEnabled: true,
                    viewerPermission: "WRITE",
                  }),
                ),
              )
            : args[0] === "label"
              ? Effect.succeed(
                  output(
                    JSON.stringify([{ name: "wayfinder:map" }, { name: "wayfinder:decision" }]),
                  ),
                )
              : Effect.succeed(
                  output(
                    JSON.stringify({
                      data: {
                        __type: {
                          fields: [
                            { name: "addSubIssue" },
                            { name: "removeSubIssue" },
                            { name: "addBlockedBy" },
                            { name: "removeBlockedBy" },
                          ],
                        },
                      },
                    }),
                  ),
                ),
      }),
    ),
  ),
);

it.effect("requires a parsed authenticated GitHub CLI account", () =>
  Effect.gen(function* () {
    const tracker = yield* IssueTracker.IssueTracker;
    assert.deepStrictEqual(yield* tracker.inspectGitHubCli("/project"), {
      available: true,
      authenticated: false,
    });
  }).pipe(
    Effect.provide(
      layer({
        execute: ({ args }) =>
          Effect.succeed(
            output(
              args[0] === "--version"
                ? "gh version 2"
                : JSON.stringify({
                    hosts: {
                      "github.com": [
                        {
                          state: "failed",
                          active: true,
                          host: "github.com",
                          login: "octocat",
                        },
                      ],
                    },
                  }),
            ),
          ),
      }),
    ),
  ),
);

it.effect("resolves only an unambiguous GitHub issue number or URL", () =>
  Effect.gen(function* () {
    const tracker = yield* IssueTracker.IssueTracker;
    const project = yield* tracker.resolveProjectRepository("/project");
    const issue = yield* tracker.resolveIssue({
      cwd: "/project",
      repository: project!,
      reference: "https://github.com/t3tools/t3code/issues/42",
    });
    assert.deepStrictEqual(issue, {
      number: 42,
      url: "https://github.com/t3tools/t3code/issues/42",
    });
  }).pipe(
    Effect.provide(
      layer({
        execute: () =>
          Effect.succeed(
            output(
              JSON.stringify({ number: 42, url: "https://github.com/t3tools/t3code/issues/42" }),
            ),
          ),
      }),
    ),
  ),
);

it.effect("rejects malformed and cross-repository issue references without invoking gh", () => {
  let executions = 0;
  return Effect.gen(function* () {
    const tracker = yield* IssueTracker.IssueTracker;
    const project = yield* tracker.resolveProjectRepository("/project");
    for (const reference of [
      "42 and 43",
      "https://github.com/other/repository/issues/42",
      "https://example.com/t3tools/t3code/issues/42",
    ]) {
      assert.isNull(
        yield* tracker.resolveIssue({ cwd: "/project", repository: project!, reference }),
      );
    }
    assert.strictEqual(executions, 0);
  }).pipe(
    Effect.provide(
      layer({
        execute: () => {
          executions += 1;
          return Effect.succeed(output(""));
        },
      }),
    ),
  );
});
