import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  SkillRunId,
  ThreadId,
  WorkstreamId,
  type OrchestrationCommand,
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
  type ServerProvider,
  type WayfinderSynchronizationState,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { dispatchWithNativeWayfinderPreflight } from "./WayfinderDispatchGate.ts";
import { VERIFIED_WAYFINDER_CONTENT_DIGEST } from "./WayfinderCompatibility.ts";
import type { WayfinderPreflightResult } from "./WayfinderPreflight.ts";

const projectId = ProjectId.make("project:wayfinder");
const threadId = ThreadId.make("thread:wayfinder");
const instanceId = ProviderInstanceId.make("codex-default");
const modelSelection = { instanceId, model: "gpt-5" };
const provider = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  skills: [],
} as unknown as ServerProvider;
const command: Extract<OrchestrationCommand, { readonly type: "thread.turn.start" }> = {
  type: "thread.turn.start",
  commandId: CommandId.make("command:wayfinder"),
  threadId,
  message: {
    messageId: MessageId.make("message:wayfinder"),
    role: "user",
    text: "$wayfinder",
    attachments: [],
  },
  modelSelection,
  runtimeMode: "full-access",
  interactionMode: "default",
  skillInvocation: {
    skill: {
      name: "wayfinder",
      path: "/skills/wayfinder/SKILL.md",
      contentDigest: VERIFIED_WAYFINDER_CONTENT_DIGEST,
    },
    action: { id: "new-map" },
    execution: { mode: "native", adapterId: "wayfinder", adapterVersion: 1 },
  },
  createdAt: "2026-07-30T00:00:00.000Z",
} as Extract<OrchestrationCommand, { readonly type: "thread.turn.start" }>;

const dependencies = (check: () => Effect.Effect<WayfinderPreflightResult>) => ({
  providers: [provider],
  getThread: () =>
    Effect.succeed(
      Option.some({
        projectId,
        modelSelection,
        worktreePath: null,
      } as unknown as OrchestrationThreadShell),
    ),
  getProject: () =>
    Effect.succeed(
      Option.some({ workspaceRoot: "/project" } as unknown as OrchestrationProjectShell),
    ),
  getSkillRuns: () => Effect.succeed([]),
  markWayfinderUnavailable: () => Effect.void,
  check,
});

it.effect("dispatches native Wayfinder for ready Codex and Claude environments", () =>
  Effect.gen(function* () {
    for (const driver of ["codex", "claudeAgent"] as const) {
      let dispatches = 0;
      const providers = [{ ...provider, driver: ProviderDriverKind.make(driver) }];
      yield* dispatchWithNativeWayfinderPreflight({
        command,
        dependencies: { ...dependencies(() => Effect.succeed({ kind: "ready" })), providers },
        dispatch: () => Effect.sync(() => dispatches++),
      });
      assert.strictEqual(dispatches, 1);
    }
  }),
);

it.effect("dispatches a continuation with its synchronized read-only map projection", () =>
  Effect.gen(function* () {
    const continuation = {
      ...command,
      skillInvocation: {
        ...command.skillInvocation!,
        action: { id: "continue-map" as const, reference: "42" },
      },
    };
    const wayfinderMap = {
      canonicalReference: {
        number: 42,
        title: "Choose the release shape",
        url: "https://github.com/t3tools/t3code/issues/42",
        state: "open" as const,
      },
      destination: "A release plan ready for specification.",
      notes: "",
      decisionsSoFar: [],
      fogOfWar: [],
      outOfScope: [],
      tickets: [],
      frontier: [],
      lastSynchronizedAt: "2026-07-30T00:00:00.000Z",
    };
    const dispatched = yield* dispatchWithNativeWayfinderPreflight({
      command: continuation,
      dependencies: dependencies(() => Effect.succeed({ kind: "ready", wayfinderMap })),
      dispatch: Effect.succeed,
    });
    assert.deepStrictEqual(
      dispatched.type === "thread.turn.start" ? dispatched.skillInvocation?.wayfinderMap : null,
      wayfinderMap,
    );
    assert.strictEqual(
      dispatched.type === "thread.turn.start"
        ? dispatched.skillInvocation?.wayfinderSynchronizedAt
        : null,
      wayfinderMap.lastSynchronizedAt,
    );
  }),
);

