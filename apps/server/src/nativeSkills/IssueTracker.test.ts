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

it.effect("loads an existing Wayfinder map with native children and dependencies", () =>
  Effect.gen(function* () {
    const tracker = yield* IssueTracker.IssueTracker;
    const project = yield* tracker.resolveProjectRepository("/project");
    const result = yield* tracker.loadWayfinderMap({
      cwd: "/project",
      repository: project!,
      issueNumber: 42,
      synchronizedAt: "2026-07-30T10:00:00.000Z",
    });

    assert.strictEqual(result.kind, "loaded");
    if (result.kind !== "loaded") return;
    assert.deepStrictEqual(result.map, {
      canonicalReference: {
        number: 42,
        title: "Choose the release shape",
        url: "https://github.com/t3tools/t3code/issues/42",
        state: "open",
      },
      destination: "A release plan that is ready for specification.",
      notes: "Use the research skill for external API facts.",
      decisionsSoFar: [
        {
          title: "Choose a package format",
          url: "https://github.com/t3tools/t3code/issues/40",
          summary: "Use a deterministic archive.",
        },
        {
          title: "Keep the first slice read-only.",
          url: null,
          summary: "",
        },
      ],
      fogOfWar: ["Deployment ownership is not yet clear."],
      outOfScope: ["Building the release is handled after specification."],
      tickets: [
        {
          number: 43,
          title: "Research hosting limits",
          url: "https://github.com/t3tools/t3code/issues/43",
          state: "open",
          classification: "research",
          claimedBy: null,
          blockedBy: [],
          blocks: [44],
        },
        {
          number: 44,
          title: "Choose the deployment target",
          url: "https://github.com/t3tools/t3code/issues/44",
          state: "open",
          classification: "grilling",
          claimedBy: null,
          blockedBy: [43],
          blocks: [],
        },
        {
          number: 45,
          title: "Record the package decision",
          url: "https://github.com/t3tools/t3code/issues/45",
          state: "closed",
          classification: "task",
          claimedBy: "maintainer",
          blockedBy: [],
          blocks: [],
        },
      ],
      frontier: [43],
      lastSynchronizedAt: "2026-07-30T10:00:00.000Z",
    });
  }).pipe(
    Effect.provide(
      layer({
        execute: ({ args }) =>
          args[0] === "api"
            ? Effect.succeed(
                output(
                  JSON.stringify({
                    data: {
                      repository: {
                        issue: {
                          number: 42,
                          title: "Choose the release shape",
                          url: "https://github.com/t3tools/t3code/issues/42",
                          state: "OPEN",
                          labels: {
                            nodes: [{ name: "wayfinder:map" }],
                            pageInfo: { hasNextPage: false },
                          },
                          body: [
                            "## Destination",
                            "",
                            "A release plan that is ready for specification.",
                            "",
                            "## Notes",
                            "",
                            "Use the research skill for external API facts.",
                            "",
                            "## Decisions so far",
                            "",
                            "- [Choose a package format](https://github.com/t3tools/t3code/issues/40) — Use a deterministic archive.",
                            "- Keep the first slice read-only.",
                            "",
                            "## Not yet specified",
                            "",
                            "- Deployment ownership is not yet clear.",
                            "",
                            "## Out of scope",
                            "",
                            "- Building the release is handled after specification.",
                          ].join("\n"),
                          subIssues: {
                            nodes: [
                              {
                                number: 43,
                                title: "Research hosting limits",
                                url: "https://github.com/t3tools/t3code/issues/43",
                                state: "OPEN",
                                assignees: {
                                  nodes: [],
                                  pageInfo: { hasNextPage: false },
                                },
                                labels: {
                                  nodes: [{ name: "wayfinder:research" }],
                                  pageInfo: { hasNextPage: false },
                                },
                                blockedBy: {
                                  nodes: [],
                                  pageInfo: { hasNextPage: false },
                                },
                                blocking: {
                                  nodes: [{ number: 44 }],
                                  pageInfo: { hasNextPage: false },
                                },
                              },
                              {
                                number: 44,
                                title: "Choose the deployment target",
                                url: "https://github.com/t3tools/t3code/issues/44",
                                state: "OPEN",
                                assignees: {
                                  nodes: [],
                                  pageInfo: { hasNextPage: false },
                                },
                                labels: {
                                  nodes: [{ name: "wayfinder:grilling" }],
                                  pageInfo: { hasNextPage: false },
                                },
                                blockedBy: {
                                  nodes: [{ number: 43, state: "OPEN" }],
                                  pageInfo: { hasNextPage: false },
                                },
                                blocking: {
                                  nodes: [],
                                  pageInfo: { hasNextPage: false },
                                },
                              },
                              {
                                number: 45,
                                title: "Record the package decision",
                                url: "https://github.com/t3tools/t3code/issues/45",
                                state: "CLOSED",
                                assignees: {
                                  nodes: [{ login: "maintainer" }],
                                  pageInfo: { hasNextPage: false },
                                },
                                labels: {
                                  nodes: [{ name: "wayfinder:task" }],
                                  pageInfo: { hasNextPage: false },
                                },
                                blockedBy: {
                                  nodes: [],
                                  pageInfo: { hasNextPage: false },
                                },
                                blocking: {
                                  nodes: [],
                                  pageInfo: { hasNextPage: false },
                                },
                              },
                            ],
                            pageInfo: { hasNextPage: false },
                          },
                        },
                      },
                    },
                  }),
                ),
              )
            : Effect.succeed(output("")),
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

it.effect("rejects a truncated native relationship projection", () =>
  Effect.gen(function* () {
    const tracker = yield* IssueTracker.IssueTracker;
    const result = yield* tracker.loadWayfinderMap({
      cwd: "/project",
      repository: {
        canonicalKey: "github.com/t3tools/t3code",
        owner: "t3tools",
        name: "t3code",
      },
      issueNumber: 42,
      synchronizedAt: "2026-07-30T10:00:00.000Z",
    });
    assert.strictEqual(result.kind, "truncated");
  }).pipe(
    Effect.provide(
      layer({
        execute: () =>
          Effect.succeed(
            output(
              JSON.stringify({
                data: {
                  repository: {
                    issue: {
                      number: 42,
                      title: "Large map",
                      url: "https://github.com/t3tools/t3code/issues/42",
                      state: "OPEN",
                      body: "",
                      labels: {
                        nodes: [{ name: "wayfinder:map" }],
                        pageInfo: { hasNextPage: false },
                      },
                      subIssues: {
                        nodes: [],
                        pageInfo: { hasNextPage: true },
                      },
                    },
                  },
                },
              }),
            ),
          ),
      }),
    ),
  ),
);
