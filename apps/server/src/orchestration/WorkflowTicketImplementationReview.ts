import { TrimmedNonEmptyString, WorkflowCodeReviewFinding } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const WorkflowTicketImplementationReviewValidation = Schema.Struct({
  name: TrimmedNonEmptyString,
  status: Schema.Literals(["passed", "failed", "not-run"]),
  command: Schema.optional(TrimmedNonEmptyString),
  detail: Schema.optional(Schema.String),
});

const WorkflowTicketImplementationReviewResult = Schema.Struct({
  status: Schema.Literals(["passed", "must-fix"]),
  summary: TrimmedNonEmptyString,
  findings: Schema.Array(WorkflowCodeReviewFinding),
  validation: Schema.Array(WorkflowTicketImplementationReviewValidation),
});
export type WorkflowTicketImplementationReviewResult =
  typeof WorkflowTicketImplementationReviewResult.Type;

const decodeWorkflowTicketImplementationReviewResult = Schema.decodeUnknownOption(
  Schema.fromJsonString(WorkflowTicketImplementationReviewResult),
);

const RESULT_PATTERN =
  /<t3-ticket-implementation-review-result>(\{[\s\S]*?\})<\/t3-ticket-implementation-review-result>/u;

export function parseWorkflowTicketImplementationReviewResult(
  output: string,
): WorkflowTicketImplementationReviewResult | null {
  const match = RESULT_PATTERN.exec(output);
  if (!match?.[1]) return null;
  return Option.getOrNull(decodeWorkflowTicketImplementationReviewResult(match[1]));
}
