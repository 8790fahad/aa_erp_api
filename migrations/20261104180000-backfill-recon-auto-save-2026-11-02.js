"use strict";

/**
 * 02/11/2026 has sales activity but no Collection Reconciliation History rows.
 * Automatic save only processed "today", so a missed night never caught up.
 *
 * This migration:
 * 1. Runs automatic hand-in save for 2026-11-02 for every business that has
 *    recon_auto_save_enabled (same confirm path as the cron).
 * 2. Safe to re-run: already-confirmed cashiers return 409 and are counted saved.
 *
 * The cron now also catches up missed days after last_run (see
 * collectionReconAutoSaveCron.js), so this gap should not happen again.
 */

const BACKFILL_DATE = "2026-11-02";

module.exports = {
  async up() {
    // eslint-disable-next-line global-require
    require("dotenv").config();
    // eslint-disable-next-line global-require
    const {
      backfillReconAutoSaveForDate,
    } = require("../src/jobs/collectionReconAutoSaveCron");

    const results = await backfillReconAutoSaveForDate(BACKFILL_DATE);
    const ok = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success);
    console.log(
      `[migrate] recon auto-save backfill ${BACKFILL_DATE}: ${ok} business(es) ok`,
    );
    if (failed.length) {
      console.warn(
        `[migrate] recon auto-save backfill failures:`,
        failed.map((f) => `${f.facilityId}: ${f.error}`).join("; "),
      );
    }
  },

  async down() {
    // Compensating delete of automatic history is not safe — leave rows.
  },
};
