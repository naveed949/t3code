# Workflow publication

Workflow publication is a server-owned, event-sourced stage after reviewed
Ticket integration. The client sends a typed preflight command, confirmation
command, or read-only reconciliation command. The decider records the exact
publication projection and rejects stale Workstream versions; it does not run
Git or provider effects.

The publication processor resolves the dedicated Workstream Baseline
workspace, verifies the tracker and target evidence, and previews the clean
Git range from the recorded Fixed Point. The preview contains the remote,
head and target branches, baseline SHA, complete commit list, title, body, and
authority. Confirmation grants only push and draft-pull-request authority.

Before a confirmed push, the processor repeats the Git preview and requires
the baseline SHA and ordered commit list to match the approved projection.
Provider reconciliation matches the exact head and base branches, title,
baseline head SHA, same-repository source, and draft state before adopting a
pull request. A create failure or restart is therefore recoverable without
blindly repeating side effects.

After publication, reconciliation reads the provider pull request and reloads
the canonical Workflow PRD tracker map. Checks and review state are projected
when the provider supplies them; unavailable provider fields remain unknown.
Tracker refresh failures are fail-closed and cannot project closure from a
cached state. Only a merged pull request plus a freshly observed closed PRD
can transition the projection to `merged`.

The workflow publication reactor emits typed progress receipts and dispatches
only internal publication updates. It has no merge, deploy, CI-fix, review-
response, or follow-up-push operation. Provider-specific draft flags remain at
the SourceControlProvider boundary and are translated by each supported
adapter.
