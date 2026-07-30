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
