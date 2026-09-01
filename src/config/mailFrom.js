"use strict";

const VERIFIED_DOMAIN = "ashiru-ali.com";
const DEFAULT_FROM = `noreply@${VERIFIED_DOMAIN}`;

function extractEmail(raw) {
  const value = String(raw || "")
    .trim()
    .replace(/^["']|["']$/g, "");
  const angle = value.match(/<([^>]+)>/);
  return (angle ? angle[1] : value).trim().toLowerCase();
}

/** Mailtrap only delivers when From is on a verified sending domain. */
function mailFrom(displayName) {
  const raw = displayName || process.env.MAIL_FROM_NAME || process.env.COMPANY_NAME || "Nexifour LLC";
  const name = /flowbooks/i.test(String(raw)) ? "Nexifour LLC" : String(raw).trim() || "Nexifour LLC";
  let email = extractEmail(process.env.MAIL_FROM || DEFAULT_FROM);
  const domain = email.split("@")[1] || "";
  if (domain !== VERIFIED_DOMAIN) {
    console.warn(
      `[mail] MAIL_FROM ${email} is not on verified domain ${VERIFIED_DOMAIN}; using ${DEFAULT_FROM}`,
    );
    email = DEFAULT_FROM;
  }
  return `"${name}" <${email}>`;
}

module.exports = { mailFrom };
