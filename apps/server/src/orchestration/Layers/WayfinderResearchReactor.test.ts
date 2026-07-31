import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  SkillRunId,
  ThreadId,
  TurnId,
  WorkstreamId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  type SkillInvocation,
  type WayfinderMapProjection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { BackgroundPolicy } from "../../background/BackgroundPolicy.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  RuntimeReceiptBus,
  type OrchestrationRuntimeReceipt,
} from "../Services/RuntimeReceiptBus.ts";
import { makeWayfinderResearchProcessor } from "./WayfinderResearchReactor.ts";

const now = "2026-07-31T10:00:00.000Z";
const sourceThreadId = ThreadId.make("thread:research-map");
const linkedThreadId = ThreadId.make("wayfinder-ticket:workstream:research:43");
const sourceSkillRunId = SkillRunId.make("skill-run:research-map");
const linkedSkillRunId = SkillRunId.make("skill-run:research-43");
const projectId = ProjectId.make("project:research");
const workstreamId = WorkstreamId.make("workstream:research");

const map: WayfinderMapProjection = {
  canonicalReference: {
    number: 42,
    title: "Research map",
    url: "https://github.com/t3tools/t3code/issues/42",
    state: "open",
  },
  destination: "Resolve factual blockers.",
  notes: "",
  decisionsSoFar: [],
  fogOfWar: [],
  outOfScope: [],
  tickets: [
    {
      number: 43,
      title: "Research API support",
      url: "https://github.com/t3tools/t3code/issues/43",
      state: "open",
      classification: "research",
      claimedBy: null,
      blockedBy: [],
      blocks: [],
    },
    {
      number: 44,
      title: "Prototype the UI",
      url: "https://github.com/t3tools/t3code/issues/44",
      state: "open",
      classification: "prototype",
      claimedBy: null,
      blockedBy: [],
      blocks: [],
    },
  ],
  frontier: [43, 44],
  lastSynchronizedAt: now,
};

const sourceInvocation: SkillInvocation = {
  skill: {
    name: "wayfinder",
    path: "/skills/wayfinder/SKILL.md",
    contentDigest: "sha256:257e40665b28ae959ffdcb97d7a72b074360f4a3d201bd84786505308546e434",
  },
  action: { id: "continue-map", reference: "42" },
  execution: { mode: "native", adapterId: "wayfinder", adapterVersion: 1 },
  workstreamId,
  skillRunId: sourceSkillRunId,
  projectId,
  threadId: sourceThreadId,
  createdAt: now,
  wayfinderMap: map,
  wayfinderSynchronization: {
    status: "healthy",
    reason: "open",
    lastAttemptedAt: now,
    lastSuccessfulAt: now,
    canMutate: true,
  },
};

function sourceWithResearch(status: "active" | "failed" | "cancelled"): SkillInvocation {
  return {
    ...sourceInvocation,
    wayfinderResearch: {
      automaticLaunchesPaused: false,
      concurrencyLimit: 2,
      tickets: [
        {
          ticketNumber: 43,
          launchMode: "automatic",
          status,
          threadId: linkedThreadId,
          updatedAt: now,
        },
      ],
      updatedAt: now,
    },
    wayfinderMap: {
      ...map,
      tickets: [{ ...map.tickets[0]!, claimedBy: "alice" }, map.tickets[1]!],
      frontier: [],
    },
  };
}

function linkedInvocationFor(source: SkillInvocation): SkillInvocation {
  return {
    ...source,
    skillRunId: linkedSkillRunId,
    threadId: linkedThreadId,
    action: {
      id: "work-ticket",
      ticketNumber: 43,
      sourceSkillRunId,
      sourceThreadId,
    },
  };
}

function thread(
  id: ThreadId,
  invocation: SkillInvocation,
  input: {
    readonly state?: "running" | "completed";
    readonly output?: string;
  } = {},
) {
  const assistantMessageId = MessageId.make(`assistant:${id}`);
  return {
    id,
    projectId,
    title: "Research",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    branch: null,
    worktreePath: null,
    latestTurn: {
      turnId: TurnId.make(`turn:${id}`),
      state: input.state ?? ("completed" as const),
      requestedAt: now,
      startedAt: now,
      completedAt: now,
      assistantMessageId,
      skillInvocation: invocation,
    },
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    messages:
      input.output === undefined
        ? []
        : [
            {
              id: assistantMessageId,
              role: "assistant" as const,
              text: input.output,
              turnId: TurnId.make(`turn:${id}`),
              streaming: false,
              createdAt: now,
              updatedAt: now,
            },
          ],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
  };
}

