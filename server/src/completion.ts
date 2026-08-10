import {
  createOpenRouterCompletionFn,
  createLiteLLMCompletionFn,
  createOfflineCompletionFn,
  type CompletionFn,
} from "chat-core";

const litellmBaseUrl = process.env.LITELLM_BASE_URL;
const openrouterApiKey = process.env.OPENROUTER_API_KEY;

let completionFn: CompletionFn;
let completionMode: string;

if (litellmBaseUrl) {
  const model = process.env.LITELLM_MODEL || "gpt-4o-mini";
  completionFn = createLiteLLMCompletionFn({
    baseUrl: litellmBaseUrl,
    apiKey: process.env.LITELLM_API_KEY,
    model,
  });
  completionMode = `litellm:${model}`;
} else if (openrouterApiKey) {
  const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
  completionFn = createOpenRouterCompletionFn({
    apiKey: openrouterApiKey,
    model,
    title: "GreenHaven Statewave Demo",
  });
  completionMode = `openrouter:${model}`;
} else {
  completionFn = createOfflineCompletionFn();
  completionMode = "offline-rule-based";
}

export { completionFn, completionMode };
