import {
  ApprovalRequestId,
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  SkillRunId,
  ThreadId,
  TurnId,
  WorkstreamId,
  type OrchestrationEvent,
  type OrchestrationLatestTurn,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type ResolvedSkillInvocation,
  type WorkflowAttachment,
  type WorkflowGraphNode,
  type WorkflowPrdDocument,
  type WorkflowRun,
  type WorkflowTicketBatch,
  type WorkflowTrackerProjection,
} from "@t3tools/contracts";
import { initializeWorkflowGraph } from "@t3tools/shared/workflowGraph";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { projectEvent } from "./projector.ts";

const now = "2026-08-08T12:00:00.000Z";
const checkpointedAt = "2026-08-08T12:01:00.000Z";
const resolvedAt = "2026-08-08T12:02:00.000Z";
const publishedAt = "2026-08-08T12:03:00.000Z";
const projectId = ProjectId.make("project-ticketing");
const originThreadId = ThreadId.make("thread-wayfinder-ticketing");
const specificationThreadId = ThreadId.make("thread-specification-ticketing");
const ticketingThreadId = ThreadId.make("thread-ticketing");
const sourceSkillRunId = SkillRunId.make("skill-run:wayfinder-ticketing");
const specificationSkillRunId = SkillRunId.make("skill-run:to-spec-ticketing");
const ticketingSkillRunId = SkillRunId.make("skill-run:to-tickets-ticketing");
const providerInstanceId = ProviderInstanceId.make("codex");
const workstreamId = WorkstreamId.make("workstream:development-workflow");
const sourceWayfinderArtifactId = "wayfinder-map:29:content:sha256:ticketing";
const workflowPrdArtifactId = `workflow-prd:${workstreamId}:v1`;

const prd: WorkflowPrdDocument = {
  version: 1,
  title: "Development Workflow",
  problemStatement: "Ticket publication needs a durable approval boundary.",
  solution: "Publish one exact approved Ticket Batch through the tracker reactor.",
  userStories: ["As a maintainer, I want ticket publication to be replay-safe."],
  implementationDecisions: ["Keep tracker state authoritative for ticket identities."],
  testingDecisions: ["Drain the publication receipt before inspecting the projection."],
  outOfScope: ["Provider prompt emulation."],
};

