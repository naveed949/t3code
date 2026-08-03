# Development Workflow

## Problem Statement

The thread-local Plan view replaces its visible checklist as providers publish later plan snapshots. Users lose the relationship between earlier work, newly introduced work, blockers, execution, review, and integration. A flat checklist also cannot safely automate a development process that spans several skills, tracker artifacts, threads, providers, worktrees, and clients.

Users need a durable graph that stays attached to the Wayfinder work that produced it, preserves history as new work arrives, exposes truthful execution state, and automates the reviewed implementation frontier without silently expanding authority.

## Solution

Add one built-in Development Workflow:

```text
Wayfinder -> Specification -> Ticketing -> Ticket Implementations -> Publication
                                              |        |
                                              |        +-> integration
                                              +-> Implementation -> Code Review
                                                       ^                 |
                                                       +-- corrections --+
```

The user explicitly invokes the Development Workflow and attaches it to an existing Wayfinder thread. T3 creates one Workstream, backfills structured Wayfinder Data already present, and observes later structured progress. The current Plan view remains separate and thread-scoped; a new Workflow view renders durable Workstream state.

The Workflow Panel is a compact stage-and-frontier control surface. The Workflow Workspace provides a layered Compound Workflow Graph, complete accessible outline, history, filters, and inspectors. Web and desktop receive the canvas and outline; mobile receives the complete outline and every valid control without the canvas in v1.

## Product Model

### Scope and identity

- A Wayfinder thread has one durable Workflow Attachment and one Workstream.
- Repeated automation creates additional Workflow Runs inside that Workstream rather than another observer.
- V1 supports multiple Workstreams attached to different Wayfinder threads. There is no singleton active workflow.
- Cross-Workstream dependencies, portfolio dashboards, and bulk controls are future scope.
- A Workflow Goal bounds the Workstream.
- A Workflow Run has explicit Run Scope. Synchronized nodes outside it remain visible but cannot dispatch.

### Workflow stages

1. **Wayfinder** supplies structured decisions, relationships, readiness, and handoff evidence.
2. **Specification** invokes `/to-spec`, preserves its native test-seam confirmation, and produces a versioned Workflow PRD.
3. **Ticketing** invokes `/to-tickets`, preserves its native granularity and blocker review, and publishes an approved Ticket Batch.
4. **Ticket Implementations** work the synchronized Ticket Frontier in isolated worktrees. `/implement` owns Code Review for each ticket.
5. **Publication** pushes the Workstream Baseline and opens one draft PR after explicit approval.

`code-review` is a child completion gate of every Ticket Implementation, not a separate global stage.

### Graph relationships

- Stage containers preserve distinct Wayfinder decisions, tracker tickets, and execution runs.
- Artifact Lineage connects exact upstream and downstream artifact versions.
- Tracker parentage and blocker edges remain tracker-owned.
- Aggregate Nodes summarize child progress and are not directly runnable.
- Only unblocked Executable Nodes may dispatch.
- A cancelled required child or blocker does not count as completed and creates Needs Decision.

### Durable evidence

- Workflow graph state comes only from structured artifacts, persisted events, tracker synchronization, and typed receipts.
- T3 never parses assistant prose to infer nodes, relationships, completion, or readiness.
- Compatible historical Wayfinder Data is backfilled at attachment; observation resumes from a persisted cursor and deduplicates replay.
- Missing structured output displays `Waiting for Wayfinder data`.
- Every Workflow Artifact records Workstream, run, source-stage, and upstream-version provenance.
- New upstream Wayfinder Data marks affected downstream artifacts Stale, stops new dependent dispatch, lets active work drain, and exposes the impact path.
- Completed history is append-only from the user's perspective; regeneration creates new versions rather than rewriting prior outcomes.

## Authority and Automation

### Explicit attachment and preflight

After T3 observes a structured Wayfinder invocation in an unattached thread, it shows one dismissible **Track this as a development workflow** hint. It never triggers from prose and never attaches automatically.

