import type { OrchestrationEvent } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  WayfinderPublicationReactor,
  type WayfinderPublicationReactorShape,
} from "../Services/WayfinderPublicationReactor.ts";
import { makeWayfinderPublicationProcessor } from "./WayfinderProcessors.ts";

type PublicationRequestedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.wayfinder-publication-requested" }
>;

export const makeWayfinderPublicationReactor = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const processEvent = yield* makeWayfinderPublicationProcessor;
  const processEventSafely = Effect.fn("WayfinderPublicationReactor.processEventSafely")(
    function* (event: PublicationRequestedEvent) {
      yield* processEvent(event);
    },
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
          return Effect.logWarning("Wayfinder publication reactor failed to process event", {
            threadId: event.payload.threadId,
            skillRunId: event.payload.skillRunId,
            cause: Cause.pretty(cause),
          });
        }),
      ),
  );
  const worker = yield* makeDrainableWorker(processEventSafely);
  const start: WayfinderPublicationReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) =>
        event.type === "thread.wayfinder-publication-requested"
          ? worker.enqueue(event)
          : Effect.void,
      ),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies WayfinderPublicationReactorShape;
});

export const WayfinderPublicationReactorLive = Layer.effect(
  WayfinderPublicationReactor,
  makeWayfinderPublicationReactor,
);
