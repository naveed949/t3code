export type NativeSkillMenuAction = "run" | "new-map" | "continue-map" | "generic";

export function nativeSkillActionPrompt(skillName: string, action: NativeSkillMenuAction): string {
  switch (action) {
    case "new-map":
      return `$${skillName} new-map`;
    case "continue-map":
      return `$${skillName} continue-map `;
    case "generic":
      return `$${skillName} generic `;
    case "run":
      return `$${skillName} `;
  }
}
