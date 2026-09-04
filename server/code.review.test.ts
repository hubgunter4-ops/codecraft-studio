import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const context = { user: undefined, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };

describe("code AI procedures", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reviews code using the server-side OpenAI key", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "## Resumen\nTodo correcto." } }] }), { status: 200 }));
    const previousKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-server-key";
    try {
      const result = await appRouter.createCaller(context).code.review({ code: "const answer = 42;", language: "javascript", mode: "review" });
      expect(result).toEqual({ result: "## Resumen\nTodo correcto.", mode: "review" });
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/chat/completions"), expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer test-server-key" }) }));
    } finally { process.env.OPENAI_API_KEY = previousKey; }
  });

  it("generates plain code from a natural-language request", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "```python\nprint('hola')\n```" } }] }), { status: 200 }));
    const result = await appRouter.createCaller(context).code.generate({ prompt: "Imprime hola", language: "python" });
    expect(result).toEqual({ code: "print('hola')", language: "python" });
  });

  it("rejects empty code and empty generation requests before calling the provider", async () => {
    await expect(appRouter.createCaller(context).code.review({ code: "", language: "python", mode: "correct" })).rejects.toThrow();
    await expect(appRouter.createCaller(context).code.generate({ prompt: "", language: "python" })).rejects.toThrow();
  });
});
