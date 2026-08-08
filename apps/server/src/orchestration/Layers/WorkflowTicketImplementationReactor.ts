import type { OrchestrationEvent } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as TxRef from "effect/TxRef";

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
      | "thread.workflow-ticket-implementation-checkpointed"
      | "thread.workflow-run-started"
      | "thread.workflow-run-resumed"
      | "thread.workflow-run-draining"
      | "thread.session-set"
      | "thread.turn-start-requested";
  }
>;

export const makeWorkflowTicketImplementationReactor = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const processEvent = yield* makeWorkflowTicketImplementationProcessor;
  const seenSequence = yield* TxRef.make(yield* orchestrationEngine.latestSequence);
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
        Effect.gen(function* () {
          if (
            event.type === "thread.workflow-ticket-implementation-requested" ||
            event.type === "thread.workflow-ticket-implementation-updated" ||
            event.type === "thread.workflow-ticket-implementation-checkpointed" ||
            event.type === "thread.workflow-run-started" ||
            event.type === "thread.workflow-run-resumed" ||
            event.type === "thread.workflow-run-draining" ||
            event.type === "thread.session-set" ||
            event.type === "thread.turn-start-requested"
          ) {
            yield* worker.enqueue(event);
          }
          yield* TxRef.update(seenSequence, (sequence) => Math.max(sequence, event.sequence)).pipe(
            Effect.tx,
          );
        }),
      ),
    );
    yield* Effect.yieldNow;
  });

  const drain: WorkflowTicketImplementationReactorShape["drain"] = Effect.gen(function* () {
    while (true) {
      const targetSequence = yield* orchestrationEngine.latestSequence;
      yield* TxRef.get(seenSequence).pipe(
        Effect.tap((sequence) => (sequence < targetSequence ? Effect.txRetry : Effect.void)),
        Effect.tx,
      );
      yield* worker.drain;
      if ((yield* orchestrationEngine.latestSequence) <= targetSequence) return;
    }
  });

  return {
    start,
    drain,
  } satisfies WorkflowTicketImplementationReactorShape;
});

export const WorkflowTicketImplementationReactorLive = Layer.effect(
  WorkflowTicketImplementationReactor,
  makeWorkflowTicketImplementationReactor,
);
