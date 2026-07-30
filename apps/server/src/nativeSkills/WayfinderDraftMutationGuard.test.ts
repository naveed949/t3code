import { ApprovalRequestId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  blockedWayfinderDraftApprovalDetail,
  hasActiveWayfinderDraft,
} from "./WayfinderDraftMutationGuard.ts";

const requestId = ApprovalRequestId.make("request:github");
const started = {
  kind: "wayfinder.draft.started",
  payload: { canonical: false },
};

describe("WayfinderDraftMutationGuard", () => {
  it.each([
    "gh issue view 5",
    "npm test",
    'mcp__github__add_issue_comment {"body":"Draft"}',
    "node indirect-github-script.js",
  ])("blocks every executable approval while an unpublished draft is active: %s", (detail) => {
    expect(
      blockedWayfinderDraftApprovalDetail([
        started,
        {
          kind: "approval.requested",
          payload: { requestId, requestKind: "command", detail },
        },
      ]),
    ).toBe("provider action");
  });

  it("stops guarding after publication", () => {
    expect(
      blockedWayfinderDraftApprovalDetail([
        started,
        { kind: "wayfinder.draft.published", payload: { issue: 5 } },
        {
          kind: "approval.requested",
          payload: { requestId, requestKind: "command", detail: "gh issue view 5" },
        },
      ]),
    ).toBeNull();
    expect(
      hasActiveWayfinderDraft([
        started,
        { kind: "wayfinder.draft.published", payload: { issue: 5 } },
      ]),
    ).toBe(false);
  });
});
