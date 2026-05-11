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

## Repo integration notes (live-capable, env-gated)

These notes document how this skill pack maps onto the Geenbank Hub
adapter. The adapter is **live-capable** behind a per-skill opt-in
(`AI_SKILL_GEENBANKKREDIETWORKFLOW_PROVIDER=openai` plus
`OPENAI_API_KEY`); see *Live OpenAI pilot (env-gated, landed)* further
down. Without the opt-in env, the deterministic mock in
`artifacts/api-server/src/lib/skills/geenbank-kredietworkflow.ts`
remains the source of `GeenbankKredietworkflowOutput`. In **both**
modes the central gate (`GATE_THRESHOLDS`) is the binding source of
truth for `canSubmit`, and the *AI uitvoeringsdetails* panel reflects
the actual provider/model/fallback state.

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

### Live OpenAI pilot (env-gated, landed)

This skill is now **live-capable** behind a per-skill opt-in. Live
execution only kicks in when **both**:

* `AI_SKILL_GEENBANKKREDIETWORKFLOW_PROVIDER=openai`
* `OPENAI_API_KEY` is present

Optional: `AI_SKILL_GEENBANKKREDIETWORKFLOW_MODEL` or `OPENAI_MODEL`
(defaults to `gpt-4o-mini`). Setting only `OPENAI_API_KEY` does **not**
auto-promote this skill — the honesty rule in `runtime.ts` keeps every
adapter on mock unless its per-skill PROVIDER env explicitly opts in.

The adapter (`artifacts/api-server/src/lib/skills/geenbank-kredietworkflow.ts`):

1. loads this `SKILL.md` as the system prompt;
2. sends a structured dossier payload (borrower, request, scores +
   `GATE_THRESHOLDS`, derived financials, evidence/document statuses)
   as the user message at `temperature=0`, `response_format=json_object`;
3. parses + validates the response with
   `validateGeenbankKredietworkflowFinancierJson()`;
4. on success: maps via `mapKredietworkflowFinancierOutputToAppAnalysis()`
   and persists `mapped.canonical` in `SkillInvocation.extras` (under
   `extras.canonical`) for loan-officer review, future dual-view
   enrichment, and future moneycare memorandum generation;
5. on **any** failure (invalid JSON, schema rejection, OpenAI error):
   records `fallbackReason`, falls back to the deterministic mock, and
   logs a structured warn line. The AI pipeline never crashes.

**Central gate stays binding.** After mapping, `entrepreneurReport.canSubmit`
is ANDed with the central gate (`completeness/correctness/viability >=
GATE_THRESHOLDS.*`). The LLM cannot promote `canSubmit` past the gate;
the orchestrator-level `checkRunAnalysisGate` remains the single source
of truth at submit time. The decision applied is recorded in
`extras.gateApplied` (`canSubmitFromMapper` vs `canSubmitAfterGate`).

The *AI uitvoeringsdetails* panel reflects this honestly:
* `Live OpenAI` when the live skill succeeded (provider=openai, no
  fallbackReason, model = real model name);
* `Fallback naar mock` when OpenAI was attempted but failed
  (provider=openai, fallbackReason populated, model=null);
* `Deterministisch / mock` when the env var is absent (provider=mock).

`OPENAI_API_KEY` itself is never persisted, never logged, and is
scrubbed defensively from `extras` / `inputSummary` / `outputSummary` /
`errorMessage` by `runtime.scrubSecrets`.

#### Pricing-rate output (numeric vs textual)

Every facility-structure node (`requestedStructure`,
`recommendedStructure`, `commercialProposal.structure`,
`termSheet.structure`) carries two pricing-rate slots:

* **`rate: number | null`** — use when an exact pricing percentage is
  known (e.g. `8.5` for 8,5%, or `0.069` if you express it as a
  decimal). MUST be a finite number or `null`. **Never** put textual
  pricing here.
