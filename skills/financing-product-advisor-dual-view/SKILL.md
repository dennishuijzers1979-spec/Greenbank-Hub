# financing-product-advisor-dual-view

Placeholder for the real ChatGPT Business skill
**`financing-product-advisor-dual-view`**.

> **Action required:** paste the exported skill instructions from
> ChatGPT Business below the marker. The adapter keeps running in
> mock-mode until then.

## Adapter binding

* SKILL_MODULE: `FinancingProductAdvisorDualView`
* Adapter: `artifacts/api-server/src/lib/skills/financing-product-advisor-dual-view.ts`
* Connection method (recommended): OpenAI Assistant id, temperature 0,
  JSON mode.

## Expected input from adapter

```jsonc
{
  "dossier": {
    "annualRevenue": "number|null",
    "annualCost": "number|null",
    "annualProfit": "number|null",
    "requestedAmount": "number|null",
    "financingTypePreference": "string|null"
  }
}
```

## Expected JSON output to adapter

```json
{
  "viabilityScore": 0,
  "revenue": 0,
  "profit": 0,
  "requested": 0,
  "margin": 0,
  "dscr": 0
}
```

* `viabilityScore` ∈ [0, 100] — drives the central gate.
* `margin` and `dscr` are decimal ratios (e.g. `0.12` = 12%).
* Output must be parseable JSON, no commentary.

## Hard rules

* No API keys or secrets in this file.
* Use temperature 0 and JSON mode so the score is stable across
  retries — flipping the verdict on rerun would break the gate
  contract.
* Do not call out to other skills from inside this one; the
  orchestrator composes them.

---

<!-- Paste the exported ChatGPT skill instructions below this line -->
