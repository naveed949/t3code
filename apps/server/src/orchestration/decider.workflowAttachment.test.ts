import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  SkillRunId,
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
type PlannedWorkflowSynchronizedEvent = Omit<
  Extract<OrchestrationEvent, { readonly type: "thread.workflow-synchronized" }>,
  "sequence"
>;
type PlannedTurnStartRequestedEvent = Omit<
  Extract<OrchestrationEvent, { readonly type: "thread.turn-start-requested" }>,
  "sequence"
>;

function isWorkflowHintEvent(event: PlannedEvent): event is PlannedWorkflowHintEvent {
  return event.type === "thread.workflow-attachment-hinted";
}

function isWorkflowSynchronizedEvent(
  event: PlannedEvent,
): event is PlannedWorkflowSynchronizedEvent {
  return event.type === "thread.workflow-synchronized";
}

function isTurnStartRequestedEvent(event: PlannedEvent): event is PlannedTurnStartRequestedEvent {
  return event.type === "thread.turn-start-requested";
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
  readonly createdAt?: string;
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
    createdAt: input.createdAt ?? now,
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

  it.effect(
    "synchronizes compatible native Wayfinder runs, deduplicates replay, and gates stale downstream work",
    () =>
      Effect.gen(function* () {
        const started = yield* decideOrchestrationCommand({
          readModel: readModel(),
          command: startCommand({
            commandId: "command-wayfinder-for-synchronization",
            skillInvocation: nativeWayfinderInvocation,
          }),
        });
        const afterHint = yield* applyEvents(readModel(), normalizeEvents(started));
        const attached = yield* decideOrchestrationCommand({
          readModel: afterHint,
          command: {
            type: "thread.workflow.attach" as const,
            commandId: CommandId.make("command-attach-synchronized-workflow"),
            threadId: originThreadId,
            originThreadId,
            workflowGoal: "Ship the workflow safely",
            confirmed: true,
            createdAt: now,
          },
        });
        const afterAttachment = yield* applyEvents(afterHint, normalizeEvents(attached));
        const attachment = afterAttachment.threads[0]?.workflowAttachment;
        expect(attachment?.workflowGraph?.artifacts).toHaveLength(1);
        if (attachment === undefined) return;
        expect(attachment.workflowGraph?.artifacts[0]?.lineage).toMatchObject({
          workstreamId: attachment.workstreamId,
          sourceSkillRunId: attachment.sourceSkillRunId,
          sourceStage: "attachment",
          upstreamVersion: expect.stringMatching(/^content:sha256:[a-f0-9]{64}$/),
        });
        const sourceSkillRunId = attachment.sourceSkillRunId;

        const synchronizedAt = "2026-08-03T12:05:00.000Z";
        const updatedMap: WayfinderMapProjection = {
          ...map,
          revision: "issue-29:2",
          destination: "Ship the synchronized Development Workflow safely.",
          lastSynchronizedAt: synchronizedAt,
        };
        const reconciliationCommand = {
          type: "thread.wayfinder.reconciliation.update" as const,
          commandId: CommandId.make("command-workflow-reconciliation"),
          threadId: originThreadId,
          skillRunId: sourceSkillRunId,
          synchronization: {
            status: "healthy" as const,
            reason: "reconnect" as const,
            lastAttemptedAt: synchronizedAt,
            lastSuccessfulAt: synchronizedAt,
            canMutate: true,
          },
          wayfinderMap: updatedMap,
          createdAt: synchronizedAt,
        };
        const synchronized = yield* decideOrchestrationCommand({
          readModel: afterAttachment,
          command: reconciliationCommand,
        });
        const synchronizedEvents = normalizeEvents(synchronized);
        const workflowSync = synchronizedEvents.find(isWorkflowSynchronizedEvent);
        expect(workflowSync?.type).toBe("thread.workflow-synchronized");
        if (workflowSync?.type !== "thread.workflow-synchronized") return;
        expect(workflowSync.payload.attachment.workflowGraph).toMatchObject({
          artifacts: expect.arrayContaining([
            expect.objectContaining({
              lineage: expect.objectContaining({
                workstreamId: attachment.workstreamId,
                sourceSkillRunId,
                sourceStage: "reconciliation",
                upstreamVersion: "revision:issue-29:2",
              }),
            }),
          ]),
          nodes: [
            expect.objectContaining({
              state: "stale",
              resolution: { status: "required", allowed: ["accept-upstream"] },
            }),
          ],
        });

        const afterSynchronization = yield* applyEvents(afterAttachment, synchronizedEvents);
        const graph = afterSynchronization.threads[0]?.workflowAttachment?.workflowGraph;
        expect(graph?.artifacts).toHaveLength(2);
        expect(
          graph?.artifacts.find(
            (artifact) => artifact.lineage.upstreamVersion === "revision:issue-29:2",
          )?.marker.state,
        ).toBe("unread");

        const mutationAt = "2026-08-03T12:06:00.000Z";
        const mutation = yield* decideOrchestrationCommand({
          readModel: afterSynchronization,
          command: {
            type: "thread.wayfinder.mutation.update" as const,
            commandId: CommandId.make("command-workflow-mutation"),
            threadId: originThreadId,
            skillRunId: sourceSkillRunId,
            mutation: {
              actionId: "action:update-workflow-destination",
              action: {
                kind: "update-map-field",
                field: "destination",
                value: "Ship the mutation-synchronized Development Workflow safely.",
              },
              status: "synchronized",
              error: null,
              updatedAt: mutationAt,
            },
            wayfinderMap: {
              ...updatedMap,
              revision: "issue-29:mutation",
              destination: "Ship the mutation-synchronized Development Workflow safely.",
              lastSynchronizedAt: mutationAt,
            },
            createdAt: mutationAt,
          },
        });
        const mutationEvents = normalizeEvents(mutation);
        const mutationSync = mutationEvents.find(isWorkflowSynchronizedEvent);
        expect(mutationSync?.type).toBe("thread.workflow-synchronized");
        if (mutationSync?.type !== "thread.workflow-synchronized") return;
        expect(
          mutationSync.payload.attachment.workflowGraph?.artifacts.at(-1)?.lineage,
        ).toMatchObject({
          sourceSkillRunId,
          sourceStage: "mutation",
          upstreamVersion: "revision:issue-29:mutation",
        });
        const afterMutation = yield* applyEvents(afterSynchronization, mutationEvents);

        const publicationAt = "2026-08-03T12:07:00.000Z";
        const publication = yield* decideOrchestrationCommand({
          readModel: afterMutation,
          command: {
            type: "thread.wayfinder.publication.update" as const,
            commandId: CommandId.make("command-workflow-publication"),
            threadId: originThreadId,
            skillRunId: sourceSkillRunId,
            publication: {
              status: "synchronized",
              artifacts: [],
              nextStep: null,
              updatedAt: publicationAt,
            },
            wayfinderMap: {
              ...updatedMap,
              revision: "issue-29:publication",
              destination: "Ship the publication-synchronized Development Workflow safely.",
              lastSynchronizedAt: publicationAt,
            },
            createdAt: publicationAt,
          },
        });
        const publicationEvents = normalizeEvents(publication);
        const publicationSync = publicationEvents.find(isWorkflowSynchronizedEvent);
        expect(publicationSync?.type).toBe("thread.workflow-synchronized");
        if (publicationSync?.type !== "thread.workflow-synchronized") return;
        expect(
          publicationSync.payload.attachment.workflowGraph?.artifacts.at(-1)?.lineage,
        ).toMatchObject({
          sourceSkillRunId,
          sourceStage: "publication",
          upstreamVersion: "revision:issue-29:publication",
        });
        const afterPublication = yield* applyEvents(afterMutation, publicationEvents);

        const continuedAt = "2026-08-03T12:10:00.000Z";
        const continued = yield* decideOrchestrationCommand({
          readModel: afterPublication,
          command: startCommand({
            commandId: "command-continue-synchronized-workflow",
            createdAt: continuedAt,
            skillInvocation: {
              ...nativeWayfinderInvocation,
              reconnectWorkstreamId: attachment.workstreamId,
              wayfinderMap: {
                ...updatedMap,
                revision: "issue-29:3",
                destination: "Continue the synchronized Development Workflow safely.",
                lastSynchronizedAt: continuedAt,
              },
              wayfinderSynchronizedAt: continuedAt,
              wayfinderSynchronization: {
                status: "healthy",
                reason: "resume",
                lastAttemptedAt: continuedAt,
                lastSuccessfulAt: continuedAt,
                canMutate: true,
              },
            },
          }),
        });
        const continuedEvents = normalizeEvents(continued);
        const continuedTurn = continuedEvents.find(isTurnStartRequestedEvent);
        expect(continuedTurn?.type).toBe("thread.turn-start-requested");
        if (continuedTurn?.type !== "thread.turn-start-requested") return;
        const continuedSkillRunId = continuedTurn.payload.skillInvocation?.skillRunId;
        expect(continuedSkillRunId).toBeDefined();
        if (continuedSkillRunId === undefined) return;
        expect(continuedSkillRunId).not.toBe(sourceSkillRunId);

        const continuedSync = continuedEvents.find(isWorkflowSynchronizedEvent);
        expect(continuedSync?.type).toBe("thread.workflow-synchronized");
        if (continuedSync?.type !== "thread.workflow-synchronized") return;
        expect(continuedSync.payload.attachment.observationCursor.sourceSkillRunId).toBe(
          continuedSkillRunId,
        );
        expect(
          continuedSync.payload.attachment.workflowGraph?.artifacts.at(-1)?.lineage,
        ).toMatchObject({
          workstreamId: attachment.workstreamId,
          sourceSkillRunId: continuedSkillRunId,
          sourceStage: "reconciliation",
          upstreamVersion: "revision:issue-29:3",
        });
        const afterContinuation = yield* applyEvents(afterPublication, continuedEvents);

        const replay = yield* decideOrchestrationCommand({
          readModel: afterContinuation,
          command: reconciliationCommand,
        });
        expect(
          normalizeEvents(replay).some((event) => event.type === "thread.workflow-synchronized"),
        ).toBe(false);

        const unauthorized = yield* decideOrchestrationCommand({
          readModel: afterContinuation,
          command: {
            ...reconciliationCommand,
            commandId: CommandId.make("command-unauthorized-workflow-reconciliation"),
            skillRunId: SkillRunId.make("skill-run:other"),
          },
        });
        expect(
          normalizeEvents(unauthorized).some(
            (event) => event.type === "thread.workflow-synchronized",
          ),
        ).toBe(false);

        const downstreamInvocation: ResolvedSkillInvocation = {
          skill: {
            name: "implement",
            path: "/skills/implement/SKILL.md",
            contentDigest:
              "sha256:257e40665b28ae959ffdcb97d7a72b074360f4a3d201bd84786505308546e434",
          },
          action: {
            id: "work-ticket",
            ticketNumber: 32,
            sourceSkillRunId,
            sourceThreadId: originThreadId,
          },
          execution: { mode: "generic", reason: "unregistered-skill" },
        };
        const blocked = yield* decideOrchestrationCommand({
          readModel: afterContinuation,
          command: startCommand({
            commandId: "command-dispatch-stale-workflow",
            skillInvocation: downstreamInvocation,
          }),
        }).pipe(Effect.flip);
        expect(errorDetail(blocked)).toContain("stale structured Wayfinder data");

        const blockedContinuedRun = yield* decideOrchestrationCommand({
          readModel: afterContinuation,
          command: startCommand({
            commandId: "command-dispatch-stale-continued-workflow",
            skillInvocation: {
              ...downstreamInvocation,
              action: {
                id: "work-ticket",
                ticketNumber: 32,
                sourceSkillRunId: continuedSkillRunId,
                sourceThreadId: originThreadId,
              },
            },
          }),
        }).pipe(Effect.flip);
        expect(errorDetail(blockedContinuedRun)).toContain("stale structured Wayfinder data");

        const blockedNativeTicket = yield* decideOrchestrationCommand({
          readModel: afterContinuation,
          command: startCommand({
            commandId: "command-dispatch-stale-native-ticket",
            skillInvocation: {
              ...nativeWayfinderInvocation,
              action: {
                id: "work-ticket",
                ticketNumber: 32,
                sourceSkillRunId,
                sourceThreadId: originThreadId,
              },
            },
          }),
        }).pipe(Effect.flip);
        expect(errorDetail(blockedNativeTicket)).toContain("stale structured Wayfinder data");

        const viewed = yield* decideOrchestrationCommand({
          readModel: afterContinuation,
          command: {
            type: "thread.workflow.artifacts.view" as const,
            commandId: CommandId.make("command-view-workflow-artifacts"),
            threadId: originThreadId,
            createdAt: synchronizedAt,
          },
        });
        const afterViewed = yield* applyEvents(afterContinuation, normalizeEvents(viewed));
        expect(
          afterViewed.threads[0]?.workflowAttachment?.workflowGraph?.artifacts.every(
            (artifact) => artifact.marker.state === "viewed",
          ),
        ).toBe(true);

        const currentArtifact =
          afterViewed.threads[0]?.workflowAttachment?.workflowGraph?.artifacts.find(
            (artifact) => artifact.state === "current",
          );
        if (currentArtifact === undefined) return;
        const acknowledged = yield* decideOrchestrationCommand({
          readModel: afterViewed,
          command: {
            type: "thread.workflow.artifact.acknowledge" as const,
            commandId: CommandId.make("command-acknowledge-workflow-artifact"),
            threadId: originThreadId,
            artifactId: currentArtifact.id,
            createdAt: synchronizedAt,
          },
        });
        const afterAcknowledgement = yield* applyEvents(afterViewed, normalizeEvents(acknowledged));
        expect(
          afterAcknowledgement.threads[0]?.workflowAttachment?.workflowGraph?.artifacts.find(
            (artifact) => artifact.id === currentArtifact.id,
          )?.marker.state,
        ).toBe("acknowledged");

        const resolved = yield* decideOrchestrationCommand({
          readModel: afterAcknowledgement,
          command: {
            type: "thread.workflow.stale.resolve" as const,
            commandId: CommandId.make("command-resolve-workflow-staleness"),
            threadId: originThreadId,
            resolution: "accept-upstream" as const,
            confirmed: true,
            createdAt: synchronizedAt,
          },
        });
        const afterResolution = yield* applyEvents(afterAcknowledgement, normalizeEvents(resolved));
        expect(
          afterResolution.threads[0]?.workflowAttachment?.workflowGraph?.nodes.some(
            (node) => node.state === "stale",
          ),
        ).toBe(false);

        const unblocked = yield* decideOrchestrationCommand({
          readModel: afterResolution,
          command: startCommand({
            commandId: "command-dispatch-resolved-workflow",
            skillInvocation: downstreamInvocation,
          }),
        });
        expect(
          normalizeEvents(unblocked).some((event) => event.type === "thread.turn-start-requested"),
        ).toBe(true);
      }),
  );
});

