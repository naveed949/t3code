import { useAtomValue } from "@effect/atom-react";
import {
  applyOptimisticWayfinderMutation,
  createWayfinderTicketAction,
  isWayfinderMutationInFlight,
  WAYFINDER_TICKET_CLASSIFICATIONS,
  type WayfinderTicketClassification,
} from "@t3tools/client-runtime/state/wayfinder-workbench";
import {
  findThreadWayfinderWorkstream,
  findWayfinderReconciliationInvocation,
  type ProjectSkillWorkstream,
} from "@t3tools/client-runtime/state/skill-runs";
import {
  advanceWayfinderReconciliationLifecycle,
  WAYFINDER_CONDITIONAL_REFRESH_INTERVAL_MS,
  type WayfinderReconciliationLifecycleEvent,
} from "@t3tools/client-runtime/state/wayfinder-reconciliation";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ThreadId,
  type WayfinderMapProjection,
  type WayfinderMutation,
  type WayfinderMutationAction,
  type WayfinderReconcileReason,
} from "@t3tools/contracts";
import {
  StackActions,
  useFocusEffect,
  useIsFocused,
  useNavigation,
  type StaticScreenProps,
} from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, TextInput, View } from "react-native";
import { Atom } from "effect/unstable/reactivity";

import { AppText as Text } from "../../components/AppText";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { useEnvironments } from "../../state/environments";
import {
  environmentThreadDetails,
  environmentThreadShells,
  threadEnvironment,
} from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  buildMobileDependencyAction,
  buildMobileTicketClaimActions,
  buildMobileTicketAction,
  buildMobileWayfinderPresentation,
} from "./WayfinderWorkbench.logic";

const EMPTY_WORKSTREAMS_ATOM = Atom.make<ReadonlyArray<ProjectSkillWorkstream>>([]);

type WayfinderWorkbenchRouteParams = {
  environmentId: string;
  threadId: string;
};

