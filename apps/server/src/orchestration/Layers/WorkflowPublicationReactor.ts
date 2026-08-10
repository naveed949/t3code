import type { OrchestrationEvent } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import {
  WorkflowPublicationReactor,
  type WorkflowPublicationReactorShape,
} from "../Services/WorkflowPublicationReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  makeWorkflowPublicationProcessor,
  type WorkflowPublicationEvent,
} from "./WorkflowPublicationProcessor.ts";

export const makeWorkflowPublicationReactor = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const processEvent = yield* makeWorkflowPublicationProcessor;
  const processEventSafely = Effect.fn("WorkflowPublicationReactor.processEventSafely")(
    function* (event: WorkflowPublicationEvent) {
      yield* processEvent(event);
    },
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
          return Effect.logWarning("Workflow publication reactor failed to process event", {
            threadId: event.payload.threadId,
            publicationStatus: event.payload.attachment.publication?.status ?? "missing",
            cause: Cause.pretty(cause),
          });
        }),
      ),
  );
  const worker = yield* makeDrainableWorker(processEventSafely);
  const start: WorkflowPublicationReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event: OrchestrationEvent) =>
        event.type === "thread.workflow-publication-preflighted" ||
        event.type === "thread.workflow-publication-requested" ||
        event.type === "thread.workflow-publication-observation-requested"
          ? worker.enqueue(event)
          : Effect.void,
      ),
    );
  });

  return { start, drain: worker.drain } satisfies WorkflowPublicationReactorShape;
});

export const WorkflowPublicationReactorLive = Layer.effect(
  WorkflowPublicationReactor,
  makeWorkflowPublicationReactor,
);
