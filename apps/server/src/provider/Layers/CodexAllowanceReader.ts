import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as CodexSchema from "effect-codex-app-server/schema";

import {
  type ProviderInstanceId,
  type SubscriptionAllowance,
  type SubscriptionAllowanceWindow,
} from "@t3tools/contracts";

import type { ProviderAllowanceReader } from "../Services/ProviderAllowanceReader.ts";
import { ProviderAllowanceReadError } from "../Services/ProviderAllowanceReader.ts";
import { withCodexAppServerClient, type CodexAppServerClientInput } from "./CodexProvider.ts";

const CODEX_ALLOWANCE_READ_TIMEOUT = "10 seconds" as const;

const mapNativeEpochSeconds = (value: number | null): string | null =>
  value === null ? null : DateTime.formatIso(DateTime.makeUnsafe(value * 1_000));

const mapWindow = (
  scope: SubscriptionAllowanceWindow["scope"],
  window: CodexSchema.V2GetAccountRateLimitsResponse__RateLimitWindow | null | undefined,
): SubscriptionAllowanceWindow | undefined => {
  if (window === null || window === undefined) return undefined;

  return {
    scope,
    usedPercent: window.usedPercent,
    ...(window.windowDurationMins === undefined
      ? {}
      : { windowDurationMins: window.windowDurationMins }),
    ...(window.resetsAt === undefined ? {} : { resetsAt: mapNativeEpochSeconds(window.resetsAt) }),
  };
};

export function mapCodexRateLimits(input: {
  readonly instanceId: ProviderInstanceId;
  readonly response: CodexSchema.V2GetAccountRateLimitsResponse;
}): SubscriptionAllowance {
  const rateLimits = input.response.rateLimits;
  const windows = [
    mapWindow("primary", rateLimits.primary),
    mapWindow("secondary", rateLimits.secondary),
  ].filter((window): window is SubscriptionAllowanceWindow => window !== undefined);

  const credits =
    rateLimits.credits === null || rateLimits.credits === undefined
      ? undefined
      : {
          ...(rateLimits.credits.balance === undefined
            ? {}
            : { balance: rateLimits.credits.balance }),
          hasCredits: rateLimits.credits.hasCredits,
          unlimited: rateLimits.credits.unlimited,
        };

  const individualLimit = rateLimits.individualLimit;
  const hasReachedState =
    rateLimits.spendControlReached !== undefined && rateLimits.spendControlReached !== null;
  const spendingControl =
    (individualLimit !== null && individualLimit !== undefined) || hasReachedState
      ? {
          ...(rateLimits.spendControlReached === undefined
            ? {}
            : { reached: rateLimits.spendControlReached }),
          ...(individualLimit === null || individualLimit === undefined
            ? {}
            : {
                limit: individualLimit.limit,
                remainingPercent: individualLimit.remainingPercent,
                resetsAt: DateTime.formatIso(DateTime.makeUnsafe(individualLimit.resetsAt * 1_000)),
                used: individualLimit.used,
              }),
        }
      : undefined;

  const hasProviderData =
    windows.length > 0 || credits !== undefined || spendingControl !== undefined;

  return {
    provider: "codex",
    instanceId: input.instanceId,
    status: hasProviderData ? "available" : "unavailable",
    windows,
    ...(credits === undefined ? {} : { credits }),
    ...(spendingControl === undefined ? {} : { spendingControl }),
    ...(hasProviderData ? {} : { message: "Codex did not provide subscription usage limits." }),
  } satisfies SubscriptionAllowance;
}

export interface CodexAllowanceReaderInput extends CodexAppServerClientInput {
  readonly instanceId: ProviderInstanceId;
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
}

export function makeCodexAllowanceReader(
  input: CodexAllowanceReaderInput,
): ProviderAllowanceReader {
  const read = withCodexAppServerClient(input, ({ client }) =>
    client
      .request("account/rateLimits/read", undefined)
      .pipe(
        Effect.map((response) => mapCodexRateLimits({ instanceId: input.instanceId, response })),
      ),
  ).pipe(
    Effect.timeout(CODEX_ALLOWANCE_READ_TIMEOUT),
    Effect.mapError(
      (cause) =>
        new ProviderAllowanceReadError({
          detail: "Codex app-server did not return subscription usage limits in time.",
          cause,
        }),
    ),
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, input.spawner),
    Effect.scoped,
  );

  return {
    provider: "codex",
    read,
  };
}
