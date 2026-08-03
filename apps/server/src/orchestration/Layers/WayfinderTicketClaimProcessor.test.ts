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
import * as Option from "effect/Option";
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
const linkedThreadId = ThreadId.make("wayfinder-ticket:workstream:release:43");
const workstreamId = WorkstreamId.make("workstream:release");
const sourceSkillRunId = SkillRunId.make("skill-run:map");
const linkedSkillRunId = SkillRunId.make("skill-run:ticket-43");

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

function trackerLayer(claimedMap: WayfinderMapProjection, alreadyClaimed = false) {
  let claimed = alreadyClaimed;
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
          return { viewerLogin: "alice" };
        }),
      releaseIssue: () => Effect.sync(() => void (claimed = false)),
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
        sourceThreadId,
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
    const retryInvocation: SkillInvocation = {
      ...invocation,
      wayfinderMap: claimedMap,
      wayfinderMutation: {
        actionId: "action:claim:43",
        action: { kind: "claim-ticket", ticketNumber: 43 },
        status: "failed",
        error: "The linked thread is incomplete.",
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
        streamDomainEvents: Stream.empty,
        latestSequence: Effect.succeed(0),
      }),
      Layer.mock(ProjectionSnapshotQuery)({
        getSnapshot: () => Effect.succeed(sourceSnapshot(true)),
        getSkillRunsByThreadId: (candidateThreadId) =>
          Effect.succeed(candidateThreadId === sourceThreadId ? [retryInvocation] : []),
      }),
      trackerLayer(claimedMap, true),
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

it.effect("releases the canonical claim without deleting its linked thread", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const claimedMap = {
      ...map,
      tickets: [{ ...map.tickets[0]!, claimedBy: "alice" }],
      frontier: [],
    };
    const claimedInvocation: SkillInvocation = {
      ...invocation,
      wayfinderMap: claimedMap,
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
        getSkillRunsByThreadId: () => Effect.succeed([claimedInvocation]),
      }),
      trackerLayer(claimedMap, true),
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
      sequence: 3,
      eventId: EventId.make("event:release"),
      aggregateKind: "thread",
      aggregateId: sourceThreadId,
      type: "thread.wayfinder-mutation-requested",
      occurredAt: now,
      commandId: CommandId.make("command:release"),
      causationEventId: null,
      correlationId: CommandId.make("command:release"),
      metadata: {},
      payload: {
        threadId: sourceThreadId,
        skillRunId: sourceSkillRunId,
        actionId: "action:release:43",
        action: { kind: "release-ticket", ticketNumber: 43 },
        runtimeMode: "full-access",
        confirmed: false,
        createdAt: now,
      },
    });

    assert.deepStrictEqual(
      dispatched.map((command) => command.type),
      ["thread.wayfinder.mutation.update", "thread.wayfinder.mutation.update"],
    );
    const success = dispatched.at(-1);
    assert(success?.type === "thread.wayfinder.mutation.update");
    assert.strictEqual(success.mutation.status, "synchronized");
    assert.strictEqual(success.wayfinderMap?.tickets[0]?.claimedBy, null);
  }),
);

