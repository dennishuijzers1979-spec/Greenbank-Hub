/**
 * Loan officer decision workflow tests.
 *
 * Covers POST /api/dossiers/:dossierId/decision: approve / reject /
 * request_additional_info, status transition guards, RBAC, and the
 * mock-email path when SENDGRID_API_KEY is unset.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import bcrypt from "bcryptjs";

import {
  db,
  pool,
  usersTable,
  sessionsTable,
  prospectProfilesTable,
  dossiersTable,
  conditionsTable,
  activityLogsTable,
} from "@workspace/db";

import app from "../app";

let server: Server;
let baseUrl: string;

const createdUserIds: string[] = [];
const createdDossierIds: string[] = [];

const savedSendgridKey = process.env.SENDGRID_API_KEY;

before(async () => {
  // The mock-email assertion below requires SendGrid to be unconfigured.
  delete process.env.SENDGRID_API_KEY;
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}/api`;
});

after(async () => {
  if (createdDossierIds.length > 0) {
    await db
      .delete(activityLogsTable)
      .where(inArray(activityLogsTable.dossierId, createdDossierIds));
    await db
      .delete(conditionsTable)
      .where(inArray(conditionsTable.dossierId, createdDossierIds));
    await db
      .delete(dossiersTable)
      .where(inArray(dossiersTable.id, createdDossierIds));
  }
  if (createdUserIds.length > 0) {
    await db
      .delete(sessionsTable)
      .where(inArray(sessionsTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await pool.end();
  if (savedSendgridKey === undefined) delete process.env.SENDGRID_API_KEY;
  else process.env.SENDGRID_API_KEY = savedSendgridKey;
});

type Role = "prospect" | "loan_officer" | "admin";

async function createUser(role: Role): Promise<{
  userId: string;
  email: string;
  sessionToken: string;
}> {
  const email = `decision-${randomUUID()}@example.com`;
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash: await bcrypt.hash("test-password", 4),
      role,
      firstLoginCompleted: true,
    })
    .returning();
  createdUserIds.push(user.id);
  const token = randomBytes(32).toString("hex");
  await db.insert(sessionsTable).values({
    userId: user.id,
    token,
    expiresAt: new Date(Date.now() + 86400 * 1000),
  });
  return { userId: user.id, email, sessionToken: token };
}

async function createProspectWithDossier(opts?: { status?: string }): Promise<{
  userId: string;
  prospectId: string;
  dossierId: string;
  prospectSession: string;
}> {
  const { userId, sessionToken } = await createUser("prospect");
  const [prospect] = await db
    .insert(prospectProfilesTable)
    .values({
      userId,
      companyName: `Decision BV ${randomUUID().slice(0, 8)}`,
      contactName: "Test Persoon",
    })
    .returning();
  const [dossier] = await db
    .insert(dossiersTable)
    .values({
      prospectId: prospect.id,
      status: opts?.status ?? "submitted_to_geenbank",
    })
    .returning();
  createdDossierIds.push(dossier.id);
  return {
    userId,
    prospectId: prospect.id,
    dossierId: dossier.id,
    prospectSession: sessionToken,
  };
}

interface ApiResponse {
  status: number;
  json: unknown;
}

async function apiPost(
  path: string,
  sessionToken: string | undefined,
  body: unknown,
): Promise<ApiResponse> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(sessionToken
        ? { Cookie: `geenbank_session=${sessionToken}` }
        : {}),
    },
    body: JSON.stringify(body),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, json };
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object", "expected object payload");
  return value as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("loan officer can approve an eligible dossier", async () => {
  const officer = await createUser("loan_officer");
  const ctx = await createProspectWithDossier({ status: "loan_officer_review" });
  const r = await apiPost(
    `/dossiers/${ctx.dossierId}/decision`,
    officer.sessionToken,
    { decision: "approve", notes: "Sterke cijfers." },
  );
  assert.equal(r.status, 200);
  const body = asRecord(r.json);
  assert.equal(body.status, "approved_for_partner_submission");

  const [updated] = await db
    .select()
    .from(dossiersTable)
    .where(eq(dossiersTable.id, ctx.dossierId));
  assert.equal(updated.status, "approved_for_partner_submission");
  assert.equal(updated.loanOfficerDecision, "approve");
  assert.equal(updated.loanOfficerNotes, "Sterke cijfers.");

  const logs = await db
    .select()
    .from(activityLogsTable)
    .where(eq(activityLogsTable.dossierId, ctx.dossierId));
  assert.ok(logs.some((l) => l.action === "decision_approve"));
});

test("loan officer can reject an eligible dossier", async () => {
  const officer = await createUser("loan_officer");
  const ctx = await createProspectWithDossier({ status: "submitted_to_geenbank" });
  const r = await apiPost(
    `/dossiers/${ctx.dossierId}/decision`,
    officer.sessionToken,
    { decision: "reject", notes: "Onvoldoende onderbouwd." },
  );
  assert.equal(r.status, 200);
  const [updated] = await db
    .select()
    .from(dossiersTable)
    .where(eq(dossiersTable.id, ctx.dossierId));
  assert.equal(updated.status, "rejected_by_loan_officer");
  assert.equal(updated.loanOfficerDecision, "reject");
});

test("loan officer can request additional information and conditions are created", async () => {
  const officer = await createUser("loan_officer");
  const ctx = await createProspectWithDossier({ status: "submitted_to_geenbank" });
  const items = [
    "Kopie identiteitsbewijs DGA",
    "Bankafschriften Q4 2025",
  ];
  const r = await apiPost(
    `/dossiers/${ctx.dossierId}/decision`,
    officer.sessionToken,
    { decision: "request_additional_info", requestedItems: items, notes: "Aanvullen aub." },
  );
  assert.equal(r.status, 200);
  const [updated] = await db
    .select()
    .from(dossiersTable)
    .where(eq(dossiersTable.id, ctx.dossierId));
  assert.equal(updated.status, "additional_info_requested");

  const conds = await db
    .select()
    .from(conditionsTable)
    .where(eq(conditionsTable.dossierId, ctx.dossierId));
  assert.equal(conds.length, items.length);
  assert.deepEqual(
    conds.map((c) => c.title).sort(),
    [...items].sort(),
  );
  assert.ok(conds.every((c) => c.type === "blocking" && c.status === "open"));

  const logs = await db
    .select()
    .from(activityLogsTable)
    .where(eq(activityLogsTable.dossierId, ctx.dossierId));
  assert.ok(logs.some((l) => l.action === "decision_request_additional_info"));
});

test("request_additional_info without items returns 400", async () => {
  const officer = await createUser("loan_officer");
  const ctx = await createProspectWithDossier({ status: "submitted_to_geenbank" });
  const r = await apiPost(
    `/dossiers/${ctx.dossierId}/decision`,
    officer.sessionToken,
    { decision: "request_additional_info", requestedItems: [] },
  );
  assert.equal(r.status, 400);
  const body = asRecord(r.json);
  assert.equal(typeof body.error, "string");
  assert.match(String(body.error), /minimaal/i);

  const [unchanged] = await db
    .select()
    .from(dossiersTable)
    .where(eq(dossiersTable.id, ctx.dossierId));
  assert.equal(unchanged.status, "submitted_to_geenbank");
});

test("decision on an already-approved dossier returns 409", async () => {
  const officer = await createUser("loan_officer");
  const ctx = await createProspectWithDossier({
    status: "approved_for_partner_submission",
  });
  const r = await apiPost(
    `/dossiers/${ctx.dossierId}/decision`,
    officer.sessionToken,
    { decision: "reject", notes: "Te laat." },
  );
  assert.equal(r.status, 409);
  const body = asRecord(r.json);
  assert.equal(typeof body.error, "string");

  const [unchanged] = await db
    .select()
    .from(dossiersTable)
    .where(eq(dossiersTable.id, ctx.dossierId));
  assert.equal(unchanged.status, "approved_for_partner_submission");
});

test("prospect cannot call the decision endpoint", async () => {
  const ctx = await createProspectWithDossier({ status: "submitted_to_geenbank" });
  const r = await apiPost(
    `/dossiers/${ctx.dossierId}/decision`,
    ctx.prospectSession,
    { decision: "approve" },
  );
  assert.ok(r.status === 401 || r.status === 403);
});

test("loan officer cannot decide on a pre-submission (officer-hidden) dossier", async () => {
  const officer = await createUser("loan_officer");
  const ctx = await createProspectWithDossier({ status: "intake_in_progress" });
  const r = await apiPost(
    `/dossiers/${ctx.dossierId}/decision`,
    officer.sessionToken,
    { decision: "approve" },
  );
  assert.equal(r.status, 404);
});

test("admin can approve like a loan officer", async () => {
  const admin = await createUser("admin");
  const ctx = await createProspectWithDossier({ status: "loan_officer_review" });
  const r = await apiPost(
    `/dossiers/${ctx.dossierId}/decision`,
    admin.sessionToken,
    { decision: "approve" },
  );
  assert.equal(r.status, 200);
});

test("decision succeeds when SendGrid key is missing (mock email path)", async () => {
  // SENDGRID_API_KEY is unset in `before` — confirm decision still succeeds.
  assert.equal(process.env.SENDGRID_API_KEY, undefined);
  const officer = await createUser("loan_officer");
  const ctx = await createProspectWithDossier({ status: "submitted_to_geenbank" });
  const r = await apiPost(
    `/dossiers/${ctx.dossierId}/decision`,
    officer.sessionToken,
    { decision: "approve" },
  );
  assert.equal(r.status, 200);
});
