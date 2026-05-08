# Geenbank Hub

A Dutch (NL) full-stack pilot product that converts Geenbank-disqualified
leads into AI-pre-validated financing dossiers ready for alternative
financiers. All UI copy is in Dutch.

## Architecture

- **Backend** — `artifacts/api-server` (Express 5 + Drizzle + Postgres)
- **Frontend** — `artifacts/geenbank-hub` (React + Vite + wouter + shadcn + Tailwind + Recharts)
- **Shared schema** — `lib/db` (Drizzle), `lib/api-spec` (OpenAPI), `lib/api-zod`, `lib/api-client-react` (generated Orval hooks)
- **Auth** — cookie sessions (`geenbank_session`) + bcryptjs password hashing
- **Database** — 9 entities: users, sessions, prospect_profiles, dossiers, documents, ai_analysis_runs, conditions, partner_financiers, partner_submissions, activity_logs

## AI pipeline

Five skill modules orchestrated server-side: `CreditProductAdvisor`,
`FinancingNeedAssessor`, `FinancingProductAdvisorDualView`,
`GeenbankKredietworkflow`, `MoneycareKredietmemorandum`. The pipeline runs
deterministically when no `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` is set, so
the product is fully functional out of the box.

## Integrations

Pipedrive and SendGrid use a mock-mode fallback when no credentials are
configured (calls are logged but not delivered). The `/api/integrations/status`
endpoint and admin page expose live/mock status for each integration.

## Demo accounts

All demo accounts use password `Welkom2025!`.

| Role | Email |
| --- | --- |
| Admin | `admin@geenbank.nl` |
| Loan officer | `maarten@geenbank.nl` |
| Prospect (active) | `anne@brouwerij-noord.nl` |
| Prospect (intake in progress) | `joris@nordhaven-cycles.nl` (forced password change) |
| Prospect (in review) | `fatima@studio-meridian.nl` |

Seed data is created automatically on first server start.

## User preferences

(none yet)
