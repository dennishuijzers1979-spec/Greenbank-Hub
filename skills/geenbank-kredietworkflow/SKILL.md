---
name: geenbank-kredietworkflow
description: orchestrate geenbank credit cases end to end from source documents to risk analysis, requested-structure feasibility testing, indicative term sheet, pricing selection, alternative risk-controlled structure design, credit committee review, and executive summary. use when the user provides financial documents such as annual accounts, bank transactions, trial balance, liquidity forecast, collateral files, debtor aging, pdf/docx/xml/excel files, or a pricing matrix / tarievenlijst and wants one consistent kredietdossier with calculations, product- and collateral-based pricing, requested-vs-recommended structure analysis, go/conditional go/no go advice, covenants, and committee-ready outputs.
---

# Geenbank kredietworkflow

Execute one integrated credit workflow. Treat prior standalone roles as stages inside one pipeline:
1. anna risk -> build the analytical base case
2. term sheet -> convert the feasible structure into commercial terms
3. kevin credit -> independently validate, stress test, and policy-check
4. proposal / executive summary -> produce the final committee-ready memo

Use the bundled references to keep definitions, thresholds, pricing rules, output order, and decision logic consistent across all outputs.

## Core operating rules

- Use one canonical case data model. Every amount, tenor, rate, collateral item, covenant, and decision must come from that shared model. Do not let the risk memo, term sheet, validation memo, and executive summary drift apart.
- The canonical model must store both:
  - the **requested structure** from the user
  - the **recommended structure** after underwriting and risk controls
- Validate document readability first. If a file is corrupted, unreadable, badly scanned, or clearly incomplete, say so immediately.
- Accept the most common case file types: pdf, docx, xml, xls, xlsx, csv, json.
- If a liquidity forecast is missing, build one from available statements, bank flows, seasonality, and working capital movements. Mark the forecast as modeled and list the assumptions explicitly.
- Never hide assumptions. Highlight all modeled fields, inferred values, and missing data.
- When sources conflict, use this precedence order unless the user specifies otherwise:
  1. most recent signed primary financial source
  2. current trial balance
  3. structured bank transaction data
  4. management-provided schedules
  5. modeled assumptions
- Run a consistency check before finalizing:
  - requested facility, recommended facility, tenor, rate, amortization, fees
  - collateral package and ranking
  - DSCR / solvency / LTV values
  - covenant thresholds
  - go / conditional go / no go outcome
- Keep the writing compact, factual, and committee-oriented. Use tables and bullets instead of narrative wherever possible.
- Use the pricing matrix rules in [references/pricing-matrix.md](references/pricing-matrix.md). If the user provides a tarievenlijst in the current chat, use that as the live pricing source; otherwise use the bundled default asset [assets/tarieven-lijst-geenbank.xlsx](assets/tarieven-lijst-geenbank.xlsx).
- Treat pricing bands as minimum starting rates. Do not quote below the applicable floor unless the user explicitly requests an exception and the exception is highlighted.

## Required minimum intake

Use [references/input-schema.md](references/input-schema.md).

Minimum required for a real case:
- most recent annual accounts
- bank transactions in csv, xml, xls/xlsx, or pdf
- current trial balance
- requested credit type
- requested amount or limit
- requested interest rate

Optional but strongly preferred:
- requested tenor
- requested repayment profile
- liquidity forecast
- debtor aging
- collateral documentation

If a mandatory item is missing, stop and request it.
If the liquidity forecast is missing, do not stop; model it and continue.

## Workflow

### Step 1 - intake and dossier control
Create a short intake table:
- file name
- file type
- business purpose
- date period covered
- usable yes/no
- issues or missing sections

Then state:
- what is missing
- what was modeled
- confidence level: high / medium / low

### Step 2 - build the canonical case model
Normalize and store at least these fields:
- borrower identity
- requested structure
- recommended structure
- facility type
- requested and proposed amount
- requested and proposed pricing
- requested and proposed tenor
- repayment structure
- purpose
- existing debt
- historical revenue / EBITDA / cash flow
- current liquidity
- working capital metrics
- collateral inventory
- legal ranking and enforceability notes
- covenant proposal
- feasibility conclusion
- decision recommendation

### Step 3 - requested structure capture and feasibility test
Use [references/acceptatiecriteria.md](references/acceptatiecriteria.md).

Always capture the user-requested structure first:
- requested product
- requested amount / limit
- requested interest rate
- requested tenor if known
- requested repayment profile if known
- stated use of proceeds