* **`rateComment: string | null`** *(optional)* — use when only
  indicative or non-numeric pricing is known: ranges (`"8-10%"`),
  qualitative notes (`"marktconform"`, `"nader te bepalen"`), or any
  caveat that cannot be expressed as a single finite number. When you
  fill `rateComment`, set `rate: null`.

The live adapter normalizes common LLM shapes
(`normalizeKredietworkflowFinancierPayload` in
`geenbank-kredietworkflow-financier-schema.ts`) **before** schema
validation, so the following inputs are accepted without falling back
to mock:

| LLM rate value | Normalized result |
| --- | --- |
| `0.069`, `8.5` | `rate = 0.069` / `8.5`, `rateComment` unchanged |
| `"8.5%"`, `"8,5%"`, `"8.5 %"` | `rate = 8.5`, `rateComment` unchanged |
| `"0,069"`, `"0.069"` | `rate = 0.069`, `rateComment` unchanged |
| `"8-10%"`, `"8 - 10%"` | `rate = null`, `rateComment = "8-10%"` |
| `"marktconform"`, `"nader te bepalen"` | `rate = null`, `rateComment = "marktconform"` |
| `null`, `""` | `rate = null` |

The normalizer **never** produces `NaN` and **never** crashes the
pipeline. It only touches `rate` / `rateComment`; every other field
(facility type, amount, tenor, decision enum, etc.) is still validated
strictly. Genuinely malformed payloads still trigger the deterministic
mock fallback with a structured `fallbackReason`.

Pricing/rate has no effect on `entrepreneurReport.canSubmit` or on
`GATE_THRESHOLDS` — those remain driven exclusively by completeness /
correctness / viability scores and the central gate.

#### Risk-analysis summary (required, never empty)

The `riskAnalysis` block carries the credit-risk narrative that loan
officers and the entrepreneur view both depend on. Every live response
MUST satisfy the following contract:

* **`riskAnalysis.summary: string`** — **REQUIRED, non-empty**.
  * Concise Dutch (NL-NL) paragraph (typically 1-3 sentences).
  * Summarizes the **core credit risks** and the **mitigating
    measures** that justify the chosen `decision`
    (Go / Conditional Go / No Go).
  * If the analysis genuinely finds no material risks, the model
    MUST say so explicitly **and** explain why the risk profile is
    acceptable (e.g. ratios, stress-case headroom, collateral). It
    must NEVER emit a hollow placeholder like
    `"Geen risico's gevonden."` without justification, and it must
    NEVER use `null`, `""`, whitespace, or filler text.
* **`riskAnalysis.keyRisks: string[]`** — list of named risks (may
  be empty if there are none, but each entry must be a non-empty
  string).
* **`riskAnalysis.mitigants: string[]`** — list of mitigating
  measures (same rule).
* **`riskAnalysis.assumptions: string[]`** — list of underlying
  assumptions (same rule).
* **`riskAnalysis.stressCase: string | null`** *(optional)* —
  qualitative stress-test commentary.

The live adapter normalizes `riskAnalysis.summary` defensively
(`normalizeRiskAnalysisSummary` in
`geenbank-kredietworkflow-financier-schema.ts`), **before** schema
validation, with strict guardrails:

| LLM `riskAnalysis.summary` | Other risk fields | Normalized result |
| --- | --- | --- |
| non-empty string | any | unchanged (existing valid summary is never overwritten) |
| missing / `null` / `""` / whitespace | `keyRisks` and/or `mitigants` and/or `stressCase` and/or `assumptions` non-empty | derived Dutch summary built from those fields, e.g. `"Belangrijkste risico's: …. Mitigerende maatregelen: …. Stresstest: …. Aannames: …."` |
| missing / empty | every supporting field also empty | **left empty** → validator still rejects → adapter falls back to deterministic mock with `fallbackReason="Skill-antwoord ongeldig: riskAnalysis.summary is geen niet-lege string"` |

The normalizer **never invents risk content**: it only restates what
the model already provided in `keyRisks` / `mitigants` / `stressCase` /
`assumptions`. It never overwrites an existing valid summary, and it
never produces a generic "no risks found" sentence on its own.

