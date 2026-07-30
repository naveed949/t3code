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
import {
  makeWayfinderPublicationProcessor,
  makeWayfinderPublicationReactor,
} from "./WayfinderPublicationReactor.ts";

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
          getSkillRunsByThreadId: () =>
            Effect.succeed([
              {
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
            ]),
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

it.effect(
  "loads an older draft by Skill Run and preserves its artifacts on repository failure",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const events = yield* Queue.unbounded<OrchestrationEvent>();
        const receipt = yield* Deferred.make<OrchestrationRuntimeReceipt>();
        const dispatched: Array<{ readonly type: string; readonly publication?: unknown }> = [];
        const now = "2026-07-30T10:10:00.000Z";
        const threadId = ThreadId.make("thread:older-draft");
        const skillRunId = SkillRunId.make("skill-run:older-draft");
        const projectId = ProjectId.make("project:older-draft");
        const invocation = {
          skill: {
            name: "wayfinder",
            path: "/skills/wayfinder/SKILL.md",
            contentDigest:
              "sha256:257e40665b28ae959ffdcb97d7a72b074360f4a3d201bd84786505308546e434",
          },
          action: { id: "new-map" as const },
          execution: { mode: "native" as const, adapterId: "wayfinder", adapterVersion: 1 },
          workstreamId: WorkstreamId.make("workstream:older-draft"),
          skillRunId,
          projectId,
          threadId,
          createdAt: now,
          wayfinderDraft: createEmptyWayfinderDraft(now),
          wayfinderPublication: {
            status: "failed" as const,
            artifacts: [{ kind: "label" as const, name: "wayfinder:map" }],
            nextStep: "resolve GitHub repository",
            error: "offline",
            updatedAt: now,
          },
        };
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
            getSkillRunsByThreadId: () => Effect.succeed([invocation]),
            getSnapshot: () =>
              Effect.succeed({
                snapshotSequence: 0,
                projects: [
                  {
                    id: projectId,
                    title: "Older draft project",
                    workspaceRoot: "/project",
                    defaultModelSelection: null,
                    scripts: [],
                    createdAt: now,
                    updatedAt: now,
                    deletedAt: null,
                  },
                ],
                threads: [
                  {
                    id: threadId,
                    projectId,
                    title: "Older draft thread",
                    modelSelection: {
                      instanceId: ProviderInstanceId.make("codex"),
                      model: "gpt-5",
                    },
                    interactionMode: "default",
                    runtimeMode: "full-access",
                    branch: null,
                    worktreePath: null,
                    latestTurn: {
                      turnId: TurnId.make("turn:follow-up"),
                      state: "completed",
                      requestedAt: now,
                      startedAt: now,
                      completedAt: now,
                      assistantMessageId: null,
                    },
                    createdAt: now,
                    updatedAt: now,
                    archivedAt: null,
                    settledOverride: null,
                    settledAt: null,
                    deletedAt: null,
                    messages: [],
                    proposedPlans: [],
                    activities: [
                      {
                        id: EventId.make("activity:older-draft"),
                        tone: "info",
                        kind: "wayfinder.draft.started",
                        summary: "Draft started",
                        payload: { skillRunId },
                        turnId: null,
                        createdAt: now,
                      },
                    ],
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
              loadWayfinderMap: () => Effect.die("unexpected tracker read"),
              ensureLabel: () => Effect.die("unexpected tracker write"),
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
          eventId: EventId.make("event:older-draft"),
          aggregateKind: "thread",
          aggregateId: threadId,
          type: "thread.wayfinder-publication-requested",
          occurredAt: now,
          commandId: CommandId.make("command:older-draft"),
          causationEventId: null,
          correlationId: CommandId.make("command:older-draft"),
          metadata: {},
          payload: {
            threadId,
            skillRunId,
            runtimeMode: "full-access",
            confirmed: false,
            createdAt: now,
          },
        });
        yield* Deferred.await(receipt);
        yield* reactor.drain;

        assert.deepStrictEqual(dispatched[0]?.publication, {
          status: "failed",
          artifacts: [{ kind: "label", name: "wayfinder:map" }],
          nextStep: "resolve GitHub repository",
          error: "The Wayfinder thread is not linked to a writable GitHub repository.",
          updatedAt: now,
        });
      }),
    ),
);

