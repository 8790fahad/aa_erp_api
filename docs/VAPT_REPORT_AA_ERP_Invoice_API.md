# VULNERABILITY ASSESSMENT & PENETRATION TESTING (VAPT) REPORT  
## AA ERP Invoice API

---

**Document Version:** 1.2  
**Classification:** Confidential  
**Date of Assessment:** Week of 17 February 2026  
**Assessment Type:** Vulnerability Assessment & Penetration Testing  
**Scope:** AA ERP / FIRS Invoice API (Create, Lookup Status, Payment Notify)

**Purpose:** This assessment was conducted in support of compliance with the Federal Inland Revenue Service (FIRS) e-Invoicing mandate and related System Integrator / Access Point Provider requirements. This report may be submitted to FIRS as evidence of security assessment of the invoice API used for e-Invoicing.

---

## 1. EXECUTIVE SUMMARY

This report presents the findings of a Vulnerability Assessment and Penetration Testing (VAPT) engagement performed on the **AA ERP Invoice API**, which provides FIRS e-Invoicing compliance through Create Invoice, Lookup Invoice Status, and Payment Notification endpoints.

**In-scope components:**
- `POST /api/v1/invoice/create`
- `POST /api/v1/invoice/status`
- `POST /api/v1/invoice/payment/notify`
- Related controller, environment configuration, and API documentation (e.g. `/aa_erp-api-docs`)

**Summary of findings:**

| Severity | Count | Remediated |
|----------|--------|------------|
| Critical | 0 | - |
| High     | 0 | 1 (VAPT-INV-001) |
| Medium   | 3 | - |
| Low      | 2 | - |
| Informational | 2 | - |

**Overall risk:** **Low–Medium**. The High finding (VAPT-INV-001 – Missing Authentication & Authorization) has been **remediated** and the platform has been updated: JWT authentication (Passport) and facility-scoped authorization are now enforced on all AA ERP Invoice API endpoints. Remaining Medium and Low findings should be addressed as per recommendations.

---

## 2. SCOPE & OBJECTIVES

### 2.1 In Scope
- AA ERP Invoice API routes and controller logic
- Request/response handling and input validation
- Use of secrets (e.g. `AA_ERP_SECRET_KEY`) and proxy behaviour
- Error handling and information disclosure
- API documentation exposure

### 2.2 Out of Scope
- Third-party AA ERP Connect Gateway backend (external gateway)
- Frontend application security
- Infrastructure and network security
- Social engineering or physical security

### 2.3 Objectives
- Identify vulnerabilities that could lead to unauthorized access, data tampering, or information disclosure
- Assess authentication, authorization, and input validation
- Provide actionable remediation recommendations

---

## 3. METHODOLOGY

- **Standards referenced:** OWASP Top 10, OWASP API Security Top 10, PTES
- **Approach:** Document review, static analysis, manual testing of API endpoints (create, status, payment/notify)
- **Tools/techniques:** Manual request/response inspection, parameter tampering, authentication bypass checks, error-message analysis, configuration review

---

## 4. ENVIRONMENT & CONFIGURATION

| Item | Detail |
|------|--------|
| API base | `/api/v1/invoice/*` |
| Backend | Node.js / Express |
| Proxy | Requests forwarded to AA ERP Connect Gateway |
| Secrets | `AA_ERP_SECRET_KEY`, `AA_ERP_BASE_URL` (env) |
| Documentation | Swagger UI at `/aa_erp-api-docs` |

---

## 5. FINDINGS

### 5.1 [HIGH] Missing Authentication & Authorization on Invoice Endpoints

**Finding ID:** VAPT-INV-001  
**CVSS v3 (approx.):** 8.1 (High)

**Description:**  
The AA ERP Invoice API endpoints (`/api/v1/invoice/create`, `/api/v1/invoice/status`, `POST /api/v1/invoice/payment/notify`) did not enforce authentication or authorization. Any party that could reach the API could call these endpoints. The server used `AA_ERP_SECRET_KEY` only when proxying to the external gateway and did not validate the identity or permissions of the caller.

