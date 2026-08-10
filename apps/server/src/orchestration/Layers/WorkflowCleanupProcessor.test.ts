import {
  CommandId,
  EventId,
  GitCommandError,
  ProjectId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type VcsStatusLocalResult,
  type WorkflowAttachment,
  type WorkflowCleanup,
} from "@t3tools/contracts";
import { assert, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { PersistenceSqlError } from "../../persistence/Errors.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  RuntimeReceiptBus,
  type OrchestrationRuntimeReceipt,
} from "../Services/RuntimeReceiptBus.ts";
import {
  makeWorkflowCleanupProcessor,
  type WorkflowCleanupEvent,
} from "./WorkflowCleanupProcessor.ts";
import { makeWorkflowCleanupReactor } from "./WorkflowCleanupReactor.ts";

const now = "2026-08-10T12:00:00.000Z";
const threadId = ThreadId.make("thread:cleanup-processor");
const projectId = ProjectId.make("project:cleanup-processor");
const branch = "codex/workflow-cleanup";
const worktreePath = "/tmp/workflow-cleanup-worktree";

function localStatus(
  input: {
    readonly isRepo?: boolean;
    readonly refName?: string | null;
    readonly hasWorkingTreeChanges?: boolean;
  } = {},
): VcsStatusLocalResult {
  return {
    isRepo: input.isRepo ?? true,
    hasPrimaryRemote: false,
    isDefaultRef: false,
    refName: input.refName === undefined ? branch : input.refName,
    hasWorkingTreeChanges: input.hasWorkingTreeChanges ?? false,
    workingTree: { files: [], insertions: 0, deletions: 0 },
  };
}

function cleanup(status: WorkflowCleanup["status"]): WorkflowCleanup {
  return {
    status,
    resources: [
      {
        id: "worktree:cleanup",
        kind: "worktree",
        path: worktreePath,
        branch,
        owned: true,
        status: status === "cleaning" ? "eligible" : "eligible",
        reason: null,
      },
    ],
    blockers: [],
    failure: null,
    requestedAt: now,
    updatedAt: now,
  };
}

function attachment(workflowCleanup: WorkflowCleanup): WorkflowAttachment {
  return {
    originThreadId: threadId,
    workstreamId: "workstream:cleanup-processor",
    sourceSkillRunId: "skill-run:cleanup-processor",
    workflowGoal: "Clean up a completed Workstream.",
    backfilledWayfinderData: {},
    observationCursor: {},
    archivedAt: now,
    workflowVersion: 4,
    workflowCleanup,
    attachedAt: now,
  } as unknown as WorkflowAttachment;
}

function event(
  type: WorkflowCleanupEvent["type"],
  workflowCleanup: WorkflowCleanup,
): WorkflowCleanupEvent {
  const commandId = CommandId.make(`command:${type}`);
  const attached = attachment(workflowCleanup);
  return {
    sequence: 1,
    eventId: EventId.make(`event:${type}`),
    aggregateKind: "thread",
    aggregateId: threadId,
    type,
    occurredAt: now,
    commandId,
    causationEventId: null,
    correlationId: commandId,
    metadata: {},
    payload: { threadId, attachment: attached },
  } as WorkflowCleanupEvent;
}

function readModel(workflowAttachment: WorkflowAttachment): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [{ id: projectId, workspaceRoot: "/repo" }],
    threads: [
      {
        id: threadId,
        projectId,
        worktreePath: null,
        workflowAttachment,
      },
    ],
    updatedAt: now,
  } as unknown as OrchestrationReadModel;
}

function dependencies(input: {
  readonly attachment: WorkflowAttachment;
  readonly localStatus?: VcsStatusLocalResult;
  readonly removeWorktree?: Effect.Effect<void, GitCommandError>;
  readonly snapshot?: OrchestrationReadModel;
  readonly snapshotFailure?: PersistenceSqlError;
  readonly stream?: Stream.Stream<OrchestrationEvent>;
}) {
  const dispatched: OrchestrationCommand[] = [];
  const receipts: OrchestrationRuntimeReceipt[] = [];
  const layer = Layer.mergeAll(
    NodeServices.layer,
    Layer.succeed(OrchestrationEngineService, {
      readEvents: () => Stream.empty,
      dispatch: (command) =>
        Effect.sync(() => dispatched.push(command)).pipe(Effect.as({ sequence: 2 })),
      streamDomainEvents: input.stream ?? Stream.empty,
      latestSequence: Effect.succeed(1),
    }),
    Layer.mock(ProjectionSnapshotQuery)({
      getSnapshot: () =>
        input.snapshotFailure === undefined
          ? Effect.succeed(input.snapshot ?? readModel(input.attachment))
          : Effect.fail(input.snapshotFailure),
    }),
    Layer.mock(GitWorkflowService)({
      invalidateLocalStatus: () => Effect.void,
      localStatus: () => Effect.succeed(input.localStatus ?? localStatus()),
      removeWorktree: () => input.removeWorktree ?? Effect.void,
    }),
    Layer.succeed(RuntimeReceiptBus, {
      publish: (receipt) => Effect.sync(() => receipts.push(receipt)),
      streamEventsForTest: Stream.empty,
    }),
  );
  return { layer, dispatched, receipts };
}

