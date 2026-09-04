import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";

const languages = ["javascript", "typescript", "python", "java", "go", "rust", "html", "css", "json", "sql", "csharp", "cpp", "php", "ruby", "kotlin", "swift"] as const;
const languageSchema = z.enum(languages);
const reviewInput = z.object({ code: z.string().trim().min(1, "Escribe código antes de continuar").max(24_000, "El fragmento no puede superar 24.000 caracteres"), language: languageSchema, mode: z.enum(["review", "correct"]) });
const generateInput = z.object({ prompt: z.string().trim().min(4, "Describe qué quieres construir").max(4_000, "La petición no puede superar 4.000 caracteres"), language: languageSchema });
const modeInstructions = {
  review: "Analiza el fragmento y responde en español con Markdown: ## Resumen, ## Hallazgos (priorizados, con línea o sección), ## Recomendaciones (errores, rendimiento, seguridad y buenas prácticas). No reescribas todo el código.",
  correct: "Responde en español con Markdown. Incluye ## Versión corregida con el código completo en un único bloque y ## Qué cambió. Conserva la intención y no inventes dependencias.",
} as const;

async function callOpenAI(messages: Array<{ role: "system" | "user"; content: string }>, temperature = 0.2) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Falta configurar OPENAI_API_KEY en el entorno del servidor");
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OPENAI_MODEL ?? "gpt-4o-mini", temperature, max_tokens: 3_000, messages }), signal: AbortSignal.timeout(45_000) });
  if (!response.ok) { const detail = await response.text().catch(() => ""); console.error(`[OpenAI] ${response.status}: ${detail.slice(0, 500)}`); if (response.status === 401) throw new Error("La clave de OpenAI no es válida o no tiene permisos"); if (response.status === 429) throw new Error("OpenAI ha limitado temporalmente la solicitud"); throw new Error("OpenAI no pudo completar la solicitud"); }
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("OpenAI devolvió una respuesta vacía");
  return content;
}

async function requestReview(code: string, language: string, mode: "review" | "correct") {
  return callOpenAI([{ role: "system", content: `Eres CodeCraft, revisor de código preciso y pedagógico. Trabajas con ${language}. No ejecutes ni almacenes el código del usuario. ${modeInstructions[mode]}` }, { role: "user", content: `Revisa este fragmento de ${language}:\n\n\`\`\`${language}\n${code}\n\`\`\`` }]);
}

async function generateCode(prompt: string, language: string) {
  const result = await callOpenAI([{ role: "system", content: `Eres CodeCraft, un ingeniero de software experto. Genera código ${language} claro, funcional y listo para copiar. Devuelve SOLO el código, sin Markdown, sin explicaciones y sin bloques de triple backtick. No inventes APIs ni dependencias innecesarias.` }, { role: "user", content: `Construye lo siguiente en ${language}:\n\n${prompt}` }], 0.3);
  return result.replace(/^```[\w-]*\n?/, "").replace(/\n?```$/, "").trim();
}

export const appRouter = router({
  system: systemRouter,
  auth: router({ me: publicProcedure.query(opts => opts.ctx.user), logout: publicProcedure.mutation(({ ctx }) => { const cookieOptions = getSessionCookieOptions(ctx.req); ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 }); return { success: true } as const; }) }),
  code: router({
    review: publicProcedure.input(reviewInput).mutation(async ({ input }) => ({ result: await requestReview(input.code, input.language, input.mode), mode: input.mode })),
    generate: publicProcedure.input(generateInput).mutation(async ({ input }) => ({ code: await generateCode(input.prompt, input.language), language: input.language })),
  }),
});
export type AppRouter = typeof appRouter;
