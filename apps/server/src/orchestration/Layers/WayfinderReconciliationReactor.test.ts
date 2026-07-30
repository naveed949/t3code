import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  ProjectId,
  ProviderInstanceId,
  SkillRunId,
  ThreadId,
  TurnId,
  WorkstreamId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { IssueTracker } from "../../nativeSkills/IssueTracker.ts";
import * as GitHubCli from "../../sourceControl/GitHubCli.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  RuntimeReceiptBus,
  type OrchestrationRuntimeReceipt,
} from "../Services/RuntimeReceiptBus.ts";
import { makeWayfinderReconciliationProcessor } from "./WayfinderReconciliationReactor.ts";

const now = "2026-07-30T16:10:00.000Z";
const previousSync = "2026-07-30T16:00:00.000Z";
const threadId = ThreadId.make("thread:reconcile");
const skillRunId = SkillRunId.make("skill-run:reconcile");
const projectId = ProjectId.make("project:reconcile");
const map = {
  canonicalReference: {
    number: 42,
    title: "Release map",
    url: "https://github.com/t3tools/t3code/issues/42",
    state: "open" as const,
  },
  revision: "revision:current",
  destination: "Ship safely",
  notes: "",
  decisionsSoFar: [],
  fogOfWar: [],
  outOfScope: [],
  tickets: [],
  frontier: [],
  lastSynchronizedAt: previousSync,
};
const invocation = {
  skill: {
    name: "wayfinder",
    path: "/skills/wayfinder/SKILL.md",
    contentDigest: "sha256:257e40665b28ae959ffdcb97d7a72b074360f4a3d201bd84786505308546e434",
  },
  action: { id: "new-map" as const },
  execution: { mode: "native" as const, adapterId: "wayfinder", adapterVersion: 1 },
  workstreamId: WorkstreamId.make("workstream:reconcile"),
  skillRunId,
  projectId,
  threadId,
  createdAt: previousSync,
  wayfinderMap: map,
  wayfinderSynchronizedAt: previousSync,
};

function event(input: {
  readonly reason: "manual" | "mutation" | "poll";
  readonly expectedRevision?: string;
}): Extract<OrchestrationEvent, { type: "thread.wayfinder-reconciliation-requested" }> {
  return {
    sequence: 1,
    eventId: EventId.make("event:reconcile"),
    aggregateKind: "thread",
    aggregateId: threadId,
    type: "thread.wayfinder-reconciliation-requested",
    occurredAt: now,
    commandId: CommandId.make("command:reconcile"),
    causationEventId: null,
    correlationId: CommandId.make("command:reconcile"),
    metadata: {},
    payload: {
      threadId,
      skillRunId,
      reason: input.reason,
      ...(input.expectedRevision !== undefined ? { expectedRevision: input.expectedRevision } : {}),
      createdAt: now,
    },
  };
}

