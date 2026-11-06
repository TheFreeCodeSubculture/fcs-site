import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/index.js";
import { withActor } from "../db/tx.js";
import { config } from "../config.js";
import { requireAdmin } from "../middleware/auth.js";
import { HttpError, asyncHandler, parseBody } from "../lib/http.js";
import { isMailConfigured, sendMail } from "../services/mailer.js";
import {
  eventUpdateEmail,
  listName,
  subscriptionConfirmEmail,
  type MailEvent,
} from "../email/templates.js";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESEND_AFTER_MS = 10 * 60 * 1000;
const SIGNUPS_PER_HOUR = 100;
const SITE = config.PUBLIC_SITE_URL.replace(/\/$/, "");

export const eventMailRouter = Router();

const SubscribeSchema = z.object({
  action: z.literal("subscribe"),
  email: z.string().trim().max(254),
  event_id: z.string().uuid().nullable().optional(),
  company: z.string().optional(),
});

const lookupListSchema = z.object({
  action: z.literal("lookup"),
  token: z.string().uuid("This link is not valid."),
});

const confirmSchema = z.object({
  action: z.literal("confirm"),
  token: z.string().uuid("This link is not valid."),
});

const unsubscribeSchema = z.object({
  action: z.literal("unsubscribe"),
  token: z.string().uuid("This link is not valid."),
  everything: z.boolean().optional(),
});

type SubscriptionRow = {
  id: string;
  email: string;
  confirmed_at: string | null;
  event_id: string | null;
  eid: string | null;
  title: string | null;
  starts_at: string | null;
  link: string | null;
  group_name: string | null;
};

async function findEvent(id: string | null | undefined, includeDrafts: boolean): Promise<MailEvent | null> {
  if (!id) return null;
  if (!UUID_RE.test(id)) throw new HttpError(404, "That event does not exist.");

  const result = await pool.query<MailEvent>(
    includeDrafts
      ? `select id, title, starts_at, link, group_name from events where id = $1`
      : `select id, title, starts_at, link, group_name
           from events where id = $1 and stage <> 'draft'`,
    [id],
  );

  const event = result.rows[0];
  if (!event) throw new HttpError(404, "That event does not exist.");
  return event;
}

async function byToken(token: string): Promise<SubscriptionRow> {
  const result = await pool.query<SubscriptionRow>(
    `select s.id, s.email, s.confirmed_at, s.event_id,
            e.id as eid, e.title, e.starts_at, e.link, e.group_name
       from subscriptions s
       left join events e on e.id = s.event_id
      where s.token = $1
      limit 1`,
    [token],
  );

  const row = result.rows[0];
  if (!row) {
    throw new HttpError(404, "This link has already been used, or the subscription was removed.");
  }
  return row;
}

function eventOf(row: SubscriptionRow): MailEvent | null {
  if (!row.eid || !row.title || !row.starts_at) return null;
  return {
    id: row.eid,
    title: row.title,
    starts_at: row.starts_at,
    link: row.link,
    group_name: row.group_name,
  };
}

const mask = (email: string) =>
  email.replace(/^(.)(.*)(@.*)$/, (_, first, rest, domain) =>
    first + "•".repeat(Math.min(rest.length, 6)) + domain,
  );

const unsubscribeURL = (token: string) => `${SITE}/subscribe.html?unsubscribe=${token}`;

async function subscribe(body: z.infer<typeof SubscribeSchema>) {
  if (body.company) return { ok: true };
  const email = body.email.toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new HttpError(400, "That does not look like an email address.");
  }

  const event = await findEvent(body.event_id, false);
  const existing = await pool.query<{
    id: string;
    token: string;
    confirmed_at: string | null;
    created_at: string;
  }>(
    `select id, token, confirmed_at, created_at
       from subscriptions
      where lower(email) = lower($1)
        and event_id is not distinct from $2::uuid
      limit 1`,
    [email, event?.id ?? null],
  );

  const row = existing.rows[0];
  if (row?.confirmed_at) return { ok: true };
  if (row && Date.now() - new Date(row.created_at).getTime() < RESEND_AFTER_MS) {
    return { ok: true };
  }

  const recent = await pool.query<{ count: string }>(
    `select count(*)::text as count
       from subscriptions
      where confirmed_at is null and created_at > now() - interval '1 hour'`,
  );
  if (Number(recent.rows[0]?.count || 0) >= SIGNUPS_PER_HOUR) {
    throw new HttpError(429, "Too many signups right now. Try again in an hour.");
  }

  let token = row?.token;
  if (row) {
    await pool.query("update subscriptions set created_at = now() where id = $1", [row.id]);
  } else {
    const inserted = await pool.query<{ token: string }>(
      `insert into subscriptions (email, event_id)
       values ($1, $2)
       returning token`,
      [email, event?.id ?? null],
    );
    token = inserted.rows[0].token;
  }

  const confirmUrl = `${SITE}/subscribe.html?confirm=${token}`;

  if (!isMailConfigured()) {
    throw new HttpError(503, "Email updates are not configured yet.");
  }

  try {
    await sendMail({
      to: email,
      ...subscriptionConfirmEmail(email, event, confirmUrl),
    });
  } catch (error) {
    if (row) {
      await pool.query("update subscriptions set created_at = $1 where id = $2", [
        row.created_at,
        row.id,
      ]);
    } else {
      await pool.query("delete from subscriptions where token = $1", [token]);
    }
    console.error("Could not send the subscription confirmation", error);
    throw new HttpError(502, "Could not send the confirmation email. Try again in a minute.");
  }

  return { ok: true };
}

