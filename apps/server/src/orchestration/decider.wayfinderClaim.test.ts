import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EventId,
  ProjectId,
  ProviderInstanceId,
  SkillRunId,
  ThreadId,
  TurnId,
  WorkstreamId,
  type WayfinderMapProjection,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const now = "2026-01-02T00:00:00.000Z";
const projectId = ProjectId.make("project-wayfinder-claim");
const threadId = ThreadId.make("thread-wayfinder-map");
const skillRunId = SkillRunId.make("skill-run:map");
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
  decisionsSoFar: [],
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
      blocks: [44],
    },
    {
      number: 44,
      title: "Choose deployment",
      url: "https://github.com/t3tools/t3code/issues/44",
      state: "open",
      classification: "grilling",
      claimedBy: null,
      blockedBy: [43],
      blocks: [],
    },
    {
      number: 45,
      title: "Already owned",
      url: "https://github.com/t3tools/t3code/issues/45",
      state: "open",
      classification: "task",
      claimedBy: "octocat",
      blockedBy: [],
      blocks: [],
    },
    {
      number: 46,
      title: "Resolved",
      url: "https://github.com/t3tools/t3code/issues/46",
      state: "closed",
      classification: "task",
      claimedBy: null,
      blockedBy: [],
      blocks: [],
    },
  ],
  frontier: [43],
  lastSynchronizedAt: now,
};

function eventBase(sequence: number, suffix: string) {
  const commandId = CommandId.make(`command-${suffix}`);
  return {
    sequence,
    eventId: EventId.make(`event-${suffix}`),
    occurredAt: now,
    commandId,
    causationEventId: null,
    correlationId: commandId,
    metadata: {},
  } as const;
}

