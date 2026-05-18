/**
 * Smoke test for the Geenbank Hub API.
 *
 * Hits a small set of unauthenticated + admin-protected endpoints to verify
 * that the deployed app is reachable, the DB is connected, and integration
 * mock/live flags look sane. Does not touch any prospect/officer data.
 *
 * Usage:
 *   BASE_URL=https://your-app.replit.app pnpm --filter @workspace/scripts run smoke
 *
 * Optional, to also check admin endpoints:
 *   BASE_URL=...
 *   ADMIN_EMAIL=admin@geenbank.nl
 *   ADMIN_PASSWORD='...'
 *   pnpm --filter @workspace/scripts run smoke
 */

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:5000").replace(/\/$/, "");
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  console.log(`[${tag}] ${name} — ${detail}`);
}

async function check(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    record(name, true, await fn());
  } catch (e) {
    record(name, false, e instanceof Error ? e.message : String(e));
  }
}

async function main(): Promise<void> {
  console.log(`Smoke test against ${BASE_URL}\n`);

  await check("GET /api/healthz", async () => {
    const r = await fetch(`${BASE_URL}/api/healthz`);
    if (!r.ok) throw new Error(`status ${r.status}`);
    const body = (await r.json()) as { status?: string };
    if (body.status !== "ok") throw new Error(`unexpected body: ${JSON.stringify(body)}`);
    return "status=ok";
  });

  await check("GET /api/integrations/status (unauth = 401 expected)", async () => {
    const r = await fetch(`${BASE_URL}/api/integrations/status`);
    if (r.status === 401 || r.status === 403) return `status=${r.status} (auth required)`;
    if (r.ok) return "status=200 (public)";
    throw new Error(`unexpected status ${r.status}`);
  });

  let cookie: string | null = null;
  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    await check("POST /api/auth/login (admin)", async () => {
      const r = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
      });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const setCookie = r.headers.get("set-cookie");
      if (!setCookie) throw new Error("no Set-Cookie returned");
      cookie = setCookie.split(";")[0] ?? null;
      return "logged in";
    });

    if (cookie) {
      await check("GET /api/admin/pilot-status", async () => {
        const r = await fetch(`${BASE_URL}/api/admin/pilot-status`, {
          headers: { cookie: cookie! },
        });
        if (!r.ok) throw new Error(`status ${r.status}`);
        const body = (await r.json()) as {
          database?: { reachable?: boolean; counts?: Record<string, number> };
          integrations?: Record<string, { live?: boolean }>;
          autoSeed?: { enabled?: boolean; reason?: string };
        };
        if (!body.database?.reachable) throw new Error("database not reachable");
        const c = body.database.counts ?? {};
        return `db ok | admin=${c.admin} officer=${c.loanOfficer} prospect=${c.prospect} dossier=${c.dossier} partner=${c.partner} | seed=${body.autoSeed?.reason}`;
      });
    }
  } else {
    console.log("\n(skip admin checks — set ADMIN_EMAIL + ADMIN_PASSWORD to run them)\n");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log("Failures:");
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
