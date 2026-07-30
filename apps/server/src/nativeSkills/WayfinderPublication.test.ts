import { assert, it } from "@effect/vitest";
import { IsoDateTime } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { IssueTrackerIssue, IssueTrackerRepository } from "./IssueTracker.ts";
import { publishWayfinderDraft, type WayfinderPublicationTracker } from "./WayfinderPublication.ts";

const repository: IssueTrackerRepository = {
  canonicalKey: "github.com/t3tools/t3code",
  owner: "t3tools",
  name: "t3code",
};

const draft = {
  authority: "unpublished-draft" as const,
  canonical: false as const,
  destination: "Choose a release plan.",
  notes: ["Keep the first slice small."],
  confirmedDecisions: [],
  proposedDecisions: [],
  candidateTickets: [
    {
      id: "research-hosting",
      title: "Research hosting limits",
      classification: "research" as const,
    },
    { id: "choose-target", title: "Choose the deployment target" },
  ],
  fogOfWar: [{ id: "owners", title: "Deployment ownership is unclear" }],
  outOfScope: [{ id: "shipping", title: "Shipping the release" }],
  proposedDependencyEdges: [{ from: "research-hosting", to: "choose-target" }],
  decisionReceipts: [],
  updatedAt: IsoDateTime.make("2026-07-30T10:00:00.000Z"),
};

class TrackerFailure extends Schema.TaggedErrorClass<TrackerFailure>()("TrackerFailure", {
  message: Schema.String,
}) {}

function successfulTracker(log: string[]): WayfinderPublicationTracker<TrackerFailure> {
  const issues = new Map<string, IssueTrackerIssue>();
  let nextNumber = 42;
  return {
    ensureLabel: (input) =>
      Effect.sync(() => {
        log.push(`label:${input.name}`);
      }),
    createIssue: (input) =>
      Effect.sync(() => {
        log.push(`issue:${input.key}`);
        const issue = {
          number: nextNumber++,
          url: `https://github.com/t3tools/t3code/issues/${nextNumber - 1}`,
        };
        issues.set(input.key, issue);
        return issue;
      }),
    addChild: (input) =>
      Effect.sync(() => {
        log.push(`child:${input.parentNumber}:${input.childNumber}`);
      }),
    addBlockedBy: (input) =>
      Effect.sync(() => {
        log.push(`blocked:${input.blockedNumber}:${input.blockerNumber}`);
      }),
    loadWayfinderMap: () =>
      Effect.succeed({
        kind: "loaded" as const,
        map: {
          canonicalReference: {
            number: issues.get("map")!.number,
            title: "Choose a release plan.",
            url: issues.get("map")!.url,
            state: "open" as const,
          },
          destination: "Choose a release plan.",
          notes: "Keep the first slice small.",
          decisionsSoFar: [],
          fogOfWar: ["Deployment ownership is unclear"],
          outOfScope: ["Shipping the release"],
          tickets: [
            {
              number: issues.get("ticket:research-hosting")!.number,
              title: "Research hosting limits",
              url: issues.get("ticket:research-hosting")!.url,
              state: "open" as const,
              classification: "research" as const,
              claimedBy: null,
              blockedBy: [],
              blocks: [issues.get("ticket:choose-target")!.number],
            },
            {
              number: issues.get("ticket:choose-target")!.number,
              title: "Choose the deployment target",
              url: issues.get("ticket:choose-target")!.url,
              state: "open" as const,
              classification: "task" as const,
              claimedBy: null,
              blockedBy: [issues.get("ticket:research-hosting")!.number],
              blocks: [],
            },
          ],
          frontier: [issues.get("ticket:research-hosting")!.number],
          lastSynchronizedAt: IsoDateTime.make("2026-07-30T10:05:00.000Z"),
        },
      }),
  };
}

it.effect("publishes labels, issues, children, and blockers in dependency-safe order", () =>
  Effect.gen(function* () {
    const writes: string[] = [];
    const receipts: string[] = [];
    const result = yield* publishWayfinderDraft(
      {
        cwd: "/project",
        repository,
        draft,
        synchronizedAt: IsoDateTime.make("2026-07-30T10:05:00.000Z"),
      },
      {
        tracker: successfulTracker(writes),
        onProgress: (progress) =>
          Effect.sync(() => {
            receipts.push(`${progress.status}:${progress.nextStep ?? "complete"}`);
          }),
      },
    );

    assert.strictEqual(result.status, "synchronized");
    assert.deepStrictEqual(writes, [
      "label:wayfinder:map",
      "label:wayfinder:decision",
      "label:wayfinder:research",
      "label:wayfinder:task",
      "issue:map",
      "issue:ticket:research-hosting",
      "issue:ticket:choose-target",
      "child:42:43",
      "child:42:44",
      "blocked:44:43",
    ]);
    assert.strictEqual(receipts.at(-1), "synchronized:complete");
  }),
);

