import { describe, expect, it } from "vite-plus/test";

import {
  applyOptimisticWayfinderMutation,
  createWayfinderTicketAction,
  deriveWayfinderTicketClaimActions,
  deriveWayfinderWorkbenchModel,
  isWayfinderMutationInFlight,
} from "./wayfinderWorkbench.ts";
import { ThreadId } from "@t3tools/contracts";

const map = {
  canonicalReference: {
    number: 42,
    title: "Release map",
    url: "https://github.com/t3tools/t3code/issues/42",
    state: "open" as const,
  },
  destination: "A release plan ready for specification.",
  notes: "",
  decisionsSoFar: [],
  fogOfWar: ["Deployment ownership"],
  outOfScope: [],
  tickets: [
    {
      number: 44,
      title: "Choose deployment",
      url: "https://github.com/t3tools/t3code/issues/44",
      state: "open" as const,
      classification: "grilling" as const,
      claimedBy: null,
      blockedBy: [43],
      blocks: [],
    },
    {
      number: 43,
      title: "Research hosting",
      url: "https://github.com/t3tools/t3code/issues/43",
      state: "open" as const,
      classification: "research" as const,
      claimedBy: null,
      blockedBy: [],
      blocks: [44],
    },
    {
      number: 45,
      title: "Choose package",
      url: "https://github.com/t3tools/t3code/issues/45",
      state: "closed" as const,
      classification: "grilling" as const,
      claimedBy: "maintainer",
      blockedBy: [],
      blocks: [],
    },
  ],
  frontier: [43],
  lastSynchronizedAt: "2026-01-02T00:00:00.000Z",
};

describe("deriveWayfinderWorkbenchModel", () => {
  it("puts the canonical frontier first and derives a stable dependency layout", () => {
    const first = deriveWayfinderWorkbenchModel(map);
    const second = deriveWayfinderWorkbenchModel({
      ...map,
      tickets: map.tickets.toReversed(),
    });
    expect(first).toEqual(second);
    expect(first.tickets.map((ticket) => ticket.number)).toEqual([43, 44, 45]);
    expect(first.nodes).toEqual([
      { ticketNumber: 43, column: 0, row: 0, state: "open", isFrontier: true },
      { ticketNumber: 45, column: 0, row: 1, state: "closed", isFrontier: false },
      { ticketNumber: 44, column: 1, row: 0, state: "open", isFrontier: false },
    ]);
    expect(first.edges).toEqual([{ from: 43, to: 44 }]);
  });

  it("provides an accessibility summary without requiring graph interpretation", () => {
    expect(deriveWayfinderWorkbenchModel(map).accessibilitySummary).toBe(
      "Release map. 1 frontier ticket, 2 open tickets, 1 completed ticket. Last synchronized 2026-01-02T00:00:00.000Z.",
    );
  });
});

describe("deriveWayfinderTicketClaimActions", () => {
  const ticket = map.tickets.find((candidate) => candidate.number === 43)!;

  it("starts only an unclaimed frontier ticket", () => {
    expect(
      deriveWayfinderTicketClaimActions({
        ticket,
        frontier: map.frontier,
        linkedThreadId: null,
        mutation: null,
      }),
    ).toEqual({
      canClaim: true,
      claimLabel: "Start work",
      canRetry: false,
      canRelease: false,
      linkedThreadId: null,
    });
  });

  it("returns to and releases an existing linked claim", () => {
    const linkedThreadId = ThreadId.make("wayfinder-ticket:workstream:release:43");
    expect(
      deriveWayfinderTicketClaimActions({
        ticket: { ...ticket, claimedBy: "alice" },
        frontier: [],
        linkedThreadId,
        mutation: null,
      }),
    ).toEqual({
      canClaim: false,
      claimLabel: "Reclaim",
      canRetry: false,
      canRelease: true,
      linkedThreadId,
    });
  });

  it("offers recovery when GitHub claimed the ticket but thread linkage failed", () => {
    expect(
      deriveWayfinderTicketClaimActions({
        ticket: { ...ticket, claimedBy: "alice" },
        frontier: [],
        linkedThreadId: null,
        mutation: {
          actionId: "claim:43",
          action: { kind: "claim-ticket", ticketNumber: ticket.number },
          status: "failed",
          error: "The linked thread is incomplete.",
          updatedAt: "2026-01-02T00:01:00.000Z",
        },
      }),
    ).toMatchObject({ canClaim: false, canRetry: true, canRelease: false });
  });
});

describe("applyOptimisticWayfinderMutation", () => {
  it("scopes optimistic state to the active action and corrects on failure", () => {
    const mutation = {
      actionId: "action:rename",
      action: { kind: "rename-ticket" as const, ticketNumber: 43, title: "Research hosting costs" },
      status: "mutating" as const,
      error: null,
      updatedAt: "2026-01-02T00:01:00.000Z",
    };
    expect(
      applyOptimisticWayfinderMutation(map, mutation).tickets.find((ticket) => ticket.number === 43)
        ?.title,
    ).toBe("Research hosting costs");
    expect(
      applyOptimisticWayfinderMutation(map, { ...mutation, status: "failed" }).tickets.find(
        (ticket) => ticket.number === 43,
      )?.title,
    ).toBe("Research hosting");
  });

  it("keeps approval and mutation in flight, then clears on a GitHub receipt", () => {
    const mutation = {
      actionId: "action:close",
      action: { kind: "close-ticket" as const, ticketNumber: 43 },
      status: "awaiting-approval" as const,
      error: null,
      updatedAt: "2026-01-02T00:01:00.000Z",
    };
    expect(isWayfinderMutationInFlight(mutation)).toBe(true);
    expect(
      applyOptimisticWayfinderMutation(map, mutation).tickets.find((ticket) => ticket.number === 43)
        ?.state,
    ).toBe("closed");
    expect(isWayfinderMutationInFlight({ ...mutation, status: "synchronized" })).toBe(false);
  });

  it("keeps canonical tickets intact while claim linkage is in flight", () => {
    const mutation = {
      actionId: "action:claim",
      action: { kind: "claim-ticket" as const, ticketNumber: 43 },
      status: "mutating" as const,
      error: null,
      updatedAt: "2026-01-02T00:01:00.000Z",
    };

    expect(applyOptimisticWayfinderMutation(map, mutation).tickets).toEqual(map.tickets);
  });
});

describe("createWayfinderTicketAction", () => {
  it("trims the title and preserves the selected client classification", () => {
    expect(createWayfinderTicketAction("  Research hosting  ", "research")).toEqual({
      kind: "create-ticket",
      title: "Research hosting",
      classification: "research",
    });
    expect(createWayfinderTicketAction("  ", "task")).toBeNull();
  });
});
