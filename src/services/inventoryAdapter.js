"use strict";
const db = require("../models");
const { postJournalBatch } = require("./postingEngine");

async function receiptToGRNI({
  facilityId,
  periodId,
  docNo,
  docDate,
  currency,
  fxRate,
  idempotencyKey,
  vendorId,
  grniAccountId,
  itemId,
  qty,
  unitCost,
  createdBy,
}) {
  // Persist GRNI row
  await db.InventoryGRNI.create({
    facilityId,
    grnNo: docNo,
    vendorId,
    itemId,
    qty,
    unitCost,
    status: "open",
  });

  // Dr Inventory, Cr GRNI (receive into stock at cost)
  const item = await db.InventoryItem.findOne({ where: { id: itemId, facilityId } });
  if (!item) throw new Error("Inventory item not found");
  const amount = Number(qty) * Number(unitCost);
  // Update weighted average layer (simple MVP)
  let layer = await db.InventoryLayer.findOne({ where: { facilityId, itemId } });
  if (!layer) {
    layer = await db.InventoryLayer.create({
      facilityId,
      itemId,
      qty: 0,
      unitCost: 0,
    });
  }
  const oldValue = Number(layer.qty) * Number(layer.unitCost);
  const newQty = Number(layer.qty) + Number(qty);
  const newValue = oldValue + amount;
  const newUnitCost = newQty > 0 ? newValue / newQty : 0;
  layer.qty = newQty;
  layer.unitCost = newUnitCost;
  await layer.save();

  return await postJournalBatch({
    facilityId,
    periodId,
    docNo,
    docType: "INV_RECEIPT",
    docDate,
    currency,
    fxRate,
    sourceModule: "INVENTORY",
    idempotencyKey,
    createdBy,
    lines: [
      { accountId: item.inventoryAccountId, description: "Inventory receipt", debit: amount, credit: 0 },
      { accountId: grniAccountId, description: "GRNI clearing", debit: 0, credit: amount },
    ],
  });
}

async function matchInvoiceToGRNI({
  facilityId,
  periodId,
  docNo,
  docDate,
  currency,
  fxRate,
  idempotencyKey,
  vendorId,
  grniAccountId,
  apControlAccountId,
  grnNo,
  amount,
  createdBy,
}) {
  const open = await db.InventoryGRNI.findOne({ where: { facilityId, grnNo, vendorId, status: "open" } });
  if (!open) throw new Error("GRNI not found/open");
  open.matchedInvoiceNo = docNo;
  open.status = "matched";
  await open.save();

  // Dr GRNI, Cr AP Control
  return await postJournalBatch({
    facilityId,
    periodId,
    docNo,
    docType: "INV_MATCH",
    docDate,
    currency,
    fxRate,
    sourceModule: "INVENTORY",
    idempotencyKey,
    createdBy,
    lines: [
      { accountId: grniAccountId, description: "Clear GRNI", debit: Number(amount || 0), credit: 0, partyId: vendorId, partyType: "vendor" },
      { accountId: apControlAccountId, description: "AP Trade", debit: 0, credit: Number(amount || 0), partyId: vendorId, partyType: "vendor" },
    ],
  });
}

async function issueCOGS({
  facilityId,
  periodId,
  docNo,
  docDate,
  currency,
  fxRate,
  idempotencyKey,
  itemId,
  qty,
  createdBy,
}) {
  const item = await db.InventoryItem.findOne({ where: { id: itemId, facilityId } });
  if (!item) throw new Error("Inventory item not found");
  const layer = await db.InventoryLayer.findOne({ where: { facilityId, itemId } });
  if (!layer || Number(layer.qty) < Number(qty)) {
    throw new Error("Insufficient inventory");
  }
  const unitCost = Number(layer.unitCost || 0);
  const amount = Number(qty) * unitCost;
  // Reduce layer
  layer.qty = Number(layer.qty) - Number(qty);
  await layer.save();

  // Dr COGS, Cr Inventory
  return await postJournalBatch({
    facilityId,
    periodId,
    docNo,
    docType: "INV_ISSUE_COGS",
    docDate,
    currency,
    fxRate,
    sourceModule: "INVENTORY",
    idempotencyKey,
    createdBy,
    lines: [
      { accountId: item.cogsAccountId, description: "COGS", debit: amount, credit: 0 },
      { accountId: item.inventoryAccountId, description: "Inventory issue", debit: 0, credit: amount },
    ],
  });
}

module.exports = { receiptToGRNI, matchInvoiceToGRNI, issueCOGS };








