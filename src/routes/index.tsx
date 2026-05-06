import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import variantData from "@/data/variants.json";
import { aggregateScore, type Variant } from "@/lib/scoring";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Activity, Search, Sparkles, FlaskConical, BookOpen, Dna, X, ChevronDown, Info, Download } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "NeuroVUS — AI Variant Classifier for Rare Neurogenetic Disorders" },
      { name: "description", content: "Clinician tool to classify variants of uncertain significance (VUS) for rare neurogenetic disorders, scored 1–10 with full literature evidence." },
    ],
  }),
});

const ALL_PARAMS = [
  "Disease", "Gene", "Transcript ID", "Variant (cDNA)", "Protein", "Variant type",
  "Genomic coordinates", "ClinVar variation ID", "VCV", "ClinVar Classification",
  "Review Status", "Evaluation Date", "gnomAD Frequency", "Frequency score",
  "Allele count", "SIFT", "PolyPhen", "CADD", "Protein domain", "PhyloP",
  "PhastCons", "Inheritance", "Segregation Data", "De novo (Y/N)",
  "No. of families", "Age of onset", "Phenotype description", "EEG Findings",
] as const;

// Map UI param name -> actual JSON key (handles trailing spaces in source data)
const KEY_MAP: Record<string, string> = {
  "Segregation Data": "Segregation Data ",
};
const keyOf = (p: string) => KEY_MAP[p] ?? p;

const records = variantData as Variant[];

function uniqueValues(field: string): string[] {
  const k = keyOf(field);
  const set = new Set<string>();
  for (const r of records) {
    const v = r[k];
    if (v !== null && v !== undefined && v !== "") set.add(String(v));
  }
  return Array.from(set).sort();
}

// Decide if a parameter should render as a dropdown (low cardinality, categorical)
const DROPDOWN_FIELDS = new Set([
  "Disease", "Gene", "Transcript ID", "Variant type", "ClinVar Classification",
  "Review Status", "Inheritance", "De novo (Y/N)", "Protein domain", "Frequency score",
]);

function matches(record: Variant, filters: Record<string, string>): boolean {
  for (const [field, val] of Object.entries(filters)) {
    if (!val) continue;
    const recVal = record[keyOf(field)];
    if (recVal === null || recVal === undefined) return false;
    const a = String(recVal).toLowerCase().trim();
    const b = val.toLowerCase().trim();
    if (!a.includes(b)) return false;
  }
  return true;
}

function scoreColor(score: number): string {
  if (score >= 7) return "bg-destructive text-destructive-foreground";
  if (score >= 5.5) return "bg-amber-500 text-white";
  if (score >= 3) return "bg-yellow-400 text-black";
  return "bg-emerald-600 text-white";
}

