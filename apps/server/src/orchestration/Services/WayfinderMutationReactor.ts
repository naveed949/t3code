import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface WayfinderMutationReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class WayfinderMutationReactor extends Context.Service<
  WayfinderMutationReactor,
  WayfinderMutationReactorShape
>()("t3/orchestration/Services/WayfinderMutationReactor") {}
