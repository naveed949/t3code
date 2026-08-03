import { renderToStaticMarkup } from "react-dom/server";
import { SkillRunId, ThreadId, WorkstreamId } from "@t3tools/contracts";
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