it.effect(
  "resolves one linked HITL ticket canonically and projects the result to the shared map run",
  () =>
    Effect.gen(function* () {
      const dispatched: OrchestrationCommand[] = [];
      const writes: string[] = [];
      const claimedMap: WayfinderMapProjection = {
        ...map,
        decisionsSoFar: [
          ...map.decisionsSoFar,
          {
            title: "Concurrent decision",
            url: "https://github.com/t3tools/t3code/issues/41",
            summary: "Keep this canonical update.",
          },
        ],
        fogOfWar: ["Relay failure behavior"],
        tickets: [{ ...map.tickets[0]!, claimedBy: "alice" }],
        frontier: [],
      };
      const finalMap: WayfinderMapProjection = {
        ...claimedMap,
        decisionsSoFar: [
          ...claimedMap.decisionsSoFar,
          {
            title: "Research hosting",
            url: "https://github.com/t3tools/t3code/issues/43#issuecomment-1",
            summary: "",
          },
        ],
        fogOfWar: [],
        tickets: [
          { ...claimedMap.tickets[0]!, state: "closed", commentCount: 1 },
          {
            number: 44,
            title: "Choose relay failure policy",
            url: "https://github.com/t3tools/t3code/issues/44",
            state: "open",
            classification: "grilling",
            claimedBy: null,
            blockedBy: [43],
            blocks: [],
          },
        ],
        frontier: [44],
      };
      const linkedInvocation: SkillInvocation = {
        ...invocation,
        action: {
          id: "work-ticket",
          ticketNumber: 43,
          sourceSkillRunId,
        },
        wayfinderMap: claimedMap,
        skillRunId: linkedSkillRunId,
        threadId: linkedThreadId,
      };
      let closed = false;
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
          getSkillRunById: () =>
            Effect.succeed(
              Option.some({
                threadId: sourceThreadId,
                skillInvocation: { ...invocation, wayfinderMap: map },
              }),
            ),
          getSkillRunsByThreadId: (candidateThreadId) =>
            Effect.succeed(
              candidateThreadId === sourceThreadId
                ? [{ ...invocation, wayfinderMap: map }]
                : candidateThreadId === linkedThreadId
                  ? [linkedInvocation]
                  : [],
            ),
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
            loadWayfinderMap: () =>
              Effect.sync(() => ({
                kind: "loaded" as const,
                map: closed ? finalMap : claimedMap,
              })),
            reconcileWayfinderMap: () => Effect.die("unexpected tracker read"),
            claimIssue: () => Effect.die("unexpected tracker write"),
            releaseIssue: () => Effect.die("unexpected tracker write"),
            ensureLabel: ({ name }) => Effect.sync(() => writes.push(`label:${name}`)),
            createIssue: ({ key }) =>
              Effect.sync(() => {
                writes.push(`issue:${key}`);
                return {
                  number: 44,
                  url: "https://github.com/t3tools/t3code/issues/44",
                };
              }),
            addChild: ({ childNumber }) => Effect.sync(() => writes.push(`child:${childNumber}`)),
            addBlockedBy: ({ blockedNumber, blockerNumber }) =>
              Effect.sync(() => writes.push(`blocked-by:${blockedNumber}:${blockerNumber}`)),
            updateWayfinderMapField: ({ field, value }) =>
              Effect.sync(() => writes.push(`field:${field}:${value}`)),
            updateWayfinderDecisions: ({ value }) =>
              Effect.sync(() => writes.push(`decisions:${value}`)),
            updateIssueTitle: () => Effect.die("unexpected tracker write"),
            setWayfinderClassification: () => Effect.die("unexpected tracker write"),
            removeChild: () => Effect.die("unexpected tracker write"),
            removeBlockedBy: () => Effect.die("unexpected tracker write"),
            addIssueComment: ({ issueNumber, body }) =>
              Effect.sync(() => writes.push(`comment:${issueNumber}:${body}`)),
            hasIssueComment: () => Effect.succeed(true),
            setIssueState: ({ issueNumber, state }) =>
              Effect.sync(() => {
                writes.push(`state:${issueNumber}:${state}`);
                closed = state === "closed";
              }),
          }),
        ),
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
        sequence: 4,
        eventId: EventId.make("event:resolve"),
        aggregateKind: "thread",
        aggregateId: linkedThreadId,
        type: "thread.wayfinder-mutation-requested",
        occurredAt: now,
        commandId: CommandId.make("command:resolve"),
        causationEventId: null,
        correlationId: CommandId.make("command:resolve"),
        metadata: {},
        payload: {
          threadId: linkedThreadId,
          skillRunId: linkedSkillRunId,
          actionId: "action:resolve:43",
          action: {
            kind: "complete-hitl-ticket",
            ticketNumber: 43,
            outcome: "resolved",
            resolution: "Use the environment-owned synchronization path.",
            contextPointer: "https://github.com/t3tools/t3code/issues/43#issuecomment-1",
            graduatedFog: [
              {
                key: "relay-failure-policy",
                fog: "Relay failure behavior",
                title: "Choose relay failure policy",
                classification: "grilling",
                blockedBy: [{ kind: "ticket", ticketNumber: 43 }],
              },
            ],
          },
          runtimeMode: "full-access",
          confirmed: false,
          createdAt: now,
        },
      });

      assert.deepStrictEqual(writes, [
        "comment:43:Resolution: Use the environment-owned synchronization path.\n\nContext: https://github.com/t3tools/t3code/issues/43#issuecomment-1",
        "label:wayfinder:grilling",
        "issue:relay-failure-policy",
        "child:44",
        "blocked-by:44:43",
        "field:fog-of-war:",
        "decisions:- [Use immutable artifacts](https://github.com/t3tools/t3code/issues/40) — Scan the exact digest.\n- [Concurrent decision](https://github.com/t3tools/t3code/issues/41) — Keep this canonical update.\n- [Research hosting](https://github.com/t3tools/t3code/issues/43#issuecomment-1)",
        "state:43:closed",
      ]);
      const terminal = dispatched.filter(
        (
          command,
        ): command is Extract<
          OrchestrationCommand,
          { readonly type: "thread.wayfinder.mutation.update" }
        > =>
          command.type === "thread.wayfinder.mutation.update" &&
          command.mutation.status === "synchronized",
      );
      assert.deepStrictEqual(
        terminal.map((command) => [command.threadId, command.skillRunId]),
        [
          [linkedThreadId, linkedSkillRunId],
          [sourceThreadId, sourceSkillRunId],
        ],
      );
      assert.strictEqual(terminal[0]?.wayfinderMap?.tickets[0]?.state, "closed");
      assert.strictEqual(terminal[1]?.wayfinderMap?.frontier[0], 44);
      assert.deepStrictEqual(
        terminal[0]?.mutation.artifacts?.map((artifact) => artifact.kind),
        [
          "resolution-comment",
          "label",
          "issue",
          "child",
          "blocked-by",
          "fog-graduated",
          "decision-pointer",
          "ticket-closed",
        ],
      );
    }),
);

