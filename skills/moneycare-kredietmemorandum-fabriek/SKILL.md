# moneycare-kredietmemorandum-fabriek

Placeholder for the real ChatGPT Business skill
**`moneycare-kredietmemorandum-fabriek`** — produces both the
financier-facing report and the multi-section credit memorandum.

> **Action required:** paste the exported skill instructions from
> ChatGPT Business below the marker. The adapter keeps running in
> mock-mode until then.

## Adapter binding

* SKILL_MODULE: `MoneycareKredietmemorandum`
* Adapter: `artifacts/api-server/src/lib/skills/moneycare-kredietmemorandum.ts`
* Two entry points:
  * `buildFinancierReport` — short report attached to the dossier.
  * `buildMemorandum` — multi-section memorandum exported to
    partners.
* Connection method (recommended): OpenAI Assistant id with a `mode`
  flag in the input, or two assistants (one per entry point).

## Expected input from adapter

```jsonc
// buildFinancierReport
{
  "mode": "financier_report",
  "dossier": { "..." },
  "metrics": { "margin": 0, "dscr": 0, "revenue": 0, "profit": 0, "requested": 0 },
  "verdict": "kansrijk|voorwaardelijk|uitdagend",
  "strongPoints": ["..."],
  "weakPoints": ["..."]
}

// buildMemorandum
{
  "mode": "memorandum",
  "dossier": { "..." },
  "financierReport": { "..." },
  "verdict": "kansrijk|voorwaardelijk|uitdagend"
}
```

## Expected JSON output to adapter

```jsonc
// buildFinancierReport
{
  "companySummary": "Nederlands",
  "financingRequest": "Nederlands",
  "financialAnalysis": "Nederlands",
  "repaymentCapacity": "Nederlands",
  "riskFactors": ["..."],
  "strengths": ["..."],
  "recommendation": "Nederlands"
}

// buildMemorandum
{
  "sections": [
    { "title": "1. Samenvatting", "body": "Nederlands" },
    { "title": "2. Financieringsverzoek", "body": "Nederlands" },
    { "title": "3. Financiële analyse", "body": "Nederlands" },
    { "title": "4. Aflossingscapaciteit", "body": "Nederlands" },
    { "title": "5. Sterktes", "body": "Nederlands" },
    { "title": "6. Risico's en aandachtspunten", "body": "Nederlands" },
    { "title": "7. Aanbeveling kredietacceptant", "body": "Nederlands" }
  ],
  "attachments": ["..."],
  "partnerNotes": null
}
```

## Hard rules

* All output **in Dutch** — the memorandum is exported to partners.
* Section titles must match the schema above so the PDF exporter can
  render them.
* No API keys or secrets in this file.
* Output strict JSON — schema mismatch breaks the memorandum view and
  the *AI uitvoeringsdetails* panel.

---

<!-- Paste the exported ChatGPT skill instructions below this line -->
