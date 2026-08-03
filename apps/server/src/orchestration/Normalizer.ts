import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import {
  type ClientOrchestrationCommand,
  type IsoDateTime,
  type OrchestrationCommand,
  OrchestrationDispatchCommandError,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ServerProvider,
  type ResolvedSkillInvocation,
  type SkillInvocation,
  type SkillRunId,
  type ThreadId,
} from "@t3tools/contracts";
import { deriveWayfinderReadiness } from "@t3tools/shared/wayfinderReadiness";

import { createAttachmentId, resolveAttachmentPath } from "../attachmentStore.ts";
import { ServerConfig } from "../config.ts";
import { parseBase64DataUrl } from "../imageMime.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { resolveSkillInvocationRequest } from "../nativeSkills/NativeSkillAdapterRegistry.ts";
import type { ProjectionSnapshotQueryShape } from "./Services/ProjectionSnapshotQuery.ts";
import type { ProjectionRepositoryError } from "../persistence/Errors.ts";

export const loadWayfinderHandoffSource = Effect.fn("loadWayfinderHandoffSource")(function* (
  query: ProjectionSnapshotQueryShape,
  skillRunId: SkillRunId,
) {
  if (query.getSkillRunById === undefined) return null;
  const stored = yield* query.getSkillRunById(skillRunId);
  if (Option.isNone(stored)) return null;
  const shell = yield* query.getShellSnapshot();
  const source = stored.value.skillInvocation;
  const ticketNumberByThreadId = new Map(
    (shell.skillRuns ?? []).flatMap((invocation) =>
      invocation.workstreamId === source.workstreamId && invocation.action?.id === "work-ticket"
        ? [[invocation.threadId, invocation.action.ticketNumber] as const]
        : [],
    ),
  );
  const activeLinkedTicketNumbers = shell.threads.flatMap((thread) => {
    const ticketNumber = ticketNumberByThreadId.get(thread.id);
    const active =
      thread.latestTurn?.state === "running" ||
      thread.session?.status === "starting" ||
      thread.session?.status === "running";
    return ticketNumber !== undefined && active ? [ticketNumber] : [];
  });
  return {
    threadId: stored.value.threadId,
    invocation: source,
    activeLinkedTicketNumbers,
  };
});

export const canonicalizeClientCommandTimestamps = (
  command: ClientOrchestrationCommand,
  receivedAt: IsoDateTime,
): ClientOrchestrationCommand => {
  const canonicalCommand =
    "createdAt" in command
      ? {
          ...command,
          createdAt: receivedAt,
        }
      : command;

  if (canonicalCommand.type !== "thread.turn.start" || !canonicalCommand.bootstrap?.createThread) {
    return canonicalCommand;
  }

  return {
    ...canonicalCommand,
    bootstrap: {
      ...canonicalCommand.bootstrap,
      createThread: {
        ...canonicalCommand.bootstrap.createThread,
        createdAt: receivedAt,
      },
    },
  };
};

