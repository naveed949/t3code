import { useAtomCommand } from "../state/use-atom-command";
import { useAtomValue } from "@effect/atom-react";
import { type EnvironmentId, type SubscriptionAllowance } from "@t3tools/contracts";
import {
  reconcileSubscriptionAllowances,
  type EnvironmentSubscriptionAllowanceStatus,
  type SubscriptionAllowanceProjection,
  type SubscriptionAllowanceSource,
} from "@t3tools/client-runtime/state/subscription-allowance";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo, useState } from "react";

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
).pipe(Atom.withLabel("web-usage:subscription-allowance"));

/** Backward-compatible web helper; reconciliation uses the shared source model below. */
export interface EnvironmentSubscriptionAllowance {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly allowance: SubscriptionAllowance;
}

export function flattenSubscriptionAllowances(
  environments: readonly (Pick<
    EnvironmentSubscriptionAllowanceStatus,
    "environmentId" | "snapshot"
  > & {
    readonly label: string;
    readonly isPending?: boolean;
    readonly error?: string | null;
  })[],
): readonly EnvironmentSubscriptionAllowance[] {
  return environments.flatMap(
    (environment) =>
      environment.snapshot?.allowances.map((allowance) => ({
        environmentId: environment.environmentId,
        environmentLabel: environment.label,
        allowance,
      })) ?? [],
  );
}

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
