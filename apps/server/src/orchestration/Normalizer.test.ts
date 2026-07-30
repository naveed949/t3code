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
  ThreadId,
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
});
