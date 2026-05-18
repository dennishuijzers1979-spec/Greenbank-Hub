/**
 * Pilot cleanup tests — guarantees the safety rules in
 * `scripts/src/pilot-cleanup.ts`:
 *  - admins, loan officers and partner financiers are preserved,
 *  - Aurora is preserved when configured, deleted when configured off,
 *  - in the default MARKED-ONLY mode, real unmarked prospects survive,
 *  - --include-unmarked mode does delete unmarked prospects,
 *  - the CLI refuses to mutate without CONFIRM_PILOT_CLEANUP=YES.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, inArray } from "drizzle-orm";

import {
  db,
  pool,
  usersTable,
  prospectProfilesTable,
  dossiersTable,
  partnerFinanciersTable,
} from "@workspace/db";

import {
  AURORA_EMAIL,
  planPilotCleanup,
  applyPilotCleanup,
} from "../pilot-cleanup";

const TEST_PREFIX = "pilot-cleanup-test-";
const FAKE_HASH = "$2a$04$abcdefghijklmnopqrstuv";

const createdUserIds: string[] = [];
const createdPartnerIds: string[] = [];

async function makeUser(role: "admin" | "loan_officer" | "prospect", email?: string) {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: email ?? `${TEST_PREFIX}${role}-${randomUUID()}@example.com`,
      passwordHash: FAKE_HASH,
      role,
      firstLoginCompleted: true,
    })
    .returning();
  createdUserIds.push(u.id);
  return u;
}

/**
 * Creates a prospect + profile + dossier. By default the profile is
 * marked `source: "seed:test"` so it is eligible for cleanup in the
 * safe MARKED-ONLY mode. Pass `markAsSeed=false` to simulate a real
 * unmarked customer record.
 */
async function makeProspectWithDossier(
  email: string,
  company: string,
  opts: { markAsSeed?: boolean } = {},
) {
  const user = await makeUser("prospect", email);
  const [p] = await db
    .insert(prospectProfilesTable)
    .values({
      userId: user.id,
      companyName: company,
      contactName: "Test",
      source: opts.markAsSeed === false ? null : "seed:test",
    })
    .returning();
  await db
    .insert(dossiersTable)
    .values({ prospectId: p.id, status: "intake_in_progress" })
    .returning();
  return user;
}

async function makePartner() {
  const [p] = await db
    .insert(partnerFinanciersTable)
    .values({
      name: `Partner ${randomUUID().slice(0, 6)}`,
      contactEmail: `p-${randomUUID().slice(0, 6)}@example.com`,
      productFocus: "MKB",
      activeStatus: "active",
    })
    .returning();
  createdPartnerIds.push(p.id);
  return p;
}

before(async () => {});

after(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  if (createdPartnerIds.length > 0) {
    await db
      .delete(partnerFinanciersTable)
      .where(inArray(partnerFinanciersTable.id, createdPartnerIds));
  }
  await pool.end();
});

test("plan preserves admin and loan_officer users", async () => {
  const admin = await makeUser("admin");
  const officer = await makeUser("loan_officer");
  const plan = await planPilotCleanup({ preserveAurora: true, markedOnly: true });
  const preservedIds = plan.preservedUsers.map((u) => u.id);
  assert.ok(preservedIds.includes(admin.id), "admin must be preserved");
  assert.ok(preservedIds.includes(officer.id), "loan officer must be preserved");
  const deletedIds = plan.deletedUsers.map((u) => u.id);
  assert.ok(!deletedIds.includes(admin.id));
  assert.ok(!deletedIds.includes(officer.id));
});

test("plan preserves partner financiers untouched", async () => {
  const partner = await makePartner();
  const plan = await planPilotCleanup({ preserveAurora: true, markedOnly: true });
  assert.ok(plan.preservedPartnerCount >= 1);
  const stillThere = await db
    .select()
    .from(partnerFinanciersTable)
    .where(eq(partnerFinanciersTable.id, partner.id));
  assert.equal(stillThere.length, 1);
});

test("plan preserves Aurora when preserveAurora=true", async () => {
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, AURORA_EMAIL));
  if (existing.length === 0) {
    await makeProspectWithDossier(AURORA_EMAIL, "Aurora Bakkerij B.V.");
  }
  const plan = await planPilotCleanup({ preserveAurora: true, markedOnly: true });
  const preservedEmails = plan.preservedUsers.map((u) => u.email);
  assert.ok(preservedEmails.includes(AURORA_EMAIL));
  const deletedEmails = plan.deletedUsers.map((u) => u.email);
  assert.ok(!deletedEmails.includes(AURORA_EMAIL));
});

test("plan deletes Aurora when preserveAurora=false (via known-seed-email marker)", async () => {
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, AURORA_EMAIL));
  if (existing.length === 0) {
    await makeProspectWithDossier(AURORA_EMAIL, "Aurora Bakkerij B.V.");
  }
  const plan = await planPilotCleanup({ preserveAurora: false, markedOnly: true });
  const deletedEmails = plan.deletedUsers.map((u) => u.email);
  assert.ok(deletedEmails.includes(AURORA_EMAIL));
});

