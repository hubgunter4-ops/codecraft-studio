import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const context = { user: undefined, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };

describe("code.review", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends code to OpenAI from the server and returns its response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "## Resumen\nTodo correcto." } }] }), { status: 200 }));
    const previousKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-server-key";

    const result = await appRouter.createCaller(context).code.review({ code: "const answer = 42;", language: "javascript", mode: "review" });

    expect(result).toEqual({ result: "## Resumen\nTodo correcto.", mode: "review" });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/chat/completions"), expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer test-server-key" }),
    }));
    process.env.OPENAI_API_KEY = previousKey;
  });

  it("rejects empty code before calling the provider", async () => {
    await expect(appRouter.createCaller(context).code.review({ code: "", language: "python", mode: "correct" })).rejects.toThrow();
  });
});
