# AI Skill Source Mapping

This document is the bridge between the **adapters in this repo** and the
**real ChatGPT Business "Vaardigheden"** that the project owner already
maintains. It exists so that we can move from deterministic mock-mode to
genuine LLM-backed skills **without** rewriting the runtime, leaking
secrets, or losing observability.

> **Status today:** all five adapters run in deterministic *mock mode*.
> Provider negotiation, fallback, and per-skill instrumentation are
> implemented (see `artifacts/api-server/src/lib/skills/runtime.ts`),
> but no callable LLM interface is wired yet.

## Conventions

* Every skill must keep returning the exact `SkillResult<T>` shape that
  the orchestrator already consumes
  (`artifacts/api-server/src/lib/skills/types.ts`). The real provider
  must be adapted *into* that shape, never the other way around.
* The runtime resolver decides per skill whether to call the real
  provider or fall back to mock — adapters never read env vars
  directly.
* No secret may live in the repo. Secrets are managed exclusively
  through Replit Secrets / `process.env`.
* Every real call must remain server-side. The browser must never
  receive an OpenAI key, assistant id, or raw skill instruction file.

## Connection methods (pick one per skill)

| Method | When to use | Required env (per skill) | Notes |
| --- | --- | --- | --- |
| **OpenAI Chat Completions / Responses API with exported skill instructions** | Skill instructions are short and stable; we want full control over prompt/version. | `OPENAI_API_KEY`, optional `AI_SKILL_<MODULE>_MODEL` | We load the SKILL.md content as the `system` message, then pass the adapter's structured input as the `user` message and parse JSON back. |
| **OpenAI Assistant / Agent ID** | Owner already maintains the skill in ChatGPT Business as an Assistant and wants to keep it editable in ChatGPT. | `OPENAI_API_KEY`, `AI_SKILL_<MODULE>_ASSISTANT_ID` | Adapter creates a thread per dossier run, posts structured input, polls until completed, parses JSON output. |
| **HTTP endpoint / webhook** | The skill lives behind a custom internal service (e.g. a private FastAPI proxy). | `AI_SKILL_<MODULE>_ENDPOINT`, optional bearer token in env | POST JSON in, JSON out. Easiest to mock in tests. |
| **Replit / local callable** | A future option if Replit exposes the skill as a first-class tool. | `ANTHROPIC_API_KEY` or `AI_API_KEY` | Currently treated as a placeholder by the runtime. |

The runtime already understands `mock | openai | http | replit` —
adding a new method means extending `resolveSkillRuntime` and writing
the actual call inside `instrumentSkill`'s callback in the relevant
adapter. The shape of the `SkillInvocation` record does not change.

## Per-skill mapping

For every skill below the columns mean:

* **Adapter** — the file that implements the adapter today.
* **Mock behaviour** — what the deterministic fallback computes, so we
  can A/B against the real skill.
* **Real source** — the ChatGPT Business "Vaardigheid" the owner
  already maintains.
* **Input schema** — the structured object the adapter produces / must
  send to the real skill.
* **Output schema** — the structured object the orchestrator expects
  back; the real skill must produce JSON that fits.
* **Missing runtime piece** — what is not yet implemented.
* **Recommended method** — the connection method that fits best.
* **Risks / validation** — what we should check before flipping the
  switch.

### 1. credit-product-advisor

| Field | Value |
| --- | --- |
| Adapter | `artifacts/api-server/src/lib/skills/credit-product-advisor.ts` |
| SKILL_MODULE | `CreditProductAdvisor` |
| Mock behaviour | Deterministic `correctnessScore` based on document validation status. |
| Real source | ChatGPT Skill **`credit-product-advisor`** (Vaardigheden). |
| Input schema | `{ documents: Document[]; dossier: { id, financingPurpose, requestedAmount, financingTypePreference, ... } }` |
| Output schema | `{ correctnessScore: number /* 0-100 */ }` |
| Missing runtime piece | Real LLM call inside the `instrumentSkill` callback. |
| Recommended method | OpenAI Assistant id (skill already curated in ChatGPT). |
| Required env | `OPENAI_API_KEY`, `AI_SKILL_CREDITPRODUCTADVISOR_ASSISTANT_ID`, optional `AI_SKILL_CREDITPRODUCTADVISOR_MODEL`. |
| Risks / validation | Score must stay numeric and bounded; clamp via existing `pct()` helper. Validate `correctnessScore` against the gate threshold before deploying. |

### 2. financing-need-assessor

| Field | Value |
| --- | --- |
| Adapter | `artifacts/api-server/src/lib/skills/financing-need-assessor.ts` |
| SKILL_MODULE | `FinancingNeedAssessor` |
| Mock behaviour | Computes `completenessScore`, `completedDocs`, `requiredDocs` from required document set + intake field count. |
| Real source | ChatGPT Skill **`financing-need-assessor`**. |
| Input schema | `{ documents: Document[]; dossier: Dossier }` |
| Output schema | `{ completenessScore: number; completedDocs: number; requiredDocs: number }` |
| Missing runtime piece | Real LLM call. |
| Recommended method | OpenAI Assistant id, fallback to Chat Completions with SKILL.md as system prompt. |
| Required env | `OPENAI_API_KEY`, `AI_SKILL_FINANCINGNEEDASSESSOR_ASSISTANT_ID`. |
| Risks / validation | `completedDocs ≤ requiredDocs`, both integers; `completenessScore` ∈ [0,100]. Gate test in `gate.test.ts` must keep passing. |

