# Geenbank Hub — pilot deployment guide

This document covers everything needed to take the cleaned pilot DB live on
Replit, plus the smoke tests, integration status, rollback procedure and
known limitations. It assumes you have already run
`pilot:cleanup --include-unmarked` against the pilot database.

## 1. Cleaned DB state (baseline)

After the broad cleanup the database contains:

| Group | Count |
| --- | --- |
| Admin users | 1 |
| Loan officers | 20 |
| Prospect users | 1 (`demo@aurora-bakkerij.nl`) |
| Dossiers | 1 (Aurora Bakkerij B.V. — happy-path demo) |
| Partner financiers | 5 |
| Test/memo fixtures | 0 |

Verify at any time via the admin endpoint
`GET /api/admin/pilot-status` or the Admin → "Systeem & Metrics" page.

## 2. Deploying on Replit

1. Open the Replit project.
2. Make sure the latest commit is on `main`.
3. Click **Publish** (Reserved VM or Autoscale — Reserved VM is recommended
   so sessions and uploads survive between requests).
4. Configure deployment env vars (see §3).
5. Wait for the deploy to go green, then run the smoke test (§7).

The deployment runs the API server bound to `$PORT`; the frontend is served
through the artifact proxy.

## 3. Environment variables

### Required (deploy will refuse to start without these)

| Var | Purpose |
| --- | --- |
| `PORT` | TCP port for the API server. Set automatically by Replit. |
| `DATABASE_URL` | Postgres connection string for the pilot DB. |

### Optional (drive live vs mock behaviour)

| Var | Effect when set |
| --- | --- |
| `NODE_ENV=production` | Enables production cookie security and disables auto-seed (unless `SEED_DEMO_DATA=1`). |
| `CORS_ALLOWED_ORIGINS` | Comma-separated list of allowed origins. Empty = allow same-origin only. |
| `PIPEDRIVE_API_TOKEN` | Switches Pipedrive from mock to live. |
| `SENDGRID_API_KEY` | Switches SendGrid from mock to live. |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Switches AI skills from deterministic mock to live (per-skill). |
| `PUBLIC_OBJECT_SEARCH_PATHS` / `PRIVATE_OBJECT_DIR` | Enable App Storage instead of DB-backed file storage. |
| `SEED_DEMO_DATA=1` | Allow demo seeding even in production (normally **off** for live pilot). |
| `PARTNER_SENDING_LIVE=1` | Allow real partner sending instead of the mock workflow. Leave unset for the pilot. |

Startup logs a structured report listing which required + optional vars are
present and which integrations are live vs mock. No secret values are logged.

## 4. Mock vs live integrations (current pilot defaults)

| Integration | Default | How to enable live |
| --- | --- | --- |
| Pipedrive | mock | set `PIPEDRIVE_API_TOKEN` |
| SendGrid | mock | set `SENDGRID_API_KEY` |
| AI skills | mock (deterministic) | set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` |
| Object Storage | mock (DB-backed) | set `PUBLIC_OBJECT_SEARCH_PATHS` / `PRIVATE_OBJECT_DIR` |
| Partner sending | mock (`submitted_mock`) | set `PARTNER_SENDING_LIVE=1` (keep off during pilot) |

Mock mode logs the would-be action and never reaches the external system —
safe for first-pilot use.

## 5. Health & status endpoints

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /api/healthz` | public | Liveness probe (returns `{status:"ok"}`). |
| `GET /api/integrations/status` | internal | Pipedrive / SendGrid / AI / Object Storage live-vs-mock summary. |
| `GET /api/admin/pilot-status` | admin only | Full operator view: DB reachable, sanity counts, env report (names only, no values), integration status, auto-seed status, demo-credential warning, app commit + timestamp. |

The admin "Systeem & Metrics" page consumes the pilot-status endpoint and
shows the cleaned-DB sanity counts, integration status, auto-seed status,
and a Dutch demo-credential warning.

## 6. Demo-credential safety

The seed data ships with Dutch demo accounts (all password `Welkom2025!`).
**Before the pilot opens to real users:**

