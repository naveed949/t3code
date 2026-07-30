import { ApprovalRequestId, emptyWayfinderDraft } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { wayfinderDraftPresentation } from "./wayfinderDraftPresentation";

describe("wayfinderDraftPresentation", () => {
  it("labels the mobile draft as non-canonical and shows only one proposal", () => {
    const question = {
      id: "scope",
      header: "Scope",
      question: "Which audience should lead?",
      options: [{ label: "Maintainers", description: "Keep it focused." }],
      multiSelect: false,
    };
    const draft = {
      ...emptyWayfinderDraft("2026-01-01T00:00:00.000Z"),
      proposedDecisions: ["1", "2"].map((suffix) => ({
        requestId: ApprovalRequestId.make(`request:${suffix}`),
        question,
        proposedAt: `2026-01-01T00:0${suffix}:00.000Z`,
      })),
    };

    expect(wayfinderDraftPresentation(draft)).toMatchObject({
      authorityLabel: "Unpublished Wayfinder draft",
      safetyLabel: "Non-canonical · nothing has been written to GitHub",
      progressLabel: "0 confirmed · 1 agent proposal",
      pendingProposal: { requestId: ApprovalRequestId.make("request:1") },
    });
  });
});
