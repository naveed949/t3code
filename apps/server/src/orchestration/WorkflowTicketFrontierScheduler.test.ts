import {
  CommandId,
  ProviderInstanceId,
  ThreadId,
  WorkstreamId,
  type WorkflowGraph,
  type WorkflowRun,
  type WorkflowTrackerProjection,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  selectWorkflowTicketFrontier,
  type WorkflowSchedulerWorkstream,
} from "./WorkflowTicketFrontierScheduler.ts";

const now = "2026-08-08T12:00:00.000Z";
const providerInstanceId = ProviderInstanceId.make("codex");

function workflowRun(
  workstreamId: WorkstreamId,
  input: {
    readonly scope: ReadonlyArray<string>;
    readonly executionLimit?: 1 | 2;
    readonly automationStatus?: "running" | "draining" | "paused";
    readonly dispatchIdentity?: string;
  },
): WorkflowRun {
  return {
    configuration: {
      workflowGoal: "Ship the workstream.",
      runScope: input.scope.map((nodeId) => ({ nodeId, label: nodeId })),
      defaultProviderInstanceId: providerInstanceId,
      providerOverrides: [],
      requiredSkills: input.scope.flatMap((nodeId) => [
        {
          nodeId,
          providerInstanceId,
          stage: "implementation" as const,
          skill: {
            name: "implement",
            path: "/skills/implement/SKILL.md",
            contentDigest:
              "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
          },
          status: "available" as const,
        },
        {
          nodeId,
          providerInstanceId,
          stage: "review" as const,
          skill: {
            name: "code-review",
            path: "/skills/code-review/SKILL.md",
            contentDigest:
              "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          },
          status: "available" as const,
        },
      ]),
      fixedPoint: "2514a152021bf9522e501ceeae5e9ab292af29b6",
      workstreamBaseline: "feature/development-workflow",
      remoteTarget: "origin/feature/development-workflow",
      targetVerification: {
        fixedPoint: "verified",
        workstreamBaseline: "verified",
        remoteTarget: "verified",
      },
      environmentAutomationCapacity: 2,
      executionLimit: input.executionLimit ?? 2,
      authority: {
        createWorktree: true,
        runProvider: true,
        mutateTracker: false,
        pushBaseline: false,
        createDraftPullRequest: false,
      },
    },
    status: "confirmed",
    authorityGranted: true,
    confirmedAt: now,
    dispatchIdentity: CommandId.make(input.dispatchIdentity ?? `run:${workstreamId}`),
    immutableAtDispatch: now,
    ...(input.automationStatus === undefined ? {} : { automationStatus: input.automationStatus }),
  };
}

function graph(
  workstreamId: WorkstreamId,
  tickets: ReadonlyArray<{
    readonly id: string;
    readonly number: number;
    readonly key: string;
    readonly held?: boolean;
  }>,
): WorkflowGraph {
  return {
    artifacts: [],
    nodes: [
      {
        id: `workflow:${workstreamId}`,
        kind: "workstream",
        state: "current",
        sourceArtifactId: null,
        resolution: { status: "not-required" },
      },
      ...tickets.map((ticket) => ({
        id: ticket.id,
        kind: "ticket" as const,
        ticketKey: ticket.key,
        ticketNumber: ticket.number,
        title: ticket.key,
        state: "current" as const,
        sourceArtifactId: null,
        includedInRun: true,
        ...(ticket.held === undefined ? {} : { held: ticket.held }),
        resolution: { status: "not-required" as const },
      })),
    ],
    edges: [],
    unreadArtifactCount: 0,
    updatedAt: now,
  };
}

function tracker(
  tickets: ReadonlyArray<{
    readonly number: number;
    readonly key: string;
    readonly blockedBy?: ReadonlyArray<number>;
    readonly state?: "open" | "closed";
    readonly integrated?: boolean;
  }>,
): WorkflowTrackerProjection {
  return {
    status: "healthy",
    canonicalReference: {
      number: 29,
      title: "Development Workflow",
      url: "https://github.com/naveed949/t3code/issues/29",
      state: "open",
    },
    tickets: tickets.map((ticket) => ({
      key: ticket.key,
      number: ticket.number,
      title: ticket.key,
      url: `https://github.com/naveed949/t3code/issues/${ticket.number}`,
      state: ticket.state ?? "open",
      body: `Acceptance criteria for ${ticket.key}.`,
      parentNumber: 29,
      blockedBy: [...(ticket.blockedBy ?? [])],
      blocks: [],
      includedInRun: true,
      ...(ticket.state === "closed" && ticket.integrated !== false
        ? {
            integration: {
              status: "integrated" as const,
              baseline: "feature/development-workflow",
              reviewedAt: now,
              synchronizedAt: now,
            },
          }
        : {}),
    })),
    synchronizedAt: now,
  };
}

function workstream(
  id: string,
  input: {
    readonly tickets: ReadonlyArray<Parameters<typeof graph>[1][number]>;
    readonly trackerTickets: Parameters<typeof tracker>[0];
    readonly scope?: ReadonlyArray<string>;
    readonly executionLimit?: 1 | 2;
    readonly automationStatus?: "running" | "draining" | "paused";
    readonly implementations?: WorkflowSchedulerWorkstream["implementations"];
    readonly activeProviderRuns?: number;
  },
): WorkflowSchedulerWorkstream {
  const workstreamId = WorkstreamId.make(id);
  return {
    workstreamId,
    originThreadId: ThreadId.make(`origin:${id}`),
    workflowRun: workflowRun(workstreamId, {
      scope: input.scope ?? input.tickets.map((ticket) => ticket.id),
      automationStatus: input.automationStatus ?? "running",
      ...(input.executionLimit === undefined ? {} : { executionLimit: input.executionLimit }),
    }),
    workflowGraph: graph(workstreamId, input.tickets),
    trackerProjection: tracker(input.trackerTickets),
    implementations: input.implementations ?? [],
    ...(input.activeProviderRuns === undefined
      ? {}
      : { activeProviderRuns: input.activeProviderRuns }),
  };
}

describe("WorkflowTicketFrontierScheduler", () => {
  it("dispatches only exact-scope, canonical-unblocked, unheld ticket leaves", () => {
    const selected = selectWorkflowTicketFrontier({
      workstreams: [
        workstream("alpha", {
          tickets: [
            { id: "ticket:in-scope", number: 30, key: "in-scope" },
            { id: "ticket:out-of-scope", number: 31, key: "out-of-scope" },
            { id: "ticket:blocked", number: 32, key: "blocked" },
            { id: "ticket:released", number: 33, key: "released" },
            { id: "ticket:held", number: 34, key: "held", held: true },
          ],
          scope: ["ticket:in-scope", "ticket:blocked", "ticket:released", "ticket:held"],
          trackerTickets: [
            { number: 30, key: "in-scope" },
            { number: 31, key: "out-of-scope" },
            { number: 32, key: "blocked", blockedBy: [90] },
            { number: 33, key: "released", blockedBy: [91] },
            { number: 34, key: "held" },
            { number: 90, key: "open-blocker" },
            { number: 91, key: "integrated-blocker", state: "closed" },
          ],
        }),
      ],
    });

    expect(selected.dispatches.map((dispatch) => dispatch.ticketNodeId)).toEqual([
      "ticket:in-scope",
      "ticket:released",
    ]);
  });

  it("caps both environment and Workstream execution, then rotates fairly", () => {
    const workstreams = [
      workstream("alpha", {
        tickets: [
          { id: "ticket:a1", number: 30, key: "a1" },
          { id: "ticket:a2", number: 31, key: "a2" },
        ],
        trackerTickets: [
          { number: 30, key: "a1" },
          { number: 31, key: "a2" },
        ],
      }),
      workstream("beta", {
        tickets: [
          { id: "ticket:b1", number: 40, key: "b1" },
          { id: "ticket:b2", number: 41, key: "b2" },
        ],
        trackerTickets: [
          { number: 40, key: "b1" },
          { number: 41, key: "b2" },
        ],
      }),
    ];

    const first = selectWorkflowTicketFrontier({ workstreams });
    expect(first.dispatches.map((dispatch) => dispatch.ticketNodeId)).toEqual([
      "ticket:a1",
      "ticket:b1",
    ]);
    expect(first.nextLastServedWorkstreamId).toBe(WorkstreamId.make("beta"));

    const second = selectWorkflowTicketFrontier({
      workstreams: workstreams.map((candidate) => ({
        ...candidate,
        implementations:
          candidate.workstreamId === WorkstreamId.make("alpha")
            ? [{ nodeId: "ticket:a1", status: "reviewed" as const }]
            : [{ nodeId: "ticket:b1", status: "reviewed" as const }],
      })),
      lastServedWorkstreamId: first.nextLastServedWorkstreamId,
    });
    expect(second.dispatches.map((dispatch) => dispatch.ticketNodeId)).toEqual([
      "ticket:a2",
      "ticket:b2",
    ]);

    const capped = selectWorkflowTicketFrontier({
      workstreams: workstreams.map((candidate) => ({
        ...candidate,
        implementations: [
          ...(candidate.workstreamId === WorkstreamId.make("alpha")
            ? [{ nodeId: "ticket:a1", status: "implementing" as const }]
            : []),
          ...(candidate.workstreamId === WorkstreamId.make("beta")
            ? [{ nodeId: "ticket:b1", status: "implementing" as const }]
            : []),
        ],
      })),
    });
    expect(capped.dispatches).toEqual([]);
  });

  it("reserves active capacity for an explicit user turn before automatic work", () => {
    const selected = selectWorkflowTicketFrontier({
      workstreams: [
        workstream("alpha", {
          tickets: [{ id: "ticket:a1", number: 30, key: "a1" }],
          trackerTickets: [{ number: 30, key: "a1" }],
          implementations: [
            { nodeId: "ticket:user", status: "implementing", dispatchMode: "user" },
          ],
        }),
        workstream("beta", {
          tickets: [{ id: "ticket:b1", number: 40, key: "b1" }],
          trackerTickets: [{ number: 40, key: "b1" }],
        }),
      ],
    });

    expect(selected.dispatches.map((dispatch) => dispatch.ticketNodeId)).toEqual(["ticket:b1"]);
  });

  it("counts provider runs that are not represented by Ticket Implementations", () => {
    const selected = selectWorkflowTicketFrontier({
      workstreams: [
        workstream("alpha", {
          tickets: [{ id: "ticket:a1", number: 30, key: "a1" }],
          trackerTickets: [{ number: 30, key: "a1" }],
          activeProviderRuns: 2,
        }),
      ],
    });

    expect(selected.dispatches).toEqual([]);
  });

  it("does not dispatch while draining or paused, and a released hold is eligible only on a later scheduling pass", () => {
    const held = workstream("alpha", {
      tickets: [{ id: "ticket:held", number: 30, key: "held", held: true }],
      trackerTickets: [{ number: 30, key: "held" }],
    });
    expect(selectWorkflowTicketFrontier({ workstreams: [held] }).dispatches).toEqual([]);

    const released = {
      ...held,
      workflowGraph: {
        ...held.workflowGraph,
        nodes: held.workflowGraph.nodes.map((node) =>
          node.id === "ticket:held" && node.kind === "ticket" ? { ...node, held: false } : node,
        ),
      },
    };
    expect(
      selectWorkflowTicketFrontier({
        workstreams: [
          { ...released, workflowRun: { ...released.workflowRun, automationStatus: "paused" } },
        ],
      }).dispatches,
    ).toEqual([]);
    expect(
      selectWorkflowTicketFrontier({ workstreams: [released] }).dispatches[0]?.ticketNodeId,
    ).toBe("ticket:held");
  });
});
