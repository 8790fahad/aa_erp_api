"use strict";

/**
 * Nexifour resalable sheet, checked against the chart of accounts.
 *
 * Revenue, cost of sales, and inventory share one suffix. The sheet had five
 * inventory or cost codes sitting on a different product:
 *   P005 120705 Maikwabo Maccaroni        -> 120105 IRS Bakers Pride Flour
 *   P024 120703 Maikwabo Pasta Slim       -> 120407 Rafa Detergent (45x84)
 *   P026 120704 Maikwabo Pasta Standard   -> 120408 Rafa Detergent (22x162)
 *   P045 710801 Mangal Rice / 120903      -> 710803 / 120803 Juicy Orange
 *   P046 710802 Optimum Rice / 120902     -> 710804 / 120804 Mangal Cement
 * P025 was parked on the 40x92 accounts. It gets 610409 / 710409 / 120409.
 * P027 is Dangote pasta, category DANGOTE.
 * Categories are the product_categories names already on this business.
 *
 * A zero cost or selling price on the sheet does not wipe a price already saved.
 * A zero quantity does not wipe stock. A quantity above zero sets the sellable
 * balance to that figure.
 */

const FACILITY_ID = "094c6e1e-dd07-48c4-a344-6e9d58cd7861";

const CATEGORIES = [
  "BUA",
  "IRS",
  "OLAM",
  "Sterium Detergent",
  "Rafa Products",
  "DANGOTE",
  "HONEY",
  "MANGAL",
  "GOLDEN PENNY",
  "NASCON",
];

