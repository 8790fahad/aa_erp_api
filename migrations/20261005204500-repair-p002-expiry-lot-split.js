"use strict";

/**
 * Superseded by 20261006124500-null-all-product-expiry-dates.
 *
 * P002 lot repair stamped dated expiries; business later asked to null all
 * product expiry dates on stock and purchase rows. Keep this file so
 * SequelizeMeta order stays stable, but do nothing here.
 */
module.exports = {
  async up() {
    // no-op — see 20261006124500-null-all-product-expiry-dates.js
  },

  async down() {},
};
