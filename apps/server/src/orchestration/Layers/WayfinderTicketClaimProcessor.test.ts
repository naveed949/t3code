import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  ProjectId,
  ProviderInstanceId,
  SkillRunId,
  ThreadId,
  WorkstreamId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  type SkillInvocation,
  type WayfinderMapProjection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { IssueTracker } from "../../nativeSkills/IssueTracker.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  RuntimeReceiptBus,
  type OrchestrationRuntimeReceipt,
} from "../Services/RuntimeReceiptBus.ts";
import { makeWayfinderMutationProcessor } from "./WayfinderProcessors.ts";

const now = "2026-01-02T00:00:00.000Z";
const projectId = ProjectId.make("project:claim");
const sourceThreadId = ThreadId.make("thread:map");
const workstreamId = WorkstreamId.make("workstream:release");
const sourceSkillRunId = SkillRunId.make("skill-run:map");

const map: WayfinderMapProjection = {
  canonicalReference: {
    number: 42,
    title: "Release map",
    url: "https://github.com/t3tools/t3code/issues/42",
    state: "open",
  },
  destination: "Choose a safe release path.",
  notes: "",
  decisionsSoFar: [
    {
      title: "Use immutable artifacts",
      url: "https://github.com/t3tools/t3code/issues/40",
      summary: "Scan the exact digest.",
    },
  ],
  fogOfWar: [],
  outOfScope: [],
  tickets: [
    {
      number: 43,
      title: "Research hosting",
      url: "https://github.com/t3tools/t3code/issues/43",
      state: "open",
      classification: "research",
      claimedBy: null,
      blockedBy: [],
      blocks: [],
    },
  ],
  frontier: [43],
  lastSynchronizedAt: now,
};

const invocation: SkillInvocation = {
  skill: {
    name: "wayfinder",
    path: "/skills/wayfinder/SKILL.md",
    contentDigest: "sha256:257e40665b28ae959ffdcb97d7a72b074360f4a3d201bd84786505308546e434",
  },
  action: { id: "continue-map", reference: "42" },
  execution: { mode: "native", adapterId: "wayfinder", adapterVersion: 1 },
  wayfinderMap: map,
  workstreamId,
  skillRunId: sourceSkillRunId,
  projectId,
  threadId: sourceThreadId,
  createdAt: now,
};

function sourceSnapshot(withEmptyTicketThread = false): OrchestrationReadModel {
  const sourceThread = {
    id: sourceThreadId,
    projectId,
    title: "Release map",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5",
    },
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    branch: "feature/release",
    worktreePath: "/project-worktree",
    latestTurn: null,
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
  };
  return {
    snapshotSequence: 0,
    projects: [
      {
        id: projectId,
        title: "Project",
        workspaceRoot: "/project",
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ],
    threads: [
      sourceThread,
      ...(withEmptyTicketThread
        ? [
            {
              ...sourceThread,
              id: ThreadId.make("wayfinder-ticket:workstream:release:43"),
              title: "Wayfinder #43: Research hosting",
            },
          ]
        : []),
    ],
    updatedAt: now,
  };
}

function trackerLayer(claimedMap: WayfinderMapProjection) {
  let claimed = false;
  return Layer.succeed(
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
      loadWayfinderMap: () =>
        Effect.succeed({ kind: "loaded" as const, map: claimed ? claimedMap : map }),
      reconcileWayfinderMap: () => Effect.die("unexpected tracker read"),
      claimIssue: () =>
        Effect.sync(() => {
          claimed = true;
          return { viewerLogin: "alice", alreadyOwned: false };
        }),
      releaseIssue: () => Effect.die("unexpected tracker write"),
      ensureLabel: () => Effect.die("unexpected tracker write"),
      createIssue: () => Effect.die("unexpected tracker write"),
      addChild: () => Effect.die("unexpected tracker write"),
      addBlockedBy: () => Effect.die("unexpected tracker write"),
      updateWayfinderMapField: () => Effect.die("unexpected tracker write"),
      updateWayfinderDecisions: () => Effect.die("unexpected tracker write"),
      updateIssueTitle: () => Effect.die("unexpected tracker write"),
      setWayfinderClassification: () => Effect.die("unexpected tracker write"),
      removeChild: () => Effect.die("unexpected tracker write"),
      removeBlockedBy: () => Effect.die("unexpected tracker write"),
      addIssueComment: () => Effect.die("unexpected tracker write"),
      setIssueState: () => Effect.die("unexpected tracker write"),
    }),
  );
}

