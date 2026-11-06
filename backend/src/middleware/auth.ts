import type { NextFunction, Request, Response } from "express";
import { pool } from "../db/index.js";
import { HttpError, asyncHandler } from "../lib/http.js";
import { verifyAccessToken } from "../lib/tokens.js";
import type { AuthUser, Role } from "../types.js";

export const requireAuth = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) {
      throw new HttpError(401, "Sign in first.");
    }

    let userId: string;
    try {
      userId = verifyAccessToken(header.slice(7)).sub;
    } catch {
      throw new HttpError(401, "Your session expired. Sign in again.");
    }

    const result = await pool.query<AuthUser>(
      `select id, email, display_name, role, can_view_analytics,
              core_member_id, must_reset
         from profiles
        where id = $1`,
      [userId],
    );

    const user = result.rows[0];
    if (!user) {
      throw new HttpError(401, "This account no longer exists.");
    }

    req.user = user;
    next();
  },
);

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(new HttpError(401, "Sign in first."));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new HttpError(403, "Your role does not allow this action."));
      return;
    }
    next();
  };
}

export const requireEditor = [requireAuth, requireRole("admin", "editor")];
export const requireAdmin = [requireAuth, requireRole("admin")];

export function requireAnalytics(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) {
    next(new HttpError(401, "Sign in first."));
    return;
  }
  if (req.user.role === "admin" || (req.user.role === "editor" && req.user.can_view_analytics)) {
    next();
    return;
  }
  next(new HttpError(403, "You do not have access to analytics."));
}