**Impact (prior to remediation):**  
- Unauthenticated users could create invoices, query status, and send payment notifications.
- Risk of abuse, fraud, data manipulation, and compliance violations (e.g. FIRS-related).

**Recommendation (implemented):**  
- Enforce authentication (e.g. JWT, API key, or session) on all invoice endpoints.
- Implement authorization so only allowed facilities/roles can create or query invoices (e.g. bind to `facilityId` and validate against authenticated identity).

**Remediation:**  
Authentication and authorization have been implemented on all AA ERP Invoice API endpoints. Only authenticated and authorized users/facilities can access `/api/v1/invoice/create`, `/api/v1/invoice/status`, and `/api/v1/invoice/payment/notify`. Identity and permissions are validated before requests are proxied to the AA ERP gateway.

**Implementation (platform update):**
- **Authentication:** All three invoice endpoints now use Passport JWT strategy (`passport.authenticate("jwt", { session: false })`). Requests must include a valid JWT in the `Authorization` header; otherwise the API returns 401 Unauthorized.
- **Authorization:** A facility-scoped check ensures that the `facilityId` in the request body matches the authenticated user’s `facilityId`. Users can only create, lookup, or notify for their own facility. If the facility does not match, the API returns 403 Forbidden with the message: "Forbidden: you may only act on your own facility."
- **Exception:** Users with role `superAdmin` may act on any facility.
- **Code changes:** Routes in `src/routes/firsInvoice.js` were updated to apply the authentication middleware; the controller in `src/controller/firsInvoice.js` was updated with an `ensureFacilityAccess(req, facilityId)` helper and authorization checks in each handler before proxying to the AA ERP gateway.

**Remediation status:** **Remediated** (implemented in platform; no open High or Critical findings at time of submission.)

---

### 5.2 [MEDIUM] Sensitive Configuration & Error Message Disclosure

**Finding ID:** VAPT-INV-002  
**CVSS v3 (approx.):** 5.3 (Medium)

**Description:**  
When `AA_ERP_SECRET_KEY` is not set, the API returns a clear-text message indicating that the “AA ERP secret key” is not configured and that `AA_ERP_SECRET_KEY` should be set in the environment. Similar dependency on environment may be reflected in other error paths.

**Impact:**  
- Attackers can confirm the use of a specific secret key and where it is configured.
- Slightly easier reconnaissance for further attacks or social engineering.

**Evidence (conceptual):**  
```json
{
  "success": false,
  "message": "AA ERP secret key not configured. Set AA_ERP_SECRET_KEY in environment."
}
```

**Recommendation:**  
- Return a generic error (e.g. “Service temporarily unavailable” or “Configuration error”) without mentioning env vars or key names.
- Log detailed configuration errors server-side only.

**Remediation status:** Open

---

### 5.3 [MEDIUM] Lack of Input Validation & Sanitization

**Finding ID:** VAPT-INV-003  
**CVSS v3 (approx.):** 5.0 (Medium)

**Description:**  
The Create Invoice endpoint accepts a large JSON body and forwards it to the upstream gateway with minimal validation. There is no schema validation, length limits per field, or sanitization of strings (e.g. for injection or oversized payloads). Status and Payment Notify accept `facilityId`, `invoiceRef`, and `paymentStatus` with only basic presence checks.

**Impact:**  
- Potential for malformed or malicious payloads to be sent downstream (upstream gateway may reject, but application logic is still at risk).
- Possible injection if upstream or logging uses these values unsafely.
- DoS or instability from very large or deeply nested JSON.

**Evidence:**  
- Controller uses `req.body` and spreads it (with `facilityId` → `merchantId` mapping) without validation.
- No use of Joi, express-validator, or similar for invoice payloads.

**Recommendation:**  
- Validate all request bodies against a strict schema (e.g. JSON Schema or Joi) for Create, Status, and Payment Notify.
- Enforce maximum lengths and allowed character sets for string fields.
- Validate enums (e.g. `paymentStatus`: PENDING, PAID, REJECTED) and reject invalid values with 400.

**Remediation status:** Open

---

### 5.4 [MEDIUM] No Rate Limiting on Invoice Endpoints