test("plan deletes seed-marked prospect dossiers and their cascade footprint", async () => {
  const email = `${TEST_PREFIX}seed-${randomUUID()}@example.com`;
  const user = await makeProspectWithDossier(email, "Cleanup Test BV");
  const plan = await planPilotCleanup({ preserveAurora: true, markedOnly: true });
  const deleted = plan.deletedUsers.find((u) => u.id === user.id);
  assert.ok(deleted, "seed-marked user must be selected for deletion");
  assert.equal(deleted!.marker, "seed-source");
  assert.ok(plan.deletedProspectProfiles >= 1);
  assert.ok(plan.deletedDossiers >= 1);
});

test("MARKED-ONLY mode preserves unmarked real-looking prospects (fail-closed)", async () => {
  const email = `${TEST_PREFIX}real-${randomUUID()}@example.com`;
  const real = await makeProspectWithDossier(email, "Echte Klant BV", {
    markAsSeed: false,
  });
  const plan = await planPilotCleanup({ preserveAurora: true, markedOnly: true });
  const deletedIds = plan.deletedUsers.map((u) => u.id);
  assert.ok(
    !deletedIds.includes(real.id),
    "unmarked prospect must NOT be in delete list under fail-closed default",
  );
  const skippedIds = plan.unmarkedSkipped.map((u) => u.id);
  assert.ok(
    skippedIds.includes(real.id),
    "unmarked prospect must appear in unmarkedSkipped",
  );
});

test("INCLUDE-UNMARKED mode deletes unmarked prospects too", async () => {
  const email = `${TEST_PREFIX}unmarked-${randomUUID()}@example.com`;
  const real = await makeProspectWithDossier(email, "Unmarked BV", {
    markAsSeed: false,
  });
  const plan = await planPilotCleanup({
    preserveAurora: true,
    markedOnly: false,
  });
  const deleted = plan.deletedUsers.find((u) => u.id === real.id);
  assert.ok(deleted, "unmarked prospect must be deletable when markedOnly=false");
  assert.equal(deleted!.marker, "unmarked");
});

test("plan respects explicit preserveEmails allowlist", async () => {
  const email = `${TEST_PREFIX}vip-${randomUUID()}@example.com`;
  const vip = await makeProspectWithDossier(email, "VIP BV");
  const plan = await planPilotCleanup({
    preserveAurora: true,
    markedOnly: true,
    preserveEmails: [email],
  });
  const preservedEmails = plan.preservedUsers.map((u) => u.email);
  assert.ok(preservedEmails.includes(email));
  const deletedIds = plan.deletedUsers.map((u) => u.id);
  assert.ok(!deletedIds.includes(vip.id));
});

test("dry-run (computing the plan) does not delete anything", async () => {
  const email = `${TEST_PREFIX}dryrun-${randomUUID()}@example.com`;
  const user = await makeProspectWithDossier(email, "DryRun BV");
  await planPilotCleanup({ preserveAurora: true, markedOnly: true });
  const stillThere = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, user.id));
  assert.equal(stillThere.length, 1, "planning must not delete");
});

test("applyPilotCleanup actually removes the planned prospect users", async () => {
  const email = `${TEST_PREFIX}apply-${randomUUID()}@example.com`;
  const user = await makeProspectWithDossier(email, "Apply Test BV");
  const plan = await planPilotCleanup({
    preserveAurora: true,
    markedOnly: true,
    preserveEmails: (
      await db.select({ email: usersTable.email }).from(usersTable)
    )
      .map((r) => r.email)
      .filter((e) => e !== email),
  });
  assert.equal(plan.deletedUsers.length, 1);
  assert.equal(plan.deletedUsers[0].email, email);
  await applyPilotCleanup(plan);
  const stillThere = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, user.id));
  assert.equal(stillThere.length, 0, "user should be deleted after apply");
  const profile = await db
    .select()
    .from(prospectProfilesTable)
    .where(eq(prospectProfilesTable.userId, user.id));
  assert.equal(profile.length, 0);
  const idx = createdUserIds.indexOf(user.id);
  if (idx >= 0) createdUserIds.splice(idx, 1);
});

test("CLI: --apply without CONFIRM_PILOT_CLEANUP refuses to mutate", async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const cliPath = resolve(here, "../pilot-cleanup.ts");

  // Create a guaranteed deletion candidate.
  const email = `${TEST_PREFIX}cli-${randomUUID()}@example.com`;
  const user = await makeProspectWithDossier(email, "CLI Guard BV");

  const env = { ...process.env };
  delete env.CONFIRM_PILOT_CLEANUP;

  const res = spawnSync(
    process.execPath,
    ["--import", "tsx", cliPath, "--apply", `--preserve-email=${AURORA_EMAIL}`],
    { encoding: "utf8", env, timeout: 30_000 },
  );
  assert.equal(res.status, 2, `expected exit 2, got ${res.status}. stderr: ${res.stderr}`);
  assert.match(res.stderr, /CONFIRM_PILOT_CLEANUP=YES/);

  // The user must still exist — no deletion happened.
  const stillThere = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, user.id));
  assert.equal(stillThere.length, 1, "user must NOT have been deleted by unconfirmed apply");
});
