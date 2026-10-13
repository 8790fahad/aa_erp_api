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

const eq = (left, right) =>
  `CONVERT(${left} USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(${right} USING utf8mb4) COLLATE utf8mb4_general_ci`;

const ne = (left, right) =>
  `CONVERT(${left} USING utf8mb4) COLLATE utf8mb4_general_ci <> CONVERT(${right} USING utf8mb4) COLLATE utf8mb4_general_ci`;

const like = (column, patternSql) =>
  `CONVERT(${column} USING utf8mb4) COLLATE utf8mb4_general_ci LIKE CONVERT(${patternSql} USING utf8mb4) COLLATE utf8mb4_general_ci`;

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

function paymentTypeFromMode(mode, allowed) {
  const value = String(mode || "").toLowerCase().trim();
  let picked = "credit";
  if (value.includes("transfer") || value === "bank") picked = "transfer";
  else if (value.includes("pos") || value.includes("card")) picked = "card";
  else if (value.includes("cash")) picked = "cash";
  else if (value.includes("split")) picked = "split";
  else if (value.includes("deposit")) picked = "deposit";
  else if (value.includes("warehouse")) picked = "warehouse";
  if (allowed && allowed.size && !allowed.has(picked)) {
    if (picked === "card" && allowed.has("transfer")) return "transfer";
    if (allowed.has("credit")) return "credit";
    return [...allowed][0];
  }
  return picked;
}

function statusForPayment(paymentType) {
  if (paymentType === "credit") {
    return {
      status: "awaiting_credit_approval",
      note: "Split onto its own invoice — awaiting credit approval",
    };
  }
  if (paymentType === "warehouse" || paymentType === "deposit") {
    return {
      status: "invoice_separation",
      note: "Split onto its own invoice — ready for separation",
    };
  }
  return {
    status: "awaiting_cashier_confirm",
    note: "Split onto its own invoice — awaiting payment confirmation",
  };
}

async function paymentTypeEnum(sequelize, transaction) {
  const rows = await sequelize.query(
    `SELECT COLUMN_TYPE AS column_type
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'sale_workflows'
       AND COLUMN_NAME = 'payment_type'
     LIMIT 1`,
    { type: sequelize.QueryTypes.SELECT, transaction },
  );
  const raw = String(rows[0]?.column_type || "");
  const allowed = new Set();
  const match = raw.match(/^enum\((.*)\)$/i);
  if (match) {
    for (const part of match[1].split(",")) {
      const value = part.trim().replace(/^'/, "").replace(/'$/, "");
      if (value) allowed.add(value);
    }
  }
  return allowed;
}

/**
 * Goods issue notes were built for every product on the shared number.
 * Move only this customer's lines onto the new invoice, one pack per store.
 */
