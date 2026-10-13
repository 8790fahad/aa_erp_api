"use strict";

/**
 * The first split moved the sale lines, but the goods issue notes stayed on
 * the shared invoice and the other customer never got a workflow, so that
 * sale did not show on Verification Points or Invoice Separation.
 *
 * Runs after 20261013120000. Safe to run again.
 */

const { repairLoggedSplits } = require("./20261013120000-split-merged-sale-invoices");

module.exports = {
  async up(queryInterface) {
    await repairLoggedSplits(queryInterface);
  },

  async down() {
    // The split migration's down() puts the sale back and removes the workflow.
  },
};
