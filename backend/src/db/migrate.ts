import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./index.js";

const migrationsDir = fileURLToPath(
  new URL("../../migrations", import.meta.url),
);

async function main() {
  await pool.query(`
    create table if not exists schema_migrations (
      version    text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const applied = new Set(
    (
      await pool.query<{ version: string }>(
        "select version from schema_migrations",
      )
    ).rows.map((row) => row.version),
  );

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip    ${file}`);
      continue;
    }

    const sql = await readFile(join(migrationsDir, file), "utf8");
    const client = await pool.connect();

    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(
        "insert into schema_migrations (version) values ($1)",
        [file],
      );
      await client.query("commit");
      console.log(`applied ${file}`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  console.log("Migrations complete");
  await pool.end();
}

main().catch(async (error) => {
  console.error("Migration failed", error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
