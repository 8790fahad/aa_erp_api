"use strict";

/**
 * Production deploy runs migrations/ (repo root), not this folder.
 * Keep in sync with migrations/20260915110000-normalize-product-category-duplicates.js
 */
module.exports = require("../../migrations/20260915110000-normalize-product-category-duplicates");