function dependencies(input: {
  readonly snapshot: OrchestrationReadModel;
  readonly source: SkillInvocation;
  readonly linked?: SkillInvocation;
  readonly dispatched: OrchestrationCommand[];
  readonly receipts: OrchestrationRuntimeReceipt[];
  readonly backgroundAllowed?: boolean;
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
      getSnapshot: () => Effect.succeed(input.snapshot),
      getSkillRunsByThreadId: (threadId) =>
        Effect.succeed(
          threadId === sourceThreadId ? [input.source] : input.linked ? [input.linked] : [],
        ),
    }),
    Layer.mock(BackgroundPolicy)({
      shouldRunScopeWork: () => Effect.succeed(input.backgroundAllowed ?? true),
    }),
    Layer.succeed(
      RuntimeReceiptBus,
      RuntimeReceiptBus.of({
        publish: (receipt) => Effect.sync(() => input.receipts.push(receipt)),
        streamEventsForTest: Stream.empty,
      }),
    ),
  );
}

function eventBase(type: string) {
  const commandId = CommandId.make(`command:${type}`);
  return {
    sequence: 1,
    eventId: EventId.make(`event:${type}`),
    aggregateKind: "thread" as const,
    aggregateId: sourceThreadId,
    occurredAt: now,
    commandId,
    causationEventId: null,
    correlationId: commandId,
    metadata: {},
  };
}

it.effect("automatically schedules only eligible research when background work is allowed", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const receipts: OrchestrationRuntimeReceipt[] = [];
    const process = yield* makeWayfinderResearchProcessor.pipe(
      Effect.provide(
        dependencies({
          snapshot: {
            snapshotSequence: 0,
            projects: [],
            threads: [thread(sourceThreadId, sourceInvocation)],
            updatedAt: now,
          },
          source: sourceInvocation,
          dispatched,
          receipts,
        }),
      ),
    );

    yield* process({
      ...eventBase("reconciled"),
      type: "thread.wayfinder-reconciliation-updated",
      payload: {
        threadId: sourceThreadId,
        skillRunId: sourceSkillRunId,
        synchronization: {
          status: "healthy",
          reason: "open",
          lastAttemptedAt: now,
          lastSuccessfulAt: now,
          canMutate: true,
        },
      },
    });

    assert.deepStrictEqual(
      dispatched.map((command) =>
        command.type === "thread.wayfinder.research"
          ? [command.type, command.action, command.launchMode]
          : [command.type],
      ),
      [["thread.wayfinder.research", { kind: "start-ticket", ticketNumber: 43 }, "automatic"]],
    );
  }),
);

it.effect("records queue and claim receipts before starting a manual research ticket", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const receipts: OrchestrationRuntimeReceipt[] = [];
    const process = yield* makeWayfinderResearchProcessor.pipe(
      Effect.provide(
        dependencies({
          snapshot: {
            snapshotSequence: 0,
            projects: [],
            threads: [thread(sourceThreadId, sourceInvocation)],
            updatedAt: now,
          },
          source: sourceInvocation,
          dispatched,
          receipts,
        }),
      ),
    );

    yield* process({
      ...eventBase("research-start"),
      type: "thread.wayfinder-research-requested",
      payload: {
        threadId: sourceThreadId,
        skillRunId: sourceSkillRunId,
        action: { kind: "start-ticket", ticketNumber: 43 },
        launchMode: "manual",
        createdAt: now,
      },
    });

    assert.deepStrictEqual(
      dispatched.map((command) =>
        command.type === "thread.wayfinder.research.update"
          ? [command.type, command.research.tickets[0]?.status]
          : command.type === "thread.wayfinder.mutate"
            ? [command.type, command.action]
            : [command.type],
      ),
      [
        ["thread.wayfinder.research.update", "queued"],
        ["thread.wayfinder.research.update", "claiming"],
        ["thread.wayfinder.mutate", { kind: "claim-ticket", ticketNumber: 43 }],
      ],
    );
    assert.deepStrictEqual(
      receipts.map((receipt) =>
        receipt.type === "wayfinder.research.progress" ? receipt.status : receipt.type,
      ),
      ["queued", "claiming"],
    );
  }),
);

it.effect("cancels the provider turn and releases the canonical claim without resolving it", () =>
  Effect.gen(function* () {
    const source = sourceWithResearch("active");
    const linkedInvocation = linkedInvocationFor(source);
    const linked = thread(linkedThreadId, linkedInvocation, { state: "running" });
    const dispatched: OrchestrationCommand[] = [];
    const receipts: OrchestrationRuntimeReceipt[] = [];
    const process = yield* makeWayfinderResearchProcessor.pipe(
      Effect.provide(
        dependencies({
          snapshot: {
            snapshotSequence: 0,
            projects: [],
            threads: [thread(sourceThreadId, source), linked],
            updatedAt: now,
          },
          source,
          linked: linkedInvocation,
          dispatched,
          receipts,
        }),
      ),
    );

    yield* process({
      ...eventBase("research-cancel"),
      type: "thread.wayfinder-research-requested",
      payload: {
        threadId: sourceThreadId,
        skillRunId: sourceSkillRunId,
        action: { kind: "cancel-ticket", ticketNumber: 43 },
        launchMode: "manual",
        createdAt: now,
      },
    });

    assert.deepStrictEqual(
      dispatched.map((command) =>
        command.type === "thread.wayfinder.research.update"
          ? [command.type, command.research.tickets[0]?.status]
          : command.type === "thread.turn.interrupt"
            ? [command.type, command.threadId]
            : command.type === "thread.wayfinder.mutate"
              ? [command.type, command.action.kind]
              : [command.type],
      ),
      [
        ["thread.wayfinder.research.update", "cancelling"],
        ["thread.turn.interrupt", linkedThreadId],
        ["thread.wayfinder.mutate", "release-ticket"],
      ],
    );
    assert.strictEqual(
      dispatched.some(
        (command) =>
          command.type === "thread.wayfinder.mutate" &&
          command.action.kind === "complete-hitl-ticket",
      ),
      false,
    );
  }),
);