it.effect("resumes after a partial failure without duplicating verified artifacts", () =>
  Effect.gen(function* () {
    const firstWrites: string[] = [];
    const tracker = successfulTracker(firstWrites);
    let failed = false;
    const first = yield* publishWayfinderDraft(
      {
        cwd: "/project",
        repository,
        draft,
        synchronizedAt: IsoDateTime.make("2026-07-30T10:05:00.000Z"),
      },
      {
        tracker: {
          ...tracker,
          addChild: (input) =>
            !failed
              ? Effect.sync(() => {
                  failed = true;
                }).pipe(
                  Effect.flatMap(
                    () =>
                      new TrackerFailure({
                        message: `relationship ${input.childNumber} unavailable`,
                      }),
                  ),
                )
              : tracker.addChild(input),
        },
        onProgress: () => Effect.void,
      },
    );

    assert.strictEqual(first.status, "failed");
    assert.strictEqual(first.nextStep, "link child ticket research-hosting");

    const resumeWrites: string[] = [];
    const resumed = yield* publishWayfinderDraft(
      {
        cwd: "/project",
        repository,
        draft,
        synchronizedAt: IsoDateTime.make("2026-07-30T10:06:00.000Z"),
        previous: first,
      },
      {
        tracker: {
          ...tracker,
          addChild: (input) =>
            Effect.sync(() => {
              resumeWrites.push(`child:${input.parentNumber}:${input.childNumber}`);
            }),
          addBlockedBy: (input) =>
            Effect.sync(() => {
              resumeWrites.push(`blocked:${input.blockedNumber}:${input.blockerNumber}`);
            }),
        },
        onProgress: () => Effect.void,
      },
    );

    assert.strictEqual(resumed.status, "synchronized");
    assert.deepStrictEqual(resumeWrites, ["child:42:43", "child:42:44", "blocked:44:43"]);
  }),
);

it.effect("rejects a cyclic dependency graph before the first tracker write", () =>
  Effect.gen(function* () {
    const writes: string[] = [];
    const result = yield* publishWayfinderDraft(
      {
        cwd: "/project",
        repository,
        draft: {
          ...draft,
          proposedDependencyEdges: [
            { from: "research-hosting", to: "choose-target" },
            { from: "choose-target", to: "research-hosting" },
          ],
        },
        synchronizedAt: IsoDateTime.make("2026-07-30T10:05:00.000Z"),
      },
      {
        tracker: successfulTracker(writes),
        onProgress: () => Effect.void,
      },
    );

    assert.strictEqual(result.status, "failed");
    assert.strictEqual(result.nextStep, "validate draft dependency graph");
    assert.deepStrictEqual(writes, []);
  }),
);

it.effect("resumes idempotently from every tracker write boundary", () =>
  Effect.gen(function* () {
    const writeCount = 10;
    for (let failureIndex = 0; failureIndex < writeCount; failureIndex += 1) {
      const writes: string[] = [];
      const tracker = successfulTracker(writes);
      let currentWrite = 0;
      const failAtBoundary = <A>(
        description: string,
        effect: Effect.Effect<A, TrackerFailure>,
      ): Effect.Effect<A, TrackerFailure> =>
        currentWrite++ === failureIndex
          ? Effect.fail(new TrackerFailure({ message: `${description} unavailable` }))
          : effect;
      const failingTracker: WayfinderPublicationTracker<TrackerFailure> = {
        ensureLabel: (input) => failAtBoundary(`label ${input.name}`, tracker.ensureLabel(input)),
        createIssue: (input) => failAtBoundary(`issue ${input.key}`, tracker.createIssue(input)),
        addChild: (input) => failAtBoundary(`child ${input.childNumber}`, tracker.addChild(input)),
        addBlockedBy: (input) =>
          failAtBoundary(`blocker ${input.blockerNumber}`, tracker.addBlockedBy(input)),
        loadWayfinderMap: tracker.loadWayfinderMap,
      };

      const failed = yield* publishWayfinderDraft(
        {
          cwd: "/project",
          repository,
          draft,
          synchronizedAt: IsoDateTime.make("2026-07-30T10:05:00.000Z"),
        },
        { tracker: failingTracker, onProgress: () => Effect.void },
      );
      assert.strictEqual(failed.status, "failed");
      assert.strictEqual(failed.artifacts.length, failureIndex);
      assert.isNotNull(failed.nextStep);
      const verifiedWrites = [...writes];

      const resumed = yield* publishWayfinderDraft(
        {
          cwd: "/project",
          repository,
          draft,
          synchronizedAt: IsoDateTime.make("2026-07-30T10:06:00.000Z"),
          previous: failed,
        },
        { tracker, onProgress: () => Effect.void },
      );
      assert.strictEqual(resumed.status, "synchronized");
      assert.deepStrictEqual(writes.slice(0, verifiedWrites.length), verifiedWrites);
      assert.strictEqual(writes.length, writeCount);
    }
  }),
);

it.effect("keeps all artifacts when reconciliation fails and retries only reconciliation", () =>
  Effect.gen(function* () {
    const writes: string[] = [];
    const tracker = successfulTracker(writes);
    const failed = yield* publishWayfinderDraft(
      {
        cwd: "/project",
        repository,
        draft,
        synchronizedAt: IsoDateTime.make("2026-07-30T10:05:00.000Z"),
      },
      {
        tracker: {
          ...tracker,
          loadWayfinderMap: () => Effect.succeed({ kind: "not-wayfinder-map" as const }),
        },
        onProgress: () => Effect.void,
      },
    );
    assert.strictEqual(failed.status, "failed");
    assert.strictEqual(failed.artifacts.length, 10);
    assert.strictEqual(failed.nextStep, "reconcile canonical map");

    const writesBeforeResume = [...writes];
    const resumed = yield* publishWayfinderDraft(
      {
        cwd: "/project",
        repository,
        draft,
        synchronizedAt: IsoDateTime.make("2026-07-30T10:06:00.000Z"),
        previous: failed,
      },
      { tracker, onProgress: () => Effect.void },
    );
    assert.strictEqual(resumed.status, "synchronized");
    assert.deepStrictEqual(writes, writesBeforeResume);
  }),
);