### 3. financing-product-advisor-dual-view

| Field | Value |
| --- | --- |
| Adapter | `artifacts/api-server/src/lib/skills/financing-product-advisor-dual-view.ts` |
| SKILL_MODULE | `FinancingProductAdvisorDualView` |
| Mock behaviour | Computes margin, DSCR, and a `viabilityScore` from revenue/cost/profit/requested amount. |
| Real source | ChatGPT Skill **`financing-product-advisor-dual-view`**. |
| Input schema | `{ revenue, cost, profit, requested, financingTypePreference, ... }` |
| Output schema | `{ viabilityScore, revenue, profit, requested, margin, dscr }` |
| Missing runtime piece | Real LLM call + JSON-mode parsing. |
| Recommended method | OpenAI Assistant id (skill is opinionated and prompt-tuned in ChatGPT). |
| Required env | `OPENAI_API_KEY`, `AI_SKILL_FINANCINGPRODUCTADVISORDUALVIEW_ASSISTANT_ID`. |
| Risks / validation | `viabilityScore` is read by `GeenbankKredietworkflow` and the central gate — must be deterministic enough to not flip verdicts on retry. Consider temperature 0. |

### 4. geenbank-kredietworkflow

| Field | Value |
| --- | --- |
| Adapter | `artifacts/api-server/src/lib/skills/geenbank-kredietworkflow.ts` |
| SKILL_MODULE | `GeenbankKredietworkflow` |
| Mock behaviour | Combines completeness/correctness/viability into a verdict + Dutch entrepreneur report (headline, summary, strong/weak/action points, likely financier asks, canSubmit). |
| Real source | ChatGPT Skill **`geenbank-kredietworkflow`** — the Dutch-language workflow that produces the entrepreneur-facing report. |
| Input schema | Full upstream scores + dossier + Dutch tone constraints. |
| Output schema | `{ confidenceScore, verdict, verdictSummary, entrepreneurReport: { headline, summary, strongPoints, weakPoints, actionPoints, likelyFinancierAsks, canSubmit }, strongPoints, weakPoints }` |
| Missing runtime piece | Real LLM call returning Dutch JSON. |
| Recommended method | OpenAI Assistant id — skill is large and tuned in ChatGPT. |
| Required env | `OPENAI_API_KEY`, `AI_SKILL_GEENBANKKREDIETWORKFLOW_ASSISTANT_ID`. |
| Risks / validation | Must produce **Dutch** UI strings (the FE renders them verbatim). `canSubmit` must respect `GATE_THRESHOLDS`. Add a unit assertion that the response is parseable JSON before persisting. |

### 5. moneycare-kredietmemorandum-fabriek

| Field | Value |
| --- | --- |
| Adapter | `artifacts/api-server/src/lib/skills/moneycare-kredietmemorandum.ts` (two entry points: `buildFinancierReport` and `buildMemorandum`) |
| SKILL_MODULE | `MoneycareKredietmemorandum` |
| Mock behaviour | Generates the financier-facing report and the multi-section memorandum from upstream signals. |
| Real source | ChatGPT Skill **`moneycare-kredietmemorandum-fabriek`**. |
| Input schema | `{ ctx, financierReport, verdict }` for memorandum; `{ ctx, margin, dscr, revenue, profit, requested, verdict, strongPoints, weakPoints }` for financier report. |
| Output schema | `FinancierReport` and `Memorandum` (see `types.ts`). |
| Missing runtime piece | Real LLM call returning structured Dutch JSON for both entry points. |
| Recommended method | OpenAI Assistant id with two threads (one per entry point) or a single skill that branches on input flag. |
| Required env | `OPENAI_API_KEY`, `AI_SKILL_MONEYCAREKREDIETMEMORANDUM_ASSISTANT_ID`. |
| Risks / validation | Output is shown to officers and exported as a memorandum — schema mismatch breaks the PDF and the *AI uitvoeringsdetails* panel. Validate against the OpenAPI `Memorandum` schema before persisting. |

## Cross-cutting risks

* **Dutch language** — every user-facing field must remain in Dutch.
  Add a smoke test that fails if the verdict / memorandum sections
  contain English filler.
* **Gate stability** — `viabilityScore` and `correctnessScore` directly
  drive the central gate. Use temperature 0 and JSON mode to keep
  retries stable.
* **Cost / latency** — real calls are 1-3 s each. The orchestrator
  runs five sequentially. Consider parallelising independent skills
  once we have telemetry (the `durationMs` field already exists in
  every `SkillInvocation`).
* **Secret hygiene** — `process.env` only; never log keys; never echo
  them into `SkillInvocation.inputSummary` or `outputSummary`. The
  existing `summarize()` helper truncates to 240 chars but does not
  scrub — adapters must redact before passing.
* **Mock fallback** — must keep working when `OPENAI_API_KEY` is unset
  so demo / test environments do not need real credentials. The
  `runtime.ts` resolver already records `fallbackReason` and falls
  back automatically.

## What the project owner needs to provide

For each ChatGPT skill, paste into the matching `skills/<name>/SKILL.md`:

1. The full skill instruction text (system prompt) exported from
   ChatGPT Business.
2. The exact JSON output contract the skill is configured to produce.
3. (Optional) The OpenAI Assistant id, if the skill is wired as an
   Assistant in the same ChatGPT workspace.

Once that material is in the repo, the next step is implementing the
real call inside `instrumentSkill` for each adapter, behind the
runtime resolver. No adapter signature has to change.
