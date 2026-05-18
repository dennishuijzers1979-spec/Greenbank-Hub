/**
 * Pilot data cleanup — removes test / demo prospects and their data so
 * the loan-officer queue is clean before going live.
 *
 * Safety model (fail-closed by default)
 * -------------------------------------
 *  - Always preserves: admin and loan_officer users, all partner financiers,
 *    and (optionally, default ON) the Aurora Bakkerij happy-path demo.
 *  - Default selection mode is MARKED-ONLY: only prospects whose
 *    `prospect_profiles.source` starts with `seed:`, OR whose email is in
 *    the hard-coded `KNOWN_SEED_EMAILS` list (back-compat for rows seeded
 *    before the marker convention) are eligible for deletion. Real,
 *    unmarked prospects are preserved.
 *  - Pass `--include-unmarked` to also delete unmarked non-staff users.
 *    This requires a second env confirmation (`CONFIRM_INCLUDE_UNMARKED=YES`).
 *  - Destructive mode requires `--apply` and `CONFIRM_PILOT_CLEANUP=YES`.
 *  - Uses Postgres FK cascades: deleting a prospect user cascades to
 *    profile → dossier → documents/runs/conditions/submissions/activity.
 *
 * Usage
 * -----
 *   pnpm --filter @workspace/scripts run pilot:cleanup:dry-run
 *   CONFIRM_PILOT_CLEANUP=YES pnpm --filter @workspace/scripts run pilot:cleanup
 *   pnpm --filter @workspace/scripts run pilot:cleanup -- --no-preserve-aurora
 *   CONFIRM_PILOT_CLEANUP=YES CONFIRM_INCLUDE_UNMARKED=YES \
 *     pnpm --filter @workspace/scripts run pilot:cleanup -- --include-unmarked
 */
import { inArray } from "drizzle-orm";
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
/**
 * Back-compat allowlist for demo prospects seeded before the
 * `source: "seed:*"` marker convention. New seed rows must use a
 * `seed:*` source string instead of relying on this list.
 */
export const KNOWN_SEED_EMAILS: ReadonlySet<string> = new Set([
  "anne@brouwerij-noord.nl",
  "joris@nordhaven-cycles.nl",
  "fatima@studio-meridian.nl",
  "demo@aurora-bakkerij.nl",
]);

export interface CleanupOptions {
  preserveAurora: boolean;
  /** Default true: only delete prospects with a `seed:*` source or known seed email. */
  markedOnly: boolean;
  /** Additional emails to preserve verbatim. Useful for pilot exemptions. */
  preserveEmails?: string[];
}

export interface CleanupPlan {
  preservedUsers: Array<{ id: string; email: string; role: string; reason: string }>;
  deletedUsers: Array<{
    id: string;
    email: string;
    role: string;
    marker: "seed-source" | "known-seed-email" | "unmarked";
  }>;
  unmarkedSkipped: Array<{ id: string; email: string }>;
  deletedProspectProfiles: number;
  deletedDossiers: number;
  preservedPartnerCount: number;
}

