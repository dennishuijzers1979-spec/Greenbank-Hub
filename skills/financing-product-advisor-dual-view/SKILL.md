---
name: financing-product-advisor-dual-view
description: "advise on the most suitable business lending product or product mix from financial information such as annual accounts, trial balance, interim figures, bank transactions, liquidity forecasts, management information, and optional output from geenbank-kredietworkflow. use when chatgpt must translate financing purpose, repayment capacity, collateral support, evidence quality, and structure feasibility into two aligned outputs: entrepreneur-readable guidance with cta and to-do lists, plus a structured partner-facing recommendation in json."
---

# Financing Product Advisor Dual View

Use this skill to assess a business financing case and produce one analysis with two aligned outputs:
- an entrepreneur view in plain language
- a partner view for submission shaping and product selection

## Inputs
Accept any combination of:
- annual accounts
- trial balance
- interim figures
- bank transactions
- liquidity forecasts
- management information
- optional output from `geenbank-kredietworkflow`

Treat `geenbank-kredietworkflow` output as enrichment, not as sole authority.

## Workflow
Follow this sequence:
1. Normalize the case inputs and identify missing critical evidence.
2. Determine the financing purpose and split mixed needs into purpose components where relevant.
3. Assess repayment capacity using cash flow, solvency, dscr, ebitda, and related indicators when available.
4. Assess collateral support and bank-transaction evidence.
5. Build a shortlist from the relevant product families instead of forcing a full-universe comparison.
6. Recommend the best single product and, if justified, the best product mix.
7. Build an indicative structure.
8. Determine the entrepreneur cta status.
9. Produce both the entrepreneur view and partner view.
10. Return readable chat output and structured json.

## Decision discipline
Treat these as leading decision criteria:
- financing purpose
- repayment capacity
- collateral quality
- evidence quality
- structure feasibility

Treat these as relevant but not leading:
- amount requested
- urgency
- company age
- sector
- seasonality

Do not let a non-leading factor override a strong financing fit unless it creates a real feasibility issue.

## Product universe
Only consider relevant products from this set:
- revolving credit or working-capital line
- business term loan
- commercial real-estate finance
- equipment lease
- financial lease
- factoring
- receivables finance
- bridge financing
- subordinated loan
- sale-and-lease-back

Build a shortlist based on purpose, evidence, collateral, and structure feasibility.

## Recommendation rules
Always determine:
- best product
- best alternative
- best justified product mix if a mix is materially better than a single product
- indicative tenor, repayment logic, collateral logic, and key conditions when they can be inferred responsibly

If information is incomplete, do not pretend certainty. Downgrade confidence, identify missing evidence, and adjust the entrepreneur cta accordingly.

## Entrepreneur view
The entrepreneur view must be in clear Dutch and must include:
- short outcome summary
- strongest points in the case
- weakest points or lender concerns
- financeability score from 1 to 10
- submission readiness score from 1 to 10
- one cta status
- minimum to-do list
- optimal to-do list

Use these cta statuses only:
- `ready_to_submit`
- `ready_to_submit_with_evidence_boosters`
- `not_ready_missing_evidence`
- `not_ready_restructure_case`
- `not_financeable_with_external_debt_now`

Meaning of cta statuses:
- `ready_to_submit`: case is sufficiently evidenced and appears externally financeable in current form.
- `ready_to_submit_with_evidence_boosters`: case is submittable now, but additional evidence would improve placement quality or success odds.
- `not_ready_missing_evidence`: case may be financeable, but current evidence is too incomplete for responsible submission.
- `not_ready_restructure_case`: current form is weak, but a better amount, tenor, product, collateral package, or product mix may create a workable case.
- `not_financeable_with_external_debt_now`: current case is not suitable for external debt in a responsible structure.

For to-do lists, always separate:
- minimum required next steps
- optimal strengthening steps

## Partner view
The partner view must remain practical and structured. Include:
- recommended product
- alternative product
- recommended product mix if applicable
- rationale
- key risks
- evidence gaps
- indicative structure
- recommendation status using `strong`, `provisional`, or `weak`
- product scores for shortlisted products:
  - `product_fit_score`
  - `evidence_strength_score`
  - `structurability_score`

