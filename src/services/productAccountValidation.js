"use strict";

/**
 * Verify product Revenue / COGS / Inventory accounts against account_category,
 * and Branch ID against branches for the facility.
 */

const db = require("../models");
const { validateBranchIdById } = require("./branchResolver");

const INVENTORY_ITEM_TYPES = [
  "Raw Material",
  "Semi Finished",
  "Finished Good",
  "Resalable",
  "By-Product",
];

const SELLABLE_ITEM_TYPES = [
  "Finished Good",
  "Resalable",
  "By-Product",
  "Service",
  "Consumable",
];

/**
 * Look up an account category by code (UI "head") for a facility.
 * @returns {Promise<object|null>}
 */
async function findAccountCategory(facilityId, code, transaction) {
  if (!facilityId || code == null || String(code).trim() === "") return null;
  const normalized = String(code).trim();
  return db.AccountCategory.findOne({
    where: {
      code: normalized,
      facility_id: facilityId,
    },
    transaction,
  });
}

/**
 * @param {object} opts
 * @param {string} opts.facilityId
 * @param {string} opts.itemType
 * @param {string} [opts.revenueAccount]
 * @param {string} [opts.cogsAccount]
 * @param {string} [opts.inventoryAccount]
 * @param {string|number|null} [opts.branchId]
 * @param {number} [opts.quantity]
 * @param {boolean} [opts.requireBranchWhenStock]
 * @param {import("sequelize").Transaction} [opts.transaction]
 * @returns {Promise<{ ok: true } | { ok: false, message: string }>}
 */
async function verifyProductAccountsAndBranch({
  facilityId,
  itemType,
  revenueAccount = "",
  cogsAccount = "",
  inventoryAccount = "",
  branchId = null,
  quantity = 0,
  requireBranchWhenStock = true,
  transaction,
}) {
  if (!facilityId) {
    return { ok: false, message: "facility_id is required" };
  }

  const type = String(itemType || "").trim();
  const isInventory = INVENTORY_ITEM_TYPES.some(
    (t) => type === t || type.includes(t),
  );
  const needsRevenue = SELLABLE_ITEM_TYPES.some(
    (t) => type === t || type.includes(t),
  );
  const qty = parseFloat(quantity) || 0;

  if (needsRevenue) {
    if (!revenueAccount || String(revenueAccount).trim() === "") {
      return { ok: false, message: "Revenue Account is required" };
    }
    const rev = await findAccountCategory(
      facilityId,
      revenueAccount,
      transaction,
    );
    if (!rev) {
      return {
        ok: false,
        message: `Revenue Account "${revenueAccount}" was not found in account categories for this business`,
      };
    }
  }

  if (isInventory) {
    if (!inventoryAccount || String(inventoryAccount).trim() === "") {
      return { ok: false, message: "Inventory Account is required" };
    }
    const inv = await findAccountCategory(
      facilityId,
      inventoryAccount,
      transaction,
    );
    if (!inv) {
      return {
        ok: false,
        message: `Inventory Account "${inventoryAccount}" was not found in account categories for this business`,
      };
    }

    if (!cogsAccount || String(cogsAccount).trim() === "") {
      return { ok: false, message: "COGS Account is required" };
    }
    const cogs = await findAccountCategory(
      facilityId,
      cogsAccount,
      transaction,
    );
    if (!cogs) {
      return {
        ok: false,
        message: `COGS Account "${cogsAccount}" was not found in account categories for this business`,
      };
    }
  }

  // Optional: if a non-required account is provided, still verify it exists
  if (
    revenueAccount &&
    String(revenueAccount).trim() !== "" &&
    !needsRevenue
  ) {
    const rev = await findAccountCategory(
      facilityId,
      revenueAccount,
      transaction,
    );
    if (!rev) {
      return {
        ok: false,
        message: `Revenue Account "${revenueAccount}" was not found in account categories for this business`,
      };
    }
  }

  const parsedBranch =
    branchId == null || branchId === "" || branchId === "all"
      ? 0
      : parseInt(branchId, 10) || 0;

  if (requireBranchWhenStock && qty > 0) {
    if (!parsedBranch) {
      return {
        ok: false,
        message: "Branch ID is required when stock quantity is greater than 0",
      };
    }
    const exists = await validateBranchIdById(
      facilityId,
      parsedBranch,
      transaction,
    );
    if (!exists) {
      return {
        ok: false,
        message: `Branch ID ${parsedBranch} was not found in branches for this business`,
      };
    }
  } else if (parsedBranch > 0) {
    const exists = await validateBranchIdById(
      facilityId,
      parsedBranch,
      transaction,
    );
    if (!exists) {
      return {
        ok: false,
        message: `Branch ID ${parsedBranch} was not found in branches for this business`,
      };
    }
  }

  return { ok: true };
}

module.exports = {
  findAccountCategory,
  verifyProductAccountsAndBranch,
  INVENTORY_ITEM_TYPES,
  SELLABLE_ITEM_TYPES,
};
