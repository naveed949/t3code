import {
  OrchestrationDispatchCommandError,
  type OrchestrationCommand,
  type OrchestrationProjectShell,
  type SkillInvocation,
  type OrchestrationThreadShell,
  type ProjectId,
  type ServerProvider,
  type ThreadId,
  type WayfinderSynchronizationState,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { NativeWayfinderPreflightService } from "./NativeWayfinderPreflightService.ts";

const canonicalReadBlockers = new Set([
  "continuation-issue",
  "github-repository",
  "github-cli",
  "github-authentication",
  "issue-capability",
  "required-labels",
  "native-child-relationships",
  "native-blocking-relationships",
]);

function sameWayfinderMapContent(
  left: NonNullable<SkillInvocation["wayfinderMap"]>,
  right: NonNullable<SkillInvocation["wayfinderMap"]>,
): boolean {
  const { lastSynchronizedAt: _leftSync, ...leftContent } = left;
  const { lastSynchronizedAt: _rightSync, ...rightContent } = right;
  return JSON.stringify(leftContent) === JSON.stringify(rightContent);
}

function matchesCanonicalReference(invocation: SkillInvocation, reference: string): boolean {
  const canonical = invocation.wayfinderMap?.canonicalReference;
  if (!canonical) return false;
  const trimmed = reference.trim();
  return (
    trimmed === String(canonical.number) ||
    trimmed === `#${canonical.number}` ||
    trimmed.replace(/\/$/u, "") === canonical.url.replace(/\/$/u, "")
  );
}

interface GateDependencies {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly getThread: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<OrchestrationThreadShell>, OrchestrationDispatchCommandError>;
  readonly getProject: (
    projectId: ProjectId,
  ) => Effect.Effect<Option.Option<OrchestrationProjectShell>, OrchestrationDispatchCommandError>;
  readonly getSkillRuns: () => Effect.Effect<
    ReadonlyArray<SkillInvocation>,
    OrchestrationDispatchCommandError
  >;
  readonly markWayfinderUnavailable: (input: {
    readonly threadId: ThreadId;
    readonly skillRunId: SkillInvocation["skillRunId"];
    readonly synchronization: WayfinderSynchronizationState;
  }) => Effect.Effect<void, OrchestrationDispatchCommandError>;
  readonly check: NativeWayfinderPreflightService["Service"]["check"];
}

function dispatchError(message: string) {
  return new OrchestrationDispatchCommandError({ message });
}

const preflightNativeWayfinderDispatch = Effect.fn("preflightNativeWayfinderDispatch")(function* (
  command: OrchestrationCommand,
  dependencies: GateDependencies,
) {
  if (
    command.type !== "thread.turn.start" ||
    command.skillInvocation?.skill.name !== "wayfinder" ||
    (command.skillInvocation.execution.mode === "generic" &&
      command.skillInvocation.execution.reason === "user-selected-generic")
  ) {
    return command;
  }
  const skillInvocation = command.skillInvocation;

  const bootstrapProjectId = command.bootstrap?.createThread?.projectId;
  const thread = bootstrapProjectId
    ? Option.none<OrchestrationThreadShell>()
    : yield* dependencies.getThread(command.threadId);
  const projectId = bootstrapProjectId ?? Option.getOrUndefined(thread)?.projectId;
  if (!projectId) {
    return yield* dispatchError("Wayfinder preflight could not resolve the target project.");
  }
  const project = yield* dependencies.getProject(projectId);
  const projectShell = Option.getOrUndefined(project);
  if (!projectShell) {
    return yield* dispatchError("Wayfinder preflight could not load the target project.");
  }

  const providerInstanceId =
    command.modelSelection?.instanceId ??
    command.bootstrap?.createThread?.modelSelection.instanceId ??
    Option.getOrUndefined(thread)?.modelSelection.instanceId;
  const provider = dependencies.providers.find(
    (candidate) => candidate.instanceId === providerInstanceId,
  );
  if (!provider) {
    return yield* dispatchError("Wayfinder preflight could not resolve the selected provider.");
  }

  const workspaceRoot =
    command.bootstrap?.prepareWorktree?.projectCwd ??
    command.bootstrap?.createThread?.worktreePath ??
    Option.getOrUndefined(thread)?.worktreePath ??
    projectShell.workspaceRoot;
  const continuationReference =
    skillInvocation.action?.id === "continue-map" ? skillInvocation.action.reference : null;
  const continuationRuns =
    continuationReference !== null
      ? (yield* dependencies.getSkillRuns())
          .filter(
            (run) =>
              run.projectId === projectId &&
              run.skill.name === "wayfinder" &&
              matchesCanonicalReference(run, continuationReference),
          )
          .sort(
            (left, right) =>
              right.createdAt.localeCompare(left.createdAt) ||
              right.skillRunId.localeCompare(left.skillRunId),
          )
      : [];
  const result = yield* dependencies.check({
    workspaceRoot,
    provider: provider.driver,
    skillDigest: skillInvocation.skill.contentDigest,
    ...(skillInvocation.action ? { action: skillInvocation.action } : {}),
  });
  if (result.kind === "blocked") {
    const cachedRun = continuationRuns[0];
    const cachedMap = continuationRuns.find((run) => run.wayfinderMap)?.wayfinderMap;
    const canonicalReadFailed = result.blockers.some((blocker) =>
      canonicalReadBlockers.has(blocker.check),
    );
    if (cachedRun && cachedMap && canonicalReadFailed) {
      const lastSuccessfulAt =
        cachedRun.wayfinderSynchronization?.lastSuccessfulAt ??
        cachedRun.wayfinderSynchronizedAt ??
        cachedMap.lastSynchronizedAt;
      yield* dependencies.markWayfinderUnavailable({
        threadId: cachedRun.threadId,
        skillRunId: cachedRun.skillRunId,
        synchronization: {
          status: "unavailable",
          reason: "resume",
          lastAttemptedAt: command.createdAt,
          lastSuccessfulAt,
          canMutate: false,
          message:
            "The cached Wayfinder map is read-only because resume could not reconcile GitHub.",
        },
      });
    }
    return yield* new OrchestrationDispatchCommandError({
      message: `Native Wayfinder preflight is blocked: ${result.blockers
        .map((blocker) => `${blocker.check}: ${blocker.remediation}`)
        .join(" ")}`,
      preflightBlockers: result.blockers,
    });
  }
  if (command.type === "thread.turn.start" && command.skillInvocation && result.wayfinderMap) {
    const matchingRuns = continuationRuns
      .filter(
        (run) =>
          run.wayfinderMap?.canonicalReference.url === result.wayfinderMap?.canonicalReference.url,
      )
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) ||
          right.skillRunId.localeCompare(left.skillRunId),
      );
    const existingRun = matchingRuns[0];
    const existingMap = matchingRuns.find((run) => run.wayfinderMap)?.wayfinderMap;
    const shouldPersistProjection =
      !existingMap || !sameWayfinderMapContent(existingMap, result.wayfinderMap);
    return {
      ...command,
      skillInvocation: {
        ...command.skillInvocation,
        ...(shouldPersistProjection ? { wayfinderMap: result.wayfinderMap } : {}),
        wayfinderSynchronizedAt: result.wayfinderMap.lastSynchronizedAt,
        ...(existingRun
          ? {
              reconnectWorkstreamId: existingRun.workstreamId,
              wayfinderSynchronization: {
                status: "healthy",
                reason: "resume",
                lastAttemptedAt: result.wayfinderMap.lastSynchronizedAt,
                lastSuccessfulAt: result.wayfinderMap.lastSynchronizedAt,
                canMutate: true,
                ...(result.wayfinderMap.revision !== undefined
                  ? { actualRevision: result.wayfinderMap.revision }
                  : {}),
              },
            }
          : {}),
      },
    } satisfies OrchestrationCommand;
  }
  return command;
});

export const dispatchWithNativeWayfinderPreflight = Effect.fn(
  "dispatchWithNativeWayfinderPreflight",
)(function* <A, E>(input: {
  readonly command: OrchestrationCommand;
  readonly dependencies: GateDependencies;
  readonly dispatch: (command: OrchestrationCommand) => Effect.Effect<A, E>;
}) {
  const command = yield* preflightNativeWayfinderDispatch(input.command, input.dependencies);
  return yield* input.dispatch(command);
});
