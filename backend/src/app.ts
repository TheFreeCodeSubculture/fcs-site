import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { config } from "./config.js";
import { pingDatabase } from "./db/index.js";
import { HttpError } from "./lib/http.js";
import { adminAnalyticsRouter } from "./routes/admin-analytics.js";
import { adminBlogRouter } from "./routes/admin-blog.js";
import { adminGithubRouter } from "./routes/admin-github.js";
import { adminMediaRouter } from "./routes/admin-media.js";
import { adminTeamRouter } from "./routes/admin-team.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { adminMailRouter, eventMailRouter } from "./routes/event-mail.js";
import { integrationsRouter } from "./routes/integrations.js";
import { publicRouter } from "./routes/public.js";
import { trackRouter } from "./routes/track.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY);
  app.use(helmet());
  app.use(
    cors({
      origin: config.SITE_ORIGINS,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      maxAge: 86_400,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(
    pinoHttp({
      level: config.isTest ? "silent" : config.isProduction ? "info" : "debug",
    }),
  );

  app.get("/", (_req, res) => {
    res.json({
      name: "fcs-backend",
      version: "0.1.0",
      status: "ok",
    });
  });

  app.get("/health", async (_req, res) => {
    try {
      const db = await pingDatabase();
      res.json({ ok: true, db: "up", time: db.now });
    } catch (error) {
      console.error("Database health check failed", error);
      res.status(503).json({ ok: false, db: "down" });
    }
  });

  app.use("/api", trackRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/event-mail", eventMailRouter);
  app.use("/api/integrations", integrationsRouter);
  app.use("/api/public", publicRouter);
  app.use("/api/admin", adminAnalyticsRouter);
  app.use("/api/admin", adminMediaRouter);
  app.use("/api/admin", adminGithubRouter);
  app.use("/api/admin", adminMailRouter);
  app.use("/api/admin/team", adminTeamRouter);
  app.use("/api/admin", adminBlogRouter);
  app.use("/api/admin", adminRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }

    const pgError = error as { code?: string };
    if (pgError.code === "23505") {
      res.status(409).json({ error: "That value is already in use." });
      return;
    }
    if (pgError.code === "23503") {
      res.status(400).json({ error: "A referenced row does not exist." });
      return;
    }
    if (pgError.code === "23514") {
      res.status(400).json({ error: "That value is not allowed." });
      return;
    }
    if (pgError.code === "22P02") {
      res.status(400).json({ error: "That identifier is not valid." });
      return;
    }
    if (pgError.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ error: "That file is too large." });
      return;
    }

    console.error("Unhandled API error", error);
    res.status(500).json({ error: "Internal server error" });
  };

  app.use(errorHandler);

  return app;
}
