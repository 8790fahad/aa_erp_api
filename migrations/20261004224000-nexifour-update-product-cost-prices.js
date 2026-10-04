"use strict";

/**
 * Set the cost price on every sheet product that has one.
 * Products with a blank or zero cost are left as they are.
 * The same cost is written on the product and on its stock lines.
 */

const FACILITY_ID = "094c6e1e-dd07-48c4-a344-6e9d58cd7861";

const NORM_SQL =
  "LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`name`, ' ', ''), '(', ''), ')', ''), '-', ''), '.', ''), '/', ''))";

function codeEq(column, valueSql) {
  const side = (expr) => `CONVERT(${expr} USING utf8mb4) COLLATE utf8mb4_general_ci`;
  return `${side(column)} = ${side(valueSql)}`;
}

function line(sku, names, cost) {
  return { sku, keys: [...new Set(names.map(norm))], cost };
}

function norm(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s().\-/]/g, "");
}

const PRODUCTS = [
  line("P001", ["IRS Flour"], 49000),
  line("P002", ["IRS Pasta"], 12300),
  line("P003", ["IRS Macaroni Cavatto", "IRS Macaroni"], 11000),
  line("P004", ["IRS Brand (Dusa)", "IRS Bran (Dusa)"], 15000),
  line("P005", ["IRS Bakers Pride Flour", "IRS Bakers Pride"], 45000),
  line("P007", ["Bua Sugar(50kg)", "Bua Sugar 50kg", "BUA Sugar (50kg)"], 73500),
  line("P010", ["Bua Rice", "BUA Rice"], 57000),
  line("P011", ["Sokoto Cement"], 11750),
  line("P013", ["Crowan Pasta(slim)", "Crown Pasta(slim)", "Crown Pasta Slim", "Crown Pasta (Slim)"], 12550),
  line("P023", ["Rafa Detargent(85x52pcs)", "Rafa Detergent(85x52pcs)", "Rafa Detergent (85x52)"], 8700),
  line("P044", ["Rafa Deterget(40gX92)", "Rafa Detergent(40gX92)", "Rafa Detergent (40x92pcs)", "Rafa Detergent (40x92)"], 7900),
  line("P045", ["Juicy Orange"], 36000),
  line("P046", ["Mangal Cement"], 11650),
];

async function findProduct(sequelize, transaction, product) {
  const byName = await sequelize.query(
    `SELECT id, sku FROM products
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
    `SELECT id, sku FROM products
     WHERE facility_id = :facilityId AND sku = :sku LIMIT 1`,
    {
      replacements: { facilityId: FACILITY_ID, sku: product.sku },
      type: sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  return bySku[0] || null;
}

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    await sequelize.transaction(async (transaction) => {
      for (const product of PRODUCTS) {
        const saved = await findProduct(sequelize, transaction, product);
        if (!saved) continue;
        await sequelize.query(
          `UPDATE products SET cost_price = :cost
           WHERE facility_id = :facilityId AND id = :id`,
          {
            replacements: {
              cost: product.cost,
              facilityId: FACILITY_ID,
              id: saved.id,
            },
            transaction,
          },
        );
        await sequelize.query(
          `UPDATE store_entries
           SET cost_price = :cost
           WHERE ${codeEq("facilityId", "CAST(:facilityId AS CHAR)")}
             AND (
               ${codeEq("product_id", "CAST(:sku AS CHAR)")}
               OR ${codeEq("product_id", "CAST(:savedSku AS CHAR)")}
               OR ${codeEq("product_id", "CAST(:productId AS CHAR)")}
             )`,
          {
            replacements: {
              cost: product.cost,
              facilityId: FACILITY_ID,
              sku: product.sku,
              savedSku: saved.sku || product.sku,
              productId: saved.id,
            },
            transaction,
          },
        );
      }
    });
  },

  async down() {},
};
