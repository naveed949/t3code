import { it as effectIt } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { describe, expect, it } from "vite-plus/test";

import {
  VERIFIED_WAYFINDER_CONTENT_DIGEST,
  resolveSkillInvocationRequest,
  resolveNativeSkillExecution,
} from "./NativeSkillAdapterRegistry.ts";

describe("resolveNativeSkillExecution", () => {
  it.each(["codex", "claudeAgent"] as const)(
    "recognizes the verified Wayfinder adapter for %s",
    (provider) => {
      expect(
        resolveNativeSkillExecution({
          provider: ProviderDriverKind.make(provider),
          skillName: "wayfinder",
          contentDigest: VERIFIED_WAYFINDER_CONTENT_DIGEST,
        }),
      ).toEqual({
        mode: "native",
        adapterId: "wayfinder",
        adapterVersion: 1,
      });
    },
  );

  it.each(["cursor", "grok", "opencode"] as const)(
    "uses truthful generic execution for unsupported provider %s",
    (provider) => {
      expect(
        resolveNativeSkillExecution({
          provider: ProviderDriverKind.make(provider),
          skillName: "wayfinder",
          contentDigest: VERIFIED_WAYFINDER_CONTENT_DIGEST,
        }),
      ).toEqual({
        mode: "generic",
        reason: "unsupported-provider",
      });
    },
  );

  it("does not treat a modified Wayfinder skill as compatible", () => {
    expect(
      resolveNativeSkillExecution({
        provider: ProviderDriverKind.make("codex"),
        skillName: "wayfinder",
        contentDigest: `sha256:${"0".repeat(64)}`,
      }),
    ).toEqual({
      mode: "generic",
      reason: "unsupported-digest",
    });
  });

  it("falls back for unregistered skills", () => {
    expect(
      resolveNativeSkillExecution({
        provider: ProviderDriverKind.make("codex"),
        skillName: "other",
        contentDigest: VERIFIED_WAYFINDER_CONTENT_DIGEST,
      }),
    ).toEqual({
      mode: "generic",
      reason: "unregistered-skill",
    });
  });

  it("honors an explicit generic Wayfinder launch on a native-capable provider", () => {
    expect(
      resolveNativeSkillExecution({
        provider: ProviderDriverKind.make("codex"),
        skillName: "wayfinder",
        contentDigest: VERIFIED_WAYFINDER_CONTENT_DIGEST,
        executionPreference: "generic",
      }),
    ).toEqual({ mode: "generic", reason: "user-selected-generic" });
  });
});

effectIt.layer(NodeServices.layer)("resolveSkillInvocationRequest", (it) => {
  it.effect(
    "pins the installed skill content and uses generic fallback for a modified digest",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDirectory = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3-native-skill-",
        });
        const skillPath = path.join(tempDirectory, "SKILL.md");
        yield* fileSystem.writeFileString(skillPath, "# locally modified Wayfinder");

        const resolved = yield* resolveSkillInvocationRequest({
          request: {
            skillName: "wayfinder",
            skillPath,
            arguments: "chart a release",
          },
          providerInstanceId: ProviderInstanceId.make("codex"),
          providers: [
            {
              driver: ProviderDriverKind.make("codex"),
              instanceId: ProviderInstanceId.make("codex"),
              skills: [{ name: "wayfinder", path: skillPath, enabled: true }],
            },
          ],
        });

        expect(resolved.skill.name).toBe("wayfinder");
        expect(resolved.skill.contentDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(resolved.execution).toEqual({
          mode: "generic",
          reason: "unsupported-digest",
        });
        expect(resolved.arguments).toBe("chart a release");

        const resolvedAction = yield* resolveSkillInvocationRequest({
          request: {
            skillName: "wayfinder",
            skillPath,
            action: { id: "new-map" },
          },
          providerInstanceId: ProviderInstanceId.make("codex"),
          providers: [
            {
              driver: ProviderDriverKind.make("codex"),
              instanceId: ProviderInstanceId.make("codex"),
              skills: [{ name: "wayfinder", path: skillPath, enabled: true }],
            },
          ],
        });
        expect(resolvedAction.action).toEqual({ id: "new-map" });
        expect(resolvedAction.arguments).toBe("new-map");
      }),
  );
});
