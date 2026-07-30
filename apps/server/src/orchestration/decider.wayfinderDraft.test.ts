import {
  ApprovalRequestId,
  CommandId,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { expect, it } from "@effect/vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

it.layer(NodeServices.layer)("Wayfinder draft command safety", (it) => {
  it.effect("rejects approval of a GitHub issue mutation while the draft is unpublished", () =>
    Effect.gen(function* () {
      const now = "2026-01-01T00:00:00.000Z";
      const projectId = ProjectId.make("project-wayfinder");
      const threadId = ThreadId.make("thread-wayfinder");
      const requestId = ApprovalRequestId.make("request-wayfinder-github");
      const initial = createEmptyReadModel(now);
      const withProject = yield* projectEvent(initial, {
        sequence: 1,
        eventId: EventId.make("event-wayfinder-project"),
        aggregateKind: "project",
        aggregateId: projectId,
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.make("command-wayfinder-project"),
        causationEventId: null,
        correlationId: CommandId.make("command-wayfinder-project"),
        metadata: {},
        payload: {
          projectId,
          title: "Wayfinder",
          workspaceRoot: "/tmp/wayfinder",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });
      const withThread = yield* projectEvent(withProject, {
        sequence: 2,
        eventId: EventId.make("event-wayfinder-thread"),
        aggregateKind: "thread",
        aggregateId: threadId,
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.make("command-wayfinder-thread"),
        causationEventId: null,
        correlationId: CommandId.make("command-wayfinder-thread"),
        metadata: {},
        payload: {
          threadId,
          projectId,
          title: "Wayfinder",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.3-codex",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });
      const activities = [
        {
          kind: "wayfinder.draft.started",
          summary: "Unpublished Wayfinder draft started",
          payload: { canonical: false },
        },
        {
          kind: "approval.requested",
          summary: "Command approval requested",
          payload: {
            requestId,
            requestKind: "command",
            detail: "gh issue create --title Draft",
          },
        },
      ] as const;
      let readModel = withThread;
      for (const [index, activity] of activities.entries()) {
        readModel = yield* projectEvent(readModel, {
          sequence: index + 3,
          eventId: EventId.make(`event-wayfinder-activity-${index}`),
          aggregateKind: "thread",
          aggregateId: threadId,
          type: "thread.activity-appended",
          occurredAt: now,
          commandId: CommandId.make(`command-wayfinder-activity-${index}`),
          causationEventId: null,
          correlationId: CommandId.make(`command-wayfinder-activity-${index}`),
          metadata: {},
          payload: {
            threadId,
            activity: {
              id: EventId.make(`event-wayfinder-activity-${index}`),
              tone: "info",
              ...activity,
              turnId: null,
              createdAt: now,
            },
          },
        });
      }

      const failure = yield* Effect.flip(
        decideOrchestrationCommand({
          readModel,
          command: {
            type: "thread.approval.respond",
            commandId: CommandId.make("command-wayfinder-approve"),
            threadId,
            requestId,
            decision: "accept",
            createdAt: now,
          },
        }),
      );

      expect(failure).toMatchObject({
        detail: expect.stringContaining("disabled"),
      });
      expect(failure).toMatchObject({
        detail: expect.stringContaining("unpublished draft"),
      });
    }),
  );
});
