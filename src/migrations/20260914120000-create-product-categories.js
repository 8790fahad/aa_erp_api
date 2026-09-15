"use strict";

/**
 * Production deploy runs migrations/ (repo root), not this folder.
 * Keep in sync with migrations/20260914120000-create-product-categories.js
 */
module.exports = require("../../migrations/20260914120000-create-product-categories");
