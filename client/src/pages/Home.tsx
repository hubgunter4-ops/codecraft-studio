import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ChevronRight, Clipboard, Code2, FileCode2, Loader2, Play, RotateCcw, ShieldCheck, Sparkles, WandSparkles } from "lucide-react";

const starter = `function sumar(a, b) {
  return a + b
}

console.log(sumar(2, 3))`;
const fileExtension: Record<string, string> = { javascript: "js", typescript: "ts", python: "py", java: "java", go: "go", rust: "rs" };

type Language = "javascript" | "typescript" | "python" | "java" | "go" | "rust";

export default function Home() {
  const [code, setCode] = useState(starter);
  const [language, setLanguage] = useState<Language>("javascript");
  const [reviewResult, setReviewResult] = useState("");
  const [correctedResult, setCorrectedResult] = useState("");
  const [activeTab, setActiveTab] = useState<"review" | "corrected">("review");
  const result = activeTab === "review" ? reviewResult : correctedResult;
  const review = trpc.code.review.useMutation({
    onSuccess: (data) => {
      if (data.mode === "correct") { setCorrectedResult(data.result); setActiveTab("corrected"); toast.success("Código corregido"); }
      else { setReviewResult(data.result); setActiveTab("review"); toast.success("Revisión lista"); }
    },
    onError: (error) => toast.error(error.message || "No se pudo completar la revisión"),
  });

  const runReview = (mode: "review" | "correct") => {
    if (!code.trim()) return toast.error("Escribe o pega código para empezar");
    review.mutate({ code, language, mode });
  };
  const copyResult = async () => { if (!result) return; await navigator.clipboard.writeText(result); toast.success("Resultado copiado"); };
  const reset = () => { setCode(""); setReviewResult(""); setCorrectedResult(""); };

  return (
    <div className="min-h-screen bg-[#f7f8fa] text-[#17202a]">
      <header className="sticky top-0 z-10 border-b border-[#e6e9ed] bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-6 py-4 lg:px-10">
          <div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-[#1e3a5f] text-white shadow-sm"><Code2 size={19} /></div><div><div className="font-extrabold tracking-tight">CodeCraft <span className="text-[#e56b42]">Studio</span></div><div className="font-mono text-[10px] uppercase tracking-[.22em] text-[#8090a0]">AI code workspace</div></div></div>
          <div className="hidden items-center gap-5 text-sm text-[#718096] md:flex"><span className="flex items-center gap-2"><ShieldCheck size={15} className="text-[#4c9f70]" /> Tu código no se guarda</span><span className="h-4 w-px bg-[#e6e9ed]" /><span>Servidor local</span></div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-6 py-8 lg:px-10 lg:py-12">
        <div className="mb-9 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-[#e56b42]"><Sparkles size={14} /> Espacio de trabajo</div><h1 className="max-w-2xl text-4xl font-extrabold leading-[1.05] tracking-[-.05em] text-[#14283d] md:text-5xl">Código claro. <span className="text-[#e56b42]">Ideas en marcha.</span></h1><p className="mt-4 max-w-xl text-base leading-7 text-[#718096]">Escribe, revisa y mejora tu código con un segundo par de ojos inteligente.</p></div><div className="flex items-center gap-2 text-xs text-[#8a98a6]"><span className="size-2 rounded-full bg-[#4c9f70]" /> OpenAI conectado de forma segura</div></div>

        <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
          <section className="overflow-hidden rounded-2xl border border-[#dde3e9] bg-white shadow-[0_14px_40px_rgba(31,55,78,.06)]"><div className="flex items-center justify-between border-b border-[#edf0f3] px-5 py-4"><div className="flex items-center gap-3"><FileCode2 size={18} className="text-[#e56b42]" /><div><h2 className="text-sm font-bold">Tu código</h2><p className="text-xs text-[#91a0ad]">Edita directamente en el espacio</p></div></div><Select value={language} onValueChange={(value) => setLanguage(value as Language)}><SelectTrigger className="h-9 w-[145px] border-[#e1e6eb] bg-[#f8fafb] text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="javascript">JavaScript</SelectItem><SelectItem value="typescript">TypeScript</SelectItem><SelectItem value="python">Python</SelectItem><SelectItem value="java">Java</SelectItem><SelectItem value="go">Go</SelectItem><SelectItem value="rust">Rust</SelectItem></SelectContent></Select></div><div className="relative bg-[#172635] p-1"><div className="flex items-center gap-2 px-4 py-2 font-mono text-[11px] text-[#8da0b2]"><span className="size-2 rounded-full bg-[#ed8060]" /><span className="size-2 rounded-full bg-[#e6bb65]" /><span className="size-2 rounded-full bg-[#6fb887]" /><span className="ml-2 opacity-60">untitled.{fileExtension[language]}</span></div><Textarea value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} className="min-h-[390px] resize-none rounded-lg border-0 bg-[#1d2e3e] px-5 py-5 font-mono text-[13px] leading-6 text-[#e5edf3] shadow-none focus-visible:ring-1 focus-visible:ring-[#e56b42]" placeholder="Pega tu código aquí..." /></div><div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0f3] px-5 py-4"><button onClick={reset} className="flex items-center gap-2 text-xs font-semibold text-[#8a98a6] transition hover:text-[#e56b42]"><RotateCcw size={14} /> Limpiar</button><div className="flex gap-2"><Button variant="outline" onClick={() => runReview("review")} disabled={review.isPending} className="h-10 border-[#dfe5ea] px-4 text-xs font-bold text-[#34516b] hover:bg-[#f5f8fa]">{review.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Play className="mr-2 size-4" />} Revisar código</Button><Button onClick={() => runReview("correct")} disabled={review.isPending} className="h-10 bg-[#e56b42] px-4 text-xs font-bold text-white shadow-sm hover:bg-[#d95d35]"><WandSparkles className="mr-2 size-4" /> Corregir con IA</Button></div></div></section>

          <section className="overflow-hidden rounded-2xl border border-[#dde3e9] bg-white shadow-[0_14px_40px_rgba(31,55,78,.06)]"><div className="flex items-center justify-between border-b border-[#edf0f3] px-5 py-4"><div><h2 className="text-sm font-bold">Resultado</h2><p className="text-xs text-[#91a0ad]">Análisis y sugerencias accionables</p></div>{result && <button onClick={copyResult} className="flex items-center gap-2 text-xs font-semibold text-[#6c7f8d] hover:text-[#e56b42]"><Clipboard size={14} /> Copiar</button>}</div><div className="flex gap-6 border-b border-[#edf0f3] px-5"><button onClick={() => setActiveTab("review")} className={`relative py-3 text-xs font-bold ${activeTab === "review" ? "text-[#e56b42]" : "text-[#9aa7b2]"}`}>Revisión {activeTab === "review" && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[#e56b42]" />}</button><button onClick={() => setActiveTab("corrected")} className={`relative py-3 text-xs font-bold ${activeTab === "corrected" ? "text-[#e56b42]" : "text-[#9aa7b2]"}`}>Versión corregida {activeTab === "corrected" && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[#e56b42]" />}</button></div><div className="min-h-[390px] p-6">{result ? <div className="whitespace-pre-wrap font-mono text-[12px] leading-6 text-[#435669]">{result}</div> : <div className="flex min-h-[340px] flex-col items-center justify-center text-center"><div className="mb-5 grid size-14 place-items-center rounded-2xl bg-[#fff3ee] text-[#e56b42]"><WandSparkles size={24} /></div><h3 className="text-sm font-bold text-[#324b61]">{activeTab === "review" ? "Tu análisis aparecerá aquí" : "Tu versión corregida aparecerá aquí"}</h3><p className="mt-2 max-w-[250px] text-xs leading-5 text-[#99a7b2]">Selecciona una acción para recibir feedback claro y práctico sobre tu código.</p><div className="mt-6 flex flex-wrap justify-center gap-2"><Badge variant="outline" className="border-[#e3e8ed] text-[10px] font-medium text-[#7d8e9c]">Errores</Badge><Badge variant="outline" className="border-[#e3e8ed] text-[10px] font-medium text-[#7d8e9c]">Rendimiento</Badge><Badge variant="outline" className="border-[#e3e8ed] text-[10px] font-medium text-[#7d8e9c]">Buenas prácticas</Badge></div></div>}</div></section>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-[#e8ecef] bg-white px-4 py-3"><div className="mb-1 text-[10px] font-bold uppercase tracking-[.15em] text-[#9aa7b2]">01 · Escribe</div><div className="text-xs font-semibold text-[#476176]">Pega cualquier fragmento</div></div><div className="rounded-xl border border-[#e8ecef] bg-white px-4 py-3"><div className="mb-1 text-[10px] font-bold uppercase tracking-[.15em] text-[#9aa7b2]">02 · Analiza</div><div className="text-xs font-semibold text-[#476176]">Detecta problemas al instante</div></div><div className="rounded-xl border border-[#e8ecef] bg-white px-4 py-3"><div className="mb-1 text-[10px] font-bold uppercase tracking-[.15em] text-[#9aa7b2]">03 · Mejora</div><div className="flex items-center gap-1 text-xs font-semibold text-[#476176]">Aplica cambios con confianza <ChevronRight size={14} className="text-[#e56b42]" /></div></div></div>
      </main>
      <footer className="mx-auto max-w-[1440px] px-6 pb-8 pt-2 text-center text-[11px] text-[#9aa7b2] lg:px-10">CodeCraft Studio · Tu código se procesa de forma segura y no se almacena.</footer>
    </div>
  );
}
