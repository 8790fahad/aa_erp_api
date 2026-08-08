# FlowBooks E-Invoicing API

**Document Version:** 2.0
**Last Updated:** July 2026
**Scope:** FIRS/NRS e-Invoicing — NRS/FIRS payload structure only

**API documentation (single URL):**

|                  | URL                                                           |
| ---------------- | ------------------------------------------------------------- |
| Documentation    | `/e-invoicing-api-docs` (Redoc — NRS e-invoicing only)        |
| OpenAPI JSON     | `/e-invoicing-api-docs.json`                                  |
| Try-it (Swagger) | `/e-invoicing-api-docs/try`                                   |
| Production       | `https://server.brainstorm.ng/flowbooks/e-invoicing-api-docs` |

Reference: [FIRS e-Invoicing API](https://einvoice.firs.gov.ng/docs/introduction?version=1.1)

---

## Endpoints

| Method | Path                             | Description                     |
| ------ | -------------------------------- | ------------------------------- |
| POST   | `/api/v1/invoice/create`         | Submit NRS invoice              |
| POST   | `/api/v1/invoice/status`         | Lookup by `business_id` + `irn` |
| POST   | `/api/v1/invoice/payment/notify` | Notify payment status           |

**Authentication:** OAuth 2.0 client credentials (system-to-system) — `POST /api/v1/invoice/oauth/token`.
Access tokens are short-lived Bearer JWTs (`expires_in` default 3600, `scope`: `e-invoicing`).
See [FIRS e-Invoicing](https://einvoice.firs.gov.ng/docs/introduction?version=1.1)

---

## NRS Create Invoice Sample (B2B)

Replace `YOUR_NRS_BUSINESS_ID`, `YOUR_SUPPLIER_TIN`, and `YOUR_CUSTOMER_TIN` with Brainstorm sandbox credentials.

**IRN format:** `InvoiceNo-ServiceId-YYYYMMDD` → `INV-2026-B2B-001-SVC001-20260709`

```json
{
  "business_id": "YOUR_NRS_BUSINESS_ID",
  "irn": "INV-2026-B2B-001-SVC001-20260709",
  "invoice_kind": "B2B",
  "issue_date": "2026-07-09",
  "due_date": "2026-08-08",
  "issue_time": "10:30:00",
  "invoice_type_code": "381",
  "payment_status": "PENDING",
  "tax_point_date": "2026-07-09",
  "document_currency_code": "NGN",
  "tax_currency_code": "NGN",
  "accounting_supplier_party": {
    "party_name": "Brainstorm IT Solutions",
    "tin": "YOUR_SUPPLIER_TIN",
    "email": "hello@flowbooks.org",
    "telephone": "+2348067643479",
    "business_description": "Software Development",
    "postal_address": {
      "street_name": "Plot 5, Brainstorm Close, Victoria Island",
      "city_name": "Lagos",
      "postal_zone": "101241",
      "country": "NG"
    }
  },
  "accounting_customer_party": {
    "party_name": "AA FOODS NIGERIA LIMITED",
    "tin": "YOUR_CUSTOMER_TIN",
    "email": "accounts@aafoods.ng",
    "telephone": "+2348012345678",
    "postal_address": {
      "street_name": "12 Industrial Avenue, Ikeja",
      "city_name": "Lagos",
      "postal_zone": "100001",
      "country": "NG"
    }
  },
  "invoice_line": [
    {
      "discount_rate": 0,
      "discount_amount": 0,
      "fee_rate": 0,
      "fee_amount": 0,
      "invoiced_quantity": 50,
      "line_extension_amount": 2250000,
      "hsn_code": "7306",
      "product_category": "Construction Materials",
      "item": {
        "name": "Industrial Steel Pipes 6inch",
        "description": "Galvanized steel pipes, 6 inch diameter, 6m length",
        "sellers_item_identification": "SKU-PIPE-6IN-001"
      },
      "price": {
        "price_amount": 45000,
        "base_quantity": 1,
        "price_unit": "EA"
      }
    }
  ],
  "tax_total": [
    {
      "tax_amount": 168750,
      "tax_subtotal": [
        {
          "taxable_amount": 2250000,
          "tax_amount": 168750,
          "tax_category": {
            "id": "STANDARD_VAT",
            "percent": 7.5
          }
        }
      ]
    }
  ],
  "legal_monetary_total": {
    "line_extension_amount": 2250000,
    "tax_exclusive_amount": 2250000,
    "tax_inclusive_amount": 2418750,
    "payable_amount": 2418750
  }
}
```
