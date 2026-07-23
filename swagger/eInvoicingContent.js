require("dotenv").config();

/**
 * Sandbox credentials — set in environment for NRS onboarding submission.
 * NRS_BUSINESS_ID, NRS_SERVICE_ID, NRS_SUPPLIER_TIN, NRS_CUSTOMER_TIN
 */
function getSandboxConfig() {
  // Prefer real NRS_* values when present so docs/examples match sandbox;
  // set EINVOICING_DOCS_USE_REAL_SANDBOX_IDS=false to force placeholders.
  const forcePlaceholders =
    process.env.EINVOICING_DOCS_USE_REAL_SANDBOX_IDS === "false";
  const useRealIds =
    !forcePlaceholders &&
    (process.env.EINVOICING_DOCS_USE_REAL_SANDBOX_IDS === "true" ||
      Boolean(process.env.NRS_BUSINESS_ID && process.env.NRS_SERVICE_ID));
  const serviceId = useRealIds
    ? process.env.NRS_SERVICE_ID || "YOUR_NRS_SERVICE_ID"
    : "YOUR_NRS_SERVICE_ID";
  const invoiceNo = process.env.NRS_SAMPLE_INVOICE_NO || "FB-2026-001";
  const issueDate = process.env.NRS_SAMPLE_ISSUE_DATE || "2026-07-09";
  const ymd = issueDate.replace(/-/g, "");

  return {
    business_id: useRealIds
      ? process.env.NRS_BUSINESS_ID || "YOUR_NRS_BUSINESS_ID_UUID"
      : "YOUR_NRS_BUSINESS_ID_UUID",
    service_id: serviceId,
    supplier_tin: useRealIds
      ? process.env.NRS_SUPPLIER_TIN || "YOUR_SUPPLIER_TIN"
      : "YOUR_SUPPLIER_TIN",
    customer_tin: useRealIds
      ? process.env.NRS_CUSTOMER_TIN || "YOUR_CUSTOMER_TIN"
      : "YOUR_CUSTOMER_TIN",
    invoice_no: invoiceNo,
    issue_date: issueDate,
    due_date: process.env.NRS_SAMPLE_DUE_DATE || "2026-08-08",
    issue_time: process.env.NRS_SAMPLE_ISSUE_TIME || "10:30:00",
    irn: `${invoiceNo}-${serviceId}-${ymd}`,
    supplier_name:
      process.env.NRS_SUPPLIER_NAME || "Sample Supplier Limited",
    customer_name:
      process.env.NRS_CUSTOMER_NAME || "Sample Customer Limited",
    supplier_email: process.env.COMPANY_EMAIL || "supplier@example.com",
    supplier_phone: process.env.COMPANY_PHONE || "+2348000000000",
    supplier_street:
      process.env.NRS_SUPPLIER_STREET ||
      "1 Example Supplier Street",
    supplier_city: process.env.NRS_SUPPLIER_CITY || "Example City",
    supplier_postal: process.env.NRS_SUPPLIER_POSTAL || "000001",
    customer_email: process.env.NRS_CUSTOMER_EMAIL || "customer@example.com",
    customer_phone: process.env.NRS_CUSTOMER_PHONE || "+2348000000001",
    customer_street:
      process.env.NRS_CUSTOMER_STREET || "2 Example Customer Avenue",
    customer_city: process.env.NRS_CUSTOMER_CITY || "Example City",
    customer_postal: process.env.NRS_CUSTOMER_POSTAL || "000002",
  };
}

