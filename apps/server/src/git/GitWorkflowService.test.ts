import { assert, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/unstable/process";

import { VcsRepositoryDetectionError } from "@t3tools/contracts";
import type { VcsRepositoryIdentity } from "@t3tools/contracts";

import * as GitManager from "./GitManager.ts";
import * as GitWorkflowService from "./GitWorkflowService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";

function makeLayer(input: {
  readonly detect: VcsDriverRegistry.VcsDriverRegistry["Service"]["detect"];
}) {
  return GitWorkflowService.layer.pipe(
    Layer.provide(
      Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
        detect: input.detect,
      }),
    ),
    Layer.provide(Layer.mock(GitVcsDriver.GitVcsDriver)({})),
    Layer.provide(Layer.mock(GitManager.GitManager)({})),
  );
}

function makeGitIntegrationLayer(input: {
  readonly execute: GitVcsDriver.GitVcsDriver["Service"]["execute"];
  readonly pushCurrentBranch?: GitVcsDriver.GitVcsDriver["Service"]["pushCurrentBranch"];
}) {
  const repository = {} as VcsRepositoryIdentity;
  const handle = {
    kind: "git" as const,
    repository,
    driver: {},
  } as unknown as VcsDriverRegistry.VcsDriverHandle;
  return GitWorkflowService.layer.pipe(
    Layer.provide(
      Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
        detect: () => Effect.succeed(handle),
        resolve: () => Effect.succeed(handle),
      }),
    ),
    Layer.provide(
      Layer.mock(GitVcsDriver.GitVcsDriver)({
        execute: input.execute,
        ...(input.pushCurrentBranch === undefined
          ? {}
          : { pushCurrentBranch: input.pushCurrentBranch }),
      }),
    ),
    Layer.provide(Layer.mock(GitManager.GitManager)({})),
  );
}

