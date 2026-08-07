import type {
  ProviderInstanceId,
  ServerProvider,
  WorkflowRunRequiredSkill,
} from "@t3tools/contracts";

/**
 * The native skills a v1 Development Workflow Run must be able to dispatch.
 * This is only a capability projection for clients; the server re-discovers
 * and digest-pins the same skills before it persists a preflight.
 */
export const WORKFLOW_RUN_REQUIRED_STAGES = [
  ["specification", "to-spec"],
  ["ticketing", "to-tickets"],
  ["implementation", "implement"],
  ["review", "code-review"],
] as const;

export function deriveWorkflowRunRequiredSkills(
  provider: ServerProvider,
  nodeId: string,
): ReadonlyArray<WorkflowRunRequiredSkill> {
  return WORKFLOW_RUN_REQUIRED_STAGES.map(([stage, name]) => {
    const skill = provider.skills.find((candidate) => candidate.name === name);
    const enabled = provider.enabled && provider.installed && skill?.enabled === true;
    return {
      nodeId,
      providerInstanceId: provider.instanceId,
      stage,
      skill: {
        name,
        ...(skill?.path !== undefined ? { path: skill.path } : {}),
      },
      status: enabled ? "available" : "missing",
    };
  });
}

export function deriveWorkflowRunRequiredSkillsByProvider(
  providers: ReadonlyArray<ServerProvider>,
  nodeId: string,
): ReadonlyMap<ProviderInstanceId, ReadonlyArray<WorkflowRunRequiredSkill>> {
  return new Map(
    providers.map(
      (provider) =>
        [provider.instanceId, deriveWorkflowRunRequiredSkills(provider, nodeId)] as const,
    ),
  );
}