it.layer(NodeServices.layer)("Workflow Run confirmation boundary", (it) => {
  it.effect("preflights read-only and confirms only the exact projected configuration", () =>
    Effect.gen(function* () {
      const hinted = yield* decideOrchestrationCommand({
        readModel: readModel(),
        command: startCommand({
          commandId: "command-run-preflight",
          skillInvocation: nativeWayfinderInvocation,
        }),
      });
      const afterHint = yield* applyEvents(readModel(), normalizeEvents(hinted));
      const attached = yield* decideOrchestrationCommand({
        readModel: afterHint,
        command: {
          type: "thread.workflow.attach" as const,
          commandId: CommandId.make("command-run-attach"),
          threadId: originThreadId,
          originThreadId,
          workflowGoal: map.destination,
          confirmed: true,
          createdAt: now,
        },
      });
      const afterAttachment = yield* applyEvents(afterHint, normalizeEvents(attached));
      const configuration = {
        workflowGoal: map.destination,
        runScope: [{ nodeId: "ticket:35", label: "Prepare Workflow Run" }],
        defaultProviderInstanceId: ProviderInstanceId.make("codex"),
        providerOverrides: [],
        requiredSkills: [
          {
            stage: "implementation",
            skill: {
              name: "implement",
              path: "/skills/implement/SKILL.md",
              contentDigest:
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            },
            status: "available" as const,
          },
        ],
        fixedPoint: "b6c5a7527a9a9fe21672ababec55fd773bbffa0b",
        workstreamBaseline: "feature/development-workflow",
        remoteTarget: "origin/feature/development-workflow",
        environmentAutomationCapacity: 2,
        executionLimit: 1,
        authority: {
          createWorktree: true,
          runProvider: true,
          mutateTracker: false,
          pushBaseline: false,
          createDraftPullRequest: false,
        },
      };
      const preview = yield* decideOrchestrationCommand({
        readModel: afterAttachment,
        command: {
          type: "thread.workflow.run.preflight" as const,
          commandId: CommandId.make("command-run-preflight-config"),
          threadId: originThreadId,
          configuration,
          createdAt: now,
        },
      });
      expect(normalizeEvents(preview)[0]?.type).toBe("thread.workflow-run-preflighted");
      const afterPreview = yield* applyEvents(afterAttachment, normalizeEvents(preview));
      expect(afterPreview.threads[0]?.workflowAttachment?.workflowRunPreview).toMatchObject({
        status: "ready-for-confirmation",
        authorityGranted: false,
      });
      const confirmed = yield* decideOrchestrationCommand({
        readModel: afterPreview,
        command: {
          type: "thread.workflow.run.confirm" as const,
          commandId: CommandId.make("command-run-confirm"),
          threadId: originThreadId,
          configuration,
          confirmed: true,
          createdAt: now,
        },
      });
      const afterConfirmation = yield* applyEvents(afterPreview, normalizeEvents(confirmed));
      expect(afterConfirmation.threads[0]?.workflowAttachment?.workflowRun).toMatchObject({
        status: "confirmed",
        authorityGranted: true,
        configuration,
      });
    }),
  );
});
