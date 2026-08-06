/**
 * Facility-scoped E2E demo for AA Foods / Dala Foods:
 * wipe transactions → seed CoA (incl. VAT balance_switch) →
 * goods + purchase + expense + sale GL → generate P&L / TB / BS / Cash Flow.
 *
 * Usage: node scripts/demo-aa-foods-e2e.js
 */
"use strict";

require("dotenv").config();
const { Sequelize, QueryTypes } = require("sequelize");
const cfg = require("../config/config.json").development;

const FID = "ae9d49ee-3f9c-4f1e-bd6c-d2f18c61269f";
const TODAY = new Date().toISOString().slice(0, 10);
const PERIOD_START = `${new Date().getFullYear()}-01-01`;

// Prefer .env (same DB as the running API); fall back to config.json development.
const dbName = process.env.DB_NAME || cfg.database;
const dbUser = process.env.DB_USERNAME || cfg.username;
const dbPass =
  process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : cfg.password;
const dbHost = process.env.DB_HOST || cfg.host;

const sequelize = new Sequelize(dbName, dbUser, dbPass, {
  host: dbHost,
  dialect: process.env.DB_DIALECT || cfg.dialect || "mysql",
  logging: false,
});

console.log(`[demo] using database ${dbName} @ ${dbHost}`);

async function q(sql, replacements = {}) {
  return sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}

async function exec(sql, replacements = {}) {
  return sequelize.query(sql, { replacements });
}

async function wipeFacility() {
  console.log("\n=== 1. Wipe transactional data ===");
  const deletes = [
    ["general_ledger", "facility_id"],
    ["invoices", "facility_id"],
    ["estimates", "facility_id"],
    ["impress", "facility_id"],
    ["goods_received_notes", "facility_id"],
    ["purchase_orders", "facility_id"],
    ["payment_voucher", "facility_id"],
    ["bank_reconciliation", "facility_id"],
    ["bank_statements", "facility_id"],
    ["bank_discrepancies", "facility_id"],
    ["inventory_valuation", "facility_id"],
  ];
  for (const [table, col] of deletes) {
    try {
      const [r] = await exec(`DELETE FROM \`${table}\` WHERE \`${col}\` = :FID`, {
        FID,
      });
      console.log(`  cleared ${table}:`, r?.affectedRows ?? r);
    } catch (e) {
      console.log(`  skip ${table}:`, e.message.split("\n")[0]);
    }
  }
  try {
    const [r] = await exec(`DELETE FROM store_entries WHERE facilityId = :FID`, {
      FID,
    });
    console.log("  cleared store_entries:", r?.affectedRows ?? r);
  } catch (e) {
    console.log("  skip store_entries:", e.message.split("\n")[0]);
  }
  // Remove prior demo product only
  try {
    await exec(
      `DELETE FROM products WHERE facility_id = :FID AND (sku = 'DEMO-FLOUR-01' OR name LIKE 'DEMO %')`,
      { FID },
    );
  } catch (_) {
    try {
      await exec(
        `DELETE FROM products WHERE facility_id = :FID AND sku = 'DEMO-FLOUR-01'`,
        { FID },
      );
    } catch (e2) {
      console.log("  product cleanup:", e2.message.split("\n")[0]);
    }
  }
}

