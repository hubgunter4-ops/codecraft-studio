import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const acceptedByFamily = {
  gpt: ["gpt-5-nano", "gpt-5-mini", "gpt-5", "gpt-5.5"],
  claude: ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-6", "claude-opus-4-7"],
  gemini: ["gemini-3-flash-preview", "gemini-3.1-pro-preview"],
};
const accepted = new Set(Object.values(acceptedByFamily).flat());
const forbidden = ["gpt-6-astra", "gemini-2.5-flash", "openai/gpt-4o-mini"];
const registry = readFileSync(join(root, "client/src/lib/aiConfig.ts"), "utf8");
const home = readFileSync(join(root, "client/src/pages/Home.tsx"), "utf8");
const server = readFileSync(join(root, "server/routers.ts"), "utf8");
const errors = [];

for (const model of forbidden) {
  if (registry.includes(model) || home.includes(model) || server.includes(model)) errors.push(`modelo obsoleto o inexistente encontrado: ${model}`);
}
if (/model:\s*["']anthropic\/claude-sonnet-4["']/.test(registry)) errors.push("modelo obsoleto o inexistente encontrado: anthropic/claude-sonnet-4");
for (const model of ["gpt-5-mini", "gemini-3-flash-preview", "anthropic/claude-sonnet-4-6"]) {
  if (!registry.includes(model)) errors.push(`falta modelo recomendado en el registro: ${model}`);
}
if (!registry.includes("max_completion_tokens")) errors.push("falta adaptación de tokens para GPT");
if (!registry.includes("max_tokens")) errors.push("falta adaptación de tokens para Claude/Gemini");
if (!registry.includes("discoverModels")) errors.push("falta descubrimiento dinámico de /models");
if (!server.includes('process.env.OPENAI_MODEL ?? "gpt-5-mini"')) errors.push("el backend no tiene gpt-5-mini como valor predeterminado");

const catalogJson = process.env.MODEL_CATALOG_JSON;
if (catalogJson) {
  let catalog;
  try { catalog = JSON.parse(catalogJson); } catch { errors.push("MODEL_CATALOG_JSON no es JSON válido"); }
  const liveIds = new Set((catalog?.data ?? catalog ?? []).map(item => typeof item === "string" ? item : item.id).filter(Boolean));
  for (const model of ["gpt-5-mini", "gemini-3-flash-preview", "gemini-3.1-pro-preview"]) {
    if (!liveIds.has(model)) errors.push(`el catálogo vivo no contiene ${model}`);
  }
}

if (errors.length) {
  console.error("Validación de modelos fallida:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Model registry OK · ${accepted.size} IDs de referencia · familias: ${Object.keys(acceptedByFamily).join(", ")}`);
console.log("Request adapters OK · GPT max_completion_tokens · Claude/Gemini max_tokens · /models discovery");