function makeReadModel() {
  return Effect.gen(function* () {
    let readModel = yield* projectEvent(createEmptyReadModel(now), {
      ...eventBase(1, "project"),
      aggregateKind: "project",
      aggregateId: projectId,
      type: "project.created",
      payload: {
        projectId,
        title: "Wayfinder",
        workspaceRoot: "/tmp/wayfinder-claim",
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
      },
    });
    readModel = yield* projectEvent(readModel, {
      ...eventBase(2, "thread"),
      aggregateKind: "thread",
      aggregateId: threadId,
      type: "thread.created",
      payload: {
        threadId,
        projectId,
        title: "Release map",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    readModel = {
      ...readModel,
      threads: readModel.threads.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              latestTurn: {
                turnId: TurnId.make("turn-map"),
                state: "running" as const,
                requestedAt: now,
                startedAt: now,
                completedAt: null,
                assistantMessageId: null,
                skillInvocation: {
                  skill: {
                    name: "wayfinder",
                    path: "/skills/wayfinder/SKILL.md",
                    contentDigest:
                      "sha256:257e40665b28ae959ffdcb97d7a72b074360f4a3d201bd84786505308546e434",
                  },
                  action: { id: "continue-map" as const, reference: "42" },
                  execution: {
                    mode: "native" as const,
                    adapterId: "wayfinder",
                    adapterVersion: 1,
                  },
                  wayfinderMap: map,
                  workstreamId: WorkstreamId.make("workstream:release"),
                  skillRunId,
                  projectId,
                  threadId,
                  createdAt: now,
                },
              },
            }
          : thread,
      ),
    };
    return yield* projectEvent(readModel, {
      ...eventBase(3, "published"),
      aggregateKind: "thread",
      aggregateId: threadId,
      type: "thread.activity-appended",
      payload: {
        threadId,
        activity: {
          id: EventId.make("activity-published"),
          tone: "info",
          kind: "wayfinder.draft.published",
          summary: "Wayfinder map published",
          payload: { skillRunId },
          turnId: null,
          createdAt: now,
        },
      },
    });
  });
}

function makeLinkedReadModel() {
  return Effect.gen(function* () {
    const readModel = yield* makeReadModel();
    return {
      ...readModel,
      threads: readModel.threads.map((thread) =>
        thread.id === threadId && thread.latestTurn?.skillInvocation
          ? {
              ...thread,
              latestTurn: {
                ...thread.latestTurn,
                skillInvocation: {
                  ...thread.latestTurn.skillInvocation,
                  action: {
                    id: "work-ticket" as const,
                    ticketNumber: 43,
                    sourceSkillRunId: skillRunId,
                  },
                  wayfinderMap: {
                    ...map,
                    tickets: map.tickets.map((ticket) =>
                      ticket.number === 43 ? { ...ticket, claimedBy: "octocat" } : ticket,
                    ),
                    frontier: [],
                  },
                  skillRunId: linkedSkillRunId,
                },
              },
            }
          : thread,
      ),
    };
  });
}

it.layer(NodeServices.layer)("Wayfinder ticket claim invariants", (it) => {
  it.effect("accepts an open unblocked unclaimed frontier ticket", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        readModel: yield* makeReadModel(),
        command: {
          type: "thread.wayfinder.mutate",
          commandId: CommandId.make("claim-43"),
          threadId,
          skillRunId,
          action: { kind: "claim-ticket", ticketNumber: 43 },
          confirmed: false,
          createdAt: now,
        },
      });
      const requested = Array.isArray(result) ? result[0] : result;
      expect(requested).toMatchObject({
        type: "thread.wayfinder-mutation-requested",
        payload: { action: { kind: "claim-ticket", ticketNumber: 43 } },
      });
    }),
  );

  it.effect("accepts an exact retry after the canonical claim outlived thread startup", () =>
    Effect.gen(function* () {
      const initial = yield* makeReadModel();
      const readModel = {
        ...initial,
        threads: initial.threads.map((thread) =>
          thread.id === threadId && thread.latestTurn?.skillInvocation
            ? {
                ...thread,
                latestTurn: {
                  ...thread.latestTurn,
                  skillInvocation: {
                    ...thread.latestTurn.skillInvocation,
                    wayfinderMap: {
                      ...map,
                      tickets: map.tickets.map((ticket) =>
                        ticket.number === 43 ? { ...ticket, claimedBy: "octocat" } : ticket,
                      ),
                      frontier: [],
                    },
                    wayfinderMutation: {
                      actionId: "claim-43",
                      action: { kind: "claim-ticket" as const, ticketNumber: 43 },
                      status: "failed" as const,
                      error: "The linked thread is incomplete.",
                      updatedAt: now,
                    },
                  },
                },
              }
            : thread,
        ),
      };
      const result = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.wayfinder.mutate",
          commandId: CommandId.make("retry-claim-43"),
          threadId,
          skillRunId,
          action: { kind: "claim-ticket", ticketNumber: 43 },
          confirmed: false,
          createdAt: now,
        },
      });

      const requested = Array.isArray(result) ? result[0] : result;
      expect(requested).toMatchObject({
        type: "thread.wayfinder-mutation-requested",
        payload: { action: { kind: "claim-ticket", ticketNumber: 43 } },
      });
    }),
  );

  for (const [ticketNumber, reason] of [
    [44, "blocked"],
    [45, "claimed"],
    [46, "open"],
  ] as const) {
    it.effect(`rejects ticket #${ticketNumber} because it is not runnable`, () =>
      Effect.gen(function* () {
        const failure = yield* Effect.flip(
          decideOrchestrationCommand({
            readModel: yield* makeReadModel(),
            command: {
              type: "thread.wayfinder.mutate",
              commandId: CommandId.make(`claim-${ticketNumber}`),
              threadId,
              skillRunId,
              action: { kind: "claim-ticket", ticketNumber },
              confirmed: false,
              createdAt: now,
            },
          }),
        );
        expect(failure).toMatchObject({ _tag: "OrchestrationCommandInvariantError" });
        if ("detail" in failure) {
          expect(failure.detail.toLowerCase()).toContain(reason);
        }
      }),
    );
  }
});

