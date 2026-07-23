# FlowBooks — Pre-VAPT Security Assessment (Internal)

**Date:** 16 July 2026 (regenerated)  
**Scope:** E-invoicing API (`/api/v1/invoice/*`) and KYC Connect (`/api/kyc/*`)  
**Audience:** Internal hardening before external VAPT / MBS submission  
**Method:** Defensive code review + full remediation pass (not a formal penetration test)

> This document does **not** replace an independent VAPT. It records findings and remediations so the external assessor’s report for MBS reflects a hardened baseline.

---

## Executive summary

All previously identified Critical, High, and listed Medium/Low items in scope have been **remediated in code**. Remaining operational steps (rotate historical secrets, configure UAT env, whitelist tester IPs) are listed under **Pre-handover checklist**.

| Severity | Original count | Status after this pass |
|----------|----------------|------------------------|
| Critical | 3 | **Remediated** |
| High | 8 | **Remediated** |
| Medium / Low (listed) | 8 | **Remediated** |

**Recommendation for pentesters:** UAT/sandbox only (`fbk_test_`), shared docs URLs with placeholders, no production `fbk_live_` until KYC approval is validated.

---

## Findings & remediation status

### Critical

| ID | Finding | Status | Remediation |
|----|---------|--------|-------------|
| C1 | Client-claimed NRS `business_id` bound onto OAuth clients (IDOR) | **Remediated** | Production `einvoicing_clients.business_id` is not updated from KYC self-save. Only `testing` clients bind from Service setup. Production binding remains admin/`completeKyc`. |
| C2 | Hardcoded Cloudinary API credentials in source | **Remediated** | Config reads `CLOUDINARY_CLOUD_NAME` / `API_KEY` / `API_SECRET` from env. **Ops: rotate the previously committed Cloudinary secret.** |
| C3 | Passport JWT fell back to well-known `"secret"` | **Remediated** | Requires strong `JWT_SECRET_KEY` (or `JWT_SECRET`); no `"secret"` default; `algorithms: ["HS256"]`. |

### High

| ID | Finding | Status | Remediation |
|----|---------|--------|-------------|
| H1 | Sandbox tokens could hit live FIRS upstream | **Remediated** | `testing` environment skips upstream unless `EINVOICING_ALLOW_TEST_UPSTREAM=true`. |
| H2 | OTP verify / login lacked rate limits | **Remediated** | OTP verify 10/15min; login 30/15min; check-email 20/15min; existing resend limiters retained. |
| H3 | Docs could embed live OAuth secrets | **Remediated** | Docs never use `EINVOICING_OAUTH_*`. Only dedicated `EINVOICING_DOCS_CLIENT_*` when flag is on and values differ from live secrets; else placeholders. |
| H4 | HTTPS / `X-Forwarded-Proto` spoof risk | **Remediated** | Production uses `req.secure` via Express trust proxy (`TRUST_PROXY` / `TRUST_PROXY_IPS`). Raw header not trusted alone. `EINVOICING_ALLOW_INSECURE` remains local-only escape hatch. |
| H5 | Error/404 handlers reflected any CORS Origin | **Remediated** | Same allowlist helper as main CORS. |
| H6 | Weak hardcoded `/status` Basic auth | **Remediated** | Monitor off unless `STATUS_MONITOR_ENABLED` + strong env user/password. |
| H7 | Public docs leaked real NRS IDs / TINs | **Remediated** | Real IDs only when `EINVOICING_DOCS_USE_REAL_SANDBOX_IDS=true`; default placeholders. |
| H8 | Admin KYC completion key hygiene | **Remediated** | Header `x-kyc-admin-key` only; timing-safe compare; production requires key ≥24 chars or admin JWT; placeholder keys fail closed for API-key path. |

### Medium / Low