it.effect("reconnects a known canonical map to its project Workstream", () =>
  Effect.gen(function* () {
    const wayfinderMap = {
      canonicalReference: {
        number: 42,
        title: "Choose the release shape",
        url: "https://github.com/t3tools/t3code/issues/42",
        state: "open" as const,
      },
      destination: "A release plan.",
      notes: "",
      decisionsSoFar: [],
      fogOfWar: [],
      outOfScope: [],
      tickets: [],
      frontier: [],
      lastSynchronizedAt: "2026-07-30T00:00:00.000Z",
    };
    const reconnectWorkstreamId = WorkstreamId.make("workstream:existing");
    const dispatched = yield* dispatchWithNativeWayfinderPreflight({
      command: {
        ...command,
        skillInvocation: {
          ...command.skillInvocation!,
          action: { id: "continue-map", reference: "42" },
        },
      },
      dependencies: {
        ...dependencies(() => Effect.succeed({ kind: "ready", wayfinderMap })),
        getSkillRuns: () =>
          Effect.succeed([
            {
              ...command.skillInvocation!,
              wayfinderMap,
              workstreamId: reconnectWorkstreamId,
              skillRunId: SkillRunId.make("skill-run:existing"),
              projectId,
              threadId,
              createdAt: "2026-07-29T00:00:00.000Z",
            },
          ]),
      },
      dispatch: Effect.succeed,
    });
    assert.strictEqual(
      dispatched.type === "thread.turn.start"
        ? dispatched.skillInvocation?.reconnectWorkstreamId
        : null,
      reconnectWorkstreamId,
    );
    assert.isUndefined(
      dispatched.type === "thread.turn.start"
        ? dispatched.skillInvocation?.wayfinderMap
        : undefined,
    );
    assert.strictEqual(
      dispatched.type === "thread.turn.start"
        ? dispatched.skillInvocation?.wayfinderSynchronizedAt
        : null,
      wayfinderMap.lastSynchronizedAt,
    );
    assert.deepStrictEqual(
      dispatched.type === "thread.turn.start"
        ? dispatched.skillInvocation?.wayfinderSynchronization
        : null,
      {
        status: "healthy",
        reason: "resume",
        lastAttemptedAt: wayfinderMap.lastSynchronizedAt,
        lastSuccessfulAt: wayfinderMap.lastSynchronizedAt,
        canMutate: true,
      },
    );
  }),
);

it.effect("returns structured blockers without dispatching canonical mutation", () => {
  let dispatches = 0;
  return Effect.gen(function* () {
    const error = yield* dispatchWithNativeWayfinderPreflight({
      command,
      dependencies: dependencies(() =>
        Effect.succeed({
          kind: "blocked",
          blockers: [{ check: "github-authentication", remediation: "Run gh auth login." }],
        }),
      ),
      dispatch: () => Effect.sync(() => dispatches++),
    }).pipe(Effect.flip);
    assert.strictEqual(error._tag, "OrchestrationDispatchCommandError");
    assert.deepStrictEqual(error.preflightBlockers, [
      { check: "github-authentication", remediation: "Run gh auth login." },
    ]);
    assert.strictEqual(dispatches, 0);
  });
});

it.effect("marks a known cached map read-only when resume preflight cannot reach GitHub", () => {
  const updates: Array<{
    readonly threadId: ThreadId;
    readonly skillRunId: SkillRunId;
    readonly synchronization: WayfinderSynchronizationState;
  }> = [];
  let dispatches = 0;
  const cachedMap = {
    canonicalReference: {
      number: 42,
      title: "Release map",
      url: "https://github.com/t3tools/t3code/issues/42",
      state: "open" as const,
    },
    destination: "A release plan.",
    notes: "",
    decisionsSoFar: [],
    fogOfWar: [],
    outOfScope: [],
    tickets: [],
    frontier: [],
    lastSynchronizedAt: "2026-07-29T00:00:00.000Z",
  };
  const continuation = {
    ...command,
    skillInvocation: {
      ...command.skillInvocation!,
      action: { id: "continue-map" as const, reference: "42" },
    },
  };
  return Effect.gen(function* () {
    yield* dispatchWithNativeWayfinderPreflight({
      command: continuation,
      dependencies: {
        ...dependencies(() =>
          Effect.succeed({
            kind: "blocked",
            blockers: [
              { check: "github-cli", remediation: "Restore GitHub connectivity and retry." },
            ],
          }),
        ),
        getSkillRuns: () =>
          Effect.succeed([
            {
              ...continuation.skillInvocation!,
              workstreamId: WorkstreamId.make("workstream:cached"),
              skillRunId: SkillRunId.make("skill-run:cached"),
              projectId,
              threadId,
              createdAt: cachedMap.lastSynchronizedAt,
              wayfinderMap: cachedMap,
            },
          ]),
        markWayfinderUnavailable: (update) =>
          Effect.sync(() => {
            updates.push(update);
          }),
      },
      dispatch: () => Effect.sync(() => dispatches++),
    }).pipe(Effect.flip);

    assert.strictEqual(dispatches, 0);
    assert.strictEqual(updates[0]?.synchronization.status, "unavailable");
    assert.strictEqual(updates[0]?.synchronization.reason, "resume");
    assert.strictEqual(updates[0]?.synchronization.canMutate, false);
    assert.strictEqual(updates[0]?.synchronization.lastSuccessfulAt, cachedMap.lastSynchronizedAt);
  });
});

