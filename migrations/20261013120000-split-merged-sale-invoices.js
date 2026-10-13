"use strict";

/**
 * Two sales saved at the same moment can share one invoice number.
 * INV-2415 is Hafizu (CUS-2450, lines 1–4) and Abdullahi Nasiru (CUS-2140, lines 5–7).
 *
 * The earliest customer keeps the original number.
 * Each later customer is moved onto the nearest unused INV- number
 * that is lower than the merged invoice, so it cannot collide with
 * invoices already issued after that number.
 * The sale counter is left where it is, because the number given out
 * is an old gap, not the next number in line.
 *
 * Safe to run again: a receipt that already has one customer is left alone.
 * down() puts the moved sales back, using bak_split_merged_invoice.
 */

const LOG = "bak_split_merged_invoice";

const fac = (column) =>
  `CONVERT(${column} USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(:facilityId USING utf8mb4) COLLATE utf8mb4_general_ci`;

async function tableExists(sequelize, table, transaction) {
  const rows = await sequelize.query(
    `SELECT 1 AS ok
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = :table
     LIMIT 1`,
    {
      replacements: { table },
      type: sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  return rows.length > 0;
}

async function usedInvoiceNumbers(sequelize, facilityId, transaction) {
  const sources = [
    ["customer_entries", "receiptNo", "facilityId"],
    ["invoices", "invoice_ref", "facility_id"],
    ["general_ledger", "reference_number", "facility_id"],
    ["store_entries", "reference_number", "facilityId"],
  ];
  if (await tableExists(sequelize, "sale_workflows", transaction)) {
    sources.push(["sale_workflows", "sale_code", "facility_id"]);
  }
  if (await tableExists(sequelize, "sale_fulfillments", transaction)) {
    sources.push(["sale_fulfillments", "sale_code", "facility_id"]);
  }

  const used = new Set();
  for (const [table, column, facilityColumn] of sources) {
    if (!(await tableExists(sequelize, table, transaction))) continue;
    const rows = await sequelize.query(
      `SELECT DISTINCT ${column} AS ref
       FROM \`${table}\`
       WHERE ${fac(facilityColumn)}
         AND ${column} REGEXP '^INV-[0-9]+$'`,
      {
        replacements: { facilityId },
        type: sequelize.QueryTypes.SELECT,
        transaction,
      },
    );
    for (const row of rows) {
      const n = Number(String(row.ref || "").replace(/^INV-/i, ""));
      if (Number.isFinite(n) && n > 0) used.add(n);
    }
  }
  return used;
}

function nearestFreeBefore(used, beforeNumber) {
  for (let n = beforeNumber - 1; n >= 1; n -= 1) {
    if (!used.has(n)) return n;
  }
  throw new Error(`No free invoice number before INV-${beforeNumber}`);
}

async function moveCustomer(sequelize, transaction, move) {
  const { facilityId, oldRef, newRef, customerNo, createdBy } = move;

  await sequelize.query(
    `UPDATE customer_entries
     SET receiptNo = :newRef,
         description = REPLACE(description, :oldRef, :newRef),
         link_id = CASE WHEN link_id = :oldRef THEN :newRef ELSE link_id END
     WHERE ${fac("facilityId")}
       AND customerNo = :customerNo
       AND (receiptNo = :oldRef OR link_id = :oldRef)`,
    { replacements: move, transaction },
  );

  if (await tableExists(sequelize, "invoices", transaction)) {
    await sequelize.query(
      `UPDATE invoices
       SET invoice_ref = :newRef
       WHERE ${fac("facility_id")}
         AND invoice_ref = :oldRef
         AND (customerNo = :customerNo OR ref_number = :customerNo)`,
      { replacements: move, transaction },
    );
  }

  if (await tableExists(sequelize, "general_ledger", transaction)) {
    await sequelize.query(
      `UPDATE general_ledger
       SET reference_number = :newRef,
           transaction_description = REPLACE(transaction_description, :oldRef, :newRef)
       WHERE ${fac("facility_id")}
         AND reference_number = :oldRef
         AND (
           payee = :customerNo
           OR payee LIKE CONCAT(:customerNo, ' %')
           OR payee LIKE CONCAT(:customerNo, '—%')
           OR payee LIKE CONCAT(:customerNo, ' —%')
           OR transaction_ref = :customerNo
         )`,
      { replacements: move, transaction },
    );
  }

  if (await tableExists(sequelize, "store_entries", transaction)) {
    await sequelize.query(
      `UPDATE store_entries se
       INNER JOIN customer_entries ce
         ON ${fac("ce.facilityId")}
        AND ce.customerNo = :customerNo
        AND ce.receiptNo = :newRef
        AND LOWER(ce.type) = 'sales'
        AND se.product_id = ce.link_id
        AND ABS(COALESCE(se.qty_out, 0) - COALESCE(ce.qty_out, 0)) < 0.001
        AND se.inserted_by = ce.created_by
        AND (ce.branch_id IS NULL OR se.branchId IS NULL OR se.branchId = ce.branch_id)
       SET se.reference_number = :newRef
       WHERE ${fac("se.facilityId")}
         AND se.reference_number = :oldRef`,
      { replacements: move, transaction },
    );
  }

  if (await tableExists(sequelize, "sale_workflows", transaction)) {
    await sequelize.query(
      `UPDATE sale_workflows sw
       SET sw.sale_code = :newRef,
           sw.history = REPLACE(sw.history, :oldRef, :newRef)
       WHERE ${fac("sw.facility_id")}
         AND sw.sale_code = :oldRef
         AND sw.customer_no = :customerNo
         AND NOT EXISTS (
           SELECT 1 FROM (
             SELECT facility_id, sale_code, customer_no
             FROM sale_workflows
           ) other
           WHERE other.sale_code = :newRef
             AND CONVERT(other.facility_id USING utf8mb4) COLLATE utf8mb4_general_ci
               = CONVERT(sw.facility_id USING utf8mb4) COLLATE utf8mb4_general_ci
             AND other.customer_no <> :customerNo
         )`,
      { replacements: move, transaction },
    );
  }

  if (
    createdBy &&
    (await tableExists(sequelize, "sale_fulfillments", transaction))
  ) {
    await sequelize.query(
      `UPDATE sale_fulfillments
       SET sale_code = :newRef,
           pack_code = REPLACE(pack_code, :oldRef, :newRef)
       WHERE ${fac("facility_id")}
         AND sale_code = :oldRef
         AND created_by = :createdBy`,
      { replacements: move, transaction },
    );
  }

  if (createdBy && (await tableExists(sequelize, "notifications", transaction))) {
    await sequelize.query(
      `UPDATE notifications
       SET entity_id = :newRef,
           title = REPLACE(title, :oldRef, :newRef)
       WHERE ${fac("facility_id")}
         AND entity_id = :oldRef
         AND actor_user_id = :createdBy`,
      { replacements: move, transaction },
    );
  }
}

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    const transaction = await sequelize.transaction();
    try {
      await sequelize.query(
        `CREATE TABLE IF NOT EXISTS \`${LOG}\` (
           id INT NOT NULL AUTO_INCREMENT,
           facility_id VARCHAR(100) NOT NULL,
           old_ref VARCHAR(50) NOT NULL,
           new_ref VARCHAR(50) NOT NULL,
           customer_no VARCHAR(50) NOT NULL,
           created_by VARCHAR(50) NULL,
           created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
           PRIMARY KEY (id)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        { transaction },
      );

      const groups = await sequelize.query(
        `SELECT facilityId AS facility_id, receiptNo AS receipt_no
         FROM customer_entries
         WHERE receiptNo REGEXP '^INV-[0-9]+$'
           AND LOWER(type) = 'sales'
         GROUP BY facilityId, receiptNo
         HAVING COUNT(DISTINCT customerNo) > 1`,
        { type: sequelize.QueryTypes.SELECT, transaction },
      );

      for (const group of groups) {
        const facilityId = group.facility_id;
        const oldRef = group.receipt_no;
        const oldNumber = Number(String(oldRef).replace(/^INV-/i, ""));
        const customers = await sequelize.query(
          `SELECT customerNo AS customer_no,
                  MIN(entry_id) AS first_entry,
                  MIN(created_by) AS created_by
           FROM customer_entries
           WHERE ${fac("facilityId")}
             AND receiptNo = :oldRef
             AND LOWER(type) = 'sales'
           GROUP BY customerNo
           ORDER BY first_entry ASC`,
          {
            replacements: { facilityId, oldRef },
            type: sequelize.QueryTypes.SELECT,
            transaction,
          },
        );
        if (customers.length < 2) continue;

        const used = await usedInvoiceNumbers(sequelize, facilityId, transaction);

        for (const extra of customers.slice(1)) {
          const already = await sequelize.query(
            `SELECT id FROM \`${LOG}\`
             WHERE ${fac("facility_id")}
               AND old_ref = :oldRef
               AND customer_no = :customerNo
             LIMIT 1`,
            {
              replacements: {
                facilityId,
                oldRef,
                customerNo: extra.customer_no,
              },
              type: sequelize.QueryTypes.SELECT,
              transaction,
            },
          );
          if (already.length) continue;

          const assigned = nearestFreeBefore(used, oldNumber);
          used.add(assigned);
          const newRef = `INV-${assigned}`;
          const move = {
            facilityId,
            oldRef,
            newRef,
            customerNo: extra.customer_no,
            createdBy: extra.created_by || null,
          };
          await moveCustomer(sequelize, transaction, move);
          await sequelize.query(
            `INSERT INTO \`${LOG}\`
               (facility_id, old_ref, new_ref, customer_no, created_by)
             VALUES (:facilityId, :oldRef, :newRef, :customerNo, :createdBy)`,
            { replacements: move, transaction },
          );
          console.log(
            `Split ${oldRef}: ${extra.customer_no} moved to ${newRef}`,
          );
        }
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    const sequelize = queryInterface.sequelize;
    if (!(await tableExists(sequelize, LOG, null))) return;

    const transaction = await sequelize.transaction();
    try {
      const rows = await sequelize.query(
        `SELECT facility_id, old_ref, new_ref, customer_no, created_by
         FROM \`${LOG}\`
         ORDER BY id DESC`,
        { type: sequelize.QueryTypes.SELECT, transaction },
      );
      for (const row of rows) {
        await moveCustomer(sequelize, transaction, {
          facilityId: row.facility_id,
          oldRef: row.new_ref,
          newRef: row.old_ref,
          customerNo: row.customer_no,
          createdBy: row.created_by,
        });
      }
      await sequelize.query(`DELETE FROM \`${LOG}\``, { transaction });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
