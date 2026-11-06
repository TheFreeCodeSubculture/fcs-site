import pg from "pg";
import { config } from "../config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export async function pingDatabase(): Promise<{ now: string }> {
  const result = await pool.query<{ now: string }>(
    "select now()::text as now",
  );
  return result.rows[0];
}
