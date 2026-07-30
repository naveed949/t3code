import type { EnvironmentProjectSkillWorkstream } from "@t3tools/client-runtime/state/skill-runs";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { MapIcon } from "lucide-react";
import { memo } from "react";

export const ProjectWorkstreamsShelf = memo(function ProjectWorkstreamsShelf(props: {
  readonly workstreams: ReadonlyArray<EnvironmentProjectSkillWorkstream>;
  readonly projectTitleByKey: ReadonlyMap<string, string>;
  readonly onOpenThread: (thread: ScopedThreadRef) => void;
}) {
  const workstreams = props.workstreams.flatMap((workstream) => {
    const map = workstream.wayfinderMap;
    const threadId = workstream.linkedThreadIds[0];
    return map && threadId ? [{ workstream, map, threadId }] : [];
  });
  if (workstreams.length === 0) return null;

  return (
    <section aria-label="Project Workstreams" className="px-2 pb-2">
      <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Workstreams
      </p>
      <ul className="space-y-1">
        {workstreams.map(({ workstream, map, threadId }) => {
          const projectKey = `${workstream.environmentId}:${workstream.projectId}`;
          return (
            <li key={`${workstream.environmentId}:${workstream.id}`}>
              <button
                type="button"
                className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-accent"
                onClick={() =>
                  props.onOpenThread({ environmentId: workstream.environmentId, threadId })
                }
              >
                <MapIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-foreground">
                    {map.canonicalReference.title}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {props.projectTitleByKey.get(projectKey) ?? "Project"} · {workstream.status}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
});