it.effect("preserves cached synchronization health for non-GitHub resume blockers", () => {
  let updates = 0;
  const cachedMap = {
    canonicalReference: {
      number: 42,
      title: "Release map",
      url: "https://github.com/t3tools/t3code/issues/42",
      state: "open" as const,
    },
    destination: "A release plan.",
    notes: "",
    decisionsSoFar: [],
    fogOfWar: [],
    outOfScope: [],
    tickets: [],
    frontier: [],
    lastSynchronizedAt: "2026-07-29T00:00:00.000Z",
  };
  const continuation = {
    ...command,
    skillInvocation: {
      ...command.skillInvocation!,
      action: { id: "continue-map" as const, reference: "42" },
    },
  };
  return Effect.gen(function* () {
    yield* dispatchWithNativeWayfinderPreflight({
      command: continuation,
      dependencies: {
        ...dependencies(() =>
          Effect.succeed({
            kind: "blocked",
            blockers: [
              {
                check: "supported-provider",
                remediation: "Choose a supported native provider.",
              },
            ],
          }),
        ),
        getSkillRuns: () =>
          Effect.succeed([
            {
              ...continuation.skillInvocation!,
              workstreamId: WorkstreamId.make("workstream:cached"),
              skillRunId: SkillRunId.make("skill-run:cached"),
              projectId,
              threadId,
              createdAt: cachedMap.lastSynchronizedAt,
              wayfinderMap: cachedMap,
            },
          ]),
        markWayfinderUnavailable: () => Effect.sync(() => updates++).pipe(Effect.asVoid),
      },
      dispatch: Effect.succeed,
    }).pipe(Effect.flip);

    assert.strictEqual(updates, 0);
  });
});

it.effect("lets an explicit generic Wayfinder launch bypass native preflight", () => {
  let checks = 0;
  let dispatches = 0;
  const generic = {
    ...command,
    skillInvocation: {
      ...command.skillInvocation!,
      execution: { mode: "generic", reason: "user-selected-generic" },
    },
  } as OrchestrationCommand;
  return Effect.gen(function* () {
    yield* dispatchWithNativeWayfinderPreflight({
      command: generic,
      dependencies: dependencies(() =>
        Effect.sync(() => {
          checks += 1;
          return { kind: "ready" as const };
        }),
      ),
      dispatch: () => Effect.sync(() => dispatches++),
    });
    assert.deepStrictEqual({ checks, dispatches }, { checks: 0, dispatches: 1 });
  });
});

it.effect("does not silently bypass preflight for an automatic generic fallback", () => {
  let checks = 0;
  let dispatches = 0;
  const unsupported = {
    ...command,
    skillInvocation: {
      ...command.skillInvocation,
      execution: { mode: "generic", reason: "unsupported-provider" },
    },
  } as OrchestrationCommand;
  return Effect.gen(function* () {
    yield* dispatchWithNativeWayfinderPreflight({
      command: unsupported,
      dependencies: dependencies(() =>
        Effect.sync(() => {
          checks += 1;
          return {
            kind: "blocked" as const,
            blockers: [
              { check: "supported-provider" as const, remediation: "Choose Codex or Claude." },
            ],
          };
        }),
      ),
      dispatch: () => Effect.sync(() => dispatches++),
    }).pipe(Effect.flip);
    assert.deepStrictEqual({ checks, dispatches }, { checks: 1, dispatches: 0 });
  });
});
