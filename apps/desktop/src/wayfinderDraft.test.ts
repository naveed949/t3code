import {
  ProjectId,
  SkillRunId,
  ThreadId,
  WorkstreamId,
  emptyWayfinderDraft,
  type SkillInvocation,
} from "@t3tools/contracts";
import { deriveWayfinderDraft } from "@t3tools/client-runtime/state/wayfinder-draft";
import { expect, it } from "vite-plus/test";

it("uses the shared recoverable Wayfinder draft model in the desktop web shell", () => {
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
    wayfinderDraft: emptyWayfinderDraft("2026-01-01T00:00:00.000Z"),
  };

  expect(deriveWayfinderDraft(invocation, [])).toMatchObject({
    authority: "unpublished-draft",
    canonical: false,
  });
});
