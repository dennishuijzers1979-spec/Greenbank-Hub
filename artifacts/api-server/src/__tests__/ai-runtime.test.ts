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
import {
  setOpenAIChatClientForTesting,
  type OpenAIChatClient,
  type OpenAIChatResponse,
} from "../lib/skills/openai-client";

const DUAL_PROVIDER_ENV = "AI_SKILL_FINANCINGPRODUCTADVISORDUALVIEW_PROVIDER";

function withDualEnv<T>(
  env: Record<string, string | undefined>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const keys = [
    DUAL_PROVIDER_ENV,
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "AI_SKILL_PROVIDER",
    "AI_SKILL_FINANCINGPRODUCTADVISORDUALVIEW_MODEL",
  ];
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) saved[k] = process.env[k];
  for (const k of keys) {
    const v = env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
}

function makeFakeOpenAI(
  responder: (req: unknown) => OpenAIChatResponse | Promise<OpenAIChatResponse>,
): OpenAIChatClient {
  return {
    async chat(req) {
      return responder(req);
    },
  };
}

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

test("OPENAI_API_KEY alone does NOT auto-promote skills to live (honesty rule)", () => {
  const originals = {
    AI_SKILL_PROVIDER: process.env.AI_SKILL_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_SKILL_ENDPOINT: process.env.AI_SKILL_ENDPOINT,
    [DUAL_PROVIDER_ENV]: process.env[DUAL_PROVIDER_ENV],
  };
  delete process.env.AI_SKILL_PROVIDER;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_API_KEY;
  delete process.env.AI_SKILL_ENDPOINT;
  delete process.env[DUAL_PROVIDER_ENV];
  process.env.OPENAI_API_KEY = "sk-test-fake-1234567890";
  try {
    // Every skill — including the dual-view one without its per-skill
    // PROVIDER opt-in — must report mock honestly.
    for (const m of SKILL_MODULES) {
      const cfg = resolveSkillRuntime(m);
      assert.equal(cfg.provider, "mock", `${m} should default to mock`);
      assert.equal(cfg.usedMockMode, true, `${m} should be mock`);
      assert.equal(cfg.fallbackReason, null);
    }
    const status = describeAiRuntime(SKILL_MODULES);
    assert.equal(status.defaultProvider, "mock");
    assert.equal(status.liveSkills, 0);
    assert.equal(status.mockSkills, SKILL_MODULES.length);
  } finally {
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("only the per-skill PROVIDER override promotes a single skill to live (configured-provider parity)", () => {
  const originals = {
    AI_SKILL_PROVIDER: process.env.AI_SKILL_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    [DUAL_PROVIDER_ENV]: process.env[DUAL_PROVIDER_ENV],
  };
  delete process.env.AI_SKILL_PROVIDER;
  process.env.OPENAI_API_KEY = "sk-test-fake-1234567890";
  process.env[DUAL_PROVIDER_ENV] = "openai";
  try {
    const dual = resolveSkillRuntime("FinancingProductAdvisorDualView");
    assert.equal(dual.provider, "openai");
    assert.equal(dual.usedMockMode, false);
    for (const m of SKILL_MODULES.filter(
      (x) => x !== "FinancingProductAdvisorDualView",
    )) {
      const cfg = resolveSkillRuntime(m);
      assert.equal(cfg.provider, "mock", `${m} must stay mock`);
      assert.equal(cfg.usedMockMode, true);
    }
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

// --- Dual-view OpenAI pilot -------------------------------------------------

test("dual-view adapter stays on mock when no env vars are set", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  await withDualEnv(
    { [DUAL_PROVIDER_ENV]: undefined, OPENAI_API_KEY: undefined },
    async () => {
      const r = await FinancingProductAdvisorDualViewAdapter.run(ctxFor(dossier));
      assert.equal(r.usedMockMode, true);
      assert.equal(r.invocation.usedMockMode, true);
      assert.equal(r.invocation.model, null);
      assert.equal(r.invocation.fallbackReason, null);
    },
  );
});

test("dual-view adapter falls back to mock when provider=openai but key is missing", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  await withDualEnv(
    { [DUAL_PROVIDER_ENV]: "openai", OPENAI_API_KEY: undefined },
    async () => {
      const r = await FinancingProductAdvisorDualViewAdapter.run(ctxFor(dossier));
      assert.equal(r.usedMockMode, true);
      assert.equal(r.invocation.usedMockMode, true);
      assert.ok(
        r.invocation.fallbackReason &&
          /OPENAI_API_KEY/i.test(r.invocation.fallbackReason),
        `expected fallbackReason to mention OPENAI_API_KEY, got ${r.invocation.fallbackReason}`,
      );
    },
  );
});

test("dual-view adapter falls back to mock when OpenAI returns invalid JSON", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({ content: "definitely not json", model: "fake-model" })),
  );
  try {
    await withDualEnv(
      { [DUAL_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const r = await FinancingProductAdvisorDualViewAdapter.run(ctxFor(dossier));
        assert.equal(r.usedMockMode, true);
        assert.equal(r.invocation.usedMockMode, true);
        assert.equal(r.invocation.provider, "openai");
        assert.ok(
          r.invocation.fallbackReason &&
            /JSON|ongeldig|mislukt/i.test(r.invocation.fallbackReason),
          `unexpected fallbackReason: ${r.invocation.fallbackReason}`,
        );
        // Mock viabilityScore for this dossier (margin=0.20 →+20, dscr=4.17 →+15) → 85.
        assert.equal(r.data.viabilityScore, 85);
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("dual-view adapter maps a valid OpenAI response onto viabilityScore", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  const skillResponse = {
    entrepreneur_view: {
      summary: "Sterke casus.",
      strengths: ["Goede marge"],
      weaknesses: [],
      financeability_score: 8,
      submission_readiness_score: 7,
      cta_status: "ready_to_submit",
      todo_minimum: [],
      todo_optimal: [],
    },
    partner_view: {
      recommended_product: "business term loan",
      alternative_product: "revolving credit",
      recommended_product_mix: [],
      recommendation_status: "strong",
      rationale: ["Goede dekking"],
      key_risks: [],
      evidence_gaps: [],
      indicative_structure: {
        amount: 200000,
        tenor_months: 60,
        repayment_logic: "annuiteit",
        collateral_logic: "borgstelling",
        conditions: [],
      },
      shortlisted_products: [],
    },
  };
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({
      content: JSON.stringify(skillResponse),
      model: "gpt-4o-mini",
    })),
  );
  try {
    await withDualEnv(
      { [DUAL_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const r = await FinancingProductAdvisorDualViewAdapter.run(ctxFor(dossier));
        assert.equal(r.ok, true);
        assert.equal(r.usedMockMode, false);
        assert.equal(r.invocation.usedMockMode, false);
        assert.equal(r.invocation.provider, "openai");
        assert.equal(r.invocation.model, "gpt-4o-mini");
        assert.equal(r.invocation.fallbackReason, null);
        // financeability_score=8 → viabilityScore=80.
        assert.equal(r.data.viabilityScore, 80);
        // Pass-through fields stay derived from dossier, not from the skill.
        assert.equal(r.data.revenue, 500000);
        assert.equal(r.data.profit, 100000);
        assert.equal(r.data.requested, 200000);
        // Rich payload preserved on extras for the AI uitvoeringsdetails panel.
        const extras = r.invocation.extras as { response?: typeof skillResponse } | null;
        assert.ok(extras && extras.response, "extras.response missing");
        assert.equal(extras!.response!.entrepreneur_view.cta_status, "ready_to_submit");
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("dual-view adapter never leaks OPENAI_API_KEY into the SkillInvocation", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  const secretKey = "sk-test-secretvalue-shouldnotleak-7777777777";
  // Fake client that intentionally tries to smuggle the key through the
  // response body — we assert the adapter scrubs it out of `extras`.
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({
      content: JSON.stringify({
        entrepreneur_view: {
          summary: `key=${secretKey}`,
          strengths: [],
          weaknesses: [],
          financeability_score: 5,
          submission_readiness_score: 5,
          cta_status: "ready_to_submit_with_evidence_boosters",
          todo_minimum: [],
          todo_optimal: [],
        },
        partner_view: {
          recommended_product: "",
          alternative_product: "",
          recommended_product_mix: [],
          recommendation_status: "provisional",
          rationale: [],
          key_risks: [],
          evidence_gaps: [],
          indicative_structure: {
            amount: null,
            tenor_months: null,
            repayment_logic: "",
            collateral_logic: "",
            conditions: [],
          },
          shortlisted_products: [],
        },
        api_key: secretKey,
        authorization: `Bearer ${secretKey}`,
      }),
      model: "gpt-4o-mini",
    })),
  );
  try {
    await withDualEnv(
      { [DUAL_PROVIDER_ENV]: "openai", OPENAI_API_KEY: secretKey },
      async () => {
        const r = await FinancingProductAdvisorDualViewAdapter.run(ctxFor(dossier));
        const serialized = JSON.stringify(r.invocation);
        assert.ok(!serialized.includes(secretKey), "raw secret key leaked");
        assert.ok(
          !/sk-test-secretvalue-shouldnotleak/.test(serialized),
          "raw secret prefix leaked",
        );
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("other adapters remain on mock when only the dual-view provider env is set", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  // Even with OPENAI_API_KEY set, the other four adapters must never
  // hit the OpenAI client — only the dual-view adapter has a live path
  // wired, and it requires its per-skill PROVIDER env to be set.
  let openAiCalls = 0;
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => {
      openAiCalls += 1;
      throw new Error("other adapters must not call OpenAI");
    }),
  );
  try {
    await withDualEnv(
      { [DUAL_PROVIDER_ENV]: undefined, OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const ctx = ctxFor(dossier);
        const need = await FinancingNeedAssessorAdapter.run(ctx);
        const credit = await CreditProductAdvisorAdapter.run(ctx);
        const dual = await FinancingProductAdvisorDualViewAdapter.run(ctx);
        // Adapters returned without throwing → none of them invoked the
        // (throwing) fake OpenAI client.
        assert.equal(openAiCalls, 0, "no adapter should call OpenAI");
        assert.ok(need.ok && credit.ok && dual.ok);
        // The dual-view adapter, lacking its per-skill PROVIDER env,
        // also stays on mock and reports it honestly.
        assert.equal(dual.usedMockMode, true);
        assert.equal(dual.invocation.usedMockMode, true);
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
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
