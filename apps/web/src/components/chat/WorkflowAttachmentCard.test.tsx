import { renderToStaticMarkup } from "react-dom/server";
import { ProviderInstanceId, SkillRunId, ThreadId, WorkstreamId } from "@t3tools/contracts";
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