function norm(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function accounts(revenue) {
  return {
    revenue,
    cogs: `7${revenue.slice(1)}`,
    inventory: `12${revenue.slice(2)}`,
  };
}

function row(sku, names, category, selling, cost, qty, revenue, uom) {
  return {
    sku,
    name: names[0],
    keys: [...new Set(names.map(norm))],
    category,
    selling: selling > 0 ? selling : null,
    cost: cost > 0 ? cost : null,
    qty: qty > 0 ? qty : null,
    uom,
    ...accounts(revenue),
  };
}

const PRODUCTS = [
  row("P001", ["IRS Flour"], "IRS", 49500, 49000, 18000, "610101", "Bags"),
  row("P002", ["IRS Pasta"], "IRS", 13000, 12300, 94500, "610102", "Catton"),
  row("P003", ["IRS Macaroni Cavatto", "IRS Macaroni"], "IRS", 11200, 11000, 2500, "610103", "Catton"),
  row("P004", ["IRS Brand (Dusa)", "IRS Bran (Dusa)"], "IRS", 20000, 15000, 21000, "610104", "Bags"),
  row("P005", ["IRS Bakers Pride Flour", "IRS Bakers Pride"], "IRS", 46500, 45000, 33300, "610105", "Bags"),
  row("P006", ["Bua Thailand Rice", "BUA Thailand Rice"], "BUA", 5900, 0, 0, "610201", "Bags"),
  row("P007", ["Bua Sugar(50kg)", "Bua Sugar 50kg", "BUA Sugar (50kg)"], "BUA", 73500, 73500, 38700, "610202", "Bags"),
  row("P008", ["Bua Sugar(25kg)", "Bua Sugar 25kg", "BUA Sugar (25kg)"], "BUA", 37000, 0, 0, "610203", "Bags"),
  row("P009", ["Bua Cement", "BUA Cement"], "BUA", 11650, 0, 0, "610204", "Bags"),
  row("P010", ["Bua Rice", "BUA Rice"], "BUA", 59000, 57000, 4100, "610205", "Bags"),
  row("P011", ["Sokoto Cement"], "BUA", 11650, 11750, 4500, "610206", "Bags"),
  row("P012", ["Crown Flour"], "OLAM", 0, 0, 0, "610301", "Bags"),
  row("P013", ["Crowan Pasta(slim)", "Crown Pasta(slim)", "Crown Pasta Slim", "Crown Pasta (Slim)"], "OLAM", 12700, 12550, 59500, "610302", "Catton"),
  row("P014", ["Crown Thick Pasta"], "OLAM", 12700, 0, 0, "610303", "Catton"),
  row("P015", ["Crown premium Thick Pasta", "Crown Premium Thick Pasta"], "OLAM", 17200, 0, 0, "610304", "Catton"),
  row("P016", ["Crown Maccaroni", "Crown Macaroni"], "OLAM", 11700, 0, 0, "610305", "Catton"),
  row("P017", ["Crown Premium Maccaroni", "Crown Premium Macaroni"], "OLAM", 17200, 0, 0, "610306", "Catton"),
  row("P018", ["Crown Premium Slim Pasta"], "OLAM", 17200, 0, 0, "610307", "Catton"),
  row("P019", ["Rafa Detargent(850x7pcs)", "Rafa Detergent(850x7pcs)", "Rafa Detergent (850x7pcs)"], "Rafa Products", 11700, 0, 0, "610401", "Catton"),
  row("P020", ["Rafa Detargent(170x26pcs)", "Rafa Detergent(170x26pcs)", "Rafa Detergent (170x26pcs)"], "Rafa Products", 9300, 0, 0, "610402", "Catton"),
  row("P021", ["Rafa Detargent(150x26pcs)", "Rafa Detergent(150x26pcs)", "Rafa Detergent (150x26pcs)"], "Rafa Products", 8000, 0, 0, "610403", "Catton"),
  row("P022", ["Rafa Detargent(125x36pcs)", "Rafa Detergent(125x36pcs)", "Rafa Detergent (125x36pcs)"], "Rafa Products", 7400, 0, 0, "610404", "Catton"),
  row("P023", ["Rafa Detargent(85x52pcs)", "Rafa Detergent(85x52pcs)", "Rafa Detergent (85x52)"], "Rafa Products", 8700, 8700, 3600, "610405", "Catton"),
  row("P024", ["Rafa Detergent(45x84)", "Rafa Detergent (45x84)"], "Rafa Products", 7900, 0, 0, "610407", "Catton"),
  row("P025", ["Rafa Detargent(55x84pcs)", "Rafa Detergent(55x84pcs)", "Rafa Detergent (55x84pcs)"], "Rafa Products", 0, 0, 0, "610409", "Catton"),
  row("P026", ["Rafa Detergent(22x162)", "Rafa Detergent (22x162)"], "Rafa Products", 8000, 0, 0, "610408", "Catton"),
  row("P027", ["Dangote pasta", "Dangote Pasta"], "DANGOTE", 12500, 0, 0, "610501", "Catton"),
  row("P028", ["Dangote Salt"], "NASCON", 17500, 0, 0, "610901", "Bags"),
  row("P029", ["Dangote Sugar(25kg)", "Dangote Sugar 25kg"], "DANGOTE", 37000, 0, 0, "610503", "Bags"),
  row("P030", ["Dangote Sugar(50kg)", "Dangote Sugar 50kg"], "DANGOTE", 73500, 0, 0, "610504", "Bags"),
  row("P031", ["Dangote Crude Salt"], "DANGOTE", 18000, 0, 0, "610505", "Bags"),
  row("P032", ["Dangote Refined Salt by20", "Dangote Refined Salt by 20"], "DANGOTE", 7700, 0, 0, "610506", "Bags"),
  row("P033", ["Dangote Refined Salt by40", "Dangote Refined Salt by 40"], "DANGOTE", 7800, 0, 0, "610507", "Bags"),
  row("P034", ["Dangote Refined Salt by80", "Dangote Refined Salt by 80"], "DANGOTE", 8000, 0, 0, "610508", "Bags"),
  row("P035", ["Dangote Bread Flour"], "DANGOTE", 29000, 0, 0, "610509", "Bags"),
  row("P036", ["Honey Cavatto"], "HONEY", 11700, 0, 0, "610601", "Catton"),
  row("P037", ["Honey Pasta"], "HONEY", 12500, 0, 0, "610602", "Catton"),
  row("P038", ["Honey Pasta Slim"], "HONEY", 12500, 0, 0, "610603", "Catton"),
  row("P039", ["Honey Flour"], "HONEY", 48000, 0, 0, "610604", "Bags"),
  row("P040", ["Golen Penny Maccaroni", "Golden Penny Maccaroni"], "GOLDEN PENNY", 17700, 0, 0, "610701", "Catton"),
  row("P041", ["Golden Penny Sphagetti", "Golden Penny Spaghetti", "Golden Penny Pasta"], "GOLDEN PENNY", 18750, 0, 0, "610702", "Catton"),
  row("P042", ["Mangal Rice"], "MANGAL", 55000, 0, 0, "610801", "Bags"),
  row("P043", ["Optimum Rice"], "MANGAL", 60000, 0, 0, "610802", "Bags"),
  row("P044", ["Rafa Deterget(40gX92)", "Rafa Detergent(40gX92)", "Rafa Detergent (40x92pcs)", "Rafa Detergent (40x92)"], "Rafa Products", 7900, 7900, 5400, "610406", "Catton"),
  row("P045", ["Juicy Orange"], "MANGAL", 36500, 36000, 2919, "610803", "Catton"),
  row("P046", ["Mangal Cement"], "MANGAL", 11680, 11650, 900, "610804", "Bags"),
];

const NORM_SQL =
  "LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`name`, ' ', ''), '(', ''), ')', ''), '-', ''), '.', ''), '/', ''))";

function codeEq(column, valueSql) {
  const side = (expr) => `CONVERT(${expr} USING utf8mb4) COLLATE utf8mb4_general_ci`;
  return `${side(column)} = ${side(valueSql)}`;
}

async function ensureAccount(sequelize, transaction, code, description) {
  const found = await sequelize.query(
    `SELECT code FROM account_category
     WHERE facility_id = :facilityId AND code = :code LIMIT 1`,
    {
      replacements: { facilityId: FACILITY_ID, code },
      type: sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  if (found.length) return;

  const kind = code.startsWith("6")
    ? {
        parent: `${code.slice(0, 4)}00`,
        category: "revenue",
        type: "Operating revenue",
        nature: "REVENUE",
        normal: "credit",
        fs: "profit_and_loss",
        pl: "turnover",
        sub: "sales",
      }
    : code.startsWith("7")
      ? {
          parent: `${code.slice(0, 4)}00`,
          category: "expenses",
          type: "Cost of sales",
          nature: "EXPENSE",
          normal: "debit",
          fs: "profit_and_loss",
          pl: "cost_of_sales",
          sub: "direct_materials",
        }
      : {
          parent: `${code.slice(0, 4)}00`,
          category: "assets",
          type: "Current assets",
          nature: "ASSET",
          normal: "debit",
          fs: "balance_sheet",
          pl: null,
          sub: "inventory",
        };

  const idRows = await sequelize.query(
    "SHOW COLUMNS FROM account_category LIKE 'id'",
    { type: sequelize.QueryTypes.SELECT, transaction },
  );
  const auto = String(idRows[0]?.Extra || idRows[0]?.extra || "")
    .toLowerCase()
    .includes("auto_increment");
  const cols = auto ? "" : "id, ";
  const vals = auto ? "" : ":id, ";
  let id = null;
  if (!auto) {
    const [next] = await sequelize.query(
      "SELECT IFNULL(MAX(id), 0) + 1 AS nextId FROM account_category",
      { type: sequelize.QueryTypes.SELECT, transaction },
    );
    id = next.nextId;
  }
  await sequelize.query(
    `INSERT INTO account_category (
       ${cols}code, parent_code, level, category, type, description, account_nature,
       facility_id, is_active, display, created_at, updated_at, subcategory,
       normal_balance, fs_section, reporting_behavior, account_role, pl_line
     ) VALUES (
       ${vals}:code, :parent, 4, :category, :type, :description, :nature,
       :facilityId, 1, 1, NOW(), NOW(), :sub,
       :normal, :fs, 'fixed', 'general', :pl
     )`,
    {
      replacements: {
        id,
        code,
        parent: kind.parent,
        category: kind.category,
        type: kind.type,
        description,
        nature: kind.nature,
        facilityId: FACILITY_ID,
        sub: kind.sub,
        normal: kind.normal,
        fs: kind.fs,
        pl: kind.pl,
      },
      transaction,
    },
  );
}

async function ensureCategories(sequelize, transaction) {
  for (const name of CATEGORIES) {
    const existing = await sequelize.query(
      `SELECT id FROM product_categories
       WHERE facility_id = :facilityId AND LOWER(TRIM(name)) = LOWER(:name) LIMIT 1`,
      {
        replacements: { facilityId: FACILITY_ID, name },
        type: sequelize.QueryTypes.SELECT,
        transaction,
      },
    );
    if (existing.length) continue;
    await sequelize.query(
      `INSERT INTO product_categories (facility_id, name, description, status, created_at, updated_at)
       VALUES (:facilityId, :name, NULL, 'active', NOW(), NOW())`,
      { replacements: { facilityId: FACILITY_ID, name }, transaction },
    );
  }
}

async function findProduct(sequelize, transaction, product) {
  const byName = await sequelize.query(
    `SELECT id, sku, name FROM products
     WHERE facility_id = :facilityId AND ${NORM_SQL} IN (:keys)
     LIMIT 1`,
    {
      replacements: { facilityId: FACILITY_ID, keys: product.keys },
      type: sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  if (byName.length) return byName[0];
  const bySku = await sequelize.query(
    `SELECT id, sku, name FROM products
     WHERE facility_id = :facilityId AND sku = :sku LIMIT 1`,
    {
      replacements: { facilityId: FACILITY_ID, sku: product.sku },
      type: sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  return bySku[0] || null;
}

async function saveProduct(sequelize, transaction, product) {
  const current = await findProduct(sequelize, transaction, product);
  const sets = [
    "name = :name",
    "category = :category",
    "revenue_account = :revenue",
    "cogs_head = :cogs",
    "inventory_account = :inventory",
    "unit_of_measure = :uom",
    "item_type = 'Resalable'",
    "status = 'Active'",
  ];
  if (product.selling != null) sets.push("selling_price = :selling");
  if (product.cost != null) sets.push("cost_price = :cost");

  if (!current) {
    const idRows = await sequelize.query(
      "SHOW COLUMNS FROM products LIKE 'id'",
      { type: sequelize.QueryTypes.SELECT, transaction },
    );
    const auto = String(idRows[0]?.Extra || idRows[0]?.extra || "")
      .toLowerCase()
      .includes("auto_increment");
    let id = null;
    if (!auto) {
      const [next] = await sequelize.query(
        "SELECT IFNULL(MAX(id), 0) + 1 AS nextId FROM products",
        { type: sequelize.QueryTypes.SELECT, transaction },
      );
      id = next.nextId;
    }
    await sequelize.query(
      `INSERT INTO products (
         ${auto ? "" : "id, "}facility_id, name, sku, item_type, selling_price, cost_price, category,
         unit_of_measure, revenue_account, cogs_head, inventory_account, status,
         taxable, is_purchased, line_of_business, sales_stopped, reorder_level,
         created_at, updated_at
       ) VALUES (
         ${auto ? "" : ":id, "}:facilityId, :name, :sku, 'Resalable', :sellingInsert, :costInsert, :category,
         :uom, :revenue, :cogs, :inventory, 'Active',
         'Taxable', 1, 0, 0, 0, NOW(), NOW()
       )`,
      {
        replacements: {
          facilityId: FACILITY_ID,
          id,
          name: product.name,
          sku: product.sku,
          sellingInsert: product.selling || 0,
          costInsert: product.cost || 0,
          category: product.category,
          uom: product.uom,
          revenue: product.revenue,
          cogs: product.cogs,
          inventory: product.inventory,
        },
        transaction,
      },
    );
    return;
  }

  const skuTaken = await sequelize.query(
    `SELECT id FROM products
     WHERE facility_id = :facilityId AND sku = :sku AND id <> :id LIMIT 1`,
    {
      replacements: { facilityId: FACILITY_ID, sku: product.sku, id: current.id },
      type: sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  if (!skuTaken.length) sets.push("sku = :sku");

  await sequelize.query(
    `UPDATE products SET ${sets.join(", ")}
     WHERE facility_id = :facilityId AND id = :id`,
    {
      replacements: {
        facilityId: FACILITY_ID,
        id: current.id,
        sku: product.sku,
        name: product.name,
        category: product.category,
        revenue: product.revenue,
        cogs: product.cogs,
        inventory: product.inventory,
        uom: product.uom,
        selling: product.selling,
        cost: product.cost,
      },
      transaction,
    },
  );
}

async function setSellableQty(sequelize, transaction, product) {
  if (product.qty == null) return;
  const saved = await findProduct(sequelize, transaction, product);
  if (!saved) return;
  const match = `(
    ${codeEq("product_id", "CAST(:sku AS CHAR)")}
    OR ${codeEq("product_id", "CAST(:savedSku AS CHAR)")}
    OR ${codeEq("product_id", "CAST(:productId AS CHAR)")}
  )`;
  const [balanceRow] = await sequelize.query(
    `SELECT IFNULL(SUM(qty_in) - SUM(qty_out), 0) AS balance
     FROM store_entries
     WHERE ${codeEq("facilityId", "CAST(:facilityId AS CHAR)")}
       AND ${match}
       AND LOWER(TRIM(branch_name)) IN ('for sales', 'for sale')`,
    {
      replacements: {
        facilityId: FACILITY_ID,
        sku: product.sku,
        savedSku: saved.sku,
        productId: saved.id,
      },
      type: sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  const delta = product.qty - Number(balanceRow?.balance || 0);
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.0001) return;

  const places = await sequelize.query(
    `SELECT branchId, location, destination, source
     FROM store_entries
     WHERE ${codeEq("facilityId", "CAST(:facilityId AS CHAR)")}
       AND LOWER(TRIM(branch_name)) IN ('for sales', 'for sale')
     ORDER BY id DESC LIMIT 1`,
    {
      replacements: { facilityId: FACILITY_ID },
      type: sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  const place = places[0] || {};
  const location = place.location || place.destination || "store";
  await sequelize.query(
    `INSERT INTO store_entries (
       receive_date, reference_number, qty_in, qty_out, cost_price,
       branch_name, facilityId, type, source, destination, status,
       product_id, createdAt, markup_mode, mark_up, multple, location, branchId
     ) VALUES (
       DATE_FORMAT(NOW(), '%Y-%m-%d'), :ref, :qtyIn, :qtyOut, :cost,
       'for sales', :facilityId, 'opening', :source, :destination, 'approved',
       :sku, NOW(), 'percentage', 0, '1', :location, :branchId
     )`,
    {
      replacements: {
        ref: `ADJ-${product.sku}`.slice(0, 20),
        qtyIn: delta > 0 ? delta : 0,
        qtyOut: delta < 0 ? Math.abs(delta) : 0,
        cost: product.cost || 0,
        facilityId: FACILITY_ID,
        source: place.source || location,
        destination: place.destination || location,
        sku: saved.sku || product.sku,
        location,
        branchId: place.branchId || 0,
      },
      transaction,
    },
  );
  await postOpeningTreatment(sequelize, transaction, {
    ref: `ADJ-${product.sku}`.slice(0, 20),
    sku: saved.sku || product.sku,
    name: product.name,
    inventory: product.inventory,
    qty: Math.abs(delta),
    cost: product.cost,
    increase: delta > 0,
  });
}

async function postOpeningTreatment(sequelize, transaction, entry) {
  if (!entry.cost || !entry.qty) return;
  const existing = await sequelize.query(
    `SELECT transaction_id FROM general_ledger
     WHERE facility_id = :facilityId
       AND reference_number = :ref
       AND purpose_of_payment = 'Opening Balance'
     LIMIT 1`,
    {
      replacements: { facilityId: FACILITY_ID, ref: entry.ref },
      type: sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  if (existing.length) return;

  const [business] = await sequelize.query(
    `SELECT opening_balance_equity AS equity
     FROM business WHERE id = :facilityId LIMIT 1`,
    {
      replacements: { facilityId: FACILITY_ID },
      type: sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  const equity = business?.equity;
  if (!equity) return;

  const accounts = await sequelize.query(
    `SELECT code, parent_code AS parentCode, description
     FROM account_category
     WHERE facility_id = :facilityId AND code IN (:inventory, :equity)`,
    {
      replacements: {
        facilityId: FACILITY_ID,
        inventory: entry.inventory,
        equity,
      },
      type: sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  const byCode = new Map(accounts.map((row) => [String(row.code), row]));
  const inventoryAccount = byCode.get(String(entry.inventory));
  const equityAccount = byCode.get(String(equity));
  if (!inventoryAccount || !equityAccount) return;

  const amount = Math.round(entry.qty * entry.cost * 100) / 100;
  const narration = `Opening Balance - ${entry.name} - Qty: ${entry.qty} @ ${entry.cost}`;
  const lines = entry.increase
    ? [
        ["inventory", inventoryAccount, amount, 0],
        ["opening_balance", equityAccount, 0, amount],
      ]
    : [
        ["opening_balance", equityAccount, amount, 0],
        ["inventory", inventoryAccount, 0, amount],
      ];

  for (const [type, account, dr, cr] of lines) {
    await sequelize.query(
      `INSERT INTO general_ledger (
         transaction_date, account_code, account_subhead, dr, cr,
         account_description, transaction_description, reference_number,
         purpose_of_payment, created_by, facility_id, status, reconciled,
         type, transaction_ref, created_at, updated_at
       ) VALUES (
         CURDATE(), :code, :subhead, :dr, :cr,
         :description, :narration, :ref,
         'Opening Balance', 'migration', :facilityId, 'posted', 'unmatched',
         :type, :sku, NOW(), NOW()
       )`,
      {
        replacements: {
          code: account.code,
          subhead: account.parentCode || "0",
          dr,
          cr,
          description: account.description || entry.name,
          narration,
          ref: entry.ref,
          facilityId: FACILITY_ID,
          type,
          sku: entry.sku,
        },
        transaction,
      },
    );
  }
}

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    await sequelize.transaction(async (transaction) => {
      await ensureCategories(sequelize, transaction);
      for (const product of PRODUCTS) {
        await ensureAccount(sequelize, transaction, product.revenue, product.name);
        await ensureAccount(sequelize, transaction, product.cogs, product.name);
        await ensureAccount(sequelize, transaction, product.inventory, product.name);
        await saveProduct(sequelize, transaction, product);
        await setSellableQty(sequelize, transaction, product);
      }
    });
  },

  async down() {},
};
