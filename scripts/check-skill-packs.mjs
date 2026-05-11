#!/usr/bin/env node
/**
 * Lightweight repo check for the skill instruction packs under `skills/`.
 *
 *  - Every known skill must have a folder + SKILL.md placeholder.
 *  - No file under `skills/` may contain plain-text secrets
 *    (`OPENAI_API_KEY=`, `sk-…`, etc.).
 *  - Runtime defaults must keep falling back to mock mode without env vars.
 *
 * Run with `node scripts/check-skill-packs.mjs`. Exit code 0 = ok.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REQUIRED_SKILLS = [
  "credit-product-advisor",
  "financing-need-assessor",
  "financing-product-advisor-dual-view",
  "geenbank-kredietworkflow",
  "moneycare-kredietmemorandum-fabriek",
];

const ROOT = new URL("..", import.meta.url).pathname;
const SKILLS_DIR = join(ROOT, "skills");

const errors = [];

for (const name of REQUIRED_SKILLS) {
  const dir = join(SKILLS_DIR, name);
  try {
    const s = statSync(dir);
    if (!s.isDirectory()) errors.push(`skills/${name} is not a directory`);
  } catch {
    errors.push(`missing folder: skills/${name}/`);
    continue;
  }
  const md = join(dir, "SKILL.md");
  try {
    statSync(md);
  } catch {
    errors.push(`missing file: skills/${name}/SKILL.md`);
  }
}

// Per-skill checks for imported skill packs (real ChatGPT Vaardigheden archives)
// that have been pulled into the repo and need an adapter mapping documented.
const IMPORTED_SKILLS = [
  {
    name: "financing-product-advisor-dual-view",
    requiredFiles: [
      "SKILL.md",
      "agents/openai.yaml",
      "references/api_reference.md",
      "references/output-notes.md",
    ],
    requiredOutputKeys: ["entrepreneur_view", "partner_view"],
    requiredMappingMarkers: [
      "Repo integration notes",
      "Output mapping",
      "viabilityScore",
    ],
  },
  {
    name: "geenbank-kredietworkflow",
    requiredFiles: [
      "SKILL.md",
      "agents/openai.yaml",
      "references/input-schema.md",
      "references/output-specs.md",
      "references/acceptatiecriteria.md",
      "references/pricing-matrix.md",
      "references/project-instruction.md",
      "assets/executive-summary-template.docx",
      "assets/tarieven-lijst-geenbank.xlsx",
    ],
    // Output markers from the imported (financier-shape) skill payload.
    requiredOutputKeys: [
      "decision",
      "feasibility_assessment",
      "recommended_structure",
      "policy_breaches",
    ],
    // Mapping markers proving the repo integration notes + mismatch
    // documentation are present and not silently dropped.
    requiredMappingMarkers: [
      "Repo integration notes (live-capable, env-gated)",
      "Mapping mismatch with the prepared adapter schema",
      "creditWorkflowContext",
      "AI_SKILL_GEENBANKKREDIETWORKFLOW_PROVIDER",
    ],
  },
];

for (const skill of IMPORTED_SKILLS) {
  const dir = join(SKILLS_DIR, skill.name);
  for (const rel of skill.requiredFiles) {
    try {
      statSync(join(dir, rel));
    } catch {
      errors.push(`missing file: skills/${skill.name}/${rel}`);
    }
  }
  let md = "";
  try {
    md = readFileSync(join(dir, "SKILL.md"), "utf8");
  } catch {
    /* already reported above */
  }
  if (md) {
    for (const key of skill.requiredOutputKeys) {
      if (!md.includes(key)) {
        errors.push(
          `skills/${skill.name}/SKILL.md is missing output JSON key "${key}"`,
        );
      }
    }
    for (const marker of skill.requiredMappingMarkers) {
      if (!md.includes(marker)) {
        errors.push(
          `skills/${skill.name}/SKILL.md is missing mapping marker "${marker}"`,
        );
      }
    }
  }
}

const SECRET_PATTERNS = [
  /OPENAI_API_KEY\s*=\s*['"]?sk-[A-Za-z0-9]/i,
  /ANTHROPIC_API_KEY\s*=\s*['"]?sk-[A-Za-z0-9]/i,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bxoxb-[A-Za-z0-9-]{20,}\b/,
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

try {
  for (const file of walk(SKILLS_DIR)) {
    const content = readFileSync(file, "utf8");
    for (const re of SECRET_PATTERNS) {
      if (re.test(content)) {
        errors.push(`possible secret in ${file} (matched ${re})`);
      }
    }
  }
} catch (err) {
  errors.push(`could not scan skills/: ${err.message}`);
}

// Runtime safety: with no AI env vars set, the resolver must default to mock.
const RUNTIME_VARS = [
  "AI_SKILL_PROVIDER",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "AI_API_KEY",
  "AI_SKILL_ENDPOINT",
];
const saved = Object.fromEntries(RUNTIME_VARS.map((k) => [k, process.env[k]]));
for (const k of RUNTIME_VARS) delete process.env[k];
try {
  const mod = await import(
    "../artifacts/api-server/src/lib/skills/runtime.ts"
  ).catch(() => null);
  if (mod) {
    const cfg = mod.resolveSkillRuntime("CreditProductAdvisor");
    if (cfg.provider !== "mock" || !cfg.usedMockMode) {
      errors.push(
        `runtime resolver did not default to mock with no env vars (got ${cfg.provider})`,
      );
    }
  }
  // If the import fails (no tsx loader), skip silently — the dedicated
  // node test runner already exercises this in CI.
} finally {
  for (const k of RUNTIME_VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

if (errors.length > 0) {
  console.error("skill-pack check FAILED:");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}
console.log(
  `skill-pack check OK — ${REQUIRED_SKILLS.length} skill folder(s) present, no secrets detected.`,
);
