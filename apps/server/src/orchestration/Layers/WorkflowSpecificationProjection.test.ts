import {
  ApprovalRequestId,
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  type ResolvedSkillInvocation,
  SkillRunId,
  ThreadId,
  TurnId,
  type WorkflowRunConfiguration,
  type WayfinderMapProjection,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { OrchestrationCommandReceiptRepository } from "../../persistence/Services/OrchestrationCommandReceipts.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { ServerConfig } from "../../config.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  RuntimeReceiptBus,
  type OrchestrationRuntimeReceipt,
} from "../Services/RuntimeReceiptBus.ts";
import { TicketBatchPublicationReactor } from "../Services/TicketBatchPublicationReactor.ts";
import { TicketBatchPublicationReactorLive } from "./TicketBatchPublicationReactor.ts";
import { WorkflowTicketImplementationReactor } from "../Services/WorkflowTicketImplementationReactor.ts";
import { WorkflowTicketImplementationReactorLive } from "./WorkflowTicketImplementationReactor.ts";
import * as IssueTracker from "../../nativeSkills/IssueTracker.ts";
import * as GitWorkflowService from "../../git/GitWorkflowService.ts";

const orchestrationLayer = OrchestrationEngineLive.pipe(
  Layer.provide(OrchestrationProjectionSnapshotQueryLive),
  Layer.provide(OrchestrationProjectionPipelineLive),
  Layer.provide(OrchestrationEventStoreLive),
  Layer.provide(OrchestrationCommandReceiptRepositoryLive),
  Layer.provide(RepositoryIdentityResolver.layer),
);
const projectionSnapshotLayer = OrchestrationProjectionSnapshotQueryLive.pipe(
  Layer.provide(RepositoryIdentityResolver.layer),
);
const receiptLayer = OrchestrationCommandReceiptRepositoryLive;

const engineLayer = it.layer(
  Layer.mergeAll(orchestrationLayer, projectionSnapshotLayer, receiptLayer).pipe(
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), {
        prefix: "t3-workflow-specification-projection-",
      }),
    ),
    Layer.provideMerge(NodeServices.layer),
  ),
);

const now = "2026-08-07T12:00:00.000Z";
const checkpointedAt = "2026-08-07T12:01:00.000Z";
const resolvedAt = "2026-08-07T12:02:00.000Z";
const completedAt = "2026-08-07T12:03:00.000Z";
const projectId = ProjectId.make("project-workflow-specification-projection");
const originThreadId = ThreadId.make("thread-workflow-origin-projection");
const specificationThreadId = ThreadId.make("thread-workflow-specification-projection");
const ticketingThreadId = ThreadId.make("thread-workflow-ticketing-projection");
const providerInstanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId: providerInstanceId, model: "gpt-5.6" };
const workflowGoal = "Ship the Development Workflow safely.";
const fixedPoint = "2514a152021bf9522e501ceeae5e9ab292af29b6";

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
    destination: workflowGoal,
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

const publishedTicketMap: WayfinderMapProjection = {
  ...wayfinderInvocation.wayfinderMap!,
  revision: "github:ticket-batch-projection-v1",
  tickets: [
    {
      number: 37,
      title: "Publish and synchronize an approved Ticket Batch",
      url: "https://github.com/naveed949/t3code/issues/37",
      state: "open",
      classification: "task",
      claimedBy: null,
      blockedBy: [],
      blocks: [],
    },
    {
      number: 38,
      title: "Later synchronized ticket",
      url: "https://github.com/naveed949/t3code/issues/38",
      state: "open",
      classification: "task",
      claimedBy: null,
      blockedBy: [],
      blocks: [],
    },
  ],
  frontier: [37],
  lastSynchronizedAt: "2026-08-08T12:04:00.000Z",
};

const ticketTrackerRepository: IssueTracker.IssueTrackerRepository = {
  canonicalKey: "github:naveed949/t3code",
  owner: "naveed949",
  name: "t3code",
};
const trackerCreatedIssues: number[] = [];
const trackerLabels: string[] = [];
const fakeTicketTracker = IssueTracker.IssueTracker.of({
  resolveProjectRepository: () => Effect.succeed(ticketTrackerRepository),
  inspectCapabilities: () =>
    Effect.succeed({
      supportsIssues: true,
      canWriteIssues: true,
      supportsChildRelationships: true,
      supportsBlockingRelationships: true,
      labels: ["ready-for-agent"],
    }),
  resolveIssue: () => Effect.succeed(null),
  loadWayfinderMap: () => Effect.succeed({ kind: "loaded" as const, map: publishedTicketMap }),
  reconcileWayfinderMap: () => Effect.succeed({ kind: "loaded" as const, map: publishedTicketMap }),
  claimIssue: () => Effect.succeed({ viewerLogin: "test" }),
  releaseIssue: () => Effect.void,
  ensureLabel: (input) => Effect.sync(() => void trackerLabels.push(input.name)),
  addIssueLabel: (input) =>
    Effect.sync(() => void trackerLabels.push(`${input.issueNumber}:${input.name}`)),
  createIssue: (input) =>
    Effect.sync(() => {
      trackerCreatedIssues.push(input.key === "ticket-batch-publication" ? 37 : 38);
      return {
        number: input.key === "ticket-batch-publication" ? 37 : 38,
        url: `https://github.com/naveed949/t3code/issues/${input.key === "ticket-batch-publication" ? 37 : 38}`,
      };
    }),
  addChild: () => Effect.void,
  addBlockedBy: () => Effect.void,
  updateWayfinderMapField: () => Effect.void,
  updateWayfinderDecisions: () => Effect.void,
  updateIssueTitle: () => Effect.void,
  setWayfinderClassification: () => Effect.void,
  removeChild: () => Effect.void,
  removeBlockedBy: () => Effect.void,
  addIssueComment: () => Effect.void,
  setIssueState: () => Effect.void,
});

const ticketPublicationReceipts: OrchestrationRuntimeReceipt[] = [];
const ticketPublicationReceiptLayer = Layer.succeed(
  RuntimeReceiptBus,
  RuntimeReceiptBus.of({
    publish: (receipt) => Effect.sync(() => void ticketPublicationReceipts.push(receipt)),
    streamEventsForTest: Stream.empty,
  }),
);