describe("GitWorkflowService", () => {
  it.effect("previews the exact baseline range and routes confirmed push authority", () => {
    const commands: string[][] = [];
    const execute: GitVcsDriver.GitVcsDriver["Service"]["execute"] = (input) =>
      Effect.sync(() => {
        commands.push([...input.args]);
        const stdout =
          input.args[0] === "symbolic-ref"
            ? "feature/development-workflow\n"
            : input.args[0] === "rev-parse"
              ? "baseline-publication-sha\n"
              : input.args[0] === "log"
                ? "ticket-44-sha\tPublish draft Workstream PR\n"
                : "";
        return {
          exitCode: ChildProcessSpawner.ExitCode(0),
          stdout,
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      });
    const pushCurrentBranch: GitVcsDriver.GitVcsDriver["Service"]["pushCurrentBranch"] = (
      cwd,
      fallbackBranch,
      options,
    ) =>
      Effect.succeed({
        status: "pushed" as const,
        branch: fallbackBranch ?? "feature/development-workflow",
        upstreamBranch: `${options?.remoteName ?? "origin"}/feature/development-workflow`,
      });

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const preview = yield* workflow.previewPublication({
        cwd: "/repo",
        baselineBranch: "feature/development-workflow",
        fixedPoint: "fixed-point-sha",
        remoteTarget: "origin/feature/development-workflow",
      });
      const pushed = yield* workflow.pushCurrentBranch({
        cwd: "/repo",
        branch: "feature/development-workflow",
        remoteName: "origin",
      });

      expect(preview).toEqual({
        baselineCommit: "baseline-publication-sha",
        commits: [{ sha: "ticket-44-sha", title: "Publish draft Workstream PR" }],
      });
      expect(pushed).toEqual({
        status: "pushed",
        branch: "feature/development-workflow",
        upstreamBranch: "origin/feature/development-workflow",
      });
      expect(commands).toEqual([
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        ["status", "--porcelain"],
        ["diff", "--check", "fixed-point-sha..feature/development-workflow"],
        ["rev-parse", "feature/development-workflow"],
        ["log", "--format=%H%x09%s", "fixed-point-sha..feature/development-workflow"],
      ]);
    }).pipe(
      Effect.provide(
        makeGitIntegrationLayer({
          execute,
          pushCurrentBranch,
        }),
      ),
    );
  });

  it.effect("blocks publication when Git truncates the complete commit receipt", () => {
    const execute: GitVcsDriver.GitVcsDriver["Service"]["execute"] = (input) =>
      Effect.succeed({
        exitCode: ChildProcessSpawner.ExitCode(0),
        stdout:
          input.args[0] === "symbolic-ref"
            ? "feature/development-workflow\n"
            : input.args[0] === "rev-parse"
              ? "baseline-publication-sha\n"
              : input.args[0] === "log"
                ? "ticket-44-sha\tPublish draft Workstream PR\n"
                : "",
        stderr: "",
        stdoutTruncated: input.args[0] === "log",
        stderrTruncated: false,
      });

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const error = yield* workflow
        .previewPublication({
          cwd: "/repo",
          baselineBranch: "feature/development-workflow",
          fixedPoint: "fixed-point-sha",
          remoteTarget: "origin/feature/development-workflow",
        })
        .pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "GitCommandError",
        detail: "The Workstream Baseline commit preview was truncated; publication was blocked.",
      });
    }).pipe(Effect.provide(makeGitIntegrationLayer({ execute })));
  });

  it.effect("merges a reviewed ticket branch into a clean Workstream Baseline", () => {
    const commands: string[][] = [];
    const execute: GitVcsDriver.GitVcsDriver["Service"]["execute"] = (input) =>
      Effect.sync(() => {
        commands.push([...input.args]);
        const stdout =
          input.args[0] === "symbolic-ref"
            ? "feature/development-workflow\n"
            : input.args[0] === "rev-parse"
              ? "merge-commit-sha\n"
              : "";
        return {
          exitCode: ChildProcessSpawner.ExitCode(0),
          stdout,
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      });

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const result = yield* workflow.integrateBranch({
        cwd: "/repo",
        targetBranch: "feature/development-workflow",
        sourceBranch: "codex/ticket-37",
      });

      expect(result).toEqual({ commitSha: "merge-commit-sha" });
      expect(commands).toEqual([
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        ["status", "--porcelain"],
        ["merge", "--no-ff", "--no-edit", "codex/ticket-37"],
        ["rev-parse", "HEAD"],
      ]);
    }).pipe(Effect.provide(makeGitIntegrationLayer({ execute })));
  });

  it.effect("returns merge conflicts with their recovery detail and leaves abort explicit", () => {
    const commands: string[][] = [];
    const execute: GitVcsDriver.GitVcsDriver["Service"]["execute"] = (input) =>
      Effect.sync(() => {
        commands.push([...input.args]);
        const isMerge = input.args[0] === "merge" && input.args[1] !== "--abort";
        return {
          exitCode: ChildProcessSpawner.ExitCode(isMerge ? 1 : 0),
          stdout: input.args[0] === "symbolic-ref" ? "feature/development-workflow\n" : "",
          stderr: isMerge ? "CONFLICT (content): Merge conflict in src/workflow.ts" : "",
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      });

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const error = yield* workflow
        .integrateBranch({
          cwd: "/repo",
          targetBranch: "feature/development-workflow",
          sourceBranch: "codex/ticket-43",
        })
        .pipe(Effect.flip);
      yield* workflow.abortIntegrationMerge("/repo");

      expect(error).toMatchObject({
        _tag: "GitCommandError",
        command: "merge",
        detail: "CONFLICT (content): Merge conflict in src/workflow.ts",
      });
      expect(commands).toEqual([
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        ["status", "--porcelain"],
        ["merge", "--no-ff", "--no-edit", "codex/ticket-43"],
        ["merge", "--abort"],
      ]);
    }).pipe(Effect.provide(makeGitIntegrationLayer({ execute })));
  });

  it.effect("previews and fast-forwards a clean baseline without hiding incoming scope", () => {
    const commands: string[][] = [];
    const execute: GitVcsDriver.GitVcsDriver["Service"]["execute"] = (input) =>
      Effect.sync(() => {
        commands.push([...input.args]);
        const stdout =
          input.args[0] === "symbolic-ref"
            ? "feature/development-workflow\n"
            : input.args[0] === "rev-parse" && input.args[1] === "feature/development-workflow"
              ? "baseline-sha\n"
              : input.args[0] === "rev-parse"
                ? "source-sha\n"
                : input.args[0] === "log"
                  ? "incoming-sha\tAdd workflow repair\n"
                  : input.args[0] === "diff"
                    ? "3\t1\tsrc/workflow.ts\n"
                    : input.args[0] === "merge"
                      ? ""
                      : "";
        return {
          exitCode: ChildProcessSpawner.ExitCode(0),
          stdout,
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      });

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const preview = yield* workflow.previewBaselineRefresh({
        cwd: "/repo",
        baselineBranch: "feature/development-workflow",
        remoteTarget: "origin/main",
      });
      const refreshed = yield* workflow.refreshBaseline({
        cwd: "/repo",
        baselineBranch: "feature/development-workflow",
        remoteTarget: "origin/main",
        expectedSourceCommit: "source-sha",
      });
      const diff = yield* workflow.diffFromFixedPoint({
        cwd: "/repo",
        fixedPoint: "fixed-point-sha",
      });

      expect(preview).toEqual({
        currentCommit: "baseline-sha",
        sourceCommit: "source-sha",
        incomingCommits: [{ sha: "incoming-sha", title: "Add workflow repair" }],
        incomingFiles: [{ path: "src/workflow.ts", additions: 3, deletions: 1 }],
      });
      expect(refreshed).toEqual({ commitSha: "source-sha" });
      expect(diff).toEqual({
        files: [{ path: "src/workflow.ts", additions: 3, deletions: 1 }],
        additions: 3,
        deletions: 1,
      });
      expect(commands).toEqual([
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        ["status", "--porcelain"],
        ["fetch", "--quiet", "origin"],
        ["rev-parse", "feature/development-workflow"],
        ["rev-parse", "origin/main"],
        ["log", "--format=%H%x09%s", "feature/development-workflow..origin/main"],
        ["diff", "--numstat", "feature/development-workflow..origin/main"],
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        ["status", "--porcelain"],
        ["fetch", "--quiet", "origin"],
        ["rev-parse", "origin/main"],
        ["merge", "--ff-only", "origin/main"],
        ["rev-parse", "HEAD"],
        ["diff", "--numstat", "fixed-point-sha..HEAD"],
      ]);
    }).pipe(Effect.provide(makeGitIntegrationLayer({ execute })));
  });

  it.effect("refuses to refresh after the confirmed source moves", () => {
    const commands: string[][] = [];
    const execute: GitVcsDriver.GitVcsDriver["Service"]["execute"] = (input) =>
      Effect.sync(() => {
        commands.push([...input.args]);
        const stdout =
          input.args[0] === "symbolic-ref"
            ? "feature/development-workflow\n"
            : input.args[0] === "rev-parse"
              ? "new-source-sha\n"
              : "";
        return {
          exitCode: ChildProcessSpawner.ExitCode(0),
          stdout,
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      });

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const error = yield* workflow
        .refreshBaseline({
          cwd: "/repo",
          baselineBranch: "feature/development-workflow",
          remoteTarget: "origin/main",
          expectedSourceCommit: "previewed-source-sha",
        })
        .pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "GitCommandError",
        command: "rev-parse",
        detail:
          "The confirmed refresh source changed from previewed-source-sha to new-source-sha; the baseline was left unchanged.",
      });
      expect(commands).toEqual([
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        ["status", "--porcelain"],
        ["fetch", "--quiet", "origin"],
        ["rev-parse", "origin/main"],
      ]);
    }).pipe(Effect.provide(makeGitIntegrationLayer({ execute })));
  });

  it.effect("validates the integrated range at the fixed point", () => {
    const execute: GitVcsDriver.GitVcsDriver["Service"]["execute"] = (input) =>
      Effect.sync(() => ({
        exitCode: ChildProcessSpawner.ExitCode(0),
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
      }));

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      yield* workflow.validateIntegration({
        cwd: "/repo",
        fixedPoint: "2794a87560f910f1b6b5c59db1e2ac1bee9373b3",
      });
    }).pipe(Effect.provide(makeGitIntegrationLayer({ execute })));
  });

  it.effect("returns an empty local status when no VCS repository is detected", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const status = yield* workflow.localStatus({ cwd: "/not-a-repo" });

      assert.deepStrictEqual(status, {
        isRepo: false,
        hasPrimaryRemote: false,
        isDefaultRef: false,
        refName: null,
        hasWorkingTreeChanges: false,
        workingTree: {
          files: [],
          insertions: 0,
          deletions: 0,
        },
      });
    }).pipe(
      Effect.provide(
        makeLayer({
          detect: () => Effect.succeed(null),
        }),
      ),
    ),
  );

  it.effect("returns an empty full status when no VCS repository is detected", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const status = yield* workflow.status({ cwd: "/not-a-repo" });

      assert.deepStrictEqual(status, {
        isRepo: false,
        hasPrimaryRemote: false,
        isDefaultRef: false,
        refName: null,
        hasWorkingTreeChanges: false,
        workingTree: {
          files: [],
          insertions: 0,
          deletions: 0,
        },
        hasUpstream: false,
        aheadCount: 0,
        behindCount: 0,
        aheadOfDefaultCount: 0,
        pr: null,
      });
    }).pipe(
      Effect.provide(
        makeLayer({
          detect: () => Effect.succeed(null),
        }),
      ),
    ),
  );

  it.effect("does not call GitManager status methods when no VCS repository is detected", () => {
    const localStatus = vi.fn();
    const remoteStatus = vi.fn();
    const status = vi.fn();

    const testLayer = GitWorkflowService.layer.pipe(
      Layer.provide(
        Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
          detect: () => Effect.succeed(null),
        }),
      ),
      Layer.provide(Layer.mock(GitVcsDriver.GitVcsDriver)({})),
      Layer.provide(
        Layer.mock(GitManager.GitManager)({
          localStatus,
          remoteStatus,
          status,
        }),
      ),
    );

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      yield* workflow.localStatus({ cwd: "/not-a-repo" });
      yield* workflow.remoteStatus({ cwd: "/not-a-repo" });
      yield* workflow.status({ cwd: "/not-a-repo" });

      assert.equal(localStatus.mock.calls.length, 0);
      assert.equal(remoteStatus.mock.calls.length, 0);
      assert.equal(status.mock.calls.length, 0);
    }).pipe(Effect.provide(testLayer));
  });

  it.effect("returns an empty ref list when no VCS repository is detected", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const refs = yield* workflow.listRefs({ cwd: "/not-a-repo" });

      assert.deepStrictEqual(refs, {
        refs: [],
        isRepo: false,
        hasPrimaryRemote: false,
        nextCursor: null,
        totalCount: 0,
      });
    }).pipe(
      Effect.provide(
        makeLayer({
          detect: () => Effect.succeed(null),
        }),
      ),
    ),
  );

  it.effect("structures workflow detection failures without exposing upstream details", () => {
    const cause = new VcsRepositoryDetectionError({
      operation: "VcsDriverRegistry.detect",
      cwd: "/repo",
      detail: "upstream detail must stay in the cause chain",
    });

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const error = yield* workflow.status({ cwd: "/repo" }).pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "GitManagerError",
        operation: "GitWorkflowService.status",
        cwd: "/repo",
        detail: "Failed to detect a VCS repository for this Git workflow.",
      });
      expect(error.message).not.toContain(cause.detail);
    }).pipe(
      Effect.provide(
        makeLayer({
          detect: () => Effect.fail(cause),
        }),
      ),
    );
  });

  it.effect("structures command detection failures without exposing upstream details", () => {
    const cause = new VcsRepositoryDetectionError({
      operation: "VcsDriverRegistry.detect",
      cwd: "/repo",
      detail: "upstream command detail must stay in the cause chain",
    });

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const error = yield* workflow.listRefs({ cwd: "/repo" }).pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "GitCommandError",
        operation: "GitWorkflowService.listRefs",
        command: "vcs-route",
        cwd: "/repo",
        detail: "Failed to detect a VCS repository for this Git command.",
      });
      expect(error.message).not.toContain(cause.detail);
    }).pipe(
      Effect.provide(
        makeLayer({
          detect: () => Effect.fail(cause),
        }),
      ),
    );
  });
});
