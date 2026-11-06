import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { pool } from "../db/index.js";
import { hashPassword } from "../lib/password.js";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  let email = (arg("email") || process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  let password = arg("password") || process.env.ADMIN_PASSWORD || "";
  const displayName = arg("name") || process.env.ADMIN_NAME || null;

  if (!email || !password) {
    const rl = createInterface({ input: stdin, output: stdout });
    if (!email) email = (await rl.question("Email: ")).trim().toLowerCase();
    if (!password) password = await rl.question("Password (min 10 chars): ");
    rl.close();
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }
  if (password.length < 10) {
    throw new Error("The password must be at least 10 characters.");
  }

  const passwordHash = await hashPassword(password);

  const existing = await pool.query<{ id: string }>(
    "select id from profiles where lower(email) = lower($1) limit 1",
    [email],
  );

  if (existing.rows[0]) {
    await pool.query(
      `update profiles
          set password_hash = $1,
              display_name = coalesce($2, display_name),
              role = 'admin',
              must_reset = false
        where id = $3`,
      [passwordHash, displayName, existing.rows[0].id],
    );
    console.log(`Updated admin ${email}`);
  } else {
    await pool.query(
      `insert into profiles (email, password_hash, display_name, role)
       values ($1, $2, $3, 'admin')`,
      [email, passwordHash, displayName],
    );
    console.log(`Created admin ${email}`);
  }

  await pool.end();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
