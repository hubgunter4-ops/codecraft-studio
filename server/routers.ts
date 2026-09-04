import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";

const reviewInput = z.object({
  code: z.string().trim().min(1, "Escribe código antes de continuar").max(24_000, "El fragmento no puede superar 24.000 caracteres"),
  language: z.enum(["javascript", "typescript", "python", "java", "go", "rust"]),
  mode: z.enum(["review", "correct"]),
});

const modeInstructions = {
  review: `Analiza el fragmento y responde en español con este formato Markdown:
## Resumen
Una frase clara sobre el estado general.
## Hallazgos
Lista priorizada de errores, riesgos y oportunidades; indica línea o sección cuando sea posible.
## Recomendaciones
Cambios concretos, incluyendo rendimiento, legibilidad, seguridad y buenas prácticas cuando apliquen.
Si no hay problemas relevantes, dilo explícitamente. No reescribas todo el código en esta respuesta.`,
  correct: `Devuelve una respuesta en español con este formato Markdown:
## Versión corregida
Incluye el código completo corregido dentro de un único bloque de código con el lenguaje indicado.
## Qué cambió
Lista breve de cada corrección y el motivo.
Conserva la intención original, no inventes dependencias y señala cualquier supuesto importante.`,
} as const;

async function requestOpenAI(code: string, language: string, mode: "review" | "correct") {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Falta configurar OPENAI_API_KEY en el entorno del servidor");

  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 2_500,
      messages: [
        { role: "system", content: `Eres CodeCraft, un revisor de código preciso y pedagógico. Trabajas con ${language}. Sé directo, evita elogios vacíos y no ejecutes ni almacenes el código del usuario. ${modeInstructions[mode]}` },
        { role: "user", content: `Revisa este fragmento de ${language}:\n\n\`\`\`${language}\n${code}\n\`\`\`` },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`[OpenAI] Request failed with status ${response.status}: ${detail.slice(0, 500)}`);
    if (response.status === 401) throw new Error("La clave de OpenAI no es válida o no tiene permisos");
    if (response.status === 429) throw new Error("OpenAI ha limitado temporalmente la solicitud; inténtalo de nuevo en un momento");
    throw new Error("OpenAI no pudo completar la revisión");
  }

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("OpenAI devolvió una respuesta vacía");
  return content;
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  code: router({
    review: publicProcedure.input(reviewInput).mutation(async ({ input }) => ({
      result: await requestOpenAI(input.code, input.language, input.mode),
      mode: input.mode,
    })),
  }),
});

export type AppRouter = typeof appRouter;
