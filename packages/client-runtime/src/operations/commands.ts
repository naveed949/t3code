import {
  CommandId,
  ORCHESTRATION_WS_METHODS,
  type ClientOrchestrationCommand,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import type { EnvironmentSupervisor } from "../connection/supervisor.ts";
import {
  type EnvironmentRpcFailure,
  type EnvironmentRpcSuccess,
  type EnvironmentRpcUnavailableError,
  request,
} from "../rpc/client.ts";

type CommandType = ClientOrchestrationCommand["type"];
type CommandOf<T extends CommandType> = Extract<ClientOrchestrationCommand, { readonly type: T }>;
type CommandInput<T extends CommandType> = Omit<
  CommandOf<T>,
  "type" | "commandId" | "createdAt"
> & {
  readonly commandId?: CommandId;
} & ("createdAt" extends keyof CommandOf<T>
    ? {
        readonly createdAt?: CommandOf<T>["createdAt"];
      }
    : {});

export type CreateProjectInput = CommandInput<"project.create">;
export type UpdateProjectInput = CommandInput<"project.meta.update">;
export type DeleteProjectInput = CommandInput<"project.delete">;
export type CreateThreadInput = CommandInput<"thread.create">;
export type DeleteThreadInput = CommandInput<"thread.delete">;
export type ArchiveThreadInput = CommandInput<"thread.archive">;
export type UnarchiveThreadInput = CommandInput<"thread.unarchive">;
export type SettleThreadInput = CommandInput<"thread.settle">;
export type UnsettleThreadInput = CommandInput<"thread.unsettle">;
export type SnoozeThreadInput = CommandInput<"thread.snooze">;
export type UnsnoozeThreadInput = CommandInput<"thread.unsnooze">;
export type UpdateThreadMetadataInput = CommandInput<"thread.meta.update">;
export type SetThreadRuntimeModeInput = CommandInput<"thread.runtime-mode.set">;
export type SetThreadInteractionModeInput = CommandInput<"thread.interaction-mode.set">;
export type StartThreadTurnInput = CommandInput<"thread.turn.start">;
export type InterruptThreadTurnInput = CommandInput<"thread.turn.interrupt">;
export type RespondToThreadApprovalInput = CommandInput<"thread.approval.respond">;
export type RespondToThreadUserInputInput = CommandInput<"thread.user-input.respond">;
export type PublishWayfinderDraftInput = CommandInput<"thread.wayfinder.publish">;
export type MutateWayfinderInput = CommandInput<"thread.wayfinder.mutate">;
export type ReconcileWayfinderMapInput = CommandInput<"thread.wayfinder.reconcile">;
export type ControlWayfinderResearchInput = CommandInput<"thread.wayfinder.research">;
export type DismissWorkflowAttachmentHintInput =
  CommandInput<"thread.workflow-attachment.hint.dismiss">;
export type AttachWorkflowInput = CommandInput<"thread.workflow.attach">;
export type ArchiveWorkflowInput = CommandInput<"thread.workflow.archive">;
export type ReopenWorkflowInput = CommandInput<"thread.workflow.reopen">;
export type PreflightWorkflowCleanupInput = CommandInput<"thread.workflow.cleanup.preflight">;
export type ConfirmWorkflowCleanupInput = CommandInput<"thread.workflow.cleanup.confirm">;
export type PreflightWorkflowRunInput = CommandInput<"thread.workflow.run.preflight">;
export type ConfirmWorkflowRunInput = CommandInput<"thread.workflow.run.confirm">;
export type StartWorkflowRunInput = CommandInput<"thread.workflow.run.start">;
export type PauseWorkflowRunInput = CommandInput<"thread.workflow.run.pause">;
export type ResumeWorkflowRunInput = CommandInput<"thread.workflow.run.resume">;
export type PreflightWorkflowBaselineRefreshInput =
  CommandInput<"thread.workflow.baseline-refresh.preflight">;
export type ConfirmWorkflowBaselineRefreshInput =
  CommandInput<"thread.workflow.baseline-refresh.confirm">;
export type PreflightWorkflowPublicationInput =
  CommandInput<"thread.workflow.publication.preflight">;
export type ConfirmWorkflowPublicationInput = CommandInput<"thread.workflow.publication.confirm">;
export type ReconcileWorkflowPublicationInput =
  CommandInput<"thread.workflow.publication.reconcile">;
export type HoldWorkflowNodeInput = CommandInput<"thread.workflow.node.hold">;
export type ReleaseWorkflowNodeInput = CommandInput<"thread.workflow.node.release">;
export type ViewWorkflowArtifactsInput = CommandInput<"thread.workflow.artifacts.view">;
export type AcknowledgeWorkflowArtifactInput = CommandInput<"thread.workflow.artifact.acknowledge">;
export type ResolveWorkflowStaleInput = CommandInput<"thread.workflow.stale.resolve">;
export type CompleteWorkflowSpecificationInput =
  CommandInput<"thread.workflow.specification.complete">;
export type PublishWorkflowTicketBatchInput = CommandInput<"thread.workflow.ticketing.publish">;
export type StartWorkflowTicketImplementationInput =
  CommandInput<"thread.workflow.ticket-implementation.start">;
export type StopWorkflowTicketImplementationInput =
  CommandInput<"thread.workflow.ticket-implementation.stop">;
export type RecoverWorkflowTicketImplementationInput =
  CommandInput<"thread.workflow.ticket-implementation.recover">;
export type RetryWorkflowTicketIntegrationInput =
  CommandInput<"thread.workflow.ticket-integration.retry">;
export type RevertThreadCheckpointInput = CommandInput<"thread.checkpoint.revert">;
export type StopThreadSessionInput = CommandInput<"thread.session.stop">;

type DispatchTag = typeof ORCHESTRATION_WS_METHODS.dispatchCommand;
type CommandEffect = Effect.Effect<
  EnvironmentRpcSuccess<DispatchTag>,
  EnvironmentRpcFailure<DispatchTag> | EnvironmentRpcUnavailableError,
  Crypto.Crypto | EnvironmentSupervisor
>;

function commandId(input: { readonly commandId?: CommandId }) {
  return Effect.gen(function* () {
    if (input.commandId !== undefined) {
      return input.commandId;
    }
    const crypto = yield* Crypto.Crypto;
    return yield* crypto.randomUUIDv4.pipe(Effect.orDie, Effect.map(CommandId.make));
  });
}

function timestampedCommandMetadata(input: {
  readonly commandId?: CommandId;
  readonly createdAt?: string;
}) {
  return Effect.all({
    commandId: commandId(input),
    createdAt:
      input.createdAt === undefined
        ? DateTime.now.pipe(Effect.map(DateTime.formatIso))
        : Effect.succeed(input.createdAt),
  });
}

function dispatch(command: ClientOrchestrationCommand) {
  return request(ORCHESTRATION_WS_METHODS.dispatchCommand, command);
}

export const createProject: (input: CreateProjectInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.createProject",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "project.create",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const updateProject: (input: UpdateProjectInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.updateProject",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "project.meta.update",
    commandId: yield* commandId(input),
  });
});

