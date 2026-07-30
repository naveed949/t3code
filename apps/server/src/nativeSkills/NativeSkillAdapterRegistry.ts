import {
  OrchestrationDispatchCommandError,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ResolvedSkillInvocation,
  type SkillExecution,
  type SkillInvocationRequest,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";

import {
  VERIFIED_WAYFINDER_CONTENT_DIGEST,
  supportsNativeWayfinderProvider,
} from "./WayfinderCompatibility.ts";

export { VERIFIED_WAYFINDER_CONTENT_DIGEST } from "./WayfinderCompatibility.ts";

export function resolveNativeSkillExecution(input: {
  readonly provider: ProviderDriverKind;
  readonly skillName: string;
  readonly contentDigest: string;
  readonly executionPreference?: "generic";
}): SkillExecution {
  if (input.executionPreference === "generic") {
    return { mode: "generic", reason: "user-selected-generic" };
  }
  if (input.skillName !== "wayfinder") {
    return {
      mode: "generic",
      reason: "unregistered-skill",
    };
  }
  if (input.contentDigest !== VERIFIED_WAYFINDER_CONTENT_DIGEST) {
    return {
      mode: "generic",
      reason: "unsupported-digest",
    };
  }
  if (!supportsNativeWayfinderProvider(input.provider)) {
    return {
      mode: "generic",
      reason: "unsupported-provider",
    };
  }
  return {
    mode: "native",
    adapterId: "wayfinder",
    adapterVersion: 1,
  };
}

interface SkillProviderSnapshot {
  readonly driver: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  readonly skills: ReadonlyArray<{
    readonly name: string;
    readonly path: string;
    readonly enabled: boolean;
  }>;
}

export const resolveSkillInvocationRequest = Effect.fn("resolveSkillInvocationRequest")(
  function* (input: {
    readonly request: SkillInvocationRequest;
    readonly providerInstanceId: ProviderInstanceId;
    readonly providers: ReadonlyArray<SkillProviderSnapshot>;
  }): Effect.fn.Return<
    ResolvedSkillInvocation,
    OrchestrationDispatchCommandError,
    FileSystem.FileSystem | Crypto.Crypto
  > {
    const provider = input.providers.find(
      (candidate) => candidate.instanceId === input.providerInstanceId,
    );
    const installedSkill = provider?.skills.find(
      (skill) =>
        skill.enabled &&
        skill.name === input.request.skillName &&
        skill.path === input.request.skillPath,
    );
    if (!provider || !installedSkill) {
      return yield* new OrchestrationDispatchCommandError({
        message: `Skill '${input.request.skillName}' is not an enabled skill on provider instance '${input.providerInstanceId}'.`,
      });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const contents = yield* fileSystem.readFileString(installedSkill.path).pipe(
      Effect.mapError(
        (cause) =>
          new OrchestrationDispatchCommandError({
            message: `Failed to read skill '${input.request.skillName}': ${cause.message}`,
          }),
      ),
    );
    const crypto = yield* Crypto.Crypto;
    const digestBytes = yield* crypto.digest("SHA-256", new TextEncoder().encode(contents)).pipe(
      Effect.mapError(
        (cause) =>
          new OrchestrationDispatchCommandError({
            message: `Failed to pin skill '${input.request.skillName}': ${cause.message}`,
          }),
      ),
    );
    const contentDigest = `sha256:${Encoding.encodeHex(digestBytes)}`;

    return {
      skill: {
        name: installedSkill.name,
        path: installedSkill.path,
        contentDigest,
      },
      ...(input.request.arguments ? { arguments: input.request.arguments } : {}),
      ...(input.request.action ? { action: input.request.action } : {}),
      execution: resolveNativeSkillExecution({
        provider: provider.driver,
        skillName: installedSkill.name,
        contentDigest,
        ...(input.request.executionPreference
          ? { executionPreference: input.request.executionPreference }
          : {}),
      }),
    };
  },
);
