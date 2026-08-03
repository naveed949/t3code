import {
  CommandId,
  type SkillInvocation,
  type SkillRunId,
  type ThreadId,
  type OrchestrationEvent,
  type WayfinderMapProjection,
  type WayfinderMutation,
  type WayfinderPublication,
  type WayfinderResolutionArtifact,
} from "@t3tools/contracts";
import { deriveWayfinderDraft } from "@t3tools/shared/wayfinderDraft";
import * as Crypto from "effect/Crypto";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { IssueTracker } from "../../nativeSkills/IssueTracker.ts";
import {
  applyWayfinderMutation,
  type WayfinderMutationTracker,
} from "../../nativeSkills/WayfinderMutation.ts";
import {
  buildWayfinderTicketThreadSeed,
  wayfinderTicketMessageId,
  wayfinderTicketThreadId,
} from "../../nativeSkills/WayfinderTicketThread.ts";
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
  const serverCommandId = Effect.fn("WayfinderMutationReactor.serverCommandId")(function* (
    tag: string,
  ) {
    const uuid = yield* crypto.randomUUIDv4;
    return CommandId.make(`server:${tag}:${uuid}`);
  });
  const publishMutation = Effect.fn("WayfinderMutationReactor.publishMutation")(function* (
    event: MutationRequestedEvent,
    mutation: WayfinderMutation,
    wayfinderMap?: WayfinderMapProjection,
    targets: ReadonlyArray<{
      readonly threadId: ThreadId;
      readonly skillRunId: SkillRunId;
    }> = [
      {
        threadId: event.payload.threadId,
        skillRunId: event.payload.skillRunId,
      },
    ],
  ) {
    for (const target of targets) {
      yield* orchestrationEngine.dispatch({
        type: "thread.wayfinder.mutation.update",
        commandId: yield* serverCommandId("wayfinder-mutation"),
        threadId: target.threadId,
        skillRunId: target.skillRunId,
        mutation,
        ...(wayfinderMap ? { wayfinderMap } : {}),
        createdAt: mutation.updatedAt,
      });
      yield* receipts.publish({
        type: "wayfinder.mutation.progress",
        threadId: target.threadId,
        skillRunId: target.skillRunId,
        actionId: mutation.actionId,
        status: mutation.status,
        createdAt: mutation.updatedAt,
      });
    }
  });

  return Effect.fn("WayfinderMutationReactor.processEvent")(function* (
    event: MutationRequestedEvent,
  ) {
    const snapshot = yield* snapshots.getSnapshot();
    const thread = snapshot.threads.find((candidate) => candidate.id === event.payload.threadId);
    const invocation = (yield* snapshots.getSkillRunsByThreadId(event.payload.threadId)).find(
      (candidate) => candidate.skillRunId === event.payload.skillRunId,
    );
    const workTicketAction =
      invocation?.action?.id === "work-ticket" ? invocation.action : undefined;
    let sourceInvocation: SkillInvocation | undefined;
    let sourceThreadId: ThreadId | undefined;
    if (event.payload.action.kind === "complete-hitl-ticket" && workTicketAction) {
      sourceThreadId = workTicketAction.sourceThreadId;
      if (sourceThreadId) {
        const sourceRuns = yield* snapshots.getSkillRunsByThreadId(sourceThreadId);
        sourceInvocation = sourceRuns.find(
          (candidate) => candidate.skillRunId === workTicketAction.sourceSkillRunId,
        );
      } else {
        const legacySource = snapshots.getSkillRunById
          ? yield* snapshots.getSkillRunById(workTicketAction.sourceSkillRunId)
          : Option.none();
        if (Option.isSome(legacySource)) {
          sourceThreadId = legacySource.value.threadId;
          sourceInvocation = legacySource.value.skillInvocation;
        }
      }
    }
    const map = sourceInvocation?.wayfinderMap ?? invocation?.wayfinderMap;
    const publishTargets =
      sourceInvocation && sourceThreadId
        ? [
            {
              threadId: event.payload.threadId,
              skillRunId: event.payload.skillRunId,
            },
            {
              threadId: sourceThreadId,
              skillRunId: sourceInvocation.skillRunId,
            },
          ]
        : undefined;
    if (event.payload.runtimeMode === "approval-required" && !event.payload.confirmed) {
      yield* publishMutation(
        event,
        {
          actionId: event.payload.actionId,
          action: event.payload.action,
          status: "awaiting-approval",
          error: null,
          updatedAt: event.payload.createdAt,
        },
        undefined,
        publishTargets,
      );
      return;
    }
    const cwd = thread
      ? resolveThreadWorkspaceCwd({ thread, projects: snapshot.projects })
      : undefined;
    const repository = cwd ? yield* issueTracker.resolveProjectRepository(cwd) : null;
    const missingResolutionSource =
      event.payload.action.kind === "complete-hitl-ticket" &&
      (!sourceInvocation || !sourceThreadId);
    if (!thread || !invocation || !cwd || !repository || !map || missingResolutionSource) {
      yield* publishMutation(
        event,
        {
          actionId: event.payload.actionId,
          action: event.payload.action,
          status: "failed",
          error: missingResolutionSource
            ? "The linked ticket thread cannot find its shared source Wayfinder run."
            : "The published Wayfinder map is not linked to a writable GitHub repository.",
          updatedAt: event.payload.createdAt,
        },
        undefined,
        publishTargets,
      );
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
    yield* publishMutation(
      event,
      {
        actionId: event.payload.actionId,
        action: event.payload.action,
        status: "mutating",
        error: null,
        updatedAt: event.payload.createdAt,
      },
      undefined,
      publishTargets,
    );
    if (
      event.payload.action.kind === "claim-ticket" ||
      event.payload.action.kind === "release-ticket"
    ) {
      const action = event.payload.action;
      const claimResult = yield* Effect.gen(function* () {
        if (action.kind === "release-ticket") {
          yield* issueTracker
            .releaseIssue({ ...base, issueNumber: action.ticketNumber })
            .pipe(Effect.mapError(trackerFailure));
          return yield* loadCanonical();
        }

        const canonicalBeforeClaim = yield* loadCanonical();
        const canonicalTicketBeforeClaim = canonicalBeforeClaim.tickets.find(
          (candidate) => candidate.number === action.ticketNumber,
        );
        const recoveringClaim =
          invocation.wayfinderMutation?.status === "failed" &&
          invocation.wayfinderMutation.action.kind === "claim-ticket" &&
          invocation.wayfinderMutation.action.ticketNumber === action.ticketNumber;
        const canonicalClaimIsRunnable =
          canonicalTicketBeforeClaim?.state === "open" &&
          canonicalTicketBeforeClaim.claimedBy === null &&
          canonicalBeforeClaim.frontier.includes(action.ticketNumber);
        const canonicalClaimIsRecoverable =
          recoveringClaim &&
          canonicalTicketBeforeClaim?.state === "open" &&
          canonicalTicketBeforeClaim.claimedBy !== null;
        if (!canonicalClaimIsRunnable && !canonicalClaimIsRecoverable) {
          return yield* new WayfinderReconciliationError({
            detail: "The canonical ticket is no longer open, unblocked, and unclaimed.",
          });
        }

        const claim = yield* issueTracker
          .claimIssue({ ...base, issueNumber: action.ticketNumber })
          .pipe(Effect.mapError(trackerFailure));
        const canonicalMap = yield* loadCanonical();
        const canonicalTicket = canonicalMap.tickets.find(
          (candidate) => candidate.number === action.ticketNumber,
        );
        if (canonicalTicket?.claimedBy !== claim.viewerLogin) {
          return yield* new WayfinderReconciliationError({
            detail: "GitHub did not confirm the canonical ticket claim.",
          });
        }

        const targetThreadId = wayfinderTicketThreadId(
          invocation.workstreamId,
          action.ticketNumber,
        );
        const targetThread = snapshot.threads.find((candidate) => candidate.id === targetThreadId);
        const targetSkillRuns = targetThread
          ? yield* snapshots.getSkillRunsByThreadId(targetThreadId)
          : [];
        const linkedRun = targetSkillRuns.find(
          (candidate) =>
            candidate.workstreamId === invocation.workstreamId &&
            candidate.action?.id === "work-ticket" &&
            candidate.action.ticketNumber === action.ticketNumber,
        );
        if (linkedRun) return canonicalMap;

        const seed = buildWayfinderTicketThreadSeed({
          workstreamId: invocation.workstreamId,
          sourceSkillRunId: invocation.skillRunId,
          sourceThreadId: event.payload.threadId,
          skill: invocation.skill,
          map: canonicalMap,
          ticket: canonicalTicket,
        });
        if (!targetThread) {
          yield* orchestrationEngine.dispatch({
            type: "thread.create",
            commandId: yield* serverCommandId("wayfinder-ticket-thread"),
            threadId: targetThreadId,
            projectId: invocation.projectId,
            title: seed.title,
            modelSelection: thread.modelSelection,
            runtimeMode: thread.runtimeMode,
            interactionMode: thread.interactionMode,
            branch: thread.branch,
            worktreePath: thread.worktreePath,
            createdAt: event.payload.createdAt,
          });
        } else if (targetThread.latestTurn !== null) {
          return yield* new WayfinderReconciliationError({
            detail: `Thread '${targetThreadId}' already exists without the expected ticket linkage.`,
          });
        }
        yield* orchestrationEngine.dispatch({
          type: "thread.turn.start",
          commandId: yield* serverCommandId("wayfinder-ticket-turn"),
          threadId: targetThreadId,
          message: {
            messageId: wayfinderTicketMessageId(targetThreadId),
            role: "user",
            text: seed.message,
            attachments: [],
          },
          modelSelection: thread.modelSelection,
          titleSeed: seed.title,
          runtimeMode: thread.runtimeMode,
          interactionMode: thread.interactionMode,
          skillInvocation: {
            skill: invocation.skill,
            arguments: seed.message,
            action: {
              id: "work-ticket",
              ticketNumber: action.ticketNumber,
              sourceSkillRunId: invocation.skillRunId,
              sourceThreadId: event.payload.threadId,
            },
            execution: invocation.execution,
            wayfinderMap: canonicalMap,
            wayfinderSynchronizedAt: canonicalMap.lastSynchronizedAt,
            reconnectWorkstreamId: invocation.workstreamId,
          },
          createdAt: event.payload.createdAt,
        });
        return canonicalMap;
      }).pipe(Effect.result);

      if (Result.isFailure(claimResult)) {
        const correction = yield* loadCanonical().pipe(Effect.result);
        const canonicalClaimed =
          Result.isSuccess(correction) &&
          correction.success.tickets.some(
            (candidate) => candidate.number === action.ticketNumber && candidate.claimedBy !== null,
          );
        yield* publishMutation(
          event,
          {
            actionId: event.payload.actionId,
            action,
            status: "failed",
            error:
              action.kind === "claim-ticket" && canonicalClaimed
                ? "The ticket is canonically claimed, but its linked thread is incomplete. Retry to recover it."
                : action.kind === "release-ticket"
                  ? "GitHub could not release and reconcile this ticket claim."
                  : "GitHub could not claim this ticket.",
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
          action,
          status: "synchronized",
          error: null,
          updatedAt: claimResult.success.lastSynchronizedAt,
        },
        claimResult.success,
      );
      return;
    }
    if (event.payload.action.kind === "complete-hitl-ticket") {
      const action = event.payload.action;
      let artifacts: WayfinderResolutionArtifact[] =
        invocation.wayfinderMutation?.actionId === event.payload.actionId &&
        invocation.wayfinderMutation.action.kind === "complete-hitl-ticket"
          ? [...(invocation.wayfinderMutation.artifacts ?? [])]
          : [];
      let nextStep: string | null = "record canonical resolution";
      const hasArtifact = (predicate: (artifact: WayfinderResolutionArtifact) => boolean) =>
        artifacts.some(predicate);
      const publishResolutionProgress = Effect.fn(
        "WayfinderMutationReactor.publishResolutionProgress",
      )(function* (artifact: WayfinderResolutionArtifact, followingStep: string) {
        artifacts = [...artifacts, artifact];
        nextStep = followingStep;
        yield* publishMutation(
          event,
          {
            actionId: event.payload.actionId,
            action,
            status: "mutating",
            artifacts,
            nextStep,
            error: null,
            updatedAt: event.payload.createdAt,
          },
          undefined,
          publishTargets,
        );
      });
      const resolutionResult = yield* Effect.gen(function* () {
        const canonicalBefore = yield* loadCanonical();
        const assigned = canonicalBefore.tickets.find(
          (candidate) => candidate.number === action.ticketNumber,
        );
        const alreadyClosed = hasArtifact(
          (artifact) =>
            artifact.kind === "ticket-closed" && artifact.ticketNumber === action.ticketNumber,
        );
        if (
          assigned === undefined ||
          (!alreadyClosed && (assigned.state !== "open" || assigned.claimedBy === null))
        ) {
          return yield* new WayfinderReconciliationError({
            detail: "The canonical assigned ticket claim is no longer resolvable.",
          });
        }
        const unknownGraduatedFog = action.graduatedFog.find(
          (graduated) =>
            !canonicalBefore.fogOfWar.includes(graduated.fog) &&
            !hasArtifact((artifact) => artifact.kind === "issue" && artifact.key === graduated.key),
        );
        if (unknownGraduatedFog) {
          return yield* new WayfinderReconciliationError({
            detail: `Fog '${unknownGraduatedFog.fog}' is not present in the canonical map.`,
          });
        }

        if (
          !hasArtifact(
            (artifact) =>
              artifact.kind === "resolution-comment" &&
              artifact.ticketNumber === action.ticketNumber,
          )
        ) {
          nextStep = "record canonical resolution";
          yield* issueTracker
            .addIssueComment({
              ...base,
              issueNumber: action.ticketNumber,
              body: `Resolution: ${action.resolution}\n\nContext: ${action.contextPointer}`,
              idempotencyKey: `${event.payload.skillRunId}:${event.payload.actionId}:resolution`,
            })
            .pipe(Effect.mapError(trackerFailure));
          yield* publishResolutionProgress(
            {
              kind: "resolution-comment",
              ticketNumber: action.ticketNumber,
              contextPointer: action.contextPointer,
            },
            action.outcome === "resolved"
              ? "graduate newly specifiable fog"
              : "record out-of-scope outcome",
          );
        }

        if (action.outcome === "resolved") {
          for (const graduated of action.graduatedFog) {
            const label = `wayfinder:${graduated.classification}`;
            if (!hasArtifact((artifact) => artifact.kind === "label" && artifact.name === label)) {
              nextStep = `ensure label ${label}`;
              yield* issueTracker
                .ensureLabel({ ...base, name: label })
                .pipe(Effect.mapError(trackerFailure));
              yield* publishResolutionProgress(
                { kind: "label", name: label },
                `create graduated ticket ${graduated.key}`,
              );
            }
            if (
              !hasArtifact(
                (artifact) => artifact.kind === "issue" && artifact.key === graduated.key,
              )
            ) {
              nextStep = `create graduated ticket ${graduated.key}`;
              const created = yield* issueTracker
                .createIssue({
                  ...base,
                  key: graduated.key,
                  idempotencyKey: `${event.payload.skillRunId}:${event.payload.actionId}:${graduated.key}`,
                  title: graduated.title,
                  body: `Graduated from Wayfinder fog: ${graduated.fog}`,
                  labels: ["wayfinder:decision", label],
                })
                .pipe(Effect.mapError(trackerFailure));
              yield* publishResolutionProgress(
                { kind: "issue", key: graduated.key, ...created },
                `link graduated ticket ${graduated.key}`,
              );
            }
            const created = artifacts.find(
              (artifact) => artifact.kind === "issue" && artifact.key === graduated.key,
            );
            if (created?.kind !== "issue") {
              return yield* new WayfinderReconciliationError({
                detail: `No canonical issue receipt exists for graduated fog '${graduated.key}'.`,
              });
            }
            if (
              !hasArtifact(
                (artifact) => artifact.kind === "child" && artifact.key === graduated.key,
              )
            ) {
              nextStep = `link graduated ticket ${graduated.key}`;
              yield* issueTracker
                .addChild({
                  ...base,
                  parentNumber: map.canonicalReference.number,
                  childNumber: created.number,
                })
                .pipe(Effect.mapError(trackerFailure));
              yield* publishResolutionProgress(
                {
                  kind: "child",
                  key: graduated.key,
                  parentNumber: map.canonicalReference.number,
                  childNumber: created.number,
                },
                `wire relationships for ${graduated.key}`,
              );
            }
          }
          for (const graduated of action.graduatedFog) {
            const created = artifacts.find(
              (artifact) => artifact.kind === "issue" && artifact.key === graduated.key,
            );
            if (created?.kind !== "issue") continue;
            for (const blocker of graduated.blockedBy) {
              const blockerNumber =
                blocker.kind === "ticket"
                  ? blocker.ticketNumber
                  : (() => {
                      const blockerIssue = artifacts.find(
                        (artifact) => artifact.kind === "issue" && artifact.key === blocker.key,
                      );
                      return blockerIssue?.kind === "issue" ? blockerIssue.number : undefined;
                    })();
              if (blockerNumber === undefined) {
                return yield* new WayfinderReconciliationError({
                  detail:
                    blocker.kind === "graduated"
                      ? `No canonical blocker receipt exists for '${blocker.key}'.`
                      : `Canonical blocker #${blocker.ticketNumber} is unavailable.`,
                });
              }
              const relationshipKey = `${graduated.key}:${blockerNumber}`;
              if (
                hasArtifact(
                  (artifact) => artifact.kind === "blocked-by" && artifact.key === relationshipKey,
                )
              ) {
                continue;
              }
              nextStep = `wire relationship ${relationshipKey}`;
              yield* issueTracker
                .addBlockedBy({
                  ...base,
                  blockedNumber: created.number,
                  blockerNumber,
                })
                .pipe(Effect.mapError(trackerFailure));
              yield* publishResolutionProgress(
                {
                  kind: "blocked-by",
                  key: relationshipKey,
                  blockedNumber: created.number,
                  blockerNumber,
                },
                "update graduated fog",
              );
            }
          }
          const canonicalForFog = yield* loadCanonical();
          const ungraduatedFog = canonicalForFog.fogOfWar.filter(
            (fog) => !action.graduatedFog.some((graduated) => graduated.fog === fog),
          );
          const missingFogReceipts = action.graduatedFog.filter(
            (graduated) =>
              !hasArtifact(
                (artifact) => artifact.kind === "fog-graduated" && artifact.key === graduated.key,
              ),
          );
          if (missingFogReceipts.length > 0) {
            nextStep = "update graduated fog";
            yield* issueTracker
              .updateWayfinderMapField({
                ...base,
                issueNumber: map.canonicalReference.number,
                field: "fog-of-war",
                value: ungraduatedFog.map((fog) => `- ${fog}`).join("\n"),
              })
              .pipe(Effect.mapError(trackerFailure));
            for (const graduated of missingFogReceipts) {
              yield* publishResolutionProgress(
                { kind: "fog-graduated", key: graduated.key, fog: graduated.fog },
                "record decision context pointer",
              );
            }
          }
          if (
            !hasArtifact(
              (artifact) =>
                artifact.kind === "decision-pointer" &&
                artifact.ticketNumber === action.ticketNumber,
            )
          ) {
            nextStep = "record decision context pointer";
            const canonicalForDecisions = yield* loadCanonical();
            const target = canonicalForDecisions.tickets.find(
              (candidate) => candidate.number === action.ticketNumber,
            );
            const pointerAlreadyRecorded = canonicalForDecisions.decisionsSoFar.some(
              (decision) => decision.url === action.contextPointer,
            );
            if (!pointerAlreadyRecorded) {
              const decisions = [
                ...canonicalForDecisions.decisionsSoFar.map(
                  (decision) =>
                    `- ${decision.url ? `[${decision.title}](${decision.url})` : decision.title}${decision.summary ? ` — ${decision.summary}` : ""}`,
                ),
                `- [${target?.title ?? `#${action.ticketNumber}`}](${action.contextPointer})`,
              ].join("\n");
              yield* issueTracker
                .updateWayfinderDecisions({
                  ...base,
                  issueNumber: map.canonicalReference.number,
                  value: decisions,
                })
                .pipe(Effect.mapError(trackerFailure));
            }
            yield* publishResolutionProgress(
              {
                kind: "decision-pointer",
                ticketNumber: action.ticketNumber,
                contextPointer: action.contextPointer,
              },
              "close canonical ticket",
            );
          }
        } else if (
          !hasArtifact(
            (artifact) =>
              artifact.kind === "out-of-scope" && artifact.ticketNumber === action.ticketNumber,
          )
        ) {
          nextStep = "record out-of-scope outcome";
          const canonicalForScope = yield* loadCanonical();
          const target = canonicalForScope.tickets.find(
            (candidate) => candidate.number === action.ticketNumber,
          );
          const pointerAlreadyRecorded = canonicalForScope.outOfScope.some((entry) =>
            entry.includes(action.contextPointer),
          );
          if (!pointerAlreadyRecorded) {
            const entries = [
              ...canonicalForScope.outOfScope.map((entry) => `- ${entry}`),
              `- [${target?.title ?? `#${action.ticketNumber}`}](${action.contextPointer})`,
            ].join("\n");
            yield* issueTracker
              .updateWayfinderMapField({
                ...base,
                issueNumber: map.canonicalReference.number,
                field: "out-of-scope",
                value: entries,
              })
              .pipe(Effect.mapError(trackerFailure));
          }
          yield* issueTracker
            .setWayfinderClassification({
              ...base,
              issueNumber: action.ticketNumber,
              previous: target?.classification ?? "unknown",
              classification: "out-of-scope",
            })
            .pipe(Effect.mapError(trackerFailure));
          yield* publishResolutionProgress(
            {
              kind: "out-of-scope",
              ticketNumber: action.ticketNumber,
              contextPointer: action.contextPointer,
            },
            "close canonical ticket",
          );
        }

        if (
          !hasArtifact(
            (artifact) =>
              artifact.kind === "ticket-closed" && artifact.ticketNumber === action.ticketNumber,
          )
        ) {
          nextStep = "close canonical ticket";
          yield* issueTracker
            .setIssueState({
              ...base,
              issueNumber: action.ticketNumber,
              state: "closed",
            })
            .pipe(Effect.mapError(trackerFailure));
          yield* publishResolutionProgress(
            { kind: "ticket-closed", ticketNumber: action.ticketNumber },
            "reconcile shared Wayfinder map",
          );
        }
        nextStep = "reconcile shared Wayfinder map";
        const commentIsCanonical = issueTracker.hasIssueComment
          ? yield* issueTracker
              .hasIssueComment({
                ...base,
                issueNumber: action.ticketNumber,
                idempotencyKey: `${event.payload.skillRunId}:${event.payload.actionId}:resolution`,
              })
              .pipe(Effect.mapError(trackerFailure))
          : false;
        const reconciled = yield* loadCanonical();
        const closed = reconciled.tickets.find(
          (candidate) => candidate.number === action.ticketNumber,
        );
        const outcomeIsProjected =
          action.outcome === "resolved"
            ? reconciled.decisionsSoFar.some(
                (decision) => decision.url === action.contextPointer,
              ) &&
              action.graduatedFog.every(
                (graduated) =>
                  !reconciled.fogOfWar.includes(graduated.fog) &&
                  (() => {
                    const created = artifacts.find(
                      (artifact) => artifact.kind === "issue" && artifact.key === graduated.key,
                    );
                    if (created?.kind !== "issue") return false;
                    const projected = reconciled.tickets.find(
                      (candidate) => candidate.number === created.number,
                    );
                    const blockerNumbers = graduated.blockedBy.flatMap((blocker) => {
                      if (blocker.kind === "ticket") return [blocker.ticketNumber];
                      const blockerIssue = artifacts.find(
                        (artifact) => artifact.kind === "issue" && artifact.key === blocker.key,
                      );
                      return blockerIssue?.kind === "issue" ? [blockerIssue.number] : [];
                    });
                    return (
                      projected?.classification === graduated.classification &&
                      blockerNumbers.every((number) => projected.blockedBy.includes(number))
                    );
                  })(),
              )
            : closed?.classification === "out-of-scope" &&
              reconciled.outOfScope.some((entry) => entry.includes(action.contextPointer));
        if (closed?.state !== "closed" || !commentIsCanonical || !outcomeIsProjected) {
          return yield* new WayfinderReconciliationError({
            detail: "GitHub did not confirm the complete canonical HITL resolution.",
          });
        }
        return reconciled;
      }).pipe(Effect.result);

      if (Result.isFailure(resolutionResult)) {
        const correction = yield* loadCanonical().pipe(Effect.result);
        yield* publishMutation(
          event,
          {
            actionId: event.payload.actionId,
            action,
            status: "failed",
            artifacts,
            nextStep,
            error:
              "The HITL resolution is partially applied. Resume or release the canonical claim.",
            updatedAt: event.payload.createdAt,
          },
          Result.isSuccess(correction) ? correction.success : undefined,
          publishTargets,
        );
        return;
      }
      yield* publishMutation(
        event,
        {
          actionId: event.payload.actionId,
          action,
          status: "synchronized",
          artifacts,
          nextStep: null,
          error: null,
          updatedAt: resolutionResult.success.lastSynchronizedAt,
        },
        resolutionResult.success,
        publishTargets,
      );
      return;
    }
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
