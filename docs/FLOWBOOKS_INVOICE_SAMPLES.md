# FlowBooks E-Invoicing API

**Document Version:** 2.1  
**Last Updated:** August 2026  
**Scope:** FIRS/NRS e-Invoicing — NRS/FIRS payload structure only

**API documentation (single URL):**

| | URL |
|--|-----|
| Documentation | `/e-invoicing-api-docs` (Redoc — NRS e-invoicing only) |
| OpenAPI JSON | `/e-invoicing-api-docs.json` |
| Sample invoice (HTML) | `/e-invoicing-api-docs/sample-invoice` |
| Try-it (Swagger) | `/e-invoicing-api-docs/try` |
| Production | `https://server.brainstorm.ng/inventria_new/e-invoicing-api-docs` |

Reference: [NRS / FIRS e-Invoicing API](https://einvoice.firs.gov.ng/docs/introduction?version=1.1)

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/invoice/create` | Submit NRS invoice |
| POST | `/api/v1/invoice/status` | Lookup by `business_id` + `irn` |
| POST | `/api/v1/invoice/payment/notify` | Notify payment status |

**Authentication:** OAuth 2.0 client credentials (system-to-system) — `POST /api/v1/invoice/oauth/token`.  
Access tokens are short-lived Bearer JWTs (`expires_in` default 3600, `scope`: `e-invoicing`).

---

## NRS Create Invoice Sample (B2B sales invoice)

This sample is Brainstorm’s NRS sandbox tax invoice:

| Field | Sandbox value |
|-------|----------------|
| `business_id` | `870c96de-c43c-430b-9fec-9f65648f4773` |
| Service ID | `FFEAC43C` |
| IRN | `FBTEST20260805174324-FFEAC43C-20260805` |
| `invoice_type_code` | `381` (sales invoice). `380` = credit note, `384` = debit note |

**IRN format:** `InvoiceNo-ServiceId-YYYYMMDD`

Credit/debit notes must also include `billing_reference: [{ irn, issue_date }]` pointing at the original signed invoice. Do not send `billing_reference` on a type `381` sales invoice.

HSN codes for goods must use dotted UN style (e.g. `8471.30`). Service lines use `isic_code` + `service_category`. Tax category ids are `STANDARD_VAT` / `ZERO_VAT`.

```json
{
  "business_id": "870c96de-c43c-430b-9fec-9f65648f4773",
  "irn": "FBTEST20260805174324-FFEAC43C-20260805",
  "invoice_kind": "B2B",
  "issue_date": "2026-08-05",
  "due_date": "2026-09-04",
  "issue_time": "17:43:24",
  "invoice_type_code": "381",
  "payment_status": "PENDING",
  "tax_point_date": "2026-08-05",
  "document_currency_code": "NGN",
  "tax_currency_code": "NGN",
  "accounting_supplier_party": {
    "party_name": "Brainstorm IT Solutions",
    "tin": "12345678-0001",
    "email": "hello@flowbooks.org",
    "telephone": "+2348067643479",
    "business_description": "Information technology and software services",
    "postal_address": {
      "street_name": "Plot 5, Adeola Odeku Street, Victoria Island",
      "city_name": "Lagos",
      "postal_zone": "101241",
      "country": "NG"
    }
  },
  "accounting_customer_party": {
    "party_name": "Atlantic Foods Nigeria Limited",
    "tin": "87654321-0001",
    "email": "accounts@atlanticfoods.ng",
    "telephone": "+2348012345678",
    "business_description": "Food manufacturing",
    "postal_address": {
      "street_name": "12 Industrial Avenue, Ikeja",
      "city_name": "Lagos",
      "postal_zone": "100001",
      "country": "NG"
    }
  },
  "invoice_line": [
    {
      "isic_code": "6201",
      "service_category": "Computer programming activities",
      "discount_rate": 0.0,
      "discount_amount": 0.0,
      "fee_rate": 0.0,
      "fee_amount": 0.0,
      "invoiced_quantity": 1.0,
      "line_extension_amount": 1500000.0,
      "item": {
        "name": "FlowBooks Cloud Accounting — Annual Licence",
        "description": "12-month SaaS licence for FlowBooks accounting (GL, sales, purchases, inventory, VAT returns) for one legal entity.",
        "sellers_item_identification": "6201"
      },
      "price": {
        "price_amount": 1500000.0,
        "base_quantity": 1,
        "price_unit": "EA"
      }
    },
    {
      "isic_code": "6202",
      "service_category": "Computer consultancy and computer facilities management",
      "discount_rate": 0.0,
      "discount_amount": 0.0,
      "fee_rate": 0.0,
      "fee_amount": 0.0,
      "invoiced_quantity": 5.0,
      "line_extension_amount": 500000.0,
      "item": {
        "name": "Implementation, data migration and user training",
        "description": "On-site / remote implementation: chart of accounts setup, opening balances, and training for up to 10 users (5 person-days).",
        "sellers_item_identification": "6202"
      },
      "price": {
        "price_amount": 100000.0,
        "base_quantity": 1,
        "price_unit": "EA"
      }
    }
  ],
  "tax_total": [
    {
      "tax_amount": 150000.0,
      "tax_subtotal": [
        {
          "taxable_amount": 1500000.0,
          "tax_amount": 112500.0,
          "tax_category": { "id": "STANDARD_VAT", "percent": 7.5 }
        },
        {
          "taxable_amount": 500000.0,
          "tax_amount": 37500.0,
          "tax_category": { "id": "STANDARD_VAT", "percent": 7.5 }
        }
      ]
    }
  ],
  "legal_monetary_total": {
    "line_extension_amount": 2000000.0,
    "tax_exclusive_amount": 2000000.0,
    "tax_inclusive_amount": 2150000.0,
    "payable_amount": 2150000.0
  }
}
```
