import type { ApprovalRequestId } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { cn } from "../../lib/cn";
import type { PendingUserInput, PendingUserInputDraftAnswer } from "../../lib/threadActivity";
import { wayfinderDecisionStep } from "./wayfinderDraftPresentation";

export interface PendingUserInputCardProps {
  readonly pendingUserInput: PendingUserInput;
  readonly drafts: Record<string, PendingUserInputDraftAnswer>;
  readonly answers: Record<string, string> | null;
  readonly respondingUserInputId: ApprovalRequestId | null;
  readonly onSelectOption: (
    requestId: ApprovalRequestId,
    questionId: string,
    label: string,
  ) => void;
  readonly onChangeCustomAnswer: (
    requestId: ApprovalRequestId,
    questionId: string,
    customAnswer: string,
  ) => void;
  readonly onSubmit: () => Promise<unknown>;
  readonly isWayfinderDecision?: boolean;
}

export function PendingUserInputCard(props: PendingUserInputCardProps) {
  const [questionIndex, setQuestionIndex] = useState(0);
  useEffect(() => {
    setQuestionIndex(0);
  }, [props.pendingUserInput.requestId]);
  const decisionStep = wayfinderDecisionStep(
    props.pendingUserInput.questions,
    props.drafts,
    questionIndex,
  );
  const visibleQuestions = props.isWayfinderDecision
    ? decisionStep.visibleQuestions
    : props.pendingUserInput.questions;
  const canAdvance = props.isWayfinderDecision && decisionStep.canAdvance;
  const isResponding = props.respondingUserInputId === props.pendingUserInput.requestId;
  const submitLabel = canAdvance
    ? "Next decision"
    : props.isWayfinderDecision
      ? "Confirm decision"
      : "Submit answers";
  const submitDisabled = (!canAdvance && props.answers === null) || isResponding;

  return (
    <View className="gap-2.5 rounded-[20px] border border-neutral-200 bg-neutral-100/80 p-4 dark:border-white/6 dark:bg-neutral-900/80">
      <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-sky-700 dark:text-sky-300">
        {props.isWayfinderDecision ? "Decision Card" : "User input needed"}
      </Text>
      <Text className="font-t3-bold text-lg text-neutral-950 dark:text-neutral-50">
        {props.isWayfinderDecision ? "Confirm one draft decision" : "Fill in the pending answers"}
      </Text>
      {visibleQuestions.map((question) => {
        const draft = props.drafts[question.id];
        return (
          <View key={question.id} className="gap-2 pt-1">
            <Text className="font-t3-bold text-xs uppercase tracking-[1px] text-neutral-500 dark:text-neutral-500">
              {question.header}
            </Text>
            <Text className="font-sans text-base leading-snug text-neutral-950 dark:text-neutral-50">
              {question.question}
            </Text>
            {props.isWayfinderDecision ? (
              <Text className="font-sans text-xs text-neutral-500 dark:text-neutral-400">
                Agent proposal · your response confirms the draft decision.
              </Text>
            ) : null}
            <View className="flex-row flex-wrap gap-2.5">
              {question.options.map((option) => {
                const selected =
                  draft?.selectedOptionLabel === option.label && !draft.customAnswer?.trim().length;
                return (
                  <Pressable
                    key={option.label}
                    accessibilityRole="button"
                    accessibilityLabel={
                      option.description && option.description !== option.label
                        ? `${option.label}. ${option.description}`
                        : option.label
                    }
                    accessibilityState={{ selected, disabled: isResponding }}
                    disabled={isResponding}
                    className={cn(
                      "rounded-full border px-3 py-2.5 ",
                      selected
                        ? "border-blue-300/50 bg-blue-50 dark:border-blue-400/28 dark:bg-blue-400/14"
                        : "border-neutral-200 bg-white dark:border-white/6 dark:bg-neutral-950/70",
                    )}
                    onPress={() =>
                      props.onSelectOption(
                        props.pendingUserInput.requestId,
                        question.id,
                        option.label,
                      )
                    }
                  >
                    <Text
                      className={cn(
                        "font-t3-bold text-sm",
                        selected
                          ? "text-sky-700 dark:text-sky-300"
                          : "text-neutral-600 dark:text-neutral-300",
                      )}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              accessibilityLabel={`Custom answer for ${question.question}`}
              value={draft?.customAnswer ?? ""}
              onChangeText={(value) =>
                props.onChangeCustomAnswer(props.pendingUserInput.requestId, question.id, value)
              }
              placeholder="Or type a custom answer"
              className="min-h-[54px] rounded-2xl border border-neutral-200 bg-white px-3.5 py-3 font-sans text-base text-neutral-950 dark:border-white/8 dark:bg-neutral-950/70 dark:text-neutral-50"
            />
          </View>
        );
      })}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={submitLabel}
        accessibilityState={{ disabled: submitDisabled }}
        className={cn(
          "items-center justify-center rounded-2xl px-4 py-3.5",
          canAdvance || props.answers ? "bg-blue-500" : "bg-neutral-200 dark:bg-neutral-700/60",
        )}
        disabled={submitDisabled}
        onPress={() => {
          if (canAdvance) {
            setQuestionIndex((current) => current + 1);
            return;
          }
          void props.onSubmit();
        }}
      >
        <Text className="font-t3-extrabold text-sm text-white">{submitLabel}</Text>
      </Pressable>
    </View>
  );
}
