"use strict";

/**
 * Opening-stock treatment for the 14 sheet lines that have a quantity.
 * Every one of those lines also has a cost price.
 * Dr the product inventory account, Cr Opening Balance Equity, for the
 * quantity posted on the ADJ stock line. A second run does nothing once
 * that opening-balance journal exists.
 */

const FACILITY_ID = "094c6e1e-dd07-48c4-a344-6e9d58cd7861";

const LINES = [
  ["P001", "IRS Flour", "120101", 49000],
  ["P002", "IRS Pasta", "120102", 12300],
  ["P003", "IRS Macaroni Cavatto", "120103", 11000],
  ["P004", "IRS Brand (Dusa)", "120104", 15000],
  ["P005", "IRS Bakers Pride Flour", "120105", 45000],
  ["P007", "Bua Sugar (50kg)", "120202", 73500],
  ["P010", "Bua Rice", "120205", 57000],
  ["P011", "Sokoto Cement", "120206", 11750],
  ["P013", "Crowan Pasta (slim)", "120302", 12550],
  ["P023", "Rafa Detergent (85x52)", "120405", 8700],
  ["P044", "Rafa Detergent (40x92)", "120406", 7900],
  ["P045", "Juicy Orange", "120803", 36000],
  ["P046", "Mangal Cement", "120804", 11650],
];

function codeEq(column, valueSql) {
  const side = (expr) => `CONVERT(${expr} USING utf8mb4) COLLATE utf8mb4_general_ci`;
  return `${side(column)} = ${side(valueSql)}`;
}

async function postLine(sequelize, transaction, line, equity) {
  const [sku, name, inventory, cost] = line;
  const ref = `ADJ-${sku}`;
  const existing = await sequelize.query(
    `SELECT transaction_id FROM general_ledger
     WHERE facility_id = :facilityId
       AND reference_number = :ref
       AND purpose_of_payment = 'Opening Balance'
     LIMIT 1`,
    {
      replacements: { facilityId: FACILITY_ID, ref },
      type: sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  if (existing.length) return;

  const [stock] = await sequelize.query(
    `SELECT qty_in AS qtyIn, qty_out AS qtyOut
     FROM store_entries
     WHERE ${codeEq("facilityId", "CAST(:facilityId AS CHAR)")}
       AND ${codeEq("reference_number", "CAST(:ref AS CHAR)")}
     ORDER BY id DESC LIMIT 1`,
    {
      replacements: { facilityId: FACILITY_ID, ref },
      type: sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  if (!stock) return;
  const qtyIn = Number(stock.qtyIn || 0);
  const qtyOut = Number(stock.qtyOut || 0);
  const qty = Math.abs(qtyIn - qtyOut);
  if (!qty || !cost) return;

  const accounts = await sequelize.query(
    `SELECT code, parent_code AS parentCode, description
     FROM account_category
     WHERE facility_id = :facilityId AND code IN (:inventory, :equity)`,
    {
      replacements: { facilityId: FACILITY_ID, inventory, equity },
      type: sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  const byCode = new Map(accounts.map((row) => [String(row.code), row]));
  const inventoryAccount = byCode.get(String(inventory));
  const equityAccount = byCode.get(String(equity));
  if (!inventoryAccount || !equityAccount) return;

  const amount = Math.round(qty * cost * 100) / 100;
  const increase = qtyIn >= qtyOut;
  const narration = `Opening Balance - ${name} - Qty: ${qty} @ ${cost}`;
  const rows = increase
    ? [
        ["inventory", inventoryAccount, amount, 0],
        ["opening_balance", equityAccount, 0, amount],
      ]
    : [
        ["opening_balance", equityAccount, amount, 0],
        ["inventory", inventoryAccount, 0, amount],
      ];

  for (const [type, account, dr, cr] of rows) {
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
          description: account.description || name,
          narration,
          ref,
          facilityId: FACILITY_ID,
          type,
          sku,
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
      for (const line of LINES) {
        await postLine(sequelize, transaction, line, equity);
      }
    });
  },

  async down() {},
};
