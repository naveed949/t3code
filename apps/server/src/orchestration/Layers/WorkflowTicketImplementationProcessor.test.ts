import { describe, expect, it } from "vite-plus/test";

import type { WorkflowGraphNode, WorkflowTicketImplementation } from "@t3tools/contracts";

import type { GitBaselineRefreshPreview } from "../../git/GitWorkflowService.ts";
import { baselineRefreshImpacts } from "./WorkflowTicketImplementationProcessor.ts";

describe("WorkflowTicketImplementationProcessor", () => {
  it("retains committed integrated diffs and already-stale Tickets in refresh impacts", () => {
    const integrated = {
      nodeId: "ticket:43",
      ticketNumber: 43,
      status: "integrated",
      diff: {
        fixedPoint: "fixed-point",
        files: [{ path: "src/workflow.ts", additions: 4, deletions: 1 }],
        additions: 4,
        deletions: 1,
        capturedAt: "2026-08-09T00:00:00.000Z",
      },
    } as unknown as WorkflowTicketImplementation;
    const stale = {
      id: "ticket:44",
      kind: "ticket",
      ticketKey: "ticket-44",
      ticketNumber: 44,
      title: "Stale ticket",
      state: "stale",
      sourceArtifactId: null,
      includedInRun: true,
      resolution: { status: "required", allowed: ["accept-upstream"] },
    } as WorkflowGraphNode;
    const attachment = {
      ticketImplementations: [integrated],
      workflowGraph: { nodes: [stale] },
    } as unknown as NonNullable<Parameters<typeof baselineRefreshImpacts>[0]>;
    const preview: GitBaselineRefreshPreview = {
      currentCommit: "baseline-before",
      sourceCommit: "baseline-after",
      incomingCommits: [{ sha: "incoming", title: "Update workflow" }],
      incomingFiles: [{ path: "src/workflow.ts", additions: 2, deletions: 0 }],
    };

    expect(baselineRefreshImpacts(attachment, preview)).toEqual([
      {
        nodeId: "ticket:43",
        ticketNumber: 43,
        state: "integrated",
        reason: "Incoming baseline commits overlap the integrated Ticket diff.",
      },
      {
        nodeId: "ticket:44",
        ticketNumber: 44,
        state: "stale",
        reason: "The Ticket is already stale and must remain visible during refresh.",
      },
    ]);
  });
});
