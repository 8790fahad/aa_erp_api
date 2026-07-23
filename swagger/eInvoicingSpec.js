require("dotenv").config();

const { getSampleInvoicePayload } = require("./eInvoicingContent");

const PORT = process.env.PORT || 3000;
const BASE_PATH = process.env.BASE_PATH || "/inventria_new";
const API_BASE_URL = (
  process.env.API_BASE_URL ||
  process.env.APP_URL ||
  `http://localhost:${PORT}`
).replace(/\/$/, "");

const baseNoTrailing = BASE_PATH.endsWith("/")
  ? BASE_PATH.slice(0, -1)
  : BASE_PATH;

const buildServers = () => {
  const localBase = `http://localhost:${PORT}${baseNoTrailing}`;
  const servers = [{ url: localBase, description: "Local development" }];

  const productionHost = "https://server.brainstorm.ng";
  if (!API_BASE_URL.includes("localhost")) {
    const remoteBase = API_BASE_URL.includes(baseNoTrailing)
      ? API_BASE_URL
      : `${API_BASE_URL.replace(/\/$/, "")}${baseNoTrailing}`;
    if (remoteBase !== localBase) {
      servers.push({ url: remoteBase, description: "Remote / configured" });
    }
  }

  const prodApi = `${productionHost}${baseNoTrailing}`;
  if (!servers.some((s) => s.url === prodApi)) {
    servers.push({ url: prodApi, description: "Production (brainstorm.ng)" });
  }

  return servers;
};

const nrsParty = {
  type: "object",
  required: ["party_name", "tin", "postal_address"],
  properties: {
    party_name: { type: "string" },
    tin: { type: "string" },
    email: { type: "string" },
    telephone: { type: "string" },
    business_description: { type: "string", nullable: true },
    postal_address: {
      type: "object",
      required: ["street_name", "city_name", "country"],
      properties: {
        street_name: { type: "string" },
        city_name: { type: "string" },
        postal_zone: { type: "string" },
        country: { type: "string", example: "NG" },
      },
    },
  },
};

const nrsInvoiceLine = {
  type: "object",
  required: ["invoiced_quantity", "line_extension_amount", "item", "price"],
  properties: {
    discount_rate: { type: "number", example: 0 },
    discount_amount: { type: "number", example: 0 },
    fee_rate: { type: "number", example: 0 },
    fee_amount: { type: "number", example: 0 },
    invoiced_quantity: { type: "number" },
    line_extension_amount: { type: "number" },
    hsn_code: { type: "string" },
    product_category: { type: "string" },
    isic_code: { type: "string" },
    service_category: { type: "string" },
    item: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        sellers_item_identification: { type: "string" },
      },
    },
    price: {
      type: "object",
      required: ["price_amount"],
      properties: {
        price_amount: { type: "number" },
        base_quantity: { type: "number", example: 1 },
        price_unit: { type: "string", example: "EA" },
      },
    },
  },
};

const nrsCreateInvoiceExample = getSampleInvoicePayload();

