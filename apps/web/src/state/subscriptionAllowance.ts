import { useAtomCommand } from "../state/use-atom-command";
import { useAtomValue } from "@effect/atom-react";
import {
  type EnvironmentId,
  type SubscriptionAllowance,
  type SubscriptionAllowanceSnapshot,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo, useState } from "react";

import { environmentPresentations } from "./presentation";
import { serverEnvironment } from "./server";

export interface EnvironmentSubscriptionAllowanceStatus {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly snapshot: SubscriptionAllowanceSnapshot | null;
}

export interface EnvironmentSubscriptionAllowance {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly allowance: SubscriptionAllowance;
}

const subscriptionAllowanceByEnvironmentAtom = Atom.make(
  (get): readonly EnvironmentSubscriptionAllowanceStatus[] => {
    const presentations = get(environmentPresentations.presentationsAtom);
    const statuses: EnvironmentSubscriptionAllowanceStatus[] = [];

    for (const [environmentId, presentation] of presentations) {
      const result = get(serverEnvironment.subscriptionAllowance({ environmentId, input: {} }));
      statuses.push({
        environmentId,
        label: presentation.entry.target.label,
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

export function flattenSubscriptionAllowances(
  environments: readonly EnvironmentSubscriptionAllowanceStatus[],
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

export interface SubscriptionAllowanceView {
  readonly allowances: readonly EnvironmentSubscriptionAllowance[];
  readonly environments: readonly EnvironmentSubscriptionAllowanceStatus[];
  readonly isPending: boolean;
  readonly isPartial: boolean;
  readonly isRefreshing: boolean;
  readonly refresh: () => void;
}

export function useSubscriptionAllowance(): SubscriptionAllowanceView {
  const environments = useAtomValue(subscriptionAllowanceByEnvironmentAtom);
  const allowances = useMemo(() => flattenSubscriptionAllowances(environments), [environments]);
  const refreshAllowance = useAtomCommand(serverEnvironment.refreshSubscriptionAllowance, {
    reportFailure: false,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(() => {
    setIsRefreshing(true);
    void Promise.all(
      environments.map((environment) =>
        refreshAllowance({
          environmentId: environment.environmentId,
          input: {},
        }),
      ),
    ).finally(() => setIsRefreshing(false));
  }, [environments, refreshAllowance]);

  const answeredCount = environments.filter((environment) => environment.snapshot !== null).length;
  const stillReporting = environments.filter(
    (environment) => environment.snapshot === null && environment.error === null,
  ).length;

  return {
    allowances,
    environments,
    isPending: answeredCount === 0 && stillReporting > 0,
    isPartial: answeredCount > 0 && stillReporting > 0,
    isRefreshing,
    refresh,
  };
}
