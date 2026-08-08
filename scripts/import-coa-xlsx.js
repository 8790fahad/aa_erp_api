#!/usr/bin/env node
/**
 * Import Chart of Accounts from scripts/coa-from-xlsx.json (sourced from CoA.xlsx)
 * into the active facility, assign hierarchy/parent codes, remap demo GL, and wire defaults.
 *
 * Usage: node scripts/import-coa-xlsx.js
 * Env: DB_* from aa_erp_api/.env ; optional FACILITY_ID=
 */
"use strict";

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const FACILITY_ID =
  process.env.FACILITY_ID || "094c6e1e-dd07-48c4-a344-6e9d58cd7861";

const NATURE_ROOTS = [
  {
    code: "1",
    description: "Assets",
    category: "assets",
    account_nature: "ASSET",
    type: "Assets",
    normal_balance: "debit",
    fs_section: "balance_sheet",
  },
  {
    code: "2",
    description: "Liabilities",
    category: "liabilities",
    account_nature: "LIABILITY",
    type: "Liabilities",
    normal_balance: "credit",
    fs_section: "balance_sheet",
  },
  {
    code: "3",
    description: "Equity",
    category: "equity",
    account_nature: "EQUITY",
    type: "Equity",
    normal_balance: "credit",
    fs_section: "balance_sheet",
  },
  {
    code: "4",
    description: "Revenue",
    category: "revenue",
    account_nature: "REVENUE",
    type: "Revenue",
    normal_balance: "credit",
    fs_section: "profit_and_loss",
  },
  {
    code: "5",
    description: "Expenses",
    category: "expenses",
    account_nature: "EXPENSE",
    type: "Expenses",
    normal_balance: "debit",
    fs_section: "profit_and_loss",
  },
];

/** Control accounts not present on the client sheet */
const EXTRA_ACCOUNTS = [
  {
    code: "112199",
    name: "Cash on Hand",
    type: "Current Asset",
    forceParent: "112000",
  },
  {
    code: "112241",
    name: "United Bank for Africa (UBA)",
    type: "Current Asset",
    forceParent: "112201",
  },
  {
    code: "300100",
    name: "Owner's Capital",
    type: "Equity",
    forceParent: "3",
  },
  {
    code: "300200",
    name: "Opening Balance Equity",
    type: "Equity",
    forceParent: "3",
  },
  {
    code: "300300",
    name: "Retained Earnings",
    type: "Equity",
    forceParent: "3",
  },
];

/** Demo CoA → new CoA remaps for existing GL rows */
const GL_REMAP = {
  "100001": "112199", // Cash at Bank → Cash on Hand
  "100002": "112300", // Inventory - Finished Goods → INVENTORY
  "100003": "112100", // Accounts Receivable
  "200001": "900201", // Accounts Payable
  "200002": "112103", // VAT Control (demo was input VAT debit) → Input VAT
  "300001": "300200", // Opening Balance Equity
  "300002": "300300", // Retained Earnings
  "400001": "610101", // Sales - Goods → first sales leaf (IRS Flour)
  "500001": "710101", // Cost of Sales
  "500002": "801205", // Admin & General → Miscellaneous Expenses
};

