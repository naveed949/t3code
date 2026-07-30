import type { EnvironmentProjectSkillWorkstream } from "@t3tools/client-runtime/state/skill-runs";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { scopedProjectKey } from "../../lib/scopedEntities";

export function ProjectWorkstreamsShelf(props: {
  readonly workstreams: ReadonlyArray<EnvironmentProjectSkillWorkstream>;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly onSelectThread: (thread: EnvironmentThreadShell) => void;
}) {
  const projectTitleByKey = new Map(
    props.projects.map(
      (project) => [scopedProjectKey(project.environmentId, project.id), project.title] as const,
    ),
  );
  const threadByKey = new Map(
    props.threads.map((thread) => [`${thread.environmentId}:${thread.id}`, thread] as const),
  );
  const entries = props.workstreams.flatMap((workstream) => {
    const map = workstream.wayfinderMap;
    const thread = workstream.linkedThreadIds
      .map((threadId) => threadByKey.get(`${workstream.environmentId}:${threadId}`))
      .find((candidate) => candidate !== undefined);
    return map && thread ? [{ workstream, map, thread }] : [];
  });
  if (entries.length === 0) return null;

  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel="Project Workstreams"
      className="px-4 pb-3"
    >
      <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
        Workstreams
      </Text>
      <View className="gap-2">
        {entries.map(({ workstream, map, thread }) => (
          <Pressable
            key={`${workstream.environmentId}:${workstream.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${map.canonicalReference.title}, ${workstream.status} Workstream`}
            className="rounded-xl border border-border bg-card px-4 py-3"
            onPress={() => props.onSelectThread(thread)}
          >
            <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
              {map.canonicalReference.title}
            </Text>
            <Text className="mt-1 text-xs capitalize text-foreground-muted" numberOfLines={1}>
              {projectTitleByKey.get(
                scopedProjectKey(workstream.environmentId, workstream.projectId),
              ) ?? "Project"}{" "}
              · {workstream.status}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
