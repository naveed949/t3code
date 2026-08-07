import {
  CommandId,
  EnvironmentId,
  ORCHESTRATION_WS_METHODS,
  ProjectId,
  SkillRunId,
  ThreadId,
  type ClientOrchestrationCommand,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "../connection/model.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as RpcSession from "../rpc/session.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import {
  archiveThread,
  acknowledgeWorkflowArtifact,
  attachWorkflow,
  createProject,
  controlWayfinderResearch,
  completeWorkflowSpecification,
  dismissWorkflowAttachmentHint,
  mutateWayfinder,
  publishWayfinderDraft,
  publishWorkflowTicketBatch,
  reconcileWayfinderMap,
  resolveWorkflowStale,
  settleThread,
  stopThreadSession,
  unsettleThread,
  viewWorkflowArtifacts,
} from "./commands.ts";

const TEST_CRYPTO_LAYER = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => new Uint8Array(size),
    digest: (_algorithm, data) => Effect.succeed(data),
  }),
);

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});

const makeSupervisor = Effect.fn("TestEnvironmentCommands.makeSupervisor")(function* (
  dispatched: ClientOrchestrationCommand[],
) {
  const client = {
    [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command: ClientOrchestrationCommand) =>
      Effect.sync(() => {
        dispatched.push(command);
        return { sequence: dispatched.length };
      }),
  } as unknown as WsRpcProtocolClient;
  const session: RpcSession.RpcSession = {
    client,
    initialConfig: Effect.never,
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
  return EnvironmentSupervisor.EnvironmentSupervisor.of({
    target: TARGET,
    state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
    session: yield* SubscriptionRef.make(Option.some(session)),
    prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
});

describe("environment commands", () => {
  it.effect("adds generated command metadata", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);

      const result = yield* createProject({
        projectId: ProjectId.make("project-1"),
        title: "Project",
        workspaceRoot: "/workspace/project",
        createdAt: "2026-06-06T00:00:00.000Z",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(result).toEqual({ sequence: 1 });
      expect(dispatched).toEqual([
        {
          type: "project.create",
          commandId: "00000000-0000-4000-8000-000000000000",
          projectId: "project-1",
          title: "Project",
          workspaceRoot: "/workspace/project",
          createdAt: "2026-06-06T00:00:00.000Z",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("preserves caller metadata for idempotent queued commands", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);

      yield* stopThreadSession({
        commandId: CommandId.make("queued-command"),
        threadId: ThreadId.make("thread-1"),
        createdAt: "2026-06-06T00:01:00.000Z",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(dispatched).toEqual([
        {
          type: "thread.session.stop",
          commandId: "queued-command",
          threadId: "thread-1",
          createdAt: "2026-06-06T00:01:00.000Z",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("does not add timestamps to commands without createdAt", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);

      yield* archiveThread({
        commandId: CommandId.make("archive-command"),
        threadId: ThreadId.make("thread-1"),
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(dispatched).toEqual([
        {
          type: "thread.archive",
          commandId: "archive-command",
          threadId: "thread-1",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("dispatches settle and unsettle commands without timestamps", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);

      yield* settleThread({
        commandId: CommandId.make("settle-command"),
        threadId: ThreadId.make("thread-1"),
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));
      yield* unsettleThread({
        commandId: CommandId.make("unsettle-command"),
        threadId: ThreadId.make("thread-1"),
        reason: "user",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(dispatched).toEqual([
        {
          type: "thread.settle",
          commandId: "settle-command",
          threadId: "thread-1",
        },
        {
          type: "thread.unsettle",
          commandId: "unsettle-command",
          threadId: "thread-1",
          reason: "user",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("dispatches a Skill Run-scoped Wayfinder publication command", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);
      yield* publishWayfinderDraft({
        commandId: CommandId.make("publish-command"),
        threadId: ThreadId.make("thread-1"),
        skillRunId: SkillRunId.make("skill-run:1"),
        confirmed: true,
        createdAt: "2026-06-06T00:03:00.000Z",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(dispatched).toEqual([
        {
          type: "thread.wayfinder.publish",
          commandId: "publish-command",
          threadId: "thread-1",
          skillRunId: "skill-run:1",
          confirmed: true,
          createdAt: "2026-06-06T00:03:00.000Z",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("dispatches explicit workflow attachment, marker, and resolution commands", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);

      yield* attachWorkflow({
        commandId: CommandId.make("attach-workflow-command"),
        threadId: ThreadId.make("thread-origin"),
        originThreadId: ThreadId.make("thread-origin"),
        workflowGoal: "Ship the workflow.",
        confirmed: true,
        createdAt: "2026-08-03T12:00:00.000Z",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));
      yield* dismissWorkflowAttachmentHint({
        commandId: CommandId.make("dismiss-workflow-hint-command"),
        threadId: ThreadId.make("thread-origin"),
        createdAt: "2026-08-03T12:01:00.000Z",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));
      yield* viewWorkflowArtifacts({
        commandId: CommandId.make("view-workflow-artifacts-command"),
        threadId: ThreadId.make("thread-origin"),
        createdAt: "2026-08-03T12:02:00.000Z",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));
      yield* acknowledgeWorkflowArtifact({
        commandId: CommandId.make("acknowledge-workflow-artifact-command"),
        threadId: ThreadId.make("thread-origin"),
        artifactId: "wayfinder-map:29:revision:2",
        createdAt: "2026-08-03T12:03:00.000Z",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));
      yield* resolveWorkflowStale({
        commandId: CommandId.make("resolve-workflow-stale-command"),
        threadId: ThreadId.make("thread-origin"),
        resolution: "accept-upstream",
        confirmed: true,
        createdAt: "2026-08-03T12:04:00.000Z",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(dispatched).toEqual([
        {
          type: "thread.workflow.attach",
          commandId: "attach-workflow-command",
          threadId: "thread-origin",
          originThreadId: "thread-origin",
          workflowGoal: "Ship the workflow.",
          confirmed: true,
          createdAt: "2026-08-03T12:00:00.000Z",
        },
        {
          type: "thread.workflow-attachment.hint.dismiss",
          commandId: "dismiss-workflow-hint-command",
          threadId: "thread-origin",
          createdAt: "2026-08-03T12:01:00.000Z",
        },
        {
          type: "thread.workflow.artifacts.view",
          commandId: "view-workflow-artifacts-command",
          threadId: "thread-origin",
          createdAt: "2026-08-03T12:02:00.000Z",
        },
        {
          type: "thread.workflow.artifact.acknowledge",
          commandId: "acknowledge-workflow-artifact-command",
          threadId: "thread-origin",
          artifactId: "wayfinder-map:29:revision:2",
          createdAt: "2026-08-03T12:03:00.000Z",
        },
        {
          type: "thread.workflow.stale.resolve",
          commandId: "resolve-workflow-stale-command",
          threadId: "thread-origin",
          resolution: "accept-upstream",
          confirmed: true,
          createdAt: "2026-08-03T12:04:00.000Z",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("dispatches a structured Specification completion command", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);

      yield* completeWorkflowSpecification({
        commandId: CommandId.make("specification-complete-command"),
        threadId: ThreadId.make("thread-origin"),
        specificationThreadId: ThreadId.make("thread-specification"),
        skillRunId: SkillRunId.make("skill-run:to-spec"),
        expectedWorkstreamVersion: 0,
        sourceWayfinderArtifactId: "wayfinder-map:29:revision:2",
        prd: {
          version: 1,
          title: "Workflow specification",
          problemStatement: "The workflow needs a durable specification.",
          solution: "Persist a structured PRD artifact.",
          userStories: ["As a maintainer, I want an inspectable PRD."],
          implementationDecisions: ["Use the Workflow Projection."],
          testingDecisions: ["Test the typed command and receipt drain."],
          outOfScope: ["Provider prompt emulation."],
        },
        createdAt: "2026-08-03T12:05:00.000Z",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(dispatched).toEqual([
        {
          type: "thread.workflow.specification.complete",
          commandId: "specification-complete-command",
          threadId: "thread-origin",
          specificationThreadId: "thread-specification",
          skillRunId: "skill-run:to-spec",
          expectedWorkstreamVersion: 0,
          sourceWayfinderArtifactId: "wayfinder-map:29:revision:2",
          prd: {
            version: 1,
            title: "Workflow specification",
            problemStatement: "The workflow needs a durable specification.",
            solution: "Persist a structured PRD artifact.",
            userStories: ["As a maintainer, I want an inspectable PRD."],
            implementationDecisions: ["Use the Workflow Projection."],
            testingDecisions: ["Test the typed command and receipt drain."],
            outOfScope: ["Provider prompt emulation."],
          },
          createdAt: "2026-08-03T12:05:00.000Z",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("dispatches an exact Ticket Batch publication command", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);

      yield* publishWorkflowTicketBatch({
        commandId: CommandId.make("ticket-batch-publication-command"),
        threadId: ThreadId.make("thread-origin"),
        ticketingThreadId: ThreadId.make("thread-ticketing"),
        skillRunId: SkillRunId.make("skill-run:to-tickets"),
        expectedWorkstreamVersion: 3,
        batch: {
          id: "ticket-batch:workflow:v1",
          sourceWorkflowPrdArtifactId: "workflow-prd:workstream:v1",
          sourceWorkflowPrdVersion: 1,
          tickets: [
            {
              key: "ticket-one",
              title: "Ticket one",
              body: "Implement ticket one.",
              parentKey: null,
            },
          ],
          blockerEdges: [],
        },
        confirmed: true,
        createdAt: "2026-08-03T12:06:00.000Z",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(dispatched).toEqual([
        {
          type: "thread.workflow.ticketing.publish",
          commandId: "ticket-batch-publication-command",
          threadId: "thread-origin",
          ticketingThreadId: "thread-ticketing",
          skillRunId: "skill-run:to-tickets",
          expectedWorkstreamVersion: 3,
          batch: {
            id: "ticket-batch:workflow:v1",
            sourceWorkflowPrdArtifactId: "workflow-prd:workstream:v1",
            sourceWorkflowPrdVersion: 1,
            tickets: [
              {
                key: "ticket-one",
                title: "Ticket one",
                body: "Implement ticket one.",
                parentKey: null,
              },
            ],
            blockerEdges: [],
          },
          confirmed: true,
          createdAt: "2026-08-03T12:06:00.000Z",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("uses the command id to scope a structured Wayfinder mutation", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);
      yield* mutateWayfinder({
        commandId: CommandId.make("mutation-command"),
        threadId: ThreadId.make("thread-1"),
        skillRunId: SkillRunId.make("skill-run:1"),
        action: { kind: "close-ticket", ticketNumber: 8 },
        confirmed: false,
        createdAt: "2026-06-06T00:04:00.000Z",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(dispatched).toEqual([
        {
          type: "thread.wayfinder.mutate",
          commandId: "mutation-command",
          actionId: "mutation-command",
          threadId: "thread-1",
          skillRunId: "skill-run:1",
          action: { kind: "close-ticket", ticketNumber: 8 },
          confirmed: false,
          createdAt: "2026-06-06T00:04:00.000Z",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("dispatches a typed Wayfinder research control command", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);
      yield* controlWayfinderResearch({
        commandId: CommandId.make("research-command"),
        threadId: ThreadId.make("thread-1"),
        skillRunId: SkillRunId.make("skill-run:1"),
        action: { kind: "retry-ticket", ticketNumber: 8 },
        createdAt: "2026-06-06T00:04:30.000Z",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(dispatched).toEqual([
        {
          type: "thread.wayfinder.research",
          commandId: "research-command",
          threadId: "thread-1",
          skillRunId: "skill-run:1",
          action: { kind: "retry-ticket", ticketNumber: 8 },
          createdAt: "2026-06-06T00:04:30.000Z",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("dispatches an immediate revision-scoped Wayfinder reconciliation command", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);
      yield* reconcileWayfinderMap({
        commandId: CommandId.make("refresh-command"),
        threadId: ThreadId.make("thread-1"),
        skillRunId: SkillRunId.make("skill-run:1"),
        reason: "mutation",
        expectedRevision: "revision:before-mutation",
        createdAt: "2026-07-30T16:05:00.000Z",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(dispatched).toEqual([
        {
          type: "thread.wayfinder.reconcile",
          commandId: "refresh-command",
          threadId: "thread-1",
          skillRunId: "skill-run:1",
          reason: "mutation",
          expectedRevision: "revision:before-mutation",
          createdAt: "2026-07-30T16:05:00.000Z",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );
});
