"use strict";

/**
 * Nexifour product costs, stock quantity, and categories.
 *
 * Cost prices come from the resalable product sheet. A blank cost on that
 * sheet is left alone so this does not wipe a price that was already entered.
 * Inventory and cost-of-sales accounts are set from the same suffix as the
 * product's revenue account, so rows that still point at the old mismatched
 * codes (120705, 120703, 120902, 120903, 710801, 710802) land on the aligned
 * chart.
 *
 * BUA India is not a separate row on the sheet. The BUA rice line (Bua Rice,
 * or a product whose name contains both "bua" and "india") is set to quantity
 * 3,200. The quantity is posted as one stock adjustment in the sellable zone,
 * and a second run does nothing once the balance is already 3,200.
 *
 * Categories are the list from product_categories, plus NASCON for the
 * Nascon Allies salt line, which is on the chart and the product sheet but
 * was not in that category list.
 *
 * Facility 094c6e1e-dd07-48c4-a344-6e9d58cd7861 only. Other facilities are
 * unchanged.
 */

const FACILITY_ID = "094c6e1e-dd07-48c4-a344-6e9d58cd7861";
const BUA_RICE_QTY = 3200;

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

const NORM_SQL =
  "LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`name`, ' ', ''), '(', ''), ')', ''), '-', ''), '.', ''), '/', ''))";

/** Bound strings and CAST(id AS CHAR) use the connection collation. Match the column. */
const SAME_CODE =
  "CONVERT(? USING utf8mb4) COLLATE utf8mb4_general_ci";

function codeEq(column, valueSql) {
  return `${SAME_CODE.replace("?", column)} = ${SAME_CODE.replace("?", valueSql)}`;
}

