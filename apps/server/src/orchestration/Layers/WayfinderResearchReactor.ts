import {
  CommandId,
  MessageId,
  type OrchestrationEvent,
  type SkillInvocation,
  type ThreadId,
  type WayfinderResearchState,
  type WayfinderResearchTicketRun,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { BackgroundPolicy } from "../../background/BackgroundPolicy.ts";
import {
  createWayfinderResearchState,
  countActiveWayfinderResearchTickets,
  parseWayfinderResearchResult,
  selectAutomaticWayfinderResearchTickets,
  selectQueuedWayfinderResearchTickets,
  updateWayfinderResearchTicket,
} from "../../nativeSkills/WayfinderResearch.ts";
import {
  buildWayfinderTicketThreadSeed,
  wayfinderTicketThreadId,
} from "../../nativeSkills/WayfinderTicketThread.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBus } from "../Services/RuntimeReceiptBus.ts";
import {
  WayfinderResearchReactor,
  type WayfinderResearchReactorShape,
} from "../Services/WayfinderResearchReactor.ts";

type ResearchRequestedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.wayfinder-research-requested" }
>;
type ResearchTriggerEvent = Extract<
  OrchestrationEvent,
  | { type: "thread.wayfinder-research-requested" }
  | { type: "thread.wayfinder-research-updated" }
  | { type: "thread.wayfinder-mutation-updated" }
  | { type: "thread.wayfinder-reconciliation-updated" }
  | { type: "thread.turn-diff-completed" }
>;

const researchActionId = (ticketNumber: number) => `wayfinder-research:${ticketNumber}`;
const researchResolutionActionId = (ticketNumber: number) =>
  `wayfinder-research-resolution:${ticketNumber}`;

export const makeWayfinderResearchProcessor = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const backgroundPolicy = yield* BackgroundPolicy;
  const receipts = yield* RuntimeReceiptBus;

  const serverCommandId = Effect.fn("WayfinderResearchReactor.serverCommandId")(function* (
    tag: string,
  ) {
    return CommandId.make(`server:${tag}:${yield* crypto.randomUUIDv4}`);
  });

  const getSource = Effect.fn("WayfinderResearchReactor.getSource")(function* (
    threadId: ThreadId,
    skillRunId: SkillInvocation["skillRunId"],
  ) {
    const snapshot = yield* snapshots.getSnapshot();
    const thread = snapshot.threads.find((candidate) => candidate.id === threadId);
    const invocation = (yield* snapshots.getSkillRunsByThreadId(threadId)).find(
      (candidate) => candidate.skillRunId === skillRunId,
    );
    return { snapshot, thread, invocation };
  });

  const publishResearch = Effect.fn("WayfinderResearchReactor.publishResearch")(function* (input: {
    readonly threadId: ThreadId;
    readonly invocation: SkillInvocation;
    readonly research: WayfinderResearchState;
    readonly ticket?: WayfinderResearchTicketRun;
  }) {
    yield* orchestrationEngine.dispatch({
      type: "thread.wayfinder.research.update",
      commandId: yield* serverCommandId("wayfinder-research"),
      threadId: input.threadId,
      skillRunId: input.invocation.skillRunId,
      research: input.research,
      createdAt: input.research.updatedAt,
    });
    if (input.ticket) {
      yield* receipts.publish({
        type: "wayfinder.research.progress",
        threadId: input.threadId,
        skillRunId: input.invocation.skillRunId,
        ticketNumber: input.ticket.ticketNumber,
        status: input.ticket.status,
        createdAt: input.ticket.updatedAt,
      });
    }
  });

  const setTicket = Effect.fn("WayfinderResearchReactor.setTicket")(function* (input: {
    readonly threadId: ThreadId;
    readonly invocation: SkillInvocation;
    readonly ticket: WayfinderResearchTicketRun;
    readonly research?: WayfinderResearchState;
  }) {
    const research =
      input.research ??
      input.invocation.wayfinderResearch ??
      createWayfinderResearchState(input.ticket.updatedAt);
    yield* publishResearch({
      threadId: input.threadId,
      invocation: input.invocation,
      research: updateWayfinderResearchTicket(research, input.ticket),
      ticket: input.ticket,
    });
  });

  const startExistingLinkedTurn = Effect.fn("WayfinderResearchReactor.startExistingLinkedTurn")(
    function* (input: {
      readonly sourceThreadId: ThreadId;
      readonly source: SkillInvocation;
      readonly ticketNumber: number;
      readonly createdAt: string;
    }) {
      const snapshot = yield* snapshots.getSnapshot();
      const sourceThread = snapshot.threads.find((thread) => thread.id === input.sourceThreadId);
      const map = input.source.wayfinderMap;
      const ticket = map?.tickets.find((candidate) => candidate.number === input.ticketNumber);
      if (!sourceThread || !map || !ticket) return false;
      const targetThreadId = wayfinderTicketThreadId(input.source.workstreamId, input.ticketNumber);
      const targetThread = snapshot.threads.find((thread) => thread.id === targetThreadId);
      if (!targetThread || targetThread.latestTurn?.state === "running") return false;
      const seed = buildWayfinderTicketThreadSeed({
        workstreamId: input.source.workstreamId,
        sourceSkillRunId: input.source.skillRunId,
        sourceThreadId: input.sourceThreadId,
        skill: input.source.skill,
        map,
        ticket,
      });
      const retryId = yield* crypto.randomUUIDv4;
      yield* orchestrationEngine.dispatch({
        type: "thread.turn.start",
        commandId: yield* serverCommandId("wayfinder-research-retry"),
        threadId: targetThreadId,
        message: {
          messageId: MessageId.make(`wayfinder-ticket-retry:${targetThreadId}:${retryId}`),
          role: "user",
          text: seed.message,
          attachments: [],
        },
        modelSelection: sourceThread.modelSelection,
        titleSeed: seed.title,
        runtimeMode: sourceThread.runtimeMode,
        interactionMode: sourceThread.interactionMode,
        skillInvocation: {
          skill: input.source.skill,
          arguments: seed.message,
          action: {
            id: "work-ticket",
            ticketNumber: input.ticketNumber,
            sourceSkillRunId: input.source.skillRunId,
            sourceThreadId: input.sourceThreadId,
          },
          execution: input.source.execution,
          wayfinderMap: map,
          wayfinderSynchronizedAt: map.lastSynchronizedAt,
          reconnectWorkstreamId: input.source.workstreamId,
        },
        createdAt: input.createdAt,
      });
      return true;
    },
  );

  const scheduleAutomatic = Effect.fn("WayfinderResearchReactor.scheduleAutomatic")(function* (
    threadId: ThreadId,
    skillRunId: SkillInvocation["skillRunId"],
    createdAt: string,
  ) {
    const { thread, invocation } = yield* getSource(threadId, skillRunId);
    if (
      !thread ||
      !invocation?.wayfinderMap ||
      invocation.action?.id === "work-ticket" ||
      invocation.wayfinderSynchronization?.status === "unavailable" ||
      invocation.wayfinderSynchronization?.status === "conflict" ||
      thread.runtimeMode === "approval-required"
    ) {
      return;
    }
    const research = invocation.wayfinderResearch ?? createWayfinderResearchState(createdAt);
    if (!(yield* backgroundPolicy.shouldRunScopeWork({ type: "thread", threadId }))) return;
    const queued = selectQueuedWayfinderResearchTickets({
      map: invocation.wayfinderMap,
      research,
    });
    if (queued.length > 0) {
      for (const run of queued) {
        yield* orchestrationEngine.dispatch({
          type: "thread.wayfinder.research",
          commandId: yield* serverCommandId("wayfinder-research-queued"),
          threadId,
          skillRunId,
          action: {
            kind: run.retrying ? "retry-ticket" : "start-ticket",
            ticketNumber: run.ticketNumber,
          },
          ...(run.launchMode === "automatic" ? { launchMode: "automatic" as const } : {}),
          createdAt,
        });
      }
      return;
    }
    for (const ticketNumber of selectAutomaticWayfinderResearchTickets({
      map: invocation.wayfinderMap,
      research,
    })) {
      yield* orchestrationEngine.dispatch({
        type: "thread.wayfinder.research",
        commandId: yield* serverCommandId("wayfinder-research-auto"),
        threadId,
        skillRunId,
        action: { kind: "start-ticket", ticketNumber },
        launchMode: "automatic",
        createdAt,
      });
    }
  });

  const processRequested = Effect.fn("WayfinderResearchReactor.processRequested")(function* (
    event: ResearchRequestedEvent,
  ) {
    const { thread, invocation } = yield* getSource(
      event.payload.threadId,
      event.payload.skillRunId,
    );
    if (!thread || !invocation?.wayfinderMap) return;
    const current =
      invocation.wayfinderResearch ?? createWayfinderResearchState(event.payload.createdAt);
    const action = event.payload.action;
    if (action.kind === "pause-automatic-launches" || action.kind === "resume-automatic-launches") {
      const research = {
        ...current,
        automaticLaunchesPaused: action.kind === "pause-automatic-launches",
        updatedAt: event.payload.createdAt,
      };
      yield* publishResearch({ threadId: event.payload.threadId, invocation, research });
      if (!research.automaticLaunchesPaused) {
        yield* scheduleAutomatic(
          event.payload.threadId,
          event.payload.skillRunId,
          event.payload.createdAt,
        );
      }
      return;
    }
    if (event.payload.launchMode === "automatic" && current.automaticLaunchesPaused) {
      return;
    }

    const ticket = invocation.wayfinderMap.tickets.find(
      (candidate) => candidate.number === action.ticketNumber,
    );
    if (!ticket || ticket.classification !== "research" || ticket.state !== "open") return;
    const previous = current.tickets.find((run) => run.ticketNumber === ticket.number);
    const launchMode = event.payload.launchMode;

    if (action.kind === "cancel-ticket") {
      if (
        !previous ||
        (previous.status !== "queued" &&
          previous.status !== "claiming" &&
          previous.status !== "active")
      ) {
        return;
      }
      const threadId =
        (previous?.threadId as ThreadId | undefined) ??
        wayfinderTicketThreadId(invocation.workstreamId, ticket.number);
      const cancelling: WayfinderResearchTicketRun = {
        ticketNumber: ticket.number,
        launchMode: previous?.launchMode ?? launchMode,
        status: "cancelling",
        threadId,
        updatedAt: event.payload.createdAt,
      };
      yield* setTicket({
        threadId: event.payload.threadId,
        invocation,
        research: current,
        ticket: cancelling,
      });
      const linked = (yield* snapshots.getSnapshot()).threads.find(
        (candidate) => candidate.id === threadId,
      );
      if (linked?.latestTurn?.state === "running") {
        yield* orchestrationEngine.dispatch({
          type: "thread.turn.interrupt",
          commandId: yield* serverCommandId("wayfinder-research-cancel"),
          threadId,
          turnId: linked.latestTurn.turnId,
          createdAt: event.payload.createdAt,
        });
      }
      if (ticket.claimedBy !== null) {
        yield* orchestrationEngine.dispatch({
          type: "thread.wayfinder.mutate",
          commandId: yield* serverCommandId("wayfinder-research-release"),
          threadId: event.payload.threadId,
          skillRunId: invocation.skillRunId,
          actionId: researchActionId(ticket.number),
          action: { kind: "release-ticket", ticketNumber: ticket.number },
          confirmed: false,
          createdAt: event.payload.createdAt,
        });
      } else {
        yield* setTicket({
          threadId: event.payload.threadId,
          invocation,
          research: updateWayfinderResearchTicket(current, cancelling),
          ticket: { ...cancelling, status: "cancelled" },
        });
      }
      return;
    }

    const queued: WayfinderResearchTicketRun = {
      ...previous,
      ticketNumber: ticket.number,
      launchMode,
      retrying: action.kind === "retry-ticket",
      status: "queued",
      ...(previous?.threadId !== undefined ? { threadId: previous.threadId } : {}),
      updatedAt: event.payload.createdAt,
    };
    yield* setTicket({
      threadId: event.payload.threadId,
      invocation,
      research: current,
      ticket: queued,
    });
    if (
      !(yield* backgroundPolicy.shouldRunScopeWork({
        type: "thread",
        threadId: event.payload.threadId,
      })) ||
      thread.runtimeMode === "approval-required"
    ) {
      return;
    }
    const activeCount = countActiveWayfinderResearchTickets(current, ticket.number);
    if (activeCount >= current.concurrencyLimit) return;

    if (action.kind === "retry-ticket" && ticket.claimedBy !== null) {
      const restarted = yield* startExistingLinkedTurn({
        sourceThreadId: event.payload.threadId,
        source: invocation,
        ticketNumber: ticket.number,
        createdAt: event.payload.createdAt,
      });
      if (restarted) {
        yield* setTicket({
          threadId: event.payload.threadId,
          invocation,
          research: updateWayfinderResearchTicket(current, queued),
          ticket: {
            ...queued,
            status: "active",
            threadId: wayfinderTicketThreadId(invocation.workstreamId, ticket.number),
          },
        });
      }
      return;
    }

    const claiming = { ...queued, status: "claiming" as const };
    yield* setTicket({
      threadId: event.payload.threadId,
      invocation,
      research: updateWayfinderResearchTicket(current, queued),
      ticket: claiming,
    });
    yield* orchestrationEngine.dispatch({
      type: "thread.wayfinder.mutate",
      commandId: yield* serverCommandId("wayfinder-research-claim"),
      threadId: event.payload.threadId,
      skillRunId: invocation.skillRunId,
      actionId: researchActionId(ticket.number),
      action: { kind: "claim-ticket", ticketNumber: ticket.number },
      confirmed: false,
      createdAt: event.payload.createdAt,
    });
  });

  const processMutation = Effect.fn("WayfinderResearchReactor.processMutation")(function* (
    event: Extract<OrchestrationEvent, { type: "thread.wayfinder-mutation-updated" }>,
  ) {
    const action = event.payload.mutation.action;
    if (!("ticketNumber" in action)) return;
    const ticketNumber = action.ticketNumber;
    if (
      event.payload.mutation.actionId !== researchActionId(ticketNumber) &&
      event.payload.mutation.actionId !== researchResolutionActionId(ticketNumber)
    ) {
      return;
    }
    const { invocation } = yield* getSource(event.payload.threadId, event.payload.skillRunId);
    if (!invocation) return;
    const current = invocation.wayfinderResearch ?? createWayfinderResearchState(event.occurredAt);
    const previous = current.tickets.find((run) => run.ticketNumber === ticketNumber);
    if (!previous) return;
    if (
      action.kind === "claim-ticket" &&
      event.payload.mutation.status === "synchronized" &&
      (previous.status === "cancelling" || previous.status === "cancelled")
    ) {
      yield* orchestrationEngine.dispatch({
        type: "thread.wayfinder.mutate",
        commandId: yield* serverCommandId("wayfinder-research-release-after-cancel"),
        threadId: event.payload.threadId,
        skillRunId: invocation.skillRunId,
        actionId: researchActionId(ticketNumber),
        action: { kind: "release-ticket", ticketNumber },
        confirmed: false,
        createdAt: event.occurredAt,
      });
      return;
    }
    if (
      action.kind === "claim-ticket" &&
      event.payload.mutation.status === "synchronized" &&
      previous.retrying
    ) {
      yield* startExistingLinkedTurn({
        sourceThreadId: event.payload.threadId,
        source: invocation,
        ticketNumber,
        createdAt: event.occurredAt,
      });
    }
    const status =
      event.payload.mutation.status === "failed"
        ? ("failed" as const)
        : event.payload.mutation.status !== "synchronized"
          ? previous.status
          : action.kind === "claim-ticket"
            ? ("active" as const)
            : action.kind === "release-ticket"
              ? ("cancelled" as const)
              : action.kind === "complete-hitl-ticket"
                ? ("resolved" as const)
                : previous.status;
    if (status === previous.status && event.payload.mutation.status !== "failed") return;
    yield* setTicket({
      threadId: event.payload.threadId,
      invocation,
      research: current,
      ticket: {
        ...previous,
        status,
        ...(status === "active"
          ? { threadId: wayfinderTicketThreadId(invocation.workstreamId, ticketNumber) }
          : {}),
        ...(event.payload.mutation.error ? { error: event.payload.mutation.error } : {}),
        updatedAt: event.occurredAt,
      },
    });
  });

  const processCompletion = Effect.fn("WayfinderResearchReactor.processCompletion")(function* (
    event: Extract<OrchestrationEvent, { type: "thread.turn-diff-completed" }>,
  ) {
    const snapshot = yield* snapshots.getSnapshot();
    const linkedThread = snapshot.threads.find(
      (candidate) => candidate.id === event.payload.threadId,
    );
    const linkedInvocation = linkedThread?.latestTurn?.skillInvocation;
    const action =
      linkedInvocation?.action?.id === "work-ticket" ? linkedInvocation.action : undefined;
    if (!linkedThread || !linkedInvocation || !action?.sourceThreadId) return;
    const sourceRuns = yield* snapshots.getSkillRunsByThreadId(action.sourceThreadId);
    const source = sourceRuns.find((candidate) => candidate.skillRunId === action.sourceSkillRunId);
    const ticket = source?.wayfinderMap?.tickets.find(
      (candidate) => candidate.number === action.ticketNumber,
    );
    if (!source || ticket?.classification !== "research") return;
    const current = source.wayfinderResearch ?? createWayfinderResearchState(event.occurredAt);
    const previous = current.tickets.find((run) => run.ticketNumber === ticket.number);
    if (!previous || previous.status === "cancelling" || previous.status === "cancelled") {
      return;
    }
    const output =
      linkedThread.messages.find((message) => message.id === event.payload.assistantMessageId)
        ?.text ??
      linkedThread.messages
        .filter((message) => message.role === "assistant")
        .toSorted((left, right) => left.updatedAt.localeCompare(right.updatedAt))
        .at(-1)?.text ??
      "";
    const result = event.payload.status === "ready" ? parseWayfinderResearchResult(output) : null;
    if (result?.status !== "resolved") {
      yield* setTicket({
        threadId: action.sourceThreadId,
        invocation: source,
        research: current,
        ticket: {
          ...previous,
          status: "failed",
          ...(output.trim() !== "" ? { output: output.trim() } : {}),
          error:
            result?.summary ??
            (event.payload.status === "ready"
              ? "Research finished without a resolved receipt."
              : "Research was interrupted or failed before a completion receipt."),
          updatedAt: event.occurredAt,
        },
      });
      return;
    }
    const resolving: WayfinderResearchTicketRun = {
      ...previous,
      status: "resolving",
      output: result.summary,
      updatedAt: event.occurredAt,
    };
    yield* setTicket({
      threadId: action.sourceThreadId,
      invocation: source,
      research: current,
      ticket: resolving,
    });
    yield* orchestrationEngine.dispatch({
      type: "thread.wayfinder.mutate",
      commandId: yield* serverCommandId("wayfinder-research-resolve"),
      threadId: event.payload.threadId,
      skillRunId: linkedInvocation.skillRunId,
      actionId: researchResolutionActionId(ticket.number),
      action: {
        kind: "complete-hitl-ticket",
        ticketNumber: ticket.number,
        outcome: "resolved",
        resolution: result.summary,
        contextPointer: ticket.url,
        graduatedFog: [],
      },
      confirmed: false,
      createdAt: event.occurredAt,
    });
  });

  return Effect.fn("WayfinderResearchReactor.processEvent")(function* (
    event: ResearchTriggerEvent,
  ) {
    switch (event.type) {
      case "thread.wayfinder-research-requested":
        yield* processRequested(event);
        return;
      case "thread.wayfinder-research-updated":
        if (!event.payload.research.automaticLaunchesPaused) {
          yield* scheduleAutomatic(
            event.payload.threadId,
            event.payload.skillRunId,
            event.occurredAt,
          );
        }
        return;
      case "thread.wayfinder-mutation-updated":
        yield* processMutation(event);
        return;
      case "thread.turn-diff-completed":
        yield* processCompletion(event);
        return;
      case "thread.wayfinder-reconciliation-updated":
        if (event.payload.synchronization.status === "healthy") {
          yield* scheduleAutomatic(
            event.payload.threadId,
            event.payload.skillRunId,
            event.occurredAt,
          );
        }
    }
  });
});

export const makeWayfinderResearchReactor = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const processEvent = yield* makeWayfinderResearchProcessor;
  const worker = yield* makeDrainableWorker(
    Effect.fn("WayfinderResearchReactor.processEventSafely")(
      function* (event: ResearchTriggerEvent) {
        yield* processEvent(event);
      },
      (effect, event) =>
        effect.pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : Effect.logWarning("Wayfinder research reactor failed to process event", {
                  eventType: event.type,
                  cause: Cause.pretty(cause),
                }),
          ),
        ),
    ),
  );
  const start: WayfinderResearchReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) =>
        event.type === "thread.wayfinder-research-requested" ||
        event.type === "thread.wayfinder-research-updated" ||
        event.type === "thread.wayfinder-mutation-updated" ||
        event.type === "thread.wayfinder-reconciliation-updated" ||
        event.type === "thread.turn-diff-completed"
          ? worker.enqueue(event)
          : Effect.void,
      ),
    );
  });
  return { start, drain: worker.drain } satisfies WayfinderResearchReactorShape;
});

export const WayfinderResearchReactorLive = Layer.effect(
  WayfinderResearchReactor,
  makeWayfinderResearchReactor,
);