it.effect("retries a failed claimed research ticket in its existing linked thread", () =>
  Effect.gen(function* () {
    const source = sourceWithResearch("failed");
    const linkedInvocation = linkedInvocationFor(source);
    const dispatched: OrchestrationCommand[] = [];
    const receipts: OrchestrationRuntimeReceipt[] = [];
    const process = yield* makeWayfinderResearchProcessor.pipe(
      Effect.provide(
        dependencies({
          snapshot: {
            snapshotSequence: 0,
            projects: [],
            threads: [
              thread(sourceThreadId, source),
              thread(linkedThreadId, linkedInvocation, { state: "completed" }),
            ],
            updatedAt: now,
          },
          source,
          linked: linkedInvocation,
          dispatched,
          receipts,
        }),
      ),
    );

    yield* process({
      ...eventBase("research-retry"),
      type: "thread.wayfinder-research-requested",
      payload: {
        threadId: sourceThreadId,
        skillRunId: sourceSkillRunId,
        action: { kind: "retry-ticket", ticketNumber: 43 },
        launchMode: "manual",
        createdAt: now,
      },
    });

    assert.deepStrictEqual(
      dispatched.map((command) =>
        command.type === "thread.wayfinder.research.update"
          ? [command.type, command.research.tickets[0]?.status]
          : command.type === "thread.turn.start"
            ? [command.type, command.threadId]
            : [command.type],
      ),
      [
        ["thread.wayfinder.research.update", "queued"],
        ["thread.turn.start", linkedThreadId],
        ["thread.wayfinder.research.update", "active"],
      ],
    );
  }),
);

it.effect("requires a checkpoint-backed structured result before canonical resolution", () =>
  Effect.gen(function* () {
    const activeSource = sourceWithResearch("active");
    const linkedInvocation = linkedInvocationFor(activeSource);
    const output =
      'Evidence.\n<wayfinder-research-result>{"status":"resolved","summary":"Conditional requests are supported."}</wayfinder-research-result>';
    const linked = thread(linkedThreadId, linkedInvocation, { output });
    const dispatched: OrchestrationCommand[] = [];
    const receipts: OrchestrationRuntimeReceipt[] = [];
    const process = yield* makeWayfinderResearchProcessor.pipe(
      Effect.provide(
        dependencies({
          snapshot: {
            snapshotSequence: 0,
            projects: [],
            threads: [thread(sourceThreadId, activeSource), linked],
            updatedAt: now,
          },
          source: activeSource,
          linked: linkedInvocation,
          dispatched,
          receipts,
        }),
      ),
    );

    yield* process({
      ...eventBase("research-complete"),
      aggregateId: linkedThreadId,
      type: "thread.turn-diff-completed",
      payload: {
        threadId: linkedThreadId,
        turnId: linked.latestTurn.turnId,
        completedAt: now,
        checkpointRef: "refs/t3/checkpoints/research" as never,
        status: "ready",
        files: [],
        assistantMessageId: linked.latestTurn.assistantMessageId!,
        checkpointTurnCount: 1,
      },
    });

    assert.deepStrictEqual(
      dispatched.map((command) =>
        command.type === "thread.wayfinder.research.update"
          ? [command.type, command.research.tickets[0]?.status]
          : command.type === "thread.wayfinder.mutate"
            ? [
                command.type,
                command.action.kind,
                "ticketNumber" in command.action ? command.action.ticketNumber : null,
              ]
            : [command.type],
      ),
      [
        ["thread.wayfinder.research.update", "resolving"],
        ["thread.wayfinder.mutate", "complete-hitl-ticket", 43],
      ],
    );

    dispatched.length = 0;
    linked.messages[0]!.text = "The provider returned prose without a structured result.";
    yield* process({
      ...eventBase("research-incomplete"),
      aggregateId: linkedThreadId,
      type: "thread.turn-diff-completed",
      payload: {
        threadId: linkedThreadId,
        turnId: linked.latestTurn.turnId,
        completedAt: now,
        checkpointRef: "refs/t3/checkpoints/research-incomplete" as never,
        status: "ready",
        files: [],
        assistantMessageId: linked.latestTurn.assistantMessageId!,
        checkpointTurnCount: 2,
      },
    });
    assert.deepStrictEqual(
      dispatched.map((command) =>
        command.type === "thread.wayfinder.research.update"
          ? [command.type, command.research.tickets[0]?.status]
          : [command.type],
      ),
      [["thread.wayfinder.research.update", "failed"]],
    );
  }),
);
