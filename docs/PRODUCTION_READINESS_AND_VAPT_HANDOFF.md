# AA ERP — Production Readiness & VAPT Handoff Checklist

This document operationalizes the "Overall Assessment" from the Pre-VAPT
Security Assessment. Application-level code fixes are complete (see
`PRE_VAPT_SECURITY_ASSESSMENT_V2.md`). The items below are the operational and
infrastructure steps to complete **before engaging a third-party assessor** and
**before submitting to MBS**.

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## 1. Rotate all secrets that may ever have been exposed

Any secret that was ever committed to git, shared over chat/email, or printed to
logs must be rotated before VAPT.

- [ ] Generate fresh app secrets: `node scripts/rotate-secrets.js`
- [ ] `JWT_SECRET_KEY` (invalidates existing user sessions — expected)
- [ ] `EINVOICING_JWT_SECRET`
- [ ] `KYC_ADMIN_API_KEY` (min 24 chars in production)
- [ ] `EINVOICING_OAUTH_CLIENT_SECRET`
- [ ] **Cloudinary** `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` — this pair
      was previously hardcoded in source; rotate in the Cloudinary dashboard.
- [ ] `MAILTRAP_TOKEN`, `BULKSMS_API_TOKEN`, `TINYURL_API_TOKEN`
- [ ] `RECAPTCHA_API_KEY` / `RECAPTCHA_SECRET_KEY`
- [ ] `QUICKBOOKS_CLIENT_SECRET`
- [ ] Re-issue NRS/FIRS e-invoicing client credentials
      (`POST /api/v1/invoice/credentials/rotate`) — old `client_id` becomes
      invalid immediately on rotation.
- [ ] Confirm no secrets remain in git history (consider `git filter-repo` /
      BFG if any were committed).

> Helper: `node scripts/rotate-secrets.js --env` prints ready-to-paste
> `KEY=VALUE` lines for the app-owned secrets.

---

## 2. Production configuration checklist

Set/verify these in the production environment (not committed to git):

- [ ] `NODE_ENV=production`
- [ ] `TRUST_PROXY` / `TRUST_PROXY_IPS` set to match the real proxy chain so
      `req.secure` is accurate (required for HTTPS enforcement + rate limiting).
- [ ] `JWT_SECRET_KEY` present and ≥ 16 chars (app fails closed otherwise).
- [ ] `KYC_ADMIN_API_KEY` ≥ 24 chars, delivered via `X-KYC-Admin-Key` header.
- [ ] `KYC_ALLOW_LEGACY_PLAINTEXT=false` (see section 5).
- [ ] `EINVOICING_ALLOW_USER_JWT=false`
- [ ] `EINVOICING_ALLOW_GLOBAL_CLIENT=false`
- [ ] `EINVOICING_ALLOW_INSECURE` unset / `false`
- [ ] `EINVOICING_ALLOW_TEST_UPSTREAM` unset / `false`
- [ ] `EINVOICING_DOCS_SHOW_SANDBOX_CREDS=false`
- [ ] `EINVOICING_DOCS_USE_REAL_SANDBOX_IDS=false`
- [ ] `CORS_ALLOW_LOCALHOST` unset (localhost origins NOT allowed in prod).
- [ ] Production CORS allow-list configured to the real frontend origins only.
- [ ] `STATUS_MONITOR_ENABLED` unset, or set with strong
      `STATUS_MONITOR_USER` / `STATUS_MONITOR_PASSWORD`.
- [ ] Cloudinary `CLOUDINARY_*` vars set from env (never hardcoded).
- [ ] Verify the full config **after deployment** by hitting a protected route
      and confirming security headers (section 4).

---

## 3. Centralized logging & monitoring

- [ ] Ship application logs to a centralized store (e.g. CloudWatch, ELK,
      Datadog, Grafana Loki).
- [ ] Confirm request logging does **not** capture bodies/secrets — morgan is
      configured with `combined` format in production and skips `/status`,
      `/health`, `/favicon.ico`. Override with `LOG_FORMAT` if needed.
- [ ] Alerting on: 5xx spikes, auth failures / rate-limit hits, OAuth token
      request bursts, and unhandled rejections.
- [ ] Retain logs per MBS/regulatory requirements; ensure PII is masked.
- [ ] Set up uptime + certificate-expiry monitoring.

---

## 4. WAF, HTTPS, HSTS & secure headers

Application code now sets (via helmet, in `src/app.js`):

- HSTS (2 years, `includeSubDomains`, `preload`) — **production only**.
- CSP (`default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`,
  `upgrade-insecure-requests` in production).
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `X-Frame-Options: DENY`, hidden `X-Powered-By`, restricted cross-domain
  policies.

Infrastructure to confirm:

- [ ] TLS terminated with a valid cert; HTTP → HTTPS redirect at the edge.
- [ ] WAF in front of the app (managed rules for OWASP Top 10, rate limiting).
- [ ] HSTS actually observed over HTTPS (curl `-I` the prod URL).
- [ ] Verify headers post-deploy:
      `curl -sI https://<prod-host>/ | grep -iE 'strict-transport|content-security|x-content-type|x-frame|referrer'`
- [ ] (Optional) submit domain to the HSTS preload list once stable.

---

## 5. Remove temporary migration compatibility code

Legacy plaintext acceptance is now **opt-in** and off by default:

- [ ] Confirm all OTP/reset/verification tokens in the DB are hashed.
- [ ] Confirm all `kyc_stakeholders.bvn` rows are encoded
      (`sha256:<hash>:<last4>`), migration
      `20260716193000-expand-kyc-stakeholder-bvn.js` applied.
- [ ] Keep `KYC_ALLOW_LEGACY_PLAINTEXT=false` in production.
- [ ] After migration is verified, delete the legacy-plaintext branch in
      `secretsEqual()` (`src/controller/kycAuth.js`) and the legacy mask branch
      in `maskBvn()`, then drop the `KYC_ALLOW_LEGACY_PLAINTEXT` flag.

---

## 6. Assessment documentation package

Prepare and share with the assessor to streamline the engagement:

- [ ] Architecture overview (components, data flow, third-party integrations:
      Cloudinary, Mailtrap, BulkSMS, reCAPTCHA, NRS/FIRS, QuickBooks).
- [ ] API documentation (Swagger at `/api-docs`, e-invoicing docs at
      `/e-invoicing-api-docs`) — with sandbox-only sample data.
- [ ] Test accounts (roles: owner/admin/user) on a dedicated UAT environment.
- [ ] Scope definition (in-scope hosts/URLs, out-of-scope third parties).
- [ ] Environment details (UAT URLs, credentials delivery method, rate limits
      the assessor should expect, contact for allow-listing their scanner IPs).
- [ ] Copy of `PRE_VAPT_SECURITY_ASSESSMENT_V2.md` with the findings/fixes.

---

## Sign-off

- [ ] Sections 1–6 complete and verified on the UAT/production environment.
- [ ] Owner: ____________________  Date: ____________

Once the above are complete, AA ERP is positioned for a formal third-party
VAPT and subsequent submission to MBS.
