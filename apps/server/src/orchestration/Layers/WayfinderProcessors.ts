import {
  CommandId,
  type OrchestrationEvent,
  type WayfinderMapProjection,
  type WayfinderMutation,
  type WayfinderPublication,
} from "@t3tools/contracts";
import { deriveWayfinderDraft } from "@t3tools/shared/wayfinderDraft";
import * as Crypto from "effect/Crypto";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { IssueTracker } from "../../nativeSkills/IssueTracker.ts";
import {
  applyWayfinderMutation,
  type WayfinderMutationTracker,
} from "../../nativeSkills/WayfinderMutation.ts";
import {
  publishWayfinderDraft,
  type WayfinderPublicationProgress,
} from "../../nativeSkills/WayfinderPublication.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBus } from "../Services/RuntimeReceiptBus.ts";

type PublicationRequestedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.wayfinder-publication-requested" }
>;
type MutationRequestedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.wayfinder-mutation-requested" }
>;

class WayfinderReconciliationError extends Data.TaggedError("WayfinderReconciliationError")<{
  readonly detail: string;
}> {}

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
    if (publication.status === "synchronized" && wayfinderMap !== undefined) {
      yield* orchestrationEngine.dispatch({
        type: "thread.wayfinder.reconciliation.update",
        commandId: yield* serverCommandId("wayfinder-publication-reconciliation"),
        threadId: event.payload.threadId,
        skillRunId: event.payload.skillRunId,
        synchronization: {
          status: "healthy",
          reason: "mutation",
          lastAttemptedAt: progress.updatedAt,
          lastSuccessfulAt: progress.updatedAt,
          canMutate: true,
          ...(wayfinderMap.revision !== undefined ? { actualRevision: wayfinderMap.revision } : {}),
        },
        createdAt: progress.updatedAt,
      });
      yield* receipts.publish({
        type: "wayfinder.reconciliation.completed",
        threadId: event.payload.threadId,
        skillRunId: event.payload.skillRunId,
        reason: "mutation",
        status: "healthy",
        createdAt: progress.updatedAt,
      });
    }
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

