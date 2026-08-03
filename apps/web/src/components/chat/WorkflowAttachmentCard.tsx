import type { ThreadId, WorkflowAttachment, WorkflowAttachmentHint } from "@t3tools/contracts";
import { AlertTriangleIcon, CheckIcon, EyeIcon, Link2Icon, XIcon } from "lucide-react";
import { useState } from "react";

export function WorkflowAttachmentCard(props: {
  readonly originThreadId: ThreadId;
  readonly hint: WorkflowAttachmentHint | null;
  readonly attachment: WorkflowAttachment | null;
  readonly onDismiss: () => void;
  readonly onAttach: (workflowGoal: string) => void;
  readonly onOpenWorkstream?: () => void;
  readonly onViewArtifacts?: () => void;
  readonly onAcknowledgeArtifact?: (artifactId: string) => void;
  readonly onResolveStale?: () => void;
}) {
  const [workflowGoal, setWorkflowGoal] = useState("");
  const [originConfirmed, setOriginConfirmed] = useState(false);

  if (props.attachment !== null) {
    const graph = props.attachment.workflowGraph;
    const unreadArtifactCount = graph?.unreadArtifactCount ?? 0;
    const artifactToAcknowledge = graph?.artifacts
      .slice()
      .reverse()
      .find((artifact) => artifact.marker.state !== "acknowledged");
    const staleNode = graph?.nodes.find((node) => node.state === "stale") ?? null;

    return (
      <section
        aria-label="Attached Development Workflow"
        className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5 shadow-sm"
      >
        <div className="flex items-start gap-2">
          <Link2Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Development Workflow attached</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{props.attachment.workflowGoal}</p>
          </div>
          {props.onOpenWorkstream ? (
            <button
              type="button"
              className="rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
              onClick={props.onOpenWorkstream}
            >
              Open Workstream
            </button>
          ) : null}
        </div>
        {unreadArtifactCount > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-primary/20 bg-background/60 px-2.5 py-2 text-xs text-muted-foreground">
            <EyeIcon aria-hidden className="size-3.5 text-primary" />
            <span aria-live="polite">
              {unreadArtifactCount} new or changed upstream{" "}
              {unreadArtifactCount === 1 ? "artifact" : "artifacts"}.
            </span>
            {props.onViewArtifacts ? (
              <button
                type="button"
                className="ml-auto rounded-md px-2 py-1 font-medium text-primary hover:bg-primary/10"
                onClick={props.onViewArtifacts}
              >
                Mark viewed
              </button>
            ) : null}
          </div>
        ) : null}
        {artifactToAcknowledge && props.onAcknowledgeArtifact ? (
          <button
            type="button"
            className="mt-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
            onClick={() => props.onAcknowledgeArtifact?.(artifactToAcknowledge.id)}
          >
            <CheckIcon aria-hidden className="size-3.5" />
            Acknowledge latest update
          </button>
        ) : null}
        {staleNode ? (
          <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-950 dark:text-amber-100">
            <div className="flex items-start gap-1.5">
              <AlertTriangleIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <p>
                Upstream Wayfinder data changed. Downstream work is paused until this update is
                accepted.
              </p>
            </div>
            {props.onResolveStale ? (
              <button
                type="button"
                className="mt-2 rounded-md bg-amber-600 px-2 py-1 font-medium text-white hover:bg-amber-700"
                onClick={props.onResolveStale}
              >
                Accept upstream update
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  }

  if (props.hint?.status !== "available") return null;
  const trimmedGoal = workflowGoal.trim();

  return (
    <section
      aria-label="Attach Development Workflow"
      className="rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm"
    >
      <div className="flex items-start gap-2">
        <Link2Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">Attach this Wayfinder workstream?</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Keep this conversation as the Origin Thread and create a durable Development Workflow
            link from its structured Wayfinder data.
          </p>
        </div>
        <button
          type="button"
          aria-label="Dismiss workflow attachment hint"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={props.onDismiss}
        >
          <XIcon aria-hidden className="size-3.5" />
        </button>
      </div>
      <label className="mt-3 block text-xs font-medium text-foreground">
        Workflow Goal
        <input
          value={workflowGoal}
          onChange={(event) => setWorkflowGoal(event.currentTarget.value)}
          placeholder="What should this workflow accomplish?"
          className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
      <label className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={originConfirmed}
          onChange={(event) => setOriginConfirmed(event.currentTarget.checked)}
          className="mt-0.5"
        />
        <span>I confirm this conversation is the Origin Thread for the workflow.</span>
      </label>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={!originConfirmed || trimmedGoal.length === 0}
          className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => props.onAttach(trimmedGoal)}
        >
          Attach Workstream
        </button>
        <span className="text-[11px] text-muted-foreground">Origin: {props.originThreadId}</span>
      </div>
    </section>
  );
}