async function seedCoA() {
  console.log("\n=== 2. Seed / update Chart of Accounts ===");
  // Roots + operating accounts (6-digit leaf codes)
  const accounts = [
    // roots
    {
      code: "1",
      parent: "0",
      level: 1,
      category: "assets",
      type: "Assets",
      description: "Assets",
      nature: "ASSET",
      nb: "DEBIT",
      fs: "BS",
      rb: "fixed",
      alt: null,
      role: "general",
      pl: null,
      display: 0,
    },
    {
      code: "2",
      parent: "0",
      level: 1,
      category: "liabilities",
      type: "Liabilities",
      description: "Liabilities",
      nature: "LIABILITY",
      nb: "CREDIT",
      fs: "BS",
      rb: "fixed",
      alt: null,
      role: "general",
      pl: null,
      display: 0,
    },
    {
      code: "3",
      parent: "0",
      level: 1,
      category: "equity",
      type: "Equity",
      description: "Equity",
      nature: "EQUITY",
      nb: "CREDIT",
      fs: "BS",
      rb: "fixed",
      alt: null,
      role: "general",
      pl: null,
      display: 0,
    },
    {
      code: "4",
      parent: "0",
      level: 1,
      category: "revenue",
      type: "Revenue",
      description: "Revenue",
      nature: "REVENUE",
      nb: "CREDIT",
      fs: "PL",
      rb: "fixed",
      alt: null,
      role: "general",
      pl: null,
      display: 0,
    },
    {
      code: "5",
      parent: "0",
      level: 1,
      category: "expenses",
      type: "Expenses",
      description: "Expenses",
      nature: "EXPENSE",
      nb: "DEBIT",
      fs: "PL",
      rb: "fixed",
      alt: null,
      role: "general",
      pl: null,
      display: 0,
    },
    // leaves
    {
      code: "100001",
      parent: "1",
      level: 2,
      category: "assets",
      type: "Current assets",
      description: "Cash at Bank",
      nature: "ASSET",
      nb: "DEBIT",
      fs: "BS",
      rb: "fixed",
      alt: null,
      role: "bank",
      pl: null,
      display: 1,
      sub: "cash_and_cash_equivalents",
    },
    {
      code: "100002",
      parent: "1",
      level: 2,
      category: "assets",
      type: "Current assets",
      description: "Inventory - Finished Goods",
      nature: "ASSET",
      nb: "DEBIT",
      fs: "BS",
      rb: "fixed",
      alt: null,
      role: "general",
      pl: null,
      display: 1,
      sub: "inventory",
    },
    {
      code: "100003",
      parent: "1",
      level: 2,
      category: "assets",
      type: "Current assets",
      description: "Accounts Receivable",
      nature: "ASSET",
      nb: "DEBIT",
      fs: "BS",
      rb: "fixed",
      alt: null,
      role: "ar",
      pl: null,
      display: 1,
      sub: "receivables",
    },
    {
      code: "200001",
      parent: "2",
      level: 2,
      category: "liabilities",
      type: "Current liabilities",
      description: "Accounts Payable",
      nature: "LIABILITY",
      nb: "CREDIT",
      fs: "BS",
      rb: "fixed",
      alt: null,
      role: "ap",
      pl: null,
      display: 1,
      sub: "trade_payables",
    },
    {
      code: "200002",
      parent: "2",
      level: 2,
      category: "liabilities",
      type: "Current liabilities",
      description: "VAT Control",
      nature: "LIABILITY",
      nb: "CREDIT",
      fs: "BS",
      rb: "balance_switch",
      alt: "ASSET",
      role: "tax_control",
      pl: null,
      display: 1,
      sub: "tax_payable",
    },
    {
      code: "300001",
      parent: "3",
      level: 2,
      category: "equity",
      type: "Equity",
      description: "Opening Balance Equity",
      nature: "EQUITY",
      nb: "CREDIT",
      fs: "BS",
      rb: "fixed",
      alt: null,
      role: "general",
      pl: null,
      display: 1,
      sub: "opening_balance_equity",
    },
    {
      code: "300002",
      parent: "3",
      level: 2,
      category: "equity",
      type: "Equity",
      description: "Retained Earnings",
      nature: "EQUITY",
      nb: "CREDIT",
      fs: "BS",
      rb: "fixed",
      alt: null,
      role: "retained_earnings",
      pl: null,
      display: 1,
      sub: "retained_earnings",
    },
    {
      code: "400001",
      parent: "4",
      level: 2,
      category: "revenue",
      type: "Operating revenue",
      description: "Sales - Goods",
      nature: "REVENUE",
      nb: "CREDIT",
      fs: "PL",
      rb: "fixed",
      alt: null,
      role: "general",
      pl: "turnover",
      display: 1,
      sub: "sales",
    },
    {
      code: "500001",
      parent: "5",
      level: 2,
      category: "expenses",
      type: "Cost of sales",
      description: "Cost of Sales",
      nature: "EXPENSE",
      nb: "DEBIT",
      fs: "PL",
      rb: "fixed",
      alt: null,
      role: "general",
      pl: "cost_of_sales",
      display: 1,
      sub: "cost_of_sales",
    },
    {
      code: "500002",
      parent: "5",
      level: 2,
      category: "expenses",
      type: "Operating expenses",
      description: "Admin & General Expenses",
      nature: "EXPENSE",
      nb: "DEBIT",
      fs: "PL",
      rb: "fixed",
      alt: null,
      role: "general",
      pl: "admin_costs",
      display: 1,
      sub: "operating_expenses",
    },
  ];

  // Clear old CoA for this facility (detach FKs that block delete)
  const fkClean = [
    `DELETE FROM discount_table WHERE facilityId = :FID`,
    `UPDATE taxes SET head=NULL, account_sub_head=NULL WHERE facilityId = :FID`,
  ];
  for (const sql of fkClean) {
    try {
      await exec(sql, { FID });
    } catch (e) {
      console.log("  fk clean skip:", e.message.split("\n")[0]);
    }
  }
  await exec(`SET FOREIGN_KEY_CHECKS=0`);
  await exec(`DELETE FROM account_category WHERE facility_id = :FID`, { FID });
  await exec(`SET FOREIGN_KEY_CHECKS=1`);

  for (const a of accounts) {
    await exec(
      `INSERT INTO account_category
        (code, parent_code, level, category, type, description, subcategory,
         account_nature, normal_balance, fs_section, reporting_behavior,
         alternate_nature, account_role, pl_line, facility_id, is_active, display, created_at, updated_at)
       VALUES
        (:code, :parent, :level, :category, :type, :description, :sub,
         :nature, :nb, :fs, :rb, :alt, :role, :pl, :FID, 1, :display, NOW(), NOW())`,
      {
        code: a.code,
        parent: a.parent,
        level: a.level,
        category: a.category,
        type: a.type,
        description: a.description,
        sub: a.sub || null,
        nature: a.nature,
        nb: a.nb,
        fs: a.fs,
        rb: a.rb,
        alt: a.alt,
        role: a.role,
        pl: a.pl,
        FID,
        display: a.display,
      },
    );
  }
  console.log(`  inserted ${accounts.length} CoA accounts (VAT Control = balance_switch)`);

  await exec(
    `UPDATE business SET
      sale_revenue_code = '400001',
      cost_of_sale = '500001',
      receivable_code = '100003',
      payable_code = '200001',
      finished_goods_code = '100002',
      opening_balance_equity = '300001',
      business_name = COALESCE(NULLIF(business_name,''), 'AA Foods Nigeria Limited')
     WHERE id = :FID`,
    { FID },
  );
  console.log("  updated business account codes");

  // Point all VAT taxes at single VAT control
  await exec(
    `UPDATE taxes SET account_sub_head = '200002', head = '200002'
     WHERE facilityId = :FID`,
    { FID },
  );
  console.log("  pointed Input/Output VAT taxes → 200002 VAT Control");
}

