/**
 * Pilot data cleanup — removes test / demo prospects and their data so
 * the loan-officer queue is clean before going live.
 *
 * Safety model
 * ------------
 *  - Always preserves: admin and loan_officer users, all partner financiers,
 *    and (optionally, default ON) the Aurora Bakkerij happy-path demo.
 *  - Default mode is DRY-RUN. The destructive mode requires both
 *    `--apply` and the env guard `CONFIRM_PILOT_CLEANUP=YES`.
 *  - Uses Postgres FK cascades, so deleting a prospect user cascades to
 *    profile → dossier → documents/runs/conditions/submissions/activity.
 *
 * Usage
 * -----
 *   pnpm --filter @workspace/scripts run pilot:cleanup:dry-run
 *   CONFIRM_PILOT_CLEANUP=YES pnpm --filter @workspace/scripts run pilot:cleanup
 *   pnpm --filter @workspace/scripts run pilot:cleanup -- --no-preserve-aurora
 */
import { eq, inArray, ne, and } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  prospectProfilesTable,
  dossiersTable,
  partnerFinanciersTable,
} from "@workspace/db";

export const AURORA_EMAIL = "demo@aurora-bakkerij.nl";
export const STAFF_ROLES = ["admin", "loan_officer"] as const;

export interface CleanupOptions {
  preserveAurora: boolean;
  /** Additional emails to preserve verbatim. Useful for pilot exemptions. */
  preserveEmails?: string[];
}

export interface CleanupPlan {
  preservedUsers: Array<{ id: string; email: string; role: string; reason: string }>;
  deletedUsers: Array<{ id: string; email: string; role: string }>;
  deletedProspectProfiles: number;
  deletedDossiers: number;
  preservedPartnerCount: number;
}

/**
 * Pure planning function: looks at the current database and computes
 * exactly which users / dossiers / profiles would be deleted vs kept,
 * without mutating anything. Used by both the dry-run CLI and the test
 * suite so the safety rules are verified independently of the actual
 * DELETE statements.
 */
export async function planPilotCleanup(
  opts: CleanupOptions,
): Promise<CleanupPlan> {
  const preserveEmails = new Set<string>(opts.preserveEmails ?? []);
  if (opts.preserveAurora) preserveEmails.add(AURORA_EMAIL);

  const users = await db.select().from(usersTable);
  const preservedUsers: CleanupPlan["preservedUsers"] = [];
  const deletedUsers: CleanupPlan["deletedUsers"] = [];

  for (const u of users) {
    if ((STAFF_ROLES as readonly string[]).includes(u.role)) {
      preservedUsers.push({
        id: u.id,
        email: u.email,
        role: u.role,
        reason: `staff role (${u.role})`,
      });
      continue;
    }
    if (preserveEmails.has(u.email)) {
      preservedUsers.push({
        id: u.id,
        email: u.email,
        role: u.role,
        reason: u.email === AURORA_EMAIL ? "Aurora demo dossier" : "explicit allowlist",
      });
      continue;
    }
    deletedUsers.push({ id: u.id, email: u.email, role: u.role });
  }

  const deletedUserIds = deletedUsers.map((u) => u.id);
  let deletedProfiles = 0;
  let deletedDossiers = 0;
  if (deletedUserIds.length > 0) {
    const profiles = await db
      .select({ id: prospectProfilesTable.id })
      .from(prospectProfilesTable)
      .where(inArray(prospectProfilesTable.userId, deletedUserIds));
    deletedProfiles = profiles.length;
    if (profiles.length > 0) {
      const profileIds = profiles.map((p) => p.id);
      const dossiers = await db
        .select({ id: dossiersTable.id })
        .from(dossiersTable)
        .where(inArray(dossiersTable.prospectId, profileIds));
      deletedDossiers = dossiers.length;
    }
  }

  const partners = await db.select().from(partnerFinanciersTable);

  return {
    preservedUsers,
    deletedUsers,
    deletedProspectProfiles: deletedProfiles,
    deletedDossiers,
    preservedPartnerCount: partners.length,
  };
}

/**
 * Apply the plan: deletes the users identified by `planPilotCleanup`.
 * Postgres FK cascades remove the rest (profile, dossier, documents,
 * runs, conditions, submissions, dossier-linked activity).
 *
 * Partner financiers are never touched here.
 */
export async function applyPilotCleanup(plan: CleanupPlan): Promise<void> {
  if (plan.deletedUsers.length === 0) return;
  const ids = plan.deletedUsers.map((u) => u.id);
  await db.delete(usersTable).where(inArray(usersTable.id, ids));
}

function parseArgs(argv: string[]): {
  apply: boolean;
  preserveAurora: boolean;
  preserveEmails: string[];
} {
  const apply = argv.includes("--apply");
  const preserveAurora = !argv.includes("--no-preserve-aurora");
  const preserveEmails: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith("--preserve-email=")) {
      preserveEmails.push(arg.slice("--preserve-email=".length));
    }
  }
  return { apply, preserveAurora, preserveEmails };
}

function printPlan(plan: CleanupPlan, apply: boolean): void {
  const mode = apply ? "APPLY" : "DRY-RUN";
  console.log(`\n=== Pilot cleanup plan (${mode}) ===\n`);
  console.log(`Preserved partner financiers: ${plan.preservedPartnerCount}`);
  console.log(`Preserved users (${plan.preservedUsers.length}):`);
  for (const u of plan.preservedUsers) {
    console.log(`  KEEP  ${u.email.padEnd(40)} role=${u.role.padEnd(13)} (${u.reason})`);
  }
  console.log(`\nUsers to delete: ${plan.deletedUsers.length}`);
  for (const u of plan.deletedUsers) {
    console.log(`  DROP  ${u.email.padEnd(40)} role=${u.role}`);
  }
  console.log(
    `\nCascade impact: ${plan.deletedProspectProfiles} prospect profile(s), ${plan.deletedDossiers} dossier(s) (and their documents/runs/conditions/submissions/activity).`,
  );
  console.log("");
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { apply, preserveAurora, preserveEmails } = parseArgs(argv);
  const plan = await planPilotCleanup({ preserveAurora, preserveEmails });
  printPlan(plan, apply);

  if (!apply) {
    console.log("DRY-RUN: nothing was deleted. Re-run with --apply to commit.");
    return;
  }
  if (process.env.CONFIRM_PILOT_CLEANUP !== "YES") {
    console.error(
      "Refusing to delete without confirmation. Re-run with env CONFIRM_PILOT_CLEANUP=YES.",
    );
    process.exitCode = 2;
    return;
  }
  if (plan.deletedUsers.length === 0) {
    console.log("Nothing to delete.");
    return;
  }
  await applyPilotCleanup(plan);
  console.log(`Deleted ${plan.deletedUsers.length} user(s) and cascaded data.`);
}

const isDirect = (() => {
  try {
    const entry = process.argv[1] ?? "";
    return entry.endsWith("pilot-cleanup.ts") || entry.endsWith("pilot-cleanup.js");
  } catch {
    return false;
  }
})();

if (isDirect) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

// Suppress unused-import warnings for tree-shaking safety in lib mode.
void eq;
void ne;
void and;
