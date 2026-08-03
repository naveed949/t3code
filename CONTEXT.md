# T3 Code

T3 Code presents durable coding-agent conversations and work across web, desktop, and mobile clients.

## Planning

**Plan View**:
The thread-scoped right-panel view of the provider's current Plan Steps.
_Avoid_: Workflow graph, task manager

**Workflow View**:
The Workstream-scoped right-panel view of durable Workflow Stages, tickets, progress, checkpoints, and execution controls.
_Avoid_: Plan sidebar, todo list

**Workflow Panel**:
The compact Workflow View showing the stage spine, current checkpoint, and runnable Ticket Frontier alongside a thread.
_Avoid_: Dependency canvas, workflow editor

**Workflow Workspace**:
The expanded Workflow View for the complete dependency graph, history, filtering, and detailed controls.
_Avoid_: Side panel, plan modal

**Compound Workflow Graph**:
The layered Workstream visualization whose stage containers preserve distinct Wayfinder decisions, tracker tickets, and execution runs while connecting them through Artifact Lineage.
_Avoid_: Flat task graph, plan tree

**Workflow Outline**:
The keyboard-accessible hierarchical representation synchronized with the Compound Workflow Graph.
_Avoid_: Fallback view, screen-reader-only list

**Visual Projection**:
The bounded canvas subset containing the selected stage, Ticket Frontier, nearby dependencies, and explicit boundary summaries while the Workflow Outline retains the complete graph.
_Avoid_: Truncated graph, authoritative subset

**Node Inspector**:
The detail view for a selected graph node, including its evidence, linked thread, state-appropriate controls, and history.
_Avoid_: Context menu, execution shortcut

**Node State**:
The independent lifecycle, outcome, eligibility, scheduling, and attention facts from which T3 derives a node's displayed status and allowed actions.
_Avoid_: Status string, UI state

**Workflow Projection**:
The server-derived Workstream graph, Node States, evidence summaries, and allowed actions rendered consistently by every client.
_Avoid_: Client model, local graph state

**Allowed Action**:
A command the server projection declares valid for a node in its current Node State and authority context.
_Avoid_: Enabled button, optimistic capability

**Action Identity**:
The unique identity used to make one workflow mutation idempotent across clients, reconnects, and repeated dispatch.
_Avoid_: Request timestamp, button click

**Development Workflow**:
An ordered progression from product uncertainty to a published reviewed change: Wayfinder, Specification, Ticketing, ticket-by-ticket Implementation, then Publication.
_Avoid_: Skill chain, task list

**Workstream**:
A durable body of related work that owns one Development Workflow and links all threads and runs contributing to it.
_Avoid_: Thread, project

**Archived Workstream**:
A read-only Workstream that no longer observes Wayfinder Data or dispatches work but retains its graph, artifacts, threads, branches, diffs, and history for reopening.
_Avoid_: Deleted workflow, detached thread

**Origin Thread**:
The explicitly selected Wayfinder thread to which a new Development Workflow is attached without moving or replacing that thread.
_Avoid_: Active thread, workflow thread

**Workflow Attachment**:
The unique durable link through which one Workstream backfills existing Wayfinder artifacts and observes later Wayfinder progress from its Origin Thread.
_Avoid_: Thread conversion, message import

**Attachment Hint**:
A dismissible, once-per-thread invitation to attach an observed Wayfinder Skill Run to a Development Workflow.
_Avoid_: Automatic attachment, recurring prompt

**Wayfinder Data**:
Structured artifacts and durable activities emitted by a Wayfinder Skill Run and eligible to populate an attached Workstream graph.
_Avoid_: Assistant prose, inferred readiness

**Workflow Goal**:
The user-confirmed outcome that bounds a Development Workflow and gives its stages shared intent.
_Avoid_: Initial prompt, ticket title

**Workstream Baseline**:
The dedicated local integration branch against which a Workstream's unfinished Ticket Implementations are based and into which reviewed work is integrated.
_Avoid_: Main branch, ticket branch

