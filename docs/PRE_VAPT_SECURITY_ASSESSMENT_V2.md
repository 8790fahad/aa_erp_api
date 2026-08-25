# AA ERP — Pre-VAPT Security Assessment V2

**Date:** 16 July 2026  
**Version:** 2.1 (fresh re-assessment after hardening + final app fixes)  
**Scope:** E-invoicing API (`/api/v1/invoice/*`) and KYC Connect (`/api/kyc/*`)  
**Method:** Defensive code review + final remediation pass (not a formal penetration test)  
**Prior report:** `docs/PRE_VAPT_SECURITY_ASSESSMENT.md` (V1)

> This document does **not** replace an independent VAPT. Use it as the internal baseline when engaging external assessors and when submitting packs to MBS.

---

## Executive summary

| Area | Result |
|------|--------|
| Critical (C1–C3) | **Remediated** in code |
| High (H1–H8) | **Remediated** (H8 strengthened further in V2) |
| Medium from V1 (M1–M8) | **Remediated** or accepted migration compatibility |
| New findings (V2) | **N1–N9 addressed** in code or explicitly accepted for sandbox design |
| External VAPT handoff confidence | **High** after API restart and ops checklist |

**Pentester scope recommendation:** UAT / sandbox only (`fbk_test_`). Do not issue production (`fbk_live_`) credentials until KYC approval is validated.

---

## 1. Prior findings — verified status

| ID | Title | V1 claim | V2 verified | Notes |
|----|--------|----------|-------------|--------|
| C1 | Client-claimed NRS `business_id` IDOR | Remediated | **Remediated** (prod) | Testing/sandbox may still self-bind NRS ID by design (N5). |
| C2 | Hardcoded Cloudinary secrets | Remediated | **Remediated** | Config + multer use `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` from `.env` only (`src/config/cloudinary.js`). **Rotate the key that was previously in source.** |
| C3 | Passport JWT `"secret"` fallback | Remediated | **Remediated** | Fail-closed in production; HS256. |
| H1 | Sandbox → live FIRS upstream | Remediated | **Remediated** | Blocked unless `EINVOICING_ALLOW_TEST_UPSTREAM=true`. |
| H2 | OTP / login rate limits | Remediated | **Remediated** | Plus signup rate limit added in V2. |
| H3 | Docs embed live OAuth secrets | Remediated | **Remediated** | Docs-only vars; live OAuth never embedded. Local `.env` set to `EINVOICING_DOCS_SHOW_SANDBOX_CREDS=false`. |
| H4 | HTTPS / forwarded-proto spoof | Remediated | **Remediated** | Uses `req.secure` + trust proxy. |
| H5 | CORS reflect on errors | Remediated | **Remediated** | Allowlist only. |
| H6 | Hardcoded `/status` Basic auth | Remediated | **Remediated** | Disabled unless strong env creds. |
| H7 | Docs leak NRS IDs / TINs | Remediated | **Remediated** | Placeholders unless `EINVOICING_DOCS_USE_REAL_SANDBOX_IDS=true`. |
| H8 | Admin KYC key hygiene | Previously needed strengthening | **Remediated** | Timing-safe; prod min 24 chars; placeholder denylist; `x-kyc-admin-key` only. |
| M1 | Tokens stored plaintext | Previously needed migration handling | **Remediated** | New OTP/reset/verification tokens are SHA-256 hashed at rest. Legacy plaintext fallback remains only for one-time migration compatibility. |
| M2 | Password min 6 | Remediated | **Remediated** | Min 8. |
| M3 | Login enumeration | Previously needed helper cleanup | **Remediated** | Login, email-check, signup duplicate, resend-verification, and resend-login responses were made generic where practical. |
| M4 | Shared JWT secret | Remediated | **Remediated** | Optional `EINVOICING_JWT_SECRET`. |
| M5 | Helmet after docs | Remediated | **Remediated** | Helmet before docs. |
| M6 | 10mb body limit | Remediated | **Remediated** | 1mb default. |
| M7 | Full BVN in API | Remediated | **Remediated** | Masked in responses; stored as encoded BVN rather than the full value. |
| M8 | User JWT on invoice APIs | Remediated | **Remediated** | Opt-in only. |

---

