"use strict";

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const nodemailer = require("nodemailer");
const { MailtrapTransport } = require("mailtrap");

const VERIFIED_FROM = "noreply@ashiru-ali.com";

function resolveEnvPath() {
  const candidates = [
    path.join(__dirname, "..", "..", ".env"),
    path.join(process.cwd(), ".env"),
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

/**
 * PM2/systemd env wins over dotenv by default. Re-apply mail keys from the
 * on-disk .env so password reset uses the Sending token and verified From.
 */
function applyMailEnvFromFile() {
  const envPath = resolveEnvPath();
  try {
    const parsed = dotenv.parse(fs.readFileSync(envPath));
    const keys = [
      "MAILTRAP_TOKEN",
      "MAIL_FROM",
      "MAIL_FROM_NAME",
      "PUBLIC_FRONTEND_URL",
      "KYC_FRONTEND_URL",
      "KYC_FRONTEND_URL_PROD",
      "KYC_FRONTEND_URL_DEV",
      "COMPANY_NAME",
      "COMPANY_WEBSITE",
      "COMPANY_EMAIL",
      "COMPANY_PHONE",
      "COMPANY_TWITTER",
      "COMPANY_INSTAGRAM",
      "COMPANY_LINKEDIN",
      "COMPANY_FACEBOOK",
      "COMPANY_FACESBOOK",
    ];
    for (const key of keys) {
      if (parsed[key] != null && String(parsed[key]).trim()) {
        process.env[key] = String(parsed[key]).trim();
      }
    }
  } catch (err) {
    console.warn("[mail] could not read", envPath, err.message);
  }
}

function fromEmail() {
  const raw = String(process.env.MAIL_FROM || VERIFIED_FROM);
  const angle = raw.match(/<([^>]+)>/);
  const email = (angle ? angle[1] : raw)
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase();
  const domain = email.split("@")[1] || "";
  if (domain !== "ashiru-ali.com") return VERIFIED_FROM;
  return email;
}

function getSmtpFromEnv() {
  const host = process.env.SMTP_HOST || process.env.MAIL_HOST;
  const user = process.env.SMTP_USER || process.env.MAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.MAIL_PASS;
  if (!host || !user || !pass) return null;
  const port = Number(process.env.SMTP_PORT || process.env.MAIL_PORT || 587);
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });
}

function getLiveMailTransport() {
  applyMailEnvFromFile();
  const token = String(process.env.MAILTRAP_TOKEN || "").trim();
  if (token) {
    return {
      transport: nodemailer.createTransport(MailtrapTransport({ token })),
      mode: "mailtrap-api",
    };
  }
  const smtp = getSmtpFromEnv();
  if (smtp) return { transport: smtp, mode: "smtp" };
  throw new Error(
    "Live email is not configured. Set MAILTRAP_TOKEN (Mailtrap Sending API) or SMTP_HOST/SMTP_USER/SMTP_PASS.",
  );
}

async function sendLiveEmail({ to, subject, html, text, category }) {
  applyMailEnvFromFile();
  const token = String(process.env.MAILTRAP_TOKEN || "").trim();
  const email = fromEmail();
  const rawName =
    process.env.MAIL_FROM_NAME || process.env.COMPANY_NAME || "Nexifour LLC";
  const name = /flowbooks/i.test(String(rawName))
    ? "Nexifour LLC"
    : String(rawName).trim() || "Nexifour LLC";
  if (!token) {
    throw new Error("MAILTRAP_TOKEN is not set in .env");
  }

  console.log("[mail] send.api.mailtrap.io", {
    from: email,
    to,
    token_len: token.length,
    token_prefix: token.slice(0, 4),
  });

  const res = await fetch("https://send.api.mailtrap.io/api/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: { email, name },
      to: [{ email: to }],
      subject,
      html,
      text: text || undefined,
      category: category || undefined,
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    const err = new Error(`Mailtrap ${res.status}: ${body}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  try {
    return JSON.parse(body);
  } catch {
    return { raw: body };
  }
}

function describeMailSendError(err) {
  if (err?.body) return String(err.body);
  const msg = String(err?.message || err || "");
  if (/unauthorized/i.test(msg)) {
    return (
      "Mailtrap Unauthorized: MAILTRAP_TOKEN must be a Sending API token " +
      "(Email → Sending → API Tokens), not an Email Testing inbox token. " +
      "MAIL_FROM must be on the verified domain, e.g. noreply@ashiru-ali.com. " +
      "Restart the API after changing env."
    );
  }
  return msg;
}

module.exports = {
  applyMailEnvFromFile,
  getSmtpFromEnv,
  getLiveMailTransport,
  sendLiveEmail,
  describeMailSendError,
};
