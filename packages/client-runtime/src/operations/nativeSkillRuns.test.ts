import { describe, expect, it } from "vite-plus/test";

import { resolveNativeSkillRunInvocation } from "./nativeSkillRuns.ts";

describe("resolveNativeSkillRunInvocation", () => {
  const skill = {
    name: "wayfinder",
    path: "/skills/wayfinder/SKILL.md",
    enabled: true,
  };
  const expected = {
    skillName: "wayfinder",
    skillPath: "/skills/wayfinder/SKILL.md",
    arguments: "chart a release",
  };

  it("gives picker, leading-token, and native-action entry points one typed identity", () => {
    expect(
      resolveNativeSkillRunInvocation({
        kind: "picker-selection",
        skill,
        arguments: "chart a release",
      }),
    ).toEqual(expected);
    expect(
      resolveNativeSkillRunInvocation({
        kind: "leading-token",
        text: "$wayfinder chart a release",
        skills: [skill],
      }),
    ).toEqual(expected);
    expect(
      resolveNativeSkillRunInvocation({
        kind: "native-action",
        skill,
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
});