function buildEInvoicingSpec() {
  return {
    openapi: "3.0.0",
    info: {
      title: "FlowBooks E-Invoicing API",
      version: "2.0.0",
      description: [
        "FlowBooks NRS E-Invoicing — technical API documentation for FIRS/NRS compliance.",
        "",
        "FlowBooks operates as a **System Integrator (SI)** and **Access Point Provider (APP)** within the Nigerian e-invoicing ecosystem, enabling ERP systems to submit NRS-compliant invoices.",
        "",
        "## Platform Roles",
        "",
        "### System Integrator (SI)",
        "- Extract invoice data from ERP/POS systems",
        "- Map tax codes and product/service codes to NRS standards",
        "- Generate Invoice Reference Numbers (IRN)",
        "- Validate payloads against the NRS schema",
        "- Standardize invoices into NRS JSON format",
        "",
        "### Access Point Provider (APP)",
        "- Authenticate API clients",
        "- Validate and transmit invoices to NRS",
        "- Return QR code data for invoice verification",
        "- Handle payment status updates",
        "",
        "## How It Works",
        "",
        "1. Invoice created in ERP → 2. Standardized to NRS JSON (SI) → 3. Submitted via FlowBooks API (APP) → 4. NRS returns IRN + QR code → 5. Status tracked via lookup endpoint",
        "",
        "## IRN Format",
        "",
        "`InvoiceNo-ServiceId-YYYYMMDD` — e.g. `INV-2026-B2B-001-SVC001-20260709`",
        "",
        "## Invoice Type Codes",
        "",
        "| Code | Description |",
        "|------|-------------|",
        "| 381 | Sales Invoice |",
        "| 380 | Credit Note |",
        "| 384 | Debit Note |",
        "",
        "## Invoice Kind",
        "",
        "`B2B`, `B2G`, or `B2C` only.",
        "",
        "Reference: [FIRS e-Invoicing](https://einvoice.firs.gov.ng/docs/introduction?version=1.1)",
      ].join("\n"),
      contact: {
        name: "FlowBooks",
        url: "https://flowbooks.org",
        email: "hello@flowbooks.org",
      },
    },
    servers: buildServers(),
    tags: [
      { name: "Authentication", description: "OAuth 2.0 client credentials (system-to-system)" },
      { name: "Invoices", description: "Submit, lookup, and update NRS invoices" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            "Short-lived OAuth 2.0 access_token from POST /api/v1/invoice/oauth/token (system-to-system). Use: Authorization: Bearer <access_token>. Tokens expire (default 3600s); scope is e-invoicing.",
        },
        basicAuth: {
          type: "http",
          scheme: "basic",
          description:
            "Base64-encoded client_id:client_secret for the token request only (OAuth 2.0 client credentials).",
        },
      },
      schemas: {
        ErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            message: { type: "string" },
          },
        },
        OAuthTokenResponse: {
          type: "object",
          properties: {
            access_token: { type: "string" },
            token_type: { type: "string", example: "bearer" },
            expires_in: { type: "integer", example: 3600 },
            scope: { type: "string", example: "e-invoicing" },
          },
        },
        OAuthError: {
          type: "object",
          properties: {
            error: { type: "string" },
            error_description: { type: "string" },
          },
        },
        NrsParty: nrsParty,
        NrsInvoiceLine: nrsInvoiceLine,
        NrsCreateInvoiceRequest: {
          type: "object",
          required: [
            "business_id",
            "irn",
            "invoice_kind",
            "issue_date",
            "due_date",
            "issue_time",
            "invoice_type_code",
            "payment_status",
            "tax_point_date",
            "document_currency_code",
            "tax_currency_code",
            "accounting_supplier_party",
            "invoice_line",
            "tax_total",
            "legal_monetary_total",
          ],
          properties: {
            business_id: {
              type: "string",
              description: "NRS merchant identifier from sandbox onboarding",
            },
            irn: {
              type: "string",
              description:
                "Unique tracking number assigned to each invoice (InvoiceNo-ServiceId-YYYYMMDD). Duplicates for the same business_id are rejected.",
            },
            invoice_kind: {
              type: "string",
              enum: ["B2B", "B2G", "B2C"],
            },
            issue_date: { type: "string", format: "date" },
            due_date: { type: "string", format: "date" },
            issue_time: { type: "string", example: "10:30:00" },
            invoice_type_code: { type: "string", example: "381" },
            payment_status: {
              type: "string",
              enum: ["PENDING", "PAID", "REJECTED", "PARTIAL"],
            },
            tax_point_date: { type: "string", format: "date" },
            document_currency_code: { type: "string", example: "NGN" },
            tax_currency_code: { type: "string", example: "NGN" },
            accounting_supplier_party: { $ref: "#/components/schemas/NrsParty" },
            accounting_customer_party: { $ref: "#/components/schemas/NrsParty" },
            invoice_line: {
              type: "array",
              minItems: 1,
              items: { $ref: "#/components/schemas/NrsInvoiceLine" },
            },
            tax_total: { type: "array", items: { type: "object" } },
            legal_monetary_total: { type: "object" },
            billing_reference: {
              type: "array",
              description: "Required for credit/debit notes",
              items: {
                type: "object",
                properties: {
                  irn: { type: "string" },
                  issue_date: { type: "string", format: "date" },
                },
              },
            },
          },
        },
        NrsInvoiceStatusRequest: {
          type: "object",
          required: ["business_id", "irn"],
          properties: {
            business_id: { type: "string" },
            irn: { type: "string" },
          },
        },
        NrsPaymentNotifyRequest: {
          type: "object",
          required: ["business_id", "irn", "payment_status"],
          properties: {
            business_id: { type: "string" },
            irn: { type: "string" },
            payment_status: {
              type: "string",
              enum: ["PENDING", "PAID", "REJECTED", "PARTIAL"],
              description:
                "PENDING, PAID, REJECTED, or PARTIAL. PARTIAL amount is this installment; cannot exceed payable or remaining balance; auto-PAID when fully paid.",
            },
            amount: {
              type: "number",
              description:
                "This payment installment. Required for PARTIAL. Must not exceed invoice payable_amount or remaining balance.",
              example: 50000,
            },
          },
        },
        NrsInvoiceResponse: {
          type: "object",
          properties: {
            irn: { type: "string" },
            issue_date: { type: "string", format: "date" },
            due_date: { type: "string", format: "date" },
            sync_date: { type: "string", format: "date" },
            payment_status: { type: "string" },
            transmitted: { type: "boolean" },
            delivered: { type: "boolean" },
            qr_code_data: { type: "string" },
          },
        },
      },
    },
    paths: {
      "/api/v1/invoice/oauth/token": {
        post: {
          tags: ["Authentication"],
          summary: "Get Access Token (OAuth 2.0)",
          description: [
            "OAuth 2.0 **client credentials** grant for **system-to-system** communication (FIRS-aligned).",
            "",
            "Encode `client_id:client_secret` as Base64 and send as `Authorization: Basic <encoded>`.",
            "",
            "Access tokens are short-lived Bearer JWTs (`expires_in`, default 3600; `scope`: `e-invoicing`).",
            "Use them on invoice endpoints as `Authorization: Bearer <access_token>`.",
            "",
            "Reference: [FIRS e-Invoicing](https://einvoice.firs.gov.ng/docs/introduction?version=1.1)",
          ].join("\n"),
          security: [{ basicAuth: [] }],
          requestBody: {
            required: false,
            content: {
              "application/x-www-form-urlencoded": {
                schema: {
                  type: "object",
                  properties: {
                    grant_type: {
                      type: "string",
                      enum: ["client_credentials"],
                      example: "client_credentials",
                    },
                  },
                },
              },
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    grant_type: { type: "string", example: "client_credentials" },
                    client_id: { type: "string" },
                    client_secret: { type: "string" },
                  },
                },
                example: {
                  grant_type: "client_credentials",
                  client_id: "YOUR_CLIENT_ID",
                  client_secret: "YOUR_CLIENT_SECRET",
                },
              },
            },
          },
          responses: {
            200: {
              description: "Access token issued",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/OAuthTokenResponse" },
                  example: {
                    access_token: "eyJhbGciOiJIUzI1NiJ9...",
                    token_type: "bearer",
                    expires_in: 3600,
                    scope: "e-invoicing",
                  },
                },
              },
            },
            401: {
              description: "Invalid client credentials",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/OAuthError" },
                },
              },
            },
          },
        },
      },
      "/api/v1/invoice/create": {
        post: {
          tags: ["Invoices"],
          summary: "Post Invoice",
          description: [
            "Submit a standardized NRS invoice to FIRS.",
            "",
            "The payload must conform to the **NRS/FIRS schema** (see sample below).",
            "Credit notes (380) and debit notes (384) require a `billing_reference` array.",
          ].join("\n"),
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/NrsCreateInvoiceRequest" },
                example: nrsCreateInvoiceExample,
              },
            },
          },
          responses: {
            200: {
              description: "Invoice submitted successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      message: { type: "string" },
                      data: { $ref: "#/components/schemas/NrsInvoiceResponse" },
                    },
                  },
                },
              },
            },
            400: { description: "Invalid NRS payload" },
            401: { description: "Unauthorized" },
            403: { description: "Forbidden" },
            409: {
              description:
                "Duplicate IRN — irn must be a unique tracking number per invoice for this business_id",
            },
          },
        },
      },
      "/api/v1/invoice/status": {
        post: {
          tags: ["Invoices"],
          summary: "Lookup Invoice Status",
          description: "Retrieve clearance and transmission status by `business_id` and `irn`.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/NrsInvoiceStatusRequest" },
                example: {
                  business_id: "YOUR_NRS_BUSINESS_ID",
                  irn: "INV-2026-B2B-001-SVC001-20260709",
                },
              },
            },
          },
          responses: {
            200: {
              description: "Status retrieved",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      data: { $ref: "#/components/schemas/NrsInvoiceResponse" },
                    },
                  },
                },
              },
            },
            400: { description: "business_id and irn required" },
            401: { description: "Unauthorized" },
          },
        },
      },
      "/api/v1/invoice/payment/notify": {
        post: {
          tags: ["Invoices"],
          summary: "Update Payment Status",
          description: "Notify NRS/FIRS of a payment status change for a cleared invoice.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/NrsPaymentNotifyRequest" },
                example: {
                  business_id: "YOUR_NRS_BUSINESS_ID",
                  irn: "INV-2026-B2B-001-SVC001-20260709",
                  payment_status: "PAID",
                },
              },
            },
          },
          responses: {
            200: { description: "Payment notification sent" },
            400: { description: "Invalid parameters" },
            401: { description: "Unauthorized" },
          },
        },
      },
      "/api/v1/invoice/transmit/{irn}": {
        post: {
          tags: ["Invoices"],
          summary: "Transmit Invoice",
          description:
            "Manually triggers transmission of a specific invoice to NRS by IRN.",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "path",
              name: "irn",
              required: true,
              schema: { type: "string" },
              description: "Unique invoice tracking number (IRN)",
            },
            {
              in: "query",
              name: "business_id",
              required: false,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    business_id: { type: "string" },
                  },
                },
                example: { business_id: "YOUR_NRS_BUSINESS_ID" },
              },
            },
          },
          responses: {
            200: {
              description: "Invoice transmitted",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      code: { type: "integer", example: 200 },
                      data: {
                        type: "object",
                        properties: {
                          ok: { type: "boolean", example: true },
                        },
                      },
                    },
                  },
                  example: { code: 200, data: { ok: true } },
                },
              },
            },
            401: { description: "Unauthorized" },
            404: { description: "Invoice not found" },
          },
        },
      },
    },
  };
}

module.exports = { buildEInvoicingSpec, buildServers };
