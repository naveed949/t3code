import {
  OrchestrationDispatchCommandError,
  type OrchestrationCommand,
  type OrchestrationProjectShell,
  type SkillInvocation,
  type OrchestrationThreadShell,
  type ProjectId,
  type ServerProvider,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { NativeWayfinderPreflightService } from "./NativeWayfinderPreflightService.ts";

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
  const result = yield* dependencies.check({
    workspaceRoot,
    provider: provider.driver,
    skillDigest: command.skillInvocation.skill.contentDigest,
    ...(command.skillInvocation.action ? { action: command.skillInvocation.action } : {}),
  });
  if (result.kind === "blocked") {
    return yield* new OrchestrationDispatchCommandError({
      message: `Native Wayfinder preflight is blocked: ${result.blockers
        .map((blocker) => `${blocker.check}: ${blocker.remediation}`)
        .join(" ")}`,
      preflightBlockers: result.blockers,
    });
  }
  if (command.type === "thread.turn.start" && command.skillInvocation && result.wayfinderMap) {
    const existingRun = (yield* dependencies.getSkillRuns())
      .filter(
        (run) =>
          run.projectId === projectId &&
          run.skill.name === "wayfinder" &&
          run.wayfinderMap?.canonicalReference.url === result.wayfinderMap?.canonicalReference.url,
      )
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) ||
          right.skillRunId.localeCompare(left.skillRunId),
      )[0];
    return {
      ...command,
      skillInvocation: {
        ...command.skillInvocation,
        wayfinderMap: result.wayfinderMap,
        ...(existingRun ? { reconnectWorkstreamId: existingRun.workstreamId } : {}),
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
