#!/usr/bin/env node
/**
 * Re-post YAMMUSA demo: opening balances → purchase → expenses → sales
 * → July 2026 depreciation → July 2026 payroll (run → process → mark-paid).
 *
 * Usage: node scripts/yammusa-repost-demo.js
 */
"use strict";

require("dotenv").config();
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

const FACILITY_ID = "094c6e1e-dd07-48c4-a344-6e9d58cd7861";
const USER_ID = "4";
const ADMIN_EMAIL = "admin@gmail.com";
const TEMP_PASSWORD = "YammusaDemo2026!";
const API_BASE = process.env.APP_API_BASE || "http://127.0.0.1:42844";
const BRANCH_ID = 45;
const SUPPLIER = "SUP-E2E1";
const CUSTOMER = "CUS-1793";
const BANK_ID = 9; // Jaiz → 112225

const log = (...a) => console.log(...a);
const fail = (msg) => {
  console.error("FATAL:", msg);
  process.exit(1);
};

async function api(method, path, token, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: token.startsWith("Bearer") ? token : `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch (_) {
    data = { raw: await res.text().catch(() => "") };
  }
  return { ok: res.ok, status: res.status, data };
}

async function ensureCoa(conn, rows) {
  for (const r of rows) {
    const [ex] = await conn.query(
      `SELECT code FROM account_category WHERE facility_id=? AND code=? LIMIT 1`,
      [FACILITY_ID, r.code]
    );
    if (ex.length) continue;
    await conn.query(
      `INSERT INTO account_category
        (code, parent_code, level, category, type, description, account_nature,
         facility_id, is_active, display, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, NOW(), NOW())`,
      [
        r.code,
        r.parent_code,
        r.level || 3,
        r.category,
        r.type,
        r.description,
        r.account_nature,
        FACILITY_ID,
      ]
    );
    log("  + CoA", r.code, r.description);
  }
}

async function main() {
  const host = process.env.DB_HOST || "127.0.0.1";
  const conn = await mysql.createConnection({
    host: host === "localhost" ? "127.0.0.1" : host,
    user: process.env.DB_USERNAME || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "aa_erp_db",
  });

  // Save & set temp password for API auth
  const [[user]] = await conn.query(`SELECT id, email, password FROM users WHERE id=?`, [USER_ID]);
  if (!user) fail("Admin user id 4 not found");
  const originalHash = user.password;
  const tempHash = await bcrypt.hash(TEMP_PASSWORD, 10);
  await conn.query(`UPDATE users SET password=? WHERE id=?`, [tempHash, USER_ID]);
  log("1) Temp admin password set for API login");

  try {
    // ── CoA stubs for hardcoded dep / payroll codes ─────────────────────────
    log("2) Ensuring CoA stubs for depreciation + payroll GL codes");
    await ensureCoa(conn, [
      // Accumulated depreciation (6-digit CoA standard)
      { code: "111014", parent_code: "111000", level: 3, category: "assets", type: "Non Current Assets", description: "Accum. Dep – Furniture & Fittings", account_nature: "ASSET" },
      { code: "111015", parent_code: "111000", level: 3, category: "assets", type: "Non Current Assets", description: "Accum. Dep – Office Equipment", account_nature: "ASSET" },
      { code: "111016", parent_code: "111000", level: 3, category: "assets", type: "Non Current Assets", description: "Accum. Dep – Computers and Laptops", account_nature: "ASSET" },
      { code: "800110", parent_code: "800100", level: 3, category: "expenses", type: "Operating expenses", description: "Staff Bonus", account_nature: "EXPENSE" },
      { code: "800111", parent_code: "800100", level: 3, category: "expenses", type: "Operating expenses", description: "Overtime Expense", account_nature: "EXPENSE" },
      { code: "900213", parent_code: "900200", level: 3, category: "liabilities", type: "Current liabilities", description: "Staff Loan Deduction Payable", account_nature: "LIABILITY" },
      { code: "900214", parent_code: "900200", level: 3, category: "liabilities", type: "Current liabilities", description: "Other Payroll Deductions Payable", account_nature: "LIABILITY" },
      { code: "900215", parent_code: "900200", level: 3, category: "liabilities", type: "Current liabilities", description: "Pension Payable", account_nature: "LIABILITY" },
      { code: "600000", parent_code: "4", level: 2, category: "revenue", type: "Operating revenue", description: "Sales Rebates / Discounts", account_nature: "REVENUE" },
    ]);

    // Point PAYE settings at real payable when possible (keep 200005 stub too)
    await conn.query(
      `UPDATE paye_settings SET payeLedgerAccount='900205' WHERE facilityId=? AND assessmentYear=2026`,
      [FACILITY_ID]
    );

    // Clear July payroll so we can re-run
    const [delPay] = await conn.query(
      `DELETE FROM payroll WHERE facilityId=? AND year=2026 AND month=7`,
      [FACILITY_ID]
    );
    log("3) Cleared July 2026 payroll rows:", delPay.affectedRows);

    // Reset assets so July dep can run; restore NBV to cost for clean month
    await conn.query(
      `UPDATE assets
       SET last_depreciation_date = NULL,
           accumulated_depreciation = 0,
           net_book_value = acquisition_cost,
           firs_written_down_value = acquisition_cost,
           firs_allowance_to_date = 0
       WHERE facility_id=? AND status='Active'`,
      [FACILITY_ID]
    );
    log("4) Reset active assets for July depreciation");

    // Clear any leftover GL (should already be empty)
    await conn.query(`DELETE FROM general_ledger WHERE facility_id=?`, [FACILITY_ID]);

    // Opening balances 1 Jul 2026
    const opening = [
      { code: "112199", dr: 1500000, cr: 0, desc: "Opening cash" },
      { code: "112225", dr: 3500000, cr: 0, desc: "Opening Jaiz Bank" },
      { code: "111005", dr: 760000, cr: 0, desc: "Opening Office Equipment" }, // 90+120+180+250+120
      { code: "111006", dr: 850000, cr: 0, desc: "Opening Computers" },
      { code: "300200", dr: 0, cr: 6610000, desc: "Opening Balance Equity" },
    ];
    for (const line of opening) {
      await conn.query(
        `INSERT INTO general_ledger
          (transaction_date, account_code, account_subhead, dr, cr, account_description,
           transaction_description, reference_number, purpose_of_payment, payee,
           facility_id, type, created_by, status, transaction_ref, created_at, updated_at)
         VALUES ('2026-07-01', ?, 'opening', ?, ?, ?, ?, 'OB-JUL-2026', 'Opening Balance', 'Opening',
                 ?, 'journal_entry', ?, 'saved', 'OB-JUL-2026', NOW(), NOW())`,
        [line.code, line.dr, line.cr, line.desc, line.desc, FACILITY_ID, USER_ID]
      );
    }
    log("5) Posted opening balances (cash, bank, assets, equity)");

    // Login
    const login = await api("POST", "/api/auth/login", null, {
      email: ADMIN_EMAIL,
      password: TEMP_PASSWORD,
    });
    if (!login.ok && !login.data?.token) {
      fail(`Login failed: ${login.status} ${JSON.stringify(login.data)}`);
    }
    const token = String(login.data.token || "").replace(/^Bearer\s+/i, "");
    log("6) Logged in");

    // Purchase stock (credit) — IRS Flour + Macaroni
    const purchase = await api("POST", "/account/purchase-stock", token, {
      facilityId: FACILITY_ID,
      user_id: USER_ID,
      supplier_no: SUPPLIER,
      terms: "30",
      remark: "July stock purchase — demo re-entry",
      transaction_date: "2026-07-10",
      due_date: "2026-08-09",
      target_branch_id: BRANCH_ID,
      apply_prepayment: false,
      tax_amount: 34500,
      taxes: [
        {
          id: 9,
          name: "Input VAT",
          rate: 7.5,
          head: "900203",
          amount: 34500,
          tax_type: "exclusive",
          rate_type: "percentage",
          inclusive_type: "exclusive",
        },
      ],
      data: [
        { sku: "PROD-00001", item_code: "PROD-00001", qty: 10, quantity: 10, cost: 28000 },
        { sku: "PROD-00003", item_code: "PROD-00003", qty: 10, quantity: 10, cost: 18000 },
      ],
    });
    log("7) Purchase:", purchase.status, purchase.data?.success ?? purchase.data?.message ?? purchase.data);

    // Operating expense bill (credit)
    const expenseBill = await api("POST", "/account/purchase-expenses", token, {
      facilityId: FACILITY_ID,
      user_id: USER_ID,
      supplier_no: SUPPLIER,
      terms: "30",
      remark: "July electricity",
      transaction_date: "2026-07-15",
      due_date: "2026-08-14",
      mode_of_payment: "credit",
      apply_prepayment: false,
      tax_amount: 0,
      taxes: [],
      data: [
        {
          head: "800301",
          account_head: "800301",
          description: "Electricity Expense",
          cost: 75000,
          quantity: 1,
          qty: 1,
          taxable: "Non-Taxable",
        },
      ],
    });
    log("8) Expense bill:", expenseBill.status, expenseBill.data?.success ?? expenseBill.data?.message ?? expenseBill.data);

    // Cash expense (imprest)
    const cashExp = await api("POST", "/account/direct-expenses", token, {
      facilityId: FACILITY_ID,
      user_id: USER_ID,
      remark: "July office supplies",
      transaction_date: "2026-07-18",
      mode_of_payment: "cash",
      accountHead: { head: "112199" },
      skip_invoice: true,
      data: [
        {
          head: "800207",
          description: "Office Supplies",
          quantity: 1,
          cost: 25000,
          tax_id: null,
        },
      ],
    });
    log("9) Cash expense:", cashExp.status, cashExp.data?.success ?? cashExp.data?.message ?? cashExp.data);

    // Rent expense via bank
    const rent = await api("POST", "/account/direct-expenses", token, {
      facilityId: FACILITY_ID,
      user_id: USER_ID,
      remark: "July shop rent",
      transaction_date: "2026-07-20",
      mode_of_payment: "bank",
      bankAccount: { id: BANK_ID },
      skip_invoice: true,
      data: [
        {
          head: "800201",
          description: "Shop Rent",
          quantity: 1,
          cost: 120000,
          tax_id: null,
        },
      ],
    });
    log("10) Rent (bank):", rent.status, rent.data?.success ?? rent.data?.message ?? rent.data);

    // Credit sale
    const saleTax = Math.round(2 * 32000 * 0.075 * 100) / 100; // 2 bags flour exclusive VAT
    const sale = await api("POST", "/api/v1/transactions/create-sale", token, {
      facilityId: FACILITY_ID,
      created_by: USER_ID,
      customer_id: CUSTOMER,
      txn_type: "Credit Sale",
      transaction_date: "2026-07-25",
      sale_branch_id: BRANCH_ID,
      receivable_code: "112100",
      sale_revenue_code: "610101",
      cost_of_sale: "710101",
      finished_goods_code: "112300",
      discount_amount: 0,
      tax_amount: saleTax,
      apply_prepayment: false,
      defer_payment: false,
      taxes: [
        {
          id: 10,
          name: "Output VAT",
          rate: 7.5,
          head: "900203",
          amount: saleTax,
          tax_type: "exclusive",
          inclusive_type: "exclusive",
          rate_type: "percentage",
        },
      ],
      items: [
        {
          product_id: "PROD-00001",
          quantity: 2,
          quantity_sold: 2,
          selling_price: 32000,
          price: 32000,
          branchId: BRANCH_ID,
          branch_id: BRANCH_ID,
          type: "Regular",
          item_name: "IRS Flour",
        },
      ],
    });
    log("11) Credit sale:", sale.status, sale.data?.success ?? sale.data?.message ?? sale.data);

    // Cash sale
    const cashSaleTax = Math.round(3 * 22000 * 0.075 * 100) / 100;
    const cashSale = await api("POST", "/api/v1/transactions/create-sale", token, {
      facilityId: FACILITY_ID,
      created_by: USER_ID,
      customer_id: CUSTOMER,
      txn_type: "Cash Sale",
      transaction_date: "2026-07-28",
      sale_branch_id: BRANCH_ID,
      receivable_code: "112100",
      sale_revenue_code: "610103",
      cost_of_sale: "710103",
      finished_goods_code: "112300",
      discount_amount: 0,
      tax_amount: cashSaleTax,
      apply_prepayment: false,
      defer_payment: true,
      modeOfPayment: "cash",
      accountHead: { head: "112199" },
      taxes: [
        {
          id: 10,
          name: "Output VAT",
          rate: 7.5,
          head: "900203",
          amount: cashSaleTax,
          tax_type: "exclusive",
          inclusive_type: "exclusive",
          rate_type: "percentage",
        },
      ],
      items: [
        {
          product_id: "PROD-00003",
          quantity: 3,
          quantity_sold: 3,
          selling_price: 22000,
          price: 22000,
          branchId: BRANCH_ID,
          branch_id: BRANCH_ID,
          type: "Regular",
          item_name: "IRS Macaroni",
        },
      ],
    });
    log("12) Cash sale:", cashSale.status, cashSale.data?.success ?? cashSale.data?.message ?? cashSale.data);

    // Depreciation July
    const dep = await api("POST", "/api/assets/depreciation/bulk", token, {
      facilityId: FACILITY_ID,
      periodEndDate: "2026-07-31",
      periodMonths: 1,
      createdBy: USER_ID,
    });
    log("13) Depreciation:", dep.status, JSON.stringify(dep.data)?.slice(0, 400));

    // Payroll July
    const run = await api("POST", "/api/hr/payroll/run", token, {
      month: 7,
      year: 2026,
      facilityId: FACILITY_ID,
      userId: USER_ID,
    });
    log("14) Payroll run:", run.status, run.data?.success ?? run.data?.message ?? JSON.stringify(run.data)?.slice(0, 300));

    const [pays] = await conn.query(
      `SELECT id, status FROM payroll WHERE facilityId=? AND year=2026 AND month=7`,
      [FACILITY_ID]
    );
    const ids = pays.map((p) => p.id);
    log("    payroll rows:", pays.length, "statuses", [...new Set(pays.map((p) => p.status))]);

    if (ids.length) {
      const processed = await api("PUT", "/api/hr/payroll/batch-status", token, {
        ids,
        status: "Processed",
        facilityId: FACILITY_ID,
        userId: USER_ID,
      });
      log("15) Payroll process:", processed.status, processed.data?.success ?? processed.data?.message ?? processed.data);

      const paid = await api("PUT", "/api/hr/payroll/mark-paid", token, {
        month: 7,
        year: 2026,
        facilityId: FACILITY_ID,
        userId: USER_ID,
        mode_of_payment: "bank",
        bankAccountId: BANK_ID,
        payment_date: "2026-07-31",
      });
      log("16) Payroll mark-paid:", paid.status, paid.data?.success ?? paid.data?.message ?? JSON.stringify(paid.data)?.slice(0, 400));
    } else {
      log("15-16) SKIP payroll process/paid — no rows from run");
    }

    // Summary
    const [[gl]] = await conn.query(
      `SELECT COUNT(*) n, COALESCE(SUM(dr),0) dr, COALESCE(SUM(cr),0) cr,
              COALESCE(SUM(dr),0)-COALESCE(SUM(cr),0) diff
       FROM general_ledger WHERE facility_id=?`,
      [FACILITY_ID]
    );
    log("\n=== GL SUMMARY ===");
    log(gl);

    const [top] = await conn.query(
      `SELECT account_code, SUM(dr) dr, SUM(cr) cr, SUM(dr)-SUM(cr) net
       FROM general_ledger WHERE facility_id=?
       GROUP BY account_code HAVING ABS(SUM(dr)-SUM(cr))>0.01
       ORDER BY account_code`,
      [FACILITY_ID]
    );
    log("Net balances by account:");
    top.forEach((r) =>
      log(
        `  ${r.account_code}  Dr ${Number(r.dr).toFixed(2)}  Cr ${Number(r.cr).toFixed(2)}  net ${Number(r.net).toFixed(2)}`
      )
    );
  } finally {
    await conn.query(`UPDATE users SET password=? WHERE id=?`, [originalHash, USER_ID]);
    log("\nRestored original admin password");
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
