import type { WayfinderMapProjection, WayfinderSynchronizationState } from "@t3tools/contracts";

export type WayfinderReadinessBlocker =
  | { readonly kind: "canonical-map-missing" }
  | { readonly kind: "missing-destination" }
  | { readonly kind: "open-decision-tickets"; readonly ticketNumbers: ReadonlyArray<number> }
  | {
      readonly kind: "active-linked-ticket-threads";
      readonly ticketNumbers: ReadonlyArray<number>;
    }
  | { readonly kind: "fog-of-war"; readonly entries: ReadonlyArray<string> }
  | {
      readonly kind: "unclassified-closed-tickets";
      readonly ticketNumbers: ReadonlyArray<number>;
    }
  | {
      readonly kind: "tracker-synchronization-unhealthy";
      readonly status: WayfinderSynchronizationState["status"] | "unknown";
    };

export interface WayfinderReadiness {
  readonly ready: boolean;
  readonly blockers: ReadonlyArray<WayfinderReadinessBlocker>;
}

export function deriveWayfinderReadiness(input: {
  readonly map: WayfinderMapProjection | null;
  readonly synchronization: WayfinderSynchronizationState | null;
  readonly activeLinkedTicketNumbers: ReadonlyArray<number>;
}): WayfinderReadiness {
  const blockers: WayfinderReadinessBlocker[] = [];
  const map = input.map;

  if (map === null) {
    blockers.push({ kind: "canonical-map-missing" });
  } else {
    if (map.destination.trim() === "") {
      blockers.push({ kind: "missing-destination" });
    }

    const openTicketNumbers = map.tickets
      .filter((ticket) => ticket.state === "open")
      .map((ticket) => ticket.number)
      .sort((left, right) => left - right);
    if (openTicketNumbers.length > 0) {
      blockers.push({ kind: "open-decision-tickets", ticketNumbers: openTicketNumbers });
    }

    const activeLinkedTicketNumbers = [...new Set(input.activeLinkedTicketNumbers)].sort(
      (left, right) => left - right,
    );
    if (activeLinkedTicketNumbers.length > 0) {
      blockers.push({
        kind: "active-linked-ticket-threads",
        ticketNumbers: activeLinkedTicketNumbers,
      });
    }

    if (map.fogOfWar.length > 0) {
      blockers.push({ kind: "fog-of-war", entries: map.fogOfWar });
    }

    const unclassifiedTicketNumbers = map.tickets
      .filter((ticket) => ticket.state === "closed" && ticket.classification === "unknown")
      .map((ticket) => ticket.number)
      .sort((left, right) => left - right);
    if (unclassifiedTicketNumbers.length > 0) {
      blockers.push({
        kind: "unclassified-closed-tickets",
        ticketNumbers: unclassifiedTicketNumbers,
      });
    }
  }

  if (input.synchronization?.status !== "healthy") {
    blockers.push({
      kind: "tracker-synchronization-unhealthy",
      status: input.synchronization?.status ?? "unknown",
    });
  }

  return { ready: blockers.length === 0, blockers };
}

export function describeWayfinderReadinessBlocker(blocker: WayfinderReadinessBlocker): string {
  switch (blocker.kind) {
    case "canonical-map-missing":
      return "No canonical Wayfinder map has been synchronized.";
    case "missing-destination":
      return "Define the Wayfinder destination.";
    case "open-decision-tickets":
      return `Close every decision ticket. Open: ${blocker.ticketNumbers.map((number) => `#${number}`).join(", ")}.`;
    case "active-linked-ticket-threads":
      return `Wait for linked ticket work to finish. Active: ${blocker.ticketNumbers.map((number) => `#${number}`).join(", ")}.`;
    case "fog-of-war":
      return `Resolve or move every in-scope unknown: ${blocker.entries.join(", ")}.`;
    case "unclassified-closed-tickets":
      return `Classify every closed ticket as a resolution or out of scope. Unclassified: ${blocker.ticketNumbers.map((number) => `#${number}`).join(", ")}.`;
    case "tracker-synchronization-unhealthy":
      return `Restore healthy tracker synchronization. Current status: ${blocker.status}.`;
  }
}