export const makeWayfinderMutationProcessor = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const issueTracker = yield* IssueTracker;
  const receipts = yield* RuntimeReceiptBus;
  const publishMutation = Effect.fn("WayfinderMutationReactor.publishMutation")(function* (
    event: MutationRequestedEvent,
    mutation: WayfinderMutation,
    wayfinderMap?: WayfinderMapProjection,
  ) {
    const uuid = yield* crypto.randomUUIDv4;
    yield* orchestrationEngine.dispatch({
      type: "thread.wayfinder.mutation.update",
      commandId: CommandId.make(`server:wayfinder-mutation:${uuid}`),
      threadId: event.payload.threadId,
      skillRunId: event.payload.skillRunId,
      mutation,
      ...(wayfinderMap ? { wayfinderMap } : {}),
      createdAt: mutation.updatedAt,
    });
    yield* receipts.publish({
      type: "wayfinder.mutation.progress",
      threadId: event.payload.threadId,
      skillRunId: event.payload.skillRunId,
      actionId: mutation.actionId,
      status: mutation.status,
      createdAt: mutation.updatedAt,
    });
  });

  return Effect.fn("WayfinderMutationReactor.processEvent")(function* (
    event: MutationRequestedEvent,
  ) {
    const snapshot = yield* snapshots.getSnapshot();
    const thread = snapshot.threads.find((candidate) => candidate.id === event.payload.threadId);
    const invocation = (yield* snapshots.getSkillRunsByThreadId(event.payload.threadId)).find(
      (candidate) => candidate.skillRunId === event.payload.skillRunId,
    );
    const map = invocation?.wayfinderMap;
    if (event.payload.runtimeMode === "approval-required" && !event.payload.confirmed) {
      yield* publishMutation(event, {
        actionId: event.payload.actionId,
        action: event.payload.action,
        status: "awaiting-approval",
        error: null,
        updatedAt: event.payload.createdAt,
      });
      return;
    }
    const cwd = thread
      ? resolveThreadWorkspaceCwd({ thread, projects: snapshot.projects })
      : undefined;
    const repository = cwd ? yield* issueTracker.resolveProjectRepository(cwd) : null;
    if (!cwd || !repository || !map) {
      yield* publishMutation(event, {
        actionId: event.payload.actionId,
        action: event.payload.action,
        status: "failed",
        error: "The published Wayfinder map is not linked to a writable GitHub repository.",
        updatedAt: event.payload.createdAt,
      });
      return;
    }

    const base = { cwd, repository };
    const trackerFailure = () =>
      new WayfinderReconciliationError({ detail: "GitHub rejected the Wayfinder change." });
    const mutationWrite = <A, E>(effect: Effect.Effect<A, E>) =>
      effect.pipe(Effect.mapError(trackerFailure));
    const ticket = (number: number) => map.tickets.find((candidate) => candidate.number === number);
    const loadCanonical = Effect.fn("WayfinderMutationReactor.loadCanonical")(function* () {
      const loaded = yield* issueTracker
        .loadWayfinderMap({
          ...base,
          issueNumber: map.canonicalReference.number,
          synchronizedAt: event.payload.createdAt,
        })
        .pipe(Effect.mapError(trackerFailure));
      if (loaded.kind === "loaded") return loaded.map;
      return yield* new WayfinderReconciliationError({
        detail: "GitHub did not return the complete Wayfinder map.",
      });
    });
    const referencedTicketNumbers = (() => {
      const action = event.payload.action;
      if (action.kind === "add-dependency" || action.kind === "remove-dependency") {
        return [action.blockerNumber, action.blockedNumber];
      }
      return "ticketNumber" in action ? [action.ticketNumber] : [];
    })();
    if (referencedTicketNumbers.some((number) => ticket(number) === undefined)) {
      yield* publishMutation(event, {
        actionId: event.payload.actionId,
        action: event.payload.action,
        status: "failed",
        error: "This action references a ticket outside the synchronized Wayfinder map.",
        updatedAt: event.payload.createdAt,
      });
      return;
    }
    yield* publishMutation(event, {
      actionId: event.payload.actionId,
      action: event.payload.action,
      status: "mutating",
      error: null,
      updatedAt: event.payload.createdAt,
    });
    type Tracker = WayfinderMutationTracker<WayfinderReconciliationError>;
    const createTicket: Tracker["createTicket"] = Effect.fn(
      "WayfinderMutationReactor.createTicket",
    )(function* (input) {
      yield* issueTracker.ensureLabel({
        ...base,
        name: `wayfinder:${input.classification}`,
      });
      const created = yield* issueTracker.createIssue({
        ...base,
        key: input.actionId,
        idempotencyKey: `${event.payload.skillRunId}:${input.actionId}`,
        title: input.title,
        body: "Wayfinder decision ticket created from the T3 Workbench.",
        labels: ["wayfinder:decision", `wayfinder:${input.classification}`],
      });
      yield* issueTracker.addChild({
        ...base,
        parentNumber: map.canonicalReference.number,
        childNumber: created.number,
      });
    }, Effect.mapError(trackerFailure));
    const resolveTicket: Tracker["resolveTicket"] = Effect.fn(
      "WayfinderMutationReactor.resolveTicket",
    )(function* (input) {
      const target = ticket(input.ticketNumber);
      const decisions = [
        ...map.decisionsSoFar.map(
          (decision) =>
            `- ${decision.url ? `[${decision.title}](${decision.url})` : decision.title}${decision.summary ? ` — ${decision.summary}` : ""}`,
        ),
        `- [${target?.title ?? `#${input.ticketNumber}`}](${target?.url ?? map.canonicalReference.url}) — ${input.resolution}`,
      ].join("\n");
      yield* issueTracker.addIssueComment({
        ...base,
        issueNumber: input.ticketNumber,
        body: `Resolution: ${input.resolution}`,
      });
      yield* issueTracker.updateWayfinderDecisions({
        ...base,
        issueNumber: map.canonicalReference.number,
        value: decisions,
      });
    }, Effect.mapError(trackerFailure));
    const result = yield* applyWayfinderMutation(
      {
        actionId: event.payload.actionId,
        action: event.payload.action,
        synchronizedAt: event.payload.createdAt,
      },
      {
        updateMap: (input) =>
          mutationWrite(
            issueTracker.updateWayfinderMapField({
              ...base,
              issueNumber: map.canonicalReference.number,
              field: input.field,
              value: input.value,
            }),
          ),
        createTicket,
        renameTicket: (input) =>
          mutationWrite(
            issueTracker.updateIssueTitle({
              ...base,
              issueNumber: input.ticketNumber,
              title: input.title,
            }),
          ),
        classifyTicket: (input) =>
          mutationWrite(
            issueTracker.setWayfinderClassification({
              ...base,
              issueNumber: input.ticketNumber,
              previous: ticket(input.ticketNumber)?.classification ?? "unknown",
              classification: input.classification,
            }),
          ),
        addDependency: (input) =>
          mutationWrite(
            issueTracker.addBlockedBy({
              ...base,
              blockedNumber: input.blockedNumber,
              blockerNumber: input.blockerNumber,
            }),
          ),
        removeDependency: (input) =>
          mutationWrite(
            issueTracker.removeBlockedBy({
              ...base,
              blockedNumber: input.blockedNumber,
              blockerNumber: input.blockerNumber,
            }),
          ),
        resolveTicket,
        setTicketState: (input) =>
          mutationWrite(
            issueTracker.setIssueState({
              ...base,
              issueNumber: input.ticketNumber,
              state: input.state,
            }),
          ),
        reconcile: loadCanonical,
      },
    ).pipe(Effect.result);
    if (Result.isFailure(result)) {
      const correction = yield* loadCanonical().pipe(Effect.result);
      yield* publishMutation(
        event,
        {
          actionId: event.payload.actionId,
          action: event.payload.action,
          status: "failed",
          error: Result.isSuccess(correction)
            ? "GitHub only partially applied this change; the canonical map was refreshed."
            : "GitHub could not apply and reconcile this Wayfinder change.",
          updatedAt: event.payload.createdAt,
        },
        Result.isSuccess(correction) ? correction.success : undefined,
      );
      return;
    }
    yield* publishMutation(
      event,
      {
        actionId: event.payload.actionId,
        action: event.payload.action,
        status: "synchronized",
        error: null,
        updatedAt: result.success.lastSynchronizedAt,
      },
      result.success,
    );
  });
});