function classify(code, typeRaw, name) {
  const t = String(typeRaw || "").toLowerCase().trim();
  const n = String(name || "").toLowerCase().trim();
  const prefix = String(code)[0];

  let account_nature = "ASSET";
  let category = "assets";
  let normal_balance = "debit";
  let fs_section = "balance_sheet";
  let type = typeRaw || "General";
  let pl_line = null;

  if (prefix === "1" || t.includes("asset")) {
    account_nature = "ASSET";
    category = "assets";
    normal_balance = "debit";
    fs_section = "balance_sheet";
    if (t.includes("non")) type = "Non-current assets";
    else type = "Current assets";
  }
  if (prefix === "9" || t.includes("liabilit")) {
    account_nature = "LIABILITY";
    category = "liabilities";
    normal_balance = "credit";
    fs_section = "balance_sheet";
    type = t.includes("non") ? "Non-current liabilities" : "Current liabilities";
  }
  if (prefix === "6" || t === "revenue") {
    account_nature = "REVENUE";
    category = "revenue";
    normal_balance = "credit";
    fs_section = "profit_and_loss";
    type = "Operating revenue";
    pl_line = "turnover";
  }
  if (prefix === "7" || t.includes("cost of sales")) {
    account_nature = "EXPENSE";
    category = "expenses";
    normal_balance = "debit";
    fs_section = "profit_and_loss";
    type = "Cost of sales";
    pl_line = "cost_of_sales";
  }
  if (prefix === "8" || t === "expenses") {
    account_nature = "EXPENSE";
    category = "expenses";
    normal_balance = "debit";
    fs_section = "profit_and_loss";
    type = "Operating expenses";
    pl_line = "operating_expenses";
  }
  if (prefix === "3" || t === "equity") {
    account_nature = "EQUITY";
    category = "equity";
    normal_balance = "credit";
    fs_section = "balance_sheet";
    type = "Equity";
  }

  // Trust Excel Header/Group markers (do NOT infer from xx00 codes — 112100 AR is a leaf)
  const isHeader =
    t === "header" ||
    n === "assets" ||
    n === "liability" ||
    n === "sales revenue" ||
    n === "cost of sales" ||
    n === "oprating expenses" ||
    n === "operating expenses" ||
    n === "inventory";
  const isGroup = t === "group";

  return {
    account_nature,
    category,
    normal_balance,
    fs_section,
    type,
    pl_line,
    isHeader,
    isGroup,
  };
}

