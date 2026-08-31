"use strict";

/**
 * branchResolver.js
 *
 * Resolves a branch_name string to its integer branchId from the branches table.
 * Returns 0 (the "Unassigned" sentinel) when the branch cannot be found.
 *
 * Results are cached per (facilityId, branch_name) pair for the lifetime of the
 * process to avoid repeated DB lookups on high-volume operations.
 */

const db = require("../models");

// In-process cache: "facilityId|branch_name" → branchId (integer)
const _cache = new Map();

/**
 * Resolve a branch_name to its branchId.
 *
 * @param {string} facilityId
 * @param {string|null|undefined} branchName
 * @returns {Promise<number>} branchId — 0 if not found
 */
async function resolveBranchId(facilityId, branchName) {
  if (!branchName || !facilityId) return 0;

  const key = `${facilityId}|${branchName}`;
  if (_cache.has(key)) return _cache.get(key);

  try {
    const [rows] = await db.sequelize.query(
      "SELECT id FROM `branches` WHERE branch_name = :branchName AND facilityId = :facilityId LIMIT 1",
      {
        replacements: { branchName, facilityId },
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    // rows is the first result when using QueryTypes.SELECT
    const id = rows?.id ?? 0;
    _cache.set(key, id);
    return id;
  } catch {
    return 0;
  }
}

/**
 * Resolve multiple branch names at once (batched).
 * Returns a Map<branchName, branchId>.
 *
 * @param {string} facilityId
 * @param {string[]} branchNames  — unique list
 * @returns {Promise<Map<string, number>>}
 */
async function resolveBranchIds(facilityId, branchNames) {
  const result = new Map();
  if (!facilityId || !branchNames?.length) return result;

  const toFetch = [];
  for (const name of branchNames) {
    const key = `${facilityId}|${name}`;
    if (_cache.has(key)) {
      result.set(name, _cache.get(key));
    } else {
      toFetch.push(name);
    }
  }

  if (toFetch.length === 0) return result;

  try {
    const rows = await db.sequelize.query(
      "SELECT id, branch_name FROM `branches` WHERE branch_name IN (:names) AND facilityId = :facilityId",
      {
        replacements: { names: toFetch, facilityId },
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    for (const row of rows) {
      const key = `${facilityId}|${row.branch_name}`;
      _cache.set(key, row.id);
      result.set(row.branch_name, row.id);
    }

    // Any not found → 0
    for (const name of toFetch) {
      if (!result.has(name)) {
        result.set(name, 0);
      }
    }
  } catch {
    for (const name of toFetch) {
      result.set(name, 0);
    }
  }

  return result;
}

/**
 * Check that a numeric branch id belongs to the given facility.
 *
 * @param {string} facilityId
 * @param {number|string} branchId
 * @param {import("sequelize").Transaction} [transaction]
 * @returns {Promise<boolean>}
 */
async function validateBranchIdById(facilityId, branchId, transaction) {
  const id = parseInt(branchId, 10);
  if (!facilityId || !id) return false;

  const options = {
    replacements: { branchId: id, facilityId },
    type: db.sequelize.QueryTypes.SELECT,
  };
  if (transaction) options.transaction = transaction;

  const rows = await db.sequelize.query(
    "SELECT id FROM `branches` WHERE id = :branchId AND facilityId = :facilityId LIMIT 1",
    options
  );
  return rows.length > 0;
}

/**
 * Resolve the default branch id for a facility.
 * Prefers is_default=1, then Store, Retail, then oldest branch.
 *
 * @param {string} facilityId
 * @param {import("sequelize").Transaction} [transaction]
 * @returns {Promise<number>}
 */
async function resolveDefaultBranchId(facilityId, transaction) {
  if (!facilityId) return 0;

  const options = {
    replacements: { facilityId },
    type: db.sequelize.QueryTypes.SELECT,
  };
  if (transaction) options.transaction = transaction;

  let rows = await db.sequelize.query(
    "SELECT id FROM `branches` WHERE facilityId = :facilityId AND is_default = 1 ORDER BY id ASC LIMIT 1",
    options
  );
  if (rows.length) return rows[0].id;

  rows = await db.sequelize.query(
    `SELECT id FROM \`branches\` WHERE facilityId = :facilityId
     ORDER BY CASE WHEN store_type = 'Store' THEN 0 WHEN store_type = 'Retail' THEN 1 ELSE 2 END, id ASC
     LIMIT 1`,
    options
  );
  return rows.length ? rows[0].id : 0;
}

/**
 * Use the given warehouse if it belongs to the facility; otherwise the default
 * warehouse (is_default), then any warehouse. Returns 0 when none exist.
 */
async function resolveRequiredBranchId(facilityId, branch_id, transaction) {
  const parsed = parseInt(branch_id, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    const ok = await validateBranchIdById(facilityId, parsed, transaction);
    if (ok) return parsed;
  }
  return resolveDefaultBranchId(facilityId, transaction);
}

/** Clear the in-process cache (useful in tests). */
function clearBranchCache() {
  _cache.clear();
}

module.exports = {
  resolveBranchId,
  resolveBranchIds,
  validateBranchIdById,
  resolveDefaultBranchId,
  resolveRequiredBranchId,
  clearBranchCache,
};
