"use strict";

/**
 * Superseded by 20261006124500-null-all-product-expiry-dates.
 *
 * The original backfill stamped transfer expiries, then failed on VPS with
 * mixed utf8mb4_general_ci / utf8mb4_unicode_ci joins. Business later asked
 * to clear every product expiry, so this step is intentionally a no-op.
 */
module.exports = {
  async up() {
    // no-op — see 20261006124500-null-all-product-expiry-dates.js
  },

  async down() {},
};
