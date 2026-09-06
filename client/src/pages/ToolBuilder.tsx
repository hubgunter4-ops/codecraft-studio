import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Archive,
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
const githubTokenStorage = "codecraft.github.token";
const openaiKeyStorage = "codecraft.openai.apiKey";
const openaiBaseStorage = "codecraft.openai.baseUrl";

function parseGitHubRepo(value: string) {
  const match = value.trim().replace(/\.git$/, "").match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\/|$)/i) ?? value.trim().match(/^([^/]+)\/([^/]+)$/);
  if (!match) throw new Error("Usa una URL como https://github.com/usuario/repositorio");
  return { owner: match[1], repo: match[2] };
}

async function githubRequest<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, { ...init, headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", ...(init?.headers ?? {}) } });
  if (!response.ok) throw new Error(`GitHub respondió ${response.status}: ${response.status === 401 ? "token inválido" : response.statusText}`);
  return response.json() as Promise<T>;
}

async function loadGitHubRepo(token: string, source: string, branch: string): Promise<GitRepo> {
  const { owner, repo } = parseGitHubRepo(source);
  const tree = await githubRequest<{ tree?: Array<{ path: string; type: string; sha: string }> }>(token, `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  const entries = (tree.tree ?? []).filter(item => item.type === "blob" && !item.path.startsWith(".git/") && !item.path.includes("node_modules/")).slice(0, 80);
  if (entries.length === 0) throw new Error("No se encontraron archivos reparables en ese repositorio");
  const files = await Promise.all(entries.map(async entry => {
    const data = await githubRequest<{ content?: string; encoding?: string }>(token, `/repos/${owner}/${repo}/contents/${entry.path}?ref=${encodeURIComponent(branch)}`);
    const content = data.encoding === "base64" ? atob((data.content ?? "").replace(/\n/g, "")) : data.content ?? "";
    return { path: entry.path, content: content.slice(0, 40_000), sha: entry.sha };
  }));
  return { owner, repo, branch, files };
}

async function askRepair(key: string, baseUrl: string, repo: GitRepo, request: string) {
  const snapshot = repo.files.map(file => `--- ${file.path} ---\n${file.content}`).join("\n").slice(0, 100_000);
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-4o-mini", temperature: 0.15, max_tokens: 2500, messages: [{ role: "system", content: "Eres un ingeniero Linux experto. Analiza un repositorio sin ejecutar sus archivos. Responde en español con ## Riesgos, ## Archivos afectados, ## Cambios propuestos y ## Validación segura. No inventes resultados de ejecución ni incluyas secretos." }, { role: "user", content: `Solicitud de reparación: ${request}\n\nRepositorio ${repo.owner}/${repo.repo}:\n${snapshot}` }] }) });
  if (!response.ok) throw new Error(`OpenAI respondió ${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return payload.choices?.[0]?.message?.content?.trim() ?? "OpenAI devolvió una respuesta vacía";
}

async function publishGitHubRepo(token: string, repo: GitRepo, files: GeneratedFile[], message: string) {
  const ref = await githubRequest<{ object: { sha: string } }>(token, `/repos/${repo.owner}/${repo.repo}/git/ref/heads/${encodeURIComponent(repo.branch)}`);
  const parent = await githubRequest<{ tree: { sha: string } }>(token, `/repos/${repo.owner}/${repo.repo}/git/commits/${ref.object.sha}`);
  const blobs = await Promise.all(files.map(async file => {
    const blob = await githubRequest<{ sha: string }>(token, `/repos/${repo.owner}/${repo.repo}/git/blobs`, { method: "POST", body: JSON.stringify({ content: btoa(unescape(encodeURIComponent(file.content))), encoding: "base64" }) });
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

function packageInstallCommand(distro: Distro, packages: string[]) {
  if (packages.length === 0) return "";
  const list = packages.join(" ");
  switch (distro) {
    case "debian":
      return `sudo apt-get update && sudo apt-get install -y ${list}`;
    case "fedora":
      return `sudo dnf install -y ${list}`;
    case "arch":
      return `sudo pacman -Sy --needed --noconfirm ${list}`;
    case "alpine":
      return `sudo apk add --no-cache ${list}`;
    case "opensuse":
      return `sudo zypper --non-interactive install ${list}`;
  }
}

function buildScript({ name, slug, description, distro, packages, command }: { name: string; slug: string; description: string; distro: Distro; packages: string[]; command: string }) {
  const distroLabel = distros.find(item => item.value === distro)?.label ?? distro;
  const install = packageInstallCommand(distro, packages);
  const installBlock = install
    ? `\ninfo "Instalando dependencias para ${distroLabel}"\nrun_shell ${shellQuote(install)}\n`
    : "";
  const sudoCheck = install
    ? `if [[ "$DRY_RUN" == false ]] && ! command -v sudo >/dev/null 2>&1; then\n  printf 'This tool requires sudo for package installation.\\n' >&2\n  exit 1\nfi\n`
    : "";
  return `#!/usr/bin/env bash
# ${name} — ${description}
# Target: ${distroLabel}
# Generated by CodeCraft Studio
set -Eeuo pipefail
IFS=$'\\n\\t'

readonly TOOL_NAME=${shellQuote(slug)}
DRY_RUN=false

usage() {
  cat <<'HELP'
${name}

${description}

Usage:
  ${slug} [--dry-run] [--help]

Options:
  --dry-run  Print commands without executing them
  --help     Show this help message
HELP
}

info() {
  printf '\\n[codecraft] %s\\n' "$1"
}

run_shell() {
  if [[ "$DRY_RUN" == true ]]; then
    printf '[dry-run] %s\\n' "$1"
  else
    bash -lc "$1"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

${sudoCheck}${installBlock}
info "Ejecutando ${name}"
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
    `./bin/${slug} --dry-run`,
    `./bin/${slug}`,
    "```",
    "",
    "`--dry-run` muestra las órdenes sin ejecutarlas. Revisa siempre el script antes de ejecutarlo con privilegios.",
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

function buildBundle({ name, description, distro, packagesValue, command, mode }: { name: string; description: string; distro: Distro; packagesValue: string; command: string; mode: OutputMode }): ToolBundle {
  const slug = slugify(name) || "linux-tool";
  const packages = packageTokens(packagesValue);
  const script = buildScript({ name, slug, description, distro, packages, command });
  if (mode === "script") {
    return { name, slug, distro, mode, summary: description, script, files: [{ path: `${slug}.sh`, content: script, executable: true }] };
  }
  const files: GeneratedFile[] = [
    { path: `bin/${slug}`, content: script, executable: true },
    { path: "README.md", content: "" },
    { path: "Makefile", content: `run:\n\tbash bin/${slug} --dry-run\n\ninstall:\n\tinstall -Dm755 bin/${slug} $(DESTDIR)/usr/local/bin/${slug}\n\ncheck:\n\tbash tests/smoke.sh\n` },
    { path: "tests/smoke.sh", content: `#!/usr/bin/env bash\nset -Eeuo pipefail\nROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"\n"$ROOT/bin/${slug}" --help >/dev/null\n"$ROOT/bin/${slug}" --dry-run >/dev/null\nprintf 'smoke tests passed\\n'\n`, executable: true },
    { path: ".gitignore", content: ".DS_Store\n*.log\n.env\n" },
    { path: "LICENSE", content: `MIT License\n\nCopyright (c) ${new Date().getFullYear()} CodeCraft Studio users\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files, to deal in the Software\nwithout restriction, including without limitation the rights to use, copy, modify,\nmerge, publish, distribute, sublicense, and/or sell copies of the Software.\n` },
  ];
  files[1].content = buildReadme({ name, slug, description, distro, packages, command, files });
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

function createTar(files: GeneratedFile[]) {
  const chunks: Uint8Array[] = [];
  for (const file of files) {
    const data = new TextEncoder().encode(file.content);
    const header = new Uint8Array(512);
    writeTarString(header, 0, 100, file.path);
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
  const [mode, setMode] = useState<OutputMode>("repo");
  const [acknowledged, setAcknowledged] = useState(false);
  const [bundle, setBundle] = useState<ToolBundle | null>(null);
  const [activeFile, setActiveFile] = useState(0);
  const [githubToken, setGithubToken] = useState("");
  const [githubSource, setGithubSource] = useState("");
  const [githubBranch, setGithubBranch] = useState("main");
  const [githubRepo, setGithubRepo] = useState<GitRepo | null>(null);
  const [repairRequest, setRepairRequest] = useState("Revisa errores de seguridad, compatibilidad con la distribución elegida y comandos peligrosos. Propón cambios mínimos.");
  const [repairReport, setRepairReport] = useState("");
  const [githubBusy, setGithubBusy] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);

  useEffect(() => { setGithubToken(sessionStorage.getItem(githubTokenStorage) ?? ""); }, []);

  const selectedFile = bundle?.files[activeFile] ?? bundle?.files[0];
  const packageError = useMemo(() => {
    const invalid = packageTokens(packages).find(item => !/^[A-Za-z0-9@._+:-]+$/.test(item));
    return invalid ? `El paquete “${invalid}” contiene caracteres no permitidos.` : "";
  }, [packages]);

  const generate = () => {
    if (!name.trim()) return toast.error("Indica un nombre para la herramienta");
    if (!description.trim()) return toast.error("Describe qué hará la herramienta");
    if (!command.trim()) return toast.error("Indica el comando principal");
    if (packageError) return toast.error(packageError);
    if (!acknowledged) return toast.error("Confirma que revisarás el script antes de ejecutarlo");
    const next = buildBundle({ name: name.trim(), description: description.trim(), distro, packagesValue: packages.trim(), command: command.trim(), mode });
    setBundle(next);
    setActiveFile(0);
    toast.success(mode === "repo" ? "Repositorio generado" : "Script generado");
  };

  const download = () => {
    if (!bundle) return;
    if (bundle.mode === "script") {
      downloadText(`${bundle.slug}.sh`, bundle.script);
      toast.success("Script descargado");
    } else {
      downloadBlob(createTar(bundle.files), `${bundle.slug}.tar`);
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
    const key = sessionStorage.getItem(openaiKeyStorage) ?? "";
    if (!key) return toast.error("Configura tu API Key de OpenAI en la pantalla principal");
    setGithubBusy(true);
    try { setRepairReport(await askRepair(key, sessionStorage.getItem(openaiBaseStorage) ?? "https://api.openai.com/v1", githubRepo, repairRequest)); toast.success("Diagnóstico de reparación listo"); } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo analizar el repositorio"); } finally { setGithubBusy(false); }
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

        <div className="grid gap-5 xl:grid-cols-[.86fr_1.14fr]">
          <section className="rounded-2xl border border-[#dde3e9] bg-white p-5 shadow-[0_14px_40px_rgba(31,55,78,.06)]">
            <div className="mb-5 flex items-center justify-between"><div><h2 className="text-sm font-bold">Especificación</h2><p className="mt-1 text-xs text-[#91a0ad]">Define qué debe hacer tu herramienta.</p></div><Badge className="border-0 bg-[#eef3f7] text-[10px] text-[#34516b]"><PackageCheck className="mr-1 size-3" /> Plantillas Linux</Badge></div>
            <div className="space-y-4">
              <label className="block"><span className="mb-1.5 block text-xs font-bold text-[#4b6072]">Nombre de la herramienta</span><input value={name} onChange={event => setName(event.target.value)} className="h-10 w-full rounded-lg border border-[#dfe5ea] bg-[#fbfcfd] px-3 text-sm outline-none focus:border-[#e56b42]" placeholder="backup-helper" /></label>
              <label className="block"><span className="mb-1.5 block text-xs font-bold text-[#4b6072]">Qué hará</span><Textarea value={description} onChange={event => setDescription(event.target.value)} className="min-h-[76px] resize-none border-[#dfe5ea] bg-[#fbfcfd] text-sm" placeholder="Describe la finalidad de la herramienta..." /></label>
              <div className="grid gap-3 sm:grid-cols-2"><label className="block"><span className="mb-1.5 block text-xs font-bold text-[#4b6072]">Distribución objetivo</span><select value={distro} onChange={event => setDistro(event.target.value as Distro)} className="h-10 w-full rounded-lg border border-[#dfe5ea] bg-[#fbfcfd] px-3 text-sm outline-none focus:border-[#e56b42]">{distros.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select><span className="mt-1 block text-[11px] text-[#91a0ad]">{distros.find(item => item.value === distro)?.hint}</span></label><label className="block"><span className="mb-1.5 block text-xs font-bold text-[#4b6072]">Paquetes opcionales</span><input value={packages} onChange={event => setPackages(event.target.value)} className="h-10 w-full rounded-lg border border-[#dfe5ea] bg-[#fbfcfd] px-3 font-mono text-xs outline-none focus:border-[#e56b42]" placeholder="curl jq ripgrep" /><span className="mt-1 block text-[11px] text-[#91a0ad]">Separados por espacios; sin comandos.</span></label></div>
              <label className="block"><span className="mb-1.5 block text-xs font-bold text-[#4b6072]">Comando principal</span><Textarea value={command} onChange={event => setCommand(event.target.value)} className="min-h-[105px] resize-y border-[#dfe5ea] bg-[#172635] font-mono text-xs leading-5 text-[#dbe7ef]" placeholder="echo 'Hello Linux'" /><span className="mt-1 block text-[11px] text-[#91a0ad]">Se incluirá como comando Bash. Puedes usar varias órdenes con &&.</span></label>
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

        <section className="mt-6 rounded-2xl border border-[#dfe5ea] bg-white p-5 shadow-[0_14px_40px_rgba(31,55,78,.06)]"><div className="mb-5 flex items-center justify-between gap-3"><div><div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-[.14em] text-[#1e3a5f]"><Github size={15} /> Conector GitHub</div><h2 className="text-lg font-extrabold text-[#14283d]">Repara o publica el repositorio completo</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-[#718096]">Carga un repositorio desde GitHub para diagnosticarlo con IA o publica la herramienta generada como un commit completo.</p></div><Badge className="border-0 bg-[#eef3f7] text-[10px] text-[#34516b]"><ShieldCheck className="mr-1 size-3" /> Token solo en sesión</Badge></div><div className="grid gap-3 lg:grid-cols-[1.1fr_1fr_130px_auto]"><input type="password" value={githubToken} onChange={event => setGithubToken(event.target.value)} placeholder="ghp_... / fine-grained token" autoComplete="off" className="h-10 rounded-lg border border-[#dfe5ea] bg-[#fbfcfd] px-3 text-xs outline-none focus:border-[#1e3a5f]"/><input value={githubSource} onChange={event => setGithubSource(event.target.value)} placeholder="https://github.com/usuario/repo" className="h-10 rounded-lg border border-[#dfe5ea] bg-[#fbfcfd] px-3 text-xs outline-none focus:border-[#1e3a5f]"/><input value={githubBranch} onChange={event => setGithubBranch(event.target.value)} placeholder="main" className="h-10 rounded-lg border border-[#dfe5ea] bg-[#fbfcfd] px-3 font-mono text-xs outline-none focus:border-[#1e3a5f]"/><Button onClick={connectGitHub} disabled={githubBusy} className="h-10 bg-[#1e3a5f] text-xs font-bold text-white hover:bg-[#16304f]">{githubBusy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />} Cargar repo</Button></div><p className="mt-2 text-[11px] text-[#91a0ad]">Crea un token fine-grained con acceso únicamente al repositorio objetivo y permisos <code>Contents: Read and write</code>. No se guarda en GitHub ni en CodeCraft.</p>{githubRepo && <div className="mt-5 grid gap-4 lg:grid-cols-[.8fr_1.2fr]"><div className="rounded-xl border border-[#e3e8ed] bg-[#fbfcfd] p-4"><div className="flex items-center gap-2 text-xs font-bold text-[#324b61]"><CheckCircle2 className="size-4 text-[#4c9f70]" /> {githubRepo.owner}/{githubRepo.repo}</div><p className="mt-1 text-[11px] text-[#91a0ad]">Rama {githubRepo.branch} · {githubRepo.files.length} archivos cargados</p><label className="mt-4 block"><span className="mb-1.5 block text-xs font-bold text-[#4b6072]">Qué quieres reparar</span><Textarea value={repairRequest} onChange={event => setRepairRequest(event.target.value)} className="min-h-[92px] resize-none border-[#dfe5ea] bg-white text-xs" /></label><Button onClick={repairRepo} disabled={githubBusy} variant="outline" className="mt-3 h-10 w-full border-[#1e3a5f] text-xs font-bold text-[#1e3a5f]">{githubBusy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Wrench className="mr-2 size-4" />} Analizar para reparar</Button>{bundle && <><label className="mt-4 flex items-start gap-2 rounded-lg border border-[#f0dfb4] bg-[#fffaf0] p-3"><input type="checkbox" checked={confirmPublish} onChange={event => setConfirmPublish(event.target.checked)} className="mt-0.5 accent-[#e56b42]" /><span className="text-[11px] leading-5 text-[#6f6248]">Confirmo crear un commit y subir los archivos generados a este repositorio.</span></label><Button onClick={publishBundle} disabled={githubBusy} className="mt-3 h-10 w-full bg-[#e56b42] text-xs font-bold text-white hover:bg-[#d95d35]"><UploadCloud className="mr-2 size-4" /> Subir herramienta generada</Button></>}</div><div className="min-h-[230px] overflow-auto rounded-xl bg-[#172635] p-4">{repairReport ? <pre className="whitespace-pre-wrap font-mono text-[11px] leading-5 text-[#dbe7ef]">{repairReport}</pre> : <div className="flex h-full min-h-[190px] flex-col items-center justify-center text-center text-[#91a0ad]"><Wrench size={22} className="mb-3 text-[#e56b42]" /><p className="text-xs font-bold text-[#dbe7ef]">Diagnóstico de reparación</p><p className="mt-1 max-w-sm text-[11px] leading-5">La IA revisará los archivos cargados sin ejecutar comandos. Después podrás aplicar cambios manualmente o subir una herramienta nueva.</p></div>}</div></div>}</section>
        <div className="mt-5 grid gap-3 md:grid-cols-3"><div className="rounded-xl border border-[#e5e9ed] bg-white p-4"><PackageCheck className="mb-2 size-4 text-[#e56b42]" /><p className="text-xs font-bold">Gestor de paquetes</p><p className="mt-1 text-[11px] leading-5 text-[#91a0ad]">La plantilla adapta la instalación a apt, dnf, pacman, apk o zypper.</p></div><div className="rounded-xl border border-[#e5e9ed] bg-white p-4"><ShieldCheck className="mb-2 size-4 text-[#4c9f70]" /><p className="text-xs font-bold">Modo dry-run</p><p className="mt-1 text-[11px] leading-5 text-[#91a0ad]">Prueba la secuencia y revisa comandos antes de tocar el sistema.</p></div><div className="rounded-xl border border-[#e5e9ed] bg-white p-4"><Archive className="mb-2 size-4 text-[#1e3a5f]" /><p className="text-xs font-bold">Repo portable</p><p className="mt-1 text-[11px] leading-5 text-[#91a0ad]">Descarga un TAR con documentación, smoke test y Makefile.</p></div></div>
        <p className="mt-5 flex items-center gap-2 text-[11px] text-[#91a0ad]"><Info size={13} /> La herramienta solo genera archivos en tu navegador. Audita siempre scripts y dependencias antes de ejecutarlos con privilegios.</p>
      </main>
    </div>
  );
}
