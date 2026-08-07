import type {
  ProviderInstanceId,
  ThreadId,
  WorkflowAttachment,
  WorkflowAttachmentHint,
  WorkflowPrdDocument,
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
  readonly onCompleteSpecification?: (document: WorkflowPrdDocument) => void;
  readonly defaultProviderInstanceId?: ProviderInstanceId;
  readonly providerOptions?: ReadonlyArray<ProviderInstanceId>;
  readonly requiredSkillsByProvider?: ReadonlyMap<
    ProviderInstanceId,
    ReadonlyArray<WorkflowRunRequiredSkill>
  >;
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
  const [prdTitle, setPrdTitle] = useState("");
  const [prdProblemStatement, setPrdProblemStatement] = useState("");
  const [prdSolution, setPrdSolution] = useState("");
  const [prdUserStories, setPrdUserStories] = useState("");
  const [prdImplementationDecisions, setPrdImplementationDecisions] = useState("");
  const [prdTestingDecisions, setPrdTestingDecisions] = useState("");
  const [prdOutOfScope, setPrdOutOfScope] = useState("");

  if (props.attachment !== null) {
    const graph = props.attachment.workflowGraph;
    const unreadArtifactCount = graph?.unreadArtifactCount ?? 0;
    const artifactToAcknowledge = graph?.artifacts
      .slice()
      .reverse()
      .find((artifact) => artifact.marker.state !== "acknowledged");
    const staleNode = graph?.nodes.find((node) => node.state === "stale") ?? null;
    const specificationStage = props.attachment.specificationStage;
    const currentWorkflowPrdVersion = Math.max(
      0,
      ...(graph?.artifacts ?? [])
        .filter((artifact) => artifact.kind === "workflow-prd")
        .map((artifact) => artifact.version),
    );
    const listLines = (value: string) =>
      value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    const prdDocument = (): WorkflowPrdDocument | null => {
      const userStories = listLines(prdUserStories);
      const implementationDecisions = listLines(prdImplementationDecisions);
      const testingDecisions = listLines(prdTestingDecisions);
      const title = prdTitle.trim();
      const problemStatement = prdProblemStatement.trim();
      const solution = prdSolution.trim();
      if (
        title.length === 0 ||
        problemStatement.length === 0 ||
        solution.length === 0 ||
        userStories.length === 0 ||
        implementationDecisions.length === 0 ||
        testingDecisions.length === 0
      ) {
        return null;
      }
      return {
        version: currentWorkflowPrdVersion + 1,
        title,
        problemStatement,
        solution,
        userStories,
        implementationDecisions,
        testingDecisions,
        outOfScope: listLines(prdOutOfScope),
      };
    };
    const listFieldDefinitions: ReadonlyArray<readonly [string, string, (next: string) => void]> = [
      ["User stories (one per line)", prdUserStories, setPrdUserStories],
      [
        "Implementation decisions (one per line)",
        prdImplementationDecisions,
        setPrdImplementationDecisions,
      ],
      ["Testing decisions (one per line)", prdTestingDecisions, setPrdTestingDecisions],
      ["Out of scope (one per line)", prdOutOfScope, setPrdOutOfScope],
    ];

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
        {specificationStage ? (
          <div
            aria-label="Specification stage"
            className="mt-2 rounded-md border border-violet-500/25 bg-violet-500/5 px-2.5 py-2 text-xs text-muted-foreground"
          >
            <p className="font-medium text-foreground">
              Specification: {specificationStage.status.replaceAll("-", " ")}
            </p>
            {specificationStage.checkpoint?.status === "pending" ? (
              <p className="mt-1" aria-live="polite">
                Native test-seam checkpoint waiting for a response in the Specification thread.
              </p>
            ) : specificationStage.checkpoint?.status === "resolved" ? (
              <p className="mt-1">Native test-seam checkpoint response recorded.</p>
            ) : null}
            {specificationStage.failure ? (
              <p className="mt-1 text-destructive">{specificationStage.failure}</p>
            ) : null}
            {specificationStage.status === "running" &&
            specificationStage.checkpoint?.status === "resolved" &&
            props.onCompleteSpecification ? (
              <details className="mt-2 rounded-md border border-violet-500/20 bg-background/50 p-2">
                <summary className="cursor-pointer font-medium text-foreground">
                  Record structured Workflow PRD
                </summary>
                <form
                  className="mt-2 space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const document = prdDocument();
                    if (document !== null) props.onCompleteSpecification?.(document);
                  }}
                >
                  <p className="text-[11px]">
                    Enter the provider-confirmed specification as structured fields. T3 does not
                    infer workflow state from prose.
                  </p>
                  <label className="block text-[11px] font-medium">
                    Title
                    <input
                      value={prdTitle}
                      onChange={(event) => setPrdTitle(event.currentTarget.value)}
                      className="mt-1 w-full rounded border border-input bg-background px-2 py-1 text-xs font-normal"
                    />
                  </label>
                  <label className="block text-[11px] font-medium">
                    Problem statement
                    <textarea
                      value={prdProblemStatement}
                      onChange={(event) => setPrdProblemStatement(event.currentTarget.value)}
                      rows={2}
                      className="mt-1 w-full rounded border border-input bg-background px-2 py-1 text-xs font-normal"
                    />
                  </label>
                  <label className="block text-[11px] font-medium">
                    Solution
                    <textarea
                      value={prdSolution}
                      onChange={(event) => setPrdSolution(event.currentTarget.value)}
                      rows={2}
                      className="mt-1 w-full rounded border border-input bg-background px-2 py-1 text-xs font-normal"
                    />
                  </label>
                  {listFieldDefinitions.map(([label, value, setValue]) => (
                    <label key={label} className="block text-[11px] font-medium">
                      {label}
                      <textarea
                        value={value}
                        onChange={(event) => setValue(event.currentTarget.value)}
                        rows={2}
                        className="mt-1 w-full rounded border border-input bg-background px-2 py-1 text-xs font-normal"
                      />
                    </label>
                  ))}
                  <button
                    type="submit"
                    disabled={prdDocument() === null}
                    className="rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Complete Specification
                  </button>
                </form>
              </details>
            ) : null}
          </div>
        ) : null}
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
            requiredSkillsByProvider={props.requiredSkillsByProvider ?? new Map()}
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
  readonly requiredSkillsByProvider: ReadonlyMap<
    ProviderInstanceId,
    ReadonlyArray<WorkflowRunRequiredSkill>
  >;
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
    runScope: [{ nodeId: `workflow:${props.attachment.workstreamId}`, label: "Workstream" }],
    defaultProviderInstanceId: props.selectedProvider,
    providerOverrides:
      props.overrideProvider === null
        ? []
        : [
            {
              nodeId: `workflow:${props.attachment.workstreamId}`,
              providerInstanceId: props.overrideProvider,
            },
          ],
    requiredSkills:
      props.requiredSkillsByProvider.get(props.overrideProvider ?? props.selectedProvider) ?? [],
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
        <p className="font-medium">Workflow Run confirmed.</p>
        <WorkflowRunSummary
          configuration={props.attachment.workflowRun.configuration}
          authorityGranted={props.attachment.workflowRun.authorityGranted}
        />
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
      <div className="text-[11px] text-muted-foreground">
        Granted authority: create worktree; run provider. Tracker mutation, push, and pull-request
        creation remain ungranted.
      </div>
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
        <div
          className={
            preview.status === "blocked"
              ? "text-[11px] text-amber-700"
              : "text-[11px] text-emerald-700"
          }
        >
          <p>
            {preview.status === "blocked"
              ? preview.blockers.join(" ")
              : "Read-only preflight passed. Confirm this exact persisted configuration."}
          </p>
          <WorkflowRunSummary
            configuration={preview.configuration}
            authorityGranted={preview.authorityGranted}
          />
        </div>
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

