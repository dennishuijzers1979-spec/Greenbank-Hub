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
| AI skills (FinancingNeedAssessor, CreditProductAdvisor, FinancingProductAdvisorDualView, GeenbankKredietworkflow, MoneycareKredietmemorandum) | none of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `AI_API_KEY` set | any of those keys set |
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

Global default provider:

| Variable | Effect |
| --- | --- |
| `AI_SKILL_PROVIDER` | Force the default provider (`mock`, `openai`, `http`, `replit`). |
| `OPENAI_API_KEY` | Auto-detected; default provider becomes `openai`. |
| `ANTHROPIC_API_KEY` / `AI_API_KEY` | Auto-detected; default becomes `replit`. |
| `AI_SKILL_ENDPOINT` | Auto-detected; default becomes `http`. |
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
