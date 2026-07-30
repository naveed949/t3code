import { memo } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { showsWayfinderLaunchChooser } from "./WayfinderLaunchChooser.logic";

const choices = [
  { id: "new-map", label: "New", prompt: "$wayfinder new-map" },
  { id: "continue-map", label: "Continue", prompt: "$wayfinder continue-map " },
  { id: "generic", label: "Generic", prompt: "$wayfinder generic " },
] as const;

export const WayfinderLaunchChooser = memo(function WayfinderLaunchChooser(props: {
  readonly prompt: string;
  readonly onChangePrompt: (prompt: string) => void;
}) {
  if (!showsWayfinderLaunchChooser(props.prompt)) return null;

  return (
    <View className="mb-2 flex-row items-center gap-2">
      <Text className="text-xs text-foreground-muted">Wayfinder</Text>
      {choices.map((choice) => (
        <Pressable
          key={choice.id}
          accessibilityRole="button"
          accessibilityLabel={`${choice.label} Wayfinder map`}
          onPress={() => props.onChangePrompt(choice.prompt)}
          className="rounded-full border border-border px-3 py-1.5 active:opacity-60"
        >
          <Text className="text-xs font-t3-medium text-foreground">{choice.label}</Text>
        </Pressable>
      ))}
    </View>
  );
});