Attachment opens a read-only preflight containing:

- Selected Wayfinder thread and Workflow Goal
- Default provider and verified Required Skills
- Tracker read/write capabilities
- Git repository, user-confirmed Fixed Point, Workstream Baseline branch, remote, and future PR target
- Dirty-state or branch-name conflicts
- Environment Automation Capacity and Workstream Execution Limit
- All local and remote authority granted by Run workflow

No branch, tracker record, Workstream, or provider run is created before confirmation.

### Capability gating

- Every Workflow Run has a default provider instance.
- Any not-yet-started node may override it with another capable provider.
- Provider and Required Skill identity become immutable at dispatch.
- Missing or changed skills create a visible Capability Block.
- T3 never substitutes a T3-authored prompt for a missing provider skill.

### Run authority

- **Start** authorizes exactly one runnable node.
- **Run workflow** authorizes automatic progression through the declared Run Scope.
- Execution pauses for native Skill Checkpoints, approvals, failure, Needs Recovery, Needs Decision, or explicit user pause.
- Starting a Workflow Run does not authorize later graph additions automatically.
- New synchronized nodes show `Not included in run` until the user selects **Include changes**.
- The approved Ticketing publication checkpoint is the exception: approving its exact Ticket Batch may publish and include those exact tickets in the current Run Scope.
- New blockers prevent future dispatch. A blocker contradicting active work creates Needs Decision; T3 does not interrupt or roll back automatically.

### Checkpoints and multiple clients

- Native skill checkpoints remain intact, including Specification test-seam confirmation and Ticketing granularity/blocker approval.
- One durable Checkpoint Request is visible from web, desktop, and mobile.
- The first accepted response wins. Duplicate or stale responses are rejected idempotently and all clients synchronize.
- Notifications are reserved for checkpoints, Needs Recovery, Needs Decision, publication approval, and Published for Review. Routine progress updates the graph and badges silently.

### Scheduling

- The Ticket Frontier contains tickets whose canonical blockers are all satisfied.
- Independent frontier tickets run concurrently in isolated worktrees.
- Automation Capacity defaults to two automated provider runs per environment and is configurable.
- Each Workstream may choose a lower Execution Limit but cannot exceed environment capacity.
- Explicit user-started turns have priority; remaining capacity is shared fairly across Workstreams.
- Work that cannot be isolated is serialized.

### Pause, stop, retry, and recovery

- **Pause workflow** is draining: it stops new dispatch while active work completes or reaches a checkpoint.
- A per-node **Hold** prevents future dispatch. Removing it makes eligible work runnable but does not start it.
- Providers cannot safely suspend an in-flight turn. Running nodes offer **Stop**, which interrupts the turn and retains its thread, worktree, and diff.
- A stopped or side-effectful failed run enters Needs Recovery. T3 does not roll back automatically.
- Recovery offers inspect, resume, cancel while retaining changes, and confirmed restore-to-checkpoint actions.
- Only transient dispatch failures that provably occurred before provider acceptance may retry with the same idempotency identity.
- Once provider execution may have changed the workspace, T3 never reruns automatically.

## Ticket Implementation and Integration

### Review loop

- `/implement` runs in one ticket worktree and invokes `/code-review` against a recorded Fixed Point.
- Only structured Must-Fix Findings grounded in repository standards or the ticket specification block integration.
- Suggestions remain visible but do not consume correction capacity.
- A Must-Fix Finding launches a fresh Correction Cycle in the same ticket worktree with the verified findings and original acceptance criteria.
- Review runs again against the same Fixed Point.
- At most four Correction Cycles are automatic. Remaining Must-Fix Findings create Needs Decision.

### Integration

