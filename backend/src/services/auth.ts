import type { Pool, PoolClient } from "pg";
import { pool } from "../db/index.js";
import { createRefreshToken, signAccessToken } from "../lib/tokens.js";
import type { AuthUser } from "../types.js";

type Db = Pick<Pool, "query"> | PoolClient;

export function publicUser(user: AuthUser) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    role: user.role,
    can_view_analytics: user.can_view_analytics,
    core_member_id: user.core_member_id,
    must_reset: user.must_reset,
  };
}

export async function issueSession(user: AuthUser, db: Db = pool) {
  const refresh = createRefreshToken();

  await db.query(
    `insert into auth_refresh_tokens (user_id, token_hash, expires_at)
     values ($1, $2, $3)`,
    [user.id, refresh.hash, refresh.expiresAt],
  );

  return {
    accessToken: signAccessToken(user),
    refreshToken: refresh.raw,
    user: publicUser(user),
  };
}
