import { describe, expect, it } from "vite-plus/test";

import { SkillRunId, ThreadId, WorkstreamId } from "@t3tools/contracts";

import {
  WORKFLOW_VISUAL_EDGE_LIMIT,
  WORKFLOW_VISUAL_NODE_LIMIT,
  deriveWorkflowWorkspaceModel,
  type WorkflowWorkspaceStageId,
} from "./workflowWorkspace.ts";
import type { WayfinderWorkflowViewModel } from "./wayfinderWorkflow.ts";

function createModel(ticketCount = 5): WayfinderWorkflowViewModel {
  const tickets = Array.from({ length: ticketCount }, (_, index) => {
    const number = index + 1;
    return {
      id: `ticket:${number}` as const,
      number,
      title: `Ticket ${number}`,
      classification: "task",
      state:
        number === 1
          ? ({ kind: "runnable", label: "Runnable" } as const)
          : number === 2
            ? ({ kind: "active", label: "Active" } as const)
            : ({ kind: "blocked", label: "Blocked" } as const),
      attention:
        number === 2
          ? ({ kind: "recovery", label: "Recover ticket 2." } as const)
          : ({ kind: "none", label: "No node attention required." } as const),
      evidence: [{ label: "Canonical ticket" }],
      history: [`Canonical state: ${number === 3 ? "closed" : "open"}.`],
      lineage: {
        blockedBy: number === 3 ? [1] : [],
        enables: number === 1 ? [3] : [],
      },
      linkedThreadId: number === 2 ? ThreadId.make("wayfinder-ticket:workflow:2") : null,
      allowedActions: [],
      accessibilityLabel: `Ticket #${number}: Ticket ${number}.`,
    };
  });

  return {
    panel: {
      stageSpine: [{ id: "wayfinder", label: "Wayfinder", state: "completed" }],
      milestone: {
        number: 99,
        title: "Workflow goal",
        url: "https://github.com/naveed949/t3code/issues/99",
      },
      attention: { kind: "decision", label: "A decision is required." },
      activeRuns: [{ kind: "ticket", ticketNumber: 2, label: "Ticket #2 is active." }],
      ticketFrontier: [{ id: "ticket:1", number: 1, title: "Ticket 1" }],
      progress: { completed: 1, total: ticketCount, label: "1 completed ticket." },
    },
    outline: tickets,
    accessibilitySummary: "Workflow summary.",
  };
}

