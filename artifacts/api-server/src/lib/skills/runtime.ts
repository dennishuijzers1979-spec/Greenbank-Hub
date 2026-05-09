import { logger } from "../logger";
import type { SkillModule } from "./types";

export type SkillProvider = "mock" | "openai" | "http" | "replit";

export type SkillRuntimeConfig = {
  module: SkillModule;
  provider: SkillProvider;
  usedMockMode: boolean;
  fallbackReason: string | null;
  model: string | null;
  endpoint: string | null;
  assistantId: string | null;
  missingEnv: string[];
};

export type SkillInvocation = {
  skillName: SkillModule;
  provider: SkillProvider;
  usedMockMode: boolean;
  fallbackReason: string | null;
  model: string | null;
  endpoint: string | null;
  assistantId: string | null;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  ok: boolean;
  inputSummary: string;
  outputSummary: string;
  errorMessage: string | null;
  /**
   * Optional structured payload that adapters can attach when they
   * have richer data than fits in `outputSummary` (e.g. the full
   * dual-view skill JSON). Persisted as JSONB on
   * `ai_analysis_runs.skill_invocations` and surfaced in the
   * *AI uitvoeringsdetails* panel. Adapters MUST scrub secrets
   * before attaching anything here.
   */
  extras?: Record<string, unknown> | null;
};

const VALID_PROVIDERS: ReadonlySet<SkillProvider> = new Set([
  "mock",
  "openai",
  "http",
  "replit",
]);

function envKey(module: SkillModule, suffix: string): string {
  return `AI_SKILL_${module.toUpperCase()}_${suffix}`;
}

function readProvider(value: string | undefined): SkillProvider | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  return VALID_PROVIDERS.has(v as SkillProvider) ? (v as SkillProvider) : null;
}

/**
 * Resolve the *global default* provider. Only an explicit
 * `AI_SKILL_PROVIDER=openai|http|replit` opts every skill into a live
 * path; the mere presence of `OPENAI_API_KEY` (or any other secret)
 * does NOT auto-promote skills to live execution. Per-skill opt-in
 * (`AI_SKILL_<MODULE>_PROVIDER`) remains the only safe way to enable a
 * single live adapter.
 *
 * Rationale: of the five adapters, only
 * `FinancingProductAdvisorDualView` has a real OpenAI implementation.
 * Auto-promoting the other four to `provider=openai` made the AI
 * uitvoeringsdetails panel and the admin Integraties card claim "live"
 * for skills that still ran deterministic mock code. The default now
 * stays honest: `mock`, unless an operator explicitly opts in.
 */
function detectGlobalProvider(): SkillProvider {
  const explicit = readProvider(process.env.AI_SKILL_PROVIDER);
  if (explicit) return explicit;
  return "mock";
}

/**
 * Resolves the runtime configuration for a single AI skill, combining
 * global defaults (AI_SKILL_PROVIDER, OPENAI_API_KEY, …) with optional
 * per-skill overrides such as `AI_SKILL_<MODULE>_PROVIDER`,
 * `AI_SKILL_<MODULE>_MODEL`, `AI_SKILL_<MODULE>_ENDPOINT`,
 * `AI_SKILL_<MODULE>_ASSISTANT_ID`.
 *
 * The resolver never throws: if the requested provider is missing
 * required env vars (e.g. `openai` without `OPENAI_API_KEY`), it falls
 * back to `mock` and records `fallbackReason` + `missingEnv` for
 * observability.
 */
