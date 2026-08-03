import {
  ApprovalRequestId,
  EventId,
  ProjectId,
  SkillRunId,
  ThreadId,
  WorkstreamId,
  type SkillInvocation,
} from "@t3tools/contracts";
import { deriveWayfinderDraft } from "@t3tools/client-runtime/state/wayfinder-draft";
import { createEmptyWayfinderDraft } from "@t3tools/shared/wayfinderDraft";
import { describe, expect, it } from "vite-plus/test";

import { wayfinderDecisionStep, wayfinderDraftPresentation } from "./wayfinderDraftPresentation";

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
      ...createEmptyWayfinderDraft("2026-01-01T00:00:00.000Z"),
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

  it("exposes one Decision Card question at a time", () => {
    const questions = [{ id: "destination" }, { id: "ticket:one" }];

    expect(wayfinderDecisionStep(questions, {}, 0)).toMatchObject({
      activeQuestion: { id: "destination" },
      visibleQuestions: [{ id: "destination" }],
      canAdvance: false,
    });
    expect(
      wayfinderDecisionStep(questions, { destination: { selectedOptionLabel: "Ship it" } }, 0),
    ).toMatchObject({
      visibleQuestions: [{ id: "destination" }],
      canAdvance: true,
    });
    expect(wayfinderDecisionStep(questions, {}, 1)).toMatchObject({
      visibleQuestions: [{ id: "ticket:one" }],
      canAdvance: false,
    });
  });

  it("presents confirmed progress after receipt recovery", () => {
    const requestId = ApprovalRequestId.make("request:mobile-loop");
    const invocation: SkillInvocation = {
      workstreamId: WorkstreamId.make("workstream:mobile-loop"),
      skillRunId: SkillRunId.make("skill-run:mobile-loop"),
      projectId: ProjectId.make("project:mobile-loop"),
      threadId: ThreadId.make("thread:mobile-loop"),
      skill: {
        name: "wayfinder",
        path: "/skills/wayfinder/SKILL.md",
        contentDigest: "sha256:257e40665b28ae959ffdcb97d7a72b074360f4a3d201bd84786505308546e434",
      },
      action: { id: "new-map" },
      execution: { mode: "native", adapterId: "wayfinder", adapterVersion: 1 },
      createdAt: "2026-01-01T00:00:00.000Z",
      wayfinderDraft: createEmptyWayfinderDraft("2026-01-01T00:00:00.000Z"),
    };
    const commonActivity = {
      summary: "Decision",
      tone: "info" as const,
      turnId: null,
    };
    const draft = deriveWayfinderDraft(invocation, [
      {
        ...commonActivity,
        id: EventId.make("event:mobile-requested"),
        kind: "user-input.requested",
        payload: {
          requestId,
          skillRunId: invocation.skillRunId,
          questions: [
            {
              id: "destination",
              header: "Destination",
              question: "Where should the map lead?",
              options: [{ label: "Cross-device", description: "Continue anywhere." }],
            },
          ],
        },
        createdAt: "2026-01-01T00:01:00.000Z",
      },
      {
        ...commonActivity,
        id: EventId.make("event:mobile-resolved"),
        kind: "user-input.resolved",
        payload: {
          requestId,
          skillRunId: invocation.skillRunId,
          answers: { destination: "Cross-device" },
        },
        createdAt: "2026-01-01T00:02:00.000Z",
      },
    ]);

    expect(draft?.decisionReceipts).toHaveLength(1);
    if (draft === null) throw new Error("Expected a recovered Wayfinder draft.");
    expect(wayfinderDraftPresentation(draft).progressLabel).toBe("1 confirmed");
  });
});
