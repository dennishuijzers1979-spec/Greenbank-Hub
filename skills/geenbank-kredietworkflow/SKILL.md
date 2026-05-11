# geenbank-kredietworkflow

Placeholder for the real ChatGPT Business skill
**`geenbank-kredietworkflow`** — the Dutch entrepreneur-facing
workflow that turns the upstream scores + dossier into a verdict and
a Dutch entrepreneur report.

> **Action required:** paste the exported skill instructions from
> ChatGPT Business below the marker. The adapter keeps running in
> mock-mode until then. Adding this file alone does **not** enable
> live invocation — that requires both the per-skill
> `AI_SKILL_GEENBANKKREDIETWORKFLOW_PROVIDER=openai` env and a real
> implementation inside the adapter callback.

## Adapter binding

* SKILL_MODULE: `GeenbankKredietworkflow`
* Adapter: `artifacts/api-server/src/lib/skills/geenbank-kredietworkflow.ts`
* Schema validator (forward-only): `artifacts/api-server/src/lib/skills/geenbank-kredietworkflow-schema.ts`
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
  "documents": { "completed": 0, "required": 0 },
  "creditWorkflowContext": {
    "dualView": null,
    "needAssessment": null,
    "creditAdvice": null
  }
}
```

`creditWorkflowContext` is the chain hand-off slot — when the upstream
adapters (FinancingNeedAssessor, CreditProductAdvisor,
FinancingProductAdvisorDualView) move from mock to live, their typed
output is forwarded here so this skill can quote back the same
strengths / weaknesses / financier-facing structure instead of
re-reasoning them. Today the adapter sends `null` placeholders.

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
* `confidenceScore` is an integer in `[0, 100]`.
* `canSubmit` must respect the gate thresholds defined in
  `artifacts/api-server/src/lib/skills/types.ts` (`GATE_THRESHOLDS`):
  `completenessScore >= 60 && correctnessScore >= 60 && viabilityScore >= 50`.

## Hard rules

* No API keys or secrets in this file.
* Output strict JSON — the orchestrator persists it to
  `ai_analysis_runs` and the FE depends on the schema above.
* Never include personally identifying information of the contact
  person in the entrepreneur report unless it is already in the
  dossier.

## Repo integration notes

When live invocation is wired (next milestone — not enabled today):

1. Reuse the `instrumentSkill(MODULE, ctx, …)` callback pattern from
   `financing-product-advisor-dual-view.ts`. The deterministic mock
   path stays as the fallback so the central gate, prevalidation
   tests, and the *AI uitvoeringsdetails* panel keep working when the
   per-skill PROVIDER env is unset.
2. Load this `SKILL.md` as the OpenAI `system` message via
   `loadSkillMarkdown("geenbank-kredietworkflow")`.
3. Send the structured input documented above as the `user` message
   in JSON mode at temperature 0.
4. Validate the response with `validateGeenbankKredietworkflowJson`
   from `geenbank-kredietworkflow-schema.ts`. On any validation error,
   record `fallbackReason` and return the deterministic mock output —
   never throw out of `run`.
5. Promote the adapter to live behind the per-skill env opt-in
   `AI_SKILL_GEENBANKKREDIETWORKFLOW_PROVIDER=openai` (plus
   `OPENAI_API_KEY`). The global `AI_SKILL_PROVIDER` switch must keep
   defaulting every adapter to mock — see the honesty rule in
   `runtime.ts`.

## Output mapping (skill JSON → adapter contract)

The skill JSON above is already 1:1 with `GeenbankKredietworkflowOutput`
in `artifacts/api-server/src/lib/skills/geenbank-kredietworkflow.ts` —
no field renaming is required. The adapter must still:

| Skill field | Adapter responsibility |
| --- | --- |
| `confidenceScore` | Clamp via `pct()` before persisting (defence in depth). |
| `verdict` | Reject anything outside the enum and fall back to mock. |
| `verdictSummary`, `entrepreneurReport.headline`, `entrepreneurReport.summary` | Pass through verbatim — must already be Dutch. |
| `entrepreneurReport.canSubmit` | Cross-check against `GATE_THRESHOLDS`; if the skill says `true` while a threshold is unmet, the adapter MUST overwrite to `false` (gate stays the source of truth). |
| `entrepreneurReport.strongPoints` / `weakPoints` / `actionPoints` / `likelyFinancierAsks` | Pass through; truncate each item to a sensible length only if it exceeds 240 chars. |
| top-level `strongPoints` / `weakPoints` | Persist as-is; consumed by `MoneycareKredietmemorandum` to build the financier-facing report. |

---

<!-- Paste the exported ChatGPT skill instructions below this line -->