function TicketActions(props: {
  readonly ticket: WayfinderMapProjection["tickets"][number];
  readonly disabled: boolean;
  readonly onMutate: (action: WayfinderMutationAction) => void;
}) {
  const [value, setValue] = useState(props.ticket.title);
  const [resolution, setResolution] = useState("");
  const nextClassification =
    WAYFINDER_TICKET_CLASSIFICATIONS[
      (WAYFINDER_TICKET_CLASSIFICATIONS.indexOf(
        props.ticket.classification as WayfinderTicketClassification,
      ) +
        1) %
        WAYFINDER_TICKET_CLASSIFICATIONS.length
    ] ?? "research";
  return (
    <View className="mt-3 gap-2 border-t border-border pt-3">
      <TextInput
        accessibilityLabel={`Rename ${props.ticket.title}`}
        className="rounded-lg border border-border px-3 py-2 text-foreground"
        value={value}
        onChangeText={setValue}
      />
      <TextInput
        accessibilityLabel={`Resolution for ${props.ticket.title}`}
        className="rounded-lg border border-border px-3 py-2 text-foreground"
        value={resolution}
        onChangeText={setResolution}
      />
      <View className="flex-row flex-wrap gap-2">
        <Pressable
          accessibilityRole="button"
          disabled={props.disabled || !value.trim()}
          className="rounded-lg border border-border px-3 py-2"
          onPress={() => {
            const action = buildMobileTicketAction(props.ticket, { kind: "rename", value });
            if (action) props.onMutate(action);
          }}
        >
          <Text className="text-xs font-semibold">Rename</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={props.disabled}
          className="rounded-lg border border-border px-3 py-2"
          onPress={() => {
            const action = buildMobileTicketAction(props.ticket, {
              kind: "classify",
              classification: nextClassification,
            });
            if (action) props.onMutate(action);
          }}
        >
          <Text className="text-xs font-semibold">Classify as {nextClassification}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={props.disabled}
          className="rounded-lg border border-border px-3 py-2"
          onPress={() => {
            const action = buildMobileTicketAction(props.ticket, { kind: "toggle-state" });
            if (action) props.onMutate(action);
          }}
        >
          <Text className="text-xs font-semibold">
            {props.ticket.state === "open" ? "Close" : "Reopen"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={props.disabled || !resolution.trim()}
          className="rounded-lg border border-border px-3 py-2"
          onPress={() => {
            const action = buildMobileTicketAction(props.ticket, {
              kind: "resolve",
              value: resolution,
            });
            if (action) props.onMutate(action);
          }}
        >
          <Text className="text-xs font-semibold">Record resolution</Text>
        </Pressable>
      </View>
    </View>
  );
}

function TicketList(props: {
  readonly map: WayfinderMapProjection;
  readonly mutation: WayfinderMutation | null;
  readonly ticketThreads: ProjectSkillWorkstream["ticketThreads"];
  readonly disabled: boolean;
  readonly onMutate: (action: WayfinderMutationAction) => void;
  readonly onReturnToThread: (threadId: ThreadId) => void;
}) {
  const presentation = buildMobileWayfinderPresentation(props.map);
  return (
    <View className="gap-2">
      {presentation.tickets.map((ticket) => {
        const linkedThreadId =
          props.ticketThreads.find((link) => link.ticketNumber === ticket.number)?.threadId ?? null;
        const claimActions = buildMobileTicketClaimActions(
          ticket,
          props.map.frontier,
          linkedThreadId,
          props.mutation,
        );
        return (
          <View key={ticket.number} className="rounded-xl border border-border bg-card p-4">
            <View className="flex-row items-start justify-between gap-3">
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`${ticket.title}, ${ticket.state}, ${ticket.classification}`}
                onPress={() => void tryOpenExternalUrl(ticket.url, "wayfinder")}
              >
                <Text className="min-w-0 flex-1 text-sm font-semibold text-foreground underline">
                  {ticket.title}
                </Text>
              </Pressable>
              <Text className="text-xs capitalize text-foreground-muted">{ticket.state}</Text>
            </View>
            <Text className="mt-1 text-xs capitalize text-foreground-muted">
              {ticket.classification}
              {ticket.claimedBy ? ` · Claimed by ${ticket.claimedBy}` : " · Unclaimed"}
              {ticket.commentCount ? ` · ${ticket.commentCount} comments` : ""}
            </Text>
            {ticket.blockedBy.length > 0 ? (
              <Text className="mt-1 text-xs text-foreground-muted">
                Blocked by {ticket.blockedBy.map((number) => `#${number}`).join(", ")}
              </Text>
            ) : props.map.frontier.includes(ticket.number) ? (
              <Text className="mt-1 text-xs font-semibold text-foreground">Frontier</Text>
            ) : null}
            <View className="mt-3 flex-row flex-wrap gap-2">
              {claimActions.canClaim ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={props.disabled}
                  className="rounded-lg border border-border px-3 py-2"
                  onPress={() =>
                    props.onMutate({ kind: "claim-ticket", ticketNumber: ticket.number })
                  }
                >
                  <Text className="text-xs font-semibold">{claimActions.claimLabel}</Text>
                </Pressable>
              ) : null}
              {claimActions.canRetry ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={props.disabled}
                  className="rounded-lg border border-border px-3 py-2"
                  onPress={() =>
                    props.onMutate({ kind: "claim-ticket", ticketNumber: ticket.number })
                  }
                >
                  <Text className="text-xs font-semibold">Retry thread linkage</Text>
                </Pressable>
              ) : null}
              {claimActions.linkedThreadId ? (
                <Pressable
                  accessibilityRole="button"
                  className="rounded-lg border border-border px-3 py-2"
                  onPress={() => props.onReturnToThread(claimActions.linkedThreadId!)}
                >
                  <Text className="text-xs font-semibold">Return to thread</Text>
                </Pressable>
              ) : null}
              {claimActions.canRelease ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={props.disabled}
                  className="rounded-lg border border-border px-3 py-2"
                  onPress={() =>
                    props.onMutate({ kind: "release-ticket", ticketNumber: ticket.number })
                  }
                >
                  <Text className="text-xs font-semibold">Release</Text>
                </Pressable>
              ) : null}
            </View>
            <TicketActions ticket={ticket} disabled={props.disabled} onMutate={props.onMutate} />
          </View>
        );
      })}
    </View>
  );
}