- The Workstream Baseline is a dedicated local integration branch created from a user-confirmed Fixed Point.
- A reviewed ticket does not release dependents until its changes integrate successfully into the baseline and its tracker issue closes and synchronizes.
- Integrations are serialized even when implementations are parallel.
- A clean integration proceeds automatically.
- A merge conflict launches one automatic Integration Repair Run under existing Run authority while the integration lane remains locked.
- The repaired combined diff must pass focused validation and Code Review.
- Must-Fix Findings may use the ticket's four Correction Cycles. A stopped or failed repair enters Needs Recovery instead of launching another repair.
- Tracker closure failure keeps the ticket and its dependents blocked.

### Cancellation and graph repair

- Cancellation is terminal but does not satisfy required work.
- Dependents remain blocked and the parent enters Needs Decision.
- T3 has no local force-unblock or waiver.
- Resolution requires an approved canonical Graph Repair in the tracker, followed by successful synchronization.

### Baseline changes

- The Workstream never follows the default branch automatically.
- **Refresh baseline** is explicit, drains active work, previews incoming commits, updates the baseline, and revalidates affected integrated work.
- No background pull or rebase changes active workflow state.

## Publication and Tracker Lifecycle

- Every implementation ticket closes after reviewed work integrates into the Workstream Baseline and tracker synchronization confirms closure.
- The Workflow PRD remains open while tickets are being implemented.
- When all in-scope tickets are integrated, no unresolved or Stale work remains, tracker synchronization is healthy, and the baseline validates, the run reaches **Locally Integrated**.
- Publication previews the exact remote, head branch, target branch, commits, PR title, PR body, and authority before approval.
- Approval pushes the Workstream Baseline and creates one draft PR for the complete Workstream.
- The PR body uses the tracker's closing relationship for the Workflow PRD, so the PRD closes on PR merge rather than PR creation.
- Successful push and PR creation produce **Published for Review** and end provider execution.
- The Workstream passively observes PR checks, reviews, merge state, and tracker state afterward.
- An external/user merge advances the projection to **Merged** only after Workflow PRD closure synchronizes.
- V1 never merges, deploys, automatically addresses CI/review feedback, or pushes follow-up commits. Selected feedback requires a separately authorized future Follow-Up Run.

## Workflow View

### Separation from Plan

- The existing Plan view remains a provider-authored, thread-local checklist.
- The Workflow view is Workstream-scoped and authoritative for development automation.
- Ephemeral Plan Steps never masquerade as authoritative Workflow Nodes.

### Workflow Panel

The compact panel shows:

- Workflow stage spine and milestone
- Current checkpoint or attention state
- Runnable Ticket Frontier and active runs
- Newly synchronized changes
- Compact progress for parent nodes
- Open-workspace and node-inspector actions

Immediate children may expand inline. The panel does not embed a pan-and-zoom canvas.

### Workflow Workspace

- Uses a layered Compound Workflow Graph rather than a flat task graph.
- Uses a deterministic left-to-right DAG layout.
- Preserves existing node positions as updates arrive.
- Does not use continuous physics, repainting animation, or automatic viewport jumps.
- Highlights new, changed, active, blocked, Stale, checkpoint, recovery, and decision states.
- Keeps existing identity and expansion state when new nodes arrive.
- Shows a `New since last viewed` summary and clears markers only after viewing or acknowledgement.
- Keeps completed and cancelled history collapsible and retrievable.
- Provides a synchronized, complete, keyboard-accessible Workflow Outline.
- Respects reduced-motion preferences.

### Scale

- The Workflow Outline retains the complete graph.
- The canvas uses a bounded Visual Projection of the selected stage, frontier, and nearby dependency context.
- Boundary nodes show hidden-node counts and continuation direction.
- Filters and expansion reveal more regions intentionally; T3 never omits graph state silently.

### Interaction

- Selecting a node is side-effect-free and opens its Node Inspector.
- The inspector shows evidence, history, Artifact Lineage, linked thread, diff/review summaries, and current Allowed Actions.
- Start, Hold, Resume, Stop, recovery, inclusion, repair, refresh, archive, cleanup, and publication remain named actions.
- Destructive or authority-expanding actions require confirmation.
- Pointer, keyboard, and touch follow the same action model.

### Surfaces and entry points

