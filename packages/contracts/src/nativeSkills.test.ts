import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ApprovalRequestId } from "./baseSchemas.ts";
import { WayfinderDraft, WayfinderPublication } from "./nativeSkills.ts";

describe("WayfinderDraft", () => {
  it("represents every unpublished map section without making it canonical", () => {
    const decoded = Schema.decodeUnknownSync(WayfinderDraft)({
      authority: "unpublished-draft",
      canonical: false,
      destination: "Make remote coding handoffs obvious",
      notes: ["Start with the cross-device continuation path"],
      confirmedDecisions: [
        {
          requestId: ApprovalRequestId.make("request:1"),
          questionId: "audience",
          question: "Who leads?",
          answer: "Remote maintainers",
          confirmedAt: "2026-01-01T00:01:00.000Z",
        },
      ],
      proposedDecisions: [],
      candidateTickets: [{ id: "ticket:1", title: "Show recovery state" }],
      fogOfWar: [{ id: "fog:1", title: "Relay latency", detail: "Needs measurement" }],
      outOfScope: [{ id: "scope:1", title: "GitHub publication" }],
      proposedDependencyEdges: [{ from: "ticket:1", to: "ticket:2" }],
      decisionReceipts: [
        {
          requestId: ApprovalRequestId.make("request:1"),
          answers: { audience: "Remote maintainers" },
          recordedAt: "2026-01-01T00:01:00.000Z",
        },
      ],
      updatedAt: "2026-01-01T00:01:00.000Z",
    });

    expect(decoded.canonical).toBe(false);
    expect(decoded.candidateTickets).toHaveLength(1);
    expect(decoded.fogOfWar).toHaveLength(1);
    expect(decoded.outOfScope).toHaveLength(1);
    expect(decoded.proposedDependencyEdges).toHaveLength(1);
  });
});

describe("WayfinderPublication", () => {
  it("keeps verified artifacts and the exact resumable step", () => {
    const decoded = Schema.decodeUnknownSync(WayfinderPublication)({
      status: "failed",
      artifacts: [
        { kind: "label", name: "wayfinder:map" },
        {
          kind: "issue",
          key: "map",
          number: 42,
          url: "https://github.com/t3tools/t3code/issues/42",
        },
      ],
      nextStep: "create decision ticket choose-target",
      error: "GitHub unavailable",
      updatedAt: "2026-07-30T10:05:00.000Z",
    });

    expect(decoded.status).toBe("failed");
    expect(decoded.artifacts).toHaveLength(2);
    expect(decoded.nextStep).toBe("create decision ticket choose-target");
  });
});
