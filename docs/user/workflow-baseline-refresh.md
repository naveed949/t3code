# Refreshing a Development Workflow Baseline

A confirmed Development Workflow keeps its Workstream Baseline explicit. Use
**Preview incoming commits** on the attached workflow card to inspect the
commits, changed files, and integrated or Stale Tickets that may be affected.
The preview records the current baseline and the exact source commit it found.

Review the preview before selecting **Confirm baseline refresh**. Confirmation
does not refresh the baseline immediately: T3 first drains active Ticket
Implementations and pauses new automatic dispatch. Once the drain completes,
the server checks that the confirmed source commit is still current, fast-
forwards the Workstream Baseline, and revalidates every affected integrated
Ticket before dispatch resumes.

If the source moved, the baseline could not fast-forward, or a revalidation
failed, the refresh enters **Needs Recovery**. T3 preserves the preview,
failure, validation evidence, and any Stale Ticket markings; it does not
silently rewrite the baseline or continue dispatch. Inspect the retained
checkpoint and resolve the reported condition before starting another explicit
refresh.