it.effect(
  "claims a frontier ticket and bootstraps one linked thread before reporting success",
  () =>
    Effect.gen(function* () {
      const dispatched: OrchestrationCommand[] = [];
      const receipts: OrchestrationRuntimeReceipt[] = [];
      const claimedMap = {
        ...map,
        tickets: [{ ...map.tickets[0]!, claimedBy: "alice" }],
        frontier: [],
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
          streamDomainEvents: Stream.empty,
          latestSequence: Effect.succeed(0),
        }),
        Layer.mock(ProjectionSnapshotQuery)({
          getSnapshot: () => Effect.succeed(sourceSnapshot()),
          getSkillRunsByThreadId: () => Effect.succeed([invocation]),
        }),
        trackerLayer(claimedMap),
        Layer.succeed(
          RuntimeReceiptBus,
          RuntimeReceiptBus.of({
            publish: (receipt) => Effect.sync(() => receipts.push(receipt)),
            streamEventsForTest: Stream.empty,
          }),
        ),
      );
      const process = yield* makeWayfinderMutationProcessor.pipe(Effect.provide(dependencies));
      yield* process({
        sequence: 1,
        eventId: EventId.make("event:claim"),
        aggregateKind: "thread",
        aggregateId: sourceThreadId,
        type: "thread.wayfinder-mutation-requested",
        occurredAt: now,
        commandId: CommandId.make("command:claim"),
        causationEventId: null,
        correlationId: CommandId.make("command:claim"),
        metadata: {},
        payload: {
          threadId: sourceThreadId,
          skillRunId: sourceSkillRunId,
          actionId: "action:claim:43",
          action: { kind: "claim-ticket", ticketNumber: 43 },
          runtimeMode: "full-access",
          confirmed: false,
          createdAt: now,
        },
      });

      assert.deepStrictEqual(
        dispatched.map((command) => command.type),
        [
          "thread.wayfinder.mutation.update",
          "thread.create",
          "thread.turn.start",
          "thread.wayfinder.mutation.update",
        ],
      );
      const create = dispatched[1];
      assert(create?.type === "thread.create");
      assert.strictEqual(create.threadId, "wayfinder-ticket:workstream:release:43");
      assert.strictEqual(create.projectId, projectId);
      const start = dispatched[2];
      assert(start?.type === "thread.turn.start");
      assert.match(start.message.text, /Destination\nChoose a safe release path/u);
      assert.match(start.message.text, /Use immutable artifacts/u);
      assert.strictEqual(start.skillInvocation?.arguments, start.message.text);
      assert.deepStrictEqual(start.skillInvocation?.action, {
        id: "work-ticket",
        ticketNumber: 43,
        sourceSkillRunId,
      });
      assert.strictEqual(start.skillInvocation?.reconnectWorkstreamId, workstreamId);
      const success = dispatched.at(-1);
      assert(success?.type === "thread.wayfinder.mutation.update");
      assert.strictEqual(success.mutation.status, "synchronized");
      assert.strictEqual(success.wayfinderMap?.tickets[0]?.claimedBy, "alice");
      assert.deepStrictEqual(
        receipts.map((receipt) =>
          receipt.type === "wayfinder.mutation.progress" ? receipt.status : receipt.type,
        ),
        ["mutating", "synchronized"],
      );
    }),
);

it.effect("recovers an empty deterministic ticket thread without creating a duplicate", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const claimedMap = {
      ...map,
      tickets: [{ ...map.tickets[0]!, claimedBy: "alice" }],
      frontier: [],
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
        streamDomainEvents: Stream.empty,
        latestSequence: Effect.succeed(0),
      }),
      Layer.mock(ProjectionSnapshotQuery)({
        getSnapshot: () => Effect.succeed(sourceSnapshot(true)),
        getSkillRunsByThreadId: () => Effect.succeed([invocation]),
      }),
      trackerLayer(claimedMap),
      Layer.succeed(
        RuntimeReceiptBus,
        RuntimeReceiptBus.of({
          publish: () => Effect.void,
          streamEventsForTest: Stream.empty,
        }),
      ),
    );
    const process = yield* makeWayfinderMutationProcessor.pipe(Effect.provide(dependencies));
    yield* process({
      sequence: 2,
      eventId: EventId.make("event:claim-retry"),
      aggregateKind: "thread",
      aggregateId: sourceThreadId,
      type: "thread.wayfinder-mutation-requested",
      occurredAt: now,
      commandId: CommandId.make("command:claim-retry"),
      causationEventId: null,
      correlationId: CommandId.make("command:claim-retry"),
      metadata: {},
      payload: {
        threadId: sourceThreadId,
        skillRunId: sourceSkillRunId,
        actionId: "action:claim-retry:43",
        action: { kind: "claim-ticket", ticketNumber: 43 },
        runtimeMode: "full-access",
        confirmed: false,
        createdAt: now,
      },
    });

    assert.deepStrictEqual(
      dispatched.map((command) => command.type),
      ["thread.wayfinder.mutation.update", "thread.turn.start", "thread.wayfinder.mutation.update"],
    );
    assert.strictEqual(dispatched.at(-1)?.type, "thread.wayfinder.mutation.update");
    const success = dispatched.at(-1);
    assert(success?.type === "thread.wayfinder.mutation.update");
    assert.strictEqual(success.mutation.status, "synchronized");
  }),
);
