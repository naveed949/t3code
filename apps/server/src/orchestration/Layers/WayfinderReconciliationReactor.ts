import {
  CommandId,
  type OrchestrationEvent,
  type WayfinderMapProjection,
  type WayfinderSynchronizationState,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { IssueTracker } from "../../nativeSkills/IssueTracker.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBus } from "../Services/RuntimeReceiptBus.ts";
import {
  WayfinderReconciliationReactor,
  type WayfinderReconciliationReactorShape,
} from "../Services/WayfinderReconciliationReactor.ts";

type ReconciliationRequestedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.wayfinder-reconciliation-requested" }
>;

export const makeWayfinderReconciliationProcessor = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const tracker = yield* IssueTracker;
  const receipts = yield* RuntimeReceiptBus;

  const publishUpdate = Effect.fn("WayfinderReconciliationReactor.publishUpdate")(
    function* (input: {
      readonly event: ReconciliationRequestedEvent;
      readonly synchronization: WayfinderSynchronizationState;
      readonly map?: WayfinderMapProjection;
    }) {
      const uuid = yield* crypto.randomUUIDv4;
      yield* orchestrationEngine.dispatch({
        type: "thread.wayfinder.reconciliation.update",
        commandId: CommandId.make(`server:wayfinder-reconciliation:${uuid}`),
        threadId: input.event.payload.threadId,
        skillRunId: input.event.payload.skillRunId,
        synchronization: input.synchronization,
        ...(input.map !== undefined ? { wayfinderMap: input.map } : {}),
        createdAt: input.synchronization.lastAttemptedAt,
      });
    },
  );

  const publishTerminalReceipt = Effect.fn("WayfinderReconciliationReactor.publishTerminalReceipt")(
    function* (
      event: ReconciliationRequestedEvent,
      status: "healthy" | "unavailable" | "conflict",
    ) {
      yield* receipts.publish({
        type: "wayfinder.reconciliation.completed",
        threadId: event.payload.threadId,
        skillRunId: event.payload.skillRunId,
        reason: event.payload.reason,
        status,
        createdAt: event.payload.createdAt,
      });
    },
  );

  const unavailable = Effect.fn("WayfinderReconciliationReactor.unavailable")(function* (
    event: ReconciliationRequestedEvent,
    lastSuccessfulAt: string | undefined,
    message: string,
  ) {
    yield* publishUpdate({
      event,
      synchronization: {
        status: "unavailable",
        reason: event.payload.reason,
        lastAttemptedAt: event.payload.createdAt,
        ...(lastSuccessfulAt !== undefined ? { lastSuccessfulAt } : {}),
        canMutate: false,
        message,
      },
    });
    yield* publishTerminalReceipt(event, "unavailable");
  });

  return Effect.fn("WayfinderReconciliationReactor.processEvent")(function* (
    event: ReconciliationRequestedEvent,
  ) {
    const snapshot = yield* snapshots.getSnapshot();
    const thread = snapshot.threads.find((candidate) => candidate.id === event.payload.threadId);
    const skillRuns = yield* snapshots.getSkillRunsByThreadId(event.payload.threadId);
    const invocation = skillRuns.find(
      (candidate) => candidate.skillRunId === event.payload.skillRunId,
    );
    const map = invocation?.wayfinderMap;
    if (!thread || !invocation || !map) return;
    const lastSuccessfulAt =
      invocation.wayfinderSynchronization?.lastSuccessfulAt ?? map.lastSynchronizedAt;

    yield* publishUpdate({
      event,
      synchronization: {
        status: "synchronizing",
        reason: event.payload.reason,
        lastAttemptedAt: event.payload.createdAt,
        lastSuccessfulAt,
        canMutate: false,
      },
    });

    if (
      event.payload.reason === "mutation" &&
      event.payload.expectedRevision !== undefined &&
      map.revision !== undefined &&
      event.payload.expectedRevision !== map.revision
    ) {
      yield* publishUpdate({
        event,
        synchronization: {
          status: "conflict",
          reason: event.payload.reason,
          lastAttemptedAt: event.payload.createdAt,
          lastSuccessfulAt,
          canMutate: false,
          expectedRevision: event.payload.expectedRevision,
          actualRevision: map.revision,
          message: "GitHub changed before this action started. Refresh before retrying.",
        },
      });
      yield* publishTerminalReceipt(event, "conflict");
      return;
    }

    const cwd = resolveThreadWorkspaceCwd({ thread, projects: snapshot.projects });
    if (cwd === undefined) {
      yield* unavailable(
        event,
        lastSuccessfulAt,
        "The cached Wayfinder map is read-only because its workspace is unavailable.",
      );
      return;
    }
    const repository = yield* tracker.resolveProjectRepository(cwd);
    if (!repository) {
      yield* unavailable(
        event,
        lastSuccessfulAt,
        "The cached Wayfinder map is read-only because its GitHub repository is unavailable.",
      );
      return;
    }

    const loaded = yield* tracker
      .reconcileWayfinderMap({
        cwd,
        repository,
        issueNumber: map.canonicalReference.number,
        synchronizedAt: event.payload.createdAt,
        ...(map.revision !== undefined ? { currentRevision: map.revision } : {}),
      })
      .pipe(Effect.result);
    if (Result.isFailure(loaded)) {
      yield* unavailable(
        event,
        lastSuccessfulAt,
        "GitHub is unavailable. The last synchronized Wayfinder map remains read-only.",
      );
      return;
    }
    if (
      loaded.success.kind === "truncated" ||
      loaded.success.kind === "over-budget" ||
      loaded.success.kind === "not-wayfinder-map"
    ) {
      yield* unavailable(
        event,
        lastSuccessfulAt,
        loaded.success.kind === "truncated"
          ? "GitHub returned a partial Wayfinder graph. The cached map remains read-only."
          : loaded.success.kind === "over-budget"
            ? "The canonical Wayfinder map exceeds the shared projection budget. The cached map remains read-only."
            : "The canonical GitHub issue is no longer a Wayfinder map. The cached map remains read-only.",
      );
      return;
    }

    const actualRevision =
      loaded.success.kind === "loaded" ? loaded.success.map.revision : loaded.success.revision;
    if (
      event.payload.reason === "mutation" &&
      event.payload.expectedRevision !== undefined &&
      actualRevision !== undefined &&
      actualRevision !== event.payload.expectedRevision
    ) {
      yield* publishUpdate({
        event,
        synchronization: {
          status: "conflict",
          reason: event.payload.reason,
          lastAttemptedAt: event.payload.createdAt,
          lastSuccessfulAt,
          canMutate: false,
          expectedRevision: event.payload.expectedRevision,
          actualRevision,
          message: "GitHub changed before this action completed. Review the canonical map.",
        },
      });
      yield* publishTerminalReceipt(event, "conflict");
      return;
    }

    yield* publishUpdate({
      event,
      synchronization: {
        status: "healthy",
        reason: event.payload.reason,
        lastAttemptedAt: event.payload.createdAt,
        lastSuccessfulAt: event.payload.createdAt,
        canMutate: true,
        ...(actualRevision !== undefined ? { actualRevision } : {}),
      },
      ...(loaded.success.kind === "loaded" ? { map: loaded.success.map } : {}),
    });
    yield* publishTerminalReceipt(event, "healthy");
  });
});

export const makeWayfinderReconciliationReactor = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const processEvent = yield* makeWayfinderReconciliationProcessor;
  const processEventSafely = Effect.fn("WayfinderReconciliationReactor.processEventSafely")(
    function* (event: ReconciliationRequestedEvent) {
      yield* processEvent(event);
    },
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
          return Effect.logWarning("Wayfinder reconciliation reactor failed to process event", {
            threadId: event.payload.threadId,
            skillRunId: event.payload.skillRunId,
            cause: Cause.pretty(cause),
          });
        }),
      ),
  );
  const worker = yield* makeDrainableWorker(processEventSafely);
  const start: WayfinderReconciliationReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) =>
        event.type === "thread.wayfinder-reconciliation-requested"
          ? worker.enqueue(event)
          : Effect.void,
      ),
    );
  });
  return { start, drain: worker.drain } satisfies WayfinderReconciliationReactorShape;
});

export const WayfinderReconciliationReactorLive = Layer.effect(
  WayfinderReconciliationReactor,
  makeWayfinderReconciliationReactor,
);