/** NRS-compliant B2B sample payload (matches FIRS e-Invoicing schema). */
function getSampleInvoicePayload(cfg = getSandboxConfig()) {
  return {
    business_id: cfg.business_id,
    irn: cfg.irn,
    invoice_kind: "B2B",
    issue_date: cfg.issue_date,
    due_date: cfg.due_date,
    issue_time: cfg.issue_time,
    invoice_type_code: "381",
    payment_status: "PENDING",
    tax_point_date: cfg.issue_date,
    document_currency_code: "NGN",
    tax_currency_code: "NGN",
    accounting_supplier_party: {
      party_name: cfg.supplier_name,
      tin: cfg.supplier_tin,
      email: cfg.supplier_email,
      telephone: cfg.supplier_phone,
      business_description: "Software Development",
      postal_address: {
        street_name: cfg.supplier_street,
        city_name: cfg.supplier_city,
        postal_zone: cfg.supplier_postal,
        country: "NG",
      },
    },
    accounting_customer_party: {
      party_name: cfg.customer_name,
      tin: cfg.customer_tin,
      email: cfg.customer_email,
      telephone: cfg.customer_phone,
      business_description: null,
      postal_address: {
        street_name: cfg.customer_street,
        city_name: cfg.customer_city,
        postal_zone: cfg.customer_postal,
        country: "NG",
      },
    },
    invoice_line: [
      {
        isic_code: "6201",
        service_category: "Software Development Services",
        discount_rate: 0.0,
        discount_amount: 0.0,
        fee_rate: 0.0,
        fee_amount: 0.0,
        invoiced_quantity: 1.0,
        line_extension_amount: 1500000.0,
        item: {
          name: "FlowBooks ERP Annual Subscription",
          description: "1.00 Each at 1500000.00 each",
          sellers_item_identification: "SVC-ERP-001",
        },
        price: {
          price_amount: 1500000.0,
          base_quantity: 1,
          price_unit: "EA",
        },
      },
      {
        hsn_code: "8471.30",
        product_category: "Computer Equipment",
        discount_rate: 0.0,
        discount_amount: 0.0,
        fee_rate: 0.0,
        fee_amount: 0.0,
        invoiced_quantity: 2.0,
        line_extension_amount: 500000.0,
        item: {
          name: "POS Terminal Device",
          description: "2.00 Each at 250000.00 each",
          sellers_item_identification: "8471.30",
        },
        price: {
          price_amount: 250000.0,
          base_quantity: 1,
          price_unit: "EA",
        },
      },
    ],
    tax_total: [
      {
        tax_amount: 150000.0,
        tax_subtotal: [
          {
            taxable_amount: 1500000.0,
            tax_amount: 112500.0,
            tax_category: { id: "STANDARD_VAT", percent: 7.5 },
          },
          {
            taxable_amount: 500000.0,
            tax_amount: 37500.0,
            tax_category: { id: "STANDARD_VAT", percent: 7.5 },
          },
        ],
      },
    ],
    legal_monetary_total: {
      line_extension_amount: 2000000.0,
      tax_exclusive_amount: 2000000.0,
      tax_inclusive_amount: 2150000.0,
      payable_amount: 2150000.0,
    },
  };
}