function CompactGraph(props: { readonly map: WayfinderMapProjection }) {
  const presentation = buildMobileWayfinderPresentation(props.map);
  const ticketsByNumber = new Map(
    props.map.tickets.map((ticket) => [ticket.number, ticket] as const),
  );
  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={presentation.graphAccessibilityLabel}
      className="gap-2 rounded-xl border border-border bg-card p-4"
    >
      {presentation.graphRows.map((row) => (
        <View
          key={row.ticketNumber}
          className="rounded-lg border border-border bg-background p-3"
          style={{ marginLeft: Math.min(row.depth, 4) * 16 }}
        >
          <Text className="text-xs font-semibold text-foreground">
            {ticketsByNumber.get(row.ticketNumber)?.title ?? `#${row.ticketNumber}`}
          </Text>
          {row.dependsOn.length > 0 ? (
            <Text className="mt-1 text-xs text-foreground-muted">
              Depends on {row.dependsOn.map((number) => `#${number}`).join(", ")}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function WayfinderWorkbenchContent(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectId: Parameters<typeof scopeProjectRef>[1];
  readonly onReturnToThread: (threadId: ThreadId) => void;
}) {
  const [showGraph, setShowGraph] = useState(false);
  const mutateWayfinder = useAtomCommand(threadEnvironment.mutateWayfinder, "update Wayfinder");
  const [appState, setAppState] = useState(AppState.currentState);
  const reconcileWayfinderMapCommand = useAtomCommand(
    threadEnvironment.reconcileWayfinderMap,
    "reconcile Wayfinder map",
  );
  const { environments } = useEnvironments();
  const isFocused = useIsFocused();
  const workstreams = useAtomValue(
    environmentThreadShells.projectWorkstreamsAtom(
      scopeProjectRef(props.environmentId, props.projectId),
    ) ?? EMPTY_WORKSTREAMS_ATOM,
  );
  const workstream = findThreadWayfinderWorkstream(props.threadId, workstreams);
  const thread = useAtomValue(
    environmentThreadDetails.detailAtom(scopeThreadRef(props.environmentId, props.threadId)),
  );
  const invocation = findWayfinderReconciliationInvocation(
    workstream,
    thread?.latestTurn?.skillInvocation ?? null,
  );
  const canonicalMap = workstream?.wayfinderMap ?? invocation?.wayfinderMap ?? null;
  const mutation: WayfinderMutation | null = invocation?.wayfinderMutation ?? null;
  const map = canonicalMap ? applyOptimisticWayfinderMutation(canonicalMap, mutation) : null;
  const [destination, setDestination] = useState(canonicalMap?.destination ?? "");
  const [notes, setNotes] = useState(canonicalMap?.notes ?? "");
  const [fog, setFog] = useState(canonicalMap?.fogOfWar.join("\n") ?? "");
  const [outOfScope, setOutOfScope] = useState(canonicalMap?.outOfScope.join("\n") ?? "");
  const [newTicketTitle, setNewTicketTitle] = useState("");
  const [newTicketClassification, setNewTicketClassification] =
    useState<WayfinderTicketClassification>("grilling");
  const [blocker, setBlocker] = useState("");
  const [blocked, setBlocked] = useState("");
  useEffect(() => {
    if (!canonicalMap) return;
    setDestination(canonicalMap.destination);
    setNotes(canonicalMap.notes);
    setFog(canonicalMap.fogOfWar.join("\n"));
    setOutOfScope(canonicalMap.outOfScope.join("\n"));
  }, [canonicalMap?.lastSynchronizedAt]);
  const working = isWayfinderMutationInFlight(mutation);
  const onMutate = (action: WayfinderMutationAction, confirmed = false) => {
    if (!invocation) return;
    void mutateWayfinder({
      environmentId: props.environmentId,
      input: {
        threadId: props.threadId,
        skillRunId: invocation.skillRunId,
        action,
        ...(confirmed && mutation ? { actionId: mutation.actionId } : {}),
        confirmed,
      },
    });
  };
  const invocationSkillRunId = invocation?.skillRunId;
  const connected =
    environments.find((environment) => environment.environmentId === props.environmentId)
      ?.connection.phase === "connected";
  const reconcile = useCallback(
    (reason: WayfinderReconcileReason) => {
      if (!invocation) return;
      void reconcileWayfinderMapCommand({
        environmentId: props.environmentId,
        input: {
          threadId: invocation.threadId,
          skillRunId: invocation.skillRunId,
          reason,
        },
      });
    },
    [invocation, props.environmentId, reconcileWayfinderMapCommand],
  );
  const reconcileRef = useRef(reconcile);
  reconcileRef.current = reconcile;
  const lifecycleRef = useRef({
    connected,
    visible: false,
    hasOpened: false,
  });
  const advanceLifecycle = useCallback((event: WayfinderReconciliationLifecycleEvent) => {
    const transition = advanceWayfinderReconciliationLifecycle(lifecycleRef.current, event);
    lifecycleRef.current = transition.lifecycle;
    if (transition.reason) reconcileRef.current(transition.reason);
  }, []);
  useFocusEffect(
    useCallback(() => {
      if (!invocationSkillRunId) return;
      advanceLifecycle({
        type: "visibility",
        visible: AppState.currentState === "active",
      });
      const subscription = AppState.addEventListener("change", (state) => {
        setAppState(state);
        advanceLifecycle({ type: "visibility", visible: state === "active" });
      });
      return () => {
        subscription.remove();
        advanceLifecycle({ type: "visibility", visible: false });
      };
    }, [advanceLifecycle, invocationSkillRunId]),
  );
  useEffect(() => {
    advanceLifecycle({ type: "connection", connected });
  }, [advanceLifecycle, connected]);
  useEffect(() => {
    if (!connected || !invocationSkillRunId || !isFocused || appState !== "active") return;
    const interval = setInterval(
      () => advanceLifecycle({ type: "poll" }),
      WAYFINDER_CONDITIONAL_REFRESH_INTERVAL_MS,
    );
    return () => clearInterval(interval);
  }, [advanceLifecycle, appState, connected, invocationSkillRunId, isFocused]);
  if (!map) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <Text className="text-center text-sm text-foreground-muted">
          No synchronized Wayfinder map is linked to this thread.
        </Text>
      </View>
    );
  }
  const presentation = buildMobileWayfinderPresentation(map);
  const synchronization = workstream?.wayfinderSynchronization ?? null;
  const synchronizationStatus = synchronization?.status ?? "healthy";
  const lastSuccessfulAt = synchronization?.lastSuccessfulAt ?? map.lastSynchronizedAt;

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="gap-6 p-4 pb-12"
      accessibilityLabel={presentation.accessibilitySummary}
    >
      <View className="gap-2">
        <Text className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          Wayfinder Workbench
        </Text>
        <Text className="text-xl font-bold text-foreground">{map.canonicalReference.title}</Text>
        <Text className="text-xs text-foreground-muted">
          {synchronizationStatus === "unavailable" || synchronizationStatus === "conflict"
            ? "Cached read-only map"
            : "Canonical GitHub map"}
          {` · Last synchronized ${lastSuccessfulAt}`}
        </Text>
        {synchronization?.message ? (
          <Text
            accessibilityRole={synchronizationStatus === "conflict" ? "alert" : "text"}
            className={
              synchronizationStatus === "conflict"
                ? "text-xs text-destructive"
                : "text-xs text-foreground-muted"
            }
          >
            {synchronization.message}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh Wayfinder map from GitHub"
          disabled={!connected || synchronizationStatus === "synchronizing"}
          className="self-start rounded-lg border border-border px-3 py-2 disabled:opacity-50"
          onPress={() => advanceLifecycle({ type: "manual" })}
        >
          <Text className="text-xs font-semibold text-foreground">
            {synchronizationStatus === "synchronizing" ? "Refreshing…" : "Refresh"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          onPress={() => void tryOpenExternalUrl(map.canonicalReference.url, "wayfinder")}
        >
          <Text className="text-sm font-semibold text-foreground underline">
            GitHub #{map.canonicalReference.number}
          </Text>
        </Pressable>
      </View>

      <View className="gap-3 rounded-xl border border-border bg-card p-4">
        <Text className="text-sm font-semibold">Structured actions</Text>
        {mutation ? (
          <Text accessibilityRole="summary" className="text-xs text-foreground-muted">
            {mutation.status === "failed" ? mutation.error : mutation.status.replace("-", " ")}
          </Text>
        ) : null}
        {mutation?.status === "awaiting-approval" ? (
          <Pressable
            accessibilityRole="button"
            className="rounded-lg border border-border px-3 py-2"
            onPress={() => onMutate(mutation.action, true)}
          >
            <Text className="text-xs font-semibold">Confirm GitHub change</Text>
          </Pressable>
        ) : null}
        <TextInput
          accessibilityLabel="Wayfinder destination"
          multiline
          className="rounded-lg border border-border px-3 py-2 text-foreground"
          value={destination}
          onChangeText={setDestination}
        />
        <Pressable
          accessibilityRole="button"
          disabled={working}
          className="self-start rounded-lg border border-border px-3 py-2"
          onPress={() =>
            onMutate({ kind: "update-map-field", field: "destination", value: destination })
          }
        >
          <Text className="text-xs font-semibold">Save destination</Text>
        </Pressable>
        <TextInput
          accessibilityLabel="Wayfinder notes"
          multiline
          className="rounded-lg border border-border px-3 py-2 text-foreground"
          value={notes}
          onChangeText={setNotes}
        />
        <Pressable
          accessibilityRole="button"
          disabled={working}
          className="self-start rounded-lg border border-border px-3 py-2"
          onPress={() => onMutate({ kind: "update-map-field", field: "notes", value: notes })}
        >
          <Text className="text-xs font-semibold">Save notes</Text>
        </Pressable>
        <TextInput
          accessibilityLabel="Wayfinder fog of war"
          multiline
          className="rounded-lg border border-border px-3 py-2 text-foreground"
          value={fog}
          onChangeText={setFog}
        />
        <Pressable
          accessibilityRole="button"
          disabled={working}
          className="self-start rounded-lg border border-border px-3 py-2"
          onPress={() => onMutate({ kind: "update-map-field", field: "fog-of-war", value: fog })}
        >
          <Text className="text-xs font-semibold">Save fog of war</Text>
        </Pressable>
        <TextInput
          accessibilityLabel="Wayfinder out of scope"
          multiline
          className="rounded-lg border border-border px-3 py-2 text-foreground"
          value={outOfScope}
          onChangeText={setOutOfScope}
        />
        <Pressable
          accessibilityRole="button"
          disabled={working}
          className="self-start rounded-lg border border-border px-3 py-2"
          onPress={() =>
            onMutate({ kind: "update-map-field", field: "out-of-scope", value: outOfScope })
          }
        >
          <Text className="text-xs font-semibold">Save out of scope</Text>
        </Pressable>
        <TextInput
          accessibilityLabel="New decision ticket title"
          className="rounded-lg border border-border px-3 py-2 text-foreground"
          value={newTicketTitle}
          onChangeText={setNewTicketTitle}
        />
        <View
          accessibilityLabel={`New ticket classification: ${newTicketClassification}`}
          className="flex-row flex-wrap gap-2"
        >
          {WAYFINDER_TICKET_CLASSIFICATIONS.map((classification) => (
            <Pressable
              key={classification}
              accessibilityRole="button"
              accessibilityState={{ selected: classification === newTicketClassification }}
              disabled={working}
              className="rounded-lg border border-border px-3 py-2"
              onPress={() => setNewTicketClassification(classification)}
            >
              <Text className="text-xs font-semibold">{classification}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={working || !newTicketTitle.trim()}
          className="self-start rounded-lg border border-border px-3 py-2"
          onPress={() => {
            const action = createWayfinderTicketAction(newTicketTitle, newTicketClassification);
            if (action) onMutate(action);
          }}
        >
          <Text className="text-xs font-semibold">Create {newTicketClassification} ticket</Text>
        </Pressable>
        <View className="flex-row gap-2">
          <TextInput
            accessibilityLabel="Blocker ticket number"
            keyboardType="number-pad"
            className="flex-1 rounded-lg border border-border px-3 py-2 text-foreground"
            value={blocker}
            onChangeText={setBlocker}
          />
          <TextInput
            accessibilityLabel="Blocked ticket number"
            keyboardType="number-pad"
            className="flex-1 rounded-lg border border-border px-3 py-2 text-foreground"
            value={blocked}
            onChangeText={setBlocked}
          />
        </View>
        <View className="flex-row gap-2">
          <Pressable
            accessibilityRole="button"
            disabled={working || !Number(blocker) || !Number(blocked)}
            className="rounded-lg border border-border px-3 py-2"
            onPress={() => {
              const action = buildMobileDependencyAction("add-dependency", blocker, blocked);
              if (action) onMutate(action);
            }}
          >
            <Text className="text-xs font-semibold">Add dependency</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={working || !Number(blocker) || !Number(blocked)}
            className="rounded-lg border border-border px-3 py-2"
            onPress={() => {
              const action = buildMobileDependencyAction("remove-dependency", blocker, blocked);
              if (action) onMutate(action);
            }}
          >
            <Text className="text-xs font-semibold">Remove</Text>
          </Pressable>
        </View>
      </View>

      <View>
        <Text className="mb-1 text-sm font-semibold text-foreground">Destination</Text>
        <Text className="text-sm leading-5 text-foreground">
          {map.destination || "No destination recorded."}
        </Text>
      </View>

      <View>
        <Text className="mb-1 text-sm font-semibold text-foreground">Notes</Text>
        <Text className="text-sm leading-5 text-foreground-muted">
          {map.notes || "No notes recorded."}
        </Text>
      </View>

      <View>
        <Text className="mb-1 text-sm font-semibold text-foreground">Decisions so far</Text>
        <Text className="text-sm leading-5 text-foreground-muted">
          {map.decisionsSoFar
            .map((decision) =>
              decision.summary ? `${decision.title}: ${decision.summary}` : decision.title,
            )
            .join("\n") || "No decisions recorded."}
        </Text>
      </View>

      <View>
        <View className="mb-2 flex-row items-center justify-between">
          <Text className="text-sm font-semibold text-foreground">Decision graph</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showGraph ? "Hide dependency graph" : "Show dependency graph"}
            className="rounded-lg border border-border px-3 py-2"
            onPress={() => setShowGraph((current) => !current)}
          >
            <Text className="text-xs font-semibold text-foreground">
              {showGraph ? "Hide graph" : "Show graph"}
            </Text>
          </Pressable>
        </View>
        {showGraph ? <CompactGraph map={map} /> : null}
      </View>

      <View>
        <Text className="mb-2 text-sm font-semibold text-foreground">Frontier and tickets</Text>
        <TicketList
          map={map}
          mutation={mutation}
          ticketThreads={workstream?.ticketThreads ?? []}
          disabled={working || !connected || synchronization?.canMutate === false}
          onMutate={onMutate}
          onReturnToThread={props.onReturnToThread}
        />
      </View>

      <View className="gap-4">
        <View>
          <Text className="mb-1 text-sm font-semibold text-foreground">Fog of war</Text>
          <Text className="text-xs leading-5 text-foreground-muted">
            {map.fogOfWar.join("\n") || "No unresolved fog."}
          </Text>
        </View>
        <View>
          <Text className="mb-1 text-sm font-semibold text-foreground">Out of scope</Text>
          <Text className="text-xs leading-5 text-foreground-muted">
            {map.outOfScope.join("\n") || "Nothing recorded."}
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

export function WayfinderWorkbenchRouteScreen({
  route,
}: StaticScreenProps<WayfinderWorkbenchRouteParams>) {
  const navigation = useNavigation();
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const threadId = ThreadId.make(route.params.threadId);
  const thread = useAtomValue(
    environmentThreadShells.threadShellAtom(scopeThreadRef(environmentId, threadId)),
  );
  if (!thread) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-sm text-foreground-muted">Loading Wayfinder map…</Text>
      </View>
    );
  }
  return (
    <WayfinderWorkbenchContent
      environmentId={environmentId}
      threadId={threadId}
      projectId={thread.projectId}
      onReturnToThread={(linkedThreadId) =>
        navigation.dispatch(
          StackActions.replace("Thread", {
            environmentId: String(environmentId),
            threadId: String(linkedThreadId),
          }),
        )
      }
    />
  );
}
