import type { WayfinderPublication } from "@t3tools/contracts";

export function shouldOpenSynchronizedWayfinderMap(input: {
  readonly previousStatus: WayfinderPublication["status"] | undefined;
  readonly status: WayfinderPublication["status"] | undefined;
  readonly hasThread: boolean;
  readonly hasMap: boolean;
}): boolean {
  return (
    input.previousStatus !== "synchronized" &&
    input.status === "synchronized" &&
    input.hasThread &&
    input.hasMap
  );
}
