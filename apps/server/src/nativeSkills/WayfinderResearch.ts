import type {
  WayfinderMapProjection,
  WayfinderResearchState,
  WayfinderResearchTicketRun,
} from "@t3tools/contracts";

export const DEFAULT_WAYFINDER_RESEARCH_CONCURRENCY_LIMIT = 2;

const ACTIVE_STATUSES = new Set<WayfinderResearchTicketRun["status"]>([
  "queued",
  "claiming",
  "active",
  "cancelling",
  "resolving",
]);

export function createWayfinderResearchState(updatedAt: string): WayfinderResearchState {
  return {
    automaticLaunchesPaused: false,
    concurrencyLimit: DEFAULT_WAYFINDER_RESEARCH_CONCURRENCY_LIMIT,
    tickets: [],
    updatedAt,
  };
}

export function updateWayfinderResearchTicket(
  research: WayfinderResearchState,
  ticket: WayfinderResearchTicketRun,
): WayfinderResearchState {
  return {
    ...research,
    tickets: [
      ...research.tickets.filter((entry) => entry.ticketNumber !== ticket.ticketNumber),
      ticket,
    ].toSorted((left, right) => left.ticketNumber - right.ticketNumber),
    updatedAt: ticket.updatedAt,
  };
}

export function selectAutomaticWayfinderResearchTickets(input: {
  readonly map: WayfinderMapProjection;
  readonly research: WayfinderResearchState;
}): ReadonlyArray<number> {
  if (input.research.automaticLaunchesPaused) return [];
  const launchedTickets = new Set(input.research.tickets.map((ticket) => ticket.ticketNumber));
  const activeCount = input.research.tickets.filter((ticket) =>
    ACTIVE_STATUSES.has(ticket.status),
  ).length;
  const availableSlots = Math.max(0, input.research.concurrencyLimit - activeCount);
  return input.map.tickets
    .filter(
      (ticket) =>
        ticket.state === "open" &&
        ticket.classification === "research" &&
        ticket.claimedBy === null &&
        input.map.frontier.includes(ticket.number) &&
        !launchedTickets.has(ticket.number),
    )
    .map((ticket) => ticket.number)
    .sort((left, right) => left - right)
    .slice(0, availableSlots);
}

export interface WayfinderResearchResult {
  readonly status: "resolved" | "failed";
  readonly summary: string;
}

const RESULT_PATTERN = /<wayfinder-research-result>(\{[\s\S]*?\})<\/wayfinder-research-result>/u;

export function parseWayfinderResearchResult(output: string): WayfinderResearchResult | null {
  const match = RESULT_PATTERN.exec(output);
  if (!match?.[1]) return null;
  try {
    const parsed = JSON.parse(match[1]) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("status" in parsed) ||
      !("summary" in parsed)
    ) {
      return null;
    }
    const status = parsed.status;
    const summary = parsed.summary;
    if (
      (status !== "resolved" && status !== "failed") ||
      typeof summary !== "string" ||
      summary.trim() === ""
    ) {
      return null;
    }
    return { status, summary: summary.trim() };
  } catch {
    return null;
  }
}
