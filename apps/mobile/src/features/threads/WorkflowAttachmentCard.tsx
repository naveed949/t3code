import type { WorkflowAttachment, WorkflowAttachmentHint } from "@t3tools/contracts";
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
      <View className="gap-2 rounded-[20px] border border-sky-300/35 bg-sky-50/90 p-4 dark:border-sky-300/15 dark:bg-sky-400/8">
        <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-sky-700 dark:text-sky-300">
          Development Workflow attached
        </Text>
        <Text className="font-sans text-sm text-neutral-700 dark:text-neutral-200">
          {props.attachment.workflowGoal}
        </Text>
        {props.attachment.workflowRun ? (
          <Text
            accessibilityRole="text"
            className="font-sans text-xs text-emerald-700 dark:text-emerald-300"
          >
            Workflow Run confirmed. Exact scope, provider, baseline, and granted authority are
            recorded.
          </Text>
        ) : props.attachment.workflowRunPreview ? (
          <Text
            accessibilityRole="text"
            className="font-sans text-xs text-amber-700 dark:text-amber-300"
          >
            Workflow Run preflight: {props.attachment.workflowRunPreview.status}.
            {props.attachment.workflowRunPreview.blockers.length > 0
              ? ` ${props.attachment.workflowRunPreview.blockers.join(" ")}`
              : " Review the exact scope and authority on web or desktop to confirm."}
          </Text>
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
