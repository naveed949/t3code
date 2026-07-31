import type {
  EnvironmentId,
  OrchestrationShellSnapshot,
  OrchestrationThreadShell,
  ProjectId,
  SkillInvocation,
  ScopedProjectRef,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentThreadShell } from "./models.ts";
import { scopeThreadShell } from "./models.ts";
import type { EnvironmentCatalogState } from "./connections.ts";
import {
  arrayElementsEqual,
  parseProjectRefCollectionKey,
  parseProjectKey,
  projectKey,
  parseThreadKey,
  projectRefCollectionKey,
  threadKey,
  threadRefsEqual,
} from "./entities.ts";
import { deriveEnvironmentWorkstreams, deriveProjectWorkstreams } from "./skillRuns.ts";

const EMPTY_THREADS: ReadonlyArray<OrchestrationThreadShell> = Object.freeze([]);
const EMPTY_SKILL_RUNS: ReadonlyArray<SkillInvocation> = Object.freeze([]);
const EMPTY_SCOPED_THREAD_REFS: ReadonlyArray<ScopedThreadRef> = Object.freeze([]);
const EMPTY_THREAD_INDEX: ReadonlyMap<ThreadId, OrchestrationThreadShell> = new Map();
const EMPTY_THREAD_REFS_BY_PROJECT: ReadonlyMap<
  ProjectId,
  ReadonlyArray<ScopedThreadRef>
> = new Map();