export const deleteProject: (input: DeleteProjectInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.deleteProject",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "project.delete",
    commandId: yield* commandId(input),
  });
});

export const createThread: (input: CreateThreadInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.createThread",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "thread.create",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const deleteThread: (input: DeleteThreadInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.deleteThread",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "thread.delete",
    commandId: yield* commandId(input),
  });
});

export const archiveThread: (input: ArchiveThreadInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.archiveThread",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "thread.archive",
    commandId: yield* commandId(input),
  });
});

export const unarchiveThread: (input: UnarchiveThreadInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.unarchiveThread",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "thread.unarchive",
    commandId: yield* commandId(input),
  });
});

export const settleThread: (input: SettleThreadInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.settleThread",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "thread.settle",
    commandId: yield* commandId(input),
  });
});

export const unsettleThread: (input: UnsettleThreadInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.unsettleThread",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "thread.unsettle",
    commandId: yield* commandId(input),
  });
});

export const snoozeThread: (input: SnoozeThreadInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.snoozeThread",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "thread.snooze",
    commandId: yield* commandId(input),
  });
});

export const unsnoozeThread: (input: UnsnoozeThreadInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.unsnoozeThread",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "thread.unsnooze",
    commandId: yield* commandId(input),
  });
});