export function resolveSkillRuntime(module: SkillModule): SkillRuntimeConfig {
  const requested =
    readProvider(process.env[envKey(module, "PROVIDER")]) ??
    detectGlobalProvider();

  const model =
    process.env[envKey(module, "MODEL")] ?? process.env.OPENAI_MODEL ?? null;
  const endpoint =
    process.env[envKey(module, "ENDPOINT")] ??
    process.env.AI_SKILL_ENDPOINT ??
    null;
  const assistantId =
    process.env[envKey(module, "ASSISTANT_ID")] ??
    process.env.OPENAI_ASSISTANT_ID ??
    null;

  const missingEnv: string[] = [];
  let provider: SkillProvider = requested;
  let fallbackReason: string | null = null;

  if (requested === "openai" && !process.env.OPENAI_API_KEY) {
    missingEnv.push("OPENAI_API_KEY");
    provider = "mock";
    fallbackReason = "OPENAI_API_KEY ontbreekt — terugvallen op mock-modus.";
  } else if (
    requested === "replit" &&
    !process.env.ANTHROPIC_API_KEY &&
    !process.env.AI_API_KEY
  ) {
    missingEnv.push("ANTHROPIC_API_KEY of AI_API_KEY");
    provider = "mock";
    fallbackReason =
      "ANTHROPIC_API_KEY of AI_API_KEY ontbreekt — terugvallen op mock-modus.";
  } else if (requested === "http" && !endpoint) {
    missingEnv.push(envKey(module, "ENDPOINT"));
    provider = "mock";
    fallbackReason =
      "AI_SKILL_ENDPOINT ontbreekt — terugvallen op mock-modus.";
  }

  return {
    module,
    provider,
    usedMockMode: provider === "mock",
    fallbackReason,
    model: provider === "mock" ? null : model,
    endpoint: provider === "http" ? endpoint : null,
    assistantId: provider === "openai" ? assistantId : null,
    missingEnv,
  };
}

export type RuntimeStatus = {
  provider: SkillProvider;
  defaultProvider: SkillProvider;
  liveSkills: number;
  mockSkills: number;
  totalSkills: number;
  perSkill: Array<{
    module: SkillModule;
    provider: SkillProvider;
    usedMockMode: boolean;
    fallbackReason: string | null;
    model: string | null;
    endpoint: string | null;
    assistantId: string | null;
    missingEnv: string[];
  }>;
};

export function describeAiRuntime(modules: readonly SkillModule[]): RuntimeStatus {
  const defaultProvider = detectGlobalProvider();
  const perSkill = modules.map((m) => {
    const cfg = resolveSkillRuntime(m);
    return {
      module: cfg.module,
      provider: cfg.provider,
      usedMockMode: cfg.usedMockMode,
      fallbackReason: cfg.fallbackReason,
      model: cfg.model,
      endpoint: cfg.endpoint,
      assistantId: cfg.assistantId,
      missingEnv: cfg.missingEnv,
    };
  });
  const liveSkills = perSkill.filter((s) => !s.usedMockMode).length;
  return {
    provider: defaultProvider,
    defaultProvider,
    liveSkills,
    mockSkills: perSkill.length - liveSkills,
    totalSkills: perSkill.length,
    perSkill,
  };
}