1. Rotate the admin and loan-officer passwords via the admin UI (or by
   updating the `users.password_hash` rows directly).
2. Decide whether to keep Aurora as a sales/training reference dossier; if
   not, run:
   ```bash
   CONFIRM_PILOT_CLEANUP=YES \
     pnpm --filter @workspace/scripts run pilot:cleanup -- --no-preserve-aurora
   ```
3. **Never** run `demo:reset` against the live pilot DB. The script refuses
   by default in production; do not set `ALLOW_PROD_DEMO_RESET=YES` there.

## 7. Smoke-test checklist (post-deploy)

Run the automated check first:

```bash
BASE_URL=https://<your-deploy>.replit.app \
  ADMIN_EMAIL=admin@geenbank.nl \
  ADMIN_PASSWORD='<rotated-password>' \
  pnpm --filter @workspace/scripts run smoke
```

Then manually walk through:

1. **Admin login** (`admin@geenbank.nl`) → Admin → "Systeem & Metrics" shows
   integrations + cleaned-DB sanity counts + demo warning.
2. **Loan-officer login** (e.g. `maarten@geenbank.nl`) → Dossier queue shows
   exactly one dossier (Aurora) and no test fixtures.
3. **Aurora prospect login** (`demo@aurora-bakkerij.nl`) → can see own
   dossier; cannot see memorandum or financier scoring data (privacy filter).
4. **Aurora happy path** (as loan officer): open Aurora's dossier →
   *Memorandum* tab renders; *Partners* tab shows package preview.
5. **Memorandum preview** renders in Dutch with the canonical section list.
6. **Partner mock-send** completes with status `submitted_mock` and an
   ActivityLog entry of action `submitted_to_partners`.
7. **Prospect privacy check**: the prospect cannot fetch
   `/api/dossiers/:id/memorandum` or financier-scored AI runs (403).
8. **Integrations / mock status check** in admin UI matches `/api/admin/pilot-status`.
9. **Incomplete package blocked path** — the cleanup removed all incomplete
   fixtures, so to verify this path either reseed a development environment
   (`CONFIRM_DEMO_RESET=YES pnpm --filter @workspace/scripts run demo:reset`)
   and walk through Joris/Fatima, or note it as a known gap and re-test in
   the next pilot iteration.

## 8. ActivityLog coverage

The pilot logs the following events to `activity_logs`:

- `prevalidation_run`, `ai_analysis_run` (AI analysis start/finish)
- `additional_info_requested`, `condition_responded`, `condition_resolved`
  (additional-info recovery loop)
- `memorandum_generated`
- `submitted_to_partners` (partner mock-send, includes `usedMockMode` flag)
- Status transitions are captured in the metadata of the above entries.

## 9. Rollback

If the deploy goes bad:

1. In Replit Deployments, **promote the previous deployment** (one click).
2. If the DB is suspect, restore from the most recent Replit DB checkpoint
   from before the cleanup/deploy.
3. To get back to the canonical demo dataset on a non-prod env:
   ```bash
   CONFIRM_DEMO_RESET=YES pnpm --filter @workspace/scripts run demo:reset
   ```
4. If a code change is the culprit, revert the commit and redeploy.

## 10. Known limitations (live pilot)

- **Partner sending is mock-only by default.** Setting `PARTNER_SENDING_LIVE=1`
  is a placeholder flag; no real partner connector ships in this build.
- **Email is mock unless `SENDGRID_API_KEY` is set.** Mock emails are visible
  in server logs only.
- **AI skills run deterministically by default.** This is intentional for
  the pilot but means generated narratives are repeatable, not creative.
- **Demo passwords are public** in `replit.md`. They must be rotated before
  any external user can reach the pilot.
- **Object storage is DB-backed unless App Storage is configured.** Large
  document uploads cap at 20 MB per file.
- **No automated end-to-end test suite for the UI yet.** Smoke testing relies
  on the script in §7 plus the manual checklist.
- **`/api/admin/pilot-status` returns env-var names only**, never values —
  safe to share screenshots with operators.