const ticketingEngineLayer = it.layer(
  Layer.mergeAll(TicketBatchPublicationReactorLive, WorkflowTicketImplementationReactorLive).pipe(
    Layer.provideMerge(orchestrationLayer),
    Layer.provideMerge(projectionSnapshotLayer),
    Layer.provideMerge(receiptLayer),
    Layer.provideMerge(Layer.succeed(IssueTracker.IssueTracker, fakeTicketTracker)),
    Layer.provideMerge(ticketPublicationReceiptLayer),
    Layer.provideMerge(
      Layer.mock(GitWorkflowService.GitWorkflowService)({
        listRefs: () =>
          Effect.succeed({
            refs: [],
            isRepo: true,
            hasPrimaryRemote: true,
            nextCursor: null,
            totalCount: 0,
          }),
        createWorktree: (input) =>
          Effect.succeed({
            worktree: {
              path: "/tmp/t3-workflow-ticket-implementation-worktree",
              refName: input.newRefName ?? input.refName,
            },
          }),
        localStatus: () =>
          Effect.succeed({
            isRepo: true,
            hasPrimaryRemote: true,
            isDefaultRef: false,
            refName: "feature/development-workflow",
            hasWorkingTreeChanges: true,
            workingTree: {
              files: [{ path: "apps/server/src/workflow.ts", insertions: 12, deletions: 3 }],
              insertions: 12,
              deletions: 3,
            },
          }),
      } satisfies Partial<GitWorkflowService.GitWorkflowService["Service"]>),
    ),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), {
        prefix: "t3-workflow-ticketing-projection-",
      }),
    ),
    Layer.provideMerge(NodeServices.layer),
  ),
);

