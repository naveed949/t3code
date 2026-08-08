# Workflow Workspace

The Workflow Workspace gives you a visual view of a Development Workflow while keeping the
complete Workflow Outline available for keyboard navigation and inspection.

## Visual projection

Open **Workflow Workspace** from the compact Workflow Panel when you want the graph. The graph is
a bounded projection of the selected workflow region. It starts with the current frontier and
nearby dependencies, then shows stage containers, workflow milestones, tickets, and active
execution runs. Tickets outside the projection are never discarded: the workspace reports how many
are hidden and identifies connected upstream or downstream regions when available.

Use **Visual region** to switch between the frontier, all projected nodes, active work, and nodes
that need attention. Expand the ticket stage or all regions when you want to reveal more context.

## Selecting and inspecting nodes

Selecting a ticket in the graph, frontier, or outline keeps the other views synchronized and opens
the same Node Inspector. The inspector shows the ticket's evidence, history, lineage, linked
thread, and currently allowed actions. Selecting a node only changes the view; it does not start
or alter workflow work.

The graph uses stable positions as new workflow data arrives. Active, blocked, stale, new, changed,
checkpoint, recovery, and decision states are called out in the visual projection and accessible
labels.

Mobile keeps the complete outline and inspector rather than showing the graph canvas.

## Ticket implementation and review

After a Workflow Run is confirmed and a ticket is executable, its Node Inspector offers **Start
implementation**. T3 records the isolated worktree, linked implementation thread, provider and
skill identities, Fixed Point, validation, diff summary, and Code Review outcome in the Workflow
Projection. Dispatching, implementation, review, reviewed, correction, and failure milestones stay
visible while the work progresses.

Code Review is a required child of the implementation. A completed provider turn remains in review
until it supplies structured review evidence; ordinary prose does not mark the ticket reviewed.
A reviewed ticket still awaits downstream integration, so it does not release dependent tickets by
itself.

## Stopping and recovering an implementation

Use **Stop** when an accepted provider run should be interrupted. Stop does not pause the run or
roll back its work. T3 retains the linked implementation thread, isolated worktree, checkpoints,
and available diff while the provider reports its typed terminal outcome.

The node then shows **Needs Recovery**. Open **Inspect retained work** to review the retained
thread and changes, or choose **Resume** to start the pinned implementation or review step again
in the same worktree. **Cancel with changes** is terminal: it keeps the worktree and diff but does
not satisfy the ticket or release dependents. When a ready checkpoint is available, **Restore
checkpoint** requires confirmation before changing the retained worktree. Recovery actions are
explicit and stale or duplicate requests are rejected safely; the Workflow Projection remains the
source of truth for the current state.

A reviewed ticket then enters the serialized integration lane. T3 merges its dedicated ticket
worktree into the confirmed Workstream Baseline, records focused validation, closes the canonical
tracker issue, and synchronizes the Tracker Projection. Dependents remain blocked until all of
those milestones succeed. If tracker closure fails, the inspector exposes **Retry tracker
closure**; retrying resumes tracker synchronization without replaying the successful merge or
validation.
