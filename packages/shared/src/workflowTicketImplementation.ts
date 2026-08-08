import * as Encoding from "effect/Encoding";

function actionSegment(actionIdentity: string): string {
  return Encoding.encodeBase64Url(new TextEncoder().encode(actionIdentity)).slice(0, 48);
}

export function workflowTicketImplementationId(input: {
  readonly workstreamId: string;
  readonly nodeId: string;
  readonly actionIdentity: string;
}): string {
  return `workflow-ticket-implementation:${input.workstreamId}:${input.nodeId}:${input.actionIdentity}`;
}

export function workflowTicketImplementationThreadId(input: {
  readonly workstreamId: string;
  readonly ticketNumber: number;
  readonly actionIdentity: string;
}): string {
  return `workflow-ticket-implementation-thread:${input.workstreamId}:${input.ticketNumber}:${actionSegment(input.actionIdentity)}`;
}

export function workflowTicketImplementationBranch(input: {
  readonly ticketNumber: number;
  readonly actionIdentity: string;
}): string {
  return `codex/workflow/ticket-${input.ticketNumber}-${actionSegment(input.actionIdentity)}`;
}
