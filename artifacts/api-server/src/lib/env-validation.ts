import { logger } from "./logger";

export type EnvVarStatus = {
  name: string;
  present: boolean;
  required: boolean;
  description: string;
};

export type EnvReport = {
  required: EnvVarStatus[];
  optional: EnvVarStatus[];
  integrations: {
    pipedrive: "live" | "mock";
    sendgrid: "live" | "mock";
    objectStorage: "live" | "mock";
    aiSkills: "live" | "mock";
    partnerSending: "live" | "mock";
  };
  autoSeed: {
    enabled: boolean;
    reason: string;
  };
  nodeEnv: string;
  missingRequired: string[];
};

const REQUIRED_VARS: ReadonlyArray<Omit<EnvVarStatus, "present" | "required">> = [
  { name: "PORT", description: "TCP port the API server binds to (set by Replit)." },
  { name: "DATABASE_URL", description: "Postgres connection string for the pilot DB." },
];

const OPTIONAL_VARS: ReadonlyArray<Omit<EnvVarStatus, "present" | "required">> = [
  { name: "NODE_ENV", description: "production | development." },
  { name: "CORS_ALLOWED_ORIGINS", description: "Comma-separated origins allowed to call the API." },
  { name: "PIPEDRIVE_API_TOKEN", description: "Enables live Pipedrive deal updates (otherwise mock)." },
  { name: "SENDGRID_API_KEY", description: "Enables live SendGrid email delivery (otherwise mock)." },
  { name: "ANTHROPIC_API_KEY", description: "Enables live AI skills via Anthropic (otherwise deterministic mock)." },
  { name: "OPENAI_API_KEY", description: "Enables live AI skills via OpenAI (otherwise deterministic mock)." },
  { name: "PUBLIC_OBJECT_SEARCH_PATHS", description: "App Storage public search paths (otherwise DB-backed mock)." },
  { name: "PRIVATE_OBJECT_DIR", description: "App Storage private dir (otherwise DB-backed mock)." },
  { name: "SEED_DEMO_DATA", description: "Set to '1' to allow demo seed in production (otherwise skipped in prod)." },
  { name: "PARTNER_SENDING_LIVE", description: "Set to '1' to enable live partner sending (otherwise mock)." },
];

export function buildEnvReport(): EnvReport {
  const required: EnvVarStatus[] = REQUIRED_VARS.map((v) => ({
    ...v,
    required: true,
    present: Boolean(process.env[v.name]),
  }));
  const optional: EnvVarStatus[] = OPTIONAL_VARS.map((v) => ({
    ...v,
    required: false,
    present: Boolean(process.env[v.name]),
  }));
  const missingRequired = required.filter((v) => !v.present).map((v) => v.name);
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const seedDisabled =
    nodeEnv === "production" && process.env.SEED_DEMO_DATA !== "1";
  return {
    required,
    optional,
    missingRequired,
    nodeEnv,
    integrations: {
      pipedrive: process.env.PIPEDRIVE_API_TOKEN ? "live" : "mock",
      sendgrid: process.env.SENDGRID_API_KEY ? "live" : "mock",
      objectStorage:
        process.env.PUBLIC_OBJECT_SEARCH_PATHS || process.env.PRIVATE_OBJECT_DIR
          ? "live"
          : "mock",
      aiSkills:
        process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY
          ? "live"
          : "mock",
      partnerSending: process.env.PARTNER_SENDING_LIVE === "1" ? "live" : "mock",
    },
    autoSeed: {
      enabled: !seedDisabled,
      reason: seedDisabled
        ? "skipped (production without SEED_DEMO_DATA=1)"
        : nodeEnv === "production"
          ? "enabled in production via SEED_DEMO_DATA=1"
          : "enabled (non-production)",
    },
  };
}

export function validateAndReportEnv(): EnvReport {
  const report = buildEnvReport();
  logger.info(
    {
      nodeEnv: report.nodeEnv,
      required: report.required.map((v) => ({ name: v.name, present: v.present })),
      optional: report.optional.map((v) => ({ name: v.name, present: v.present })),
      integrations: report.integrations,
      autoSeed: report.autoSeed,
    },
    "Environment configuration report",
  );
  if (report.missingRequired.length > 0) {
    const msg = `Missing required environment variables: ${report.missingRequired.join(", ")}`;
    logger.error({ missing: report.missingRequired }, msg);
    throw new Error(msg);
  }
  return report;
}