it.effect("publishes, reconciles, and emits progress receipts through the reactor", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const firstReceipt = yield* Deferred.make<OrchestrationRuntimeReceipt>();
      const publications: Array<{ readonly status?: string }> = [];
      const receiptStatuses: string[] = [];
      const now = "2026-07-30T10:15:00.000Z";
      const threadId = ThreadId.make("thread:successful-publication");
      const skillRunId = SkillRunId.make("skill-run:successful-publication");
      const projectId = ProjectId.make("project:successful-publication");
      const draft = {
        ...createEmptyWayfinderDraft(now),
        destination: "Choose a release plan",
        candidateTickets: [{ id: "choose-target", title: "Choose the deployment target" }],
      };
      const invocation = {
        skill: {
          name: "wayfinder",
          path: "/skills/wayfinder/SKILL.md",
          contentDigest: "sha256:257e40665b28ae959ffdcb97d7a72b074360f4a3d201bd84786505308546e434",
        },
        action: { id: "new-map" as const },
        execution: { mode: "native" as const, adapterId: "wayfinder", adapterVersion: 1 },
        workstreamId: WorkstreamId.make("workstream:successful-publication"),
        skillRunId,
        projectId,
        threadId,
        createdAt: now,
        wayfinderDraft: draft,
      };
      const publicationEvent = {
        sequence: 1,
        eventId: EventId.make("event:successful-publication"),
        aggregateKind: "thread",
        aggregateId: threadId,
        type: "thread.wayfinder-publication-requested",
        occurredAt: now,
        commandId: CommandId.make("command:successful-publication"),
        causationEventId: null,
        correlationId: CommandId.make("command:successful-publication"),
        metadata: {},
        payload: {
          threadId,
          skillRunId,
          runtimeMode: "full-access",
          confirmed: false,
          createdAt: now,
        },
      } satisfies Extract<OrchestrationEvent, { type: "thread.wayfinder-publication-requested" }>;
      let nextIssueNumber = 42;
      const dependencies = Layer.mergeAll(
        NodeServices.layer,
        Layer.succeed(OrchestrationEngineService, {
          readEvents: () => Stream.empty,
          dispatch: (command) =>
            Effect.sync(() => {
              if (command.type === "thread.wayfinder.publication.update") {
                publications.push(command.publication);
              }
              return { sequence: publications.length };
            }),
          streamDomainEvents: Stream.empty,
          latestSequence: Effect.succeed(0),
        }),
        Layer.mock(ProjectionSnapshotQuery)({
          getSkillRunsByThreadId: () => Effect.succeed([invocation]),
          getSnapshot: () =>
            Effect.succeed({
              snapshotSequence: 0,
              projects: [
                {
                  id: projectId,
                  title: "Successful publication project",
                  workspaceRoot: "/project",
                  defaultModelSelection: null,
                  scripts: [],
                  createdAt: now,
                  updatedAt: now,
                  deletedAt: null,
                },
              ],
              threads: [
                {
                  id: threadId,
                  projectId,
                  title: "Successful publication thread",
                  modelSelection: {
                    instanceId: ProviderInstanceId.make("codex"),
                    model: "gpt-5",
                  },
                  interactionMode: "default",
                  runtimeMode: "full-access",
                  branch: null,
                  worktreePath: null,
                  latestTurn: {
                    turnId: TurnId.make("turn:successful-publication"),
                    state: "completed",
                    requestedAt: now,
                    startedAt: now,
                    completedAt: now,
                    assistantMessageId: null,
                    skillInvocation: invocation,
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
            resolveProjectRepository: () =>
              Effect.succeed({
                canonicalKey: "github.com/t3tools/t3code",
                owner: "t3tools",
                name: "t3code",
              }),
            inspectCapabilities: () => Effect.die("unexpected tracker read"),
            resolveIssue: () => Effect.die("unexpected tracker read"),
            ensureLabel: () => Effect.void,
            createIssue: () =>
              Effect.sync(() => {
                const number = nextIssueNumber++;
                return {
                  number,
                  url: `https://github.com/t3tools/t3code/issues/${number}`,
                };
              }),
            addChild: () => Effect.void,
            addBlockedBy: () => Effect.void,
            loadWayfinderMap: () =>
              Effect.succeed({
                kind: "loaded" as const,
                map: {
                  canonicalReference: {
                    number: 42,
                    title: "Choose a release plan",
                    url: "https://github.com/t3tools/t3code/issues/42",
                    state: "open" as const,
                  },
                  destination: "Choose a release plan",
                  notes: "",
                  decisionsSoFar: [],
                  fogOfWar: [],
                  outOfScope: [],
                  tickets: [
                    {
                      number: 43,
                      title: "Choose the deployment target",
                      url: "https://github.com/t3tools/t3code/issues/43",
                      state: "open" as const,
                      classification: "task" as const,
                      claimedBy: null,
                      blockedBy: [],
                      blocks: [],
                    },
                  ],
                  frontier: [43],
                  lastSynchronizedAt: now,
                },
              }),
          }),
        ),
        Layer.succeed(
          RuntimeReceiptBus,
          RuntimeReceiptBus.of({
            publish: (receipt) =>
              Effect.gen(function* () {
                if (receipt.type !== "wayfinder.publication.progress") return;
                receiptStatuses.push(receipt.status);
                yield* Deferred.succeed(firstReceipt, receipt);
              }),
            streamEventsForTest: Stream.empty,
          }),
        ),
      );
      yield* Effect.gen(function* () {
        const processEvent = yield* makeWayfinderPublicationProcessor;
        yield* processEvent(publicationEvent);
        yield* Deferred.await(firstReceipt);
      }).pipe(Effect.provide(dependencies));

      assert.strictEqual(publications[0]?.status, "publishing");
      assert.strictEqual(publications.at(-1)?.status, "synchronized");
      assert.deepStrictEqual(
        receiptStatuses,
        publications.map((publication) => publication.status),
      );
    }),
  ),
);
