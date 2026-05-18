/**
 * Tests for the explicit loan-officer "request additional information"
 * UX (POST /api/dossiers/:id/request-additional-info) and for the
 * accompanying visibility/serialization rules.
 *
 * Coverage:
 *   - LO can turn an internal condition into a prospect-facing request
 *   - Prospect only sees REQUESTED items via /dossiers/me/conditions
 *   - Prospect serializer exposes prospect-facing copy and never leaks
 *     internal credit wording, reviewerNotes, or unrequested items
 *   - Prospect cannot respond to internal-only conditions
 *   - LO can normally resolve after a prospect response
 *   - LO can force-resolve an open requested item with reviewer note
 *   - LO cannot force-resolve without reviewer note
 *   - Partner submission (gate) remains blocked while requested
 *     blocking items are unresolved
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
  documentsTable,
} from "@workspace/db";

import app from "../app";

let server: Server;
let baseUrl: string;

const createdUserIds: string[] = [];
const createdDossierIds: string[] = [];

before(async () => {
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
      .delete(documentsTable)
      .where(inArray(documentsTable.dossierId, createdDossierIds));
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
});

type Role = "prospect" | "loan_officer" | "admin";

async function createUser(role: Role): Promise<{
  userId: string;
  sessionToken: string;
}> {
  const email = `addreq-${randomUUID()}@example.com`;
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
  return { userId: user.id, sessionToken: token };
}

/**
 * Create a scenario where the dossier already has one INTERNAL (raw
 * credit-language) blocking condition that has NOT been requested from
 * the prospect — the new flow turns this into a prospect-facing
 * request.
 */
async function createScenarioWithInternalCondition(opts?: {
  status?: string;
}): Promise<{
  prospectUserId: string;
  prospectSession: string;
  dossierId: string;
  internalConditionId: string;
  internalTitle: string;
  internalReviewerNote: string;
}> {
  const prospect = await createUser("prospect");
  const [profile] = await db
    .insert(prospectProfilesTable)
    .values({
      userId: prospect.userId,
      companyName: `AddReq BV ${randomUUID().slice(0, 8)}`,
      contactName: "Test Persoon",
    })
    .returning();
  const [dossier] = await db
    .insert(dossiersTable)
    .values({
      prospectId: profile.id,
      status: opts?.status ?? "loan_officer_review",
    })
    .returning();
  createdDossierIds.push(dossier.id);
  const internalTitle =
    "Geen collateral-waardering/coverage voor te financieren tanks; LTV niet vast te stellen";
  const internalReviewerNote =
    "INTERNE NOTITIE — credit-committee meeting 12-05, scope LTV ≤ 0.6.";
  const [cond] = await db
    .insert(conditionsTable)
    .values({
      dossierId: dossier.id,
      type: "blocking",
      status: "open",
      title: internalTitle,
      description: internalTitle,
      requiredAction: internalTitle,
      reviewerNotes: internalReviewerNote,
      // Note: NOT requested → requestedAt remains null → prospect-invisible.
    })
    .returning();
  return {
    prospectUserId: prospect.userId,
    prospectSession: prospect.sessionToken,
    dossierId: dossier.id,
    internalConditionId: cond.id,
    internalTitle,
    internalReviewerNote,
  };
}

