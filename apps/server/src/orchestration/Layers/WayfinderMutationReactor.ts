import type { OrchestrationEvent } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  WayfinderMutationReactor,
  type WayfinderMutationReactorShape,
} from "../Services/WayfinderMutationReactor.ts";
import { makeWayfinderMutationProcessor } from "./WayfinderProcessors.ts";

type MutationRequestedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.wayfinder-mutation-requested" }
>;

export const makeWayfinderMutationReactor = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const processMutation = yield* makeWayfinderMutationProcessor;
  const processMutationSafely = Effect.fn("WayfinderMutationReactor.processEventSafely")(
    function* (event: MutationRequestedEvent) {
      yield* processMutation(event);
    },
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logWarning("Wayfinder mutation reactor failed to process event", {
                threadId: event.payload.threadId,
                skillRunId: event.payload.skillRunId,
                cause: Cause.pretty(cause),
              }),
        ),
      ),
  );
  const worker = yield* makeDrainableWorker(processMutationSafely);
  const start: WayfinderMutationReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) =>
        event.type === "thread.wayfinder-mutation-requested" ? worker.enqueue(event) : Effect.void,
      ),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies WayfinderMutationReactorShape;
});

export const WayfinderMutationReactorLive = Layer.effect(
  WayfinderMutationReactor,
  makeWayfinderMutationReactor,
);