Then test whether the requested structure is:
- haalbaar zoals aangevraagd
- haalbaar onder voorwaarden
- niet haalbaar zoals aangevraagd

Minimum feasibility tests:
- repayment capacity / DSCR
- collateral coverage / borrowing base / availability
- product fit against collateral and use case
- pricing fit against the matrix floor
- concentration and volatility risk
- legal and documentary sufficiency

### Step 4 - anna risk stage
Use [references/acceptatiecriteria.md](references/acceptatiecriteria.md) and [references/output-specs.md](references/output-specs.md).

Produce:
- base financial analysis
- bank flow analysis
- liquidity analysis
- modeled forecast if needed
- collateral and coverage analysis
- key risks, mitigants, and assumptions

Always include:
- DSCR
- solvency
- net working capital
- LTV or collateral coverage where relevant
- concentration flags
- stress case: revenue down 20% and impact on DSCR/covenants

### Step 5 - pricing and term sheet stage
After the canonical case model is stable, determine the realistic product structure and pricing using [references/pricing-matrix.md](references/pricing-matrix.md).

Mandatory pricing workflow:
- identify the collateral-backed product or product mix that actually fits the case
- map each product component to the relevant pricing band
- test the requested rate against the applicable floor and risk profile
- if the requested rate is not supportable, state why
- select a realistic recommended rate at or above the applicable minimum
- if multiple products are used, calculate a weighted grand total rate for the full structure
- carry the exact same pricing into the term sheet, executive summary, rendement section, and recommendation

Produce an indicative term sheet only after this pricing step is complete.

Term sheet must include only:
- requested structure summary
- recommended structure summary
- facility type
- purpose
- principal / limit
- rate and any weighted grand total if multiple products apply
- fees
- tenor
- amortization or revolving mechanics
- collateral package
- covenant package
- monitoring cadence
- conditions precedent
- events of default
- disclaimer that final approval remains subject to credit committee approval

Use internal precedent structure from the references. Keep commercial language clean and externally usable.

### Step 6 - alternative structure stage
If the requested structure is not feasible as requested, or if a safer structure is materially better, design one recommended alternative.

An alternative may adjust:
- product mix
- amount / limit
- rate
- tenor
- amortization
- initial availability
- collateral package
- draw restrictions
- cash dominion / cash sweep
- reporting or covenant package
- conditions precedent

Never present the alternative as optional fluff. If it is better than the requested structure, explain exactly why.

### Step 7 - kevin credit stage
Apply an independent review against source documents and prior outputs.

Mandatory checks:
- recalculate DSCR, LTV, solvency
- verify that proposed collateral is actually evidenced
- compare market value versus forced-sale / net realizable value where relevant
- verify policy gates and explicitly justify any exceptions
- log mismatches between source docs, analysis, term sheet, requested structure, recommended structure, and final memo
- assign go / conditional go / no go

When a case is weak but repairable, prefer conditional go over false certainty. Conditions must be specific and testable.

### Step 8 - executive summary / committee memo stage
Produce the final committee-ready memo as a .docx document following the exact report structure and headings defined in [references/output-specs.md](references/output-specs.md), including the mandatory `Product- en prijsopbouw` section, and using the bundled asset [assets/executive-summary-template.docx](assets/executive-summary-template.docx) as the layout/model reference.

The uploaded template contains example content, but the heading structure is authoritative. Recreate that report type for each case: same section order, same committee-style framing, same signature/annex pattern, but with case-specific content from the canonical case model and source evidence.

The final memo must summarize, not reinvent, the prior work. It should be possible to trace every conclusion back to the canonical case model and source evidence.

## Decision logic

Use [references/acceptatiecriteria.md](references/acceptatiecriteria.md).

### Base decision framing
- **go**: requested structure is supportable or the recommended structure is supportable with only routine conditions
- **conditional go**: transaction is supportable only if specific conditions precedent, collateral perfection, reporting covenants, pricing adjustments, or draw restrictions are implemented
- **no go**: requested and recommended structures are not supportable because repayment capacity, collateral/enforceability, data quality, or policy breaches are too material to cure

### Required policy gates to test every time
- requested structure completeness
- DSCR threshold and DSCR stress result
- collateral coverage / LTV / advance rate logic
- solvency and net working capital trend
- document completeness and legal enforceability
- concentration limits
- liquidity / funding mismatch
- requested rate versus pricing floor