- Web and desktop provide graph plus outline.
- Mobile provides the complete outline, inspector, checkpoints, and all controls; phone canvas is out of scope for v1.
- Invocation and reopening are available through the Attachment Hint, Workflow tab/screen, command palette on web/desktop, and thread action menu on every client.
- A keybinding may open Workflow View but never start work directly.
- Settings owns provider defaults and Automation Capacity, not workflow creation.

## State and Server Architecture

### Orthogonal Node State

Node truth is composed rather than represented by one flat status enum:

- Lifecycle: pending, running, terminal
- Outcome: completed or cancelled
- Eligibility: runnable, blocked, Stale, or capability-blocked
- Scheduling: active or held
- Attention: none, checkpoint, recovery, or decision

The server derives display labels and Allowed Actions. Clients do not reproduce transition rules.

### Orchestration

- Contracts define typed commands, events, receipts, snapshots, and deltas.
- A pure server decider validates commands and emits persisted events.
- A projector derives the Workflow Projection, Node State, Run Scope, Ticket Frontier, and Allowed Actions.
- Queue-backed reactors perform provider, tracker, and Git effects and emit typed receipts.
- Every mutation carries an Action Identity and expected Workstream version.
- Duplicate identities return the recorded result without repeating effects.
- Stale-version commands return the latest projection and require intentional retry.

### Remote transport

- Opening a Workstream returns one bounded snapshot.
- Sequenced graph deltas update it afterward.
- Sequence gaps trigger snapshot resynchronization.
- Full artifacts, diffs, review findings, and history load lazily through Node Inspector.
- Disconnected clients retain a readable cached projection but cannot queue workflow mutations.
- Reconnection refreshes server and tracker state before controls re-enable.

## Archival and Cleanup

- **Archive Workstream** drains active work, stops observation and dispatch, and retains graph, artifacts, linked threads, branches, diffs, receipts, and history read-only.
- Reopening restores the same Workstream.
- After Merged, **Clean up workflow resources** previews every target.
- Cleanup removes only resources created and still owned by the Workstream.
- Unexpected or uncommitted changes block cleanup.
- Local and remote branch deletion are separately optional.
- Cleanup never removes durable Workstream history.

## User Stories

1. As a user, I want to attach a Development Workflow explicitly to an existing Wayfinder thread so that T3 never guesses when automation should begin.
2. As a user, I want existing Wayfinder artifacts backfilled so that attaching after planning has started does not lose context.
3. As a user, I want the graph to observe structured Wayfinder progress so that new decisions appear without replacing earlier work.
4. As a user, I want new graph nodes highlighted without viewport jumps so that I retain spatial and conversational context.
5. As a user, I want Plan and Workflow views separated so that provider checklists are not confused with authoritative execution state.
6. As a user, I want native skill checkpoints preserved so that automation never makes product or publication decisions for me.
7. As a remote user, I want to resolve a checkpoint from any connected client so that work does not depend on the originating device.
8. As a user, I want one-click Run workflow automation within a visible Run Scope so that expected stages progress without repeated start actions.
9. As a user, I want later additions excluded until I include them so that an existing authorization cannot grow silently.
10. As a user, I want unblocked tickets implemented concurrently in isolated worktrees so that independent work finishes sooner without corrupting shared state.
11. As a user, I want direct chat work prioritized over queued automation so that background workflows do not make T3 feel unresponsive.
12. As a user, I want each ticket reviewed before integration so that downstream work never builds on unreviewed changes.
13. As a user, I want bounded automatic correction and conflict repair so that routine findings resolve automatically without infinite loops.
14. As a user, I want interrupted work preserved for recovery so that Stop never destroys potentially valuable changes.
15. As a user, I want tracker-owned blockers repaired canonically so that the graph never diverges from the system of record.
16. As a user, I want tickets closed only after reviewed integration so that tracker progress matches shared baseline progress.
17. As a user, I want one draft PR for the integrated Workstream so that reviewers see the coherent product change.
18. As a user, I want the Workflow PRD to close on PR merge so that publication is not mistaken for completion.
19. As a mobile user, I want full outline and control parity so that I can manage workflows remotely without an unusable miniature canvas.
20. As a user with several efforts, I want multiple Workstreams to share environment capacity fairly so that future parallel workflows do not require a new state model.

