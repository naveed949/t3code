import type {
  ProviderInstanceId,
  ThreadId,
  WorkflowAttachment,
  WorkflowAttachmentHint,
  WorkflowRunConfiguration,
  WorkflowRunRequiredSkill,
} from "@t3tools/contracts";
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
  readonly defaultProviderInstanceId?: ProviderInstanceId;
  readonly providerOptions?: ReadonlyArray<ProviderInstanceId>;
  readonly requiredSkills?: ReadonlyArray<WorkflowRunRequiredSkill>;
  readonly onPreflightRun?: (configuration: WorkflowRunConfiguration) => void;
  readonly onConfirmRun?: (configuration: WorkflowRunConfiguration) => void;
}) {
  const [workflowGoal, setWorkflowGoal] = useState("");
  const [originConfirmed, setOriginConfirmed] = useState(false);
  const [fixedPoint, setFixedPoint] = useState("");
  const [baseline, setBaseline] = useState("");
  const [remoteTarget, setRemoteTarget] = useState("");
  const [executionLimit, setExecutionLimit] = useState<1 | 2>(1);
  const [selectedProvider, setSelectedProvider] = useState<ProviderInstanceId | null>(null);
  const [overrideProvider, setOverrideProvider] = useState<ProviderInstanceId | null>(null);

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
        {props.onPreflightRun && props.defaultProviderInstanceId ? (
          <WorkflowRunControls
            attachment={props.attachment}
            defaultProviderInstanceId={props.defaultProviderInstanceId}
            providerOptions={props.providerOptions ?? [props.defaultProviderInstanceId]}
            selectedProvider={selectedProvider ?? props.defaultProviderInstanceId}
            overrideProvider={overrideProvider}
            onSelectedProviderChange={setSelectedProvider}
            onOverrideProviderChange={setOverrideProvider}
            requiredSkills={props.requiredSkills ?? []}
            fixedPoint={fixedPoint}
            baseline={baseline}
            remoteTarget={remoteTarget}
            executionLimit={executionLimit}
            onFixedPointChange={setFixedPoint}
            onBaselineChange={setBaseline}
            onRemoteTargetChange={setRemoteTarget}
            onExecutionLimitChange={setExecutionLimit}
            onPreflightRun={props.onPreflightRun}
            {...(props.onConfirmRun ? { onConfirmRun: props.onConfirmRun } : {})}
          />
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

function WorkflowRunControls(props: {
  readonly attachment: WorkflowAttachment;
  readonly defaultProviderInstanceId: ProviderInstanceId;
  readonly providerOptions: ReadonlyArray<ProviderInstanceId>;
  readonly selectedProvider: ProviderInstanceId;
  readonly overrideProvider: ProviderInstanceId | null;
  readonly requiredSkills: ReadonlyArray<WorkflowRunRequiredSkill>;
  readonly fixedPoint: string;
  readonly baseline: string;
  readonly remoteTarget: string;
  readonly executionLimit: 1 | 2;
  readonly onFixedPointChange: (value: string) => void;
  readonly onBaselineChange: (value: string) => void;
  readonly onRemoteTargetChange: (value: string) => void;
  readonly onExecutionLimitChange: (value: 1 | 2) => void;
  readonly onSelectedProviderChange: (value: ProviderInstanceId) => void;
  readonly onOverrideProviderChange: (value: ProviderInstanceId | null) => void;
  readonly onPreflightRun: (configuration: WorkflowRunConfiguration) => void;
  readonly onConfirmRun?: (configuration: WorkflowRunConfiguration) => void;
}) {
  const configuration = (): WorkflowRunConfiguration => ({
    workflowGoal: props.attachment.workflowGoal,
    runScope: [{ nodeId: `workstream:${props.attachment.workstreamId}`, label: "Workstream" }],
    defaultProviderInstanceId: props.selectedProvider,
    providerOverrides:
      props.overrideProvider === null
        ? []
        : [
            {
              nodeId: `workstream:${props.attachment.workstreamId}`,
              providerInstanceId: props.overrideProvider,
            },
          ],
    requiredSkills: props.requiredSkills,
    fixedPoint: props.fixedPoint.trim(),
    workstreamBaseline: props.baseline.trim(),
    remoteTarget: props.remoteTarget.trim(),
    environmentAutomationCapacity: 2,
    executionLimit: props.executionLimit,
    authority: {
      createWorktree: true,
      runProvider: true,
      mutateTracker: false,
      pushBaseline: false,
      createDraftPullRequest: false,
    },
  });
  const ready =
    props.fixedPoint.trim().length > 0 &&
    props.baseline.trim().length > 0 &&
    props.remoteTarget.trim().length > 0;
  const preview = props.attachment.workflowRunPreview;
  if (props.attachment.workflowRun) {
    return (
      <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs">
        Workflow Run confirmed. Authority is recorded for the exact scope and configuration.
      </div>
    );
  }
  return (
    <div
      className="mt-3 space-y-2 rounded-md border border-border/70 bg-background/60 p-2.5"
      aria-label="Workflow Run confirmation"
    >
      <p className="text-xs font-semibold text-foreground">Prepare Workflow Run</p>
      <p className="text-[11px] text-muted-foreground">Exact scope: Workstream. Capacity: 2.</p>
      <label className="block text-[11px] font-medium text-foreground">
        Default Provider
        <select
          className="ml-2 rounded border border-input bg-background px-1 py-1 text-xs"
          value={props.selectedProvider}
          onChange={(event) =>
            props.onSelectedProviderChange(event.currentTarget.value as ProviderInstanceId)
          }
        >
          {props.providerOptions.map((provider) => (
            <option key={provider} value={provider}>
              {provider}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-[11px] font-medium text-foreground">
        Workstream override
        <select
          className="ml-2 rounded border border-input bg-background px-1 py-1 text-xs"
          value={props.overrideProvider ?? "inherit"}
          onChange={(event) =>
            props.onOverrideProviderChange(
              event.currentTarget.value === "inherit"
                ? null
                : (event.currentTarget.value as ProviderInstanceId),
            )
          }
        >
          <option value="inherit">Inherit default</option>
          {props.providerOptions.map((provider) => (
            <option key={provider} value={provider}>
              {provider}
            </option>
          ))}
        </select>
      </label>
      {(["fixedPoint", "baseline", "remoteTarget"] as const).map((field) => {
        const labels = {
          fixedPoint: "Fixed Point",
          baseline: "Workstream Baseline",
          remoteTarget: "Remote Target",
        };
        const values = {
          fixedPoint: props.fixedPoint,
          baseline: props.baseline,
          remoteTarget: props.remoteTarget,
        };
        const setters = {
          fixedPoint: props.onFixedPointChange,
          baseline: props.onBaselineChange,
          remoteTarget: props.onRemoteTargetChange,
        };
        return (
          <label key={field} className="block text-[11px] font-medium text-foreground">
            {labels[field]}
            <input
              className="mt-1 w-full rounded border border-input bg-background px-2 py-1 text-xs"
              value={values[field]}
              onChange={(event) => setters[field](event.currentTarget.value)}
            />
          </label>
        );
      })}
      <label className="block text-[11px] font-medium text-foreground">
        Execution Limit
        <select
          className="ml-2 rounded border border-input bg-background px-1 py-1 text-xs"
          value={props.executionLimit}
          onChange={(event) =>
            props.onExecutionLimitChange(Number(event.currentTarget.value) as 1 | 2)
          }
        >
          <option value="1">1 node</option>
          <option value="2">2 nodes</option>
        </select>
      </label>
      {preview ? (
        <p
          className={
            preview.status === "blocked"
              ? "text-[11px] text-amber-700"
              : "text-[11px] text-emerald-700"
          }
        >
          {preview.status === "blocked"
            ? preview.blockers.join(" ")
            : "Preflight passed. Review the exact authority above."}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!ready}
          className="rounded bg-secondary px-2 py-1 text-xs font-medium disabled:opacity-50"
          onClick={() => props.onPreflightRun(configuration())}
        >
          Run read-only preflight
        </button>
        {preview?.status === "ready-for-confirmation" && props.onConfirmRun ? (
          <button
            type="button"
            className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground"
            onClick={() => props.onConfirmRun?.(configuration())}
          >
            Confirm Workflow Run
          </button>
        ) : null}
      </div>
    </div>
  );
}