**Finding ID:** VAPT-INV-004  
**CVSS v3 (approx.):** 5.0 (Medium)

**Description:**  
No rate limiting or throttling was observed on the invoice API. An attacker or misbehaving client can send a high volume of requests to create invoices, lookup status, or notify payments.

**Impact:**  
- DoS through resource exhaustion (CPU, memory, or downstream gateway limits).
- Abuse of the external AA ERP service and possible account or contractual issues.
- Brute-force or enumeration of `facilityId` / `invoiceRef` if combined with weak auth.

**Recommendation:**  
- Apply rate limiting (e.g. per IP and/or per authenticated identity) to all invoice endpoints.
- Use different limits for create vs read/notify if needed; consider stricter limits for create and payment notify.

**Remediation status:** Open

---

### 5.5 [LOW] API Documentation Publicly Accessible

**Finding ID:** VAPT-INV-005  
**CVSS v3 (approx.):** 3.7 (Low)

**Description:**  
Swagger UI for the AA ERP Invoice API is exposed at `/aa_erp-api-docs` (and under `BASE_PATH`). The documentation describes request/response schemas, parameters, and examples, and may be reachable without authentication.

**Impact:**  
- Easier reconnaissance: attackers can see exact endpoints, parameters, and example payloads.
- Risk increases if authentication is not enforced on the docs or the API itself.

**Recommendation:**  
- Restrict access to `/aa_erp-api-docs` (e.g. authentication, IP allowlist, or only in non-production).
- Ensure production API requires authentication regardless of documentation exposure.

**Remediation status:** Open

---

### 5.6 [LOW] Verbose Error Responses from Proxy

**Finding ID:** VAPT-INV-006  
**CVSS v3 (approx.):** 3.0 (Low)

**Description:**  
On upstream errors, the controller may return the upstream response (or part of it) in the `error` or `data` field. This can expose internal or third-party error details to the client.

**Impact:**  
- Information disclosure about the external gateway or internal behaviour.
- Slightly easier troubleshooting for an attacker.

**Recommendation:**  
- Log full upstream errors server-side only.
- Return generic error messages and codes to the client; avoid forwarding raw upstream messages.

**Remediation status:** Open

---

### 5.7 [INFORMATIONAL] Use of Deprecated `request` Library

**Finding ID:** VAPT-INV-007  

**Description:**  
The controller uses the deprecated `request` npm package for outbound HTTP calls to the AA ERP gateway.

**Impact:**  
- No direct vulnerability cited, but deprecated dependencies may stop receiving security updates.

**Recommendation:**  
- Replace with a maintained client (e.g. `axios`, `node-fetch`, or native `fetch` in supported Node versions).
- Re-run dependency and security audits after migration.

**Remediation status:** Open

---

### 5.8 [INFORMATIONAL] CORS and Security Headers

**Finding ID:** VAPT-INV-008  

**Description:**  
The application uses CORS and Helmet. CORS is configured with an allowlist of origins; Helmet is used with some relaxations for cross-origin and embedding. No specific issue was identified that directly impacts the invoice API in isolation.

**Recommendation:**  
- Periodically review `CORS_ALLOWED_ORIGINS` and Helmet settings as new front-ends or integrations are added.
- Ensure strict origin checks and avoid `*` for credentials or sensitive APIs.

**Remediation status:** Informational

---

## 6. RISK MATRIX (SUMMARY)

| ID        | Finding                                      | Severity     | Likelihood | Impact | Risk  | Status     |
|-----------|----------------------------------------------|-------------|------------|--------|-------|------------|
| VAPT-INV-001 | Missing authentication/authorization       | High        | High       | High   | **High** | **Remediated** |
| VAPT-INV-002 | Sensitive configuration in error messages | Medium      | Medium     | Medium | **Medium** | Open       |
| VAPT-INV-003 | Lack of input validation                   | Medium      | Medium     | Medium | **Medium** | Open       |
| VAPT-INV-004 | No rate limiting                           | Medium      | Medium     | Medium | **Medium** | Open       |
| VAPT-INV-005 | API documentation publicly accessible      | Low         | High       | Low    | **Low**    | Open       |
| VAPT-INV-006 | Verbose proxy error responses              | Low         | Medium     | Low    | **Low**    | Open       |
| VAPT-INV-007 | Deprecated `request` library               | Info        | -          | -      | Info       | Open       |
| VAPT-INV-008 | CORS / Helmet review                       | Info        | -          | -      | Info       | Informational |

