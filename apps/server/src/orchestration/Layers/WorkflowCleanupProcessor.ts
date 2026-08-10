import {
  CommandId,
  type OrchestrationEvent,
  type ThreadId,
  type WorkflowCleanup,
  type WorkflowCleanupResource,
} from "@t3tools/contracts";
import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBus } from "../Services/RuntimeReceiptBus.ts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

type CleanupPreflightedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.workflow-cleanup-preflighted" }
>;
type CleanupRequestedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.workflow-cleanup-requested" }
>;

export type WorkflowCleanupEvent = CleanupPreflightedEvent | CleanupRequestedEvent;

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const makeWorkflowCleanupProcessor = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const git = yield* GitWorkflowService;
  const receipts = yield* RuntimeReceiptBus;

  const serverCommandId = Effect.fn("WorkflowCleanupReactor.serverCommandId")(function* (
    tag: string,
  ) {
    return CommandId.make(`server:${tag}:${yield* crypto.randomUUIDv4}`);
  });

  const publishProgress = Effect.fn("WorkflowCleanupReactor.publishProgress")(function* (
    threadId: ThreadId,
    cleanup: WorkflowCleanup,
    message: string | null,
  ) {
    yield* receipts.publish({
      type: "workflow.cleanup.progress",
      threadId,
      status: cleanup.status,
      createdAt: cleanup.updatedAt,
      message,
    });
  });

  const updateCleanup = Effect.fn("WorkflowCleanupReactor.updateCleanup")(function* (input: {
    readonly threadId: ThreadId;
    readonly attachment: CleanupPreflightedEvent["payload"]["attachment"];
    readonly cleanup: WorkflowCleanup;
  }) {
    yield* orchestrationEngine.dispatch({
      type: "thread.workflow.cleanup.update",
      commandId: yield* serverCommandId("workflow-cleanup-update"),
      threadId: input.threadId,
      cleanup: input.cleanup,
      expectedWorkstreamVersion: input.attachment.workflowVersion ?? 0,
      createdAt: input.cleanup.updatedAt,
    });
  });

  const previewResource = Effect.fn("WorkflowCleanupReactor.previewResource")(function* (input: {
    readonly resource: WorkflowCleanupResource;
  }): Effect.fn.Return<WorkflowCleanupResource, never> {
    const resource = input.resource;
    if (!resource.owned) return resource;
    if (resource.kind !== "worktree") return resource;
    if (resource.path === null) {
      return {
        ...resource,
        status: "blocked",
        reason: "The Workstream-owned worktree has no recorded local path.",
      };
    }
    if (resource.branch === null) {
      return {
        ...resource,
        status: "blocked",
        reason: "The Workstream-owned worktree has no recorded branch.",
      };
    }
    yield* git.invalidateLocalStatus(resource.path);
    const status = yield* git.localStatus({ cwd: resource.path }).pipe(Effect.result);
    if (Result.isFailure(status)) {
      return {
        ...resource,
        status: "blocked",
        reason: failureMessage(status.failure),
      };
    }
    if (!status.success.isRepo) {
      return {
        ...resource,
        status: "removed" as const,
        reason: "The Workstream-owned worktree is already absent.",
      };
    }
    if (status.success.refName !== resource.branch) {
      return {
        ...resource,
        status: "blocked",
        reason: `The recorded branch does not match the worktree branch (${status.success.refName ?? "detached"}).`,
      };
    }
    if (status.success.hasWorkingTreeChanges) {
      return {
        ...resource,
        status: "blocked",
        reason: "Unexpected or uncommitted changes block cleanup.",
      };
    }
    return { ...resource, status: "eligible", reason: null };
  });

  const processPreflight = Effect.fn("WorkflowCleanupReactor.processPreflight")(function* (
    event: CleanupPreflightedEvent,
  ) {
    const requested = event.payload.attachment.workflowCleanup;
    if (requested === undefined || requested.status !== "previewing") {
      if (requested !== undefined) {
        yield* publishProgress(
          event.payload.threadId,
          requested,
          requested.blockers.join(" ") || null,
        );
      }
      return;
    }
    const snapshot = yield* snapshots.getSnapshot();
    const originThread = snapshot.threads.find((thread) => thread.id === event.payload.threadId);
    if (originThread === undefined) return;
    const cwd = resolveThreadWorkspaceCwd({ thread: originThread, projects: snapshot.projects });
    if (cwd === undefined) {
      const cleanup: WorkflowCleanup = {
        ...requested,
        status: "needs-recovery",
        failure: "The Origin Thread has no resolvable project workspace.",
        updatedAt: event.occurredAt,
      };
      yield* updateCleanup({
        threadId: event.payload.threadId,
        attachment: event.payload.attachment,
        cleanup,
      });
      yield* publishProgress(event.payload.threadId, cleanup, cleanup.failure);
      return;
    }
    const resources: WorkflowCleanupResource[] = [];
    for (const resource of requested.resources) {
      resources.push(yield* previewResource({ resource }));
    }
    const blocked = resources.some((resource) => resource.status === "blocked");
    const cleanup: WorkflowCleanup = {
      ...requested,
      status: blocked ? "blocked" : "ready",
      resources,
      failure: null,
      updatedAt: event.occurredAt,
    };
    yield* updateCleanup({
      threadId: event.payload.threadId,
      attachment: event.payload.attachment,
      cleanup,
    });
    yield* publishProgress(
      event.payload.threadId,
      cleanup,
      blocked ? "Unexpected or uncommitted changes block cleanup." : "Cleanup preview is ready.",
    );
  });

  const processRequested = Effect.fn("WorkflowCleanupReactor.processRequested")(function* (
    event: CleanupRequestedEvent,
  ) {
    const requested = event.payload.attachment.workflowCleanup;
    if (requested === undefined || requested.status !== "cleaning") return;
    const snapshot = yield* snapshots.getSnapshot();
    const originThread = snapshot.threads.find((thread) => thread.id === event.payload.threadId);
    if (originThread === undefined) return;
    const cwd = resolveThreadWorkspaceCwd({ thread: originThread, projects: snapshot.projects });
    if (cwd === undefined) {
      const cleanup: WorkflowCleanup = {
        ...requested,
        status: "needs-recovery",
        failure: "The Origin Thread has no resolvable project workspace.",
        updatedAt: event.occurredAt,
      };
      yield* updateCleanup({
        threadId: event.payload.threadId,
        attachment: event.payload.attachment,
        cleanup,
      });
      yield* publishProgress(event.payload.threadId, cleanup, cleanup.failure);
      return;
    }
    const resources: WorkflowCleanupResource[] = [];
    let failure: string | null = null;
    for (const resource of requested.resources) {
      if (resource.kind !== "worktree" || resource.status !== "eligible" || !resource.owned) {
        resources.push(resource);
        continue;
      }
      if (resource.path === null) {
        const blocked = {
          ...resource,
          status: "blocked" as const,
          reason: "The Workstream-owned worktree has no recorded local path.",
        };
        resources.push(blocked);
        failure ??= blocked.reason;
        continue;
      }
      if (resource.branch === null) {
        const blocked = {
          ...resource,
          status: "blocked" as const,
          reason: "The Workstream-owned worktree has no recorded branch.",
        };
        resources.push(blocked);
        failure ??= blocked.reason;
        continue;
      }
      yield* git.invalidateLocalStatus(resource.path);
      const status = yield* git.localStatus({ cwd: resource.path }).pipe(Effect.result);
      if (Result.isFailure(status)) {
        const blocked = {
          ...resource,
          status: "blocked" as const,
          reason: failureMessage(status.failure),
        };
        resources.push(blocked);
        failure ??= blocked.reason;
        continue;
      }
      if (!status.success.isRepo) {
        resources.push({
          ...resource,
          status: "removed",
          reason: "The Workstream-owned worktree was already absent.",
        });
        continue;
      }
      if (status.success.refName !== resource.branch) {
        const blocked = {
          ...resource,
          status: "blocked" as const,
          reason: `The recorded branch does not match the worktree branch (${status.success.refName ?? "detached"}).`,
        };
        resources.push(blocked);
        failure ??= blocked.reason;
        continue;
      }
      if (status.success.hasWorkingTreeChanges) {
        const blocked = {
          ...resource,
          status: "blocked" as const,
          reason: "Unexpected or uncommitted changes block cleanup.",
        };
        resources.push(blocked);
        failure ??= blocked.reason;
        continue;
      }
      const removed = yield* git
        .removeWorktree({ cwd, path: resource.path, force: false })
        .pipe(Effect.result);
      if (Result.isFailure(removed)) {
        const blocked = {
          ...resource,
          status: "blocked" as const,
          reason: failureMessage(removed.failure),
        };
        resources.push(blocked);
        failure ??= blocked.reason;
        continue;
      }
      resources.push({ ...resource, status: "removed", reason: null });
    }
    const cleanup: WorkflowCleanup = {
      ...requested,
      status: failure === null ? "completed" : "needs-recovery",
      resources,
      failure,
      updatedAt: event.occurredAt,
    };
    yield* updateCleanup({
      threadId: event.payload.threadId,
      attachment: event.payload.attachment,
      cleanup,
    });
    yield* publishProgress(
      event.payload.threadId,
      cleanup,
      failure ?? "Owned clean local worktrees were removed; durable history was retained.",
    );
  });

  return Effect.fn("WorkflowCleanupReactor.processEvent")(function* (event: WorkflowCleanupEvent) {
    switch (event.type) {
      case "thread.workflow-cleanup-preflighted":
        yield* processPreflight(event);
        return;
      case "thread.workflow-cleanup-requested":
        yield* processRequested(event);
        return;
    }
  });
});
