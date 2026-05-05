// ACMG-inspired heuristic to convert a variant record into a 1–10 pathogenicity scale.
// 1 = most likely benign, 10 = most likely pathogenic.
export type Variant = Record<string, unknown>;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^\d.\-eE]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown) => (v == null ? "" : String(v)).toLowerCase();

export interface ScoreBreakdown {
  score: number; // 1..10
  label: string;
  reasons: { criterion: string; delta: number; detail: string }[];
}

export function scoreVariant(v: Variant): ScoreBreakdown {
  const reasons: ScoreBreakdown["reasons"] = [];
  let s = 5.5; // neutral VUS midpoint

  // ClinVar classification (strong anchor)
  const clin = str(v["ClinVar Classification"]);
  if (clin.includes("pathogenic") && !clin.includes("likely")) {
    s += 3; reasons.push({ criterion: "ClinVar", delta: +3, detail: "Pathogenic in ClinVar" });
  } else if (clin.includes("likely pathogenic") || clin.includes("pathogenic/likely")) {
    s += 2.2; reasons.push({ criterion: "ClinVar", delta: +2.2, detail: "Likely Pathogenic" });
  } else if (clin.includes("benign") && !clin.includes("likely")) {
    s -= 3.5; reasons.push({ criterion: "ClinVar", delta: -3.5, detail: "Benign in ClinVar" });
  } else if (clin.includes("likely benign")) {
    s -= 2.2; reasons.push({ criterion: "ClinVar", delta: -2.2, detail: "Likely Benign" });
  } else if (clin.includes("uncertain")) {
    reasons.push({ criterion: "ClinVar", delta: 0, detail: "VUS — relying on supporting evidence" });
  }

  // Variant type (PVS1-style)
  const vt = str(v["Variant type"]);
  if (/(frameshift|nonsense|stop[-_ ]?gain|splice|start[-_ ]?loss)/.test(vt)) {
    s += 1.2; reasons.push({ criterion: "PVS1", delta: +1.2, detail: `Loss-of-function (${vt})` });
  } else if (/synonymous/.test(vt)) {
    s -= 1.0; reasons.push({ criterion: "BP7", delta: -1.0, detail: "Synonymous change" });
  }

  // Population frequency
  const af = num(v["gnomAD Frequency"]);
  if (af !== null) {
    if (af === 0) { s += 0.6; reasons.push({ criterion: "PM2", delta: +0.6, detail: "Absent from gnomAD" }); }
    else if (af < 1e-5) { s += 0.4; reasons.push({ criterion: "PM2_supp", delta: +0.4, detail: `Ultra-rare (${af})` }); }
    else if (af > 5e-3) { s -= 1.5; reasons.push({ criterion: "BA1/BS1", delta: -1.5, detail: `Common allele (${af})` }); }
  }

  // CADD
  const cadd = num(v["CADD"]);
  if (cadd !== null) {
    if (cadd >= 25) { s += 0.8; reasons.push({ criterion: "PP3", delta: +0.8, detail: `CADD ${cadd} (deleterious)` }); }
    else if (cadd >= 20) { s += 0.4; reasons.push({ criterion: "PP3", delta: +0.4, detail: `CADD ${cadd}` }); }
    else if (cadd < 10) { s -= 0.6; reasons.push({ criterion: "BP4", delta: -0.6, detail: `CADD ${cadd} (low)` }); }
  }

  // SIFT (lower = more damaging)
  const sift = num(v["SIFT"]);
  if (sift !== null) {
    if (sift <= 0.05) { s += 0.4; reasons.push({ criterion: "PP3", delta: +0.4, detail: `SIFT ${sift}` }); }
    else if (sift > 0.3) { s -= 0.3; reasons.push({ criterion: "BP4", delta: -0.3, detail: `SIFT ${sift}` }); }
  }

  // PolyPhen (higher = damaging)
  const pp = num(v["PolyPhen"]);
  if (pp !== null) {
    if (pp >= 0.85) { s += 0.4; reasons.push({ criterion: "PP3", delta: +0.4, detail: `PolyPhen ${pp}` }); }
    else if (pp < 0.2) { s -= 0.3; reasons.push({ criterion: "BP4", delta: -0.3, detail: `PolyPhen ${pp}` }); }
  }

  // Conservation
  const phylo = num(v["PhyloP"]);
  if (phylo !== null) {
    if (phylo >= 5) { s += 0.4; reasons.push({ criterion: "PP3", delta: +0.4, detail: `PhyloP ${phylo}` }); }
    else if (phylo < 1) { s -= 0.3; reasons.push({ criterion: "BP4", delta: -0.3, detail: `PhyloP ${phylo}` }); }
  }

  // De novo (PS2/PM6)
  const dn = str(v["De novo (Y/N)"]);
  if (dn.startsWith("y") || dn.includes("ps2") || dn.includes("pm6")) {
    const strong = dn.includes("strong") || dn.includes("ps2");
    const d = strong ? 1.2 : 0.7;
    s += d; reasons.push({ criterion: strong ? "PS2" : "PM6", delta: +d, detail: `De novo: ${v["De novo (Y/N)"]}` });
  }

  // Segregation / families
  const fam = num(v["No. of families"]);
  if (fam !== null && fam >= 2) {
    s += 0.5; reasons.push({ criterion: "PP1", delta: +0.5, detail: `Segregation in ${fam} families` });
  }

  // Functional study
  const fs = str(v["Functional Study (Y/N)"]);
  const fr = str(v["Functional Result "]) || str(v["Functional Result"]);
  if (fs.startsWith("y")) {
    if (/(damaging|loss|abolish|deleterious|abnormal|impair)/.test(fr)) {
      s += 0.8; reasons.push({ criterion: "PS3", delta: +0.8, detail: "Functional study: damaging" });
    } else if (/(normal|no effect|benign)/.test(fr)) {
      s -= 0.8; reasons.push({ criterion: "BS3", delta: -0.8, detail: "Functional study: no effect" });
    }
  }

  // Author classification
  const ac = str(v["Author classification"]);
  if (/pathogenic|causative/.test(ac)) {
    s += 0.4; reasons.push({ criterion: "Author", delta: +0.4, detail: "Author: pathogenic" });
  } else if (/benign/.test(ac)) {
    s -= 0.4; reasons.push({ criterion: "Author", delta: -0.4, detail: "Author: benign" });
  }

  // Clamp 1..10
  const score = Math.max(1, Math.min(10, Math.round(s * 10) / 10));
  let label = "Uncertain significance";
  if (score >= 8.5) label = "Likely Pathogenic — strong";
  else if (score >= 7) label = "Likely Pathogenic";
  else if (score >= 5.5) label = "VUS — leaning pathogenic";
  else if (score >= 4) label = "VUS — leaning benign";
  else if (score >= 2.5) label = "Likely Benign";
  else label = "Likely Benign — strong";

  return { score, label, reasons };
}

export function aggregateScore(records: Variant[]): ScoreBreakdown {
  if (records.length === 0) return { score: 5.5, label: "No matching evidence", reasons: [] };
  const scored = records.map(scoreVariant);
  const avg = scored.reduce((a, b) => a + b.score, 0) / scored.length;
  const score = Math.round(avg * 10) / 10;
  // Merge unique reasons
  const seen = new Set<string>();
  const reasons: ScoreBreakdown["reasons"] = [];
  for (const sb of scored) for (const r of sb.reasons) {
    const k = `${r.criterion}|${r.detail}`;
    if (!seen.has(k)) { seen.add(k); reasons.push(r); }
  }
  let label = "Uncertain significance";
  if (score >= 8.5) label = "Likely Pathogenic — strong";
  else if (score >= 7) label = "Likely Pathogenic";
  else if (score >= 5.5) label = "VUS — leaning pathogenic";
  else if (score >= 4) label = "VUS — leaning benign";
  else if (score >= 2.5) label = "Likely Benign";
  else label = "Likely Benign — strong";
  return { score, label, reasons };
}