function workflowConfiguration(workstreamId: string): WorkflowRunConfiguration {
  return {
    workflowGoal,
    runScope: [{ nodeId: `workflow:${workstreamId}`, label: "Workstream" }],
    defaultProviderInstanceId: providerInstanceId,
    providerOverrides: [],
    requiredSkills: [
      {
        nodeId: `workflow:${workstreamId}`,
        providerInstanceId,
        stage: "specification",
        skill: {
          name: "to-spec",
          path: "/skills/to-spec/SKILL.md",
          contentDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
        status: "available",
      },
      {
        nodeId: `workflow:${workstreamId}`,
        providerInstanceId,
        stage: "implementation",
        skill: {
          name: "implement",
          path: "/skills/implement/SKILL.md",
          contentDigest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        },
        status: "available",
      },
      {
        nodeId: `workflow:${workstreamId}`,
        providerInstanceId,
        stage: "review",
        skill: {
          name: "code-review",
          path: "/skills/code-review/SKILL.md",
          contentDigest: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        },
        status: "available",
      },
    ],
    fixedPoint,
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
  };
}

engineLayer("Workflow Specification through the public orchestration seam", (it) => {
  it.effect(
    "dispatches, drains the command receipt, and projects the native checkpoint and PRD",
    () =>
      Effect.gen(function* () {
        const engine = yield* OrchestrationEngineService;
        const snapshots = yield* ProjectionSnapshotQuery;
        const receipts = yield* OrchestrationCommandReceiptRepository;

        yield* engine.dispatch({
          type: "project.create",
          commandId: CommandId.make("workflow-projection-project-create"),
          projectId,
          title: "Workflow Projection Test",
          workspaceRoot: "/tmp/t3-workflow-specification-projection",
          defaultModelSelection: modelSelection,
          createdAt: now,
        });
        yield* engine.dispatch({
          type: "thread.create",
          commandId: CommandId.make("workflow-projection-origin-create"),
          threadId: originThreadId,
          projectId,
          title: "Wayfinder origin",
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
        });
        yield* engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make("workflow-projection-wayfinder-start"),
          threadId: originThreadId,
          message: {
            messageId: MessageId.make("workflow-projection-wayfinder-message"),
            role: "user",
            text: "Continue the structured Wayfinder map.",
            attachments: [],
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          skillInvocation: wayfinderInvocation,
          createdAt: now,
        });
        yield* engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("workflow-projection-wayfinder-running"),
          threadId: originThreadId,
          session: {
            threadId: originThreadId,
            status: "running",
            providerName: "codex",
            providerInstanceId,
            runtimeMode: "full-access",
            activeTurnId: TurnId.make("turn:wayfinder-projection"),
            lastError: null,
            updatedAt: now,
          },
          createdAt: now,
        });

        const afterWayfinder = yield* snapshots.getSnapshot();
        const originAfterWayfinder = afterWayfinder.threads.find(
          (thread) => thread.id === originThreadId,
        );
        const sourceInvocation = originAfterWayfinder?.latestTurn?.skillInvocation;
        assert.isDefined(sourceInvocation);
        assert.isDefined(sourceInvocation.action);
        assert.equal(sourceInvocation.action.id, "continue-map");
        const workstreamId = sourceInvocation.workstreamId;
        const sourceSkillRunId = sourceInvocation.skillRunId;
        const synchronizedAt = sourceInvocation.wayfinderSynchronizedAt ?? now;

        yield* engine.dispatch({
          type: "thread.workflow.attach",
          commandId: CommandId.make("workflow-projection-attach"),
          threadId: originThreadId,
          originThreadId,
          workflowGoal,
          confirmed: true,
          createdAt: now,
        });
        const afterAttach = yield* snapshots.getSnapshot();
        const attachment = afterAttach.threads.find(
          (thread) => thread.id === originThreadId,
        )?.workflowAttachment;
        assert.isDefined(attachment);
        assert.equal(attachment.sourceSkillRunId, sourceSkillRunId);
        const sourceArtifact = attachment.workflowGraph?.artifacts.find(
          (artifact) => artifact.kind === "wayfinder-map" && artifact.state === "current",
        );
        assert.isDefined(sourceArtifact);

        const configuration = workflowConfiguration(workstreamId);
        yield* engine.dispatch({
          type: "thread.workflow.run.preflight",
          commandId: CommandId.make("workflow-projection-run-preflight"),
          threadId: originThreadId,
          configuration,
          createdAt: now,
        });
        yield* engine.dispatch({
          type: "thread.workflow.run.confirm",
          commandId: CommandId.make("workflow-projection-run-confirm"),
          threadId: originThreadId,
          configuration,
          confirmed: true,
          createdAt: now,
        });
        yield* engine.dispatch({
          type: "thread.create",
          commandId: CommandId.make("workflow-projection-specification-create"),
          threadId: specificationThreadId,
          projectId,
          title: "Specification",
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
        });

        const specificationInvocation: ResolvedSkillInvocation = {
          skill: {
            name: "to-spec",
            path: "/skills/to-spec/SKILL.md",
            contentDigest:
              "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          },
          action: {
            id: "handoff-to-spec",
            sourceSkillRunId,
            sourceThreadId: originThreadId,
            canonicalReference: {
              number: 29,
              url: "https://github.com/naveed949/t3code/issues/29",
            },
            wayfinderSynchronizedAt: synchronizedAt,
            acknowledgedIncomplete: false,
          },
          execution: { mode: "generic", reason: "unregistered-skill" },
          reconnectWorkstreamId: workstreamId,
        };
        yield* engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make("workflow-projection-specification-start"),
          threadId: specificationThreadId,
          message: {
            messageId: MessageId.make("workflow-projection-specification-message"),
            role: "user",
            text: "Create the structured Workflow PRD.",
            attachments: [],
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          skillInvocation: specificationInvocation,
          createdAt: now,
        });
        yield* engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("workflow-projection-specification-running"),
          threadId: specificationThreadId,
          session: {
            threadId: specificationThreadId,
            status: "running",
            providerName: "codex",
            providerInstanceId,
            runtimeMode: "full-access",
            activeTurnId: TurnId.make("turn:specification-projection"),
            lastError: null,
            updatedAt: now,
          },
          createdAt: now,
        });

        const afterDispatch = yield* snapshots.getSnapshot();
        const dispatchedAttachment = afterDispatch.threads.find(
          (thread) => thread.id === originThreadId,
        )?.workflowAttachment;
        const dispatchedStage = dispatchedAttachment?.specificationStage;
        assert.isDefined(dispatchedStage);
        assert.equal(dispatchedStage.status, "running");
        assert.equal(dispatchedStage.providerInstanceId, providerInstanceId);

        const checkpointRequestId = ApprovalRequestId.make("workflow-projection-checkpoint");
        const checkpointCommandId = CommandId.make("workflow-projection-checkpoint-request");
        yield* engine.dispatch({
          type: "thread.activity.append",
          commandId: checkpointCommandId,
          threadId: specificationThreadId,
          activity: {
            id: EventId.make("workflow-projection-checkpoint-activity"),
            tone: "info",
            kind: "user-input.requested",
            summary: "Confirm the proposed specification test seam",
            payload: {
              requestId: checkpointRequestId,
              skillRunId: dispatchedStage.skillRunId,
              questions: [
                {
                  id: "seam",
                  header: "Test seam",
                  question: "Does the typed command to projection seam match your expectation?",
                  options: [
                    { label: "Yes", description: "Use the proposed seam." },
                    { label: "No", description: "Revise the proposed seam." },
                  ],
                },
              ],
            },
            turnId: TurnId.make("workflow-projection-specification-turn"),
            createdAt: checkpointedAt,
          },
          createdAt: checkpointedAt,
        });
        const afterCheckpoint = yield* snapshots.getSnapshot();
        const checkpointStage = afterCheckpoint.threads.find(
          (thread) => thread.id === originThreadId,
        )?.workflowAttachment?.specificationStage;
        assert.equal(checkpointStage?.status, "checkpoint");
        assert.equal(checkpointStage?.checkpoint?.status, "pending");

        yield* engine.dispatch({
          type: "thread.user-input.respond",
          commandId: CommandId.make("workflow-projection-checkpoint-response"),
          threadId: specificationThreadId,
          requestId: checkpointRequestId,
          answers: { seam: { selectedOptionLabel: "Yes" } },
          createdAt: resolvedAt,
        });
        const afterResponse = yield* snapshots.getSnapshot();
        const responseAttachment = afterResponse.threads.find(
          (thread) => thread.id === originThreadId,
        )?.workflowAttachment;
        const responseStage = responseAttachment?.specificationStage;
        assert.equal(responseStage?.status, "running");
        assert.equal(responseStage?.checkpoint?.status, "resolved");

        const completionCommandId = CommandId.make("workflow-projection-specification-complete");
        const completionResult = yield* engine.dispatch({
          type: "thread.workflow.specification.complete",
          commandId: completionCommandId,
          threadId: originThreadId,
          specificationThreadId,
          skillRunId: responseStage!.skillRunId,
          expectedWorkstreamVersion: responseAttachment?.workflowVersion ?? 0,
          sourceWayfinderArtifactId: sourceArtifact.id,
          prd: {
            version: 1,
            title: "Development Workflow",
            problemStatement: "The workflow needs a durable specification.",
            solution: "Persist a structured PRD artifact.",
            userStories: ["As a maintainer, I want an inspectable PRD."],
            implementationDecisions: ["Use the server Workflow Projection."],
            testingDecisions: ["Test the typed command and receipt-backed projection."],
            outOfScope: ["Provider prompt emulation."],
          },
          createdAt: completedAt,
        });
        const completionReceipt = yield* receipts.getByCommandId({
          commandId: completionCommandId,
        });
        if (Option.isNone(completionReceipt)) {
          throw new Error("completion command receipt was not persisted");
        }
        assert.equal(completionReceipt.value.status, "accepted");
        assert.equal(completionReceipt.value.resultSequence, completionResult.sequence);

        const projected = yield* snapshots.getSnapshot();
        const completedAttachment = projected.threads.find(
          (thread) => thread.id === originThreadId,
        )?.workflowAttachment;
        assert.equal(completedAttachment?.specificationStage?.status, "completed");
        assert.equal(completedAttachment?.workflowGraph?.artifacts.length, 2);
        const workflowPrd = completedAttachment?.workflowGraph?.artifacts.find(
          (artifact) => artifact.kind === "workflow-prd",
        );
        assert.deepEqual(workflowPrd && { version: workflowPrd.version }, { version: 1 });
        assert.equal(
          completedAttachment?.specificationStage?.artifactId,
          `workflow-prd:${workstreamId}:v1`,
        );
      }),
  );
});

