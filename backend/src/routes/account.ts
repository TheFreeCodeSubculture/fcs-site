import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/index.js";
import { withActor } from "../db/tx.js";
import { requireAuth, requireVerified } from "../middleware/auth.js";
import { HttpError, asyncHandler, parseBody } from "../lib/http.js";
import type { AuthUser } from "../types.js";

export const accountRouter = Router();
accountRouter.use(requireAuth, requireVerified);

const optionalHttpURL = (label: string) =>
  z
    .string()
    .trim()
    .max(500, `${label} is too long.`)
    .refine(
      (value) => !value || /^https?:\/\//i.test(value),
      `${label} must start with http:// or https://.`,
    )
    .transform((value) => value || null);

const optionalAvatarURL = z
  .string()
  .trim()
  .max(500, "The avatar URL is too long.")
  .refine(
    (value) => !value || /^https:\/\//i.test(value),
    "The avatar URL must start with https://.",
  )
  .transform((value) => value || null);

const optionalGitHub = z
  .string()
  .trim()
  .max(40, "The GitHub username is too long.")
  .transform((value) => value.replace(/^@/, ""))
  .refine(
    (value) => !value || /^[A-Za-z0-9-]{1,39}$/.test(value),
    "A GitHub username can only use letters, numbers and hyphens.",
  )
  .transform((value) => value || null);

const ProfileSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(1, "Enter a display name.")
    .max(80, "Keep the display name under 80 characters.")
    .optional(),
  bio: z
    .string()
    .trim()
    .max(1200, "Keep the bio under 1200 characters.")
    .transform((value) => value || null)
    .optional(),
  website_url: optionalHttpURL("The website URL").optional(),
  github_username: optionalGitHub.optional(),
  avatar_url: optionalAvatarURL.optional(),
  directory_opted_in: z.boolean().optional(),
});

const EmailPreferencesSchema = z.object({
  emailUpdates: z.boolean(),
});

type AccountProfile = {
  id: string;
  email: string;
  display_name: string | null;
  bio: string | null;
  website_url: string | null;
  github_username: string | null;
  avatar_url: string | null;
  directory_opted_in: boolean;
  email_updates: boolean;
  role: string;
  created_at: string;
  email_verified_at: string | null;
};

const PROFILE_COLUMNS = `
  id, email, display_name, bio, website_url, github_username, avatar_url,
  directory_opted_in, email_updates, role, created_at, email_verified_at
`;

async function readProfile(userId: string): Promise<AccountProfile> {
  const result = await pool.query<AccountProfile>(
    `select ${PROFILE_COLUMNS} from profiles where id = $1`,
    [userId],
  );
  const profile = result.rows[0];
  if (!profile) throw new HttpError(404, "That account does not exist.");
  return profile;
}

accountRouter.get(
  "/profile",
  asyncHandler(async (req, res) => {
    res.json(await readProfile(req.user!.id));
  }),
);

accountRouter.patch(
  "/profile",
  asyncHandler(async (req, res) => {
    const body = parseBody(ProfileSchema, req.body);

    if (Object.values(body).every((value) => value === undefined)) {
      throw new HttpError(400, "Send at least one field to update.");
    }

    const profile = await withActor(req.user!, async (client) => {
      const fields: string[] = [];
      const values: unknown[] = [];
      for (const [field, value] of Object.entries(body)) {
        if (value !== undefined) {
          values.push(value);
          fields.push(`${field} = $${values.length}`);
        }
      }
      values.push(req.user!.id);

      const result = await client.query<AccountProfile>(
        `update profiles
            set ${fields.join(", ")}
          where id = $${values.length}
          returning ${PROFILE_COLUMNS}`,
        values,
      );

      const row = result.rows[0];
      if (!row) throw new HttpError(404, "That account does not exist.");
      return row;
    });

    res.json(profile);
  }),
);

accountRouter.patch(
  "/email-preferences",
  asyncHandler(async (req, res) => {
    const body = parseBody(EmailPreferencesSchema, req.body);
    const user = req.user as AuthUser;

    await withActor(user, async (client) => {
      await client.query(
        "update profiles set email_updates = $1 where id = $2",
        [body.emailUpdates, user.id],
      );

      if (body.emailUpdates) {
        await client.query(
          `insert into subscriptions (email, event_id, confirmed_at, added_by)
           values ($1, null, now(), $2)
           on conflict (email, event_id) do update set confirmed_at = now()`,
          [user.email, user.id],
        );
      } else {
        await client.query(
          "delete from subscriptions where lower(email) = lower($1) and event_id is null",
          [user.email],
        );
      }
    });

    res.json({ emailUpdates: body.emailUpdates });
  }),
);