## Testing Decisions

The primary public TDD seam is:

> Dispatch a typed workflow command, drain its receipt-backed effects, then inspect the resulting Workflow Projection.

Tests through this seam cover:

- Command invariants, optimistic version checks, and Action Identity deduplication
- Explicit attachment, structured Wayfinder backfill, cursor replay, and archival
- Run Scope, Ticket Batch inclusion, Scope Changes, Artifact Lineage, and Stale propagation
- Orthogonal Node State, Ticket Frontier, parent aggregation, blocker semantics, and Allowed Actions
- Native checkpoints and first-response-wins behavior across clients
- Provider capability gating and immutable Provider Assignment after dispatch
- Environment Automation Capacity, fair scheduling, and draining pause
- Pre-accept retry versus Accepted Run recovery
- Four-cycle Must-Fix correction bounds
- Automatic single Integration Repair Run and serialized integration
- Tracker closure, dependent release, Locally Integrated, Publication, Published for Review, and passive Merged projection
- Snapshot/delta sequencing, gap recovery, lazy inspector details, and disconnected read-only behavior

Provider, tracker, and Git dependencies use in-memory adapters behind their real seams. Client tests assert rendering and dispatch of server-projected Allowed Actions; they do not reproduce orchestration rules. Focused integrated verification covers web, desktop wrapping web, and the mobile outline/control path when implementation is authorized.

## Acceptance Criteria

1. An observed structured Wayfinder invocation shows one dismissible attachment hint and prose mentions do not.
2. Confirmed attachment backfills existing structured artifacts and follows later events without duplicate nodes.
3. The Plan view remains thread-local and the Workflow view remains Workstream-scoped.
4. New nodes preserve existing graph identity, layout, expansion, history, and user focus.
5. Nodes outside Run Scope cannot dispatch until explicitly included, except the exact approved Ticket Batch.
6. Missing or changed Required Skills create Capability Blocks and never trigger prompt emulation.
7. Workflow checkpoints resolve idempotently from web, desktop, or mobile.
8. The scheduler never exceeds environment capacity, prioritizes explicit user work, and fairly serves multiple Workstreams.
9. Pause drains; Hold prevents dispatch; Stop interrupts and preserves recoverable state.
10. Side-effectful failures never retry automatically.
11. Only Executable Nodes run; cancelled required work never satisfies a parent or blocker.
12. Ticket dependents remain blocked until reviewed integration, tracker closure, and synchronization all succeed.
13. Must-Fix Findings receive at most four automatic Correction Cycles.
14. A merge conflict receives one automatic Integration Repair Run, validation, and renewed review.
15. Tracker unavailability leaves cached state readable but disables new workflow mutations.
16. Publication cannot begin before Locally Integrated and explicit preview approval.
17. Publication pushes one Workstream Baseline and creates one draft PR linked to close the Workflow PRD on merge.
18. PR creation reports Published for Review; only synchronized PR merge and PRD closure report Merged.
19. Mobile exposes the complete outline, inspector, checkpoints, and Allowed Actions without requiring the canvas.
20. Archive and cleanup never delete unexpected changes or durable Workstream history.

## Out of Scope

- A general workflow builder, arbitrary skill chains, or saved workflow templates
- Cross-Workstream dependency edges, portfolio dashboards, or bulk controls
- Semantic/fuzzy Plan Step identity inference
- Parsing assistant prose for workflow state
- Local overrides of tracker-owned blockers
- Continuous physics-based graph layout
- Phone canvas in v1
- Offline mutation queues
- Automatic PR merge or deployment
- Automatic post-publication CI or review fixes
- Automatic deletion of worktrees, branches, or history
