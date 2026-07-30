import { describe, expect, it } from "vite-plus/test";

import { resolveNativeSkillRunInvocation } from "./nativeSkillRuns.ts";

describe("resolveNativeSkillRunInvocation", () => {
  const skill = {
    name: "wayfinder",
    path: "/skills/wayfinder/SKILL.md",
    enabled: true,
  };

  it("gives picker, leading-token, and native-action entry points one typed identity", () => {
    const genericSkill = { ...skill, name: "research" };
    const expected = {
      skillName: "research",
      skillPath: genericSkill.path,
      arguments: "chart a release",
    };
    expect(
      resolveNativeSkillRunInvocation({
        kind: "picker-selection",
        skill: genericSkill,
        arguments: "chart a release",
      }),
    ).toEqual(expected);
    expect(
      resolveNativeSkillRunInvocation({
        kind: "leading-token",
        text: "$research chart a release",
        skills: [genericSkill],
      }),
    ).toEqual(expected);
    expect(
      resolveNativeSkillRunInvocation({
        kind: "native-action",
        skill: genericSkill,
        arguments: "chart a release",
      }),
    ).toEqual(expected);
  });

  it("does not create an invocation from ordinary prose", () => {
    expect(
      resolveNativeSkillRunInvocation({
        kind: "leading-token",
        text: "Tell me whether Wayfinder would help",
        skills: [skill],
      }),
    ).toBeNull();
  });

  it("creates explicit new-map and generic Wayfinder launches", () => {
    expect(
      resolveNativeSkillRunInvocation({
        kind: "native-action",
        skill,
        action: { id: "new-map" },
      }),
    ).toEqual({
      skillName: "wayfinder",
      skillPath: skill.path,
      action: { id: "new-map" },
    });
    expect(
      resolveNativeSkillRunInvocation({
        kind: "native-action",
        skill,
        action: { id: "new-map" },
        executionPreference: "generic",
      }),
    ).toEqual({
      skillName: "wayfinder",
      skillPath: skill.path,
      action: { id: "new-map" },
      executionPreference: "generic",
    });
  });

  it("returns a chooser instead of guessing a missing continuation issue", () => {
    expect(
      resolveNativeSkillRunInvocation({
        kind: "native-action",
        skill,
        action: { id: "continue-map" },
      }),
    ).toEqual({
      kind: "chooser",
      reason: "continuation-reference-required",
    });
  });

  it("resolves an unambiguous continuation issue number or GitHub URL", () => {
    for (const [reference, expectedReference] of [
      ["#42", "42"],
      [
        "https://github.com/t3tools/t3code/issues/42",
        "https://github.com/t3tools/t3code/issues/42",
      ],
    ] as const) {
      expect(
        resolveNativeSkillRunInvocation({
          kind: "native-action",
          skill,
          action: { id: "continue-map", reference },
        }),
      ).toEqual({
        skillName: "wayfinder",
        skillPath: skill.path,
        action: { id: "continue-map", reference: expectedReference },
      });
    }
  });

  it("preserves typed Wayfinder launch choices entered from web or mobile composers", () => {
    expect(
      resolveNativeSkillRunInvocation({
        kind: "leading-token",
        text: "$wayfinder new-map",
        skills: [skill],
      }),
    ).toMatchObject({ action: { id: "new-map" } });
    expect(
      resolveNativeSkillRunInvocation({
        kind: "leading-token",
        text: "$wayfinder continue-map #42",
        skills: [skill],
      }),
    ).toMatchObject({ action: { id: "continue-map", reference: "42" } });
    expect(
      resolveNativeSkillRunInvocation({
        kind: "leading-token",
        text: "$wayfinder generic continue without native GitHub features",
        skills: [skill],
      }),
    ).toMatchObject({ executionPreference: "generic" });
  });

  it("returns chooser state for an ambiguous continuation without guessing", () => {
    expect(
      resolveNativeSkillRunInvocation({
        kind: "leading-token",
        text: "$wayfinder continue-map 42 and 43",
        skills: [skill],
      }),
    ).toEqual({ kind: "chooser", reason: "continuation-reference-required" });
  });

  it("requires an explicit launch choice for a bare Wayfinder invocation", () => {
    expect(
      resolveNativeSkillRunInvocation({
        kind: "leading-token",
        text: "$wayfinder",
        skills: [skill],
      }),
    ).toEqual({ kind: "chooser", reason: "launch-selection-required" });
  });
});
