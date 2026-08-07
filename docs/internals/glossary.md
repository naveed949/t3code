# Glossary

> For maintainers. Using T3 Code? See [docs/user](../user/).

This is a living glossary for T3 Code. It explains what common terms mean in this codebase.

## Table of contents

- [Project and workspace](#project-and-workspace)
- [Thread timeline](#thread-timeline)
- [Orchestration](#orchestration)
- [Skill runs](#skill-runs)
- [Provider runtime](#provider-runtime)
- [Checkpointing](#checkpointing)

## Concepts

### Project and workspace

#### Project

The top-level workspace record in the app. In [the orchestration contracts][1], a project has a `workspaceRoot` and a title. It does not contain threads: `OrchestrationProject` and `OrchestrationThread` are separate arrays on the read model, and a project can have zero threads. See [workspace-layout.md][2].

#### Workspace root

The root filesystem path for a project. In [the orchestration model][1], it is the base directory for branches and optional worktrees. See [workspace-layout.md][2].

#### Worktree

A Git worktree used as an isolated workspace for a thread. If a thread has a `worktreePath` in [the contracts][1], it runs there instead of in the main working tree. Git operations live behind the VCS driver contract in `apps/server/src/vcs/VcsDriver.ts`, implemented by [GitVcsDriverCore.ts][3].

### Thread timeline

#### Thread

The main durable unit of conversation and workspace history. In [the orchestration contracts][1], a thread holds messages, activities, checkpoints, and session-related state. See [projector.ts][4].

#### Turn

A single user-to-assistant work cycle inside a thread. It starts with user input and ends when the session leaves `running` status, which [projector.ts][4] treats as the authoritative completion signal (`settledTurnStateForSessionStatus`). Checkpoint and diff work may settle afterward without changing when the turn ended. See [the contracts][1] and [ProviderRuntimeIngestion.ts][5].

#### Activity

A user-visible log item attached to a thread. In [the contracts][1], activities cover important non-message events like approvals, tool actions, and failures. They are projected into thread state in [projector.ts][4].

### Orchestration

Orchestration is the server-side domain layer that turns runtime activity into stable app state. The main entry point is [OrchestrationEngine.ts][7], with core logic in [decider.ts][8] and [projector.ts][4].

#### Aggregate

The domain object a command or event belongs to. In [the contracts][1], that is usually `project` or `thread`. See [decider.ts][8].

#### Command

A typed request to change domain state. In [the contracts][1], commands are validated in [commandInvariants.ts][9] and turned into events by [decider.ts][8].
Examples include `thread.create`, `thread.turn.start`, and `thread.checkpoint.revert`.

#### Domain Event

A persisted fact that something already happened. In [the contracts][1], events are the source of truth, and [projector.ts][4] shows how they are applied.
Examples include `thread.created`, `thread.message-sent`, and `thread.turn-diff-completed`.

#### Decider

The pure orchestration logic that turns commands plus current state into events. The core implementation is in [decider.ts][8], with preconditions in [commandInvariants.ts][9].

#### Projection

A read-optimized view derived from events. See [projector.ts][4], [ProjectionPipeline.ts][11], and [ProjectionSnapshotQuery.ts][10].

#### Projector

The logic that applies domain events to the read model or projection tables. See [projector.ts][4] and [ProjectionPipeline.ts][11].

#### Read model

The current materialized view of orchestration state. In [the contracts][1], it holds projects, threads, messages, activities, checkpoints, and session state. See [ProjectionSnapshotQuery.ts][10] and [OrchestrationEngine.ts][7].

#### Reactor

A side-effecting service that handles follow-up work after events or runtime signals. Examples include [CheckpointReactor.ts][6], [ProviderCommandReactor.ts][12], and [ProviderRuntimeIngestion.ts][5].

### Skill runs

#### Workstream

A project-scoped identity that groups related skill work. The first explicit skill invocation creates
the Workstream identifier in [decider.ts][8]; clients derive its current representation from the
shared project Skill Run list and each run's linked thread.

#### Development Workflow attachment

An explicit, one-per-Origin-Thread link from a native structured Wayfinder Skill Run to a durable
Development Workflow Workstream. The attachment preserves compatible Wayfinder projection data and
an observation cursor in the thread projection; it never treats assistant prose as workflow
authority and does not replace the originating conversation thread. Its compact graph retains
bounded artifact lineage (Workstream, source run, source stage, and exact upstream version) and
durable new/changed markers. A newer compatible artifact supersedes the old one, marks the
Workstream node stale, and gates downstream dispatch until an allowed explicit resolution is
recorded. See [the contracts][1] and [ProjectionPipeline.ts][11].

#### Specification stage

The server-owned stage that dispatches a pinned generic `to-spec` Skill Run from a confirmed
Wayfinder Workstream. It retains the native test-seam checkpoint, binds checkpoint activities to the
authorized Skill Run, and accepts completion only after the checkpoint is resolved and a structured
Workflow PRD names the current Wayfinder artifact.

#### Ticketing stage

The server-owned stage that dispatches a pinned native `to-tickets` Skill Run from the completed
Workflow PRD. It preserves one native granularity-and-blocker Checkpoint, binds the exact approved
Ticket Batch to that response, and does not publish or expand Run Scope without the explicit
publication command.

#### Ticket Batch

The immutable, approval-scoped set of ticket titles, bodies, parent relationships, and blocker edges
derived from one current Workflow PRD version. Publication effects use the batch identifier and each
ticket key as their idempotency identity.

#### Tracker Projection

The read model of tracker-owned ticket identity, parentage, blocker edges, and open or closed state
after Ticket Batch publication. T3 owns the workflow history and Run Scope inclusion; the tracker
remains authoritative for the synchronized external relationships and state.

#### Workflow PRD

A versioned, structured specification artifact produced by the Specification stage. The normal graph
projection retains only bounded metadata and lineage; full document details travel through the
artifact-detail path so opening a Workstream does not hydrate an unbounded document into every
snapshot or delta.

#### Capability Block

A projected stage state explaining why a pinned provider capability cannot be dispatched, such as a
missing, changed, unverified, or provider-mismatched Required Skill. A Capability Block is visible to
the user and does not substitute a T3-authored prompt or silently start generic work.

#### Workflow Checkpoint

A durable native Skill Run pause owned by a Workflow stage. The Specification checkpoint records its
request identity, stage Skill Run, questions, status, and first accepted response; unrelated,
duplicate, or stale responses cannot advance the stage.

#### Skill Run

One execution of a pinned skill within a Workstream. Its durable invocation record includes the skill
name, installed path, content digest, provider execution mode, owning project and thread, and creation
time. Native compatibility is decided by [NativeSkillAdapterRegistry.ts][25].

#### Wayfinder map

The canonical GitHub issue map attached to a Wayfinder Workstream. Its synchronized
projection records the destination, notes, decisions, fog of war, out-of-scope items, child-ticket
states and dependency relationships, claims, classifications, canonical reference, and last sync
time. Reconnecting to the same canonical map creates a new Skill Run in the existing Workstream.

#### Wayfinder Workbench

The client view of a synchronized Wayfinder map. Web and desktop expose it as a right-panel surface;
mobile exposes a full-screen route. Both prioritize the **frontier**: open, unblocked, unclaimed
child tickets that are ready to advance. Starting work claims a frontier ticket and opens its
deterministic linked ticket thread; retry, return, release, and reclaim expose the reverse and
recovery states on every client.

The complete frontier-first ticket list is also the non-visual alternative to the dependency graph.
The shared model keeps all supported tickets but caps the decorative graph at 100 nodes and 200
stably sorted relationships. Web and desktop focus the Workbench heading when the panel opens;
mobile exposes the same state and actions through a full-screen route. See
[wayfinderWorkbench.ts][30].

#### Workflow Panel and Outline

The Workstream-scoped presentation derived from the synchronized Wayfinder projection. The compact
panel surfaces the active stage, milestone, checkpoint or attention, active runs, progress, and
Ticket Frontier. The complete outline retains every projected ticket and dependency independently of
the bounded decorative graph. Node selection is local presentation state only; the inspector exposes
canonical evidence, history, lineage, linked thread, and the currently allowed native controls. It
never imports or rebrands provider-authored thread Plan steps as workflow nodes. See
[wayfinderWorkflow.ts][32].

#### Wayfinder projection budget

The server-side bound applied before a canonical map enters shared shell state. GitHub relationship
connections stop at 100 entries, and the complete projected map may occupy at most 256 KiB when
encoded as UTF-8 JSON. Preflight rejects an oversized map; reconciliation retains the last healthy
projection as cached read-only state. See [WayfinderMapProjection.ts][31].

#### HITL resolution

The receipt-backed completion of one claimed Wayfinder decision in its dedicated linked thread.
It records the canonical issue comment and context pointer before closing the assigned ticket.
Newly specifiable fog may graduate into child tickets and native blocking relationships; work beyond
the destination is classified and represented as out of scope instead of becoming a route decision.
Verified artifacts and the claim survive interruption for explicit resume or release.

#### Wayfinder readiness

The receipt-backed completion decision for a synchronized map. Readiness requires a destination, no
open decision tickets, no active linked ticket threads, no in-scope fog, no closed ticket with an
unknown classification, and healthy tracker synchronization. The Workbench displays every failed
invariant; closing the parent issue or narrating completion does not satisfy one.

#### Wayfinder to-spec handoff

An explicit, provenance-linked transition from a Wayfinder Skill Run to a separate generic
`to-spec` Skill Run in the same project Workstream. The invocation retains its source Skill Run and
thread, canonical issue reference, and synchronization receipt time. An incomplete map requires a
recorded early-handoff acknowledgement, and T3 never starts this transition automatically.

#### Wayfinder research run

The visible background lifecycle for one agent-only `research` ticket. Only an open, unblocked,
unclaimed research ticket may launch automatically; grilling, prototypes, and manual tasks always
require the user. The Workstream projection retains its automatic/manual launch mode, queue,
activity, output, cancellation, failure, retry, and resolution state. A checkpoint-backed structured
result starts canonical resolution, while GitHub receipts and reconciliation confirm completion and
frontier changes. See [WayfinderResearchReactor.ts][29].

#### Wayfinder mutation

One closed, structured action against a published Wayfinder map: edit a map field; create, rename,
classify, resolve, close, reopen, claim, release, or complete a HITL decision ticket; or add or remove
a blocking relationship. Its persisted state identifies the active action and whether it is
awaiting approval, mutating, failed, or synchronized. A resumable HITL mutation also retains
verified artifacts and its exact next step. GitHub receipts and reconciliation, rather than client
optimism or assistant prose, confirm the canonical result.

#### Wayfinder reconciliation

The server-owned refresh flow that keeps a published Wayfinder projection aligned with GitHub. It
uses lightweight revision evidence before loading the full graph and persists a structured healthy,
unavailable, or conflict result. An unavailable map remains cached and read-only; stale mutation
evidence never overwrites canonical GitHub state. See [WayfinderReconciliationReactor.ts][28].

#### Native skill adapter

A verified mapping from a pinned skill identity to a provider-native invocation mechanism. A missing
provider mapping or a mismatched digest uses generic execution without claiming native support. See
[NativeSkillAdapterRegistry.ts][25].

#### Unpublished Wayfinder draft

A non-canonical map owned by a native Wayfinder `new-map` Skill Run. It contains the destination,
notes, confirmed decisions, agent proposals, candidate tickets, fog of war, out-of-scope entries,
and proposed dependency edges. Clients recover it from the durable Skill Run and structured-input
activities; GitHub is unchanged until a later publication flow. See [nativeSkills.ts][26].

#### Decision Card

The client surface for one pending Wayfinder choice. It presents the agent's recommendation,
reasoning, bounded options, and a free-form answer without treating the proposal as confirmed.

#### Decision receipt

The structured record of the user's answer to a Decision Card. A matching
`user-input.requested`/`user-input.resolved` pair produces the receipt and moves the proposal into
confirmed draft state. See [wayfinderDraft.ts][27].

#### Wayfinder publication

The permission-aware server reactor that turns one confirmed unpublished draft into a canonical
GitHub map. Its persisted progress records verified labels, issues, child relationships, blocking
relationships, and the exact next step. Publication can resume those receipts idempotently; only a
successful canonical reconciliation transfers authority to the synchronized Workbench projection.

#### Receipt

A typed signal emitted when an async milestone completes, such as `checkpoint.baseline.captured`, `checkpoint.diff.finalized`, or `turn.processing.quiesced`. Receipts are a test-only mechanism: the production `RuntimeReceiptBusLive` publish is a no-op and only the test layer is PubSub-backed. Do not build production behavior on them. See [RuntimeReceiptBus.ts][13] and [CheckpointReactor.ts][6].

#### Quiesced

"Quiesced" means a turn has gone quiet and stable: follow-up work such as [CheckpointReactor.ts][6] has settled. It appears in [the receipt schema][13], so in practice it is something tests wait on rather than a production signal.

### Provider runtime

The live backend agent implementation and its event stream. The main service is [ProviderService.ts][14], the adapter contract is [ProviderAdapter.ts][15], and the overview is in [providers.md][16].

#### Provider

The backend agent runtime that actually performs work. Five drivers ship built in: Codex, Claude, Cursor, Grok, and OpenCode. See [ProviderService.ts][14], [ProviderAdapter.ts][15], and [CodexAdapter.ts][17] as a representative adapter.

#### Session

The live provider-backed runtime attached to a thread. Session shape is in [the orchestration contracts][1], and lifecycle is managed in [ProviderService.ts][14].

#### Runtime mode

The safety/access mode for a thread or session. [The contracts][1] define four values: `approval-required`, `auto-accept-edits`, `auto`, and `full-access`. See [permission modes][18].

#### Interaction mode

The agent interaction style for a thread. In [the contracts][1], the values are `default` and `plan`.

#### Assistant delivery mode

Controls how assistant text reaches the thread timeline. In [the contracts][1], `streaming` updates incrementally and `buffered` accumulates text. Buffered delivery is not held until the turn completes: it spills once accumulated text would exceed 24,000 characters, and flushes at approval and user-input boundaries. See [ProviderRuntimeIngestion.ts][5].

#### Snapshot

A point-in-time view of state. The word is used in multiple layers, including orchestration, provider, and checkpointing. See [ProjectionSnapshotQuery.ts][10], [ProviderAdapter.ts][15], and [CheckpointStore.ts][19].

### Checkpointing

Checkpointing captures workspace state over time so the app can diff turns and restore earlier points. The main pieces are [CheckpointStore.ts][19], [CheckpointDiffQuery.ts][20], and [CheckpointReactor.ts][6].

#### Checkpoint

A saved snapshot of a thread workspace at a particular turn. In practice it is a hidden Git ref in [CheckpointStore.ts][19] plus a projected summary from [ProjectionCheckpoints.ts][21]. Capture and lifecycle work happen in [CheckpointReactor.ts][6].

#### Checkpoint ref

The durable identifier for a filesystem checkpoint, stored as a Git ref. It is typed in [the contracts][1], constructed in [Utils.ts][22], and used by [CheckpointStore.ts][19].

#### Checkpoint baseline

The starting checkpoint for diffing a thread timeline. This flow is surfaced through [RuntimeReceiptBus.ts][13], coordinated in [CheckpointReactor.ts][6], and supported by [Utils.ts][22].

#### Checkpoint diff

The patch difference between two checkpoints. Query logic lives in [CheckpointDiffQuery.ts][20], diff parsing lives in [Diffs.ts][23], and finalization is coordinated by [CheckpointReactor.ts][6].

#### Turn diff

The file patch and changed-file summary for one turn. It is usually computed in [CheckpointDiffQuery.ts][20], represented in [the contracts][1], and recorded into thread state by [projector.ts][4].

## Practical Shortcuts

- If you see `requested`, think "intent recorded".
- If you see `completed`, think "result applied".
- If you see `receipt`, think "async milestone signal, for tests".
- If you see `checkpoint`, think "workspace snapshot for diff/restore".
- If you see `quiesced`, think "all relevant follow-up work has gone idle".

## Related Docs

- [Architecture overview][24]
- [Provider architecture][16]
- [Permission modes][18]
- [Workspace layout][2]

[1]: ../../packages/contracts/src/orchestration.ts
[2]: ./workspace-layout.md
[3]: ../../apps/server/src/vcs/GitVcsDriverCore.ts
[4]: ../../apps/server/src/orchestration/projector.ts
[5]: ../../apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
[6]: ../../apps/server/src/orchestration/Layers/CheckpointReactor.ts
[7]: ../../apps/server/src/orchestration/Layers/OrchestrationEngine.ts
[8]: ../../apps/server/src/orchestration/decider.ts
[9]: ../../apps/server/src/orchestration/commandInvariants.ts
[10]: ../../apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts
[11]: ../../apps/server/src/orchestration/Layers/ProjectionPipeline.ts
[12]: ../../apps/server/src/orchestration/Layers/ProviderCommandReactor.ts
[13]: ../../apps/server/src/orchestration/Services/RuntimeReceiptBus.ts
[14]: ../../apps/server/src/provider/Layers/ProviderService.ts
[15]: ../../apps/server/src/provider/Services/ProviderAdapter.ts
[16]: ./providers.md
[17]: ../../apps/server/src/provider/Layers/CodexAdapter.ts
[18]: ../user/permission-modes.md
[19]: ../../apps/server/src/checkpointing/CheckpointStore.ts
[20]: ../../apps/server/src/checkpointing/CheckpointDiffQuery.ts
[21]: ../../apps/server/src/persistence/Services/ProjectionCheckpoints.ts
[22]: ../../apps/server/src/checkpointing/Utils.ts
[23]: ../../apps/server/src/checkpointing/Diffs.ts
[24]: ./overview.md
[25]: ../../apps/server/src/nativeSkills/NativeSkillAdapterRegistry.ts
[26]: ../../packages/contracts/src/nativeSkills.ts
[27]: ../../packages/client-runtime/src/state/wayfinderDraft.ts
[28]: ../../apps/server/src/orchestration/Layers/WayfinderReconciliationReactor.ts
[29]: ../../apps/server/src/orchestration/Layers/WayfinderResearchReactor.ts
[30]: ../../packages/client-runtime/src/state/wayfinderWorkbench.ts
[31]: ../../apps/server/src/nativeSkills/WayfinderMapProjection.ts
[32]: ../../packages/client-runtime/src/state/wayfinderWorkflow.ts
