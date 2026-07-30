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

Continuing an existing Wayfinder map synchronizes a read-only projection from GitHub. The Workbench
shows the destination, notes, decisions, fog of war, out-of-scope entries, native child tickets and
dependencies, claims, issue states, canonical links, and the last synchronization time. Its frontier
contains only open, unblocked, unclaimed tickets.

The initial read-only slice supports up to 100 child tickets, labels, assignees, or native
dependency relationships per GitHub connection. T3 blocks continuation with a specific remediation
instead of displaying an incomplete map when GitHub reports more results.

On web and desktop, the Workbench opens in the resizable right panel and supports the panel's
maximize control. The dependency graph uses a deterministic, non-animated layout and the ticket list
puts the frontier first. On mobile, linked threads expose a full-screen Wayfinder route with the same
frontier-first list and an optional compact graph. Reopening the same canonical GitHub map creates a
new Skill Run in the existing project Workstream.

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