it.effect("preserves verified resolution artifacts and the canonical claim after failure", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const claimedMap: WayfinderMapProjection = {
      ...map,
      tickets: [{ ...map.tickets[0]!, claimedBy: "alice" }],
      frontier: [],
    };
    const linkedInvocation: SkillInvocation = {
      ...invocation,
      action: { id: "work-ticket", ticketNumber: 43, sourceSkillRunId, sourceThreadId },
      wayfinderMap: claimedMap,
      skillRunId: linkedSkillRunId,
      threadId: linkedThreadId,
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
        getSkillRunsByThreadId: (candidateThreadId) =>
          Effect.succeed(
            candidateThreadId === sourceThreadId
              ? [{ ...invocation, wayfinderMap: map }]
              : candidateThreadId === linkedThreadId
                ? [linkedInvocation]
                : [],
          ),
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
          loadWayfinderMap: () => Effect.succeed({ kind: "loaded" as const, map: claimedMap }),
          reconcileWayfinderMap: () => Effect.die("unexpected tracker read"),
          claimIssue: () => Effect.die("unexpected tracker write"),
          releaseIssue: () => Effect.die("unexpected tracker write"),
          ensureLabel: () => Effect.die("unexpected tracker write"),
          createIssue: () => Effect.die("unexpected tracker write"),
          addChild: () => Effect.die("unexpected tracker write"),
          addBlockedBy: () => Effect.die("unexpected tracker write"),
          updateWayfinderMapField: () => Effect.die("unexpected tracker write"),
          updateWayfinderDecisions: () => Effect.fail({} as never),
          updateIssueTitle: () => Effect.die("unexpected tracker write"),
          setWayfinderClassification: () => Effect.die("unexpected tracker write"),
          removeChild: () => Effect.die("unexpected tracker write"),
          removeBlockedBy: () => Effect.die("unexpected tracker write"),
          addIssueComment: () => Effect.void,
          setIssueState: () => Effect.die("unexpected tracker write"),
        }),
      ),
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
      sequence: 5,
      eventId: EventId.make("event:resolve-failed"),
      aggregateKind: "thread",
      aggregateId: linkedThreadId,
      type: "thread.wayfinder-mutation-requested",
      occurredAt: now,
      commandId: CommandId.make("command:resolve-failed"),
      causationEventId: null,
      correlationId: CommandId.make("command:resolve-failed"),
      metadata: {},
      payload: {
        threadId: linkedThreadId,
        skillRunId: linkedSkillRunId,
        actionId: "action:resolve:failed:43",
        action: {
          kind: "complete-hitl-ticket",
          ticketNumber: 43,
          outcome: "resolved",
          resolution: "Use the environment-owned synchronization path.",
          contextPointer: "https://github.com/t3tools/t3code/issues/43#issuecomment-1",
          graduatedFog: [],
        },
        runtimeMode: "full-access",
        confirmed: false,
        createdAt: now,
      },
    });

    const failures = dispatched.filter(
      (
        command,
      ): command is Extract<
        OrchestrationCommand,
        { readonly type: "thread.wayfinder.mutation.update" }
      > =>
        command.type === "thread.wayfinder.mutation.update" && command.mutation.status === "failed",
    );
    assert.strictEqual(failures.length, 2);
    assert.deepStrictEqual(
      failures[0]?.mutation.artifacts?.map((artifact) => artifact.kind),
      ["resolution-comment"],
    );
    assert.strictEqual(failures[0]?.mutation.nextStep, "record decision context pointer");
    assert.strictEqual(failures[0]?.wayfinderMap?.tickets[0]?.claimedBy, "alice");
    assert.match(failures[0]?.mutation.error ?? "", /Resume or release/u);
  }),
);