async function splitFulfillments(sequelize, transaction, move) {
  if (!(await tableExists(sequelize, "sale_fulfillments", transaction))) return;
  if (!(await tableExists(sequelize, "sale_fulfillment_lines", transaction))) {
    return;
  }

  const lines = await sequelize.query(
    `SELECT DISTINCT sfl.id AS line_id, sf.branch_id
     FROM sale_fulfillment_lines sfl
     INNER JOIN sale_fulfillments sf ON sf.id = sfl.fulfillment_id
     INNER JOIN customer_entries ce
       ON ${fac("ce.facilityId")}
      AND ${eq("ce.customerNo", ":customerNo")}
      AND ${eq("ce.receiptNo", ":newRef")}
      AND CONVERT(LOWER(ce.type) USING utf8mb4) COLLATE utf8mb4_general_ci
          IN ('sales', 'service', 'pro-bono')
      AND ${eq("sfl.product_id", "ce.link_id")}
      AND ABS(COALESCE(sfl.qty, 0) - COALESCE(ce.qty_out, 0)) < 0.001
     WHERE ${fac("sf.facility_id")}
       AND ${eq("sf.sale_code", ":oldRef")}
       AND (
         sfl.store_entry_id IS NULL
         OR EXISTS (
           SELECT 1 FROM store_entries se
           WHERE se.id = sfl.store_entry_id
             AND (
               ${eq("se.inserted_by", "ce.created_by")}
               OR ${eq("se.reference_number", ":newRef")}
             )
         )
       )`,
    {
      replacements: move,
      type: sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  if (!lines.length) return;

  const byBranch = new Map();
  for (const line of lines) {
    const branchId = Number(line.branch_id) > 0 ? Number(line.branch_id) : 0;
    if (!byBranch.has(branchId)) byBranch.set(branchId, []);
    byBranch.get(branchId).push(line.line_id);
  }

  for (const [branchId, lineIds] of byBranch) {
    const found = await sequelize.query(
      `SELECT id
       FROM sale_fulfillments
       WHERE ${fac("facility_id")}
         AND ${eq("sale_code", ":newRef")}
         AND branch_id = :branchId
       LIMIT 1`,
      {
        replacements: { ...move, branchId },
        type: sequelize.QueryTypes.SELECT,
        transaction,
      },
    );
    let packId = found[0]?.id;
    if (!packId) {
      const packCode = `${move.newRef}-B${branchId || "0"}`;
      await sequelize.query(
        `INSERT INTO sale_fulfillments
           (facility_id, sale_code, branch_id, pack_code, status, created_by, updated_by, created_at, updated_at)
         VALUES
           (:facilityId, :newRef, :branchId, :packCode, 'pending', :createdBy, :createdBy, NOW(), NOW())`,
        {
          replacements: { ...move, branchId, packCode },
          transaction,
        },
      );
      const inserted = await sequelize.query(`SELECT LAST_INSERT_ID() AS id`, {
        type: sequelize.QueryTypes.SELECT,
        transaction,
      });
      packId = inserted[0]?.id;
    }
    if (!packId) continue;
    await sequelize.query(
      `UPDATE sale_fulfillment_lines
       SET fulfillment_id = :packId
       WHERE id IN (:lineIds)`,
      { replacements: { packId, lineIds }, transaction },
    );
  }

  await sequelize.query(
    `DELETE sf
     FROM sale_fulfillments sf
     LEFT JOIN sale_fulfillment_lines sfl ON sfl.fulfillment_id = sf.id
     WHERE ${fac("sf.facility_id")}
       AND ${eq("sf.sale_code", ":oldRef")}
       AND sf.status = 'pending'
       AND sfl.id IS NULL`,
    { replacements: move, transaction },
  );
}

/**
 * The shared number only kept the first customer's workflow, so the other
 * sale never appeared on Verification Points or Invoice Separation.
 */
async function ensureWorkflow(sequelize, transaction, move) {
  if (!(await tableExists(sequelize, "sale_workflows", transaction))) return;

  const existing = await sequelize.query(
    `SELECT id
     FROM sale_workflows
     WHERE ${fac("facility_id")}
       AND (
         ${eq("sale_code", ":newRef")}
         OR (${eq("sale_code", ":oldRef")} AND ${eq("customer_no", ":customerNo")})
       )
     LIMIT 1`,
    {
      replacements: move,
      type: sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  if (existing.length) return;

  const totals = await sequelize.query(
    `SELECT MAX(mode_of_payment) AS mode_of_payment,
            SUM(COALESCE(qty_out, 0) * COALESCE(cost, 0)) AS line_amount,
            MIN(branch_id) AS branch_id,
            MIN(created_by) AS created_by
     FROM customer_entries
     WHERE ${fac("facilityId")}
       AND ${eq("customerNo", ":customerNo")}
       AND ${eq("receiptNo", ":newRef")}
       AND CONVERT(LOWER(type) USING utf8mb4) COLLATE utf8mb4_general_ci = 'sales'`,
    {
      replacements: move,
      type: sequelize.QueryTypes.SELECT,
      transaction,
    },
  );

  let amount = Number(totals[0]?.line_amount) || 0;
  let branchId = Number(totals[0]?.branch_id);
  if (!Number.isFinite(branchId) || branchId <= 0) branchId = null;
  const createdBy = move.createdBy || totals[0]?.created_by || null;

  if (await tableExists(sequelize, "invoices", transaction)) {
    const invoices = await sequelize.query(
      `SELECT amount, branchId
       FROM invoices
       WHERE ${fac("facility_id")}
         AND ${eq("invoice_ref", ":newRef")}
         AND (${eq("customerNo", ":customerNo")} OR ${eq("ref_number", ":customerNo")})
       LIMIT 1`,
      {
        replacements: move,
        type: sequelize.QueryTypes.SELECT,
        transaction,
      },
    );
    if (invoices[0]) {
      const invoiceAmount = Number(invoices[0].amount);
      if (Number.isFinite(invoiceAmount) && invoiceAmount > 0) {
        amount = invoiceAmount;
      }
      const invoiceBranch = Number(invoices[0].branchId);
      if (Number.isFinite(invoiceBranch) && invoiceBranch > 0) {
        branchId = invoiceBranch;
      }
    }
  }

  let customerName = move.customerNo;
  if (await tableExists(sequelize, "customers", transaction)) {
    const customers = await sequelize.query(
      `SELECT fullname
       FROM customers
       WHERE ${fac("facilityId")}
         AND ${eq("customerNo", ":customerNo")}
       LIMIT 1`,
      {
        replacements: move,
        type: sequelize.QueryTypes.SELECT,
        transaction,
      },
    );
    if (customers[0]?.fullname) customerName = customers[0].fullname;
  }

  const allowed = await paymentTypeEnum(sequelize, transaction);
  const paymentType = paymentTypeFromMode(totals[0]?.mode_of_payment, allowed);
  const stage = statusForPayment(paymentType);
  const now = new Date().toISOString();
  const history = JSON.stringify([
    {
      status: "submitted",
      at: now,
      by: createdBy,
      note: `Separated from ${move.oldRef} onto ${move.newRef}`,
    },
    {
      status: stage.status,
      at: now,
      by: createdBy,
      note: stage.note,
    },
  ]);

  await sequelize.query(
    `INSERT INTO sale_workflows
       (facility_id, sale_code, customer_no, customer_name, payment_type, status,
        amount, branch_id, hold_overnight, history, notes, created_by, updated_by,
        created_at, updated_at)
     VALUES
       (:facilityId, :newRef, :customerNo, :customerName, :paymentType, :status,
        :amount, :branchId, 0, :history, :notes, :createdBy, :createdBy,
        NOW(), NOW())`,
    {
      replacements: {
        ...move,
        customerName,
        paymentType,
        status: stage.status,
        amount,
        branchId,
        history,
        notes: `split-merged-invoice:${move.oldRef}`,
        createdBy,
      },
      transaction,
    },
  );
}

async function removeSplitWorkflow(sequelize, transaction, move) {
  if (!(await tableExists(sequelize, "sale_workflows", transaction))) return;
  await sequelize.query(
    `DELETE FROM sale_workflows
     WHERE ${fac("facility_id")}
       AND ${eq("sale_code", ":saleCode")}
       AND ${eq("customer_no", ":customerNo")}
       AND notes LIKE 'split-merged-invoice:%'`,
    {
      replacements: {
        facilityId: move.facilityId,
        saleCode: move.saleCode,
        customerNo: move.customerNo,
      },
      transaction,
    },
  );
}

async function moveCustomer(sequelize, transaction, move) {
  const { facilityId, oldRef, newRef, customerNo, createdBy } = move;

  await sequelize.query(
    `UPDATE customer_entries
     SET receiptNo = :newRef,
         description = REPLACE(description, :oldRef, :newRef),
         link_id = CASE WHEN link_id = :oldRef THEN :newRef ELSE link_id END
     WHERE ${fac("facilityId")}
       AND ${eq("customerNo", ":customerNo")}
       AND (${eq("receiptNo", ":oldRef")} OR ${eq("link_id", ":oldRef")})`,
    { replacements: move, transaction },
  );

  if (await tableExists(sequelize, "invoices", transaction)) {
    await sequelize.query(
      `UPDATE invoices
       SET invoice_ref = :newRef
       WHERE ${fac("facility_id")}
         AND ${eq("invoice_ref", ":oldRef")}
         AND (${eq("customerNo", ":customerNo")} OR ${eq("ref_number", ":customerNo")})`,
      { replacements: move, transaction },
    );
  }

  if (await tableExists(sequelize, "general_ledger", transaction)) {
    await sequelize.query(
      `UPDATE general_ledger
       SET reference_number = :newRef,
           transaction_description = REPLACE(transaction_description, :oldRef, :newRef)
       WHERE ${fac("facility_id")}
         AND ${eq("reference_number", ":oldRef")}
         AND (
           ${eq("payee", ":customerNo")}
           OR ${like("payee", "CONCAT(:customerNo, ' %')")}
           OR ${like("payee", "CONCAT(:customerNo, '—%')")}
           OR ${like("payee", "CONCAT(:customerNo, ' —%')")}
           OR ${eq("transaction_ref", ":customerNo")}
         )`,
      { replacements: move, transaction },
    );
  }

  if (await tableExists(sequelize, "store_entries", transaction)) {
    await sequelize.query(
      `UPDATE store_entries se
       INNER JOIN customer_entries ce
         ON ${fac("ce.facilityId")}
        AND ${eq("ce.customerNo", ":customerNo")}
        AND ${eq("ce.receiptNo", ":newRef")}
        AND CONVERT(LOWER(ce.type) USING utf8mb4) COLLATE utf8mb4_general_ci = 'sales'
        AND ${eq("se.product_id", "ce.link_id")}
        AND ABS(COALESCE(se.qty_out, 0) - COALESCE(ce.qty_out, 0)) < 0.001
        AND ${eq("se.inserted_by", "ce.created_by")}
        AND (ce.branch_id IS NULL OR se.branchId IS NULL OR se.branchId = ce.branch_id)
       SET se.reference_number = :newRef
       WHERE ${fac("se.facilityId")}
         AND ${eq("se.reference_number", ":oldRef")}`,
      { replacements: move, transaction },
    );
  }

  if (await tableExists(sequelize, "sale_workflows", transaction)) {
    await sequelize.query(
      `UPDATE sale_workflows sw
       SET sw.sale_code = :newRef,
           sw.history = REPLACE(sw.history, :oldRef, :newRef)
       WHERE ${fac("sw.facility_id")}
         AND ${eq("sw.sale_code", ":oldRef")}
         AND ${eq("sw.customer_no", ":customerNo")}
         AND NOT EXISTS (
           SELECT 1 FROM (
             SELECT facility_id, sale_code, customer_no
             FROM sale_workflows
           ) other
           WHERE ${eq("other.sale_code", ":newRef")}
             AND CONVERT(other.facility_id USING utf8mb4) COLLATE utf8mb4_general_ci
               = CONVERT(sw.facility_id USING utf8mb4) COLLATE utf8mb4_general_ci
             AND ${ne("other.customer_no", ":customerNo")}
         )`,
      { replacements: move, transaction },
    );
  }

  await splitFulfillments(sequelize, transaction, move);
  await ensureWorkflow(sequelize, transaction, move);

  if (createdBy && (await tableExists(sequelize, "notifications", transaction))) {
    await sequelize.query(
      `UPDATE notifications
       SET entity_id = :newRef,
           title = REPLACE(title, :oldRef, :newRef)
       WHERE ${fac("facility_id")}
         AND ${eq("entity_id", ":oldRef")}
         AND ${eq("actor_user_id", ":createdBy")}`,
      { replacements: move, transaction },
    );
  }
}

async function repairLoggedSplits(queryInterface) {
  const sequelize = queryInterface.sequelize;
  if (!(await tableExists(sequelize, LOG, null))) return;
  const transaction = await sequelize.transaction();
  try {
    const rows = await sequelize.query(
      `SELECT facility_id, old_ref, new_ref, customer_no, created_by
       FROM \`${LOG}\`
       ORDER BY id ASC`,
      { type: sequelize.QueryTypes.SELECT, transaction },
    );
    for (const row of rows) {
      const move = {
        facilityId: row.facility_id,
        oldRef: row.old_ref,
        newRef: row.new_ref,
        customerNo: row.customer_no,
        createdBy: row.created_by || null,
      };
      await splitFulfillments(sequelize, transaction, move);
      await ensureWorkflow(sequelize, transaction, move);
      console.log(
        `Repair ${row.old_ref}: ${row.customer_no} goods notes and workflow on ${row.new_ref}`,
      );
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

module.exports = {
  repairLoggedSplits,
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
           AND CONVERT(LOWER(type) USING utf8mb4) COLLATE utf8mb4_general_ci = 'sales'
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
             AND ${eq("receiptNo", ":oldRef")}
             AND CONVERT(LOWER(type) USING utf8mb4) COLLATE utf8mb4_general_ci = 'sales'
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
            `SELECT id, new_ref, created_by FROM \`${LOG}\`
             WHERE ${fac("facility_id")}
               AND ${eq("old_ref", ":oldRef")}
               AND ${eq("customer_no", ":customerNo")}
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
          if (already.length) {
            await splitFulfillments(sequelize, transaction, {
              facilityId,
              oldRef,
              newRef: already[0].new_ref,
              customerNo: extra.customer_no,
              createdBy: already[0].created_by || extra.created_by || null,
            });
            await ensureWorkflow(sequelize, transaction, {
              facilityId,
              oldRef,
              newRef: already[0].new_ref,
              customerNo: extra.customer_no,
              createdBy: already[0].created_by || extra.created_by || null,
            });
            continue;
          }

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
        await removeSplitWorkflow(sequelize, transaction, {
          facilityId: row.facility_id,
          saleCode: row.new_ref,
          customerNo: row.customer_no,
        });
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
