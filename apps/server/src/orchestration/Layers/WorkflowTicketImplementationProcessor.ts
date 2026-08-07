import {
  CommandId,
  MessageId,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationThread,
  type WorkflowDiffEvidence,
  type WorkflowTicketImplementation,
} from "@t3tools/contracts";
import {
  workflowTicketImplementationBranch,
  workflowTicketImplementationThreadId,
} from "@t3tools/shared/workflowTicketImplementation";
import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBus } from "../Services/RuntimeReceiptBus.ts";
import { parseWorkflowTicketImplementationReviewResult } from "../WorkflowTicketImplementationReview.ts";
import { stableStringify } from "@t3tools/shared/relaySigning";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";

type TicketImplementationRequestedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.workflow-ticket-implementation-requested" }
>;
type TicketImplementationUpdatedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.workflow-ticket-implementation-updated" }
>;
type SessionSetEvent = Extract<OrchestrationEvent, { type: "thread.session-set" }>;
type TurnStartRequestedEvent = Extract<OrchestrationEvent, { type: "thread.turn-start-requested" }>;
type WorkflowTicketImplementationEvent =
  | TicketImplementationRequestedEvent
  | TicketImplementationUpdatedEvent
  | SessionSetEvent
  | TurnStartRequestedEvent;

function implementationById(
  thread: OrchestrationThread,
  implementationId: string,
): {
  readonly originThread: OrchestrationThread;
  readonly implementation: WorkflowTicketImplementation;
} | null {
  const implementation = thread.workflowAttachment?.ticketImplementations?.find(
    (candidate) => candidate.id === implementationId,
  );
  return implementation === undefined ? null : { originThread: thread, implementation };
}

function implementationPhase(
  implementation: WorkflowTicketImplementation,
  fallback: "worktree" | "implementation" | "review" = "implementation",
): "worktree" | "implementation" | "review" {
  if (implementation.status === "dispatching") return "worktree";
  if (
    implementation.status === "reviewing" ||
    implementation.status === "reviewed" ||
    implementation.status === "needs-correction"
  ) {
    return "review";
  }
  return fallback;
}

function implementationMessage(
  implementation: WorkflowTicketImplementation,
  phase: "implementation" | "review",
): string {
  if (phase === "review") {
    return [
      `Run the pinned /code-review child for ticket #${implementation.ticketNumber}.`,
      `Review the current worktree changes against the original Fixed Point ${implementation.fixedPoint}.`,
      "Only structured review evidence may complete this gate; prose alone is not workflow authority.",
      "Finish with exactly one result wrapped in <t3-ticket-implementation-review-result> tags.",
      `The JSON shape is {"status":"passed"|"must-fix","summary":"...","findings":[{"severity":"must-fix"|"suggestion","summary":"...","file":"optional","line":1}],"validation":[{"name":"...","status":"passed"|"failed"|"not-run","command":"optional","detail":"optional"}]}.`,
    ].join("\n\n");
  }
  return [
    `Implement ticket #${implementation.ticketNumber} against Fixed Point ${implementation.fixedPoint}.`,
    "",
    implementation.acceptanceCriteria,
    "",
    "The pinned /code-review child is required before this Ticket Implementation can be marked reviewed.",
  ].join("\n");
}

