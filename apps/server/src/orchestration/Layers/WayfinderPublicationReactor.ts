import { CommandId, type OrchestrationEvent, type WayfinderPublication } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { deriveWayfinderDraft } from "@t3tools/shared/wayfinderDraft";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { IssueTracker } from "../../nativeSkills/IssueTracker.ts";
import {
  publishWayfinderDraft,
  type WayfinderPublicationProgress,
} from "../../nativeSkills/WayfinderPublication.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBus } from "../Services/RuntimeReceiptBus.ts";
import {
  WayfinderPublicationReactor,
  type WayfinderPublicationReactorShape,
} from "../Services/WayfinderPublicationReactor.ts";

type PublicationRequestedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.wayfinder-publication-requested" }
>;

export const makeWayfinderPublicationProcessor = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const tracker = yield* IssueTracker;
  const receipts = yield* RuntimeReceiptBus;
  const serverCommandId = Effect.fn("WayfinderPublicationReactor.serverCommandId")(function* (
    tag: string,
  ) {
    const uuid = yield* crypto.randomUUIDv4;
    return CommandId.make(`server:${tag}:${uuid}`);
  });

  const publishProgress = Effect.fn("WayfinderPublicationReactor.publishProgress")(function* (
    event: PublicationRequestedEvent,
    progress: WayfinderPublicationProgress | WayfinderPublication,
  ) {
    const { map: wayfinderMap, ...publication } =
      "map" in progress ? progress : { ...progress, map: undefined };
    yield* orchestrationEngine.dispatch({
      type: "thread.wayfinder.publication.update",
      commandId: yield* serverCommandId("wayfinder-publication"),
      threadId: event.payload.threadId,
      skillRunId: event.payload.skillRunId,
      publication,
      ...(wayfinderMap !== undefined ? { wayfinderMap } : {}),
      createdAt: progress.updatedAt,
    });
    yield* receipts.publish({
      type: "wayfinder.publication.progress",
      threadId: event.payload.threadId,
      skillRunId: event.payload.skillRunId,
      status: progress.status,
      nextStep: progress.nextStep,
      createdAt: progress.updatedAt,
    });
  });

  const processEvent = Effect.fn("WayfinderPublicationReactor.processEvent")(function* (
    event: PublicationRequestedEvent,
  ) {
    const snapshot = yield* snapshots.getSnapshot();
    const thread = snapshot.threads.find((candidate) => candidate.id === event.payload.threadId);
    const skillRuns = yield* snapshots.getSkillRunsByThreadId(event.payload.threadId);
    const invocation = skillRuns.find(
      (candidate) => candidate.skillRunId === event.payload.skillRunId,
    );
    const previous = invocation?.wayfinderPublication;
    if (previous?.status === "synchronized") return;
    const draft = deriveWayfinderDraft(invocation, thread?.activities ?? []);
    if (draft === null) {
      yield* publishProgress(event, {
        status: "failed",
        artifacts: previous?.artifacts ?? [],
        nextStep: "load confirmed Wayfinder draft",
        error: "The requested Wayfinder draft is not the active unpublished draft.",
        updatedAt: event.payload.createdAt,
      });
      return;
    }
    if (event.payload.runtimeMode === "approval-required" && !event.payload.confirmed) {
      yield* publishProgress(event, {
        status: "awaiting-approval",
        artifacts: previous?.artifacts ?? [],
        nextStep: "confirm GitHub publication",
        updatedAt: event.payload.createdAt,
      });
      return;
    }

    const cwd = thread
      ? resolveThreadWorkspaceCwd({ thread, projects: snapshot.projects })
      : undefined;
    const repository = cwd ? yield* tracker.resolveProjectRepository(cwd) : null;
    if (!thread || !cwd || !repository) {
      yield* publishProgress(event, {
        status: "failed",
        artifacts: previous?.artifacts ?? [],
        nextStep: "resolve GitHub repository",
        error: "The Wayfinder thread is not linked to a writable GitHub repository.",
        updatedAt: event.payload.createdAt,
      });
      return;
    }
    const resumablePrevious = previous;
    yield* publishWayfinderDraft(
      {
        cwd,
        repository,
        draft,
        synchronizedAt: event.payload.createdAt,
        publicationKey: event.payload.skillRunId,
        ...(resumablePrevious !== undefined ? { previous: resumablePrevious } : {}),
      },
      {
        tracker,
        onProgress: (progress) => publishProgress(event, progress),
      },
    );
  });

  return processEvent;
});

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
