import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { WayfinderWorkflowViewModel } from "@t3tools/client-runtime/state/wayfinder-workflow";

import { WorkflowWorkspace } from "./WorkflowWorkspace.tsx";

const model: WayfinderWorkflowViewModel = {
  panel: {
    stageSpine: [{ id: "wayfinder", label: "Wayfinder", state: "attention" }],
    milestone: {
      number: 34,
      title: "Compound graph",
      url: "https://github.com/naveed949/t3code/issues/34",
    },
    attention: { kind: "checkpoint", label: "A workflow checkpoint needs review." },
    activeRuns: [{ kind: "ticket", ticketNumber: 1, label: "Ticket #1 is active." }],
    ticketFrontier: [{ id: "ticket:1", number: 1, title: "Render graph" }],
    progress: { completed: 0, total: 1, label: "No completed tickets." },
  },
  outline: [
    {
      id: "ticket:1",
      number: 1,
      title: "Render graph",
      classification: "task",
      state: { kind: "runnable", label: "Runnable" },
      attention: { kind: "checkpoint", label: "Ticket checkpoint needs review." },
      evidence: [{ label: "Canonical ticket" }],
      history: ["Canonical state: open."],
      lineage: { blockedBy: [], enables: [] },
      linkedThreadId: null,
      allowedActions: [],
      accessibilityLabel: "Ticket #1: Render graph.",
    },
  ],
  accessibilitySummary: "Workflow summary.",
};

describe("WorkflowWorkspace", () => {
  it("renders a deterministic bounded graph with accessible state markers and no motion classes", () => {
    const markup = renderToStaticMarkup(
      <WorkflowWorkspace model={model} selectedNodeId="ticket:1" onSelectNode={() => {}} />,
    );

    expect(markup).toContain('data-workflow-workspace="expanded"');
    expect(markup).toContain('data-workflow-layout="deterministic"');
    expect(markup).toContain('data-workflow-motion="static"');
    expect(markup).toContain('data-workflow-visual-projection="bounded"');
    expect(markup).toContain('data-workflow-stage-container="ticketing"');
    expect(markup).toContain('data-workflow-node-kind="ticket"');
    expect(markup).toContain('data-workflow-node-state="runnable"');
    expect(markup).toContain('data-workflow-node-attention="checkpoint"');
    expect(markup).toContain("Complete Workflow Outline");
    expect(markup).not.toMatch(/animate-|transition-/);
  });
});
