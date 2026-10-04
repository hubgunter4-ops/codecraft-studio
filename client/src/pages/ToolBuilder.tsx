import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { readAiConfig } from "@/lib/aiConfig";
import {
  Archive,
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Code2,
  Download,
  FileCode2,
  FolderTree,
  Github,
  Info,
  Loader2,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  Terminal,
  UploadCloud,
  Wrench,
  WandSparkles,
} from "lucide-react";

type Distro = "debian" | "fedora" | "arch" | "alpine" | "opensuse";
type OutputMode = "script" | "repo";
type GeneratedFile = { path: string; content: string; executable?: boolean };
type ProjectFileSpec = { path: string; role?: string };

type ToolBundle = {
  name: string;
  slug: string;
  distro: Distro;
  mode: OutputMode;
  summary: string;
  script: string;
  files: GeneratedFile[];
};

type GitFile = { path: string; content: string; sha?: string };
type GitRepo = { owner: string; repo: string; branch: string; files: GitFile[] };
type RepairPatch = { id: string; path: string; summary: string; content: string };
const githubTokenStorage = "codecraft.github.token";

function bytesToUtf8Base64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToUtf8(value: string) {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function parseGitHubRepo(value: string) {
  const match = value.trim().replace(/\.git$/, "").match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\/|$)/i) ?? value.trim().match(/^([^/]+)\/([^/]+)$/);
  if (!match) throw new Error("Usa una URL como https://github.com/usuario/repositorio");
  return { owner: match[1], repo: match[2] };
}

async function githubRequest<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, { ...init, headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", ...(init?.headers ?? {}) } });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const message = response.status === 401 ? "token inválido" : response.status === 403 ? "acceso denegado o límite de GitHub alcanzado" : response.status === 404 ? "repositorio, rama o archivo no encontrado" : response.status === 422 ? "GitHub rechazó los datos enviados" : response.statusText;
    throw new Error(`GitHub respondió ${response.status}: ${message}${detail ? ` · ${detail.slice(0, 180)}` : ""}`);
  }
  return response.json() as Promise<T>;
}