it.layer(NodeServices.layer)("Wayfinder research control invariants", (it) => {
  it.effect("accepts pause and resume on the canonical map run", () =>
    Effect.gen(function* () {
      for (const kind of ["pause-automatic-launches", "resume-automatic-launches"] as const) {
        const result = yield* decideOrchestrationCommand({
          readModel: yield* makeReadModel(),
          command: {
            type: "thread.wayfinder.research",
            commandId: CommandId.make(`research:${kind}`),
            threadId,
            skillRunId,
            action: { kind },
            createdAt: now,
          },
        });
        const requested = Array.isArray(result) ? result[0] : result;
        expect(requested).toMatchObject({
          type: "thread.wayfinder-research-requested",
          payload: { skillRunId, action: { kind } },
        });
      }
    }),
  );

  it.effect("accepts manual launch only for an eligible research frontier ticket", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        readModel: yield* makeReadModel(),
        command: {
          type: "thread.wayfinder.research",
          commandId: CommandId.make("research:start:43"),
          threadId,
          skillRunId,
          action: { kind: "start-ticket", ticketNumber: 43 },
          createdAt: now,
        },
      });
      const requested = Array.isArray(result) ? result[0] : result;
      expect(requested).toMatchObject({
        type: "thread.wayfinder-research-requested",
        payload: { action: { kind: "start-ticket", ticketNumber: 43 } },
      });
    }),
  );

  for (const [ticketNumber, reason] of [
    [44, "research"],
    [45, "research"],
    [46, "open"],
  ] as const) {
    it.effect(`rejects research launch for ticket #${ticketNumber}`, () =>
      Effect.gen(function* () {
        const failure = yield* Effect.flip(
          decideOrchestrationCommand({
            readModel: yield* makeReadModel(),
            command: {
              type: "thread.wayfinder.research",
              commandId: CommandId.make(`research:start:${ticketNumber}`),
              threadId,
              skillRunId,
              action: { kind: "start-ticket", ticketNumber },
              createdAt: now,
            },
          }),
        );
        expect(failure).toMatchObject({ _tag: "OrchestrationCommandInvariantError" });
        if ("detail" in failure) expect(failure.detail.toLowerCase()).toContain(reason);
      }),
    );
  }

  it.effect("rebuilds durable research queue and failure state from events", () =>
    Effect.gen(function* () {
      const research = {
        automaticLaunchesPaused: true,
        concurrencyLimit: 2,
        tickets: [
          {
            ticketNumber: 43,
            launchMode: "automatic" as const,
            status: "failed" as const,
            output: "Primary documentation was unavailable.",
            error: "Research finished without a resolved receipt.",
            updatedAt: now,
          },
        ],
        updatedAt: now,
      };
      const projected = yield* projectEvent(yield* makeReadModel(), {
        ...eventBase(4, "research-updated"),
        aggregateKind: "thread",
        aggregateId: threadId,
        type: "thread.wayfinder-research-updated",
        payload: {
          threadId,
          skillRunId,
          research,
        },
      });

      expect(projected.threads[0]?.latestTurn?.skillInvocation?.wayfinderResearch).toEqual(
        research,
      );
    }),
  );
});

