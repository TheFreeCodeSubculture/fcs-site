import type { Express } from "express";
import { accountRouter } from "./account.routes.js";
import {
  analyticsAdminRouter,
  analyticsTrackRouter,
} from "./analytics.routes.js";
import { authRouter } from "./auth.routes.js";
import {
  blogAdminRouter,
  blogPublicRouter,
} from "./blog.routes.js";
import {
  contentAdminRouter,
  contentPublicRouter,
} from "./content.routes.js";
import { githubAdminRouter, githubPublicRouter } from "./github.routes.js";
import { integrationsRouter } from "./integrations.routes.js";
import {
  mailingAdminRouter,
  mailingPublicRouter,
  mailingTeamRouter,
} from "./mailing.routes.js";
import { mediaAdminRouter } from "./media.routes.js";
import { teamRouter } from "./team.routes.js";

/**
 * The single place where API routes are mounted. Keep more-specific admin
 * routers before the generic content CRUD router, which matches /:resource.
 */
export function registerRoutes(app: Express) {
  app.use("/api", analyticsTrackRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/account", accountRouter);
  app.use("/api/event-mail", mailingPublicRouter);
  app.use("/api/integrations", integrationsRouter);

  app.use("/api/public", contentPublicRouter);
  app.use("/api/public", blogPublicRouter);
  app.use("/api/public", githubPublicRouter);

  app.use("/api/admin", analyticsAdminRouter);
  app.use("/api/admin", mediaAdminRouter);
  app.use("/api/admin", githubAdminRouter);
  app.use("/api/admin", mailingAdminRouter);
  app.use("/api/admin/team", mailingTeamRouter);
  app.use("/api/admin/team", teamRouter);
  app.use("/api/admin", blogAdminRouter);
  app.use("/api/admin", contentAdminRouter);
}
