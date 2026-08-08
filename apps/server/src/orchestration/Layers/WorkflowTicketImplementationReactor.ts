import type { OrchestrationEvent } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import {
  WorkflowTicketImplementationReactor,
  type WorkflowTicketImplementationReactorShape,
} from "../Services/WorkflowTicketImplementationReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { makeWorkflowTicketImplementationProcessor } from "./WorkflowTicketImplementationProcessor.ts";

type WorkflowTicketImplementationEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.workflow-ticket-implementation-requested"
      | "thread.workflow-ticket-implementation-updated"
      | "thread.workflow-ticket-implementation-recovery-requested"
      | "thread.session-set"
      | "thread.reverted"
      | "thread.turn-start-requested";
  }
>;

export const makeWorkflowTicketImplementationReactor = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const processEvent = yield* makeWorkflowTicketImplementationProcessor;
  const processEventSafely = Effect.fn("WorkflowTicketImplementationReactor.processEventSafely")(
    function* (event: WorkflowTicketImplementationEvent) {
      yield* processEvent(event);
    },
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
          return Effect.logWarning("Ticket Implementation reactor failed to process event", {
            eventType: event.type,
            threadId: event.payload.threadId,
            cause: Cause.pretty(cause),
          });
        }),
      ),
  );
  const worker = yield* makeDrainableWorker(processEventSafely);
  const start: WorkflowTicketImplementationReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) =>
        event.type === "thread.workflow-ticket-implementation-requested" ||
        event.type === "thread.workflow-ticket-implementation-updated" ||
        event.type === "thread.workflow-ticket-implementation-recovery-requested" ||
        event.type === "thread.session-set" ||
        event.type === "thread.reverted" ||
        event.type === "thread.turn-start-requested"
          ? worker.enqueue(event)
          : Effect.void,
      ),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies WorkflowTicketImplementationReactorShape;
});

export const WorkflowTicketImplementationReactorLive = Layer.effect(
  WorkflowTicketImplementationReactor,
  makeWorkflowTicketImplementationReactor,
);