function buildHierarchy(rawRows) {
  const rows = rawRows
    .map((r) => ({
      code: String(r.code).trim(),
      name: String(r.name || r.description || "").trim(),
      typeRaw: String(r.type || "").trim(),
    }))
    .filter((r) => r.code && r.name);

  for (const ex of EXTRA_ACCOUNTS) {
    if (!rows.find((r) => r.code === ex.code)) {
      rows.push({
        code: ex.code,
        name: ex.name,
        typeRaw: ex.type,
        forceParent: ex.forceParent,
      });
    }
  }
  rows.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  const byCode = new Map();

  for (const r of rows) {
    const meta = classify(r.code, r.typeRaw, r.name);
    const node = {
      ...r,
      ...meta,
      parent_code: "0",
      level: 2,
      display: meta.isHeader || meta.isGroup ? 0 : 1,
      reporting_behavior: "fixed",
      alternate_nature: null,
      account_role: "general",
    };

    const prefix = r.code[0];
    if (prefix === "1") node.parent_code = "1";
    else if (prefix === "9") node.parent_code = "2";
    else if (prefix === "6") node.parent_code = "4";
    else if (prefix === "7" || prefix === "8") node.parent_code = "5";
    else if (prefix === "3") node.parent_code = "3";

    if (r.forceParent) node.parent_code = r.forceParent;

    if (meta.isHeader) {
      node.level = 2;
      node.display = 0;
    } else if (meta.isGroup) {
      node.level = 3;
      node.display = 0;
    } else {
      node.level = 4;
      node.display = 1;
    }

    if (/vat payable/i.test(r.name)) {
      node.reporting_behavior = "balance_switch";
      node.alternate_nature = "ASSET";
      node.account_role = "tax_payable";
    }
    if (/input vat/i.test(r.name)) node.account_role = "tax_receivable";
    if (/^accounts receivable$/i.test(r.name.trim())) node.account_role = "receivable";
    if (/trade creditors|accounts payable/i.test(r.name)) node.account_role = "payable";
    if (/cash on hand/i.test(r.name)) node.account_role = "cash";
    if (/^banks$/i.test(r.name.trim())) node.account_role = "bank_group";
    if (/retained earnings/i.test(r.name)) node.account_role = "retained_earnings";
    if (/opening balance equity/i.test(r.name)) node.account_role = "opening_balance_equity";

    byCode.set(r.code, node);
  }

  const all = [...byCode.values()].sort((a, b) =>
    a.code.localeCompare(b.code, undefined, { numeric: true }),
  );

  function resolveParent(node) {
    if (node.forceParent) return byCode.get(node.forceParent) || null;
    if (node.isHeader) {
      // nature root already set
      return null;
    }

    // Product inventory families
    if (node.code.startsWith("120") && node.isGroup) {
      return byCode.get("112300");
    }
    if (node.code.startsWith("12") && !node.isGroup) {
      const groupCode = node.code.slice(0, 4) + "00";
      if (byCode.has(groupCode) && groupCode !== node.code) return byCode.get(groupCode);
      return byCode.get("112300");
    }

    // Bank leaves under Banks group
    if (
      node.code.startsWith("1122") &&
      Number(node.code) >= 112202 &&
      byCode.has("112201")
    ) {
      return byCode.get("112201");
    }

    // Current-asset leaves / groups under CURRENT ASSETS
    if (node.code.startsWith("112") && byCode.has("112000")) {
      if (node.isGroup) return byCode.get("112000");
      // Prefer nearest prior group in 112xxx
      if (byCode.has("112201") && node.code === "112201") return byCode.get("112000");
      // AR, Input VAT, Cash & CE, etc.
      return byCode.get("112000");
    }

    // Non-current under NON-CURRENT ASSET group / ASSETS header
    if (node.code.startsWith("111")) {
      if (node.isGroup) return byCode.get("100000");
      if (byCode.has("111000")) return byCode.get("111000");
      return byCode.get("100000");
    }

    // ASSETS header
    if (node.code === "100000") return null;

    // Revenue / COS / Opex: leaf → family group (xxxx00) → section header
    if (!node.isGroup && !node.isHeader) {
      // Dangote revenue odd codes under 610510
      if (node.code.startsWith("6105") && byCode.has("610510")) {
        return byCode.get("610510");
      }
      const groupCode = node.code.slice(0, 4) + "00";
      if (byCode.has(groupCode) && groupCode !== node.code) {
        return byCode.get(groupCode);
      }
      // opex leaves: 800101 → 800100
      const opexGroup = node.code.slice(0, 4) + "00";
      if (node.code.startsWith("80") && byCode.has(opexGroup)) {
        return byCode.get(opexGroup);
      }
      // liability leaves under CURRENT/NON-CURRENT groups
      if (node.code.startsWith("9002") && byCode.has("900200")) {
        return byCode.get("900200");
      }
      if (node.code.startsWith("9001") && byCode.has("900100")) {
        return byCode.get("900100");
      }
    }

    if (node.isGroup) {
      if (node.code.startsWith("61")) return byCode.get("600000");
      if (node.code.startsWith("71")) return byCode.get("700000");
      if (node.code.startsWith("80")) return byCode.get("800000");
      if (node.code.startsWith("90")) return byCode.get("900000");
      if (node.code.startsWith("11")) return byCode.get("100000");
    }

    return null;
  }

  for (const node of all) {
    const parent = resolveParent(node);
    if (parent) {
      node.parent_code = parent.code;
      node.level = Number(parent.level) + 1;
    } else if (node.isHeader) {
      // keep nature-root parent assigned above; level 2
      node.level = 2;
    } else if (node.forceParent === "3" || node.parent_code === "3") {
      node.level = 2;
    }
  }

  return all;
}

