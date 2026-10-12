"use strict";

/**
 * Taj Bank (Yammusa) actual is 161,715.38 (not 121,715.38).
 * Posts ACTUAL − current ledger against Opening Balance Equity.
 * Skips once OB-BRK3-07 exists, or if the ledger already matches.
 */

const FACILITY_ID = "094c6e1e-dd07-48c4-a344-6e9d58cd7861";
const OB_DATE = "2026-01-01";
const REF = "OB-BRK3-07";
const ACTUAL = 161715.38;

const SPEC = {
  label: "Taj Bank (Yammusa)",
  bank: /TAJ/i,
  owner: /YAMMUSA|YAMUSA|YANMUSA|YAMMUSUA/i,
  exclude: /ASHIRU/i,
};

function codeEq(column, param) {
  const side = (expr) =>
    `CONVERT(${expr} USING utf8mb4) COLLATE utf8mb4_general_ci`;
  return `${side(column)} = ${side(param)}`;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function haystack(row) {
  return [row.accountName, row.glDescription].filter(Boolean).join(" ");
}

function matchBank(rows) {
  return rows.filter((row) => {
    const text = haystack(row);
    if (!SPEC.bank.test(text)) return false;
    if (SPEC.owner && !SPEC.owner.test(text)) return false;
    if (SPEC.exclude && SPEC.exclude.test(text)) return false;
    return true;
  });
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
       'Opening Balance', :payee, :bankAccountId, :modeOfPayment,
       'migration', :facilityId, 'posted', 'unmatched', 'opening_balance',
       :transactionRef, NOW(), NOW()
     )`,
    { replacements: line, transaction },
  );
}

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    await sequelize.transaction(async (transaction) => {
      const existing = await sequelize.query(
        `SELECT transaction_id
         FROM general_ledger
         WHERE ${codeEq("facility_id", ":facilityId")}
           AND ${codeEq("reference_number", ":ref")}
           AND type = 'opening_balance'
         LIMIT 1`,
        {
          replacements: { facilityId: FACILITY_ID, ref: REF },
          type: sequelize.QueryTypes.SELECT,
          transaction,
        },
      );
      if (existing.length) return;

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

      const banks = await sequelize.query(
        `SELECT
           ba.id AS bankAccountId,
           ba.account_name AS accountName,
           ba.head AS head,
           ac.description AS glDescription,
           ac.parent_code AS parentCode
         FROM bank_accounts ba
         LEFT JOIN account_category ac
           ON ${codeEq("ac.facility_id", "ba.facility_id")}
          AND ${codeEq("ac.code", "ba.head")}
         WHERE ${codeEq("ba.facility_id", ":facilityId")}
           AND LOWER(ba.status) = 'active'
           AND NULLIF(TRIM(ba.head), '') IS NOT NULL`,
        {
          replacements: { facilityId: FACILITY_ID },
          type: sequelize.QueryTypes.SELECT,
          transaction,
        },
      );

      const hits = matchBank(banks);
      if (hits.length !== 1) {
        const names = (hits.length ? hits : banks)
          .map((row) => `${row.accountName} [${row.head}]`)
          .join("; ");
        throw new Error(
          `Bank "${SPEC.label}" matched ${hits.length} account(s). Available: ${names}`,
        );
      }

      const bank = hits[0];
      const [ledger] = await sequelize.query(
        `SELECT COALESCE(SUM(gl.dr - gl.cr), 0) AS balance
         FROM general_ledger gl
         WHERE ${codeEq("gl.facility_id", ":facilityId")}
           AND ${codeEq("gl.account_code", ":head")}`,
        {
          replacements: { facilityId: FACILITY_ID, head: bank.head },
          type: sequelize.QueryTypes.SELECT,
          transaction,
        },
      );
      const system = round2(ledger?.balance);
      const amount = round2(ACTUAL - system);
      if (Math.abs(amount) < 0.005) return;

      const bankDr = amount > 0 ? amount : 0;
      const bankCr = amount < 0 ? Math.abs(amount) : 0;
      const bankNarration =
        `Opening Balance - Align bank ledger to ACTUAL - ${SPEC.label}` +
        ` (system ${system.toFixed(2)}, actual ${ACTUAL.toFixed(2)})`;

      await insertLine(sequelize, transaction, {
        txDate: OB_DATE,
        code: bank.head,
        subhead: bank.parentCode || "0",
        dr: bankDr,
        cr: bankCr,
        accountDescription: String(
          bank.glDescription || bank.accountName || SPEC.label,
        ).slice(0, 300),
        narration: bankNarration.slice(0, 500),
        ref: REF,
        payee: SPEC.label.slice(0, 50),
        bankAccountId: bank.bankAccountId,
        modeOfPayment: "bank",
        facilityId: FACILITY_ID,
        transactionRef: `${REF}-BANK`,
      });

      await insertLine(sequelize, transaction, {
        txDate: OB_DATE,
        code: equity.code,
        subhead: equity.parentCode || "0",
        dr: bankCr,
        cr: bankDr,
        accountDescription: String(
          equity.description || "Opening Balance Equity",
        ).slice(0, 300),
        narration: `Opening Balance Equity offset - Align bank ledger to ACTUAL - ${SPEC.label}`.slice(
          0,
          500,
        ),
        ref: REF,
        payee: "",
        bankAccountId: null,
        modeOfPayment: null,
        facilityId: FACILITY_ID,
        transactionRef: `${REF}-EQUITY`,
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM general_ledger
       WHERE ${codeEq("facility_id", ":facilityId")}
         AND type = 'opening_balance'
         AND reference_number = 'OB-BRK3-07'
         AND created_by = 'migration'`,
      { replacements: { facilityId: FACILITY_ID } },
    );
  },
};