it.effect("closes beyond-destination work as out of scope without adding a route decision", () =>
  Effect.gen(function* () {
    const writes: string[] = [];
    const dispatched: OrchestrationCommand[] = [];
    const claimedMap: WayfinderMapProjection = {
      ...map,
      outOfScope: ["Building production"],
      tickets: [{ ...map.tickets[0]!, claimedBy: "alice" }],
      frontier: [],
    };
    const finalMap: WayfinderMapProjection = {
      ...claimedMap,
      outOfScope: [
        "Building production",
        "[Research hosting](https://github.com/t3tools/t3code/issues/43#issuecomment-2)",
      ],
      tickets: [
        {
          ...claimedMap.tickets[0]!,
          state: "closed",
          classification: "out-of-scope",
          commentCount: 1,
        },
      ],
    };
    const linkedInvocation: SkillInvocation = {
      ...invocation,
      action: { id: "work-ticket", ticketNumber: 43, sourceSkillRunId, sourceThreadId },
      wayfinderMap: claimedMap,
      skillRunId: linkedSkillRunId,
      threadId: linkedThreadId,
    };
    let closed = false;
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
        getSkillRunsByThreadId: (candidateThreadId) =>
          Effect.succeed(
            candidateThreadId === sourceThreadId
              ? [{ ...invocation, wayfinderMap: map }]
              : candidateThreadId === linkedThreadId
                ? [linkedInvocation]
                : [],
          ),
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
          loadWayfinderMap: () =>
            Effect.sync(() => ({
              kind: "loaded" as const,
              map: closed ? finalMap : claimedMap,
            })),
          reconcileWayfinderMap: () => Effect.die("unexpected tracker read"),
          claimIssue: () => Effect.die("unexpected tracker write"),
          releaseIssue: () => Effect.die("unexpected tracker write"),
          ensureLabel: () => Effect.die("unexpected tracker write"),
          createIssue: () => Effect.die("unexpected tracker write"),
          addChild: () => Effect.die("unexpected tracker write"),
          addBlockedBy: () => Effect.die("unexpected tracker write"),
          updateWayfinderMapField: ({ field, value }) =>
            Effect.sync(() => writes.push(`field:${field}:${value}`)),
          updateWayfinderDecisions: () => Effect.die("must not record a route decision"),
          updateIssueTitle: () => Effect.die("unexpected tracker write"),
          setWayfinderClassification: ({ classification }) =>
            Effect.sync(() => writes.push(`classification:${classification}`)),
          removeChild: () => Effect.die("unexpected tracker write"),
          removeBlockedBy: () => Effect.die("unexpected tracker write"),
          addIssueComment: () => Effect.sync(() => writes.push("comment")),
          hasIssueComment: () => Effect.succeed(true),
          setIssueState: ({ state }) =>
            Effect.sync(() => {
              writes.push(`state:${state}`);
              closed = state === "closed";
            }),
        }),
      ),
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
      sequence: 6,
      eventId: EventId.make("event:out-of-scope"),
      aggregateKind: "thread",
      aggregateId: linkedThreadId,
      type: "thread.wayfinder-mutation-requested",
      occurredAt: now,
      commandId: CommandId.make("command:out-of-scope"),
      causationEventId: null,
      correlationId: CommandId.make("command:out-of-scope"),
      metadata: {},
      payload: {
        threadId: linkedThreadId,
        skillRunId: linkedSkillRunId,
        actionId: "action:out-of-scope:43",
        action: {
          kind: "complete-hitl-ticket",
          ticketNumber: 43,
          outcome: "out-of-scope",
          resolution: "Hosting execution is beyond this map's destination.",
          contextPointer: "https://github.com/t3tools/t3code/issues/43#issuecomment-2",
          graduatedFog: [],
        },
        runtimeMode: "full-access",
        confirmed: false,
        createdAt: now,
      },
    });

    assert.deepStrictEqual(writes, [
      "comment",
      "field:out-of-scope:- Building production\n- [Research hosting](https://github.com/t3tools/t3code/issues/43#issuecomment-2)",
      "classification:out-of-scope",
      "state:closed",
    ]);
    const terminal = dispatched.find(
      (command) =>
        command.type === "thread.wayfinder.mutation.update" &&
        command.mutation.status === "synchronized",
    );
    assert(terminal?.type === "thread.wayfinder.mutation.update");
    assert.strictEqual(terminal.wayfinderMap?.tickets[0]?.classification, "out-of-scope");
    assert.deepStrictEqual(terminal.wayfinderMap?.decisionsSoFar, map.decisionsSoFar);
  }),
);
