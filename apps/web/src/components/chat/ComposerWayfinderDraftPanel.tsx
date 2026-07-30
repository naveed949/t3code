import type { WayfinderDraft } from "@t3tools/contracts";
import { memo } from "react";

export const ComposerWayfinderDraftPanel = memo(function ComposerWayfinderDraftPanel(props: {
  readonly draft: WayfinderDraft;
}) {
  const pending = props.draft.proposedDecisions[0];
  return (
    <section
      aria-label="Unpublished Wayfinder draft"
      className="border-b border-amber-500/15 bg-amber-500/5 px-4 py-3 sm:px-5"
      data-wayfinder-draft="unpublished"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold tracking-widest text-amber-700 uppercase dark:text-amber-300">
            Unpublished Wayfinder draft
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Non-canonical · nothing has been written to GitHub
          </p>
        </div>
        <p className="text-xs tabular-nums text-muted-foreground">
          {props.draft.confirmedDecisions.length} confirmed
          {pending ? " · 1 proposed" : ""}
        </p>
      </div>
      {props.draft.destination ? (
        <p className="mt-2 text-sm text-foreground/90">{props.draft.destination}</p>
      ) : null}
      {pending ? (
        <div className="mt-2 rounded-lg border border-amber-500/15 bg-background/45 px-3 py-2">
          <p className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
            Agent proposal
          </p>
          <p className="mt-1 text-sm text-foreground/90">{pending.question.question}</p>
          {pending.recommendation ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Recommended: {pending.recommendation}
              {pending.reasoning ? ` — ${pending.reasoning}` : ""}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
});
