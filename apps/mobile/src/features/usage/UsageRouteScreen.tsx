import { useIsFocused, useNavigation } from "@react-navigation/native";
import type { MergedUsage } from "@t3tools/shared/usageMerge";
import {
  enumerateDays,
  formatCount,
  formatDayShort,
  formatPercent,
  formatTokens,
  formatUsd,
  makeWindow,
} from "@t3tools/shared/usageFormat";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useSubscriptionAllowance } from "../../state/subscriptionAllowance";
import { useUsage, type EnvironmentUsageStatus } from "../../state/usage";
import { SettingsSection } from "../settings/components/SettingsSection";
import { UsageDailyChart } from "./UsageDailyChart";
import type { UsageChartMetric } from "./usageChartData";
import {
  formatAllowanceDuration,
  formatAllowanceEnvironmentNotice,
  formatAllowanceResetAt,
  formatAllowanceUpdatedAt,
  formatAllowanceWindowScope,
  presentAllowanceGroup,
  progressWidthForAllowance,
  type MobileAllowanceCardModel,
} from "./usageAllowance";
import { PROVIDER_LABEL, useProviderColors } from "./usageProviders";
import { subscriptionViewPhase, USAGE_VIEW_OPTIONS, type UsageView } from "./usageView";

const WINDOW_OPTIONS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;

const CHART_HEIGHT = 180;

export function UsageRouteScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const [view, setView] = useState<UsageView>("historical");

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <>
          <NativeStackScreenOptions options={{ headerShown: false }} />
          <AndroidScreenHeader title="Usage" onBack={() => navigation.goBack()} />
        </>
      ) : null}
      <UsageContent
        view={view}
        isFocused={isFocused}
        onViewChange={setView}
        insetsBottom={insets.bottom}
      />
    </View>
  );
}

function UsageContent(props: {
  readonly view: UsageView;
  readonly isFocused: boolean;
  readonly onViewChange: (view: UsageView) => void;
  readonly insetsBottom: number;
}) {
  // Mount only the selected data source so leaving Subscription tears down its
  // allowance stream and leaving Historical releases its transcript query.
  if (!props.isFocused) return null;

  return props.view === "subscription" ? (
    <SubscriptionUsageContent onViewChange={props.onViewChange} insetsBottom={props.insetsBottom} />
  ) : (
    <HistoricalUsageContent onViewChange={props.onViewChange} insetsBottom={props.insetsBottom} />
  );
}

