import { renderToStaticMarkup } from "react-dom/server";
import {
  ApprovalRequestId,
  CommandId,
  ProviderInstanceId,
  SkillRunId,
  ThreadId,
  WorkstreamId,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { WorkflowAttachmentCard } from "./WorkflowAttachmentCard";

it("renders a structured attachment hint with explicit origin and goal confirmation", () => {
  const markup = renderToStaticMarkup(
    <WorkflowAttachmentCard
      originThreadId={ThreadId.make("thread-origin")}
      hint={{
        status: "available",
        sourceSkillRunId: SkillRunId.make("skill-run:origin"),
        workstreamId: WorkstreamId.make("workstream:origin"),
        backfilledWayfinderData: {},
        offeredAt: "2026-08-03T12:00:00.000Z",
        updatedAt: "2026-08-03T12:00:00.000Z",
      }}
      attachment={null}
      onDismiss={() => undefined}
      onAttach={() => undefined}
    />,
  );

  expect(markup).toContain('aria-label="Attach Development Workflow"');
  expect(markup).toContain("Workflow Goal");
  expect(markup).toContain("Origin Thread");
  expect(markup).toContain("Attach Workstream");
});

it("renders a durable reopen control once attached", () => {
  const markup = renderToStaticMarkup(
    <WorkflowAttachmentCard
      originThreadId={ThreadId.make("thread-origin")}
      hint={null}
      attachment={{
        originThreadId: ThreadId.make("thread-origin"),
        workstreamId: WorkstreamId.make("workstream:origin"),
        sourceSkillRunId: SkillRunId.make("skill-run:origin"),
        workflowGoal: "Ship the workflow.",
        backfilledWayfinderData: {},
        observationCursor: {
          sourceSkillRunId: SkillRunId.make("skill-run:origin"),
          observedAt: "2026-08-03T12:00:00.000Z",
        },
        attachedAt: "2026-08-03T12:00:00.000Z",
      }}
      onDismiss={() => undefined}
      onAttach={() => undefined}
      onOpenWorkstream={() => undefined}
    />,
  );

  expect(markup).toContain('aria-label="Attached Development Workflow"');
  expect(markup).toContain("Open Workstream");
});

it("surfaces durable upstream markers and the allowed stale resolution", () => {
  const markup = renderToStaticMarkup(
    <WorkflowAttachmentCard
      originThreadId={ThreadId.make("thread-origin")}
      hint={null}
      attachment={{
        originThreadId: ThreadId.make("thread-origin"),
        workstreamId: WorkstreamId.make("workstream:origin"),
        sourceSkillRunId: SkillRunId.make("skill-run:origin"),
        workflowGoal: "Ship the workflow.",
        backfilledWayfinderData: {},
        observationCursor: {
          sourceSkillRunId: SkillRunId.make("skill-run:origin"),
          observedAt: "2026-08-03T12:05:00.000Z",
        },
        workflowGraph: {
          artifacts: [
            {
              id: "wayfinder-map:29:revision:2",
              logicalId: "wayfinder-map:29",
              kind: "wayfinder-map",
              state: "current",
              lineage: {
                workstreamId: WorkstreamId.make("workstream:origin"),
                sourceSkillRunId: SkillRunId.make("skill-run:origin"),
                sourceStage: "reconciliation",
                upstreamVersion: "revision:2",
              },
              upstreamSynchronizedAt: "2026-08-03T12:05:00.000Z",
              importedAt: "2026-08-03T12:05:00.000Z",
              marker: {
                kind: "changed",
                state: "unread",
                markedAt: "2026-08-03T12:05:00.000Z",
              },
            },
          ],
          nodes: [
            {
              id: "workflow:workstream:origin",
              kind: "workstream",
              state: "stale",
              sourceArtifactId: "wayfinder-map:29:revision:2",
              resolution: { status: "required", allowed: ["accept-upstream"] },
              staleAt: "2026-08-03T12:05:00.000Z",
            },
          ],
          unreadArtifactCount: 33,
          updatedAt: "2026-08-03T12:05:00.000Z",
        },
        attachedAt: "2026-08-03T12:00:00.000Z",
      }}
      onDismiss={() => undefined}
      onAttach={() => undefined}
      onViewArtifacts={() => undefined}
      onAcknowledgeArtifact={() => undefined}
      onResolveStale={() => undefined}
    />,
  );

  expect(markup).toContain("33 new or changed upstream artifacts.");
  expect(markup).toContain("Mark viewed");
  expect(markup).toContain("Acknowledge latest update");
  expect(markup).toContain("Accept upstream update");
});

it("renders exact Workflow Run provider controls and preflight action", () => {
  const provider = ProviderInstanceId.make("codex");
  const markup = renderToStaticMarkup(
    <WorkflowAttachmentCard
      originThreadId={ThreadId.make("thread-origin")}
      hint={null}
      attachment={{
        originThreadId: ThreadId.make("thread-origin"),
        workstreamId: WorkstreamId.make("workstream:origin"),
        sourceSkillRunId: SkillRunId.make("skill-run:origin"),
        workflowGoal: "Ship the workflow.",
        backfilledWayfinderData: {},
        observationCursor: {
          sourceSkillRunId: SkillRunId.make("skill-run:origin"),
          observedAt: "2026-08-03T12:00:00.000Z",
        },
        attachedAt: "2026-08-03T12:00:00.000Z",
      }}
      onDismiss={() => undefined}
      onAttach={() => undefined}
      defaultProviderInstanceId={provider}
      providerOptions={[provider]}
      requiredSkillsByProvider={new Map([[provider, []]])}
      onPreflightRun={() => undefined}
      onConfirmRun={() => undefined}
    />,
  );

  expect(markup).toContain("Default Provider");
  expect(markup).toContain("Workstream override");
  expect(markup).toContain("Run read-only preflight");
});

it("renders the server-projected Baseline Refresh preview and confirmation", () => {
  const provider = ProviderInstanceId.make("codex");
  const originThreadId = ThreadId.make("thread-origin");
  const workstreamId = WorkstreamId.make("workstream:origin");
  const markup = renderToStaticMarkup(
    <WorkflowAttachmentCard
      originThreadId={originThreadId}
      hint={null}
      attachment={{
        originThreadId,
        workstreamId,
        sourceSkillRunId: SkillRunId.make("skill-run:origin"),
        workflowGoal: "Ship the workflow.",
        backfilledWayfinderData: {},
        observationCursor: {
          sourceSkillRunId: SkillRunId.make("skill-run:origin"),
          observedAt: "2026-08-03T12:00:00.000Z",
        },
        workflowRun: {
          configuration: {
            workflowGoal: "Ship the workflow.",
            runScope: [{ nodeId: "ticket:43", label: "Repair workflow" }],
            defaultProviderInstanceId: provider,
            providerOverrides: [],
            requiredSkills: [],
            fixedPoint: "fixed-point",
            workstreamBaseline: "feature/development-workflow",
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
              pushBaseline: false,
              createDraftPullRequest: false,
            },
          },
          status: "confirmed",
          authorityGranted: true,
          confirmedAt: "2026-08-03T12:00:00.000Z",
          dispatchIdentity: CommandId.make("workflow-run:origin"),
          immutableAtDispatch: "2026-08-03T12:00:00.000Z",
        },
        baselineRefresh: {
          status: "ready",
          baselineBranch: "feature/development-workflow",
          remoteTarget: "origin/main",
          currentCommit: "current-sha",
          sourceCommit: "source-sha",
          incomingCommits: [{ sha: "source-sha", title: "Refresh the baseline" }],
          incomingFiles: [{ path: "src/workflow.ts", additions: 3, deletions: 1 }],
          affectedTickets: [
            {
              nodeId: "ticket:43",
              ticketNumber: 43,
              state: "integrated",
              reason: "Incoming baseline commits overlap the integrated Ticket diff.",
            },
          ],
          validations: [],
          failure: null,
          allowedActions: [
            { id: "preflight", label: "Refresh preview", enabled: true, reason: null },
            {
              id: "confirm",
              label: "Confirm baseline refresh",
              enabled: true,
              reason: null,
            },
          ],
          requestedAt: "2026-08-03T12:00:00.000Z",
          updatedAt: "2026-08-03T12:00:00.000Z",
        },
        attachedAt: "2026-08-03T12:00:00.000Z",
      }}
      onDismiss={() => undefined}
      onAttach={() => undefined}
      onPreflightBaselineRefresh={() => undefined}
      onConfirmBaselineRefresh={() => undefined}
    />,
  );

  expect(markup).toContain("Baseline Refresh");
  expect(markup).toContain("Refresh the baseline");
  expect(markup).toContain("src/workflow.ts");
  expect(markup).toContain("Ticket #43");
  expect(markup).toContain("Confirm baseline refresh");
});

