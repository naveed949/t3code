import { ThreadId, type WayfinderMapProjection } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_WAYFINDER_RESEARCH_CONCURRENCY_LIMIT,
  parseWayfinderResearchResult,
  selectAutomaticWayfinderResearchTickets,
  selectQueuedWayfinderResearchTickets,
  updateWayfinderResearchTicket,
} from "./WayfinderResearch.ts";

const map: WayfinderMapProjection = {
  canonicalReference: {
    number: 42,
    title: "Release map",
    url: "https://github.com/t3tools/t3code/issues/42",
    state: "open",
  },
  destination: "Choose a release path.",
  notes: "",
  decisionsSoFar: [],
  fogOfWar: [],
  outOfScope: [],
  tickets: [
    {
      number: 43,
      title: "Research hosting",
      url: "https://github.com/t3tools/t3code/issues/43",
      state: "open",
      classification: "research",
      claimedBy: null,
      blockedBy: [],
      blocks: [],
    },
    {
      number: 44,
      title: "Prototype deployment",
      url: "https://github.com/t3tools/t3code/issues/44",
      state: "open",
      classification: "prototype",
      claimedBy: null,
      blockedBy: [],
      blocks: [],
    },
    {
      number: 45,
      title: "Research blocked fact",
      url: "https://github.com/t3tools/t3code/issues/45",
      state: "open",
      classification: "research",
      claimedBy: null,
      blockedBy: [43],
      blocks: [],
    },
    {
      number: 46,
      title: "Research another fact",
      url: "https://github.com/t3tools/t3code/issues/46",
      state: "open",
      classification: "research",
      claimedBy: null,
      blockedBy: [],
      blocks: [],
    },
  ],
  frontier: [43, 44, 46],
  lastSynchronizedAt: "2026-07-31T10:00:00.000Z",
};

describe("selectAutomaticWayfinderResearchTickets", () => {
  it("fills available slots with only eligible research tickets", () => {
    expect(
      selectAutomaticWayfinderResearchTickets({
        map,
        research: {
          automaticLaunchesPaused: false,
          concurrencyLimit: DEFAULT_WAYFINDER_RESEARCH_CONCURRENCY_LIMIT,
          tickets: [
            {
              ticketNumber: 46,
              launchMode: "manual",
              status: "active",
              threadId: "wayfinder-ticket:release:46",
              updatedAt: "2026-07-31T10:00:00.000Z",
            },
          ],
          updatedAt: "2026-07-31T10:00:00.000Z",
        },
      }),
    ).toEqual([43]);
  });

  it("does not launch while automatic research is paused", () => {
    expect(
      selectAutomaticWayfinderResearchTickets({
        map,
        research: {
          automaticLaunchesPaused: true,
          concurrencyLimit: 2,
          tickets: [],
          updatedAt: "2026-07-31T10:00:00.000Z",
        },
      }),
    ).toEqual([]);
  });
});

describe("research result receipts", () => {
  it("accepts only a completed structured result envelope", () => {
    expect(
      parseWayfinderResearchResult(
        'Evidence gathered.\n<wayfinder-research-result>{"status":"resolved","summary":"The API supports conditional requests."}</wayfinder-research-result>',
      ),
    ).toEqual({
      status: "resolved",
      summary: "The API supports conditional requests.",
    });
    expect(parseWayfinderResearchResult("I think the research is done.")).toBeNull();
  });

  it("keeps a structured failed result non-resolving", () => {
    expect(
      parseWayfinderResearchResult(
        '<wayfinder-research-result>{"status":"failed","summary":"Primary documentation was unavailable."}</wayfinder-research-result>',
      ),
    ).toEqual({
      status: "failed",
      summary: "Primary documentation was unavailable.",
    });
  });
});

describe("selectQueuedWayfinderResearchTickets", () => {
  it("promotes queued manual work only when a provider slot is available", () => {
    const queued = {
      ticketNumber: 43,
      launchMode: "manual" as const,
      status: "queued" as const,
      updatedAt: "2026-07-31T10:00:00.000Z",
    };
    expect(
      selectQueuedWayfinderResearchTickets({
        map,
        research: {
          automaticLaunchesPaused: true,
          concurrencyLimit: 2,
          tickets: [
            queued,
            {
              ticketNumber: 46,
              launchMode: "automatic",
              status: "active",
              updatedAt: "2026-07-31T10:00:00.000Z",
            },
          ],
          updatedAt: "2026-07-31T10:00:00.000Z",
        },
      }),
    ).toEqual([queued]);
    expect(
      selectQueuedWayfinderResearchTickets({
        map,
        research: {
          automaticLaunchesPaused: false,
          concurrencyLimit: 1,
          tickets: [
            queued,
            {
              ticketNumber: 46,
              launchMode: "automatic",
              status: "active",
              updatedAt: "2026-07-31T10:00:00.000Z",
            },
          ],
          updatedAt: "2026-07-31T10:00:00.000Z",
        },
      }),
    ).toEqual([]);
  });
});

it("updates one ticket without losing concurrent run state", () => {
  const first = updateWayfinderResearchTicket(
    {
      automaticLaunchesPaused: false,
      concurrencyLimit: 2,
      tickets: [],
      updatedAt: "2026-07-31T10:00:00.000Z",
    },
    {
      ticketNumber: 43,
      launchMode: "automatic",
      status: "active",
      threadId: ThreadId.make("wayfinder-ticket:release:43"),
      updatedAt: "2026-07-31T10:01:00.000Z",
    },
  );
  const second = updateWayfinderResearchTicket(first, {
    ticketNumber: 46,
    launchMode: "manual",
    status: "queued",
    updatedAt: "2026-07-31T10:02:00.000Z",
  });

  expect(second.tickets.map((ticket) => ticket.ticketNumber)).toEqual([43, 46]);
  expect(second.updatedAt).toBe("2026-07-31T10:02:00.000Z");
});
