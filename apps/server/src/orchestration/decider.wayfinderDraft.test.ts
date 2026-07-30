import {
  ApprovalRequestId,
  CommandId,
  EventId,
  ProjectId,
  ProviderInstanceId,
  SkillRunId,
  ThreadId,
} from "@t3tools/contracts";
import { createEmptyWayfinderDraft } from "@t3tools/shared/wayfinderDraft";
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

  it.effect("records publication against the thread's existing runtime permission mode", () =>
    Effect.gen(function* () {
      const now = "2026-01-01T00:00:00.000Z";
      const projectId = ProjectId.make("project-wayfinder-publish");
      const threadId = ThreadId.make("thread-wayfinder-publish");
      const skillRunId = SkillRunId.make("skill-run:publish");
      let readModel = yield* projectEvent(createEmptyReadModel(now), {
        sequence: 1,
        eventId: EventId.make("event-publish-project"),
        aggregateKind: "project",
        aggregateId: projectId,
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.make("command-publish-project"),
        causationEventId: null,
        correlationId: CommandId.make("command-publish-project"),
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
      readModel = yield* projectEvent(readModel, {
        sequence: 2,
        eventId: EventId.make("event-publish-thread"),
        aggregateKind: "thread",
        aggregateId: threadId,
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.make("command-publish-thread"),
        causationEventId: null,
        correlationId: CommandId.make("command-publish-thread"),
        metadata: {},
        payload: {
          threadId,
          projectId,
          title: "Wayfinder",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.3-codex",
          },
          runtimeMode: "approval-required",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });
      readModel = yield* projectEvent(readModel, {
        sequence: 3,
        eventId: EventId.make("event-publish-draft"),
        aggregateKind: "thread",
        aggregateId: threadId,
        type: "thread.activity-appended",
        occurredAt: now,
        commandId: CommandId.make("command-publish-draft"),
        causationEventId: null,
        correlationId: CommandId.make("command-publish-draft"),
        metadata: {},
        payload: {
          threadId,
          activity: {
            id: EventId.make("activity-publish-draft"),
            tone: "info",
            kind: "wayfinder.draft.started",
            summary: "Unpublished Wayfinder draft started",
            payload: { skillRunId },
            turnId: null,
            createdAt: now,
          },
        },
      });

      const bypass = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.wayfinder.publish",
          commandId: CommandId.make("command-publish-bypass"),
          threadId,
          skillRunId,
          confirmed: true,
          createdAt: now,
        },
      }).pipe(Effect.flip);
      expect(bypass).toMatchObject({ detail: expect.stringContaining("pending server approval") });

      const event = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.wayfinder.publish",
          commandId: CommandId.make("command-publish"),
          threadId,
          skillRunId,
          confirmed: false,
          createdAt: now,
        },
      });

      expect(event).toMatchObject({
        type: "thread.wayfinder-publication-requested",
        payload: {
          threadId,
          skillRunId,
          runtimeMode: "approval-required",
          confirmed: false,
        },
      });

      const approvalEvents = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.wayfinder.publication.update",
          commandId: CommandId.make("command-publication-awaiting"),
          threadId,
          skillRunId,
          publication: {
            status: "awaiting-approval",
            artifacts: [],
            nextStep: "confirm GitHub publication",
            updatedAt: now,
          },
          createdAt: now,
        },
      });
      expect(Array.isArray(approvalEvents)).toBe(true);
      let sequence = 4;
      for (const approvalEvent of Array.isArray(approvalEvents)
        ? approvalEvents
        : [approvalEvents]) {
        readModel = yield* projectEvent(readModel, { ...approvalEvent, sequence: sequence++ });
      }

      const confirmed = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.wayfinder.publish",
          commandId: CommandId.make("command-publish-confirmed"),
          threadId,
          skillRunId,
          confirmed: true,
          createdAt: now,
        },
      });
      expect(confirmed).toMatchObject({
        type: "thread.wayfinder-publication-requested",
        payload: { threadId, skillRunId, confirmed: true },
      });
    }),
  );
});
