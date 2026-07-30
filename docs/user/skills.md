# Skills

Installed provider skills appear in the composer picker. Selecting one inserts its canonical
`$skill-name` token. A turn is treated as an explicit skill invocation only when that token is the
first non-whitespace content in the message; mentioning a skill in ordinary prose does not start a
skill run.

T3 pins the selected skill's name, path, and content digest when the turn starts. The official,
verified Wayfinder skill runs through the Codex and Claude native skill mechanisms. Other providers,
unregistered skills, and locally modified Wayfinder content continue as ordinary provider prompts
with a truthful generic fallback.

The resulting skill-run identity is part of the shared thread snapshot, so web, desktop, and mobile
clients see the same run after reconnecting.
