import type {
  EnvironmentId,
  ProjectId,
  SkillInvocation,
  SkillRunId,
  ThreadId,
  WayfinderMapProjection,
  WorkstreamId,
} from "@t3tools/contracts";

export interface ProjectSkillWorkstream {
  readonly id: WorkstreamId;
  readonly projectId: ProjectId;
  readonly status: "active" | "completed";
  readonly linkedThreadIds: ReadonlyArray<ThreadId>;
  readonly skillRuns: ReadonlyArray<SkillInvocation>;
  readonly wayfinderMap: WayfinderMapProjection | null;
}

export interface EnvironmentProjectSkillWorkstream extends ProjectSkillWorkstream {
  readonly environmentId: EnvironmentId;
}

export const deriveProjectWorkstreams = (
  projectId: ProjectId,
  skillRuns: ReadonlyArray<SkillInvocation>,
): ReadonlyArray<ProjectSkillWorkstream> => {
  const workstreams = new Map<
    WorkstreamId,
    {
      readonly linkedThreadIds: Set<ThreadId>;
      readonly skillRuns: Map<SkillRunId, SkillInvocation>;
    }
  >();

  for (const invocation of skillRuns) {
    if (invocation.projectId !== projectId) continue;

    const existing = workstreams.get(invocation.workstreamId) ?? {
      linkedThreadIds: new Set<ThreadId>(),
      skillRuns: new Map<SkillRunId, SkillInvocation>(),
    };

    existing.linkedThreadIds.add(invocation.threadId);
    existing.skillRuns.set(invocation.skillRunId, invocation);
    workstreams.set(invocation.workstreamId, existing);
  }

  return Array.from(workstreams, ([id, workstream]) => {
    const sortedRuns = Array.from(workstream.skillRuns.values()).sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.skillRunId.localeCompare(right.skillRunId),
    );
    const wayfinderMap =
      sortedRuns.toReversed().find((run) => run.wayfinderMap)?.wayfinderMap ?? null;
    const completed =
      wayfinderMap !== null &&
      (wayfinderMap.canonicalReference.state === "closed" ||
        (wayfinderMap.destination.length > 0 &&
          wayfinderMap.fogOfWar.length === 0 &&
          wayfinderMap.tickets.every((ticket) => ticket.state === "closed")));
    return {
      id,
      projectId,
      status: completed ? ("completed" as const) : ("active" as const),
      linkedThreadIds: Array.from(workstream.linkedThreadIds).sort(),
      skillRuns: sortedRuns,
      wayfinderMap,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
};

export function findThreadWayfinderWorkstream(
  threadId: ThreadId,
  workstreams: ReadonlyArray<ProjectSkillWorkstream>,
): ProjectSkillWorkstream | null {
  const lastSynchronizedAt = (workstream: ProjectSkillWorkstream) =>
    workstream.wayfinderMap?.lastSynchronizedAt ?? "";
  return (
    workstreams
      .filter(
        (workstream) =>
          workstream.wayfinderMap !== null && workstream.linkedThreadIds.includes(threadId),
      )
      .sort(
        (left, right) =>
          lastSynchronizedAt(right).localeCompare(lastSynchronizedAt(left)) ||
          right.id.localeCompare(left.id),
      )[0] ?? null
  );
}

export function deriveEnvironmentWorkstreams(
  environmentId: EnvironmentId,
  skillRuns: ReadonlyArray<SkillInvocation>,
): ReadonlyArray<EnvironmentProjectSkillWorkstream> {
  const projectIds = [...new Set(skillRuns.map((run) => run.projectId))].sort();
  return projectIds.flatMap((projectId) =>
    deriveProjectWorkstreams(projectId, skillRuns).map((workstream) => ({
      ...workstream,
      environmentId,
    })),
  );
}
