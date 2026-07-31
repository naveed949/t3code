import { describe, expect, it } from "vite-plus/test";
import { ThreadId } from "@t3tools/contracts";

import {
  buildMobileGraduatedFogTicket,
  buildMobileDependencyAction,
  buildMobileHitlResolutionAction,
  buildMobileResearchPresentation,
  buildMobileTicketClaimActions,
  buildMobileTicketAction,
  buildMobileWayfinderPresentation,
} from "./WayfinderWorkbench.logic";
import {
  createWayfinderTicketAction,
  WAYFINDER_TICKET_CLASSIFICATIONS,
} from "@t3tools/client-runtime/state/wayfinder-workbench";

const map = {
  canonicalReference: {
    number: 42,
    title: "Release map",
    url: "https://github.com/t3tools/t3code/issues/42",
    state: "open" as const,
  },
  destination: "A release plan.",
  notes: "",
  decisionsSoFar: [],
  fogOfWar: [],
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
  ],
  frontier: [43],
  lastSynchronizedAt: "2026-01-02T00:00:00.000Z",
};

describe("buildMobileWayfinderPresentation", () => {
  it("keeps the dependency-aware list frontier-first and exposes compact graph rows", () => {
    const presentation = buildMobileWayfinderPresentation(map);
    expect(presentation.tickets.map((ticket) => ticket.number)).toEqual([43, 44]);
    expect(presentation.graphRows).toEqual([
      { ticketNumber: 43, depth: 0, dependsOn: [] },
      { ticketNumber: 44, depth: 1, dependsOn: [43] },
    ]);
    expect(presentation.graphAccessibilityLabel).toContain(
      "Research hosting enables Choose deployment",
    );
  });

  it("offers every ticket classification and builds the selected create action", () => {
    expect(WAYFINDER_TICKET_CLASSIFICATIONS).toEqual(["research", "prototype", "grilling", "task"]);
    expect(createWayfinderTicketAction("Prototype sync", "prototype")).toEqual({
      kind: "create-ticket",
      title: "Prototype sync",
      classification: "prototype",
    });
  });

  it("builds every ticket and dependency action dispatched by the mobile controls", () => {
    const ticket = map.tickets[0]!;
    expect(buildMobileTicketAction(ticket, { kind: "rename", value: "  New title  " })).toEqual({
      kind: "rename-ticket",
      ticketNumber: 44,
      title: "New title",
    });
    expect(
      buildMobileTicketAction(ticket, { kind: "classify", classification: "prototype" }),
    ).toEqual({
      kind: "classify-ticket",
      ticketNumber: 44,
      classification: "prototype",
    });
    expect(buildMobileTicketAction(ticket, { kind: "toggle-state" })).toEqual({
      kind: "close-ticket",
      ticketNumber: 44,
    });
    expect(buildMobileTicketAction(ticket, { kind: "resolve", value: "  Use Fly  " })).toEqual({
      kind: "resolve-ticket",
      ticketNumber: 44,
      resolution: "Use Fly",
    });
    expect(buildMobileDependencyAction("add-dependency", "43", "44")).toEqual({
      kind: "add-dependency",
      blockerNumber: 43,
      blockedNumber: 44,
    });
    expect(buildMobileDependencyAction("remove-dependency", "", "44")).toBeNull();
  });

  it("derives mobile claim and linked-thread actions from shared Workstream state", () => {
    const linkedThreadId = ThreadId.make("wayfinder-ticket:workstream:release:43");
    expect(
      buildMobileTicketClaimActions(
        { ...map.tickets[1]!, claimedBy: "alice" },
        [],
        linkedThreadId,
        null,
      ),
    ).toMatchObject({
      canClaim: false,
      canRelease: true,
      linkedThreadId,
    });
    expect(
      buildMobileTicketClaimActions(
        { ...map.tickets[0]!, claimedBy: "alice" },
        [],
        ThreadId.make("wayfinder-ticket:workstream:release:44"),
        null,
        43,
      ),
    ).toMatchObject({
      canClaim: false,
      canRetry: false,
      canRelease: false,
      linkedThreadId: null,
    });
  });

  it("presents paused and recoverable background research on mobile", () => {
    const presentation = buildMobileResearchPresentation({
      map,
      research: {
        automaticLaunchesPaused: true,
        concurrencyLimit: 2,
        tickets: [
          {
            ticketNumber: 43,
            launchMode: "automatic",
            status: "failed",
            output: "The API supports conditional requests.",
            error: "Canonical resolution failed.",
            updatedAt: "2026-07-31T10:00:00.000Z",
          },
        ],
        updatedAt: "2026-07-31T10:00:00.000Z",
      },
      ticketThreads: [],
    });

    expect(presentation.automaticLaunchesPaused).toBe(true);
    expect(presentation.concurrencyLimit).toBe(2);
    expect(presentation.tickets.find((ticket) => ticket.ticketNumber === 43)).toMatchObject({
      status: "failed",
      output: "The API supports conditional requests.",
      canRetry: true,
    });
  });

  it("builds the assigned mobile HITL resolution with a graduated fog ticket", () => {
    expect(
      buildMobileHitlResolutionAction({
        ticketNumber: 43,
        outcome: "resolved",
        resolution: " Use the native relay. ",
        contextPointer: " https://github.com/t3tools/t3code/issues/43#issuecomment-1 ",
        graduatedFog: [
          buildMobileGraduatedFogTicket({
            fog: "Relay ownership",
            title: "Choose relay ownership",
            classification: "grilling",
            blockers: "42, #43",
          })!,
        ],
      }),
    ).toEqual({
      kind: "complete-hitl-ticket",
      ticketNumber: 43,
      outcome: "resolved",
      resolution: "Use the native relay.",
      contextPointer: "https://github.com/t3tools/t3code/issues/43#issuecomment-1",
      graduatedFog: [
        {
          key: "choose-relay-ownership",
          fog: "Relay ownership",
          title: "Choose relay ownership",
          classification: "grilling",
          blockedBy: [
            { kind: "ticket", ticketNumber: 42 },
            { kind: "ticket", ticketNumber: 43 },
          ],
        },
      ],
    });
  });

  it("shares graduated blocker parsing with web and supports key references", () => {
    expect(
      buildMobileGraduatedFogTicket({
        fog: "Transport policy",
        title: "Choose transport policy",
        classification: "research",
        blockers: "#42, key:relay-policy",
      }),
    ).toMatchObject({
      key: "choose-transport-policy",
      blockedBy: [
        { kind: "ticket", ticketNumber: 42 },
        { kind: "graduated", key: "relay-policy" },
      ],
    });
  });
});