## 2. New findings (V2) and actions

| ID | Severity | Finding | Action in V2 |
|----|----------|---------|--------------|
| N1 | Medium | KYC JWT used insecure secret if env weak (unlike passport) | **Fixed** — production fail-closed; same ≥16 rule. |
| N2 | Medium | Signup had no IP rate limit | **Fixed** — 10 signups / hour / IP. |
| N3 | Medium | BVN plaintext at rest | **Fixed** — BVNs are stored as `sha256:<hash>:<last4>`; API returns masked only. Existing local rows were encoded and column expanded via migration `20260716193000-expand-kyc-stakeholder-bvn.js`. |
| N4 | Medium | Residual KYC enumeration (check-email, resend, status msgs) | **Fixed** — helper/resend responses are generic; login verification failures are generalized. |
| N5 | Low | Sandbox self-bind of NRS Business ID | **Accepted** for SI sandbox; live FIRS blocked. |
| N6 | Low | localhost Origins allowed even in prod CORS helper | **Fixed** — localhost origins are allowed only outside production unless `CORS_ALLOW_LOCALHOST=true`. |
| N7 | Low | Dual Cloudinary env schemas | **Fixed** — old helper now uses `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. |
| N8 | Low | Docs sample names/addresses look real | **Fixed** — docs samples now use neutral `example.com` / sample company data by default. |
| N9 | Info | Dashboard credential rotate trust model differs from KYC | **Fixed** — invoice credential rotation now requires admin/superadmin/owner role. |

**Ops fix applied locally:** `EINVOICING_DOCS_SHOW_SANDBOX_CREDS=false`, `EINVOICING_ALLOW_GLOBAL_CLIENT=false` in `aa_erp_api/.env`.

---

## 3. Positive controls

- OAuth client secrets bcrypt-hashed; plaintext only on issue/rotate  
- E-invoicing JWT: HS256 + `scope=e-invoicing`  
- OAuth token endpoint rate-limited  
- Production credential rotate gated on KYC `approved`  
- Invoice create enforces token `business_id` match  
- Sandbox tokens do not hit live FIRS by default  
- OTP / reset / verification tokens hashed (SHA-256)  
- BVN is no longer stored in full for stakeholder records  
- Helmet before public docs; CORS allowlist on errors  

---

## 4. Pre-handover checklist (ops)

1. Restart API so V2 code + `.env` flags load.  
2. Rotate historical Cloudinary secrets if ever committed.  
3. Confirm UAT env:
   - Strong `JWT_SECRET_KEY` (≥16; prefer 32+)  
   - Optional `EINVOICING_JWT_SECRET`  
   - Docs flags **false**  
   - `EINVOICING_ALLOW_USER_JWT` / `ALLOW_INSECURE` / `ALLOW_TEST_UPSTREAM` / `ALLOW_GLOBAL_CLIENT` **unset/false**  
   - Random `KYC_ADMIN_API_KEY` ≥24 chars (not example text)  
   - `TRUST_PROXY` / `TRUST_PROXY_IPS` correct  
4. Give pentesters: docs URL, Postman collection, sandbox creds (secure channel), NRS sandbox Business ID.  
5. Whitelist tester IPs on WAF/CDN.  
6. Scope letter: UAT only; no SMS bombing; no live FIRS unless approved.  
7. After external VAPT: attach **V1 + V2 internal notes** + formal VAPT PDF for MBS.

---

## 5. API surfaces in scope

| Surface | Auth |
|---------|------|
| `POST /api/v1/invoice/oauth/token` | OAuth2 client credentials |
| `POST /api/v1/invoice/create\|status\|payment/notify` | Bearer JWT (`e-invoicing`) |
| `/api/kyc/*` | KYC JWT / OTP |
| `/e-invoicing-api-docs*` | Public docs (placeholders by default) |

---

## 6. Handoff readiness

**Confidence: High**

Core Critical/High e-invoicing and KYC hardening has been verified in code. V2.1 also closes the remaining app-level items from the re-audit: BVN full-value storage, KYC enumeration helper responses, production localhost CORS, Cloudinary env naming, docs sample data, and credential-rotation role checks.

**Next step:** Complete ops checklist → engage external VAPT on UAT → submit combined pack to MBS.
