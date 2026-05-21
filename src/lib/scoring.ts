// Weighted, explainable ACMG-inspired scoring framework.
// Total score is the sum of 5 modules, normalized to 0–10.
// Missing data is treated as NEUTRAL (excluded), never as 0.

export type Variant = Record<string, unknown>;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  if (s === "" || /^(na|n\/a|nd|unknown|absent|none)$/i.test(s)) {
    // "absent" handled separately for AF
    if (/^absent$/i.test(s)) return 0;
    return null;
  }
  const n = parseFloat(s.replace(/[^\d.\-eE]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown) => (v == null ? "" : String(v)).toLowerCase().trim();
const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";

export interface ModuleScore {
  name: string;
  score: number;          // module subtotal (after cap)
  max: number;            // module cap
  contributions: { label: string; delta: number }[]; // raw, pre-cap items
  used: boolean;          // whether any data was available
}

export interface ScoreBreakdown {
  score: number;             // 0–10 normalized
  label: string;             // interpretive label
  explanation: string;       // plain-language summary (interpretation)
  keyDrivers: string[];      // top 3–4 strongest evidence statements
  interpretation: string;    // 1–2 sentence clinical interpretation
  confidence: number;        // 0–1, fraction of modules with data
  confidenceLabel: string;   // High / Moderate / Low
  modules: ModuleScore[];
  highlights: { label: string; delta: number }[]; // top contributing items
}

// ─── Module 1: Population Frequency (0–2) ────────────────────────────────
function modPopulation(v: Variant): ModuleScore {
  const m: ModuleScore = { name: "Population Frequency", score: 0, max: 2, contributions: [], used: false };
  const raw = v["gnomAD Frequency"];
  const af = num(raw);
  if (af === null && !/absent/i.test(String(raw ?? ""))) return m;
  m.used = true;
  const isAbsent = af === 0 || /absent/i.test(String(raw ?? ""));
  let pts = 0, label = "";
  if (isAbsent) { pts = 2; label = "Absent from gnomAD"; }
  else if (af! < 1e-4) { pts = 1.5; label = `Ultra-rare (AF ${af})`; }
  else if (af! < 1e-3) { pts = 1; label = `Rare (AF ${af})`; }
  else if (af! < 1e-2) { pts = 0.5; label = `Low frequency (AF ${af})`; }
  else { pts = 0; label = `Common (AF ${af})`; }
  m.contributions.push({ label, delta: pts });
  m.score = Math.min(m.max, pts);
  return m;
}

// ─── Module 2: Functional Prediction (0–2) ───────────────────────────────
function modFunctional(v: Variant): ModuleScore {
  const m: ModuleScore = { name: "Functional Prediction", score: 0, max: 2, contributions: [], used: false };
  const sift = num(v["SIFT"]);
  const pp = num(v["PolyPhen"]);
  const cadd = num(v["CADD"]);

  if (sift !== null || pp !== null) {
    m.used = true;
    const siftDamaging = sift !== null && sift <= 0.05;
    const ppDamaging = pp !== null && pp >= 0.85;
    const siftBenign = sift !== null && sift > 0.3;
    const ppBenign = pp !== null && pp < 0.2;
    let pts = 0, label = "";
    if ((sift !== null && pp !== null) && siftDamaging && ppDamaging) {
      pts = 1; label = `SIFT ${sift} + PolyPhen ${pp}: both damaging`;
    } else if ((sift !== null && pp !== null) && siftBenign && ppBenign) {
      pts = 0; label = `SIFT ${sift} + PolyPhen ${pp}: both benign`;
    } else if (siftDamaging || ppDamaging) {
      pts = 0.5; label = `Mixed predictions (SIFT ${sift ?? "—"}, PolyPhen ${pp ?? "—"})`;
    } else {
      pts = 0; label = `Predictions not damaging (SIFT ${sift ?? "—"}, PolyPhen ${pp ?? "—"})`;
    }
    m.contributions.push({ label, delta: pts });
  }

  if (cadd !== null) {
    m.used = true;
    let pts = 0, label = "";
    if (cadd >= 20) { pts = 1; label = `CADD ${cadd} (deleterious)`; }
    else if (cadd >= 10) { pts = 0.5; label = `CADD ${cadd} (intermediate)`; }
    else { pts = 0; label = `CADD ${cadd} (low)`; }
    m.contributions.push({ label, delta: pts });
  }

  const total = m.contributions.reduce((a, b) => a + b.delta, 0);
  m.score = Math.min(m.max, total);
  return m;
}

// ─── Module 3: Conservation + Domain (0–2) ───────────────────────────────
function modConservation(v: Variant): ModuleScore {
  const m: ModuleScore = { name: "Conservation & Domain", score: 0, max: 2, contributions: [], used: false };
  const phylo = num(v["PhyloP"]);
  const phast = num(v["PhastCons"]);
  const dom = str(v["Protein domain"]);

  if (phylo !== null) {
    m.used = true;
    let pts = 0;
    if (phylo >= 2) pts = 1;
    else if (phylo >= 1) pts = 0.5;
    m.contributions.push({ label: `PhyloP ${phylo}`, delta: pts });
  }
  if (phast !== null) {
    m.used = true;
    let pts = 0;
    if (phast >= 0.7) pts = 1;
    else if (phast >= 0.3) pts = 0.5;
    m.contributions.push({ label: `PhastCons ${phast}`, delta: pts });
  }
  if (dom) {
    m.used = true;
    let pts = 0.25, label = `Domain: ${v["Protein domain"]} (low-impact)`;
    if (/(critical|catalytic|active site|pore|dna[- ]?binding|kinase|atp[- ]?binding|transmembrane core)/.test(dom)) {
      pts = 1; label = `Critical domain: ${v["Protein domain"]}`;
    } else if (/(binding|regulatory|signaling|transmembrane|conserved|functional)/.test(dom)) {
      pts = 0.5; label = `Moderate-importance domain: ${v["Protein domain"]}`;
    }
    m.contributions.push({ label, delta: pts });
  }

  const total = m.contributions.reduce((a, b) => a + b.delta, 0);
  m.score = Math.min(m.max, total);
  return m;
}

// ─── Module 4: Genetic Evidence (0–2.5) ──────────────────────────────────
function modGenetic(v: Variant): ModuleScore {
  const m: ModuleScore = { name: "Genetic Evidence", score: 0, max: 2.5, contributions: [], used: false };

  const dn = str(v["De novo (Y/N)"]);
  if (dn) {
    m.used = true;
    if (/^y|confirm|de novo/.test(dn)) m.contributions.push({ label: "Confirmed de novo", delta: 1 });
    else if (/unknown|nd|n\/a/.test(dn)) m.contributions.push({ label: "De novo unknown", delta: 0 });
    else if (/^n|inherited/.test(dn)) m.contributions.push({ label: "Not de novo (inherited)", delta: -0.5 });
  }

  const fams = num(v["No. of families"]);
  if (fams !== null) {
    m.used = true;
    if (fams >= 3) m.contributions.push({ label: `Segregation in ${fams} families`, delta: 1 });
    else if (fams >= 1) m.contributions.push({ label: `Segregation in ${fams} family(ies)`, delta: 0.5 });
    else m.contributions.push({ label: "No family segregation", delta: 0 });
  }

  const inh = str(v["Inheritance"]);
  const seg = str(v["Segregation Data "]) || str(v["Segregation Data"]);
  if (inh || seg) {
    m.used = true;
    const text = `${inh} ${seg}`;
    if (/(consistent|co[- ]?segregat|fits|matches)/.test(text)) {
      m.contributions.push({ label: "Inheritance consistent with disease", delta: 0.5 });
    } else if (/(inconsistent|does not segregate|non[- ]?segregat)/.test(text)) {
      m.contributions.push({ label: "Inheritance inconsistent", delta: -0.5 });
    } else {
      m.contributions.push({ label: `Inheritance: ${inh || "unknown"}`, delta: 0 });
    }
  }

  const total = m.contributions.reduce((a, b) => a + b.delta, 0);
  m.score = Math.max(0, Math.min(m.max, total));
  return m;
}

// ─── Module 5: Structural / Variant Impact (0–1.5) ───────────────────────
const AA_PROPS: Record<string, { charge: number; polar: boolean; size: number }> = {
  A: { charge: 0, polar: false, size: 1 }, G: { charge: 0, polar: false, size: 1 },
  V: { charge: 0, polar: false, size: 2 }, L: { charge: 0, polar: false, size: 2 },
  I: { charge: 0, polar: false, size: 2 }, M: { charge: 0, polar: false, size: 2 },
  F: { charge: 0, polar: false, size: 3 }, W: { charge: 0, polar: false, size: 3 },
  P: { charge: 0, polar: false, size: 2 }, S: { charge: 0, polar: true, size: 1 },
  T: { charge: 0, polar: true, size: 2 }, C: { charge: 0, polar: true, size: 2 },
  Y: { charge: 0, polar: true, size: 3 }, N: { charge: 0, polar: true, size: 2 },
  Q: { charge: 0, polar: true, size: 2 }, K: { charge: 1, polar: true, size: 3 },
  R: { charge: 1, polar: true, size: 3 }, H: { charge: 1, polar: true, size: 3 },
  D: { charge: -1, polar: true, size: 2 }, E: { charge: -1, polar: true, size: 2 },
};
const AA3to1: Record<string, string> = {
  Ala: "A", Arg: "R", Asn: "N", Asp: "D", Cys: "C", Gln: "Q", Glu: "E", Gly: "G",
  His: "H", Ile: "I", Leu: "L", Lys: "K", Met: "M", Phe: "F", Pro: "P", Ser: "S",
  Thr: "T", Trp: "W", Tyr: "Y", Val: "V",
};
function parseAAChange(p: string): { ref: string; alt: string } | null {
  const m = p.match(/p\.?\(?([A-Z][a-z]{2}|[A-Z])\d+([A-Z][a-z]{2}|[A-Z*=])\)?/);
  if (!m) return null;
  const ref = AA3to1[m[1]] ?? m[1];
  const alt = AA3to1[m[2]] ?? m[2];
  if (!ref || !alt || alt === "*" || alt === "=") return null;
  return { ref, alt };
}
function modStructural(v: Variant): ModuleScore {
  const m: ModuleScore = { name: "Structural Impact", score: 0, max: 1.5, contributions: [], used: false };
  const vt = str(v["Variant type"]);
  const protein = String(v["Protein"] ?? "");

  if (vt) {
    m.used = true;
    if (/(frameshift|nonsense|stop[-_ ]?gain|splice|start[-_ ]?loss|truncat)/.test(vt)) {
      m.contributions.push({ label: `${v["Variant type"]} (loss-of-function)`, delta: 1.5 });
    } else if (/missense/.test(vt)) {
      m.contributions.push({ label: "Missense variant", delta: 0.5 });
    } else if (/synonymous/.test(vt)) {
      m.contributions.push({ label: "Synonymous", delta: 0 });
    } else if (/in[- ]?frame|insertion|deletion|indel/.test(vt)) {
      m.contributions.push({ label: `${v["Variant type"]}`, delta: 0.75 });
    }
  }

  const aa = parseAAChange(protein);
  if (aa && AA_PROPS[aa.ref] && AA_PROPS[aa.alt]) {
    m.used = true;
    const a = AA_PROPS[aa.ref], b = AA_PROPS[aa.alt];
    const chargeDiff = a.charge !== b.charge;
    const polarDiff = a.polar !== b.polar;
    const sizeDiff = Math.abs(a.size - b.size) >= 2;
    const nonConservative = chargeDiff && polarDiff;
    if (nonConservative) m.contributions.push({ label: `${aa.ref}→${aa.alt}: non-conservative`, delta: 1 });
    else if (chargeDiff || polarDiff) m.contributions.push({ label: `${aa.ref}→${aa.alt}: semi-conservative`, delta: 0.5 });
    if (chargeDiff) m.contributions.push({ label: "Charge change", delta: 0.25 });
    if (polarDiff) m.contributions.push({ label: "Polarity change", delta: 0.25 });
    if (sizeDiff) m.contributions.push({ label: "Significant size difference", delta: 0.25 });
  }

  const total = m.contributions.reduce((a, b) => a + b.delta, 0);
  m.score = Math.max(0, Math.min(m.max, total));
  return m;
}

function labelFor(score: number): string {
  if (score >= 7) return "Likely Pathogenic";
  if (score >= 5.5) return "VUS — leaning pathogenic";
  if (score >= 3) return "VUS — leaning benign";
  return "Likely Benign";
}

function buildExplanation(modules: ModuleScore[], score: number, label: string): string {
  const parts: string[] = [];
  const pop = modules[0], fn = modules[1], cons = modules[2], gen = modules[3], str_ = modules[4];

  if (pop.used) {
    const top = pop.contributions[0]?.label.toLowerCase() ?? "";
    if (pop.score >= 1.5) parts.push(`is ${top}`);
    else if (pop.score <= 0.5) parts.push(`appears at ${top}`);
  }
  if (str_.used) {
    const lof = str_.contributions.find(c => /loss-of-function|frameshift|nonsense|splice/i.test(c.label));
    if (lof) parts.push(`results in a ${lof.label.toLowerCase()}`);
    else if (str_.score >= 0.75) parts.push("alters protein sequence in a non-conservative manner");
  }
  if (fn.used && fn.score >= 1) parts.push("is predicted damaging by computational tools");
  if (cons.used && cons.score >= 1) parts.push("affects an evolutionarily conserved or critical region");
  if (gen.used) {
    const dn = gen.contributions.find(c => /de novo/i.test(c.label) && c.delta > 0);
    const seg = gen.contributions.find(c => /segregation/i.test(c.label) && c.delta > 0);
    if (dn) parts.push("occurs de novo");
    if (seg) parts.push(seg.label.toLowerCase());
  }

  const subject = "This variant";
  const body = parts.length > 0 ? parts.join(", ") : "has limited supporting evidence across the evaluated modules";
  const verdict =
    score >= 7 ? "strongly suggesting functional disruption and a likely pathogenic role."
    : score >= 5.5 ? "leaning toward a pathogenic interpretation, though further evidence is recommended."
    : score >= 3 ? "with insufficient evidence for pathogenicity; classification leans benign."
    : "consistent with a likely benign interpretation.";
  return `${subject} ${body}, ${verdict} Overall score: ${score.toFixed(1)}/10 (${label}).`;
}

export function scoreVariant(v: Variant): ScoreBreakdown {
  const modules = [modPopulation(v), modFunctional(v), modConservation(v), modGenetic(v), modStructural(v)];

  // Sum of caps for modules that had data; normalize to 0–10.
  const usedMaxSum = modules.filter(m => m.used).reduce((a, b) => a + b.max, 0);
  const rawSum = modules.reduce((a, b) => a + b.score, 0);
  const score = usedMaxSum > 0
    ? Math.max(0, Math.min(10, Math.round((rawSum / usedMaxSum) * 10 * 10) / 10))
    : 5; // no data → neutral midpoint

  const label = labelFor(score);

  // Highlights = top contributors across all modules
  const highlights = modules
    .flatMap(m => m.contributions.map(c => ({ label: c.label, delta: c.delta })))
    .filter(c => Math.abs(c.delta) >= 0.5)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 6);

  const explanation = buildExplanation(modules, score, label);
  return { score, label, explanation, modules, highlights };
}

