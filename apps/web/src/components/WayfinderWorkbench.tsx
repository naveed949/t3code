import {
  applyOptimisticWayfinderMutation,
  deriveWayfinderWorkbenchModel,
} from "@t3tools/client-runtime/state/wayfinder-workbench";
import type {
  WayfinderMapProjection,
  WayfinderMutation,
  WayfinderMutationAction,
} from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { memo, type ReactNode, useEffect, useState } from "react";

import { cn } from "~/lib/utils";

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

const classifications = ["research", "prototype", "grilling", "task"] as const;

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
  const [classification, setClassification] =
    useState<(typeof classifications)[number]>("grilling");
  const [ticketNumber, setTicketNumber] = useState(props.map.tickets[0]?.number ?? 0);
  const [ticketAction, setTicketAction] = useState<
    "rename" | "classify" | "resolve" | "close" | "reopen"
  >("rename");
  const [ticketValue, setTicketValue] = useState("");
  const [blockerNumber, setBlockerNumber] = useState(props.map.tickets[0]?.number ?? 0);
  const [blockedNumber, setBlockedNumber] = useState(props.map.tickets[1]?.number ?? 0);
  const working =
    props.mutation?.status === "mutating" || props.mutation?.status === "awaiting-approval";
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
            {classifications.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={working || !title.trim()}
            className="rounded-md border px-2 py-1 text-xs"
            onClick={() =>
              props.onMutate({ kind: "create-ticket", title: title.trim(), classification })
            }
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
                {classifications.map((item) => (
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

export const WayfinderWorkbench = memo(function WayfinderWorkbench(props: {
  readonly map: WayfinderMapProjection;
  readonly mutation?: WayfinderMutation | null;
  readonly onMutate?: (
    action: WayfinderMutationAction,
    options?: { readonly actionId?: string; readonly confirmed?: boolean },
  ) => void;
}) {
  const map = applyOptimisticWayfinderMutation(props.map, props.mutation ?? null);
  const model = deriveWayfinderWorkbenchModel(map);
  const ticketsByNumber = new Map(map.tickets.map((ticket) => [ticket.number, ticket] as const));
  const incomingEdgesByNumber = new Map<number, typeof model.edges>();
  for (const edge of model.edges) {
    incomingEdgesByNumber.set(edge.to, [...(incomingEdgesByNumber.get(edge.to) ?? []), edge]);
  }
  const columnCount = Math.max(1, ...model.nodes.map((node) => node.column + 1));

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
              <h2 className="mt-1 text-base font-semibold text-foreground">
                {map.canonicalReference.title}
              </h2>
            </div>
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] capitalize text-muted-foreground">
              {map.canonicalReference.state}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            GitHub canonical · Synchronized {map.lastSynchronizedAt}
          </p>
          <ReferenceLink href={map.canonicalReference.url}>
            GitHub #{String(map.canonicalReference.number)}
          </ReferenceLink>
        </header>

        {props.onMutate ? (
          <EditingControls map={map} mutation={props.mutation ?? null} onMutate={props.onMutate} />
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
        </section>

        <section aria-labelledby="wayfinder-frontier">
          <h3 id="wayfinder-frontier" className="mb-2 text-xs font-semibold text-foreground">
            Frontier
          </h3>
          {model.tickets.length === 0 ? (
            <p className="text-xs text-muted-foreground">No decision tickets.</p>
          ) : (
            <ol className="space-y-2">
              {model.tickets.map((ticket) => (
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
                    {ticket.blockedBy.length > 0
                      ? ` · Blocked by ${ticket.blockedBy.map((number) => `#${number}`).join(", ")}`
                      : ""}
                  </p>
                </li>
              ))}
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
