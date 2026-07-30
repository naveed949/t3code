import type {
  ProjectId,
  SkillInvocation,
  SkillRunId,
  ThreadId,
  WorkstreamId,
} from "@t3tools/contracts";

export interface ProjectSkillWorkstream {
  readonly id: WorkstreamId;
  readonly projectId: ProjectId;
  readonly linkedThreadIds: ReadonlyArray<ThreadId>;
  readonly skillRuns: ReadonlyArray<SkillInvocation>;
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

  return Array.from(workstreams, ([id, workstream]) => ({
    id,
    projectId,
    linkedThreadIds: Array.from(workstream.linkedThreadIds).sort(),
    skillRuns: Array.from(workstream.skillRuns.values()).sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.skillRunId.localeCompare(right.skillRunId),
    ),
  })).sort((left, right) => left.id.localeCompare(right.id));
};
