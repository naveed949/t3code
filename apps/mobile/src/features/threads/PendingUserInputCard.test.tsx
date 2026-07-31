import { ApprovalRequestId } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { PendingUserInputCard } from "./PendingUserInputCard";

vi.mock("react-native", async () => {
  const { createElement } = await import("react");
  return {
    Pressable: ({
      accessibilityState,
      ...props
    }: {
      readonly accessibilityState?: { readonly selected?: boolean; readonly disabled?: boolean };
      readonly [key: string]: unknown;
    }) =>
      createElement("button", {
        ...props,
        "data-accessibility-selected": accessibilityState?.selected,
        "data-accessibility-disabled": accessibilityState?.disabled,
      }),
    View: "View",
  };
});
vi.mock("../../components/AppText", () => ({ AppText: "Text", AppTextInput: "TextInput" }));

const { renderToStaticMarkup } = (await import("react-dom/server" as string)) as {
  readonly renderToStaticMarkup: (node: ReactNode) => string;
};

describe("PendingUserInputCard", () => {
  it("names mobile Decision Card controls and exposes selected and disabled state", () => {
    const markup = renderToStaticMarkup(
      <PendingUserInputCard
        pendingUserInput={{
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
        }}
        drafts={{ "decision-owner": { selectedOptionLabel: "Maintainers" } }}
        answers={null}
        respondingUserInputId={null}
        onSelectOption={() => undefined}
        onChangeCustomAnswer={() => undefined}
        onSubmit={async () => undefined}
        isWayfinderDecision
      />,
    );

    expect(markup).toContain('accessibilityRole="button"');
    expect(markup).toContain('accessibilityLabel="Maintainers. The core team owns deployment."');
    expect(markup).toContain('data-accessibility-selected="true"');
    expect(markup).toContain('data-accessibility-selected="false"');
    expect(markup).toContain('data-accessibility-disabled="false"');
    expect(markup).toContain('accessibilityLabel="Custom answer for Who owns deployment?"');
    expect(markup).toContain('accessibilityLabel="Confirm decision"');
  });
});
