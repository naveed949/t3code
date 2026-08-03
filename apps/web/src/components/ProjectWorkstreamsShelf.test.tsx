import { renderToStaticMarkup } from "react-dom/server";
import { EnvironmentId, ProjectId, SkillRunId, ThreadId, WorkstreamId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { ProjectWorkstreamsShelf } from "./ProjectWorkstreamsShelf";

it("lists active and completed Workstreams with their project context", () => {
  const markup = renderToStaticMarkup(
    <ProjectWorkstreamsShelf
      workstreams={[
        {
          id: WorkstreamId.make("workstream:1"),
          environmentId: EnvironmentId.make("environment:1"),
          projectId: ProjectId.make("project:1"),
          status: "completed",
          linkedThreadIds: [ThreadId.make("thread:1")],
          skillRuns: [],
          ticketThreads: [],
          wayfinderMap: {
            canonicalReference: {
              number: 42,
              title: "Release map",
              url: "https://github.com/t3tools/t3code/issues/42",
              state: "closed",
            },
            destination: "A release plan.",
            notes: "",
            decisionsSoFar: [],
            fogOfWar: [],
            outOfScope: [],
            tickets: [],
            frontier: [],
            lastSynchronizedAt: "2026-01-02T00:00:00.000Z",
          },
          wayfinderSynchronization: null,
          workflowAttachment: null,
          readiness: { ready: true, blockers: [] },
        },
      ]}
      projectTitleByKey={new Map([["environment:1:project:1", "T3 Code"]])}
      onOpenThread={() => undefined}
    />,
  );
  expect(markup).toContain('aria-label="Project Workstreams"');
  expect(markup).toContain("Release map");
  expect(markup).toContain("T3 Code · completed");
});

it("keeps an attached Development Workflow linked to its Origin Thread", () => {
  const markup = renderToStaticMarkup(
    <ProjectWorkstreamsShelf
      workstreams={[
        {
          id: WorkstreamId.make("workstream:workflow"),
          environmentId: EnvironmentId.make("environment:1"),
          projectId: ProjectId.make("project:1"),
          status: "active",
          linkedThreadIds: [ThreadId.make("thread:stale-linked-run")],
          skillRuns: [],
          ticketThreads: [],
          wayfinderMap: null,
          wayfinderSynchronization: null,
          workflowAttachment: {
            originThreadId: ThreadId.make("thread:origin"),
            workstreamId: WorkstreamId.make("workstream:workflow"),
            sourceSkillRunId: SkillRunId.make("skill-run:workflow-origin"),
            workflowGoal: "Ship the Development Workflow.",
            backfilledWayfinderData: {},
            observationCursor: {
              sourceSkillRunId: SkillRunId.make("skill-run:workflow-origin"),
              observedAt: "2026-08-03T12:00:00.000Z",
            },
            attachedAt: "2026-08-03T12:00:00.000Z",
          },
          readiness: {
            ready: false,
            blockers: [
              { kind: "canonical-map-missing" },
              { kind: "tracker-synchronization-unhealthy", status: "unknown" },
            ],
          },
        },
      ]}
      projectTitleByKey={new Map([["environment:1:project:1", "T3 Code"]])}
      onOpenThread={() => undefined}
    />,
  );

  expect(markup).toContain("Ship the Development Workflow.");
  expect(markup).toContain("Development workflow");
});
