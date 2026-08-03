import type { WayfinderMapProjection, WayfinderSynchronizationState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveWayfinderReadiness } from "./wayfinderReadiness.ts";

const synchronizedAt = "2026-01-04T00:00:00.000Z";

const healthySynchronization: WayfinderSynchronizationState = {
  status: "healthy",
  reason: "manual",
  lastAttemptedAt: synchronizedAt,
  lastSuccessfulAt: synchronizedAt,
  canMutate: true,
};

const readyMap: WayfinderMapProjection = {
  canonicalReference: {
    number: 42,
    title: "Release map",
    url: "https://github.com/t3tools/t3code/issues/42",
    state: "open",
  },
  destination: "A release plan.",
  notes: "",
  decisionsSoFar: [],
  fogOfWar: [],
  outOfScope: [],
  tickets: [
    {
      number: 43,
      title: "Choose hosting",
      url: "https://github.com/t3tools/t3code/issues/43",
      state: "closed",
      classification: "grilling",
      claimedBy: null,
      blockedBy: [],
      blocks: [],
    },
  ],
  frontier: [],
  lastSynchronizedAt: synchronizedAt,
};

describe("deriveWayfinderReadiness", () => {
  it("reports every unmet completion invariant from observable state", () => {
    expect(
      deriveWayfinderReadiness({
        map: {
          ...readyMap,
          destination: "   ",
          fogOfWar: ["Deployment ownership"],
          tickets: [
            { ...readyMap.tickets[0]!, state: "open" },
            {
              ...readyMap.tickets[0]!,
              number: 44,
              title: "Unknown closed decision",
              state: "closed",
              classification: "unknown",
            },
          ],
        },
        synchronization: {
          ...healthySynchronization,
          status: "unavailable",
          canMutate: false,
          message: "GitHub unavailable",
        },
        activeLinkedTicketNumbers: [43, 45],
      }),
    ).toEqual({
      ready: false,
      blockers: [
        { kind: "missing-destination" },
        { kind: "open-decision-tickets", ticketNumbers: [43] },
        { kind: "active-linked-ticket-threads", ticketNumbers: [43, 45] },
        { kind: "fog-of-war", entries: ["Deployment ownership"] },
        { kind: "unclassified-closed-tickets", ticketNumbers: [44] },
        { kind: "tracker-synchronization-unhealthy", status: "unavailable" },
      ],
    });
  });

  it("is ready only when every canonical invariant holds", () => {
    expect(
      deriveWayfinderReadiness({
        map: readyMap,
        synchronization: healthySynchronization,
        activeLinkedTicketNumbers: [],
      }),
    ).toEqual({ ready: true, blockers: [] });
  });

  it("does not treat a closed parent issue as a completion shortcut", () => {
    expect(
      deriveWayfinderReadiness({
        map: {
          ...readyMap,
          canonicalReference: { ...readyMap.canonicalReference, state: "closed" },
          tickets: [{ ...readyMap.tickets[0]!, state: "open" }],
        },
        synchronization: healthySynchronization,
        activeLinkedTicketNumbers: [],
      }),
    ).toEqual({
      ready: false,
      blockers: [{ kind: "open-decision-tickets", ticketNumbers: [43] }],
    });
  });
});
