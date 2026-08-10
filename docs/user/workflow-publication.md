# Publishing a Development Workflow for Review

When every in-scope Ticket is reviewed and integrated into the Workstream
Baseline, the Workflow card can prepare one coherent draft pull request.
Publication is deliberately separate from implementation: it does not close
the Workflow PRD, merge code, deploy, or make follow-up changes.

Select **Preview publication** to see the exact remote, head branch, target
branch, baseline commit, commits, pull request title, pull request body, and
the two authorities that would be granted: pushing the Workstream Baseline
and creating a draft pull request. The preview is read-only. T3 blocks it when
the Workflow Run, tracker synchronization, target verification, baseline
refresh, or integrated Ticket evidence is incomplete.

After reviewing the exact preview, select **Publish draft pull request**. T3
rechecks the Workstream before pushing and creating the draft. If the branch
changed, the provider call failed, or the result cannot be verified, the card
shows **Needs Recovery** and preserves the failure for an explicit retry.
Retries reconcile an existing pull request before attempting another push, so
an interrupted publication does not create duplicates.

Once the draft is visible, the card shows **Published for Review** and links
to the pull request. T3 passively observes its checks, reviews, and merge state
alongside a fresh Workflow PRD tracker read. It never merges, deploys,
automatically fixes checks or review feedback, or pushes follow-up commits.

The Workflow reaches **Merged** only after the pull request is merged and the
Workflow PRD is confirmed closed by tracker synchronization. A later change
requires a separately authorized Follow-Up Run.
