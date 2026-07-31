import {
  applyOptimisticWayfinderMutation,
  createWayfinderHitlResolutionAction,
  createWayfinderGraduatedFogTicket,
  createWayfinderTicketAction,
  deriveWayfinderTicketClaimActions,
  deriveWayfinderResearchModel,
  deriveWayfinderWorkbenchModel,
  isWayfinderMutationInFlight,
  WAYFINDER_TICKET_CLASSIFICATIONS,
  type WayfinderTicketClassification,
} from "@t3tools/client-runtime/state/wayfinder-workbench";
import {
  advanceWayfinderReconciliationLifecycle,
  WAYFINDER_CONDITIONAL_REFRESH_INTERVAL_MS,
  type WayfinderReconciliationLifecycleEvent,
} from "@t3tools/client-runtime/state/wayfinder-reconciliation";
import type {
  ThreadId,
  WayfinderMapProjection,
  WayfinderMutation,
  WayfinderMutationAction,
  WayfinderReconcileReason,
  WayfinderResearchAction,
  WayfinderResearchState,
  WayfinderSynchronizationState,
} from "@t3tools/contracts";
import {
  deriveWayfinderReadiness,
  describeWayfinderReadinessBlocker,
  type WayfinderReadiness,
} from "@t3tools/shared/wayfinderReadiness";
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { memo, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";

export function requestWayfinderToSpecStart(input: {
  readonly readiness: WayfinderReadiness;
  readonly confirmIncomplete: (warning: string) => boolean;
  readonly onStart: (acknowledgedIncomplete: boolean) => void;
}) {
  if (input.readiness.ready) {
    input.onStart(false);
    return;
  }
  const blockers = input.readiness.blockers.map(describeWayfinderReadinessBlocker).join("\n");
  if (
    input.confirmIncomplete(
      `This Wayfinder map is incomplete:\n\n${blockers}\n\nStart to-spec early anyway?`,
    )
  ) {
    input.onStart(true);
  }
}

function ReferenceLink(props: { readonly href: string; readonly children: ReactNode }) {
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-medium text-foreground underline decoration-border underline-offset-2"
    >
      {props.children}
      <ExternalLinkIcon aria-hidden className="size-3" />
    </a>
  );
}

function TextList(props: { readonly items: ReadonlyArray<string>; readonly empty: string }) {
  return props.items.length === 0 ? (
    <p className="text-xs text-muted-foreground">{props.empty}</p>
  ) : (
    <ul className="space-y-1 text-xs text-foreground">
      {props.items.map((item) => (
        <li key={item} className="ml-4 list-disc">
          {item}
        </li>
      ))}
    </ul>
  );
}

