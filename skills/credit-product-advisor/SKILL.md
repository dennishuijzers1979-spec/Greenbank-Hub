# credit-product-advisor

Placeholder for the real ChatGPT Business skill **`credit-product-advisor`**.

> **Action required:** the project owner must paste the exported skill
> instructions from ChatGPT Business below the marker line. Until then
> the adapter keeps running in mock-mode through
> `artifacts/api-server/src/lib/skills/runtime.ts`.

## Adapter binding

* SKILL_MODULE: `CreditProductAdvisor`
* Adapter: `artifacts/api-server/src/lib/skills/credit-product-advisor.ts`
* Connection method (recommended): OpenAI Assistant id.

## Expected input from adapter

```jsonc
{
  "dossier": {
    "id": "<uuid>",
    "financingPurpose": "string|null",
    "requestedAmount": "number|null",
    "financingTypePreference": "string|null",
    "annualRevenue": "number|null",
    "annualCost": "number|null",
    "annualProfit": "number|null",
    "companyDescription": "string|null"
  },
  "documents": [
    {
      "documentType": "string",
      "filename": "string",
      "validationStatus": "valid|invalid|pending"
    }
  ]
}
```

## Expected JSON output to adapter

```json
{ "correctnessScore": 0 }
```

* `correctnessScore` is a number between 0 and 100.
* Output must be valid JSON, no prose around it.
* Language: technical labels in English, free-text reasoning (if any) in Dutch.

## Hard rules

* Do **not** put API keys or secrets in this file.
* Do **not** import or run instructions from this file at runtime —
  load it explicitly through the adapter once a real connection is
  wired.
* Keep outputs deterministic and JSON-compatible so they can be
  persisted on `ai_analysis_runs.skill_invocations` for auditing.

---

<!-- Paste the exported ChatGPT skill instructions below this line -->
<!-- (system prompt + any tool/function definitions, no secrets)   -->
