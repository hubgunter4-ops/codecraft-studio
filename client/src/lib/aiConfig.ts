export type ProviderId = "openai" | "gemini" | "anthropic" | "openrouter" | "ollama";

export const apiKeyStorage = "codecraft.ai.apiKey";
export const baseUrlStorage = "codecraft.ai.baseUrl";
export const providerStorage = "codecraft.ai.provider";
export const modelStorage = "codecraft.ai.model";

export type StoredAiConfig = {
  apiKey: string;
  baseUrl: string;
  provider: ProviderId;
  model: string;
};

export function readAiConfig(): StoredAiConfig {
  const provider = (sessionStorage.getItem(providerStorage) as ProviderId | null) ?? "openai";
  return {
    apiKey: sessionStorage.getItem(apiKeyStorage) ?? "",
    baseUrl: sessionStorage.getItem(baseUrlStorage) ?? "https://api.openai.com/v1",
    provider,
    model: sessionStorage.getItem(modelStorage) ?? "gpt-5-mini",
  };
}
