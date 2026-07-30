import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import * as GitHubPreflightInspector from "./GitHubPreflightInspector.ts";

const output = (stdout: string) => ({
  exitCode: ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

it.effect("requires a parsed authenticated GitHub CLI account", () =>
  Effect.gen(function* () {
    const inspector = yield* GitHubPreflightInspector.GitHubPreflightInspector;
    assert.deepStrictEqual(yield* inspector.inspectCli("/project"), {
      available: true,
      authenticated: false,
    });
  }).pipe(
    Effect.provide(
      GitHubPreflightInspector.layer.pipe(
        Layer.provide(
          Layer.mock(GitHubCli.GitHubCli)({
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
    ),
  ),
);
