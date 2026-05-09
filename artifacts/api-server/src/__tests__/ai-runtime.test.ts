/**
 * Tests for AI skill invocation observability:
 *  - Central runtime resolves provider, mock fallback, missing env.
 *  - Each skill adapter emits a structured invocation record.
 *  - Orchestrator persists invocations to the AIAnalysisRun row.
 *  - GET /dossiers/:id/latest-run returns invocations to officers
 *    without leaking secrets.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import bcrypt from "bcryptjs";

import {
  db,
  pool,
  usersTable,
  sessionsTable,
  prospectProfilesTable,
  dossiersTable,
  documentsTable,
  conditionsTable,
  aiAnalysisRunsTable,
} from "@workspace/db";

import app from "../app";
import {
  resolveSkillRuntime,
  describeAiRuntime,
} from "../lib/skills/runtime";
import {
  CreditProductAdvisorAdapter,
  FinancingNeedAssessorAdapter,
  FinancingProductAdvisorDualViewAdapter,
  GeenbankKredietworkflowAdapter,
  MoneycareKredietmemorandumAdapter,
} from "../lib/skills";
import { SKILL_MODULES } from "../lib/skills/types";
import { skillOrchestrationService } from "../lib/skill-orchestration";

let server: Server;
let baseUrl: string;
const createdUserIds: string[] = [];
const createdDossierIds: string[] = [];

before(async () => {
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}/api`;
});

after(async () => {
  if (createdDossierIds.length > 0) {
    await db
      .delete(aiAnalysisRunsTable)
      .where(inArray(aiAnalysisRunsTable.dossierId, createdDossierIds));
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

async function createUser(role: "prospect" | "loan_officer" | "admin") {
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `test-${randomUUID()}@example.com`,
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

async function createDossier(status = "submitted_to_geenbank") {
  const { userId } = await createUser("prospect");
  const [prospect] = await db
    .insert(prospectProfilesTable)
    .values({
      userId,
      companyName: `Test BV ${randomUUID().slice(0, 8)}`,
      contactName: "Test",
    })
    .returning();
  const [dossier] = await db
    .insert(dossiersTable)
    .values({
      prospectId: prospect.id,
      status,
      annualRevenue: "500000",
      annualCost: "400000",
      annualProfit: "100000",
      requestedAmount: "200000",
      financingPurpose: "uitbreiding",
      financingTypePreference: "lening",
      companyDescription: "Test bedrijf voor regressie van AI observability.",
    })
    .returning();
  createdDossierIds.push(dossier.id);
  return { dossierId: dossier.id, prospectId: prospect.id, userId };
}

function ctxFor(dossier: typeof dossiersTable.$inferSelect) {
  return { dossier, documents: [], companyName: "Test BV" };
}

// --- Runtime resolver -------------------------------------------------------

test("runtime resolver defaults to mock when no provider env is set", () => {
  const original = {
    AI_SKILL_PROVIDER: process.env.AI_SKILL_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_SKILL_ENDPOINT: process.env.AI_SKILL_ENDPOINT,
  };
  delete process.env.AI_SKILL_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_API_KEY;
  delete process.env.AI_SKILL_ENDPOINT;
  try {
    const cfg = resolveSkillRuntime("CreditProductAdvisor");
    assert.equal(cfg.provider, "mock");
    assert.equal(cfg.usedMockMode, true);
    assert.equal(cfg.fallbackReason, null);
  } finally {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("runtime resolver falls back to mock when openai is requested without key", () => {
  const originals = {
    AI_SKILL_PROVIDER: process.env.AI_SKILL_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  process.env.AI_SKILL_PROVIDER = "openai";
  delete process.env.OPENAI_API_KEY;
  try {
    const cfg = resolveSkillRuntime("FinancingNeedAssessor");
    assert.equal(cfg.provider, "mock");
    assert.equal(cfg.usedMockMode, true);
    assert.ok(cfg.fallbackReason && /OPENAI_API_KEY/.test(cfg.fallbackReason));
    assert.deepEqual(cfg.missingEnv, ["OPENAI_API_KEY"]);
  } finally {
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("describeAiRuntime returns one entry per known skill module", () => {
  const status = describeAiRuntime(SKILL_MODULES);
  assert.equal(status.totalSkills, SKILL_MODULES.length);
  assert.equal(status.perSkill.length, SKILL_MODULES.length);
  for (const s of status.perSkill) {
    assert.ok(SKILL_MODULES.includes(s.module));
    assert.ok(["mock", "openai", "http", "replit"].includes(s.provider));
  }
});

// --- Per-adapter invocation -------------------------------------------------

test("every skill adapter emits a structured invocation record", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  const ctx = ctxFor(dossier);

  const need = await FinancingNeedAssessorAdapter.run(ctx);
  const credit = await CreditProductAdvisorAdapter.run(ctx);
  const dual = await FinancingProductAdvisorDualViewAdapter.run(ctx);
  const flow = await GeenbankKredietworkflowAdapter.run({
    ctx,
    completenessScore: need.data.completenessScore,
    correctnessScore: credit.data.correctnessScore,
    viabilityScore: dual.data.viabilityScore,
    completedDocs: need.data.completedDocs,
    requiredDocs: need.data.requiredDocs,
    margin: dual.data.margin,
    dscr: dual.data.dscr,
    revenue: dual.data.revenue,
    profit: dual.data.profit,
    requested: dual.data.requested,
  });
  const fin = await MoneycareKredietmemorandumAdapter.buildFinancierReport({
    ctx,
    margin: dual.data.margin,
    dscr: dual.data.dscr,
    revenue: dual.data.revenue,
    profit: dual.data.profit,
    requested: dual.data.requested,
    verdict: flow.data.verdict,
    strongPoints: flow.data.strongPoints,
    weakPoints: flow.data.weakPoints,
  });

  for (const r of [need, credit, dual, flow, fin]) {
    assert.ok(r.invocation, `${r.module} missing invocation`);
    assert.equal(r.invocation.skillName, r.module);
    assert.ok(typeof r.invocation.durationMs === "number");
    assert.ok(r.invocation.startedAt);
    assert.ok(r.invocation.completedAt);
    assert.ok(["mock", "openai", "http", "replit"].includes(r.invocation.provider));
    assert.equal(r.invocation.usedMockMode, r.usedMockMode);
    assert.ok(r.invocation.outputSummary.length > 0);
  }
});

// --- Orchestrator persists invocations + officer endpoint exposes them ------

test("runPrevalidation persists skillInvocations and officer can read them", async () => {
  const { dossierId } = await createDossier("intake_in_progress");
  const { runId } = await skillOrchestrationService.runPrevalidation(dossierId);
  const [row] = await db
    .select()
    .from(aiAnalysisRunsTable)
    .where(inArray(aiAnalysisRunsTable.id, [runId]));
  const invocations = row.skillInvocations as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(invocations));
  assert.equal(invocations.length, 5);
  for (const inv of invocations) {
    assert.ok(typeof inv.skillName === "string");
    assert.ok(typeof inv.provider === "string");
    assert.ok(typeof inv.durationMs === "number");
  }

  // Move dossier to officer-visible status so the officer endpoint accepts it.
  await db
    .update(dossiersTable)
    .set({ status: "submitted_to_geenbank" })
    .where(inArray(dossiersTable.id, [dossierId]));
  const officer = await createUser("loan_officer");
  const res = await fetch(`${baseUrl}/dossiers/${dossierId}/latest-run`, {
    headers: { Cookie: `geenbank_session=${officer.sessionToken}` },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { skillInvocations: unknown[] };
  assert.ok(Array.isArray(body.skillInvocations));
  assert.equal(body.skillInvocations.length, 5);
  // Make sure secrets never appear in the serialized payload.
  const serialized = JSON.stringify(body);
  assert.ok(!/sk-[A-Za-z0-9]/.test(serialized), "openai key leaked");
  assert.ok(!/OPENAI_API_KEY=\S/.test(serialized), "raw env leaked");
});
