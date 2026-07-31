import type {
  WayfinderMapProjection,
  WayfinderResearchState,
  WayfinderResearchTicketRun,
} from "@t3tools/contracts";
import { TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const DEFAULT_WAYFINDER_RESEARCH_CONCURRENCY_LIMIT = 2;

const ACTIVE_STATUSES = new Set<WayfinderResearchTicketRun["status"]>([
  "claiming",
  "active",
  "cancelling",
  "resolving",
]);

export function isWayfinderResearchActive(status: WayfinderResearchTicketRun["status"]): boolean {
  return ACTIVE_STATUSES.has(status);
}

export function countActiveWayfinderResearchTickets(
  research: WayfinderResearchState,
  exceptTicketNumber?: number,
): number {
  return research.tickets.filter(
    (ticket) =>
      ticket.ticketNumber !== exceptTicketNumber && isWayfinderResearchActive(ticket.status),
  ).length;
}

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
  const activeCount = countActiveWayfinderResearchTickets(input.research);
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

export function selectQueuedWayfinderResearchTickets(input: {
  readonly map: WayfinderMapProjection;
  readonly research: WayfinderResearchState;
}): ReadonlyArray<WayfinderResearchTicketRun> {
  const availableSlots = Math.max(
    0,
    input.research.concurrencyLimit - countActiveWayfinderResearchTickets(input.research),
  );
  return input.research.tickets
    .filter((run) => {
      const ticket = input.map.tickets.find((candidate) => candidate.number === run.ticketNumber);
      const canResumeExistingClaim = run.retrying === true && ticket?.claimedBy !== null;
      const canClaimFrontierTicket =
        ticket?.claimedBy === null && input.map.frontier.includes(ticket.number);
      return (
        run.status === "queued" &&
        (run.launchMode === "manual" || !input.research.automaticLaunchesPaused) &&
        ticket?.state === "open" &&
        ticket.classification === "research" &&
        (canResumeExistingClaim || canClaimFrontierTicket)
      );
    })
    .toSorted((left, right) => left.ticketNumber - right.ticketNumber)
    .slice(0, availableSlots);
}

const WayfinderResearchResult = Schema.Struct({
  status: Schema.Literals(["resolved", "failed"]),
  summary: TrimmedNonEmptyString,
});
export type WayfinderResearchResult = typeof WayfinderResearchResult.Type;
const decodeWayfinderResearchResult = Schema.decodeUnknownOption(
  Schema.fromJsonString(WayfinderResearchResult),
);

const RESULT_PATTERN = /<wayfinder-research-result>(\{[\s\S]*?\})<\/wayfinder-research-result>/u;

export function parseWayfinderResearchResult(output: string): WayfinderResearchResult | null {
  const match = RESULT_PATTERN.exec(output);
  if (!match?.[1]) return null;
  return Option.getOrNull(decodeWayfinderResearchResult(match[1]));
}
