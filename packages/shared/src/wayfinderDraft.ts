import {
  IsoDateTime,
  type SkillInvocation,
  WayfinderDecisionTarget,
  type WayfinderDecisionTarget as WayfinderDecisionTargetType,
  type WayfinderDraft,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const isWayfinderDecisionTarget = Schema.is(WayfinderDecisionTarget);

export const createEmptyWayfinderDraft = (createdAt: string): WayfinderDraft => ({
  authority: "unpublished-draft",
  canonical: false,
  destination: null,
  notes: [],
  confirmedDecisions: [],
  proposedDecisions: [],
  candidateTickets: [],
  fogOfWar: [],
  outOfScope: [],
  proposedDependencyEdges: [],
  decisionReceipts: [],
  updatedAt: IsoDateTime.make(createdAt),
});

export function parseWayfinderDecisionTarget(id: string): WayfinderDecisionTargetType | null {
  if (id === "destination") return { kind: "destination" };
  for (const [prefix, kind] of [
    ["note:", "note"],
    ["ticket:", "candidate-ticket"],
    ["fog:", "fog-of-war"],
    ["out-of-scope:", "out-of-scope"],
  ] as const) {
    if (id.startsWith(prefix) && id.length > prefix.length) {
      const target = { kind, id: id.slice(prefix.length) };
      return isWayfinderDecisionTarget(target) ? target : null;
    }
  }
  const dependency = /^dependency:(.+)->(.+)$/u.exec(id);
  const target =
    dependency?.[1] && dependency[2]
      ? { kind: "proposed-dependency" as const, from: dependency[1], to: dependency[2] }
      : null;
  return target !== null && isWayfinderDecisionTarget(target) ? target : null;
}

export const isNativeWayfinderDraftInvocation = (
  invocation: SkillInvocation | null | undefined,
): invocation is SkillInvocation & { readonly wayfinderDraft: WayfinderDraft } =>
  invocation?.skill.name === "wayfinder" &&
  invocation.execution.mode === "native" &&
  invocation.action?.id === "new-map" &&
  invocation.wayfinderDraft !== undefined;
