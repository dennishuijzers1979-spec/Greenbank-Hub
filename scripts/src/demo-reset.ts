/**
 * Full demo reset — wipes the dossier dataset and re-runs the seed so
 * the database returns to a known, deterministic demo state. Intended
 * for development and demo environments only, never for live pilot
 * databases.
 *
 * Safety
 * ------
 *  - Requires `CONFIRM_DEMO_RESET=YES` in the environment.
 *  - Refuses to run if `NODE_ENV=production` unless `ALLOW_PROD_DEMO_RESET=YES`
 *    is also set (extra paranoia gate).
 *
 * Usage
 * -----
 *   CONFIRM_DEMO_RESET=YES pnpm --filter @workspace/scripts run demo:reset
 */
import {
  db,
  pool,
  usersTable,
  partnerFinanciersTable,
  activityLogsTable,
} from "@workspace/db";

async function wipe(): Promise<void> {
  // Wrap in a transaction so a partial failure leaves the DB in its
  // original state rather than empty.
  await db.transaction(async (tx) => {
    // Cascades handle the rest: deleting users removes sessions, profiles,
    // dossiers, documents, runs, conditions, dossier-linked activity, and
    // partner_submissions (via dossier cascade).
    await tx.delete(activityLogsTable);
    await tx.delete(partnerFinanciersTable);
    await tx.delete(usersTable);
  });
}

async function reseed(): Promise<void> {
  const seedModule = await import(
    "../../artifacts/api-server/src/lib/seed.js"
  );
  await seedModule.seedIfEmpty();
  await seedModule.ensureAuroraDemo();
}

async function main(): Promise<void> {
  if (process.env.CONFIRM_DEMO_RESET !== "YES") {
    console.error(
      "Refusing to reset without confirmation. Re-run with env CONFIRM_DEMO_RESET=YES.",
    );
    process.exitCode = 2;
    return;
  }
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_PROD_DEMO_RESET !== "YES"
  ) {
    console.error(
      "Refusing to demo-reset a production database. Set ALLOW_PROD_DEMO_RESET=YES if this is truly intended.",
    );
    process.exitCode = 2;
    return;
  }
  console.log("Wiping demo dataset…");
  await wipe();
  console.log("Re-seeding deterministic demo data…");
  await reseed();
  console.log("Demo reset complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