### Exception handling
If a case falls outside a threshold but is still supportable, you must:
1. name the failed threshold
2. quantify the gap
3. propose the mitigant
4. state whether the mitigant is pre-funding or post-funding
5. explain why the residual risk is still acceptable

## Docx typography standard
- For every human-facing `.docx` output, set the default body typography to **Poppins 10 pt**.
- Apply Poppins 10 pt consistently to paragraphs, table body text, and standard list text unless a stricter user instruction overrides it.
- If a bundled or user-provided template contains fixed branding or locked header/footer elements, preserve those template elements, but keep all editable human-facing body content in Poppins 10 pt.

## Output set

Generate these outputs unless the user asks for only one component:
1. risk analysis memo
2. indicative term sheet
3. kevin credit validation memo / committee advice
4. executive summary / committee report in .docx based on the template structure
5. structured json summary of requested structure, recommended structure, key facts, metrics, assumptions, exceptions, feasibility result, and decision

## Quality bar

Before finalizing, verify all of the following:
- no amount, tenor, rate, or covenant contradictions across outputs
- requested structure, recommended structure, and final committee advice are explicitly distinguished
- all calculations trace back to source data or explicit assumptions
- all missing data is marked
- all policy breaches are either cured by conditions or lead to no go
- tone is compact, factual, and decision-ready

## References

- input requirements: [references/input-schema.md](references/input-schema.md)
- acceptance criteria and inferred policy gates: [references/acceptatiecriteria.md](references/acceptatiecriteria.md)
- output formats: [references/output-specs.md](references/output-specs.md)
- pricing matrix: [references/pricing-matrix.md](references/pricing-matrix.md)
- executive summary template asset: [assets/executive-summary-template.docx](assets/executive-summary-template.docx)
- project-level instruction draft: [references/project-instruction.md](references/project-instruction.md)

---

## Repo integration notes (forward-only — adapter still on mock)

These notes document how this skill pack maps onto the Geenbank Hub
adapter today. Importing this pack does **not** enable live OpenAI
invocation. The deterministic mock in
`artifacts/api-server/src/lib/skills/geenbank-kredietworkflow.ts`
remains the source of `GeenbankKredietworkflowOutput` for the dossier
gate and for the *AI uitvoeringsdetails* panel.

### Adapter binding

* SKILL_MODULE: `GeenbankKredietworkflow`
* Adapter: `artifacts/api-server/src/lib/skills/geenbank-kredietworkflow.ts`
* Forward-only schema validator (current adapter contract):
  `artifacts/api-server/src/lib/skills/geenbank-kredietworkflow-schema.ts`
* Connection method (recommended once wired): OpenAI Assistant id with
  this `SKILL.md` as system prompt and the bundled references attached.
* Live opt-in (NOT set today):
  `AI_SKILL_GEENBANKKREDIETWORKFLOW_PROVIDER=openai` plus
  `OPENAI_API_KEY`. Setting `OPENAI_API_KEY` alone does not promote
  this adapter — see the *honesty rule* in `runtime.ts`.

### Expected adapter input (forward-only; not yet sent today)

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
adapters (`FinancingNeedAssessor`, `CreditProductAdvisor`,
`FinancingProductAdvisorDualView`) move from mock to live, their typed
output is forwarded here so this skill can quote back the same
strengths / weaknesses / financier-facing structure instead of
re-reasoning them. Today the adapter sends `null` placeholders.

### Mapping mismatch with the prepared adapter schema

The imported skill produces a **financier / credit-committee** output set
(risk memo, term sheet, kevin-credit validation, executive `.docx`,
structured JSON with `decision: Go|Conditional Go|No Go`). The prepared
adapter schema (`geenbank-kredietworkflow-schema.ts` +
`GeenbankKredietworkflowOutput`) describes an **entrepreneur-facing**
self-service report (`verdict: kansrijk|voorwaardelijk|uitdagend`,
`entrepreneurReport.{headline,summary,canSubmit,...}`).

These contracts are functionally different products. The mismatch is
documented — not silently reconciled — per the *do not change the
adapter* rule.