`riskAnalysis.summary` has no effect on `entrepreneurReport.canSubmit`
or on `GATE_THRESHOLDS` — those remain driven exclusively by
completeness / correctness / viability scores and the central gate.

#### Risk-analysis metrics (required object, never omit)

The `riskAnalysis.metrics` block carries the quantitative credit
ratios that loan officers and the entrepreneur view both depend on.
Every live response MUST satisfy the following contract:

* **`riskAnalysis.metrics: { dscr, solvency, ltv, netWorkingCapital }`**
  — **REQUIRED object, MUST always be present**. The four keys are
  the canonical set; do not invent extra keys.
* **`metrics.dscr: number | null`** — Debt-Service-Coverage Ratio.
  Include the value when it is **known or directly derivable from
  the supplied input** (`derivedFinancials.dscr` is provided in the
  user payload). Otherwise emit `null`.
* **`metrics.solvency: number | null`** — equity / total assets.
  Include the value **only when supported by balance-sheet data** in
  the input (jaarrekening, intake). Otherwise emit `null`. **Do NOT
  fabricate** a solvency ratio when no balance-sheet data is
  available.
* **`metrics.ltv: number | null`** — Loan-To-Value. Include the value
  **only when collateral / asset valuation data is available** in the
  input. Otherwise emit `null`. **Do NOT fabricate** an LTV.
* **`metrics.netWorkingCapital: number | null`** — current assets –
  current liabilities (in EUR). Include the value **only when current
  assets and current liabilities are both available** in the input.
  Otherwise emit `null`. **Do NOT fabricate** working capital.

Hard rules:

* `metrics` MUST be an object literal — never `null`, never omitted.
* Every metric value MUST be a finite `number` or `null` — never
  `NaN`, never a string, never a range like `"30-40%"`, never
  qualitative text like `"sterk"`.
* Use `null` for unknown / unsupported metrics. Loan officers prefer
  an explicit "unknown" over an invented number.

The live adapter normalizes `riskAnalysis.metrics` defensively
(`normalizeRiskAnalysisMetrics` in
`geenbank-kredietworkflow-financier-schema.ts`), **before** schema
validation, with strict guardrails:

| Live `metrics.<field>` | Normalized result |
| --- | --- |
| finite `number` | unchanged (model value wins) |
| `null` | `null` |
| missing key | `null` (or for `dscr`: deterministic proxy from `derivedFinancials.dscr` when finite) |
| `"1.45"`, `"1,45"`, `"38%"`, `"0,38"`, `"38 %"` | numeric value with `%` and whitespace stripped, comma → dot. **No scale conversion** — `"38%"` parses to `38`, not `0.38`. |
| range string (`"30-40%"`), qualitative text, `NaN`, boolean, array, object | `null` |
| missing entire `metrics` object | replaced with `{ dscr, solvency: null, ltv: null, netWorkingCapital: null }` (with `dscr` backfilled from the deterministic proxy when finite, else `null`) |

The normalizer **never invents `solvency`, `ltv`, or
`netWorkingCapital`** — those stay `null` whenever the model did not
provide a parseable value, because the orchestrator does not have
authoritative balance-sheet / collateral data on hand. Only `dscr` is
backfilled from the deterministic proxy already computed by the
orchestrator. A valid model-supplied `dscr` is **never** overridden.

`riskAnalysis.metrics` has no effect on `entrepreneurReport.canSubmit`
or on `GATE_THRESHOLDS` — those remain driven exclusively by
completeness / correctness / viability scores and the central gate.

#### Commercial-proposal & term-sheet summary (required, never empty)

The `commercialProposal` and `termSheet` blocks share the same shape
(`validateCommercialProposal`) and both carry a required summary that
loan officers and the entrepreneur view depend on. Every live response
MUST satisfy the following contract on **both** nodes:

