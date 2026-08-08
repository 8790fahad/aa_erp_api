#!/usr/bin/env node
/**
 * Seed a Q3 2026 Rice 50kg sale so Rebate Ledger (E2E Rice Rebate) can accrue,
 * then optionally issue the rebate credit note.
 *
 * Usage:
 *   node scripts/test-rebate-e2e.js
 *   node scripts/test-rebate-e2e.js --payout
 */
"use strict";

require("dotenv").config();
const mysql = require("mysql2/promise");

const FACILITY_ID = "094c6e1e-dd07-48c4-a344-6e9d58cd7861";
const CUSTOMER_NO = "CUS-1427";
const CUSTOMER_NAME = "A.A TIJO KOROKANI & SONGS";
const PRODUCT_SKU = "PROD-00234";
const PRODUCT_NAME = "Rice 50kg";
const INV_REF = "INV-REBATE-E2E-001";
const QTY = 10;
const UNIT_PRICE = 10000;
const BRANCH_ID = 45;
const USER_ID = "4";
const DO_PAYOUT = process.argv.includes("--payout");
const API_BASE = process.env.APP_API_BASE || "http://127.0.0.1:42843";

async function main() {
  const host = process.env.DB_HOST || "127.0.0.1";
  const conn = await mysql.createConnection({
    host: host === "localhost" ? "127.0.0.1" : host,
    user: process.env.DB_USERNAME || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "aa_erp_db",
    multipleStatements: true,
  });

  try {
    const [[rule]] = await conn.query(
      `SELECT id, name, rebate_percent, min_qty, from_date, to_date, product_sku
       FROM rebate_rules
       WHERE facility_id = ? AND name = 'E2E Rice Rebate'
       LIMIT 1`,
      [FACILITY_ID],
    );
    if (!rule) {
      throw new Error("E2E Rice Rebate rule not found — create it in UI first");
    }
    console.log("Rule:", rule.id, rule.name, `${rule.rebate_percent}%`);

    // Ensure stock receipt (qty_in) so inventory isn't negative if UI cares later
    await conn.query(
      `DELETE FROM store_entries
       WHERE facilityId = ? AND reference_number IN (?, ?)`,
      [FACILITY_ID, "OB-REBATE-E2E-001", INV_REF],
    );
    await conn.query(
      `DELETE FROM invoices WHERE facility_id = ? AND invoice_ref = ?`,
      [FACILITY_ID, INV_REF],
    );
    await conn.query(
      `DELETE FROM rebate_statuses
       WHERE facility_id = ? AND rule_id = ? AND customer_no = ?`,
      [FACILITY_ID, rule.id, CUSTOMER_NO],
    );

    const now = new Date();
    const saleDate = "2026-08-05 10:00:00";

    await conn.query(
      `INSERT INTO store_entries
        (receive_date, reference_number, qty_in, qty_out, cost_price, selling_price,
         branch_name, inserted_by, facilityId, type, source, destination, status,
         product_id, createdAt, markup_mode, mark_up, multple, location, branchId, user_id)
       VALUES
        ('2026-08-01', 'OB-REBATE-E2E-001', 50, 0, 8000, 10000,
         'YAMUSA STORE', ?, ?, 'opening_balance', 'opening', 'store', 'posted',
         ?, ?, 'fixed', 0, '1', 'store', ?, ?),
        ('2026-08-05', ?, 0, ?, 8000, ?,
         'YAMUSA STORE', ?, ?, 'sales', 'for sales', 'sold', 'posted',
         ?, ?, 'fixed', 0, '1', 'store', ?, ?)`,
      [
        USER_ID,
        FACILITY_ID,
        PRODUCT_SKU,
        now,
        BRANCH_ID,
        USER_ID,
        INV_REF,
        QTY,
        UNIT_PRICE,
        USER_ID,
        FACILITY_ID,
        PRODUCT_SKU,
        saleDate,
        BRANCH_ID,
        USER_ID,
      ],
    );

    const amount = QTY * UNIT_PRICE;
    await conn.query(
      `INSERT INTO invoices
        (ref_number, invoice_ref, due_date, transaction_date, tax_amount, discount_amount,
         description, amount, created_by, facility_id, type, created_at, customerNo, branchId, user_id)
       VALUES
        (?, ?, '2026-08-20', '2026-08-05', 0, 0,
         'E2E rebate test sale — Rice 50kg', ?, ?, ?, 'sales', ?, ?, ?, ?)`,
      [
        CUSTOMER_NO,
        INV_REF,
        amount,
        USER_ID,
        FACILITY_ID,
        now,
        CUSTOMER_NO,
        BRANCH_ID,
        USER_ID,
      ],
    );

    const expectedRebate = amount * (Number(rule.rebate_percent) / 100);
    console.log(
      `Seeded sale ${INV_REF}: ${QTY} × ${PRODUCT_NAME} @ ${UNIT_PRICE} = ${amount}`,
    );
    console.log(`Expected rebate @ ${rule.rebate_percent}% = ${expectedRebate}`);

    // Verify sales-line-report sees the line
    const params = new URLSearchParams({
      facilityId: FACILITY_ID,
      userId: USER_ID,
      fromDate: "2026-07-01",
      toDate: "2026-09-30",
      page: "1",
      pageSize: "50",
      search: PRODUCT_NAME,
    });
    const reportRes = await fetch(
      `${API_BASE}/api/v1/transactions/sales-line-report?${params}`,
    );
    const reportJson = await reportRes.json();
    const rows = reportJson?.results || reportJson?.data || reportJson?.rows || [];
    const match = (Array.isArray(rows) ? rows : []).find(
      (r) =>
        String(r.invoice_no) === INV_REF ||
        String(r.product_sku) === PRODUCT_SKU,
    );
    console.log(
      "sales-line-report:",
      reportRes.status,
      reportJson?.success,
      "rows:",
      Array.isArray(rows) ? rows.length : "n/a",
      match
        ? `MATCH qty=${match.qty} total=${match.line_total} cust=${match.customer_name}`
        : "NO MATCH — check API shape",
    );
    if (!match) {
      console.log("Report payload keys:", Object.keys(reportJson || {}));
      console.log(JSON.stringify(reportJson, null, 2).slice(0, 800));
    }

    if (DO_PAYOUT) {
      const payoutRes = await fetch(
        `${API_BASE}/api/v1/rebate-ledger/issue-credit-note`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            facilityId: FACILITY_ID,
            userId: USER_ID,
            ruleId: rule.id,
            customer: CUSTOMER_NAME,
            customerNo: CUSTOMER_NO,
            rebateAmount: expectedRebate,
          }),
        },
      );
      const payoutJson = await payoutRes.json();
      console.log(
        "issue-credit-note:",
        payoutRes.status,
        payoutJson?.success,
        payoutJson?.message || "",
        payoutJson?.data?.creditNoteNumber || "",
      );
      if (!payoutJson?.success) {
        console.log(JSON.stringify(payoutJson, null, 2).slice(0, 1200));
        process.exitCode = 1;
      }
    } else {
      console.log("\nBilling/Rebates should now show the accrual in the UI.");
      console.log("Re-run with --payout to issue the rebate credit note.");
    }
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
