import {
  CommandId,
  CheckpointRef,
  ProjectId,
  ProviderInstanceId,
  SkillRunId,
  ThreadId,
  TurnId,
  WorkstreamId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type WorkflowAttachment,
  type WorkflowPublication,
  type WorkflowTicketImplementation,
} from "@t3tools/contracts";
import { initializeWorkflowGraph } from "@t3tools/shared/workflowGraph";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { OrchestrationProjectorDecodeError } from "./Errors.ts";
import { decideOrchestrationCommand } from "./decider.ts";
import { projectEvent } from "./projector.ts";

const now = "2026-08-10T12:00:00.000Z";
const archivedAt = "2026-08-10T12:01:00.000Z";
const reopenedAt = "2026-08-10T12:02:00.000Z";
const projectId = ProjectId.make("project-workflow-archive");
const originThreadId = ThreadId.make("thread-workflow-archive");
const sourceSkillRunId = SkillRunId.make("skill-run:workflow-archive");
const providerInstanceId = ProviderInstanceId.make("codex");
const workstreamId = WorkstreamId.make("workstream:workflow-archive");

function publication(): WorkflowPublication {
  return {
    status: "merged",
    remoteTarget: "origin/feature/workflow-archive",
    remote: "origin",
    headBranch: "feature/workflow-archive",
    targetBranch: "main",
    baselineCommit: "a".repeat(40),
    commits: [{ sha: "b".repeat(40), title: "Workflow archive" }],
    title: "Workflow archive",
    body: "Archive and cleanup workflow resources.",
    authority: { pushBaseline: true, createDraftPullRequest: true },
    authorityGranted: true,
    trackerState: "closed",
    failure: null,
    requestedAt: now,
    updatedAt: now,
  };
}

function implementation(
  status: WorkflowTicketImplementation["status"] = "integrated",
): WorkflowTicketImplementation {
  return {
    id: "implementation:archive:45",
    workstreamId,
    nodeId: "ticket:45",
    ticketKey: "issue-45",
    ticketNumber: 45,
    title: "Archive cleanup",
    actionIdentity: "issue-45:implement",
    status,
    originThreadId,
    implementationThreadId: ThreadId.make("thread:implementation:45"),
    worktreePath: "/tmp/t3-workflow-archive-45",
    branch: "codex/issue-45-archive-workstream-cleanup",
    worktreeOwned: true,
    branchOwned: true,
    fixedPoint: "c".repeat(40),
    acceptanceCriteria: "Archive cleanup remains explicit and safe.",
    providerInstanceId,
    implementSkill: {
      name: "implement",
      path: "/skills/implement/SKILL.md",
      contentDigest: "sha256:" + "d".repeat(64),
    },
    reviewSkill: {
      name: "code-review",
      path: "/skills/code-review/SKILL.md",
      contentDigest: "sha256:" + "e".repeat(64),
    },
    implementationSkillRunId: null,
    reviewSkillRunId: null,
    validation: [],
    diff: null,
    review: null,
    failure: null,
    startedAt: now,
    updatedAt: now,
  };
}

function attachment(
  input: {
    readonly archivedAt?: string | null;
    readonly workflowVersion?: number;
    readonly implementationStatus?: WorkflowTicketImplementation["status"];
    readonly workflowRunAutomationStatus?: "idle" | "running" | "draining" | "paused";
  } = {},
): WorkflowAttachment {
  const base: WorkflowAttachment = {
    originThreadId,
    workstreamId,
    sourceSkillRunId,
    workflowGoal: "Archive this Workstream safely.",
    backfilledWayfinderData: {
      wayfinderSynchronization: {
        status: "healthy",
        reason: "resume",
        lastAttemptedAt: now,
        lastSuccessfulAt: now,
        canMutate: true,
      },
    },
    observationCursor: { sourceSkillRunId, observedAt: now },
    attachedAt: now,
  };
  return {
    ...base,
    workflowGraph: initializeWorkflowGraph(base),
    workflowVersion: input.workflowVersion ?? 2,
    archivedAt: input.archivedAt ?? null,
    publication: publication(),
    ticketImplementations: [implementation(input.implementationStatus)],
    workflowRun: {
      configuration: {
        workflowGoal: base.workflowGoal,
        runScope: [{ nodeId: "ticket:45", label: "Archive cleanup" }],
        defaultProviderInstanceId: providerInstanceId,
        providerOverrides: [],
        requiredSkills: [],
        fixedPoint: "c".repeat(40),
        workstreamBaseline: "feature/workflow-archive",
        remoteTarget: "origin/feature/workflow-archive",
        targetVerification: {
          fixedPoint: "verified",
          workstreamBaseline: "verified",
          remoteTarget: "verified",
        },
        environmentAutomationCapacity: 2,
        executionLimit: 1,
        authority: {
          createWorktree: true,
          runProvider: true,
          mutateTracker: true,
          pushBaseline: false,
          createDraftPullRequest: false,
        },
      },
      status: "confirmed",
      authorityGranted: true,
      confirmedAt: now,
      dispatchIdentity: CommandId.make("workflow-run:archive"),
      immutableAtDispatch: now,
      automationStatus: input.workflowRunAutomationStatus ?? "paused",
    },
  };
}