**Fixed Point**:
The user-confirmed source revision from which a Workstream Baseline and its Ticket Implementations begin.
_Avoid_: Latest main, merge base

**Baseline Refresh**:
An explicit operation that drains active work, previews newer source changes, updates the Workstream Baseline, and revalidates affected integrated work.
_Avoid_: Background pull, automatic rebase

**Workflow Run**:
One execution of a Development Workflow within a Workstream.
_Avoid_: Thread, session

**Run Scope**:
The Workflow Stages and tracker nodes explicitly authorized for dispatch by a Workflow Run.
_Avoid_: Entire Workstream, latest graph

**Scope Change**:
A synchronized addition or relationship change outside the current Run Scope that remains visible but cannot dispatch until explicitly included.
_Avoid_: Plan replacement, automatic update

**Ticket Batch**:
The exact tickets and graph edges proposed by a Ticketing stage for one approved publication and Run Scope expansion.
_Avoid_: Future tickets, tracker snapshot

**Workflow Checkpoint**:
A point where a Workflow Run cannot advance without user input, approval, failure recovery, or an explicit resume.
_Avoid_: Stage boundary, notification

**Skill Checkpoint**:
A Workflow Checkpoint required by a Required Skill's native process, such as confirming test seams or approving ticket granularity and blocker edges.
_Avoid_: Optional prompt, T3-added gate

**Checkpoint Request**:
The single durable structured request through which any connected client may resolve a Workflow Checkpoint.
_Avoid_: Device prompt, thread-local question

**Draining Pause**:
A Workflow Run state that dispatches no new work while already active runs continue until they complete or reach a Workflow Checkpoint.
_Avoid_: Interrupt, stop

**Scheduling Hold**:
A user-controlled state that prevents an otherwise eligible Workflow Node from being dispatched. Removing the hold does not itself start the work.
_Avoid_: Suspended turn, stopped run

**Stopped Run**:
A provider run interrupted while active, with its linked thread and workspace retained for explicit recovery.
_Avoid_: Paused run, cancelled work

**Needs Recovery**:
A Workflow Checkpoint after a Stopped Run where retained thread and workspace evidence must be inspected, resumed, cancelled, or explicitly restored.
_Avoid_: Failed, rolled back

**Accepted Run**:
A provider run whose dispatch has been acknowledged, after which T3 must assume workspace side effects may exist.
_Avoid_: Queued run, completed run

**Needs Decision**:
A Workflow Checkpoint where a cancelled required child or blocker prevents valid automatic completion or progression.
_Avoid_: Completed with warnings, failed

**Cancelled Node**:
A terminal Workflow Node whose intended outcome was not delivered. It does not satisfy parent completion or blocker edges.
_Avoid_: Completed, skipped

**Runnable**:
A Workflow Node whose prerequisites are satisfied and which is not already running, completed, cancelled, or held.
_Avoid_: Pending, ready-for-agent

**Workflow Stage**:
A named phase of a Development Workflow that produces the inputs required by a later phase.
_Avoid_: Plan Step, pipeline task

**Workflow Artifact**:
A durable, versioned output that a Workflow Stage hands to later stages with its source Workstream and run provenance.
_Avoid_: Assistant message, completion claim

**Artifact Lineage**:
The versioned relationship from each Workflow Artifact to the exact upstream artifacts from which it was produced.
_Avoid_: File history, conversation order

**Stale**:
A downstream artifact or node whose Artifact Lineage no longer points to the current authorized upstream version.
_Avoid_: Failed, outdated display

**Completion Receipt**:
A typed record that confirms a Workflow Stage reached its required durable outcome.
_Avoid_: Success message, inferred status

**Required Skill**:
A provider-exposed skill whose verified identity is pinned to a Workflow Stage before that stage may run.
_Avoid_: Injected prompt, simulated skill

**Provider Assignment**:
The provider instance selected for one not-yet-started Workflow Stage or Ticket Implementation, inherited from the Workflow Run default unless explicitly overridden.
_Avoid_: Active provider switch, workflow owner

