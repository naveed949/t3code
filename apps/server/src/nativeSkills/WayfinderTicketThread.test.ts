import { SkillRunId, ThreadId, WorkstreamId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildWayfinderTicketThreadSeed,
  wayfinderTicketThreadId,
} from "./WayfinderTicketThread.ts";

describe("Wayfinder ticket thread bootstrap", () => {
  it("uses one stable thread identity per Workstream ticket", () => {
    expect(wayfinderTicketThreadId(WorkstreamId.make("workstream:release"), 43)).toBe(
      ThreadId.make("wayfinder-ticket:workstream:release:43"),
    );
    expect(wayfinderTicketThreadId(WorkstreamId.make("workstream:release"), 44)).toBe(
      ThreadId.make("wayfinder-ticket:workstream:release:44"),
    );
  });

  it("seeds the destination, prior resolutions, ticket, artifacts, run, and pinned skill", () => {
    const seed = buildWayfinderTicketThreadSeed({
      workstreamId: WorkstreamId.make("workstream:release"),
      sourceSkillRunId: SkillRunId.make("skill-run:map"),
      skill: {
        name: "wayfinder",
        path: "/skills/wayfinder/SKILL.md",
        contentDigest: "sha256:257e40665b28ae959ffdcb97d7a72b074360f4a3d201bd84786505308546e434",
      },
      map: {
        canonicalReference: {
          number: 42,
          title: "Release map",
          url: "https://github.com/t3tools/t3code/issues/42",
          state: "open",
        },
        destination: "Choose a safe release path.",
        notes: "",
        decisionsSoFar: [
          {
            title: "Use immutable artifacts",
            url: "https://github.com/t3tools/t3code/issues/40",
            summary: "Scan the exact digest.",
          },
        ],
        fogOfWar: [],
        outOfScope: [],
        tickets: [],
        frontier: [],
        lastSynchronizedAt: "2026-01-02T00:00:00.000Z",
      },
      ticket: {
        number: 43,
        title: "Research hosting",
        url: "https://github.com/t3tools/t3code/issues/43",
        state: "open",
        classification: "research",
        claimedBy: "alice",
        blockedBy: [],
        blocks: [],
      },
    });

    expect(seed.title).toBe("Wayfinder #43: Research hosting");
    expect(seed.message).toContain("Destination\nChoose a safe release path.");
    expect(seed.message).toContain("Use immutable artifacts");
    expect(seed.message).toContain("Scan the exact digest.");
    expect(seed.message).toContain("research");
    expect(seed.message).toContain("https://github.com/t3tools/t3code/issues/42");
    expect(seed.message).toContain("https://github.com/t3tools/t3code/issues/43");
    expect(seed.message).toContain("workstream:release");
    expect(seed.message).toContain("skill-run:map");
    expect(seed.message).toContain("sha256:257e4066");
  });
});
