import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { config } from "./config.js";
import { pingDatabase } from "./db/index.js";
import { HttpError } from "./lib/http.js";
import { logger } from "./lib/logger.js";
import { registerRoutes } from "./routes/index.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY);
  app.use(helmet());
  app.use(
    cors({
      origin: config.SITE_ORIGINS,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      maxAge: 86_400,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(
    pinoHttp({
      logger,
      // Keep request logs small and avoid dumping headers by default.
      // Authentication and address headers are additionally redacted in
      // logger.ts as a second line of defence.
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url,
            query: req.query,
            remoteAddress: req.remoteAddress,
            remotePort: req.remotePort,
          };
        },
        res(res) {
          return { statusCode: res.statusCode };
        },
      },
    }),
  );

  app.get("/", (_req, res) => {
    res.json({
      name: "fcs-backend",
      version: "0.1.0",
      status: "ok",
    });
  });

  app.get("/health", async (req, res) => {
    try {
      const db = await pingDatabase();
      res.json({ ok: true, db: "up", time: db.now });
    } catch (error) {
      req.log.error({ err: error }, "Database health check failed");
      res.status(503).json({ ok: false, db: "down" });
    }
  });

  registerRoutes(app);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
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

    req.log.error({ err: error }, "Unhandled API error");
    res.status(500).json({ error: "Internal server error" });
  };

  app.use(errorHandler);

  return app;
}