/** Truncate long strings for safe persistence/log. */
export function summarize(value: unknown, max = 240): string {
  let s: string;
  try {
    s = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Wraps a skill execution to produce a structured `SkillInvocation`
 * record alongside the adapter's output. Uses the runtime resolver so
 * the adapter does not have to know how to interpret env vars.
 */
/**
 * Optional overrides an adapter callback can return so the recorded
 * `SkillInvocation` reflects what actually happened, not just what was
 * requested. Used by the dual-view adapter when a live OpenAI call is
 * attempted and falls back to deterministic mock output mid-flight.
 */
export type SkillCallbackResult<T> = {
  data: T;
  outputSummary: string;
  ok?: boolean;
  error?: string | null;
  usedMockMode?: boolean;
  fallbackReason?: string | null;
  model?: string | null;
  extras?: Record<string, unknown> | null;
};

export async function instrumentSkill<T>(
  module: SkillModule,
  ctx: { dossier: { id: string } },
  inputSummary: string,
  fn: (cfg: SkillRuntimeConfig) => Promise<SkillCallbackResult<T>>,
): Promise<{ data: T; invocation: SkillInvocation; ok: boolean; error: string | null; usedMockMode: boolean }> {
  const cfg = resolveSkillRuntime(module);
  const startedAt = new Date();
  logger.info(
    {
      skill: module,
      dossierId: ctx.dossier.id,
      provider: cfg.provider,
      mock: cfg.usedMockMode,
      fallbackReason: cfg.fallbackReason,
      model: cfg.model,
      endpoint: cfg.endpoint,
      assistantId: cfg.assistantId,
    },
    "[skill] start",
  );
  let data: T;
  let outputSummary = "";
  let ok = true;
  let errorMessage: string | null = null;
  let usedMockOverride: boolean | undefined;
  let fallbackOverride: string | null | undefined;
  let modelOverride: string | null | undefined;
  let extras: Record<string, unknown> | null | undefined;
  try {
    const r = await fn(cfg);
    data = r.data;
    outputSummary = r.outputSummary;
    ok = r.ok ?? true;
    errorMessage = r.error ?? null;
    usedMockOverride = r.usedMockMode;
    fallbackOverride = r.fallbackReason;
    modelOverride = r.model;
    extras = r.extras;
  } catch (err) {
    ok = false;
    errorMessage = err instanceof Error ? err.message : String(err);
    throw Object.assign(err instanceof Error ? err : new Error(errorMessage), {
      __invocation: buildInvocation({
        cfg,
        startedAt,
        ok: false,
        inputSummary,
        outputSummary: "",
        errorMessage,
      }),
    });
  }
  const invocation = buildInvocation({
    cfg,
    startedAt,
    ok,
    inputSummary,
    outputSummary,
    errorMessage,
    usedMockOverride,
    fallbackOverride,
    modelOverride,
    extras,
  });
  logger.info(
    {
      skill: module,
      dossierId: ctx.dossier.id,
      provider: invocation.provider,
      mock: invocation.usedMockMode,
      durationMs: invocation.durationMs,
      ok: invocation.ok,
      error: invocation.errorMessage,
    },
    "[skill] complete",
  );
  return {
    data,
    invocation,
    ok,
    error: errorMessage,
    usedMockMode: invocation.usedMockMode,
  };
}

function buildInvocation(args: {
  cfg: SkillRuntimeConfig;
  startedAt: Date;
  ok: boolean;
  inputSummary: string;
  outputSummary: string;
  errorMessage: string | null;
  usedMockOverride?: boolean;
  fallbackOverride?: string | null;
  modelOverride?: string | null;
  extras?: Record<string, unknown> | null;
}): SkillInvocation {
  const completedAt = new Date();
  const usedMockMode =
    args.usedMockOverride ?? args.cfg.usedMockMode;
  const fallbackReason =
    args.fallbackOverride !== undefined
      ? args.fallbackOverride
      : args.cfg.fallbackReason;
  const model =
    args.modelOverride !== undefined ? args.modelOverride : args.cfg.model;
  return {
    skillName: args.cfg.module,
    provider: args.cfg.provider,
    usedMockMode,
    fallbackReason,
    model: usedMockMode && args.modelOverride === undefined ? null : model,
    endpoint: args.cfg.endpoint,
    assistantId: args.cfg.assistantId,
    startedAt: args.startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - args.startedAt.getTime(),
    ok: args.ok,
    inputSummary: summarize(args.inputSummary),
    outputSummary: summarize(args.outputSummary),
    errorMessage: args.errorMessage,
    extras: args.extras ?? null,
  };
}

/** Build an invocation record for a synchronous error path that did not even start. */
export function failedInvocation(
  module: SkillModule,
  startedAt: Date,
  inputSummary: string,
  errorMessage: string,
): SkillInvocation {
  const cfg = resolveSkillRuntime(module);
  return buildInvocation({
    cfg,
    startedAt,
    ok: false,
    inputSummary,
    outputSummary: "",
    errorMessage,
  });
}