**Capability Block**:
A Workflow Checkpoint caused by a Required Skill being missing or no longer matching its pinned identity.
_Avoid_: Provider error, unsupported workflow

**Plan Step**:
A provider-authored checklist item displayed in the thread-local Plan View. It is not authoritative Workstream state.
_Avoid_: Task, Workflow Node

**Workflow Node**:
A durable typed entry in the Compound Workflow Graph, such as a Workflow Stage, tracker ticket, or execution run.
_Avoid_: Plan Step, task

**Aggregate Node**:
A Workflow Node that groups children and summarizes their progress without dispatching agent work directly.
_Avoid_: Parent task, executable parent

**Executable Node**:
A leaf Workflow Node eligible to dispatch agent work when it is Runnable.
_Avoid_: Subtask, child task

**Ticket Implementation**:
The work for one unblocked ticket, including its required Code Review completion gate.
_Avoid_: Implement stage, implementation task

**Correction Cycle**:
One fresh correction run in a Ticket Implementation's existing worktree followed by Code Review against the original Fixed Point.
_Avoid_: Retry, resumed review

**Integration Repair Run**:
An automatically dispatched run that resolves a ticket's conflict with the current Workstream Baseline before validation and Code Review run again.
_Avoid_: Manual merge, correction retry

**Must-Fix Finding**:
A Code Review finding grounded in repository standards or the ticket specification that prevents integration until corrected or explicitly resolved.
_Avoid_: Suggestion, preference

**Integrated Ticket**:
A ticket whose reviewed changes have been incorporated into the Workstream Baseline and whose tracker record has been closed and synchronized. Only an Integrated Ticket satisfies blocker edges for dependent tickets.
_Avoid_: Reviewed ticket, implemented ticket

**Locally Integrated**:
A Workflow Run milestone where every in-scope ticket is integrated and validated in the Workstream Baseline with no unresolved or Stale work.
_Avoid_: Published, merged, shipped

**Publication**:
The final Workflow Stage that pushes the Workstream Baseline and creates its pull request after explicit approval.
_Avoid_: Integration, deployment

**Published for Review**:
A Workflow Run milestone where its Workstream Baseline has been pushed and a draft pull request has been created with a closing relationship to the Workflow PRD.
_Avoid_: Completed, merged, shipped

**Merged**:
A passive Workstream milestone confirmed after its published pull request merges and tracker synchronization confirms Workflow PRD closure.
_Avoid_: Published for Review, deployed

**Follow-Up Run**:
A separately authorized future Workflow Run for selected post-publication CI or review feedback.
_Avoid_: Automatic PR babysitting, resumed publication

**Workflow PRD**:
The tracker issue describing the Development Workflow's complete product change, kept open while its implementation tickets are integrated.
_Avoid_: Parent ticket, Workflow Goal

**Ticket Frontier**:
The set of unfinished tickets whose blockers have been completed and which are therefore eligible for implementation.
_Avoid_: Queue, next ticket

**Tracker Projection**:
T3's synchronized, locally readable view of tracker-owned tickets, parentage, status, and blocker edges.
_Avoid_: Ticket database, cached truth

**Graph Repair**:
An approved tracker mutation that resolves a Needs Decision state by replacing or cancelling required work or changing canonical graph edges.
_Avoid_: Local waiver, force unblock

**Synchronization Health**:
Whether the Tracker Projection is current enough to authorize new Workflow Run actions.
_Avoid_: Online status, last refreshed

**Disconnected View**:
A readable cached Workflow Projection whose mutation controls remain disabled until environment and tracker synchronization recover.
_Avoid_: Offline mode, queued workflow

**Execution Limit**:
The maximum number of isolated Ticket Implementations a Workflow Run may execute concurrently.
_Avoid_: Worker count, thread limit

**Automation Capacity**:
The environment-wide maximum number of provider runs that Workflow Runs may execute concurrently.
_Avoid_: Workstream limit, provider quota

**Dispatch Priority**:
The ordering rule that gives explicit user-started work precedence over queued automation and shares remaining Automation Capacity fairly across Workstreams.
_Avoid_: Ticket priority, provider priority
