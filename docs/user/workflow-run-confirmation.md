# Confirming a Development Workflow Run

After attaching a Development Workflow, the workflow card lets you prepare a
Run before any provider, repository, tracker, push, or pull-request effect is
started.

The read-only preflight shows the exact Workflow Goal and Run Scope, the
selected default provider and any undispatched node override, Required Skill
availability, Fixed Point, Workstream Baseline, Remote Target, execution
limit, environment capacity, and the authority that confirmation will grant.

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