function dependencies(input: {
  readonly reconcile: IssueTracker["Service"]["reconcileWayfinderMap"];
  readonly dispatched: OrchestrationCommand[];
  readonly receipts: OrchestrationRuntimeReceipt[];
  readonly trackerReads: { value: number };
}) {
  return Layer.mergeAll(
    NodeServices.layer,
    Layer.succeed(OrchestrationEngineService, {
      readEvents: () => Stream.empty,
      dispatch: (command) =>
        Effect.sync(() => {
          input.dispatched.push(command);
          return { sequence: input.dispatched.length };
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
              title: "Reconciliation project",
              workspaceRoot: "/project",
              defaultModelSelection: null,
              scripts: [],
              createdAt: previousSync,
              updatedAt: previousSync,
              deletedAt: null,
            },
          ],
          threads: [
            {
              id: threadId,
              projectId,
              title: "Reconciliation thread",
              modelSelection: {
                instanceId: ProviderInstanceId.make("codex"),
                model: "gpt-5",
              },
              interactionMode: "default",
              runtimeMode: "full-access",
              branch: null,
              worktreePath: null,
              latestTurn: {
                turnId: TurnId.make("turn:reconcile"),
                state: "completed",
                requestedAt: previousSync,
                startedAt: previousSync,
                completedAt: previousSync,
                assistantMessageId: null,
                skillInvocation: invocation,
              },
              createdAt: previousSync,
              updatedAt: previousSync,
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
          updatedAt: previousSync,
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
        loadWayfinderMap: () => Effect.die("unexpected tracker read"),
        reconcileWayfinderMap: (request) => {
          input.trackerReads.value += 1;
          return input.reconcile(request);
        },
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
    ),
    Layer.succeed(
      RuntimeReceiptBus,
      RuntimeReceiptBus.of({
        publish: (receipt) =>
          Effect.sync(() => {
            input.receipts.push(receipt);
          }),
        streamEventsForTest: Stream.empty,
      }),
    ),
  );
}

it.effect(
  "uses a conditional tracker read and advances synchronization without replacing the map",
  () =>
    Effect.gen(function* () {
      const dispatched: OrchestrationCommand[] = [];
      const receipts: OrchestrationRuntimeReceipt[] = [];
      const trackerReads = { value: 0 };
      const process = yield* makeWayfinderReconciliationProcessor.pipe(
        Effect.provide(
          dependencies({
            dispatched,
            receipts,
            trackerReads,
            reconcile: () => Effect.succeed({ kind: "unchanged", revision: map.revision }),
          }),
        ),
      );

      yield* process(event({ reason: "manual" }));

      assert.strictEqual(trackerReads.value, 1);
      assert.deepStrictEqual(
        dispatched.map((command) =>
          command.type === "thread.wayfinder.reconciliation.update"
            ? [command.type, command.synchronization.status, command.wayfinderMap]
            : [command.type],
        ),
        [
          ["thread.wayfinder.reconciliation.update", "synchronizing", undefined],
          ["thread.wayfinder.reconciliation.update", "healthy", undefined],
        ],
      );
      assert.strictEqual(receipts.at(-1)?.type, "wayfinder.reconciliation.completed");
    }),
);

it.effect("enters conflict before a stale mutation can reach GitHub", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const receipts: OrchestrationRuntimeReceipt[] = [];
    const trackerReads = { value: 0 };
    const process = yield* makeWayfinderReconciliationProcessor.pipe(
      Effect.provide(
        dependencies({
          dispatched,
          receipts,
          trackerReads,
          reconcile: () => Effect.die("stale mutation must not read or write GitHub"),
        }),
      ),
    );

    yield* process(event({ reason: "mutation", expectedRevision: "revision:stale" }));

    assert.strictEqual(trackerReads.value, 0);
    const terminal = dispatched.at(-1);
    assert.strictEqual(terminal?.type, "thread.wayfinder.reconciliation.update");
    if (terminal?.type === "thread.wayfinder.reconciliation.update") {
      assert.strictEqual(terminal.synchronization.status, "conflict");
      assert.strictEqual(terminal.synchronization.actualRevision, "revision:current");
      assert.strictEqual(terminal.wayfinderMap, undefined);
    }
  }),
);

it.effect("preserves the cached map as read-only when GitHub is unavailable", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const receipts: OrchestrationRuntimeReceipt[] = [];
    const trackerReads = { value: 0 };
    const process = yield* makeWayfinderReconciliationProcessor.pipe(
      Effect.provide(
        dependencies({
          dispatched,
          receipts,
          trackerReads,
          reconcile: () =>
            Effect.fail(
              new GitHubCli.GitHubCliUnavailableError({
                command: "gh",
                cwd: "/project",
                cause: new Error("offline"),
              }),
            ),
        }),
      ),
    );

    yield* process(event({ reason: "poll" }));

    const terminal = dispatched.at(-1);
    assert.strictEqual(terminal?.type, "thread.wayfinder.reconciliation.update");
    if (terminal?.type === "thread.wayfinder.reconciliation.update") {
      assert.strictEqual(terminal.synchronization.status, "unavailable");
      assert.strictEqual(terminal.synchronization.canMutate, false);
      assert.strictEqual(terminal.wayfinderMap, undefined);
    }
  }),
);

it.effect("replaces the projection when external GitHub state changes", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const receipts: OrchestrationRuntimeReceipt[] = [];
    const trackerReads = { value: 0 };
    const changedMap = {
      ...map,
      revision: "revision:changed",
      tickets: [
        {
          number: 43,
          title: "Reopened decision",
          url: "https://github.com/t3tools/t3code/issues/43",
          state: "open" as const,
          classification: "grilling" as const,
          claimedBy: "alice",
          blockedBy: [],
          blocks: [],
          commentCount: 3,
        },
      ],
      frontier: [],
      lastSynchronizedAt: now,
    };
    const process = yield* makeWayfinderReconciliationProcessor.pipe(
      Effect.provide(
        dependencies({
          dispatched,
          receipts,
          trackerReads,
          reconcile: () => Effect.succeed({ kind: "loaded", map: changedMap }),
        }),
      ),
    );

    yield* process(event({ reason: "poll" }));

    const terminal = dispatched.at(-1);
    assert.strictEqual(terminal?.type, "thread.wayfinder.reconciliation.update");
    if (terminal?.type === "thread.wayfinder.reconciliation.update") {
      assert.strictEqual(terminal.synchronization.status, "healthy");
      assert.deepStrictEqual(terminal.wayfinderMap, changedMap);
    }
    assert.strictEqual(receipts.at(-1)?.type, "wayfinder.reconciliation.completed");
  }),
);