function hasSeedMarker(source: string | null): boolean {
  return typeof source === "string" && source.startsWith("seed:");
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
  const userIds = users.map((u) => u.id);
  const profiles = userIds.length
    ? await db
        .select()
        .from(prospectProfilesTable)
        .where(inArray(prospectProfilesTable.userId, userIds))
    : [];
  const profileByUser = new Map<string, (typeof profiles)[number]>();
  for (const p of profiles) profileByUser.set(p.userId, p);

  const preservedUsers: CleanupPlan["preservedUsers"] = [];
  const deletedUsers: CleanupPlan["deletedUsers"] = [];
  const unmarkedSkipped: CleanupPlan["unmarkedSkipped"] = [];

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
        reason:
          u.email === AURORA_EMAIL ? "Aurora demo dossier" : "explicit allowlist",
      });
      continue;
    }
    const profile = profileByUser.get(u.id);
    const seedBySource = hasSeedMarker(profile?.source ?? null);
    const seedByEmail = KNOWN_SEED_EMAILS.has(u.email);

    if (seedBySource) {
      deletedUsers.push({ id: u.id, email: u.email, role: u.role, marker: "seed-source" });
    } else if (seedByEmail) {
      deletedUsers.push({
        id: u.id,
        email: u.email,
        role: u.role,
        marker: "known-seed-email",
      });
    } else if (!opts.markedOnly) {
      deletedUsers.push({ id: u.id, email: u.email, role: u.role, marker: "unmarked" });
    } else {
      // Fail-closed: unmarked records are preserved by default.
      unmarkedSkipped.push({ id: u.id, email: u.email });
      preservedUsers.push({
        id: u.id,
        email: u.email,
        role: u.role,
        reason: "unmarked (no seed:* source) — preserved by fail-closed default",
      });
    }
  }

  const deletedUserIds = deletedUsers.map((u) => u.id);
  let deletedProfiles = 0;
  let deletedDossiers = 0;
  if (deletedUserIds.length > 0) {
    const dProfiles = await db
      .select({ id: prospectProfilesTable.id })
      .from(prospectProfilesTable)
      .where(inArray(prospectProfilesTable.userId, deletedUserIds));
    deletedProfiles = dProfiles.length;
    if (dProfiles.length > 0) {
      const profileIds = dProfiles.map((p) => p.id);
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
    unmarkedSkipped,
    deletedProspectProfiles: deletedProfiles,
    deletedDossiers,
    preservedPartnerCount: partners.length,
  };
}

/**
 * Apply the plan: deletes the users identified by `planPilotCleanup`.
 * Postgres FK cascades remove the rest (profile, dossier, documents,
 * runs, conditions, submissions, dossier-linked activity). Partner
 * financiers are never touched here.
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
  includeUnmarked: boolean;
} {
  const apply = argv.includes("--apply");
  const preserveAurora = !argv.includes("--no-preserve-aurora");
  const includeUnmarked = argv.includes("--include-unmarked");
  const preserveEmails: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith("--preserve-email=")) {
      preserveEmails.push(arg.slice("--preserve-email=".length));
    }
  }
  return { apply, preserveAurora, preserveEmails, includeUnmarked };
}

function printPlan(
  plan: CleanupPlan,
  apply: boolean,
  markedOnly: boolean,
): void {
  const mode = apply ? "APPLY" : "DRY-RUN";
  const selection = markedOnly
    ? "MARKED-ONLY (fail-closed)"
    : "INCLUDE-UNMARKED (broad)";
  console.log(`\n=== Pilot cleanup plan (${mode}, ${selection}) ===\n`);
  console.log(`Preserved partner financiers: ${plan.preservedPartnerCount}`);
  console.log(`Preserved users (${plan.preservedUsers.length}):`);
  for (const u of plan.preservedUsers) {
    console.log(`  KEEP  ${u.email.padEnd(40)} role=${u.role.padEnd(13)} (${u.reason})`);
  }
  console.log(`\nUsers to delete: ${plan.deletedUsers.length}`);
  for (const u of plan.deletedUsers) {
    console.log(
      `  DROP  ${u.email.padEnd(40)} role=${u.role.padEnd(13)} marker=${u.marker}`,
    );
  }
  if (markedOnly && plan.unmarkedSkipped.length > 0) {
    console.log(
      `\nUnmarked non-staff users skipped (${plan.unmarkedSkipped.length}). Re-run with --include-unmarked to remove these as well.`,
    );
  }
  console.log(
    `\nCascade impact: ${plan.deletedProspectProfiles} prospect profile(s), ${plan.deletedDossiers} dossier(s) (and their documents/runs/conditions/submissions/activity).`,
  );
  console.log("");
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { apply, preserveAurora, preserveEmails, includeUnmarked } = parseArgs(argv);
  const markedOnly = !includeUnmarked;
  const plan = await planPilotCleanup({ preserveAurora, preserveEmails, markedOnly });
  printPlan(plan, apply, markedOnly);

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
  if (includeUnmarked && process.env.CONFIRM_INCLUDE_UNMARKED !== "YES") {
    console.error(
      "Refusing --include-unmarked without extra confirmation. Re-run with env CONFIRM_INCLUDE_UNMARKED=YES.",
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
