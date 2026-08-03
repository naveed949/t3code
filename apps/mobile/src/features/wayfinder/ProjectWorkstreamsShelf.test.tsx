import type { EnvironmentProjectSkillWorkstream } from "@t3tools/client-runtime/state/skill-runs";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, SkillRunId, ThreadId, WorkstreamId } from "@t3tools/contracts";
import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { ProjectWorkstreamsShelf } from "./ProjectWorkstreamsShelf";

vi.mock("react-native", () => ({ Pressable: "Pressable", View: "View" }));
vi.mock("../../components/AppText", () => ({ AppText: "Text" }));

const environmentId = EnvironmentId.make("environment:1");
const projectId = ProjectId.make("project:1");
const activeThread = {
  environmentId,
  id: ThreadId.make("thread:active"),
  projectId,
} as EnvironmentThreadShell;
const completedThread = {
  environmentId,
  id: ThreadId.make("thread:completed"),
  projectId,
} as EnvironmentThreadShell;
const project = {
  environmentId,
  id: projectId,
  title: "T3 Code",
} as EnvironmentProject;

function workstream(
  id: string,
  status: "active" | "completed",
  thread: EnvironmentThreadShell,
): EnvironmentProjectSkillWorkstream {
  return {
    environmentId,
    id: WorkstreamId.make(id),
    projectId,
    status,
    linkedThreadIds: [thread.id],
    skillRuns: [],
    ticketThreads: [],
    wayfinderMap: {
      canonicalReference: {
        number: status === "active" ? 42 : 43,
        title: `${status} map`,
        url: `https://github.com/t3tools/t3code/issues/${status === "active" ? 42 : 43}`,
        state: status === "active" ? "open" : "closed",
      },
      destination: "Ship the decision.",
      notes: "",
      decisionsSoFar: [],
      fogOfWar: [],
      outOfScope: [],
      tickets: [],
      frontier: [],
      lastSynchronizedAt: "2026-07-30T00:00:00.000Z",
    },
    wayfinderSynchronization: null,
    workflowAttachment: null,
    readiness: { ready: false, blockers: [{ kind: "open-decision-tickets", ticketNumbers: [43] }] },
  };
}

function pressableProps(node: ReactNode): Array<{
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
}> {
  if (!isValidElement(node)) return [];
  const props = node.props as {
    readonly accessibilityLabel?: string;
    readonly onPress?: () => void;
    readonly children?: ReactNode;
  };
  const current =
    props.accessibilityLabel && props.onPress
      ? [{ accessibilityLabel: props.accessibilityLabel, onPress: props.onPress }]
      : [];
  return [
    ...current,
    ...pressableProps(props.children),
    ...(Array.isArray(props.children) ? props.children.flatMap(pressableProps) : []),
  ];
}

describe("ProjectWorkstreamsShelf", () => {
  it("exposes active and completed maps and opens their linked threads", () => {
    const onSelectThread = vi.fn();
    const tree = ProjectWorkstreamsShelf({
      workstreams: [
        workstream("workstream:active", "active", activeThread),
        workstream("workstream:completed", "completed", completedThread),
      ],
      projects: [project],
      threads: [activeThread, completedThread],
      onSelectThread,
    });
    const buttons = pressableProps(tree);

    expect(buttons.map((button) => button.accessibilityLabel)).toEqual([
      "active map, active Workstream",
      "completed map, completed Workstream",
    ]);
    buttons[1]?.onPress();
    expect(onSelectThread).toHaveBeenCalledWith(completedThread);
  });

  it("reopens an attached workflow through its durable Origin Thread", () => {
    const onSelectThread = vi.fn();
    const originThread = {
      environmentId,
      id: ThreadId.make("thread:origin"),
      projectId,
    } as EnvironmentThreadShell;
    const tree = ProjectWorkstreamsShelf({
      workstreams: [
        {
          ...workstream("workstream:workflow", "active", activeThread),
          linkedThreadIds: [activeThread.id],
          wayfinderMap: null,
          workflowAttachment: {
            originThreadId: originThread.id,
            workstreamId: WorkstreamId.make("workstream:workflow"),
            sourceSkillRunId: SkillRunId.make("skill-run:workflow-origin"),
            workflowGoal: "Ship the Development Workflow.",
            backfilledWayfinderData: {},
            observationCursor: {
              sourceSkillRunId: SkillRunId.make("skill-run:workflow-origin"),
              observedAt: "2026-08-03T12:00:00.000Z",
            },
            attachedAt: "2026-08-03T12:00:00.000Z",
          },
        },
      ],
      projects: [project],
      threads: [activeThread, originThread],
      onSelectThread,
    });
    const buttons = pressableProps(tree);

    expect(buttons[0]?.accessibilityLabel).toBe(
      "Ship the Development Workflow., Development workflow Workstream",
    );
    buttons[0]?.onPress();
    expect(onSelectThread).toHaveBeenCalledWith(originThread);
  });
});
