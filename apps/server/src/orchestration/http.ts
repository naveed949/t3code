import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { projectThreadDetailSnapshot } from "./ActivityPayloadProjection.ts";
import { loadWayfinderHandoffSource, normalizeDispatchCommand } from "./Normalizer.ts";
import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  failEnvironmentInvalidRequest,
  failEnvironmentNotFound,
  requireEnvironmentScope,
} from "../auth/http.ts";
import * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

export const orchestrationHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "orchestration",
  Effect.fnUntraced(function* (handlers) {
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const providerRegistry = yield* ProviderRegistry.ProviderRegistry;

    return handlers
      .handle(
        "snapshot",
        Effect.fn("environment.orchestration.snapshot")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          // Serve the lightweight command read model (thread bodies empty)
          // instead of the fully hydrated snapshot. Hydrating every message
          // and activity payload in the database has OOM-killed servers, and
          // the route's only consumer (the project CLI) reads projects alone —
          // UI clients load the shell and per-thread snapshots instead.
          return yield* projectionSnapshotQuery
            .getCommandReadModel()
            .pipe(
              Effect.catch((cause) =>
                failEnvironmentInternal("orchestration_snapshot_failed", cause),
              ),
            );
        }),
      )
      .handle(
        "shellSnapshot",
        Effect.fn("environment.orchestration.shellSnapshot")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* projectionSnapshotQuery
            .getShellSnapshot()
            .pipe(
              Effect.catch((cause) =>
                failEnvironmentInternal("orchestration_snapshot_failed", cause),
              ),
            );
        }),
      )
      .handle(
        "threadSnapshot",
        Effect.fn("environment.orchestration.threadSnapshot")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          const snapshot = yield* projectionSnapshotQuery
            .getThreadDetailSnapshot(args.params.threadId)
            .pipe(
              Effect.catch((cause) =>
                failEnvironmentInternal("orchestration_thread_snapshot_failed", cause),
              ),
            );
          if (Option.isNone(snapshot)) {
            return yield* failEnvironmentNotFound("thread_not_found");
          }
          return projectThreadDetailSnapshot(snapshot.value);
        }),
      )
      .handle(
        "dispatch",
        Effect.fn("environment.orchestration.dispatch")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          const providers =
            (args.payload.type === "thread.turn.start" &&
              args.payload.skillInvocationRequest !== undefined) ||
            args.payload.type === "thread.workflow.run.preflight" ||
            args.payload.type === "thread.workflow.run.confirm"
              ? yield* providerRegistry.getProviders
              : undefined;
          const workflowRunCommand =
            args.payload.type === "thread.workflow.run.preflight" ||
            args.payload.type === "thread.workflow.run.confirm";
          const normalizedCommand = yield* normalizeDispatchCommand(args.payload, {
            ...(providers ? { providers } : {}),
            ...(workflowRunCommand
              ? {
                  getWorkflowRunWorkspaceRoot: (threadId) =>
                    projectionSnapshotQuery.getThreadShellById(threadId).pipe(
                      Effect.flatMap((thread) =>
                        Option.match(thread, {
                          onNone: () => Effect.succeed(null),
                          onSome: (shell) =>
                            projectionSnapshotQuery.getProjectShellById(shell.projectId).pipe(
                              Effect.map((project) =>
                                Option.match(project, {
                                  onNone: () => null,
                                  onSome: (value) => value.workspaceRoot,
                                }),
                              ),
                            ),
                        }),
                      ),
                    ),
                }
              : {}),
            getWayfinderHandoffSource: (skillRunId) =>
              loadWayfinderHandoffSource(projectionSnapshotQuery, skillRunId),
          }).pipe(Effect.catch(() => failEnvironmentInvalidRequest("invalid_command")));
          return yield* orchestrationEngine
            .dispatch(normalizedCommand)
            .pipe(
              Effect.catch((cause) =>
                failEnvironmentInternal("orchestration_dispatch_failed", cause),
              ),
            );
        }),
      );
  }),
);