function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function exportReportPDF(
  records: Variant[],
  score: ReturnType<typeof aggregateScore>,
  filters: Record<string, string>,
) {
  const activeFilters = Object.entries(filters).filter(([, v]) => v && v.trim() !== "");
  const date = new Date().toLocaleString();
  const first = records[0] ?? {};
  const title = `${String(first["Gene"] ?? "Variant")} ${String(first["Variant (cDNA)"] ?? "")}`.trim();

  const reportSections = records.map((r, i) => {
    const sectionsHtml = SECTIONS.map((sec) => {
      const rows = sec.fields
        .map((f) => [f, r[f]] as const)
        .filter(([, v]) => v !== null && v !== undefined && v !== "");
      if (rows.length === 0) return "";
      return `
        <h3>${escapeHtml(sec.title)}</h3>
        <table class="kv">
          ${rows.map(([f, v]) => `
            <tr><th>${escapeHtml(f.replace(/\.1$/, "").trim())}</th><td>${escapeHtml(v)}</td></tr>
          `).join("")}
        </table>`;
    }).join("");
    const pmid = r["PMID"] ? String(r["PMID"]).split(".")[0] : "";
    return `
      <section class="report">
        <h2>Report ${i + 1}: ${escapeHtml(r["Gene"])} · ${escapeHtml(r["Variant (cDNA)"])} (${escapeHtml(r["Protein"])})</h2>
        <p class="muted">${escapeHtml(r["Disease"] ?? "")}</p>
        ${pmid ? `<p class="muted">PubMed: <a href="https://pubmed.ncbi.nlm.nih.gov/${escapeHtml(pmid)}/">${escapeHtml(pmid)}</a></p>` : ""}
        ${sectionsHtml}
      </section>`;
  }).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>NeuroVUS Report — ${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; margin: 32px; font-size: 12px; line-height: 1.45; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 24px 0 6px; padding-bottom: 4px; border-bottom: 2px solid #2563eb; color: #1e3a8a; }
  h3 { font-size: 12px; margin: 14px 0 4px; color: #2563eb; text-transform: uppercase; letter-spacing: 0.04em; }
  .muted { color: #555; font-size: 11px; margin: 2px 0; }
  .header { border-bottom: 3px solid #2563eb; padding-bottom: 12px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .score-box { text-align: center; padding: 12px 18px; border-radius: 10px; color: #fff; min-width: 120px; }
  .score-box .num { font-size: 28px; font-weight: bold; }
  .score-box .lbl { font-size: 11px; opacity: 0.95; }
  .bg-low { background: #059669; } .bg-mid { background: #f59e0b; } .bg-high { background: #dc2626; } .bg-vlow { background: #facc15; color: #111; }
  table.kv { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  table.kv th { text-align: left; width: 35%; padding: 4px 8px; background: #f3f4f6; border: 1px solid #e5e7eb; font-weight: 600; vertical-align: top; }
  table.kv td { padding: 4px 8px; border: 1px solid #e5e7eb; vertical-align: top; word-break: break-word; }
  .modules { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 8px 0; }
  .module { border: 1px solid #e5e7eb; padding: 6px 10px; border-radius: 6px; font-size: 11px; }
  .module .n { font-weight: 600; }
  .explain { background: #eff6ff; border-left: 3px solid #2563eb; padding: 10px 12px; border-radius: 4px; margin: 8px 0; }
  .filters { background: #f9fafb; padding: 8px 12px; border-radius: 4px; font-size: 11px; }
  .filters span { display: inline-block; background: #fff; border: 1px solid #d1d5db; padding: 2px 8px; border-radius: 999px; margin: 2px 4px 2px 0; }
  section.report { page-break-inside: avoid; margin-top: 18px; }
  ul.contrib { margin: 4px 0 8px 18px; padding: 0; font-size: 11px; }
  @page { margin: 18mm; @bottom-center { content: "Created By: Arushi Ganguly"; font-family: -apple-system, sans-serif; font-size: 10px; color: #555; } }
  .print-footer { position: fixed; bottom: 6mm; left: 0; right: 0; text-align: center; font-size: 10px; color: #555; }
  @media screen { .print-footer { position: static; margin-top: 24px; padding-top: 8px; border-top: 1px solid #e5e7eb; } }
  @media print { body { margin: 18mm 18mm 24mm; } .no-print { display: none; } }
</style></head><body>
  <div class="header">
    <div>
      <h1>NeuroVUS Variant Classification Report</h1>
      <p class="muted">Generated ${escapeHtml(date)}</p>
      <p class="muted">${escapeHtml(title)} — ${records.length} matching report${records.length === 1 ? "" : "s"}</p>
    </div>
    <div class="score-box ${score.score >= 7 ? "bg-high" : score.score >= 5.5 ? "bg-mid" : score.score >= 3 ? "bg-vlow" : "bg-low"}">
      <div class="num">${score.score.toFixed(1)}<span style="font-size:14px;opacity:0.8">/10</span></div>
      <div class="lbl">${escapeHtml(score.label)}</div>
    </div>
  </div>

  ${activeFilters.length ? `<div class="filters"><strong>Clinician inputs:</strong> ${activeFilters.map(([k, v]) => `<span><b>${escapeHtml(k)}:</b> ${escapeHtml(v)}</span>`).join("")}</div>` : ""}

  <h2>Pathogenicity Assessment</h2>
  <div class="explain"><strong>Why this score?</strong><br>${escapeHtml(score.explanation)}</div>

  <h3>Module Breakdown</h3>
  <div class="modules">
    ${score.modules.map((m) => `
      <div class="module">
        <div class="n">${escapeHtml(m.name)}</div>
        <div>${m.used ? `${m.score.toFixed(2)} / ${m.max}` : "no data (neutral)"}</div>
        ${m.used && m.contributions.length ? `<ul class="contrib">${m.contributions.map((c) => `<li>${c.delta > 0 ? "+" : ""}${c.delta.toFixed(2)} — ${escapeHtml(c.label)}</li>`).join("")}</ul>` : ""}
      </div>`).join("")}
  </div>

  ${score.highlights.length ? `<h3>Key Contributions</h3><ul>${score.highlights.map((h) => `<li><b>${h.delta >= 0 ? "+" : ""}${h.delta.toFixed(2)}</b> — ${escapeHtml(h.label)}</li>`).join("")}</ul>` : ""}

  ${reportSections}

  <p class="muted" style="margin-top:24px;border-top:1px solid #e5e7eb;padding-top:8px">
    Disclaimer: This report is generated by an AI-assisted decision support tool (NeuroVUS Classifier) and is intended to aid clinical interpretation. It does not replace expert clinical judgment.
  </p>
  <div class="print-footer">Created By: Arushi Ganguly</div>
  <script>window.onload = () => { setTimeout(() => window.print(), 300); };</script>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) {
    alert("Please allow pop-ups to export the PDF report.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

function Index() {
  const [selected, setSelected] = useState<string[]>(["Gene", "Variant (cDNA)"]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState<Record<string, string> | null>(null);

  const toggleParam = (p: string) => {
    setSelected((s) =>
      s.includes(p) ? s.filter((x) => x !== p) : [...s, p]
    );
    setFilters((f) => {
      if (!f[p]) return f;
      const { [p]: _, ...rest } = f;
      return rest;
    });
  };

  const matched = useMemo(() => {
    if (!submitted) return [];
    const active = Object.fromEntries(
      Object.entries(submitted).filter(([, v]) => v && v.trim() !== "")
    );
    if (Object.keys(active).length === 0) return [];
    return records.filter((r) => matches(r, active));
  }, [submitted]);

  const scoreInfo = useMemo(() => aggregateScore(matched), [matched]);

  const onAnalyze = () => setSubmitted({ ...filters });

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-secondary/40">
      {/* Header */}
      <header className="border-b bg-card/60 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary text-primary-foreground grid place-items-center shadow">
              <Dna className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">NeuroVUS Classifier</h1>
              <p className="text-xs text-muted-foreground">AI-assisted classification of variants of uncertain significance</p>
            </div>
          </div>
          <Badge variant="outline" className="gap-1">
            <Activity className="h-3 w-3" /> {records.length} curated variant reports
          </Badge>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 grid gap-6 lg:grid-cols-[380px_1fr]">
        {/* LEFT: Parameter selection */}
        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Search className="h-4 w-4" /> Select input parameters
              </CardTitle>
              <CardDescription>
                Tick any number of fields the clinician wants to search by, then enter values.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-72 pr-3">
                <div className="grid grid-cols-1 gap-2">
                  {ALL_PARAMS.map((p) => (
                    <label
                      key={p}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted cursor-pointer text-sm"
                    >
                      <Checkbox
                        checked={selected.includes(p)}
                        onCheckedChange={() => toggleParam(p)}
                      />
                      <span>{p}</span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Enter values</CardTitle>
              <CardDescription>{selected.length} parameter{selected.length === 1 ? "" : "s"} active</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {selected.length === 0 && (
                <p className="text-sm text-muted-foreground">No parameters selected.</p>
              )}
              {selected.map((p) => {
                const isDropdown = DROPDOWN_FIELDS.has(p);
                const opts = isDropdown ? uniqueValues(p) : [];
                return (
                  <div key={p} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium">{p}</Label>
                      <button
                        onClick={() => toggleParam(p)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Remove ${p}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {isDropdown ? (
                      <Select
                        value={filters[p] ?? ""}
                        onValueChange={(v) => setFilters((f) => ({ ...f, [p]: v }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={`Select ${p.toLowerCase()}…`} />
                        </SelectTrigger>
                        <SelectContent>
                          {opts.map((o) => (
                            <SelectItem key={o} value={o}>{o}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        placeholder={`Enter ${p.toLowerCase()}`}
                        value={filters[p] ?? ""}
                        onChange={(e) => setFilters((f) => ({ ...f, [p]: e.target.value }))}
                      />
                    )}
                  </div>
                );
              })}

              <Button
                onClick={onAnalyze}
                disabled={selected.length === 0}
                className="w-full gap-2"
              >
                <Sparkles className="h-4 w-4" /> Analyze variant
              </Button>
              {(submitted || Object.keys(filters).length > 0) && (
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => { setFilters({}); setSubmitted(null); }}
                >
                  Reset
                </Button>
              )}
            </CardContent>
          </Card>
        </aside>

        {/* RIGHT: Results */}
        <section className="space-y-6">
          {!submitted && <EmptyState />}

          {submitted && matched.length === 0 && (
            <Card>
              <CardHeader>
                <CardTitle>No matching reports</CardTitle>
                <CardDescription>
                  No curated variants in the database match every filter you provided. Try removing or loosening some parameters.
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          {submitted && matched.length > 0 && (
            <>
              <ScoreCard
                score={scoreInfo}
                matchCount={matched.length}
                onExport={() => exportReportPDF(matched, scoreInfo, submitted)}
              />
              {matched.map((r, idx) => (
                <ReportCard key={idx} record={r} />
              ))}
            </>
          )}
        </section>
      </main>
      <div className="fixed bottom-3 right-4 text-xs text-muted-foreground bg-card/80 backdrop-blur px-2.5 py-1 rounded-full border shadow-sm pointer-events-none z-20">
        Created By: Arushi Ganguly
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="border-dashed">
      <CardContent className="py-16 flex flex-col items-center text-center gap-3">
        <div className="h-14 w-14 rounded-full bg-primary/10 grid place-items-center text-primary">
          <Dna className="h-7 w-7" />
        </div>
        <h2 className="text-lg font-semibold">Ready to classify a variant</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          Select one or more input parameters on the left (Disease, Gene, cDNA change, CADD, inheritance, phenotype…),
          enter values, and run the analysis. The system will retrieve every matching curated report and return an
          AI-derived pathogenicity score from 1 (most likely benign) to 10 (most likely pathogenic).
        </p>
      </CardContent>
    </Card>
  );
}

function ScoreCard({ score, matchCount, onExport }: { score: ReturnType<typeof aggregateScore>; matchCount: number; onExport: () => void }) {
  const pct = (score.score / 10) * 100;
  const [open, setOpen] = useState(false);
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Pathogenicity Score (0–10)
            </CardTitle>
            <CardDescription>
              Aggregated across {matchCount} matching report{matchCount === 1 ? "" : "s"} using a weighted ACMG-inspired framework.
            </CardDescription>
          </div>
          <div className={`px-4 py-3 rounded-xl text-3xl font-bold tabular-nums ${scoreColor(score.score)}`}>
            {score.score.toFixed(1)}
            <span className="text-sm font-normal opacity-80"> /10</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Gauge */}
        <div>
          <div className="h-3 w-full rounded-full bg-gradient-to-r from-emerald-500 via-yellow-400 to-destructive relative">
            <div
              className="absolute -top-1 -translate-x-1/2 h-5 w-1.5 rounded-full bg-foreground shadow"
              style={{ left: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>0 — Benign</span>
            <span>5.5 — VUS</span>
            <span>10 — Pathogenic</span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Badge>{score.label}</Badge>
          <p className="text-xs text-muted-foreground flex-1 min-w-[200px]">
            This score is derived from integrated population, computational, structural, and clinical evidence to assist variant prioritization.
          </p>
          <Button onClick={onExport} size="sm" variant="outline" className="gap-2">
            <Download className="h-4 w-4" /> Export PDF
          </Button>
        </div>

        {/* Highlights */}
        {score.highlights.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Key contributions</div>
            <div className="grid sm:grid-cols-2 gap-2">
              {score.highlights.map((h, i) => (
                <div key={i} className="text-xs flex items-start gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5">
                  <span className={`shrink-0 font-mono px-1.5 py-0.5 rounded ${h.delta >= 0 ? "bg-destructive/10 text-destructive" : "bg-emerald-600/10 text-emerald-700"}`}>
                    {h.delta >= 0 ? "+" : ""}{h.delta.toFixed(2)}
                  </span>
                  <div className="text-foreground">{h.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Module breakdown */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Module breakdown</div>
          <div className="space-y-2">
            {score.modules.map((m) => {
              const pctMod = m.max > 0 ? (m.score / m.max) * 100 : 0;
              return (
                <div key={m.name} className="rounded-md border bg-card px-3 py-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{m.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {m.used ? `${m.score.toFixed(2)} / ${m.max}` : "no data (neutral)"}
                    </span>
                  </div>
                  {m.used && <Progress value={pctMod} className="h-1.5 mt-1.5" />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Why this score? */}
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-between rounded-md border bg-primary/5 hover:bg-primary/10 transition px-3 py-2 text-sm font-medium">
              <span className="flex items-center gap-2"><Info className="h-4 w-4 text-primary" /> Why this score?</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3 space-y-3">
            <p className="text-sm leading-relaxed">{score.explanation}</p>
            <div className="space-y-2">
              {score.modules.filter(m => m.used && m.contributions.length > 0).map((m) => (
                <div key={m.name} className="rounded-md border bg-muted/30 px-3 py-2">
                  <div className="text-xs font-semibold mb-1">{m.name}</div>
                  <ul className="space-y-1">
                    {m.contributions.map((c, i) => (
                      <li key={i} className="text-xs flex items-start gap-2">
                        <span className={`shrink-0 font-mono px-1 rounded ${c.delta > 0 ? "text-destructive" : c.delta < 0 ? "text-emerald-700" : "text-muted-foreground"}`}>
                          {c.delta > 0 ? "+" : ""}{c.delta.toFixed(2)}
                        </span>
                        <span>{c.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

const SECTIONS: { title: string; icon: React.ReactNode; fields: string[] }[] = [
  {
    title: "Variant Identification",
    icon: <Dna className="h-4 w-4" />,
    fields: ["Disease", "Gene", "Transcript ID", "Variant (cDNA)", "Protein", "Variant type",
      "Genomic coordinates", "ClinVar variation ID", "VCV", "ClinVar Classification",
      "Review Status", "Evaluation Date"],
  },
  {
    title: "Population Data",
    icon: <Activity className="h-4 w-4" />,
    fields: ["gnomAD Frequency", "Frequency score", "Allele count"],
  },
  {
    title: "Functional Prediction",
    icon: <FlaskConical className="h-4 w-4" />,
    fields: ["SIFT", "PolyPhen", "CADD"],
  },
  {
    title: "Conservation / Domain",
    icon: <FlaskConical className="h-4 w-4" />,
    fields: ["Protein domain", "PhyloP", "PhastCons"],
  },
  {
    title: "Genetic Evidence",
    icon: <Dna className="h-4 w-4" />,
    fields: ["Inheritance", "Segregation Data ", "De novo (Y/N)", "No. of families"],
  },
  {
    title: "Literature Evidence",
    icon: <BookOpen className="h-4 w-4" />,
    fields: ["Study Title ", "PMID", "Study type", "Clinical Evicdence reported",
      "Functional evidence", "Treatments reported", "Outcome observations"],
  },
  {
    title: "Phenotype / Experimental Data",
    icon: <Activity className="h-4 w-4" />,
    fields: ["Age of onset", "Phenotype description", "EEG Findings",
      "Functional Study (Y/N)", "Functional Result "],
  },
  {
    title: "Clinical Interpretation",
    icon: <Sparkles className="h-4 w-4" />,
    fields: ["Severity", "Author classification", "Evidence Level"],
  },
  {
    title: "Treatment / Outcome",
    icon: <FlaskConical className="h-4 w-4" />,
    fields: ["Treatments reported.1", "Response", "Outcome"],
  },
];

function ReportCard({ record }: { record: Variant }) {
  const pmid = record["PMID"];
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">
              {String(record["Gene"] ?? "")} <span className="text-muted-foreground font-normal">·</span>{" "}
              <span className="font-mono">{String(record["Variant (cDNA)"] ?? "")}</span>{" "}
              <span className="text-muted-foreground font-normal">({String(record["Protein"] ?? "")})</span>
            </CardTitle>
            <CardDescription>{String(record["Disease"] ?? "")}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {Boolean(record["ClinVar Classification"]) && (
              <Badge variant="secondary">{String(record["ClinVar Classification"])}</Badge>
            )}
            {Boolean(record["Variant type"]) && (
              <Badge variant="outline">{String(record["Variant type"])}</Badge>
            )}
            {Boolean(record["Inheritance"]) && (
              <Badge variant="outline">{String(record["Inheritance"])}</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {SECTIONS.map((sec) => {
          const rows = sec.fields
            .map((f) => [f, record[f]] as const)
            .filter(([, v]) => v !== null && v !== undefined && v !== "");
          if (rows.length === 0) return null;
          return (
            <div key={sec.title}>
              <div className="flex items-center gap-2 text-sm font-semibold text-primary mb-2">
                {sec.icon}
                {sec.title}
                {sec.title === "Literature Evidence" && Boolean(pmid) && (
                  <a
                    href={`https://pubmed.ncbi.nlm.nih.gov/${String(pmid).split(".")[0]}/`}
                    target="_blank" rel="noreferrer"
                    className="ml-auto text-xs font-normal text-primary underline underline-offset-2 hover:opacity-80"
                  >
                    PubMed: {String(pmid).split(".")[0]} ↗
                  </a>
                )}
              </div>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {rows.map(([f, v]) => (
                  <div key={f} className="border-b border-dashed py-1.5">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      {f.replace(/\.1$/, "").trim()}
                    </div>
                    <div className="break-words">{String(v)}</div>
                  </div>
                ))}
              </div>
              <Separator className="mt-4" />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
