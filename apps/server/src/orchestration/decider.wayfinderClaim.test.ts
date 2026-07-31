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
