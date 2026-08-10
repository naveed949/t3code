import type {
  ProviderInstanceId,
  WorkflowAttachment,
  WorkflowAttachmentHint,
  WorkflowPrdDocument,
  WorkflowRunConfiguration,
  WorkflowRunRequiredSkill,
} from "@t3tools/contracts";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";

export function WorkflowAttachmentCard(props: {
  readonly hint: WorkflowAttachmentHint | null;
  readonly attachment: WorkflowAttachment | null;
  readonly onDismiss?: () => void;
  readonly onAttach?: (workflowGoal: string) => void;
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
  readonly onPreflightBaselineRefresh?: () => void;
  readonly onConfirmBaselineRefresh?: (currentCommit: string, sourceCommit: string) => void;
  readonly onPreflightPublication?: () => void;
  readonly onConfirmPublication?: () => void;
  readonly onReconcilePublication?: () => void;
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
      <View className="gap-2 rounded-[20px] border border-sky-300/35 bg-sky-50/90 p-4 dark:border-sky-300/15 dark:bg-sky-400/8">
        <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-sky-700 dark:text-sky-300">
          Development Workflow attached
        </Text>
        <Text className="font-sans text-sm text-neutral-700 dark:text-neutral-200">
          {props.attachment.workflowGoal}
        </Text>
        {specificationStage ? (
          <View
            accessibilityLabel="Specification stage"
            className="gap-1 rounded-xl border border-violet-500/25 bg-violet-50/70 p-3 dark:bg-violet-400/10"
          >
            <Text className="font-t3-bold text-xs capitalize text-neutral-900 dark:text-neutral-100">
              Specification: {specificationStage.status.replaceAll("-", " ")}
            </Text>
            {specificationStage.checkpoint?.status === "pending" ? (
              <Text
                accessibilityLiveRegion="polite"
                className="font-sans text-xs text-neutral-700 dark:text-neutral-200"
              >
                Native test-seam checkpoint waiting for a response in the Specification thread.
              </Text>
            ) : specificationStage.checkpoint?.status === "resolved" ? (
              <Text className="font-sans text-xs text-neutral-700 dark:text-neutral-200">
                Native test-seam checkpoint response recorded.
              </Text>
            ) : null}
            {specificationStage.failure ? (
              <Text className="font-sans text-xs text-red-700 dark:text-red-300">
                {specificationStage.failure}
              </Text>
            ) : null}
            {specificationStage.status === "running" &&
            specificationStage.checkpoint?.status === "resolved" &&
            props.onCompleteSpecification ? (
              <View className="mt-2 gap-2 rounded-lg border border-violet-500/20 bg-white/50 p-2 dark:bg-neutral-950/30">
                <Text className="font-t3-bold text-xs text-neutral-900 dark:text-neutral-100">
                  Record structured Workflow PRD
                </Text>
                <Text className="font-sans text-[11px] text-neutral-600 dark:text-neutral-300">
                  Enter the provider-confirmed fields. T3 does not infer workflow state from prose.
                </Text>
                <TextInput
                  accessibilityLabel="Workflow PRD title"
                  value={prdTitle}
                  onChangeText={setPrdTitle}
                  placeholder="Title"
                  className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs dark:border-white/8 dark:bg-neutral-950/70"
                />
                <TextInput
                  accessibilityLabel="Workflow PRD problem statement"
                  value={prdProblemStatement}
                  onChangeText={setPrdProblemStatement}
                  placeholder="Problem statement"
                  multiline
                  className="min-h-[52px] rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs dark:border-white/8 dark:bg-neutral-950/70"
                />
                <TextInput
                  accessibilityLabel="Workflow PRD solution"
                  value={prdSolution}
                  onChangeText={setPrdSolution}
                  placeholder="Solution"
                  multiline
                  className="min-h-[52px] rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs dark:border-white/8 dark:bg-neutral-950/70"
                />
                {listFieldDefinitions.map(([label, value, setValue]) => (
                  <TextInput
                    key={label}
                    accessibilityLabel={label}
                    value={value}
                    onChangeText={setValue}
                    placeholder={label}
                    multiline
                    className="min-h-[52px] rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs dark:border-white/8 dark:bg-neutral-950/70"
                  />
                ))}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Complete Specification"
                  accessibilityState={{ disabled: prdDocument() === null }}
                  disabled={prdDocument() === null}
                  className="self-start rounded-lg bg-sky-500 px-3 py-2 disabled:bg-neutral-300 dark:disabled:bg-neutral-700"
                  onPress={() => {
                    const document = prdDocument();
                    if (document !== null) props.onCompleteSpecification?.(document);
                  }}
                >
                  <Text className="font-t3-bold text-xs text-white">Complete Specification</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}
        {props.attachment.workflowRun &&
        (props.onPreflightPublication ||
          props.onConfirmPublication ||
          props.onReconcilePublication) ? (
          <WorkflowPublicationControls
            attachment={props.attachment}
            {...(props.onPreflightPublication ? { onPreflight: props.onPreflightPublication } : {})}
            {...(props.onConfirmPublication ? { onConfirm: props.onConfirmPublication } : {})}
            {...(props.onReconcilePublication ? { onReconcile: props.onReconcilePublication } : {})}
          />
        ) : null}
        {props.onPreflightRun &&
        props.defaultProviderInstanceId &&
        !props.attachment.workflowRun ? (
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
        {props.attachment.workflowRun ? (
          <View className="gap-1 rounded-xl border border-emerald-500/25 bg-emerald-50/70 p-3 dark:bg-emerald-400/10">
            <Text
              accessibilityRole="text"
              className="font-t3-bold text-xs text-emerald-700 dark:text-emerald-300"
            >
              Workflow Run confirmed.
            </Text>
            <WorkflowRunSummary
              configuration={props.attachment.workflowRun.configuration}
              authorityGranted={props.attachment.workflowRun.authorityGranted}
            />
          </View>
        ) : props.attachment.workflowRunPreview ? (
          <View className="gap-1 rounded-xl border border-amber-400/30 bg-amber-50/70 p-3 dark:bg-amber-400/10">
            <Text
              accessibilityRole="text"
              className="font-t3-bold text-xs text-amber-700 dark:text-amber-300"
            >
              Workflow Run preflight: {props.attachment.workflowRunPreview.status}.
            </Text>
            {props.attachment.workflowRunPreview.blockers.length > 0 ? (
              <Text className="font-sans text-xs text-amber-700 dark:text-amber-300">
                {props.attachment.workflowRunPreview.blockers.join(" ")}
              </Text>
            ) : null}
            <WorkflowRunSummary
              configuration={props.attachment.workflowRunPreview.configuration}
              authorityGranted={props.attachment.workflowRunPreview.authorityGranted}
            />
          </View>
        ) : null}
        {props.attachment.workflowRun && props.onPreflightBaselineRefresh ? (
          <BaselineRefreshControls
            attachment={props.attachment}
            onPreflight={props.onPreflightBaselineRefresh}
            {...(props.onConfirmBaselineRefresh
              ? { onConfirm: props.onConfirmBaselineRefresh }
              : {})}
          />
        ) : null}
        {props.onOpenWorkstream ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open attached Development Workflow"
            className="self-start rounded-xl border border-sky-500/30 bg-white/70 px-4 py-2 dark:bg-neutral-950/40"
            onPress={props.onOpenWorkstream}
          >
            <Text className="font-t3-bold text-xs text-neutral-900 dark:text-neutral-100">
              Open Workstream
            </Text>
          </Pressable>
        ) : null}
        {unreadArtifactCount > 0 ? (
          <View className="gap-2 rounded-xl border border-sky-500/20 bg-white/60 px-3 py-2.5 dark:bg-neutral-950/30">
            <Text className="font-sans text-xs text-neutral-700 dark:text-neutral-200">
              {unreadArtifactCount} new or changed upstream{" "}
              {unreadArtifactCount === 1 ? "artifact" : "artifacts"}.
            </Text>
            {props.onViewArtifacts ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Mark workflow updates viewed"
                className="self-start rounded-lg px-2 py-1"
                onPress={props.onViewArtifacts}
              >
                <Text className="font-t3-bold text-xs text-sky-700 dark:text-sky-300">
                  Mark viewed
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {artifactToAcknowledge && props.onAcknowledgeArtifact ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Acknowledge latest workflow update"
            className="self-start rounded-lg px-2 py-1"
            onPress={() => props.onAcknowledgeArtifact?.(artifactToAcknowledge.id)}
          >
            <Text className="font-t3-bold text-xs text-sky-700 dark:text-sky-300">
              Acknowledge latest update
            </Text>
          </Pressable>
        ) : null}
        {staleNode ? (
          <View className="gap-2 rounded-xl border border-amber-400/45 bg-amber-100/70 px-3 py-2.5 dark:border-amber-300/25 dark:bg-amber-400/10">
            <Text className="font-sans text-xs leading-relaxed text-amber-950 dark:text-amber-100">
              Upstream Wayfinder data changed. Downstream work is paused until this update is
              accepted.
            </Text>
            {props.onResolveStale ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Accept upstream workflow update"
                className="self-start rounded-lg bg-amber-600 px-3 py-2"
                onPress={props.onResolveStale}
              >
                <Text className="font-t3-bold text-xs text-white">Accept upstream update</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }

  if (props.hint?.status !== "available") return null;
  const trimmedGoal = workflowGoal.trim();
  const canAttach = Boolean(props.onAttach) && originConfirmed && trimmedGoal.length > 0;

  return (
    <View className="gap-2.5 rounded-[20px] border border-neutral-200 bg-neutral-100/80 p-4 dark:border-white/6 dark:bg-neutral-900/80">
      <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-sky-700 dark:text-sky-300">
        Development Workflow
      </Text>
      <Text className="font-t3-bold text-lg text-neutral-950 dark:text-neutral-50">
        Attach this Wayfinder workstream?
      </Text>
      <Text className="font-sans text-sm text-neutral-600 dark:text-neutral-300">
        This keeps the conversation as the Origin Thread and stores a durable workflow link from its
        structured Wayfinder data.
      </Text>
      <TextInput
        accessibilityLabel="Workflow Goal"
        value={workflowGoal}
        onChangeText={setWorkflowGoal}
        placeholder="What should this workflow accomplish?"
        className="min-h-[48px] rounded-2xl border border-neutral-200 bg-white px-3.5 py-3 font-sans text-base text-neutral-950 dark:border-white/8 dark:bg-neutral-950/70 dark:text-neutral-50"
      />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel="Confirm Origin Thread"
        accessibilityState={{ checked: originConfirmed }}
        className="flex-row items-start gap-2"
        onPress={() => setOriginConfirmed((current) => !current)}
      >
        <View
          className={`mt-0.5 size-4 rounded border ${
            originConfirmed
              ? "border-sky-500 bg-sky-500"
              : "border-neutral-300 bg-white dark:border-neutral-600 dark:bg-neutral-950"
          }`}
        />
        <Text className="flex-1 font-sans text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">
          I confirm this conversation is the Origin Thread for the workflow.
        </Text>
      </Pressable>
      <View className="flex-row items-center gap-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Attach Workstream"
          accessibilityState={{ disabled: !canAttach }}
          disabled={!canAttach}
          className="rounded-xl bg-sky-500 px-4 py-3 disabled:bg-neutral-200 dark:disabled:bg-neutral-700/60"
          onPress={() => props.onAttach?.(trimmedGoal)}
        >
          <Text className="font-t3-extrabold text-xs text-white">Attach Workstream</Text>
        </Pressable>
        {props.onDismiss ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss workflow attachment hint"
            className="px-2 py-2"
            onPress={props.onDismiss}
          >
            <Text className="font-t3-bold text-xs text-neutral-500 dark:text-neutral-400">
              Dismiss
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
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
      mutateTracker: true,
      pushBaseline: false,
      createDraftPullRequest: false,
    },
  });
  const ready = props.fixedPoint.trim() && props.baseline.trim() && props.remoteTarget.trim();
  const preview = props.attachment.workflowRunPreview;
  return (
    <View className="gap-2 rounded-xl border border-sky-500/20 bg-white/60 p-3 dark:bg-neutral-950/30">
      <Text className="font-t3-bold text-xs text-neutral-900 dark:text-neutral-100">
        Prepare Workflow Run
      </Text>
      <Text className="font-sans text-xs text-neutral-600 dark:text-neutral-300">
        Exact scope: Workstream. Capacity: 2. Authority: create worktree, run provider, and
        synchronize the tracker; push and draft pull-request creation remain ungranted.
      </Text>
      <Text className="font-t3-bold text-xs text-neutral-900 dark:text-neutral-100">
        Default Provider
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {props.providerOptions.map((provider) => (
          <Pressable
            key={provider}
            accessibilityRole="radio"
            accessibilityLabel={`Use ${provider} as the default provider`}
            accessibilityState={{ selected: props.selectedProvider === provider }}
            className={`rounded-lg border px-2 py-1.5 ${
              props.selectedProvider === provider
                ? "border-sky-600 bg-sky-100 dark:bg-sky-400/20"
                : "border-neutral-300 bg-white/60 dark:border-neutral-700 dark:bg-neutral-950/30"
            }`}
            onPress={() => props.onSelectedProviderChange(provider)}
          >
            <Text className="font-sans text-xs text-neutral-800 dark:text-neutral-100">
              {provider}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text className="font-t3-bold text-xs text-neutral-900 dark:text-neutral-100">
        Workstream Provider Override
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <Pressable
          accessibilityRole="radio"
          accessibilityLabel="Inherit the default workflow provider"
          accessibilityState={{ selected: props.overrideProvider === null }}
          className={`rounded-lg border px-2 py-1.5 ${
            props.overrideProvider === null
              ? "border-sky-600 bg-sky-100 dark:bg-sky-400/20"
              : "border-neutral-300 bg-white/60 dark:border-neutral-700 dark:bg-neutral-950/30"
          }`}
          onPress={() => props.onOverrideProviderChange(null)}
        >
          <Text className="font-sans text-xs text-neutral-800 dark:text-neutral-100">Inherit</Text>
        </Pressable>
        {props.providerOptions.map((provider) => (
          <Pressable
            key={provider}
            accessibilityRole="radio"
            accessibilityLabel={`Use ${provider} for this workflow workstream`}
            accessibilityState={{ selected: props.overrideProvider === provider }}
            className={`rounded-lg border px-2 py-1.5 ${
              props.overrideProvider === provider
                ? "border-sky-600 bg-sky-100 dark:bg-sky-400/20"
                : "border-neutral-300 bg-white/60 dark:border-neutral-700 dark:bg-neutral-950/30"
            }`}
            onPress={() => props.onOverrideProviderChange(provider)}
          >
            <Text className="font-sans text-xs text-neutral-800 dark:text-neutral-100">
              {provider}
            </Text>
          </Pressable>
        ))}
      </View>
      {(
        [
          ["Fixed Point", props.fixedPoint, props.onFixedPointChange],
          ["Workstream Baseline", props.baseline, props.onBaselineChange],
          ["Remote Target", props.remoteTarget, props.onRemoteTargetChange],
        ] as const
      ).map(([label, value, setter]) => (
        <TextInput
          key={label}
          accessibilityLabel={label}
          value={value}
          onChangeText={setter}
          placeholder={label}
        />
      ))}
      <TextInput
        accessibilityLabel="Execution Limit"
        value={String(props.executionLimit)}
        onChangeText={(value) => props.onExecutionLimitChange(value === "2" ? 2 : 1)}
        keyboardType="number-pad"
      />
      {preview ? (
        <Text className="font-sans text-xs text-amber-700 dark:text-amber-300">
          {preview.status === "blocked"
            ? preview.blockers.join(" ")
            : "Preflight passed. Review the exact authority above."}
        </Text>
      ) : null}
      <View className="flex-row gap-2">
        <Pressable
          disabled={!ready}
          accessibilityRole="button"
          accessibilityLabel="Run read-only workflow preflight"
          className="rounded-lg bg-neutral-900 px-3 py-2 disabled:opacity-40 dark:bg-white"
          onPress={() => props.onPreflightRun(configuration())}
        >
          <Text className="font-t3-bold text-xs text-white dark:text-neutral-900">Preflight</Text>
        </Pressable>
        {preview?.status === "ready-for-confirmation" && props.onConfirmRun ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Confirm Workflow Run"
            className="rounded-lg bg-sky-600 px-3 py-2"
            onPress={() => props.onConfirmRun?.(configuration())}
          >
            <Text className="font-t3-bold text-xs text-white">Confirm</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function BaselineRefreshControls(props: {
  readonly attachment: WorkflowAttachment;
  readonly onPreflight: () => void;
  readonly onConfirm?: (currentCommit: string, sourceCommit: string) => void;
}) {
  const refresh = props.attachment.baselineRefresh;
  const canPreflight =
    refresh === undefined ||
    refresh.allowedActions?.some((action) => action.id === "preflight" && action.enabled) === true;
  const canConfirm =
    props.onConfirm !== undefined &&
    refresh?.allowedActions?.some((action) => action.id === "confirm" && action.enabled) === true;
  const statusLabel = refresh?.status.replaceAll("-", " ") ?? "not requested";
  return (
    <View
      accessibilityLabel="Baseline Refresh"
      className="gap-2 rounded-xl border border-sky-500/25 bg-sky-50/70 p-3 dark:bg-sky-400/10"
    >
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1 gap-1">
          <Text className="font-t3-bold text-xs text-neutral-900 dark:text-neutral-100">
            Baseline Refresh
          </Text>
          <Text className="font-sans text-[11px] capitalize text-neutral-600 dark:text-neutral-300">
            Status: {statusLabel}
          </Text>
        </View>
        {canPreflight ? (
          <Pressable
            accessibilityRole="button"
            className="rounded-lg border border-sky-500/30 px-2 py-1"
            onPress={props.onPreflight}
          >
            <Text className="font-t3-bold text-[11px] text-sky-700 dark:text-sky-300">
              {refresh === undefined ? "Preview incoming commits" : "Refresh preview"}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {refresh?.status === "ready" ? (
        <>
          <Text className="font-sans text-[11px] text-neutral-600 dark:text-neutral-300">
            {refresh.incomingCommits.length} incoming commit
            {refresh.incomingCommits.length === 1 ? "" : "s"}, {refresh.incomingFiles.length}{" "}
            changed file
            {refresh.incomingFiles.length === 1 ? "" : "s"}, and {refresh.affectedTickets.length}{" "}
            affected Ticket
            {refresh.affectedTickets.length === 1 ? "" : "s"}.
          </Text>
          {refresh.incomingCommits.length > 0 ? (
            <View className="gap-1">
              {refresh.incomingCommits.slice(0, 5).map((commit) => (
                <Text
                  key={commit.sha}
                  className="font-sans text-[11px] text-neutral-600 dark:text-neutral-300"
                >
                  {commit.sha.slice(0, 8)} {commit.title || "Untitled commit"}
                </Text>
              ))}
              {refresh.incomingCommits.length > 5 ? (
                <Text className="font-sans text-[11px] text-neutral-600 dark:text-neutral-300">
                  …and {refresh.incomingCommits.length - 5} more incoming commits.
                </Text>
              ) : null}
            </View>
          ) : (
            <Text className="font-sans text-[11px] text-neutral-600 dark:text-neutral-300">
              No incoming commits.
            </Text>
          )}
          {refresh.incomingFiles.length > 0 ? (
            <Text className="font-sans text-[11px] text-neutral-600 dark:text-neutral-300">
              Files:{" "}
              {refresh.incomingFiles
                .slice(0, 5)
                .map((file) => file.path)
                .join(", ")}
              {refresh.incomingFiles.length > 5
                ? `, and ${refresh.incomingFiles.length - 5} more`
                : ""}
              .
            </Text>
          ) : null}
          {refresh.affectedTickets.length > 0 ? (
            <View className="gap-1">
              {refresh.affectedTickets.map((ticket) => (
                <Text
                  key={`${ticket.nodeId}:${ticket.state}`}
                  className="font-sans text-[11px] text-neutral-600 dark:text-neutral-300"
                >
                  Ticket #{ticket.ticketNumber} ({ticket.state}): {ticket.reason}
                </Text>
              ))}
            </View>
          ) : (
            <Text className="font-sans text-[11px] text-neutral-600 dark:text-neutral-300">
              No integrated or Stale Tickets are affected.
            </Text>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canConfirm }}
            disabled={!canConfirm}
            className="self-start rounded-lg bg-sky-500 px-3 py-2 disabled:bg-neutral-300 dark:disabled:bg-neutral-700"
            onPress={() => {
              if (canConfirm && refresh) {
                props.onConfirm?.(refresh.currentCommit!, refresh.sourceCommit!);
              }
            }}
          >
            <Text className="font-t3-bold text-xs text-white">Confirm baseline refresh</Text>
          </Pressable>
        </>
      ) : null}
      {refresh?.status === "previewing" ? (
        <Text className="font-sans text-[11px] text-neutral-600 dark:text-neutral-300">
          Building a preview from the confirmed baseline.
        </Text>
      ) : null}
      {refresh?.status === "draining" || refresh?.status === "refreshing" ? (
        <Text className="font-sans text-[11px] text-neutral-600 dark:text-neutral-300">
          Active work is draining before the baseline changes. No new automatic Ticket work will
          start.
        </Text>
      ) : null}
      {refresh?.status === "needs-recovery" ? (
        <Text
          accessibilityRole="alert"
          className="font-sans text-[11px] text-red-700 dark:text-red-300"
        >
          {refresh.failure ?? "Baseline refresh needs recovery."}
        </Text>
      ) : null}
      {refresh?.status === "completed" ? (
        <Text className="font-sans text-[11px] text-neutral-600 dark:text-neutral-300">
          Baseline refreshed at {refresh.currentCommit ?? "the confirmed source"}.
        </Text>
      ) : null}
    </View>
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
    .map((override) => `${override.nodeId} -> ${override.providerInstanceId}`)
    .join(", ");
  const verification = props.configuration.targetVerification;
  return (
    <View className="gap-0.5">
      <Text className="font-sans text-[11px] text-neutral-600 dark:text-neutral-300">
        Scope: {scope}
      </Text>
      <Text className="font-sans text-[11px] text-neutral-600 dark:text-neutral-300">
        Provider: {props.configuration.defaultProviderInstanceId}; {overrides || "no overrides"}
      </Text>
      <Text className="font-sans text-[11px] text-neutral-600 dark:text-neutral-300">
        Fixed Point: {props.configuration.fixedPoint} ({verification?.fixedPoint ?? "unverified"})
      </Text>
      <Text className="font-sans text-[11px] text-neutral-600 dark:text-neutral-300">
        Baseline: {props.configuration.workstreamBaseline} (
        {verification?.workstreamBaseline ?? "unverified"})
      </Text>
      <Text className="font-sans text-[11px] text-neutral-600 dark:text-neutral-300">
        Remote Target: {props.configuration.remoteTarget} (
        {verification?.remoteTarget ?? "unverified"})
      </Text>
      <Text className="font-sans text-[11px] text-neutral-600 dark:text-neutral-300">
        Execution: {props.configuration.executionLimit}/
        {props.configuration.environmentAutomationCapacity}; authority{" "}
        {props.authorityGranted ? "granted" : "not granted"} (worktree{" "}
        {props.configuration.authority.createWorktree ? "yes" : "no"}, provider{" "}
        {props.configuration.authority.runProvider ? "yes" : "no"}, tracker{" "}
        {props.configuration.authority.mutateTracker ? "yes" : "no"}, push{" "}
        {props.configuration.authority.pushBaseline ? "yes" : "no"}, draft PR{" "}
        {props.configuration.authority.createDraftPullRequest ? "yes" : "no"})
      </Text>
    </View>
  );
}

export function WorkflowPublicationControls(props: {
  readonly attachment: WorkflowAttachment;
  readonly onPreflight?: () => void;
  readonly onConfirm?: () => void;
  readonly onReconcile?: () => void;
}) {
  const publication = props.attachment.publication;
  const action = (id: "preflight" | "confirm" | "reconcile") =>
    publication?.allowedActions?.find((candidate) => candidate.id === id);
  const canPreflight =
    props.onPreflight !== undefined &&
    (publication === undefined || action("preflight")?.enabled === true);
  const canConfirm = action("confirm")?.enabled === true && props.onConfirm !== undefined;
  const canReconcile = action("reconcile")?.enabled === true && props.onReconcile !== undefined;
  return (
    <View
      accessibilityLabel="Workstream Publication"
      className="gap-2 rounded-xl border border-fuchsia-500/25 bg-fuchsia-50/70 p-3 dark:bg-fuchsia-400/10"
    >
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1 gap-1">
          <Text className="font-t3-bold text-xs text-neutral-900 dark:text-neutral-100">
            Workstream Publication
          </Text>
          <Text className="font-sans text-[11px] capitalize text-neutral-600 dark:text-neutral-300">
            Status: {publication?.status.replaceAll("-", " ") ?? "not requested"}
          </Text>
        </View>
        {canPreflight ? (
          <Pressable
            accessibilityRole="button"
            className="rounded-lg border border-fuchsia-500/30 px-2 py-1"
            onPress={props.onPreflight}
          >
            <Text className="font-t3-bold text-[11px] text-fuchsia-700 dark:text-fuchsia-300">
              {publication === undefined ? "Preview publication" : "Refresh preview"}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {publication ? (
        <>
          <View className="gap-0.5">
            <Text className="font-sans text-[11px] text-neutral-600 dark:text-neutral-300">
              Title: {publication.title}
            </Text>
            <Text className="font-sans text-[11px] text-neutral-600 dark:text-neutral-300">
              Remote: {publication.remoteTarget}
            </Text>
            <Text className="font-sans text-[11px] text-neutral-600 dark:text-neutral-300">
              Head: {publication.headBranch} · Target: {publication.targetBranch}
            </Text>
            <Text className="font-sans text-[11px] text-neutral-600 dark:text-neutral-300">
              Authority:{" "}
              {publication.authorityGranted ? "push + draft PR granted" : "read-only preview"}
            </Text>
          </View>
          {publication.commits.length > 0 ? (
            <View className="gap-1">
              {publication.commits.map((commit) => (
                <Text
                  key={commit.sha}
                  className="font-sans text-[11px] text-neutral-600 dark:text-neutral-300"
                >
                  {commit.sha.slice(0, 8)} {commit.title || "Untitled commit"}
                </Text>
              ))}
            </View>
          ) : null}
          <View className="gap-1 rounded-lg border border-fuchsia-500/20 bg-white/45 p-2 dark:bg-neutral-950/25">
            <Text className="font-t3-bold text-[11px] text-neutral-900 dark:text-neutral-100">
              Pull request body
            </Text>
            <Text className="font-sans text-[11px] text-neutral-600 dark:text-neutral-300">
              {publication.body}
            </Text>
          </View>
          {publication.changeRequest ? (
            <View className="gap-1">
              <Pressable
                accessibilityRole="link"
                onPress={() =>
                  void import("../../lib/openExternalUrl").then(({ tryOpenExternalUrl }) =>
                    tryOpenExternalUrl(publication.changeRequest!.url, "pull-request"),
                  )
                }
              >
                <Text className="text-[11px] font-semibold text-fuchsia-700 underline dark:text-fuchsia-300">
                  Pull request #{publication.changeRequest.number} (
                  {publication.changeRequest.state})
                </Text>
              </Pressable>
              <Text className="font-sans text-[11px] text-neutral-600 dark:text-neutral-300">
                Checks: {publication.changeRequest.checksState ?? "unavailable"}; Reviews:{" "}
                {publication.changeRequest.reviewState ?? "unavailable"}
              </Text>
            </View>
          ) : null}
          {publication.failure ? (
            <Text
              accessibilityRole="alert"
              className="font-sans text-[11px] text-red-700 dark:text-red-300"
            >
              {publication.failure}
            </Text>
          ) : null}
          <View className="flex-row flex-wrap gap-2">
            {canConfirm ? (
              <Pressable
                accessibilityRole="button"
                className="rounded-lg bg-fuchsia-600 px-3 py-2"
                onPress={props.onConfirm}
              >
                <Text className="font-t3-bold text-xs text-white">Publish draft PR</Text>
              </Pressable>
            ) : null}
            {canReconcile ? (
              <Pressable
                accessibilityRole="button"
                className="rounded-lg border border-border px-3 py-2"
                onPress={props.onReconcile}
              >
                <Text className="font-t3-bold text-xs text-foreground">Reconcile</Text>
              </Pressable>
            ) : null}
          </View>
        </>
      ) : null}
    </View>
  );
}
