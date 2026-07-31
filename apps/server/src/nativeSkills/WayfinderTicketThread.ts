import {
  MessageId,
  ThreadId,
  type PinnedSkillIdentity,
  type SkillRunId,
  type WayfinderMapProjection,
  type WorkstreamId,
} from "@t3tools/contracts";

export function wayfinderTicketThreadId(
  workstreamId: WorkstreamId,
  ticketNumber: number,
): ThreadId {
  return ThreadId.make(`wayfinder-ticket:${workstreamId}:${ticketNumber}`);
}

export function wayfinderTicketMessageId(threadId: ThreadId): MessageId {
  return MessageId.make(`wayfinder-ticket-seed:${threadId}`);
}

export function buildWayfinderTicketThreadSeed(input: {
  readonly workstreamId: WorkstreamId;
  readonly sourceSkillRunId: SkillRunId;
  readonly sourceThreadId: ThreadId;
  readonly skill: PinnedSkillIdentity;
  readonly map: WayfinderMapProjection;
  readonly ticket: WayfinderMapProjection["tickets"][number];
}): { readonly title: string; readonly message: string } {
  const resolutions =
    input.map.decisionsSoFar.length === 0
      ? "No prior resolutions are recorded."
      : input.map.decisionsSoFar
          .map(
            (decision) =>
              `- ${decision.title}${decision.summary ? `: ${decision.summary}` : ""}${decision.url ? ` (${decision.url})` : ""}`,
          )
          .join("\n");

  return {
    title: `Wayfinder #${input.ticket.number}: ${input.ticket.title}`,
    message: [
      `Work canonical Wayfinder ticket #${input.ticket.number} in this dedicated linked thread.`,
      "",
      "Destination",
      input.map.destination || "No destination recorded.",
      "",
      "Relevant prior resolutions",
      resolutions,
      "",
      "Ticket",
      `Question: ${input.ticket.title}`,
      `Classification: ${input.ticket.classification}`,
      `Canonical ticket: ${input.ticket.url}`,
      `Canonical map: ${input.map.canonicalReference.url}`,
      "",
      "HITL working agreement",
      `Work only this assigned ticket (#${input.ticket.number}); do not resolve unrelated Wayfinder work.`,
      "Present one user decision at a time through structured input.",
      "When the answer is verified, use the complete-hitl-ticket action so T3 records the canonical resolution before advancing the shared map.",
      "",
      "Provenance",
      `Workstream: ${input.workstreamId}`,
      `Source Skill Run: ${input.sourceSkillRunId}`,
      `Source Thread: ${input.sourceThreadId}`,
      `Pinned skill: ${input.skill.name}`,
      `Skill path: ${input.skill.path}`,
      `Skill digest: ${input.skill.contentDigest}`,
    ].join("\n"),
  };
}