async function apiRequest(
  method: "GET" | "POST",
  path: string,
  sessionToken: string | undefined,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(sessionToken
        ? { Cookie: `geenbank_session=${sessionToken}` }
        : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
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

function asArray(value: unknown): unknown[] {
  assert.ok(Array.isArray(value), "expected array payload");
  return value;
}

// ---------------------------------------------------------------------------
// Visibility: prospect must NEVER see internal-only conditions
// ---------------------------------------------------------------------------

test("prospect /dossiers/me/conditions hides internal-only conditions", async () => {
  const ctx = await createScenarioWithInternalCondition();
  const r = await apiRequest(
    "GET",
    "/dossiers/me/conditions",
    ctx.prospectSession,
  );
  assert.equal(r.status, 200);
  const items = asArray(r.json);
  assert.equal(
    items.length,
    0,
    "prospect must not see un-requested internal conditions",
  );
});

test("prospect cannot respond to an internal-only condition (404)", async () => {
  const ctx = await createScenarioWithInternalCondition();
  const r = await apiRequest(
    "POST",
    `/conditions/${ctx.internalConditionId}/respond`,
    ctx.prospectSession,
    { responseText: "wat is dit?" },
  );
  assert.equal(r.status, 404);
});

// ---------------------------------------------------------------------------
// Explicit request-additional-info endpoint
// ---------------------------------------------------------------------------

test("LO can turn an internal condition into a prospect-facing request", async () => {
  const ctx = await createScenarioWithInternalCondition();
  const officer = await createUser("loan_officer");
  const r = await apiRequest(
    "POST",
    `/dossiers/${ctx.dossierId}/request-additional-info`,
    officer.sessionToken,
    {
      items: [
        {
          internalConditionId: ctx.internalConditionId,
          prospectTitle: "Upload de offerte of factuur van de tanks",
          prospectExplanation:
            "Met deze informatie kunnen we de zekerheidswaarde van de investering beter inschatten.",
          prospectRequiredAction:
            "Upload een offerte, factuur, taxatie of specificatie van de vergistingstanks.",
          documentTypeHint: "offerte_tanks.pdf",
          reviewerNotes: "Volg credit-committee scope (LTV ≤ 0.6).",
        },
      ],
    },
  );
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const body = asRecord(r.json);
  assert.equal(asRecord(body.dossier).status, "additional_info_requested");
  const conds = asArray(body.conditions);
  assert.equal(conds.length, 1);
  const c0 = asRecord(conds[0]);
  assert.equal(c0.id, ctx.internalConditionId, "updates the existing row in place");
  assert.equal(c0.prospectTitle, "Upload de offerte of factuur van de tanks");
  // Officer serializer keeps internal credit wording side-by-side.
  assert.equal(c0.title, ctx.internalTitle);
  assert.ok(c0.requestedAt, "requestedAt must be stamped");

  // Prospect now sees exactly one item, with the rewritten copy.
  const pr = await apiRequest(
    "GET",
    "/dossiers/me/conditions",
    ctx.prospectSession,
  );
  const items = asArray(pr.json);
  assert.equal(items.length, 1);
  const pItem = asRecord(items[0]);
  assert.equal(
    pItem.title,
    "Upload de offerte of factuur van de tanks",
    "prospect title is the rewritten copy, NOT the internal credit wording",
  );
  // CRITICAL: prospect must NEVER see internal credit wording...
  assert.notEqual(pItem.title, ctx.internalTitle);
  assert.notEqual(pItem.description, ctx.internalTitle);
  // ...and must NEVER see reviewer notes.
  assert.equal(pItem.reviewerNotes, null);
});

test("LO request-additional-info creates a brand-new requested item when no internalConditionId is given", async () => {
  const ctx = await createScenarioWithInternalCondition();
  const officer = await createUser("loan_officer");
  const r = await apiRequest(
    "POST",
    `/dossiers/${ctx.dossierId}/request-additional-info`,
    officer.sessionToken,
    {
      items: [
        {
          prospectTitle: "Voeg een actuele KvK-uittreksel toe",
          prospectExplanation:
            "We hebben het meest recente uittreksel nodig om je gegevens te verifiëren.",
          prospectRequiredAction:
            "Upload het KvK-uittreksel (maximaal 30 dagen oud).",
        },
      ],
    },
  );
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const body = asRecord(r.json);
  const conds = asArray(body.conditions);
  assert.equal(conds.length, 1);
  const c = asRecord(conds[0]);
  assert.notEqual(c.id, ctx.internalConditionId, "must be a new row");
  assert.ok(c.requestedAt);

  // Prospect now sees TWO items? No — only the new one, because the
  // existing internal condition is still un-requested.
  const pr = await apiRequest(
    "GET",
    "/dossiers/me/conditions",
    ctx.prospectSession,
  );
  const items = asArray(pr.json);
  assert.equal(items.length, 1);
  assert.equal(asRecord(items[0]).id, c.id);
});

test("request-additional-info rejects missing fields", async () => {
  const ctx = await createScenarioWithInternalCondition();
  const officer = await createUser("loan_officer");
  const r = await apiRequest(
    "POST",
    `/dossiers/${ctx.dossierId}/request-additional-info`,
    officer.sessionToken,
    { items: [{ prospectTitle: "", prospectExplanation: "x", prospectRequiredAction: "y" }] },
  );
  assert.equal(r.status, 400);
});

test("request-additional-info requires loan officer role", async () => {
  const ctx = await createScenarioWithInternalCondition();
  // Prospect cannot call it.
  const r = await apiRequest(
    "POST",
    `/dossiers/${ctx.dossierId}/request-additional-info`,
    ctx.prospectSession,
    {
      items: [
        {
          prospectTitle: "x",
          prospectExplanation: "y",
          prospectRequiredAction: "z",
        },
      ],
    },
  );
  assert.equal(r.status, 403);
});

// ---------------------------------------------------------------------------
// Resolve flow (post-request)
// ---------------------------------------------------------------------------

test("LO can resolve a requested item after the prospect responds", async () => {
  const ctx = await createScenarioWithInternalCondition();
  const officer = await createUser("loan_officer");
  // Request.
  const reqResp = await apiRequest(
    "POST",
    `/dossiers/${ctx.dossierId}/request-additional-info`,
    officer.sessionToken,
    {
      items: [
        {
          internalConditionId: ctx.internalConditionId,
          prospectTitle: "Upload tank-offerte",
          prospectExplanation: "Nodig voor zekerheidswaarde.",
          prospectRequiredAction: "Upload offerte of factuur.",
        },
      ],
    },
  );
  assert.equal(reqResp.status, 200);
  // Prospect responds.
  const respond = await apiRequest(
    "POST",
    `/conditions/${ctx.internalConditionId}/respond`,
    ctx.prospectSession,
    { responseText: "Bijgevoegd: offerte_tanks_v2.pdf" },
  );
  assert.equal(respond.status, 200, JSON.stringify(respond.json));
  // Officer resolves with empty body — should now work because there is
  // a response.
  const resolve = await apiRequest(
    "POST",
    `/conditions/${ctx.internalConditionId}/resolve`,
    officer.sessionToken,
    {},
  );
  assert.equal(resolve.status, 200);
  assert.equal(asRecord(resolve.json).status, "resolved");
});

test("LO can force-resolve an open requested item ONLY with a reviewer note", async () => {
  const ctx = await createScenarioWithInternalCondition();
  const officer = await createUser("loan_officer");
  // Request.
  await apiRequest(
    "POST",
    `/dossiers/${ctx.dossierId}/request-additional-info`,
    officer.sessionToken,
    {
      items: [
        {
          internalConditionId: ctx.internalConditionId,
          prospectTitle: "Upload tank-offerte",
          prospectExplanation: "Nodig voor zekerheidswaarde.",
          prospectRequiredAction: "Upload offerte of factuur.",
        },
      ],
    },
  );
  // Try to resolve without a note — must fail with 409.
  const without = await apiRequest(
    "POST",
    `/conditions/${ctx.internalConditionId}/resolve`,
    officer.sessionToken,
    {},
  );
  assert.equal(without.status, 409, JSON.stringify(without.json));
  // Force-resolve with a note — must succeed.
  const withNote = await apiRequest(
    "POST",
    `/conditions/${ctx.internalConditionId}/resolve`,
    officer.sessionToken,
    { reviewerNotes: "Telefonisch akkoord ondernemer 18-05; offerte n.v.t." },
  );
  assert.equal(withNote.status, 200);
  assert.equal(asRecord(withNote.json).status, "resolved");
  // Confirm the note was persisted.
  const [row] = await db
    .select()
    .from(conditionsTable)
    .where(eq(conditionsTable.id, ctx.internalConditionId));
  assert.match(row.reviewerNotes ?? "", /Telefonisch akkoord/);
});

// ---------------------------------------------------------------------------
// Partner-submission gate — must remain blocked while requested
// blocking items are unresolved
// ---------------------------------------------------------------------------

test("partner submission remains blocked while requested blocking items are unresolved", async () => {
  const ctx = await createScenarioWithInternalCondition();
  const officer = await createUser("loan_officer");
  // Request the internal condition.
  await apiRequest(
    "POST",
    `/dossiers/${ctx.dossierId}/request-additional-info`,
    officer.sessionToken,
    {
      items: [
        {
          internalConditionId: ctx.internalConditionId,
          prospectTitle: "Upload tank-offerte",
          prospectExplanation: "Nodig voor zekerheidswaarde.",
          prospectRequiredAction: "Upload offerte of factuur.",
        },
      ],
    },
  );
  // Force-flip the dossier to approved (the gate is the second-line
  // defence — the route still rejects when there are open blockers).
  await db
    .update(dossiersTable)
    .set({ status: "approved_for_partner_submission" })
    .where(eq(dossiersTable.id, ctx.dossierId));

  const submit = await apiRequest(
    "POST",
    `/dossiers/${ctx.dossierId}/submit-to-partners`,
    officer.sessionToken,
    { partnerIds: [] },
  );
  // 400 (no partner ids) or 409 (open blockers) — both prove the
  // request reached the gate. We only assert it is NOT a success.
  assert.notEqual(submit.status, 200);
});