export const updateThreadMetadata: (input: UpdateThreadMetadataInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.updateThreadMetadata",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "thread.meta.update",
    commandId: yield* commandId(input),
  });
});

export const setThreadRuntimeMode: (input: SetThreadRuntimeModeInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.setThreadRuntimeMode",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "thread.runtime-mode.set",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const setThreadInteractionMode: (input: SetThreadInteractionModeInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.setThreadInteractionMode")(function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.interaction-mode.set",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  });

export const startThreadTurn: (input: StartThreadTurnInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.startThreadTurn",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "thread.turn.start",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const interruptThreadTurn: (input: InterruptThreadTurnInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.interruptThreadTurn",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "thread.turn.interrupt",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const respondToThreadApproval: (input: RespondToThreadApprovalInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.respondToThreadApproval")(function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.approval.respond",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  });

export const respondToThreadUserInput: (input: RespondToThreadUserInputInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.respondToThreadUserInput")(function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.user-input.respond",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  });

export const publishWayfinderDraft: (input: PublishWayfinderDraftInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.publishWayfinderDraft")(function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.wayfinder.publish",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  });

export const mutateWayfinder: (input: MutateWayfinderInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.mutateWayfinder",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "thread.wayfinder.mutate",
    commandId: metadata.commandId,
    actionId: input.actionId ?? metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const reconcileWayfinderMap: (input: ReconcileWayfinderMapInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.reconcileWayfinderMap")(function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.wayfinder.reconcile",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  });

export const controlWayfinderResearch: (input: ControlWayfinderResearchInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.controlWayfinderResearch")(function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.wayfinder.research",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  });

export const dismissWorkflowAttachmentHint: (
  input: DismissWorkflowAttachmentHintInput,
) => CommandEffect = Effect.fn("EnvironmentCommands.dismissWorkflowAttachmentHint")(
  function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.workflow-attachment.hint.dismiss",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  },
);

export const attachWorkflow: (input: AttachWorkflowInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.attachWorkflow",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "thread.workflow.attach",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const archiveWorkflow: (input: ArchiveWorkflowInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.archiveWorkflow",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "thread.workflow.archive",
    commandId: metadata.commandId,
    confirmed: true,
    createdAt: metadata.createdAt,
  });
});

export const reopenWorkflow: (input: ReopenWorkflowInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.reopenWorkflow",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "thread.workflow.reopen",
    commandId: metadata.commandId,
    confirmed: true,
    createdAt: metadata.createdAt,
  });
});

export const preflightWorkflowCleanup: (input: PreflightWorkflowCleanupInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.preflightWorkflowCleanup")(function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.workflow.cleanup.preflight",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  });

export const confirmWorkflowCleanup: (input: ConfirmWorkflowCleanupInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.confirmWorkflowCleanup")(function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.workflow.cleanup.confirm",
      commandId: metadata.commandId,
      confirmed: true,
      createdAt: metadata.createdAt,
    });
  });

export const viewWorkflowArtifacts: (input: ViewWorkflowArtifactsInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.viewWorkflowArtifacts")(function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.workflow.artifacts.view",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  });

export const acknowledgeWorkflowArtifact: (
  input: AcknowledgeWorkflowArtifactInput,
) => CommandEffect = Effect.fn("EnvironmentCommands.acknowledgeWorkflowArtifact")(
  function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.workflow.artifact.acknowledge",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  },
);