export const makeWorkflowTicketImplementationProcessor = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const git = yield* GitWorkflowService;
  const receipts = yield* RuntimeReceiptBus;

  const serverCommandId = Effect.fn("WorkflowTicketImplementationReactor.serverCommandId")(
    function* (tag: string) {
      return CommandId.make(`server:${tag}:${yield* crypto.randomUUIDv4}`);
    },
  );

  const publishProgress = Effect.fn("WorkflowTicketImplementationReactor.publishProgress")(
    function* (input: {
      readonly implementation: WorkflowTicketImplementation;
      readonly message: string | null;
      readonly phase?: "worktree" | "implementation" | "review";
    }) {
      yield* receipts.publish({
        type: "workflow.ticket-implementation.progress",
        threadId: input.implementation.originThreadId,
        ticketNodeId: input.implementation.nodeId,
        implementationId: input.implementation.id,
        actionIdentity: input.implementation.actionIdentity,
        phase: input.phase ?? implementationPhase(input.implementation),
        status: input.implementation.status,
        createdAt: input.implementation.updatedAt,
        message: input.message,
      });
    },
  );

  const updateImplementation = Effect.fn(
    "WorkflowTicketImplementationReactor.updateImplementation",
  )(function* (input: {
    readonly implementationId: string;
    readonly patch: Partial<WorkflowTicketImplementation>;
  }) {
    const snapshot = yield* snapshots.getSnapshot();
    const originThread = snapshot.threads.find((thread) =>
      thread.workflowAttachment?.ticketImplementations?.some(
        (implementation) => implementation.id === input.implementationId,
      ),
    );
    const current = originThread?.workflowAttachment?.ticketImplementations?.find(
      (implementation) => implementation.id === input.implementationId,
    );
    const attachment = originThread?.workflowAttachment;
    if (originThread === undefined || current === undefined || attachment === undefined) {
      return null;
    }
    const next: WorkflowTicketImplementation = {
      ...current,
      ...input.patch,
      id: current.id,
      originThreadId: current.originThreadId,
      updatedAt: input.patch.updatedAt ?? current.updatedAt,
    };
    if (stableStringify(next) === stableStringify(current)) return current;
    yield* orchestrationEngine.dispatch({
      type: "thread.workflow.ticket-implementation.update",
      commandId: yield* serverCommandId("ticket-implementation-update"),
      threadId: originThread.id,
      implementationId: current.id,
      implementation: next,
      expectedWorkstreamVersion: attachment.workflowVersion ?? 0,
      createdAt: next.updatedAt,
    });
    return next;
  });

  const worktreeForImplementation = Effect.fn(
    "WorkflowTicketImplementationReactor.worktreeForImplementation",
  )(function* (input: {
    readonly cwd: string;
    readonly implementation: WorkflowTicketImplementation;
  }) {
    const branch =
      input.implementation.branch ??
      workflowTicketImplementationBranch({
        ticketNumber: input.implementation.ticketNumber,
        actionIdentity: input.implementation.actionIdentity,
      });
    const refs = yield* git.listRefs({
      cwd: input.cwd,
      query: branch,
      refKind: "local",
      includeMatchingRemoteRefs: false,
    });
    const existing = refs.refs.find(
      (ref) => ref.name === branch && ref.worktreePath !== null,
    )?.worktreePath;
    if (existing !== undefined && existing !== null) {
      return { branch, path: existing };
    }
    const worktree = yield* git.createWorktree({
      cwd: input.cwd,
      refName: refs.refs.some((ref) => ref.name === branch)
        ? branch
        : input.implementation.fixedPoint,
      ...(refs.refs.some((ref) => ref.name === branch) ? {} : { newRefName: branch }),
      baseRefName: input.implementation.fixedPoint,
      path: null,
    });
    return { branch, path: worktree.worktree.path };
  });

  const ensureImplementationThread = Effect.fn(
    "WorkflowTicketImplementationReactor.ensureImplementationThread",
  )(function* (input: {
    readonly originThread: OrchestrationThread;
    readonly implementation: WorkflowTicketImplementation;
  }) {
    const snapshot = yield* snapshots.getSnapshot();
    const threadId =
      input.implementation.implementationThreadId ??
      ThreadId.make(
        workflowTicketImplementationThreadId({
          workstreamId: input.implementation.workstreamId,
          ticketNumber: input.implementation.ticketNumber,
          actionIdentity: input.implementation.actionIdentity,
        }),
      );
    const existing = snapshot.threads.find((thread) => thread.id === threadId);
    if (existing === undefined) {
      yield* orchestrationEngine.dispatch({
        type: "thread.create",
        commandId: yield* serverCommandId("ticket-implementation-thread-create"),
        threadId,
        projectId: input.originThread.projectId,
        title: `Implement #${input.implementation.ticketNumber}: ${input.implementation.title}`,
        modelSelection: {
          ...input.originThread.modelSelection,
          instanceId: input.implementation.providerInstanceId,
        },
        runtimeMode: input.originThread.runtimeMode,
        interactionMode: input.originThread.interactionMode,
        branch: input.implementation.branch,
        worktreePath: input.implementation.worktreePath,
        createdAt: input.implementation.updatedAt,
      });
    } else if (
      existing.worktreePath !== input.implementation.worktreePath ||
      existing.branch !== input.implementation.branch
    ) {
      yield* orchestrationEngine.dispatch({
        type: "thread.meta.update",
        commandId: yield* serverCommandId("ticket-implementation-thread-meta"),
        threadId,
        expectedBranch: existing.branch,
        branch: input.implementation.branch,
        worktreePath: input.implementation.worktreePath,
      });
    }
    return threadId;
  });

  const startSkillTurn = Effect.fn("WorkflowTicketImplementationReactor.startSkillTurn")(
    function* (input: {
      readonly originThread: OrchestrationThread;
      readonly implementation: WorkflowTicketImplementation;
      readonly phase: "implementation" | "review";
    }) {
      const threadId = input.implementation.implementationThreadId;
      if (threadId === null) return null;
      const snapshot = yield* snapshots.getSnapshot();
      const thread = snapshot.threads.find((candidate) => candidate.id === threadId);
      const recordedSkillRunId =
        input.phase === "implementation"
          ? input.implementation.implementationSkillRunId
          : input.implementation.reviewSkillRunId;
      if (recordedSkillRunId !== null) return recordedSkillRunId;
      const expectedSkill =
        input.phase === "implementation"
          ? input.implementation.implementSkill
          : input.implementation.reviewSkill;
      const latestTurn = thread?.latestTurn;
      if (
        latestTurn !== null &&
        latestTurn !== undefined &&
        latestTurn.skillInvocation?.skill.name === expectedSkill.name &&
        latestTurn.skillInvocation.skill.path === expectedSkill.path &&
        latestTurn.state !== "error" &&
        latestTurn.state !== "interrupted"
      ) {
        return latestTurn.skillInvocation.skillRunId;
      }
      const messageId = MessageId.make(`${input.implementation.id}:message:${input.phase}`);
      yield* orchestrationEngine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make(
          `server:ticket-implementation:${input.implementation.id}:${input.phase}:turn-start`,
        ),
        threadId,
        message: {
          messageId,
          role: "user",
          text: implementationMessage(input.implementation, input.phase),
          attachments: [],
        },
        modelSelection: {
          ...(thread?.modelSelection ?? input.originThread.modelSelection),
          instanceId: input.implementation.providerInstanceId,
        },
        runtimeMode: thread?.runtimeMode ?? input.originThread.runtimeMode,
        interactionMode: thread?.interactionMode ?? input.originThread.interactionMode,
        skillInvocation: {
          skill: expectedSkill,
          execution: { mode: "generic", reason: "unregistered-skill" },
          reconnectWorkstreamId: input.implementation.workstreamId,
        },
        createdAt: input.implementation.updatedAt,
      });
      const afterStart = yield* snapshots.getSnapshot();
      return (
        afterStart.threads.find((candidate) => candidate.id === threadId)?.latestTurn
          ?.skillInvocation?.skillRunId ?? null
      );
    },
  );

  const processRequested = Effect.fn("WorkflowTicketImplementationReactor.processRequested")(
    function* (event: TicketImplementationRequestedEvent) {
      const snapshot = yield* snapshots.getSnapshot();
      const originThread = snapshot.threads.find((thread) => thread.id === event.payload.threadId);
      const implementation = originThread
        ? implementationById(originThread, event.payload.implementation.id)?.implementation
        : undefined;
      if (originThread === undefined || implementation === undefined) return;
      if (
        implementation.status !== "dispatching" ||
        implementation.implementationThreadId !== null ||
        implementation.implementationSkillRunId !== null
      ) {
        yield* publishProgress({
          implementation,
          message: "Existing Ticket Implementation retained; no duplicate run was created.",
        });
        return;
      }
      const cwd = resolveThreadWorkspaceCwd({
        thread: originThread,
        projects: snapshot.projects,
      });
      if (cwd === undefined) {
        const failed = yield* updateImplementation({
          implementationId: implementation.id,
          patch: {
            status: "failed",
            failure: "The Origin Thread has no resolvable project workspace.",
            updatedAt: event.payload.createdAt,
          },
        });
        if (failed) yield* publishProgress({ implementation: failed, message: failed.failure });
        return;
      }
      const worktree =
        implementation.worktreePath === null
          ? yield* worktreeForImplementation({ cwd, implementation })
          : { branch: implementation.branch!, path: implementation.worktreePath };
      const implementing = yield* updateImplementation({
        implementationId: implementation.id,
        patch: {
          status: "implementing",
          branch: worktree.branch,
          worktreePath: worktree.path,
          failure: null,
          updatedAt: event.payload.createdAt,
        },
      });
      if (implementing === null) return;
      const threadId = yield* ensureImplementationThread({
        originThread,
        implementation: implementing,
      });
      const withThread = yield* updateImplementation({
        implementationId: implementing.id,
        patch: {
          implementationThreadId: threadId,
          updatedAt: event.payload.createdAt,
        },
      });
      if (withThread === null) return;
      const skillRunId = yield* startSkillTurn({
        originThread,
        implementation: withThread,
        phase: "implementation",
      });
      const updated = yield* updateImplementation({
        implementationId: withThread.id,
        patch: {
          status: "implementing",
          ...(skillRunId !== null ? { implementationSkillRunId: skillRunId } : {}),
          updatedAt: event.payload.createdAt,
        },
      });
      if (updated !== null) {
        yield* publishProgress({
          implementation: updated,
          message: "Pinned /implement dispatched in the isolated ticket worktree.",
        });
      }
    },
  );

  const processSessionSet = Effect.fn("WorkflowTicketImplementationReactor.processSessionSet")(
    function* (event: SessionSetEvent) {
      const snapshot = yield* snapshots.getSnapshot();
      const originThread = snapshot.threads.find((thread) =>
        thread.workflowAttachment?.ticketImplementations?.some(
          (implementation) => implementation.implementationThreadId === event.payload.threadId,
        ),
      );
      const implementation = originThread?.workflowAttachment?.ticketImplementations?.find(
        (candidate) => candidate.implementationThreadId === event.payload.threadId,
      );
      const implementationThread = snapshot.threads.find(
        (thread) => thread.id === event.payload.threadId,
      );
      if (
        originThread === undefined ||
        implementation === undefined ||
        implementationThread === undefined
      ) {
        return;
      }
      const terminal = ["error", "stopped", "interrupted"].includes(event.payload.session.status);
      if (
        terminal &&
        (implementation.status === "implementing" || implementation.status === "reviewing")
      ) {
        const failed = yield* updateImplementation({
          implementationId: implementation.id,
          patch: {
            status: "failed",
            failure:
              event.payload.session.lastError ??
              "The provider session stopped before the workflow milestone completed.",
            updatedAt: event.payload.session.updatedAt,
          },
        });
        if (failed) yield* publishProgress({ implementation: failed, message: failed.failure });
        return;
      }
      if (implementation.status === "reviewing") {
        if (
          event.payload.session.status !== "ready" ||
          implementationThread.latestTurn?.state !== "completed" ||
          implementation.reviewSkillRunId === null
        ) {
          return;
        }
        const assistantMessageId = implementationThread.latestTurn.assistantMessageId;
        const output =
          (assistantMessageId === null
            ? null
            : implementationThread.messages.find((message) => message.id === assistantMessageId)
          )?.text ??
          implementationThread.messages
            .filter((message) => message.role === "assistant")
            .toSorted((left, right) => left.updatedAt.localeCompare(right.updatedAt))
            .at(-1)?.text ??
          "";
        const result = parseWorkflowTicketImplementationReviewResult(output);
        if (result === null) {
          yield* publishProgress({
            implementation,
            message:
              "Code Review completed without a structured result; the Ticket Implementation remains in review.",
            phase: "review",
          });
          return;
        }
        const attachment = originThread.workflowAttachment;
        if (attachment === undefined) return;
        yield* orchestrationEngine.dispatch({
          type: "thread.workflow.ticket-implementation.review.record",
          commandId: CommandId.make(
            `server:ticket-implementation:${implementation.id}:${implementation.reviewSkillRunId}:review-record`,
          ),
          threadId: originThread.id,
          implementationId: implementation.id,
          expectedWorkstreamVersion: attachment.workflowVersion ?? 0,
          review: {
            status: result.status,
            skillRunId: implementation.reviewSkillRunId,
            fixedPoint: implementation.fixedPoint,
            summary: result.summary,
            findings: result.findings,
            completedAt: event.payload.session.updatedAt,
          },
          validation: result.validation.map((evidence) => ({
            ...evidence,
            recordedAt: event.payload.session.updatedAt,
          })),
          createdAt: event.payload.session.updatedAt,
        });
        return;
      }
      if (
        implementation.status !== "implementing" ||
        event.payload.session.status !== "ready" ||
        implementationThread.latestTurn?.state !== "completed"
      ) {
        return;
      }
      const localStatus =
        implementation.worktreePath === null
          ? null
          : yield* git.localStatus({ cwd: implementation.worktreePath });
      const diff: WorkflowDiffEvidence | null =
        localStatus === null
          ? null
          : {
              fixedPoint: implementation.fixedPoint,
              files: localStatus.workingTree.files.map((file) => ({
                path: file.path,
                additions: file.insertions,
                deletions: file.deletions,
              })),
              additions: localStatus.workingTree.insertions,
              deletions: localStatus.workingTree.deletions,
              capturedAt: event.payload.session.updatedAt,
            };
      const reviewing = yield* updateImplementation({
        implementationId: implementation.id,
        patch: {
          status: "reviewing",
          diff,
          failure: null,
          updatedAt: event.payload.session.updatedAt,
        },
      });
      if (reviewing === null) return;
      const reviewSkillRunId = yield* startSkillTurn({
        originThread,
        implementation: reviewing,
        phase: "review",
      });
      const updated = yield* updateImplementation({
        implementationId: reviewing.id,
        patch: {
          status: "reviewing",
          ...(reviewSkillRunId !== null ? { reviewSkillRunId } : {}),
          updatedAt: event.payload.session.updatedAt,
        },
      });
      if (updated !== null) {
        yield* publishProgress({
          implementation: updated,
          message: "Pinned /code-review dispatched against the original Fixed Point.",
          phase: "review",
        });
      }
    },
  );

  const processUpdated = Effect.fn("WorkflowTicketImplementationReactor.processUpdated")(function* (
    event: TicketImplementationUpdatedEvent,
  ) {
    yield* publishProgress({
      implementation: event.payload.implementation,
      message:
        event.payload.implementation.status === "reviewed"
          ? "Structured Code Review evidence recorded; integration remains a downstream milestone."
          : null,
    });
  });

  const processTurnStartRequested = Effect.fn(
    "WorkflowTicketImplementationReactor.processTurnStartRequested",
  )(function* (event: TurnStartRequestedEvent) {
    const skillInvocation = event.payload.skillInvocation;
    if (skillInvocation === undefined) return;
    const snapshot = yield* snapshots.getSnapshot();
    const implementation = snapshot.threads
      .flatMap((thread) => thread.workflowAttachment?.ticketImplementations ?? [])
      .find((candidate) => candidate.implementationThreadId === event.payload.threadId);
    if (implementation === undefined) return;
    if (skillInvocation.skill.name === implementation.implementSkill.name) {
      yield* updateImplementation({
        implementationId: implementation.id,
        patch: {
          implementationSkillRunId: skillInvocation.skillRunId,
          updatedAt: event.payload.createdAt,
        },
      });
      return;
    }
    if (skillInvocation.skill.name === implementation.reviewSkill.name) {
      yield* updateImplementation({
        implementationId: implementation.id,
        patch: {
          reviewSkillRunId: skillInvocation.skillRunId,
          updatedAt: event.payload.createdAt,
        },
      });
    }
  });

  return Effect.fn("WorkflowTicketImplementationReactor.processEvent")(function* (
    event: WorkflowTicketImplementationEvent,
  ) {
    switch (event.type) {
      case "thread.workflow-ticket-implementation-requested":
        yield* processRequested(event);
        return;
      case "thread.workflow-ticket-implementation-updated":
        yield* processUpdated(event);
        return;
      case "thread.session-set":
        yield* processSessionSet(event);
        return;
      case "thread.turn-start-requested":
        yield* processTurnStartRequested(event);
        return;
    }
  });
});