async function registerGoodsAndPost() {
  console.log("\n=== 3. Goods + Purchase + Expense + Sales ===");

  // Discover product columns
  const cols = await q(`SHOW COLUMNS FROM products`);
  const fields = new Set(cols.map((c) => c.Field));
  const nameCol = fields.has("name")
    ? "name"
    : fields.has("product_name")
      ? "product_name"
      : fields.has("item_name")
        ? "item_name"
        : null;

  let productId = `DEMO-FLOUR-01`;
  const insertCols = ["facility_id", "sku"];
  const insertVals = [":FID", ":sku"];
  const reps = { FID, sku: productId };

  if (nameCol) {
    insertCols.push(nameCol);
    insertVals.push(":pname");
    reps.pname = "DEMO Wheat Flour 50kg";
  }
  if (fields.has("cost_price")) {
    insertCols.push("cost_price");
    insertVals.push("10000");
  }
  if (fields.has("selling_price")) {
    insertCols.push("selling_price");
    insertVals.push("15000");
  }
  if (fields.has("status")) {
    insertCols.push("status");
    insertVals.push("'active'");
  }
  if (fields.has("unit_of_measure")) {
    insertCols.push("unit_of_measure");
    insertVals.push("'Bag'");
  }
  if (fields.has("item_type") || fields.has("type")) {
    const t = fields.has("item_type") ? "item_type" : "type";
    insertCols.push(t);
    insertVals.push("'GOODS'");
  }
  if (fields.has("created_at")) {
    insertCols.push("created_at");
    insertVals.push("NOW()");
  }
  if (fields.has("updated_at")) {
    insertCols.push("updated_at");
    insertVals.push("NOW()");
  }

  try {
    await exec(
      `INSERT INTO products (${insertCols.join(",")}) VALUES (${insertVals.join(",")})`,
      reps,
    );
    console.log("  registered goods:", reps.pname || productId);
  } catch (e) {
    console.log("  product insert:", e.message.split("\n")[0]);
    // use existing
    const existing = await q(
      `SELECT * FROM products WHERE facility_id = :FID LIMIT 1`,
      { FID },
    );
    if (existing[0]) {
      productId = existing[0].sku || existing[0].id || productId;
      console.log("  using existing product", productId);
    }
  }

  // Opening cash via equity
  await postGL({
    date: PERIOD_START,
    code: "100001",
    parent: "1",
    dr: 500000,
    cr: 0,
    desc: "Cash at Bank",
    tdesc: "Opening cash",
    ref: "DEMO-OB-1",
    type: "opening_balance",
  });
  await postGL({
    date: PERIOD_START,
    code: "300001",
    parent: "3",
    dr: 0,
    cr: 500000,
    desc: "Opening Balance Equity",
    tdesc: "Opening cash",
    ref: "DEMO-OB-1",
    type: "opening_balance",
  });

  // Purchase: 10 bags @ 10,000 + 7.5% VAT = 100,000 + 7,500
  // DR Inventory 100000, DR VAT 7500, CR AP 107500
  await postGL({
    date: TODAY,
    code: "100002",
    parent: "1",
    dr: 100000,
    cr: 0,
    desc: "Inventory - Finished Goods",
    tdesc: "Purchase DEMO Wheat Flour 10 bags",
    ref: "DEMO-PUR-1",
    type: "inventory",
  });
  await postGL({
    date: TODAY,
    code: "200002",
    parent: "2",
    dr: 7500,
    cr: 0,
    desc: "VAT Control",
    tdesc: "Input VAT on purchase",
    ref: "DEMO-PUR-1",
    type: "tax",
  });
  await postGL({
    date: TODAY,
    code: "200001",
    parent: "2",
    dr: 0,
    cr: 107500,
    desc: "Accounts Payable",
    tdesc: "Supplier bill DEMO-PUR-1",
    ref: "DEMO-PUR-1",
    type: "payable",
  });
  console.log("  purchase posted: Inventory 100,000 + Input VAT 7,500 / AP 107,500");

  try {
    await exec(
      `INSERT INTO store_entries
        (receive_date, reference_number, qty_in, qty_out, cost_price, selling_price,
         facilityId, type, status, product_id, inserted_by)
       VALUES (:d, 'DEMO-PUR-1', 10, 0, 10000, 15000, :FID, 'purchase', 'posted', :pid, 'demo-script')`,
      { d: TODAY, FID, pid: productId },
    );
    console.log("  store_entries qty_in 10");
  } catch (e) {
    console.log("  store_entries:", e.message.split("\n")[0]);
  }

  // Pay supplier from bank
  await postGL({
    date: TODAY,
    code: "200001",
    parent: "2",
    dr: 107500,
    cr: 0,
    desc: "Accounts Payable",
    tdesc: "Pay supplier DEMO-PUR-1",
    ref: "DEMO-PAY-1",
    type: "payment",
  });
  await postGL({
    date: TODAY,
    code: "100001",
    parent: "1",
    dr: 0,
    cr: 107500,
    desc: "Cash at Bank",
    tdesc: "Pay supplier DEMO-PUR-1",
    ref: "DEMO-PAY-1",
    type: "bank",
  });
  console.log("  supplier paid from bank");

  // Expense: admin 25,000 cash
  await postGL({
    date: TODAY,
    code: "500002",
    parent: "5",
    dr: 25000,
    cr: 0,
    desc: "Admin & General Expenses",
    tdesc: "Office / admin expense",
    ref: "DEMO-EXP-1",
    type: "expenses",
  });
  await postGL({
    date: TODAY,
    code: "100001",
    parent: "1",
    dr: 0,
    cr: 25000,
    desc: "Cash at Bank",
    tdesc: "Office / admin expense",
    ref: "DEMO-EXP-1",
    type: "bank",
  });
  console.log("  expense posted: Admin 25,000");

  // Sale: 6 bags @ 15,000 = 90,000 + VAT 6,750 = 96,750 cash
  // COGS 6 * 10000 = 60,000
  await postGL({
    date: TODAY,
    code: "100001",
    parent: "1",
    dr: 96750,
    cr: 0,
    desc: "Cash at Bank",
    tdesc: "Cash sale 6 bags flour",
    ref: "DEMO-SAL-1",
    type: "bank",
  });
  await postGL({
    date: TODAY,
    code: "400001",
    parent: "4",
    dr: 0,
    cr: 90000,
    desc: "Sales - Goods",
    tdesc: "Cash sale 6 bags flour",
    ref: "DEMO-SAL-1",
    type: "revenue",
  });
  await postGL({
    date: TODAY,
    code: "200002",
    parent: "2",
    dr: 0,
    cr: 6750,
    desc: "VAT Control",
    tdesc: "Output VAT on sale",
    ref: "DEMO-SAL-1",
    type: "tax",
  });
  await postGL({
    date: TODAY,
    code: "500001",
    parent: "5",
    dr: 60000,
    cr: 0,
    desc: "Cost of Sales",
    tdesc: "COGS 6 bags",
    ref: "DEMO-SAL-1",
    type: "expenses",
  });
  await postGL({
    date: TODAY,
    code: "100002",
    parent: "1",
    dr: 0,
    cr: 60000,
    desc: "Inventory - Finished Goods",
    tdesc: "COGS 6 bags",
    ref: "DEMO-SAL-1",
    type: "inventory",
  });
  console.log("  sale posted: Revenue 90,000 + Output VAT 6,750; COGS 60,000");

  try {
    await exec(
      `INSERT INTO store_entries
        (receive_date, reference_number, qty_in, qty_out, cost_price, selling_price,
         facilityId, type, status, product_id, inserted_by)
       VALUES (:d, 'DEMO-SAL-1', 0, 6, 10000, 15000, :FID, 'sales', 'posted', :pid, 'demo-script')`,
      { d: TODAY, FID, pid: productId },
    );
  } catch (_) {}

  // VAT net = Input 7500 - Output 6750 = DR 750 → recoverable asset via balance_switch
  console.log("  VAT Control net = DR 750 (recoverable → BS asset via balance_switch)");
}

