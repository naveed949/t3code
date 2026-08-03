# Provider architecture

> For maintainers. Using T3 Code? See [docs/user](../user/).

A provider is the agent runtime that does the actual work. T3 Code supports several, and the
orchestration layer does not know which one is behind a thread.

## Built-in drivers

[`builtInDrivers.ts`][drivers] exports `BUILT_IN_DRIVERS` with five entries:

| Driver kind   | Driver source                           |
| ------------- | --------------------------------------- |
| `codex`       | [`Drivers/CodexDriver.ts`][codex]       |
| `claudeAgent` | [`Drivers/ClaudeDriver.ts`][claude]     |
| `cursor`      | [`Drivers/CursorDriver.ts`][cursor]     |
| `grok`        | [`Drivers/GrokDriver.ts`][grok]         |
| `opencode`    | [`Drivers/OpenCodeDriver.ts`][opencode] |

Each driver declares its `driverKind`, a `configSchema`, and a `create` function that builds an
adapter in a child scope. Adapter implementations live beside them in
`apps/server/src/provider/Layers/` (`CodexAdapter.ts`, `ClaudeAdapter.ts`, and so on) and conform to
[`ProviderAdapter.ts`][adapter]. Read the driver plus its adapter to see how a specific agent's
transport, config, and event shapes are mapped.

## Registry and routing

Two registries separate configuration from live processes:

- [`ProviderInstanceRegistry`][instances] keys configured instances by `ProviderInstanceId`. Creating
  one looks up the driver by `driverKind`, decodes `entry.config` with that driver's schema, opens a
  child scope, and calls `driver.create`.
- [`ProviderAdapterRegistry`][registry] resolves an instance ID to its live adapter via
  `getByInstance`.

[`ProviderService`][service] sits on top. It combines the adapter registry with the provider session
directory to route session and turn operations for a thread, so callers name a thread, not an agent.

Adding a driver means writing the driver plus adapter and adding it to `BUILT_IN_DRIVERS`. No
orchestration, contract, or client change is required for the common case.

## How provider work is requested

Clients never call a provider directly. They dispatch orchestration commands over the RPC method
`orchestration.dispatchCommand`, defined with the rest of the orchestration surface in
[`orchestration.ts`][contracts]. The client-dispatchable provider-facing commands are
`thread.turn.start`, `thread.turn.interrupt`, `thread.approval.respond`,
`thread.user-input.respond`, `thread.checkpoint.revert`, and `thread.session.stop`, plus the mode
setters `thread.runtime-mode.set` and `thread.interaction-mode.set`.

The engine persists an event for the command, and a server-side reactor performs the provider call.
Provider output comes back as internal commands such as `thread.message.assistant.delta` and
`thread.session.set`, which clients observe through `orchestration.subscribeThread`. See
[overview.md](./overview.md) for the command/event loop.

## Server-side workers

Provider work flows through three queue-backed workers. All three are built with
`makeDrainableWorker` from [`DrainableWorker.ts`][worker] and expose `drain` for deterministic test
synchronization.

1. [`ProviderRuntimeIngestion`][ingest] consumes provider runtime streams and emits orchestration
   commands.
2. [`ProviderCommandReactor`][cmd] reacts to orchestration intent events and dispatches provider
   calls.
3. [`CheckpointReactor`][checkpoint] captures workspace checkpoints on turn start and completion, and
   performs reverts.

### Buffered assistant delivery

A thread in `buffered` assistant delivery mode accumulates assistant text instead of streaming each
delta. The buffer is not held until turn completion. In [`ProviderRuntimeIngestion`][ingest],
`MAX_BUFFERED_ASSISTANT_CHARS` is 24,000: the append that would exceed it invalidates the buffer and
spills the whole accumulated text as one delta. The buffer also flushes at interaction boundaries,
when a request opens (approval) or user input is requested, via
`flushBufferedAssistantMessagesForTurn`.

[drivers]: ../../apps/server/src/provider/builtInDrivers.ts
[codex]: ../../apps/server/src/provider/Drivers/CodexDriver.ts
[claude]: ../../apps/server/src/provider/Drivers/ClaudeDriver.ts
[cursor]: ../../apps/server/src/provider/Drivers/CursorDriver.ts
[grok]: ../../apps/server/src/provider/Drivers/GrokDriver.ts
[opencode]: ../../apps/server/src/provider/Drivers/OpenCodeDriver.ts
[adapter]: ../../apps/server/src/provider/Services/ProviderAdapter.ts
[instances]: ../../apps/server/src/provider/Services/ProviderInstanceRegistry.ts
[registry]: ../../apps/server/src/provider/Services/ProviderAdapterRegistry.ts
[service]: ../../apps/server/src/provider/Layers/ProviderService.ts
[contracts]: ../../packages/contracts/src/orchestration.ts
[worker]: ../../packages/shared/src/DrainableWorker.ts
[ingest]: ../../apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
[cmd]: ../../apps/server/src/orchestration/Layers/ProviderCommandReactor.ts
[checkpoint]: ../../apps/server/src/orchestration/Layers/CheckpointReactor.ts