* **`commercialProposal.summary: string`** and
  **`termSheet.summary: string`** — **REQUIRED, non-empty**.
  * Concise Dutch (NL-NL) paragraph that restates the proposed
    facility (type, amount, rate / pricing caveat, tenor) plus the
    headline conditions (collateral, covenants, conditions precedent,
    events of default, fees, monitoring cadence) — i.e. the same
    information the structured fields carry, condensed for narrative
    use.
  * Must NEVER be `null`, `""`, whitespace, or filler text such as
    `"Geen commercieel voorstel beschikbaar"`.
* **`commercialProposal.collateralPackage`**,
  **`commercialProposal.covenantPackage`**,
  **`commercialProposal.conditionsPrecedent`**,
  **`commercialProposal.eventsOfDefault`** — string arrays (each
  entry must be a non-empty string when present). Same rules apply to
  `termSheet`.
* **`commercialProposal.fees`** and
  **`commercialProposal.monitoringCadence`** — optional strings.

The live adapter normalizes both summaries defensively
(`normalizeCommercialProposalSummary` in
`geenbank-kredietworkflow-financier-schema.ts`), **before** schema
validation, with strict guardrails:

| LLM `<node>.summary` | Other commercial-proposal fields | Normalized result |
| --- | --- | --- |
| non-empty string | any | unchanged (existing valid summary is never overwritten) |
| missing / `null` / `""` / whitespace | `structure.facilityType` and/or `structure.amount` and/or `structure.rate` (or `rateComment`) and/or `structure.tenor` and/or `collateralPackage` / `covenantPackage` / `conditionsPrecedent` / `eventsOfDefault` / `fees` / `monitoringCadence` non-empty | derived Dutch summary built from those fields, e.g. `"Voorgestelde structuur: Annuïteitenlening, EUR 250000, tegen 6.9%, over 60 mnd. Zekerheden: …. Convenanten: …. Condities precedent: …. Events of default: …. Fees: …. Monitoring: …."` |
| missing / empty | every supporting field also empty | **left empty** → validator still rejects → adapter falls back to deterministic mock with `fallbackReason="Skill-antwoord ongeldig: commercialProposal.summary is geen niet-lege string"` (or `termSheet.summary` for the term-sheet node) |

The normalizer is applied to **both** `commercialProposal` and
`termSheet` independently. It **never invents commercial content**: it
only restates what the model already provided in the structured fields.
It never overwrites an existing valid summary, and it never produces a
generic placeholder sentence on its own.

`commercialProposal.summary` and `termSheet.summary` have no effect on
`entrepreneurReport.canSubmit` or on `GATE_THRESHOLDS` — those remain
driven exclusively by completeness / correctness / viability scores
and the central gate.

#### Validation-findings arrays (always string-arrays, never objects)

The `validationFindings` block carries three list-shaped fields that
**must** be string-arrays in the canonical financier output:

* **`validationFindings.blockingFindings: string[]`** — required.
  Use `[]` when there are no blocking findings; never `null`, never a
  bare string, never an array of objects, never a nested structure.
  Each entry is one short Dutch sentence describing a single
  showstopper for the casus.
* **`validationFindings.advisoryFindings: string[]`** — required.
  Same rule: `[]` when there are none. Each entry is one short Dutch
  sentence describing an advisory (non-blocking) point that the loan
  officer should be aware of.
* **`validationFindings.consistencyIssues?: string[]`** — optional but
  if present **must** be a string-array (use `[]` when none). Same
  rule: no objects, no nulls, no bare strings.

`validationFindings.summary` remains required and must be a non-empty
Dutch string. It is **not** normalized — produce a real one-sentence
review of the case.

The live adapter normalizes the three array fields defensively before
schema validation (`normalizeValidationFindings` /
`coerceFindingsArray`):