export const normalizeDispatchCommand = Effect.fn("normalizeDispatchCommand")(function* (
  command: ClientOrchestrationCommand,
  options: {
    readonly providers?: ReadonlyArray<ServerProvider>;
    readonly getWayfinderHandoffSource?: (skillRunId: SkillRunId) => Effect.Effect<
      {
        readonly threadId: ThreadId;
        readonly invocation: SkillInvocation;
        readonly activeLinkedTicketNumbers: ReadonlyArray<number>;
      } | null,
      ProjectionRepositoryError
    >;
  } = {},
) {
  const receivedAt = DateTime.formatIso(yield* DateTime.now);
  const canonicalCommand = canonicalizeClientCommandTimestamps(command, receivedAt);
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;

  const normalizeProjectWorkspaceRoot = (workspaceRoot: string) =>
    workspacePaths.normalizeWorkspaceRoot(workspaceRoot).pipe(
      Effect.mapError(
        (cause) =>
          new OrchestrationDispatchCommandError({
            message: cause.message,
          }),
      ),
    );

  const normalizeProjectWorkspaceRootForCreate = (
    workspaceRoot: string,
    createIfMissing: boolean | undefined,
  ) =>
    workspacePaths
      .normalizeWorkspaceRoot(workspaceRoot, {
        createIfMissing: createIfMissing === true,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationDispatchCommandError({
              message: cause.message,
            }),
        ),
      );

  if (canonicalCommand.type === "project.create") {
    return {
      ...canonicalCommand,
      workspaceRoot: yield* normalizeProjectWorkspaceRootForCreate(
        canonicalCommand.workspaceRoot,
        canonicalCommand.createWorkspaceRootIfMissing,
      ),
      createWorkspaceRootIfMissing: canonicalCommand.createWorkspaceRootIfMissing === true,
    } satisfies OrchestrationCommand;
  }

  if (
    canonicalCommand.type === "project.meta.update" &&
    canonicalCommand.workspaceRoot !== undefined
  ) {
    return {
      ...canonicalCommand,
      workspaceRoot: yield* normalizeProjectWorkspaceRoot(canonicalCommand.workspaceRoot),
    } satisfies OrchestrationCommand;
  }

  if (canonicalCommand.type !== "thread.turn.start") {
    return canonicalCommand as OrchestrationCommand;
  }

  const skillInvocationRequest = canonicalCommand.skillInvocationRequest;
  const resolvedSkillInvocation = skillInvocationRequest
    ? yield* Effect.gen(function* () {
        const providers = options.providers ?? [];
        const requestedInstanceId =
          canonicalCommand.modelSelection?.instanceId ??
          canonicalCommand.bootstrap?.createThread?.modelSelection.instanceId;
        const providerInstanceId =
          requestedInstanceId ??
          providers.find((provider) =>
            provider.skills.some(
              (skill) =>
                skill.enabled &&
                skill.name === skillInvocationRequest.skillName &&
                skill.path === skillInvocationRequest.skillPath,
            ),
          )?.instanceId;
        if (!providerInstanceId) {
          return yield* new OrchestrationDispatchCommandError({
            message: `Unable to resolve a provider instance for skill '${skillInvocationRequest.skillName}'.`,
          });
        }
        return yield* resolveSkillInvocationRequest({
          request: skillInvocationRequest,
          providerInstanceId,
          providers,
        });
      })
    : undefined;
  const handoffAction =
    resolvedSkillInvocation?.action?.id === "handoff-to-spec"
      ? resolvedSkillInvocation.action
      : null;
  const skillInvocation: ResolvedSkillInvocation | undefined =
    handoffAction === null
      ? resolvedSkillInvocation
      : yield* Effect.gen(function* () {
          if (resolvedSkillInvocation === undefined) {
            return yield* new OrchestrationDispatchCommandError({
              message: "Unable to resolve the to-spec Skill Run.",
            });
          }
          const loadSource = options.getWayfinderHandoffSource;
          if (loadSource === undefined) {
            return yield* new OrchestrationDispatchCommandError({
              message: "Durable Wayfinder handoff provenance is unavailable.",
            });
          }
          const source = yield* loadSource(handoffAction.sourceSkillRunId).pipe(
            Effect.mapError(
              () =>
                new OrchestrationDispatchCommandError({
                  message: "Failed to load durable Wayfinder handoff provenance.",
                }),
            ),
          );
          const map = source?.invocation.wayfinderMap;
          const synchronizedAt =
            source?.invocation.wayfinderSynchronizedAt ?? map?.lastSynchronizedAt;
          if (
            source === null ||
            source.threadId !== handoffAction.sourceThreadId ||
            source.invocation.skill.name !== "wayfinder" ||
            source.invocation.execution.mode !== "native" ||
            map === undefined ||
            handoffAction.canonicalReference.number !== map.canonicalReference.number ||
            handoffAction.canonicalReference.url !== map.canonicalReference.url ||
            handoffAction.wayfinderSynchronizedAt !== synchronizedAt
          ) {
            return yield* new OrchestrationDispatchCommandError({
              message: "to-spec provenance does not match the durable canonical Wayfinder run.",
            });
          }
          const readiness = deriveWayfinderReadiness({
            map,
            synchronization: source.invocation.wayfinderSynchronization ?? null,
            activeLinkedTicketNumbers: source.activeLinkedTicketNumbers,
          });
          if (!readiness.ready && !handoffAction.acknowledgedIncomplete) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Acknowledge the incomplete Wayfinder map before early to-spec handoff. Blockers: ${readiness.blockers.map((blocker) => blocker.kind).join(", ")}.`,
            });
          }
          return {
            ...resolvedSkillInvocation,
            reconnectWorkstreamId: source.invocation.workstreamId,
          } satisfies ResolvedSkillInvocation;
        });

  const normalizedAttachments = yield* Effect.forEach(
    canonicalCommand.message.attachments,
    (attachment) =>
      Effect.gen(function* () {
        const parsed = parseBase64DataUrl(attachment.dataUrl);
        if (!parsed || !parsed.mimeType.startsWith("image/")) {
          return yield* new OrchestrationDispatchCommandError({
            message: `Invalid image attachment payload for '${attachment.name}'.`,
          });
        }

        const bytes = Buffer.from(parsed.base64, "base64");
        if (bytes.byteLength === 0 || bytes.byteLength > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
          return yield* new OrchestrationDispatchCommandError({
            message: `Image attachment '${attachment.name}' is empty or too large.`,
          });
        }

        const attachmentId = createAttachmentId(canonicalCommand.threadId);
        if (!attachmentId) {
          return yield* new OrchestrationDispatchCommandError({
            message: "Failed to create a safe attachment id.",
          });
        }

        const persistedAttachment = {
          type: "image" as const,
          id: attachmentId,
          name: attachment.name,
          mimeType: parsed.mimeType.toLowerCase(),
          sizeBytes: bytes.byteLength,
        };

        const attachmentPath = resolveAttachmentPath({
          attachmentsDir: serverConfig.attachmentsDir,
          attachment: persistedAttachment,
        });
        if (!attachmentPath) {
          return yield* new OrchestrationDispatchCommandError({
            message: `Failed to resolve persisted path for '${attachment.name}'.`,
          });
        }

        yield* fileSystem.makeDirectory(path.dirname(attachmentPath), { recursive: true }).pipe(
          Effect.mapError(
            () =>
              new OrchestrationDispatchCommandError({
                message: `Failed to create attachment directory for '${attachment.name}'.`,
              }),
          ),
        );
        yield* fileSystem.writeFile(attachmentPath, bytes).pipe(
          Effect.mapError(
            () =>
              new OrchestrationDispatchCommandError({
                message: `Failed to persist attachment '${attachment.name}'.`,
              }),
          ),
        );

        return persistedAttachment;
      }),
    { concurrency: 1 },
  );

  const { skillInvocationRequest: _skillInvocationRequest, ...normalizedCommand } =
    canonicalCommand;
  return {
    ...normalizedCommand,
    message: {
      ...canonicalCommand.message,
      attachments: normalizedAttachments,
    },
    ...(skillInvocation ? { skillInvocation } : {}),
  } satisfies OrchestrationCommand;
});
