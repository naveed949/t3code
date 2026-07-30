import { ApprovalRequestId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  blockedGitHubMutationDetail,
  hasActiveWayfinderDraft,
} from "./WayfinderDraftMutationGuard.ts";

const requestId = ApprovalRequestId.make("request:github");
const started = {
  kind: "wayfinder.draft.started",
  payload: { canonical: false },
};

describe("WayfinderDraftMutationGuard", () => {
  it.each([
    "gh issue create --title map",
    "gh issue comment 5 --body draft",
    "gh api --method PATCH repos/acme/repo/issues/5 -f state=closed",
    "gh api repos/acme/repo/issues -f title=Draft",
    "curl -X POST https://api.github.com/repos/acme/repo/issues",
    'mcp__github__create_issue {"title":"Draft"}',
  ])("blocks GitHub mutation commands while an unpublished draft is active: %s", (detail) => {
    expect(
      blockedGitHubMutationDetail(
        [
          started,
          {
            kind: "approval.requested",
            payload: { requestId, requestKind: "command", detail },
          },
        ],
        requestId,
      ),
    ).toBe(detail);
  });

  it("allows read-only GitHub commands and stops guarding after publication", () => {
    expect(
      blockedGitHubMutationDetail(
        [
          started,
          {
            kind: "approval.requested",
            payload: { requestId, requestKind: "command", detail: "gh issue view 5" },
          },
        ],
        requestId,
      ),
    ).toBeNull();
    expect(
      hasActiveWayfinderDraft([
        started,
        { kind: "wayfinder.draft.published", payload: { issue: 5 } },
      ]),
    ).toBe(false);
  });
});