function norm(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function linkedAccounts(revenue) {
  return {
    revenue,
    cogs: `7${revenue.slice(1)}`,
    inventory: `12${revenue.slice(2)}`,
  };
}

/**
 * keys: normalized product names that should receive this row.
 * cost: null means the sheet had no cost, so products.cost_price is not changed.
 */
const PRODUCTS = [
  ["P001", ["IRS Flour"], 49000, "610101", "IRS"],
  ["P002", ["IRS Pasta"], 12300, "610102", "IRS"],
  ["P003", ["IRS Macaroni Cavatto", "IRS Macaroni"], 11000, "610103", "IRS"],
  ["P004", ["IRS Brand (Dusa)", "IRS Bran (Dusa)"], 15000, "610104", "IRS"],
  ["P005", ["IRS Bakers Pride Flour", "IRS Bakers Pride"], 45000, "610105", "IRS"],
  ["P006", ["Bua Thailand Rice"], null, "610201", "BUA"],
  ["P007", ["Bua Sugar(50kg)", "Bua Sugar 50kg"], 73500, "610202", "BUA"],
  ["P008", ["Bua Sugar(25kg)", "Bua Sugar 25kg"], null, "610203", "BUA"],
  ["P009", ["Bua Cement"], null, "610204", "BUA"],
  ["P010", ["Bua Rice"], 57000, "610205", "BUA"],
  ["P011", ["Sokoto Cement"], 11750, "610206", "BUA"],
  ["P012", ["Crown Flour"], null, "610301", "OLAM"],
  ["P013", ["Crowan Pasta(slim)", "Crown Pasta(slim)", "Crown Pasta Slim"], 12550, "610302", "OLAM"],
  ["P014", ["Crown Thick Pasta"], null, "610303", "OLAM"],
  ["P015", ["Crown premium Thick Pasta", "Crown Premium Thick Pasta"], null, "610304", "OLAM"],
  ["P016", ["Crown Maccaroni"], null, "610305", "OLAM"],
  ["P017", ["Crown Premium Maccaroni"], null, "610306", "OLAM"],
  ["P018", ["Crown Premium Slim Pasta"], null, "610307", "OLAM"],
  ["P019", ["Rafa Detargent(850x7pcs)", "Rafa Detergent(850x7pcs)"], null, "610401", "Rafa Products"],
  ["P020", ["Rafa Detargent(170x26pcs)", "Rafa Detergent(170x26pcs)"], null, "610402", "Rafa Products"],
  ["P021", ["Rafa Detargent(150x26pcs)", "Rafa Detergent(150x26pcs)"], null, "610403", "Rafa Products"],
  ["P022", ["Rafa Detargent(125x36pcs)", "Rafa Detergent(125x36pcs)", "Rafa Detergent (125x36pcs)"], null, "610404", "Rafa Products"],
  ["P023", ["Rafa Detargent(85x52pcs)", "Rafa Detergent(85x52pcs)", "Rafa Detergent (85x52)"], 8700, "610405", "Rafa Products"],
  ["P024", ["Rafa Detergent(45x84)", "Rafa Detergent (45x84)"], null, "610407", "Rafa Products"],
  ["P026", ["Rafa Detergent(22x162)", "Rafa Detergent (22x162)"], null, "610408", "Rafa Products"],
  ["P027", ["Dangote pasta", "Dangote Pasta"], null, "610501", "DANGOTE"],
  ["P028", ["Dangote Salt"], null, "610901", "NASCON"],
  ["P029", ["Dangote Sugar(25kg)", "Dangote Sugar 25kg"], null, "610503", "DANGOTE"],
  ["P030", ["Dangote Sugar(50kg)", "Dangote Sugar 50kg"], null, "610504", "DANGOTE"],
  ["P031", ["Dangote Crude Salt"], null, "610505", "DANGOTE"],
  ["P032", ["Dangote Refined Salt by20", "Dangote Refined Salt by 20"], null, "610506", "DANGOTE"],
  ["P033", ["Dangote Refined Salt by40", "Dangote Refined Salt by 40"], null, "610507", "DANGOTE"],
  ["P034", ["Dangote Refined Salt by80", "Dangote Refined Salt by 80"], null, "610508", "DANGOTE"],
  ["P035", ["Dangote Bread Flour"], null, "610509", "DANGOTE"],
  ["P036", ["Honey Cavatto"], null, "610601", "HONEY"],
  ["P037", ["Honey Pasta"], null, "610602", "HONEY"],
  ["P038", ["Honey Pasta Slim"], null, "610603", "HONEY"],
  ["P039", ["Honey Flour"], null, "610604", "HONEY"],
  ["P040", ["Golen Penny Maccaroni", "Golden Penny Maccaroni"], null, "610701", "GOLDEN PENNY"],
  ["P041", ["Golden Penny Sphagetti", "Golden Penny Spaghetti"], null, "610702", "GOLDEN PENNY"],
  ["P042", ["Mangal Rice"], null, "610801", "MANGAL"],
  ["P043", ["Optimum Rice"], null, "610802", "MANGAL"],
  ["P044", ["Rafa Deterget(40gX92)", "Rafa Detergent(40gX92)", "Rafa Detergent (40x92pcs)", "Rafa Detergent (40x92)"], 7900, "610406", "Rafa Products"],
  ["P045", ["Juicy Orange"], 36000, "610803", "MANGAL"],
  ["P046", ["Mangal Cement"], 11650, "610804", "MANGAL"],
].map(([sku, names, cost, revenue, category]) => ({
  sku,
  keys: [...new Set(names.map(norm))],
  cost,
  category,
  ...linkedAccounts(revenue),
}));

async function columnExists(sequelize, table, column) {
  const rows = await sequelize.query(
    `SELECT COLUMN_NAME AS columnName
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :table
       AND COLUMN_NAME = :column
     LIMIT 1`,
    {
      replacements: { table, column },
      type: sequelize.QueryTypes.SELECT,
    },
  );
  return rows.length > 0;
}

async function ensureCategories(sequelize, transaction) {
  if (!(await columnExists(sequelize, "product_categories", "name"))) return;
  const idRows = await sequelize.query("SHOW COLUMNS FROM product_categories LIKE 'id'", {
    type: sequelize.QueryTypes.SELECT,
    transaction,
  });
  const extra = String(idRows[0]?.Extra || idRows[0]?.extra || "");
  const autoIncrement = extra.toLowerCase().includes("auto_increment");

  for (const name of CATEGORIES) {
    const existing = await sequelize.query(
      `SELECT id
       FROM product_categories
       WHERE facility_id = :facilityId
         AND LOWER(TRIM(name)) = LOWER(:name)
       LIMIT 1`,
      {
        replacements: { facilityId: FACILITY_ID, name },
        type: sequelize.QueryTypes.SELECT,
        transaction,
      },
    );
    if (existing.length) continue;

    if (autoIncrement) {
      await sequelize.query(
        `INSERT INTO product_categories (facility_id, name, description, status, created_at, updated_at)
         VALUES (:facilityId, :name, NULL, 'active', NOW(), NOW())`,
        { replacements: { facilityId: FACILITY_ID, name }, transaction },
      );
    } else {
      const [next] = await sequelize.query(
        `SELECT IFNULL(MAX(id), 0) + 1 AS nextId FROM product_categories`,
        { type: sequelize.QueryTypes.SELECT, transaction },
      );
      await sequelize.query(
        `INSERT INTO product_categories (id, facility_id, name, description, status, created_at, updated_at)
         VALUES (:id, :facilityId, :name, NULL, 'active', NOW(), NOW())`,
        {
          replacements: {
            id: next.nextId,
            facilityId: FACILITY_ID,
            name,
          },
          transaction,
        },
      );
    }
  }
}

async function applyProduct(sequelize, transaction, product) {
  const setCost = product.cost != null;
  const [result] = await sequelize.query(
    `UPDATE products
     SET revenue_account = :revenue,
         cogs_head = :cogs,
         inventory_account = :inventory,
         category = :category
         ${setCost ? ", cost_price = :cost" : ""}
     WHERE facility_id = :facilityId
       AND (
         ${NORM_SQL} IN (:keys)
         OR sku = :sku
       )`,
    {
      replacements: {
        facilityId: FACILITY_ID,
        revenue: product.revenue,
        cogs: product.cogs,
        inventory: product.inventory,
        category: product.category,
        cost: product.cost,
        keys: product.keys,
        sku: product.sku,
      },
      transaction,
    },
  );

  if (!setCost) return result;

  await sequelize.query(
    `UPDATE store_entries se
     INNER JOIN products p
       ON ${codeEq("p.facility_id", "se.facilityId")}
      AND (
        ${codeEq("se.product_id", "p.sku")}
        OR ${codeEq("se.product_id", "CAST(p.id AS CHAR)")}
      )
     SET se.cost_price = :cost
     WHERE p.facility_id = :facilityId
       AND (
         ${NORM_SQL.split("`name`").join("p.`name`")} IN (:keys)
         OR p.sku = :sku
       )
       AND (se.cost_price IS NULL OR se.cost_price = 0)`,
    {
      replacements: {
        facilityId: FACILITY_ID,
        cost: product.cost,
        keys: product.keys,
        sku: product.sku,
      },
      transaction,
    },
  );
  return result;
}

async function findRiceProducts(sequelize, transaction) {
  const india = await sequelize.query(
    `SELECT id, sku, name, cost_price
     FROM products
     WHERE facility_id = :facilityId
       AND LOWER(name) LIKE '%bua%'
       AND LOWER(name) LIKE '%india%'`,
    {
      replacements: { facilityId: FACILITY_ID },
      type: sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  if (india.length) return india;

  return sequelize.query(
    `SELECT id, sku, name, cost_price
     FROM products
     WHERE facility_id = :facilityId
       AND ${NORM_SQL} = 'buarice'`,
    {
      replacements: { facilityId: FACILITY_ID },
      type: sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
}

async function setSellableQty(sequelize, transaction, product, qty) {
  const [balanceRow] = await sequelize.query(
    `SELECT IFNULL(SUM(qty_in) - SUM(qty_out), 0) AS balance
     FROM store_entries
     WHERE facilityId = :facilityId
       AND (
         ${codeEq("product_id", "CAST(:sku AS CHAR)")}
         OR ${codeEq("product_id", "CAST(:productId AS CHAR)")}
       )
       AND LOWER(TRIM(branch_name)) IN ('for sales', 'for sale')`,
    {
      replacements: {
        facilityId: FACILITY_ID,
        sku: product.sku,
        productId: product.id,
      },
      type: sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  const balance = Number(balanceRow?.balance || 0);
  const delta = qty - balance;
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.0001) return;

  const places = await sequelize.query(
    `SELECT branchId, location, destination, source
     FROM store_entries
     WHERE facilityId = :facilityId
       AND (
         ${codeEq("product_id", "CAST(:sku AS CHAR)")}
         OR ${codeEq("product_id", "CAST(:productId AS CHAR)")}
       )
       AND LOWER(TRIM(branch_name)) IN ('for sales', 'for sale')
     ORDER BY id DESC
     LIMIT 1`,
    {
      replacements: {
        facilityId: FACILITY_ID,
        sku: product.sku,
        productId: product.id,
      },
      type: sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  let place = places[0];
  if (!place) {
    const facilityPlaces = await sequelize.query(
      `SELECT branchId, location, destination, source
       FROM store_entries
       WHERE facilityId = :facilityId
         AND LOWER(TRIM(branch_name)) IN ('for sales', 'for sale')
       ORDER BY id DESC
       LIMIT 1`,
      {
        replacements: { facilityId: FACILITY_ID },
        type: sequelize.QueryTypes.SELECT,
        transaction,
      },
    );
    place = facilityPlaces[0] || {};
  }

  const location = place.location || place.destination || "store";
  const qtyIn = delta > 0 ? delta : 0;
  const qtyOut = delta < 0 ? Math.abs(delta) : 0;

  await sequelize.query(
    `INSERT INTO store_entries (
       receive_date, reference_number, qty_in, qty_out, cost_price,
       branch_name, facilityId, type, source, destination, status,
       product_id, createdAt, markup_mode, mark_up, multple, location, branchId
     ) VALUES (
       DATE_FORMAT(NOW(), '%Y-%m-%d'), 'ADJ-BUA-INDIA-3200', :qtyIn, :qtyOut, :cost,
       'for sales', :facilityId, 'opening', :source, :destination, 'approved',
       :sku, NOW(), 'percentage', 0, '1', :location, :branchId
     )`,
    {
      replacements: {
        qtyIn,
        qtyOut,
        cost: product.cost_price || 0,
        facilityId: FACILITY_ID,
        source: place.source || location,
        destination: place.destination || location,
        sku: product.sku,
        location,
        branchId: place.branchId || 0,
      },
      transaction,
    },
  );
}

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    await sequelize.transaction(async (transaction) => {
      await ensureCategories(sequelize, transaction);
      for (const product of PRODUCTS) {
        await applyProduct(sequelize, transaction, product);
      }
      const rice = await findRiceProducts(sequelize, transaction);
      for (const product of rice) {
        await setSellableQty(sequelize, transaction, product, BUA_RICE_QTY);
      }
    });
  },

  async down() {
    // Prices, categories, and the stock adjustment are production data.
    // Reversing them would put back numbers this migration was written to replace.
  },
};
