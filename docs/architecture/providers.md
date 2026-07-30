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