const wayfinderInvocation: ResolvedSkillInvocation = {
  skill: {
    name: "wayfinder",
    path: "/skills/wayfinder/SKILL.md",
    contentDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
  action: { id: "continue-map", reference: "#29" },
  execution: { mode: "native", adapterId: "wayfinder", adapterVersion: 1 },
  wayfinderMap: {
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
  },
  wayfinderSynchronizedAt: now,
  wayfinderSynchronization: {
    status: "healthy",
    reason: "resume",
    lastAttemptedAt: now,
    lastSuccessfulAt: now,
    canMutate: true,
  },
};

const toSpecInvocation: ResolvedSkillInvocation = {
  skill: {
    name: "to-spec",
    path: "/skills/to-spec/SKILL.md",
    contentDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  },
  action: {
    id: "handoff-to-spec",
    sourceSkillRunId,
    sourceThreadId: originThreadId,
    canonicalReference: {
      number: 29,
      url: "https://github.com/naveed949/t3code/issues/29",
    },
    wayfinderSynchronizedAt: now,
    acknowledgedIncomplete: false,
  },
  execution: { mode: "generic", reason: "unregistered-skill" },
  reconnectWorkstreamId: workstreamId,
};

const toTicketsInvocation: ResolvedSkillInvocation = {
  skill: {
    name: "to-tickets",
    path: "/skills/to-tickets/SKILL.md",
    contentDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  },
  action: {
    id: "handoff-to-tickets",
    sourceSkillRunId: specificationSkillRunId,
    sourceThreadId: specificationThreadId,
    sourceWorkflowPrdArtifactId: workflowPrdArtifactId,
    sourceWorkflowPrdVersion: 1,
  },
  execution: { mode: "generic", reason: "unregistered-skill" },
  reconnectWorkstreamId: workstreamId,
};

function latestTurn(
  skillInvocation: ResolvedSkillInvocation,
  skillRunId: SkillRunId,
): OrchestrationLatestTurn {
  return {
    turnId: TurnId.make(`turn:${skillRunId}`),
    state: "running",
    requestedAt: now,
    startedAt: now,
    completedAt: null,
    assistantMessageId: null,
    sourceProposedPlan: undefined,
    skillInvocation: {
      ...skillInvocation,
      workstreamId,
      skillRunId,
      projectId,
      threadId:
        skillInvocation.action?.id === "handoff-to-tickets"
          ? ticketingThreadId
          : specificationThreadId,
      createdAt: now,
      wayfinderDraft: undefined,
      wayfinderPublication: undefined,
      wayfinderMutation: undefined,
      wayfinderResearch: undefined,
    },
  };
}

function workflowRun(): WorkflowRun {
  return {
    configuration: {
      workflowGoal: "Ship the Development Workflow safely.",
      runScope: [{ nodeId: `workflow:${workstreamId}`, label: "Workstream" }],
      defaultProviderInstanceId: providerInstanceId,
      providerOverrides: [],
      requiredSkills: [
        {
          nodeId: `workflow:${workstreamId}`,
          providerInstanceId,
          stage: "ticketing",
          skill: {
            name: "to-tickets",
            path: "/skills/to-tickets/SKILL.md",
            contentDigest:
              "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          },
          status: "available",
        },
      ],
      fixedPoint: "2514a152021bf9522e501ceeae5e9ab292af29b6",
      workstreamBaseline: "feature/development-workflow",
      remoteTarget: "origin/feature/development-workflow",
      targetVerification: {
        fixedPoint: "verified",
        workstreamBaseline: "verified",
        remoteTarget: "verified",
      },
      environmentAutomationCapacity: 2,
      executionLimit: 1,
      authority: {
        createWorktree: true,
        runProvider: true,
        mutateTracker: false,
        pushBaseline: false,
        createDraftPullRequest: false,
      },
    },
    status: "confirmed",
    authorityGranted: true,
    confirmedAt: now,
    dispatchIdentity: CommandId.make("workflow-run-ticketing"),
    immutableAtDispatch: now,
  };
}

function attachment(): WorkflowAttachment {
  const base: WorkflowAttachment = {
    originThreadId,
    workstreamId,
    sourceSkillRunId,
    workflowGoal: "Ship the Development Workflow safely.",
    backfilledWayfinderData: {
      wayfinderMap: wayfinderInvocation.wayfinderMap,
      wayfinderSynchronizedAt: now,
      wayfinderSynchronization: wayfinderInvocation.wayfinderSynchronization,
    },
    observationCursor: {
      sourceSkillRunId,
      observedAt: now,
      wayfinderSynchronizedAt: now,
    },
    attachedAt: now,
  };
  const graph = initializeWorkflowGraph(base);
  return {
    ...base,
    workflowGraph: {
      ...graph,
      artifacts: [
        {
          id: sourceWayfinderArtifactId,
          logicalId: "wayfinder-map:29",
          kind: "wayfinder-map",
          state: "current",
          lineage: {
            workstreamId,
            sourceSkillRunId,
            sourceStage: "attachment",
            upstreamVersion: "content:sha256:ticketing",
          },
          upstreamSynchronizedAt: now,
          importedAt: now,
          marker: { kind: "new", state: "acknowledged", markedAt: now },
        },
        {
          id: workflowPrdArtifactId,
          logicalId: `workflow-prd:${workstreamId}`,
          kind: "workflow-prd",
          state: "current",
          version: prd.version,
          lineage: {
            workstreamId,
            sourceSkillRunId: specificationSkillRunId,
            sourceStage: "specification",
            upstreamVersion: "content:sha256:ticketing",
            upstreamArtifactId: sourceWayfinderArtifactId,
          },
          upstreamSynchronizedAt: now,
          importedAt: now,
          marker: { kind: "new", state: "acknowledged", markedAt: now },
        },
      ],
    },
    workflowRun: workflowRun(),
    workflowVersion: 1,
    specificationStage: {
      status: "completed",
      workstreamId,
      nodeId: `workflow:${workstreamId}`,
      originThreadId,
      specificationThreadId,
      skillRunId: specificationSkillRunId,
      providerInstanceId,
      skill: toSpecInvocation.skill,
      artifactId: workflowPrdArtifactId,
      startedAt: now,
      updatedAt: now,
    },
  };
}

function thread(
  id: ThreadId,
  input: {
    readonly latestTurn?: OrchestrationLatestTurn;
    readonly workflowAttachment?: WorkflowAttachment;
  } = {},
): OrchestrationThread {
  return {
    id,
    projectId,
    title:
      id === originThreadId
        ? "Wayfinder"
        : id === ticketingThreadId
          ? "Ticketing"
          : "Specification",
    modelSelection: { instanceId: providerInstanceId, model: "gpt-5.6" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: input.latestTurn ?? null,
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
    ...(input.workflowAttachment === undefined
      ? {}
      : { workflowAttachment: input.workflowAttachment }),
  };
}

function readModel(
  input: { readonly ticketingStage?: WorkflowAttachment["ticketingStage"] } = {},
): OrchestrationReadModel {
  const origin = attachment();
  const nextAttachment =
    input.ticketingStage === undefined
      ? origin
      : { ...origin, ticketingStage: input.ticketingStage };
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      thread(originThreadId, { workflowAttachment: nextAttachment }),
      thread(specificationThreadId, {
        latestTurn: latestTurn(toSpecInvocation, specificationSkillRunId),
      }),
      thread(ticketingThreadId),
    ],
    updatedAt: now,
  };
}

const batch: WorkflowTicketBatch = {
  id: "ticket-batch:development-workflow:v1",
  sourceWorkflowPrdArtifactId: workflowPrdArtifactId,
  sourceWorkflowPrdVersion: 1,
  tickets: [
    {
      key: "ticket-batch-publication",
      title: "Publish and synchronize an approved Ticket Batch",
      body: "Run /to-tickets and publish only the exact approved batch.",
      parentKey: null,
    },
  ],
  blockerEdges: [],
};

const trackerProjection: WorkflowTrackerProjection = {
  status: "healthy",
  canonicalReference: {
    number: 29,
    title: "Development Workflow",
    url: "https://github.com/naveed949/t3code/issues/29",
    state: "open",
  },
  revision: "github:ticket-batch-v1",
  batchId: batch.id,
  tickets: [
    {
      key: batch.tickets[0]!.key,
      number: 37,
      title: batch.tickets[0]!.title,
      url: "https://github.com/naveed949/t3code/issues/37",
      state: "open",
      body: batch.tickets[0]!.body,
      parentNumber: 29,
      blockedBy: [],
      blocks: [],
      includedInRun: true,
    },
    {
      key: "later-ticket",
      number: 38,
      title: "A later synchronized ticket",
      url: "https://github.com/naveed949/t3code/issues/38",
      state: "open",
      parentNumber: 29,
      blockedBy: [],
      blocks: [],
      includedInRun: false,
    },
  ],
  synchronizedAt: publishedAt,
};

const implementationNodeId = "ticket:ticket-batch-publication";
const implementationActionIdentity = "ticket-implementation:37:stage";
const implementSkill = {
  name: "implement",
  path: "/skills/implement/SKILL.md",
  contentDigest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
} as const;
const reviewSkill = {
  name: "code-review",
  path: "/skills/code-review/SKILL.md",
  contentDigest: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
} as const;

function implementationReadModel(): OrchestrationReadModel {
  const base = readModel();
  const origin = base.threads.find((candidate) => candidate.id === originThreadId)!;
  const attachment = origin.workflowAttachment!;
  const ticketNode: WorkflowGraphNode = {
    id: implementationNodeId,
    kind: "ticket",
    ticketKey: batch.tickets[0]!.key,
    ticketNumber: 37,
    title: batch.tickets[0]!.title,
    state: "current",
    sourceArtifactId: workflowPrdArtifactId,
    includedInRun: true,
    resolution: { status: "not-required" },
  };
  const workflowRun = attachment.workflowRun!;
  const configuration = {
    ...workflowRun.configuration,
    runScope: [
      ...workflowRun.configuration.runScope,
      { nodeId: implementationNodeId, label: batch.tickets[0]!.title },
    ],
    requiredSkills: [
      ...workflowRun.configuration.requiredSkills,
      {
        nodeId: `workflow:${workstreamId}`,
        providerInstanceId,
        stage: "implementation",
        skill: implementSkill,
        status: "available" as const,
      },
      {
        nodeId: `workflow:${workstreamId}`,
        providerInstanceId,
        stage: "review",
        skill: reviewSkill,
        status: "available" as const,
      },
    ],
  };
  const nextAttachment: WorkflowAttachment = {
    ...attachment,
    workflowGraph: {
      ...attachment.workflowGraph!,
      nodes: [...attachment.workflowGraph!.nodes, ticketNode],
      updatedAt: now,
    },
    workflowRun: { ...workflowRun, configuration },
    trackerProjection,
    workflowVersion: 3,
  };
  return {
    ...base,
    threads: base.threads.map((candidate) =>
      candidate.id === originThreadId
        ? { ...candidate, workflowAttachment: nextAttachment }
        : candidate,
    ),
  };
}

function normalizeEvents(
  result:
    | Omit<OrchestrationEvent, "sequence">
    | ReadonlyArray<Omit<OrchestrationEvent, "sequence">>,
): ReadonlyArray<Omit<OrchestrationEvent, "sequence">> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<Omit<OrchestrationEvent, "sequence">>;
  }
  return [result as Omit<OrchestrationEvent, "sequence">];
}