## Language directive
All free-text fields in both views — `summary`, `strengths[]`, `weaknesses[]`,
`rationale[]`, `key_risks[]`, `evidence_gaps[]`, `todo_minimum[]`,
`todo_optimal[]`, `notes[]`, `repayment_logic`, `collateral_logic`, and any
narrative chat output — MUST be written in clear Dutch (NL-NL). Do not
translate the enum values: `cta_status`, `recommendation_status`, and
`product_name` stay in their controlled English form so the adapter and the
central gate can match them. Currency notation should follow Dutch
convention (`€ 200.000`).

## Output requirements
### Chat output
Default structure:
1. ondernemer samenvatting
2. sterke punten
3. aandachtspunten vanuit financier
4. scores
5. cta
6. to-do minimum
7. to-do optimaal
8. partneradvies samenvatting

### JSON output
Always return a top-level JSON object with this shape:

```json
{
  "entrepreneur_view": {
    "summary": "",
    "strengths": [],
    "weaknesses": [],
    "financeability_score": 0,
    "submission_readiness_score": 0,
    "cta_status": "",
    "todo_minimum": [],
    "todo_optimal": []
  },
  "partner_view": {
    "recommended_product": "",
    "alternative_product": "",
    "recommended_product_mix": [],
    "recommendation_status": "",
    "rationale": [],
    "key_risks": [],
    "evidence_gaps": [],
    "indicative_structure": {
      "amount": null,
      "tenor_months": null,
      "repayment_logic": "",
      "collateral_logic": "",
      "conditions": []
    },
    "shortlisted_products": [
      {
        "product_name": "",
        "product_fit_score": 0,
        "evidence_strength_score": 0,
        "structurability_score": 0,
        "notes": []
      }
    ]
  }
}
```

If a field cannot be determined responsibly, use `null` or an empty list and explain why in the narrative.

## Quality bar
Before finalizing, check:
- entrepreneur and partner outputs must not contradict each other
- scores must align with cta status
- missing evidence must appear both in the narrative and the json
- product mix must only be proposed when it is materially better than a single-product structure
- entrepreneur language must be plain, concrete, and action-oriented

---

## Repo integration notes (Geenbank Hub)

> The section above is the verbatim ChatGPT skill instruction text imported
> from the project owner's skill archive. The notes below are repo-specific
> and must not be sent to the model — they describe how this skill maps onto
> the existing adapter in this codebase.

### Adapter binding

* SKILL_MODULE: `FinancingProductAdvisorDualView`
* Adapter: `artifacts/api-server/src/lib/skills/financing-product-advisor-dual-view.ts`
* Companion files in this folder:
  * `agents/openai.yaml` — interface + policy declaration from ChatGPT.
  * `references/api_reference.md` — placeholder reference content (kept for
    parity with the upstream archive; not used at runtime).
  * `references/output-notes.md` — short note that the entrepreneur cta and
    the partner recommendation must agree.
* Status: **mock-mode**. Live OpenAI invocation is not wired and is not
  implied by the presence of this skill pack. The runtime resolver in
  `artifacts/api-server/src/lib/skills/runtime.ts` continues to fall back to
  mock when no AI env vars are configured.

### Hard rules

* No API keys, OAuth tokens, or assistant ids in this folder.
* No live OpenAI calls until the adapter's `instrumentSkill` callback is
  rewritten to use the runtime resolver — that change is **not** in this
  task.
* When a real call is added, the response JSON must be validated against the
  shape above before any field is persisted to `ai_analysis_runs`.

### Adapter input that must be sent to the skill

The adapter currently reads only the financial summary fields off the
dossier. When real invocation is wired the request payload should be the
adapter input below — extended with whatever document evidence the
orchestrator already has access to.

```jsonc
{
  "dossier": {
    "annualRevenue": "number|null",
    "annualCost": "number|null",
    "annualProfit": "number|null",
    "requestedAmount": "number|null",
    "financingTypePreference": "string|null",
    "financingPurpose": "string|null",
    "companyDescription": "string|null"
  },
  "evidence": {
    "documents": [
      { "documentType": "string", "filename": "string", "validationStatus": "valid|invalid|pending" }
    ],
    "geenbankKredietworkflow": null
  }
}
```