ticketingEngineLayer(
  "Workflow Ticket Batch publication through the public orchestration seam",
  (it) => {
    it.effect(
      "dispatches the typed publication command, drains the reactor receipt, and projects exact tracker scope",
      () =>
        Effect.gen(function* () {
          const engine = yield* OrchestrationEngineService;
          const snapshots = yield* ProjectionSnapshotQuery;
          const receipts = yield* OrchestrationCommandReceiptRepository;
          const reactor = yield* TicketBatchPublicationReactor;
          const implementationReactor = yield* WorkflowTicketImplementationReactor;

          trackerCreatedIssues.length = 0;
          trackerLabels.length = 0;
          ticketPublicationReceipts.length = 0;

          yield* engine.dispatch({
            type: "project.create",
            commandId: CommandId.make("ticketing-projection-project-create"),
            projectId,
            title: "Workflow Ticketing Projection Test",
            workspaceRoot: "/tmp/t3-workflow-ticketing-projection",
            defaultModelSelection: modelSelection,
            createdAt: now,
          });
          yield* engine.dispatch({
            type: "thread.create",
            commandId: CommandId.make("ticketing-projection-origin-create"),
            threadId: originThreadId,
            projectId,
            title: "Wayfinder origin",
            modelSelection,
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: now,
          });
          yield* engine.dispatch({
            type: "thread.turn.start",
            commandId: CommandId.make("ticketing-projection-wayfinder-start"),
            threadId: originThreadId,
            message: {
              messageId: MessageId.make("ticketing-projection-wayfinder-message"),
              role: "user",
              text: "Continue the structured Wayfinder map.",
              attachments: [],
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            skillInvocation: wayfinderInvocation,
            createdAt: now,
          });
          yield* engine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make("ticketing-projection-wayfinder-running"),
            threadId: originThreadId,
            session: {
              threadId: originThreadId,
              status: "running",
              providerName: "codex",
              providerInstanceId,
              runtimeMode: "full-access",
              activeTurnId: TurnId.make("turn:ticketing-wayfinder-projection"),
              lastError: null,
              updatedAt: now,
            },
            createdAt: now,
          });

          const afterWayfinder = yield* snapshots.getSnapshot();
          const sourceInvocation = afterWayfinder.threads.find(
            (thread) => thread.id === originThreadId,
          )?.latestTurn?.skillInvocation;
          assert.isDefined(sourceInvocation);
          const workstreamId = sourceInvocation.workstreamId;
          const sourceSkillRunId = sourceInvocation.skillRunId;
          const synchronizedAt = sourceInvocation.wayfinderSynchronizedAt ?? now;

          yield* engine.dispatch({
            type: "thread.workflow.attach",
            commandId: CommandId.make("ticketing-projection-attach"),
            threadId: originThreadId,
            originThreadId,
            workflowGoal,
            confirmed: true,
            createdAt: now,
          });
          const afterAttach = yield* snapshots.getSnapshot();
          const attachment = afterAttach.threads.find(
            (thread) => thread.id === originThreadId,
          )?.workflowAttachment;
          assert.isDefined(attachment);
          const sourceArtifact = attachment.workflowGraph?.artifacts.find(
            (artifact) => artifact.kind === "wayfinder-map" && artifact.state === "current",
          );
          assert.isDefined(sourceArtifact);

          const baseConfiguration = workflowConfiguration(workstreamId);
          const configuration = {
            ...baseConfiguration,
            requiredSkills: [
              ...baseConfiguration.requiredSkills,
              {
                nodeId: `workflow:${workstreamId}`,
                providerInstanceId,
                stage: "ticketing" as const,
                skill: {
                  name: "to-tickets",
                  path: "/skills/to-tickets/SKILL.md",
                  contentDigest:
                    "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                },
                status: "available" as const,
              },
            ],
          };
          yield* engine.dispatch({
            type: "thread.workflow.run.preflight",
            commandId: CommandId.make("ticketing-projection-run-preflight"),
            threadId: originThreadId,
            configuration,
            createdAt: now,
          });
          yield* engine.dispatch({
            type: "thread.workflow.run.confirm",
            commandId: CommandId.make("ticketing-projection-run-confirm"),
            threadId: originThreadId,
            configuration,
            confirmed: true,
            createdAt: now,
          });
          yield* engine.dispatch({
            type: "thread.create",
            commandId: CommandId.make("ticketing-projection-specification-create"),
            threadId: specificationThreadId,
            projectId,
            title: "Specification",
            modelSelection,
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: now,
          });

          yield* engine.dispatch({
            type: "thread.turn.start",
            commandId: CommandId.make("ticketing-projection-specification-start"),
            threadId: specificationThreadId,
            message: {
              messageId: MessageId.make("ticketing-projection-specification-message"),
              role: "user",
              text: "Create the structured Workflow PRD.",
              attachments: [],
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            skillInvocation: {
              skill: {
                name: "to-spec",
                path: "/skills/to-spec/SKILL.md",
                contentDigest:
                  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              },
              action: {
                id: "handoff-to-spec",
                sourceSkillRunId,
                sourceThreadId: originThreadId,
                canonicalReference: {
                  number: 29,
                  url: "https://github.com/naveed949/t3code/issues/29",
                },
                wayfinderSynchronizedAt: synchronizedAt,
                acknowledgedIncomplete: false,
              },
              execution: { mode: "generic", reason: "unregistered-skill" },
              reconnectWorkstreamId: workstreamId,
            },
            createdAt: now,
          });
          yield* engine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make("ticketing-projection-specification-running"),
            threadId: specificationThreadId,
            session: {
              threadId: specificationThreadId,
              status: "running",
              providerName: "codex",
              providerInstanceId,
              runtimeMode: "full-access",
              activeTurnId: TurnId.make("turn:ticketing-specification-projection"),
              lastError: null,
              updatedAt: now,
            },
            createdAt: now,
          });
          const specificationSnapshot = yield* snapshots.getSnapshot();
          const specificationStage = specificationSnapshot.threads.find(
            (thread) => thread.id === originThreadId,
          )?.workflowAttachment?.specificationStage;
          assert.isDefined(specificationStage);

          const specificationCheckpointRequestId = ApprovalRequestId.make(
            "ticketing-projection-specification-checkpoint",
          );
          yield* engine.dispatch({
            type: "thread.activity.append",
            commandId: CommandId.make("ticketing-projection-specification-checkpoint-request"),
            threadId: specificationThreadId,
            activity: {
              id: EventId.make("ticketing-projection-specification-checkpoint-activity"),
              tone: "info",
              kind: "user-input.requested",
              summary: "Confirm the proposed specification test seam",
              payload: {
                requestId: specificationCheckpointRequestId,
                skillRunId: specificationStage.skillRunId,
                questions: [
                  {
                    id: "seam",
                    header: "Test seam",
                    question: "Does the typed command to projection seam match your expectation?",
                    options: [
                      { label: "Yes", description: "Use the proposed seam." },
                      { label: "No", description: "Revise the proposed seam." },
                    ],
                  },
                ],
              },
              turnId: TurnId.make("workflow-ticketing-specification-turn"),
              createdAt: checkpointedAt,
            },
            createdAt: checkpointedAt,
          });
          yield* engine.dispatch({
            type: "thread.user-input.respond",
            commandId: CommandId.make("ticketing-projection-specification-checkpoint-response"),
            threadId: specificationThreadId,
            requestId: specificationCheckpointRequestId,
            answers: { seam: { selectedOptionLabel: "Yes" } },
            createdAt: resolvedAt,
          });

          const afterSpecificationResponse = yield* snapshots.getSnapshot();
          const specificationResponseAttachment = afterSpecificationResponse.threads.find(
            (thread) => thread.id === originThreadId,
          )?.workflowAttachment;
          const specificationResponseStage = specificationResponseAttachment?.specificationStage;
          assert.isDefined(specificationResponseStage);
          const completionCommandId = CommandId.make("ticketing-projection-specification-complete");
          yield* engine.dispatch({
            type: "thread.workflow.specification.complete",
            commandId: completionCommandId,
            threadId: originThreadId,
            specificationThreadId,
            skillRunId: specificationResponseStage.skillRunId,
            expectedWorkstreamVersion: specificationResponseAttachment?.workflowVersion ?? 0,
            sourceWayfinderArtifactId: sourceArtifact.id,
            prd: {
              version: 1,
              title: "Development Workflow",
              problemStatement: "The workflow needs a durable specification.",
              solution: "Persist a structured PRD artifact.",
              userStories: ["As a maintainer, I want an inspectable PRD."],
              implementationDecisions: ["Use the server Workflow Projection."],
              testingDecisions: ["Test the typed command and receipt-backed projection."],
              outOfScope: ["Provider prompt emulation."],
            },
            createdAt: completedAt,
          });
          const completionReceipt = yield* receipts.getByCommandId({
            commandId: completionCommandId,
          });
          if (Option.isNone(completionReceipt)) {
            throw new Error("completion command receipt was not persisted");
          }
          assert.equal(completionReceipt.value.status, "accepted");

          const afterSpecification = yield* snapshots.getSnapshot();
          const completedAttachment = afterSpecification.threads.find(
            (thread) => thread.id === originThreadId,
          )?.workflowAttachment;
          assert.isDefined(completedAttachment);
          const workflowPrd = completedAttachment.workflowGraph?.artifacts.find(
            (artifact) => artifact.kind === "workflow-prd" && artifact.state === "current",
          );
          assert.isDefined(workflowPrd);

          yield* engine.dispatch({
            type: "thread.create",
            commandId: CommandId.make("ticketing-projection-ticketing-create"),
            threadId: ticketingThreadId,
            projectId,
            title: "Ticketing",
            modelSelection,
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: completedAt,
          });
          const ticketingStartCommandId = CommandId.make("ticketing-projection-ticketing-start");
          yield* engine.dispatch({
            type: "thread.turn.start",
            commandId: ticketingStartCommandId,
            threadId: ticketingThreadId,
            message: {
              messageId: MessageId.make("ticketing-projection-ticketing-message"),
              role: "user",
              text: "Prepare the approved Ticket Batch.",
              attachments: [],
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            skillInvocation: {
              skill: {
                name: "to-tickets",
                path: "/skills/to-tickets/SKILL.md",
                contentDigest:
                  "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
              },
              action: {
                id: "handoff-to-tickets",
                sourceSkillRunId: specificationResponseStage.skillRunId,
                sourceThreadId: specificationThreadId,
                sourceWorkflowPrdArtifactId: workflowPrd.id,
                sourceWorkflowPrdVersion: 1,
              },
              execution: { mode: "generic", reason: "unregistered-skill" },
              reconnectWorkstreamId: workstreamId,
            },
            createdAt: completedAt,
          });
          const ticketingStartReceipt = yield* receipts.getByCommandId({
            commandId: ticketingStartCommandId,
          });
          if (Option.isNone(ticketingStartReceipt)) {
            throw new Error("ticketing start command receipt was not persisted");
          }
          yield* engine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make("ticketing-projection-ticketing-running"),
            threadId: ticketingThreadId,
            session: {
              threadId: ticketingThreadId,
              status: "running",
              providerName: "codex",
              providerInstanceId,
              runtimeMode: "full-access",
              activeTurnId: TurnId.make("turn:ticketing-ticketing-projection"),
              lastError: null,
              updatedAt: completedAt,
            },
            createdAt: completedAt,
          });
          const afterTicketingDispatch = yield* snapshots.getSnapshot();
          const ticketingStage = afterTicketingDispatch.threads.find(
            (thread) => thread.id === originThreadId,
          )?.workflowAttachment?.ticketingStage;
          assert.isDefined(ticketingStage);
          assert.equal(ticketingStage.status, "running");

          const ticketingCheckpointRequestId = ApprovalRequestId.make(
            "ticketing-projection-ticketing-checkpoint",
          );
          const approvedTicketBatch = {
            id: "ticket-batch:development-workflow:v1",
            sourceWorkflowPrdArtifactId: workflowPrd.id,
            sourceWorkflowPrdVersion: 1,
            tickets: [
              {
                key: "ticket-batch-publication",
                title: "Publish and synchronize an approved Ticket Batch",
                body: "Publish the exact approved Ticket Batch and synchronize its tracker projection.",
                parentKey: null,
              },
            ],
            blockerEdges: [],
          } as const;
          yield* engine.dispatch({
            type: "thread.activity.append",
            commandId: CommandId.make("ticketing-projection-ticketing-checkpoint-request"),
            threadId: ticketingThreadId,
            activity: {
              id: EventId.make("ticketing-projection-ticketing-checkpoint-activity"),
              tone: "info",
              kind: "user-input.requested",
              summary: "Confirm Ticket Batch granularity and blocker edges",
              payload: {
                requestId: ticketingCheckpointRequestId,
                skillRunId: ticketingStage.skillRunId,
                batch: approvedTicketBatch,
                questions: [
                  {
                    id: "batch",
                    header: "Ticket Batch",
                    question: "Is this the exact approved Ticket Batch?",
                    options: [
                      { label: "Approve", description: "Publish only this batch." },
                      { label: "Revise", description: "Return to ticket planning." },
                    ],
                  },
                ],
              },
              turnId: TurnId.make("workflow-ticketing-ticketing-turn"),
              createdAt: "2026-08-08T12:01:00.000Z",
            },
            createdAt: "2026-08-08T12:01:00.000Z",
          });
          yield* engine.dispatch({
            type: "thread.user-input.respond",
            commandId: CommandId.make("ticketing-projection-ticketing-checkpoint-response"),
            threadId: ticketingThreadId,
            requestId: ticketingCheckpointRequestId,
            answers: { batch: { selectedOptionLabel: "Approve" } },
            createdAt: "2026-08-08T12:02:00.000Z",
          });

          const beforePublication = yield* snapshots.getSnapshot();
          const publicationAttachment = beforePublication.threads.find(
            (thread) => thread.id === originThreadId,
          )?.workflowAttachment;
          const publicationStage = publicationAttachment?.ticketingStage;
          assert.isDefined(publicationAttachment);
          assert.isDefined(publicationStage);
          assert.equal(publicationStage.status, "running");
          const publicationCommandId = CommandId.make("ticketing-projection-publication");
          yield* reactor.start();
          yield* implementationReactor.start();
          const publicationResult = yield* engine.dispatch({
            type: "thread.workflow.ticketing.publish",
            commandId: publicationCommandId,
            threadId: originThreadId,
            ticketingThreadId,
            skillRunId: publicationStage.skillRunId,
            expectedWorkstreamVersion: publicationAttachment.workflowVersion ?? 0,
            batch: approvedTicketBatch,
            confirmed: true,
            createdAt: "2026-08-08T12:03:00.000Z",
          });
          yield* reactor.drain;

          const publicationReceipt = yield* receipts.getByCommandId({
            commandId: publicationCommandId,
          });
          if (Option.isNone(publicationReceipt)) {
            throw new Error("publication command receipt was not persisted");
          }
          assert.equal(publicationReceipt.value.status, "accepted");
          assert.equal(publicationReceipt.value.resultSequence, publicationResult.sequence);
          assert.isTrue(
            ticketPublicationReceipts.some(
              (receipt) =>
                receipt.type === "workflow.ticket-batch.publication.progress" &&
                receipt.status === "synchronized" &&
                receipt.batchId === "ticket-batch:development-workflow:v1",
            ),
          );
          assert.deepEqual(trackerCreatedIssues, [37]);
          assert.include(trackerLabels, "ready-for-agent");
          assert.include(trackerLabels, "37:ready-for-agent");

          const projected = yield* snapshots.getSnapshot();
          const projectedAttachment = projected.threads.find(
            (thread) => thread.id === originThreadId,
          )?.workflowAttachment;
          assert.isDefined(projectedAttachment);
          assert.equal(projectedAttachment.ticketingStage?.status, "completed");
          assert.equal(projectedAttachment.trackerProjection?.status, "healthy");
          assert.equal(projectedAttachment.trackerProjection?.tickets.length, 2);
          assert.equal(
            projectedAttachment.trackerProjection?.tickets.find((ticket) => ticket.number === 37)
              ?.includedInRun,
            true,
          );
          assert.equal(
            projectedAttachment.trackerProjection?.tickets.find((ticket) => ticket.number === 38)
              ?.includedInRun,
            false,
          );
          const ticketNodes = projectedAttachment.workflowGraph?.nodes.filter(
            (node) => node.kind === "ticket",
          );
          assert.deepEqual(
            ticketNodes?.map((node) => [node.ticketKey, node.includedInRun]),
            [
              ["ticket-batch-publication", true],
              ["tracker:38", false],
            ],
          );
          assert.include(
            projectedAttachment.workflowRun?.configuration.runScope.map((scope) => scope.nodeId) ??
              [],
            "ticket:ticket-batch-publication",
          );
          assert.notInclude(
            projectedAttachment.workflowRun?.configuration.runScope.map((scope) => scope.nodeId) ??
              [],
            "ticket:tracker:38",
          );

          yield* engine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make("ticketing-projection-origin-ready"),
            threadId: originThreadId,
            session: {
              threadId: originThreadId,
              status: "ready",
              providerName: "codex",
              providerInstanceId,
              runtimeMode: "full-access",
              activeTurnId: null,
              lastError: null,
              updatedAt: "2026-08-08T12:03:30.000Z",
            },
            createdAt: "2026-08-08T12:03:30.000Z",
          });

          const automaticActionIdentity = `workflow-frontier:${projectedAttachment.workflowRun!.dispatchIdentity}:ticket:ticket-batch-publication`;
          const implementationStartCommandId = CommandId.make(
            ["server", "workflow-frontier", automaticActionIdentity].join(":"),
          );
          const workflowRunStartCommandId = CommandId.make(
            "ticketing-projection-workflow-run-start",
          );
          const workflowRunStartResult = yield* engine.dispatch({
            type: "thread.workflow.run.start",
            commandId: workflowRunStartCommandId,
            threadId: originThreadId,
            expectedWorkstreamVersion: projectedAttachment.workflowVersion ?? 0,
            confirmed: true,
            createdAt: "2026-08-08T12:04:00.000Z",
          });
          yield* implementationReactor.drain;
          const workflowRunStartReceipt = yield* receipts.getByCommandId({
            commandId: workflowRunStartCommandId,
          });
          if (Option.isNone(workflowRunStartReceipt)) {
            throw new Error("workflow run start command receipt was not persisted");
          }
          assert.equal(workflowRunStartReceipt.value.status, "accepted");
          assert.equal(
            workflowRunStartReceipt.value.resultSequence,
            workflowRunStartResult.sequence,
          );
          const implementationReceipt = yield* receipts.getByCommandId({
            commandId: implementationStartCommandId,
          });
          if (Option.isNone(implementationReceipt)) {
            throw new Error("implementation start command receipt was not persisted");
          }
          assert.equal(implementationReceipt.value.status, "accepted");
          assert.isAbove(
            implementationReceipt.value.resultSequence,
            workflowRunStartResult.sequence,
          );
          assert.isTrue(
            ticketPublicationReceipts.some(
              (receipt) =>
                receipt.type === "workflow.ticket-frontier.scheduled" &&
                receipt.workstreamId === workstreamId &&
                receipt.ticketNodeIds.includes("ticket:ticket-batch-publication"),
            ),
          );

          const afterImplementation = yield* snapshots.getSnapshot();
          const implementation = afterImplementation.threads.find(
            (thread) => thread.id === originThreadId,
          )?.workflowAttachment?.ticketImplementations?.[0];
          assert.isDefined(implementation);
          assert.equal(implementation.status, "implementing");
          assert.equal(implementation.fixedPoint, fixedPoint);
          assert.isNotNull(implementation.implementationThreadId);
          assert.isNotNull(implementation.implementationSkillRunId);
          assert.isTrue(
            ticketPublicationReceipts.some(
              (receipt) =>
                receipt.type === "workflow.ticket-implementation.progress" &&
                receipt.status === "implementing" &&
                receipt.actionIdentity === automaticActionIdentity,
            ),
          );

          yield* engine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make("ticketing-projection-implementation-running"),
            threadId: implementation.implementationThreadId!,
            session: {
              threadId: implementation.implementationThreadId!,
              status: "running",
              providerName: "codex",
              providerInstanceId,
              runtimeMode: "full-access",
              activeTurnId: TurnId.make("turn:ticket-implementation"),
              lastError: null,
              updatedAt: "2026-08-08T12:04:30.000Z",
            },
            createdAt: "2026-08-08T12:04:30.000Z",
          });
          yield* implementationReactor.drain;
          yield* engine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make("ticketing-projection-implementation-ready"),
            threadId: implementation.implementationThreadId!,
            session: {
              threadId: implementation.implementationThreadId!,
              status: "ready",
              providerName: "codex",
              providerInstanceId,
              runtimeMode: "full-access",
              activeTurnId: TurnId.make("turn:ticket-implementation"),
              lastError: null,
              updatedAt: "2026-08-08T12:05:00.000Z",
            },
            createdAt: "2026-08-08T12:05:00.000Z",
          });
          yield* implementationReactor.drain;

          const afterReviewDispatch = yield* snapshots.getSnapshot();
          const reviewing = afterReviewDispatch.threads.find(
            (thread) => thread.id === originThreadId,
          )?.workflowAttachment?.ticketImplementations?.[0];
          assert.isDefined(reviewing);
          assert.equal(reviewing.status, "reviewing");
          assert.equal(reviewing.diff?.fixedPoint, fixedPoint);
          assert.isNotNull(reviewing.reviewSkillRunId);

          yield* engine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make("ticketing-projection-review-running"),
            threadId: reviewing.implementationThreadId!,
            session: {
              threadId: reviewing.implementationThreadId!,
              status: "running",
              providerName: "codex",
              providerInstanceId,
              runtimeMode: "full-access",
              activeTurnId: TurnId.make("turn:ticket-implementation-review"),
              lastError: null,
              updatedAt: "2026-08-08T12:05:30.000Z",
            },
            createdAt: "2026-08-08T12:05:30.000Z",
          });
          yield* implementationReactor.drain;
          yield* engine.dispatch({
            type: "thread.message.assistant.delta",
            commandId: CommandId.make("ticketing-projection-review-result-delta"),
            threadId: reviewing.implementationThreadId!,
            messageId: MessageId.make("assistant:ticket-implementation-review"),
            turnId: TurnId.make("turn:ticket-implementation-review"),
            delta:
              '<t3-ticket-implementation-review-result>{"status":"must-fix","summary":"The pinned review found one ticket-specification finding.","findings":[{"severity":"must-fix","source":"ticket-specification","summary":"The implementation must retain the typed receipt boundary."}],"validation":[{"name":"focused orchestration tests","status":"passed","command":"vp test run apps/server/src/orchestration/decider.workflowTicketing.test.ts"}]}</t3-ticket-implementation-review-result>',
            createdAt: "2026-08-08T12:05:45.000Z",
          });
          yield* engine.dispatch({
            type: "thread.message.assistant.complete",
            commandId: CommandId.make("ticketing-projection-review-result-complete"),
            threadId: reviewing.implementationThreadId!,
            messageId: MessageId.make("assistant:ticket-implementation-review"),
            turnId: TurnId.make("turn:ticket-implementation-review"),
            createdAt: "2026-08-08T12:05:50.000Z",
          });
          yield* engine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make("ticketing-projection-review-ready"),
            threadId: reviewing.implementationThreadId!,
            session: {
              threadId: reviewing.implementationThreadId!,
              status: "ready",
              providerName: "codex",
              providerInstanceId,
              runtimeMode: "full-access",
              activeTurnId: TurnId.make("turn:ticket-implementation-review"),
              lastError: null,
              updatedAt: "2026-08-08T12:06:00.000Z",
            },
            createdAt: "2026-08-08T12:06:00.000Z",
          });
          yield* implementationReactor.drain;
          const correctionSnapshot = yield* snapshots.getSnapshot();
          const correcting = correctionSnapshot.threads.find(
            (thread) => thread.id === originThreadId,
          )?.workflowAttachment?.ticketImplementations?.[0];
          assert.isDefined(correcting);
          assert.equal(correcting.status, "implementing");
          assert.equal(correcting.correctionCycles?.length, 1);
          assert.equal(correcting.worktreePath, reviewing.worktreePath);
          assert.equal(correcting.branch, reviewing.branch);
          assert.equal(correcting.implementationThreadId, reviewing.implementationThreadId);
          assert.equal(correcting.fixedPoint, fixedPoint);
          assert.equal(correcting.acceptanceCriteria, reviewing.acceptanceCriteria);
          assert.equal(correcting.review?.findings[0]?.source, "ticket-specification");
          const correctionThread = correctionSnapshot.threads.find(
            (thread) => thread.id === correcting.implementationThreadId,
          );
          assert.isTrue(
            correctionThread?.messages.some(
              (message) =>
                message.role === "user" && message.text.includes("Run Correction Cycle 1"),
            ) ?? false,
          );

          const correctionTurnId =
            correctionThread?.latestTurn?.turnId ??
            TurnId.make("turn:ticket-implementation-correction");
          yield* engine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make("ticketing-projection-correction-running"),
            threadId: correcting.implementationThreadId!,
            session: {
              threadId: correcting.implementationThreadId!,
              status: "running",
              providerName: "codex",
              providerInstanceId,
              runtimeMode: "full-access",
              activeTurnId: correctionTurnId,
              lastError: null,
              updatedAt: "2026-08-08T12:06:30.000Z",
            },
            createdAt: "2026-08-08T12:06:30.000Z",
          });
          yield* implementationReactor.drain;
          yield* engine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make("ticketing-projection-correction-ready"),
            threadId: correcting.implementationThreadId!,
            session: {
              threadId: correcting.implementationThreadId!,
              status: "ready",
              providerName: "codex",
              providerInstanceId,
              runtimeMode: "full-access",
              activeTurnId: correctionTurnId,
              lastError: null,
              updatedAt: "2026-08-08T12:07:00.000Z",
            },
            createdAt: "2026-08-08T12:07:00.000Z",
          });
          yield* implementationReactor.drain;

          const afterCorrectionReviewDispatch = yield* snapshots.getSnapshot();
          const reviewingCorrection = afterCorrectionReviewDispatch.threads.find(
            (thread) => thread.id === originThreadId,
          )?.workflowAttachment?.ticketImplementations?.[0];
          assert.isDefined(reviewingCorrection);
          assert.equal(reviewingCorrection.status, "reviewing");
          assert.equal(reviewingCorrection.fixedPoint, fixedPoint);
          assert.isNotNull(reviewingCorrection.reviewSkillRunId);
          assert.notEqual(reviewingCorrection.reviewSkillRunId, reviewing.reviewSkillRunId);

          const correctionReviewThread = afterCorrectionReviewDispatch.threads.find(
            (thread) => thread.id === reviewingCorrection.implementationThreadId,
          );
          const correctionReviewTurnId =
            correctionReviewThread?.latestTurn?.turnId ??
            TurnId.make("turn:ticket-implementation-correction-review");
          const correctionReviewMessageId = MessageId.make(
            "assistant:ticket-implementation-correction-review",
          );
          yield* engine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make("ticketing-projection-correction-review-running"),
            threadId: reviewingCorrection.implementationThreadId!,
            session: {
              threadId: reviewingCorrection.implementationThreadId!,
              status: "running",
              providerName: "codex",
              providerInstanceId,
              runtimeMode: "full-access",
              activeTurnId: correctionReviewTurnId,
              lastError: null,
              updatedAt: "2026-08-08T12:07:30.000Z",
            },
            createdAt: "2026-08-08T12:07:30.000Z",
          });
          yield* implementationReactor.drain;
          yield* engine.dispatch({
            type: "thread.message.assistant.delta",
            commandId: CommandId.make("ticketing-projection-correction-review-result-delta"),
            threadId: reviewingCorrection.implementationThreadId!,
            messageId: correctionReviewMessageId,
            turnId: correctionReviewTurnId,
            delta:
              '<t3-ticket-implementation-review-result>{"status":"passed","summary":"The correction now satisfies the ticket specification.","findings":[{"severity":"suggestion","summary":"Keep the receipt assertion close to the projection assertion."}],"validation":[{"name":"focused orchestration tests","status":"passed","command":"vp test run apps/server/src/orchestration/decider.workflowTicketing.test.ts"}]}</t3-ticket-implementation-review-result>',
            createdAt: "2026-08-08T12:07:45.000Z",
          });
          yield* engine.dispatch({
            type: "thread.message.assistant.complete",
            commandId: CommandId.make("ticketing-projection-correction-review-result-complete"),
            threadId: reviewingCorrection.implementationThreadId!,
            messageId: correctionReviewMessageId,
            turnId: correctionReviewTurnId,
            createdAt: "2026-08-08T12:07:50.000Z",
          });
          yield* engine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make("ticketing-projection-correction-review-ready"),
            threadId: reviewingCorrection.implementationThreadId!,
            session: {
              threadId: reviewingCorrection.implementationThreadId!,
              status: "ready",
              providerName: "codex",
              providerInstanceId,
              runtimeMode: "full-access",
              activeTurnId: correctionReviewTurnId,
              lastError: null,
              updatedAt: "2026-08-08T12:08:00.000Z",
            },
            createdAt: "2026-08-08T12:08:00.000Z",
          });
          yield* implementationReactor.drain;
          const reviewReadySnapshot = yield* snapshots.getSnapshot();
          const reviewThread = reviewReadySnapshot.threads.find(
            (thread) => thread.id === reviewingCorrection.implementationThreadId,
          );
          assert.isDefined(reviewThread);
          const reviewedSnapshot = yield* snapshots.getSnapshot();
          const reviewed = reviewedSnapshot.threads.find((thread) => thread.id === originThreadId)
            ?.workflowAttachment?.ticketImplementations?.[0];
          assert.isDefined(reviewed);
          assert.equal(reviewed.status, "reviewed");
          assert.equal(reviewed.review?.status, "passed");
          assert.equal(reviewed.review?.fixedPoint, fixedPoint);
          assert.equal(reviewed.validation[0]?.status, "passed");
          assert.equal(reviewed.correctionCycles?.length, 1);
          assert.isTrue(
            ticketPublicationReceipts.some(
              (receipt) =>
                receipt.type === "workflow.ticket-implementation.progress" &&
                receipt.status === "reviewed",
            ),
          );
        }),
    );
  },
);