---

## 7. RECOMMENDATIONS SUMMARY

1. **Completed:** Authentication and authorization are now enforced on all AA ERP Invoice API endpoints (VAPT-INV-001 remediated).
2. **High priority:** Add request validation (schema + length/enum checks) and generic error messages; avoid exposing `AA_ERP_SECRET_KEY` or env details in responses.
3. **Medium priority:** Deploy rate limiting and restrict or protect access to `/aa_erp-api-docs`.
4. **Ongoing:** Replace deprecated HTTP client, keep dependencies updated, and re-scan after changes.

---

## 8. CONCLUSION

The AA ERP Invoice API provides necessary integration points for FIRS e-Invoicing. The **High finding (VAPT-INV-001 – Missing Authentication & Authorization) has been remediated** and the **platform has been updated**: JWT authentication and facility-scoped authorization are enforced on all invoice endpoints (see Section 5.1 for implementation details). Overall risk is **Low–Medium**. Addressing the remaining Medium and Low findings (input validation, rate limiting, error message hardening, documentation access) will further improve security and compliance posture. Re-assessment after full remediation is recommended.

---

**Report prepared for:** Brainstorm IT Solutions  
**Assessment performed by:** Brainstorm Group, headed by Ayomide (Okikiola) Elemeje, Cybersecurity Analyst | Penetration Tester  
**Next review:** March 2026 (one month from assessment)

**Authorised for submission to:** Federal Inland Revenue Service (FIRS), in support of e-Invoicing compliance requirements.

---

## What to strengthen before submitting 🔧

1. **Add an assessor qualification/credential statement.** FIRS (and most regulators) want to know the assessor is a recognised professional. Add a line in the cover or assessor section listing any relevant certifications (CEH, OSCP, CompTIA Security+, CISA, etc.). If none exist yet, consider having the assessment countersigned by a certified cybersecurity firm.

2. **Remediation timeline for open findings.** The three Medium and two Low findings are marked "Open." FIRS may require a remediation plan with target dates. Add a column or appendix with committed resolution dates (e.g. Medium items: within 30 days, Low items: 60 days).

3. **Confirm this covers the actual production system.** The report should explicitly state the environment tested was the production (or pre-production) instance that will be connected to FIRS. Add a line in Section 4 confirming this.

4. **Re-test / closure certificate.** Ideally, after remediating the Medium findings (especially input validation and rate limiting), a follow-up scan and a brief Remediation Closure Certificate should be obtained. FIRS is more likely to approve an application with all High and Medium items closed.

5. **Sign and seal.** The signature/seal section must be fully completed (wet or digital signatures) before submission. A blank signature block will be rejected.

6. **Company letterhead or stamp.** Official regulatory submissions typically require the document to be on the submitting firm's letterhead. Add Brainstorm Group's logo, address, and contact details to the cover page.

---

## 9. SIGNATURE AND SEAL

**Assessor / Prepared by**

| | |
|---|------|
| **Signature** | ![Assessor signature](assets/vapt_signature.svg) |
| **Name** | Ayomide (Okikiola) Elemeje |
| **Title** | Cybersecurity Analyst \| Penetration Tester |
| **Date** | _________________________ |
| **Seal / Stamp** | ![Assessor seal](assets/vapt_seal_stamp.svg) |

---

**Authorised by (Client)**

| | |
|---|------|
| **Signature** | _________________________ |
| **Name** | _________________________ |
| **Title** | _________________________ |
| **Date** | _________________________ |
| **Seal / Stamp** | ![Company seal](assets/vapt_seal_stamp.svg) *(Brainstorm IT Solutions – replace with client seal if different)* |

---

*This report is confidential and intended for the use of the commissioning organization. Unauthorized distribution is prohibited.*
