import { ApprovalRequestId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { hasActiveWayfinderDraftAuthority } from "./WayfinderDraftMutationGuard.ts";

const requestId = ApprovalRequestId.make("request:github");
const started = {
  kind: "wayfinder.draft.started",
  payload: { canonical: false },
};

describe("WayfinderDraftMutationGuard", () => {
  it("identifies active unpublished draft authority", () => {
    expect(
      hasActiveWayfinderDraftAuthority([
        started,
        {
          kind: "approval.requested",
          payload: { requestId, requestKind: "command", detail: "node indirect-script.js" },
        },
      ]),
    ).toBe(true);
  });

  it("stops guarding after publication", () => {
    expect(
      hasActiveWayfinderDraftAuthority([
        started,
        { kind: "wayfinder.draft.published", payload: { issue: 5 } },
      ]),
    ).toBe(false);
  });
});
