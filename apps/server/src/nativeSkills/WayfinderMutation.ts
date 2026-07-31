import type { WayfinderMapProjection, WayfinderMutationAction } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

interface MutationContext {
  readonly actionId: string;
  readonly synchronizedAt: string;
}

export interface WayfinderMutationTracker<ErrorType> {
  readonly updateMap: (
    input: MutationContext &
      Extract<WayfinderMutationAction, { readonly kind: "update-map-field" }>,
  ) => Effect.Effect<void, ErrorType>;
  readonly createTicket: (
    input: MutationContext & Extract<WayfinderMutationAction, { readonly kind: "create-ticket" }>,
  ) => Effect.Effect<void, ErrorType>;
  readonly renameTicket: (
    input: MutationContext & Extract<WayfinderMutationAction, { readonly kind: "rename-ticket" }>,
  ) => Effect.Effect<void, ErrorType>;
  readonly classifyTicket: (
    input: MutationContext & Extract<WayfinderMutationAction, { readonly kind: "classify-ticket" }>,
  ) => Effect.Effect<void, ErrorType>;
  readonly addDependency: (
    input: MutationContext & Extract<WayfinderMutationAction, { readonly kind: "add-dependency" }>,
  ) => Effect.Effect<void, ErrorType>;
  readonly removeDependency: (
    input: MutationContext &
      Extract<WayfinderMutationAction, { readonly kind: "remove-dependency" }>,
  ) => Effect.Effect<void, ErrorType>;
  readonly resolveTicket: (
    input: MutationContext & Extract<WayfinderMutationAction, { readonly kind: "resolve-ticket" }>,
  ) => Effect.Effect<void, ErrorType>;
  readonly setTicketState: (
    input: MutationContext & {
      readonly ticketNumber: number;
      readonly state: "open" | "closed";
    },
  ) => Effect.Effect<void, ErrorType>;
  readonly reconcile: (input: MutationContext) => Effect.Effect<WayfinderMapProjection, ErrorType>;
}

export const applyWayfinderMutation = Effect.fn("WayfinderMutation.apply")(function* <ErrorType>(
  input: MutationContext & { readonly action: WayfinderMutationAction },
  tracker: WayfinderMutationTracker<ErrorType>,
) {
  const context = { actionId: input.actionId, synchronizedAt: input.synchronizedAt };
  switch (input.action.kind) {
    case "update-map-field":
      yield* tracker.updateMap({ ...context, ...input.action });
      break;
    case "create-ticket":
      yield* tracker.createTicket({ ...context, ...input.action });
      break;
    case "rename-ticket":
      yield* tracker.renameTicket({ ...context, ...input.action });
      break;
    case "classify-ticket":
      yield* tracker.classifyTicket({ ...context, ...input.action });
      break;
    case "add-dependency":
      yield* tracker.addDependency({ ...context, ...input.action });
      break;
    case "remove-dependency":
      yield* tracker.removeDependency({ ...context, ...input.action });
      break;
    case "resolve-ticket":
      yield* tracker.resolveTicket({ ...context, ...input.action });
      break;
    case "close-ticket":
    case "reopen-ticket":
      yield* tracker.setTicketState({
        ...context,
        ticketNumber: input.action.ticketNumber,
        state: input.action.kind === "close-ticket" ? "closed" : "open",
      });
      break;
  }
  return yield* tracker.reconcile(context);
});
