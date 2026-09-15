/**
 * Clean deposit / apply-advance data so Deposit Summary is empty for retesting.
 * Facility: 094c6e1e-dd07-48c4-a344-6e9d58cd7861
 */
require("dotenv").config();
const db = require("../src/models");
const { QueryTypes } = require("sequelize");

const FACILITY = "094c6e1e-dd07-48c4-a344-6e9d58cd7861";

async function main() {
  const before = await db.sequelize.query(
    `SELECT transaction_ref AS customer_no,
            ROUND(SUM(cr)-SUM(dr),2) AS bal
     FROM general_ledger
     WHERE facility_id = :f AND LOWER(COALESCE(type,'')) = 'deposit'
     GROUP BY transaction_ref
     HAVING ABS(bal) > 0.01
     ORDER BY bal DESC`,
    { replacements: { f: FACILITY }, type: QueryTypes.SELECT },
  );
  console.log("Deposit balances BEFORE:", JSON.stringify(before, null, 2));

  const t = await db.sequelize.transaction();
  try {
    const [glDeposit] = await db.sequelize.query(
      `DELETE FROM general_ledger
       WHERE facility_id = :f
         AND LOWER(COALESCE(type,'')) = 'deposit'`,
      { replacements: { f: FACILITY }, transaction: t },
    );

    // Apply-deposit legs that credited A/R (AA-* / apply advance)
    const [glApply] = await db.sequelize.query(
      `DELETE FROM general_ledger
       WHERE facility_id = :f
         AND (
           reference_number LIKE 'AA-%'
           OR purpose_of_payment LIKE 'Apply customer advance%'
           OR transaction_description LIKE '%AUTOTEST apply%'
           OR transaction_description LIKE 'Advance applied%'
         )`,
      { replacements: { f: FACILITY }, transaction: t },
    );

    const [entries] = await db.sequelize.query(
      `DELETE FROM customer_entries
       WHERE facilityId = :f
         AND (
           LOWER(COALESCE(type,'')) = 'deposit'
           OR receiptNo LIKE 'AD-%'
           OR receiptNo LIKE 'AA-%'
           OR description LIKE '%AUTOTEST%'
           OR description LIKE 'Advance applied%'
         )`,
      { replacements: { f: FACILITY }, transaction: t },
    );

    const [workflows] = await db.sequelize.query(
      `DELETE FROM sale_workflows
       WHERE facility_id = :f
         AND (
           sale_code LIKE 'TEST-DEP-%'
           OR notes LIKE '%AUTOTEST%'
         )`,
      { replacements: { f: FACILITY }, transaction: t },
    );

    await t.commit();

    console.log("Deleted deposit GL:", glDeposit?.affectedRows ?? glDeposit);
    console.log("Deleted apply/AA GL:", glApply?.affectedRows ?? glApply);
    console.log("Deleted customer_entries:", entries?.affectedRows ?? entries);
    console.log("Deleted TEST workflows:", workflows?.affectedRows ?? workflows);
  } catch (err) {
    await t.rollback();
    throw err;
  }

  const after = await db.sequelize.query(
    `SELECT transaction_ref AS customer_no,
            ROUND(SUM(cr)-SUM(dr),2) AS bal
     FROM general_ledger
     WHERE facility_id = :f AND LOWER(COALESCE(type,'')) = 'deposit'
     GROUP BY transaction_ref
     HAVING ABS(bal) > 0.01`,
    { replacements: { f: FACILITY }, type: QueryTypes.SELECT },
  );
  console.log("Deposit balances AFTER:", after);

  await db.sequelize.close();
  console.log("DONE — Deposit Summary should be empty. Refresh the UI.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