async function applyEvents(
  model: OrchestrationReadModel,
  events: ReadonlyArray<Omit<OrchestrationEvent, "sequence">>,
): Promise<OrchestrationReadModel> {
  let current = model;
  for (const event of events) {
    current = await Effect.runPromise(
      projectEvent(current, {
        ...event,
        sequence: current.snapshotSequence + 1,
      } as OrchestrationEvent),
    );
  }
  return current;
}

it.layer(NodeServices.layer)("Ticket Batch publication boundary", (it) => {
  it.effect(
    "dispatches only from the current PRD and projects an approved batch into Run Scope",
    () =>
      Effect.gen(function* () {
        const started = yield* decideOrchestrationCommand({
          readModel: readModel(),
          command: {
            type: "thread.turn.start" as const,
            commandId: CommandId.make("ticketing-start"),
            threadId: ticketingThreadId,
            message: {
              messageId: MessageId.make("message:ticketing-start"),
              role: "user" as const,
              text: "Create the approved ticket batch.",
              attachments: [],
            },
            runtimeMode: "full-access" as const,
            interactionMode: "default" as const,
            skillInvocation: toTicketsInvocation,
            createdAt: now,
          },
        });
        expect(normalizeEvents(started).map((event) => event.type)).toContain(
          "thread.workflow-ticketing-dispatched",
        );
        const afterStart = yield* Effect.promise(() =>
          applyEvents(readModel(), normalizeEvents(started)),
        );
        const dispatched = afterStart.threads[0]?.workflowAttachment?.ticketingStage;
        expect(dispatched).toMatchObject({
          status: "running",
          sourceWorkflowPrdArtifactId: workflowPrdArtifactId,
          ticketingThreadId,
        });

        const checkpoint = yield* decideOrchestrationCommand({
          readModel: afterStart,
          command: {
            type: "thread.activity.append" as const,
            commandId: CommandId.make("ticketing-checkpoint"),
            threadId: ticketingThreadId,
            activity: {
              id: EventId.make("activity:ticketing-checkpoint"),
              tone: "info" as const,
              kind: "user-input.requested" as const,
              summary: "Confirm ticket granularity and blocker edges",
              payload: {
                requestId: ApprovalRequestId.make("request:ticketing-granularity"),
                skillRunId: dispatched!.skillRunId,
                batch,
                questions: [
                  {
                    id: "batch",
                    header: "Ticket Batch",
                    question: "Approve the exact ticket titles and blocker edges?",
                    options: [{ label: "Approve", description: "Publish this exact batch." }],
                  },
                ],
              },
              turnId: TurnId.make("turn:ticketing"),
              createdAt: checkpointedAt,
            },
            createdAt: checkpointedAt,
          },
        });
        const afterCheckpoint = yield* Effect.promise(() =>
          applyEvents(afterStart, normalizeEvents(checkpoint)),
        );
        expect(afterCheckpoint.threads[0]?.workflowAttachment?.ticketingStage).toMatchObject({
          status: "checkpoint",
          checkpoint: { kind: "ticketing-granularity-blockers", status: "pending" },
        });

        const response = yield* decideOrchestrationCommand({
          readModel: afterCheckpoint,
          command: {
            type: "thread.user-input.respond" as const,
            commandId: CommandId.make("ticketing-checkpoint-response"),
            threadId: ticketingThreadId,
            requestId: ApprovalRequestId.make("request:ticketing-granularity"),
            answers: { batch: { selectedOptionLabel: "Approve" } },
            createdAt: resolvedAt,
          },
        });
        const afterResponse = yield* Effect.promise(() =>
          applyEvents(afterCheckpoint, normalizeEvents(response)),
        );
        expect(afterResponse.threads[0]?.workflowAttachment?.ticketingStage).toMatchObject({
          status: "running",
          checkpoint: { status: "resolved" },
        });

        const publication = yield* decideOrchestrationCommand({
          readModel: afterResponse,
          command: {
            type: "thread.workflow.ticketing.publish" as const,
            commandId: CommandId.make("ticketing-publish"),
            threadId: originThreadId,
            ticketingThreadId,
            skillRunId: afterResponse.threads[0]!.workflowAttachment!.ticketingStage!.skillRunId,
            expectedWorkstreamVersion:
              afterResponse.threads[0]!.workflowAttachment!.workflowVersion ?? 0,
            batch,
            confirmed: true,
            createdAt: publishedAt,
          },
        });
        expect(normalizeEvents(publication).map((event) => event.type)).toContain(
          "thread.workflow-ticket-batch-publication-requested",
        );
        const afterRequest = yield* Effect.promise(() =>
          applyEvents(afterResponse, normalizeEvents(publication)),
        );
        expect(afterRequest.threads[0]?.workflowAttachment?.ticketingStage).toMatchObject({
          status: "publishing",
          approvedBatch: batch,
        });

        const synchronized = yield* decideOrchestrationCommand({
          readModel: afterRequest,
          command: {
            type: "thread.workflow.ticketing.publication.update" as const,
            commandId: CommandId.make("ticketing-publication-synchronized"),
            threadId: originThreadId,
            ticketingThreadId,
            skillRunId: afterRequest.threads[0]!.workflowAttachment!.ticketingStage!.skillRunId,
            publication: {
              status: "succeeded",
              batchId: batch.id,
              identities: [
                {
                  key: batch.tickets[0]!.key,
                  number: 37,
                  url: "https://github.com/naveed949/t3code/issues/37",
                },
              ],
              requestedAt: publishedAt,
              updatedAt: publishedAt,
            },
            trackerProjection,
            createdAt: publishedAt,
          },
        });
        const projected = yield* Effect.promise(() =>
          applyEvents(afterRequest, normalizeEvents(synchronized)),
        );
        const projectedAttachment = projected.threads[0]?.workflowAttachment;
        expect(projectedAttachment?.trackerProjection?.status).toBe("healthy");
        expect(projectedAttachment?.ticketingStage?.status).toBe("completed");
        expect(projectedAttachment?.workflowRun?.configuration.runScope).toEqual(
          expect.arrayContaining([
            { nodeId: `ticket:${batch.tickets[0]!.key}`, label: batch.tickets[0]!.title },
          ]),
        );
        expect(projectedAttachment?.workflowGraph?.nodes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: "ticket",
              ticketKey: batch.tickets[0]!.key,
              includedInRun: true,
            }),
            expect.objectContaining({
              kind: "ticket",
              ticketKey: "later-ticket",
              includedInRun: false,
            }),
          ]),
        );
      }),
  );
});

