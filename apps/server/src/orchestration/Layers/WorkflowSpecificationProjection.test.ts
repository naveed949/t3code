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
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

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
