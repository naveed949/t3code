import { renderToStaticMarkup } from "react-dom/server";
import { EnvironmentId, ProjectId, ThreadId, WorkstreamId } from "@t3tools/contracts";
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
