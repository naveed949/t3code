import { describe, expect, it } from "vite-plus/test";

import { nativeSkillActionPrompt } from "./nativeSkillMenuActions.ts";

describe("nativeSkillActionPrompt", () => {
  it("keeps every Wayfinder launcher explicit in the composer", () => {
    expect(nativeSkillActionPrompt("wayfinder", "new-map")).toBe("$wayfinder new-map");
    expect(nativeSkillActionPrompt("wayfinder", "continue-map")).toBe("$wayfinder continue-map ");
    expect(nativeSkillActionPrompt("wayfinder", "generic")).toBe("$wayfinder generic ");
  });
});
