export type ProviderId = "openai" | "gemini" | "anthropic" | "openrouter" | "ollama";
export type ModelFamily = "gpt" | "claude" | "gemini" | "other";

export const apiKeyStorage = "codecraft.ai.apiKey";
export const baseUrlStorage = "codecraft.ai.baseUrl";
export const providerStorage = "codecraft.ai.provider";
export const modelStorage = "codecraft.ai.model";

export type ProviderPreset = {
  id: ProviderId;
  label: string;
  hint: string;
  baseUrl: string;
  model: string;
  placeholder: string;
};

// Identificadores verificados contra el catálogo vivo del proxy el 2026-10-03.
// Los proveedores externos pueden mostrar un catálogo diferente y se pueden descubrir con /models.
export const providerPresets: ProviderPreset[] = [
  { id: "openai", label: "OpenAI · GPT-5 mini", hint: "API compatible con OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-5-mini", placeholder: "sk-..." },
  { id: "gemini", label: "Google Gemini · 3 Flash", hint: "Endpoint OpenAI-compatible de Google", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3-flash-preview", placeholder: "AIza..." },
  { id: "anthropic", label: "Anthropic Claude · Sonnet 4.6", hint: "Claude usando OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "anthropic/claude-sonnet-4-6", placeholder: "sk-or-..." },
  { id: "openrouter", label: "OpenRouter · GPT-5 mini", hint: "Muchos modelos en un endpoint", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-5-mini", placeholder: "sk-or-..." },
  { id: "ollama", label: "Ollama local", hint: "Modelo local · sin API key", baseUrl: "http://localhost:11434/v1", model: "llama3.2", placeholder: "ollama (opcional)" },
];

export type StoredAiConfig = {
  apiKey: string;
  baseUrl: string;
  provider: ProviderId;
  model: string;
};

export function readAiConfig(): StoredAiConfig {
  const provider = (sessionStorage.getItem(providerStorage) as ProviderId | null) ?? "openai";
  const preset = providerPresets.find(item => item.id === provider) ?? providerPresets[0];
  return {
    apiKey: sessionStorage.getItem(apiKeyStorage) ?? "",
    baseUrl: sessionStorage.getItem(baseUrlStorage) ?? preset.baseUrl,
    provider,
    model: sessionStorage.getItem(modelStorage) ?? preset.model,
  };
}

export function modelFamily(model: string): ModelFamily {
  const value = model.trim().toLowerCase().replace(/^[a-z0-9_-]+\//, "");
  if (/^(gpt-|o[1345](?:$|[-.]))/.test(value)) return "gpt";
  if (value.includes("claude")) return "claude";
  if (value.startsWith("gemini-")) return "gemini";
  return "other";
}

export function modelRequestOptions(model: string) {
  switch (modelFamily(model)) {
    case "gpt":
      return { max_completion_tokens: 3000 } as const;
    case "claude":
    case "gemini":
      return { max_tokens: 3000 } as const;
    default:
      return { temperature: 0.25, max_tokens: 3000 } as const;
  }
}

export function isModelAllowedForProvider(provider: ProviderId, model: string) {
  const value = model.trim();
  if (!value) return false;
  if (provider === "ollama") return /^[a-z0-9][a-z0-9._:/-]*$/i.test(value);
  return !/[\s`"'<>]/.test(value) && value.length <= 160;
}

export async function discoverModels(apiKey: string, baseUrl: string) {
  const endpoint = baseUrl.trim().replace(/\/$/, "");
  const response = await fetch(`${endpoint}/models`, {
    headers: { Accept: "application/json", ...(apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}) },
  });
  if (!response.ok) throw new Error(`No se pudo consultar el catálogo de modelos (${response.status})`);
  const payload = await response.json() as { data?: Array<{ id?: string }> };
  return (payload.data ?? []).map(item => item.id?.trim()).filter((id): id is string => Boolean(id)).sort((a, b) => a.localeCompare(b));
}
