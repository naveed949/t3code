import { CommandId, type OrchestrationEvent } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import {
  WorkflowCleanupReactor,
  type WorkflowCleanupReactorShape,
} from "../Services/WorkflowCleanupReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  makeWorkflowCleanupProcessor,
  type WorkflowCleanupEvent,
} from "./WorkflowCleanupProcessor.ts";

export const makeWorkflowCleanupReactor = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const processEvent = yield* makeWorkflowCleanupProcessor;
  const processEventSafely = Effect.fn("WorkflowCleanupReactor.processEventSafely")(
    function* (event: WorkflowCleanupEvent) {
      yield* processEvent(event);
    },
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
          const cleanup = event.payload.attachment.workflowCleanup;
          const detail = Cause.pretty(cause);
          if (cleanup === undefined || !["previewing", "cleaning"].includes(cleanup.status)) {
            return Effect.logWarning("Workflow cleanup reactor failed to process event", {
              threadId: event.payload.threadId,
              cleanupStatus: cleanup?.status ?? "missing",
              cause: detail,
            });
          }
          const recovery = {
            ...cleanup,
            status: "needs-recovery" as const,
            failure: detail,
            updatedAt: event.occurredAt,
          };
          return orchestrationEngine
            .dispatch({
              type: "thread.workflow.cleanup.update",
              commandId: CommandId.make(
                `server:workflow-cleanup-recovery:${String(event.commandId)}`,
              ),
              threadId: event.payload.threadId,
              expectedWorkstreamVersion: event.payload.attachment.workflowVersion ?? 0,
              cleanup: recovery,
              createdAt: event.occurredAt,
            })
            .pipe(
              Effect.catchCause((recoveryCause) =>
                Effect.logWarning("Workflow cleanup recovery update failed", {
                  threadId: event.payload.threadId,
                  cause: Cause.pretty(recoveryCause),
                }),
              ),
              Effect.andThen(
                Effect.logWarning("Workflow cleanup reactor failed to process event", {
                  threadId: event.payload.threadId,
                  cleanupStatus: cleanup.status,
                  cause: detail,
                }),
              ),
            );
        }),
      ),
  );
  const worker = yield* makeDrainableWorker(processEventSafely);
  const start: WorkflowCleanupReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event: OrchestrationEvent) =>
        event.type === "thread.workflow-cleanup-preflighted" ||
        event.type === "thread.workflow-cleanup-requested"
          ? worker.enqueue(event)
          : Effect.void,
      ),
    );
  });

  return { start, drain: worker.drain } satisfies WorkflowCleanupReactorShape;
});

export const WorkflowCleanupReactorLive = Layer.effect(
  WorkflowCleanupReactor,
  makeWorkflowCleanupReactor,
);
