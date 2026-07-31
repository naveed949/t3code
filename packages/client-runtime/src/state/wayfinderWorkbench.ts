import type {
  ThreadId,
  WayfinderMapProjection,
  WayfinderMutation,
  WayfinderMutationAction,
  WayfinderTicketState,
} from "@t3tools/contracts";

export const WAYFINDER_TICKET_CLASSIFICATIONS = [
  "research",
  "prototype",
  "grilling",
  "task",
] as const;

export type WayfinderTicketClassification = (typeof WAYFINDER_TICKET_CLASSIFICATIONS)[number];

export function isWayfinderMutationInFlight(mutation: WayfinderMutation | null): boolean {
  return mutation?.status === "awaiting-approval" || mutation?.status === "mutating";
}

export function createWayfinderTicketAction(
  title: string,
  classification: WayfinderTicketClassification,
): WayfinderMutationAction | null {
  const trimmedTitle = title.trim();
  return trimmedTitle === ""
    ? null
    : { kind: "create-ticket", title: trimmedTitle, classification };
}

type CompleteHitlTicketAction = Extract<
  WayfinderMutationAction,
  { readonly kind: "complete-hitl-ticket" }
>;

export function createWayfinderGraduatedFogTicket(input: {
  readonly fog: string;
  readonly title: string;
  readonly classification: WayfinderTicketClassification;
  readonly blockers: string;
}): CompleteHitlTicketAction["graduatedFog"][number] | null {
  const fog = input.fog.trim();
  const title = input.title.trim();
  const key = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  if (fog === "" || title === "" || key === "") return null;
  return {
    key,
    fog,
    title,
    classification: input.classification,
    blockedBy: input.blockers
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .flatMap((entry): CompleteHitlTicketAction["graduatedFog"][number]["blockedBy"] =>
        entry.startsWith("key:")
          ? [{ kind: "graduated", key: entry.slice(4).trim() }]
          : Number(entry.replace(/^#/u, "")) > 0
            ? [{ kind: "ticket", ticketNumber: Number(entry.replace(/^#/u, "")) }]
            : [],
      ),
  };
}

export function createWayfinderHitlResolutionAction(input: {
  readonly ticketNumber: number;
  readonly outcome: CompleteHitlTicketAction["outcome"];
  readonly resolution: string;
  readonly contextPointer: string;
  readonly graduatedFog: CompleteHitlTicketAction["graduatedFog"];
}): CompleteHitlTicketAction | null {
  const resolution = input.resolution.trim();
  const contextPointer = input.contextPointer.trim();
  if (input.ticketNumber <= 0 || resolution === "" || contextPointer === "") return null;
  const graduatedFog: CompleteHitlTicketAction["graduatedFog"][number][] = [];
  if (input.outcome === "resolved") {
    const keys = new Set<string>();
    for (const ticket of input.graduatedFog) {
      const key = ticket.key.trim();
      const fog = ticket.fog.trim();
      const title = ticket.title.trim();
      if (key === "" || fog === "" || title === "") return null;
      if (keys.has(key)) return null;
      keys.add(key);
      graduatedFog.push({
        ...ticket,
        key,
        fog,
        title,
        blockedBy: ticket.blockedBy.map((blocker) =>
          blocker.kind === "graduated" ? { ...blocker, key: blocker.key.trim() } : blocker,
        ),
      });
    }
  }
  return {
    kind: "complete-hitl-ticket",
    ticketNumber: input.ticketNumber,
    outcome: input.outcome,
    resolution,
    contextPointer,
    graduatedFog,
  };
}

export function deriveWayfinderTicketClaimActions(input: {
  readonly ticket: WayfinderMapProjection["tickets"][number];
  readonly frontier: ReadonlyArray<number>;
  readonly linkedThreadId: ThreadId | null;
  readonly mutation: WayfinderMutation | null;
}) {
  const failedClaim =
    input.mutation?.status === "failed" &&
    input.mutation.action.kind === "claim-ticket" &&
    input.mutation.action.ticketNumber === input.ticket.number;
  const canClaim =
    input.ticket.state === "open" &&
    input.ticket.claimedBy === null &&
    input.frontier.includes(input.ticket.number);
  return {
    canClaim,
    claimLabel: input.linkedThreadId === null ? "Start work" : "Reclaim",
    canRetry: failedClaim && input.ticket.claimedBy !== null && input.linkedThreadId === null,
    canRelease: input.ticket.claimedBy !== null && (input.linkedThreadId !== null || failedClaim),
    linkedThreadId: input.linkedThreadId,
  };
}

export interface WayfinderWorkbenchNode {
  readonly ticketNumber: number;
  readonly column: number;
  readonly row: number;
  readonly state: WayfinderTicketState;
  readonly isFrontier: boolean;
}

export interface WayfinderWorkbenchEdge {
  readonly from: number;
  readonly to: number;
}

export interface WayfinderWorkbenchModel {
  readonly tickets: WayfinderMapProjection["tickets"];
  readonly nodes: ReadonlyArray<WayfinderWorkbenchNode>;
  readonly edges: ReadonlyArray<WayfinderWorkbenchEdge>;
  readonly accessibilitySummary: string;
}

export function applyOptimisticWayfinderMutation(
  map: WayfinderMapProjection,
  mutation: WayfinderMutation | null,
): WayfinderMapProjection {
  if (!mutation || !isWayfinderMutationInFlight(mutation)) {
    return map;
  }
  const action = mutation.action;
  const withTickets = (tickets: WayfinderMapProjection["tickets"]): WayfinderMapProjection => {
    const byNumber = new Map(tickets.map((ticket) => [ticket.number, ticket] as const));
    return {
      ...map,
      tickets,
      frontier: tickets
        .filter(
          (ticket) =>
            ticket.state === "open" &&
            ticket.claimedBy === null &&
            ticket.blockedBy.every((number) => byNumber.get(number)?.state === "closed"),
        )
        .map((ticket) => ticket.number)
        .sort((left, right) => left - right),
    };
  };
  if (action.kind === "update-map-field") {
    if (action.field === "destination" || action.field === "notes") {
      return { ...map, [action.field]: action.value };
    }
    const entries = action.value
      .split(/\r?\n/u)
      .map((entry) => entry.replace(/^[-*]\s*/u, "").trim())
      .filter(Boolean);
    return {
      ...map,
      [action.field === "fog-of-war" ? "fogOfWar" : "outOfScope"]: entries,
    };
  }
  if (action.kind === "add-dependency" || action.kind === "remove-dependency") {
    const add = action.kind === "add-dependency";
    return withTickets(
      map.tickets.map((ticket) => {
        if (ticket.number === action.blockedNumber) {
          return {
            ...ticket,
            blockedBy: add
              ? [...new Set([...ticket.blockedBy, action.blockerNumber])].sort((a, b) => a - b)
              : ticket.blockedBy.filter((number) => number !== action.blockerNumber),
          };
        }
        if (ticket.number === action.blockerNumber) {
          return {
            ...ticket,
            blocks: add
              ? [...new Set([...ticket.blocks, action.blockedNumber])].sort((a, b) => a - b)
              : ticket.blocks.filter((number) => number !== action.blockedNumber),
          };
        }
        return ticket;
      }),
    );
  }
  if ("ticketNumber" in action) {
    return withTickets(
      map.tickets.map((ticket) => {
        if (ticket.number !== action.ticketNumber) return ticket;
        switch (action.kind) {
          case "rename-ticket":
            return { ...ticket, title: action.title };
          case "classify-ticket":
            return { ...ticket, classification: action.classification };
          case "close-ticket":
            return { ...ticket, state: "closed" as const };
          case "reopen-ticket":
            return { ...ticket, state: "open" as const };
          case "resolve-ticket":
          case "claim-ticket":
          case "release-ticket":
          case "complete-hitl-ticket":
            return ticket;
        }
      }),
    );
  }
  return map;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function deriveWayfinderWorkbenchModel(
  map: WayfinderMapProjection,
): WayfinderWorkbenchModel {
  const ticketsByNumber = new Map(map.tickets.map((ticket) => [ticket.number, ticket] as const));
  const frontier = new Set(map.frontier);
  const depthByNumber = new Map<number, number>();

  const depth = (ticketNumber: number, visiting = new Set<number>()): number => {
    const cached = depthByNumber.get(ticketNumber);
    if (cached !== undefined) return cached;
    if (visiting.has(ticketNumber)) return 0;
    const ticket = ticketsByNumber.get(ticketNumber);
    if (!ticket) return 0;
    const nextVisiting = new Set(visiting).add(ticketNumber);
    const parentDepths = ticket.blockedBy
      .filter((blocker) => ticketsByNumber.has(blocker))
      .map((blocker) => depth(blocker, nextVisiting));
    const value = parentDepths.length === 0 ? 0 : Math.max(...parentDepths) + 1;
    depthByNumber.set(ticketNumber, value);
    return value;
  };

  const ticketsByColumn = new Map<number, number[]>();
  for (const ticket of [...map.tickets].sort((left, right) => left.number - right.number)) {
    const column = depth(ticket.number);
    const columnTickets = ticketsByColumn.get(column) ?? [];
    columnTickets.push(ticket.number);
    ticketsByColumn.set(column, columnTickets);
  }

  const nodes = Array.from(ticketsByColumn.entries())
    .sort(([left], [right]) => left - right)
    .flatMap(([column, ticketNumbers]) =>
      ticketNumbers.map((ticketNumber, row) => {
        const ticket = ticketsByNumber.get(ticketNumber)!;
        return {
          ticketNumber,
          column,
          row,
          state: ticket.state,
          isFrontier: frontier.has(ticketNumber),
        };
      }),
    );
  const edges = map.tickets
    .flatMap((ticket) =>
      ticket.blockedBy
        .filter((blocker) => ticketsByNumber.has(blocker))
        .map((blocker) => ({ from: blocker, to: ticket.number })),
    )
    .sort((left, right) => left.from - right.from || left.to - right.to);
  const tickets = [...map.tickets].sort((left, right) => {
    const frontierOrder = Number(frontier.has(right.number)) - Number(frontier.has(left.number));
    if (frontierOrder !== 0) return frontierOrder;
    const stateOrder = Number(left.state === "closed") - Number(right.state === "closed");
    return stateOrder || left.number - right.number;
  });
  const openCount = map.tickets.filter((ticket) => ticket.state === "open").length;
  const completedCount = map.tickets.length - openCount;

  return {
    tickets,
    nodes,
    edges,
    accessibilitySummary: `${map.canonicalReference.title}. ${plural(
      map.frontier.length,
      "frontier ticket",
    )}, ${plural(openCount, "open ticket")}, ${plural(
      completedCount,
      "completed ticket",
    )}. Last synchronized ${map.lastSynchronizedAt}.`,
  };
}
