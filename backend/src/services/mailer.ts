import nodemailer, { type SendMailOptions, type Transporter } from "nodemailer";
import { config } from "../config.js";

let transport: Transporter | null = null;

export function isMailConfigured(): boolean {
  return Boolean(config.GMAIL_USER && config.GMAIL_APP_PASSWORD);
}

function mailer(): Transporter {
  if (!isMailConfigured()) {
    throw new Error("Email is not configured.");
  }

  transport ??= nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    pool: true,
    maxConnections: 1,
    maxMessages: 100,
    auth: {
      user: config.GMAIL_USER!,
      pass: config.GMAIL_APP_PASSWORD!.replace(/\s+/g, ""),
    },
    tls: { minVersion: "TLSv1.2" },
  });

  return transport;
}

export async function sendMail(message: SendMailOptions) {
  if (!isMailConfigured()) {
    throw new Error("Email is not configured: set GMAIL_USER and GMAIL_APP_PASSWORD.");
  }

  return mailer().sendMail({
    from: {
      name: config.MAIL_FROM_NAME,
      address: config.GMAIL_USER!,
    },
    ...message,
  });
}

export async function verifyMailer(): Promise<boolean> {
  if (!isMailConfigured()) return false;
  await mailer().verify();
  return true;
}
