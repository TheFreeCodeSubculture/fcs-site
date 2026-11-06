const SITE = "https://thefreecodesubculture.github.io/fcs-site";
const INK = "#000000";
const PAPER = "#ffffff";
const ACCENT = "#fcce37";
const BG = "#fff7e4";
const MUTED = "#555248";
const HEAD = "'Arial Black', 'Helvetica Neue', Arial, sans-serif";
const BODY = "Arial, 'Helvetica Neue', Helvetica, sans-serif";
const MONO = "'Courier New', Courier, monospace";

const esc = (value: string) =>
  String(value).replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );

function layout(tag: string, title: string, inner: string, footer: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${BG};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG};"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;"><tr><td style="background:${INK};padding:0 6px 6px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER};border:3px solid ${INK};">
  <tr><td style="background:${ACCENT};border-bottom:3px solid ${INK};padding:16px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="middle" style="font-family:${HEAD};font-size:15px;letter-spacing:0.5px;text-transform:uppercase;color:${INK};">The Free Code Subculture</td>
      <td valign="middle" align="right" style="font-family:${MONO};font-size:12px;font-weight:bold;white-space:nowrap;color:${INK};">${esc(tag)}</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:32px 28px 28px;">
    <h1 style="margin:0 0 18px;font-family:${HEAD};font-size:26px;line-height:1.2;color:${INK};">${esc(title)}</h1>
    ${inner}
  </td></tr>
  <tr><td style="border-top:3px solid ${INK};padding:16px 28px;font-family:${MONO};font-size:12px;line-height:1.6;color:${MUTED};">${footer}</td></tr>
</table></td></tr></table></td></tr></table></body></html>`;
}

const para = (html: string) =>
  `<p style="margin:0 0 16px;font-family:${BODY};font-size:16px;line-height:1.55;color:${INK};">${html}</p>`;

const button = (label: string, href: string) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr><td style="background:${INK};padding:0 4px 4px 0;">
  <a href="${esc(href)}" style="display:block;background:${ACCENT};border:3px solid ${INK};padding:14px 26px;font-family:${HEAD};font-size:15px;letter-spacing:0.5px;text-transform:uppercase;color:${INK};text-decoration:none;">${esc(label)} &rarr;</a>
</td></tr></table>`;

const footer = `You received this because someone used your email address on the FCS site. If that was not you, ignore this email.`;

export function resetEmail(name: string, url: string) {
  const subject = "Reset your FCS password";
  const html = layout("// PASSWORD", "Reset your password",
    para(`Hi ${esc(name)},`) +
    para("Use the button below to choose a new password. The link expires in one hour and can be used once.") +
    button("Choose a new password", url) +
    para(`<span style="font-size:13px;color:${MUTED};">If you did not ask for this, you can ignore this email. Your password will not change.</span>`),
    footer);
  const text = `Hi ${name},\n\nReset your FCS password here (expires in one hour):\n${url}\n\nIf you did not ask for this, ignore this email.`;
  return { subject, html, text };
}

export function verificationEmail(name: string, url: string) {
  const subject = "Verify your FCS member account";
  const html = layout("// MEMBER", "Verify your email",
    para(`Hi ${esc(name)},`) +
    para("Confirm your email address to activate your FCS member account. The link expires in 24 hours and can be used once.") +
    button("Verify my email", url) +
    para(`<span style="font-size:13px;color:${MUTED};">If you did not create an account, ignore this email and nothing will happen.</span>`),
    footer);
  const text = `Hi ${name},\n\nVerify your FCS member account here (expires in 24 hours):\n${url}\n\nIf you did not create an account, ignore this email.`;
  return { subject, html, text };
}

export function inviteEmail(role: "admin" | "editor", url: string) {
  const subject = "You are invited to the FCS admin panel";
  const html = layout("// INVITE", "You are invited",
    para(`You have been invited to help maintain the FCS site as an <strong>${esc(role)}</strong>.`) +
    para("Choose a password to activate your account. The invite expires in seven days.") +
    button("Accept the invite", url) +
    para(`<span style="font-size:13px;color:${MUTED};">If you were not expecting this, you can ignore this email.</span>`),
    `${footer} Invite sent from ${esc(SITE.replace("https://", ""))}.`);
  const text = `You have been invited to the FCS admin panel as an ${role}.\n\nChoose a password here (expires in seven days):\n${url}\n\nIf you were not expecting this, ignore this email.`;
  return { subject, html, text };
}

export function testEmail(to: string) {
  const subject = "FCS backend email test";
  const html = layout("// TEST", "Email is working",
    para(`This is a test email sent to ${esc(to)}.`) +
    para("If you can read this, the FCS backend can send email through Gmail."),
    footer);
  const text = `This is a test email sent to ${to}. If you can read this, the FCS backend can send email through Gmail.`;
  return { subject, html, text };
}

export interface MailEvent {
  id: string;
  title: string;
  starts_at: string;
  link: string | null;
  group_name: string | null;
}

export function listName(event: MailEvent | null): string {
  return event ? `“${event.title}”` : "all FCS events";
}

function when(iso: string): string {
  return `${new Date(iso).toLocaleString("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  })} IST`;
}

function eventBox(event: MailEvent): string {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border:2px solid ${INK};"><tr>
  <td width="8" style="background:${ACCENT};border-right:2px solid ${INK};"></td>
  <td style="padding:12px 14px;font-family:${BODY};color:${INK};">
    ${event.group_name ? `<div style="font-family:${MONO};font-size:12px;color:${MUTED};text-transform:uppercase;">${esc(event.group_name)}</div>` : ""}
    <div style="font-family:${HEAD};font-size:17px;">${esc(event.title)}</div>
    <div style="font-size:14px;margin-top:4px;">${esc(when(event.starts_at))}</div>
  </td></tr></table>`;
}

const linkify = (text: string) =>
  esc(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#000;">$1</a>')
    .replace(/\n/g, "<br>");

export function subscriptionConfirmEmail(
  email: string,
  event: MailEvent | null,
  url: string,
) {
  const list = listName(event);
  const subject = `Confirm: updates about ${list}`;
  const html = layout("// SUBSCRIBE", "Confirm your subscription",
    para(`Confirm that <strong>${esc(email)}</strong> should get email updates about ${esc(list)}.`) +
    (event ? eventBox(event) : "") +
    button("Confirm", url) +
    para(`<span style="font-size:13px;color:${MUTED};">If you did not ask for this, ignore this email and you will not hear from us.</span>`),
    `You got this because ${esc(email)} was entered on the FCS site.`);
  const text = `Confirm that ${email} should get updates about ${list}:\n${url}\n\nIf you did not ask for this, ignore this email.`;
  return { subject, html, text };
}

export function eventUpdateEmail(
  subject: string,
  message: string,
  event: MailEvent | null,
  unsubscribeUrl: string | null,
) {
  const list = listName(event);
  const html = layout(
    event ? "// EVENT UPDATE" : "// UPDATE",
    subject,
    (event ? eventBox(event) : "") +
      para(linkify(message)) +
      (event?.link ? button("Open the event", event.link) : ""),
    unsubscribeUrl
      ? `You are getting this because you subscribed to updates about ${esc(list)}.<br><a href="${esc(unsubscribeUrl)}" style="color:${INK};font-weight:bold;">Unsubscribe</a>`
      : "This is a test send, only to you.",
  );
  const text = `${subject}\n\n${event ? `${event.title}, ${when(event.starts_at)}\n\n` : ""}${message}\n\n${unsubscribeUrl ? `Unsubscribe: ${unsubscribeUrl}` : ""}`;
  return { subject, html, text };
}

