import { deriveWayfinderWorkbenchModel } from "@t3tools/client-runtime/state/wayfinder-workbench";
import type { WayfinderMapProjection } from "@t3tools/contracts";

export function buildMobileWayfinderPresentation(map: WayfinderMapProjection) {
  const model = deriveWayfinderWorkbenchModel(map);
  const ticketsByNumber = new Map(map.tickets.map((ticket) => [ticket.number, ticket] as const));
  const relationships = model.edges.flatMap((edge) => {
    const from = ticketsByNumber.get(edge.from);
    const to = ticketsByNumber.get(edge.to);
    return from && to ? [`${from.title} enables ${to.title}`] : [];
  });
  return {
    tickets: model.tickets,
    graphRows: model.nodes.map((node) => ({
      ticketNumber: node.ticketNumber,
      depth: node.column,
      dependsOn: ticketsByNumber.get(node.ticketNumber)?.blockedBy ?? [],
    })),
    graphAccessibilityLabel:
      relationships.length > 0
        ? `Dependency graph. ${relationships.join(". ")}.`
        : "Dependency graph. No dependencies.",
    accessibilitySummary: model.accessibilitySummary,
  };
}