+## Native skill invocation

Clients may attach a typed skill invocation request to `thread.turn.start`. The server validates that
the exact named path is enabled on the selected provider instance, hashes the installed `SKILL.md`,
and records the pinned identity before dispatch. The native adapter registry recognizes only
verified name-and-digest pairs.

Codex receives a native skill input item and Claude receives its native slash-command form. Providers
without a registered native adapter, unknown skills, and digest mismatches preserve the original
prompt as a generic turn. The orchestration event owns the Workstream and Skill Run identifiers, and
the projected turn stores the complete invocation record. Shared shell snapshots collect every
thread's latest stored run independently of its latest turn. This bounded summary survives restart
and reconnect without making base shell hydration grow with every historical run; complete run
history remains in the persisted turns.

Native Wayfinder dispatch is wrapped in a server-side, read-only preflight gate. GitHub credentials
and CLI calls never cross into web, desktop, or mobile clients. The gate resolves the project and any
continuation issue, returns structured blockers with remediation, and only invokes orchestration
dispatch after every prerequisite succeeds. An explicit generic execution preference bypasses this
native-only gate while retaining the pinned skill invocation.

For an existing-map continuation, the tracker adapter reads the canonical map and its native
sub-issue and blocking relationships in one GraphQL projection. The gate attaches that projection
to the normalized invocation before dispatch, and the existing turn event and projection pipeline
persist it without introducing a client-owned authority. A matching canonical map reuses its
project Workstream identity while each explicit continuation receives a new Skill Run identity.
Client runtime derives active/completed discovery, the open-unblocked-unclaimed frontier, and a
stable graph layout from the shared projection.

Native new-map dispatch also supplies a versioned unpublished-draft contract to Codex and Claude.
It requires one structured decision at a time and reserves structured question identifiers for the
destination, notes, candidate tickets, fog of war, out-of-scope entries, and proposed dependency
edges. The persisted Skill Run owns the initial non-canonical draft; clients deterministically fold
durable `user-input.requested` and `user-input.resolved` activities into proposals, decision
receipts, and confirmed map state. This keeps recovery provider-neutral without a second draft
database or client-only state. The server forces these draft sessions into `approval-required`
mode, scopes every structured decision activity to its originating Skill Run, and retains those
activities outside the rolling work-log window. While draft authority is active, the server rejects
every executable approval because an arbitrary command cannot be proven GitHub-read-only;
structured Decision Card responses remain available. Publication clears that authority marker.
Only the latest active draft receives this retention. If a restart has discarded the provider's
in-memory user-input callback, the server records a response against the persisted, Skill
Run-scoped request directly; live callbacks still resume through the provider. The thread's
configured runtime mode is not changed.

Publication is a server-owned reactor flow rather than provider prose. The client dispatches a typed
Skill Run-scoped command, the decider preserves the thread's current runtime permission mode, and a
drainable worker creates labels, issues, child links, and blockers in dependency order. Every
verified artifact produces a typed runtime receipt and a persisted Skill Run progress update.
In approval-required mode, the first request persists a server-owned pending approval activity; a
confirmation command is rejected unless that activity exists for the same active Skill Run.
GitHub issues carry a Skill Run-scoped idempotency marker, while relationship writes read the
canonical relationship first, so recovery is safe even if the process stops between a GitHub write
and its receipt. Draft authority clears only after the tracker adapter reloads the canonical map and
reconciles every expected child and blocker identity. Publication updates also refresh the exact
Skill Run in the shell stream, even when a later ordinary turn is the thread's latest turn.

Published-map editing reuses that command/event/reactor seam. A closed union of Wayfinder mutation
actions crosses the wire; arbitrary issue-body administration does not. The decider binds the
action to the published Skill Run and current runtime permission mode. The drainable worker performs
one tracker mutation, emits typed in-flight and completion receipts, reloads the canonical graph,
and persists both the active-action state and reconciled projection on the same Skill Run. Clients
may project only an awaiting or mutating action optimistically and discard that projection on a
failed receipt.

Ticket claims are a specialized mutation because canonical assignment and local orchestration must
complete as one user-visible operation. The reactor reloads the canonical frontier immediately
before assignment, uses the tracker adapter's current-viewer compare-and-verify claim, and derives a
stable thread identifier from the Workstream and ticket number. It dispatches a project-owned
thread and a pinned `work-ticket` Skill Run only after GitHub confirms the assignment. A retry
recognizes either the persisted linked run or an empty deterministic thread and resumes the missing
step without duplication. If local dispatch fails after assignment, reconciliation persists the
canonical claim with a failed, recoverable mutation instead of reporting success.

