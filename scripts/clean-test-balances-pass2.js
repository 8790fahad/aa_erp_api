/**
 * Second-pass: clear ALL currently open invoice AR (do not delete prior TEST CLEAN).
 */
require("dotenv").config();
const db = require("../src/models");
const { QueryTypes } = require("sequelize");

const FACILITY = "094c6e1e-dd07-48c4-a344-6e9d58cd7861";
const USER_ID = "4";

async function main() {
  const open = await db.sequelize.query(
    `SELECT i.invoice_ref, i.ref_number AS customer_no,
            COALESCE(NULLIF(TRIM(c.fullname), ''), i.ref_number) AS customer_name,
            GREATEST(COALESCE(se_tot.ar_outstanding, 0), 0) AS balance
     FROM invoices i
     INNER JOIN customers c
       ON c.customerNo = i.ref_number AND c.facilityId = i.facility_id
     LEFT JOIN (
       SELECT reference_number AS invoice_ref, facility_id,
              GREATEST(SUM(CASE WHEN LOWER(type) IN ('receivable','recevable') THEN dr-cr ELSE 0 END), 0) AS ar_outstanding
       FROM general_ledger
       WHERE facility_id = :f AND reference_number IS NOT NULL AND reference_number != ''
       GROUP BY reference_number, facility_id
     ) se_tot
       ON se_tot.invoice_ref = i.invoice_ref AND se_tot.facility_id = i.facility_id
     WHERE i.type = 'sales' AND i.facility_id = :f
     HAVING balance > 0.0001`,
    { replacements: { f: FACILITY }, type: QueryTypes.SELECT },
  );
  console.log(
    "Open BEFORE:",
    open.map((r) => ({ inv: r.invoice_ref, cust: r.customer_no, bal: r.balance })),
  );

  const t = await db.sequelize.transaction();
  try {
    let cleared = 0;
    for (const row of open) {
      const amt = Number(row.balance) || 0;
      if (amt <= 0.001) continue;
      const acctRows = await db.sequelize.query(
        `SELECT account_code, account_subhead, account_description
         FROM general_ledger
         WHERE facility_id = :f AND reference_number = :inv
           AND LOWER(type) IN ('receivable','recevable') AND dr > 0
         ORDER BY transaction_id DESC LIMIT 1`,
        {
          replacements: { f: FACILITY, inv: row.invoice_ref },
          type: QueryTypes.SELECT,
          transaction: t,
        },
      );
      const acct = acctRows[0];
      if (!acct?.account_code) {
        console.warn("Skip:", row.invoice_ref);
        continue;
      }
      await db.GeneralLedger.create(
        {
          transaction_date: new Date(),
          account_code: acct.account_code,
          account_subhead: acct.account_subhead || 0,
          dr: 0,
          cr: amt,
          account_description: acct.account_description || "Accounts Receivable",
          transaction_description: `TEST CLEAN — clear credit for retest — ${row.invoice_ref}`,
          reference_number: row.invoice_ref,
          purpose_of_payment: "TEST CLEAN clear credit balance",
          payee: row.customer_name,
          created_by: USER_ID,
          facility_id: FACILITY,
          status: "posted",
          type: "receivable",
          transaction_ref: row.customer_no,
        },
        { transaction: t },
      );
      cleared += 1;
    }

    const refs = open.map((r) => r.invoice_ref).filter(Boolean);
    if (refs.length) {
      await db.sequelize.query(
        `UPDATE sale_workflows
         SET status = 'cancelled',
             notes = CONCAT(COALESCE(notes,''), ' | TEST CLEAN cancelled for retest'),
             updated_by = :uid
         WHERE facility_id = :f
           AND sale_code IN (:refs)
           AND LOWER(COALESCE(status,'')) NOT IN ('completed','cancelled','reversed','goods_released')`,
        {
          replacements: { f: FACILITY, uid: USER_ID, refs },
          transaction: t,
        },
      );
    }

    // deposits empty
    await db.sequelize.query(
      `DELETE FROM general_ledger
       WHERE facility_id = :f AND LOWER(COALESCE(type,'')) = 'deposit'`,
      { replacements: { f: FACILITY }, transaction: t },
    );
    await db.sequelize.query(
      `DELETE FROM customer_entries
       WHERE facilityId = :f
         AND (LOWER(COALESCE(type,'')) = 'deposit' OR receiptNo LIKE 'AD-%' OR receiptNo LIKE 'AA-%')`,
      { replacements: { f: FACILITY }, transaction: t },
    );

    await t.commit();
    console.log("Cleared:", cleared);
  } catch (e) {
    await t.rollback();
    throw e;
  }

  const after = await db.sequelize.query(
    `SELECT i.ref_number AS customer_no,
            ROUND(SUM(GREATEST(COALESCE(se.ar,0),0)),2) AS bal
     FROM invoices i
     LEFT JOIN (
       SELECT reference_number AS invoice_ref, facility_id,
              SUM(CASE WHEN LOWER(type) IN ('receivable','recevable') THEN dr-cr ELSE 0 END) AS ar
       FROM general_ledger
       WHERE facility_id = :f AND reference_number IS NOT NULL AND reference_number != ''
       GROUP BY reference_number, facility_id
     ) se ON se.invoice_ref = i.invoice_ref AND se.facility_id = i.facility_id
     WHERE i.type = 'sales' AND i.facility_id = :f
     GROUP BY i.ref_number HAVING bal > 0.0001`,
    { replacements: { f: FACILITY }, type: QueryTypes.SELECT },
  );
  const dep = await db.sequelize.query(
    `SELECT ROUND(COALESCE(SUM(cr)-SUM(dr),0),2) AS bal FROM general_ledger
     WHERE facility_id = :f AND LOWER(type)='deposit'`,
    { replacements: { f: FACILITY }, type: QueryTypes.SELECT },
  );
  console.log("Credit AFTER:", after);
  console.log("Deposit AFTER:", dep[0]);
  await db.sequelize.close();
  console.log("DONE");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
