# geenbank-kredietworkflow

Placeholder for the real ChatGPT Business skill
**`geenbank-kredietworkflow`** — the Dutch entrepreneur-facing
workflow.

> **Action required:** paste the exported skill instructions from
> ChatGPT Business below the marker. The adapter keeps running in
> mock-mode until then.

## Adapter binding

* SKILL_MODULE: `GeenbankKredietworkflow`
* Adapter: `artifacts/api-server/src/lib/skills/geenbank-kredietworkflow.ts`
* Connection method (recommended): OpenAI Assistant id.

## Expected input from adapter

```jsonc
{
  "dossier": { "...full dossier..." },
  "scores": {
    "completenessScore": 0,
    "correctnessScore": 0,
    "viabilityScore": 0
  },
  "metrics": { "margin": 0, "dscr": 0, "revenue": 0, "profit": 0, "requested": 0 },
  "documents": { "completed": 0, "required": 0 }
}
```

## Expected JSON output to adapter

```json
{
  "confidenceScore": 0,
  "verdict": "kansrijk|voorwaardelijk|uitdagend",
  "verdictSummary": "Korte Nederlandse samenvatting",
  "entrepreneurReport": {
    "headline": "Nederlandse kop",
    "summary": "Nederlandse samenvatting",
    "strongPoints": ["..."],
    "weakPoints": ["..."],
    "actionPoints": ["..."],
    "likelyFinancierAsks": ["..."],
    "canSubmit": false
  },
  "strongPoints": ["..."],
  "weakPoints": ["..."]
}
```

* All user-facing strings **must be in Dutch** — the FE renders them
  verbatim.
* `verdict` is one of `kansrijk` / `voorwaardelijk` / `uitdagend`.
* `canSubmit` must respect the gate thresholds defined in
  `artifacts/api-server/src/lib/skills/types.ts` (`GATE_THRESHOLDS`).

## Hard rules

* No API keys or secrets in this file.
* Output strict JSON — the orchestrator persists it to
  `ai_analysis_runs` and the FE depends on the schema above.
* Never include personally identifying information of the contact
  person in the entrepreneur report unless it is already in the
  dossier.

---

<!-- Paste the exported ChatGPT skill instructions below this line -->
