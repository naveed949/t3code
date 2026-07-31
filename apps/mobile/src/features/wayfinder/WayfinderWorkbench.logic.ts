import {
  createWayfinderGraduatedFogTicket,
  createWayfinderHitlResolutionAction,
  deriveWayfinderTicketClaimActions,
  deriveWayfinderWorkbenchModel,
} from "@t3tools/client-runtime/state/wayfinder-workbench";
import type {
  ThreadId,
  WayfinderMapProjection,
  WayfinderMutation,
  WayfinderMutationAction,
  WayfinderDraftTicketClassification,
} from "@t3tools/contracts";

export function buildMobileTicketClaimActions(
  ticket: WayfinderMapProjection["tickets"][number],
  frontier: ReadonlyArray<number>,
  linkedThreadId: ThreadId | null,
  mutation: WayfinderMutation | null,
  assignedTicketNumber: number | null = null,
) {
  if (assignedTicketNumber !== null && ticket.number !== assignedTicketNumber) {
    return {
      canClaim: false,
      claimLabel: "Start work",
      canRetry: false,
      canRelease: false,
      linkedThreadId: null,
    };
  }
  return deriveWayfinderTicketClaimActions({ ticket, frontier, linkedThreadId, mutation });
}

export function buildMobileTicketAction(
  ticket: WayfinderMapProjection["tickets"][number],
  intent:
    | { readonly kind: "rename"; readonly value: string }
    | { readonly kind: "classify"; readonly classification: WayfinderDraftTicketClassification }
    | { readonly kind: "toggle-state" }
    | { readonly kind: "resolve"; readonly value: string },
): WayfinderMutationAction | null {
  if (intent.kind === "rename" || intent.kind === "resolve") {
    const value = intent.value.trim();
    if (value === "") return null;
    return intent.kind === "rename"
      ? { kind: "rename-ticket", ticketNumber: ticket.number, title: value }
      : { kind: "resolve-ticket", ticketNumber: ticket.number, resolution: value };
  }
  if (intent.kind === "classify") {
    return {
      kind: "classify-ticket",
      ticketNumber: ticket.number,
      classification: intent.classification,
    };
  }
  return {
    kind: ticket.state === "open" ? "close-ticket" : "reopen-ticket",
    ticketNumber: ticket.number,
  };
}

export function buildMobileDependencyAction(
  kind: "add-dependency" | "remove-dependency",
  blocker: string,
  blocked: string,
): WayfinderMutationAction | null {
  const blockerNumber = Number(blocker);
  const blockedNumber = Number(blocked);
  return blockerNumber > 0 && blockedNumber > 0 ? { kind, blockerNumber, blockedNumber } : null;
}

export const buildMobileGraduatedFogTicket = createWayfinderGraduatedFogTicket;

export function buildMobileHitlResolutionAction(input: {
  readonly ticketNumber: number;
  readonly outcome: "resolved" | "out-of-scope";
  readonly resolution: string;
  readonly contextPointer: string;
  readonly graduatedFog: Extract<
    WayfinderMutationAction,
    { readonly kind: "complete-hitl-ticket" }
  >["graduatedFog"];
}) {
  return createWayfinderHitlResolutionAction({
    ticketNumber: input.ticketNumber,
    outcome: input.outcome,
    resolution: input.resolution,
    contextPointer: input.contextPointer,
    graduatedFog: input.graduatedFog,
  });
}

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