function lastCleanupCommand(dispatched: ReadonlyArray<OrchestrationCommand>) {
  const command = dispatched.at(-1);
  assert(command?.type === "thread.workflow.cleanup.update");
  return command;
}

function cleanupReceipts(receipts: ReadonlyArray<OrchestrationRuntimeReceipt>) {
  return receipts.filter(
    (
      receipt,
    ): receipt is Extract<OrchestrationRuntimeReceipt, { type: "workflow.cleanup.progress" }> =>
      receipt.type === "workflow.cleanup.progress",
  );
}

it.effect("previews clean, dirty, absent, and branch-mismatched worktrees safely", () =>
  Effect.gen(function* () {
    const cases = [
      {
        name: "clean",
        status: localStatus(),
        expectedStatus: "ready" as const,
        resource: "eligible" as const,
      },
      {
        name: "dirty",
        status: localStatus({ hasWorkingTreeChanges: true }),
        expectedStatus: "blocked" as const,
        resource: "blocked" as const,
      },
      {
        name: "absent",
        status: localStatus({ isRepo: false, refName: null }),
        expectedStatus: "ready" as const,
        resource: "removed" as const,
      },
      {
        name: "reused branch",
        status: localStatus({ refName: "feature/other-workstream" }),
        expectedStatus: "blocked" as const,
        resource: "blocked" as const,
      },
    ] as const;
    for (const testCase of cases) {
      const input = dependencies({
        attachment: attachment(cleanup("previewing")),
        localStatus: testCase.status,
      });
      const process = yield* makeWorkflowCleanupProcessor.pipe(Effect.provide(input.layer));
      yield* process(event("thread.workflow-cleanup-preflighted", cleanup("previewing")));
      const command = lastCleanupCommand(input.dispatched);
      expect(command.cleanup.status, testCase.name).toBe(testCase.expectedStatus);
      expect(command.cleanup.resources[0]?.status, testCase.name).toBe(testCase.resource);
      expect(cleanupReceipts(input.receipts).at(-1)?.status, testCase.name).toBe(
        testCase.expectedStatus,
      );
    }
  }),
);

it.effect("removes only a clean matching worktree and reports removal failures", () =>
  Effect.gen(function* () {
    let removeCalls = 0;
    const input = dependencies({
      attachment: attachment(cleanup("cleaning")),
      removeWorktree: Effect.sync(() => {
        removeCalls += 1;
      }),
    });
    const process = yield* makeWorkflowCleanupProcessor.pipe(Effect.provide(input.layer));
    yield* process(event("thread.workflow-cleanup-requested", cleanup("cleaning")));
    expect(removeCalls).toBe(1);
    expect(lastCleanupCommand(input.dispatched).cleanup.status).toBe("completed");
    expect(lastCleanupCommand(input.dispatched).cleanup.resources[0]?.status).toBe("removed");
    expect(cleanupReceipts(input.receipts).at(-1)?.status).toBe("completed");

    const failure = new GitCommandError({
      operation: "test.remove-worktree",
      command: "git worktree remove",
      cwd: "/repo",
      detail: "worktree is dirty",
    });
    const failed = dependencies({
      attachment: attachment(cleanup("cleaning")),
      removeWorktree: Effect.fail(failure),
    });
    const failedProcess = yield* makeWorkflowCleanupProcessor.pipe(Effect.provide(failed.layer));
    yield* failedProcess(event("thread.workflow-cleanup-requested", cleanup("cleaning")));
    expect(lastCleanupCommand(failed.dispatched).cleanup.status).toBe("needs-recovery");
    expect(lastCleanupCommand(failed.dispatched).cleanup.resources[0]?.status).toBe("blocked");
    expect(cleanupReceipts(failed.receipts).at(-1)?.status).toBe("needs-recovery");
  }),
);

it.effect("reactor drains cleanup events and records processor failures as recovery", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const requested = event("thread.workflow-cleanup-requested", cleanup("cleaning"));
      const input = dependencies({
        attachment: attachment(cleanup("cleaning")),
        stream: Stream.fromIterable([requested]),
      });
      const reactor = yield* makeWorkflowCleanupReactor.pipe(Effect.provide(input.layer));
      yield* reactor.start();
      yield* Effect.yieldNow;
      yield* reactor.drain;
      expect(lastCleanupCommand(input.dispatched).cleanup.status).toBe("completed");

      const failedInput = dependencies({
        attachment: attachment(cleanup("previewing")),
        stream: Stream.fromIterable([
          event("thread.workflow-cleanup-preflighted", cleanup("previewing")),
        ]),
        snapshotFailure: new PersistenceSqlError({
          operation: "test.snapshot",
          detail: "snapshot unavailable",
        }),
      });
      const failedReactor = yield* makeWorkflowCleanupReactor.pipe(
        Effect.provide(failedInput.layer),
      );
      yield* failedReactor.start();
      yield* Effect.yieldNow;
      yield* failedReactor.drain;
      expect(lastCleanupCommand(failedInput.dispatched).cleanup.status).toBe("needs-recovery");
    }),
  ),
);
