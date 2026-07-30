import type { WayfinderMapProjection, WayfinderTicketState } from "@t3tools/contracts";

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