async function loadGitHubRepo(token: string, source: string, branch: string): Promise<GitRepo> {
  const { owner, repo } = parseGitHubRepo(source);
  const tree = await githubRequest<{ truncated?: boolean; tree?: Array<{ path: string; type: string; sha: string }> }>(token, `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  if (tree.truncated) throw new Error("GitHub truncó el árbol del repositorio; usa un repositorio más pequeño o repara una copia local");
  const entries = (tree.tree ?? []).filter(item => item.type === "blob" && !item.path.startsWith(".git/") && !item.path.includes("node_modules/")).slice(0, 80);
  if (entries.length === 0) throw new Error("No se encontraron archivos reparables en ese repositorio");
  const files = await Promise.all(entries.map(async entry => {
    const data = await githubRequest<{ content?: string; encoding?: string }>(token, `/repos/${owner}/${repo}/contents/${entry.path}?ref=${encodeURIComponent(branch)}`);
    const content = data.encoding === "base64" ? base64ToUtf8(data.content ?? "") : data.content ?? "";
    return { path: entry.path, content, sha: entry.sha };
  }));
  return { owner, repo, branch, files };
}

async function askRepair(key: string, baseUrl: string, model: string, repo: GitRepo, request: string) {
  const snapshot = repo.files.map(file => `--- ${file.path} ---\n${file.content}`).join("\n").slice(0, 100_000);
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: model || "gpt-5-mini", temperature: 0.15, max_tokens: 3500, response_format: { type: "json_object" }, messages: [{ role: "system", content: "Eres un ingeniero Linux experto. Analiza un repositorio sin ejecutar sus archivos. Devuelve JSON válido con esta forma exacta: {\"summary\":\"resumen en español\",\"patches\":[{\"id\":\"slug\",\"path\":\"ruta existente\",\"summary\":\"cambio\",\"content\":\"contenido completo nuevo del archivo\"}]}. Incluye solo parches seguros para archivos presentes en el repositorio. No inventes resultados de ejecución ni incluyas secretos." }, { role: "user", content: `Solicitud de reparación: ${request}\n\nRepositorio ${repo.owner}/${repo.repo}:\n${snapshot}` }] }) });
  if (!response.ok) throw new Error(`OpenAI respondió ${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const raw = payload.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error("OpenAI devolvió una respuesta vacía");
  const parsed = JSON.parse(raw) as { summary?: string; patches?: Array<{ id?: string; path?: string; summary?: string; content?: string }> };
  const validPaths = new Set(repo.files.map(file => file.path));
  return { summary: parsed.summary ?? "Diagnóstico generado", patches: (parsed.patches ?? []).filter(patch => patch.path && validPaths.has(patch.path) && typeof patch.content === "string").map((patch, index) => ({ id: patch.id || `patch-${index + 1}`, path: patch.path!, summary: patch.summary || "Cambio propuesto", content: patch.content! })) };
}

async function publishGitHubRepo(token: string, repo: GitRepo, files: GeneratedFile[], message: string) {
  if (files.length === 0) throw new Error("No hay archivos modificados para publicar");
  const ref = await githubRequest<{ object: { sha: string } }>(token, `/repos/${repo.owner}/${repo.repo}/git/ref/heads/${encodeURIComponent(repo.branch)}`);
  const parent = await githubRequest<{ tree: { sha: string } }>(token, `/repos/${repo.owner}/${repo.repo}/git/commits/${ref.object.sha}`);
  const blobs = await Promise.all(files.map(async file => {
    const blob = await githubRequest<{ sha: string }>(token, `/repos/${repo.owner}/${repo.repo}/git/blobs`, { method: "POST", body: JSON.stringify({ content: bytesToUtf8Base64(file.content), encoding: "base64" }) });
    return { path: file.path, mode: file.executable ? "100755" : "100644", type: "blob", sha: blob.sha };
  }));
  const tree = await githubRequest<{ sha: string }>(token, `/repos/${repo.owner}/${repo.repo}/git/trees`, { method: "POST", body: JSON.stringify({ base_tree: parent.tree.sha, tree: blobs }) });
  const commit = await githubRequest<{ sha: string }>(token, `/repos/${repo.owner}/${repo.repo}/git/commits`, { method: "POST", body: JSON.stringify({ message, tree: tree.sha, parents: [ref.object.sha] }) });
  await githubRequest(token, `/repos/${repo.owner}/${repo.repo}/git/refs/heads/${encodeURIComponent(repo.branch)}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) });
  return commit.sha;
}

const distros: Array<{ value: Distro; label: string; hint: string; manager: string }> = [
  { value: "debian", label: "Ubuntu / Debian", hint: "apt · Linux Mint · Pop!_OS", manager: "apt-get" },
  { value: "fedora", label: "Fedora / RHEL", hint: "dnf · Rocky · AlmaLinux", manager: "dnf" },
  { value: "arch", label: "Arch Linux", hint: "pacman · Manjaro", manager: "pacman" },
  { value: "alpine", label: "Alpine Linux", hint: "apk · contenedores", manager: "apk" },
  { value: "opensuse", label: "openSUSE", hint: "zypper · SLES", manager: "zypper" },
];
const commandPresets = [
  { value: "system", label: "Diagnóstico del sistema", command: "uname -a && printf '\\nCPU:\\n' && nproc && printf '\\nMemory:\\n' && free -h" },
  { value: "disk", label: "Espacio en disco", command: "df -h / && printf '\\nLargest directories:\\n' && du -xhd1 / 2>/dev/null | sort -h | tail -n 10" },
  { value: "network", label: "Red y conectividad", command: "ip -brief address && printf '\\nDNS:\\n' && getent hosts example.com" },
  { value: "processes", label: "Procesos activos", command: "ps aux --sort=-%cpu | head -n 11" },
  { value: "logs", label: "Últimos logs", command: "journalctl -p warning..alert -n 50 --no-pager" },
] as const;

function deriveCommandFromRequest(description: string, currentCommand: string) {
  const text = description.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const injectionRequest = /(inject|inyecc|modify context|modificar contexto|payload|obfuscat|bypass|evasion|exploit)/.test(text);
  if (injectionRequest) {
    return {
      command: "printf '%s\\n' '[safe-audit] Revisando archivos y patrones de inyección sin modificar el sistema' && grep -RInE 'eval\\(|source[[:space:]]|curl[^|]*\\|[[:space:]]*(ba)?sh|wget[^|]*\\|[[:space:]]*(ba)?sh' . --exclude-dir=.git --exclude='*.log' 2>/dev/null || true",
      warning: "La petición contiene una instrucción de inyección o modificación de contexto; se convirtió en una auditoría segura de solo lectura.",
    };
  }
  const detected = commandPresets.find(item => item.value === detectCommandPreset(description));
  const isPresetCommand = commandPresets.some(item => item.command === currentCommand.trim());
  return detected && isPresetCommand
    ? { command: detected.command, warning: "" }
    : { command: currentCommand.trim(), warning: "" };
}

function detectCommandPreset(description: string) {
  const text = description.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/(disco|espacio|almacenamiento|directorio|carpeta)/.test(text)) return "disk";
  if (/(red|redes|internet|conexion|dns|puerto|conectividad)/.test(text)) return "network";
  if (/(proceso|procesos|cpu|consumo|carga)/.test(text)) return "processes";
  if (/(log|logs|registro|registros|journal|error)/.test(text)) return "logs";
  return "system";
}

function normalizeDetectedCommand(value: string) {
  return value.replace(/```(?:bash|sh|shell)?/gi, "").replace(/```/g, "").replace(/^['"`\s]+|['"`\s]+$/g, "").replace(/\s+/g, " ").trim();
}

function normalizeDetectedPackages(value: string) {
  return value.split(/[\s,;]+/).map(item => item.replace(/^[`'"([{]+|[`'"\])},.]+$/g, "").trim()).filter(item => /^[A-Za-z0-9][A-Za-z0-9@._+:-]*$/.test(item) && !/^(y|and|e|with|para|con|instala|install)$/i.test(item));
}

export function extractToolSpec(description: string, fallbackCommand: string, fallbackPackages: string) {
  const text = description.replace(/\r/g, "");
  const packageMatch = text.match(/(?:paquetes?\s+opcionales?|dependencias?|packages?|requiere|instala(?:r)?|install)\s*[:=\-]?\s*([^\n]+)/i);
  const commandMatch = text.match(/(?:comando\s+(?:principal|a\s+ejecutar)|comando|ejecuta|run)\s*[:=\-]?\s*([^\n]+)/i);
  const packageValues = packageMatch ? normalizeDetectedPackages(packageMatch[1]) : [];
  const inferredPackages = packageValues.length ? packageValues : ["curl", "jq", "ripgrep", "git", "python3", "node", "docker"].filter(item => new RegExp(`(?:^|[^a-z0-9])${item}(?:$|[^a-z0-9])`, "i").test(text));
  const command = commandMatch ? normalizeDetectedCommand(commandMatch[1]) : fallbackCommand.trim();
  const packagesValue = inferredPackages.length ? Array.from(new Set(inferredPackages)).join(" ") : fallbackPackages.trim();
  return { packages: packagesValue, command, packageDetected: inferredPackages.length > 0, commandDetected: Boolean(commandMatch) };
}

function improveRequest(description: string, distro: Distro, presetLabel: string) {
  const clean = description.trim().replace(/\s+/g, " ");
  return `Construye una herramienta Linux para ${distro} que cumpla exactamente este objetivo: ${clean}. Conserva la intención y el resultado funcional solicitado. Usa como referencia la categoría ${presetLabel}, genera archivos autocontenidos y documenta los requisitos. Incluye validación de entradas, permisos mínimos, modo dry-run y mensajes claros. No ejecutes comandos durante la generación, no incluyas secretos y solicita revisión humana antes de cualquier acción destructiva o publicación.`;
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0,  fortyEight());
}

function fortyEight() {
  return 48;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function packageTokens(value: string) {
  return value.trim().split(/\s+/).filter(Boolean);
}

function normalizeProjectPath(value: string) {
  const path = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!path || path.startsWith("/") || path.includes("..") || /[\u0000\r\n]/.test(path)) throw new Error(`Ruta de proyecto no válida: “${value}”`);
  return path.split("/").filter(Boolean).join("/");
}

export function parseProjectStructure(value: string): ProjectFileSpec[] {
  const entries = value.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#"));
  const files = entries.map(line => {
    const [rawPath, rawRole] = line.split("|", 2);
    return { path: normalizeProjectPath(rawPath), role: rawRole?.trim().toLowerCase() || undefined };
  });
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.path)) throw new Error(`Ruta repetida en la estructura: “${file.path}”`);
    seen.add(file.path);
  }
  return files;
}

function scaffoldContent(file: ProjectFileSpec, slug: string, description: string) {
  const role = file.role ?? "";
  if (file.path.startsWith("scripts/") || role === "script" || file.path.endsWith(".sh")) {
    return `#!/usr/bin/env bash\nset -Eeuo pipefail\n\n# ${file.path} · ${description}\nSCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"\nprintf '[${slug}] ejecutando %s\\n' "${file.path}"\n`;
  }
  if (file.path.startsWith("tests/") || role === "test") {
    if (file.path.endsWith(".sh")) return `#!/usr/bin/env bash\nset -Eeuo pipefail\nROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"\nprintf 'test placeholder: %s\\n' "$ROOT"\n`;
    if (file.path.endsWith(".py")) return `"""Pruebas iniciales para ${slug}."""\n\n\ndef test_placeholder():\n    assert True\n`;
    return `// Pruebas iniciales para ${slug}.\ndescribe("${slug}", () => { it("placeholder", () => expect(true).toBe(true)); });\n`;
  }
  if (file.path.endsWith(".py") || role === "module") return `"""Módulo ${file.path} para ${slug}."""\n\n\ndef main():\n    """Punto de extensión del módulo."""\n    return None\n`;
  if (file.path.endsWith(".ts") || file.path.endsWith(".js")) return `/** Módulo ${file.path} para ${slug}. */\n\nexport function main(): void {\n  // Punto de extensión del módulo.\n}\n`;
  if (file.path.endsWith(".yml") || file.path.endsWith(".yaml")) return `name: ${slug} checks\non:\n  workflow_dispatch:\njobs:\n  validate:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: echo "Validar ${slug}"\n`;
  if (file.path.endsWith(".md")) return `# ${file.path}\n\nArchivo generado para ${slug}.\n\n${description}\n`;
  if (file.path.endsWith(".json")) return `{}\n`;
  return `# ${file.path}\n# Archivo generado para ${slug}.\n`;
}

function projectFiles(value: string, slug: string, description: string) {
  return parseProjectStructure(value).map(file => ({ path: file.path, content: scaffoldContent(file, slug, description), executable: file.path.endsWith(".sh") || file.role === "script" }));
}

export function packageInstallCommand(distro: Distro, packages: string[]) {
  if (packages.length === 0) return "";
  const list = packages.map(shellQuote).join(" ");
  switch (distro) {
    case "debian":
      return `sudo apt-get update && sudo apt-get install -y -- ${list}`;
    case "fedora":
      return `sudo dnf install -y -- ${list}`;
    case "arch":
      return `sudo pacman -Sy --needed --noconfirm -- ${list}`;
    case "alpine":
      return `sudo apk add --no-cache -- ${list}`;
    case "opensuse":
      return `sudo zypper --non-interactive install -- ${list}`;
  }
}

export function buildScript({ name, slug, description, distro, packages, command }: { name: string; slug: string; description: string; distro: Distro; packages: string[]; command: string }) {
  const distroLabel = distros.find(item => item.value === distro)?.label ?? distro;
  const install = packageInstallCommand(distro, packages);
  const safeName = name.replace(/[\r\n\u0000]/g, " ").trim();
  const safeDescription = description.replace(/[\r\n\u0000]/g, " ").trim();
  const installBlock = install ? `\n  [[ "$SKIP_DEPS" == true ]] || { info "Instalando dependencias para ${distroLabel}"; run_shell ${shellQuote(install)}; }\n` : "";
  const sudoCheck = install
    ? `if [[ "$DRY_RUN" == false ]] && ! command -v sudo >/dev/null 2>&1; then\n  printf 'This tool requires sudo for package installation.\\n' >&2\n  exit 1\nfi\n`
    : "";
  const helpLines = [safeName, "", safeDescription, "", "Uso:", `  ${slug} [--dry-run|--apply] [-- argumentos...]`, "", "Opciones:", "  --dry-run        Muestra las órdenes sin ejecutarlas (predeterminado)", "  --apply          Ejecuta las órdenes", "  --skip-deps      Omite la instalación de dependencias", "  -v, --verbose    Muestra más información", "  -V, --version    Muestra la versión", "  -h, --help       Muestra esta ayuda"];
  const helpBlock = helpLines.map(line => `  printf '%s\\n' ${shellQuote(line)}`).join("\n");
  return `#!/usr/bin/env bash
# ${safeName} — ${safeDescription}
# Target: ${distroLabel}
# Generated by CodeCraft Studio
set -Eeuo pipefail
IFS=$'\\n\\t'

readonly TOOL_NAME=${shellQuote(slug)}
readonly TOOL_VERSION='1.0.0'
DRY_RUN=true
SKIP_DEPS=false
VERBOSE=false
EXTRA_ARGS=()

usage() {
${helpBlock}
}

info() {
  printf '\\n[codecraft] %s\\n' "$1"
}

run_shell() {
  if [[ "$DRY_RUN" == true ]]; then
    printf '[dry-run] %s\\n' "$1"
  else
    bash -c "$1" "$TOOL_NAME" "\${EXTRA_ARGS[@]}"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --apply) DRY_RUN=false; shift ;;
    --skip-deps) SKIP_DEPS=true; shift ;;
    -v|--verbose) VERBOSE=true; shift ;;
    -V|--version) printf '%s %s\\n' "$TOOL_NAME" "$TOOL_VERSION"; exit 0 ;;
    -h|--help) usage; exit 0 ;;
    --) shift; EXTRA_ARGS=("$@"); break ;;
    -*) printf 'Unknown option: %s\\n' "$1" >&2; usage >&2; exit 2 ;;
    *) EXTRA_ARGS+=("$1"); shift ;;
  esac
done

${sudoCheck}if [[ "$VERBOSE" == true ]]; then set -x; fi
${installBlock}
info "Ejecutando ${safeName}"
run_shell ${shellQuote(command)}
info "Herramienta completada"
`;
}

function buildReadme({ name, slug, description, distro, packages, command, files }: { name: string; slug: string; description: string; distro: Distro; packages: string[]; command: string; files: GeneratedFile[] }) {
  const distroLabel = distros.find(item => item.value === distro)?.label ?? distro;
  const manager = distros.find(item => item.value === distro)?.manager ?? distro;
  const packageLine = packages.length ? packages.map(item => "`" + item + "`").join(", ") : "ninguna";
  const fileLines = files.map(file => "- `" + file.path + "`").join("\n");
  return [
    `# ${name}`,
    "",
    description,
    "",
    "Herramienta generada con [CodeCraft Studio](https://hubgunter4-ops.github.io/codecraft-studio/).",
    "",
    "## Compatibilidad",
    "",
    `- Distribución objetivo: **${distroLabel}**`,
    `- Gestor de paquetes: **${manager}**`,
    `- Dependencias: ${packageLine}`,
    "",
    "## Uso",
    "",
    "```bash",
    `chmod +x bin/${slug}`,
    `./bin/${slug} --help`,
    `./bin/${slug}              # simulación por defecto`,
    `./bin/${slug} --apply      # ejecución real`,
    `./bin/${slug} --apply -- argumento1 argumento2`,
    "```",
    "",
    "La herramienta empieza en modo simulación. Usa `--apply` para ejecutar y `--skip-deps` para omitir instalaciones. Revisa siempre el script antes de ejecutarlo con privilegios.",
    "",
    "## Comando principal",
    "",
    "`" + command + "`",
    "",
    "## Archivos",
    "",
    fileLines,
    "",
    "## Seguridad",
    "",
    "Este repositorio fue generado como plantilla. Audita los comandos y dependencias antes de usarlo en servidores, máquinas de producción o sistemas que contengan datos importantes.",
    "",
  ].join("\n");
}

export function buildBundle({ name, description, distro, packagesValue, command, mode, structureValue = "" }: { name: string; description: string; distro: Distro; packagesValue: string; command: string; mode: OutputMode; structureValue?: string }): ToolBundle {
  const slug = slugify(name) || "linux-tool";
  const packages = packageTokens(packagesValue);
  const invalidPackage = packages.find(item => !/^[A-Za-z0-9][A-Za-z0-9@._+:-]*$/.test(item));
  if (invalidPackage) throw new Error(`El paquete “${invalidPackage}” contiene caracteres o banderas no permitidos.`);
  const script = buildScript({ name, slug, description, distro, packages, command });
  if (mode === "script") {
    return { name, slug, distro, mode, summary: description, script, files: [{ path: `${slug}.sh`, content: script, executable: true }] };
  }
  const extraFiles = projectFiles(structureValue, slug, description);
  const reserved = new Set([`bin/${slug}`, "README.md", "Makefile", "tests/smoke.sh", ".gitignore", "LICENSE"]);
  const conflict = extraFiles.find(file => reserved.has(file.path));
  if (conflict) throw new Error(`La estructura usa una ruta reservada: “${conflict.path}”`);
  const files: GeneratedFile[] = [
    { path: `bin/${slug}`, content: script, executable: true },
    ...extraFiles,
    { path: "README.md", content: "" },
    { path: "Makefile", content: `run:\n\tbash bin/${slug} --dry-run\n\ninstall:\n\tinstall -Dm755 bin/${slug} $(DESTDIR)/usr/local/bin/${slug}\n\ncheck:\n\tbash tests/smoke.sh\n` },
    { path: "tests/smoke.sh", content: `#!/usr/bin/env bash\nset -Eeuo pipefail\nROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"\nTOOL="$ROOT/bin/${slug}"\nexpect() { local want="$1"; shift; local label="$1"; shift; set +e; "$@" >/dev/null 2>&1; local got=$?; set -e; [[ "$got" == "$want" ]] || { printf 'FAIL: %s (expected %s got %s)\\n' "$label" "$want" "$got" >&2; exit 1; }; printf 'ok: %s\\n' "$label"; }\nexpect 0 help "$TOOL" --help\nexpect 0 version "$TOOL" --version\nexpect 2 unknown-option "$TOOL" --unknown-option\nexpect 0 default-dry-run "$TOOL"\nprintf 'smoke tests passed\\n'\n`, executable: true },
    { path: ".gitignore", content: ".DS_Store\n*.log\n.env\n" },
    { path: "LICENSE", content: `MIT License\n\nCopyright (c) ${new Date().getFullYear()} CodeCraft Studio users\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files, to deal in the Software\nwithout restriction, including without limitation the rights to use, copy, modify,\nmerge, publish, distribute, sublicense, and/or sell copies of the Software.\n` },
  ];
  const readmeIndex = files.findIndex(file => file.path === "README.md");
  files[readmeIndex].content = buildReadme({ name, slug, description, distro, packages, command, files });
  return { name, slug, distro, mode, summary: description, script, files };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadText(filename: string, content: string, mime = "text/plain;charset=utf-8") {
  downloadBlob(new Blob([content], { type: mime }), filename);
}

function writeTarString(target: Uint8Array, offset: number, length: number, value: string) {
  const encoded = new TextEncoder().encode(value).slice(0, length);
  target.set(encoded, offset);
}

function writeTarOctal(target: Uint8Array, offset: number, length: number, value: number) {
  writeTarString(target, offset, length, `${value.toString(8).padStart(length - 1, "0")}\0`);
}

export function createTar(files: GeneratedFile[], rootDir: string) {
  const chunks: Uint8Array[] = [];
  for (const file of files) {
    const data = new TextEncoder().encode(file.content);
    const header = new Uint8Array(512);
    writeTarString(header, 0, 100, `${rootDir}/${file.path}`);
    writeTarOctal(header, 100, 8, file.executable ? 0o755 : 0o644);
    writeTarOctal(header, 108, 8, 0);
    writeTarOctal(header, 116, 8, 0);
    writeTarOctal(header, 124, 12, data.length);
    writeTarOctal(header, 136, 12, Math.floor(Date.now() / 1000));
    header.fill(32, 148, 156);
    header[156] = 48;
    writeTarString(header, 257, 6, "ustar");
    let checksum = 0;
    for (let index = 0; index < header.length; index += 1) checksum += header[index];
    writeTarString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
    chunks.push(header, data);
    const padding = (512 - (data.length % 512)) % 512;
    if (padding) chunks.push(new Uint8Array(padding));
  }
  chunks.push(new Uint8Array(1024));
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const archive = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    archive.set(chunk, offset);
    offset += chunk.length;
  }
  return new Blob([archive.buffer as ArrayBuffer], { type: "application/x-tar" });
}

export default function ToolBuilder() {
  const [name, setName] = useState("sys-check");
  const [description, setDescription] = useState("Comprueba herramientas básicas y muestra información útil del sistema.");
  const [distro, setDistro] = useState<Distro>("debian");
  const [packages, setPackages] = useState("curl jq");
  const [command, setCommand] = useState("uname -a && printf '\\nDisk:\\n' && df -h /");
  const [structure, setStructure] = useState("scripts/healthcheck.sh | script\nsrc/checks.py | module\ntests/test_checks.py | test\nconfig/default.json\n.github/workflows/validate.yml");
  const [commandPreset, setCommandPreset] = useState("system");
  const [generatedContext, setGeneratedContext] = useState("");
  const [mode, setMode] = useState<OutputMode>("repo");
  const [acknowledged, setAcknowledged] = useState(false);
  const [bundle, setBundle] = useState<ToolBundle | null>(null);
  const [activeFile, setActiveFile] = useState(0);
  const [githubToken, setGithubToken] = useState("");
  const [githubSource, setGithubSource] = useState("");
  const [githubBranch, setGithubBranch] = useState("main");
  const [githubRepo, setGithubRepo] = useState<GitRepo | null>(null);
  const [repairRequest, setRepairRequest] = useState("Revisa errores de seguridad, compatibilidad con la distribución elegida y comandos peligrosos. Propón cambios mínimos.");
  const [repairData, setRepairData] = useState<{ summary: string; patches: RepairPatch[] } | null>(null);
  const [selectedPatches, setSelectedPatches] = useState<string[]>([]);
  const [appliedPatchIds, setAppliedPatchIds] = useState<string[]>([]);
  const [appliedPatchPaths, setAppliedPatchPaths] = useState<string[]>([]);
  const [toolTab, setToolTab] = useState<"create" | "repair">(() => (window.location.hash.includes("tab=repair") || window.location.search.includes("tab=repair") ? "repair" : "create"));
  const [githubBusy, setGithubBusy] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);

  useEffect(() => { setGithubToken(sessionStorage.getItem(githubTokenStorage) ?? ""); }, []);

  const selectedFile = bundle?.files[activeFile] ?? bundle?.files[0];
  const packageError = useMemo(() => {
    const invalid = packageTokens(packages).find(item => !/^[A-Za-z0-9][A-Za-z0-9@._+:-]*$/.test(item));
    return invalid ? `El paquete “${invalid}” contiene caracteres no permitidos.` : "";
  }, [packages]);

  const generate = () => {
    if (!name.trim()) return toast.error("Indica un nombre para la herramienta");
    if (!description.trim()) return toast.error("Describe qué hará la herramienta");
    if (!command.trim()) return toast.error("Indica el comando principal");
    if (packageError) return toast.error(packageError);
    if (!acknowledged) return toast.error("Confirma que revisarás el script antes de ejecutarlo");
    const resolved = deriveCommandFromRequest(description, command);
    if (resolved.warning) toast.warning(resolved.warning);
    setCommand(resolved.command);
    const next = buildBundle({ name: name.trim(), description: description.trim(), distro, packagesValue: packages.trim(), command: resolved.command, mode, structureValue: mode === "repo" ? structure : "" });
    setBundle(next);
    setActiveFile(0);
    toast.success(mode === "repo" ? "Repositorio generado" : "Script generado");
  };

  const fillCommand = () => {
    const preset = commandPresets.find(item => item.value === commandPreset) ?? commandPresets[0];
    setCommand(preset.command);
    toast.success(`Comando rellenado: ${preset.label}`);
  };

  const detectCommandFromDescription = () => {
    if (!description.trim()) return toast.error("Describe primero qué hará la herramienta");
    const detected = detectCommandPreset(description);
    setCommandPreset(detected);
    const preset = commandPresets.find(item => item.value === detected) ?? commandPresets[0];
    setCommand(preset.command);
    toast.success(`Petición identificada: ${preset.label}`);
  };

  const generatePromptContext = async () => {
    const request = description.trim();
    if (!request) return toast.error("Describe primero qué hará la herramienta");
    const risky = /\b(rm\s+-rf|mkfs|dd\s+if=|shutdown|reboot|chmod\s+777|curl.+\|\s*(ba)?sh|wget.+\|\s*(ba)?sh)\b/i.test(request);
    const extracted = extractToolSpec(request, command, packages);
    if (extracted.packageDetected) setPackages(extracted.packages);
    if (extracted.commandDetected) { setCommand(extracted.command); setCommandPreset(""); }
    const preset = commandPresets.find(item => item.value === detectCommandPreset(request)) ?? commandPresets[0];
    const improved = improveRequest(request, distro, preset.label);
    const context = [
      "# Contexto ejecutable para CodeCraft Studio",
      "",
      "## Petición original (inmutable)",
      request,
      "",
      "## Petición reestructurada (preserva intención y función)",
      improved,
      "",
      "## Objetivo",
      `Crear una herramienta Linux para: ${request}`,
      "",
      "## Comportamiento esperado",
      `- Generar un script Bash o repositorio completo para ${distro}.`,
      `- Usar como punto de partida el comando de ${preset.label}:`,
      `  ${extracted.command}`,
      `- Paquetes opcionales detectados: ${extracted.packages || "ninguno"}.`,
      `- Integrar esos paquetes y ese comando en la configuración editable antes de generar.`,
      "- Mantener el comando editable y mostrar un modo dry-run antes de ejecutar.",
      "- No ejecutar comandos durante la generación ni modificar la petición original.",
      "",
      "## Restricciones de seguridad",
      "- Auditar dependencias, permisos y rutas antes de ejecutar.",
      "- No incluir secretos ni credenciales.",
      "- Pedir confirmación humana antes de publicar cambios o ejecutar acciones destructivas.",
    ].join("\n");
    setGeneratedContext(context);
    if (risky) toast.warning("Alerta: la petición contiene patrones potencialmente peligrosos. Se añadió un marco seguro; el contexto requiere revisión y no ejecuta nada.");
    else toast.success(extracted.packageDetected || extracted.commandDetected ? "GenPrompt detectó e integró paquetes y comando principal" : "Petición reestructurada y contexto generado sin modificar el original");
  };

  const copyGeneratedContext = async () => {
    if (!generatedContext) return;
    await navigator.clipboard.writeText(generatedContext);
    toast.success("Contexto copiado");
  };

  const download = () => {
    if (!bundle) return;
    if (bundle.mode === "script") {
      downloadText(`${bundle.slug}.sh`, bundle.script);
      toast.success("Script descargado");
    } else {
      downloadBlob(createTar(bundle.files, bundle.slug), `${bundle.slug}.tar`);
      toast.success("Repositorio descargado como TAR");
    }
  };

  const copy = async () => {
    if (!selectedFile) return;
    await navigator.clipboard.writeText(selectedFile.content);
    toast.success("Archivo copiado");
  };

  const connectGitHub = async () => {
    if (!githubToken.trim()) return toast.error("Introduce un token de GitHub con permiso Contents: read/write");
    if (!githubSource.trim()) return toast.error("Indica el repositorio de GitHub que quieres reparar");
    setGithubBusy(true);
    try {
      const loaded = await loadGitHubRepo(githubToken.trim(), githubSource, githubBranch.trim() || "main");
      sessionStorage.setItem(githubTokenStorage, githubToken.trim());
      setGithubRepo(loaded);
      toast.success(`Repositorio cargado: ${loaded.files.length} archivos`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo cargar el repositorio"); } finally { setGithubBusy(false); }
  };

  const repairRepo = async () => {
    if (!githubRepo) return toast.error("Carga primero un repositorio de GitHub");
    const aiConfig = readAiConfig();
    const key = aiConfig.apiKey;
    if (!key) return toast.error("Configura tu API Key de OpenAI en la pantalla principal");
    setGithubBusy(true);
    try { const data = await askRepair(key, aiConfig.baseUrl, aiConfig.model, githubRepo, repairRequest); setRepairData(data); setSelectedPatches(data.patches.map(patch => patch.id)); setAppliedPatchIds([]); setAppliedPatchPaths([]); toast.success(`${data.patches.length} parches propuestos`); } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo analizar el repositorio"); } finally { setGithubBusy(false); }
  };

  const applySelectedPatches = () => {
    if (!githubRepo || !repairData) return;
    const selected = new Map(repairData.patches.filter(patch => selectedPatches.includes(patch.id)).map(patch => [patch.path, patch.content]));
    if (selected.size === 0) return toast.error("Selecciona al menos un parche");
    setGithubRepo({ ...githubRepo, files: githubRepo.files.map(file => selected.has(file.path) ? { ...file, content: selected.get(file.path)! } : file) });
    setAppliedPatchIds(selectedPatches);
    setAppliedPatchPaths(Array.from(selected.keys()));
    toast.success(`${selected.size} parches aplicados en la vista local`);
  };

  const publishRepairedRepo = async () => {
    if (!githubRepo || appliedPatchIds.length === 0) return toast.error("Aplica al menos un parche antes de publicar");
    if (!confirmPublish) return toast.error("Confirma crear un commit de reparación en GitHub");
    setGithubBusy(true);
    try { const changedFiles = githubRepo.files.filter(file => appliedPatchPaths.includes(file.path)); const sha = await publishGitHubRepo(githubToken.trim(), githubRepo, changedFiles, `fix: apply ${appliedPatchIds.length} selected repair patches`); toast.success(`Reparación publicada · commit ${sha.slice(0, 7)}`); } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo publicar la reparación"); } finally { setGithubBusy(false); }
  };

  const publishBundle = async () => {
    if (!githubRepo) return toast.error("Carga primero un repositorio destino");
    if (!bundle) return toast.error("Genera un repositorio antes de publicarlo");
    if (!confirmPublish) return toast.error("Confirma que quieres crear un commit en GitHub");
    setGithubBusy(true);
    try { const sha = await publishGitHubRepo(githubToken.trim(), githubRepo, bundle.files, `feat: add ${bundle.name} Linux tool`); toast.success(`Repositorio publicado · commit ${sha.slice(0, 7)}`); } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo publicar en GitHub"); } finally { setGithubBusy(false); }
  };

  return (
    <div className="min-h-screen bg-[#f7f8fa] text-[#17202a]">
      <header className="sticky top-0 z-10 border-b border-[#e6e9ed] bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-6 py-4 lg:px-10">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-xl bg-[#1e3a5f] text-white shadow-sm"><Code2 size={19} /></div>
            <div><div className="font-extrabold tracking-tight">CodeCraft <span className="text-[#e56b42]">Studio</span></div><div className="font-mono text-[10px] uppercase tracking-[.22em] text-[#8090a0]">Linux tool builder</div></div>
          </div>
          <nav aria-label="Navegación principal" className="flex items-center gap-1">
            <Link href="/review" className="rounded-lg px-3 py-2 text-xs font-bold text-[#718096] hover:bg-[#f6f8fa]"><FileCode2 className="mr-1.5 inline size-3.5" /> Revisar</Link>
            <Link href="/generate" className="rounded-lg px-3 py-2 text-xs font-bold text-[#718096] hover:bg-[#fff8f5]"><WandSparkles className="mr-1.5 inline size-3.5" /> Generar</Link>
            <Link href="/tools" className="rounded-lg bg-[#eef3f7] px-3 py-2 text-xs font-bold text-[#1e3a5f]"><Terminal className="mr-1.5 inline size-3.5" /> Herramientas Linux</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-6 py-8 lg:px-10 lg:py-12">
        <div className="mb-8 max-w-3xl">
          <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-[#e56b42]"><Terminal size={14} /> Linux tool builder</div>
          <h1 className="text-4xl font-extrabold leading-[1.05] tracking-[-.05em] text-[#14283d] md:text-5xl">Crea herramientas <span className="text-[#e56b42]">listas para ejecutar.</span></h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-[#718096]">Genera un script Bash autocontenido o un repositorio completo con README, pruebas smoke y Makefile para tu distribución Linux.</p>
        </div>

        <div className="mb-5 flex max-w-fit gap-1 rounded-xl border border-[#e2e7eb] bg-white p-1 shadow-sm"><button onClick={() => setToolTab("create")} className={`rounded-lg px-4 py-2 text-xs font-bold transition ${toolTab === "create" ? "bg-[#1e3a5f] text-white" : "text-[#718096] hover:bg-[#f4f7f9]"}`}><WandSparkles className="mr-2 inline size-4" /> Crear herramienta</button><button onClick={() => setToolTab("repair")} className={`rounded-lg px-4 py-2 text-xs font-bold transition ${toolTab === "repair" ? "bg-[#e56b42] text-white" : "text-[#718096] hover:bg-[#fff4f0]"}`}><Wrench className="mr-2 inline size-4" /> Reparar repositorio</button></div>
        <div className={`${toolTab === "create" ? "grid" : "hidden"} gap-5 xl:grid-cols-[.86fr_1.14fr]`}>
          <section className="rounded-2xl border border-[#dde3e9] bg-white p-5 shadow-[0_14px_40px_rgba(31,55,78,.06)]">
            <div className="mb-5 flex items-center justify-between"><div><h2 className="text-sm font-bold">Especificación</h2><p className="mt-1 text-xs text-[#91a0ad]">Define qué debe hacer tu herramienta.</p></div><Badge className="border-0 bg-[#eef3f7] text-[10px] text-[#34516b]"><PackageCheck className="mr-1 size-3" /> Plantillas Linux</Badge></div>
            <div className="space-y-4">
              <label className="block"><span className="mb-1.5 block text-xs font-bold text-[#4b6072]">Nombre de la herramienta</span><input value={name} onChange={event => setName(event.target.value)} className="h-10 w-full rounded-lg border border-[#dfe5ea] bg-[#fbfcfd] px-3 text-sm outline-none focus:border-[#e56b42]" placeholder="backup-helper" /></label>
              <label className="block"><div className="mb-1.5 flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-bold text-[#4b6072]">Qué hará</span><div className="flex items-center gap-2"><button type="button" onClick={detectCommandFromDescription} className="inline-flex h-8 items-center rounded-lg border border-[#dfe5ea] bg-[#f2f6f9] px-2.5 text-[11px] font-bold text-[#34516b] transition hover:border-[#c4d0d9] hover:bg-white"><WandSparkles className="mr-1.5 size-3" /> Identificar petición</button><button type="button" onClick={generatePromptContext} className="inline-flex h-8 items-center rounded-lg border border-[#ead9d1] bg-[#fff8f5] px-2.5 text-[11px] font-bold text-[#c8522e] transition hover:bg-[#fff0e9]"><WandSparkles className="mr-1.5 size-3" /> GenPrompt</button></div></div><Textarea value={description} onChange={event => setDescription(event.target.value)} className="min-h-[76px] resize-none border-[#dfe5ea] bg-[#fbfcfd] text-sm" placeholder="Describe la finalidad de la herramienta..." /><span className="mt-1 block text-[11px] text-[#91a0ad]">Identifica palabras clave o convierte la petición en un contexto ejecutable sin modificar este texto.</span>{generatedContext && <div className="mt-3 rounded-xl border border-[#f0dfb4] bg-[#fffaf0] p-3"><div className="mb-2 flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 text-[11px] font-bold text-[#6f6248]"><AlertTriangle className="size-3.5" /> Contexto generado · revisión humana requerida</span><button type="button" onClick={copyGeneratedContext} className="flex items-center gap-1 text-[11px] font-bold text-[#8a6a32] hover:text-[#c8522e]"><Clipboard className="size-3.5" /> Copiar</button></div><textarea readOnly value={generatedContext} aria-label="Contexto ejecutable generado" className="min-h-[190px] w-full resize-y rounded-lg border border-[#ecdcae] bg-white p-3 font-mono text-[11px] leading-5 text-[#6f6248] outline-none" /></div>}</label>
              <div className="grid gap-3 sm:grid-cols-2"><label className="block"><span className="mb-1.5 block text-xs font-bold text-[#4b6072]">Distribución objetivo</span><select value={distro} onChange={event => setDistro(event.target.value as Distro)} className="h-10 w-full rounded-lg border border-[#dfe5ea] bg-[#fbfcfd] px-3 text-sm outline-none focus:border-[#e56b42]">{distros.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select><span className="mt-1 block text-[11px] text-[#91a0ad]">{distros.find(item => item.value === distro)?.hint}</span></label><label className="block"><span className="mb-1.5 block text-xs font-bold text-[#4b6072]">Paquetes opcionales</span><input value={packages} onChange={event => setPackages(event.target.value)} className="h-10 w-full rounded-lg border border-[#dfe5ea] bg-[#fbfcfd] px-3 font-mono text-xs outline-none focus:border-[#e56b42]" placeholder="curl jq ripgrep" /><span className="mt-1 block text-[11px] text-[#91a0ad]">Separados por espacios; sin comandos.</span></label></div>
              <label className="block"><div className="mb-1.5 flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-bold text-[#4b6072]">Comando principal</span><div className="flex items-center gap-2"><select value={commandPreset} onChange={event => setCommandPreset(event.target.value)} aria-label="Preset de comando" className="h-8 rounded-lg border border-[#dfe5ea] bg-white px-2 text-[11px] text-[#536b7d] outline-none focus:border-[#e56b42]"><option value="">Selecciona un preset</option>{commandPresets.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select><button type="button" onClick={fillCommand} disabled={!commandPreset} className="inline-flex h-8 items-center rounded-lg border border-[#ead9d1] bg-[#fff8f5] px-2.5 text-[11px] font-bold text-[#c8522e] transition hover:bg-[#fff0e9] disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw className="mr-1.5 size-3" /> Rellenar</button></div></div><Textarea value={command} onChange={event => setCommand(event.target.value)} className="min-h-[105px] resize-y border-[#dfe5ea] bg-[#172635] font-mono text-xs leading-5 text-[#dbe7ef]" placeholder="echo 'Hello Linux'" /><span className="mt-1 block text-[11px] text-[#91a0ad]">Selecciona un preset para rellenar automáticamente o edita el comando Bash manualmente. Puedes usar varias órdenes con &&.</span></label>
              {mode === "repo" && <label className="block"><div className="mb-1.5 flex items-center justify-between gap-2"><span className="text-xs font-bold text-[#4b6072]">Estructura del repositorio</span><Badge variant="outline" className="text-[10px] text-[#718096]">rutas relativas</Badge></div><Textarea value={structure} onChange={event => setStructure(event.target.value)} className="min-h-[150px] resize-y border-[#dfe5ea] bg-[#fbfcfd] font-mono text-xs leading-5" placeholder={'scripts/backup.sh | script\nsrc/backup.py | module\ntests/test_backup.py | test'} /><span className="mt-1 block text-[11px] leading-5 text-[#91a0ad]">Una ruta por línea. Opcionalmente añade <code>| script</code>, <code>| module</code> o <code>| test</code>. Se crean también carpetas anidadas automáticamente.</span></label>}
              <div><span className="mb-1.5 block text-xs font-bold text-[#4b6072]">Formato de salida</span><div className="grid grid-cols-2 gap-2"><button onClick={() => setMode("script")} className={`rounded-xl border p-3 text-left transition ${mode === "script" ? "border-[#e56b42] bg-[#fff5f0]" : "border-[#dfe5ea] bg-[#fbfcfd] hover:border-[#c4d0d9]"}`}><Terminal className={`mb-2 size-4 ${mode === "script" ? "text-[#e56b42]" : "text-[#718096]"}`} /><span className="block text-xs font-bold">Script completo</span><span className="mt-1 block text-[11px] text-[#91a0ad]">Un .sh ejecutable.</span></button><button onClick={() => setMode("repo")} className={`rounded-xl border p-3 text-left transition ${mode === "repo" ? "border-[#1e3a5f] bg-[#f2f6f9]" : "border-[#dfe5ea] bg-[#fbfcfd] hover:border-[#c4d0d9]"}`}><FolderTree className={`mb-2 size-4 ${mode === "repo" ? "text-[#1e3a5f]" : "text-[#718096]"}`} /><span className="block text-xs font-bold">Repositorio</span><span className="mt-1 block text-[11px] text-[#91a0ad]">README, tests y Makefile.</span></button></div></div>
              <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-[#f0dfb4] bg-[#fffaf0] p-3"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} className="mt-0.5 accent-[#e56b42]" /><span className="text-[11px] leading-5 text-[#6f6248]">Revisaré el contenido antes de ejecutarlo. CodeCraft genera archivos, pero nunca ejecuta comandos en este navegador.</span></label>
              {packageError && <p className="text-xs font-semibold text-[#b44f32]">{packageError}</p>}
              <Button onClick={generate} className="h-11 w-full bg-[#1e3a5f] text-xs font-bold text-white hover:bg-[#16304f]"><WandSparkles className="mr-2 size-4" /> Generar {mode === "repo" ? "repositorio" : "script"}</Button>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-[#dde3e9] bg-white shadow-[0_14px_40px_rgba(31,55,78,.06)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0f3] px-5 py-4"><div><h2 className="text-sm font-bold">Previsualización</h2><p className="mt-1 text-xs text-[#91a0ad]">Revisa el resultado antes de descargarlo.</p></div>{bundle && <div className="flex gap-2"><Button variant="outline" onClick={copy} className="h-9 border-[#dfe5ea] px-3 text-xs font-bold text-[#34516b]"><Clipboard className="mr-2 size-3.5" /> Copiar</Button><Button onClick={download} className="h-9 bg-[#e56b42] px-3 text-xs font-bold text-white hover:bg-[#d95d35]"><Download className="mr-2 size-3.5" /> Descargar</Button></div>}</div>
              {!bundle ? <div className="grid min-h-[590px] place-items-center p-8 text-center"><div className="max-w-sm"><div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-[#f2f6f9] text-[#1e3a5f]"><Terminal size={25} /></div><h3 className="text-sm font-bold text-[#324b61]">Tu herramienta aparecerá aquí</h3><p className="mt-2 text-xs leading-5 text-[#91a0ad]">Genera un script o repositorio con modo `--dry-run`, documentación y una estructura que puedas adaptar.</p><div className="mt-5 flex items-center justify-center gap-2 text-[11px] text-[#4c9f70]"><ShieldCheck size={14} /> No se ejecuta nada automáticamente</div></div></div> : <div className="grid min-h-[590px] lg:grid-cols-[190px_1fr]"><aside className="border-b border-[#edf0f3] bg-[#fbfcfd] p-3 lg:border-b-0 lg:border-r">{bundle.files.map((file, index) => <button key={file.path} onClick={() => setActiveFile(index)} className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-mono text-[11px] ${index === activeFile ? "bg-[#eaf0f5] font-bold text-[#1e3a5f]" : "text-[#718096] hover:bg-[#f2f6f9]"}`}><FileCode2 className="size-3.5 shrink-0" /> <span className="truncate">{file.path}</span></button>)}</aside><div className="min-w-0"><div className="flex items-center justify-between border-b border-[#edf0f3] px-4 py-3"><div className="flex items-center gap-2 text-xs font-bold text-[#4b6072]"><CheckCircle2 className="size-4 text-[#4c9f70]" /> {bundle.name}</div><span className="font-mono text-[10px] text-[#91a0ad]">{bundle.mode === "repo" ? `${bundle.files.length} archivos` : "bash"}</span></div><pre className="max-h-[535px] min-h-[520px] overflow-auto bg-[#172635] p-5 font-mono text-[11px] leading-5 text-[#dbe7ef]"><code>{selectedFile?.content}</code></pre></div></div>}
          </section>
        </div>

        <section className={`${toolTab === "repair" ? "block" : "hidden"} mt-6 rounded-2xl border border-[#dfe5ea] bg-white p-5 shadow-[0_14px_40px_rgba(31,55,78,.06)]`}><div className="mb-5 flex items-center justify-between gap-3"><div><div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-[.14em] text-[#1e3a5f]"><Github size={15} /> Conector GitHub</div><h2 className="text-lg font-extrabold text-[#14283d]">Repara o publica el repositorio completo</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-[#718096]">Carga un repositorio desde GitHub para diagnosticarlo con IA o publica la herramienta generada como un commit completo.</p></div><Badge className="border-0 bg-[#eef3f7] text-[10px] text-[#34516b]"><ShieldCheck className="mr-1 size-3" /> Token solo en sesión</Badge></div><div className="grid gap-3 lg:grid-cols-[1.1fr_1fr_130px_auto]"><input type="password" value={githubToken} onChange={event => setGithubToken(event.target.value)} placeholder="ghp_... / fine-grained token" autoComplete="off" className="h-10 rounded-lg border border-[#dfe5ea] bg-[#fbfcfd] px-3 text-xs outline-none focus:border-[#1e3a5f]"/><input value={githubSource} onChange={event => setGithubSource(event.target.value)} placeholder="https://github.com/usuario/repo" className="h-10 rounded-lg border border-[#dfe5ea] bg-[#fbfcfd] px-3 text-xs outline-none focus:border-[#1e3a5f]"/><input value={githubBranch} onChange={event => setGithubBranch(event.target.value)} placeholder="main" className="h-10 rounded-lg border border-[#dfe5ea] bg-[#fbfcfd] px-3 font-mono text-xs outline-none focus:border-[#1e3a5f]"/><Button onClick={connectGitHub} disabled={githubBusy} className="h-10 bg-[#1e3a5f] text-xs font-bold text-white hover:bg-[#16304f]">{githubBusy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />} Cargar repo</Button></div><p className="mt-2 text-[11px] text-[#91a0ad]">Crea un token fine-grained con acceso únicamente al repositorio objetivo y permisos <code>Contents: Read and write</code>. No se guarda en GitHub ni en CodeCraft.</p>{githubRepo && <div className="mt-5 grid gap-4 lg:grid-cols-[.8fr_1.2fr]"><div className="rounded-xl border border-[#e3e8ed] bg-[#fbfcfd] p-4"><div className="flex items-center gap-2 text-xs font-bold text-[#324b61]"><CheckCircle2 className="size-4 text-[#4c9f70]" /> {githubRepo.owner}/{githubRepo.repo}</div><p className="mt-1 text-[11px] text-[#91a0ad]">Rama {githubRepo.branch} · {githubRepo.files.length} archivos cargados</p><label className="mt-4 block"><span className="mb-1.5 block text-xs font-bold text-[#4b6072]">Qué quieres reparar</span><Textarea value={repairRequest} onChange={event => setRepairRequest(event.target.value)} className="min-h-[92px] resize-none border-[#dfe5ea] bg-white text-xs" /></label><Button onClick={repairRepo} disabled={githubBusy} variant="outline" className="mt-3 h-10 w-full border-[#1e3a5f] text-xs font-bold text-[#1e3a5f]">{githubBusy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Wrench className="mr-2 size-4" />} Analizar para reparar</Button>{bundle && <><label className="mt-4 flex items-start gap-2 rounded-lg border border-[#f0dfb4] bg-[#fffaf0] p-3"><input type="checkbox" checked={confirmPublish} onChange={event => setConfirmPublish(event.target.checked)} className="mt-0.5 accent-[#e56b42]" /><span className="text-[11px] leading-5 text-[#6f6248]">Confirmo crear un commit y subir los archivos generados a este repositorio.</span></label><Button onClick={publishBundle} disabled={githubBusy} className="mt-3 h-10 w-full bg-[#e56b42] text-xs font-bold text-white hover:bg-[#d95d35]"><UploadCloud className="mr-2 size-4" /> Subir herramienta generada</Button></>}</div><div className="min-h-[230px] overflow-auto rounded-xl bg-[#172635] p-4">{repairData ? <div className="space-y-3"><div className="rounded-lg border border-[#dbe7ef] bg-[#20384b] p-3"><p className="text-xs font-bold text-white">{repairData.summary}</p><p className="mt-1 text-[11px] text-[#a9bac6]">Selecciona los parches que quieras aplicar en la copia cargada.</p></div>{repairData.patches.length === 0 ? <p className="text-xs text-[#f1c06b]">No se propusieron parches automáticos.</p> : repairData.patches.map(patch => <label key={patch.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-[#38566a] bg-[#20384b] p-3"><input type="checkbox" checked={selectedPatches.includes(patch.id)} onChange={event => setSelectedPatches(current => event.target.checked ? [...current, patch.id] : current.filter(id => id !== patch.id))} className="mt-0.5 accent-[#e56b42]" /><span className="min-w-0"><span className="block font-mono text-[11px] font-bold text-[#f2c4b4]">{patch.path}</span><span className="mt-1 block text-[11px] leading-5 text-[#dbe7ef]">{patch.summary}</span></span></label>)}{repairData.patches.length > 0 && <Button onClick={applySelectedPatches} className="h-9 w-full bg-[#4c9f70] text-xs font-bold text-white hover:bg-[#3d855c]"><Wrench className="mr-2 size-4" /> Aplicar parches seleccionados</Button>}{appliedPatchIds.length > 0 && <Button onClick={publishRepairedRepo} disabled={githubBusy} className="h-9 w-full bg-[#1e3a5f] text-xs font-bold text-white hover:bg-[#16304f]"><UploadCloud className="mr-2 size-4" /> Publicar reparación aplicada</Button>}</div> : <div className="flex h-full min-h-[190px] flex-col items-center justify-center text-center text-[#91a0ad]"><Wrench size={22} className="mb-3 text-[#e56b42]" /><p className="text-xs font-bold text-[#dbe7ef]">Diagnóstico de reparación</p><p className="mt-1 max-w-sm text-[11px] leading-5">La IA revisará los archivos cargados sin ejecutar comandos. Después podrás aplicar cambios manualmente o subir una herramienta nueva.</p></div>}</div></div>}</section>
        <div className="mt-5 grid gap-3 md:grid-cols-3"><div className="rounded-xl border border-[#e5e9ed] bg-white p-4"><PackageCheck className="mb-2 size-4 text-[#e56b42]" /><p className="text-xs font-bold">Gestor de paquetes</p><p className="mt-1 text-[11px] leading-5 text-[#91a0ad]">La plantilla adapta la instalación a apt, dnf, pacman, apk o zypper.</p></div><div className="rounded-xl border border-[#e5e9ed] bg-white p-4"><ShieldCheck className="mb-2 size-4 text-[#4c9f70]" /><p className="text-xs font-bold">Modo dry-run</p><p className="mt-1 text-[11px] leading-5 text-[#91a0ad]">Prueba la secuencia y revisa comandos antes de tocar el sistema.</p></div><div className="rounded-xl border border-[#e5e9ed] bg-white p-4"><Archive className="mb-2 size-4 text-[#1e3a5f]" /><p className="text-xs font-bold">Repo portable</p><p className="mt-1 text-[11px] leading-5 text-[#91a0ad]">Descarga un TAR con documentación, smoke test y Makefile.</p></div></div>
        <p className="mt-5 flex items-center gap-2 text-[11px] text-[#91a0ad]"><Info size={13} /> La herramienta solo genera archivos en tu navegador. Audita siempre scripts y dependencias antes de ejecutarlos con privilegios.</p>
      </main>
    </div>
  );
}