| LLM `<arrayField>` | Normalized result |
| --- | --- |
| missing key / `undefined` / `null` | `[]` |
| `""` / whitespace-only string | `[]` |
| non-empty string `"X"` | `["X"]` |
| `string[]` | trimmed; empty entries dropped |
| `Array<string \| object>` mix | per-entry: non-empty string kept (trimmed); object with one of the recognized text fields (`description`, `finding`, `summary`, `issue`, `message`, `text`) carrying a non-empty string → that string; everything else dropped |
| any other shape (number, boolean, plain object, …) | `[]` |

The normalizer **never invents finding text**: an object without a
recognized text field is silently dropped rather than coerced into
placeholder text. It never overwrites a valid existing `string[]`
beyond trimming + dropping empty entries. It does not touch
`validationFindings.summary` or `validationFindings.recalculatedMetrics`,
so missing/empty `summary` still triggers the validator and the
adapter falls back to the deterministic mock with a structured
`fallbackReason`.

`validationFindings.blockingFindings` / `.advisoryFindings` /
`.consistencyIssues` have no effect on `entrepreneurReport.canSubmit`
or on `GATE_THRESHOLDS` — those remain driven exclusively by
completeness / correctness / viability scores and the central gate.

#### Credit-report headline (required, never empty)

`creditReport` is the executive committee memo and carries a
**required, non-empty** headline:

* **`creditReport.headline: string`** — REQUIRED, non-empty. Short,
  zakelijk, committee-style. When `decision` and `borrower.name` are
  available, the headline must summarise that existing information
  (e.g. `"Kredietvoorstel <borrower.name> — <decision>"`). It must
  never invent a new decision, risk, condition, amount, rate or other
  conclusion that is not already present elsewhere on the canonical
  payload.

`creditReport.summary` and `creditReport.sections` remain strictly
required and are **not** normalized — produce real Dutch content.

The live adapter normalizes `creditReport.headline` defensively
(`normalizeCreditReportHeadline`) before schema validation. Priority:

| LLM `creditReport.headline` | Other available evidence | Normalized headline |
| --- | --- | --- |
| non-empty string | any | unchanged (existing valid headline is never overwritten; only trimmed/clipped to 200 chars) |
| missing / `null` / `""` / whitespace | `borrower.name` AND a valid `decision` (`Go` / `Conditional Go` / `No Go`) | `"Kredietvoorstel <borrower.name> — <decision>"` |
| missing / empty | `borrower.name` only | `"Kredietvoorstel <borrower.name>"` |
| missing / empty | first non-empty `creditReport.sections[*].title` | that title (clipped to 140 chars) |
| missing / empty | non-empty `creditReport.summary` | first sentence of the summary (clipped) |
| missing / empty | non-empty top-level `decisionRationale` | first sentence of the rationale (clipped) |
| missing / empty | none of the above | **left empty** → validator still rejects → adapter falls back to deterministic mock with `fallbackReason="Skill-antwoord ongeldig: creditReport.headline is geen niet-lege string"` |

The normalizer **never invents committee content**: it only restates
evidence already present on the same canonical payload. It does not
touch `creditReport.summary`, `creditReport.sections` or
`creditReport.docxArtifactRef`, so genuinely missing executive content
still triggers the validator and the live adapter still falls back to
the deterministic mock with a structured `fallbackReason`.

`creditReport.headline` has no effect on `entrepreneurReport.canSubmit`
or on `GATE_THRESHOLDS` — those remain driven exclusively by
completeness / correctness / viability scores and the central gate.

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
  above. Today it is still `null` from the orchestrator step (the
  adapter persists the canonical output on `SkillInvocation.extras`
  instead); the next-step pipeline wiring will populate this slot from
  the canonical output so chained skills can consume it without
  re-parsing.

The schema + mapper + types + tests + docs are forward-only and the
entrepreneur-facing validator (`validateGeenbankKredietworkflowJson`)
still validates the mock-shape output. The adapter itself is now
**live-capable** when its per-skill env opt-in is present (see *Live
OpenAI pilot* above). Without the opt-in it runs the deterministic
mock; in either mode the central gate (`GATE_THRESHOLDS`) drives the
final `canSubmit`.

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
