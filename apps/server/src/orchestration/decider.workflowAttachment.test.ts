import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type ResolvedSkillInvocation,
  type WayfinderMapProjection,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { projectEvent } from "./projector.ts";

const now = "2026-08-03T12:00:00.000Z";
const projectId = ProjectId.make("project-workflow");
const originThreadId = ThreadId.make("thread-wayfinder");

const map: WayfinderMapProjection = {
  canonicalReference: {
    number: 29,
    title: "Development Workflow",
    url: "https://github.com/naveed949/t3code/issues/29",
    state: "open",
  },
  destination: "Ship the Development Workflow safely.",
  notes: "",
  decisionsSoFar: [],
  fogOfWar: [],
  outOfScope: [],
  tickets: [],
  frontier: [],
  lastSynchronizedAt: now,
};

const nativeWayfinderInvocation: ResolvedSkillInvocation = {
  skill: {
    name: "wayfinder",
    path: "/skills/wayfinder/SKILL.md",
    contentDigest: "sha256:257e40665b28ae959ffdcb97d7a72b074360f4a3d201bd84786505308546e434",
  },
  action: { id: "continue-map", reference: "#29" },
  execution: { mode: "native", adapterId: "wayfinder", adapterVersion: 1 },
  wayfinderMap: map,
  wayfinderSynchronizedAt: now,
  wayfinderSynchronization: {
    status: "healthy",
    reason: "resume",
    lastAttemptedAt: now,
    lastSuccessfulAt: now,
    canMutate: true,
  },
};

type PlannedEvent = Omit<OrchestrationEvent, "sequence">;
type PlannedWorkflowHintEvent = Omit<
  Extract<OrchestrationEvent, { readonly type: "thread.workflow-attachment-hinted" }>,
  "sequence"
>;

function isWorkflowHintEvent(event: PlannedEvent): event is PlannedWorkflowHintEvent {
  return event.type === "thread.workflow-attachment-hinted";
}

function errorDetail(error: unknown): string {
  return typeof error === "object" && error !== null && "detail" in error
    ? String(error.detail)
    : String(error);
}

function thread(id: ThreadId): OrchestrationThread {
  return {
    id,
    projectId,
    title: "Wayfinder origin",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
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
}

function readModel(
  threads: ReadonlyArray<OrchestrationThread> = [thread(originThreadId)],
): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads,
    updatedAt: now,
  };
}

function applyEvents(model: OrchestrationReadModel, events: ReturnType<typeof normalizeEvents>) {
  return Effect.gen(function* () {
    let current = model;
    for (const event of events) {
      current = yield* projectEvent(current, {
        ...event,
        sequence: current.snapshotSequence + 1,
      } as OrchestrationEvent);
    }
    return current;
  });
}

function normalizeEvents(
  result: PlannedEvent | ReadonlyArray<PlannedEvent>,
): ReadonlyArray<PlannedEvent> {
  return (Array.isArray(result) ? result : [result]) as ReadonlyArray<PlannedEvent>;
}

function startCommand(input: {
  readonly commandId: string;
  readonly skillInvocation?: ResolvedSkillInvocation;
}) {
  return {
    type: "thread.turn.start" as const,
    commandId: CommandId.make(input.commandId),
    threadId: originThreadId,
    message: {
      messageId: MessageId.make(`message:${input.commandId}`),
      role: "user" as const,
      text: input.skillInvocation ? "$wayfinder continue-map #29" : "Tell me about Wayfinder.",
      attachments: [],
    },
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    ...(input.skillInvocation ? { skillInvocation: input.skillInvocation } : {}),
    createdAt: now,
  };
}

