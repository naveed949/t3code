import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ApprovalRequestId } from "./baseSchemas.ts";
import { WayfinderDraft, WayfinderMutation, WayfinderPublication } from "./nativeSkills.ts";

const decodeWayfinderDraft = Schema.decodeUnknownSync(WayfinderDraft);
const decodeWayfinderPublication = Schema.decodeUnknownSync(WayfinderPublication);
const decodeWayfinderMutation = Schema.decodeUnknownSync(WayfinderMutation);

describe("WayfinderDraft", () => {
  it("represents every unpublished map section without making it canonical", () => {
    const decoded = decodeWayfinderDraft({
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
    const decoded = decodeWayfinderPublication({
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

describe("WayfinderMutation", () => {
  it("keeps one structured canonical action and its receipt-backed state", () => {
    const decoded = decodeWayfinderMutation({
      actionId: "action:rename",
      action: { kind: "rename-ticket", ticketNumber: 42, title: "Choose the release target" },
      status: "mutating",
      error: null,
      updatedAt: "2026-07-30T10:05:00.000Z",
    });

    expect(decoded.action.kind).toBe("rename-ticket");
    expect(decoded.status).toBe("mutating");
  });

  it("rejects arbitrary GitHub issue administration", () => {
    expect(() =>
      decodeWayfinderMutation({
        actionId: "action:raw",
        action: { kind: "edit-issue-body", ticketNumber: 42, body: "anything" },
        status: "mutating",
        error: null,
        updatedAt: "2026-07-30T10:05:00.000Z",
      }),
    ).toThrow();
  });

  it("decodes claim and release actions for a canonical ticket", () => {
    expect(
      decodeWayfinderMutation({
        actionId: "claim:43",
        action: { kind: "claim-ticket", ticketNumber: 43 },
        status: "mutating",
        error: null,
        updatedAt: "2026-01-02T00:00:00.000Z",
      }).action,
    ).toEqual({ kind: "claim-ticket", ticketNumber: 43 });

    expect(
      decodeWayfinderMutation({
        actionId: "release:43",
        action: { kind: "release-ticket", ticketNumber: 43 },
        status: "synchronized",
        error: null,
        updatedAt: "2026-01-02T00:01:00.000Z",
      }).action,
    ).toEqual({ kind: "release-ticket", ticketNumber: 43 });
  });

  it("decodes a resumable HITL resolution with graduated fog relationships", () => {
    const decoded = decodeWayfinderMutation({
      actionId: "resolve:43",
      action: {
        kind: "complete-hitl-ticket",
        ticketNumber: 43,
        outcome: "resolved",
        resolution: "Ship the environment-owned synchronization path.",
        contextPointer: "https://github.com/t3tools/t3code/issues/43#issuecomment-1",
        graduatedFog: [
          {
            key: "relay-failure-policy",
            fog: "Relay failure behavior",
            title: "Choose the relay failure policy",
            classification: "grilling",
            blockedBy: [{ kind: "ticket", ticketNumber: 42 }],
          },
          {
            key: "mobile-recovery",
            fog: "Mobile recovery details",
            title: "Define mobile recovery",
            classification: "research",
            blockedBy: [{ kind: "graduated", key: "relay-failure-policy" }],
          },
        ],
      },
      status: "failed",
      artifacts: [
        {
          kind: "resolution-comment",
          ticketNumber: 43,
          contextPointer: "https://github.com/t3tools/t3code/issues/43#issuecomment-1",
        },
        {
          kind: "issue",
          key: "relay-failure-policy",
          number: 44,
          url: "https://github.com/t3tools/t3code/issues/44",
        },
      ],
      nextStep: "link graduated ticket mobile-recovery",
      error: "GitHub unavailable",
      updatedAt: "2026-07-30T10:05:00.000Z",
    });

    expect(decoded.action.kind).toBe("complete-hitl-ticket");
    expect(decoded.artifacts).toHaveLength(2);
    expect(decoded.nextStep).toBe("link graduated ticket mobile-recovery");
  });
});