| Imported skill JSON field | Prepared adapter schema field | Status |
| --- | --- | --- |
| `decision` (`Go` / `Conditional Go` / `No Go`) | `verdict` (`kansrijk` / `voorwaardelijk` / `uitdagend`) | **Mismatch** — different label set, different language. A future live wiring must translate (e.g. Go→kansrijk, Conditional Go→voorwaardelijk, No Go→uitdagend) and document the mapping. |
| `decision_rationale` | `verdictSummary` | Compatible after Dutch translation; entrepreneur-facing summary must stay in Dutch and remain non-technical. |
| `feasibility_assessment` (haalbaar / onder voorwaarden / niet haalbaar) | `entrepreneurReport.canSubmit` | Bridgeable: `canSubmit = (feasibility_assessment === "haalbaar zoals aangevraagd" && all gate thresholds met)`. The central gate stays the source of truth — see *Hard rules*. |
| `request_vs_recommendation_differences` | (no slot today) | Drop or summarise into `entrepreneurReport.actionPoints`. |
| `metrics` (DSCR, LTV, solvency) | (no slot today; lives on dual-view + need-assessor) | Forward to financier report; **do not** re-derive in the entrepreneur view. |
| `policy_breaches` / `mitigants` | `entrepreneurReport.weakPoints` / `entrepreneurReport.actionPoints` | Compatible after Dutch translation and stripping financier-only jargon. |
| `assumptions` / `missing_information` | `entrepreneurReport.likelyFinancierAsks` | Compatible — surface the financier asks the entrepreneur should resolve before submission. |
| `recommended_structure` (term sheet fields) | (not in entrepreneur-facing report) | Persist on `SkillInvocation.extras` for the *AI uitvoeringsdetails* panel and for downstream `MoneycareKredietmemorandum`. |
| `borrower` / `requested_structure` | (echo from dossier) | Pass-through. Do not let the live skill rewrite borrower identity. |
| `risk analysis memo` / `indicative term sheet` / `executive summary .docx` | (not consumed today) | Persist as separate `extras` artifacts; do not break the `SkillResult<T>` shape. |

### Canonical credit-analysis framing (landed)

This skill is now treated as the **canonical credit-analysis engine**
of the chain — not as an entrepreneur-view generator. The intended
internal flow is:

1. risk analysis        (anna-risk stage)
2. commercial proposal  (term sheet stage)
3. control / validation (kevin-credit stage)
4. credit report        (executive summary stage)

Applicant data + document ingestion happen inside the risk-analysis
stage. The entrepreneur view is **derived** from the same canonical
financier output, not independently invented.

To support that without changing the adapter runtime, two pure
artefacts ship alongside this SKILL.md:

* `artifacts/api-server/src/lib/skills/geenbank-kredietworkflow-financier-schema.ts`
  — `GeenbankKredietworkflowFinancierOutput` type +
  `validateGeenbankKredietworkflowFinancierJson()`. Models the
  imported financier shape (decision, decisionRationale,
  feasibilityAssessment, borrower, requestedStructure,
  recommendedStructure, riskAnalysis, commercialProposal,
  validationFindings, creditReport, termSheet, conditions, riskFlags,
  securities, pricingIndication, confidenceScore,
  creditWorkflowContext).
* `artifacts/api-server/src/lib/skills/geenbank-kredietworkflow-financier-mapper.ts`
  — pure `mapKredietworkflowFinancierOutputToAppAnalysis()`. Derives
  the entrepreneur-facing app analysis from the financier output:

  | Financier field | App field |
  | --- | --- |
  | `decision: "Go"` | `aiVerdict: "kansrijk"` |
  | `decision: "Conditional Go"` | `aiVerdict: "voorwaardelijk"` |
  | `decision: "No Go"` | `aiVerdict: "uitdagend"` |
  | `confidenceScore` | `confidenceScore` (clamped 0-100) |
  | `riskAnalysis.mitigants` | `entrepreneurReport.strongPoints` |
  | `riskAnalysis.keyRisks` ⊕ blocking conditions | `entrepreneurReport.weakPoints` |
  | blocking conditions ⊕ advisory conditions | `entrepreneurReport.actionPoints` |
  | `riskAnalysis.assumptions` ⊕ `commercialProposal.conditionsPrecedent` | `entrepreneurReport.likelyFinancierAsks` |
  | `decisionRationale` | `entrepreneurReport.summary` (prefixed with borrower name) |
  | derived | `entrepreneurReport.headline` (Dutch verdict copy) |
  | `decision === "Go" && no blockers && feasibility !== "niet haalbaar zoals aangevraagd"` | `entrepreneurReport.canSubmit` |

  The mapper returns the **canonical financier output untouched** in
  `mapped.canonical`. Callers MUST persist that on
  `SkillInvocation.extras` so loan-officer review,
  `FinancingProductAdvisorDualView` enrichment, and
  `MoneycareKredietmemorandum` can keep using the rich payload.

