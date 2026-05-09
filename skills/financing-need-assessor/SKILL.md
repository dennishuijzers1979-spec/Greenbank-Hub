# financing-need-assessor

Placeholder for the real ChatGPT Business skill **`financing-need-assessor`**.

> **Action required:** paste the exported skill instructions from
> ChatGPT Business below the marker. The adapter keeps running in
> mock-mode until then.

## Adapter binding

* SKILL_MODULE: `FinancingNeedAssessor`
* Adapter: `artifacts/api-server/src/lib/skills/financing-need-assessor.ts`
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
    { "documentType": "string", "filename": "string", "validationStatus": "valid|invalid|pending" }
  ]
}
```

## Expected JSON output to adapter

```json
{
  "completenessScore": 0,
  "completedDocs": 0,
  "requiredDocs": 0
}
```

* `completenessScore` ∈ [0, 100].
* `completedDocs ≤ requiredDocs`, both integers.
* Output must be parseable JSON.

## Hard rules

* No API keys or secrets in this file.
* Do not echo the raw dossier back in the output — only the three
  summary fields above.
* Keep outputs deterministic so the central gate stays stable across
  retries.

---

<!-- Paste the exported ChatGPT skill instructions below this line -->
