#!/usr/bin/env node
/**
 * Live demo: reverse unpaid Verification Points invoices for Yammusa.
 * Usage: node scripts/demo-verification-closing-reverse.js
 */
"use strict";

require("dotenv").config();
const db = require("../src/models");
const {
  reverseUnpaidNonCreditInvoicesForFacility,
  saleHasAnyPayment,
  VERIFICATION_STATUSES,
} = require("../src/services/invoiceClosingService");

const FACILITY_ID =
  process.env.TEST_FACILITY_ID || "094c6e1e-dd07-48c4-a344-6e9d58cd7861";

function money(n) {
  return Number(n || 0).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function listVerification() {
  const rows = await db.SaleWorkflow.findAll({
    where: {
      facility_id: FACILITY_ID,
      status: VERIFICATION_STATUSES,
    },
    order: [["created_at", "ASC"]],
  });
  const out = [];
  for (const row of rows) {
    const pay = await saleHasAnyPayment({
      facilityId: FACILITY_ID,
      saleCode: row.sale_code,
      workflow: row,
    });
    out.push({
      sale_code: row.sale_code,
      payment_type: row.payment_type,
      status: row.status,
      amount: Number(row.amount) || 0,
      will_reverse: !pay.paid,
      paid: pay.paid,
      paid_amount: pay.amount || 0,
    });
  }
  return out;
}

function printRows(title, rows) {
  console.log(`\n=== ${title} (${rows.length}) ===`);
  if (!rows.length) {
    console.log("(none)");
    return;
  }
  for (const r of rows) {
    const action = r.will_reverse
      ? "REVERSE (unpaid)"
      : `KEEP (partial ₦${money(r.paid_amount)})`;
    console.log(
      `${r.sale_code.padEnd(14)} ${String(r.payment_type).padEnd(10)} ${String(r.status).padEnd(28)} ₦${money(r.amount).padStart(12)}  ${action}`,
    );
  }
}

async function main() {
  const business = await db.business.findByPk(FACILITY_ID);
  console.log("Business:", business?.business_name || FACILITY_ID);
  console.log(
    "Closing lock:",
    business?.invoice_closing_enabled ? "Enabled" : "Disabled",
    business?.invoice_closing_time || "17:00",
    business?.invoice_closing_timezone || "Africa/Lagos",
  );

  const before = await listVerification();
  printRows("BEFORE — invoices on Verification Points", before);

  if (!before.length) {
    console.log("\nNothing on verification to reverse.");
    return;
  }

  const summary = await reverseUnpaidNonCreditInvoicesForFacility({
    facilityId: FACILITY_ID,
    userId: "4",
    reason:
      "Live test reverse after closing lock — unpaid invoices still on Verification Points",
  });

  console.log("\n=== REVERSE RESULT ===");
  console.log(
    `candidates=${summary.candidates} reversed=${summary.reversed} skipped=${summary.skipped} failed=${summary.failed}`,
  );
  for (const r of summary.results || []) {
    if (r.success) {
      console.log(
        `  REVERSED ${r.sale_code}  (VOID GL ${r.deleted_ledger_entries || 0}, stock ${r.deleted_store_entries || 0})`,
      );
    } else if (r.skipped) {
      console.log(
        `  KEPT     ${r.sale_code}  (${r.reason}${r.amount_paid ? ` ₦${money(r.amount_paid)}` : ""})`,
      );
    } else {
      console.log(`  FAILED   ${r.sale_code}  ${r.error || ""}`);
    }
  }

  const after = await listVerification();
  printRows("AFTER — still on Verification Points", after);
  console.log(
    "\nRefresh Verification Points in the app. Unpaid rows should be gone; partially paid stay.",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.sequelize.close();
    } catch (_) {}
  });
