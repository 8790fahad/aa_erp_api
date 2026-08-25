#!/usr/bin/env node
/**
 * Secret rotation helper.
 *
 * Generates cryptographically strong values for every secret AA ERP uses,
 * ready to paste into your production secret store / .env. Run this before a
 * VAPT engagement and any time a secret may have been exposed (e.g. committed
 * to git, shared, or logged).
 *
 * Usage:
 *   node scripts/rotate-secrets.js            # print a full recommended set
 *   node scripts/rotate-secrets.js --env      # print as KEY=VALUE .env lines
 *   node scripts/rotate-secrets.js --bytes 48 # change entropy (default 48)
 *
 * NOTE: This only *generates* values. You must still update them in the
 * provider dashboards (Cloudinary, Mailtrap, BulkSMS, reCAPTCHA, QuickBooks,
 * NRS/FIRS) and in your production environment, then redeploy.
 */
const crypto = require("crypto");

function token(bytes) {
  // URL-safe base64 without padding — safe for env files and headers.
  return crypto
    .randomBytes(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const args = process.argv.slice(2);
const asEnv = args.includes("--env");
const bytesIdx = args.indexOf("--bytes");
const bytes = bytesIdx !== -1 ? Number(args[bytesIdx + 1]) || 48 : 48;

// App-owned secrets we can safely regenerate here. Provider-owned secrets
// (Cloudinary/Mailtrap/etc.) must be rotated in their dashboards.
const generated = {
  JWT_SECRET_KEY: token(bytes),
  EINVOICING_JWT_SECRET: token(bytes),
  KYC_ADMIN_API_KEY: token(Math.max(bytes, 24)),
  EINVOICING_OAUTH_CLIENT_SECRET: token(bytes),
  STATUS_MONITOR_PASSWORD: token(24),
};

const providerRotate = [
  "CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET (Cloudinary dashboard)",
  "MAILTRAP_TOKEN (Mailtrap)",
  "BULKSMS_API_TOKEN (BulkSMS Nigeria)",
  "RECAPTCHA_API_KEY / RECAPTCHA_SECRET_KEY (Google Cloud)",
  "QUICKBOOKS_CLIENT_SECRET (Intuit)",
  "TINYURL_API_TOKEN (TinyURL)",
  "NRS/FIRS e-invoicing credentials (re-issue via /invoice/credentials/rotate)",
];

if (asEnv) {
  for (const [k, v] of Object.entries(generated)) {
    console.log(`${k}=${v}`);
  }
} else {
  console.log("=== Generated app secrets (paste into your secret store) ===\n");
  for (const [k, v] of Object.entries(generated)) {
    console.log(`${k}=${v}`);
  }
  console.log("\n=== Rotate these in their provider dashboards ===\n");
  for (const item of providerRotate) {
    console.log(`- ${item}`);
  }
  console.log(
    "\nAfter updating your environment, redeploy and invalidate old sessions.",
  );
}
