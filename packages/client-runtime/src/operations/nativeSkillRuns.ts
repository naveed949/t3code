import type {
  ServerProviderSkill,
  SkillInvocationRequest,
  SkillRunId,
  ThreadId,
} from "@t3tools/contracts";
import {
  createSkillInvocationRequest,
  resolveLeadingSkillInvocationRequest,
} from "@t3tools/shared/composerInlineTokens";

type SelectableSkill = Pick<ServerProviderSkill, "name" | "path" | "enabled">;

export function createWayfinderToSpecInvocationRequest(input: {
  readonly skill: SelectableSkill;
  readonly sourceSkillRunId: SkillRunId;
  readonly sourceThreadId: ThreadId;
  readonly destination: string;
  readonly canonicalReference: { readonly number: number; readonly url: string };
  readonly wayfinderSynchronizedAt: string;
  readonly acknowledgedIncomplete: boolean;
}): SkillInvocationRequest | null {
  if (!input.skill.enabled || input.skill.name !== "to-spec") return null;

  const destination = input.destination.trim();
  return {
    ...createSkillInvocationRequest(
      input.skill,
      `Create a specification from the Wayfinder map at ${input.canonicalReference.url}.${destination === "" ? "" : ` Destination: ${destination}`}`,
    ),
    action: {
      id: "handoff-to-spec",
      sourceSkillRunId: input.sourceSkillRunId,
      sourceThreadId: input.sourceThreadId,
      canonicalReference: input.canonicalReference,
      wayfinderSynchronizedAt: input.wayfinderSynchronizedAt,
      acknowledgedIncomplete: input.acknowledgedIncomplete,
    },
    executionPreference: "generic",
  };
}

export type NativeSkillRunInvocationIntent =
  | {
      readonly kind: "leading-token";
      readonly text: string;
      readonly skills: ReadonlyArray<SelectableSkill>;
    }
  | {
      readonly kind: "picker-selection";
      readonly skill: SelectableSkill;
      readonly arguments?: string;
    }
  | {
      readonly kind: "native-action";
      readonly skill: SelectableSkill;
      readonly arguments?: string;
      readonly action?:
        | { readonly id: "new-map" }
        | { readonly id: "continue-map"; readonly reference?: string };
      readonly executionPreference?: "generic";
    };

export type NativeSkillRunInvocationChooser = {
  readonly kind: "chooser";
  readonly reason: "launch-selection-required" | "continuation-reference-required";
};

function resolveGitHubIssueReference(reference: string | undefined): string | null {
  const trimmed = reference?.trim() ?? "";
  const direct = /^#?(\d+)$/u.exec(trimmed);
  if (direct?.[1]) return direct[1];
  try {
    const url = new URL(trimmed);
    const match = /^\/[^/]+\/[^/]+\/issues\/(\d+)\/?$/u.exec(url.pathname);
    return url.hostname === "github.com" && match?.[1] ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Canonical client seam for every explicit way into a native Skill Run.
 * Callers send the resulting request with `thread.turn.start`; the server owns
 * validation, digest pinning, and durable Workstream / Skill Run identities.
 */
export function resolveNativeSkillRunInvocation(
  intent: Extract<NativeSkillRunInvocationIntent, { readonly kind: "leading-token" }>,
): SkillInvocationRequest | NativeSkillRunInvocationChooser | null;
export function resolveNativeSkillRunInvocation(
  intent: Extract<NativeSkillRunInvocationIntent, { readonly kind: "picker-selection" }>,
): SkillInvocationRequest | null;
export function resolveNativeSkillRunInvocation(
  intent: Extract<NativeSkillRunInvocationIntent, { readonly kind: "native-action" }>,
): SkillInvocationRequest | NativeSkillRunInvocationChooser | null;
export function resolveNativeSkillRunInvocation(
  intent: NativeSkillRunInvocationIntent,
): SkillInvocationRequest | NativeSkillRunInvocationChooser | null {
  if (intent.kind === "leading-token") {
    const request = resolveLeadingSkillInvocationRequest(intent.text, intent.skills);
    if (request?.skillName !== "wayfinder") return request;
    const wayfinderArguments = request.arguments?.trim() ?? "";
    if (wayfinderArguments === "new-map") {
      return { ...request, action: { id: "new-map" } };
    }
    if (wayfinderArguments === "generic" || wayfinderArguments.startsWith("generic ")) {
      return { ...request, executionPreference: "generic" };
    }
    const continueMatch = /^continue-map(?:\s+(.*))?$/u.exec(wayfinderArguments);
    if (continueMatch) {
      const suppliedReference = continueMatch[1]?.trim();
      const issueReference = resolveGitHubIssueReference(suppliedReference);
      return issueReference
        ? { ...request, action: { id: "continue-map", reference: issueReference } }
        : { kind: "chooser", reason: "continuation-reference-required" };
    }
    return { kind: "chooser", reason: "launch-selection-required" };
  }
  if (!intent.skill.enabled) {
    return null;
  }
  const request = createSkillInvocationRequest(intent.skill, intent.arguments);
  if (intent.kind === "picker-selection") {
    return request;
  }
  if (intent.action?.id === "continue-map") {
    const issueReference = resolveGitHubIssueReference(intent.action.reference);
    if (issueReference === null) {
      return { kind: "chooser", reason: "continuation-reference-required" };
    }
    return {
      ...request,
      action: { id: "continue-map", reference: issueReference },
      ...(intent.executionPreference ? { executionPreference: intent.executionPreference } : {}),
    };
  }
  return {
    ...request,
    ...(intent.action ? { action: intent.action } : {}),
    ...(intent.executionPreference ? { executionPreference: intent.executionPreference } : {}),
  };
}
