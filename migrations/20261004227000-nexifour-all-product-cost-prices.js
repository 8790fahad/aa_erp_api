"use strict";

/**
 * The later sheet has a cost on 44 products.
 * Crown Flour (P012) and Rafa Detergent 55x84 (P025) are the only zeros,
 * so their product cost is left unchanged.
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
  line("P006", ["Bua Thailand Rice", "BUA Thailand Rice"], 65000),
  line("P007", ["Bua Sugar(50kg)", "Bua Sugar 50kg", "BUA Sugar (50kg)"], 73500),
  line("P008", ["Bua Sugar(25kg)", "Bua Sugar 25kg", "BUA Sugar (25kg)"], 37000),
  line("P009", ["Bua Cement", "BUA Cement"], 11750),
  line("P010", ["Bua Rice", "BUA Rice"], 57000),
  line("P011", ["Sokoto Cement"], 11750),
  line("P013", ["Crowan Pasta(slim)", "Crown Pasta(slim)", "Crown Pasta Slim", "Crown Pasta (Slim)"], 12550),
  line("P014", ["Crown Thick Pasta"], 11550),
  line("P015", ["Crown premium Thick Pasta", "Crown Premium Thick Pasta"], 17200),
  line("P016", ["Crown Maccaroni", "Crown Macaroni"], 11700),
  line("P017", ["Crown Premium Maccaroni", "Crown Premium Macaroni"], 17200),
  line("P018", ["Crown Premium Slim Pasta"], 17200),
  line("P019", ["Rafa Detargent(850x7pcs)", "Rafa Detergent(850x7pcs)", "Rafa Detergent (850x7pcs)"], 11700),
  line("P020", ["Rafa Detargent(170x26pcs)", "Rafa Detergent(170x26pcs)", "Rafa Detergent (170x26pcs)"], 9300),
  line("P021", ["Rafa Detargent(150x26pcs)", "Rafa Detergent(150x26pcs)", "Rafa Detergent (150x26pcs)"], 8000),
  line("P022", ["Rafa Detargent(125x36pcs)", "Rafa Detergent(125x36pcs)", "Rafa Detergent (125x36pcs)"], 7400),
  line("P023", ["Rafa Detargent(85x52pcs)", "Rafa Detergent(85x52pcs)", "Rafa Detergent (85x52)"], 8700),
  line("P024", ["Rafa Detergent(45x84)", "Rafa Detergent (45x84)"], 7900),
  line("P026", ["Rafa Detergent(22x162)", "Rafa Detergent (22x162)"], 7900),
  line("P027", ["Dangote pasta", "Dangote Pasta"], 11500),
  line("P028", ["Dangote Salt"], 17500),
  line("P029", ["Dangote Sugar(25kg)", "Dangote Sugar 25kg"], 37000),
  line("P030", ["Dangote Sugar(50kg)", "Dangote Sugar 50kg"], 73500),
  line("P031", ["Dangote Crude Salt"], 17000),
  line("P032", ["Dangote Refined Salt by20", "Dangote Refined Salt by 20"], 7700),
  line("P033", ["Dangote Refined Salt by40", "Dangote Refined Salt by 40"], 7800),
  line("P034", ["Dangote Refined Salt by80", "Dangote Refined Salt by 80"], 8000),
  line("P035", ["Dangote Bread Flour"], 29000),
  line("P036", ["Honey Cavatto"], 11700),
  line("P037", ["Honey Pasta"], 12500),
  line("P038", ["Honey Pasta Slim"], 12500),
  line("P039", ["Honey Flour"], 48000),
  line("P040", ["Golen Penny Maccaroni", "Golden Penny Maccaroni"], 17700),
  line("P041", ["Golden Penny Sphagetti", "Golden Penny Spaghetti", "Golden Penny Pasta"], 18750),
  line("P042", ["Mangal Rice"], 55000),
  line("P043", ["Optimum Rice"], 60000),
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
