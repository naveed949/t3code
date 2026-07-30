import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  type OrchestrationEvent,
  ProjectId,
  ProviderInstanceId,
  SkillRunId,
  ThreadId,
  TurnId,
  WorkstreamId,
} from "@t3tools/contracts";
import { createEmptyWayfinderDraft } from "@t3tools/shared/wayfinderDraft";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { IssueTracker } from "../../nativeSkills/IssueTracker.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  RuntimeReceiptBus,
  type OrchestrationRuntimeReceipt,
} from "../Services/RuntimeReceiptBus.ts";
import { makeWayfinderPublicationReactor } from "./WayfinderPublicationReactor.ts";

it.effect("waits for confirmation in approval-required mode without writing to GitHub", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<OrchestrationEvent>();
      const receipt = yield* Deferred.make<OrchestrationRuntimeReceipt>();
      const dispatched: Array<{ readonly type: string; readonly publication?: unknown }> = [];
      let trackerWrites = 0;
      const now = "2026-07-30T10:05:00.000Z";
      const threadId = ThreadId.make("thread:publish");
      const skillRunId = SkillRunId.make("skill-run:publish");
      const projectId = ProjectId.make("project:publish");

      const dependencies = Layer.mergeAll(
        NodeServices.layer,
        Layer.succeed(OrchestrationEngineService, {
          readEvents: () => Stream.empty,
          dispatch: (command) =>
            Effect.sync(() => {
              dispatched.push(command);
              return { sequence: dispatched.length };
            }),
          streamDomainEvents: Stream.fromQueue(events),
          latestSequence: Effect.succeed(0),
        }),
        Layer.mock(ProjectionSnapshotQuery)({
          getSnapshot: () =>
            Effect.succeed({
              snapshotSequence: 0,
              projects: [],
              threads: [
                {
                  id: threadId,
                  projectId,
                  title: "Publication thread",
                  modelSelection: {
                    instanceId: ProviderInstanceId.make("codex"),
                    model: "gpt-5",
                  },
                  interactionMode: "default",
                  runtimeMode: "approval-required",
                  branch: null,
                  worktreePath: null,
                  latestTurn: {
                    turnId: TurnId.make("turn:publish"),
                    state: "completed",
                    requestedAt: now,
                    startedAt: now,
                    completedAt: now,
                    assistantMessageId: null,
                    skillInvocation: {
                      skill: {
                        name: "wayfinder",
                        path: "/skills/wayfinder/SKILL.md",
                        contentDigest:
                          "sha256:257e40665b28ae959ffdcb97d7a72b074360f4a3d201bd84786505308546e434",
                      },
                      action: { id: "new-map" },
                      execution: { mode: "native", adapterId: "wayfinder", adapterVersion: 1 },
                      workstreamId: WorkstreamId.make("workstream:publish"),
                      skillRunId,
                      projectId,
                      threadId,
                      createdAt: now,
                      wayfinderDraft: createEmptyWayfinderDraft(now),
                    },
                  },
                  createdAt: now,
                  updatedAt: now,
                  archivedAt: null,
                  settledOverride: null,
                  settledAt: null,
                  deletedAt: null,
                  messages: [],
                  proposedPlans: [],
                  activities: [],
                  checkpoints: [],
                  session: null,
                },
              ],
              updatedAt: now,
            }),
        }),
        Layer.succeed(
          IssueTracker,
          IssueTracker.of({
            resolveProjectRepository: () => Effect.succeed(null),
            inspectCapabilities: () => Effect.die("unexpected tracker read"),
            resolveIssue: () => Effect.die("unexpected tracker read"),
            loadWayfinderMap: () => Effect.die("unexpected tracker write"),
            ensureLabel: () =>
              Effect.sync(() => {
                trackerWrites += 1;
              }),
            createIssue: () => Effect.die("unexpected tracker write"),
            addChild: () => Effect.die("unexpected tracker write"),
            addBlockedBy: () => Effect.die("unexpected tracker write"),
          }),
        ),
        Layer.succeed(
          RuntimeReceiptBus,
          RuntimeReceiptBus.of({
            publish: (value) => Deferred.succeed(receipt, value).pipe(Effect.asVoid),
            streamEventsForTest: Stream.empty,
          }),
        ),
      );
      const reactor = yield* makeWayfinderPublicationReactor.pipe(Effect.provide(dependencies));
      yield* reactor.start();
      yield* Queue.offer(events, {
        sequence: 1,
        eventId: EventId.make("event:publish"),
        aggregateKind: "thread",
        aggregateId: threadId,
        type: "thread.wayfinder-publication-requested",
        occurredAt: now,
        commandId: CommandId.make("command:publish"),
        causationEventId: null,
        correlationId: CommandId.make("command:publish"),
        metadata: {},
        payload: {
          threadId,
          skillRunId,
          runtimeMode: "approval-required",
          confirmed: false,
          createdAt: now,
        },
      });
      const publishedReceipt = yield* Deferred.await(receipt);
      yield* reactor.drain;

      assert.strictEqual(trackerWrites, 0);
      assert.strictEqual(publishedReceipt.type, "wayfinder.publication.progress");
      if (publishedReceipt.type === "wayfinder.publication.progress") {
        assert.strictEqual(publishedReceipt.status, "awaiting-approval");
        assert.strictEqual(publishedReceipt.nextStep, "confirm GitHub publication");
      }
      assert.deepStrictEqual(
        dispatched.map((command) => command.type),
        ["thread.wayfinder.publication.update"],
      );
    }),
  ),
);
