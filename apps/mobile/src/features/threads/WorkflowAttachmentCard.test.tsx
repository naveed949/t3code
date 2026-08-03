import { SkillRunId, ThreadId, WorkstreamId } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";

import { WorkflowAttachmentCard } from "./WorkflowAttachmentCard";

vi.mock("react-native", async () => {
  const { createElement } = await import("react");
  return {
    Pressable: ({
      accessibilityLabel,
      accessibilityRole,
      accessibilityState,
      children,
      onPress,
      ...props
    }: {
      readonly [key: string]: unknown;
    }) =>
      createElement("button", {
        ...props,
        children,
        "aria-label": accessibilityLabel,
        role: accessibilityRole,
        onClick: onPress,
        "data-accessibility-checked": (accessibilityState as { checked?: boolean } | undefined)
          ?.checked,
        "data-accessibility-disabled": (accessibilityState as { disabled?: boolean } | undefined)
          ?.disabled,
      }),
    View: ({ children, ...props }: { readonly [key: string]: unknown }) =>
      createElement("div", { ...props, children }),
  };
});
vi.mock("../../components/AppText", async () => {
  const { createElement } = await import("react");
  return {
    AppText: ({ children, ...props }: { readonly [key: string]: unknown }) =>
      createElement("span", { ...props, children }),
    AppTextInput: ({
      accessibilityLabel,
      onChangeText: _onChangeText,
      ...props
    }: {
      readonly [key: string]: unknown;
    }) =>
      createElement("input", {
        ...props,
        "aria-label": accessibilityLabel,
        onChange: () => undefined,
      }),
  };
});

const { renderToStaticMarkup } = (await import("react-dom/server" as string)) as {
  readonly renderToStaticMarkup: (node: ReactNode) => string;
};

it("requires an explicit Origin Thread confirmation and Workflow Goal on mobile", () => {
  const markup = renderToStaticMarkup(
    <WorkflowAttachmentCard
      hint={{
        status: "available",
        sourceSkillRunId: SkillRunId.make("skill-run:origin"),
        workstreamId: WorkstreamId.make("workstream:origin"),
        backfilledWayfinderData: {},
        offeredAt: "2026-08-03T12:00:00.000Z",
        updatedAt: "2026-08-03T12:00:00.000Z",
      }}
      attachment={null}
      onDismiss={() => undefined}
      onAttach={() => undefined}
    />,
  );

  expect(markup).toContain('aria-label="Workflow Goal"');
  expect(markup).toContain('aria-label="Confirm Origin Thread"');
  expect(markup).toContain('aria-label="Attach Workstream"');
  expect(markup).toContain('data-accessibility-disabled="true"');
});

it("exposes the mobile reopen entry point after attachment", () => {
  const markup = renderToStaticMarkup(
    <WorkflowAttachmentCard
      hint={null}
      attachment={{
        originThreadId: ThreadId.make("thread-origin"),
        workstreamId: WorkstreamId.make("workstream:origin"),
        sourceSkillRunId: SkillRunId.make("skill-run:origin"),
        workflowGoal: "Ship the workflow.",
        backfilledWayfinderData: {},
        observationCursor: {
          sourceSkillRunId: SkillRunId.make("skill-run:origin"),
          observedAt: "2026-08-03T12:00:00.000Z",
        },
        attachedAt: "2026-08-03T12:00:00.000Z",
      }}
      onOpenWorkstream={() => undefined}
    />,
  );

  expect(markup).toContain('aria-label="Open attached Development Workflow"');
});

it("exposes durable workflow marker and stale-resolution controls on mobile", () => {
  const markup = renderToStaticMarkup(
    <WorkflowAttachmentCard
      hint={null}
      attachment={{
        originThreadId: ThreadId.make("thread-origin"),
        workstreamId: WorkstreamId.make("workstream:origin"),
        sourceSkillRunId: SkillRunId.make("skill-run:origin"),
        workflowGoal: "Ship the workflow.",
        backfilledWayfinderData: {},
        observationCursor: {
          sourceSkillRunId: SkillRunId.make("skill-run:origin"),
          observedAt: "2026-08-03T12:05:00.000Z",
        },
        workflowGraph: {
          artifacts: [
            {
              id: "wayfinder-map:29:revision:2",
              logicalId: "wayfinder-map:29",
              kind: "wayfinder-map",
              state: "current",
              lineage: {
                workstreamId: WorkstreamId.make("workstream:origin"),
                sourceSkillRunId: SkillRunId.make("skill-run:origin"),
                sourceStage: "reconciliation",
                upstreamVersion: "revision:2",
              },
              upstreamSynchronizedAt: "2026-08-03T12:05:00.000Z",
              importedAt: "2026-08-03T12:05:00.000Z",
              marker: {
                kind: "changed",
                state: "unread",
                markedAt: "2026-08-03T12:05:00.000Z",
              },
            },
          ],
          nodes: [
            {
              id: "workflow:workstream:origin",
              kind: "workstream",
              state: "stale",
              sourceArtifactId: "wayfinder-map:29:revision:2",
              resolution: { status: "required", allowed: ["accept-upstream"] },
              staleAt: "2026-08-03T12:05:00.000Z",
            },
          ],
          unreadArtifactCount: 33,
          updatedAt: "2026-08-03T12:05:00.000Z",
        },
        attachedAt: "2026-08-03T12:00:00.000Z",
      }}
      onViewArtifacts={() => undefined}
      onAcknowledgeArtifact={() => undefined}
      onResolveStale={() => undefined}
    />,
  );

  expect(markup).toContain('aria-label="Mark workflow updates viewed"');
  expect(markup).toContain("33 new or changed upstream artifacts.");
  expect(markup).toContain('aria-label="Acknowledge latest workflow update"');
  expect(markup).toContain('aria-label="Accept upstream workflow update"');
});