| ID | Finding | Status | Remediation |
|----|---------|--------|-------------|
| M1 | OTP / reset / verification tokens stored plaintext | **Remediated** | SHA-256 at rest; legacy plaintext still accepted once for migration. |
| M2 | Weak password policy (min 6) | **Remediated** | Minimum **8** characters on signup and reset. |
| M3 | Account enumeration on login | **Remediated** | Uniform `Invalid email or password` for unknown user / bad password. |
| M4 | Shared JWT secret across audiences | **Remediated** | Optional `EINVOICING_JWT_SECRET` separate from KYC/user JWT; both pin HS256. |
| M5 | Helmet after public docs | **Remediated** | Helmet runs before e-invoicing/Swagger docs routes. |
| M6 | 10mb JSON body on all routes | **Remediated** | Default body limit **1mb**. |
| M7 | Full BVN in stakeholder API responses | **Remediated** | Masked as `*******{last4}`. |
| M8 | User JWT on invoice APIs outside prod by default | **Remediated** | Only when `EINVOICING_ALLOW_USER_JWT=true`. |

---

## Positive controls (retained / strengthened)

- OAuth client secrets bcrypt-hashed; plaintext only on issue/rotate  
- E-invoicing JWT verifies `HS256` + `scope=e-invoicing`  
- OAuth token endpoint rate-limited (failed attempts)  
- Production credential rotate gated on KYC `approved`  
- Invoice create enforces token `business_id` match  
- Forgot-password anti-enumeration messaging  
- Sandbox vs production credential prefixes (`fbk_test_` / `fbk_live_`)  

---

## Pre-handover checklist (ops — before pentesters / MBS)

1. **Rotate** any Cloudinary credentials that ever lived in git history.  
2. Confirm UAT `.env`:
   - Strong `JWT_SECRET_KEY` (≥16; prefer 32+)  
   - Optional dedicated `EINVOICING_JWT_SECRET`  
   - `EINVOICING_DOCS_SHOW_SANDBOX_CREDS` unset/false  
   - `EINVOICING_DOCS_USE_REAL_SANDBOX_IDS` unset/false  
   - `EINVOICING_ALLOW_USER_JWT` unset/false  
   - `EINVOICING_ALLOW_INSECURE` unset  
   - `KYC_ADMIN_API_KEY` ≥24 random chars (if using API-key complete)  
   - `TRUST_PROXY` / `TRUST_PROXY_IPS` match reverse proxy  
3. Provide pentesters: docs URL, Postman collection, sandbox `client_id`/`client_secret` via secure channel, NRS sandbox Business ID.  
4. Whitelist tester IPs on WAF/CDN if present.  
5. Scope letter: UAT only; no SMS bombing; no live FIRS unless approved.  
6. After external VAPT: attach **this internal note** + formal VAPT PDF for MBS.

---

## API surfaces in scope (reference)

| Surface | Auth |
|---------|------|
| `POST /api/v1/invoice/oauth/token` | OAuth2 client credentials (Basic or body) |
| `POST /api/v1/invoice/create\|status\|payment/notify` | Bearer JWT (`e-invoicing`) |
| `/api/kyc/*` | KYC JWT / OTP (portal) |
| `/e-invoicing-api-docs*` | Public documentation (placeholders by default) |

Docs: `{BASE}/e-invoicing-api-docs` · OpenAPI `{BASE}/e-invoicing-api-docs.json` · Postman `{BASE}/e-invoicing-api-docs/postman.json`

---

## Files touched in remediation passes

- `src/app.js`  
- `src/config/passport.js`  
- `src/middleware/eInvoicingAuth.js`  
- `src/controller/firsInvoice.js`  
- `src/controller/kycAuth.js`  
- `src/routes/kyc.js`  
- `src/utils/einvoicingCredentials.js`  
- `swagger/eInvoicingContent.js`  
- `swagger/renderEInvoicingDocs.js`  
- `.env.example`  
- `docs/PRE_VAPT_SECURITY_ASSESSMENT.md` (this file)

---

**Prepared for:** FlowBooks / Brainstorm engineering  
**Next step:** Restart API on UAT, complete ops checklist, engage external VAPT, submit combined pack to MBS.
