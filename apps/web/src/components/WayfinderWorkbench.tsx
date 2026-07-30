import { deriveWayfinderWorkbenchModel } from "@t3tools/client-runtime/state/wayfinder-workbench";
import type { WayfinderMapProjection } from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { memo, type ReactNode } from "react";

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

export const WayfinderWorkbench = memo(function WayfinderWorkbench(props: {
  readonly map: WayfinderMapProjection;
}) {
  const model = deriveWayfinderWorkbenchModel(props.map);
  const ticketsByNumber = new Map(
    props.map.tickets.map((ticket) => [ticket.number, ticket] as const),
  );
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
                {props.map.canonicalReference.title}
              </h2>
            </div>
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] capitalize text-muted-foreground">
              {props.map.canonicalReference.state}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Read-only · Synchronized {props.map.lastSynchronizedAt}
          </p>
          <ReferenceLink href={props.map.canonicalReference.url}>
            GitHub #{String(props.map.canonicalReference.number)}
          </ReferenceLink>
        </header>

        <section aria-labelledby="wayfinder-destination">
          <h3 id="wayfinder-destination" className="mb-1 text-xs font-semibold text-foreground">
            Destination
          </h3>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {props.map.destination || "No destination recorded."}
          </p>
        </section>

        {props.map.notes ? (
          <section aria-labelledby="wayfinder-notes">
            <h3 id="wayfinder-notes" className="mb-1 text-xs font-semibold text-foreground">
              Notes
            </h3>
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
              {props.map.notes}
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
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Blocked by {ticket.blockedBy.map((number) => `#${number}`).join(", ")}
                    </p>
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
          {props.map.decisionsSoFar.length === 0 ? (
            <p className="text-xs text-muted-foreground">No resolved decisions yet.</p>
          ) : (
            <ul className="space-y-2">
              {props.map.decisionsSoFar.map((decision) => (
                <li key={decision.url} className="text-xs">
                  <ReferenceLink href={decision.url}>{decision.title}</ReferenceLink>
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
            <TextList items={props.map.fogOfWar} empty="No unresolved fog." />
          </section>
          <section aria-labelledby="wayfinder-out-of-scope">
            <h3 id="wayfinder-out-of-scope" className="mb-2 text-xs font-semibold text-foreground">
              Out of scope
            </h3>
            <TextList items={props.map.outOfScope} empty="Nothing recorded." />
          </section>
        </div>
      </div>
    </section>
  );
});
