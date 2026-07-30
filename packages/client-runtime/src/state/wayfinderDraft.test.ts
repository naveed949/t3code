import { describe, expect, it } from "vite-plus/test";
import {
  ApprovalRequestId,
  EventId,
  ProjectId,
  SkillRunId,
  ThreadId,
  WorkstreamId,
  type OrchestrationThreadActivity,
  type SkillInvocation,
} from "@t3tools/contracts";
import { createEmptyWayfinderDraft } from "@t3tools/shared/wayfinderDraft";

import { deriveWayfinderDraft, findLatestWayfinderDraftInvocation } from "./wayfinderDraft.ts";

const invocation: SkillInvocation = {
  workstreamId: WorkstreamId.make("workstream:1"),
  skillRunId: SkillRunId.make("skill-run:1"),
  projectId: ProjectId.make("project:1"),
  threadId: ThreadId.make("thread:1"),
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

const activity = (
  id: string,
  kind: string,
  payload: unknown,
  createdAt: string,
): OrchestrationThreadActivity => ({
  id: EventId.make(id),
  kind,
  payload,
  createdAt,
  summary: kind,
  tone: "info",
  turnId: null,
});

describe("deriveWayfinderDraft", () => {
  it("keeps one pending Decision Card as an agent proposal", () => {
    const requestId = ApprovalRequestId.make("request:scope");
    const draft = deriveWayfinderDraft(invocation, [
      activity(
        "event:requested",
        "user-input.requested",
        {
          requestId,
          skillRunId: invocation.skillRunId,
          questions: [
            {
              id: "audience",
              header: "Audience",
              question: "Who should this map serve?",
              options: [
                {
                  label: "Maintainers (Recommended)",
                  description: "Keeps the first map operationally focused.",
                },
                { label: "Everyone", description: "Covers every possible audience." },
              ],
            },
          ],
        },
        "2026-01-01T00:01:00.000Z",
      ),
    ]);

    expect(draft?.proposedDecisions).toMatchObject([
      {
        requestId,
        recommendation: "Maintainers",
        reasoning: "Keeps the first map operationally focused.",
      },
    ]);
    expect(draft?.confirmedDecisions).toEqual([]);
    expect(draft?.decisionReceipts).toEqual([]);
  });

  it("records a structured receipt before moving the proposal to confirmed state", () => {
    const requestId = ApprovalRequestId.make("request:scope");
    const requested = activity(
      "event:requested",
      "user-input.requested",
      {
        requestId,
        skillRunId: invocation.skillRunId,
        questions: [
          {
            id: "audience",
            header: "Audience",
            question: "Who should this map serve?",
            options: [
              {
                label: "Maintainers (Recommended)",
                description: "Keeps the first map operationally focused.",
              },
            ],
          },
        ],
      },
      "2026-01-01T00:01:00.000Z",
    );

    const draft = deriveWayfinderDraft(invocation, [
      requested,
      activity(
        "event:resolved",
        "user-input.resolved",
        {
          requestId,
          skillRunId: invocation.skillRunId,
          answers: { audience: "Maintainers" },
        },
        "2026-01-01T00:02:00.000Z",
      ),
    ]);

    expect(draft?.decisionReceipts).toEqual([
      {
        requestId,
        answers: { audience: "Maintainers" },
        recordedAt: "2026-01-01T00:02:00.000Z",
      },
    ]);
    expect(draft?.proposedDecisions).toEqual([]);
    expect(draft?.confirmedDecisions).toEqual([
      {
        requestId,
        questionId: "audience",
        question: "Who should this map serve?",
        answer: "Maintainers",
        confirmedAt: "2026-01-01T00:02:00.000Z",
      },
    ]);
  });

  it("projects confirmed structured decision ids into every map section", () => {
    const requestId = ApprovalRequestId.make("request:map-sections");
    const questions = [
      ["destination", "Destination", "Ship reliable remote handoffs"],
      ["note:relay", "Note", "Measure relay reconnect latency"],
      ["ticket:recovery", "Candidate ticket", "Show recoverable draft state"],
      ["fog:latency", "Fog of war", "Relay latency needs measurement"],
      ["out-of-scope:publish", "Out of scope", "GitHub publication"],
      ["dependency:recovery->sync", "Dependency", "Confirm dependency"],
    ].map(([id, header]) => ({
      id: id!,
      header: header!,
      question: `Confirm ${header}`,
      options: [{ label: "Confirm (Recommended)", description: "Keeps the map explicit." }],
    }));
    const answers = Object.fromEntries(
      questions.map((question, index) => [
        question.id,
        [
          "Ship reliable remote handoffs",
          "Measure relay reconnect latency",
          "Show recoverable draft state",
          "Relay latency needs measurement",
          "GitHub publication",
          "Confirm dependency",
        ][index],
      ]),
    );

    const draft = deriveWayfinderDraft(invocation, [
      activity(
        "event:requested",
        "user-input.requested",
        { requestId, skillRunId: invocation.skillRunId, questions },
        "2026-01-01T00:01:00.000Z",
      ),
      activity(
        "event:resolved",
        "user-input.resolved",
        { requestId, skillRunId: invocation.skillRunId, answers },
        "2026-01-01T00:02:00.000Z",
      ),
    ]);

    expect(draft).toMatchObject({
      destination: "Ship reliable remote handoffs",
      notes: ["Measure relay reconnect latency"],
      candidateTickets: [{ id: "recovery", title: "Show recoverable draft state" }],
      fogOfWar: [{ id: "latency", title: "Relay latency needs measurement" }],
      outOfScope: [{ id: "publish", title: "GitHub publication" }],
      proposedDependencyEdges: [{ from: "recovery", to: "sync" }],
    });
  });

  it("does not create draft state for generic or continuation runs", () => {
    expect(
      deriveWayfinderDraft(
        {
          ...invocation,
          execution: { mode: "generic", reason: "user-selected-generic" },
        },
        [],
      ),
    ).toBeNull();
    expect(
      deriveWayfinderDraft({ ...invocation, action: { id: "continue-map", reference: "5" } }, []),
    ).toBeNull();
  });

  it("ignores structured input from another Skill Run", () => {
    const requestId = ApprovalRequestId.make("request:unrelated");
    const unrelatedSkillRunId = SkillRunId.make("skill-run:unrelated");
    const draft = deriveWayfinderDraft(invocation, [
      activity(
        "event:unrelated-requested",
        "user-input.requested",
        {
          requestId,
          skillRunId: unrelatedSkillRunId,
          questions: [
            {
              id: "destination",
              header: "Destination",
              question: "Where next?",
              options: [{ label: "Wrong map", description: "Belongs elsewhere." }],
            },
          ],
        },
        "2026-01-01T00:03:00.000Z",
      ),
      activity(
        "event:unrelated-resolved",
        "user-input.resolved",
        {
          requestId,
          skillRunId: unrelatedSkillRunId,
          answers: { destination: "Wrong map" },
        },
        "2026-01-01T00:04:00.000Z",
      ),
    ]);

    expect(draft?.destination).toBeNull();
    expect(draft?.decisionReceipts).toEqual([]);
  });

  it("removes draft-write authority after canonical reconciliation", () => {
    expect(
      deriveWayfinderDraft(
        {
          ...invocation,
          wayfinderPublication: {
            status: "synchronized",
            artifacts: [],
            nextStep: null,
            updatedAt: "2026-01-01T00:05:00.000Z",
          },
        },
        [],
      ),
    ).toBeNull();
  });

  it("recovers the latest unpublished run independently of the thread's latest turn", () => {
    const newer = {
      ...invocation,
      skillRunId: SkillRunId.make("skill-run:2"),
      createdAt: "2026-01-01T00:03:00.000Z",
    };

    expect(
      findLatestWayfinderDraftInvocation(
        [
          newer,
          invocation,
          { ...invocation, threadId: ThreadId.make("thread:other") },
          {
            ...invocation,
            skillRunId: SkillRunId.make("skill-run:generic"),
            execution: { mode: "generic", reason: "user-selected-generic" },
          },
        ],
        invocation.threadId,
      ),
    ).toEqual(newer);
  });
});
