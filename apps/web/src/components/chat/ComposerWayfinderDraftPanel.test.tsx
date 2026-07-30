import { emptyWayfinderDraft, ApprovalRequestId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerWayfinderDraftPanel } from "./ComposerWayfinderDraftPanel";

describe("ComposerWayfinderDraftPanel", () => {
  it("keeps the unpublished map and agent recommendation visually distinct", () => {
    const draft = {
      ...emptyWayfinderDraft("2026-01-01T00:00:00.000Z"),
      proposedDecisions: [
        {
          requestId: ApprovalRequestId.make("request:1"),
          question: {
            id: "scope",
            header: "Scope",
            question: "Which audience should lead?",
            options: [
              {
                label: "Maintainers (Recommended)",
                description: "Keeps the map focused.",
              },
            ],
            multiSelect: false,
          },
          recommendation: "Maintainers",
          reasoning: "Keeps the map focused.",
          proposedAt: "2026-01-01T00:01:00.000Z",
        },
      ],
    };

    const markup = renderToStaticMarkup(<ComposerWayfinderDraftPanel draft={draft} />);

    expect(markup).toContain("Unpublished Wayfinder draft");
    expect(markup).toContain("Non-canonical");
    expect(markup).toContain("nothing has been written to GitHub");
    expect(markup).toContain("Agent proposal");
    expect(markup).toContain("Recommended: Maintainers");
  });
});
