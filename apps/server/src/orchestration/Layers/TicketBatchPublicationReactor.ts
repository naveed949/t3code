import type { OrchestrationEvent } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import {
  TicketBatchPublicationReactor,
  type TicketBatchPublicationReactorShape,
} from "../Services/TicketBatchPublicationReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { makeTicketBatchPublicationProcessor } from "./TicketBatchPublicationProcessor.ts";

type PublicationRequestedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.workflow-ticket-batch-publication-requested" }
>;

export const makeTicketBatchPublicationReactor = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const processEvent = yield* makeTicketBatchPublicationProcessor;
  const processEventSafely = Effect.fn("TicketBatchPublicationReactor.processEventSafely")(
    function* (event: PublicationRequestedEvent) {
      yield* processEvent(event);
    },
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
          return Effect.logWarning("Ticket Batch publication reactor failed to process event", {
            threadId: event.payload.threadId,
            batchId: event.payload.batch.id,
            cause: Cause.pretty(cause),
          });
        }),
      ),
  );
  const worker = yield* makeDrainableWorker(processEventSafely);
  const start: TicketBatchPublicationReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) =>
        event.type === "thread.workflow-ticket-batch-publication-requested"
          ? worker.enqueue(event)
          : Effect.void,
      ),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies TicketBatchPublicationReactorShape;
});

export const TicketBatchPublicationReactorLive = Layer.effect(
  TicketBatchPublicationReactor,
  makeTicketBatchPublicationReactor,
);