async function postGL({
  date,
  code,
  parent,
  dr,
  cr,
  desc,
  tdesc,
  ref,
  type,
}) {
  await exec(
    `INSERT INTO general_ledger
      (transaction_date, account_code, account_subhead, dr, cr,
       account_description, transaction_description, reference_number,
       purpose_of_payment, created_by, facility_id, status, type,
       transaction_ref, created_at, updated_at)
     VALUES
      (:date, :code, :parent, :dr, :cr, :desc, :tdesc, :ref,
       :tdesc, 'demo-script', :FID, 'posted', :type, :ref, NOW(), NOW())`,
    { date, code, parent, dr, cr, desc, tdesc, ref, type, FID },
  );
}

async function generateReports() {
  console.log("\n=== 4. Generate reports ===");
  // Require compiled? Use babel-node path - scripts run with plain node.
  // Call controllers via dynamic require of src (may need babel). Prefer raw SQL summaries + HTTP if server up.

  const accountingReports = require("../src/controller/accountingReports");

  const call = (fn, body) =>
    new Promise((resolve) => {
      const req = { body, query: {}, params: {} };
      const res = {
        statusCode: 200,
        status(c) {
          this.statusCode = c;
          return this;
        },
        json(payload) {
          resolve({ status: this.statusCode, payload });
          return this;
        },
      };
      Promise.resolve(fn(req, res)).catch((err) =>
        resolve({ status: 500, payload: { success: false, message: err.message } }),
      );
    });

  const tb = await call(accountingReports.getTrialBalance, {
    facilityId: FID,
    asOfDate: TODAY,
  });
  const pl = await call(accountingReports.getIncomeStatement, {
    facilityId: FID,
    fromDate: PERIOD_START,
    toDate: TODAY,
  });
  const bs = await call(accountingReports.getBalanceSheet, {
    facilityId: FID,
    asOfDate: TODAY,
  });
  const cf = await call(accountingReports.getCashFlowStatement, {
    facilityId: FID,
    fromDate: PERIOD_START,
    toDate: TODAY,
  });

  const summary = {
    trialBalance: {
      ok: !!tb.payload?.success,
      totals: tb.payload?.totals || tb.payload?.results?.totals || null,
      message: tb.payload?.message,
    },
    incomeStatement: {
      ok: !!pl.payload?.success,
      keys: pl.payload ? Object.keys(pl.payload).slice(0, 12) : [],
      message: pl.payload?.message,
    },
    balanceSheet: {
      ok: !!bs.payload?.success,
      message: bs.payload?.message,
      assets: (bs.payload?.assets || bs.payload?.results?.assets || []).length,
      liabilities: (
        bs.payload?.liabilities ||
        bs.payload?.results?.liabilities ||
        []
      ).length,
    },
    cashFlow: {
      ok: !!cf.payload?.success,
      message: cf.payload?.message,
    },
  };

  // Highlight VAT on BS
  const assets =
    bs.payload?.assets ||
    bs.payload?.results?.assets ||
    bs.payload?.data?.assets ||
    [];
  const liabilities =
    bs.payload?.liabilities ||
    bs.payload?.results?.liabilities ||
    bs.payload?.data?.liabilities ||
    [];
  const vatAsset = assets.find?.((r) => String(r.account_code) === "200002");
  const vatLiab = liabilities.find?.(
    (r) => String(r.account_code) === "200002",
  );

  console.log(JSON.stringify({ summary, vatAsset, vatLiab }, null, 2));

  // Quick TB leaf check via SQL
  const nets = await q(
    `SELECT ac.code, ac.description, ac.reporting_behavior,
            COALESCE(SUM(gl.dr),0) dr, COALESCE(SUM(gl.cr),0) cr,
            COALESCE(SUM(gl.dr-gl.cr),0) net_debit
     FROM account_category ac
     LEFT JOIN general_ledger gl
       ON gl.account_code = ac.code AND gl.facility_id = ac.facility_id
      AND gl.status IN ('paid','posted')
     WHERE ac.facility_id = :FID AND ac.display = 1
     GROUP BY ac.code, ac.description, ac.reporting_behavior
     ORDER BY ac.code`,
    { FID },
  );
  console.log("\nAccount nets:");
  for (const r of nets) {
    console.log(
      `  ${r.code} ${r.description}: DR ${r.dr} CR ${r.cr} netDR ${r.net_debit}${
        r.reporting_behavior === "balance_switch" ? " [SWITCH]" : ""
      }`,
    );
  }

  return { tb, pl, bs, cf, nets };
}

(async () => {
  await sequelize.authenticate();
  const [[biz]] = await sequelize.query(
    `SELECT id, business_name FROM business WHERE id = :FID`,
    { replacements: { FID }, type: QueryTypes.SELECT },
  ).then((rows) => [rows]);
  // sequelize.query with SELECT returns array of rows directly when type SELECT
  const bizRows = await q(`SELECT id, business_name FROM business WHERE id = :FID`, {
    FID,
  });
  console.log("Facility:", bizRows[0] || biz);

  await wipeFacility();
  await seedCoA();
  await registerGoodsAndPost();
  await generateReports();

  console.log("\n✅ Demo complete for facility", FID);
  console.log("Open in UI:");
  console.log("  - Chart of Accounts");
  console.log("  - Reports → P&L / Trial Balance / Balance Sheet / Cash Flow");
  await sequelize.close();
})().catch(async (e) => {
  console.error(e);
  try {
    await sequelize.close();
  } catch (_) {}
  process.exit(1);
});
