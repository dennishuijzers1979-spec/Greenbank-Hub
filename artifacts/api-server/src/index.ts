import app from "./app";
import { logger } from "./lib/logger";
import { seedIfEmpty, ensureAuroraDemo } from "./lib/seed";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
  const seedDisabled =
    process.env.NODE_ENV === "production" && process.env.SEED_DEMO_DATA !== "1";
  if (seedDisabled) {
    logger.info("Demo seed skipped (production without SEED_DEMO_DATA=1)");
  } else {
    try {
      await seedIfEmpty();
      await ensureAuroraDemo();
    } catch (e) {
      logger.error({ err: e }, "Seed failed");
    }
  }
});
