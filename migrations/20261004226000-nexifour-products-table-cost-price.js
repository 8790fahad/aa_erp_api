"use strict";

/**
 * Write each sheet cost onto products.cost_price.
 * A product is updated when its sku or its name matches.
 * Products with no cost on the sheet are left unchanged.
 */

const FACILITY_ID = "094c6e1e-dd07-48c4-a344-6e9d58cd7861";

const NORM_SQL =
  "LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`name`, ' ', ''), '(', ''), ')', ''), '-', ''), '.', ''), '/', ''))";

function norm(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s().\-/]/g, "");
}

function line(sku, names, cost) {
  return { sku, keys: [...new Set(names.map(norm))], cost };
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

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    await sequelize.transaction(async (transaction) => {
      for (const product of PRODUCTS) {
        await sequelize.query(
          `UPDATE products
           SET cost_price = :cost
           WHERE facility_id = :facilityId
             AND (sku = :sku OR ${NORM_SQL} IN (:keys))`,
          {
            replacements: {
              cost: product.cost,
              facilityId: FACILITY_ID,
              sku: product.sku,
              keys: product.keys,
            },
            transaction,
          },
        );
      }
    });
  },

  async down() {},
};