* `PipelineContext` in
  `artifacts/api-server/src/lib/skills/types.ts` now carries an
  optional `creditWorkflowEnrichment: PipelineCreditWorkflowEnrichment | null`
  slot — the chain hand-off documented under the *Mismatch* section
  above. Today it is `null` (adapter still on mock); the live wiring
  populates it from the canonical output.

These are schema + mapper + types + tests + docs only. The adapter
(`geenbank-kredietworkflow.ts`) still runs the deterministic mock,
the central gate (`GATE_THRESHOLDS`) still drives `canSubmit`,
`validateGeenbankKredietworkflowJson` still validates the mock
output, and no live OpenAI call is enabled.

### Forward-only steps to wire live invocation (NOT executed today)

1. Decide whether the adapter keeps its current entrepreneur-facing
   contract (translate live skill output down) or grows a second
   financier-facing contract (forward the live skill output up to
   `MoneycareKredietmemorandum` and the *Financier productadvies*
   card). Record the decision in `docs/ai-skill-source-mapping.md`.
2. Reuse the `instrumentSkill(MODULE, ctx, …)` callback pattern from
   `financing-product-advisor-dual-view.ts`. The deterministic mock
   path stays as the fallback so the central gate, prevalidation
   tests, and the *AI uitvoeringsdetails* panel keep working when the
   per-skill PROVIDER env is unset.
3. Load this `SKILL.md` (and only the references that are safe to
   ship as system context) as the OpenAI `system` message via
   `loadSkillMarkdown("geenbank-kredietworkflow")`. The bundled
   `.xlsx` / `.docx` assets are tools for the human/.docx output
   pipeline; they are **not** suitable as system text.
4. Send the structured input documented above as the `user` message
   in JSON mode at temperature 0.
5. Map the live skill JSON onto `GeenbankKredietworkflowOutput`
   following the table above. On any validation error, fall back to
   the deterministic mock and record `fallbackReason` — never throw
   out of `run`. Use a new validator (added alongside, not replacing,
   `validateGeenbankKredietworkflowJson`) for the financier-shape
   payload.
6. Promote the adapter to live behind the per-skill env opt-in
   `AI_SKILL_GEENBANKKREDIETWORKFLOW_PROVIDER=openai` (plus
   `OPENAI_API_KEY`). The global `AI_SKILL_PROVIDER` switch must keep
   defaulting every adapter to mock — see the honesty rule in
   `runtime.ts`.

### Hard rules

* No API keys or secrets in this file or in any imported reference /
  asset under `skills/geenbank-kredietworkflow/`.
* Output strict JSON for the entrepreneur-facing report — the
  orchestrator persists it to `ai_analysis_runs` and the FE depends on
  the schema in `geenbank-kredietworkflow-schema.ts`.
* All entrepreneur-facing strings rendered to the prospect dossier UI
  **must be Dutch (NL-NL)**. Internal financier outputs (term sheet,
  exec summary, validation memo) may stay in their imported language
  but must be persisted on `SkillInvocation.extras`, not in the
  entrepreneur report.
* Use **stable machine enums** for `verdict` (kansrijk /
  voorwaardelijk / uitdagend) and any future mapped `decision` field.
  Free text stays in dedicated `*Summary` / `*Report` slots.
* Never include personally identifying information of the contact
  person in the entrepreneur report unless it is already in the
  dossier.
* The central gate (`GATE_THRESHOLDS` in `types.ts`) remains the
  source of truth for `canSubmit` — if the live skill says the case
  is feasible while a threshold is unmet, the adapter MUST overwrite
  `canSubmit` to `false`.
* Do not hallucinate missing data — every modeled / inferred value
  must be marked, including in the eventual mapped Dutch entrepreneur
  output (`entrepreneurReport.weakPoints` / `likelyFinancierAsks`).
* Separate **blocking** findings (`policy_breaches` → adapter must
  flag `canSubmit=false` and surface in `weakPoints`) from
  **non-blocking** findings (`assumptions` / `missing_information` →
  surface in `actionPoints` / `likelyFinancierAsks`).
* Produce `creditWorkflowContext` payload for downstream skills
  (`MoneycareKredietmemorandum`, `FinancingProductAdvisorDualView`)
  via `SkillInvocation.extras`, even when this adapter is on mock.
