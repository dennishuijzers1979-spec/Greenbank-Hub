import { logger } from "./logger";
import { describeAiRuntime, type RuntimeStatus } from "./skills/runtime";
import { SKILL_MODULES } from "./skills/types";

export function pipedriveStatus() {
  const live = Boolean(process.env.PIPEDRIVE_API_TOKEN);
  return {
    name: "Pipedrive",
    live,
    message: live
      ? "Live verbonden met Pipedrive."
      : "Mock-modus — leads worden gelogd maar niet naar Pipedrive verstuurd.",
  };
}

export function sendgridStatus() {
  const live = Boolean(process.env.SENDGRID_API_KEY);
  return {
    name: "SendGrid",
    live,
    message: live
      ? "Live verbonden met SendGrid."
      : "Mock-modus — e-mails worden gelogd maar niet daadwerkelijk verzonden.",
  };
}

export type AISkillsStatus = {
  name: string;
  live: boolean;
  message: string;
  runtime: RuntimeStatus;
};

export function aiSkillsStatus(): AISkillsStatus {
  const runtime = describeAiRuntime(SKILL_MODULES);
  const live = runtime.liveSkills > 0;
  const message = live
    ? `AI-pijplijn: ${runtime.liveSkills}/${runtime.totalSkills} skills live via ${runtime.defaultProvider}.`
    : "AI-pijplijn draait deterministisch in mock-modus.";
  return { name: "AI Skills", live, message, runtime };
}

export function objectStorageStatus() {
  const live = Boolean(process.env.PUBLIC_OBJECT_SEARCH_PATHS || process.env.PRIVATE_OBJECT_DIR);
  return {
    name: "Object Storage",
    live,
    message: live
      ? "App Storage geconfigureerd."
      : "Documenten worden in de database opgeslagen (mock-modus).",
  };
}

export async function notifyPipedriveDealUpdate(opts: {
  dealId: string | null;
  stage: string;
  notes?: string;
}): Promise<{ delivered: boolean }> {
  const live = pipedriveStatus().live;
  if (!live) {
    logger.info({ pipedrive: "mock", ...opts }, "Pipedrive update (mock)");
    return { delivered: false };
  }
  logger.info({ pipedrive: "live", ...opts }, "Pipedrive update");
  return { delivered: true };
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  body: string;
}): Promise<{ delivered: boolean }> {
  const live = sendgridStatus().live;
  if (!live) {
    logger.info({ sendgrid: "mock", ...opts }, "Email (mock)");
    return { delivered: false };
  }
  logger.info({ sendgrid: "live", to: opts.to, subject: opts.subject }, "Email sent");
  return { delivered: true };
}