export function aggregateScore(records: Variant[]): ScoreBreakdown {
  if (records.length === 0) {
    return {
      score: 5, label: "No matching evidence",
      explanation: "No curated reports matched the selected criteria.",
      modules: [], highlights: [],
    };
  }
  if (records.length === 1) return scoreVariant(records[0]);

  const all = records.map(scoreVariant);
  const score = Math.round((all.reduce((a, b) => a + b.score, 0) / all.length) * 10) / 10;
  const label = labelFor(score);

  // Merge modules by name (average used scores)
  const merged: Record<string, ModuleScore> = {};
  for (const sb of all) {
    for (const m of sb.modules) {
      if (!merged[m.name]) merged[m.name] = { name: m.name, score: 0, max: m.max, contributions: [], used: false };
      const acc = merged[m.name];
      if (m.used) {
        acc.used = true;
        acc.score += m.score;
        for (const c of m.contributions) {
          if (!acc.contributions.find(x => x.label === c.label)) acc.contributions.push(c);
        }
      }
    }
  }
  const usedCounts: Record<string, number> = {};
  for (const sb of all) for (const m of sb.modules) if (m.used) usedCounts[m.name] = (usedCounts[m.name] ?? 0) + 1;
  for (const name of Object.keys(merged)) {
    const c = usedCounts[name] || 1;
    merged[name].score = Math.round((merged[name].score / c) * 100) / 100;
  }
  const modules = Object.values(merged);
  const highlights = modules
    .flatMap(m => m.contributions.map(c => ({ label: c.label, delta: c.delta })))
    .filter(c => Math.abs(c.delta) >= 0.5)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 6);
  const explanation = buildExplanation(modules, score, label) +
    ` Aggregated across ${records.length} matching reports.`;
  return { score, label, explanation, modules, highlights };
}
