import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface TicketBatchPublicationReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class TicketBatchPublicationReactor extends Context.Service<
  TicketBatchPublicationReactor,
  TicketBatchPublicationReactorShape
>()("t3/orchestration/Services/TicketBatchPublicationReactor") {}
