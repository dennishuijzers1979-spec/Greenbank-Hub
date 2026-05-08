import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
const corsAllowlist = (process.env.CORS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    credentials: true,
    origin: (origin, cb) => {
      // Allow same-origin / non-browser requests (no Origin header)
      if (!origin) return cb(null, true);
      if (corsAllowlist.length === 0) return cb(null, true);
      if (corsAllowlist.includes(origin)) return cb(null, true);
      cb(new Error("Origin not allowed by CORS"));
    },
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "32mb" }));
app.use(express.urlencoded({ extended: true, limit: "32mb" }));

app.use("/api", router);

import type { ErrorRequestHandler } from "express";
const bodyTooLargeHandler: ErrorRequestHandler = (err, _req, res, next) => {
  const e = err as (Error & { type?: string; status?: number }) | undefined;
  if (e && (e.type === "entity.too.large" || e.status === 413)) {
    res.status(413).json({
      error:
        "Verzoek is te groot. Upload bestanden van maximaal 20 MB per stuk.",
    });
    return;
  }
  next(err);
};
app.use(bodyTooLargeHandler);

export default app;
