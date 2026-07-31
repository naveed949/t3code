import { ApprovalRequestId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerPendingUserInputPanel } from "./ComposerPendingUserInputPanel";

describe("ComposerPendingUserInputPanel", () => {
  it("names a Wayfinder Decision Card and exposes its selected state without motion", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingUserInputPanel
        pendingUserInputs={[
          {
            requestId: ApprovalRequestId.make("request:decision-owner"),
            createdAt: "2026-07-31T10:00:00.000Z",
            questions: [
              {
                id: "decision-owner",
                header: "Owner",
                question: "Who owns deployment?",
                options: [
                  { label: "Maintainers", description: "The core team owns deployment." },
                  { label: "Release team", description: "A separate team owns deployment." },
                ],
                multiSelect: false,
              },
            ],
          },
        ]}
        respondingRequestIds={[]}
        answers={{ "decision-owner": { selectedOptionLabels: ["Maintainers"] } }}
        questionIndex={0}
        onToggleOption={() => undefined}
        onAdvance={() => undefined}
        isWayfinderDecision
      />,
    );

    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-labelledby="wayfinder-decision-question-decision-owner"');
    expect(markup).toContain('id="wayfinder-decision-question-decision-owner"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain("motion-reduce:transition-none");
    expect(markup).toContain('aria-hidden="true"');
  });
});
