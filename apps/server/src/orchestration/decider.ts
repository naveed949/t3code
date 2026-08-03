import {
  EventId,
  SkillRunId,
  WayfinderMutationAction,
  WorkstreamId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type SkillInvocation,
  type WorkflowAttachmentWayfinderData,
} from "@t3tools/contracts";
import { createEmptyWayfinderDraft } from "@t3tools/shared/wayfinderDraft";
import { deriveWayfinderReadiness } from "@t3tools/shared/wayfinderReadiness";
import * as DateTime from "effect/DateTime";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import { OrchestrationCommandInvariantError } from "./Errors.ts";
import {
  activeWayfinderDraftSkillRunId,
  approvedWayfinderPublicationSkillRunId,
  hasActiveWayfinderDraftAuthority,
} from "../nativeSkills/WayfinderDraftMutationGuard.ts";
import {
  listThreadsByProjectId,
  requireActiveProjectWorkspaceRootAbsent,
  requireProject,
  requireProjectAbsent,
  requireThread,
  requireThreadArchived,
  requireThreadAbsent,
  requireThreadNotArchived,
} from "./commandInvariants.ts";
import { projectEvent } from "./projector.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
const decodePublishedWayfinderPayload = Schema.decodeUnknownOption(
  Schema.Struct({ skillRunId: SkillRunId }),
);
const decodeWayfinderMutationApprovalPayload = Schema.decodeUnknownOption(
  Schema.Struct({
    skillRunId: SkillRunId,
    actionId: Schema.String,
    action: WayfinderMutationAction,
  }),
);

function isWorkflowAttachableWayfinderInvocation(invocation: SkillInvocation): boolean {
  return (
    invocation.skill.name === "wayfinder" &&
    invocation.execution.mode === "native" &&
    invocation.action?.id !== "work-ticket" &&
    (invocation.wayfinderMap !== undefined || invocation.wayfinderDraft !== undefined)
  );
}

function backfillWorkflowAttachmentWayfinderData(
  invocation: SkillInvocation,
): WorkflowAttachmentWayfinderData {
  return {
    ...(invocation.wayfinderMap !== undefined ? { wayfinderMap: invocation.wayfinderMap } : {}),
    ...(invocation.wayfinderDraft !== undefined
      ? { wayfinderDraft: invocation.wayfinderDraft }
      : {}),
    ...(invocation.wayfinderPublication !== undefined
      ? { wayfinderPublication: invocation.wayfinderPublication }
      : {}),
    ...(invocation.wayfinderSynchronizedAt !== undefined
      ? { wayfinderSynchronizedAt: invocation.wayfinderSynchronizedAt }
      : {}),
    ...(invocation.wayfinderSynchronization !== undefined
      ? { wayfinderSynchronization: invocation.wayfinderSynchronization }
      : {}),
  };
}

function sameWayfinderMutationAction(
  left: WayfinderMutationAction,
  right: WayfinderMutationAction,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "update-map-field":
      return right.kind === left.kind && left.field === right.field && left.value === right.value;
    case "create-ticket":
      return (
        right.kind === left.kind &&
        left.title === right.title &&
        left.classification === right.classification
      );
    case "rename-ticket":
      return (
        right.kind === left.kind &&
        left.ticketNumber === right.ticketNumber &&
        left.title === right.title
      );
    case "classify-ticket":
      return (
        right.kind === left.kind &&
        left.ticketNumber === right.ticketNumber &&
        left.classification === right.classification
      );
    case "add-dependency":
    case "remove-dependency":
      return (
        right.kind === left.kind &&
        left.blockerNumber === right.blockerNumber &&
        left.blockedNumber === right.blockedNumber
      );
    case "resolve-ticket":
      return (
        right.kind === left.kind &&
        left.ticketNumber === right.ticketNumber &&
        left.resolution === right.resolution
      );
    case "close-ticket":
    case "reopen-ticket":
    case "claim-ticket":
    case "release-ticket":
      return right.kind === left.kind && left.ticketNumber === right.ticketNumber;
    case "complete-hitl-ticket":
      return (
        right.kind === left.kind &&
        left.ticketNumber === right.ticketNumber &&
        left.outcome === right.outcome &&
        left.resolution === right.resolution &&
        left.contextPointer === right.contextPointer &&
        left.graduatedFog.length === right.graduatedFog.length &&
        left.graduatedFog.every((ticket, ticketIndex) => {
          const candidate = right.graduatedFog[ticketIndex];
          return (
            candidate !== undefined &&
            ticket.key === candidate.key &&
            ticket.fog === candidate.fog &&
            ticket.title === candidate.title &&
            ticket.classification === candidate.classification &&
            ticket.blockedBy.length === candidate.blockedBy.length &&
            ticket.blockedBy.every((blocker, blockerIndex) => {
              const candidateBlocker = candidate.blockedBy[blockerIndex];
              return (
                candidateBlocker !== undefined &&
                blocker.kind === candidateBlocker.kind &&
                (blocker.kind === "ticket"
                  ? candidateBlocker.kind === "ticket" &&
                    blocker.ticketNumber === candidateBlocker.ticketNumber
                  : candidateBlocker.kind === "graduated" && blocker.key === candidateBlocker.key)
              );
            })
          );
        })
      );
  }
}

// Session adoption takes seconds; a user message still unadopted after this
// window is a failed/stale start, not pending work. Mirrors the client's
// QUEUED_TURN_START_GRACE_MS in client-runtime threadSettled.ts.
const QUEUED_TURN_START_GRACE_MS = 2 * 60 * 1_000;

/**
 * Blocked-on-you work derived from the thread's retained activities: an
 * approval or user-input request with no later resolution for the same
 * requestId. The server-side twin of the shell's hasPendingApprovals /
 * hasPendingUserInput flags, which the decider read model does not carry.
 * The clearing rules MUST match ProjectionPipeline's pending accounting —
 * resolved activities always clear, respond.failed clears only when the
 * failure detail marks the request stale/unknown — or settle would be
 * rejected on threads whose shell flags read as clear.
 */
