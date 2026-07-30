import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface WayfinderPublicationReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class WayfinderPublicationReactor extends Context.Service<
  WayfinderPublicationReactor,
  WayfinderPublicationReactorShape
>()("t3/orchestration/Services/WayfinderPublicationReactor") {}