### Output mapping (skill JSON → current adapter contract)

The skill returns a rich `entrepreneur_view` + `partner_view` payload. The
current `FinancingProductAdvisorDualViewOutput` is a small numeric summary
consumed by `GeenbankKredietworkflowAdapter` and the central gate. When real
invocation is wired, map the skill response onto the existing output contract
as follows — and persist the full skill JSON alongside it for the
*AI uitvoeringsdetails* panel.

| Skill field | Used as | Adapter field today | Notes |
| --- | --- | --- | --- |
| `entrepreneur_view.financeability_score` (1-10) | Primary signal | `viabilityScore` (0-100) | Multiply by 10, clamp via `pct()`. This score drives the central gate, so use temperature 0 + JSON mode upstream. |
| `entrepreneur_view.submission_readiness_score` (1-10) | Secondary signal | *(new — persist on `SkillInvocation.outputSummary`)* | Surface in the *AI uitvoeringsdetails* panel; do not mix into `viabilityScore`. |
| `entrepreneur_view.cta_status` | Gate hint | *(new — persist alongside)* | Already constrained to a fixed enum; safe to expose verbatim in the entrepreneur report. |
| `entrepreneur_view.summary` / `strengths` / `weaknesses` | Narrative | *(consumed by `GeenbankKredietworkflowAdapter`)* | Hand off to the workflow skill instead of duplicating in this adapter's output. |
| `entrepreneur_view.todo_minimum` / `todo_optimal` | Action items | *(consumed by `GeenbankKredietworkflowAdapter`)* | Map onto `entrepreneurReport.actionPoints`. |
| `partner_view.recommended_product` | Product label | *(new — persist alongside)* | Render in the financier-facing report, not in the entrepreneur view. |
| `partner_view.alternative_product` | Product label | *(new — persist alongside)* | Same as above. |
| `partner_view.recommended_product_mix` | Product list | *(new — persist alongside)* | Only when the skill itself decides a mix is materially better. |
| `partner_view.recommendation_status` (`strong`/`provisional`/`weak`) | Confidence | *(new — persist alongside)* | Display next to verdict in the officer view. |
| `partner_view.indicative_structure` | Structure proposal | *(new — persist alongside)* | Forwarded to `MoneycareKredietmemorandum` for the memorandum. |
| `partner_view.shortlisted_products[]` | Shortlist scores | *(new — persist alongside)* | Render as a small table in the *AI uitvoeringsdetails* panel. |
| `dossier.annualRevenue` (input echo) | Audit | `revenue` | Adapter passes through, not produced by skill. |
| `dossier.annualProfit` (input echo) | Audit | `profit` | Adapter passes through. |
| `dossier.requestedAmount` (input echo) | Audit | `requested` | Adapter passes through. |
| Derived (`profit / revenue`) | Margin | `margin` | Compute in adapter from the input, do not depend on the skill for it. |
| Derived (DSCR proxy) | DSCR | `dscr` | Same — derived in adapter so the gate stays stable even if the skill omits it. |

The adapter signature (`run(ctx) → SkillResult<FinancingProductAdvisorDualViewOutput>`)
must not change. Extra skill fields are persisted on
`SkillInvocation.outputSummary` and on the new "additional" payload that the
runtime already records — no orchestrator change needed.

### Recommended provider configuration (for later)

* Provider: `openai` (Assistant id, or Chat Completions with this SKILL.md as the system prompt).
* Required env when wiring live calls: `OPENAI_API_KEY`, optional `AI_SKILL_FINANCINGPRODUCTADVISORDUALVIEW_ASSISTANT_ID`, optional `AI_SKILL_FINANCINGPRODUCTADVISORDUALVIEW_MODEL`.
* Temperature: `0`, response format: JSON.
* On any non-JSON response or schema mismatch: throw — the runtime resolver will record `fallbackReason` and the orchestrator will fall back to the deterministic mock.