describe("deriveWorkflowWorkspaceModel", () => {
  it("creates typed stage, milestone, ticket, and execution nodes with deterministic edges", () => {
    const model = deriveWorkflowWorkspaceModel({
      viewModel: createModel(),
      selectedNodeId: "ticket:1",
      expandedStageIds: new Set<WorkflowWorkspaceStageId>(["wayfinder", "ticketing"]),
      filter: "all",
    });

    expect(model.stages.map((stage) => stage.id)).toEqual([
      "wayfinder",
      "specification",
      "ticketing",
      "implementation",
      "publication",
    ]);
    expect(model.nodes.filter((node) => node.kind === "stage")).toHaveLength(5);
    expect(model.nodes.find((node) => node.id === "milestone:99")).toMatchObject({
      kind: "milestone",
      stageId: "wayfinder",
      marker: null,
    });
    expect(model.nodes.find((node) => node.id === "ticket:2")).toMatchObject({
      kind: "ticket",
      state: { kind: "active" },
      attention: { kind: "recovery" },
    });
    expect(model.nodes.find((node) => node.id === "run:ticket:2")).toMatchObject({
      kind: "run",
      stageId: "implementation",
      state: { kind: "active" },
    });
    expect(model.edges).toEqual(
      expect.arrayContaining([
        { id: "dependency:1:3", from: "ticket:1", to: "ticket:3", kind: "dependency" },
        { id: "execution:ticket:2", from: "ticket:2", to: "run:ticket:2", kind: "execution" },
      ]),
    );
  });

  it("bounds the visual projection while retaining the complete outline and directional boundaries", () => {
    const base = createModel(WORKFLOW_VISUAL_NODE_LIMIT + 8);
    const model = deriveWorkflowWorkspaceModel({
      viewModel: {
        ...base,
        outline: base.outline.map((node) =>
          node.number === 4 ? { ...node, lineage: { blockedBy: [1], enables: [] } } : node,
        ),
      },
      selectedNodeId: "ticket:1",
      expandedStageIds: new Set<WorkflowWorkspaceStageId>(["wayfinder"]),
      filter: "frontier",
    });

    expect(model.outline).toHaveLength(WORKFLOW_VISUAL_NODE_LIMIT + 8);
    expect(model.visualProjection.hiddenNodeCount).toBeGreaterThan(0);
    expect(model.visualProjection.visibleNodeIds.length).toBeLessThanOrEqual(
      WORKFLOW_VISUAL_NODE_LIMIT,
    );
    expect(model.edges.length).toBeLessThanOrEqual(WORKFLOW_VISUAL_EDGE_LIMIT);
    expect(model.visualProjection.boundaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ direction: "downstream", hiddenNodeCount: expect.any(Number) }),
      ]),
    );
    expect(
      model.visualProjection.boundaries.every((boundary) => boundary.hiddenNodeCount > 0),
    ).toBe(true);
  });

  it("keeps selected nodes visible while reserving the bound for graph scaffolding", () => {
    const selectedNodeId = `ticket:${WORKFLOW_VISUAL_NODE_LIMIT + 8}`;
    const model = deriveWorkflowWorkspaceModel({
      viewModel: createModel(WORKFLOW_VISUAL_NODE_LIMIT + 8),
      selectedNodeId,
      expandedStageIds: new Set<WorkflowWorkspaceStageId>([
        "wayfinder",
        "specification",
        "ticketing",
        "implementation",
        "publication",
      ]),
      filter: "all",
    });

    expect(model.visualProjection.visibleNodeIds.length).toBeLessThanOrEqual(
      WORKFLOW_VISUAL_NODE_LIMIT,
    );
    expect(model.visualProjection.visibleNodeIds).toContain(selectedNodeId);
  });

  it("reports hidden predecessor and successor regions with the correct direction", () => {
    const base = createModel(5);
    const model = deriveWorkflowWorkspaceModel({
      viewModel: {
        ...base,
        outline: base.outline.map((node) =>
          node.number === 4
            ? { ...node, lineage: { blockedBy: [1], enables: [] } }
            : node.number === 5
              ? { ...node, lineage: { blockedBy: [], enables: [1] } }
              : node,
        ),
      },
      selectedNodeId: "ticket:1",
      expandedStageIds: new Set<WorkflowWorkspaceStageId>(["wayfinder"]),
      filter: "frontier",
    });

    expect(model.visualProjection.boundaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ direction: "upstream", hiddenNodeCount: expect.any(Number) }),
        expect.objectContaining({ direction: "downstream", hiddenNodeCount: expect.any(Number) }),
      ]),
    );
  });

  it("preserves existing positions when a bounded delta adds a new node", () => {
    const first = deriveWorkflowWorkspaceModel({
      viewModel: createModel(3),
      selectedNodeId: "ticket:1",
      expandedStageIds: new Set<WorkflowWorkspaceStageId>(["ticketing"]),
      filter: "all",
    });
    const previousPositions = Object.fromEntries(
      first.nodes.map((node) => [node.id, node.position] as const),
    );
    const second = deriveWorkflowWorkspaceModel({
      viewModel: createModel(4),
      selectedNodeId: "ticket:1",
      expandedStageIds: new Set<WorkflowWorkspaceStageId>(["ticketing"]),
      filter: "all",
      previousPositions,
    });

    for (const node of first.nodes) {
      expect(second.nodes.find((candidate) => candidate.id === node.id)?.position).toEqual(
        node.position,
      );
    }
    expect(second.nodes.find((node) => node.id === "ticket:4")?.position).not.toBeUndefined();
    expect(second.nodes.find((node) => node.id === "ticket:4")?.position.y).toBeGreaterThan(
      first.nodes.find((node) => node.id === "ticket:3")!.position.y,
    );
  });

  it("expands a stage intentionally and reports state markers without motion requirements", () => {
    const model = deriveWorkflowWorkspaceModel({
      viewModel: createModel(3),
      selectedNodeId: "ticket:2",
      expandedStageIds: new Set<WorkflowWorkspaceStageId>(["wayfinder", "ticketing"]),
      filter: "attention",
    });

    expect(model.visualProjection.expandedStageIds).toEqual(["ticketing", "wayfinder"]);
    expect(model.nodes.find((node) => node.id === "ticket:2")?.attention.kind).toBe("recovery");
    expect(model.accessibilitySummary).toContain("Complete Workflow Outline");
  });

  it("surfaces durable stale and unread artifact state in the visual projection", () => {
    const model = deriveWorkflowWorkspaceModel({
      viewModel: createModel(3),
      workflowGraph: {
        artifacts: [
          {
            id: "wayfinder-map:99:revision:2",
            logicalId: "wayfinder-map:99",
            kind: "wayfinder-map",
            state: "current",
            lineage: {
              workstreamId: WorkstreamId.make("workstream:workflow"),
              sourceSkillRunId: SkillRunId.make("skill-run:workflow"),
              sourceStage: "attachment",
              upstreamVersion: "revision:2",
            },
            upstreamSynchronizedAt: "2026-01-03T00:00:00.000Z",
            importedAt: "2026-01-03T00:00:00.000Z",
            marker: {
              kind: "changed",
              state: "unread",
              markedAt: "2026-01-03T00:00:00.000Z",
            },
          },
        ],
        nodes: [
          {
            id: "workflow:workflow",
            kind: "workstream",
            state: "stale",
            sourceArtifactId: "wayfinder-map:99:revision:2",
            resolution: { status: "required", allowed: ["accept-upstream"] },
            staleAt: "2026-01-03T00:00:00.000Z",
          },
        ],
        unreadArtifactCount: 1,
        updatedAt: "2026-01-03T00:00:00.000Z",
      },
      selectedNodeId: "ticket:1",
      expandedStageIds: new Set<WorkflowWorkspaceStageId>(["wayfinder"]),
      filter: "attention",
    });

    expect(model.stages.find((stage) => stage.id === "wayfinder")?.state).toBe("stale");
    expect(model.nodes.find((node) => node.id === "milestone:99")).toMatchObject({
      state: { kind: "stale" },
      marker: "changed",
    });
    expect(model.nodes.find((node) => node.kind === "artifact")).toMatchObject({
      stageId: "wayfinder",
      marker: "changed",
      subtitle: expect.stringContaining("revision:2"),
    });
    expect(model.edges).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "lineage" })]),
    );
  });
});
