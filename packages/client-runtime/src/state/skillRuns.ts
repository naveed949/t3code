import type {
  EnvironmentId,
  OrchestrationThreadShell,
  ProjectId,
  SkillInvocation,
  SkillRunId,
  ThreadId,
  WayfinderMapProjection,
  WayfinderSynchronizationState,
  WorkstreamId,
} from "@t3tools/contracts";
import {
  deriveWayfinderReadiness,
  type WayfinderReadiness,
} from "@t3tools/shared/wayfinderReadiness";

export interface ProjectSkillWorkstream {
  readonly id: WorkstreamId;
  readonly projectId: ProjectId;
  readonly status: "active" | "completed";
  readonly linkedThreadIds: ReadonlyArray<ThreadId>;
  readonly ticketThreads: ReadonlyArray<{
    readonly ticketNumber: number;
    readonly threadId: ThreadId;
    readonly skillRunId: SkillRunId;
    readonly sourceSkillRunId: SkillRunId;
    readonly status: "active" | "resolved" | "out-of-scope";
  }>;
  readonly skillRuns: ReadonlyArray<SkillInvocation>;
  readonly wayfinderMap: WayfinderMapProjection | null;
  readonly wayfinderSynchronization: WayfinderSynchronizationState | null;
  readonly readiness: WayfinderReadiness;
}

export interface EnvironmentProjectSkillWorkstream extends ProjectSkillWorkstream {
  readonly environmentId: EnvironmentId;
}

type WayfinderMapInvocation = SkillInvocation & { readonly wayfinderMap: WayfinderMapProjection };

function isWayfinderMapInvocation(
  invocation: SkillInvocation,
): invocation is WayfinderMapInvocation {
  return invocation.wayfinderMap !== undefined;
}

function mapSynchronizationTime(invocation: WayfinderMapInvocation): string {
  return invocation.wayfinderSynchronizedAt ?? invocation.wayfinderMap.lastSynchronizedAt;
}

export const deriveProjectWorkstreams = (
  projectId: ProjectId,
  skillRuns: ReadonlyArray<SkillInvocation>,
  threads: ReadonlyArray<OrchestrationThreadShell> = [],
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
    const mapRuns = sortedRuns
      .filter(isWayfinderMapInvocation)
      .sort(
        (left, right) =>
          mapSynchronizationTime(left).localeCompare(mapSynchronizationTime(right)) ||
          left.createdAt.localeCompare(right.createdAt) ||
          left.skillRunId.localeCompare(right.skillRunId),
      );
    const storedWayfinderMap = mapRuns.at(-1)?.wayfinderMap ?? null;
    const lastSynchronizedAt = sortedRuns
      .flatMap((run) => [
        ...(run.wayfinderSynchronizedAt ? [run.wayfinderSynchronizedAt] : []),
        ...(run.wayfinderMap ? [run.wayfinderMap.lastSynchronizedAt] : []),
      ])
      .sort()
      .at(-1);
    const wayfinderMap =
      storedWayfinderMap && lastSynchronizedAt
        ? { ...storedWayfinderMap, lastSynchronizedAt }
        : storedWayfinderMap;
    const wayfinderSynchronization =
      sortedRuns
        .flatMap((run) =>
          run.wayfinderSynchronization
            ? [{ run, synchronization: run.wayfinderSynchronization }]
            : [],
        )
        .sort(
          (left, right) =>
            left.synchronization.lastAttemptedAt.localeCompare(
              right.synchronization.lastAttemptedAt,
            ) ||
            left.run.createdAt.localeCompare(right.run.createdAt) ||
            left.run.skillRunId.localeCompare(right.run.skillRunId),
        )
        .at(-1)?.synchronization ?? null;
    const ticketThreads = sortedRuns
      .flatMap((run) => {
        const action = run.action?.id === "work-ticket" ? run.action : null;
        if (action === null) return [];
        const ticket = wayfinderMap?.tickets.find(
          (candidate) => candidate.number === action.ticketNumber,
        );
        return [
          {
            ticketNumber: action.ticketNumber,
            threadId: run.threadId,
            skillRunId: run.skillRunId,
            sourceSkillRunId: action.sourceSkillRunId,
            status:
              ticket?.classification === "out-of-scope"
                ? ("out-of-scope" as const)
                : ticket?.state === "closed"
                  ? ("resolved" as const)
                  : ("active" as const),
          },
        ];
      })
      .sort(
        (left, right) =>
          left.ticketNumber - right.ticketNumber ||
          left.threadId.localeCompare(right.threadId) ||
          left.skillRunId.localeCompare(right.skillRunId),
      );
    const ticketNumberByThreadId = new Map(
      ticketThreads.map((ticketThread) => [ticketThread.threadId, ticketThread.ticketNumber]),
    );
    const activeLinkedTicketNumbers = threads.flatMap((thread) => {
      const ticketNumber = ticketNumberByThreadId.get(thread.id);
      const active =
        thread.latestTurn?.state === "running" ||
        thread.session?.status === "starting" ||
        thread.session?.status === "running";
      return ticketNumber !== undefined && active ? [ticketNumber] : [];
    });
    const readiness = deriveWayfinderReadiness({
      map: wayfinderMap,
      synchronization: wayfinderSynchronization,
      activeLinkedTicketNumbers,
    });
    return {
      id,
      projectId,
      status: readiness.ready ? ("completed" as const) : ("active" as const),
      linkedThreadIds: Array.from(workstream.linkedThreadIds).sort(),
      ticketThreads,
      skillRuns: sortedRuns,
      wayfinderMap,
      wayfinderSynchronization,
      readiness,
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

export function findWayfinderReconciliationInvocation(
  workstream: ProjectSkillWorkstream | null,
  fallback: SkillInvocation | null,
): SkillInvocation | null {
  const mapRuns = workstream?.skillRuns.filter(isWayfinderMapInvocation) ?? [];
  const canonicalMapRuns = mapRuns.filter((run) => run.action?.id !== "work-ticket");
  return (
    (canonicalMapRuns.length > 0 ? canonicalMapRuns : mapRuns).sort(
      (left, right) =>
        mapSynchronizationTime(right).localeCompare(mapSynchronizationTime(left)) ||
        right.createdAt.localeCompare(left.createdAt) ||
        right.skillRunId.localeCompare(left.skillRunId),
    )[0] ?? (fallback?.wayfinderMap && fallback.action?.id !== "work-ticket" ? fallback : null)
  );
}

export function deriveEnvironmentWorkstreams(
  environmentId: EnvironmentId,
  skillRuns: ReadonlyArray<SkillInvocation>,
  threads: ReadonlyArray<OrchestrationThreadShell> = [],
): ReadonlyArray<EnvironmentProjectSkillWorkstream> {
  const projectIds = [...new Set(skillRuns.map((run) => run.projectId))].sort();
  return projectIds.flatMap((projectId) =>
    deriveProjectWorkstreams(projectId, skillRuns, threads).map((workstream) => ({
      ...workstream,
      environmentId,
    })),
  );
}
