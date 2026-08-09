# Confirming a Development Workflow Run

After attaching a Development Workflow, the workflow card lets you prepare a
Run before any provider, repository, tracker, push, or pull-request effect is
started.

The read-only preflight shows the exact Workflow Goal and Run Scope, the
selected default provider and any undispatched node override, Required Skill
availability, Fixed Point, Workstream Baseline, Remote Target, execution
limit, environment capacity, and the authority that confirmation will grant.
For the development workflow, confirmation authorizes tracker mutation so
reviewed tickets can close and synchronize after baseline integration. Push
and draft pull-request creation remain separate, ungranted approvals.

The server re-discovers each selected provider's Required Skills and pins their
content digests; client-provided capability claims are never trusted. It also
checks the Fixed Point, Baseline ancestry, and remote branch against the
repository without changing it. Preflight can be blocked when a required
provider skill is missing or changed, when a scope node is not in the projected
graph, or when any repository target cannot be verified. Resolve the displayed
condition and run preflight again. Confirmation is accepted only for the exact
configuration that was preflighted; discovering later graph work never expands
that authority.

The environment capacity is two concurrent nodes. A Workstream may choose a
lower execution limit. Confirmed provider and Required Skill identities are
retained for dispatch and cannot be changed by a later client update.

Use **Run workflow** to advance only executable tickets in the confirmed Run
Scope. Independent tickets may run concurrently in isolated worktrees, while
explicit user-started work keeps priority and remaining capacity is shared
fairly between Workstreams. **Pause workflow** drains active work: it stops new
dispatch until each active implementation finishes or reaches a Workflow
Checkpoint. A per-node **Hold** blocks future dispatch; releasing the Hold makes
the node eligible again but does not start it. **Resume workflow** rechecks
scope, blockers, capabilities, holds, and capacity before dispatching anything.

See [Refreshing a Development Workflow Baseline](workflow-baseline-refresh.md)
when the Workstream Baseline has incoming commits that need an explicit
preview, drain, and revalidation pass.