async function lookup(token: string) {
  const row = await byToken(token);
  return {
    email: mask(row.email),
    list: listName(eventOf(row)),
    confirmed: Boolean(row.confirmed_at),
  };
}

async function confirm(token: string) {
  const row = await byToken(token);
  if (!row.confirmed_at) {
    await pool.query("update subscriptions set confirmed_at = now() where id = $1", [row.id]);
  }
  if (row.event_id === null) {
    await pool.query(
      "update profiles set email_updates = true where lower(email) = lower($1)",
      [row.email],
    );
  }
  return { email: mask(row.email), list: listName(eventOf(row)) };
}

async function unsubscribe(token: string, everything: boolean) {
  const row = await byToken(token);
  const event = eventOf(row);

  if (everything) {
    await pool.query("delete from subscriptions where lower(email) = lower($1)", [row.email]);
  } else {
    await pool.query("delete from subscriptions where id = $1", [row.id]);
  }

  if (everything || row.event_id === null) {
    await pool.query(
      "update profiles set email_updates = false where lower(email) = lower($1)",
      [row.email],
    );
  }

  return {
    email: mask(row.email),
    list: everything ? "every FCS list" : listName(event),
  };
}

eventMailRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const action = req.body?.action;

    if (action === "subscribe") {
      const body = parseBody(SubscribeSchema, req.body);
      res.json(await subscribe(body));
      return;
    }

    if (action === "lookup") {
      const body = parseBody(lookupListSchema, req.body);
      res.json(await lookup(body.token));
      return;
    }

    if (action === "confirm") {
      const body = parseBody(confirmSchema, req.body);
      res.json(await confirm(body.token));
      return;
    }

    if (action === "unsubscribe") {
      const body = parseBody(unsubscribeSchema, req.body);
      res.json(await unsubscribe(body.token, body.everything === true));
      return;
    }

    throw new HttpError(400, "Unknown action.");
  }),
);

/* ---- admin subscribers ----------------------------------------------- */

export const adminMailRouter = Router();

const AddSubscribersSchema = z.object({
  emails: z.array(z.string().trim()).min(1, "Add at least one email address."),
  eventId: z.string().uuid().nullable().optional(),
});

const SendSchema = z.object({
  event_id: z.string().uuid().nullable().optional(),
  subject: z.string().trim().min(1, "Write a subject.").max(150),
  body: z.string().trim().min(1, "Write a message.").max(20_000),
  test: z.boolean().optional(),
});

adminMailRouter.get(
  "/subscriptions",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `select id, email, event_id, confirmed_at, added_by, created_at
         from subscriptions
        order by created_at desc`,
    );
    res.json(result.rows);
  }),
);

adminMailRouter.post(
  "/subscriptions",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(AddSubscribersSchema, req.body);
    const eventId = body.eventId ?? null;
    if (eventId) await findEvent(eventId, true);

    const emails = [...new Set(
      body.emails.map((email) => email.trim().toLowerCase()).filter((email) => EMAIL_RE.test(email)),
    )];
    if (!emails.length) throw new HttpError(400, "None of those look like email addresses.");

    let added = 0;
    await withActor(req.user!, async (client) => {
      for (const email of emails) {
        const result = await client.query(
          `insert into subscriptions (email, event_id, confirmed_at, added_by)
           values ($1, $2, now(), $3)
           on conflict (email, event_id) do nothing
           returning id`,
          [email, eventId, req.user!.id],
        );
        added += result.rowCount ?? 0;
      }
    });

    res.status(201).json({ added });
  }),
);

adminMailRouter.delete(
  "/subscriptions/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      "delete from subscriptions where id = $1 returning id",
      [req.params.id],
    );
    if (!result.rowCount) throw new HttpError(404, "That subscriber does not exist.");
    res.status(204).end();
  }),
);

adminMailRouter.get(
  "/email-sends",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `select id, title, body, event_id, sent_by_email, recipients, failed, created_at
         from email_sends
        order by created_at desc
        limit 50`,
    );
    res.json(result.rows);
  }),
);

adminMailRouter.post(
  "/event-mail",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(SendSchema, req.body);
    const event = await findEvent(body.event_id, true);

    if (body.test) {
      if (!req.user?.email) throw new HttpError(400, "Your account has no email address.");
      const email = eventUpdateEmail(`[Test] ${body.subject}`, body.body, event, null);
      await sendMail({ to: req.user.email, ...email });
      res.json({ sent: 1, failed: 0, test: true });
      return;
    }

    const result = await pool.query<{ email: string; token: string; event_id: string | null }>(
      `select email, token, event_id
         from subscriptions
        where confirmed_at is not null
          and ($1::uuid is null or event_id = $1 or event_id is null)`,
      [event?.id ?? null],
    );

    if (!result.rowCount) {
      throw new HttpError(400, "Nobody is on this list yet.");
    }

    const recipients = new Map<string, string>();
    for (const row of result.rows) {
      if (!recipients.has(row.email) || row.event_id === event?.id) {
        recipients.set(row.email, row.token);
      }
    }

    let sent = 0;
    let failed = 0;

    for (const [email, token] of recipients) {
      try {
        const message = eventUpdateEmail(
          body.subject,
          body.body,
          event,
          unsubscribeURL(token),
        );
        await sendMail({ to: email, ...message });
        sent++;
      } catch (error) {
        failed++;
        console.error("Event update send failed", error);
      }
    }

    await withActor(req.user!, async (client) => {
      await client.query(
        `insert into email_sends
           (title, body, event_id, sent_by_email, recipients, failed)
         values ($1, $2, $3, $4, $5, $6)`,
        [body.subject, body.body, event?.id ?? null, req.user!.email, sent, failed],
      );
    });

    res.json({ sent, failed });
  }),
);