function thread(
  workflowAttachment: WorkflowAttachment,
  checkpoints: OrchestrationThread["checkpoints"] = [],
): OrchestrationThread {
  return {
    id: originThreadId,
    projectId,
    title: "Workflow archive",
    modelSelection: { instanceId: providerInstanceId, model: "gpt-5.6" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints,
    session: null,
    workflowAttachment,
  };
}

function readModel(
  workflowAttachment = attachment(),
  checkpoints: OrchestrationThread["checkpoints"] = [],
): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [thread(workflowAttachment, checkpoints)],
    updatedAt: now,
  };
}

function applyEvents(
  model: OrchestrationReadModel,
  events: ReadonlyArray<Omit<OrchestrationEvent, "sequence">>,
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> {
  return Effect.gen(function* () {
    let current = model;
    for (const event of events) {
      current = yield* projectEvent(current, {
        ...event,
        sequence: current.snapshotSequence + 1,
      } as OrchestrationEvent);
    }
    return current;
  });
}

function normalizeEvents(
  result:
    | Omit<OrchestrationEvent, "sequence">
    | ReadonlyArray<Omit<OrchestrationEvent, "sequence">>,
): ReadonlyArray<Omit<OrchestrationEvent, "sequence">> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<Omit<OrchestrationEvent, "sequence">>;
  }
  return [result as Omit<OrchestrationEvent, "sequence">];
}

function archiveCommand(commandId = "archive-workstream") {
  return {
    type: "thread.workflow.archive" as const,
    commandId: CommandId.make(commandId),
    threadId: originThreadId,
    expectedWorkstreamVersion: 2,
    confirmed: true as const,
    createdAt: archivedAt,
  };
}

function reopenCommand(commandId = "reopen-workstream") {
  return {
    type: "thread.workflow.reopen" as const,
    commandId: CommandId.make(commandId),
    threadId: originThreadId,
    expectedWorkstreamVersion: 3,
    confirmed: true as const,
    createdAt: reopenedAt,
  };
}

