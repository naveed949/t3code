import type {
  WayfinderDraft,
  WayfinderMapProjection,
  WayfinderPublication as StoredWayfinderPublication,
  WayfinderPublicationArtifact,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import type {
  IssueTrackerIssue,
  IssueTrackerRepository,
  WayfinderMapLoadResult,
} from "./IssueTracker.ts";

export interface WayfinderPublicationProgress extends StoredWayfinderPublication {
  readonly status: "publishing" | "failed" | "synchronized";
  readonly map?: WayfinderMapProjection;
}

export interface WayfinderPublicationTracker<ErrorType = never> {
  readonly ensureLabel: (input: {
    readonly cwd: string;
    readonly repository: IssueTrackerRepository;
    readonly name: string;
  }) => Effect.Effect<void, ErrorType>;
  readonly createIssue: (input: {
    readonly cwd: string;
    readonly repository: IssueTrackerRepository;
    readonly key: string;
    readonly idempotencyKey: string;
    readonly title: string;
    readonly body: string;
    readonly labels: ReadonlyArray<string>;
  }) => Effect.Effect<IssueTrackerIssue, ErrorType>;
  readonly addChild: (input: {
    readonly cwd: string;
    readonly repository: IssueTrackerRepository;
    readonly parentNumber: number;
    readonly childNumber: number;
  }) => Effect.Effect<void, ErrorType>;
  readonly addBlockedBy: (input: {
    readonly cwd: string;
    readonly repository: IssueTrackerRepository;
    readonly blockedNumber: number;
    readonly blockerNumber: number;
  }) => Effect.Effect<void, ErrorType>;
  readonly loadWayfinderMap: (input: {
    readonly cwd: string;
    readonly repository: IssueTrackerRepository;
    readonly issueNumber: number;
    readonly synchronizedAt: string;
  }) => Effect.Effect<WayfinderMapLoadResult, ErrorType>;
}

interface PublishInput {
  readonly cwd: string;
  readonly repository: IssueTrackerRepository;
  readonly draft: WayfinderDraft;
  readonly synchronizedAt: string;
  readonly publicationKey?: string;
  readonly previous?: StoredWayfinderPublication;
}

interface PublishDependencies<TrackerError, ProgressError> {
  readonly tracker: WayfinderPublicationTracker<TrackerError>;
  readonly onProgress: (
    progress: WayfinderPublicationProgress,
  ) => Effect.Effect<void, ProgressError>;
}

interface PublicationStep<ErrorType> {
  readonly key: string;
  readonly description: string;
  readonly run: (
    artifacts: ReadonlyArray<WayfinderPublicationArtifact>,
  ) => Effect.Effect<WayfinderPublicationArtifact, ErrorType>;
}

function topologicallySortedTicketIds(draft: WayfinderDraft): ReadonlyArray<string> | null {
  const order = new Map(draft.candidateTickets.map((ticket, index) => [ticket.id, index] as const));
  const incoming = new Map<string, number>(
    draft.candidateTickets.map((ticket) => [ticket.id, 0] as const),
  );
  const outgoing = new Map(
    draft.candidateTickets.map((ticket) => [ticket.id, [] as string[]] as const),
  );
  for (const edge of draft.proposedDependencyEdges) {
    if (!incoming.has(edge.from) || !incoming.has(edge.to)) continue;
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }
  const ready = [...incoming.entries()]
    .filter(([, count]) => count === 0)
    .map(([id]) => id)
    .sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
  const sorted: string[] = [];
  while (ready.length > 0) {
    const current = ready.shift()!;
    sorted.push(current);
    for (const next of outgoing.get(current) ?? []) {
      const count = (incoming.get(next) ?? 1) - 1;
      incoming.set(next, count);
      if (count === 0) {
        ready.push(next);
        ready.sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
      }
    }
  }
  return sorted.length === draft.candidateTickets.length ? sorted : null;
}

function draftGraphError(draft: WayfinderDraft): string | null {
  const ticketIds = new Set<string>();
  for (const ticket of draft.candidateTickets) {
    if (ticketIds.has(ticket.id)) return `Decision ticket id '${ticket.id}' is duplicated.`;
    ticketIds.add(ticket.id);
  }
  for (const edge of draft.proposedDependencyEdges) {
    if (!ticketIds.has(edge.from) || !ticketIds.has(edge.to)) {
      return `Dependency '${edge.from} -> ${edge.to}' references an unknown decision ticket.`;
    }
  }
  return topologicallySortedTicketIds(draft) === null
    ? "The decision dependency graph contains a cycle."
    : null;
}

function issueArtifact(
  artifacts: ReadonlyArray<WayfinderPublicationArtifact>,
  key: string,
): Extract<WayfinderPublicationArtifact, { readonly kind: "issue" }> | undefined {
  return artifacts.find(
    (artifact): artifact is Extract<WayfinderPublicationArtifact, { readonly kind: "issue" }> =>
      artifact.kind === "issue" && artifact.key === key,
  );
}

function renderMapBody(draft: WayfinderDraft): string {
  const list = (items: ReadonlyArray<string>, empty: string) =>
    items.length === 0 ? empty : items.map((item) => `- ${item}`).join("\n");
  return [
    "## Destination",
    "",
    draft.destination ?? "",
    "",
    "## Notes",
    "",
    draft.notes.join("\n"),
    "",
    "## Decisions so far",
    "",
    list(
      draft.confirmedDecisions.map((decision) => `${decision.question}: ${decision.answer}`),
      "No decisions recorded.",
    ),
    "",
    "## Not yet specified",
    "",
    list(
      draft.fogOfWar.map((item) => item.title),
      "Nothing recorded.",
    ),
    "",
    "## Out of scope",
    "",
    list(
      draft.outOfScope.map((item) => item.title),
      "Nothing recorded.",
    ),
  ].join("\n");
}

function buildSteps<ErrorType>(
  input: PublishInput,
  tracker: WayfinderPublicationTracker<ErrorType>,
): PublicationStep<ErrorType>[] {
  const ticketById = new Map(input.draft.candidateTickets.map((ticket) => [ticket.id, ticket]));
  const publicationKey = input.publicationKey ?? input.draft.updatedAt;
  const ticketIds = topologicallySortedTicketIds(input.draft) ?? [];
  const classificationForTicket = (ticketId: string) =>
    ticketById.get(ticketId)?.classification ?? "task";
  const classifications = [...new Set(ticketIds.map(classificationForTicket))].sort();
  const steps: PublicationStep<ErrorType>[] = [
    ...[
      "wayfinder:map",
      "wayfinder:decision",
      ...classifications.map((value) => `wayfinder:${value}`),
    ].map(
      (name): PublicationStep<ErrorType> => ({
        key: `label:${name}`,
        description: `create label ${name}`,
        run: () =>
          tracker
            .ensureLabel({
              cwd: input.cwd,
              repository: input.repository,
              name,
            })
            .pipe(Effect.as({ kind: "label" as const, name })),
      }),
    ),
    {
      key: "issue:map",
      description: "create canonical map issue",
      run: () =>
        tracker
          .createIssue({
            cwd: input.cwd,
            repository: input.repository,
            key: "map",
            idempotencyKey: `${publicationKey}:map`,
            title: input.draft.destination ?? "Wayfinder map",
            body: renderMapBody(input.draft),
            labels: ["wayfinder:map"],
          })
          .pipe(
            Effect.map((issue) => ({
              kind: "issue" as const,
              key: "map",
              ...issue,
            })),
          ),
    },
    ...ticketIds.map((ticketId): PublicationStep<ErrorType> => {
      const ticket = ticketById.get(ticketId)!;
      return {
        key: `issue:ticket:${ticketId}`,
        description: `create decision ticket ${ticketId}`,
        run: () =>
          tracker
            .createIssue({
              cwd: input.cwd,
              repository: input.repository,
              key: `ticket:${ticketId}`,
              idempotencyKey: `${publicationKey}:ticket:${ticketId}`,
              title: ticket.title,
              body:
                ticket.detail ?? `Decision ticket for ${input.draft.destination ?? "Wayfinder"}.`,
              labels: ["wayfinder:decision", `wayfinder:${classificationForTicket(ticketId)}`],
            })
            .pipe(
              Effect.map((issue) => ({
                kind: "issue" as const,
                key: `ticket:${ticketId}`,
                ...issue,
              })),
            ),
      };
    }),
    ...ticketIds.map(
      (ticketId): PublicationStep<ErrorType> => ({
        key: `child:${ticketId}`,
        description: `link child ticket ${ticketId}`,
        run: (artifacts) => {
          const map = issueArtifact(artifacts, "map")!;
          const ticket = issueArtifact(artifacts, `ticket:${ticketId}`)!;
          return tracker
            .addChild({
              cwd: input.cwd,
              repository: input.repository,
              parentNumber: map.number,
              childNumber: ticket.number,
            })
            .pipe(
              Effect.as({
                kind: "child" as const,
                key: ticketId,
                parentNumber: map.number,
                childNumber: ticket.number,
              }),
            );
        },
      }),
    ),
    ...input.draft.proposedDependencyEdges.map(
      (edge): PublicationStep<ErrorType> => ({
        key: `blocked-by:${edge.from}:${edge.to}`,
        description: `link dependency ${edge.from} -> ${edge.to}`,
        run: (artifacts) => {
          const blocker = issueArtifact(artifacts, `ticket:${edge.from}`)!;
          const blocked = issueArtifact(artifacts, `ticket:${edge.to}`)!;
          return tracker
            .addBlockedBy({
              cwd: input.cwd,
              repository: input.repository,
              blockedNumber: blocked.number,
              blockerNumber: blocker.number,
            })
            .pipe(
              Effect.as({
                kind: "blocked-by" as const,
                key: `${edge.from}:${edge.to}`,
                blockedNumber: blocked.number,
                blockerNumber: blocker.number,
              }),
            );
        },
      }),
    ),
  ];
  return steps;
}

function artifactStepKey(artifact: WayfinderPublicationArtifact): string {
  switch (artifact.kind) {
    case "label":
      return `label:${artifact.name}`;
    case "issue":
      return `issue:${artifact.key}`;
    case "child":
      return `child:${artifact.key}`;
    case "blocked-by":
      return `blocked-by:${artifact.key}`;
  }
}

function causeMessage<ErrorType>(cause: Cause.Cause<ErrorType>): string {
  const failure = Cause.findErrorOption(cause);
  return failure._tag === "Some" && failure.value instanceof globalThis.Error
    ? failure.value.message
    : Cause.pretty(cause);
}

function reconciliationError(
  map: WayfinderMapProjection,
  artifacts: ReadonlyArray<WayfinderPublicationArtifact>,
): string | null {
  const canonical = issueArtifact(artifacts, "map");
  if (!canonical || map.canonicalReference.number !== canonical.number) {
    return "Canonical map identity does not match the verified map issue.";
  }
  const ticketNumbers = new Set(map.tickets.map((ticket) => ticket.number));
  for (const artifact of artifacts) {
    if (
      artifact.kind === "issue" &&
      artifact.key.startsWith("ticket:") &&
      !ticketNumbers.has(artifact.number)
    ) {
      return `Decision ticket #${artifact.number} is missing from the canonical child graph.`;
    }
    if (artifact.kind === "child" && !ticketNumbers.has(artifact.childNumber)) {
      return `Child relationship for #${artifact.childNumber} is missing from the canonical graph.`;
    }
    if (artifact.kind === "blocked-by") {
      const blocked = map.tickets.find((ticket) => ticket.number === artifact.blockedNumber);
      if (!blocked?.blockedBy.includes(artifact.blockerNumber)) {
        return `Blocking relationship #${artifact.blockerNumber} -> #${artifact.blockedNumber} is missing from the canonical graph.`;
      }
    }
  }
  return null;
}

export const publishWayfinderDraft = Effect.fn("publishWayfinderDraft")(function* <
  TrackerError,
  ProgressError,
>(input: PublishInput, dependencies: PublishDependencies<TrackerError, ProgressError>) {
  const artifacts = [...(input.previous?.artifacts ?? [])];
  const invalidDraft = draftGraphError(input.draft);
  if (invalidDraft !== null) {
    const failed: WayfinderPublicationProgress = {
      status: "failed",
      artifacts,
      nextStep: "validate draft dependency graph",
      error: invalidDraft,
      updatedAt: input.synchronizedAt,
    };
    yield* dependencies.onProgress(failed);
    return failed;
  }
  const completed = new Set(artifacts.map(artifactStepKey));
  const steps = buildSteps(input, dependencies.tracker);

  for (const step of steps) {
    if (completed.has(step.key)) continue;
    const running: WayfinderPublicationProgress = {
      status: "publishing",
      artifacts: [...artifacts],
      nextStep: step.description,
      updatedAt: input.synchronizedAt,
    };
    yield* dependencies.onProgress(running);
    const exit = yield* Effect.exit(step.run(artifacts));
    if (Exit.isFailure(exit)) {
      const failed: WayfinderPublicationProgress = {
        status: "failed",
        artifacts: [...artifacts],
        nextStep: step.description,
        error: causeMessage(exit.cause),
        updatedAt: input.synchronizedAt,
      };
      yield* dependencies.onProgress(failed);
      return failed;
    }
    artifacts.push(exit.value);
    completed.add(step.key);
    yield* dependencies.onProgress({
      status: "publishing",
      artifacts: [...artifacts],
      nextStep:
        steps.find((candidate) => !completed.has(candidate.key))?.description ?? "reconcile",
      updatedAt: input.synchronizedAt,
    });
  }

  const mapIssue = issueArtifact(artifacts, "map")!;
  const reconciliation = yield* Effect.exit(
    dependencies.tracker.loadWayfinderMap({
      cwd: input.cwd,
      repository: input.repository,
      issueNumber: mapIssue.number,
      synchronizedAt: input.synchronizedAt,
    }),
  );
  if (Exit.isFailure(reconciliation) || reconciliation.value.kind !== "loaded") {
    const failed: WayfinderPublicationProgress = {
      status: "failed",
      artifacts,
      nextStep: "reconcile canonical map",
      error: Exit.isFailure(reconciliation)
        ? causeMessage(reconciliation.cause)
        : `GitHub returned ${reconciliation.value.kind}`,
      updatedAt: input.synchronizedAt,
    };
    yield* dependencies.onProgress(failed);
    return failed;
  }
  const mismatch = reconciliationError(reconciliation.value.map, artifacts);
  if (mismatch !== null) {
    const failed: WayfinderPublicationProgress = {
      status: "failed",
      artifacts,
      nextStep: "reconcile canonical map",
      error: mismatch,
      updatedAt: input.synchronizedAt,
    };
    yield* dependencies.onProgress(failed);
    return failed;
  }

  const synchronized: WayfinderPublicationProgress = {
    status: "synchronized",
    artifacts,
    nextStep: null,
    map: reconciliation.value.map,
    updatedAt: input.synchronizedAt,
  };
  yield* dependencies.onProgress(synchronized);
  return synchronized;
});
