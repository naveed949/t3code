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
import { createWayfinderToSpecInvocationRequest } from "@t3tools/client-runtime/operations/native-skill-runs";
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
  type WayfinderResearchAction,
  type WayfinderResearchState,
} from "@t3tools/contracts";
import {
  StackActions,
  useFocusEffect,
  useIsFocused,
  useNavigation,
  type StaticScreenProps,
} from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Pressable, ScrollView, TextInput, View } from "react-native";
import { Atom } from "effect/unstable/reactivity";
import { deriveWayfinderReadiness } from "@t3tools/shared/wayfinderReadiness";

import { AppText as Text } from "../../components/AppText";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { makeTurnCommandMetadata } from "../../lib/commandMetadata";
import { buildProjectThreadStartTurnInput } from "../../lib/projectThreadStartTurn";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentServerConfig, useProject } from "../../state/entities";
import {
  environmentThreadDetails,
  environmentThreadShells,
  threadEnvironment,
} from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  buildMobileDependencyAction,
  buildMobileWayfinderCompletionPresentation,
  buildMobileGraduatedFogTicket,
  buildMobileHitlResolutionAction,
  buildMobileResearchPresentation,
  requestMobileWayfinderToSpecStart,
  buildMobileTicketClaimActions,
  buildMobileTicketAction,
  buildMobileWorkflowPresentation,
  buildMobileWayfinderPresentation,
} from "./WayfinderWorkbench.logic";
import { WorkflowPanel } from "./WorkflowPanel";

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
  readonly assignedTicketNumber: number | null;
  readonly disabled: boolean;
  readonly onMutate: (action: WayfinderMutationAction) => void;
  readonly onReturnToThread: (threadId: ThreadId) => void;
  readonly research: WayfinderResearchState | null;
  readonly onResearch: (action: WayfinderResearchAction) => void;
}) {
  const presentation = buildMobileWayfinderPresentation(props.map);
  const ticketThreadIdsByNumber = new Map(
    props.ticketThreads.map((link) => [link.ticketNumber, link.threadId] as const),
  );
  const research = buildMobileResearchPresentation({
    map: props.map,
    research: props.research,
    ticketThreads: props.ticketThreads,
  });
  const researchByTicket = new Map(
    research.tickets.map((ticket) => [ticket.ticketNumber, ticket] as const),
  );
  return (
    <View className="gap-2">
      {props.assignedTicketNumber === null ? (
        <View className="mb-2 flex-row items-center justify-between gap-3">
          <Text className="text-xs text-foreground-muted">
            Background research · Limit {research.concurrencyLimit}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={props.disabled}
            className="rounded-lg border border-border px-3 py-2"
            onPress={() =>
              props.onResearch({
                kind: research.automaticLaunchesPaused
                  ? "resume-automatic-launches"
                  : "pause-automatic-launches",
              })
            }
          >
            <Text className="text-xs font-semibold">
              {research.automaticLaunchesPaused
                ? "Resume automatic launches"
                : "Pause automatic launches"}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {presentation.tickets.map((ticket) => {
        const linkedThreadId = ticketThreadIdsByNumber.get(ticket.number) ?? null;
        const claimActions = buildMobileTicketClaimActions(
          ticket,
          props.map.frontier,
          linkedThreadId,
          props.mutation,
          props.assignedTicketNumber,
        );
        const ticketIsAssigned =
          props.assignedTicketNumber === null || ticket.number === props.assignedTicketNumber;
        const researchTicket = researchByTicket.get(ticket.number);
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
            {ticket.classification === "research" && researchTicket ? (
              <View className="mt-2 gap-1">
                <Text
                  accessibilityRole="summary"
                  className="text-xs capitalize text-foreground-muted"
                >
                  Research: {researchTicket.status.replace("-", " ")}
                  {researchTicket.launchMode ? ` · ${researchTicket.launchMode}` : ""}
                </Text>
                {researchTicket.output ? (
                  <Text className="rounded-lg border border-border p-2 text-xs text-foreground">
                    {researchTicket.output}
                  </Text>
                ) : null}
                {researchTicket.error ? (
                  <Text accessibilityRole="alert" className="text-xs text-destructive">
                    {researchTicket.error}
                  </Text>
                ) : null}
              </View>
            ) : null}
            <View className="mt-3 flex-row flex-wrap gap-2">
              {claimActions.canClaim && ticket.classification !== "research" ? (
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
              {ticketIsAssigned &&
              ticket.classification === "research" &&
              researchTicket?.canStart ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={props.disabled}
                  className="rounded-lg border border-border px-3 py-2"
                  onPress={() =>
                    props.onResearch({ kind: "start-ticket", ticketNumber: ticket.number })
                  }
                >
                  <Text className="text-xs font-semibold">Start research</Text>
                </Pressable>
              ) : null}
              {ticketIsAssigned && researchTicket?.canCancel ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={props.disabled}
                  className="rounded-lg border border-border px-3 py-2"
                  onPress={() =>
                    props.onResearch({ kind: "cancel-ticket", ticketNumber: ticket.number })
                  }
                >
                  <Text className="text-xs font-semibold">Cancel research</Text>
                </Pressable>
              ) : null}
              {ticketIsAssigned && researchTicket?.canRetry ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={props.disabled}
                  className="rounded-lg border border-border px-3 py-2"
                  onPress={() =>
                    props.onResearch({ kind: "retry-ticket", ticketNumber: ticket.number })
                  }
                >
                  <Text className="text-xs font-semibold">Retry research</Text>
                </Pressable>
              ) : null}
            </View>
            {props.assignedTicketNumber === null && ticketIsAssigned ? (
              <TicketActions ticket={ticket} disabled={props.disabled} onMutate={props.onMutate} />
            ) : null}
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

function HitlResolutionCard(props: {
  readonly map: WayfinderMapProjection;
  readonly ticketNumber: number;
  readonly mutation: WayfinderMutation | null;
  readonly disabled: boolean;
  readonly onComplete: (
    action: Extract<WayfinderMutationAction, { readonly kind: "complete-hitl-ticket" }>,
    resumeActionId?: string,
  ) => void;
}) {
  const ticket = props.map.tickets.find((candidate) => candidate.number === props.ticketNumber);
  const [outcome, setOutcome] = useState<"resolved" | "out-of-scope">("resolved");
  const [resolution, setResolution] = useState("");
  const [contextPointer, setContextPointer] = useState(ticket?.url ?? "");
  const [selectedFog, setSelectedFog] = useState(props.map.fogOfWar[0] ?? "");
  const [graduatedTitle, setGraduatedTitle] = useState("");
  const [classification, setClassification] = useState<WayfinderTicketClassification>("grilling");
  const [blockerNumbers, setBlockerNumbers] = useState("");
  const [graduatedFog, setGraduatedFog] = useState<
    Extract<WayfinderMutationAction, { readonly kind: "complete-hitl-ticket" }>["graduatedFog"]
  >([]);
  if (!ticket) return null;
  const activeResolution =
    props.mutation?.action.kind === "complete-hitl-ticket" &&
    props.mutation.action.ticketNumber === props.ticketNumber
      ? props.mutation
      : null;
  const submit = () => {
    const action = buildMobileHitlResolutionAction({
      ticketNumber: props.ticketNumber,
      outcome,
      resolution,
      contextPointer,
      graduatedFog,
    });
    if (action) props.onComplete(action);
  };

  return (
    <View className="gap-3 rounded-xl border border-border bg-card p-4">
      <Text className="text-sm font-semibold text-foreground">Resolve assigned decision</Text>
      <Text className="text-xs text-foreground-muted">
        Complete only #{props.ticketNumber} {ticket.title}. T3 records the canonical receipt before
        advancing the shared map.
      </Text>
      {activeResolution ? (
        <Text
          accessibilityRole={activeResolution.status === "failed" ? "alert" : "summary"}
          className="text-xs text-foreground-muted"
        >
          {activeResolution.status === "failed"
            ? `${activeResolution.error} Next: ${activeResolution.nextStep ?? "resume resolution"}.`
            : activeResolution.status}
        </Text>
      ) : null}
      {activeResolution?.status === "failed" ? (
        <Pressable
          accessibilityRole="button"
          disabled={props.disabled}
          className="self-start rounded-lg border border-border px-3 py-2 disabled:opacity-50"
          onPress={() => {
            const action = activeResolution.action;
            if (action.kind === "complete-hitl-ticket") {
              props.onComplete(action, activeResolution.actionId);
            }
          }}
        >
          <Text className="text-xs font-semibold">Resume resolution</Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Assigned ticket outcome: ${outcome}`}
        className="self-start rounded-lg border border-border px-3 py-2"
        onPress={() =>
          setOutcome((current) => (current === "resolved" ? "out-of-scope" : "resolved"))
        }
      >
        <Text className="text-xs font-semibold">
          {outcome === "resolved" ? "Resolved decision" : "Beyond destination"}
        </Text>
      </Pressable>
      <TextInput
        accessibilityLabel="Verified resolution"
        multiline
        className="rounded-lg border border-border px-3 py-2 text-foreground"
        value={resolution}
        onChangeText={setResolution}
      />
      <TextInput
        accessibilityLabel="Resolution context pointer"
        autoCapitalize="none"
        className="rounded-lg border border-border px-3 py-2 text-foreground"
        value={contextPointer}
        onChangeText={setContextPointer}
      />
      {outcome === "resolved" && props.map.fogOfWar.length > 0 ? (
        <View className="gap-2 border-t border-border pt-3">
          <Text className="text-xs font-semibold">Optional fog graduation</Text>
          <View className="flex-row flex-wrap gap-2">
            {props.map.fogOfWar.map((fog) => (
              <Pressable
                key={fog}
                accessibilityRole="button"
                accessibilityState={{ selected: fog === selectedFog }}
                className="rounded-lg border border-border px-3 py-2"
                onPress={() => setSelectedFog(fog)}
              >
                <Text className="text-xs">{fog}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            accessibilityLabel="Graduated ticket title"
            className="rounded-lg border border-border px-3 py-2 text-foreground"
            value={graduatedTitle}
            onChangeText={setGraduatedTitle}
          />
          <View className="flex-row flex-wrap gap-2">
            {WAYFINDER_TICKET_CLASSIFICATIONS.map((candidate) => (
              <Pressable
                key={candidate}
                accessibilityRole="button"
                accessibilityState={{ selected: candidate === classification }}
                className="rounded-lg border border-border px-3 py-2"
                onPress={() => setClassification(candidate)}
              >
                <Text className="text-xs">{candidate}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            accessibilityLabel="Graduated ticket blockers"
            placeholder="#42, key:transport-policy"
            className="rounded-lg border border-border px-3 py-2 text-foreground"
            value={blockerNumbers}
            onChangeText={setBlockerNumbers}
          />
          <Pressable
            accessibilityRole="button"
            className="self-start rounded-lg border border-border px-3 py-2"
            onPress={() => {
              const graduated = buildMobileGraduatedFogTicket({
                fog: selectedFog,
                title: graduatedTitle,
                classification,
                blockers: blockerNumbers,
              });
              if (!graduated) return;
              setGraduatedFog((current) => [...current, graduated]);
              setGraduatedTitle("");
              setBlockerNumbers("");
            }}
          >
            <Text className="text-xs font-semibold">Add graduated ticket</Text>
          </Pressable>
          {graduatedFog.map((graduated) => (
            <Text key={graduated.key} className="text-xs text-foreground-muted">
              {graduated.title} · {graduated.classification}
            </Text>
          ))}
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={props.disabled || !resolution.trim() || !contextPointer.trim()}
        className="self-start rounded-lg border border-border px-3 py-2 disabled:opacity-50"
        onPress={submit}
      >
        <Text className="text-xs font-semibold">Record canonical resolution</Text>
      </Pressable>
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
  const controlWayfinderResearch = useAtomCommand(
    threadEnvironment.controlWayfinderResearch,
    "control Wayfinder research",
  );
  const [appState, setAppState] = useState(AppState.currentState);
  const reconcileWayfinderMapCommand = useAtomCommand(
    threadEnvironment.reconcileWayfinderMap,
    "reconcile Wayfinder map",
  );
  const startTurn = useAtomCommand(threadEnvironment.startTurn, "start to-spec");
  const { environments } = useEnvironments();
  const isFocused = useIsFocused();
  const workstreams = useAtomValue(
    environmentThreadShells.projectWorkstreamsAtom(
      scopeProjectRef(props.environmentId, props.projectId),
    ) ?? EMPTY_WORKSTREAMS_ATOM,
  );
  const workstream = findThreadWayfinderWorkstream(props.threadId, workstreams);
  const project = useProject(scopeProjectRef(props.environmentId, props.projectId));
  const serverConfig = useEnvironmentServerConfig(props.environmentId);
  const thread = useAtomValue(
    environmentThreadDetails.detailAtom(scopeThreadRef(props.environmentId, props.threadId)),
  );
  const invocation = findWayfinderReconciliationInvocation(
    workstream,
    thread?.latestTurn?.skillInvocation ?? null,
  );
  const linkedTicketAction =
    thread?.latestTurn?.skillInvocation?.action?.id === "work-ticket"
      ? thread.latestTurn.skillInvocation.action
      : null;
  const linkedTicketInvocation =
    linkedTicketAction === null ? null : (thread?.latestTurn?.skillInvocation ?? null);
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
        threadId: invocation.threadId,
        skillRunId: invocation.skillRunId,
        action,
        ...(confirmed && mutation ? { actionId: mutation.actionId } : {}),
        confirmed,
      },
    });
  };
  const onCompleteHitl = (
    action: Extract<WayfinderMutationAction, { readonly kind: "complete-hitl-ticket" }>,
    resumeActionId?: string,
  ) => {
    if (!linkedTicketInvocation) return;
    void mutateWayfinder({
      environmentId: props.environmentId,
      input: {
        threadId: linkedTicketInvocation.threadId,
        skillRunId: linkedTicketInvocation.skillRunId,
        action,
        ...(resumeActionId ? { actionId: resumeActionId } : {}),
        confirmed: resumeActionId !== undefined,
      },
    });
  };
  const onResearch = (action: WayfinderResearchAction) => {
    if (!invocation) return;
    void controlWayfinderResearch({
      environmentId: props.environmentId,
      input: {
        threadId: invocation.threadId,
        skillRunId: invocation.skillRunId,
        action,
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
  const readiness =
    workstream?.readiness ??
    deriveWayfinderReadiness({
      map,
      synchronization,
      activeLinkedTicketNumbers: [],
    });
  const workflowMap = canonicalMap ?? map;
  const workflowReadiness =
    workstream?.readiness ??
    deriveWayfinderReadiness({
      map: workflowMap,
      synchronization,
      activeLinkedTicketNumbers: [],
    });
  const completion = buildMobileWayfinderCompletionPresentation(readiness);
  const mutationsEnabled = !working && connected && synchronization?.canMutate !== false;
  const workflowPresentation = buildMobileWorkflowPresentation({
    map: workflowMap,
    mutation,
    research: invocation?.wayfinderResearch ?? null,
    ticketThreads: workstream?.ticketThreads ?? [],
    synchronization,
    readiness: workflowReadiness,
    mutationsEnabled,
  });
  const toSpecSkill =
    serverConfig?.providers
      .find((provider) => provider.instanceId === thread?.modelSelection.instanceId)
      ?.skills.find((skill) => skill.name === "to-spec" && skill.enabled) ?? null;
  const startToSpec = async (acknowledgedIncomplete: boolean) => {
    if (
      !project ||
      !thread ||
      !invocation ||
      !toSpecSkill ||
      (workstream?.workflowAttachment != null &&
        workstream.workflowAttachment.workflowRun === undefined)
    ) {
      return;
    }
    const request = createWayfinderToSpecInvocationRequest({
      skill: toSpecSkill,
      sourceSkillRunId: invocation.skillRunId,
      sourceThreadId: invocation.threadId,
      destination: map.destination,
      canonicalReference: {
        number: map.canonicalReference.number,
        url: map.canonicalReference.url,
      },
      wayfinderSynchronizedAt: invocation.wayfinderSynchronizedAt ?? map.lastSynchronizedAt,
      acknowledgedIncomplete,
    });
    if (request === null) return;
    const metadata = makeTurnCommandMetadata();
    const result = await startTurn({
      environmentId: props.environmentId,
      input: buildProjectThreadStartTurnInput({
        projectId: project.id,
        projectCwd: project.workspaceRoot,
        threadId: metadata.threadId,
        commandId: metadata.commandId,
        messageId: metadata.messageId,
        createdAt: metadata.createdAt,
        text: request.arguments ?? "Create a specification from Wayfinder.",
        attachments: [],
        modelSelection: thread.modelSelection,
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        skillInvocationRequest: request,
        workspaceMode: "local",
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        startFromOrigin: false,
        worktreeBranchName: "unused-to-spec-handoff",
      }),
    });
    if (result._tag === "Failure") {
      Alert.alert("Could not start to-spec", "The generic Skill Run could not be created.");
      return;
    }
    props.onReturnToThread(ThreadId.make(metadata.threadId));
  };
  const requestToSpec = () => {
    requestMobileWayfinderToSpecStart({
      readiness,
      onStart: (acknowledgedIncomplete) => void startToSpec(acknowledgedIncomplete),
      requestIncompleteAcknowledgement: (warning, onAcknowledge) =>
        Alert.alert("Wayfinder is incomplete", warning, [
          { text: "Cancel", style: "cancel" },
          { text: "Start early", onPress: onAcknowledge },
        ]),
    });
  };

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

      <View className="gap-2 rounded-lg border border-border p-3">
        <Text className="text-sm font-semibold text-foreground">{completion.title}</Text>
        {completion.blockers.map((blocker) => (
          <Text key={blocker} className="text-xs leading-5 text-foreground-muted">
            • {blocker}
          </Text>
        ))}
        {toSpecSkill &&
        (workstream?.workflowAttachment == null ||
          workstream.workflowAttachment.workflowRun !== undefined) ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={completion.actionLabel}
            className="self-start rounded-lg border border-border px-3 py-2"
            onPress={requestToSpec}
          >
            <Text className="text-xs font-semibold text-foreground">{completion.actionLabel}</Text>
          </Pressable>
        ) : (
          <Text className="text-xs text-foreground-muted">
            Enable the to-spec skill for this provider to start the handoff.
          </Text>
        )}
      </View>

      <WorkflowPanel model={workflowPresentation} onOpenThread={props.onReturnToThread} />

      {linkedTicketAction === null ? (
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
      ) : null}

      {linkedTicketAction ? (
        <HitlResolutionCard
          map={map}
          ticketNumber={linkedTicketAction.ticketNumber}
          mutation={mutation}
          disabled={working || !connected || synchronization?.canMutate === false}
          onComplete={onCompleteHitl}
        />
      ) : null}

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
          research={invocation?.wayfinderResearch ?? null}
          ticketThreads={workstream?.ticketThreads ?? []}
          assignedTicketNumber={linkedTicketAction?.ticketNumber ?? null}
          disabled={working || !connected || synchronization?.canMutate === false}
          onMutate={onMutate}
          onResearch={onResearch}
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
