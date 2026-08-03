import { describe, expect, it } from "vite-plus/test";

import {
  isWayfinderMapProjectionWithinBudget,
  measureWayfinderMapProjectionBytes,
  projectWayfinderMap,
  WAYFINDER_MAP_PROJECTION_MAX_BYTES,
} from "./WayfinderMapProjection.ts";

function githubMap(body: string) {
  return {
    number: 42,
    title: "Release map",
    url: "https://github.com/t3tools/t3code/issues/42",
    state: "OPEN" as const,
    body,
    comments: { totalCount: 1, nodes: [{ updatedAt: "2026-07-31T10:00:00.000Z" }] },
    subIssues: {
      nodes: Array.from({ length: 100 }, (_, index) => {
        const number = index + 1;
        return {
          number,
          title: `Decision ${number}`,
          url: `https://github.com/t3tools/t3code/issues/${number}`,
          state: "OPEN" as const,
          comments: undefined,
          assignees: { nodes: [] },
          labels: { nodes: [{ name: "wayfinder:grilling" }] },
          blockedBy: {
            nodes: Array.from({ length: index }, (__, blocker) => ({
              number: blocker + 1,
              state: "OPEN" as const,
            })),
          },
          blocking: {
            nodes: Array.from({ length: 99 - index }, (__, blocked) => ({
              number: number + blocked + 1,
            })),
          },
        };
      }),
    },
  };
}

describe("Wayfinder map projection budget", () => {
  it("measures a dense supported map below the shared-shell payload limit", () => {
    const projection = projectWayfinderMap(
      githubMap("## Destination\n\nA release plan ready for specification."),
      "2026-07-31T10:00:00.000Z",
    );

    expect(projection.tickets).toHaveLength(100);
    expect(measureWayfinderMapProjectionBytes(projection)).toBeLessThan(
      WAYFINDER_MAP_PROJECTION_MAX_BYTES,
    );
    expect(isWayfinderMapProjectionWithinBudget(projection)).toBe(true);
  });

  it("rejects oversized projection content", () => {
    const projection = projectWayfinderMap(
      githubMap(`## Notes\n\n${"x".repeat(WAYFINDER_MAP_PROJECTION_MAX_BYTES)}`),
      "2026-07-31T10:00:00.000Z",
    );

    expect(isWayfinderMapProjectionWithinBudget(projection)).toBe(false);
  });
});
