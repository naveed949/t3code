import {
  query as claudeQuery,
  type SDKControlGetUsageResponse,
  type SDKUserMessage,
  type Options as ClaudeQueryOptions,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  ClaudeSettings,
  ProviderInstanceId,
  SubscriptionAllowance,
  SubscriptionAllowanceExtraUsage,
  SubscriptionAllowanceWindow,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { buildClaudeCapabilitiesProbeQueryOptions } from "./ClaudeProvider.ts";
import { resolveClaudeSdkExecutablePath } from "../Drivers/ClaudeExecutable.ts";
import { makeClaudeEnvironment } from "../Drivers/ClaudeHome.ts";
import type { ProviderAllowanceReader } from "../Services/ProviderAllowanceReader.ts";
import {
  CLAUDE_SUBSCRIPTION_ALLOWANCE_UNAVAILABLE_MESSAGE,
  ProviderAllowanceReadError,
} from "../Services/ProviderAllowanceReader.ts";

const CLAUDE_ALLOWANCE_READ_TIMEOUT = "25 seconds" as const;

type ClaudeRateLimitWindow = {
  readonly utilization: number | null;
  readonly resets_at: string | null;
};

type ClaudeExtraUsage = {
  readonly is_enabled: boolean;
  readonly monthly_limit: number | null;
  readonly used_credits: number | null;
  readonly utilization: number | null;
  readonly currency?: string | null;
};

/** The small part of the SDK Query surface needed by the allowance reader. */
export interface ClaudeAllowanceQuery {
  readonly initializationResult: () => Promise<unknown>;
  readonly usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?: () => Promise<SDKControlGetUsageResponse>;
  readonly close: () => void;
}

export interface ClaudeAllowanceReaderInput {
  readonly instanceId: ProviderInstanceId;
  readonly binaryPath: ClaudeSettings["binaryPath"];
  readonly homePath: ClaudeSettings["homePath"];
  readonly environment?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly timeout?: Duration.Input;
  readonly createQuery?: (input: {
    readonly prompt: AsyncIterable<SDKUserMessage>;
    readonly options: ClaudeQueryOptions;
  }) => ClaudeAllowanceQuery;
}

const unavailableAllowance = (instanceId: ProviderInstanceId): SubscriptionAllowance => ({
  provider: "claude",
  instanceId,
  status: "unavailable",
  windows: [],
  message: CLAUDE_SUBSCRIPTION_ALLOWANCE_UNAVAILABLE_MESSAGE,
});

const mapWindow = (
  scope: SubscriptionAllowanceWindow["scope"],
  window: ClaudeRateLimitWindow | null | undefined,
): SubscriptionAllowanceWindow | undefined => {
  if (window === null || window === undefined) return undefined;

  return {
    scope,
    usedPercent: window.utilization,
    resetsAt: window.resets_at,
  };
};

const mapExtraUsage = (
  extraUsage: ClaudeExtraUsage | null | undefined,
): SubscriptionAllowanceExtraUsage | undefined => {
  if (extraUsage === null || extraUsage === undefined) return undefined;

  return {
    isEnabled: extraUsage.is_enabled,
    monthlyLimit: extraUsage.monthly_limit,
    usedCredits: extraUsage.used_credits,
    utilization: extraUsage.utilization,
    ...(extraUsage.currency === undefined ? {} : { currency: extraUsage.currency }),
  };
};

export function mapClaudeUsage(input: {
  readonly instanceId: ProviderInstanceId;
  readonly response: SDKControlGetUsageResponse;
}): SubscriptionAllowance {
  const rateLimits = input.response.rate_limits;
  if (!input.response.rate_limits_available || !rateLimits) {
    return unavailableAllowance(input.instanceId);
  }

  const windows = [
    mapWindow("five_hour", rateLimits.five_hour),
    mapWindow("seven_day", rateLimits.seven_day),
    mapWindow("seven_day_oauth_apps", rateLimits.seven_day_oauth_apps),
    mapWindow("seven_day_opus", rateLimits.seven_day_opus),
    mapWindow("seven_day_sonnet", rateLimits.seven_day_sonnet),
  ].filter((window): window is SubscriptionAllowanceWindow => window !== undefined);
  const extraUsage = mapExtraUsage(rateLimits.extra_usage);

  if (windows.length === 0 && extraUsage === undefined) {
    return unavailableAllowance(input.instanceId);
  }

  return {
    provider: "claude",
    instanceId: input.instanceId,
    status: "available",
    windows,
    ...(extraUsage === undefined ? {} : { extraUsage }),
  } satisfies SubscriptionAllowance;
}

const neverYieldingPrompt = (signal: AbortSignal): AsyncIterable<SDKUserMessage> =>
  // oxlint-disable-next-line require-yield
  (async function* (): AsyncGenerator<SDKUserMessage> {
    await new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
  })();

const makeReadError = (cause: unknown): ProviderAllowanceReadError =>
  new ProviderAllowanceReadError({
    detail: "Claude Agent SDK did not return subscription usage limits.",
    cause,
  });

const isProviderAllowanceReadError = Schema.is(ProviderAllowanceReadError);

const withTimeout = <A>(promise: Promise<A>, timeout: Duration.Input): Promise<A> => {
  const timeoutMs = Duration.toMillis(timeout);
  if (!Number.isFinite(timeoutMs)) return promise;

  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise<A>((resolve, reject) => {
    // The SDK promise is external to Effect and may ignore interruption, so the
    // adapter needs a real deadline before its cleanup runs.
    // @effect-diagnostics-next-line globalTimers:off
    timer = setTimeout(
      () => reject(new Error("Claude Agent SDK allowance read timed out.")),
      timeoutMs,
    );
    promise.then(resolve, reject);
  }).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
};

export const makeClaudeAllowanceReader = Effect.fn("makeClaudeAllowanceReader")(function* (
  input: ClaudeAllowanceReaderInput,
) {
  const claudeEnvironment = yield* makeClaudeEnvironment(
    { homePath: input.homePath },
    input.environment,
  );
  const executablePath = yield* resolveClaudeSdkExecutablePath(input.binaryPath, claudeEnvironment);
  const createQuery =
    input.createQuery ??
    ((queryInput: {
      readonly prompt: AsyncIterable<SDKUserMessage>;
      readonly options: ClaudeQueryOptions;
    }) => claudeQuery(queryInput));

  const read = Effect.gen(function* () {
    const abortController = new AbortController();
    let query: ClaudeAllowanceQuery | undefined;

    return yield* Effect.tryPromise({
      try: () =>
        withTimeout(
          (async () => {
            query = createQuery({
              prompt: neverYieldingPrompt(abortController.signal),
              options: buildClaudeCapabilitiesProbeQueryOptions({
                executablePath,
                abortController,
                environment: claudeEnvironment,
                cwd: input.cwd,
              }),
            });

            await query.initializationResult();
            const readUsage = query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
            if (readUsage === undefined) {
              return unavailableAllowance(input.instanceId);
            }

            return mapClaudeUsage({
              instanceId: input.instanceId,
              response: await readUsage.call(query),
            });
          })(),
          input.timeout ?? CLAUDE_ALLOWANCE_READ_TIMEOUT,
        ),
      catch: makeReadError,
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (!abortController.signal.aborted) abortController.abort();
          query?.close();
        }),
      ),
      Effect.mapError((cause) =>
        isProviderAllowanceReadError(cause) ? cause : makeReadError(cause),
      ),
    );
  });

  return {
    provider: "claude",
    read,
  } satisfies ProviderAllowanceReader;
});

export { CLAUDE_ALLOWANCE_READ_TIMEOUT };
export { CLAUDE_SUBSCRIPTION_ALLOWANCE_UNAVAILABLE_MESSAGE };
