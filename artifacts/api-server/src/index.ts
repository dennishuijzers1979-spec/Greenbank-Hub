import app from "./app";
import { logger } from "./lib/logger";
import { seedIfEmpty, ensureAuroraDemo } from "./lib/seed";
import { validateAndReportEnv } from "./lib/env-validation";

const envReport = validateAndReportEnv();

const port = Number(process.env["PORT"]);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env["PORT"]}"`);
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port, nodeEnv: envReport.nodeEnv }, "Server listening");
  if (!envReport.autoSeed.enabled) {
    logger.info({ reason: envReport.autoSeed.reason }, "Demo seed skipped");
  } else {
    try {
      await seedIfEmpty();
      await ensureAuroraDemo();
    } catch (e) {
      logger.error({ err: e }, "Seed failed");
    }
  }
});
