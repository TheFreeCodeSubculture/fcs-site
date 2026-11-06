import type { PoolClient } from "pg";
import { pool } from "./index.js";
import type { AuthUser } from "../types.js";

/**
 * Run a write in one transaction and make the actor available to the
 * activity-log trigger through the app.actor_id / app.actor_email settings.
 */
export async function withActor<T>(
  actor: Pick<AuthUser, "id" | "email"> | null,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("begin");
    if (actor) {
      await client.query(
        "select set_config('app.actor_id', $1, true), set_config('app.actor_email', $2, true)",
        [actor.id, actor.email],
      );
    }
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
