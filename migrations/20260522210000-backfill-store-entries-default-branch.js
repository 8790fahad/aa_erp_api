"use strict";

/**
 * Backfill `store_entries.branchId` for rows that are still NULL or 0
 * (the "Unassigned" sentinel) by pointing them at each business's
 * default branch.
 *
 * Default-branch resolution per facility (first match wins):
 *   1. store_type = 'Store'   (canonical default)
 *   2. store_type = 'Retail'  (created by the current signup flow)
 *   3. lowest `id` branch on the facility (oldest one)
 *
 * Tie-break in every step is the lowest branch.id (oldest record), so
 * facilities with multiple matching branches still get a stable result.
 *
 * Facilities with no branches at all are skipped — those rows stay at 0.
 */
module.exports = {
  up: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const sql = queryInterface.sequelize;

    // Build a map of facilityId -> default branch id, applying the priority
    // rules above. We compute it in JS so the priority ordering is explicit
    // and easy to audit, instead of relying on MySQL ORDER BY tricks.
    const [branches] = await sql.query(
      "SELECT id, facilityId, store_type FROM `branches` WHERE id <> 0 ORDER BY id ASC"
    );

    const PRIORITY = { Store: 0, Retail: 1 };
    const byFacility = new Map();
    for (const b of branches) {
      if (!b.facilityId) continue;
      const rank = PRIORITY[b.store_type] != null ? PRIORITY[b.store_type] : 2;
      const existing = byFacility.get(b.facilityId);
      if (
        !existing ||
        rank < existing.rank ||
        (rank === existing.rank && b.id < existing.id)
      ) {
        byFacility.set(b.facilityId, { id: b.id, rank, store_type: b.store_type });
      }
    }

    // Snapshot the rows we're going to touch so the result is reproducible
    // and we can log totals.
    const [pending] = await sql.query(
      "SELECT facilityId, COUNT(*) AS c FROM `store_entries` " +
        "WHERE branchId IS NULL OR branchId = 0 GROUP BY facilityId"
    );

    if (pending.length === 0) {
      console.log("[backfill-store-entries] nothing to do — no rows with branchId NULL/0");
      return;
    }

    let updated = 0;
    let skipped = 0;
    for (const row of pending) {
      const def = byFacility.get(row.facilityId);
      if (!def) {
        console.warn(
          `[backfill-store-entries] facility ${row.facilityId} has no usable branch; ` +
            `${row.c} store_entries left at branchId=0`
        );
        skipped += row.c;
        continue;
      }

      const [result] = await sql.query(
        "UPDATE `store_entries` SET branchId = :branchId " +
          "WHERE facilityId = :facilityId AND (branchId IS NULL OR branchId = 0)",
        { replacements: { branchId: def.id, facilityId: row.facilityId } }
      );
      const affected = result?.affectedRows ?? row.c;
      updated += affected;
      console.log(
        `[backfill-store-entries] facility=${row.facilityId} branchId=${def.id} ` +
          `(${def.store_type}) rows=${affected}`
      );
    }

    console.log(
      `[backfill-store-entries] done — updated=${updated} skipped=${skipped}`
    );
  },

  down: async () => {
    // Intentional no-op. Reverting a data backfill in bulk would be unsafe;
    // if you need to undo this, restore from a backup.
  },
};
