import { describe, expect, it } from "vitest";

describe("OpenAI configuration", () => {
  it("authenticates against the models endpoint with the server-side key", async () => {
    const key = process.env.OPENAI_API_KEY;
    expect(key, "OPENAI_API_KEY must be configured").toBeTruthy();

    const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });

    expect(response.ok, `OpenAI models endpoint returned ${response.status}`).toBe(true);
  }, 15_000);
});
