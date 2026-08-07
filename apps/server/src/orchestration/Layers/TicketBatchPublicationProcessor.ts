import {
  CommandId,
  type OrchestrationEvent,
  type WayfinderMapProjection,
  type WorkflowTicketBatch,
  type WorkflowTicketBatchPublication,
  type WorkflowTicketIdentity,
  type WorkflowTrackerProjection,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { IssueTracker, type IssueTrackerRepository } from "../../nativeSkills/IssueTracker.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBus } from "../Services/RuntimeReceiptBus.ts";

type PublicationRequestedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.workflow-ticket-batch-publication-requested" }
>;

class TicketBatchPublicationError extends Data.TaggedError("TicketBatchPublicationError")<{
  readonly detail: string;
}> {}

function failureMessage(error: unknown): string {
  if (error instanceof TicketBatchPublicationError) return error.detail;
  return error instanceof Error ? error.message : String(error);
}

function projectionFromMap(input: {
  readonly map: WayfinderMapProjection;
  readonly batch: WorkflowTicketBatch;
  readonly identities: ReadonlyArray<WorkflowTicketIdentity>;
  readonly synchronizedAt: string;
}): WorkflowTrackerProjection {
  const identityByNumber = new Map(input.identities.map((identity) => [identity.number, identity]));
  const batchByKey = new Map(input.batch.tickets.map((ticket) => [ticket.key, ticket]));
  const ticketEntries = input.map.tickets.map((ticket) => {
    const identity = identityByNumber.get(ticket.number);
    const batchTicket = identity === undefined ? undefined : batchByKey.get(identity.key);
    const parentNumber =
      batchTicket?.parentKey === null || batchTicket?.parentKey === undefined
        ? input.map.canonicalReference.number
        : (input.identities.find((candidate) => candidate.key === batchTicket.parentKey)?.number ??
          input.map.canonicalReference.number);
    return {
      ...(identity === undefined ? { key: null } : { key: identity.key }),
      number: ticket.number,
      title: ticket.title,
      url: ticket.url,
      state: ticket.state,
      ...(batchTicket === undefined ? {} : { body: batchTicket.body }),
      parentNumber,
      blockedBy: ticket.blockedBy,
      blocks: ticket.blocks,
      includedInRun: identity !== undefined,
    };
  });
  return {
    status: "healthy",
    canonicalReference: {
      number: input.map.canonicalReference.number,
      title: input.map.canonicalReference.title,
      url: input.map.canonicalReference.url,
      state: input.map.canonicalReference.state,
    },
    ...(input.map.revision !== undefined ? { revision: input.map.revision } : {}),
    batchId: input.batch.id,
    tickets: ticketEntries,
    synchronizedAt: input.synchronizedAt,
  };
}

export const makeTicketBatchPublicationProcessor = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const tracker = yield* IssueTracker;
  const receipts = yield* RuntimeReceiptBus;

  const serverCommandId = Effect.fn("TicketBatchPublicationReactor.serverCommandId")(function* (
    tag: string,
  ) {
    return CommandId.make(`server:${tag}:${yield* crypto.randomUUIDv4}`);
  });

  const publishProgress = Effect.fn("TicketBatchPublicationReactor.publishProgress")(function* (
    event: PublicationRequestedEvent,
    publication: WorkflowTicketBatchPublication,
    ticketCount: number,
    message: string | null,
  ) {
    yield* orchestrationEngine.dispatch({
      type: "thread.workflow.ticketing.publication.update",
      commandId: yield* serverCommandId("ticket-batch-publication"),
      threadId: event.payload.threadId,
      ticketingThreadId: event.payload.ticketingThreadId,
      skillRunId: event.payload.skillRunId,
      publication,
      createdAt: publication.updatedAt,
    });
    yield* receipts.publish({
      type: "workflow.ticket-batch.publication.progress",
      threadId: event.payload.threadId,
      skillRunId: event.payload.skillRunId,
      batchId: event.payload.batch.id,
      status:
        publication.status === "failed"
          ? "failed"
          : publication.status === "succeeded" || publication.status === "reconciled"
            ? "synchronized"
            : "publishing",
      ticketCount,
      createdAt: publication.updatedAt,
      message,
    });
  });

  const verifyParentage = Effect.fn("TicketBatchPublicationReactor.verifyParentage")(
    function* (input: {
      readonly cwd: string;
      readonly repository: IssueTrackerRepository;
      readonly map: WayfinderMapProjection;
      readonly batch: WorkflowTicketBatch;
      readonly identities: ReadonlyArray<WorkflowTicketIdentity>;
    }) {
      const hasChild = tracker.hasChild;
      if (hasChild === undefined) return true;
      const identityByKey = new Map(input.identities.map((identity) => [identity.key, identity]));
      const checks = yield* Effect.forEach(input.batch.tickets, (ticket) => {
        const child = identityByKey.get(ticket.key);
        const parentNumber =
          ticket.parentKey === null
            ? input.map.canonicalReference.number
            : identityByKey.get(ticket.parentKey)?.number;
        return child === undefined || parentNumber === undefined
          ? Effect.succeed(false)
          : hasChild({
              cwd: input.cwd,
              repository: input.repository,
              parentNumber,
              childNumber: child.number,
            });
      });
      return checks.every(Boolean);
    },
  );

  const performPublication = Effect.fn("TicketBatchPublicationReactor.performPublication")(
    function* (input: {
      readonly cwd: string;
      readonly repository: IssueTrackerRepository;
      readonly map: WayfinderMapProjection;
      readonly batch: WorkflowTicketBatch;
      readonly synchronizedAt: string;
    }) {
      const capabilities = yield* tracker.inspectCapabilities({
        cwd: input.cwd,
        repository: input.repository,
      });
      if (!capabilities.supportsIssues || !capabilities.canWriteIssues) {
        return yield* new TicketBatchPublicationError({
          detail: "The configured issue tracker cannot publish issues.",
        });
      }
      if (!capabilities.supportsChildRelationships) {
        return yield* new TicketBatchPublicationError({
          detail: "The configured issue tracker cannot represent Ticket Batch parentage.",
        });
      }
      if (input.batch.blockerEdges.length > 0 && !capabilities.supportsBlockingRelationships) {
        return yield* new TicketBatchPublicationError({
          detail: "The configured issue tracker cannot represent Ticket Batch blocker edges.",
        });
      }
      yield* tracker.ensureLabel({
        cwd: input.cwd,
        repository: input.repository,
        name: "ready-for-agent",
      });
      const identities: WorkflowTicketIdentity[] = [];
      for (const ticket of input.batch.tickets) {
        const identity = yield* tracker.createIssue({
          cwd: input.cwd,
          repository: input.repository,
          key: ticket.key,
          idempotencyKey: `${input.batch.id}:${ticket.key}`,
          title: ticket.title,
          body: ticket.body,
          labels: ["ready-for-agent"],
        });
        if (tracker.addIssueLabel !== undefined) {
          yield* tracker.addIssueLabel({
            cwd: input.cwd,
            repository: input.repository,
            issueNumber: identity.number,
            name: "ready-for-agent",
          });
        }
        identities.push({ key: ticket.key, number: identity.number, url: identity.url });
      }
      const identityByKey = new Map(identities.map((identity) => [identity.key, identity]));
      for (const ticket of input.batch.tickets) {
        const child = identityByKey.get(ticket.key);
        if (child === undefined) {
          return yield* new TicketBatchPublicationError({
            detail: `Tracker did not return an identity for approved ticket '${ticket.key}'.`,
          });
        }
        const parent =
          ticket.parentKey === null
            ? input.map.canonicalReference.number
            : identityByKey.get(ticket.parentKey)?.number;
        if (parent === undefined) {
          return yield* new TicketBatchPublicationError({
            detail: `Tracker could not resolve parent '${ticket.parentKey}' for '${ticket.key}'.`,
          });
        }
        yield* tracker.addChild({
          cwd: input.cwd,
          repository: input.repository,
          parentNumber: parent,
          childNumber: child.number,
        });
      }
      for (const edge of input.batch.blockerEdges) {
        const blocked = identityByKey.get(edge.blockedKey);
        const blocker = identityByKey.get(edge.blockerKey);
        if (blocked === undefined || blocker === undefined) {
          return yield* new TicketBatchPublicationError({
            detail: "Tracker could not resolve an approved blocker edge.",
          });
        }
        yield* tracker.addBlockedBy({
          cwd: input.cwd,
          repository: input.repository,
          blockedNumber: blocked.number,
          blockerNumber: blocker.number,
        });
      }
      if (
        !(yield* verifyParentage({
          cwd: input.cwd,
          repository: input.repository,
          map: input.map,
          batch: input.batch,
          identities,
        }))
      ) {
        return yield* new TicketBatchPublicationError({
          detail: "The tracker did not confirm Ticket Batch parentage.",
        });
      }
      const loaded = yield* tracker.loadWayfinderMap({
        cwd: input.cwd,
        repository: input.repository,
        issueNumber: input.map.canonicalReference.number,
        synchronizedAt: input.synchronizedAt,
      });
      if (loaded.kind !== "loaded") {
        return yield* new TicketBatchPublicationError({
          detail:
            "The tracker did not return a canonical projection after Ticket Batch publication.",
        });
      }
      const missingIdentity = identities.find((identity) => {
        const projected = loaded.map.tickets.find((ticket) => ticket.number === identity.number);
        return projected === undefined || projected.url !== identity.url;
      });
      if (missingIdentity !== undefined) {
        return yield* new TicketBatchPublicationError({
          detail: `The canonical tracker projection did not contain issue #${missingIdentity.number} for approved ticket '${missingIdentity.key}'.`,
        });
      }
      const missingBlockerEdge = input.batch.blockerEdges.find((edge) => {
        const blockedNumber = identityByKey.get(edge.blockedKey)?.number;
        const blockerNumber = identityByKey.get(edge.blockerKey)?.number;
        const blockedTicket =
          blockedNumber === undefined
            ? undefined
            : loaded.map.tickets.find((ticket) => ticket.number === blockedNumber);
        return (
          blockerNumber === undefined || blockedTicket?.blockedBy.includes(blockerNumber) !== true
        );
      });
      if (missingBlockerEdge !== undefined) {
        return yield* new TicketBatchPublicationError({
          detail: `The canonical tracker projection did not contain blocker edge '${missingBlockerEdge.blockerKey}->${missingBlockerEdge.blockedKey}'.`,
        });
      }
      const projection = projectionFromMap({
        map: loaded.map,
        batch: input.batch,
        identities,
        synchronizedAt: input.synchronizedAt,
      });
      return { identities, projection };
    },
  );

  const reconcilePublication = Effect.fn("TicketBatchPublicationReactor.reconcilePublication")(
    function* (input: {
      readonly cwd: string;
      readonly repository: IssueTrackerRepository;
      readonly map: WayfinderMapProjection;
      readonly batch: WorkflowTicketBatch;
      readonly synchronizedAt: string;
    }) {
      const findIssue = tracker.findIssueByIdempotencyKey;
      if (findIssue === undefined) return null;
      const identities = yield* Effect.forEach(input.batch.tickets, (ticket) =>
        findIssue({
          cwd: input.cwd,
          repository: input.repository,
          idempotencyKey: `${input.batch.id}:${ticket.key}`,
        }).pipe(
          Effect.map((issue) =>
            issue === null ? null : { key: ticket.key, number: issue.number, url: issue.url },
          ),
        ),
      );
      if (identities.some((identity) => identity === null)) return null;
      const resolvedIdentities = identities as ReadonlyArray<WorkflowTicketIdentity>;
      const loaded = yield* tracker.reconcileWayfinderMap({
        cwd: input.cwd,
        repository: input.repository,
        issueNumber: input.map.canonicalReference.number,
        synchronizedAt: input.synchronizedAt,
      });
      if (loaded.kind !== "loaded") return null;
      if (
        !(yield* verifyParentage({
          cwd: input.cwd,
          repository: input.repository,
          map: input.map,
          batch: input.batch,
          identities: resolvedIdentities,
        }))
      ) {
        return null;
      }
      const missingIdentity = resolvedIdentities.find((identity) => {
        const projected = loaded.map.tickets.find((ticket) => ticket.number === identity.number);
        return projected === undefined || projected.url !== identity.url;
      });
      if (missingIdentity !== undefined) return null;
      const identityByKey = new Map(resolvedIdentities.map((identity) => [identity.key, identity]));
      const missingBlockerEdge = input.batch.blockerEdges.find((edge) => {
        const blockedNumber = identityByKey.get(edge.blockedKey)?.number;
        const blockerNumber = identityByKey.get(edge.blockerKey)?.number;
        const blockedTicket =
          blockedNumber === undefined
            ? undefined
            : loaded.map.tickets.find((ticket) => ticket.number === blockedNumber);
        return (
          blockerNumber === undefined || blockedTicket?.blockedBy.includes(blockerNumber) !== true
        );
      });
      if (missingBlockerEdge !== undefined) return null;
      return {
        identities: resolvedIdentities,
        projection: projectionFromMap({
          map: loaded.map,
          batch: input.batch,
          identities: resolvedIdentities,
          synchronizedAt: input.synchronizedAt,
        }),
      };
    },
  );

  const publishSynchronized = Effect.fn("TicketBatchPublicationReactor.publishSynchronized")(
    function* (input: {
      readonly event: PublicationRequestedEvent;
      readonly status: "succeeded" | "reconciled";
      readonly identities: ReadonlyArray<WorkflowTicketIdentity>;
      readonly projection: WorkflowTrackerProjection;
      readonly message: string | null;
    }) {
      yield* orchestrationEngine.dispatch({
        type: "thread.workflow.ticketing.publication.update",
        commandId: yield* serverCommandId(`ticket-batch-publication-${input.status}`),
        threadId: input.event.payload.threadId,
        ticketingThreadId: input.event.payload.ticketingThreadId,
        skillRunId: input.event.payload.skillRunId,
        publication: {
          status: input.status,
          batchId: input.event.payload.batch.id,
          identities: input.identities,
          requestedAt: input.event.payload.publication.requestedAt,
          updatedAt: input.event.payload.createdAt,
        },
        trackerProjection: input.projection,
        createdAt: input.event.payload.createdAt,
      });
      yield* receipts.publish({
        type: "workflow.ticket-batch.publication.progress",
        threadId: input.event.payload.threadId,
        skillRunId: input.event.payload.skillRunId,
        batchId: input.event.payload.batch.id,
        status: "synchronized",
        ticketCount: input.event.payload.batch.tickets.length,
        createdAt: input.event.payload.createdAt,
        message: input.message,
      });
    },
  );

  return Effect.fn("TicketBatchPublicationReactor.processEvent")(function* (
    event: PublicationRequestedEvent,
  ) {
    yield* receipts.publish({
      type: "workflow.ticket-batch.publication.progress",
      threadId: event.payload.threadId,
      skillRunId: event.payload.skillRunId,
      batchId: event.payload.batch.id,
      status: "publishing",
      ticketCount: event.payload.batch.tickets.length,
      createdAt: event.payload.createdAt,
      message: null,
    });
    const snapshot = yield* snapshots.getSnapshot();
    const thread = snapshot.threads.find((candidate) => candidate.id === event.payload.threadId);
    const attachment = thread?.workflowAttachment;
    const sourceMap = attachment?.backfilledWayfinderData.wayfinderMap;
    const cwd =
      thread === undefined
        ? undefined
        : resolveThreadWorkspaceCwd({ thread, projects: snapshot.projects });
    const repositoryResult =
      cwd === undefined
        ? Result.succeed(null)
        : yield* tracker.resolveProjectRepository(cwd).pipe(Effect.result);
    const repository = Result.isSuccess(repositoryResult) ? repositoryResult.success : null;
    if (
      thread === undefined ||
      attachment === undefined ||
      sourceMap === undefined ||
      !cwd ||
      !repository
    ) {
      yield* publishProgress(
        event,
        {
          ...event.payload.publication,
          status: "failed",
          failure: "The Ticketing Workstream is not linked to a writable issue tracker.",
          updatedAt: event.payload.createdAt,
        },
        event.payload.batch.tickets.length,
        "The Ticketing Workstream is not linked to a writable issue tracker.",
      );
      return;
    }

    const reconciliationBeforePublication = yield* reconcilePublication({
      cwd,
      repository,
      map: sourceMap,
      batch: event.payload.batch,
      synchronizedAt: event.payload.createdAt,
    }).pipe(Effect.result);
    if (
      Result.isSuccess(reconciliationBeforePublication) &&
      reconciliationBeforePublication.success
    ) {
      yield* publishSynchronized({
        event,
        status: "reconciled",
        identities: reconciliationBeforePublication.success.identities,
        projection: reconciliationBeforePublication.success.projection,
        message: "Existing tracker outcome was reconciled before publication.",
      });
      return;
    }

    const publicationResult = yield* performPublication({
      cwd,
      repository,
      map: sourceMap,
      batch: event.payload.batch,
      synchronizedAt: event.payload.createdAt,
    }).pipe(Effect.result);
    if (Result.isSuccess(publicationResult)) {
      yield* publishSynchronized({
        event,
        status: "succeeded",
        identities: publicationResult.success.identities,
        projection: publicationResult.success.projection,
        message: null,
      });
      return;
    }

    // A failed tracker call may have committed an external mutation. Re-read
    // exact idempotency markers before exposing failure. Never rerun a
    // side-effectful publication automatically; a later explicit publication
    // command performs the same reconciliation before retrying.
    const reconciliationAfterFailure = yield* reconcilePublication({
      cwd,
      repository,
      map: sourceMap,
      batch: event.payload.batch,
      synchronizedAt: event.payload.createdAt,
    }).pipe(Effect.result);
    if (Result.isSuccess(reconciliationAfterFailure) && reconciliationAfterFailure.success) {
      yield* publishSynchronized({
        event,
        status: "reconciled",
        identities: reconciliationAfterFailure.success.identities,
        projection: reconciliationAfterFailure.success.projection,
        message: "Tracker outcome was reconciled after the publication attempt.",
      });
      return;
    }

    const failure = failureMessage(publicationResult.failure);
    yield* publishProgress(
      event,
      {
        ...event.payload.publication,
        status: "failed",
        failure,
        updatedAt: event.payload.createdAt,
      },
      event.payload.batch.tickets.length,
      failure,
    );
  });
});
