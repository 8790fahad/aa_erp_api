"use strict";

/**
 * Return Inward / Purchase Return stock movements for credit & debit notes.
 * Customer return → qty_in (sales_return) + reverse COGS to Inventory.
 * Supplier return → qty_out (purchase_return) + reduce Inventory / COGS offset.
 */

const { Op } = require("sequelize");
const db = require("../models");
const { STORE_ENTRY_TYPE } = require("../constants/storeEntryTypes");
const {
  getReasonDefinition,
  reasonRequiresInventoryRestock,
  getReasonByCategory,
} = require("../controller/creditNoteReasonController");

async function resolveDefaultBranchId(facilityId, preferredId, transaction) {
  const preferred = parseInt(preferredId, 10);
  if (preferred > 0) return preferred;

  const Branch = db.Branch || db.branches;
  if (!Branch) return 0;

  const whereBase = {
    [Op.or]: [{ facilityId }, { facility_id: facilityId }],
  };

  let row = await Branch.findOne({
    where: { ...whereBase, is_default: true },
    transaction,
  });
  if (!row) {
    row = await Branch.findOne({ where: whereBase, order: [["id", "ASC"]], transaction });
  }
  return row?.id ? parseInt(row.id, 10) : 0;
}

async function resolveProduct(facilityId, sku, transaction) {
  if (!sku) return null;
  const Product = db.Product || db.products;
  if (!Product) return null;
  return Product.findOne({
    where: {
      facility_id: facilityId,
      sku: String(sku),
    },
    transaction,
  });
}

/**
 * @returns {{ storeRows: number, cogsReversed: number }}
 */
async function applyCreditNoteInventoryMovement({
  facilityId,
  userId,
  type, // customer | supplier
  reason,
  reasonCategory,
  creditNoteNumber,
  transactionDate,
  lineItems = [],
  entityId,
  entityName,
  inventoryExplanation,
  transaction,
  pushGl,
}) {
  const reasonDef =
    getReasonDefinition(reason, type) ||
    getReasonByCategory(reasonCategory, type);

  const shouldMove =
    reasonRequiresInventoryRestock(reason, type) ||
    !!(reasonDef?.restockInventory && reasonDef?.inventoryRelated);

  if (!shouldMove) {
    return { storeRows: 0, cogsReversed: 0 };
  }

  const Product = db.Product || db.products;
  if (!Product || !db.StoreEntry) {
    throw new Error("Product / StoreEntry models unavailable for inventory return");
  }

  let storeRows = 0;
  let cogsReversed = 0;
  const receiveDate =
    transactionDate instanceof Date
      ? transactionDate.toISOString().slice(0, 10)
      : String(transactionDate || "").slice(0, 10);

  const productLines = (lineItems || []).filter((li) => {
    const kind = String(li.lineKind || "").toLowerCase();
    if (kind === "service") return false;
    const qty = Number(li.quantity) || 0;
    const sku =
      li.product_id ||
      li.sku ||
      li.product?.sku ||
      li.product?.product_id ||
      null;
    return qty > 0 && sku;
  });

  if (!productLines.length) {
    throw new Error(
      "Return inward requires product lines with item and quantity so stock can be updated.",
    );
  }

  let lineIdx = 0;
  for (const li of productLines) {
    lineIdx += 1;
    const sku = String(
      li.product_id || li.sku || li.product?.sku || li.product?.product_id,
    ).trim();
    const qty = Number(li.quantity) || 0;
    const product = await resolveProduct(facilityId, sku, transaction);
    if (!product) {
      throw new Error(`Product not found for return line: ${sku}`);
    }
    if (String(product.item_type || "").toLowerCase() === "service") {
      continue;
    }

    const branchId = await resolveDefaultBranchId(
      facilityId,
      li.branchId ?? li.branch_id,
      transaction,
    );
    const unitCost =
      Number(li.cost_price) ||
      Number(product.cost_price) ||
      Number(product.unit_cost) ||
      0;
    const sellingPrice =
      Number(li.rate) ||
      Number(li.selling_price) ||
      Number(product.selling_price) ||
      0;

    const note = String(inventoryExplanation || reason || "Return inward").slice(
      0,
      200,
    );

    if (type === "customer") {
      // Return inward — goods back into stock
      await db.StoreEntry.create(
        {
          receive_date: receiveDate,
          reference_number: String(creditNoteNumber).slice(0, 20),
          qty_in: qty,
          qty_out: 0,
          cost_price: unitCost,
          mark_up: unitCost > 0 && sellingPrice > 0 ? sellingPrice / unitCost : 1,
          selling_price: sellingPrice,
          branch_name: "for sales",
          branchId: branchId || 0,
          inserted_by: String(userId || "").slice(0, 50),
          facilityId,
          type: STORE_ENTRY_TYPE.SALES_RETURN,
          source: "customer return",
          destination: "for sales",
          status: "approved",
          product_id: product.sku || sku,
          truckNo: "",
          waybillNo: note.slice(0, 50),
        },
        { transaction },
      );
      storeRows += 1;

      // Reverse COGS: Dr Inventory / Cr Cost of Sales
      if (unitCost > 0 && typeof pushGl === "function") {
        const invCode =
          li.inventory_account ||
          product.inventory_account ||
          null;
        const cogsCode = li.cogs_head || product.cogs_head || null;
        if (invCode && cogsCode) {
          const invAcc = await db.AccountCategory.findOne({
            where: { facility_id: facilityId, code: String(invCode) },
            transaction,
          });
          const cogsAcc = await db.AccountCategory.findOne({
            where: { facility_id: facilityId, code: String(cogsCode) },
            transaction,
          });
          if (invAcc && cogsAcc) {
            const amount = Number((unitCost * qty).toFixed(2));
            const desc = `Return inward ${creditNoteNumber} — ${
              product.name || sku
            } (${entityName || entityId})`;
            pushGl(invAcc, amount, 0, desc, `RET-INV-${lineIdx}`);
            pushGl(cogsAcc, 0, amount, desc, `RET-COGS-${lineIdx}`);
            cogsReversed += amount;
          }
        }
      }
    } else {
      // Return to supplier — stock out
      await db.StoreEntry.create(
        {
          receive_date: receiveDate,
          reference_number: String(creditNoteNumber).slice(0, 20),
          qty_in: 0,
          qty_out: qty,
          cost_price: unitCost,
          mark_up: 1,
          selling_price: sellingPrice,
          branch_name: "Warehouse",
          branchId: branchId || 0,
          inserted_by: String(userId || "").slice(0, 50),
          facilityId,
          type: STORE_ENTRY_TYPE.PURCHASE_RETURN,
          source: "for sales",
          destination: "supplier return",
          status: "approved",
          product_id: product.sku || sku,
          supplier_code: String(entityId || "").slice(0, 150),
          truckNo: "",
          waybillNo: note.slice(0, 50),
        },
        { transaction },
      );
      storeRows += 1;

      // Stock qty only — monetary side already posted via vendor credit line accounts.
      // (Avoid unbalanced Inventory CR without a matching DR here.)
    }
  }

  return { storeRows, cogsReversed };
}

module.exports = {
  applyCreditNoteInventoryMovement,
};