export function createEnvironmentThreadShellAtoms(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly snapshotAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<OrchestrationShellSnapshot | null>;
}) {
  const environmentThreadsAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make(
      (get): ReadonlyArray<OrchestrationThreadShell> =>
        get(input.snapshotAtom(environmentId))?.threads ?? EMPTY_THREADS,
    ).pipe(Atom.withLabel(`environment-threads:${environmentId}`)),
  );

  const environmentSkillRunsAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make(
      (get): ReadonlyArray<SkillInvocation> =>
        get(input.snapshotAtom(environmentId))?.skillRuns ?? EMPTY_SKILL_RUNS,
    ).pipe(Atom.withLabel(`environment-skill-runs:${environmentId}`)),
  );

  const projectWorkstreamsAtomFamily = Atom.family((key: string) => {
    const projectRef = parseProjectKey(key);
    let previousRuns: ReadonlyArray<SkillInvocation> = EMPTY_SKILL_RUNS;
    let previousThreads: ReadonlyArray<OrchestrationThreadShell> = EMPTY_THREADS;
    let previousWorkstreams = deriveProjectWorkstreams(
      projectRef.projectId,
      previousRuns,
      previousThreads,
    );
    return Atom.make((get) => {
      const runs = get(environmentSkillRunsAtom(projectRef.environmentId));
      const threads = get(environmentThreadsAtom(projectRef.environmentId)).filter(
        (thread) => thread.projectId === projectRef.projectId,
      );
      if (arrayElementsEqual(previousRuns, runs) && arrayElementsEqual(previousThreads, threads)) {
        return previousWorkstreams;
      }
      previousRuns = runs;
      previousThreads = threads;
      previousWorkstreams = deriveProjectWorkstreams(projectRef.projectId, runs, threads);
      return previousWorkstreams;
    }).pipe(Atom.withLabel(`project-workstreams:${key}`));
  });

  const environmentThreadIndexAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get): ReadonlyMap<ThreadId, OrchestrationThreadShell> => {
      const threads = get(environmentThreadsAtom(environmentId));
      if (threads.length === 0) {
        return EMPTY_THREAD_INDEX;
      }
      return new Map(threads.map((thread) => [thread.id, thread] as const));
    }).pipe(Atom.withLabel(`environment-thread-index:${environmentId}`)),
  );

  const environmentThreadRefsAtom = Atom.family((environmentId: EnvironmentId) => {
    let previous: ReadonlyArray<ScopedThreadRef> = [];
    return Atom.make((get) => {
      const next = get(environmentThreadsAtom(environmentId)).map((thread) => ({
        environmentId,
        threadId: thread.id,
      }));
      if (threadRefsEqual(previous, next)) {
        return previous;
      }
      previous = next;
      return next;
    }).pipe(Atom.withLabel(`environment-thread-refs:${environmentId}`));
  });

  const environmentThreadRefsByProjectAtom = Atom.family((environmentId: EnvironmentId) => {
    let previous: ReadonlyMap<
      ProjectId,
      ReadonlyArray<ScopedThreadRef>
    > = EMPTY_THREAD_REFS_BY_PROJECT;
    return Atom.make((get) => {
      const grouped = new Map<ProjectId, ScopedThreadRef[]>();
      for (const thread of get(environmentThreadsAtom(environmentId))) {
        const refs = grouped.get(thread.projectId);
        const ref = { environmentId, threadId: thread.id };
        if (refs === undefined) {
          grouped.set(thread.projectId, [ref]);
        } else {
          refs.push(ref);
        }
      }
      if (grouped.size === 0) {
        previous = EMPTY_THREAD_REFS_BY_PROJECT;
        return previous;
      }
      const next = new Map<ProjectId, ReadonlyArray<ScopedThreadRef>>();
      for (const [projectId, refs] of grouped) {
        const previousRefs = previous.get(projectId);
        next.set(
          projectId,
          previousRefs !== undefined && threadRefsEqual(previousRefs, refs) ? previousRefs : refs,
        );
      }
      previous = next;
      return previous;
    }).pipe(Atom.withLabel(`environment-thread-refs-by-project:${environmentId}`));
  });

  const threadShellAtomFamily = Atom.family((key: string) => {
    const ref = parseThreadKey(key);
    let previousSource: OrchestrationThreadShell | null = null;
    let previousValue: EnvironmentThreadShell | null = null;
    return Atom.make((get) => {
      const source = get(environmentThreadIndexAtom(ref.environmentId)).get(ref.threadId) ?? null;
      if (source === previousSource) {
        return previousValue;
      }
      previousSource = source;
      previousValue = source === null ? null : scopeThreadShell(ref.environmentId, source);
      return previousValue;
    }).pipe(Atom.withLabel(`environment-thread-shell:${key}`));
  });

  const threadShellsForProjectRefsAtomFamily = Atom.family((key: string) => {
    const projectRefs = parseProjectRefCollectionKey(key);
    let previous: ReadonlyArray<EnvironmentThreadShell> = [];
    return Atom.make((get) => {
      const next: EnvironmentThreadShell[] = [];
      const seen = new Set<string>();
      for (const projectRef of projectRefs) {
        const refs =
          get(environmentThreadRefsByProjectAtom(projectRef.environmentId)).get(
            projectRef.projectId,
          ) ?? EMPTY_SCOPED_THREAD_REFS;
        for (const ref of refs) {
          const key = threadKey(ref);
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          const thread = get(threadShellAtomFamily(key));
          if (thread !== null) {
            next.push(thread);
          }
        }
      }
      if (arrayElementsEqual(previous, next)) {
        return previous;
      }
      previous = next;
      return previous;
    }).pipe(Atom.withLabel(`environment-thread-shells-for-projects:${key}`));
  });

  let previousThreadRefs: ReadonlyArray<ScopedThreadRef> = [];
  const threadRefsAtom = Atom.make((get) => {
    const refs: ScopedThreadRef[] = [];
    for (const environmentId of get(input.catalogValueAtom).entries.keys()) {
      refs.push(...get(environmentThreadRefsAtom(environmentId)));
    }
    if (threadRefsEqual(previousThreadRefs, refs)) {
      return previousThreadRefs;
    }
    previousThreadRefs = refs;
    return refs;
  }).pipe(Atom.withLabel("environment-thread-refs"));

  let previousWorkstreamEnvironmentIds: ReadonlyArray<EnvironmentId> = [];
  let previousRunsByEnvironment = new Map<EnvironmentId, ReadonlyArray<SkillInvocation>>();
  let previousThreadsByEnvironment = new Map<
    EnvironmentId,
    ReadonlyArray<OrchestrationThreadShell>
  >();
  let previousWorkstreams: ReturnType<typeof deriveEnvironmentWorkstreams> = [];
  const workstreamsAtom = Atom.make((get) => {
    const environmentIds = [...get(input.catalogValueAtom).entries.keys()];
    const runsByEnvironment = new Map(
      environmentIds.map(
        (environmentId) => [environmentId, get(environmentSkillRunsAtom(environmentId))] as const,
      ),
    );
    const threadsByEnvironment = new Map(
      environmentIds.map(
        (environmentId) => [environmentId, get(environmentThreadsAtom(environmentId))] as const,
      ),
    );
    const unchanged =
      arrayElementsEqual(previousWorkstreamEnvironmentIds, environmentIds) &&
      environmentIds.every((environmentId) =>
        arrayElementsEqual(
          previousRunsByEnvironment.get(environmentId) ?? EMPTY_SKILL_RUNS,
          runsByEnvironment.get(environmentId) ?? EMPTY_SKILL_RUNS,
        ),
      ) &&
      environmentIds.every((environmentId) =>
        arrayElementsEqual(
          previousThreadsByEnvironment.get(environmentId) ?? EMPTY_THREADS,
          threadsByEnvironment.get(environmentId) ?? EMPTY_THREADS,
        ),
      );
    if (unchanged) return previousWorkstreams;
    previousWorkstreamEnvironmentIds = environmentIds;
    previousRunsByEnvironment = runsByEnvironment;
    previousThreadsByEnvironment = threadsByEnvironment;
    previousWorkstreams = environmentIds.flatMap((environmentId) =>
      deriveEnvironmentWorkstreams(
        environmentId,
        runsByEnvironment.get(environmentId) ?? EMPTY_SKILL_RUNS,
        threadsByEnvironment.get(environmentId) ?? EMPTY_THREADS,
      ),
    );
    return previousWorkstreams;
  }).pipe(Atom.withLabel("environment-project-workstreams"));

  let previousThreadShells: ReadonlyArray<EnvironmentThreadShell> = [];
  const threadShellsAtom = Atom.make((get) => {
    const next = get(threadRefsAtom).flatMap((ref) => {
      const thread = get(threadShellAtomFamily(threadKey(ref)));
      return thread === null ? [] : [thread];
    });
    if (arrayElementsEqual(previousThreadShells, next)) {
      return previousThreadShells;
    }
    previousThreadShells = next;
    return previousThreadShells;
  }).pipe(Atom.withLabel("environment-thread-shell-list"));

  return {
    environmentThreadsAtom,
    environmentSkillRunsAtom,
    environmentThreadIndexAtom,
    environmentThreadRefsAtom,
    environmentThreadRefsByProjectAtom,
    threadRefsAtom,
    workstreamsAtom,
    threadShellsAtom,
    threadShellsForProjectRefsAtom: (refs: ReadonlyArray<ScopedProjectRef>) =>
      threadShellsForProjectRefsAtomFamily(projectRefCollectionKey(refs)),
    projectWorkstreamsAtom: (ref: ScopedProjectRef) =>
      projectWorkstreamsAtomFamily(projectKey(ref)),
    threadShellAtom: (ref: ScopedThreadRef) => threadShellAtomFamily(threadKey(ref)),
  };
}
