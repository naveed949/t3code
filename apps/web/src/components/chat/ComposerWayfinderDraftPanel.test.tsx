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
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerWayfinderDraftPanel } from "./ComposerWayfinderDraftPanel";

describe("ComposerWayfinderDraftPanel", () => {
  it("keeps the unpublished map and agent recommendation visually distinct", () => {
    const draft = {
      ...createEmptyWayfinderDraft("2026-01-01T00:00:00.000Z"),
      proposedDecisions: [
        {
          requestId: ApprovalRequestId.make("request:1"),
          question: {
            id: "scope",
            header: "Scope",
            question: "Which audience should lead?",
            options: [
              {
                label: "Maintainers (Recommended)",
                description: "Keeps the map focused.",
              },
            ],
            multiSelect: false,
          },
          recommendation: "Maintainers",
          reasoning: "Keeps the map focused.",
          proposedAt: "2026-01-01T00:01:00.000Z",
        },
      ],
    };

    const markup = renderToStaticMarkup(<ComposerWayfinderDraftPanel draft={draft} />);

    expect(markup).toContain("Unpublished Wayfinder draft");
    expect(markup).toContain("Non-canonical");
    expect(markup).toContain("nothing has been written to GitHub");
    expect(markup).toContain("Agent proposal");
    expect(markup).toContain("Recommended: Maintainers");
  });

  it("renders confirmed state after the structured receipt is recovered", () => {
    const requestId = ApprovalRequestId.make("request:web-loop");
    const invocation: SkillInvocation = {
      workstreamId: WorkstreamId.make("workstream:web-loop"),
      skillRunId: SkillRunId.make("skill-run:web-loop"),
      projectId: ProjectId.make("project:web-loop"),
      threadId: ThreadId.make("thread:web-loop"),
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
        id: EventId.make("event:web-requested"),
        kind: "user-input.requested",
        payload: {
          requestId,
          skillRunId: invocation.skillRunId,
          questions: [
            {
              id: "destination",
              header: "Destination",
              question: "Where should the map lead?",
              options: [{ label: "Remote ready", description: "Works everywhere." }],
            },
          ],
        },
        createdAt: "2026-01-01T00:01:00.000Z",
      },
      {
        ...commonActivity,
        id: EventId.make("event:web-resolved"),
        kind: "user-input.resolved",
        payload: {
          requestId,
          skillRunId: invocation.skillRunId,
          answers: { destination: "Remote ready" },
        },
        createdAt: "2026-01-01T00:02:00.000Z",
      },
    ]);

    expect(draft?.decisionReceipts).toHaveLength(1);
    if (draft === null) throw new Error("Expected a recovered Wayfinder draft.");
    const markup = renderToStaticMarkup(<ComposerWayfinderDraftPanel draft={draft} />);
    expect(markup).toContain("1 confirmed");
    expect(markup).toContain("Remote ready");
  });
});
