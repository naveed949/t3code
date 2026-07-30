import type { WayfinderDraft } from "@t3tools/contracts";
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { wayfinderDraftPresentation } from "./wayfinderDraftPresentation";

export function WayfinderDraftCard(props: { readonly draft: WayfinderDraft }) {
  const presentation = wayfinderDraftPresentation(props.draft);
  const pending = presentation.pendingProposal;
  return (
    <View className="gap-2 rounded-[20px] border border-amber-300/35 bg-amber-50/90 p-4 dark:border-amber-300/15 dark:bg-amber-400/8">
      <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-amber-700 dark:text-amber-300">
        {presentation.authorityLabel}
      </Text>
      <Text className="font-sans text-sm text-neutral-600 dark:text-neutral-300">
        {presentation.safetyLabel}
      </Text>
      <Text className="font-t3-bold text-sm text-neutral-900 dark:text-neutral-100">
        {presentation.progressLabel}
      </Text>
      {pending ? (
        <View className="gap-1 rounded-2xl border border-amber-300/25 bg-white/70 p-3 dark:border-white/6 dark:bg-neutral-950/40">
          <Text className="font-t3-bold text-2xs uppercase tracking-[1px] text-neutral-500">
            Agent proposal
          </Text>
          <Text className="font-sans text-sm text-neutral-950 dark:text-neutral-50">
            {pending.question.question}
          </Text>
          {pending.recommendation ? (
            <Text className="font-sans text-xs text-neutral-600 dark:text-neutral-300">
              Recommended: {pending.recommendation}
              {pending.reasoning ? ` — ${pending.reasoning}` : ""}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
