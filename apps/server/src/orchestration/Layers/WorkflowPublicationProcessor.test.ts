import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, expect, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  ProjectId,
  ThreadId,
  type ChangeRequest,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type WorkflowAttachment,
  type WayfinderMapProjection,
  type WorkflowPublication,
  type VcsListRefsResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { IssueTracker } from "../../nativeSkills/IssueTracker.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  RuntimeReceiptBus,
  type OrchestrationRuntimeReceipt,
} from "../Services/RuntimeReceiptBus.ts";
import { makeWorkflowPublicationProcessor } from "./WorkflowPublicationProcessor.ts";
import * as SourceControlProvider from "../../sourceControl/SourceControlProvider.ts";
import { SourceControlProviderRegistry } from "../../sourceControl/SourceControlProviderRegistry.ts";

const now = "2026-08-10T12:00:00.000Z";
const baselineCommit = "baseline-publication-sha";
const headBranch = "feature/development-workflow";
const targetBranch = "main";

function publication(
  input: {
    readonly baselineCommit?: string;
    readonly commits?: ReadonlyArray<{ readonly sha: string; readonly title: string }>;
  } = {},
): WorkflowPublication {
  return {
    status: "publishing",
    remoteTarget: "origin/main",
    remote: "origin",
    headBranch,
    targetBranch,
    baselineCommit: input.baselineCommit ?? baselineCommit,
    commits: [...(input.commits ?? [{ sha: "ticket-44-sha", title: "Publish Workstream" }])],
    title: "Workflow: Development Workflow",
    body: "## Workstream\n\nShip the workflow.\n\nCloses #29",
    authority: { pushBaseline: true, createDraftPullRequest: true },
    authorityGranted: true,
    failure: null,
    allowedActions: [],
    requestedAt: now,
    updatedAt: now,
  };
}

function attachmentFor(inputPublication: WorkflowPublication): WorkflowAttachment {
  const ticketNodeId = "ticket:44";
  return {
    workstreamId: "workstream:44",
    sourceSkillRunId: "skill-run:44",
    workflowGoal: "Ship the workflow",
    backfilledWayfinderData: {} as WorkflowAttachment["backfilledWayfinderData"],
    observationCursor: {} as WorkflowAttachment["observationCursor"],
    workflowGraph: {
      artifacts: [],
      nodes: [
        {
          id: ticketNodeId,
          kind: "ticket",
          ticketKey: "ticket-44",
          ticketNumber: 44,
          title: "Publish Workstream PR",
          state: "current",
          sourceArtifactId: null,
          includedInRun: true,
          resolution: { status: "not-required" },
        },
      ],
      unreadArtifactCount: 0,
      updatedAt: now,
    },
    workflowRun: {
      configuration: {
        workflowGoal: "Ship the workflow",
        runScope: [{ nodeId: ticketNodeId, label: "Publish Workstream PR" }],
        defaultProviderInstanceId: "codex",
        providerOverrides: [],
        requiredSkills: [],
        fixedPoint: "fixed-point-sha",
        workstreamBaseline: headBranch,
        remoteTarget: "origin/main",
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
          mutateTracker: true,
          pushBaseline: true,
          createDraftPullRequest: true,
        },
      },
      status: "confirmed",
      authorityGranted: true,
      confirmedAt: now,
      dispatchIdentity: "command:run",
      immutableAtDispatch: now,
      automationStatus: "idle",
    },
    trackerProjection: {
      status: "healthy",
      canonicalReference: {
        number: 29,
        title: "Development Workflow",
        url: "https://github.com/naveed949/t3code/issues/29",
        state: "open",
      },
      tickets: [
        {
          key: "ticket-44",
          number: 44,
          title: "Publish Workstream PR",
          url: "https://github.com/naveed949/t3code/issues/44",
          state: "closed",
          parentNumber: 29,
          blockedBy: [],
          blocks: [],
          includedInRun: true,
          integration: {
            status: "integrated",
            baseline: baselineCommit,
            reviewedAt: now,
            synchronizedAt: now,
          },
        },
      ],
      synchronizedAt: now,
    },
    ticketImplementations: [
      { nodeId: ticketNodeId, status: "integrated" },
    ] as unknown as NonNullable<WorkflowAttachment["ticketImplementations"]>,
    publication: inputPublication,
    workflowVersion: 4,
    attachedAt: now,
  } as unknown as WorkflowAttachment;
}

