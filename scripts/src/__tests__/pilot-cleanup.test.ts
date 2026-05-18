/**
 * Pilot cleanup tests — guarantees that the allow-list rules in
 * `scripts/src/pilot-cleanup.ts` actually keep the records that must
 * survive (internal staff, partner financiers, Aurora demo when
 * configured) and remove every other prospect dossier.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

// Tests run against the live DEV database; they create + delete only
// records they own, identified by `pilot-cleanup-test-` email prefixes.
const TEST_PREFIX = "pilot-cleanup-test-";
// Cheap, fake password hash — these tests never authenticate.
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

async function makeProspectWithDossier(email: string, company: string) {
  const user = await makeUser("prospect", email);
  const [p] = await db
    .insert(prospectProfilesTable)
    .values({ userId: user.id, companyName: company, contactName: "Test" })
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

before(async () => {
  // Tests rely on inspecting the live test DB. No app/server needed.
});

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
  const plan = await planPilotCleanup({ preserveAurora: true });
  const preservedIds = plan.preservedUsers.map((u) => u.id);
  assert.ok(preservedIds.includes(admin.id), "admin must be preserved");
  assert.ok(preservedIds.includes(officer.id), "loan officer must be preserved");
  const deletedIds = plan.deletedUsers.map((u) => u.id);
  assert.ok(!deletedIds.includes(admin.id));
  assert.ok(!deletedIds.includes(officer.id));
});

test("plan preserves partner financiers untouched", async () => {
  const partner = await makePartner();
  const plan = await planPilotCleanup({ preserveAurora: true });
  assert.ok(plan.preservedPartnerCount >= 1);
  const stillThere = await db
    .select()
    .from(partnerFinanciersTable)
    .where(eq(partnerFinanciersTable.id, partner.id));
  assert.equal(stillThere.length, 1);
});

test("plan preserves Aurora when preserveAurora=true", async () => {
  // Ensure Aurora exists for this test
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, AURORA_EMAIL));
  if (existing.length === 0) {
    const u = await makeProspectWithDossier(AURORA_EMAIL, "Aurora Bakkerij B.V.");
    void u;
  }
  const plan = await planPilotCleanup({ preserveAurora: true });
  const preservedEmails = plan.preservedUsers.map((u) => u.email);
  assert.ok(preservedEmails.includes(AURORA_EMAIL));
  const deletedEmails = plan.deletedUsers.map((u) => u.email);
  assert.ok(!deletedEmails.includes(AURORA_EMAIL));
});

test("plan deletes Aurora when preserveAurora=false", async () => {
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, AURORA_EMAIL));
  if (existing.length === 0) {
    await makeProspectWithDossier(AURORA_EMAIL, "Aurora Bakkerij B.V.");
  }
  const plan = await planPilotCleanup({ preserveAurora: false });
  const deletedEmails = plan.deletedUsers.map((u) => u.email);
  assert.ok(deletedEmails.includes(AURORA_EMAIL));
});

test("plan deletes prospect dossiers and their cascade footprint", async () => {
  const email = `cleanup-test-${randomUUID()}@example.com`;
  const user = await makeProspectWithDossier(email, "Cleanup Test BV");
  const plan = await planPilotCleanup({ preserveAurora: true });
  const deletedIds = plan.deletedUsers.map((u) => u.id);
  assert.ok(deletedIds.includes(user.id));
  assert.ok(plan.deletedProspectProfiles >= 1);
  assert.ok(plan.deletedDossiers >= 1);
});

test("plan respects explicit preserveEmails allowlist", async () => {
  const email = `vip-${randomUUID()}@example.com`;
  const vip = await makeProspectWithDossier(email, "VIP BV");
  const plan = await planPilotCleanup({
    preserveAurora: true,
    preserveEmails: [email],
  });
  const preservedEmails = plan.preservedUsers.map((u) => u.email);
  assert.ok(preservedEmails.includes(email));
  const deletedIds = plan.deletedUsers.map((u) => u.id);
  assert.ok(!deletedIds.includes(vip.id));
});

test("dry-run (computing the plan) does not delete anything", async () => {
  const email = `dryrun-${randomUUID()}@example.com`;
  const user = await makeProspectWithDossier(email, "DryRun BV");
  await planPilotCleanup({ preserveAurora: true });
  const stillThere = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, user.id));
  assert.equal(stillThere.length, 1, "planning must not delete");
});

test("applyPilotCleanup actually removes the planned prospect users", async () => {
  const email = `apply-${randomUUID()}@example.com`;
  const user = await makeProspectWithDossier(email, "Apply Test BV");
  const plan = await planPilotCleanup({
    preserveAurora: true,
    // Keep every existing user except the one we just made, so this
    // test does not inadvertently nuke parallel-test fixtures.
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
  // Cascade: profile should also be gone.
  const profile = await db
    .select()
    .from(prospectProfilesTable)
    .where(eq(prospectProfilesTable.userId, user.id));
  assert.equal(profile.length, 0);
  // Strip from tracker since it's already deleted.
  const idx = createdUserIds.indexOf(user.id);
  if (idx >= 0) createdUserIds.splice(idx, 1);
});