function isStaleRequestFailureDetail(payload: Record<string, unknown> | null): boolean {
  const detail = typeof payload?.detail === "string" ? payload.detail.toLowerCase() : null;
  if (detail === null) return false;
  return (
    detail.includes("stale pending approval request") ||
    detail.includes("unknown pending approval request") ||
    detail.includes("unknown pending permission request") ||
    detail.includes("stale pending user-input request") ||
    detail.includes("unknown pending user-input request") ||
    detail.includes("unknown pending user input request") ||
    detail.includes("unknown pending codex user input request")
  );
}

// Scans the read model's activities, which the projector caps at the most
// recent 500. That bound is safe here: an OPEN approval/user-input request
// blocks its turn, so the thread cannot accumulate hundreds of later
// activities while one is outstanding — a request that has scrolled out of
// the window is one whose turn kept running, i.e. it was resolved or went
// stale. (The projection pipeline's pendingApprovalCount reads the same
// capped stream and stays consistent with this view.)
function hasOpenBlockingRequest(thread: {
  readonly activities: ReadonlyArray<{ readonly kind: string; readonly payload: unknown }>;
}): boolean {
  const openRequestIds = new Set<string>();
  for (const activity of thread.activities) {
    const payload =
      typeof activity.payload === "object" && activity.payload !== null
        ? (activity.payload as Record<string, unknown>)
        : null;
    const requestId = typeof payload?.requestId === "string" ? payload.requestId : null;
    if (requestId === null) continue;
    if (activity.kind === "approval.requested" || activity.kind === "user-input.requested") {
      openRequestIds.add(requestId);
    } else if (activity.kind === "approval.resolved" || activity.kind === "user-input.resolved") {
      openRequestIds.delete(requestId);
    } else if (
      (activity.kind === "provider.approval.respond.failed" ||
        activity.kind === "provider.user-input.respond.failed") &&
      isStaleRequestFailureDetail(payload)
    ) {
      openRequestIds.delete(requestId);
    }
  }
  return openRequestIds.size > 0;
}

/**
 * A queued turn start — a user message no turn has picked up yet — is work
 * in flight even though session is still null (turn.start emits
 * message-sent + turn-start-requested; the session arrives later). Detection
 * mirrors the client's hasQueuedTurnStart: the newest user message is
 * strictly newer than every latestTurn timestamp (adoption stamps the new
 * turn's requestedAt with the message time, clearing this), and only within
 * the adoption grace window — historical threads whose last user message
 * postdates their turn timestamps (older-server data, mid-turn messages)
 * must not be blocked forever. A failed session start (status "error")
 * clears the block immediately.
 *
 * The age check is bounded on BOTH sides: message timestamps are
 * client-supplied, so a client clock ahead of the server yields a negative
 * age. Without the lower bound that negative age satisfies `<= grace` for
 * as long as the skew lasts, extending the block far past the intended two
 * minutes.
 */
function threadHasQueuedTurnStart(
  thread: {
    readonly messages: ReadonlyArray<{ readonly role: string; readonly createdAt: string }>;
    readonly latestTurn: {
      readonly requestedAt: string;
      readonly startedAt: string | null;
      readonly completedAt: string | null;
    } | null;
    readonly session: { readonly status: string } | null;
  },
  occurredAt: string,
): boolean {
  const latestUserMessageAtMs = thread.messages.reduce(
    (latest, message) =>
      message.role === "user" ? Math.max(latest, Date.parse(message.createdAt)) : latest,
    Number.NEGATIVE_INFINITY,
  );
  const latestTurnAtMs =
    thread.latestTurn === null
      ? Number.NEGATIVE_INFINITY
      : Math.max(
          ...[
            thread.latestTurn.requestedAt,
            thread.latestTurn.startedAt,
            thread.latestTurn.completedAt,
          ].map((candidate) =>
            candidate == null ? Number.NEGATIVE_INFINITY : Date.parse(candidate),
          ),
        );
  const queuedAgeMs = Date.parse(occurredAt) - latestUserMessageAtMs;
  return (
    thread.session?.status !== "error" &&
    Number.isFinite(latestUserMessageAtMs) &&
    latestUserMessageAtMs > latestTurnAtMs &&
    Math.abs(queuedAgeMs) <= QUEUED_TURN_START_GRACE_MS
  );
}

function withEventBase(
  input: Pick<OrchestrationCommand, "commandId"> & {
    readonly aggregateKind: OrchestrationEvent["aggregateKind"];
    readonly aggregateId: OrchestrationEvent["aggregateId"];
    readonly occurredAt: string;
    readonly metadata?: OrchestrationEvent["metadata"];
  },
): Effect.Effect<
  Omit<OrchestrationEvent, "sequence" | "type" | "payload">,
  PlatformError.PlatformError,
  Crypto.Crypto
> {
  return Crypto.Crypto.pipe(
    Effect.flatMap((crypto) =>
      crypto.randomUUIDv4.pipe(
        Effect.map((eventId) => ({
          eventId: EventId.make(eventId),
          aggregateKind: input.aggregateKind,
          aggregateId: input.aggregateId,
          occurredAt: input.occurredAt,
          commandId: input.commandId,
          causationEventId: null,
          correlationId: input.commandId,
          metadata: input.metadata ?? {},
        })),
      ),
    ),
  );
}

type PlannedOrchestrationEvent = Omit<OrchestrationEvent, "sequence">;

type DecideOrchestrationCommandResult =
  | PlannedOrchestrationEvent
  | ReadonlyArray<PlannedOrchestrationEvent>;