export const preflightWorkflowRun: (input: PreflightWorkflowRunInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.preflightWorkflowRun",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "thread.workflow.run.preflight",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const confirmWorkflowRun: (input: ConfirmWorkflowRunInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.confirmWorkflowRun",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "thread.workflow.run.confirm",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const startWorkflowRun: (input: StartWorkflowRunInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.startWorkflowRun",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "thread.workflow.run.start",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const pauseWorkflowRun: (input: PauseWorkflowRunInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.pauseWorkflowRun",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "thread.workflow.run.pause",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const resumeWorkflowRun: (input: ResumeWorkflowRunInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.resumeWorkflowRun",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "thread.workflow.run.resume",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const holdWorkflowNode: (input: HoldWorkflowNodeInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.holdWorkflowNode",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "thread.workflow.node.hold",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const releaseWorkflowNode: (input: ReleaseWorkflowNodeInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.releaseWorkflowNode",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "thread.workflow.node.release",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const resolveWorkflowStale: (input: ResolveWorkflowStaleInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.resolveWorkflowStale",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "thread.workflow.stale.resolve",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const completeWorkflowSpecification: (
  input: CompleteWorkflowSpecificationInput,
) => CommandEffect = Effect.fn("EnvironmentCommands.completeWorkflowSpecification")(
  function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.workflow.specification.complete",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  },
);

export const preflightWorkflowBaselineRefresh: (
  input: PreflightWorkflowBaselineRefreshInput,
) => CommandEffect = Effect.fn("EnvironmentCommands.preflightWorkflowBaselineRefresh")(
  function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.workflow.baseline-refresh.preflight",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  },
);

export const confirmWorkflowBaselineRefresh: (
  input: ConfirmWorkflowBaselineRefreshInput,
) => CommandEffect = Effect.fn("EnvironmentCommands.confirmWorkflowBaselineRefresh")(
  function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.workflow.baseline-refresh.confirm",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  },
);

export const preflightWorkflowPublication: (
  input: PreflightWorkflowPublicationInput,
) => CommandEffect = Effect.fn("EnvironmentCommands.preflightWorkflowPublication")(
  function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.workflow.publication.preflight",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  },
);

export const confirmWorkflowPublication: (input: ConfirmWorkflowPublicationInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.confirmWorkflowPublication")(function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.workflow.publication.confirm",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  });

export const reconcileWorkflowPublication: (
  input: ReconcileWorkflowPublicationInput,
) => CommandEffect = Effect.fn("EnvironmentCommands.reconcileWorkflowPublication")(
  function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.workflow.publication.reconcile",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  },
);

export const publishWorkflowTicketBatch: (input: PublishWorkflowTicketBatchInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.publishWorkflowTicketBatch")(function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.workflow.ticketing.publish",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  });

export const startWorkflowTicketImplementation: (
  input: StartWorkflowTicketImplementationInput,
) => CommandEffect = Effect.fn("EnvironmentCommands.startWorkflowTicketImplementation")(
  function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.workflow.ticket-implementation.start",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  },
);

export const stopWorkflowTicketImplementation: (
  input: StopWorkflowTicketImplementationInput,
) => CommandEffect = Effect.fn("EnvironmentCommands.stopWorkflowTicketImplementation")(
  function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.workflow.ticket-implementation.stop",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  },
);

export const recoverWorkflowTicketImplementation: (
  input: RecoverWorkflowTicketImplementationInput,
) => CommandEffect = Effect.fn("EnvironmentCommands.recoverWorkflowTicketImplementation")(
  function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.workflow.ticket-implementation.recover",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  },
);

export const retryWorkflowTicketIntegration: (
  input: RetryWorkflowTicketIntegrationInput,
) => CommandEffect = Effect.fn("EnvironmentCommands.retryWorkflowTicketIntegration")(
  function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.workflow.ticket-integration.retry",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  },
);

export const revertThreadCheckpoint: (input: RevertThreadCheckpointInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.revertThreadCheckpoint")(function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.checkpoint.revert",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  });

export const stopThreadSession: (input: StopThreadSessionInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.stopThreadSession",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "thread.session.stop",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});
