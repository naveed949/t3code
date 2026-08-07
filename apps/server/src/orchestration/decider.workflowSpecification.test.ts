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
  type WorkflowRun,
} from "@t3tools/contracts";
import { initializeWorkflowGraph } from "@t3tools/shared/workflowGraph";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { projectEvent } from "./projector.ts";

const now = "2026-08-07T12:00:00.000Z";
const checkpointedAt = "2026-08-07T12:01:00.000Z";
const resolvedAt = "2026-08-07T12:02:00.000Z";
const completedAt = "2026-08-07T12:03:00.000Z";
const projectId = ProjectId.make("project-specification");
const originThreadId = ThreadId.make("thread-wayfinder-origin");
const specificationThreadId = ThreadId.make("thread-specification");
const sourceSkillRunId = SkillRunId.make("skill-run:wayfinder");
const specificationSkillRunId = SkillRunId.make("skill-run:to-spec");
const providerInstanceId = ProviderInstanceId.make("codex");
const workstreamId = WorkstreamId.make("workstream:development-workflow");
const sourceWayfinderArtifactId = "wayfinder-map:29:content:sha256:source";

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

const specificationInvocation: ResolvedSkillInvocation = {
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

function latestTurn(skillInvocation?: ResolvedSkillInvocation): OrchestrationLatestTurn | null {
  return skillInvocation === undefined
    ? null
    : {
        turnId: TurnId.make("turn:specification"),
        state: "running",
        requestedAt: now,
        startedAt: now,
        completedAt: null,
        assistantMessageId: null,
        sourceProposedPlan: undefined,
        skillInvocation: {
          ...skillInvocation,
          workstreamId,
          skillRunId:
            skillInvocation.skill.name === "wayfinder" ? sourceSkillRunId : specificationSkillRunId,
          projectId,
          threadId:
            skillInvocation.skill.name === "wayfinder" ? originThreadId : specificationThreadId,
          createdAt: now,
          wayfinderDraft: undefined,
          wayfinderPublication: undefined,
          wayfinderMutation: undefined,
          wayfinderResearch: undefined,
        },
      };
}

function makeThread(
  id: ThreadId,
  input: {
    readonly latestTurn?: OrchestrationLatestTurn | null;
    readonly workflowAttachment?: WorkflowAttachment;
  } = {},
): OrchestrationThread {
  return {
    id,
    projectId,
    title: id === originThreadId ? "Wayfinder origin" : "Specification",
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

function makeWorkflowRun(): WorkflowRun {
  return {
    configuration: {
      workflowGoal: "Ship the Development Workflow safely.",
      runScope: [{ nodeId: "workflow:development-workflow", label: "Workstream" }],
      defaultProviderInstanceId: providerInstanceId,
      providerOverrides: [],
      requiredSkills: [
        {
          nodeId: "workflow:development-workflow",
          providerInstanceId,
          stage: "specification",
          skill: {
            name: "to-spec",
            path: "/skills/to-spec/SKILL.md",
            contentDigest:
              "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
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
    dispatchIdentity: CommandId.make("workflow-run-confirmed"),
    immutableAtDispatch: now,
  };
}

function makeAttachment(withRun = true): WorkflowAttachment {
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
  return {
    ...base,
    workflowGraph: {
      ...initializeWorkflowGraph(base),
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
            upstreamVersion: "content:sha256:source",
          },
          upstreamSynchronizedAt: now,
          importedAt: now,
          marker: { kind: "new", state: "acknowledged", markedAt: now },
        },
      ],
    },
    ...(withRun ? { workflowRun: makeWorkflowRun() } : {}),
  };
}

function readModel(withRun = true): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      makeThread(originThreadId, {
        latestTurn: latestTurn(wayfinderInvocation),
        workflowAttachment: makeAttachment(withRun),
      }),
      makeThread(specificationThreadId),
    ],
    updatedAt: now,
  };
}

function readModelWithRequiredSkillStatus(status: "missing" | "changed"): OrchestrationReadModel {
  const model = readModel();
  return {
    ...model,
    threads: model.threads.map((thread) => {
      if (thread.id !== originThreadId || thread.workflowAttachment?.workflowRun === undefined) {
        return thread;
      }
      return {
        ...thread,
        workflowAttachment: {
          ...thread.workflowAttachment,
          workflowRun: {
            ...thread.workflowAttachment.workflowRun,
            configuration: {
              ...thread.workflowAttachment.workflowRun.configuration,
              requiredSkills:
                thread.workflowAttachment.workflowRun.configuration.requiredSkills.map(
                  (requiredSkill) => ({ ...requiredSkill, status }),
                ),
            },
          },
        },
      };
    }),
  };
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

function startToSpec(commandId: string) {
  return {
    type: "thread.turn.start" as const,
    commandId: CommandId.make(commandId),
    threadId: specificationThreadId,
    message: {
      messageId: MessageId.make(`message:${commandId}`),
      role: "user" as const,
      text: "Create a specification.",
      attachments: [],
    },
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    skillInvocation: specificationInvocation,
    createdAt: now,
  };
}

function pendingCheckpointActivity(skillRunId: SkillRunId) {
  return {
    type: "thread.activity.append" as const,
    commandId: CommandId.make("specification-checkpoint-activity"),
    threadId: specificationThreadId,
    activity: {
      id: EventId.make("activity:specification-checkpoint"),
      tone: "info" as const,
      kind: "user-input.requested" as const,
      summary: "Confirm the proposed specification test seam",
      payload: {
        requestId: ApprovalRequestId.make("request:specification-seam"),
        skillRunId,
        questions: [
          {
            id: "seam",
            header: "Test seam",
            question: "Does this typed command to projection seam match your expectation?",
            options: [
              { label: "Yes", description: "Use the proposed seam." },
              { label: "No", description: "Revise the proposed seam." },
            ],
          },
        ],
      },
      turnId: TurnId.make("turn:specification"),
      createdAt: checkpointedAt,
    },
    createdAt: checkpointedAt,
  };
}

it.layer(NodeServices.layer)("Specification stage boundary", (it) => {
  it.effect("requires a confirmed Run with the pinned to-spec capability", () =>
    Effect.gen(function* () {
      const blocked = yield* decideOrchestrationCommand({
        readModel: readModel(false),
        command: startToSpec("specification-without-run"),
      }).pipe(Effect.flip);
      expect(String(blocked)).toContain("confirmed Workflow Run");

      const started = yield* decideOrchestrationCommand({
        readModel: readModel(),
        command: startToSpec("specification-with-run"),
      });
      expect(normalizeEvents(started).map((event) => event.type)).toContain(
        "thread.workflow-specification-dispatched",
      );
      const projected = yield* Effect.promise(() =>
        applyEvents(readModel(), normalizeEvents(started)),
      );
      expect(projected.threads[0]?.workflowAttachment?.specificationStage).toMatchObject({
        status: "running",
        specificationThreadId,
        skillRunId: expect.any(String),
        skill: {
          name: "to-spec",
          contentDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      });
    }),
  );

  it.effect("projects a capability block without starting a provider turn", () =>
    Effect.gen(function* () {
      const blocked = yield* decideOrchestrationCommand({
        readModel: readModelWithRequiredSkillStatus("changed"),
        command: startToSpec("specification-capability-changed"),
      });
      expect(normalizeEvents(blocked).map((event) => event.type)).toEqual([
        "thread.workflow-specification-failed",
      ]);
      const projected = yield* Effect.promise(() =>
        applyEvents(readModelWithRequiredSkillStatus("changed"), normalizeEvents(blocked)),
      );
      expect(projected.threads[0]?.workflowAttachment?.specificationStage).toMatchObject({
        status: "capability-blocked",
        failure: "The pinned Specification Required Skill is changed.",
      });
    }),
  );

  it.effect("projects one durable checkpoint, resolves first response, and rejects replay", () =>
    Effect.gen(function* () {
      const started = yield* decideOrchestrationCommand({
        readModel: readModel(),
        command: startToSpec("specification-for-checkpoint"),
      });
      const afterStart = yield* Effect.promise(() =>
        applyEvents(readModel(), normalizeEvents(started)),
      );
      const stageAfterStart = afterStart.threads[0]?.workflowAttachment?.specificationStage;
      expect(stageAfterStart).toBeDefined();
      const unrelatedCheckpoint = yield* decideOrchestrationCommand({
        readModel: afterStart,
        command: {
          ...pendingCheckpointActivity(SkillRunId.make("skill-run:unrelated")),
          commandId: CommandId.make("unrelated-checkpoint-activity"),
        },
      });
      expect(normalizeEvents(unrelatedCheckpoint).map((event) => event.type)).toEqual([
        "thread.activity-appended",
      ]);
      const checkpoint = yield* decideOrchestrationCommand({
        readModel: afterStart,
        command: pendingCheckpointActivity(stageAfterStart!.skillRunId),
      });
      const afterCheckpoint = yield* Effect.promise(() =>
        applyEvents(afterStart, normalizeEvents(checkpoint)),
      );
      const checkpointState = afterCheckpoint.threads[0]?.workflowAttachment?.specificationStage;
      expect(checkpointState).toMatchObject({
        status: "checkpoint",
        checkpoint: {
          requestId: ApprovalRequestId.make("request:specification-seam"),
          status: "pending",
          specificationThreadId,
        },
      });

      const response = yield* decideOrchestrationCommand({
        readModel: afterCheckpoint,
        command: {
          type: "thread.user-input.respond" as const,
          commandId: CommandId.make("specification-checkpoint-response"),
          threadId: specificationThreadId,
          requestId: ApprovalRequestId.make("request:specification-seam"),
          answers: { seam: { selectedOptionLabel: "Yes" } },
          createdAt: resolvedAt,
        },
      });
      expect(normalizeEvents(response).map((event) => event.type)).toEqual([
        "thread.workflow-specification-checkpoint-resolved",
        "thread.user-input-response-requested",
      ]);
      const afterResponse = yield* Effect.promise(() =>
        applyEvents(afterCheckpoint, normalizeEvents(response)),
      );
      expect(afterResponse.threads[0]?.workflowAttachment?.specificationStage).toMatchObject({
        status: "running",
        checkpoint: {
          status: "resolved",
          answers: { seam: { selectedOptionLabel: "Yes" } },
        },
      });

      const replay = yield* decideOrchestrationCommand({
        readModel: afterResponse,
        command: {
          type: "thread.user-input.respond" as const,
          commandId: CommandId.make("specification-checkpoint-response-replay"),
          threadId: specificationThreadId,
          requestId: ApprovalRequestId.make("request:specification-seam"),
          answers: { seam: { selectedOptionLabel: "No" } },
          createdAt: completedAt,
        },
      }).pipe(Effect.flip);
      expect(String(replay)).toContain("stale or already resolved");
    }),
  );

  it.effect(
    "completes only with a structured versioned PRD linked to the current Wayfinder artifact",
    () =>
      Effect.gen(function* () {
        const started = yield* decideOrchestrationCommand({
          readModel: readModel(),
          command: startToSpec("specification-for-completion"),
        });
        const afterStart = yield* Effect.promise(() =>
          applyEvents(readModel(), normalizeEvents(started)),
        );
        const stageAfterStart = afterStart.threads[0]?.workflowAttachment?.specificationStage;
        expect(stageAfterStart).toBeDefined();
        const checkpoint = yield* decideOrchestrationCommand({
          readModel: afterStart,
          command: pendingCheckpointActivity(stageAfterStart!.skillRunId),
        });
        const afterCheckpoint = yield* Effect.promise(() =>
          applyEvents(afterStart, normalizeEvents(checkpoint)),
        );
        const response = yield* decideOrchestrationCommand({
          readModel: afterCheckpoint,
          command: {
            type: "thread.user-input.respond" as const,
            commandId: CommandId.make("specification-completion-response"),
            threadId: specificationThreadId,
            requestId: ApprovalRequestId.make("request:specification-seam"),
            answers: { seam: { selectedOptionLabel: "Yes" } },
            createdAt: resolvedAt,
          },
        });
        const afterResponse = yield* Effect.promise(() =>
          applyEvents(afterCheckpoint, normalizeEvents(response)),
        );
        const stageAfterResponse = afterResponse.threads[0]?.workflowAttachment?.specificationStage;
        expect(stageAfterResponse).toBeDefined();
        const completed = yield* decideOrchestrationCommand({
          readModel: afterResponse,
          command: {
            type: "thread.workflow.specification.complete" as const,
            commandId: CommandId.make("specification-complete"),
            threadId: originThreadId,
            specificationThreadId,
            skillRunId: stageAfterResponse!.skillRunId,
            expectedWorkstreamVersion:
              afterResponse.threads[0]?.workflowAttachment?.workflowVersion ?? 0,
            sourceWayfinderArtifactId,
            prd: {
              version: 1,
              title: "Development Workflow",
              problemStatement: "The workflow needs a durable specification.",
              solution: "Persist a structured PRD artifact.",
              userStories: ["As a maintainer, I want a versioned PRD."],
              implementationDecisions: ["Use the server Workflow Projection."],
              testingDecisions: ["Test command, drain, and projection."],
              outOfScope: ["Provider prompt emulation."],
            },
            createdAt: completedAt,
          },
        });
        expect(normalizeEvents(completed).map((event) => event.type)).toContain(
          "thread.workflow-specification-completed",
        );
        const projected = yield* Effect.promise(() =>
          applyEvents(afterResponse, normalizeEvents(completed)),
        );
        const attachment = projected.threads[0]?.workflowAttachment;
        expect(attachment?.specificationStage).toMatchObject({
          status: "completed",
          artifactId: expect.any(String),
        });
        expect(attachment?.workflowGraph?.artifacts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: "workflow-prd",
              version: 1,
              lineage: {
                workstreamId,
                sourceSkillRunId: stageAfterResponse!.skillRunId,
                sourceStage: "specification",
                upstreamVersion: "content:sha256:source",
                upstreamArtifactId: sourceWayfinderArtifactId,
              },
            }),
          ]),
        );
      }),
  );

  it.effect("projects a truthful failure and allows a stopped stage to be retried", () =>
    Effect.gen(function* () {
      const started = yield* decideOrchestrationCommand({
        readModel: readModel(),
        command: startToSpec("specification-for-recovery"),
      });
      const afterStart = yield* Effect.promise(() =>
        applyEvents(readModel(), normalizeEvents(started)),
      );
      const stageAfterStart = afterStart.threads[0]?.workflowAttachment?.specificationStage;
      expect(stageAfterStart).toBeDefined();
      const failed = yield* decideOrchestrationCommand({
        readModel: afterStart,
        command: {
          type: "thread.session.set" as const,
          commandId: CommandId.make("specification-session-failed"),
          threadId: specificationThreadId,
          session: {
            threadId: specificationThreadId,
            status: "error" as const,
            providerName: "codex",
            providerInstanceId,
            runtimeMode: "full-access" as const,
            activeTurnId: null,
            lastError: "The native to-spec run failed.",
            updatedAt: completedAt,
          },
          createdAt: completedAt,
        },
      });
      expect(normalizeEvents(failed).map((event) => event.type)).toEqual([
        "thread.session-set",
        "thread.workflow-specification-failed",
      ]);
      const afterFailure = yield* Effect.promise(() =>
        applyEvents(afterStart, normalizeEvents(failed)),
      );
      expect(afterFailure.threads[0]?.workflowAttachment?.specificationStage).toMatchObject({
        status: "failed",
        failure: "The native to-spec run failed.",
      });

      const retried = yield* decideOrchestrationCommand({
        readModel: afterFailure,
        command: startToSpec("specification-retry"),
      });
      expect(normalizeEvents(retried).map((event) => event.type)).toContain(
        "thread.workflow-specification-dispatched",
      );
    }),
  );
});
