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
import { expect, it } from "vite-plus/test";

it("uses the shared recoverable Wayfinder draft model in the desktop web shell", () => {
  const requestId = ApprovalRequestId.make("request:desktop");
  const invocation: SkillInvocation = {
    workstreamId: WorkstreamId.make("workstream:desktop"),
    skillRunId: SkillRunId.make("skill-run:desktop"),
    projectId: ProjectId.make("project:desktop"),
    threadId: ThreadId.make("thread:desktop"),
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

  expect(
    deriveWayfinderDraft(invocation, [
      {
        id: EventId.make("event:desktop-requested"),
        kind: "user-input.requested",
        payload: {
          requestId,
          questions: [
            {
              id: "destination",
              header: "Destination",
              question: "Where should this map lead?",
              options: [
                {
                  label: "Reliable recovery (Recommended)",
                  description: "Keeps the remote workflow durable.",
                },
              ],
            },
          ],
        },
        createdAt: "2026-01-01T00:01:00.000Z",
        summary: "Decision requested",
        tone: "info",
        turnId: null,
      },
      {
        id: EventId.make("event:desktop-resolved"),
        kind: "user-input.resolved",
        payload: { requestId, answers: { destination: "Reliable recovery" } },
        createdAt: "2026-01-01T00:02:00.000Z",
        summary: "Decision resolved",
        tone: "info",
        turnId: null,
      },
    ]),
  ).toMatchObject({
    authority: "unpublished-draft",
    canonical: false,
    destination: "Reliable recovery",
    decisionReceipts: [{ requestId }],
    confirmedDecisions: [{ requestId, questionId: "destination" }],
  });
});
