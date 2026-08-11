import { describe, expect, it } from "vite-plus/test";

import {
  formatAllowanceDuration,
  formatAllowanceWindowScope,
  progressWidthForAllowance,
} from "./usageAllowance";

describe("usage allowance presentation", () => {
  it("uses the provider scope and duration without deriving missing values", () => {
    expect(formatAllowanceWindowScope("primary")).toBe("Primary limit");
    expect(formatAllowanceWindowScope("secondary")).toBe("Secondary limit");
    expect(formatAllowanceDuration(300)).toBe("5 hours");
    expect(formatAllowanceDuration(null)).toBeNull();
    expect(formatAllowanceDuration(undefined)).toBeNull();
  });

  it("clamps only the visual progress bar, preserving native percentage text", () => {
    expect(progressWidthForAllowance(-1)).toBe(0);
    expect(progressWidthForAllowance(42)).toBe(42);
    expect(progressWidthForAllowance(101)).toBe(100);
  });
});
