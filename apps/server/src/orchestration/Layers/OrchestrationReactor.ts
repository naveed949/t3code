import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  OrchestrationReactor,
  type OrchestrationReactorShape,
} from "../Services/OrchestrationReactor.ts";
import { CheckpointReactor } from "../Services/CheckpointReactor.ts";
import { ProviderCommandReactor } from "../Services/ProviderCommandReactor.ts";
import { ProviderRuntimeIngestionService } from "../Services/ProviderRuntimeIngestion.ts";
import { ThreadDeletionReactor } from "../Services/ThreadDeletionReactor.ts";
import { WayfinderPublicationReactor } from "../Services/WayfinderPublicationReactor.ts";
import { WayfinderMutationReactor } from "../Services/WayfinderMutationReactor.ts";
import { WayfinderReconciliationReactor } from "../Services/WayfinderReconciliationReactor.ts";
import { WayfinderResearchReactor } from "../Services/WayfinderResearchReactor.ts";
import * as AgentAwarenessRelay from "../../relay/AgentAwarenessRelay.ts";

export const makeOrchestrationReactor = Effect.gen(function* () {
  const providerRuntimeIngestion = yield* ProviderRuntimeIngestionService;
  const providerCommandReactor = yield* ProviderCommandReactor;
  const checkpointReactor = yield* CheckpointReactor;
  const threadDeletionReactor = yield* ThreadDeletionReactor;
  const wayfinderPublicationReactor = yield* WayfinderPublicationReactor;
  const wayfinderMutationReactor = yield* WayfinderMutationReactor;
  const wayfinderReconciliationReactor = yield* WayfinderReconciliationReactor;
  const wayfinderResearchReactor = yield* WayfinderResearchReactor;
  const agentAwarenessRelay = yield* AgentAwarenessRelay.AgentAwarenessRelay;

  const start: OrchestrationReactorShape["start"] = Effect.fn("start")(function* () {
    yield* providerRuntimeIngestion.start();
    yield* providerCommandReactor.start();
    yield* checkpointReactor.start();
    yield* threadDeletionReactor.start();
    yield* wayfinderPublicationReactor.start();
    yield* wayfinderMutationReactor.start();
    yield* wayfinderReconciliationReactor.start();
    yield* wayfinderResearchReactor.start();
    yield* agentAwarenessRelay.start();
  });

  return {
    start,
  } satisfies OrchestrationReactorShape;
});

export const OrchestrationReactorLive = Layer.effect(
  OrchestrationReactor,
  makeOrchestrationReactor,
);
