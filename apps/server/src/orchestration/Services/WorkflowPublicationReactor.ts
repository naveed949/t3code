import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface WorkflowPublicationReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class WorkflowPublicationReactor extends Context.Service<
  WorkflowPublicationReactor,
  WorkflowPublicationReactorShape
>()("t3/orchestration/Services/WorkflowPublicationReactor") {}