function changeRequest(
  input: {
    readonly headCommitSha?: string;
    readonly isDraft?: boolean;
  } = {},
): ChangeRequest {
  return {
    provider: "github",
    number: 144,
    title: "Workflow: Development Workflow",
    url: "https://github.com/naveed949/t3code/pull/144",
    baseRefName: targetBranch,
    headRefName: headBranch,
    state: "open",
    updatedAt: Option.none(),
    isDraft: input.isDraft ?? true,
    headCommitSha: input.headCommitSha ?? baselineCommit,
    isCrossRepository: false,
    checksState: "pending",
    reviewState: "pending",
  };
}

function publicationEvent(
  attachment: WorkflowAttachment,
): Extract<OrchestrationEvent, { readonly type: "thread.workflow-publication-requested" }> {
  const threadId = ThreadId.make("thread:publication");
  return {
    sequence: 1,
    eventId: EventId.make("event:publication"),
    aggregateKind: "thread",
    aggregateId: threadId,
    type: "thread.workflow-publication-requested",
    occurredAt: now,
    commandId: CommandId.make("command:publication"),
    causationEventId: null,
    correlationId: CommandId.make("command:publication"),
    metadata: {},
    payload: { threadId, attachment },
  };
}

function makeProvider(input: {
  readonly requests: ReadonlyArray<ChangeRequest>;
  readonly onCreate: (
    request: Parameters<
      SourceControlProvider.SourceControlProvider["Service"]["createChangeRequest"]
    >[0],
  ) => void;
}) {
  let listCalls = 0;
  const provider = SourceControlProvider.SourceControlProvider.of({
    kind: "github",
    listChangeRequests: () => Effect.succeed(listCalls++ < 2 ? [] : input.requests),
    getChangeRequest: () => Effect.succeed(input.requests[0]!),
    createChangeRequest: (request) => Effect.sync(() => input.onCreate(request)),
    getRepositoryCloneUrls: () => Effect.die("unexpected repository read"),
    createRepository: () => Effect.die("unexpected repository write"),
    getDefaultBranch: () => Effect.die("unexpected default branch read"),
    checkoutChangeRequest: () => Effect.die("unexpected checkout"),
  });
  return provider;
}

function makeDependencies(input: {
  readonly attachment: WorkflowAttachment;
  readonly provider: SourceControlProvider.SourceControlProvider["Service"];
  readonly preview: {
    readonly baselineCommit: string;
    readonly commits: ReadonlyArray<{ sha: string; title: string }>;
  };
  readonly onPush: () => void;
  readonly onDispatch: (command: OrchestrationCommand) => Effect.Effect<void>;
  readonly receipts: Array<OrchestrationRuntimeReceipt>;
}) {
  const threadId = ThreadId.make("thread:publication");
  const projectId = ProjectId.make("project:publication");
  const readModel = {
    snapshotSequence: 0,
    projects: [{ id: projectId, workspaceRoot: "/repo" }],
    threads: [
      { id: threadId, projectId, worktreePath: null, workflowAttachment: input.attachment },
    ],
    updatedAt: now,
  } as unknown as OrchestrationReadModel;
  const repository = {
    canonicalKey: "github.com/naveed949/t3code",
    owner: "naveed949",
    name: "t3code",
  };

  return Layer.mergeAll(
    NodeServices.layer,
    Layer.succeed(OrchestrationEngineService, {
      readEvents: () => Stream.empty,
      dispatch: (command) => input.onDispatch(command).pipe(Effect.as({ sequence: 2 })),
      streamDomainEvents: Stream.empty,
      latestSequence: Effect.succeed(1),
    }),
    Layer.mock(ProjectionSnapshotQuery)({ getSnapshot: () => Effect.succeed(readModel) }),
    Layer.mock(GitWorkflowService)({
      listRefs: () =>
        Effect.succeed({
          refs: [
            {
              name: headBranch,
              current: false,
              isDefault: false,
              worktreePath: "/integration",
            },
          ],
          isRepo: true,
          hasPrimaryRemote: true,
          nextCursor: null,
          totalCount: 1,
        } satisfies VcsListRefsResult),
      previewPublication: () => Effect.succeed(input.preview),
      pushCurrentBranch: () =>
        Effect.sync(input.onPush).pipe(
          Effect.as({ status: "pushed" as const, branch: headBranch }),
        ),
    }),
    Layer.mock(IssueTracker)({
      resolveProjectRepository: () => Effect.succeed(repository),
      loadWayfinderMap: () =>
        Effect.succeed({
          kind: "loaded" as const,
          map: {
            canonicalReference: {
              number: 29,
              title: "Development Workflow",
              url: "https://github.com/naveed949/t3code/issues/29",
              state: "open" as const,
            },
          },
        } as unknown as WayfinderMapProjection),
    }),
    Layer.mock(SourceControlProviderRegistry)({
      resolveHandle: () => Effect.succeed({ provider: input.provider, context: null }),
    }),
    Layer.succeed(RuntimeReceiptBus, {
      publish: (receipt) => Effect.sync(() => input.receipts.push(receipt)),
      streamEventsForTest: Stream.empty,
    }),
  );
}

