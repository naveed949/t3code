import { describe, expect, it } from "vite-plus/test";

import { parseWorkflowTicketImplementationReviewResult } from "./WorkflowTicketImplementationReview.ts";

describe("parseWorkflowTicketImplementationReviewResult", () => {
  it("accepts the structured review receipt emitted by the pinned child", () => {
    expect(
      parseWorkflowTicketImplementationReviewResult(
        '<t3-ticket-implementation-review-result>{"status":"passed","summary":"No must-fix findings.","findings":[],"validation":[{"name":"focused tests","status":"passed"}]}</t3-ticket-implementation-review-result>',
      ),
    ).toEqual({
      status: "passed",
      summary: "No must-fix findings.",
      findings: [],
      validation: [{ name: "focused tests", status: "passed" }],
    });
  });

  it("rejects prose without the structured receipt", () => {
    expect(parseWorkflowTicketImplementationReviewResult("Review completed successfully.")).toBe(
      null,
    );
  });
});
