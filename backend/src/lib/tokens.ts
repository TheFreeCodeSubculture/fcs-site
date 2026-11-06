import { createHmac, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import type { AuthUser, Role } from "../types.js";

const ACCESS_TTL = "15m";
const REFRESH_DAYS = 30;

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: Role;
}

export function signAccessToken(user: Pick<AuthUser, "id" | "email" | "role">): string {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    config.JWT_SECRET,
    {
      expiresIn: ACCESS_TTL,
      issuer: "fcs-backend",
      audience: "fcs-admin",
    },
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = jwt.verify(token, config.JWT_SECRET, {
    issuer: "fcs-backend",
    audience: "fcs-admin",
  });

  if (typeof payload === "string" || typeof payload.sub !== "string") {
    throw new Error("Invalid token");
  }

  return {
    sub: payload.sub,
    email: String(payload.email || ""),
    role: payload.role as Role,
  };
}

export function hashToken(rawToken: string): string {
  return createHmac("sha256", config.REFRESH_TOKEN_PEPPER)
    .update(rawToken)
    .digest("hex");
}

export function createRefreshToken(): {
  raw: string;
  hash: string;
  expiresAt: Date;
} {
  const raw = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);
  return { raw, hash: hashToken(raw), expiresAt };
}

export function createOpaqueToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw) };
}