it("surfaces the durable Specification checkpoint", () => {
  const markup = renderToStaticMarkup(
    <WorkflowAttachmentCard
      originThreadId={ThreadId.make("thread-origin")}
      hint={null}
      attachment={{
        originThreadId: ThreadId.make("thread-origin"),
        workstreamId: WorkstreamId.make("workstream:origin"),
        sourceSkillRunId: SkillRunId.make("skill-run:origin"),
        workflowGoal: "Ship the workflow.",
        backfilledWayfinderData: {},
        observationCursor: {
          sourceSkillRunId: SkillRunId.make("skill-run:origin"),
          observedAt: "2026-08-03T12:00:00.000Z",
        },
        specificationStage: {
          status: "checkpoint",
          workstreamId: WorkstreamId.make("workstream:origin"),
          nodeId: "workflow:workstream:origin",
          originThreadId: ThreadId.make("thread-origin"),
          specificationThreadId: ThreadId.make("thread-specification"),
          skillRunId: SkillRunId.make("skill-run:to-spec"),
          providerInstanceId: ProviderInstanceId.make("codex"),
          skill: {
            name: "to-spec",
            path: "/skills/to-spec/SKILL.md",
            contentDigest: `sha256:${"a".repeat(64)}`,
          },
          checkpoint: {
            requestId: ApprovalRequestId.make("request:seam"),
            kind: "specification-test-seam",
            workstreamId: WorkstreamId.make("workstream:origin"),
            originThreadId: ThreadId.make("thread-origin"),
            specificationThreadId: ThreadId.make("thread-specification"),
            skillRunId: SkillRunId.make("skill-run:to-spec"),
            questions: [
              {
                id: "seam",
                header: "Test seam",
                question: "Does this seam match?",
                options: [{ label: "Yes", description: "Use it." }],
              },
            ],
            status: "pending",
            requestedAt: "2026-08-03T12:01:00.000Z",
          },
          startedAt: "2026-08-03T12:00:00.000Z",
          updatedAt: "2026-08-03T12:01:00.000Z",
        },
        attachedAt: "2026-08-03T12:00:00.000Z",
      }}
      onDismiss={() => undefined}
      onAttach={() => undefined}
    />,
  );

  expect(markup).toContain('aria-label="Specification stage"');
  expect(markup).toContain("Specification: checkpoint");
  expect(markup).toContain("Native test-seam checkpoint waiting for a response");
});
