import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { submitComposerDraft } from "./composerSubmission";

describe("submitComposerDraft", () => {
  it("keeps an oversized draft editable and sends a corrected follow-up", () => {
    let draft = "x".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS + 1);
    let validationMessage: string | null = null;
    const dispatchedDrafts: string[] = [];
    const preventDefault = vi.fn();

    const submit = () => {
      const result = submitComposerDraft({
        prompt: draft,
        event: { preventDefault },
        onSend: () => dispatchedDrafts.push(draft),
      });
      validationMessage = result.validationMessage;
    };

    submit();

    expect(dispatchedDrafts).toEqual([]);
    expect(draft).toHaveLength(PROVIDER_SEND_TURN_MAX_INPUT_CHARS + 1);
    expect(validationMessage).toBe(
      "Prompt is 1 character over the 120,000-character limit. Shorten or split it before sending.",
    );
    expect(preventDefault).toHaveBeenCalledOnce();

    draft = "Corrected prompt";
    submit();

    expect(dispatchedDrafts).toEqual(["Corrected prompt"]);
    expect(validationMessage).toBeNull();
  });

  it("allows a draft at the shared character limit through the normal send path", () => {
    const draft = "x".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS);
    const onSend = vi.fn();
    const preventDefault = vi.fn();

    const result = submitComposerDraft({
      prompt: draft,
      event: { preventDefault },
      onSend,
    });

    expect(result).toEqual({ validationMessage: null, didDispatch: true });
    expect(onSend).toHaveBeenCalledOnce();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