function money(n, currency = "NGN") {
  return `${currency} ${Number(n).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Rendered tax invoice HTML for documentation (NRS-compliant layout). */
function getSampleInvoiceHtml(cfg = getSandboxConfig()) {
  const payload = getSampleInvoicePayload(cfg);
  const supplier = payload.accounting_supplier_party;
  const customer = payload.accounting_customer_party;
  const totals = payload.legal_monetary_total;
  const taxTotal = payload.tax_total[0];
  const qrData = encodeURIComponent(payload.irn);
  const brand = "#4267B2";

  const lineRows = payload.invoice_line
    .map((row) => {
      const code = row.hsn_code
        ? `${row.hsn_code} · ${row.product_category}`
        : `${row.isic_code} · ${row.service_category}`;
      const lineTax =
        row.line_extension_amount * 0.075;
      const lineGross = row.line_extension_amount + lineTax;
      return `<tr>
        <td><strong>${row.item.name}</strong><br/><span class="muted">${row.item.description}</span><br/><span class="code">${code}</span></td>
        <td class="num">${row.invoiced_quantity}</td>
        <td class="num">${money(row.price.price_amount)}</td>
        <td class="num">${money(row.discount_amount)}</td>
        <td class="num">7.5%<br/>${money(lineTax)}</td>
        <td class="num"><strong>${money(lineGross)}</strong></td>
      </tr>`;
    })
    .join("");

  const vatRows = taxTotal.tax_subtotal
    .map(
      (s) =>
        `<tr><td>${s.tax_category.id}</td><td class="num">${money(s.taxable_amount)}</td><td class="num">${s.tax_category.percent}%</td><td class="num">${money(s.tax_amount)}</td></tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><title>Tax Invoice ${cfg.invoice_no}</title>
<style>
  *{box-sizing:border-box} body{font-family:'Segoe UI',Arial,sans-serif;margin:0;padding:24px;background:#eef2f6;color:#111}
  .inv{max-width:820px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden}
  .head{display:flex;justify-content:space-between;padding:24px 28px;border-bottom:4px solid ${brand}}
  .head h1{margin:0;font-size:22px;color:#111} .head .tin{font-size:12px;color:#666;margin-top:6px}
  .title{font-size:26px;font-weight:800;color:${brand};text-align:right}
  .meta{display:flex;justify-content:space-between;padding:16px 28px;background:#f8fafc;border-bottom:1px solid #e5e7eb}
  .parties{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #e5e7eb}
  .party{padding:20px 28px} .party h3{margin:0 0 8px;font-size:11px;text-transform:uppercase;color:#9ca3af;letter-spacing:.08em}
  .party p{margin:0;font-size:13px;line-height:1.6;color:#374151}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{background:${brand};color:#fff;padding:10px 8px;text-align:left;font-size:10px;text-transform:uppercase}
  td{padding:10px 8px;border-bottom:1px solid #f0f0f0;vertical-align:top}
  .num{text-align:right;white-space:nowrap} .muted{font-size:11px;color:#6b7280} .code{font-size:10px;color:#9ca3af}
  .bottom{display:grid;grid-template-columns:1fr 300px;gap:20px;padding:20px 28px}
  .vat h4{margin:0 0 8px;font-size:12px;text-transform:uppercase;color:#6b7280}
  .totals td{padding:6px 0} .grand td{font-size:16px;font-weight:700;border-top:2px solid ${brand};padding-top:10px}
  .tax-info{margin:0 28px 24px;padding:16px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;display:flex;gap:20px;align-items:center}
  .tax-info .irn{font-family:monospace;font-size:13px;font-weight:700}
  .foot{text-align:center;padding:14px;background:#f8fafc;font-size:11px;color:#6b7280;border-top:1px solid #e5e7eb}
</style></head><body>
<div class="inv">
  <div class="head">
    <div>
      <h1>${supplier.party_name}</h1>
      <div class="tin">TIN: ${supplier.tin}<br/>${supplier.postal_address.street_name}, ${supplier.postal_address.city_name}<br/>Tel: ${supplier.telephone} · ${supplier.email}</div>
    </div>
    <div>
      <div class="title">TAX INVOICE</div>
      <div style="text-align:right;font-size:13px;margin-top:8px">No: <strong>${cfg.invoice_no}</strong><br/>Date: ${cfg.issue_date}<br/>Due: ${cfg.due_date}</div>
    </div>
  </div>
  <div class="meta">
    <div><strong>Invoice Kind:</strong> B2B &nbsp;|&nbsp; <strong>Currency:</strong> NGN &nbsp;|&nbsp; <strong>Payment:</strong> PENDING</div>
    <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${qrData}" width="100" height="100" alt="QR"/>
  </div>
  <div class="parties">
    <div class="party"><h3>From · Supplier</h3><p><strong>${supplier.party_name}</strong><br/>TIN: ${supplier.tin}</p></div>
    <div class="party" style="border-left:1px solid #f0f0f0"><h3>Bill To · Customer</h3><p><strong>${customer.party_name}</strong><br/>TIN: ${customer.tin}<br/>${customer.postal_address.street_name}, ${customer.postal_address.city_name}<br/>${customer.email} · ${customer.telephone}</p></div>
  </div>
  <div style="padding:0 16px">
    <table>
      <thead><tr><th>Description / HSN·ISIC</th><th>Qty</th><th>Unit Price</th><th>Discount</th><th>VAT</th><th>Amount</th></tr></thead>
      <tbody>${lineRows}</tbody>
    </table>
  </div>
  <div class="bottom">
    <div class="vat">
      <h4>VAT Analysis</h4>
      <table><thead><tr><th>Tax Code</th><th>Goods Value</th><th>Rate</th><th>VAT</th></tr></thead><tbody>${vatRows}</tbody></table>
    </div>
    <table class="totals">
      <tr><td>Sub Total</td><td class="num">${money(totals.line_extension_amount)}</td></tr>
      <tr><td>Total VAT</td><td class="num">${money(taxTotal.tax_amount)}</td></tr>
      <tr class="grand"><td>Grand Total</td><td class="num" style="color:${brand}">${money(totals.payable_amount)}</td></tr>
    </table>
  </div>
  <div class="tax-info">
    <div style="flex:1">
      <div style="font-size:10px;text-transform:uppercase;color:#64748b;font-weight:700">Tax Information · NRS</div>
      <div style="margin-top:6px;font-size:11px">Transmission Date: ${cfg.issue_date} ${cfg.issue_time}</div>
      <div class="irn" style="margin-top:8px">IRN: ${payload.irn}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:4px">Merchant ID: ${cfg.business_id}</div>
    </div>
    <img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${qrData}" width="120" height="120" alt="NRS QR"/>
  </div>
  <div class="foot">Computer-generated NRS e-invoice · FlowBooks · Federal Inland Revenue Service (FIRS) / Nigeria Revenue Service (NRS)</div>
</div></body></html>`;
}

module.exports = {
  getSandboxConfig,
  getSampleInvoicePayload,
  getSampleInvoiceHtml,
};
