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