async function main() {
  const jsonPath = path.join(__dirname, "coa-from-xlsx.json");
  if (!fs.existsSync(jsonPath)) {
    console.error("Missing", jsonPath, "— regenerate from CoA.xlsx first");
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const accounts = buildHierarchy(raw);

  const host = process.env.DB_HOST || "127.0.0.1";
  const conn = await mysql.createConnection({
    host: host === "localhost" ? "127.0.0.1" : host,
    user: process.env.DB_USERNAME || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "aa_erp_db",
    multipleStatements: true,
  });

  console.log("Facility", FACILITY_ID);
  console.log("Importing", accounts.length, "accounts (+ nature roots)");

  await conn.beginTransaction();
  try {
    await conn.query(`DELETE FROM account_category WHERE facility_id = ?`, [
      FACILITY_ID,
    ]);

    for (const root of NATURE_ROOTS) {
      await conn.query(
        `INSERT INTO account_category
          (code, parent_code, level, category, type, description, account_nature,
           facility_id, is_active, display, normal_balance, fs_section,
           reporting_behavior, alternate_nature, account_role, pl_line, created_at, updated_at)
         VALUES (?, '0', 1, ?, ?, ?, ?, ?, 1, 0, ?, ?, 'fixed', NULL, 'general', NULL, NOW(), NOW())`,
        [
          root.code,
          root.category,
          root.type,
          root.description,
          root.account_nature,
          FACILITY_ID,
          root.normal_balance,
          root.fs_section,
        ],
      );
    }

    for (const a of accounts) {
      await conn.query(
        `INSERT INTO account_category
          (code, parent_code, level, category, type, description, account_nature,
           facility_id, is_active, display, normal_balance, fs_section,
           reporting_behavior, alternate_nature, account_role, pl_line, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          a.code,
          a.parent_code || "0",
          a.level,
          a.category,
          a.type,
          a.name.slice(0, 200),
          a.account_nature,
          FACILITY_ID,
          a.display ? 1 : 0,
          a.normal_balance,
          a.fs_section,
          a.reporting_behavior || "fixed",
          a.alternate_nature,
          a.account_role || "general",
          a.pl_line,
        ],
      );
    }

    const ar = accounts.find(
      (a) => /^accounts receivable$/i.test(a.name.trim()) && a.display,
    );
    const ap = accounts.find((a) => /trade creditors|accounts payable/i.test(a.name));
    const vat = accounts.find((a) => /vat payable/i.test(a.name));
    const inputVat = accounts.find((a) => /input vat/i.test(a.name));
    const cash = accounts.find((a) => /cash on hand/i.test(a.name));
    const invCtrl = accounts.find((a) => a.code === "112300");
    const equityOB = accounts.find((a) => /opening balance equity/i.test(a.name));
    const salesLeaf = accounts.find(
      (a) => a.account_nature === "REVENUE" && a.display && a.code.startsWith("61"),
    );
    const cosLeaf = accounts.find(
      (a) => a.pl_line === "cost_of_sales" && a.display && a.code.startsWith("71"),
    );

    await conn.query(
      `UPDATE business SET
         receivable_code = ?,
         payable_code = ?,
         sale_revenue_code = ?,
         cost_of_sale = ?,
         opening_balance_equity = ?
       WHERE id = ?`,
      [
        ar?.code || "112100",
        ap?.code || "900201",
        salesLeaf?.code || "610101",
        cosLeaf?.code || "710101",
        equityOB?.code || "300200",
        FACILITY_ID,
      ],
    );

    // Remap existing GL demo rows to new codes + subheads
    let remapped = 0;
    for (const [from, to] of Object.entries(GL_REMAP)) {
      const target = accounts.find((a) => a.code === to);
      if (!target) continue;
      const [res] = await conn.query(
        `UPDATE general_ledger
         SET account_code = ?, account_subhead = ?, account_description = ?
         WHERE facility_id = ? AND account_code = ?`,
        [to, target.parent_code, target.name.slice(0, 300), FACILITY_ID, from],
      );
      remapped += res.affectedRows || 0;
    }

    // Map bank_accounts.head to CoA bank ledger codes by name
    const bankNameMap = [
      [/jaiz/i, "112225"],
      [/fcmb|first city monument/i, "112207"],
      [/uba/i, "112241"],
      [/ubn|unity/i, "112228"],
      [/taj/i, "112226"],
      [/access/i, "112202"],
      [/gtbank|guaranty trust/i, "112209"],
      [/first bank/i, "112206"],
      [/zenith/i, "112230"],
      [/sterling/i, "112221"],
      [/wema/i, "112229"],
      [/opay/i, "112231"],
      [/moniepoint/i, "112232"],
    ];
    const [banks] = await conn.query(
      `SELECT id, account_name, head FROM bank_accounts WHERE facility_id = ?`,
      [FACILITY_ID],
    );
    let banksMapped = 0;
    for (const b of banks) {
      let code = null;
      for (const [re, c] of bankNameMap) {
        if (re.test(b.account_name || "")) {
          code = c;
          break;
        }
      }
      if (!code) continue;
      const target = accounts.find((a) => a.code === code);
      if (!target) continue;
      await conn.query(
        `UPDATE bank_accounts SET head = ? WHERE id = ? AND facility_id = ?`,
        [code, b.id, FACILITY_ID],
      );
      banksMapped += 1;
    }

    // Products: link by exact name when Inv+Rev+COS exist; else trading defaults
    const [products] = await conn.query(
      `SELECT id, name FROM products WHERE facility_id = ?`,
      [FACILITY_ID],
    );
    let linked = 0;
    let defaulted = 0;
    const defInv = invCtrl?.code || "112300";
    const defRev = salesLeaf?.code || "610101";
    const defCos = cosLeaf?.code || "710101";

    for (const p of products) {
      const name = String(p.name || "").trim().toLowerCase();
      if (!name) continue;
      const inv = accounts.find(
        (a) =>
          a.display &&
          a.account_nature === "ASSET" &&
          a.code.startsWith("12") &&
          a.name.toLowerCase() === name,
      );
      const rev = accounts.find(
        (a) =>
          a.display &&
          a.account_nature === "REVENUE" &&
          a.name.toLowerCase() === name,
      );
      const cos = accounts.find(
        (a) =>
          a.display &&
          a.pl_line === "cost_of_sales" &&
          a.name.toLowerCase() === name,
      );
      if (inv && rev && cos) {
        await conn.query(
          `UPDATE products
           SET inventory_account = ?, revenue_account = ?, cogs_head = ?
           WHERE id = ? AND facility_id = ?`,
          [inv.code, rev.code, cos.code, p.id, FACILITY_ID],
        );
        linked += 1;
      } else {
        await conn.query(
          `UPDATE products
           SET inventory_account = ?, revenue_account = ?, cogs_head = ?
           WHERE id = ? AND facility_id = ?`,
          [defInv, defRev, defCos, p.id, FACILITY_ID],
        );
        defaulted += 1;
      }
    }

    await conn.commit();

    const [[{ c }]] = await conn.query(
      `SELECT COUNT(*) c FROM account_category WHERE facility_id = ?`,
      [FACILITY_ID],
    );
    const [[{ d }]] = await conn.query(
      `SELECT COUNT(*) d FROM account_category WHERE facility_id = ? AND display = 1`,
      [FACILITY_ID],
    );

    console.log("\n✅ CoA imported from CoA.xlsx");
    console.log("  total accounts:", c, "(displayable:", d + ")");
    console.log("  AR:", ar?.code, ar?.name);
    console.log("  AP:", ap?.code, ap?.name);
    console.log("  Input VAT:", inputVat?.code);
    console.log("  VAT Payable:", vat?.code, "(balance_switch)");
    console.log("  Cash:", cash?.code, cash?.name);
    console.log("  Inventory ctrl:", invCtrl?.code);
    console.log("  Default Sales:", salesLeaf?.code, salesLeaf?.name);
    console.log("  Default COS:", cosLeaf?.code, cosLeaf?.name);
    console.log("  Equity OB:", equityOB?.code);
    console.log("  GL rows remapped:", remapped);
    console.log("  Bank accounts mapped:", banksMapped);
    console.log("  Products linked by name:", linked);
    console.log("  Products on trading defaults:", defaulted);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