it.layer(NodeServices.layer)("Wayfinder HITL resolution invariants", (it) => {
  const action = {
    kind: "complete-hitl-ticket" as const,
    ticketNumber: 43,
    outcome: "resolved" as const,
    resolution: "Use the environment-owned synchronization path.",
    contextPointer: "https://github.com/t3tools/t3code/issues/43#issuecomment-1",
    graduatedFog: [],
  };

  it.effect("accepts the assigned claimed ticket from its linked work-ticket run", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        readModel: yield* makeLinkedReadModel(),
        command: {
          type: "thread.wayfinder.mutate",
          commandId: CommandId.make("resolve-43"),
          threadId,
          skillRunId: linkedSkillRunId,
          action,
          confirmed: false,
          createdAt: now,
        },
      });

      const requested = Array.isArray(result) ? result[0] : result;
      expect(requested).toMatchObject({
        type: "thread.wayfinder-mutation-requested",
        payload: { skillRunId: linkedSkillRunId, action },
      });
    }),
  );

  it.effect("rejects completing a ticket other than the linked assignment", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        decideOrchestrationCommand({
          readModel: yield* makeLinkedReadModel(),
          command: {
            type: "thread.wayfinder.mutate",
            commandId: CommandId.make("resolve-44"),
            threadId,
            skillRunId: linkedSkillRunId,
            action: { ...action, ticketNumber: 44 },
            confirmed: false,
            createdAt: now,
          },
        }),
      );

      expect(failure).toMatchObject({ _tag: "OrchestrationCommandInvariantError" });
      if ("detail" in failure) expect(failure.detail).toContain("assigned ticket #43");
    }),
  );

  it.effect("rejects HITL completion from the shared map run", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        decideOrchestrationCommand({
          readModel: yield* makeReadModel(),
          command: {
            type: "thread.wayfinder.mutate",
            commandId: CommandId.make("resolve-map-43"),
            threadId,
            skillRunId,
            action,
            confirmed: false,
            createdAt: now,
          },
        }),
      );

      expect(failure).toMatchObject({ _tag: "OrchestrationCommandInvariantError" });
      if ("detail" in failure) expect(failure.detail).toContain("linked ticket thread");
    }),
  );

  it.effect("rejects unrelated map administration from the linked ticket run", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        decideOrchestrationCommand({
          readModel: yield* makeLinkedReadModel(),
          command: {
            type: "thread.wayfinder.mutate",
            commandId: CommandId.make("rename-44-from-ticket-43"),
            threadId,
            skillRunId: linkedSkillRunId,
            action: { kind: "rename-ticket", ticketNumber: 44, title: "Unrelated change" },
            confirmed: false,
            createdAt: now,
          },
        }),
      );

      expect(failure).toMatchObject({ _tag: "OrchestrationCommandInvariantError" });
      if ("detail" in failure) expect(failure.detail).toContain("only its assigned ticket");
    }),
  );

  it.effect("rejects duplicate graduated fog ticket keys", () =>
    Effect.gen(function* () {
      const graduated = {
        key: "relay-policy",
        fog: "Relay ownership",
        title: "Choose relay ownership",
        classification: "grilling" as const,
        blockedBy: [],
      };
      const failure = yield* Effect.flip(
        decideOrchestrationCommand({
          readModel: yield* makeLinkedReadModel(),
          command: {
            type: "thread.wayfinder.mutate",
            commandId: CommandId.make("duplicate-graduated-key"),
            threadId,
            skillRunId: linkedSkillRunId,
            action: { ...action, graduatedFog: [graduated, graduated] },
            confirmed: false,
            createdAt: now,
          },
        }),
      );

      expect(failure).toMatchObject({ _tag: "OrchestrationCommandInvariantError" });
      if ("detail" in failure) expect(failure.detail).toContain("unique key");
    }),
  );

  it.effect("rejects graduation of fog outside the synchronized map", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        decideOrchestrationCommand({
          readModel: yield* makeLinkedReadModel(),
          command: {
            type: "thread.wayfinder.mutate",
            commandId: CommandId.make("unknown-graduated-fog"),
            threadId,
            skillRunId: linkedSkillRunId,
            action: {
              ...action,
              graduatedFog: [
                {
                  key: "unknown-policy",
                  fog: "A made-up uncertainty",
                  title: "Choose unknown policy",
                  classification: "grilling",
                  blockedBy: [],
                },
              ],
            },
            confirmed: false,
            createdAt: now,
          },
        }),
      );

      expect(failure).toMatchObject({ _tag: "OrchestrationCommandInvariantError" });
      if ("detail" in failure) expect(failure.detail).toContain("canonical map");
    }),
  );
});