const decideCommandSequence = Effect.fn("decideCommandSequence")(function* ({
  commands,
  readModel,
}: {
  readonly commands: ReadonlyArray<OrchestrationCommand>;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<
  ReadonlyArray<PlannedOrchestrationEvent>,
  OrchestrationCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  let nextReadModel = readModel;
  let nextSequence = readModel.snapshotSequence;
  const plannedEvents: PlannedOrchestrationEvent[] = [];

  for (const nextCommand of commands) {
    const decided = yield* decideOrchestrationCommand({
      command: nextCommand,
      readModel: nextReadModel,
    });
    const nextEvents = Array.isArray(decided) ? decided : [decided];
    for (const nextEvent of nextEvents) {
      plannedEvents.push(nextEvent);
      nextSequence += 1;
      nextReadModel = yield* projectEvent(nextReadModel, {
        ...nextEvent,
        sequence: nextSequence,
      }).pipe(Effect.orDie);
    }
  }

  return plannedEvents;
});

export const decideOrchestrationCommand = Effect.fn("decideOrchestrationCommand")(function* ({
  command,
  readModel,
}: {
  readonly command: OrchestrationCommand;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<
  DecideOrchestrationCommandResult,
  OrchestrationCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  switch (command.type) {
    case "project.create": {
      yield* requireProjectAbsent({
        readModel,
        command,
        projectId: command.projectId,
      });
      yield* requireActiveProjectWorkspaceRootAbsent({
        readModel,
        command,
        workspaceRoot: command.workspaceRoot,
        exceptProjectId: command.projectId,
      });

      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "project.created",
        payload: {
          projectId: command.projectId,
          title: command.title,
          workspaceRoot: command.workspaceRoot,
          defaultModelSelection: command.defaultModelSelection ?? null,
          scripts: [],
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "project.meta.update": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      if (command.workspaceRoot !== undefined) {
        yield* requireActiveProjectWorkspaceRootAbsent({
          readModel,
          command,
          workspaceRoot: command.workspaceRoot,
          exceptProjectId: command.projectId,
        });
      }
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "project.meta-updated",
        payload: {
          projectId: command.projectId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.workspaceRoot !== undefined ? { workspaceRoot: command.workspaceRoot } : {}),
          ...(command.defaultModelSelection !== undefined
            ? { defaultModelSelection: command.defaultModelSelection }
            : {}),
          ...(command.scripts !== undefined ? { scripts: command.scripts } : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "project.delete": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const activeThreads = listThreadsByProjectId(readModel, command.projectId).filter(
        (thread) => thread.deletedAt === null,
      );
      if (activeThreads.length > 0 && command.force !== true) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Project '${command.projectId}' is not empty and cannot be deleted without force=true.`,
        });
      }
      if (activeThreads.length > 0) {
        return yield* decideCommandSequence({
          readModel,
          commands: [
            ...activeThreads.map(
              (thread): Extract<OrchestrationCommand, { type: "thread.delete" }> => ({
                type: "thread.delete",
                commandId: command.commandId,
                threadId: thread.id,
              }),
            ),
            {
              type: "project.delete",
              commandId: command.commandId,
              projectId: command.projectId,
            },
          ],
        });
      }

      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "project.deleted" as const,
        payload: {
          projectId: command.projectId,
          deletedAt: occurredAt,
        },
      };
    }

    case "thread.create": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      yield* requireThreadAbsent({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.created",
        payload: {
          threadId: command.threadId,
          projectId: command.projectId,
          title: command.title,
          modelSelection: command.modelSelection,
          runtimeMode: command.runtimeMode,
          interactionMode: command.interactionMode,
          branch: command.branch,
          worktreePath: command.worktreePath,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.delete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.deleted",
        payload: {
          threadId: command.threadId,
          deletedAt: occurredAt,
        },
      };
    }

    case "thread.archive": {
      yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.archived",
        payload: {
          threadId: command.threadId,
          archivedAt: occurredAt,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.unarchive": {
      yield* requireThreadArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.unarchived",
        payload: {
          threadId: command.threadId,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.settle": {
      const thread = yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      // Server-side twin of the client's canSettle session check: a stale
      // or raced client must not settle a thread whose session is coming
      // alive or working.
      if (thread.session?.status === "starting" || thread.session?.status === "running") {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `thread ${command.threadId} has an active session and cannot be settled`,
          }),
        );
      }
      // Pending approval / user-input requests are blocked-on-you work: a
      // raced or stale client must not park them behind a settled override
      // that would surface only after the request resolves.
      if (hasOpenBlockingRequest(thread)) {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `thread ${command.threadId} has a pending approval or user-input request and cannot be settled`,
          }),
        );
      }
      const occurredAt = yield* nowIso;
      // Settling inside the adoption window would hide just-requested work.
      if (threadHasQueuedTurnStart(thread, occurredAt)) {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `thread ${command.threadId} has a queued turn start and cannot be settled`,
          }),
        );
      }
      // Settling an already-settled thread re-emits with the original
      // settledAt: the engine rejects zero-event commands, and bulk-settle /
      // double-click must stay silent no-ops rather than surface errors.
      const alreadySettled = thread.settledOverride === "settled" && thread.settledAt !== null;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.settled",
        payload: {
          threadId: command.threadId,
          settledAt: alreadySettled ? thread.settledAt : occurredAt,
          // A re-emission is a projected no-op: keep the existing updatedAt
          // so duplicate settles neither rewind nor churn ordering. A fresh
          // settle stamps the command time.
          updatedAt: alreadySettled ? thread.updatedAt : occurredAt,
        },
      };
    }

    case "thread.unsettle": {
      const thread = yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      // Idempotent by re-emission (see thread.settle): reducing the event a
      // second time lands on the same override state. A re-emission keeps
      // the existing updatedAt so duplicates do not churn ordering.
      const alreadyPinnedActive = thread.settledOverride === "active";
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.unsettled",
        payload: {
          threadId: command.threadId,
          reason: command.reason,
          updatedAt: alreadyPinnedActive ? thread.updatedAt : occurredAt,
        },
      };
    }

    case "thread.snooze": {
      const thread = yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      // A wake time in the past would create a thread that is snoozed and
      // woken at once — the row would never leave the inbox but still carry
      // snooze state. Reject instead of silently normalizing. The negated
      // comparison also catches unparseable wake times (IsoDateTime is
      // structurally just a string): NaN fails every comparison, and an
      // unparseable snoozedUntil must never persist.
      if (!(Date.parse(command.snoozedUntil) > Date.parse(occurredAt))) {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `thread ${command.threadId} snooze wake time ${command.snoozedUntil} is not in the future`,
          }),
        );
      }
      // Blocked-on-you work must not be snoozed away: a pending approval or
      // user-input request is the agent waiting on the user, and hiding it
      // defeats the request. (A running session IS snoozable — snooze only
      // affects visibility, never the agent.)
      if (hasOpenBlockingRequest(thread)) {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `thread ${command.threadId} has a pending approval or user-input request and cannot be snoozed`,
          }),
        );
      }
      // A queued turn start — a user message no turn has adopted yet — is
      // invisible pending work: no session, no pending flags. Snoozing in
      // that window would hide a just-requested turn exactly the way settle
      // would.
      if (threadHasQueuedTurnStart(thread, occurredAt)) {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `thread ${command.threadId} has a queued turn start and cannot be snoozed`,
          }),
        );
      }
      // Re-snoozing an already-snoozed thread to the SAME wake time is a
      // duplicate (double-click, raced clients): re-emit with the original
      // timestamps so the projection is a no-op. A different wake time is a
      // real change and stamps fresh.
      const existingSnoozedAt =
        thread.snoozedUntil === command.snoozedUntil && thread.snoozedAt != null
          ? thread.snoozedAt
          : null;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.snoozed",
        payload: {
          threadId: command.threadId,
          snoozedUntil: command.snoozedUntil,
          snoozedAt: existingSnoozedAt ?? occurredAt,
          updatedAt: existingSnoozedAt !== null ? thread.updatedAt : occurredAt,
        },
      };
    }

    case "thread.unsnooze": {
      const thread = yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      // Idempotent by re-emission (see thread.settle): waking a thread that
      // is not snoozed lands on the same null state without churning
      // updatedAt.
      const alreadyAwake = thread.snoozedUntil == null;
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.unsnoozed",
        payload: {
          threadId: command.threadId,
          reason: command.reason,
          updatedAt: alreadyAwake ? thread.updatedAt : occurredAt,
        },
      };
    }

    case "thread.meta.update": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const branch =
        command.branch !== undefined &&
        command.expectedBranch !== undefined &&
        thread.branch !== command.expectedBranch
          ? thread.branch
          : command.branch;
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.meta-updated",
        payload: {
          threadId: command.threadId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.regenerateTitle === true
            ? {
                regenerateTitle: true as const,
                previousTitle: thread.title,
                titleRegeneration: {
                  requestId: command.commandId,
                  startedAt: occurredAt,
                },
              }
            : {}),
          ...(command.title !== undefined && thread.titleRegeneration != null
            ? { titleRegeneration: null }
            : {}),
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(branch !== undefined ? { branch } : {}),
          ...(command.worktreePath !== undefined ? { worktreePath: command.worktreePath } : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.title.regeneration.complete": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const requestIsCurrent = thread.titleRegeneration?.requestId === command.requestId;
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.meta-updated",
        payload: {
          threadId: command.threadId,
          ...(requestIsCurrent && command.title !== undefined ? { title: command.title } : {}),
          ...(requestIsCurrent ? { titleRegeneration: null } : {}),
          updatedAt: requestIsCurrent ? occurredAt : thread.updatedAt,
        },
      };
    }

    case "thread.runtime-mode.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.runtime-mode-set",
        payload: {
          threadId: command.threadId,
          runtimeMode: command.runtimeMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.interaction-mode.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.interaction-mode-set",
        payload: {
          threadId: command.threadId,
          interactionMode: command.interactionMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.turn.start": {
      const targetThread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const sourceProposedPlan = command.sourceProposedPlan;
      const sourceThread = sourceProposedPlan
        ? yield* requireThread({
            readModel,
            command,
            threadId: sourceProposedPlan.threadId,
          })
        : null;
      const sourcePlan =
        sourceProposedPlan && sourceThread
          ? sourceThread.proposedPlans.find((entry) => entry.id === sourceProposedPlan.planId)
          : null;
      if (sourceProposedPlan && !sourcePlan) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourceProposedPlan.planId}' does not exist on thread '${sourceProposedPlan.threadId}'.`,
        });
      }
      if (sourceThread && sourceThread.projectId !== targetThread.projectId) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourceProposedPlan?.planId}' belongs to thread '${sourceThread.id}' in a different project.`,
        });
      }
      const requestedSkillInvocation = command.skillInvocation;
      const handoffAction =
        requestedSkillInvocation?.action?.id === "handoff-to-spec"
          ? requestedSkillInvocation.action
          : null;
      let handoffWorkstreamId: WorkstreamId | null = null;
      if (handoffAction !== null) {
        if (
          requestedSkillInvocation?.skill.name !== "to-spec" ||
          requestedSkillInvocation.execution.mode !== "generic"
        ) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Wayfinder handoff requires generic to-spec execution.",
          });
        }
        const wayfinderThread = yield* requireThread({
          readModel,
          command,
          threadId: handoffAction.sourceThreadId,
        });
        const wayfinderInvocation = wayfinderThread.latestTurn?.skillInvocation;
        if (wayfinderThread.projectId !== targetThread.projectId) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail:
              "to-spec provenance must reference a native Wayfinder map in the target project.",
          });
        }
        const latestTurnHasSource =
          wayfinderInvocation?.skillRunId === handoffAction.sourceSkillRunId &&
          wayfinderInvocation.skill.name === "wayfinder" &&
          wayfinderInvocation.execution.mode === "native" &&
          wayfinderInvocation.wayfinderMap !== undefined;
        if (!latestTurnHasSource) {
          if (requestedSkillInvocation.reconnectWorkstreamId === undefined) {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: "to-spec provenance must resolve from a durable Wayfinder Skill Run.",
            });
          }
          handoffWorkstreamId = requestedSkillInvocation.reconnectWorkstreamId;
        } else {
          const wayfinderMap = wayfinderInvocation.wayfinderMap;
          const synchronizedAt =
            wayfinderInvocation.wayfinderSynchronizedAt ?? wayfinderMap.lastSynchronizedAt;
          if (
            handoffAction.canonicalReference.number !== wayfinderMap.canonicalReference.number ||
            handoffAction.canonicalReference.url !== wayfinderMap.canonicalReference.url ||
            handoffAction.wayfinderSynchronizedAt !== synchronizedAt
          ) {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: "to-spec provenance does not match the canonical synchronized Wayfinder map.",
            });
          }
          const activeLinkedTicketNumbers = readModel.threads.flatMap((thread) => {
            const invocation = thread.latestTurn?.skillInvocation;
            const action = invocation?.action?.id === "work-ticket" ? invocation.action : null;
            const active =
              thread.latestTurn?.state === "running" ||
              thread.session?.status === "starting" ||
              thread.session?.status === "running";
            return invocation?.workstreamId === wayfinderInvocation.workstreamId &&
              action !== null &&
              active
              ? [action.ticketNumber]
              : [];
          });
          const readiness = deriveWayfinderReadiness({
            map: wayfinderMap,
            synchronization: wayfinderInvocation.wayfinderSynchronization ?? null,
            activeLinkedTicketNumbers,
          });
          if (!readiness.ready && !handoffAction.acknowledgedIncomplete) {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: `Acknowledge the incomplete Wayfinder map before early to-spec handoff. Blockers: ${readiness.blockers.map((blocker) => blocker.kind).join(", ")}.`,
            });
          }
          if (
            requestedSkillInvocation.reconnectWorkstreamId !== undefined &&
            requestedSkillInvocation.reconnectWorkstreamId !== wayfinderInvocation.workstreamId
          ) {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: "to-spec reconnect Workstream does not match its Wayfinder provenance.",
            });
          }
          handoffWorkstreamId = wayfinderInvocation.workstreamId;
        }
      }
      const skillInvocation: SkillInvocation | undefined = requestedSkillInvocation
        ? {
            skill: requestedSkillInvocation.skill,
            ...(requestedSkillInvocation.arguments !== undefined
              ? { arguments: requestedSkillInvocation.arguments }
              : {}),
            ...(requestedSkillInvocation.action !== undefined
              ? { action: requestedSkillInvocation.action }
              : {}),
            execution: requestedSkillInvocation.execution,
            ...(requestedSkillInvocation.wayfinderMap !== undefined
              ? { wayfinderMap: requestedSkillInvocation.wayfinderMap }
              : {}),
            ...(requestedSkillInvocation.wayfinderSynchronizedAt !== undefined
              ? { wayfinderSynchronizedAt: requestedSkillInvocation.wayfinderSynchronizedAt }
              : {}),
            ...(requestedSkillInvocation.wayfinderSynchronization !== undefined
              ? { wayfinderSynchronization: requestedSkillInvocation.wayfinderSynchronization }
              : {}),
            workstreamId:
              handoffWorkstreamId ??
              requestedSkillInvocation.reconnectWorkstreamId ??
              WorkstreamId.make(
                `workstream:${yield* Crypto.Crypto.pipe(Effect.flatMap((crypto) => crypto.randomUUIDv4))}`,
              ),
            skillRunId: SkillRunId.make(
              `skill-run:${yield* Crypto.Crypto.pipe(Effect.flatMap((crypto) => crypto.randomUUIDv4))}`,
            ),
            projectId: targetThread.projectId,
            threadId: command.threadId,
            createdAt: command.createdAt,
            ...(command.skillInvocation.skill.name === "wayfinder" &&
            command.skillInvocation.execution.mode === "native" &&
            command.skillInvocation.action?.id === "new-map"
              ? { wayfinderDraft: createEmptyWayfinderDraft(command.createdAt) }
              : {}),
          }
        : undefined;
      const userMessageEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          role: "user",
          text: command.message.text,
          attachments: command.message.attachments,
          turnId: null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
      const turnStartRequestedEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        causationEventId: userMessageEvent.eventId,
        type: "thread.turn-start-requested",
        payload: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(command.titleSeed !== undefined ? { titleSeed: command.titleSeed } : {}),
          runtimeMode: targetThread.runtimeMode,
          interactionMode: targetThread.interactionMode,
          ...(sourceProposedPlan !== undefined ? { sourceProposedPlan } : {}),
          ...(skillInvocation !== undefined ? { skillInvocation } : {}),
          createdAt: command.createdAt,
        },
      };
      const draftStartedEvent =
        skillInvocation?.wayfinderDraft !== undefined
          ? yield* withEventBase({
              aggregateKind: "thread",
              aggregateId: command.threadId,
              occurredAt: command.createdAt,
              commandId: command.commandId,
            }).pipe(
              Effect.map(
                (eventBase): Omit<OrchestrationEvent, "sequence"> => ({
                  ...eventBase,
                  causationEventId: turnStartRequestedEvent.eventId,
                  type: "thread.activity-appended",
                  payload: {
                    threadId: command.threadId,
                    activity: {
                      id: eventBase.eventId,
                      tone: "info",
                      kind: "wayfinder.draft.started",
                      summary: "Unpublished Wayfinder draft started",
                      payload: {
                        workstreamId: skillInvocation.workstreamId,
                        skillRunId: skillInvocation.skillRunId,
                        canonical: false,
                      },
                      turnId: null,
                      createdAt: command.createdAt,
                    },
                  },
                }),
              ),
            )
          : null;
      // A Development Workflow attachment is never inferred from prose or
      // from a generic skill. A native, structured Wayfinder invocation can
      // offer exactly one durable hint for this Origin Thread; the later
      // attach command still requires the user to name and confirm the goal.
      const workflowAttachmentHintEvent =
        skillInvocation !== undefined &&
        isWorkflowAttachableWayfinderInvocation(skillInvocation) &&
        targetThread.workflowAttachment === undefined &&
        targetThread.workflowAttachmentHint === undefined
          ? yield* withEventBase({
              aggregateKind: "thread",
              aggregateId: command.threadId,
              occurredAt: command.createdAt,
              commandId: command.commandId,
            }).pipe(
              Effect.map(
                (eventBase): Omit<OrchestrationEvent, "sequence"> => ({
                  ...eventBase,
                  causationEventId: turnStartRequestedEvent.eventId,
                  type: "thread.workflow-attachment-hinted",
                  payload: {
                    threadId: command.threadId,
                    hint: {
                      status: "available",
                      sourceSkillRunId: skillInvocation.skillRunId,
                      workstreamId: skillInvocation.workstreamId,
                      backfilledWayfinderData:
                        backfillWorkflowAttachmentWayfinderData(skillInvocation),
                      offeredAt: command.createdAt,
                      updatedAt: command.createdAt,
                    },
                  },
                }),
              ),
            )
          : null;
      // Real activity resets ANY override: it wakes an explicitly settled
      // thread, and it clears a keep-active pin back to neutral so the
      // thread can auto-settle again after this burst of work goes stale.
      // A snooze clears the same way — sending a message to a snoozed
      // thread is the user re-engaging, so the return ticket is spent.
      const lifecycleResetEvents: Array<Omit<OrchestrationEvent, "sequence">> = [];
      if (targetThread.settledOverride !== null) {
        lifecycleResetEvents.push({
          ...(yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          })),
          type: "thread.unsettled",
          payload: {
            threadId: command.threadId,
            reason: "activity",
            updatedAt: command.createdAt,
          },
        });
      }
      if (targetThread.snoozedUntil != null) {
        lifecycleResetEvents.push({
          ...(yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          })),
          type: "thread.unsnoozed",
          payload: {
            threadId: command.threadId,
            reason: "activity",
            updatedAt: command.createdAt,
          },
        });
      }
      return [
        ...lifecycleResetEvents,
        userMessageEvent,
        turnStartRequestedEvent,
        ...(draftStartedEvent ? [draftStartedEvent] : []),
        ...(workflowAttachmentHintEvent ? [workflowAttachmentHintEvent] : []),
      ];
    }

    case "thread.turn.interrupt": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.turn-interrupt-requested",
        payload: {
          threadId: command.threadId,
          ...(command.turnId !== undefined ? { turnId: command.turnId } : {}),
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.approval.respond": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const acceptsExecutableAction =
        command.decision === "accept" || command.decision === "acceptForSession";
      if (acceptsExecutableAction && hasActiveWayfinderDraftAuthority(thread.activities)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail:
            "Executable approvals are disabled while the Wayfinder map is an unpublished draft, ensuring GitHub remains unchanged.",
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        })),
        type: "thread.approval-response-requested",
        payload: {
          threadId: command.threadId,
          requestId: command.requestId,
          decision: command.decision,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.user-input.respond": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        })),
        type: "thread.user-input-response-requested",
        payload: {
          threadId: command.threadId,
          requestId: command.requestId,
          answers: command.answers,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.workflow-attachment.hint.dismiss": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const hint = thread.workflowAttachmentHint;
      if (hint === undefined || hint.status !== "available") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "No available structured Wayfinder hint can be dismissed.",
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.workflow-attachment-hint-dismissed",
        payload: {
          threadId: command.threadId,
          hint: {
            ...hint,
            status: "dismissed",
            updatedAt: command.createdAt,
          },
        },
      };
    }

    case "thread.workflow.attach": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      if (command.originThreadId !== thread.id) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Workflow attachment must explicitly confirm this origin thread.",
        });
      }
      if (thread.workflowAttachment !== undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "This origin thread is already attached to a Development Workflow.",
        });
      }
      const hint = thread.workflowAttachmentHint;
      if (hint === undefined || hint.status !== "available") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Workflow attachment requires an available structured Wayfinder hint.",
        });
      }
      const attachment = {
        originThreadId: command.originThreadId,
        workstreamId: hint.workstreamId,
        sourceSkillRunId: hint.sourceSkillRunId,
        workflowGoal: command.workflowGoal,
        backfilledWayfinderData: hint.backfilledWayfinderData,
        observationCursor: {
          sourceSkillRunId: hint.sourceSkillRunId,
          observedAt: command.createdAt,
          ...(hint.backfilledWayfinderData.wayfinderSynchronizedAt !== undefined
            ? {
                wayfinderSynchronizedAt: hint.backfilledWayfinderData.wayfinderSynchronizedAt,
              }
            : {}),
        },
        attachedAt: command.createdAt,
      };
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.workflow-attached",
        payload: {
          threadId: command.threadId,
          hint: {
            ...hint,
            status: "attached",
            updatedAt: command.createdAt,
          },
          attachment,
        },
      };
    }

    case "thread.wayfinder.publish": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      if (activeWayfinderDraftSkillRunId(thread.activities) !== command.skillRunId) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Wayfinder publication requires the matching active unpublished draft.",
        });
      }
      if (
        thread.runtimeMode === "approval-required" &&
        command.confirmed &&
        approvedWayfinderPublicationSkillRunId(thread.activities) !== command.skillRunId
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Wayfinder publication confirmation requires a pending server approval.",
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.wayfinder-publication-requested",
        payload: {
          threadId: command.threadId,
          skillRunId: command.skillRunId,
          runtimeMode: thread.runtimeMode,
          confirmed: command.confirmed,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.wayfinder.mutate": {
      const thread = yield* requireThread({ readModel, command, threadId: command.threadId });
      const actionId = command.actionId ?? command.commandId;
      const invocation = thread.latestTurn?.skillInvocation;
      const map =
        invocation?.skillRunId === command.skillRunId ? invocation.wayfinderMap : undefined;
      const published = thread.activities.some((activity) => {
        if (activity.kind !== "wayfinder.draft.published") return false;
        const payload = decodePublishedWayfinderPayload(activity.payload);
        return Option.isSome(payload) && payload.value.skillRunId === command.skillRunId;
      });
      const workTicketAction = invocation?.action?.id === "work-ticket" ? invocation.action : null;
      if (!published && workTicketAction === null) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Wayfinder editing requires a published canonical map.",
        });
      }
      if (
        workTicketAction !== null &&
        command.action.kind !== "complete-hitl-ticket" &&
        !(
          command.action.kind === "release-ticket" &&
          command.action.ticketNumber === workTicketAction.ticketNumber
        )
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `A linked HITL thread can work only its assigned ticket #${workTicketAction.ticketNumber}.`,
        });
      }
      if (command.action.kind === "complete-hitl-ticket") {
        if (workTicketAction === null) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Wayfinder HITL completion requires a dedicated linked ticket thread.",
          });
        }
        if (command.action.ticketNumber !== workTicketAction.ticketNumber) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `This linked thread can resolve only its assigned ticket #${workTicketAction.ticketNumber}.`,
          });
        }
        const assignedTicket = map?.tickets.find(
          (ticket) => ticket.number === workTicketAction.ticketNumber,
        );
        if (assignedTicket?.state !== "open" || assignedTicket.claimedBy === null) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Wayfinder HITL completion requires the assigned canonical ticket claim.",
          });
        }
        if (command.action.outcome === "out-of-scope" && command.action.graduatedFog.length > 0) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "An out-of-scope ticket cannot graduate new route decisions.",
          });
        }
        if (
          new Set(command.action.graduatedFog.map((graduated) => graduated.key)).size !==
          command.action.graduatedFog.length
        ) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Each graduated fog ticket requires a unique key.",
          });
        }
        if (
          command.action.graduatedFog.some((graduated) => !map?.fogOfWar.includes(graduated.fog))
        ) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Graduated fog must exist in the synchronized canonical map.",
          });
        }
        if (hasOpenBlockingRequest(thread)) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Resolve the current user decision before completing this HITL ticket.",
          });
        }
      }
      if (command.action.kind === "claim-ticket") {
        const action = command.action;
        const ticket = map?.tickets.find((candidate) => candidate.number === action.ticketNumber);
        const recoveringClaim =
          invocation?.wayfinderMutation?.status === "failed" &&
          invocation.wayfinderMutation.action.kind === "claim-ticket" &&
          invocation.wayfinderMutation.action.ticketNumber === action.ticketNumber;
        if (!ticket) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Wayfinder claims require a ticket in the synchronized canonical map.",
          });
        }
        if (ticket.state !== "open") {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Wayfinder ticket #${ticket.number} must be open before it can be claimed.`,
          });
        }
        if (ticket.claimedBy !== null && !recoveringClaim) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Wayfinder ticket #${ticket.number} is already claimed by ${ticket.claimedBy}.`,
          });
        }
        if (!recoveringClaim && !map?.frontier.includes(ticket.number)) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Wayfinder ticket #${ticket.number} is blocked and is not on the runnable frontier.`,
          });
        }
      }
      let approvalRequested = false;
      let approvalResolved = false;
      for (const activity of thread.activities) {
        if (
          activity.kind !== "wayfinder.mutation.approval-requested" &&
          activity.kind !== "wayfinder.mutation.approval-resolved"
        ) {
          continue;
        }
        const payload = decodeWayfinderMutationApprovalPayload(activity.payload);
        const matches =
          Option.isSome(payload) &&
          payload.value.skillRunId === command.skillRunId &&
          payload.value.actionId === actionId &&
          sameWayfinderMutationAction(payload.value.action, command.action);
        if (matches) {
          approvalRequested ||= activity.kind === "wayfinder.mutation.approval-requested";
          approvalResolved ||= activity.kind === "wayfinder.mutation.approval-resolved";
        }
      }
      const pendingApproval = approvalRequested && !approvalResolved;
      if (thread.runtimeMode === "approval-required" && command.confirmed && !pendingApproval) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Wayfinder mutation confirmation requires a pending server approval.",
        });
      }
      const requested: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.wayfinder-mutation-requested",
        payload: {
          threadId: command.threadId,
          skillRunId: command.skillRunId,
          actionId,
          action: command.action,
          runtimeMode: thread.runtimeMode,
          confirmed: command.confirmed,
          createdAt: command.createdAt,
        },
      };
      if (thread.runtimeMode !== "approval-required" || !command.confirmed) return requested;
      return [
        requested,
        {
          ...(yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          })),
          type: "thread.activity-appended",
          payload: {
            threadId: command.threadId,
            activity: {
              id: EventId.make(`wayfinder-mutation-approval-resolved:${command.commandId}`),
              tone: "info",
              kind: "wayfinder.mutation.approval-resolved",
              summary: "Wayfinder change confirmed",
              payload: {
                skillRunId: command.skillRunId,
                actionId,
                action: command.action,
              },
              turnId: null,
              createdAt: command.createdAt,
            },
          },
        },
      ];
    }

    case "thread.wayfinder.reconcile": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.wayfinder-reconciliation-requested",
        payload: {
          threadId: command.threadId,
          skillRunId: command.skillRunId,
          reason: command.reason,
          ...(command.expectedRevision !== undefined
            ? { expectedRevision: command.expectedRevision }
            : {}),
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.wayfinder.research": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const invocation = thread.latestTurn?.skillInvocation;
      if (
        invocation?.skillRunId !== command.skillRunId ||
        invocation.wayfinderMap === undefined ||
        invocation.action?.id === "work-ticket"
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Wayfinder research controls require the canonical shared map run.",
        });
      }
      const action = command.action;
      if ("ticketNumber" in action) {
        const ticket = invocation.wayfinderMap.tickets.find(
          (candidate) => candidate.number === action.ticketNumber,
        );
        if (!ticket) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Wayfinder research controls require a ticket in the canonical map.",
          });
        }
        if (action.kind === "start-ticket") {
          if (ticket.state !== "open") {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: `Wayfinder research ticket #${ticket.number} must be open.`,
            });
          }
          if (ticket.classification !== "research") {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: `Wayfinder ticket #${ticket.number} is not agent-only research.`,
            });
          }
          if (
            ticket.claimedBy !== null ||
            !invocation.wayfinderMap.frontier.includes(ticket.number)
          ) {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: `Wayfinder research ticket #${ticket.number} must be unblocked and unclaimed.`,
            });
          }
        }
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.wayfinder-research-requested",
        payload: {
          threadId: command.threadId,
          skillRunId: command.skillRunId,
          action: command.action,
          launchMode: command.launchMode ?? "manual",
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.checkpoint.revert": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.checkpoint-revert-requested",
        payload: {
          threadId: command.threadId,
          turnCount: command.turnCount,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.session.stop": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.session-stop-requested",
        payload: {
          threadId: command.threadId,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.session.set": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const sessionSetEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {},
        })),
        type: "thread.session-set",
        payload: {
          threadId: command.threadId,
          session: command.session,
        },
      };
      // Only a session coming alive is activity worth waking a settled thread
      // for — status writes like ready/stopped/error arrive after the fact and
      // must not fight a user's explicit settle. Snooze is deliberately NOT
      // cleared here: snooze never pauses the agent, so its session starting
      // or erroring is not the user re-engaging. Blocked/failed work still
      // surfaces immediately — effectiveSnoozed refuses to classify a thread
      // with a raised hand (approval / input / failure / fresh completion)
      // as snoozed, without spending the return ticket.
      const isSessionActivity =
        command.session.status === "starting" || command.session.status === "running";
      // Real activity resets ANY override (settled wakes, active unpins).
      if (thread.settledOverride === null || !isSessionActivity) {
        return sessionSetEvent;
      }
      const unsettledEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.unsettled",
        payload: {
          threadId: command.threadId,
          reason: "activity",
          updatedAt: command.createdAt,
        },
      };
      return [unsettledEvent, sessionSetEvent];
    }

    case "thread.message.assistant.delta": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          role: "assistant",
          text: command.delta,
          turnId: command.turnId ?? null,
          streaming: true,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.message.assistant.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          role: "assistant",
          text: "",
          turnId: command.turnId ?? null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.proposed-plan.upsert": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.proposed-plan-upserted",
        payload: {
          threadId: command.threadId,
          proposedPlan: command.proposedPlan,
        },
      };
    }

    case "thread.turn.diff.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.turn-diff-completed",
        payload: {
          threadId: command.threadId,
          turnId: command.turnId,
          checkpointTurnCount: command.checkpointTurnCount,
          checkpointRef: command.checkpointRef,
          status: command.status,
          files: command.files,
          assistantMessageId: command.assistantMessageId ?? null,
          completedAt: command.completedAt,
        },
      };
    }

    case "thread.revert.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.reverted",
        payload: {
          threadId: command.threadId,
          turnCount: command.turnCount,
        },
      };
    }

    case "thread.activity.append": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const requestId =
        typeof command.activity.payload === "object" &&
        command.activity.payload !== null &&
        "requestId" in command.activity.payload &&
        typeof (command.activity.payload as { requestId?: unknown }).requestId === "string"
          ? ((command.activity.payload as { requestId: string })
              .requestId as OrchestrationEvent["metadata"]["requestId"])
          : undefined;
      const activityAppendedEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          ...(requestId !== undefined ? { metadata: { requestId } } : {}),
        })),
        type: "thread.activity-appended",
        payload: {
          threadId: command.threadId,
          activity: command.activity,
        },
      };
      // An approval or user-input request is blocked-on-you work — it must
      // never stay hidden inside a settled slim row.
      const wakesSettledThread =
        command.activity.kind === "approval.requested" ||
        command.activity.kind === "user-input.requested";
      // Real activity resets ANY override (settled wakes, active unpins).
      if (thread.settledOverride === null || !wakesSettledThread) {
        return activityAppendedEvent;
      }
      const unsettledEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.unsettled",
        payload: {
          threadId: command.threadId,
          reason: "activity",
          updatedAt: command.createdAt,
        },
      };
      return [unsettledEvent, activityAppendedEvent];
    }

    case "thread.wayfinder.publication.update": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const updated: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.wayfinder-publication-updated",
        payload: {
          threadId: command.threadId,
          skillRunId: command.skillRunId,
          publication: command.publication,
          ...(command.wayfinderMap !== undefined ? { wayfinderMap: command.wayfinderMap } : {}),
        },
      };
      if (command.publication.status === "awaiting-approval") {
        const approvalRequested: Omit<OrchestrationEvent, "sequence"> = {
          ...(yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          })),
          type: "thread.activity-appended",
          payload: {
            threadId: command.threadId,
            activity: {
              id: EventId.make(`wayfinder-publication-approval:${command.commandId}`),
              tone: "info",
              kind: "wayfinder.publication.approval-requested",
              summary: "Wayfinder publication needs confirmation",
              payload: { skillRunId: command.skillRunId },
              turnId: null,
              createdAt: command.createdAt,
            },
          },
        };
        return [updated, approvalRequested];
      }
      if (command.publication.status !== "synchronized") return updated;
      const published: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.activity-appended",
        payload: {
          threadId: command.threadId,
          activity: {
            id: EventId.make(`wayfinder-publication:${command.commandId}`),
            tone: "info",
            kind: "wayfinder.draft.published",
            summary: "Wayfinder draft published and reconciled",
            payload: {
              skillRunId: command.skillRunId,
              canonicalReference: command.wayfinderMap?.canonicalReference,
            },
            turnId: null,
            createdAt: command.createdAt,
          },
        },
      };
      return [updated, published];
    }

    case "thread.wayfinder.mutation.update": {
      yield* requireThread({ readModel, command, threadId: command.threadId });
      const updated: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.wayfinder-mutation-updated",
        payload: {
          threadId: command.threadId,
          skillRunId: command.skillRunId,
          mutation: command.mutation,
          ...(command.wayfinderMap !== undefined ? { wayfinderMap: command.wayfinderMap } : {}),
        },
      };
      if (command.mutation.status !== "awaiting-approval") return updated;
      return [
        updated,
        {
          ...(yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          })),
          type: "thread.activity-appended",
          payload: {
            threadId: command.threadId,
            activity: {
              id: EventId.make(`wayfinder-mutation-approval:${command.commandId}`),
              tone: "info",
              kind: "wayfinder.mutation.approval-requested",
              summary: "Wayfinder change needs confirmation",
              payload: {
                skillRunId: command.skillRunId,
                actionId: command.mutation.actionId,
                action: command.mutation.action,
              },
              turnId: null,
              createdAt: command.createdAt,
            },
          },
        },
      ];
    }

    case "thread.wayfinder.reconciliation.update": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.wayfinder-reconciliation-updated",
        payload: {
          threadId: command.threadId,
          skillRunId: command.skillRunId,
          synchronization: command.synchronization,
          ...(command.wayfinderMap !== undefined ? { wayfinderMap: command.wayfinderMap } : {}),
        },
      };
    }

    case "thread.wayfinder.research.update": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.wayfinder-research-updated",
        payload: {
          threadId: command.threadId,
          skillRunId: command.skillRunId,
          research: command.research,
        },
      };
    }

    default: {
      command satisfies never;
      const fallback = command as never as { type: string };
      return yield* new OrchestrationCommandInvariantError({
        commandType: fallback.type,
        detail: `Unknown command type: ${fallback.type}`,
      });
    }
  }
});
