"use strict";

/**
 * Move the 7.5% VAT out of cost of sales on sales that are not posted yet.
 *
 * A sale waiting for credit approval, cashier confirmation or a deposit keeps
 * its ledger lines in sale_workflows.history (pending_sale_ledger) and posts
 * them to general_ledger only after approval. Migration 20261008221000 fixes
 * what is already in general_ledger, so these queued lines still carry the
 * full cost. When they are approved they would post the old cost.
 *
 * For each queued "COGS [sku]" line of a Taxable product:
 *   cost of sales is reduced to the cost after tax,
 *   the same amount is debited to Input VAT (placed right after the line),
 *   the inventory credit is left as it was.
 * Example: 45,000 with VAT inside becomes 41,860.47 of cost and 3,139.53 of
 * Input VAT.
 *
 * Non-Taxable, Exempted, and Zero Rated products are not changed.
 * Safe to run again: a product that already has an Input VAT line in the same
 * queued sale is skipped.
 *
 * The workflow rows it changes are copied first into
 * bak_pending_cogs_vat_sale_workflows. down() puts them back.
 */

const { costIncludesInputVat } = require("../src/constants/taxableStatus");

const eq = (a, b) =>
  `CONVERT(${a} USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(${b} USING utf8mb4) COLLATE utf8mb4_general_ci`;

const BACKUP_TABLE = "bak_pending_cogs_vat_sale_workflows";

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function parseHistory(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  if (raw && typeof raw === "object") return [raw];
  return [];
}

const COGS_LINE = /^COGS \[(.+?)\]\s*[–-]?\s*(.*)$/;
const vatLinePrefix = (sku) => `Input VAT [${sku}]`;

/**
 * Returns the history with VAT moved out of its queued COGS lines, and how many
 * lines changed. Throws when a line needs an Input VAT account and none is given.
 */
function fixHistory(history, facilityId, taxableBySku, vatAccount) {
  let changed = 0;
  const next = history.map((item) => {
    const queued = item?.pending_sale_ledger;
    if (!Array.isArray(queued) || !queued.length || item.sale_gl_posted) {
      return item;
    }

    const hasVatFor = new Set();
    for (const e of queued) {
      const d = String(e?.transaction_description || "");
      if (e?.type === "tax" && d.startsWith("Input VAT [")) {
        const m = d.match(/^Input VAT \[(.+?)\]/);
        if (m) hasVatFor.add(m[1]);
      }
    }

    const rebuilt = [];
    for (const e of queued) {
      rebuilt.push(e);
      const desc = String(e?.transaction_description || "");
      const m = desc.match(COGS_LINE);
      if (!m || Number(e?.dr) <= 0) continue;
      const sku = m[1];
      if (hasVatFor.has(sku)) continue;
      if (!costIncludesInputVat(taxableBySku.get(sku))) continue;

      const gross = Number(e.dr);
      const vat = round2(gross - gross / 1.075);
      if (!(vat > 0)) continue;

      if (!vatAccount) {
        throw new Error(
          `No inclusive Input VAT account for facility ${facilityId}`,
        );
      }

      e.dr = round2(gross - vat);
      rebuilt.push({
        ...e,
        account_code: vatAccount.code,
        account_subhead: vatAccount.parent_code || vatAccount.code,
        dr: vat,
        cr: 0,
        account_description: vatAccount.description,
        transaction_description: `${vatLinePrefix(sku)} – ${m[2] || sku}`,
        type: "tax",
        transaction_ref: sku,
      });
      changed += 1;
    }

    return { ...item, pending_sale_ledger: rebuilt };
  });
  return { history: next, changed };
}

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;

    const [rows] = await sequelize.query(`
      SELECT id, facility_id, sale_code, history
      FROM sale_workflows
      WHERE CAST(history AS CHAR) LIKE '%pending_sale_ledger%'
        AND CAST(history AS CHAR) LIKE '%COGS [%'
    `);

    const [products] = await sequelize.query(
      `SELECT facility_id, sku, taxable FROM products`,
    );
    const taxableByFacility = new Map();
    for (const p of products) {
      if (!taxableByFacility.has(p.facility_id)) {
        taxableByFacility.set(p.facility_id, new Map());
      }
      taxableByFacility.get(p.facility_id).set(String(p.sku), p.taxable);
    }

    const [vatRows] = await sequelize.query(`
      SELECT t.facilityId AS facility_id,
             MIN(ac.code) AS code,
             MIN(ac.parent_code) AS parent_code,
             MIN(ac.description) AS description
      FROM taxes t
      INNER JOIN account_category ac
        ON ${eq("ac.facility_id", "t.facilityId")}
       AND ${eq("ac.code", "t.account_sub_head")}
      WHERE t.tax_category = 'Purchase'
        AND t.inclusive_type = 'inclusive'
        AND t.description LIKE 'Input VAT%'
      GROUP BY t.facilityId
    `);
    const vatByFacility = new Map(vatRows.map((v) => [v.facility_id, v]));

    // Work out every change first, so nothing is written if one sale fails.
    const updates = [];
    for (const row of rows) {
      const history = parseHistory(row.history);
      const { history: fixed, changed } = fixHistory(
        history,
        row.facility_id,
        taxableByFacility.get(row.facility_id) || new Map(),
        vatByFacility.get(row.facility_id) || null,
      );
      if (changed > 0) updates.push({ id: row.id, history: fixed });
    }

    if (!updates.length) return;

    // Backup first. CREATE TABLE commits in MySQL, so it is outside the transaction.
    await sequelize.query(
      `CREATE TABLE IF NOT EXISTS \`${BACKUP_TABLE}\` LIKE \`sale_workflows\``,
    );
    await sequelize.query(
      `INSERT IGNORE INTO \`${BACKUP_TABLE}\`
       SELECT * FROM sale_workflows WHERE id IN (:ids)`,
      { replacements: { ids: updates.map((u) => u.id) } },
    );

    const transaction = await sequelize.transaction();
    try {
      for (const u of updates) {
        await sequelize.query(
          "UPDATE sale_workflows SET history = :history WHERE id = :id",
          {
            replacements: { id: u.id, history: JSON.stringify(u.history) },
            transaction,
          },
        );
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    const sequelize = queryInterface.sequelize;
    const [exists] = await sequelize.query(
      `SHOW TABLES LIKE '${BACKUP_TABLE}'`,
    );
    if (!exists.length) return;
    // Only sales still waiting are restored. A sale already approved has
    // posted its lines to general_ledger and is left alone.
    const [backups] = await sequelize.query(
      `SELECT id, history FROM \`${BACKUP_TABLE}\``,
    );
    const ids = backups.map((b) => b.id);
    if (!ids.length) return;
    const [current] = await sequelize.query(
      "SELECT id, history FROM sale_workflows WHERE id IN (:ids)",
      { replacements: { ids } },
    );
    const stillWaiting = new Set(
      current
        .filter((c) =>
          parseHistory(c.history).some(
            (h) =>
              Array.isArray(h?.pending_sale_ledger) &&
              h.pending_sale_ledger.length &&
              !h.sale_gl_posted,
          ),
        )
        .map((c) => c.id),
    );

    const transaction = await sequelize.transaction();
    try {
      for (const b of backups) {
        if (!stillWaiting.has(b.id)) continue;
        await sequelize.query(
          "UPDATE sale_workflows SET history = :history WHERE id = :id",
          {
            replacements: {
              id: b.id,
              history: JSON.stringify(parseHistory(b.history)),
            },
            transaction,
          },
        );
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
