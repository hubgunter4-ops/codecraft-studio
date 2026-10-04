import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBundle, createTar, extractToolSpec, packageInstallCommand, parseProjectStructure } from "./ToolBuilder";

function writeExecutable(path: string, content: string) {
  writeFileSync(path, content, { mode: 0o755 });
}

describe("generador de herramientas Linux", () => {
  it("genera un script válido aunque la petición tenga saltos de línea y HELP", () => {
    const bundle = buildBundle({
      name: "auditor",
      description: "Revisa el sistema\nHELP\necho NO_DEBE_EJECUTARSE",
      distro: "debian",
      packagesValue: "",
      command: "printf '%s\\n' listo",
      mode: "script",
    });
    const dir = mkdtempSync(join(tmpdir(), "codecraft-tool-"));
    const script = join(dir, "auditor.sh");
    writeExecutable(script, bundle.script);
    expect(() => execFileSync("bash", ["-n", script])).not.toThrow();
    expect(execFileSync("bash", [script, "--help"], { encoding: "utf8" })).toContain("HELP");
    expect(execFileSync("bash", [script], { encoding: "utf8" })).toContain("[dry-run]");
  });

  it("simula por defecto, ejecuta con --apply y reenvía argumentos después de --", () => {
    const bundle = buildBundle({
      name: "arg-tool",
      description: "Muestra el primer argumento",
      distro: "debian",
      packagesValue: "",
      command: "printf 'arg=%s\\n' \"$1\"",
      mode: "script",
    });
    const dir = mkdtempSync(join(tmpdir(), "codecraft-tool-"));
    const script = join(dir, "arg-tool.sh");
    writeExecutable(script, bundle.script);
    expect(execFileSync("bash", [script, "--", "hola"], { encoding: "utf8" })).toContain("[dry-run]");
    expect(execFileSync("bash", [script, "--apply", "--", "hola"], { encoding: "utf8" })).toContain("arg=hola");
  });

  it("rechaza banderas como paquetes y genera instalación con --", () => {
    expect(packageInstallCommand("debian", ["curl", "jq"])).toContain("install -y -- 'curl' 'jq'");
    expect(() => buildBundle({ name: "bad", description: "test", distro: "debian", packagesValue: "--force", command: "true", mode: "script" })).toThrow();
  });

  it("valida la estructura y genera scripts, módulos, pruebas y carpetas anidadas", () => {
    const structure = "scripts/backup.sh | script\nsrc/lib/metrics.py | module\ntests/unit/test_metrics.py | test\nconfig/default.json\n.github/workflows/validate.yml";
    expect(parseProjectStructure(structure)).toHaveLength(5);
    expect(() => parseProjectStructure("../escape.py")).toThrow();
    expect(() => parseProjectStructure("src/a.py\nsrc/a.py")).toThrow();
    const bundle = buildBundle({ name: "metrics", description: "Analiza métricas", distro: "debian", packagesValue: "", command: "printf ok", mode: "repo", structureValue: structure });
    const paths = bundle.files.map(file => file.path);
    expect(paths).toEqual(expect.arrayContaining(["scripts/backup.sh", "src/lib/metrics.py", "tests/unit/test_metrics.py", "config/default.json", ".github/workflows/validate.yml"]));
    const backup = bundle.files.find(file => file.path === "scripts/backup.sh");
    expect(backup?.executable).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), "codecraft-structure-"));
    const backupPath = join(dir, "backup.sh");
    writeExecutable(backupPath, backup?.content ?? "");
    expect(() => execFileSync("bash", ["-n", backupPath])).not.toThrow();
    expect(bundle.files.find(file => file.path === "src/lib/metrics.py")?.content).toContain("def main");
    expect(bundle.files.find(file => file.path === "tests/unit/test_metrics.py")?.content).toContain("test_placeholder");
  });

  it("GenPrompt integra paquetes opcionales y comando principal en la configuración", () => {
    const request = "Crea una herramienta de diagnóstico.\nPaquetes opcionales: curl, jq, ripgrep\nComando principal: df -h / | sort -h";
    expect(extractToolSpec(request, "uname -a", "git")).toEqual({ packages: "curl jq ripgrep", command: "df -h / | sort -h", packageDetected: true, commandDetected: true });
    expect(extractToolSpec("Usa git y python3 para revisar logs", "journalctl -n 10", "")).toMatchObject({ packages: "git python3", command: "journalctl -n 10", packageDetected: true, commandDetected: false });
  });

  it("contiene el repositorio generado dentro de una carpeta raíz en el TAR", async () => {
    const bundle = buildBundle({ name: "tar-tool", description: "Empaquetable", distro: "debian", packagesValue: "", command: "true", mode: "repo" });
    const archive = createTar(bundle.files, bundle.slug);
    const dir = mkdtempSync(join(tmpdir(), "codecraft-tar-"));
    const tarPath = join(dir, "tool.tar");
    writeFileSync(tarPath, Buffer.from(await archive.arrayBuffer()));
    const listing = execFileSync("tar", ["-tf", tarPath], { encoding: "utf8" });
    expect(listing).toContain("tar-tool/bin/tar-tool");
    expect(listing).toContain("tar-tool/README.md");
    expect(listing.split("\n").filter(Boolean).every(path => path.startsWith("tar-tool/"))).toBe(true);
    expect(readFileSync(tarPath).length).toBeGreaterThan(1024);
  });

  it.each(["debian", "fedora", "arch", "alpine", "opensuse"] as const)("construye script y repositorio completos para %s", distro => {
    const request = { name: `check-${distro}`, description: `Diagnóstico para ${distro}`, distro, packagesValue: "curl jq", command: "printf 'ok\\n'", mode: "script" as const };
    const scriptBundle = buildBundle(request);
    const repoBundle = buildBundle({ ...request, mode: "repo" });
    const dir = mkdtempSync(join(tmpdir(), `codecraft-${distro}-`));
    const scriptPath = join(dir, `${scriptBundle.slug}.sh`);
    writeExecutable(scriptPath, scriptBundle.script);
    expect(() => execFileSync("bash", ["-n", scriptPath])).not.toThrow();
    expect(execFileSync("bash", [scriptPath, "--dry-run"], { encoding: "utf8" })).toContain("[dry-run]");
    for (const file of repoBundle.files) {
      const target = join(dir, "repo", file.path);
      const parent = target.slice(0, target.lastIndexOf("/"));
      mkdirSync(parent, { recursive: true });
      writeFileSync(target, file.content, { mode: file.executable ? 0o755 : 0o644 });
    }
    expect(execFileSync("bash", [join(dir, "repo", "tests/smoke.sh")], { encoding: "utf8" })).toContain("smoke tests passed");
  });
});
