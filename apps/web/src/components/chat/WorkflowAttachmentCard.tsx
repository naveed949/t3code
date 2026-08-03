import type { ThreadId, WorkflowAttachment, WorkflowAttachmentHint } from "@t3tools/contracts";
import { Link2Icon, XIcon } from "lucide-react";
import { useState } from "react";

export function WorkflowAttachmentCard(props: {
  readonly originThreadId: ThreadId;
  readonly hint: WorkflowAttachmentHint | null;
  readonly attachment: WorkflowAttachment | null;
  readonly onDismiss: () => void;
  readonly onAttach: (workflowGoal: string) => void;
  readonly onOpenWorkstream?: () => void;
}) {
  const [workflowGoal, setWorkflowGoal] = useState("");
  const [originConfirmed, setOriginConfirmed] = useState(false);

  if (props.attachment !== null) {
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
