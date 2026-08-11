import type { SubscriptionAllowance, SubscriptionAllowanceProviderKind } from "@t3tools/contracts";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class ProviderAllowanceReadError extends Schema.TaggedErrorClass<ProviderAllowanceReadError>()(
  "ProviderAllowanceReadError",
  {
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/**
 * Optional live subscription reader owned by a materialized provider
 * instance. The service that aggregates these readers is intentionally
 * provider-agnostic; protocol details stay at the adapter boundary.
 */
export interface ProviderAllowanceReader {
  readonly provider: SubscriptionAllowanceProviderKind;
  readonly read: Effect.Effect<SubscriptionAllowance, ProviderAllowanceReadError>;
}
