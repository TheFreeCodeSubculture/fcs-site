import dotenv from "dotenv";
import { z } from "zod";

/*
 * Production reads /srv/fcs-api/shared/.env, which lives outside the release
 * directory. Local development can use backend/.env instead.
 */
dotenv.config({
  path: process.env.FCS_ENV_FILE || "/srv/fcs-api/shared/.env",
});
dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().max(65535).default(5050),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SITE_ORIGINS: z
    .string()
    .default("http://localhost:8000")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  PUBLIC_API_URL: z.string().min(1).default("http://localhost:5050"),
  PUBLIC_SITE_URL: z
    .string()
    .min(1)
    .default("https://thefreecodesubculture.github.io/fcs-site"),
  MEDIA_DIR: z.string().min(1).default("./media"),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters")
    .default("development-only-jwt-secret-change-me"),
  REFRESH_TOKEN_PEPPER: z
    .string()
    .min(32, "REFRESH_TOKEN_PEPPER must be at least 32 characters")
    .default("development-only-refresh-pepper-change-me"),
  GMAIL_USER: z.string().optional(),
  GMAIL_APP_PASSWORD: z.string().optional(),
  MAIL_FROM_NAME: z.string().default("The Free Code Subculture"),
  GITHUB_ASSETS_TOKEN: z.string().optional(),
  GITHUB_DISPATCH_TOKEN: z.string().optional(),
  UNSPLASH_ACCESS_KEY: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === "production",
  isTest: parsed.data.NODE_ENV === "test",
};
