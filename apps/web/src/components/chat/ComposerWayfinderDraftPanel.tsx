import type { WayfinderDraft, WayfinderPublication } from "@t3tools/contracts";
import { memo } from "react";

export const ComposerWayfinderDraftPanel = memo(function ComposerWayfinderDraftPanel(props: {
  readonly draft: WayfinderDraft;
  readonly publication: WayfinderPublication | null;
  readonly onPublish: () => void;
}) {
  const pending = props.draft.proposedDecisions[0];
  const canPublish =
    !pending && props.draft.destination !== null && props.draft.candidateTickets.length > 0;
  const isWorking = props.publication?.status === "publishing";
  const needsApproval = props.publication?.status === "awaiting-approval";
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
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {props.publication?.status === "failed"
            ? `Publication paused · ${props.publication.nextStep}`
            : props.publication?.status === "publishing"
              ? `Publishing · ${props.publication.nextStep}`
              : needsApproval
                ? "GitHub publication needs confirmation"
                : "Ready to publish as canonical GitHub issues"}
        </p>
        <button
          type="button"
          disabled={!canPublish || isWorking}
          onClick={props.onPublish}
          className="rounded-md border border-amber-600/30 bg-background px-3 py-1.5 text-xs font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {needsApproval
            ? "Confirm publication"
            : props.publication?.status === "failed"
              ? "Resume publication"
              : isWorking
                ? "Publishing…"
                : "Publish to GitHub"}
        </button>
      </div>
    </section>
  );
});