function WorkflowRunSummary(props: {
  readonly configuration: WorkflowRunConfiguration;
  readonly authorityGranted: boolean;
}) {
  const scope = props.configuration.runScope
    .map((node) => `${node.label} (${node.nodeId})`)
    .join(", ");
  const overrides = props.configuration.providerOverrides
    .map((override) => `${override.nodeId} → ${override.providerInstanceId}`)
    .join(", ");
  const verification = props.configuration.targetVerification;
  return (
    <dl className="mt-2 grid gap-0.5 text-[11px] text-muted-foreground">
      <div>
        <dt className="inline font-medium">Run Scope:</dt> <dd className="inline">{scope}</dd>
      </div>
      <div>
        <dt className="inline font-medium">Provider:</dt>{" "}
        <dd className="inline">
          {props.configuration.defaultProviderInstanceId}
          {overrides.length > 0 ? `; overrides ${overrides}` : "; no overrides"}
        </dd>
      </div>
      <div>
        <dt className="inline font-medium">Fixed Point:</dt>{" "}
        <dd className="inline">
          {props.configuration.fixedPoint} ({verification?.fixedPoint ?? "unverified"})
        </dd>
      </div>
      <div>
        <dt className="inline font-medium">Baseline:</dt>{" "}
        <dd className="inline">
          {props.configuration.workstreamBaseline} (
          {verification?.workstreamBaseline ?? "unverified"})
        </dd>
      </div>
      <div>
        <dt className="inline font-medium">Remote Target:</dt>{" "}
        <dd className="inline">
          {props.configuration.remoteTarget} ({verification?.remoteTarget ?? "unverified"})
        </dd>
      </div>
      <div>
        <dt className="inline font-medium">Execution:</dt>{" "}
        <dd className="inline">
          {props.configuration.executionLimit}/{props.configuration.environmentAutomationCapacity}
        </dd>
      </div>
      <div>
        <dt className="inline font-medium">Authority:</dt>{" "}
        <dd className="inline">
          {props.authorityGranted ? "granted" : "not granted"}; create worktree{" "}
          {props.configuration.authority.createWorktree ? "yes" : "no"}, run provider{" "}
          {props.configuration.authority.runProvider ? "yes" : "no"}, tracker mutation{" "}
          {props.configuration.authority.mutateTracker ? "yes" : "no"}, push{" "}
          {props.configuration.authority.pushBaseline ? "yes" : "no"}, draft PR{" "}
          {props.configuration.authority.createDraftPullRequest ? "yes" : "no"}
        </dd>
      </div>
    </dl>
  );
}
