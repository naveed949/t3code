import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from "@t3tools/contracts";

type ComposerSubmitEvent = { preventDefault: () => void };

export function getComposerPromptLengthValidationMessage(prompt: string): string | null {
  const excessCharacters = prompt.length - PROVIDER_SEND_TURN_MAX_INPUT_CHARS;
  if (excessCharacters <= 0) return null;

  const characterLabel = excessCharacters === 1 ? "character" : "characters";
  return `Prompt is ${excessCharacters.toLocaleString("en-US")} ${characterLabel} over the ${PROVIDER_SEND_TURN_MAX_INPUT_CHARS.toLocaleString("en-US")}-character limit. Shorten or split it before sending.`;
}

export function submitComposerDraft(options: {
  prompt: string;
  event: ComposerSubmitEvent | undefined;
  onSend: (event?: ComposerSubmitEvent) => void;
}): { validationMessage: string | null; didDispatch: boolean } {
  const validationMessage = getComposerPromptLengthValidationMessage(options.prompt);
  if (validationMessage) {
    options.event?.preventDefault();
    return { validationMessage, didDispatch: false };
  }

  options.onSend(options.event);
  return { validationMessage: null, didDispatch: true };
}
