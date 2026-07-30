import { useAtomValue } from "@effect/atom-react";
import {
  findThreadWayfinderWorkstream,
  type ProjectSkillWorkstream,
} from "@t3tools/client-runtime/state/skill-runs";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type WayfinderMapProjection } from "@t3tools/contracts";
import type { StaticScreenProps } from "@react-navigation/native";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Atom } from "effect/unstable/reactivity";

import { AppText as Text } from "../../components/AppText";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { environmentThreadDetails, environmentThreadShells } from "../../state/threads";
import { buildMobileWayfinderPresentation } from "./WayfinderWorkbench.logic";

const EMPTY_WORKSTREAMS_ATOM = Atom.make<ReadonlyArray<ProjectSkillWorkstream>>([]);

type WayfinderWorkbenchRouteParams = {
  environmentId: string;
  threadId: string;
};

function TicketList(props: { readonly map: WayfinderMapProjection }) {
  const presentation = buildMobileWayfinderPresentation(props.map);
  return (
    <View className="gap-2">
      {presentation.tickets.map((ticket) => (
        <Pressable
          key={ticket.number}
          accessibilityRole="link"
          accessibilityLabel={`${ticket.title}, ${ticket.state}, ${ticket.classification}`}
          className="rounded-xl border border-border bg-card p-4"
          onPress={() => void tryOpenExternalUrl(ticket.url, "wayfinder")}
        >
          <View className="flex-row items-start justify-between gap-3">
            <Text className="min-w-0 flex-1 text-sm font-semibold text-foreground">
              {ticket.title}
            </Text>
            <Text className="text-xs capitalize text-foreground-muted">{ticket.state}</Text>
          </View>
          <Text className="mt-1 text-xs capitalize text-foreground-muted">
            {ticket.classification}
            {ticket.claimedBy ? ` · Claimed by ${ticket.claimedBy}` : " · Unclaimed"}
          </Text>
          {ticket.blockedBy.length > 0 ? (
            <Text className="mt-1 text-xs text-foreground-muted">
              Blocked by {ticket.blockedBy.map((number) => `#${number}`).join(", ")}
            </Text>
          ) : props.map.frontier.includes(ticket.number) ? (
            <Text className="mt-1 text-xs font-semibold text-foreground">Frontier</Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

function CompactGraph(props: { readonly map: WayfinderMapProjection }) {
  const presentation = buildMobileWayfinderPresentation(props.map);
  const ticketsByNumber = new Map(
    props.map.tickets.map((ticket) => [ticket.number, ticket] as const),
  );
  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={presentation.graphAccessibilityLabel}
      className="gap-2 rounded-xl border border-border bg-card p-4"
    >
      {presentation.graphRows.map((row) => (
        <View
          key={row.ticketNumber}
          className="rounded-lg border border-border bg-background p-3"
          style={{ marginLeft: Math.min(row.depth, 4) * 16 }}
        >
          <Text className="text-xs font-semibold text-foreground">
            {ticketsByNumber.get(row.ticketNumber)?.title ?? `#${row.ticketNumber}`}
          </Text>
          {row.dependsOn.length > 0 ? (
            <Text className="mt-1 text-xs text-foreground-muted">
              Depends on {row.dependsOn.map((number) => `#${number}`).join(", ")}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function WayfinderWorkbenchContent(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectId: Parameters<typeof scopeProjectRef>[1];
}) {
  const [showGraph, setShowGraph] = useState(false);
  const workstreams = useAtomValue(
    environmentThreadShells.projectWorkstreamsAtom(
      scopeProjectRef(props.environmentId, props.projectId),
    ) ?? EMPTY_WORKSTREAMS_ATOM,
  );
  const workstream = findThreadWayfinderWorkstream(props.threadId, workstreams);
  const thread = useAtomValue(
    environmentThreadDetails.detailAtom(scopeThreadRef(props.environmentId, props.threadId)),
  );
  const map = workstream?.wayfinderMap ?? thread?.latestTurn?.skillInvocation?.wayfinderMap ?? null;
  if (!map) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <Text className="text-center text-sm text-foreground-muted">
          No synchronized Wayfinder map is linked to this thread.
        </Text>
      </View>
    );
  }
  const presentation = buildMobileWayfinderPresentation(map);

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="gap-6 p-4 pb-12"
      accessibilityLabel={presentation.accessibilitySummary}
    >
      <View className="gap-2">
        <Text className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          Wayfinder Workbench
        </Text>
        <Text className="text-xl font-bold text-foreground">{map.canonicalReference.title}</Text>
        <Text className="text-xs text-foreground-muted">
          Read-only · Synchronized {map.lastSynchronizedAt}
        </Text>
        <Pressable
          accessibilityRole="link"
          onPress={() => void tryOpenExternalUrl(map.canonicalReference.url, "wayfinder")}
        >
          <Text className="text-sm font-semibold text-foreground underline">
            GitHub #{map.canonicalReference.number}
          </Text>
        </Pressable>
      </View>

      <View>
        <Text className="mb-1 text-sm font-semibold text-foreground">Destination</Text>
        <Text className="text-sm leading-5 text-foreground">
          {map.destination || "No destination recorded."}
        </Text>
      </View>

      <View>
        <Text className="mb-1 text-sm font-semibold text-foreground">Notes</Text>
        <Text className="text-sm leading-5 text-foreground-muted">
          {map.notes || "No notes recorded."}
        </Text>
      </View>

      <View>
        <Text className="mb-1 text-sm font-semibold text-foreground">Decisions so far</Text>
        <Text className="text-sm leading-5 text-foreground-muted">
          {map.decisionsSoFar
            .map((decision) =>
              decision.summary ? `${decision.title}: ${decision.summary}` : decision.title,
            )
            .join("\n") || "No decisions recorded."}
        </Text>
      </View>

      <View>
        <View className="mb-2 flex-row items-center justify-between">
          <Text className="text-sm font-semibold text-foreground">Decision graph</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showGraph ? "Hide dependency graph" : "Show dependency graph"}
            className="rounded-lg border border-border px-3 py-2"
            onPress={() => setShowGraph((current) => !current)}
          >
            <Text className="text-xs font-semibold text-foreground">
              {showGraph ? "Hide graph" : "Show graph"}
            </Text>
          </Pressable>
        </View>
        {showGraph ? <CompactGraph map={map} /> : null}
      </View>

      <View>
        <Text className="mb-2 text-sm font-semibold text-foreground">Frontier and tickets</Text>
        <TicketList map={map} />
      </View>

      <View className="gap-4">
        <View>
          <Text className="mb-1 text-sm font-semibold text-foreground">Fog of war</Text>
          <Text className="text-xs leading-5 text-foreground-muted">
            {map.fogOfWar.join("\n") || "No unresolved fog."}
          </Text>
        </View>
        <View>
          <Text className="mb-1 text-sm font-semibold text-foreground">Out of scope</Text>
          <Text className="text-xs leading-5 text-foreground-muted">
            {map.outOfScope.join("\n") || "Nothing recorded."}
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

export function WayfinderWorkbenchRouteScreen({
  route,
}: StaticScreenProps<WayfinderWorkbenchRouteParams>) {
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const threadId = ThreadId.make(route.params.threadId);
  const thread = useAtomValue(
    environmentThreadShells.threadShellAtom(scopeThreadRef(environmentId, threadId)),
  );
  if (!thread) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-sm text-foreground-muted">Loading Wayfinder map…</Text>
      </View>
    );
  }
  return (
    <WayfinderWorkbenchContent
      environmentId={environmentId}
      threadId={threadId}
      projectId={thread.projectId}
    />
  );
}
