import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverModels, isModelAllowedForProvider, modelFamily, modelRequestOptions, providerPresets } from "./aiConfig";

describe("registro de modelos y adaptadores", () => {
  afterEach(() => vi.restoreAllMocks());

  it("usa únicamente modelos por defecto aceptados", () => {
    expect(providerPresets.map(item => item.model)).toEqual([
      "gpt-5-mini",
      "gemini-3-flash-preview",
      "anthropic/claude-sonnet-4-6",
      "openai/gpt-5-mini",
      "llama3.2",
    ]);
  });

  it("detecta familias con gateway y aplica el parámetro de tokens correcto", () => {
    expect(modelFamily("gpt-5-mini")).toBe("gpt");
    expect(modelFamily("openai/gpt-5-mini")).toBe("gpt");
    expect(modelFamily("anthropic/claude-sonnet-4-6")).toBe("claude");
    expect(modelFamily("gemini-3-flash-preview")).toBe("gemini");
    expect(modelRequestOptions("gpt-5")).toEqual({ max_completion_tokens: 3000 });
    expect(modelRequestOptions("openai/gpt-5-mini")).toEqual({ max_completion_tokens: 3000 });
    expect(modelRequestOptions("claude-sonnet-4-6")).toEqual({ max_tokens: 3000 });
    expect(modelRequestOptions("gemini-3-flash-preview")).toEqual({ max_tokens: 3000 });
  });

  it("valida identificadores y descubre modelos del endpoint compatible", async () => {
    expect(isModelAllowedForProvider("openai", "gpt-5-mini")).toBe(true);
    expect(isModelAllowedForProvider("openai", "gpt 5")).toBe(false);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "gpt-5-mini" }, { id: "gpt-5" }] }), { status: 200 }));
    await expect(discoverModels("test-key", "https://example.test/v1")).resolves.toEqual(["gpt-5", "gpt-5-mini"]);
    expect(fetch).toHaveBeenCalledWith("https://example.test/v1/models", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-key" }) }));
  });
});