it.effect("pushes and creates a draft only after the approved publication is revalidated", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const dispatched: OrchestrationCommand[] = [];
      const receipts: OrchestrationRuntimeReceipt[] = [];
      const created: Array<
        Parameters<SourceControlProvider.SourceControlProvider["Service"]["createChangeRequest"]>[0]
      > = [];
      let pushes = 0;
      const request = changeRequest();
      const attachment = attachmentFor(publication());
      const provider = makeProvider({
        requests: [request],
        onCreate: (input) => created.push(input),
      });
      const dependencies = makeDependencies({
        attachment,
        provider,
        preview: {
          baselineCommit,
          commits: [{ sha: "ticket-44-sha", title: "Publish Workstream" }],
        },
        onPush: () => pushes++,
        onDispatch: (command) => Effect.sync(() => dispatched.push(command)),
        receipts,
      });
      const process = yield* makeWorkflowPublicationProcessor.pipe(Effect.provide(dependencies));
      yield* process(publicationEvent(attachment));
      const command = dispatched[0];

      assert.strictEqual(pushes, 1);
      assert.strictEqual(created.length, 1);
      assert.strictEqual(created[0]?.draft, true);
      assert.deepStrictEqual(
        receipts
          .filter(
            (
              receipt,
            ): receipt is Extract<
              OrchestrationRuntimeReceipt,
              { readonly type: "workflow.publication.progress" }
            > => receipt.type === "workflow.publication.progress",
          )
          .map((receipt) => receipt.status),
        ["publishing", "published-for-review"],
      );
      assert.strictEqual(dispatched.length, 1);
      assert(command !== undefined);
      if (command?.type === "thread.workflow.publication.update") {
        assert.strictEqual(command.publication.status, "published-for-review");
        assert.strictEqual(command.publication.changeRequest?.number, request.number);
      }
    }),
  ),
);

it.effect("blocks the push when the approved baseline changes before publication", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const dispatched: OrchestrationCommand[] = [];
      const receipts: OrchestrationRuntimeReceipt[] = [];
      let pushes = 0;
      const attachment = attachmentFor(publication());
      const provider = makeProvider({
        requests: [],
        onCreate: () => assert.fail("create must not run"),
      });
      const dependencies = makeDependencies({
        attachment,
        provider,
        preview: {
          baselineCommit: "changed-baseline-sha",
          commits: [{ sha: "changed-sha", title: "Changed" }],
        },
        onPush: () => pushes++,
        onDispatch: (command) => Effect.sync(() => dispatched.push(command)),
        receipts,
      });
      const process = yield* makeWorkflowPublicationProcessor.pipe(Effect.provide(dependencies));
      yield* process(publicationEvent(attachment));
      const command = dispatched[0];

      assert.strictEqual(pushes, 0);
      assert(command !== undefined);
      if (command?.type === "thread.workflow.publication.update") {
        assert.strictEqual(command.publication.status, "needs-recovery");
        expect(command.publication.failure).toContain("changed after approval");
      }
    }),
  ),
);
