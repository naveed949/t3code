import { Effect } from "effect";
import { it } from "@effect/vitest";
import { describe, expect } from "vite-plus/test";

import { applyWayfinderMutation, type WayfinderMutationTracker } from "./WayfinderMutation.ts";
import type { WayfinderMutationAction } from "@t3tools/contracts";

const map = {
  canonicalReference: {
    number: 7,
    title: "Plan the release",
    url: "https://github.com/acme/repo/issues/7",
    state: "open" as const,
  },
  destination: "Ship safely",
  notes: "Keep it small",
  decisionsSoFar: [],
  fogOfWar: ["Hosting"],
  outOfScope: ["Billing"],
  tickets: [
    {
      number: 8,
      title: "Choose hosting",
      url: "https://github.com/acme/repo/issues/8",
      state: "open" as const,
      classification: "research" as const,
      claimedBy: null,
      blockedBy: [],
      blocks: [],
    },
  ],
  frontier: [8],
  lastSynchronizedAt: "2026-07-30T10:00:00.000Z",
};

function tracker(log: string[]): WayfinderMutationTracker<never> {
  return {
    updateMap: (input) => Effect.sync(() => log.push(`map:${input.field}:${input.value}`)),
    createTicket: (input) => Effect.sync(() => log.push(`create:${input.title}`)),
    renameTicket: (input) => Effect.sync(() => log.push(`rename:${input.ticketNumber}`)),
    classifyTicket: (input) => Effect.sync(() => log.push(`classify:${input.ticketNumber}`)),
    addDependency: (input) =>
      Effect.sync(() => log.push(`add:${input.blockerNumber}->${input.blockedNumber}`)),
    removeDependency: (input) =>
      Effect.sync(() => log.push(`remove:${input.blockerNumber}->${input.blockedNumber}`)),
    resolveTicket: (input) => Effect.sync(() => log.push(`resolve:${input.ticketNumber}`)),
    setTicketState: (input) => Effect.sync(() => log.push(`${input.state}:${input.ticketNumber}`)),
    reconcile: () => Effect.succeed(map),
  };
}

describe("applyWayfinderMutation", () => {
  it.effect("performs only the requested structured action and then reconciles", () =>
    Effect.gen(function* () {
      const log: string[] = [];
      const result = yield* applyWayfinderMutation(
        {
          actionId: "action:rename",
          action: { kind: "rename-ticket", ticketNumber: 8, title: "Choose infrastructure" },
          synchronizedAt: "2026-07-30T10:05:00.000Z",
        },
        tracker(log),
      );

      expect(log).toEqual(["rename:8"]);
      expect(result.lastSynchronizedAt).toBe("2026-07-30T10:00:00.000Z");
    }),
  );

  it.effect("preserves dependency direction for removal", () =>
    Effect.gen(function* () {
      const log: string[] = [];
      yield* applyWayfinderMutation(
        {
          actionId: "action:dependency",
          action: { kind: "remove-dependency", blockerNumber: 8, blockedNumber: 9 },
          synchronizedAt: "2026-07-30T10:05:00.000Z",
        },
        tracker(log),
      );

      expect(log).toEqual(["remove:8->9"]);
    }),
  );

  const actionCases: ReadonlyArray<readonly [WayfinderMutationAction, string]> = [
    [
      { kind: "update-map-field", field: "destination", value: "Ship confidently" },
      "map:destination:Ship confidently",
    ],
    [
      { kind: "create-ticket", title: "Choose a host", classification: "research" },
      "create:Choose a host",
    ],
    [{ kind: "classify-ticket", ticketNumber: 8, classification: "prototype" }, "classify:8"],
    [{ kind: "add-dependency", blockerNumber: 8, blockedNumber: 9 }, "add:8->9"],
    [{ kind: "resolve-ticket", ticketNumber: 8, resolution: "Use Fly" }, "resolve:8"],
    [{ kind: "close-ticket", ticketNumber: 8 }, "closed:8"],
    [{ kind: "reopen-ticket", ticketNumber: 8 }, "open:8"],
  ];

  for (const [action, expectedWrite] of actionCases) {
    it.effect(`dispatches only the ${action.kind} tracker operation`, () =>
      Effect.gen(function* () {
        const log: string[] = [];
        yield* applyWayfinderMutation(
          {
            actionId: `action:${action.kind}`,
            action,
            synchronizedAt: "2026-07-30T10:05:00.000Z",
          },
          tracker(log),
        );

        expect(log).toEqual([expectedWrite]);
      }),
    );
  }
});
