import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  SkillRunId,
  ThreadId,
  TurnId,
  WorkstreamId,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type ResolvedSkillInvocation,
  type WayfinderMapProjection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const now = "2026-01-02T00:00:00.000Z";
const projectId = ProjectId.make("project-handoff");
const sourceThreadId = ThreadId.make("thread-wayfinder");
const targetThreadId = ThreadId.make("thread-to-spec");
const sourceSkillRunId = SkillRunId.make("skill-run:wayfinder");
const workstreamId = WorkstreamId.make("workstream:release");

const map: WayfinderMapProjection = {
  canonicalReference: {
    number: 42,
    title: "Release map",
    url: "https://github.com/t3tools/t3code/issues/42",
    state: "open",
  },
  destination: "Ship a remote-ready release.",
  notes: "",
  decisionsSoFar: [],
  fogOfWar: [],
  outOfScope: [],
  tickets: [
    {
      number: 43,
      title: "Choose hosting",
      url: "https://github.com/t3tools/t3code/issues/43",
      state: "closed",
      classification: "grilling",
      claimedBy: null,
      blockedBy: [],
      blocks: [],
    },
  ],
  frontier: [],
  lastSynchronizedAt: now,
};

const sourceInvocation: ResolvedSkillInvocation & {
  readonly workstreamId: WorkstreamId;
  readonly skillRunId: SkillRunId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly createdAt: string;
} = {
  skill: {
    name: "wayfinder",
    path: "/skills/wayfinder/SKILL.md",
    contentDigest: "sha256:257e40665b28ae959ffdcb97d7a72b074360f4a3d201bd84786505308546e434",
  },
  action: { id: "continue-map", reference: "42" },
  execution: { mode: "native", adapterId: "wayfinder", adapterVersion: 1 },
  wayfinderMap: map,
  wayfinderSynchronizedAt: now,
  wayfinderSynchronization: {
    status: "healthy",
    reason: "manual",
    lastAttemptedAt: now,
    lastSuccessfulAt: now,
    canMutate: true,
  },
  workstreamId,
  skillRunId: sourceSkillRunId,
  projectId,
  threadId: sourceThreadId,
  createdAt: now,
};

function thread(
  id: ThreadId,
  invocation: typeof sourceInvocation | null,
  state: "running" | "completed" = "completed",
): OrchestrationThread {
  return {
    id,
    projectId,
    title: id === sourceThreadId ? "Wayfinder" : "to-spec",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn:
      invocation === null
        ? null
        : {
            turnId: TurnId.make(`turn:${id}`),
            state,
            requestedAt: now,
            startedAt: now,
            completedAt: state === "completed" ? now : null,
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
  };
}

function readModel(source: typeof sourceInvocation = sourceInvocation): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [thread(sourceThreadId, source), thread(targetThreadId, null)],
    updatedAt: now,
  };
}

function handoffInvocation(acknowledgedIncomplete: boolean): ResolvedSkillInvocation {
  return {
    skill: {
      name: "to-spec",
      path: "/skills/to-spec/SKILL.md",
      contentDigest: "sha256:357e40665b28ae959ffdcb97d7a72b074360f4a3d201bd84786505308546e434",
    },
    arguments: `Create a specification from ${map.canonicalReference.url}`,
    action: {
      id: "handoff-to-spec",
      sourceSkillRunId,
      sourceThreadId,
      canonicalReference: {
        number: map.canonicalReference.number,
        url: map.canonicalReference.url,
      },
      wayfinderSynchronizedAt: now,
      acknowledgedIncomplete,
    },
    execution: { mode: "generic", reason: "user-selected-generic" },
  };
}

function command(invocation: ResolvedSkillInvocation) {
  return {
    type: "thread.turn.start" as const,
    commandId: CommandId.make("command-to-spec"),
    threadId: targetThreadId,
    message: {
      messageId: MessageId.make("message-to-spec"),
      role: "user" as const,
      text: `Create a specification from ${map.canonicalReference.url}`,
      attachments: [],
    },
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    skillInvocation: invocation,
    createdAt: now,
  };
}

it.layer(NodeServices.layer)("Wayfinder to-spec handoff invariants", (it) => {
  it.effect("creates a separate generic Skill Run in the source Workstream", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: command(handoffInvocation(false)),
        readModel: readModel(),
      });
      const events = Array.isArray(result) ? result : [result];
      const start = events.find((event) => event.type === "thread.turn-start-requested");

      expect(start?.type).toBe("thread.turn-start-requested");
      if (start?.type !== "thread.turn-start-requested") return;
      expect(start.payload.skillInvocation).toMatchObject({
        workstreamId,
        projectId,
        threadId: targetThreadId,
        action: {
          id: "handoff-to-spec",
          sourceSkillRunId,
          sourceThreadId,
          canonicalReference: {
            number: 42,
            url: map.canonicalReference.url,
          },
          wayfinderSynchronizedAt: now,
          acknowledgedIncomplete: false,
        },
        execution: { mode: "generic" },
      });
      expect(start.payload.skillInvocation?.skillRunId).not.toBe(sourceSkillRunId);
    }),
  );

  it.effect("requires warning acknowledgement while the map is incomplete", () =>
    Effect.gen(function* () {
      const incompleteSource = {
        ...sourceInvocation,
        wayfinderMap: {
          ...map,
          tickets: [{ ...map.tickets[0]!, state: "open" as const }],
        },
      };
      const error = yield* decideOrchestrationCommand({
        command: command(handoffInvocation(false)),
        readModel: readModel(incompleteSource),
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      expect(error.message).toContain("Acknowledge");
      expect(error.message).toContain("open-decision-tickets");
    }),
  );

  it.effect("permits an explicitly acknowledged early handoff", () =>
    Effect.gen(function* () {
      const incompleteSource = {
        ...sourceInvocation,
        wayfinderMap: {
          ...map,
          fogOfWar: ["Deployment ownership"],
        },
      };
      const result = yield* decideOrchestrationCommand({
        command: command(handoffInvocation(true)),
        readModel: readModel(incompleteSource),
      });
      const events = Array.isArray(result) ? result : [result];

      expect(events.some((event) => event.type === "thread.turn-start-requested")).toBe(true);
    }),
  );

  it.effect("accepts server-resolved provenance after the source run is no longer latest", () =>
    Effect.gen(function* () {
      const recoveredReadModel = readModel();
      const result = yield* decideOrchestrationCommand({
        command: command({
          ...handoffInvocation(false),
          reconnectWorkstreamId: workstreamId,
        }),
        readModel: {
          ...recoveredReadModel,
          threads: recoveredReadModel.threads.map((candidate) =>
            candidate.id === sourceThreadId ? { ...candidate, latestTurn: null } : candidate,
          ),
        },
      });
      const events = Array.isArray(result) ? result : [result];
      const start = events.find((event) => event.type === "thread.turn-start-requested");

      expect(start?.type).toBe("thread.turn-start-requested");
      if (start?.type !== "thread.turn-start-requested") return;
      expect(start.payload.skillInvocation?.workstreamId).toBe(workstreamId);
    }),
  );
});