function EditingControls(props: {
  readonly map: WayfinderMapProjection;
  readonly mutation: WayfinderMutation | null;
  readonly onMutate: (
    action: WayfinderMutationAction,
    options?: { readonly actionId?: string; readonly confirmed?: boolean },
  ) => void;
}) {
  const [field, setField] = useState<"destination" | "notes" | "fog-of-war" | "out-of-scope">(
    "destination",
  );
  const fieldValue =
    field === "destination"
      ? props.map.destination
      : field === "notes"
        ? props.map.notes
        : (field === "fog-of-war" ? props.map.fogOfWar : props.map.outOfScope).join("\n");
  const [value, setValue] = useState(fieldValue);
  useEffect(() => setValue(fieldValue), [fieldValue]);
  const [title, setTitle] = useState("");
  const [classification, setClassification] = useState<WayfinderTicketClassification>("grilling");
  const [ticketNumber, setTicketNumber] = useState(props.map.tickets[0]?.number ?? 0);
  const [ticketAction, setTicketAction] = useState<
    "rename" | "classify" | "resolve" | "close" | "reopen"
  >("rename");
  const [ticketValue, setTicketValue] = useState("");
  const [blockerNumber, setBlockerNumber] = useState(props.map.tickets[0]?.number ?? 0);
  const [blockedNumber, setBlockedNumber] = useState(props.map.tickets[1]?.number ?? 0);
  const working = isWayfinderMutationInFlight(props.mutation);
  const inputClass = "rounded-md border border-border bg-background px-2 py-1.5 text-xs";

  const submitTicketAction = () => {
    if (ticketAction === "rename" && ticketValue.trim()) {
      props.onMutate({ kind: "rename-ticket", ticketNumber, title: ticketValue.trim() });
    } else if (ticketAction === "classify") {
      props.onMutate({ kind: "classify-ticket", ticketNumber, classification });
    } else if (ticketAction === "resolve" && ticketValue.trim()) {
      props.onMutate({ kind: "resolve-ticket", ticketNumber, resolution: ticketValue.trim() });
    } else if (ticketAction === "close") {
      props.onMutate({ kind: "close-ticket", ticketNumber });
    } else if (ticketAction === "reopen") {
      props.onMutate({ kind: "reopen-ticket", ticketNumber });
    }
  };

  return (
    <section aria-labelledby="wayfinder-editing" className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id="wayfinder-editing" className="text-xs font-semibold">
          Structured actions
        </h3>
        {props.mutation ? (
          <span role="status" className="text-[11px] text-muted-foreground">
            {props.mutation.status === "failed"
              ? props.mutation.error
              : props.mutation.status.replace("-", " ")}
          </span>
        ) : null}
      </div>
      {props.mutation?.status === "awaiting-approval" ? (
        <button
          type="button"
          className="rounded-md border px-2 py-1 text-xs font-medium"
          onClick={() =>
            props.onMutate(props.mutation!.action, {
              actionId: props.mutation!.actionId,
              confirmed: true,
            })
          }
        >
          Confirm GitHub change
        </button>
      ) : null}
      <details>
        <summary className="cursor-pointer text-xs font-medium">Edit map fields</summary>
        <div className="mt-2 grid gap-2">
          <label className="text-xs">
            Field
            <select
              className={`${inputClass} ml-2`}
              value={field}
              onChange={(event) => {
                const next = event.target.value as typeof field;
                setField(next);
                setValue(
                  next === "destination"
                    ? props.map.destination
                    : next === "notes"
                      ? props.map.notes
                      : (next === "fog-of-war" ? props.map.fogOfWar : props.map.outOfScope).join(
                          "\n",
                        ),
                );
              }}
            >
              <option value="destination">Destination</option>
              <option value="notes">Notes</option>
              <option value="fog-of-war">Fog of war</option>
              <option value="out-of-scope">Out of scope</option>
            </select>
          </label>
          <textarea
            aria-label={`Wayfinder ${field}`}
            className={inputClass}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <button
            type="button"
            disabled={working}
            className="w-fit rounded-md border px-2 py-1 text-xs"
            onClick={() => props.onMutate({ kind: "update-map-field", field, value })}
          >
            Save field
          </button>
        </div>
      </details>
      <details>
        <summary className="cursor-pointer text-xs font-medium">Create decision ticket</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            aria-label="New ticket title"
            className={inputClass}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <select
            aria-label="New ticket classification"
            className={inputClass}
            value={classification}
            onChange={(event) => setClassification(event.target.value as typeof classification)}
          >
            {WAYFINDER_TICKET_CLASSIFICATIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={working || !title.trim()}
            className="rounded-md border px-2 py-1 text-xs"
            onClick={() => {
              const action = createWayfinderTicketAction(title, classification);
              if (action) props.onMutate(action);
            }}
          >
            Create ticket
          </button>
        </div>
      </details>
      {props.map.tickets.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-xs font-medium">Update decision ticket</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            <select
              aria-label="Decision ticket"
              className={inputClass}
              value={ticketNumber}
              onChange={(event) => setTicketNumber(Number(event.target.value))}
            >
              {props.map.tickets.map((ticket) => (
                <option key={ticket.number} value={ticket.number}>
                  #{ticket.number} {ticket.title}
                </option>
              ))}
            </select>
            <select
              aria-label="Ticket action"
              className={inputClass}
              value={ticketAction}
              onChange={(event) => setTicketAction(event.target.value as typeof ticketAction)}
            >
              <option value="rename">Rename</option>
              <option value="classify">Classify</option>
              <option value="resolve">Record resolution</option>
              <option value="close">Close</option>
              <option value="reopen">Reopen</option>
            </select>
            {ticketAction === "classify" ? (
              <select
                aria-label="Ticket classification"
                className={inputClass}
                value={classification}
                onChange={(event) => setClassification(event.target.value as typeof classification)}
              >
                {WAYFINDER_TICKET_CLASSIFICATIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            ) : ticketAction === "rename" || ticketAction === "resolve" ? (
              <input
                aria-label={ticketAction === "rename" ? "New ticket title" : "Ticket resolution"}
                className={inputClass}
                value={ticketValue}
                onChange={(event) => setTicketValue(event.target.value)}
              />
            ) : null}
            <button
              type="button"
              disabled={working}
              className="rounded-md border px-2 py-1 text-xs"
              onClick={submitTicketAction}
            >
              Apply
            </button>
          </div>
        </details>
      ) : null}
      {props.map.tickets.length > 1 ? (
        <details>
          <summary className="cursor-pointer text-xs font-medium">Edit dependencies</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            <select
              aria-label="Blocker ticket"
              className={inputClass}
              value={blockerNumber}
              onChange={(event) => setBlockerNumber(Number(event.target.value))}
            >
              {props.map.tickets.map((ticket) => (
                <option key={ticket.number} value={ticket.number}>
                  #{ticket.number} blocker
                </option>
              ))}
            </select>
            <select
              aria-label="Blocked ticket"
              className={inputClass}
              value={blockedNumber}
              onChange={(event) => setBlockedNumber(Number(event.target.value))}
            >
              {props.map.tickets.map((ticket) => (
                <option key={ticket.number} value={ticket.number}>
                  #{ticket.number} blocked
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={working || blockerNumber === blockedNumber}
              className="rounded-md border px-2 py-1 text-xs"
              onClick={() =>
                props.onMutate({ kind: "add-dependency", blockerNumber, blockedNumber })
              }
            >
              Add
            </button>
            <button
              type="button"
              disabled={working || blockerNumber === blockedNumber}
              className="rounded-md border px-2 py-1 text-xs"
              onClick={() =>
                props.onMutate({ kind: "remove-dependency", blockerNumber, blockedNumber })
              }
            >
              Remove
            </button>
          </div>
        </details>
      ) : null}
    </section>
  );
}

function HitlResolutionControls(props: {
  readonly map: WayfinderMapProjection;
  readonly ticketNumber: number;
  readonly mutation: WayfinderMutation | null;
  readonly disabled: boolean;
  readonly onComplete: (
    action: Extract<WayfinderMutationAction, { readonly kind: "complete-hitl-ticket" }>,
    options?: { readonly actionId?: string; readonly confirmed?: boolean },
  ) => void;
}) {
  type CompletionAction = Extract<
    WayfinderMutationAction,
    { readonly kind: "complete-hitl-ticket" }
  >;
  const ticket = props.map.tickets.find((candidate) => candidate.number === props.ticketNumber);
  const [outcome, setOutcome] = useState<CompletionAction["outcome"]>("resolved");
  const [resolution, setResolution] = useState("");
  const [contextPointer, setContextPointer] = useState(ticket?.url ?? "");
  const [fog, setFog] = useState(props.map.fogOfWar[0] ?? "");
  const [graduatedTitle, setGraduatedTitle] = useState("");
  const [graduatedClassification, setGraduatedClassification] =
    useState<WayfinderTicketClassification>("grilling");
  const [graduatedBlockers, setGraduatedBlockers] = useState("");
  const [graduatedFog, setGraduatedFog] = useState<CompletionAction["graduatedFog"]>([]);
  if (!ticket) return null;
  const activeResolution =
    props.mutation?.action.kind === "complete-hitl-ticket" &&
    props.mutation.action.ticketNumber === props.ticketNumber
      ? props.mutation
      : null;
  const addGraduatedFog = () => {
    const ticket = createWayfinderGraduatedFogTicket({
      fog,
      title: graduatedTitle,
      classification: graduatedClassification,
      blockers: graduatedBlockers,
    });
    if (!ticket) return;
    setGraduatedFog((current) => [...current, ticket]);
    setGraduatedTitle("");
    setGraduatedBlockers("");
  };
  const submit = () => {
    const action = createWayfinderHitlResolutionAction({
      ticketNumber: props.ticketNumber,
      outcome,
      resolution,
      contextPointer,
      graduatedFog,
    });
    if (action) props.onComplete(action);
  };

  return (
    <section
      aria-labelledby="wayfinder-hitl-resolution"
      className="space-y-3 rounded-lg border p-3"
    >
      <div>
        <h3 id="wayfinder-hitl-resolution" className="text-xs font-semibold">
          Resolve assigned decision
        </h3>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Complete only #{props.ticketNumber} {ticket.title}. The canonical receipt lands before the
          shared map advances.
        </p>
      </div>
      {activeResolution ? (
        <p role={activeResolution.status === "failed" ? "alert" : "status"} className="text-xs">
          {activeResolution.status === "failed"
            ? `${activeResolution.error} Next: ${activeResolution.nextStep ?? "resume resolution"}.`
            : activeResolution.status === "synchronized"
              ? "Canonical resolution synchronized."
              : `Resolution ${activeResolution.status.replace("-", " ")}.`}
        </p>
      ) : null}
      {activeResolution?.status === "failed" ? (
        <button
          type="button"
          disabled={props.disabled}
          className="rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50"
          onClick={() => {
            const resolutionAction = activeResolution.action;
            if (resolutionAction.kind !== "complete-hitl-ticket") return;
            props.onComplete(resolutionAction, {
              actionId: activeResolution.actionId,
              confirmed: true,
            });
          }}
        >
          Resume resolution
        </button>
      ) : null}
      <label className="block text-xs">
        Outcome
        <select
          aria-label="Assigned ticket outcome"
          className="ml-2 rounded-md border border-border bg-background px-2 py-1.5"
          value={outcome}
          onChange={(event) => setOutcome(event.target.value as CompletionAction["outcome"])}
        >
          <option value="resolved">Resolved decision</option>
          <option value="out-of-scope">Beyond destination</option>
        </select>
      </label>
      <textarea
        aria-label="Verified resolution"
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
        value={resolution}
        onChange={(event) => setResolution(event.target.value)}
      />
      <input
        aria-label="Resolution context pointer"
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
        value={contextPointer}
        onChange={(event) => setContextPointer(event.target.value)}
      />
      {outcome === "resolved" && props.map.fogOfWar.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-xs font-medium">
            Graduate fog into a ticket
          </summary>
          <div className="mt-2 grid gap-2">
            <select
              aria-label="Fog to graduate"
              value={fog}
              onChange={(event) => setFog(event.target.value)}
            >
              {props.map.fogOfWar.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
            <input
              aria-label="Graduated ticket title"
              value={graduatedTitle}
              onChange={(event) => setGraduatedTitle(event.target.value)}
            />
            <select
              aria-label="Graduated ticket classification"
              value={graduatedClassification}
              onChange={(event) =>
                setGraduatedClassification(event.target.value as WayfinderTicketClassification)
              }
            >
              {WAYFINDER_TICKET_CLASSIFICATIONS.map((classification) => (
                <option key={classification} value={classification}>
                  {classification}
                </option>
              ))}
            </select>
            <input
              aria-label="Graduated ticket blockers"
              placeholder="#42, key:other-ticket"
              value={graduatedBlockers}
              onChange={(event) => setGraduatedBlockers(event.target.value)}
            />
            <button type="button" onClick={addGraduatedFog}>
              Add graduated ticket
            </button>
            {graduatedFog.map((entry) => (
              <p key={entry.key} className="text-[11px] text-muted-foreground">
                {entry.title}
              </p>
            ))}
          </div>
        </details>
      ) : null}
      <button
        type="button"
        disabled={props.disabled || !resolution.trim() || !contextPointer.trim()}
        className="rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50"
        onClick={submit}
      >
        Record canonical resolution
      </button>
    </section>
  );
}

export const WayfinderWorkbench = memo(function WayfinderWorkbench(props: {
  readonly map: WayfinderMapProjection;
  readonly mutation?: WayfinderMutation | null;
  readonly onMutate?: (
    action: WayfinderMutationAction,
    options?: { readonly actionId?: string; readonly confirmed?: boolean },
  ) => void;
  readonly ticketThreads?: ReadonlyArray<{
    readonly ticketNumber: number;
    readonly threadId: ThreadId;
  }>;
  readonly onReturnToThread?: (threadId: ThreadId) => void;
  readonly research?: WayfinderResearchState | null;
  readonly onResearch?: (action: WayfinderResearchAction) => void;
  readonly assignedTicketNumber?: number | null;
  readonly onCompleteHitl?: (
    action: Extract<WayfinderMutationAction, { readonly kind: "complete-hitl-ticket" }>,
    options?: { readonly actionId?: string; readonly confirmed?: boolean },
  ) => void;
  readonly synchronization: WayfinderSynchronizationState | null;
  readonly connected: boolean;
  readonly onReconcile: (reason: WayfinderReconcileReason) => void;
  readonly readiness?: WayfinderReadiness;
  readonly toSpecAvailable?: boolean;
  readonly onStartToSpec?: (acknowledgedIncomplete: boolean) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const reconcileRef = useRef(props.onReconcile);
  reconcileRef.current = props.onReconcile;
  const lifecycleRef = useRef({
    connected: props.connected,
    visible: false,
    hasOpened: false,
  });
  const advanceLifecycle = useCallback((event: WayfinderReconciliationLifecycleEvent) => {
    const transition = advanceWayfinderReconciliationLifecycle(lifecycleRef.current, event);
    lifecycleRef.current = transition.lifecycle;
    if (transition.reason) reconcileRef.current(transition.reason);
  }, []);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    advanceLifecycle({
      type: "visibility",
      visible: document.visibilityState === "visible",
    });
    const onVisibilityChange = () => {
      advanceLifecycle({
        type: "visibility",
        visible: document.visibilityState === "visible",
      });
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      advanceLifecycle({ type: "visibility", visible: false });
    };
  }, [advanceLifecycle]);
  useEffect(() => {
    advanceLifecycle({ type: "connection", connected: props.connected });
  }, [advanceLifecycle, props.connected]);
  useEffect(() => {
    if (!props.connected) return;
    const interval = window.setInterval(
      () => advanceLifecycle({ type: "poll" }),
      WAYFINDER_CONDITIONAL_REFRESH_INTERVAL_MS,
    );
    return () => window.clearInterval(interval);
  }, [advanceLifecycle, props.connected]);

  const map = applyOptimisticWayfinderMutation(props.map, props.mutation ?? null);
  const model = deriveWayfinderWorkbenchModel(map);
  const ticketsByNumber = new Map(map.tickets.map((ticket) => [ticket.number, ticket] as const));
  const ticketThreadIdsByNumber = new Map(
    props.ticketThreads?.map((link) => [link.ticketNumber, link.threadId] as const),
  );
  const researchModel = deriveWayfinderResearchModel({
    map,
    research: props.research ?? null,
    ticketThreads: props.ticketThreads ?? [],
  });
  const researchByTicket = new Map(
    researchModel.tickets.map((ticket) => [ticket.ticketNumber, ticket] as const),
  );
  const incomingEdgesByNumber = new Map<number, typeof model.edges>();
  for (const edge of model.edges) {
    incomingEdgesByNumber.set(edge.to, [...(incomingEdgesByNumber.get(edge.to) ?? []), edge]);
  }
  const columnCount = Math.max(1, ...model.nodes.map((node) => node.column + 1));
  const synchronizationStatus = props.synchronization?.status ?? "healthy";
  const lastSuccessfulAt = props.synchronization?.lastSuccessfulAt ?? props.map.lastSynchronizedAt;
  const synchronizationMessage =
    props.synchronization?.message ??
    (synchronizationStatus === "synchronizing" ? "Refreshing canonical GitHub state…" : null);
  const mutationsEnabled =
    props.connected &&
    props.synchronization?.canMutate !== false &&
    !isWayfinderMutationInFlight(props.mutation ?? null);
  const readiness =
    props.readiness ??
    deriveWayfinderReadiness({
      map,
      synchronization: props.synchronization,
      activeLinkedTicketNumbers: [],
    });
  const startToSpec = () => {
    if (!props.onStartToSpec) return;
    requestWayfinderToSpecStart({
      readiness,
      confirmIncomplete: (warning) => window.confirm(warning),
      onStart: props.onStartToSpec,
    });
  };

  return (
    <section
      aria-label={model.accessibilitySummary}
      className="min-h-0 flex-1 overflow-y-auto bg-background"
    >
      <div className="space-y-6 p-4">
        <header className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Wayfinder Workbench
              </p>
              <h2
                ref={headingRef}
                tabIndex={-1}
                data-wayfinder-initial-focus="true"
                className="mt-1 text-base font-semibold text-foreground"
              >
                {map.canonicalReference.title}
              </h2>
            </div>
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] capitalize text-muted-foreground">
              {map.canonicalReference.state}
            </span>
          </div>
          <div
            aria-live="polite"
            data-wayfinder-mutations-enabled={
              props.connected && props.synchronization?.canMutate !== false ? "true" : "false"
            }
            className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
          >
            <p>
              {synchronizationStatus === "unavailable" || synchronizationStatus === "conflict"
                ? "Cached read-only map"
                : "Canonical GitHub map"}
              {` · Last synchronized ${lastSuccessfulAt}`}
            </p>
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!props.connected || synchronizationStatus === "synchronizing"}
              onClick={() => advanceLifecycle({ type: "manual" })}
            >
              <RefreshCwIcon aria-hidden className="size-3" />
              Refresh
            </button>
          </div>
          {synchronizationMessage ? (
            <p
              role={synchronizationStatus === "conflict" ? "alert" : "status"}
              className={cn(
                "rounded-md border px-3 py-2 text-xs",
                synchronizationStatus === "conflict"
                  ? "border-destructive/40 text-destructive"
                  : "border-border text-muted-foreground",
              )}
            >
              {synchronizationMessage}
            </p>
          ) : null}
          <ReferenceLink href={props.map.canonicalReference.url}>
            GitHub #{String(props.map.canonicalReference.number)}
          </ReferenceLink>
        </header>

        <section
          aria-labelledby="wayfinder-completion"
          className="space-y-3 rounded-lg border border-border/70 p-3"
        >
          <div>
            <h3 id="wayfinder-completion" className="text-xs font-semibold text-foreground">
              {readiness.ready ? "Ready for specification" : "Wayfinder is not complete"}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {readiness.ready
                ? "Every observable completion invariant holds. The next skill starts only when you choose it."
                : "Resolve these invariants before the normal handoff, or explicitly acknowledge an early handoff."}
            </p>
          </div>
          {readiness.blockers.length > 0 ? (
            <ul className="space-y-1 text-xs text-foreground">
              {readiness.blockers.map((blocker) => (
                <li key={blocker.kind} className="ml-4 list-disc">
                  {describeWayfinderReadinessBlocker(blocker)}
                </li>
              ))}
            </ul>
          ) : null}
          {props.toSpecAvailable && props.onStartToSpec ? (
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground"
              onClick={startToSpec}
            >
              {readiness.ready ? "Start to-spec" : "Start to-spec early"}
            </button>
          ) : (
            <p className="text-xs text-muted-foreground">
              Enable the to-spec skill for this provider to start the handoff.
            </p>
          )}
        </section>

        {props.onMutate && props.assignedTicketNumber == null ? (
          <EditingControls map={map} mutation={props.mutation ?? null} onMutate={props.onMutate} />
        ) : null}

        {props.assignedTicketNumber && props.onCompleteHitl ? (
          <HitlResolutionControls
            map={map}
            ticketNumber={props.assignedTicketNumber}
            mutation={props.mutation ?? null}
            disabled={!mutationsEnabled}
            onComplete={props.onCompleteHitl}
          />
        ) : null}

        <section aria-labelledby="wayfinder-destination">
          <h3 id="wayfinder-destination" className="mb-1 text-xs font-semibold text-foreground">
            Destination
          </h3>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {map.destination || "No destination recorded."}
          </p>
        </section>

        {map.notes ? (
          <section aria-labelledby="wayfinder-notes">
            <h3 id="wayfinder-notes" className="mb-1 text-xs font-semibold text-foreground">
              Notes
            </h3>
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
              {map.notes}
            </p>
          </section>
        ) : null}

        <section aria-labelledby="wayfinder-graph">
          <h3 id="wayfinder-graph" className="mb-2 text-xs font-semibold text-foreground">
            Dependency graph
          </h3>
          <div
            role="img"
            aria-label={model.accessibilitySummary}
            aria-describedby="wayfinder-graph-alternative"
            data-wayfinder-dependency-graph="stable"
            className="grid gap-2 overflow-x-auto rounded-lg border border-border/70 bg-muted/20 p-3"
            style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(9rem, 1fr))` }}
          >
            {model.nodes.map((node) => {
              const ticket = ticketsByNumber.get(node.ticketNumber);
              if (!ticket) return null;
              return (
                <div
                  key={ticket.number}
                  className={cn(
                    "min-w-36 rounded-md border bg-card p-2",
                    node.isFrontier ? "border-foreground/40" : "border-border",
                    ticket.state === "closed" && "opacity-60",
                  )}
                  style={{ gridColumn: node.column + 1, gridRow: node.row + 1 }}
                >
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {node.isFrontier ? "Frontier" : ticket.classification}
                  </p>
                  <p className="mt-1 text-xs font-medium text-foreground">{ticket.title}</p>
                  {ticket.blockedBy.length > 0 ? (
                    <div
                      aria-label={`Dependencies for ${ticket.title}`}
                      className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground"
                    >
                      {(incomingEdgesByNumber.get(ticket.number) ?? []).map((edge) => (
                        <span
                          key={`${edge.from}:${edge.to}`}
                          data-wayfinder-edge={`${edge.from}:${edge.to}`}
                          className="rounded border border-border px-1"
                        >
                          #{edge.from} → #{edge.to}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p id="wayfinder-graph-alternative" className="sr-only">
            The frontier-first ticket list after this graph is the complete dependency alternative.
          </p>
        </section>

        <section aria-labelledby="wayfinder-frontier">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <h3 id="wayfinder-frontier" className="text-xs font-semibold text-foreground">
                Frontier
              </h3>
              {props.assignedTicketNumber == null ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Background research · Limit {researchModel.concurrencyLimit}
                </p>
              ) : null}
            </div>
            {props.onResearch && props.assignedTicketNumber == null ? (
              <button
                type="button"
                disabled={!mutationsEnabled}
                className="rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50"
                onClick={() =>
                  props.onResearch?.({
                    kind: researchModel.automaticLaunchesPaused
                      ? "resume-automatic-launches"
                      : "pause-automatic-launches",
                  })
                }
              >
                {researchModel.automaticLaunchesPaused
                  ? "Resume automatic launches"
                  : "Pause automatic launches"}
              </button>
            ) : null}
          </div>
          {model.tickets.length === 0 ? (
            <p className="text-xs text-muted-foreground">No decision tickets.</p>
          ) : (
            <ol className="space-y-2">
              {model.tickets.map((ticket) => {
                const ticketIsAssigned =
                  props.assignedTicketNumber == null ||
                  ticket.number === props.assignedTicketNumber;
                const linkedThreadId = ticketThreadIdsByNumber.get(ticket.number) ?? null;
                const claimActions = deriveWayfinderTicketClaimActions({
                  ticket,
                  frontier: map.frontier,
                  linkedThreadId,
                  mutation: props.mutation ?? null,
                });
                const research = researchByTicket.get(ticket.number);
                return (
                  <li key={ticket.number} className="rounded-md border border-border/70 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <ReferenceLink href={ticket.url}>{ticket.title}</ReferenceLink>
                      <span className="text-[10px] capitalize text-muted-foreground">
                        {ticket.state}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {ticket.classification}
                      {ticket.claimedBy ? ` · Claimed by ${ticket.claimedBy}` : " · Unclaimed"}
                      {ticket.commentCount ? ` · ${ticket.commentCount} comments` : ""}
                      {ticket.blockedBy.length > 0
                        ? ` · Blocked by ${ticket.blockedBy.map((number) => `#${number}`).join(", ")}`
                        : ""}
                    </p>
                    {ticket.classification === "research" && research ? (
                      <div className="mt-2 space-y-1 text-[11px]">
                        <p role="status" className="capitalize text-muted-foreground">
                          Research: {research.status.replace("-", " ")}
                          {research.launchMode ? ` · ${research.launchMode}` : ""}
                        </p>
                        {research.output ? (
                          <p className="rounded-md border border-border/70 p-2 text-foreground">
                            {research.output}
                          </p>
                        ) : null}
                        {research.error ? (
                          <p role="alert" className="text-destructive">
                            {research.error}
                          </p>
                        ) : null}
                        {ticketIsAssigned && props.onResearch ? (
                          <div className="flex flex-wrap gap-2">
                            {research.canStart ? (
                              <button
                                type="button"
                                disabled={!mutationsEnabled}
                                className="rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50"
                                onClick={() =>
                                  props.onResearch?.({
                                    kind: "start-ticket",
                                    ticketNumber: ticket.number,
                                  })
                                }
                              >
                                Start research
                              </button>
                            ) : null}
                            {research.canCancel ? (
                              <button
                                type="button"
                                disabled={!mutationsEnabled}
                                className="rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50"
                                onClick={() =>
                                  props.onResearch?.({
                                    kind: "cancel-ticket",
                                    ticketNumber: ticket.number,
                                  })
                                }
                              >
                                Cancel research
                              </button>
                            ) : null}
                            {research.canRetry ? (
                              <button
                                type="button"
                                disabled={!mutationsEnabled}
                                className="rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50"
                                onClick={() =>
                                  props.onResearch?.({
                                    kind: "retry-ticket",
                                    ticketNumber: ticket.number,
                                  })
                                }
                              >
                                Retry research
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {(ticketIsAssigned && props.onMutate) ||
                    (ticketIsAssigned && linkedThreadId && props.onReturnToThread) ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {ticketIsAssigned &&
                        ticket.classification !== "research" &&
                        claimActions.canClaim &&
                        props.onMutate ? (
                          <button
                            type="button"
                            disabled={!mutationsEnabled}
                            className="rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50"
                            onClick={() =>
                              props.onMutate?.({
                                kind: "claim-ticket",
                                ticketNumber: ticket.number,
                              })
                            }
                          >
                            {claimActions.claimLabel}
                          </button>
                        ) : null}
                        {ticketIsAssigned && claimActions.canRetry && props.onMutate ? (
                          <button
                            type="button"
                            disabled={!mutationsEnabled}
                            className="rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50"
                            onClick={() =>
                              props.onMutate?.({
                                kind: "claim-ticket",
                                ticketNumber: ticket.number,
                              })
                            }
                          >
                            Retry thread linkage
                          </button>
                        ) : null}
                        {ticketIsAssigned && linkedThreadId && props.onReturnToThread ? (
                          <button
                            type="button"
                            className="rounded-md border px-2 py-1 text-xs font-medium"
                            onClick={() => props.onReturnToThread?.(linkedThreadId)}
                          >
                            Return to thread
                          </button>
                        ) : null}
                        {ticketIsAssigned && claimActions.canRelease && props.onMutate ? (
                          <button
                            type="button"
                            disabled={!mutationsEnabled}
                            className="rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50"
                            onClick={() =>
                              props.onMutate?.({
                                kind: "release-ticket",
                                ticketNumber: ticket.number,
                              })
                            }
                          >
                            Release
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section aria-labelledby="wayfinder-decisions">
          <h3 id="wayfinder-decisions" className="mb-2 text-xs font-semibold text-foreground">
            Decisions so far
          </h3>
          {map.decisionsSoFar.length === 0 ? (
            <p className="text-xs text-muted-foreground">No resolved decisions yet.</p>
          ) : (
            <ul className="space-y-2">
              {map.decisionsSoFar.map((decision) => (
                <li key={`${decision.url ?? "plain"}:${decision.title}`} className="text-xs">
                  {decision.url ? (
                    <ReferenceLink href={decision.url}>{decision.title}</ReferenceLink>
                  ) : (
                    <span className="font-medium text-foreground">{decision.title}</span>
                  )}
                  {decision.summary ? (
                    <span className="text-muted-foreground"> — {decision.summary}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
          <section aria-labelledby="wayfinder-fog">
            <h3 id="wayfinder-fog" className="mb-2 text-xs font-semibold text-foreground">
              Fog of war
            </h3>
            <TextList items={map.fogOfWar} empty="No unresolved fog." />
          </section>
          <section aria-labelledby="wayfinder-out-of-scope">
            <h3 id="wayfinder-out-of-scope" className="mb-2 text-xs font-semibold text-foreground">
              Out of scope
            </h3>
            <TextList items={map.outOfScope} empty="Nothing recorded." />
          </section>
        </div>
      </div>
    </section>
  );
});