function HistoricalUsageContent(props: {
  readonly onViewChange: (view: UsageView) => void;
  readonly insetsBottom: number;
}) {
  const [windowDays, setWindowDays] = useState<number>(30);
  const [metric, setMetric] = useState<UsageChartMetric>("cost");

  // Recomputed only when the window length changes, so a re-render does not
  // shift the range and refetch every environment.
  const window = useMemo(() => makeWindow(windowDays), [windowDays]);
  const { merged, environments, isPending, isPartial, refresh } = useUsage(window);

  const days = useMemo(
    () => enumerateDays(window.sinceDay, window.untilDay),
    [window.sinceDay, window.untilDay],
  );

  // The pull spinner tracks re-scans of environments that have answered
  // before. The initial scan renders its own placeholder, and an unreachable
  // environment stays pending forever — neither may pin the spinner on.
  const refreshing = environments.some((entry) => entry.isPending && entry.summary !== null);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      className="flex-1"
      contentContainerClassName="gap-6 px-5 pt-4"
      contentContainerStyle={{ paddingBottom: Math.max(props.insetsBottom, 18) + 18 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <UsageViewTabs value="historical" onChange={props.onViewChange} />
      <SegmentedControl
        accessibilityLabel="Historical usage window"
        options={WINDOW_OPTIONS.map((option) => ({ value: option.days, label: option.label }))}
        selected={windowDays}
        onSelect={setWindowDays}
      />

      <UsageCoverageNotice environments={environments} merged={merged} isPartial={isPartial} />

      {isPending ? (
        <Text className="py-16 text-center text-base text-foreground-muted">
          Scanning provider transcripts…
        </Text>
      ) : environments.length === 0 ? (
        <Text className="py-16 text-center text-base text-foreground-muted">
          Connect an environment to see usage.
        </Text>
      ) : (
        <>
          <ChartCard
            merged={merged}
            days={days}
            metric={metric}
            onMetricChange={setMetric}
            sinceDay={window.sinceDay}
            untilDay={window.untilDay}
          />
          <ProviderSection merged={merged} metric={metric} />
          <TotalsSection merged={merged} />
          <ModelsSection merged={merged} />
        </>
      )}
    </ScrollView>
  );
}

function UsageViewTabs(props: {
  readonly value: UsageView;
  readonly onChange: (view: UsageView) => void;
}) {
  return (
    <SegmentedControl
      accessibilityLabel="Usage view"
      options={USAGE_VIEW_OPTIONS}
      selected={props.value}
      onSelect={props.onChange}
    />
  );
}

function SubscriptionUsageContent(props: {
  readonly onViewChange: (view: UsageView) => void;
  readonly insetsBottom: number;
}) {
  const { groups, environments, isPending, isPartial, isRefreshing, refresh } =
    useSubscriptionAllowance();
  const environmentNotices = environments.flatMap((environment) => {
    const message = formatAllowanceEnvironmentNotice(environment);
    return message === null ? [] : [{ environmentId: environment.environmentId, message }];
  });
  // Keep already available cards visible while another environment answers.
  // Only an empty first response needs the full loading placeholder.
  const phase = subscriptionViewPhase({
    isPending,
    isPartial,
    groupCount: groups.length,
  });

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      className="flex-1"
      contentContainerClassName="gap-6 px-5 pt-4"
      contentContainerStyle={{ paddingBottom: Math.max(props.insetsBottom, 18) + 18 }}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}
    >
      <UsageViewTabs value="subscription" onChange={props.onViewChange} />

      <View className="flex-row items-start justify-between gap-4">
        <View className="min-w-0 flex-1 gap-0.5">
          <Text accessibilityRole="header" className="text-lg font-t3-medium text-foreground">
            Subscription allowance
          </Text>
          <Text className="text-sm text-foreground-muted">
            Current provider-reported limits and reset windows.
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Refresh subscription usage"
          accessibilityRole="button"
          accessibilityState={{ busy: isRefreshing, disabled: isRefreshing }}
          disabled={isRefreshing}
          onPress={refresh}
          className="rounded-full border-continuous bg-card px-3 py-2 disabled:opacity-50"
        >
          <Text className="text-sm font-t3-medium text-foreground">
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </Text>
        </Pressable>
      </View>

      {phase === "loading" ? (
        <View className="items-center gap-3 rounded-[24px] border-continuous bg-card px-4 py-10">
          <ActivityIndicator />
          <Text className="text-sm text-foreground-muted">Reading provider allowance…</Text>
        </View>
      ) : groups.length === 0 ? (
        <View className="gap-1 rounded-[24px] border-continuous bg-card px-4 py-6">
          {environmentNotices.length > 0 ? (
            environmentNotices.map((notice) => (
              <Text key={notice.environmentId} className="text-sm text-foreground-muted">
                {notice.message}
              </Text>
            ))
          ) : environments.length === 0 ? (
            <Text className="text-sm text-foreground-muted">
              Connect an environment to see subscription allowance.
            </Text>
          ) : (
            <Text className="text-sm text-foreground-muted">
              No enabled provider reports subscription allowance data.
            </Text>
          )}
        </View>
      ) : (
        <>
          {environmentNotices.length > 0 ? (
            <View className="gap-1 rounded-[16px] border-continuous bg-card px-4 py-3">
              {environmentNotices.map((notice) => (
                <Text key={notice.environmentId} className="text-xs text-foreground-muted">
                  {notice.message}
                </Text>
              ))}
            </View>
          ) : null}
          {phase === "partial" ? (
            <Text className="text-xs text-foreground-muted">
              Some environments are still reporting.
            </Text>
          ) : null}
          <View className="gap-4">
            {groups.map((group) => (
              <SubscriptionAllowanceCard key={group.key} model={presentAllowanceGroup(group)} />
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function SubscriptionAllowanceCard(props: { readonly model: MobileAllowanceCardModel }) {
  const { model } = props;
  const updatedAt = formatAllowanceUpdatedAt(model.updatedAt);

  return (
    <View className="gap-5 rounded-[24px] border-continuous bg-card p-4">
      <View className="gap-1">
        <View className="flex-row items-baseline gap-2">
          <Text accessibilityRole="header" className="text-lg font-t3-medium text-foreground">
            {model.providerLabel}
          </Text>
          {model.accountLabel !== null ? (
            <Text className="min-w-0 flex-1 text-sm text-foreground-muted" numberOfLines={1}>
              {model.accountLabel}
            </Text>
          ) : null}
        </View>
        <View className="flex-row items-baseline justify-between gap-2">
          <Text className="min-w-0 flex-1 text-xs text-foreground-muted" numberOfLines={1}>
            {model.sourceLabel}
          </Text>
          <Text
            className={
              model.freshness === "stale"
                ? "text-xs font-t3-medium text-amber-600"
                : "text-xs text-foreground-muted"
            }
          >
            {model.freshness === "stale"
              ? "Stale"
              : updatedAt === null
                ? "Updated time unavailable"
                : `Updated ${updatedAt}`}
          </Text>
        </View>
      </View>

      {model.status === "unavailable" ? (
        <Text className="text-sm text-foreground-muted">{model.message}</Text>
      ) : (
        <>
          <View className="gap-4">
            {model.windows.map((window) => (
              <AllowanceWindowRow key={window.scope} window={window} />
            ))}
          </View>
          <AllowanceMetadata model={model} />
        </>
      )}

      {model.hasMultipleReadings ? (
        <Text className="border-t border-border-subtle pt-3 text-xs text-foreground-muted">
          Multiple readings are available; showing one whole provider source.
        </Text>
      ) : null}
      {model.sources.length > 1 ? <AllowanceSources sources={model.sources} /> : null}
    </View>
  );
}

function AllowanceWindowRow(props: {
  readonly window: MobileAllowanceCardModel["windows"][number];
}) {
  const { window } = props;
  const hasUsage = window.usedPercent !== undefined && window.usedPercent !== null;
  const duration = formatAllowanceDuration(window.windowDurationMins);
  const reset =
    window.resetsAt === undefined || window.resetsAt === null
      ? null
      : formatAllowanceResetAt(window.resetsAt);

  return (
    <View className="gap-1.5">
      <View className="flex-row items-baseline justify-between gap-3">
        <Text className="min-w-0 flex-1 text-sm text-foreground">
          {formatAllowanceWindowScope(window.scope)}
        </Text>
        <Text className="text-sm tabular-nums text-foreground">
          {hasUsage ? `${window.usedPercent}% used` : "Not reported"}
        </Text>
      </View>
      {hasUsage ? (
        <View className="h-1.5 flex-row overflow-hidden rounded-full bg-subtle">
          <View
            className="h-full rounded-full bg-foreground"
            style={{ width: `${progressWidthForAllowance(window.usedPercent)}%` }}
          />
        </View>
      ) : null}
      {duration !== null || reset !== null ? (
        <Text className="text-xs text-foreground-muted">
          {[duration, reset === null ? null : `Resets ${reset}`].filter(Boolean).join(" · ")}
        </Text>
      ) : null}
    </View>
  );
}

function AllowanceMetadata(props: { readonly model: MobileAllowanceCardModel }) {
  const { model } = props;
  const credits = model.credits;
  const spendingControl = model.spendingControl;
  const extraUsage = model.extraUsage;

  return (
    <>
      {credits !== null ? (
        <View className="flex-row flex-wrap gap-x-4 gap-y-1 border-t border-border-subtle pt-3">
          <Text className="text-xs text-foreground-muted">Credits</Text>
          {credits.balance !== undefined && credits.balance !== null ? (
            <Text className="text-xs text-foreground-muted">Balance {credits.balance}</Text>
          ) : null}
          <Text className="text-xs text-foreground-muted">
            {credits.unlimited ? "Unlimited" : credits.hasCredits ? "Available" : "No credits"}
          </Text>
        </View>
      ) : null}

      {spendingControl !== null ? (
        <View className="flex-row flex-wrap gap-x-4 gap-y-1 border-t border-border-subtle pt-3">
          <Text className="text-xs text-foreground-muted">Spending control</Text>
          {spendingControl.reached !== undefined && spendingControl.reached !== null ? (
            <Text className="text-xs text-foreground-muted">
              {spendingControl.reached ? "Reached" : "Not reached"}
            </Text>
          ) : null}
          {spendingControl.used !== undefined &&
          spendingControl.used !== null &&
          spendingControl.limit !== undefined &&
          spendingControl.limit !== null ? (
            <Text className="text-xs text-foreground-muted">
              Used {spendingControl.used} / {spendingControl.limit}
            </Text>
          ) : null}
          {spendingControl.remainingPercent !== undefined &&
          spendingControl.remainingPercent !== null ? (
            <Text className="text-xs text-foreground-muted">
              {spendingControl.remainingPercent}% remaining
            </Text>
          ) : null}
          {spendingControl.resetsAt !== undefined && spendingControl.resetsAt !== null ? (
            <Text className="text-xs text-foreground-muted">
              Resets {formatAllowanceResetAt(spendingControl.resetsAt)}
            </Text>
          ) : null}
        </View>
      ) : null}

      {extraUsage !== null ? (
        <View className="flex-row flex-wrap gap-x-4 gap-y-1 border-t border-border-subtle pt-3">
          <Text className="text-xs text-foreground-muted">Extra usage</Text>
          <Text className="text-xs text-foreground-muted">
            {extraUsage.isEnabled ? "Enabled" : "Disabled"}
          </Text>
          {extraUsage.monthlyLimit !== null ? (
            <Text className="text-xs text-foreground-muted">
              Monthly limit {extraUsage.monthlyLimit}
            </Text>
          ) : null}
          {extraUsage.usedCredits !== null ? (
            <Text className="text-xs text-foreground-muted">
              Used credits {extraUsage.usedCredits}
            </Text>
          ) : null}
          {extraUsage.utilization !== null ? (
            <Text className="text-xs text-foreground-muted">{extraUsage.utilization}% used</Text>
          ) : null}
          {extraUsage.currency !== undefined && extraUsage.currency !== null ? (
            <Text className="text-xs text-foreground-muted">{extraUsage.currency}</Text>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

function AllowanceSources(props: {
  readonly sources: readonly MobileAllowanceCardModel["sources"][number][];
}) {
  return (
    <View className="gap-1 border-t border-border-subtle pt-3">
      <Text className="text-xs text-foreground-muted">Sources</Text>
      {props.sources.map((source) => (
        <Text key={source.key} className="text-xs text-foreground-muted">
          {source.environmentLabel} · {source.instanceId} · {source.connectionLabel} ·{" "}
          {source.status}
          {source.status === "unavailable"
            ? " · unavailable"
            : source.freshness === "stale"
              ? " · stale"
              : " · current"}
          {source.isEffective ? " · shown" : ""}
        </Text>
      ))}
    </View>
  );
}

function SegmentedControl<Value extends number | string>(props: {
  readonly accessibilityLabel?: string;
  readonly options: readonly { readonly value: Value; readonly label: string }[];
  readonly selected: Value;
  readonly onSelect: (value: Value) => void;
}) {
  return (
    <View
      accessibilityLabel={props.accessibilityLabel}
      className="flex-row overflow-hidden rounded-full border-continuous bg-card"
    >
      {props.options.map((option) => {
        const active = option.value === props.selected;
        return (
          <Pressable
            key={String(option.value)}
            accessibilityLabel={option.label}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => props.onSelect(option.value)}
            className={
              active
                ? "flex-1 items-center rounded-full bg-subtle-strong py-2"
                : "flex-1 items-center py-2"
            }
          >
            <Text
              className={
                active ? "text-sm font-t3-medium text-foreground" : "text-sm text-foreground-muted"
              }
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Headline figure, the animated daily chart, and its legend, in one card. */
function ChartCard(props: {
  readonly merged: MergedUsage;
  readonly days: readonly string[];
  readonly metric: UsageChartMetric;
  readonly onMetricChange: (metric: UsageChartMetric) => void;
  readonly sinceDay: string;
  readonly untilDay: string;
}) {
  const { merged, metric } = props;
  const colors = useProviderColors();
  const hasActivity = merged.daily.some((day) => day.totalTokens > 0);

  return (
    <View className="gap-4 rounded-[24px] border-continuous bg-card p-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-sm text-foreground-muted">
            {metric === "cost" ? "Raw token cost" : "Processed tokens"}
          </Text>
          <Text className="text-4xl font-t3-bold tabular-nums text-foreground">
            {metric === "cost" ? `${formatUsd(merged.costUsd)}*` : formatTokens(merged.totalTokens)}
          </Text>
          <Text className="text-sm text-foreground-muted">
            {metric === "cost"
              ? "* if billed at full API rate"
              : `Across ${formatCount(merged.sessions)} sessions`}
          </Text>
        </View>
        <MetricToggle metric={metric} onChange={props.onMetricChange} />
      </View>

      {hasActivity ? (
        <UsageDailyChart
          days={props.days}
          daily={merged.daily}
          metric={metric}
          height={CHART_HEIGHT}
        />
      ) : (
        <View style={{ height: CHART_HEIGHT }} className="items-center justify-center">
          <Text className="text-base text-foreground-muted">No activity in this window.</Text>
        </View>
      )}

      <View className="flex-row items-center justify-between">
        <Text className="text-xs text-foreground-tertiary">{formatDayShort(props.sinceDay)}</Text>
        <View className="flex-row items-center gap-4">
          {merged.providers.map((provider) => (
            <View key={provider.provider} className="flex-row items-center gap-1.5">
              <View
                className="size-2 rounded-full"
                style={{ backgroundColor: colors[provider.provider] }}
              />
              <Text className="text-xs text-foreground-muted">
                {PROVIDER_LABEL[provider.provider]}
              </Text>
            </View>
          ))}
        </View>
        <Text className="text-xs text-foreground-tertiary">{formatDayShort(props.untilDay)}</Text>
      </View>
    </View>
  );
}

function MetricToggle(props: {
  readonly metric: UsageChartMetric;
  readonly onChange: (metric: UsageChartMetric) => void;
}) {
  return (
    <View className="flex-row overflow-hidden rounded-full bg-subtle">
      {(["cost", "tokens"] as const).map((option) => {
        const active = option === props.metric;
        return (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => props.onChange(option)}
            className={active ? "rounded-full bg-subtle-strong px-3 py-1.5" : "px-3 py-1.5"}
          >
            <Text
              className={
                active
                  ? "text-xs font-t3-medium uppercase text-foreground"
                  : "text-xs uppercase text-foreground-muted"
              }
            >
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ProviderSection(props: {
  readonly merged: MergedUsage;
  readonly metric: UsageChartMetric;
}) {
  const { merged, metric } = props;
  const colors = useProviderColors();
  if (merged.providers.length === 0) return null;

  // Ranked by whatever the toggle is showing, so the rows always descend.
  // .sort() on a copy, not .toSorted(): Hermes doesn't ship the ES2023 method.
  const ordered = [...merged.providers].sort((a, b) =>
    metric === "cost" ? b.costUsd - a.costUsd : b.totalTokens - a.totalTokens,
  );

  return (
    <SettingsSection title="Providers" card>
      {ordered.map((provider, index) => {
        const share = metric === "cost" ? provider.costShare : provider.tokenShare;
        return (
          <View
            key={provider.provider}
            className={index === 0 ? "gap-2 p-4" : "gap-2 border-t border-border-subtle p-4"}
          >
            <View className="flex-row items-baseline justify-between gap-3">
              <View className="flex-row items-center gap-2">
                <View
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: colors[provider.provider] }}
                />
                <Text className="text-lg text-foreground">{PROVIDER_LABEL[provider.provider]}</Text>
              </View>
              <Text className="text-lg tabular-nums text-foreground">
                {metric === "cost"
                  ? formatUsd(provider.costUsd)
                  : formatTokens(provider.totalTokens)}
              </Text>
            </View>
            <View className="h-1 flex-row overflow-hidden rounded-full bg-subtle">
              <View
                className="h-full rounded-full"
                style={{ flex: share, backgroundColor: colors[provider.provider] }}
              />
              <View style={{ flex: 1 - share }} />
            </View>
            <Text className="text-sm text-foreground-muted">
              {metric === "cost"
                ? `${formatPercent(share)} of cost · ${formatTokens(provider.totalTokens)} tokens`
                : `${formatPercent(share)} of tokens · ${formatUsd(provider.costUsd)}`}
            </Text>
          </View>
        );
      })}
    </SettingsSection>
  );
}

function TotalsSection(props: { readonly merged: MergedUsage }) {
  const { merged } = props;
  const activeDays = merged.daily.filter((day) => day.totalTokens > 0).length;
  const dailyAverage = activeDays === 0 ? 0 : merged.totalTokens / activeDays;
  const observedInput = merged.uncachedInputTokens + merged.cachedInputTokens;
  const cachedShare = observedInput === 0 ? 0 : merged.cachedInputTokens / observedInput;

  return (
    <SettingsSection title="Totals" card>
      <View className="flex-row flex-wrap">
        <MetricCell
          label="Processed tokens"
          value={formatTokens(merged.totalTokens)}
          detail={`${formatTokens(dailyAverage)} per active day`}
        />
        <MetricCell
          label="Cache savings"
          value={formatUsd(merged.costQuality.cacheSavingsUsd)}
          detail={
            merged.costUsd > 0
              ? `${(merged.costQuality.cacheSavingsUsd / merged.costUsd).toFixed(1)}x the raw cost`
              : "vs full input rates"
          }
        />
        <MetricCell
          label="Cached input"
          value={formatTokens(merged.cachedInputTokens)}
          detail={`${formatPercent(cachedShare)} of observed input`}
        />
        <MetricCell
          label="Uncached input"
          value={formatTokens(merged.uncachedInputTokens)}
          detail={`${formatTokens(merged.cacheCreationTokens)} cache writes`}
        />
        <MetricCell
          label="Output"
          value={formatTokens(merged.outputTokens)}
          detail={`incl. ${formatTokens(merged.reasoningTokens)} reasoning`}
        />
        <MetricCell
          label="Unpriced"
          value={formatPercent(merged.costQuality.unpricedShare)}
          detail="of records, excluded from cost"
        />
      </View>
    </SettingsSection>
  );
}

function MetricCell(props: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}) {
  return (
    <View className="w-1/2 gap-0.5 p-4">
      <Text className="text-sm text-foreground-muted">{props.label}</Text>
      <Text className="text-xl font-t3-medium tabular-nums text-foreground">{props.value}</Text>
      <Text className="text-xs text-foreground-tertiary">{props.detail}</Text>
    </View>
  );
}

function ModelsSection(props: { readonly merged: MergedUsage }) {
  const { merged } = props;
  const colors = useProviderColors();
  if (merged.models.length === 0) return null;

  return (
    <SettingsSection title="By model" card>
      {merged.models.map((model, index) => (
        <View
          key={`${model.provider}:${model.model}`}
          className={
            index === 0
              ? "flex-row items-center gap-3 p-4"
              : "flex-row items-center gap-3 border-t border-border-subtle p-4"
          }
        >
          <View
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: colors[model.provider] }}
          />
          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="text-base text-foreground" numberOfLines={1}>
              {model.model}
            </Text>
            <Text className="text-sm text-foreground-muted">
              {formatPercent(model.costShare)} of cost · {formatTokens(model.totalTokens)} tokens
            </Text>
          </View>
          <Text className="text-base tabular-nums text-foreground">{formatUsd(model.costUsd)}</Text>
        </View>
      ))}
    </SettingsSection>
  );
}

/**
 * Says plainly when the totals are incomplete: an environment still answering,
 * one that failed, or one whose transcripts another environment already
 * reported.
 */
function UsageCoverageNotice(props: {
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly merged: MergedUsage;
  readonly isPartial: boolean;
}) {
  const failed = props.environments.filter((environment) => environment.error !== null);
  const stale = props.environments.filter((environment) =>
    props.merged.staleEnvironments.includes(environment.environmentId),
  );
  const duplicateSources = props.merged.duplicateSources;
  if (
    failed.length === 0 &&
    stale.length === 0 &&
    duplicateSources.length === 0 &&
    !props.isPartial
  ) {
    return null;
  }

  return (
    <View className="gap-1 rounded-[16px] border-continuous bg-card px-4 py-3">
      {props.isPartial ? (
        <Text className="text-sm text-foreground-muted">
          Some environments are still reporting. Totals are partial.
        </Text>
      ) : null}
      {failed.map((environment) => (
        <Text key={environment.environmentId} className="text-sm text-foreground-muted">
          {environment.label} could not report usage.
        </Text>
      ))}
      {stale.map((environment) => (
        <Text key={environment.environmentId} className="text-sm text-foreground-muted">
          {environment.label} runs an older server version and is excluded from totals.
        </Text>
      ))}
      {duplicateSources.length > 0 ? (
        <Text className="text-sm text-foreground-muted">
          Counted once across environments sharing a transcript directory:{" "}
          {duplicateSources.join(", ")}
        </Text>
      ) : null}
    </View>
  );
}
