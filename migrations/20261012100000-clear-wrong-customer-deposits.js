"use strict";

/**
 * These customers were listed with deposit balances they do not have.
 * Zero remaining deposit (GL type deposit) against Opening Balance Equity.
 * Bank ledgers are left alone. A second run is a no-op once RD-CLR-{customerNo} exists.
 */

const FACILITY_ID = "094c6e1e-dd07-48c4-a344-6e9d58cd7861";
const TX_DATE = "2026-10-12";
const BATCH = "RD-CLR";

const CUSTOMERS = [
  { label: "GORON DUMA", match: /GORON\s*DUMA/i },
  { label: "HARUNA SABO", match: /HARUNA\s*SABO/i },
  { label: "AMINU BAUCHI", match: /AMINU\s*BAUCHI/i },
  { label: "ALH SAIDU UNGURU", match: /SAIDU\s*UNGURU/i },
  { label: "MUAZU JALINGO", match: /MUAZU\s*JALINGO/i },
];

function codeEq(column, param) {
  const side = (expr) =>
    `CONVERT(${expr} USING utf8mb4) COLLATE utf8mb4_general_ci`;
  return `${side(column)} = ${side(param)}`;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function haystack(row) {
  return [row.fullname, row.storeName, row.companyName]
    .filter(Boolean)
    .join(" ");
}

function matchCustomer(rows, spec) {
  return rows.filter((row) => spec.match.test(haystack(row)));
}

async function insertLine(sequelize, transaction, line) {
  await sequelize.query(
    `INSERT INTO general_ledger (
       transaction_date, account_code, account_subhead, dr, cr,
       account_description, transaction_description, reference_number,
       purpose_of_payment, payee, bank_account_id, mode_of_payment,
       created_by, facility_id, status, reconciled, type, transaction_ref,
       created_at, updated_at
     ) VALUES (
       :txDate, :code, :subhead, :dr, :cr,
       :accountDescription, :narration, :ref,
       'Clear incorrect deposit', :payee, NULL, NULL,
       'migration', :facilityId, 'posted', 'unmatched', :type,
       :transactionRef, NOW(), NOW()
     )`,
    { replacements: line, transaction },
  );
}

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    await sequelize.transaction(async (transaction) => {
      const [business] = await sequelize.query(
        `SELECT opening_balance_equity AS equity
         FROM business
         WHERE ${codeEq("id", ":facilityId")}
         LIMIT 1`,
        {
          replacements: { facilityId: FACILITY_ID },
          type: sequelize.QueryTypes.SELECT,
          transaction,
        },
      );
      const equityCode = String(business?.equity || "").trim();
      if (!equityCode) {
        throw new Error(
          "Opening Balance Equity is not set on business.opening_balance_equity",
        );
      }

      const [equity] = await sequelize.query(
        `SELECT code, parent_code AS parentCode, description
         FROM account_category
         WHERE ${codeEq("facility_id", ":facilityId")}
           AND ${codeEq("code", ":equity")}
         LIMIT 1`,
        {
          replacements: { facilityId: FACILITY_ID, equity: equityCode },
          type: sequelize.QueryTypes.SELECT,
          transaction,
        },
      );
      if (!equity) {
        throw new Error(
          `Opening Balance Equity account not found: ${equityCode}`,
        );
      }

      const customers = await sequelize.query(
        `SELECT
           c.customerNo AS customerNo,
           c.fullname AS fullname,
           c.store_name AS storeName,
           c.company_name AS companyName,
           NULLIF(TRIM(c.receivable_accural_code), '') AS depositCode
         FROM customers c
         WHERE ${codeEq("c.facilityId", ":facilityId")}`,
        {
          replacements: { facilityId: FACILITY_ID },
          type: sequelize.QueryTypes.SELECT,
          transaction,
        },
      );

      for (const spec of CUSTOMERS) {
        const hits = matchCustomer(customers, spec);
        if (hits.length !== 1) {
          const names = (hits.length ? hits : customers)
            .slice(0, 40)
            .map((row) => `${row.fullname} [${row.customerNo}]`)
            .join("; ");
          throw new Error(
            `Customer "${spec.label}" matched ${hits.length} record(s). Available: ${names}`,
          );
        }

        const customer = hits[0];
        const ref = `${BATCH}-${customer.customerNo}`;
        const existing = await sequelize.query(
          `SELECT transaction_id
           FROM general_ledger
           WHERE ${codeEq("facility_id", ":facilityId")}
             AND ${codeEq("reference_number", ":ref")}
           LIMIT 1`,
          {
            replacements: { facilityId: FACILITY_ID, ref },
            type: sequelize.QueryTypes.SELECT,
            transaction,
          },
        );
        if (existing.length) continue;

        const [depBal] = await sequelize.query(
          `SELECT COALESCE(SUM(gl.cr), 0) - COALESCE(SUM(gl.dr), 0) AS balance
           FROM general_ledger gl
           WHERE ${codeEq("gl.facility_id", ":facilityId")}
             AND LOWER(COALESCE(gl.type, '')) = 'deposit'
             AND (
               gl.transaction_ref = :customerNo
               OR gl.transaction_ref LIKE CONCAT(:customerNo, '-%')
             )`,
          {
            replacements: {
              facilityId: FACILITY_ID,
              customerNo: customer.customerNo,
            },
            type: sequelize.QueryTypes.SELECT,
            transaction,
          },
        );
        const amount = round2(depBal?.balance);
        if (amount <= 0.005) continue;

        const depositCode = customer.depositCode || "900206";
        const [deposit] = await sequelize.query(
          `SELECT code, parent_code AS parentCode, description
           FROM account_category
           WHERE ${codeEq("facility_id", ":facilityId")}
             AND ${codeEq("code", ":code")}
           LIMIT 1`,
          {
            replacements: { facilityId: FACILITY_ID, code: depositCode },
            type: sequelize.QueryTypes.SELECT,
            transaction,
          },
        );
        if (!deposit) {
          throw new Error(
            `Customer Deposit account not found: ${depositCode} (${spec.label})`,
          );
        }

        const payee = String(customer.fullname || spec.label).slice(0, 50);
        const narration =
          `Clear incorrect customer deposit - ${spec.label} (${customer.customerNo})`;

        await insertLine(sequelize, transaction, {
          txDate: TX_DATE,
          code: deposit.code,
          subhead: deposit.parentCode || "0",
          dr: amount,
          cr: 0,
          accountDescription: String(
            deposit.description || "Customer Deposit",
          ).slice(0, 300),
          narration: narration.slice(0, 500),
          ref,
          payee,
          facilityId: FACILITY_ID,
          type: "deposit",
          transactionRef: customer.customerNo,
        });

        await insertLine(sequelize, transaction, {
          txDate: TX_DATE,
          code: equity.code,
          subhead: equity.parentCode || "0",
          dr: 0,
          cr: amount,
          accountDescription: String(
            equity.description || "Opening Balance Equity",
          ).slice(0, 300),
          narration: `Opening Balance Equity offset - ${narration}`.slice(
            0,
            500,
          ),
          ref,
          payee: "",
          facilityId: FACILITY_ID,
          type: "opening_balance",
          transactionRef: `${ref}-EQUITY`,
        });
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM general_ledger
       WHERE ${codeEq("facility_id", ":facilityId")}
         AND reference_number LIKE 'RD-CLR-%'
         AND created_by = 'migration'`,
      { replacements: { facilityId: FACILITY_ID } },
    );
  },
};
