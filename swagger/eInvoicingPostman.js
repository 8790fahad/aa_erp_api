const {
  getSandboxConfig,
  getSampleInvoicePayload,
} = require("./eInvoicingContent.js");

/**
 * Build a Postman Collection (v2.1.0) for the FlowBooks NRS E-Invoicing API.
 *
 * Security model (OAuth 2.0 client credentials):
 *  - `client_id` / `client_secret` are used ONCE to mint a short-lived Bearer
 *    token from POST {{authUrl}}/api/v1/invoice/oauth/token.
 *  - A collection-level pre-request script fetches/caches that token and the
 *    data requests send only `Authorization: Bearer {{access_token}}`.
 *  - Keep the real `client_secret` in a Postman ENVIRONMENT (or the "current
 *    value" field) — never save it into a collection shared to a public
 *    workspace. The exported collection ships with placeholders only.
 *
 * @param {{ baseUrl?: string }} opts - API base URL (no trailing slash)
 * @returns {object} Postman v2.1 collection JSON
 */
function buildEInvoicingPostmanCollection({ baseUrl = "" } = {}) {
  const cfg = getSandboxConfig();
  const root = (baseUrl || "http://localhost:3000/inventria_new").replace(
    /\/$/,
    "",
  );
  const authRoot = (
    process.env.EINVOICING_AUTH_BASE_URL || "https://connect.flowbooks.org"
  ).replace(/\/$/, "");
  const sample = getSampleInvoicePayload(cfg);

  const jsonBody = (obj) => ({
    mode: "raw",
    raw: JSON.stringify(obj, null, 2),
    options: { raw: { language: "json" } },
  });

  const bearerAuth = {
    type: "bearer",
    bearer: [{ key: "token", value: "{{access_token}}", type: "string" }],
  };

  const jsonHeaders = () => [{ key: "Content-Type", value: "application/json" }];

  return {
    info: {
      _postman_id: "flowbooks-nrs-einvoicing-v2",
      name: "FlowBooks NRS E-Invoicing",
      description:
        "FlowBooks NRS E-Invoicing API (System Integrator + Access Point Provider).\n\n" +
        "Requests in this collection:\n" +
        "1. Get Access Token (OAuth 2.0)\n" +
        "2. Create Invoice\n" +
        "3. Lookup Invoice Status\n" +
        "4. Payment Notify (PENDING | PAID | REJECTED | PARTIAL)\n" +
        "5. Transmit Invoice\n\n" +
        "OAuth 2.0: set {{client_id}} and {{client_secret}} (keep the secret in an Environment). " +
        "A pre-request script exchanges them for {{access_token}} and caches it until expiry.",
      schema:
        "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    auth: bearerAuth,
    event: [
      {
        listen: "prerequest",
        script: {
          type: "text/javascript",
          exec: [
            "// OAuth2 client-credentials: mint a short-lived token, cache until expiry.",
            "const now = Math.floor(Date.now() / 1000);",
            "const exp = Number(pm.collectionVariables.get('token_expiry') || 0);",
            "const cached = pm.collectionVariables.get('access_token');",
            "if (cached && exp - 60 > now) { return; } // still valid",
            "",
            "const clientId = pm.collectionVariables.get('client_id');",
            "const clientSecret = pm.collectionVariables.get('client_secret');",
            "if (!clientId || !clientSecret) {",
            "  console.warn('Set client_id and client_secret to authenticate.');",
            "  return;",
            "}",
            "const basic = 'Basic ' + CryptoJS.enc.Base64.stringify(",
            "  CryptoJS.enc.Utf8.parse(clientId + ':' + clientSecret)",
            ");",
            "pm.sendRequest({",
            "  url: pm.collectionVariables.get('authUrl') + '/api/v1/invoice/oauth/token',",
            "  method: 'POST',",
            "  header: {",
            "    'Content-Type': 'application/x-www-form-urlencoded',",
            "    'Authorization': basic",
            "  },",
            "  body: {",
            "    mode: 'urlencoded',",
            "    urlencoded: [{ key: 'grant_type', value: 'client_credentials' }]",
            "  }",
            "}, (err, res) => {",
            "  if (err) { console.error('Token request failed', err); return; }",
            "  const data = res.json();",
            "  if (data && data.access_token) {",
            "    pm.collectionVariables.set('access_token', data.access_token);",
            "    const ttl = Number(data.expires_in || 3600);",
            "    pm.collectionVariables.set('token_expiry', String(now + ttl));",
            "  } else {",
            "    console.error('No access_token in token response', data);",
            "  }",
            "});",
          ],
        },
      },
    ],
    variable: [
      { key: "baseUrl", value: root, type: "string" },
      { key: "authUrl", value: authRoot, type: "string" },
      { key: "client_id", value: "YOUR_CLIENT_ID", type: "string" },
      { key: "client_secret", value: "", type: "string" },
      { key: "access_token", value: "", type: "string" },
      { key: "token_expiry", value: "0", type: "string" },
      { key: "business_id", value: cfg.business_id, type: "string" },
      { key: "irn", value: cfg.irn, type: "string" },
    ],
    item: [
      {
        name: "Get Access Token (OAuth 2.0)",
        event: [
          {
            listen: "test",
            script: {
              type: "text/javascript",
              exec: [
                "// Save the issued token so every other request can reuse it.",
                "let data = {};",
                "try { data = pm.response.json(); } catch (e) {}",
                "if (pm.response.code === 200 && data.access_token) {",
                "  const now = Math.floor(Date.now() / 1000);",
                "  const ttl = Number(data.expires_in || 3600);",
                "  pm.collectionVariables.set('access_token', data.access_token);",
                "  pm.collectionVariables.set('token_expiry', String(now + ttl));",
                "  pm.test('Access token issued', function () {",
                "    pm.expect(data.access_token).to.be.a('string').and.not.empty;",
                "  });",
                "} else {",
                "  pm.test('Access token issued', function () {",
                "    pm.expect.fail('Token request failed: ' + JSON.stringify(data));",
                "  });",
                "}",
              ],
            },
          },
        ],
        request: {
          auth: {
            type: "basic",
            basic: [
              { key: "username", value: "{{client_id}}", type: "string" },
              { key: "password", value: "{{client_secret}}", type: "string" },
            ],
          },
          method: "POST",
          header: [
            {
              key: "Content-Type",
              value: "application/x-www-form-urlencoded",
            },
          ],
          body: {
            mode: "urlencoded",
            urlencoded: [
              { key: "grant_type", value: "client_credentials", type: "text" },
            ],
          },
          url: {
            raw: "{{authUrl}}/api/v1/invoice/oauth/token",
            host: ["{{authUrl}}"],
            path: ["api", "v1", "invoice", "oauth", "token"],
          },
          description:
            "OAuth 2.0 client-credentials grant. Sends HTTP Basic auth with " +
            "{{client_id}}:{{client_secret}} and grant_type=client_credentials, and " +
            "returns a short-lived Bearer token. The test script stores {{access_token}} " +
            "and {{token_expiry}} for the other requests. NOTE: the collection also " +
            "auto-mints this token via a pre-request script, so running this request " +
            "manually is optional — it's here so you can see/test the auth step directly.",
        },
      },
      {
        name: "Create Invoice",
        request: {
          auth: bearerAuth,
          method: "POST",
          header: jsonHeaders(),
          body: jsonBody(sample),
          url: {
            raw: "{{baseUrl}}/api/v1/invoice/create",
            host: ["{{baseUrl}}"],
            path: ["api", "v1", "invoice", "create"],
          },
          description:
            "Submit a standardized invoice to NRS. Credit notes (380) and debit notes (384) require a billing_reference array.",
        },
      },
      {
        name: "Lookup Invoice Status",
        request: {
          auth: bearerAuth,
          method: "POST",
          header: jsonHeaders(),
          body: jsonBody({ business_id: cfg.business_id, irn: cfg.irn }),
          url: {
            raw: "{{baseUrl}}/api/v1/invoice/status",
            host: ["{{baseUrl}}"],
            path: ["api", "v1", "invoice", "status"],
          },
          description:
            "Retrieve clearance and transmission status for an invoice by business_id and irn.",
        },
      },
      {
        name: "Payment Notify",
        request: {
          auth: bearerAuth,
          method: "POST",
          header: jsonHeaders(),
          body: jsonBody({
            business_id: "{{business_id}}",
            irn: "{{irn}}",
            payment_status: "PAID",
            reference: "payment_reference_or_note",
          }),
          url: {
            raw: "{{baseUrl}}/api/v1/invoice/payment/notify",
            host: ["{{baseUrl}}"],
            path: ["api", "v1", "invoice", "payment", "notify"],
          },
          description: [
            "Update payment status for a cleared invoice.",
            "",
            "Same endpoint for every status — only change payment_status:",
            "  PENDING | PAID | REJECTED | PARTIAL",
            "",
            "Examples (same request, different status):",
            "",
            "PAID:",
            '{ "business_id": "{{business_id}}", "irn": "{{irn}}", "payment_status": "PAID" }',
            "",
            "PARTIAL (amount required — this installment):",
            '{ "business_id": "{{business_id}}", "irn": "{{irn}}", "payment_status": "PARTIAL", "amount": 50000 }',
            "",
            "Controls for PARTIAL: amount cannot exceed payable or remaining balance;",
            "when fully paid, status becomes PAID automatically.",
          ].join("\n"),
        },
      },
      {
        name: "Transmit Invoice",
        request: {
          auth: bearerAuth,
          method: "POST",
          header: jsonHeaders(),
          body: jsonBody({ business_id: "{{business_id}}" }),
          url: {
            raw: "{{baseUrl}}/api/v1/invoice/transmit/{{irn}}",
            host: ["{{baseUrl}}"],
            path: ["api", "v1", "invoice", "transmit", "{{irn}}"],
            variable: [
              {
                key: "irn",
                value: "{{irn}}",
                description: "Unique invoice tracking number (IRN)",
              },
            ],
          },
          description: [
            "Manually triggers transmission of a specific invoice to NRS by IRN.",
            "",
            "Path: POST /api/v1/invoice/transmit/{IRN}",
            "Set collection variables {{business_id}} and {{irn}} (same IRN used on Create).",
            "",
            "Success response:",
            '{ "code": 200, "data": { "ok": true } }',
          ].join("\n"),
        },
      },
    ],
  };
}

module.exports = { buildEInvoicingPostmanCollection };
