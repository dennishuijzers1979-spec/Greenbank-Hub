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

## Pilot data cleanup

Two scripts in `scripts/src/` keep the database safe between demos and
the live pilot launch. Both gate destructive operations behind explicit
env-var confirmations and default to a dry-run summary.

### `pilot:cleanup` — clean up the loan-officer queue before going live

**Safe by default (fail-closed).** Only prospects with a `seed:*` source
marker (set by `seed.ts` / `ensureAuroraDemo`) or whose email is in the
hard-coded `KNOWN_SEED_EMAILS` list are eligible for deletion. Real,
unmarked prospects are preserved and listed in the plan so you can
review them.

Always preserved regardless of mode:

- every user with role `admin` or `loan_officer`,
- every record in `partner_financiers`,
- the Aurora Bakkerij happy-path demo (`demo@aurora-bakkerij.nl`),
  unless `--no-preserve-aurora` is passed,
- any extra email passed via `--preserve-email=foo@bar.nl`.

Deleting a prospect user cascades (via FK `onDelete: cascade`) to its
profile, dossier, documents, AI runs, conditions, partner submissions
and dossier-linked activity logs.

Commands:

```bash
# Dry-run — shows exactly what would be kept / deleted, deletes nothing.
pnpm --filter @workspace/scripts run pilot:cleanup:dry-run

# Apply (safe mode, marker-only) — requires CONFIRM_PILOT_CLEANUP=YES.
CONFIRM_PILOT_CLEANUP=YES pnpm --filter @workspace/scripts run pilot:cleanup

# Apply without keeping Aurora.
CONFIRM_PILOT_CLEANUP=YES \
  pnpm --filter @workspace/scripts run pilot:cleanup -- --no-preserve-aurora

# Also remove unmarked non-staff users (broad — use with care). Requires
# BOTH confirmations.
CONFIRM_PILOT_CLEANUP=YES CONFIRM_INCLUDE_UNMARKED=YES \
  pnpm --filter @workspace/scripts run pilot:cleanup -- --include-unmarked
```

Without the env vars, `--apply` refuses to delete. **Run this only
against the environment you intend to clean** — there is no undo.

### `demo:reset` — restore the deterministic demo dataset (dev/demo only)

Wipes user/partner/activity rows and re-runs `seedIfEmpty()` +
`ensureAuroraDemo()` so the database returns to the canonical demo
state (3 prospect demos + Aurora + 4 partners).

```bash
CONFIRM_DEMO_RESET=YES pnpm --filter @workspace/scripts run demo:reset
```

Refuses to run when `NODE_ENV=production` unless you also set
`ALLOW_PROD_DEMO_RESET=YES`. Intended for development and demo
environments — do not point at a live pilot database.

### Before going live — manual checklist

1. Run the dry-run, confirm exactly the records you expect.
2. Decide whether to keep Aurora as a sales/training reference.
3. Run `pilot:cleanup` against the pilot database with
   `CONFIRM_PILOT_CLEANUP=YES`.
4. Verify the loan-officer queue is empty (or contains only Aurora).
5. Rotate the demo passwords (admin + loan officer + Aurora prospect).
6. Disable the automatic seed by deploying with `NODE_ENV=production`
   and **without** `SEED_DEMO_DATA=1`.

## User preferences

(none yet)