it.layer(NodeServices.layer)("Workflow attachment commands", (it) => {
  it.effect(
    "offers exactly one hint for a structured native Wayfinder invocation and never for prose",
    () =>
      Effect.gen(function* () {
        const nativeResult = yield* decideOrchestrationCommand({
          readModel: readModel(),
          command: startCommand({
            commandId: "command-native-wayfinder",
            skillInvocation: nativeWayfinderInvocation,
          }),
        });
        const nativeEvents = normalizeEvents(nativeResult);
        const hint = nativeEvents.find(isWorkflowHintEvent);

        expect(hint?.type).toBe("thread.workflow-attachment-hinted");
        if (hint?.type !== "thread.workflow-attachment-hinted") return;
        expect(hint.payload.hint).toMatchObject({
          status: "available",
          workstreamId: expect.stringMatching(/^workstream:/),
          backfilledWayfinderData: {
            wayfinderMap: map,
            wayfinderSynchronizedAt: now,
          },
        });

        const afterHint = yield* applyEvents(readModel(), nativeEvents);
        const secondNativeResult = yield* decideOrchestrationCommand({
          readModel: afterHint,
          command: startCommand({
            commandId: "command-native-wayfinder-again",
            skillInvocation: nativeWayfinderInvocation,
          }),
        });
        expect(
          normalizeEvents(secondNativeResult).some(
            (event) => event.type === "thread.workflow-attachment-hinted",
          ),
        ).toBe(false);

        const proseResult = yield* decideOrchestrationCommand({
          readModel: readModel([thread(ThreadId.make("thread-prose"))]),
          command: {
            ...startCommand({ commandId: "command-prose" }),
            threadId: ThreadId.make("thread-prose"),
          },
        });
        expect(
          normalizeEvents(proseResult).some(
            (event) => event.type === "thread.workflow-attachment-hinted",
          ),
        ).toBe(false);

        const genericWayfinderResult = yield* decideOrchestrationCommand({
          readModel: readModel([thread(ThreadId.make("thread-generic-wayfinder"))]),
          command: {
            ...startCommand({
              commandId: "command-generic-wayfinder",
              skillInvocation: {
                ...nativeWayfinderInvocation,
                execution: { mode: "generic", reason: "user-selected-generic" },
              },
            }),
            threadId: ThreadId.make("thread-generic-wayfinder"),
          },
        });
        expect(
          normalizeEvents(genericWayfinderResult).some(
            (event) => event.type === "thread.workflow-attachment-hinted",
          ),
        ).toBe(false);
      }),
  );

  it.effect(
    "requires an explicit origin-thread confirmation and goal, then records a durable backfill cursor",
    () =>
      Effect.gen(function* () {
        const started = yield* decideOrchestrationCommand({
          readModel: readModel(),
          command: startCommand({
            commandId: "command-wayfinder-for-attachment",
            skillInvocation: nativeWayfinderInvocation,
          }),
        });
        const afterHint = yield* applyEvents(readModel(), normalizeEvents(started));

        const wrongOrigin = yield* decideOrchestrationCommand({
          readModel: afterHint,
          command: {
            type: "thread.workflow.attach" as const,
            commandId: CommandId.make("command-wrong-origin"),
            threadId: originThreadId,
            originThreadId: ThreadId.make("thread-not-the-origin"),
            workflowGoal: "Ship the workflow",
            confirmed: true,
            createdAt: now,
          },
        }).pipe(Effect.flip);
        expect(errorDetail(wrongOrigin)).toContain("origin thread");

        const attached = yield* decideOrchestrationCommand({
          readModel: afterHint,
          command: {
            type: "thread.workflow.attach" as const,
            commandId: CommandId.make("command-attach-workflow"),
            threadId: originThreadId,
            originThreadId,
            workflowGoal: "Ship the workflow",
            confirmed: true,
            createdAt: now,
          },
        });
        expect(attached).toMatchObject({
          type: "thread.workflow-attached",
          payload: {
            threadId: originThreadId,
            attachment: {
              originThreadId,
              workflowGoal: "Ship the workflow",
              backfilledWayfinderData: { wayfinderMap: map },
              observationCursor: {
                sourceSkillRunId: expect.stringMatching(/^skill-run:/),
                observedAt: now,
                wayfinderSynchronizedAt: now,
              },
            },
          },
        });

        const afterAttachment = yield* applyEvents(afterHint, normalizeEvents(attached));
        const attachment = afterAttachment.threads[0]?.workflowAttachment;
        expect(attachment?.originThreadId).toBe(originThreadId);
        expect(attachment?.backfilledWayfinderData.wayfinderMap).toEqual(map);

        const duplicate = yield* decideOrchestrationCommand({
          readModel: afterAttachment,
          command: {
            type: "thread.workflow.attach" as const,
            commandId: CommandId.make("command-attach-workflow-again"),
            threadId: originThreadId,
            originThreadId,
            workflowGoal: "Duplicate",
            confirmed: true,
            createdAt: now,
          },
        }).pipe(Effect.flip);
        expect(errorDetail(duplicate)).toContain("already attached");
      }),
  );

  it.effect("keeps a dismissed hint durable and rejects attachment without a structured hint", () =>
    Effect.gen(function* () {
      const started = yield* decideOrchestrationCommand({
        readModel: readModel(),
        command: startCommand({
          commandId: "command-wayfinder-for-dismissal",
          skillInvocation: nativeWayfinderInvocation,
        }),
      });
      const afterHint = yield* applyEvents(readModel(), normalizeEvents(started));
      const dismissed = yield* decideOrchestrationCommand({
        readModel: afterHint,
        command: {
          type: "thread.workflow-attachment.hint.dismiss" as const,
          commandId: CommandId.make("command-dismiss-workflow-hint"),
          threadId: originThreadId,
          createdAt: now,
        },
      });
      const afterDismissal = yield* applyEvents(afterHint, normalizeEvents(dismissed));
      expect(afterDismissal.threads[0]?.workflowAttachmentHint?.status).toBe("dismissed");

      const blocked = yield* decideOrchestrationCommand({
        readModel: afterDismissal,
        command: {
          type: "thread.workflow.attach" as const,
          commandId: CommandId.make("command-dismissed-workflow-attach"),
          threadId: originThreadId,
          originThreadId,
          workflowGoal: "Should not attach",
          confirmed: true,
          createdAt: now,
        },
      }).pipe(Effect.flip);
      expect(errorDetail(blocked)).toContain("available structured Wayfinder hint");

      const proseThreadId = ThreadId.make("thread-prose");
      const noHint = yield* decideOrchestrationCommand({
        readModel: readModel([thread(proseThreadId)]),
        command: {
          type: "thread.workflow.attach" as const,
          commandId: CommandId.make("command-prose-attach"),
          threadId: proseThreadId,
          originThreadId: proseThreadId,
          workflowGoal: "Cannot infer from prose",
          confirmed: true,
          createdAt: now,
        },
      }).pipe(Effect.flip);
      expect(errorDetail(noHint)).toContain("available structured Wayfinder hint");
    }),
  );
});