Agent-only research adds a dedicated queue-backed reactor on top of that claim seam. Reconciliation
and persisted research-state events select only open, unblocked, unclaimed `research` tickets.
Selection is bounded by a two-ticket Workstream limit, the existing scoped background-activity
policy, the source runtime permission mode, and the provider runtime's own scheduling. The persisted
research projection records pause state and per-ticket launch mode, queue, activity, output,
cancellation, failure, retry, resolution, and error state; each transition also emits a typed
runtime receipt.

Research turns receive a companion result-envelope contract. A ready checkpoint plus a valid
structured resolved result moves the run to `resolving`; prose alone, missing checkpoints,
interruptions, and explicit failed results cannot close the ticket. Resolution dispatches the same
linked-run canonical completion mutation used by decision tickets, so only confirmed GitHub
comment, map-pointer, issue-close, and reconciliation receipts mark the research resolved and
recompute the frontier. Cancellation interrupts the provider turn and releases the claim, including
the claim-completion race; retry reuses the deterministic linked thread with a fresh turn identity.

Human-in-the-loop completion is another specialized mutation and is accepted only from the pinned
`work-ticket` Skill Run for its assigned claimed ticket. The processor locates that run's source map
Skill Run, then records an idempotent canonical resolution comment before changing the route. A
resolved outcome can create idempotent decision issues, child links, and blocking relationships,
remove the corresponding fog, and append only a context pointer to **Decisions so far**. An
out-of-scope outcome updates **Out of scope**, applies the `wayfinder:out-of-scope` classification,
and never appends a route decision.

Every verified step emits a mutation update carrying its artifact receipt and exact next step.
Failure retains those receipts and the canonical claim for explicit resume or release. Closure is
the last write before a full reconciliation. Terminal and partial projections are dispatched to
both the linked ticket run and its source map run, so comment, relationship, close, and reopen
receipts recompute the shared frontier and linked-thread state without client-side dual authority.

Published maps use a separate queue-backed reconciliation reactor. Clients send a typed,
Skill Run-scoped reason (`open`, `reconnect`, `focus`, `manual`, `poll`, `mutation`, or `resume`), and
the environment-owning server performs every GitHub read. A lightweight revision query covers the
map and child titles, states, labels, assignments, latest comments, child membership, and blocking
relationships; an unchanged result advances sync health without loading bodies or another full
graph. Changed graphs are projected through persisted orchestration events and shell updates so
web, desktop, mobile, and remote clients converge.

Synchronization is explicit: `synchronizing`, `healthy`, `unavailable`, or `conflict`. Unavailable
and partial responses retain the prior projection and set `canMutate` false. Mutation reconciliation
compares expected revision evidence before any tracker action; a mismatch persists a structured
conflict and leaves the cached graph untouched. Each terminal attempt emits a typed runtime receipt,
so tests can wait on the worker rather than timers or polling. Successful publication emits the
same healthy `mutation` synchronization state after its final canonical reload. Continuing a known
map performs its full GitHub preflight before dispatching the resumed provider turn and persists a
healthy `resume` state into the newly linked Skill Run.

Wayfinder readiness is one shared pure derivation over receipt-backed projection state: destination,
open decision tickets, active `work-ticket` threads, in-scope fog, closed-ticket classification, and
synchronization health. The parent issue's state and provider prose are not completion inputs. Web,
desktop, and mobile render every returned blocker. An explicit `handoff-to-spec` action is normalized
by loading its historical source Skill Run from the projection store, validating the canonical issue
and synchronization receipt, and stamping that source Workstream as `reconnectWorkstreamId`. The
decider then creates a new generic Skill Run identity in that Workstream. Incomplete readiness is
accepted only when the typed action records the user's warning acknowledgement; no reactor or
assistant output automatically dispatches the handoff.

## Wayfinder projection and rendering budgets

GitHub pagination and shared-shell payload size are separate trust boundaries. `IssueTracker` rejects
any relationship connection whose first 100 entries report another page. After projecting a complete
response, the server measures its UTF-8 JSON representation and accepts at most 256 KiB. An oversized
continuation fails preflight with remediation; an oversized reconciliation preserves the last
successful projection as read-only. Neither case sends a partial authoritative map.

Clients derive one deterministic model from that bounded projection. All supported tickets remain in
the frontier-first list, while the decorative dependency graph is limited to 100 nodes and the first
200 stably sorted relationships. Web and desktop link the graph to the complete list alternative;
mobile derives its compact rows and accessibility description from the same capped edge set. This
prevents a dense 100-ticket DAG from expanding into thousands of rendered badges or one unbounded
screen-reader announcement.

Reconciliation polling runs only while the Workbench is connected and visible. The 60-second client
interval requests lightweight revision evidence first; unchanged evidence updates synchronization
health without loading or broadcasting the full map. Graph surfaces use static layout and Decision
Card transitions disable themselves for reduced-motion users. The web Workbench focuses its heading
once on mount, while native controls expose their selected and disabled states on both web and mobile.
