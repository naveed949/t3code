# Skills

Installed provider skills appear in the composer picker. Selecting one inserts its canonical
`$skill-name` token. A turn is treated as an explicit skill invocation only when that token is the
first non-whitespace content in the message; mentioning a skill in ordinary prose does not start a
skill run.

T3 pins the selected skill's name, path, and content digest when the turn starts. The official,
verified Wayfinder skill runs through the Codex and Claude native skill mechanisms. Other providers,
unregistered skills, and locally modified Wayfinder content continue as ordinary provider prompts
with a truthful generic fallback.

Wayfinder offers explicit **New**, **Continue**, and **Generic** launch choices. Continue requires one
issue number or GitHub issue URL; T3 never guesses between references. Before a native launch, the
environment-owning server checks the installed skill, provider, GitHub remote and CLI authentication,
issue permissions and labels, native issue relationships, and repository instructions. A failed
check returns its remediation without creating or changing GitHub issues. Generic execution remains
available when native preflight cannot succeed. Composer syntax works on every client:
`$wayfinder new-map`, `$wayfinder continue-map #42`, or `$wayfinder generic ...`.

The resulting skill-run identity is part of the shared project snapshot and links back to its
originating thread, so web, desktop, and mobile clients retain the same run after later turns and
after reconnecting.

Continuing an existing Wayfinder map synchronizes a projection from GitHub. The Workbench
shows the destination, notes, decisions, fog of war, out-of-scope entries, native child tickets and
dependencies, claims, issue states, canonical links, and the last synchronization time. Its frontier
contains only open, unblocked, unclaimed tickets.

The initial read-only slice supports up to 100 child tickets, labels, assignees, or native
dependency relationships per GitHub connection. T3 blocks continuation with a specific remediation
instead of displaying an incomplete map when GitHub reports more results.

While a published Workbench is visible, T3 reconciles it when the view opens, the environment
reconnects, the app regains focus, the user presses **Refresh**, and periodically while the map stays
visible. Periodic checks first compare lightweight GitHub revision evidence and only reload the full
graph when canonical issue, comment, assignment, state, child, or blocking data changed. The
Workbench always shows the last successful synchronization time.

If GitHub cannot be reached or returns only a partial graph, the last synchronized map remains
available as a cached read-only view and canonical mutation controls are disabled; T3 does not queue
those mutations for later replay. A native action carrying stale expected-revision evidence enters a
visible conflict state instead of overwriting GitHub. Refreshing after connectivity or conflict
reconciles canonical state before readiness and the frontier are derived again, so reopening a
decision ticket makes its Workstream active again.

On web and desktop, the Workbench opens in the resizable right panel and supports the panel's
maximize control. The dependency graph uses a deterministic, non-animated layout and the ticket list
puts the frontier first. On mobile, linked threads expose a full-screen Wayfinder route with the same
frontier-first list and an optional compact graph. Reopening the same canonical GitHub map creates a
new Skill Run in the existing project Workstream. Before that resumed provider turn starts, native
preflight reloads GitHub and the project Workstream snapshot; the new run records a healthy
`resume` synchronization result. Active linked runtime work and synchronization health are included
when the shared clients recompute whether the Workstream is complete.

A native **New** run starts with a visible unpublished draft. The draft is explicitly non-canonical:
T3 does not create or change GitHub issues, labels, assignments, comments, or relationships while
the map is being charted. Wayfinder presents one Decision Card at a time, including its recommended
choice and reasoning when available, while still accepting a custom answer. Agent proposals remain
separate from confirmed decisions until the answer is recorded. The draft and its structured
decision receipts are rebuilt from persisted run and transcript state after restart, reconnect, or
continuation on another web, desktop, or mobile client.

Once the draft has a destination, at least one decision ticket, and no pending Decision Card, the
Workbench can publish it to GitHub. Publication follows the thread's runtime permission mode:
approval-required threads show a separate confirmation step, while full-access threads begin after
the publish action. Web, desktop, and mobile show the exact current step until GitHub receipts and a
canonical graph reconciliation complete. A failed step keeps every verified issue and relationship
identity and offers an idempotent resume instead of starting over. Only successful reconciliation
removes draft authority and switches the Workbench to the synchronized GitHub graph.

After publication, the Workbench offers structured controls for its Wayfinder fields, decision
tickets, ticket classifications and states, resolutions, and dependency relationships. These are
not general GitHub issue controls; the canonical issue link remains available for exceptional
administration. Each action follows the thread's runtime permission mode, shows its own pending or
in-flight state, and applies optimism only to that action. The server performs the write with the
environment's GitHub credentials, then confirms or corrects the client from a mutation receipt and
a fresh canonical reconciliation. The same actions are available in web, desktop, and mobile.

An open, unblocked, unclaimed frontier ticket also offers **Start work**. T3 first rechecks the
canonical GitHub frontier and assigns the current GitHub user, then creates one deterministic,
project-owned thread linked to the Workstream, source Skill Run, and ticket. The first turn is
seeded with the destination, prior resolutions, ticket question and classification, canonical
links, and the pinned skill identity. Separate frontier tickets may run concurrently.

The claim reports success only after both the canonical assignment and local thread linkage are
known. If GitHub accepted the assignment but thread startup was interrupted, the Workbench keeps
that partial state visible and offers **Retry thread linkage**. Retrying reuses the same thread;
**Return to thread** opens an existing link, **Release** removes the current GitHub user's
assignment, and **Reclaim** reconnects a released ticket without creating a duplicate. These
controls and their persisted links survive reconnect on web, desktop, and mobile.
