import type { WayfinderMapProjection, WayfinderTicketClassification } from "@t3tools/contracts";

interface GitHubMapIssue {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: "OPEN" | "CLOSED";
  readonly comments:
    | {
        readonly totalCount: number;
        readonly nodes: ReadonlyArray<{ readonly updatedAt: string }>;
      }
    | undefined;
  readonly body: string;
  readonly subIssues: {
    readonly nodes: ReadonlyArray<{
      readonly number: number;
      readonly title: string;
      readonly url: string;
      readonly state: "OPEN" | "CLOSED";
      readonly comments:
        | {
            readonly totalCount: number;
            readonly nodes: ReadonlyArray<{ readonly updatedAt: string }>;
          }
        | undefined;
      readonly assignees: { readonly nodes: ReadonlyArray<{ readonly login: string }> };
      readonly labels: { readonly nodes: ReadonlyArray<{ readonly name: string }> };
      readonly blockedBy: {
        readonly nodes: ReadonlyArray<{
          readonly number: number;
          readonly state: "OPEN" | "CLOSED";
        }>;
      };
      readonly blocking: { readonly nodes: ReadonlyArray<{ readonly number: number }> };
    }>;
  };
}

type MapSectionName = "destination" | "notes" | "decisionsSoFar" | "fogOfWar" | "outOfScope";
type MapSection = MapSectionName | null;

const MAP_HEADINGS: Readonly<Record<string, MapSectionName>> = {
  destination: "destination",
  notes: "notes",
  "decisions so far": "decisionsSoFar",
  "not yet specified": "fogOfWar",
  "out of scope": "outOfScope",
};

function parseMapSections(body: string): Record<MapSectionName, string[]> {
  const sections = {
    destination: [] as string[],
    notes: [] as string[],
    decisionsSoFar: [] as string[],
    fogOfWar: [] as string[],
    outOfScope: [] as string[],
  };
  let current: MapSection = null;
  for (const line of body.split(/\r?\n/u)) {
    const heading = /^##\s+(.+?)\s*$/u.exec(line)?.[1]?.toLowerCase();
    if (heading) {
      current = MAP_HEADINGS[heading] ?? null;
      continue;
    }
    if (current && !/^\s*<!--.*-->\s*$/u.test(line)) sections[current].push(line);
  }
  return sections;
}

function sectionText(lines: ReadonlyArray<string>): string {
  return lines.join("\n").trim();
}

function sectionEntries(lines: ReadonlyArray<string>): string[] {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("<!--"))
    .map((line) => line.replace(/^[-*]\s+/u, ""));
}

function parseDecisions(lines: ReadonlyArray<string>): WayfinderMapProjection["decisionsSoFar"] {
  return sectionEntries(lines).map((line): WayfinderMapProjection["decisionsSoFar"][number] => {
    const match = /^\[([^\]]+)\]\(([^)]+)\)\s*(?:[—–-]\s*)?(.*)$/u.exec(line);
    return match?.[1] && match[2]
      ? { title: match[1], url: match[2], summary: match[3]?.trim() ?? "" }
      : { title: line, url: null, summary: "" };
  });
}

function classification(labels: ReadonlyArray<{ readonly name: string }>) {
  const supported = new Set<WayfinderTicketClassification>([
    "research",
    "prototype",
    "grilling",
    "task",
    "out-of-scope",
  ]);
  for (const label of labels) {
    const value = /^wayfinder:(.+)$/u.exec(label.name)?.[1];
    if (value && supported.has(value as WayfinderTicketClassification)) {
      return value as WayfinderTicketClassification;
    }
  }
  return "unknown" as const;
}

export function projectWayfinderMap(
  issue: GitHubMapIssue,
  synchronizedAt: string,
  revision?: string,
): WayfinderMapProjection {
  const sections = parseMapSections(issue.body);
  const tickets = issue.subIssues.nodes
    .map((ticket) => ({
      number: ticket.number,
      title: ticket.title,
      url: ticket.url,
      state: ticket.state === "OPEN" ? ("open" as const) : ("closed" as const),
      classification: classification(ticket.labels.nodes),
      claimedBy: ticket.assignees.nodes[0]?.login ?? null,
      blockedBy: ticket.blockedBy.nodes.map((blocker) => blocker.number).sort((a, b) => a - b),
      blocks: ticket.blocking.nodes.map((blocked) => blocked.number).sort((a, b) => a - b),
      ...(ticket.comments ? { commentCount: ticket.comments.totalCount } : {}),
      ...(ticket.comments?.nodes[0]?.updatedAt
        ? { lastCommentedAt: ticket.comments.nodes[0].updatedAt }
        : {}),
      hasOpenBlocker: ticket.blockedBy.nodes.some((blocker) => blocker.state === "OPEN"),
    }))
    .sort((left, right) => left.number - right.number);

  return {
    canonicalReference: {
      number: issue.number,
      title: issue.title,
      url: issue.url,
      state: issue.state === "OPEN" ? "open" : "closed",
      ...(issue.comments ? { commentCount: issue.comments.totalCount } : {}),
    },
    ...(revision !== undefined ? { revision } : {}),
    destination: sectionText(sections.destination),
    notes: sectionText(sections.notes),
    decisionsSoFar: parseDecisions(sections.decisionsSoFar),
    fogOfWar: sectionEntries(sections.fogOfWar),
    outOfScope: sectionEntries(sections.outOfScope),
    tickets: tickets.map(({ hasOpenBlocker: _, ...ticket }) => ticket),
    frontier: tickets
      .filter(
        (ticket) => ticket.state === "open" && ticket.claimedBy === null && !ticket.hasOpenBlocker,
      )
      .map((ticket) => ticket.number),
    lastSynchronizedAt: synchronizedAt,
  };
}
