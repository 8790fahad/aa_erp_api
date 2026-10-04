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

function isHeadOfficeName(name) {
  return String(name || "").trim().toLowerCase() === "head office";
}

function isHeadOfficeBranch(branch) {
  return [branch?.branch_name, branch?.storeName, branch?.location_name].some(
    isHeadOfficeName,
  );
}

function branchRowId(row) {
  const id = Number(row?.id);
  if (Number.isInteger(id) && id > 0) return id;
  const branchId = Number(row?.branchId);
  if (Number.isFinite(branchId) && branchId > 0) return branchId;
  return NaN;
}

function requestUserId(req) {
  const header = req?.headers?.authorization || req?.headers?.Authorization || "";
  const raw = String(header).replace(/^Bearer\s+/i, "").trim();
  if (raw) {
    try {
      const jwt = require("jsonwebtoken");
      const secret =
        process.env.JWT_SECRET_KEY || process.env.JWT_SECRET || "secret";
      const decoded = jwt.verify(raw, secret);
      if (decoded?.id) return String(decoded.id);
    } catch (_err) {
      /* fall through */
    }
  }
  return req?.user?.id || req?.query?.userId || null;
}

async function assignedBranchIds(userId, facilityId) {
  if (!userId || !facilityId) return [];
  const rows = await db.sequelize.query(
    `SELECT branch_id
     FROM user_branches
     WHERE user_id = :userId
       AND facility_id = :facilityId
     UNION
     SELECT u.branchId AS branch_id
     FROM users u
     INNER JOIN branches b
       ON b.id = u.branchId
      AND b.facilityId = :facilityId
     WHERE u.id = :userId
       AND u.branchId IS NOT NULL`,
    {
      replacements: { userId: String(userId), facilityId: String(facilityId) },
      type: db.sequelize.QueryTypes.SELECT,
    },
  );
  return [
    ...new Set(
      rows
        .map((row) => Number(row.branch_id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];
}

/**
 * A branch is visible only after it is assigned on the user.
 * includeAll keeps the full list on staff and branch setup, where access is granted.
 */
async function omitUnassignedBranches(rows, { userId, facilityId, includeAll }) {
  const list = Array.isArray(rows) ? rows : [];
  if (String(includeAll) === "1") return list;
  const allowed = new Set(await assignedBranchIds(userId, facilityId));
  return list.filter((row) => allowed.has(branchRowId(row)));
}

module.exports = {
  resolveBranchId,
  resolveBranchIds,
  validateBranchIdById,
  resolveDefaultBranchId,
  resolveRequiredBranchId,
  clearBranchCache,
  isHeadOfficeBranch,
  requestUserId,
  assignedBranchIds,
  omitUnassignedBranches,
};
