"use strict";

const nodemailer = require("nodemailer");
const { MailtrapTransport } = require("mailtrap");

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

/**
 * Live inbox delivery (password reset, KYC, CRM outreach).
 * Prefer Mailtrap Sending API when MAILTRAP_TOKEN is set.
 */
function getLiveMailTransport() {
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

function describeMailSendError(err) {
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
  getSmtpFromEnv,
  getLiveMailTransport,
  describeMailSendError,
};
