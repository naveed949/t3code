import { describe, expect, it } from "vite-plus/test";
import { it as effectIt } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import {
  CommandId,
  type ClientOrchestrationCommand,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  SkillRunId,
  ThreadId,
  WorkstreamId,
  ProviderDriverKind,
} from "@t3tools/contracts";

import { ServerConfig } from "../config.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { canonicalizeClientCommandTimestamps, normalizeDispatchCommand } from "./Normalizer.ts";

const clientCreatedAt = "2031-01-01T00:00:00.000Z";
const serverReceivedAt = "2026-07-18T00:00:00.000Z";

describe("canonicalizeClientCommandTimestamps", () => {
  it("replaces a client command timestamp with the server receipt timestamp", () => {
    const command: ClientOrchestrationCommand = {
      type: "project.create",
      commandId: CommandId.make("command-1"),
      projectId: ProjectId.make("project-1"),
      title: "Clock-safe project",
      workspaceRoot: "/tmp/clock-safe-project",
      createdAt: clientCreatedAt,
    };

    expect(canonicalizeClientCommandTimestamps(command, serverReceivedAt)).toEqual({
      ...command,
      createdAt: serverReceivedAt,
    });
  });

  it("replaces both timestamps when the first turn bootstraps a thread", () => {
    const command: ClientOrchestrationCommand = {
      type: "thread.turn.start",
      commandId: CommandId.make("command-2"),
      threadId: ThreadId.make("thread-1"),
      message: {
        messageId: MessageId.make("message-1"),
        role: "user",
        text: "Start a thread",
        attachments: [],
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      bootstrap: {
        createThread: {
          projectId: ProjectId.make("project-1"),
          title: "Clock-safe thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.4",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: clientCreatedAt,
        },
      },
      createdAt: clientCreatedAt,
    };

    const result = canonicalizeClientCommandTimestamps(command, serverReceivedAt);

    expect(result.type).toBe("thread.turn.start");
    if (result.type !== "thread.turn.start") {
      throw new Error("Expected a thread.turn.start command");
    }
    expect(result.createdAt).toBe(serverReceivedAt);
    expect(result.bootstrap?.createThread?.createdAt).toBe(serverReceivedAt);
  });
});

effectIt.layer(
  Layer.mergeAll(
    NodeServices.layer,
    WorkspacePaths.layer.pipe(Layer.provide(NodeServices.layer)),
    ServerConfig.layerTest(process.cwd(), {
      prefix: "t3-normalizer-native-skill-test-",
    }).pipe(Layer.provide(NodeServices.layer)),
  ),
)("normalizeDispatchCommand", (it) => {
  it.effect("turns an explicit request into a digest-pinned server invocation", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDirectory = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-normalizer-native-skill-",
      });
      const skillPath = path.join(tempDirectory, "SKILL.md");
      yield* fileSystem.writeFileString(skillPath, "# test Wayfinder");

      const command: ClientOrchestrationCommand = {
        type: "thread.turn.start",
        commandId: CommandId.make("command-native-skill"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: MessageId.make("message-native-skill"),
          role: "user",
          text: "$wayfinder chart a release",
          attachments: [],
        },
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        skillInvocationRequest: {
          skillName: "wayfinder",
          skillPath,
          arguments: "chart a release",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: clientCreatedAt,
      };

      const normalized = yield* normalizeDispatchCommand(command, {
        providers: [
          {
            driver: ProviderDriverKind.make("codex"),
            instanceId: ProviderInstanceId.make("codex"),
            enabled: true,
            installed: true,
            version: "1.0.0",
            status: "ready",
            auth: { status: "authenticated" },
            checkedAt: "2026-01-01T00:00:00.000Z",
            models: [],
            slashCommands: [],
            skills: [
              {
                name: "wayfinder",
                path: skillPath,
                enabled: true,
              },
            ],
          },
        ],
      });

      expect(normalized.type).toBe("thread.turn.start");
      if (normalized.type !== "thread.turn.start") return;
      expect(normalized.skillInvocation).toMatchObject({
        skill: {
          name: "wayfinder",
          path: skillPath,
          contentDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        },
        arguments: "chart a release",
        execution: {
          mode: "generic",
          reason: "unsupported-digest",
        },
      });
      expect("skillInvocationRequest" in normalized).toBe(false);
    }),
  );

  it.effect("resolves a historical Wayfinder run into durable to-spec provenance", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDirectory = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-normalizer-to-spec-",
      });
      const skillPath = path.join(tempDirectory, "SKILL.md");
      yield* fileSystem.writeFileString(skillPath, "# test to-spec");
      const sourceSkillRunId = SkillRunId.make("skill-run:wayfinder");
      const sourceThreadId = ThreadId.make("thread-wayfinder");
      const synchronizedAt = "2026-01-02T00:00:00.000Z";

      const normalized = yield* normalizeDispatchCommand(
        {
          type: "thread.turn.start",
          commandId: CommandId.make("command-to-spec"),
          threadId: ThreadId.make("thread-to-spec"),
          message: {
            messageId: MessageId.make("message-to-spec"),
            role: "user",
            text: "Create the specification.",
            attachments: [],
          },
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
          skillInvocationRequest: {
            skillName: "to-spec",
            skillPath,
            arguments: "Create the specification.",
            action: {
              id: "handoff-to-spec",
              sourceSkillRunId,
              sourceThreadId,
              canonicalReference: { number: 42, url: "https://example.test/issues/42" },
              wayfinderSynchronizedAt: synchronizedAt,
              acknowledgedIncomplete: false,
            },
            executionPreference: "generic",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt: clientCreatedAt,
        },
        {
          providers: [
            {
              driver: ProviderDriverKind.make("codex"),
              instanceId: ProviderInstanceId.make("codex"),
              enabled: true,
              installed: true,
              version: "1.0.0",
              status: "ready",
              auth: { status: "authenticated" },
              checkedAt: synchronizedAt,
              models: [],
              slashCommands: [],
              skills: [{ name: "to-spec", path: skillPath, enabled: true }],
            },
          ],
          getWayfinderHandoffSource: () =>
            Effect.succeed({
              threadId: sourceThreadId,
              invocation: {
                workstreamId: WorkstreamId.make("workstream:release"),
                skillRunId: sourceSkillRunId,
                projectId: ProjectId.make("project-1"),
                threadId: sourceThreadId,
                skill: {
                  name: "wayfinder",
                  path: "/skills/wayfinder/SKILL.md",
                  contentDigest:
                    "sha256:257e40665b28ae959ffdcb97d7a72b074360f4a3d201bd84786505308546e434",
                },
                execution: { mode: "native", adapterId: "wayfinder", adapterVersion: 1 },
                wayfinderMap: {
                  canonicalReference: {
                    number: 42,
                    title: "Release map",
                    url: "https://example.test/issues/42",
                    state: "open",
                  },
                  destination: "Ship a release.",
                  notes: "",
                  decisionsSoFar: [],
                  fogOfWar: [],
                  outOfScope: [],
                  tickets: [],
                  frontier: [],
                  lastSynchronizedAt: synchronizedAt,
                },
                wayfinderSynchronization: {
                  status: "healthy",
                  reason: "manual",
                  lastAttemptedAt: synchronizedAt,
                  lastSuccessfulAt: synchronizedAt,
                  canMutate: true,
                },
                createdAt: synchronizedAt,
              },
              activeLinkedTicketNumbers: [],
            }),
        },
      );

      expect(normalized.type).toBe("thread.turn.start");
      if (normalized.type !== "thread.turn.start") return;
      expect(normalized.skillInvocation).toMatchObject({
        reconnectWorkstreamId: "workstream:release",
        execution: { mode: "generic" },
        action: { id: "handoff-to-spec", sourceSkillRunId },
      });
    }),
  );
});