it.layer(NodeServices.layer)("Workflow archival and cleanup boundaries", (it) => {
  it.effect("archives explicitly, preserves the projection, and blocks dispatch", () =>
    Effect.gen(function* () {
      const model = readModel();
      const decided = yield* decideOrchestrationCommand({
        readModel: model,
        command: archiveCommand(),
      });
      const events = normalizeEvents(decided);
      expect(events.map((event) => event.type)).toEqual(["thread.workflow-archived"]);
      const archived = yield* applyEvents(model, events);
      const projected = archived.threads[0]?.workflowAttachment;
      expect(projected?.archivedAt).toBe(archivedAt);
      expect(projected?.workflowGraph).toEqual(model.threads[0]?.workflowAttachment?.workflowGraph);
      expect(projected?.publication).toEqual(model.threads[0]?.workflowAttachment?.publication);
      expect(projected?.ticketImplementations?.[0]?.branch).toBe(
        "codex/issue-45-archive-workstream-cleanup",
      );

      const blocked = yield* decideOrchestrationCommand({
        readModel: archived,
        command: {
          type: "thread.workflow.run.start" as const,
          commandId: CommandId.make("start-archived-workstream"),
          threadId: originThreadId,
          expectedWorkstreamVersion: projected?.workflowVersion ?? 0,
          confirmed: true,
          createdAt: reopenedAt,
        },
      }).pipe(Effect.flip);
      expect(String(blocked)).toContain("archived");
    }),
  );

  it.effect("reopens only after synchronization and capability validation", () =>
    Effect.gen(function* () {
      const archive = yield* decideOrchestrationCommand({
        readModel: readModel(),
        command: archiveCommand(),
      });
      const archivedModel = yield* applyEvents(readModel(), normalizeEvents(archive));
      const reopened = yield* decideOrchestrationCommand({
        readModel: archivedModel,
        command: reopenCommand(),
      });
      const projected = yield* applyEvents(archivedModel, normalizeEvents(reopened));
      expect(normalizeEvents(reopened)[0]?.type).toBe("thread.workflow-reopened");
      expect(projected.threads[0]?.workflowAttachment?.archivedAt).toBeNull();
      expect(projected.threads[0]?.workflowAttachment?.workflowGraph).toEqual(
        archivedModel.threads[0]?.workflowAttachment?.workflowGraph,
      );

      const unhealthy = yield* decideOrchestrationCommand({
        readModel: readModel({
          ...attachment({ archivedAt: archivedAt, workflowVersion: 3 }),
          backfilledWayfinderData: {
            wayfinderSynchronization: {
              status: "unavailable",
              reason: "reconnect",
              lastAttemptedAt: archivedAt,
              canMutate: false,
            },
          },
        }),
        command: reopenCommand("reopen-unhealthy"),
      }).pipe(Effect.flip);
      expect(String(unhealthy)).toContain("synchronization");
    }),
  );

  it.effect("previews cleanup resources and blocks unresolved work", () =>
    Effect.gen(function* () {
      const model = readModel(attachment({ archivedAt }));
      const preview = yield* decideOrchestrationCommand({
        readModel: model,
        command: {
          type: "thread.workflow.cleanup.preflight" as const,
          commandId: CommandId.make("cleanup-preview"),
          threadId: originThreadId,
          expectedWorkstreamVersion: 2,
          createdAt: reopenedAt,
        },
      });
      const projected = yield* applyEvents(model, normalizeEvents(preview));
      const cleanup = projected.threads[0]?.workflowAttachment?.workflowCleanup;
      expect(cleanup).toMatchObject({ status: "previewing", blockers: [] });
      expect(cleanup?.resources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "worktree", path: "/tmp/t3-workflow-archive-45" }),
          expect.objectContaining({
            kind: "branch",
            branch: "codex/issue-45-archive-workstream-cleanup",
          }),
        ]),
      );

      const blocked = yield* decideOrchestrationCommand({
        readModel: readModel(attachment({ archivedAt, implementationStatus: "needs-decision" })),
        command: {
          type: "thread.workflow.cleanup.preflight" as const,
          commandId: CommandId.make("cleanup-preview-blocked"),
          threadId: originThreadId,
          expectedWorkstreamVersion: 2,
          createdAt: reopenedAt,
        },
      });
      const blockedProjection = yield* applyEvents(
        readModel(attachment({ archivedAt, implementationStatus: "needs-decision" })),
        normalizeEvents(blocked),
      );
      const blockedCleanup = blockedProjection.threads[0]?.workflowAttachment?.workflowCleanup;
      expect(blockedCleanup?.status).toBe("blocked");
      expect(blockedCleanup?.blockers.some((blocker) => blocker.includes("Needs Decision"))).toBe(
        true,
      );

      const checkpointBlocked = yield* decideOrchestrationCommand({
        readModel: readModel(attachment({ archivedAt }), [
          {
            turnId: TurnId.make("turn:workflow-archive"),
            checkpointTurnCount: 1,
            checkpointRef: CheckpointRef.make("refs/t3/checkpoints/workflow-archive/turn/1"),
            status: "error",
            files: [],
            assistantMessageId: null,
            completedAt: reopenedAt,
          },
        ]),
        command: {
          type: "thread.workflow.cleanup.preflight" as const,
          commandId: CommandId.make("cleanup-preview-checkpoint-blocked"),
          threadId: originThreadId,
          expectedWorkstreamVersion: 2,
          createdAt: reopenedAt,
        },
      });
      expect(normalizeEvents(checkpointBlocked)[0]?.payload).toMatchObject({
        attachment: {
          workflowCleanup: {
            status: "blocked",
            blockers: [expect.stringContaining("unresolved checkpoints")],
          },
        },
      });

      for (const implementationStatus of ["checkpointed", "integration-failed"] as const) {
        const unresolved = yield* decideOrchestrationCommand({
          readModel: readModel(attachment({ archivedAt, implementationStatus })),
          command: {
            type: "thread.workflow.cleanup.preflight" as const,
            commandId: CommandId.make(`cleanup-preview-${implementationStatus}`),
            threadId: originThreadId,
            expectedWorkstreamVersion: 2,
            createdAt: reopenedAt,
          },
        });
        const unresolvedEvent = normalizeEvents(unresolved)[0] as Omit<
          Extract<OrchestrationEvent, { readonly type: "thread.workflow-cleanup-preflighted" }>,
          "sequence"
        >;
        const unresolvedCleanup = unresolvedEvent.payload.attachment.workflowCleanup;
        expect(unresolvedCleanup?.status).toBe("blocked");
        expect(
          unresolvedCleanup?.blockers.some((blocker) =>
            blocker.includes("Ticket Implementation effects"),
          ),
        ).toBe(true);
      }
    }),
  );

  it.effect("requires a ready preview before cleanup and makes confirmation idempotent", () =>
    Effect.gen(function* () {
      const model = readModel(attachment({ archivedAt }));
      const preview = yield* decideOrchestrationCommand({
        readModel: model,
        command: {
          type: "thread.workflow.cleanup.preflight" as const,
          commandId: CommandId.make("cleanup-preview-ready"),
          threadId: originThreadId,
          expectedWorkstreamVersion: 2,
          createdAt: reopenedAt,
        },
      });
      const previewed = yield* applyEvents(model, normalizeEvents(preview));
      const previewedAttachment = previewed.threads[0]?.workflowAttachment;
      const cleanup = previewedAttachment?.workflowCleanup;
      expect(cleanup).toBeDefined();
      const ready = {
        ...cleanup!,
        status: "ready" as const,
        blockers: [],
        updatedAt: reopenedAt,
      };
      const updated = yield* decideOrchestrationCommand({
        readModel: previewed,
        command: {
          type: "thread.workflow.cleanup.update" as const,
          commandId: CommandId.make("cleanup-update-ready"),
          threadId: originThreadId,
          expectedWorkstreamVersion: previewedAttachment?.workflowVersion ?? 0,
          cleanup: ready,
          createdAt: reopenedAt,
        },
      });
      const readyProjection = yield* applyEvents(previewed, normalizeEvents(updated));
      const readyAttachment = readyProjection.threads[0]?.workflowAttachment;
      const requested = yield* decideOrchestrationCommand({
        readModel: readyProjection,
        command: {
          type: "thread.workflow.cleanup.confirm" as const,
          commandId: CommandId.make("cleanup-confirm"),
          threadId: originThreadId,
          expectedWorkstreamVersion: readyAttachment?.workflowVersion ?? 0,
          confirmed: true,
          createdAt: reopenedAt,
        },
      });
      expect(normalizeEvents(requested).map((event) => event.type)).toEqual([
        "thread.workflow-cleanup-requested",
      ]);
      const cleaning = yield* applyEvents(readyProjection, normalizeEvents(requested));
      const cleaningAttachment = cleaning.threads[0]?.workflowAttachment;
      expect(cleaningAttachment?.workflowCleanup).toMatchObject({
        status: "cleaning",
      });
      const replay = yield* decideOrchestrationCommand({
        readModel: cleaning,
        command: {
          type: "thread.workflow.cleanup.confirm" as const,
          commandId: CommandId.make("cleanup-confirm-replay"),
          threadId: originThreadId,
          expectedWorkstreamVersion: cleaningAttachment?.workflowVersion ?? 0,
          confirmed: true,
          createdAt: reopenedAt,
        },
      });
      expect(normalizeEvents(replay)[0]?.type).toBe("thread.workflow-cleanup-requested");
    }),
  );

  it.effect("drains active automation before archiving", () =>
    Effect.gen(function* () {
      const model = readModel(attachment({ workflowRunAutomationStatus: "running" }));
      const requested = yield* decideOrchestrationCommand({
        readModel: model,
        command: archiveCommand("archive-running-workstream"),
      });
      expect(normalizeEvents(requested)[0]?.type).toBe("thread.workflow-archive-requested");
      const draining = yield* applyEvents(model, normalizeEvents(requested));
      const drainingAttachment = draining.threads[0]?.workflowAttachment;
      expect(drainingAttachment).toMatchObject({ archiveRequestedAt: archivedAt });
      const completed = yield* decideOrchestrationCommand({
        readModel: draining,
        command: {
          type: "thread.workflow.run.drain.complete" as const,
          commandId: CommandId.make("archive-drain-complete"),
          threadId: originThreadId,
          expectedWorkstreamVersion: drainingAttachment?.workflowVersion ?? 0,
          createdAt: reopenedAt,
        },
      });
      expect(normalizeEvents(completed)[0]?.type).toBe("thread.workflow-archived");
      const archived = yield* applyEvents(draining, normalizeEvents(completed));
      expect(archived.threads[0]?.workflowAttachment).toMatchObject({
        archivedAt: reopenedAt,
        archiveRequestedAt: undefined,
      });
    }),
  );
});
