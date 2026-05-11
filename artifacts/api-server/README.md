# @workspace/api-server — Geenbank Hub API

Express 5 + Drizzle ORM + PostgreSQL backend for the Geenbank Hub
financing-pre-validation flow.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm --filter @workspace/api-server dev` | Build + start the API (workflow target). |
| `pnpm --filter @workspace/api-server build` | Bundle to `dist/index.mjs`. |
| `pnpm --filter @workspace/api-server typecheck` | Type-check sources. |
| `pnpm --filter @workspace/api-server test` | Run backend gate integration tests. |

## Backend gate tests

The test suite (`src/__tests__/gate.test.ts`) protects the central
dossier gate (`checkRunAnalysisGate`) and the surfaces that depend on
it. Running the tests against the development PostgreSQL database is
safe — every case seeds rows under random IDs and cleans them up in
`after()`.

What the tests cover today:

- **Run-analysis gate** — a prospect cannot run the full AI analysis
  when:
  - required documents are missing,
  - any required document is still `validationStatus = "pending"`,
  - any required document is `validationStatus = "invalid"`,
  - one or more open `blocking` conditions exist on the dossier,
  - the latest run's `confidenceScore` is below
    `GATE_THRESHOLDS.confidence`,
  - the latest run's `viabilityScore` is below
    `GATE_THRESHOLDS.viability`.
- **Submit gate parity** — `/dossiers/me/submit` reuses
  `checkRunAnalysisGate` and returns the same structured 409
  payload as `/dossiers/me/run-analysis` (same key set, no drift).
- **Officer visibility** — `/dossiers` and `officerCanAccessDossier`
  only expose dossiers whose status is in
  `OFFICER_VISIBLE_STATUSES`. Pre-submission dossiers are hidden.
- **Document download authorisation** — `/api/documents/:id/content`
  rejects unrelated prospects and rejects officers when the parent
  dossier is still pre-submission, while authorising officers once the
  dossier is in the Geenbank workflow.

To run the suite:

```bash
pnpm --filter @workspace/api-server test
```

The runner is Node's built-in test runner (`node --test`) loaded
through `tsx` for TypeScript on-the-fly compilation. No additional
heavy test framework is required.

## Typed gate error payload

Both `/dossiers/me/run-analysis` and `/dossiers/me/submit` return the
same structured `409` payload when the central gate blocks the
request. The payload is documented in `lib/api-spec/openapi.yaml` as
the `GateBlockedError` schema and regenerates into:

- `lib/api-zod/src/generated/types/gateBlockedError.ts`
- `lib/api-client-react/src/generated/api.schemas.ts`

Frontend code consumes the typed shape via
`@workspace/api-client-react`'s `GateBlockedError` type — see
`artifacts/geenbank-hub/src/pages/dossier/index.tsx` for the typed
`extractGateError` helper.

## Mock-mode behaviour

The following integrations run in deterministic mock-mode unless the
relevant secret is provided. The status is also surfaced live in the
admin "Integraties" view via `aiSkillsStatus`, `pipedriveStatus`,
`sendgridStatus`, and `objectStorageStatus`.

| Subsystem | Mock-mode trigger | Live trigger |
| --- | --- | --- |
| AI skills (FinancingNeedAssessor, CreditProductAdvisor, FinancingProductAdvisorDualView, GeenbankKredietworkflow, MoneycareKredietmemorandum) | default — only the per-skill `AI_SKILL_<MODULE>_PROVIDER=openai` opts a single adapter into a live path | per-skill `AI_SKILL_<MODULE>_PROVIDER=openai` **plus** the matching credentials (e.g. `OPENAI_API_KEY`). Today only `FinancingProductAdvisorDualView` has a live OpenAI implementation; the other four ignore the live opt-in and continue to run deterministic mock code. |
| Pipedrive deal updates | `PIPEDRIVE_API_TOKEN` unset | `PIPEDRIVE_API_TOKEN` set |
| Outbound email (`sendEmail`) | `SENDGRID_API_KEY` unset | `SENDGRID_API_KEY` set |
| Document storage | neither `PUBLIC_OBJECT_SEARCH_PATHS` nor `PRIVATE_OBJECT_DIR` set | either set (App Storage) |

In mock-mode every call is logged through `pino` and skipped — no
external request is made. The skill modules return deterministic
sample output, which is enough to exercise the dossier gates and
report rendering end-to-end.

## AI skill invocation observability

Every AI skill call now flows through a single runtime resolver
(`src/lib/skills/runtime.ts`) that decides which provider to use
(`mock` | `openai` | `http` | `replit`) and produces a structured
`SkillInvocation` record. Records are:

- attached to the `SkillResult` returned by every adapter,
- persisted on the `ai_analysis_runs.skill_invocations` JSON column
  for both staged runs and memorandum runs,
- logged through `pino` (start + complete with provider, mock flag,
  duration, error),
- exposed to officers/admins on `GET /api/dossiers/:id/latest-run`
  (and surfaced in the dossier "AI Analyse" tab as
  *AI uitvoeringsdetails*),
- summarised on `GET /api/integrations/status` so the admin
  "Integraties" card shows per-skill provider/model + missing-env
  hints.

### Configuration

**Configured provider vs actual execution mode.** The runtime resolver
distinguishes the *configured* provider (what the env vars ask for) from
the *actual execution mode* recorded on each `SkillInvocation`. Setting
`OPENAI_API_KEY` does **not** by itself promote any skill to live —
that secret is only consumed when an adapter has been explicitly
opted in via its per-skill `AI_SKILL_<MODULE>_PROVIDER=openai`. This
keeps the AI uitvoeringsdetails panel and the admin Integraties card
honest: every row reports what truly ran (`Live OpenAI`,
`Fallback naar mock`, or `Deterministisch / mock`).

Global default provider:

| Variable | Effect |
| --- | --- |
| `AI_SKILL_PROVIDER` | Force the default provider for **all** skills (`mock`, `openai`, `http`, `replit`). Mostly useful for staging. Defaults to `mock`. |
| `OPENAI_API_KEY` | Credential consumed by adapters whose per-skill PROVIDER is `openai`. Presence alone does NOT change the default provider. |
| `ANTHROPIC_API_KEY` / `AI_API_KEY` | Credentials consumed by adapters whose per-skill PROVIDER is `replit`. Presence alone does NOT change the default provider. |
| `AI_SKILL_ENDPOINT` | Endpoint consumed by adapters whose per-skill PROVIDER is `http`. Presence alone does NOT change the default provider. |
| `OPENAI_MODEL`, `OPENAI_ASSISTANT_ID` | Default model / assistant for OpenAI. |

Per-skill overrides — replace `<MODULE>` with one of
`FINANCINGNEEDASSESSOR`, `CREDITPRODUCTADVISOR`,
`FINANCINGPRODUCTADVISORDUALVIEW`, `GEENBANKKREDIETWORKFLOW`,
`MONEYCAREKREDIETMEMORANDUM`:

| Variable | Purpose |
| --- | --- |
| `AI_SKILL_<MODULE>_PROVIDER` | Override provider for this skill only. |
| `AI_SKILL_<MODULE>_MODEL` | Override model name. |
| `AI_SKILL_<MODULE>_ENDPOINT` | Override HTTP endpoint (when provider=`http`). |
| `AI_SKILL_<MODULE>_ASSISTANT_ID` | Override OpenAI assistant id. |

If the requested provider is missing its key/endpoint, the resolver
records `fallbackReason` + `missingEnv` and silently falls back to
`mock` so the dossier flow keeps working. Secrets themselves are
never written to the DB or returned over the API — only the variable
*name* that is missing.

### Intended skill chain order

When the remaining adapters move from deterministic mock to live, the
orchestrator will call them in this order, threading a typed
`PipelineContext` (see `src/lib/skills/types.ts`) through the chain:

1. `GeenbankKredietworkflow` — produces the workflow analysis.
2. `FinancingNeedAssessor` — runs alongside the dual-view advisor,
   both consume the workflow output.
3. `FinancingProductAdvisorDualView` — produces entrepreneur + partner
   views; today the only adapter with a live OpenAI implementation.
4. `MoneycareKredietmemorandum` — consumes the previous three to build
   the financier-facing memorandum.

`PipelineContext` is currently a types-only forward contract — adapters
are not yet wired to consume it, but new live adapters should accept it
to avoid further schema churn.

## Connecting real ChatGPT skills

The five adapters currently run in deterministic mock-mode. The plan
for moving to the real ChatGPT Business "Vaardigheden" lives in
[`docs/ai-skill-source-mapping.md`](../../docs/ai-skill-source-mapping.md),
and the per-skill instruction placeholders live under
[`skills/<skill-name>/SKILL.md`](../../skills) at the repo root.

To go from mock to real for a single skill (worked example: the
financing-need assessor):

1. Open ChatGPT Business → *Vaardigheden* → `financing-need-assessor`
   and copy the full instruction text + JSON output contract.
2. Paste both into `skills/financing-need-assessor/SKILL.md` below the
   marker line (no API keys, no secrets).
3. In Replit *Secrets* set:
   * `OPENAI_API_KEY` (global, shared across all real skills), and
   * `AI_SKILL_FINANCINGNEEDASSESSOR_ASSISTANT_ID` (or
     `AI_SKILL_FINANCINGNEEDASSESSOR_PROVIDER=openai` plus the model
     of your choice).
4. Implement the real call inside the existing
   `instrumentSkill(MODULE, ctx, …)` callback in the adapter — keep
   the function signature and the returned `data`/`outputSummary`
   shape unchanged so the orchestrator and the *AI uitvoeringsdetails*
   panel keep working.
5. Reload the workspace, open a dossier, and confirm under *AI
   Analyse → AI uitvoeringsdetails* that the row for this skill now
   shows provider `openai (live)` instead of `mock (live)`. The admin
   *Integraties* card shows the same per-skill breakdown.

To roll back safely: remove the relevant env var. The runtime
resolver will fall back to `mock` automatically and record the reason
in every persisted `SkillInvocation`. No code change required.

Use `node scripts/check-skill-packs.mjs` to verify that all five
skill folders exist, no plain-text secrets slipped into a SKILL.md,
and the runtime still defaults to mock when no AI env vars are set.

### Imported skill packs

The real ChatGPT skill pack for **`financing-product-advisor-dual-view`**
has been imported under
[`skills/financing-product-advisor-dual-view/`](../../skills/financing-product-advisor-dual-view)
(SKILL.md + `agents/openai.yaml` + `references/`). The pack is ready for
the mapping / live-connection work described in
[`docs/ai-skill-source-mapping.md`](../../docs/ai-skill-source-mapping.md):

* **Live invocation is not enabled.** The adapter
  (`artifacts/api-server/src/lib/skills/financing-product-advisor-dual-view.ts`)
  still runs the deterministic mock and continues to drive the central
  gate via `viabilityScore`.
* No `OPENAI_API_KEY` or assistant id is required to run the app today.
* When live invocation is wired, the *AI Analyse → AI uitvoeringsdetails*
  panel and the admin *Integraties* card will switch the row for this
  skill from `mock (live)` to `openai (live)`. Until then both surfaces
  keep showing `mock (live)` and the `SkillInvocation.fallbackReason`
  field documents why.

The skill packs for the other four adapters (`credit-product-advisor`,
`financing-need-assessor`, `geenbank-kredietworkflow`,
`moneycare-kredietmemorandum-fabriek`) remain placeholders awaiting their
own archive imports.

### Live OpenAI pilot — financing-product-advisor-dual-view only

The `FinancingProductAdvisorDualView` adapter is the **only** adapter that
can currently invoke OpenAI live. All four other adapters keep running in
deterministic mock mode regardless of env vars.

#### Required Replit Secrets to enable the pilot

| Secret | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Standard OpenAI API key (begins with `sk-…`). |
| `AI_SKILL_FINANCINGPRODUCTADVISORDUALVIEW_PROVIDER=openai` | Per-skill opt-in. **Required** — the adapter stays on mock without it, even if the API key is set. |
| `OPENAI_MODEL` *(optional)* | Override the model. Defaults to `gpt-4o-mini`. Per-skill override `AI_SKILL_FINANCINGPRODUCTADVISORDUALVIEW_MODEL` also accepted. |

Notes:

* **No Assistant ID is required** for this path. The adapter uses the
  Chat Completions API with the imported `skills/financing-product-advisor-dual-view/SKILL.md`
  as the `system` message and the dossier payload as the `user` message,
  in JSON mode at temperature 0.
* The adapter never calls a ChatGPT UI skill URL directly — those
  endpoints are not API endpoints.
* The OpenAI key is only ever read from `process.env`. It is never
  written to logs, the database, or the `SkillInvocation` record. The
  adapter additionally scrubs `sk-…` patterns and `api_key` /
  `authorization` keys from the structured `extras` payload before
  persisting.

#### Confirming live vs mock

After enabling the pilot, open any dossier under *AI Analyse →
AI uitvoeringsdetails*. The row for `FinancingProductAdvisorDualView`
shows:

* `provider`: `openai` when the live call succeeded, `openai` (with
  `usedMockMode=true` and a `fallbackReason`) when OpenAI was attempted
  and failed, `mock` when the per-skill provider env was not set.
* `usedMockMode`: `false` only when the live call succeeded.
* `model`: the OpenAI model that responded.
* `durationMs`: end-to-end latency including the network call.
* `fallbackReason`: a Dutch explanation when the live call was
  attempted but failed (missing key, non-JSON response, schema
  mismatch).

The admin **Integraties** card shows the same per-skill breakdown, so an
administrator can confirm at a glance that the four other adapters are
still on mock.

#### Rollback

Remove either env var to fully restore mock mode for this adapter:

* unset `AI_SKILL_FINANCINGPRODUCTADVISORDUALVIEW_PROVIDER`, or
* unset `OPENAI_API_KEY`.

No code change required. The next dossier run will record
`provider=mock`, `usedMockMode=true`, `fallbackReason=null` for the
dual-view skill, and the central gate will continue to use the
deterministic mock viability score.

#### Failure handling

The dual-view adapter is the only adapter that drives `viabilityScore`,
which feeds the central gate. To keep the gate stable:

* `revenue`, `profit`, `requested`, `margin`, and `dscr` are always
  derived in-process from the dossier, never from the live skill
  response.
* If OpenAI returns invalid JSON, an unexpected schema, an
  out-of-range `financeability_score`, or any HTTP error, the adapter
  falls back to the deterministic mock `viabilityScore`, marks
  `usedMockMode=true`, and records the failure in `fallbackReason` —
  the AI pipeline does not crash.
* The full live skill response (when valid) is preserved on
  `SkillInvocation.extras` for the *AI uitvoeringsdetails* panel and
  for use by the financier-facing report later.

### Internal product advice — `GET /dossiers/:id/dual-view-advice`

Loan officers and admins can request a typed extract of the latest
`FinancingProductAdvisorDualView` invocation:

```
GET /api/dossiers/:dossierId/dual-view-advice    # loan_officer | admin
```

The response is the `DualViewAdvice` schema in
`lib/api-spec/openapi.yaml` (regenerated into `@workspace/api-zod` and
`@workspace/api-client-react`). Key fields:

* `executionMode` — `live_openai`, `deterministic_mock`, or
  `fallback_mock` (live attempted, fell back to mock — see
  `fallbackReason`).
* `partnerView` — recommended product, alternative, mix, status,
  rationale, key risks, evidence gaps, indicative structure, and a
  shortlist with fit / evidence / structurability scores.
* `entrepreneurSummary` — minimal summary fields (financeability,
  submission readiness, CTA status). The entrepreneur-facing detail
  view is still owned by the prospect dossier surface.
* `partial` + `warnings[]` — Dutch warnings for empty partner views,
  missing indicative structure, or mock-mode usage.

The endpoint never exposes prompts, request bodies, API keys, or
authorization headers. The extractor in
`src/lib/skills/dual-view-advice.ts` only copies a fixed allow-list of
fields out of `SkillInvocation.extras.response`, and any string that
still matches an `sk-…` or `Bearer …` pattern is dropped — covered by
`extractDualViewAdvice scrubs strings that look like API keys` and
`GET /dossiers/:id/dual-view-advice does not leak secrets in the response`
in the test suite.

The Geenbank Hub dossier review surface
(`artifacts/geenbank-hub/src/pages/dossiers/[id].tsx`) calls this
endpoint via the generated `useGetDualViewAdvice` hook and renders the
result as the *Financier productadvies (intern)* card on the AI
analyse tab — visible to loan officers and admins only, hidden from
the prospect dossier UI.
