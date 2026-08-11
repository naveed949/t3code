/**
 * Multi-environment subscription allowance state.
 *
 * The stream is read only while the mobile Subscription view is mounted. The
 * shared projection keeps provider instances and environments separate and
 * selects one whole source for display without blending native windows.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  reconcileSubscriptionAllowances,
  type EnvironmentSubscriptionAllowanceStatus,
  type SubscriptionAllowanceProjection,
  type SubscriptionAllowanceSource,
} from "@t3tools/client-runtime/state/subscription-allowance";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo, useState } from "react";

import { useAtomCommand } from "./use-atom-command";
import { environmentPresentations } from "./presentation";
import { serverEnvironment } from "./server";

const subscriptionAllowanceByEnvironmentAtom = Atom.make(
  (get): readonly EnvironmentSubscriptionAllowanceStatus[] => {
    const presentations = get(environmentPresentations.presentationsAtom);
    const statuses: EnvironmentSubscriptionAllowanceStatus[] = [];

    for (const [environmentId, presentation] of presentations) {
      const result = get(serverEnvironment.subscriptionAllowance({ environmentId, input: {} }));
      statuses.push({
        environmentId,
        label: presentation.entry.target.label,
        connectionPhase: presentation.connection.phase,
        isPending: result.waiting,
        error:
          result._tag === "Failure"
            ? "This environment could not report subscription usage."
            : null,
        snapshot: Option.getOrNull(AsyncResult.value(result)),
      });
    }

    return statuses;
  },
).pipe(Atom.withLabel("mobile-usage:subscription-allowance"));

export interface SubscriptionAllowanceView extends SubscriptionAllowanceProjection {
  readonly isRefreshing: boolean;
  readonly refresh: () => void;
}

export function useSubscriptionAllowance(): SubscriptionAllowanceView {
  const environments = useAtomValue(subscriptionAllowanceByEnvironmentAtom);
  const projection = useMemo(() => reconcileSubscriptionAllowances(environments), [environments]);
  const refreshAllowance = useAtomCommand(serverEnvironment.refreshSubscriptionAllowance, {
    reportFailure: false,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(() => {
    setIsRefreshing(true);
    void Promise.all(
      projection.refreshEnvironmentIds.map((environmentId) =>
        refreshAllowance({
          environmentId,
          input: {},
        }),
      ),
    ).finally(() => setIsRefreshing(false));
  }, [projection.refreshEnvironmentIds, refreshAllowance]);

  return {
    ...projection,
    isRefreshing,
    refresh,
  };
}

export type { EnvironmentSubscriptionAllowanceStatus, SubscriptionAllowanceSource };