it.layer(NodeServices.layer)("Ticket Implementation boundary", (it) => {
  it.effect("starts one executable node and reuses the same Action Identity", () =>
    Effect.gen(function* () {
      const model = implementationReadModel();
      const command = {
        type: "thread.workflow.ticket-implementation.start" as const,
        commandId: CommandId.make("ticket-implementation-start"),
        threadId: originThreadId,
        ticketNodeId: implementationNodeId,
        actionIdentity: implementationActionIdentity,
        expectedWorkstreamVersion: 3,
        confirmed: true as const,
        createdAt: publishedAt,
      };
      const requested = yield* decideOrchestrationCommand({ readModel: model, command });
      const requestedEvents = normalizeEvents(requested);
      expect(requestedEvents.map((event) => event.type)).toEqual([
        "thread.workflow-ticket-implementation-requested",
      ]);
      const afterRequest = yield* Effect.promise(() => applyEvents(model, requestedEvents));
      const implementation =
        afterRequest.threads[0]?.workflowAttachment?.ticketImplementations?.[0];
      expect(implementation).toMatchObject({
        status: "dispatching",
        ticketNumber: 37,
        fixedPoint: "2514a152021bf9522e501ceeae5e9ab292af29b6",
        acceptanceCriteria: "Run /to-tickets and publish only the exact approved batch.",
        implementSkill,
        reviewSkill,
      });
      expect(
        afterRequest.threads[0]?.workflowAttachment?.workflowGraph?.nodes.find(
          (node) => node.id === implementationNodeId,
        ),
      ).toMatchObject({
        implementationAvailability: {
          status: "active",
          canStart: false,
        },
      });

      const replay = yield* decideOrchestrationCommand({ readModel: afterRequest, command });
      const replayedImplementation = normalizeEvents(replay)[0];
      expect(replayedImplementation?.type).toBe("thread.workflow-ticket-implementation-requested");
      if (replayedImplementation?.type === "thread.workflow-ticket-implementation-requested") {
        expect(replayedImplementation).toMatchObject({ payload: { implementation } });
      }

      const immutableUpdate = yield* decideOrchestrationCommand({
        readModel: afterRequest,
        command: {
          type: "thread.workflow.ticket-implementation.update" as const,
          commandId: CommandId.make("ticket-implementation-rebind-fixed-point"),
          threadId: originThreadId,
          implementationId: implementation!.id,
          implementation: {
            ...implementation!,
            fixedPoint: "a-different-fixed-point",
          },
          expectedWorkstreamVersion:
            afterRequest.threads[0]?.workflowAttachment?.workflowVersion ?? 0,
          createdAt: publishedAt,
        },
      }).pipe(Effect.flip);
      expect(immutableUpdate._tag).toBe("OrchestrationCommandInvariantError");

      const heldModel: OrchestrationReadModel = {
        ...model,
        threads: model.threads.map((candidate) =>
          candidate.id === originThreadId
            ? {
                ...candidate,
                workflowAttachment: {
                  ...candidate.workflowAttachment!,
                  workflowGraph: {
                    ...candidate.workflowAttachment!.workflowGraph!,
                    nodes: candidate.workflowAttachment!.workflowGraph!.nodes.map((node) =>
                      node.id === implementationNodeId && node.kind === "ticket"
                        ? { ...node, held: true }
                        : node,
                    ),
                  },
                },
              }
            : candidate,
        ),
      };
      const rejection = yield* decideOrchestrationCommand({
        readModel: heldModel,
        command: { ...command, commandId: CommandId.make("ticket-implementation-held") },
      }).pipe(Effect.flip);
      expect(rejection._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("records structured review evidence only after the pinned child completes", () =>
    Effect.gen(function* () {
      const model = implementationReadModel();
      const startCommand = {
        type: "thread.workflow.ticket-implementation.start" as const,
        commandId: CommandId.make("ticket-implementation-review-start"),
        threadId: originThreadId,
        ticketNodeId: implementationNodeId,
        actionIdentity: "ticket-implementation:37:review-gate",
        expectedWorkstreamVersion: 3,
        confirmed: true as const,
        createdAt: publishedAt,
      };
      const started = yield* decideOrchestrationCommand({
        readModel: model,
        command: startCommand,
      });
      const afterStart = yield* Effect.promise(() => applyEvents(model, normalizeEvents(started)));
      const startedImplementation =
        afterStart.threads[0]?.workflowAttachment?.ticketImplementations?.[0];
      expect(startedImplementation).toBeDefined();
      const reviewSkillRunId = SkillRunId.make("skill-run:ticket-implementation-review");
      const reviewInvocation: ResolvedSkillInvocation = {
        skill: reviewSkill,
        action: {
          id: "work-ticket",
          ticketNumber: 37,
          sourceSkillRunId,
          sourceThreadId: originThreadId,
        },
        execution: { mode: "generic", reason: "unregistered-skill" },
        reconnectWorkstreamId: workstreamId,
      };
      const reviewTurn: OrchestrationLatestTurn = {
        ...latestTurn(reviewInvocation, reviewSkillRunId),
        state: "completed",
        completedAt: publishedAt,
        skillInvocation: {
          ...latestTurn(reviewInvocation, reviewSkillRunId).skillInvocation!,
          skillRunId: reviewSkillRunId,
        },
      };
      const reviewingImplementation = {
        ...startedImplementation!,
        status: "reviewing" as const,
        implementationThreadId: ThreadId.make("ticket-implementation-review-thread"),
        reviewSkillRunId,
        updatedAt: publishedAt,
      };
      const reviewingModel: OrchestrationReadModel = {
        ...afterStart,
        threads: [
          ...afterStart.threads.map((candidate) =>
            candidate.id === originThreadId
              ? {
                  ...candidate,
                  workflowAttachment: {
                    ...candidate.workflowAttachment!,
                    ticketImplementations: [reviewingImplementation],
                  },
                }
              : candidate,
          ),
          thread(reviewingImplementation.implementationThreadId, { latestTurn: reviewTurn }),
        ],
      };
      const validation = [
        {
          name: "focused tests",
          status: "passed" as const,
          command:
            "vp test run apps/server/src/orchestration/decider.workflowTicketImplementation.test.ts",
          recordedAt: publishedAt,
        },
      ];
      const review = {
        status: "passed" as const,
        skillRunId: reviewSkillRunId,
        fixedPoint: reviewingImplementation.fixedPoint,
        summary: "The implementation matches the ticket acceptance criteria.",
        findings: [],
        completedAt: publishedAt,
      };
      const recorded = yield* decideOrchestrationCommand({
        readModel: reviewingModel,
        command: {
          type: "thread.workflow.ticket-implementation.review.record" as const,
          commandId: CommandId.make("ticket-implementation-review-record"),
          threadId: originThreadId,
          implementationId: reviewingImplementation.id,
          expectedWorkstreamVersion:
            reviewingModel.threads[0]?.workflowAttachment?.workflowVersion ?? 0,
          review,
          validation,
          createdAt: publishedAt,
        },
      });
      const projected = yield* Effect.promise(() =>
        applyEvents(reviewingModel, normalizeEvents(recorded)),
      );
      expect(projected.threads[0]?.workflowAttachment?.ticketImplementations?.[0]).toMatchObject({
        status: "reviewed",
        review,
        validation,
      });
    }),
  );
});
