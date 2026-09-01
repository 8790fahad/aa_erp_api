"use strict";

/** Mailtrap only delivers when From is on a verified sending domain. */
function mailFrom(displayName) {
  const name = displayName || process.env.COMPANY_NAME || "AA ERP";
  const email =
    process.env.MAIL_FROM ||
    process.env.SMTP_USER ||
    "noreply@ashiru-ali.com";
  return `"${name}" <${email}>`;
}

module.exports = { mailFrom };
