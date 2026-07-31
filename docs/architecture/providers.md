# Provider architecture

The web app communicates with the server via WebSocket using a simple JSON-RPC-style protocol:

- **Request/Response**: `{ id, method, params }` → `{ id, result }` or `{ id, error }`
- **Push events**: typed envelopes with `channel`, `sequence` (monotonic per connection), and channel-specific `data`

Push channels: `server.welcome`, `server.configUpdated`, `terminal.event`, `orchestration.domainEvent`. Payloads are schema-validated at the transport boundary (`wsTransport.ts`). Decode failures produce structured `WsDecodeDiagnostic` with `code`, `reason`, and path info.

Methods mirror the `NativeApi` interface defined in `@t3tools/contracts`:

- `providers.startSession`, `providers.sendTurn`, `providers.interruptTurn`
- `providers.respondToRequest`, `providers.stopSession`
- `shell.openInEditor`, `server.getConfig`

Provider adapters currently cover Codex, Claude, Cursor, Grok, and OpenCode. Their capabilities are
not identical; adapter-specific features must use explicit capability checks and truthful fallback.

## Client transport

`wsTransport.ts` manages connection state: `connecting` → `open` → `reconnecting` → `closed` → `disposed`. Outbound requests are queued while disconnected and flushed on reconnect. Inbound pushes are decoded and validated at the boundary, then cached per channel. Subscribers can opt into `replayLatest` to receive the last push on subscribe.

## Server-side orchestration layers

Provider runtime events flow through queue-based workers:

1. **ProviderRuntimeIngestion** — consumes provider runtime streams, emits orchestration commands
2. **ProviderCommandReactor** — reacts to orchestration intent events, dispatches provider calls
3. **CheckpointReactor** — captures git checkpoints on turn start/complete, publishes runtime receipts

All three use `DrainableWorker` internally and expose `drain()` for deterministic test synchronization.

## Native skill invocation

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
