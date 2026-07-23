"use strict";

const moment = require("moment");
const { Op } = require("sequelize");
const { v4: uuidv4 } = require("uuid");
const db = require("../models");

function parseEnableFlag(enabled) {
  return (
    enabled === "true" ||
    enabled === "1" ||
    enabled === "yes" ||
    enabled === true
  );
}

function batchRefs(batchNo) {
  const raw = String(batchNo || "").trim();
  if (!raw) return [];
  return [...new Set([raw])];
}

function parseJsonMaybe(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function resolveCostingRecord(facilityId, refs, transaction) {
  if (!db.ProductionCostingRecord) return null;
  const or = [];
  for (const r of refs) {
    or.push({ id: r }, { batch_no: r });
  }
  let costing = await db.ProductionCostingRecord.findOne({
    where: { facility_id: facilityId, [Op.or]: or },
    order: [["created_at", "DESC"]],
    raw: true,
    transaction,
  });
  if (costing) return costing;
  const candidates = await db.sequelize.query(
    `SELECT *
     FROM production_costing_records
     WHERE facility_id = :facilityId
       AND (
         id IN (:refs)
         OR batch_no IN (:refs)
         OR JSON_UNQUOTE(JSON_EXTRACT(data, '$.batchNo')) IN (:refs)
       )
       AND LOWER(COALESCE(status, '')) <> 'rejected'
     ORDER BY created_at DESC
     LIMIT 1`,
    {
      replacements: { facilityId, refs },
      type: db.sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  return candidates[0] || null;
}

async function createCorrectionArchive({
  facilityId,
  batchNo,
  costingRecordId,
  reason,
  archivedBy,
  storeEntries,
  ledgerEntries,
  costingData,
  meta,
  transaction,
}) {
  if (!db.ProductionCorrectionArchive) {
    console.warn("ProductionCorrectionArchive model missing — skipping backup");
    return null;
  }
  const id = uuidv4();
  await db.ProductionCorrectionArchive.create(
    {
      id,
      facility_id: facilityId,
      batch_no: batchNo,
      costing_record_id: costingRecordId || null,
      reason: reason || "correct",
      archived_by: archivedBy || null,
      archived_at: new Date(),
      store_entries: storeEntries || [],
      ledger_entries: ledgerEntries || [],
      costing_data: costingData || null,
      meta: meta || null,
    },
    { transaction },
  );
  return id;
}

function buildCorrectedStoreRows({
  existingStore,
  updatesById,
  effectiveDate,
  batch,
  facilityId,
  userId,
}) {
  return existingStore.map((se) => {
    const upd = updatesById.get(parseInt(se.id, 10));
    const oldIn = parseFloat(se.qty_in || 0) || 0;
    const oldOut = parseFloat(se.qty_out || 0) || 0;
    const wasIn = oldIn > 0;
    let qtyIn = oldIn;
    let qtyOut = oldOut;
    let costPrice = parseFloat(se.cost_price || 0) || 0;
    if (upd && Number.isFinite(upd.qty) && upd.qty >= 0) {
      if (wasIn) {
        qtyIn = upd.qty;
        qtyOut = 0;
      } else {
        qtyOut = upd.qty;
        qtyIn = 0;
      }
    }
    if (upd && Number.isFinite(upd.cost_price) && upd.cost_price >= 0) {
      costPrice = upd.cost_price;
    }
    return {
      receive_date: effectiveDate,
      reference_number: se.reference_number || batch,
      batch_id: se.batch_id || batch,
      product_id: se.product_id,
      qty_in: qtyIn,
      qty_out: qtyOut,
      cost_price: costPrice,
      selling_price: se.selling_price ?? null,
      mark_up: se.mark_up ?? 0,
      markup_mode: se.markup_mode || "percentage",
      branch_name: se.branch_name || "for sales",
      branchId: se.branchId ?? 0,
      source: se.source || (wasIn ? "Production" : "Work in Progress"),
      destination:
        se.destination || (wasIn ? "Finished Goods" : "Finished Goods"),
      inserted_by: se.inserted_by || userId || null,
      facilityId,
      status: se.status || "approved",
      type: se.type,
      multple: se.multple || "1",
      location: se.location || "Warehouse",
      createdAt: new Date(),
      truckNo: se.truckNo || null,
      waybillNo: se.waybillNo || null,
      supplier_code: se.supplier_code || null,
      expiry_date: se.expiry_date || null,
      multiplier_id: se.multiplier_id || null,
      _was_in: wasIn,
      _sku: String(se.product_id || "").trim(),
      _old_id: se.id,
    };
  });
}

function collectOtherCostLines(sharedCosts, productGroups, items) {
  const lines = [];
  const pushRow = (row) => {
    if (!row) return;
    const kind = String(row.kind || row.rowType || row.type || "").toLowerCase();
    if (
      kind === "raw_material" ||
      kind === "finished_good" ||
      kind === "by_product_credit" ||
      kind === "by_product"
    ) {
      return;
    }
    // Skip rows tied to store RM/FG that we already post from store
    if (row.store_entry_id && (kind === "raw_material" || !kind)) {
      // still allow pure other_cost with store_entry_id missing
    }
    const code = String(
      row.account_code || row.descriptionCode || row.description_code || "",
    ).trim();
    if (!code) return;
    const qty = parseFloat(row.qty || 0) || 0;
    const rate = parseFloat(row.cost_price || row.rate || 0) || 0;
    let amount = parseFloat(row.amount);
    if (!Number.isFinite(amount)) {
      amount = qty > 0 && rate > 0 ? qty * rate : rate;
    }
    amount = Math.abs(amount);
    if (amount <= 0) return;
    lines.push({
      account: code,
      description:
        row.product_name ||
        row.description ||
        row.account_description ||
        "Other manufacturing cost",
      amount,
    });
  };

  for (const r of sharedCosts?.otherCosts || []) pushRow(r);
  for (const r of sharedCosts?.rawMaterials || []) {
    // raw materials handled via store
  }
  for (const g of productGroups || []) {
    for (const r of g.otherCosts || []) pushRow(r);
  }
  for (const it of items || []) {
    const kind = String(it.kind || it.role || "").toLowerCase();
    if (kind === "other_cost" || kind === "other") pushRow(it);
  }
  return lines;
}

function absorbLedgerDiff(rows) {
  let totalDr = rows.reduce((s, r) => s + (parseFloat(r.dr) || 0), 0);
  let totalCr = rows.reduce((s, r) => s + (parseFloat(r.cr) || 0), 0);
  let diff = Number((totalDr - totalCr).toFixed(2));
  if (Math.abs(diff) < 0.01) return rows;

  // Prefer adjusting the largest inventory debit (FG receipt)
  const drRows = rows
    .map((r, i) => ({ i, dr: parseFloat(r.dr) || 0 }))
    .filter((x) => x.dr > 0)
    .sort((a, b) => b.dr - a.dr);
  if (drRows.length && diff > 0) {
    const idx = drRows[0].i;
    const next = Number((rows[idx].dr - diff).toFixed(2));
    if (next > 0) {
      rows[idx].dr = next;
      return rows;
    }
  }
  if (drRows.length && diff < 0) {
    const idx = drRows[0].i;
    rows[idx].dr = Number((rows[idx].dr - diff).toFixed(2));
    return rows;
  }
  const crRows = rows
    .map((r, i) => ({ i, cr: parseFloat(r.cr) || 0 }))
    .filter((x) => x.cr > 0)
    .sort((a, b) => b.cr - a.cr);
  if (crRows.length) {
    const idx = crRows[0].i;
    rows[idx].cr = Number((rows[idx].cr + diff).toFixed(2));
  }
  return rows;
}

function buildCorrectedLedgerRows({
  existingLedger,
  newStoreRows,
  otherCostLines,
  wipCode,
  wipDescription,
  inventoryAccountBySku,
  productNameBySku,
  effectiveDate,
  batch,
  facilityId,
  userId,
}) {
  const purpose =
    (existingLedger[0] && existingLedger[0].purpose_of_payment) ||
    `Production Correction - Batch: ${batch}`;
  const branchId =
    existingLedger[0]?.branch_id != null ? existingLedger[0].branch_id : null;
  const rows = [];

  const push = ({
    account,
    accountDescription,
    description,
    dr = 0,
    cr = 0,
    ref = null,
    type = "inventory",
  }) => {
    const d = Number((parseFloat(dr) || 0).toFixed(2));
    const c = Number((parseFloat(cr) || 0).toFixed(2));
    if (d === 0 && c === 0) return;
    rows.push({
      transaction_date: effectiveDate,
      account_code: account,
      account_subhead: "0",
      dr: d,
      cr: c,
      account_description: accountDescription || description || account,
      transaction_description: description || accountDescription || account,
      reference_number: batch,
      purpose_of_payment: purpose,
      created_by: userId || null,
      facility_id: facilityId,
      type,
      transaction_ref: ref || String(account || "").slice(0, 100),
      branch_id: branchId,
      status: "saved",
    });
  };

  const priorBySkuDr = new Map();
  const priorBySkuCr = new Map();
  for (const gl of existingLedger || []) {
    const ref = String(gl.transaction_ref || "").trim().toUpperCase();
    if (!ref) continue;
    if (parseFloat(gl.dr || 0) > 0) priorBySkuDr.set(ref, gl);
    if (parseFloat(gl.cr || 0) > 0) priorBySkuCr.set(ref, gl);
  }

  for (const se of newStoreRows) {
    const sku = String(se.product_id || se._sku || "").trim();
    const skuKey = sku.toUpperCase();
    const name = productNameBySku.get(skuKey) || sku;
    const qtyOut = parseFloat(se.qty_out || 0) || 0;
    const qtyIn = parseFloat(se.qty_in || 0) || 0;
    const rate = parseFloat(se.cost_price || 0) || 0;
    const amount = Number((Math.max(qtyOut, qtyIn) * rate).toFixed(4));

    if (qtyOut > 0 && amount > 0) {
      const prior = priorBySkuCr.get(skuKey);
      push({
        account: wipCode,
        accountDescription: wipDescription || "WIP",
        description:
          prior?.transaction_description ||
          `${name} — material consumption`,
        cr: amount,
        ref: sku,
        type: prior?.type || "inventory",
      });
    }
    if (qtyIn > 0 && amount > 0) {
      const prior = priorBySkuDr.get(skuKey);
      const invAcct =
        (prior && prior.account_code) ||
        inventoryAccountBySku.get(skuKey) ||
        wipCode;
      push({
        account: invAcct,
        accountDescription:
          prior?.account_description || name || invAcct,
        description:
          prior?.transaction_description ||
          `${name} — inventory receipt`,
        dr: amount,
        ref: sku,
        type: prior?.type || "inventory",
      });
    }
  }

  for (const line of otherCostLines || []) {
    push({
      account: line.account,
      accountDescription: line.description,
      description: line.description,
      cr: line.amount,
      ref: line.account,
      type: "expenses",
    });
  }

  // If other costs missing from payload, preserve prior expense Cr lines not tied to WIP/store SKUs
  if (!(otherCostLines && otherCostLines.length)) {
    const storeSkus = new Set(
      newStoreRows.map((s) => String(s.product_id || "").trim().toUpperCase()),
    );
    for (const gl of existingLedger || []) {
      const cr = parseFloat(gl.cr || 0) || 0;
      if (cr <= 0) continue;
      const code = String(gl.account_code || "").trim();
      if (!code || code === String(wipCode).trim()) continue;
      const ref = String(gl.transaction_ref || "").trim().toUpperCase();
      if (ref && storeSkus.has(ref)) continue;
      push({
        account: code,
        accountDescription: gl.account_description,
        description: gl.transaction_description || gl.account_description,
        cr,
        ref: gl.transaction_ref || code,
        type: gl.type || "expenses",
      });
    }
  }

  return absorbLedgerDiff(rows);
}

function patchCostingDataQtys(costingData, updatesBySku) {
  if (!costingData || typeof costingData !== "object") return costingData;
  const data = JSON.parse(JSON.stringify(costingData));
  const applySku = (obj) => {
    if (!obj || typeof obj !== "object") return;
    const sku = String(
      obj.rawMaterialSku ||
        obj.productSku ||
        obj.sku ||
        obj.item_code ||
        obj.product_id ||
        "",
    )
      .trim()
      .toUpperCase();
    if (!sku || !updatesBySku.has(sku)) return;
    const u = updatesBySku.get(sku);
    if (Number.isFinite(u.qty)) {
      if (obj.actualQty != null) obj.actualQty = u.qty;
      if (obj.actual_qty != null) obj.actual_qty = u.qty;
      if (obj.qtyUsed != null) obj.qtyUsed = u.qty;
      if (obj.goodQuantity != null) obj.goodQuantity = u.qty;
      if (obj.quantity != null && obj.goodQuantity == null) obj.quantity = u.qty;
    }
    if (Number.isFinite(u.cost_price)) {
      if (obj.unit_cost != null) obj.unit_cost = u.cost_price;
      if (obj.rate != null) obj.rate = u.cost_price;
      if (obj.cost_price != null) obj.cost_price = u.cost_price;
    }
  };

  for (const c of data.sharedCosts || []) applySku(c);
  if (data.templateByProduct) {
    applySku(data.templateByProduct);
    for (const it of data.templateByProduct.items || []) applySku(it);
  }
  for (const p of data.products || []) {
    applySku(p);
    for (const fg of p.finishedGoods || []) applySku(fg);
    for (const it of p.items || p.ingredients || []) applySku(it);
  }
  return data;
}


function storeItemFromRow(se) {
  const qtyIn = parseFloat(se.qty_in || 0) || 0;
  const qtyOut = parseFloat(se.qty_out || 0) || 0;
  const qty = qtyIn > 0 ? qtyIn : qtyOut;
  return {
    store_entry_id: se.id,
    product_id: se.product_id,
    sku: se.product_id,
    product_name: se.product_name || se.product_id,
    type: se.type,
    branch_name: se.branch_name,
    source: se.source,
    destination: se.destination,
    direction: qtyIn > 0 ? "in" : "out",
    qty,
    original_qty: qty,
    cost_price: parseFloat(se.cost_price || 0) || 0,
    receive_date: se.receive_date,
    role: qtyIn > 0 ? "finished_good" : "raw_material",
  };
}

function takeStoreBySku(bySku, sku) {
  const key = String(sku || "").trim().toUpperCase();
  if (!key) return null;
  const list = bySku.get(key);
  if (!list || !list.length) return null;
  return list.shift();
}

function costLineFromItem(item, storeBySku) {
  const type = String(item?.type || "").toLowerCase();
  const sku = String(
    item?.rawMaterialSku || item?.productSku || item?.sku || "",
  ).trim();
  if (type === "by_product_credit" || type === "by_product") {
    const matched = takeStoreBySku(storeBySku, sku);
    const qty =
      parseFloat(
        matched?.qty ??
          item.actual_qty ??
          item.actualQty ??
          item.qtyUsed ??
          item.quantity ??
          0,
      ) || 0;
    const rate =
      parseFloat(matched?.cost_price ?? item.unit_cost ?? item.rate ?? 0) || 0;
    const amount = parseFloat(item.amount);
    return {
      kind: "by_product_credit",
      ...(matched || {}),
      store_entry_id: matched?.store_entry_id || null,
      sku: sku || matched?.sku || null,
      product_name:
        item.rawMaterialName ||
        item.description ||
        item.productName ||
        matched?.product_name ||
        sku ||
        "By-product",
      account_code: item.descriptionCode || item.accountHead || null,
      qty,
      original_qty: qty,
      cost_price: rate,
      amount: Number.isFinite(amount)
        ? -Math.abs(amount)
        : -Math.abs(Number((qty * rate).toFixed(4))),
      editable: !!matched?.store_entry_id,
    };
  }
  if (type === "raw_material" || (sku && type !== "other")) {
    const matched = takeStoreBySku(storeBySku, sku);
    if (matched) {
      return { kind: "raw_material", ...matched };
    }
    return {
      kind: "raw_material",
      store_entry_id: null,
      sku: sku || null,
      product_name:
        item.rawMaterialName || item.description || item.productName || sku,
      qty:
        parseFloat(
          item.actual_qty ?? item.actualQty ?? item.qtyUsed ?? item.quantity ?? 0,
        ) || 0,
      original_qty:
        parseFloat(
          item.actual_qty ?? item.actualQty ?? item.qtyUsed ?? item.quantity ?? 0,
        ) || 0,
      cost_price: parseFloat(item.unit_cost || item.rate || 0) || 0,
      editable: false,
    };
  }
  return {
    kind: "other_cost",
    store_entry_id: null,
    sku: item.descriptionCode || null,
    product_name: item.description || item.accountHead || "Other cost",
    account_code: item.descriptionCode || null,
    account_description: item.accountHead || item.description || null,
    qty: parseFloat(item.quantity || item.qtyUsed || 0) || 0,
    amount: parseFloat(item.amount || item.rate || 0) || 0,
    cost_price: parseFloat(item.unit_cost || item.rate || 0) || 0,
    input_type: item.otherType || null,
    rate: parseFloat(item.rate || 0) || 0,
    editable: false,
  };
}

/**
 * Group finished goods with their raw materials / other costs.
 * Prefers costing/manufacturing JSON; falls back to store posting order.
 */
function buildProductGroups({ items, ledgerEntries, batchPayload }) {
  const storeBySku = new Map();
  for (const it of items) {
    const key = String(it.sku || "").trim().toUpperCase();
    if (!key) continue;
    if (!storeBySku.has(key)) storeBySku.set(key, []);
    storeBySku.get(key).push({ ...it });
  }

  const groups = [];
  const shared = { rawMaterials: [], otherCosts: [], byProducts: [] };
  const usedStoreIds = new Set();

  const markUsed = (row) => {
    if (row?.store_entry_id) usedStoreIds.add(row.store_entry_id);
  };

  const payload = batchPayload || {};
  const products = Array.isArray(payload.products) ? payload.products : [];

  if (products.length) {
    for (const prod of products) {
      const fgs = Array.isArray(prod.finishedGoods)
        ? prod.finishedGoods
        : prod.finishedGoods
          ? [prod.finishedGoods]
          : [];
      const fgMeta = fgs[0] || {};
      const fgSku = String(
        fgMeta.productSku ||
          fgMeta.sku ||
          fgMeta.finishedGood?.sku ||
          fgMeta.finishedGood?.item_code ||
          prod.productSku ||
          "",
      ).trim();
      const fgStore = takeStoreBySku(storeBySku, fgSku);
      const finishedGood = fgStore
        ? { kind: "finished_good", ...fgStore, editable: true }
        : {
            kind: "finished_good",
            store_entry_id: null,
            sku: fgSku || null,
            product_name:
              fgMeta.productName ||
              fgMeta.finishedGood?.item_name ||
              prod.productName ||
              fgSku ||
              "Finished good",
            qty: parseFloat(fgMeta.goodQuantity ?? fgMeta.quantity ?? prod.productQty ?? 0) || 0,
            original_qty:
              parseFloat(fgMeta.goodQuantity ?? fgMeta.quantity ?? prod.productQty ?? 0) || 0,
            cost_price: parseFloat(fgMeta.unit_cost || 0) || 0,
            editable: false,
          };
      markUsed(finishedGood);

      const lineItems = Array.isArray(prod.items)
        ? prod.items
        : Array.isArray(prod.ingredients)
          ? prod.ingredients
          : [];
      const rawMaterials = [];
      const otherCosts = [];
      for (const line of lineItems) {
        const mapped = costLineFromItem(line, storeBySku);
        markUsed(mapped);
        if (mapped.kind === "raw_material") rawMaterials.push(mapped);
        else otherCosts.push(mapped);
      }

      groups.push({
        key: finishedGood.sku || `prod-${groups.length}`,
        title: finishedGood.product_name,
        finishedGood,
        rawMaterials,
        otherCosts,
      });
    }

    for (const cost of Array.isArray(payload.sharedCosts) ? payload.sharedCosts : []) {
      const mapped = costLineFromItem(cost, storeBySku);
      markUsed(mapped);
      if (mapped.kind === "raw_material") shared.rawMaterials.push(mapped);
      else if (mapped.kind === "by_product_credit")
        shared.byProducts.push(mapped);
      else shared.otherCosts.push(mapped);
    }

    const tbp = payload.templateByProduct;
    if (tbp) {
      const bpSku = String(tbp.productSku || tbp.item_code || "").trim();
      const bpStore = takeStoreBySku(storeBySku, bpSku);
      const qty =
        parseFloat(bpStore?.qty ?? tbp.quantity ?? tbp.productQty ?? 0) || 0;
      const rate = parseFloat(bpStore?.cost_price ?? tbp.unit_cost ?? 0) || 0;
      const finishedGood = bpStore
        ? { kind: "by_product", ...bpStore, editable: true }
        : {
            kind: "by_product",
            store_entry_id: null,
            sku: bpSku || null,
            product_name: tbp.productName || bpSku || "By-product",
            qty,
            original_qty: qty,
            cost_price: rate,
            editable: false,
          };
      markUsed(finishedGood);
      shared.byProducts.push({
        kind: "by_product_credit",
        ...finishedGood,
        amount: -Math.abs(Number((qty * rate).toFixed(4))),
        account_code: tbp.inventory_account || null,
      });
    }
  } else {
    // Fallback (no costing JSON): mirror joint_shared layout —
    // FG cards, product-specific RMs (qty matches FG), shared RMs, by-products.
    const finishedGoods = items.filter(
      (it) =>
        it.direction === "in" &&
        !String(it.destination || "")
          .toLowerCase()
          .includes("by-product") &&
        !String(it.destination || "")
          .toLowerCase()
          .includes("byproduct"),
    );
    // Also treat production type without by-product destination as FG
    const byProducts = items.filter(
      (it) =>
        it.direction === "in" &&
        (String(it.destination || "")
          .toLowerCase()
          .includes("by-product") ||
          String(it.destination || "")
            .toLowerCase()
            .includes("byproduct")),
    );
    // If destination missing, production rows that aren't already classified:
    const classifiedIn = new Set(
      [...finishedGoods, ...byProducts].map((i) => i.store_entry_id),
    );
    for (const it of items) {
      if (it.direction !== "in" || classifiedIn.has(it.store_entry_id)) continue;
      finishedGoods.push(it);
      classifiedIn.add(it.store_entry_id);
    }

    const consumed = items.filter((it) => it.direction === "out");
    const assignedRm = new Set();

    for (const fg of finishedGoods) {
      const fgQty = parseFloat(fg.qty || 0) || 0;
      const rawMaterials = [];
      for (const rm of consumed) {
        if (assignedRm.has(rm.store_entry_id)) continue;
        const rmQty = parseFloat(rm.qty || 0) || 0;
        // Packaging / product-specific: same qty as FG output
        if (fgQty > 0 && Math.abs(rmQty - fgQty) < 0.0001) {
          rawMaterials.push({ kind: "raw_material", ...rm, editable: true });
          assignedRm.add(rm.store_entry_id);
          markUsed(rm);
        }
      }
      markUsed(fg);
      groups.push({
        key: fg.sku || `fg-${groups.length}`,
        title: fg.product_name,
        finishedGood: {
          kind: "finished_good",
          ...fg,
          destination: fg.destination,
          editable: true,
        },
        rawMaterials,
        otherCosts: [],
      });
    }

    for (const bp of byProducts) {
      markUsed(bp);
      const amount = Number(
        (
          (parseFloat(bp.qty || 0) || 0) * (parseFloat(bp.cost_price || 0) || 0)
        ).toFixed(4),
      );
      shared.byProducts.push({
        kind: "by_product_credit",
        ...bp,
        amount: -Math.abs(amount),
        editable: true,
      });
    }

    for (const rm of consumed) {
      if (assignedRm.has(rm.store_entry_id)) continue;
      shared.rawMaterials.push({
        kind: "raw_material",
        ...rm,
        editable: true,
      });
      markUsed(rm);
    }
  }

  // Leftover store rows
  for (const it of items) {
    if (usedStoreIds.has(it.store_entry_id)) continue;
    if (it.direction === "in") {
      groups.push({
        key: it.sku || `extra-${groups.length}`,
        title: it.product_name,
        finishedGood: { kind: "finished_good", ...it, editable: true },
        rawMaterials: [],
        otherCosts: [],
      });
    } else {
      shared.rawMaterials.push({ kind: "raw_material", ...it, editable: true });
    }
    usedStoreIds.add(it.store_entry_id);
  }

  // Attach unmatched GL lines as shared other costs (not already tied to a store SKU)
  const storeSkus = new Set(
    items.map((i) => String(i.sku || "").trim().toUpperCase()).filter(Boolean),
  );
  for (const gl of ledgerEntries || []) {
    const ref = String(gl.transaction_ref || "").trim().toUpperCase();
    if (ref && storeSkus.has(ref)) continue;
    const desc = String(gl.transaction_description || "").toLowerCase();
    const looksMaterial = [...storeSkus].some(
      (sku) => sku && desc.includes(sku.toLowerCase()),
    );
    if (looksMaterial) continue;
    shared.otherCosts.push({
      kind: "other_cost",
      store_entry_id: null,
      transaction_id: gl.transaction_id,
      sku: gl.account_code,
      product_name: gl.transaction_description || gl.account_description,
      account_code: gl.account_code,
      account_description: gl.account_description,
      amount: Math.max(parseFloat(gl.dr || 0), parseFloat(gl.cr || 0)),
      dr: parseFloat(gl.dr || 0) || 0,
      cr: parseFloat(gl.cr || 0) || 0,
      editable: false,
    });
  }

  return { productGroups: groups, sharedCosts: shared };
}

async function assertProductionCorrectionEnabled(facilityId) {
  const business = await db.business.findOne({
    where: { id: facilityId },
    attributes: ["id", "enable_production_correction"],
  });
  if (!business) {
    const err = new Error("Business not found");
    err.status = 404;
    throw err;
  }
  if (!business.enable_production_correction) {
    const err = new Error("Production correction is disabled for this business");
    err.status = 403;
    throw err;
  }
  return business;
}

/**
 * List production batches for correction from Costing & Pricing
 * (`production_costing_records`) — same source as Markup Costing tab.
 * Store/ledger counts are attached when postings exist for the batch.
 */
exports.listBatchesForCorrection = async (req, res) => {
  try {
    const { facilityId, q = "", limit = 50 } = req.query;
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    if (!db.ProductionCostingRecord) {
      return res.status(500).json({
        success: false,
        message: "Production costing records are not available",
      });
    }

    const trimmed = String(q || "").trim();
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);

    const query = `
      SELECT
        pr.id,
        pr.batch_no,
        pr.production_date,
        pr.status,
        pr.type,
        pr.created_at,
        pr.updated_at,
        COALESCE(
          NULLIF(TRIM(pr.batch_no), ''),
          NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.batchNo'))), ''),
          pr.id
        ) AS batch_id,
        JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.runStatus')) AS run_status
      FROM production_costing_records pr
      WHERE pr.facility_id = :facilityId
        AND LOWER(COALESCE(pr.status, '')) = 'completed'
        ${
          trimmed
            ? `AND (
                 pr.batch_no LIKE :q
                 OR pr.id LIKE :q
                 OR JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.batchNo')) LIKE :q
               )`
            : ""
        }
      ORDER BY pr.created_at DESC
    `;

    const rawRows = await db.sequelize.query(query, {
      replacements: {
        facilityId,
        ...(trimmed ? { q: `%${trimmed}%` } : {}),
      },
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Same batch-key dedupe as Costing & Pricing list
    const byBatchKey = new Map();
    for (const row of rawRows) {
      const key = String(row.batch_id || row.batch_no || row.id || "").trim();
      if (!key) continue;
      const prev = byBatchKey.get(key);
      if (!prev) {
        byBatchKey.set(key, row);
        continue;
      }
      const rowTime = new Date(row.created_at || 0).getTime();
      const prevTime = new Date(prev.created_at || 0).getTime();
      if (rowTime >= prevTime) byBatchKey.set(key, row);
    }
    const costingRows = Array.from(byBatchKey.values())
      .sort(
        (a, b) =>
          new Date(b.created_at || 0).getTime() -
          new Date(a.created_at || 0).getTime(),
      )
      .slice(0, lim);

    const batchNos = [
      ...new Set(
        costingRows
          .flatMap((r) => [r.batch_id, r.batch_no, r.id])
          .map((v) => String(v || "").trim())
          .filter(Boolean),
      ),
    ];

    let storeMap = new Map();
    let glMap = new Map();

    if (batchNos.length) {
      const storeRows = await db.sequelize.query(
        `SELECT
           COALESCE(NULLIF(TRIM(se.reference_number), ''), NULLIF(TRIM(se.batch_id), '')) AS batch_no,
           COUNT(*) AS store_count,
           SUM(CASE WHEN se.qty_in > 0 THEN 1 ELSE 0 END) AS produced_legs,
           SUM(CASE WHEN se.qty_out > 0 THEN 1 ELSE 0 END) AS consumed_legs,
           SUM(se.qty_in) AS total_qty_in,
           SUM(se.qty_out) AS total_qty_out,
           COALESCE(
             MIN(CASE WHEN se.qty_in > 0 THEN se.receive_date END),
             MIN(se.receive_date)
           ) AS store_production_date
         FROM store_entries se
         WHERE se.facilityId = :facilityId
           AND se.type IN ('production', 'consumed')
           AND (
             se.reference_number IN (:batchNos)
             OR se.batch_id IN (:batchNos)
           )
         GROUP BY batch_no
         HAVING batch_no IS NOT NULL AND batch_no <> ''`,
        {
          replacements: { facilityId, batchNos },
          type: db.sequelize.QueryTypes.SELECT,
        },
      );
      storeMap = new Map(
        storeRows.map((r) => [String(r.batch_no || "").trim(), r]),
      );

      const glRows = await db.sequelize.query(
        `SELECT reference_number, COUNT(*) AS entry_count
         FROM general_ledger
         WHERE facility_id = :facilityId
           AND reference_number IN (:batchNos)
         GROUP BY reference_number`,
        {
          replacements: { facilityId, batchNos },
          type: db.sequelize.QueryTypes.SELECT,
        },
      );
      glMap = new Map(
        glRows.map((r) => [
          String(r.reference_number || ""),
          parseInt(r.entry_count, 10) || 0,
        ]),
      );
    }

    return res.json({
      success: true,
      data: costingRows.map((r) => {
        const batch = String(r.batch_id || r.batch_no || r.id || "").trim();
        const store =
          storeMap.get(batch) ||
          storeMap.get(String(r.batch_no || "").trim());
        return {
          id: r.id,
          batch_no: batch,
          production_date:
            r.production_date || store?.store_production_date || null,
          status: r.status || "draft",
          type: r.type || "production",
          run_status: r.run_status || null,
          store_count: parseInt(store?.store_count, 10) || 0,
          ledger_count:
            glMap.get(batch) ||
            glMap.get(String(r.batch_no || "").trim()) ||
            0,
          produced_legs: parseInt(store?.produced_legs, 10) || 0,
          consumed_legs: parseInt(store?.consumed_legs, 10) || 0,
          total_qty_in: parseFloat(store?.total_qty_in || 0) || 0,
          total_qty_out: parseFloat(store?.total_qty_out || 0) || 0,
          source: "production_costing_records",
        };
      }),
    });
  } catch (error) {
    console.error("listBatchesForCorrection error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to list production batches",
      error: error.message,
    });
  }
};

/**
 * Store movements + general ledger for one batch.
 */
exports.getBatchPostings = async (req, res) => {
  try {
    const { batchNo } = req.params;
    const { facilityId } = req.query;
    if (!batchNo || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "batchNo and facilityId are required",
      });
    }

    const refs = batchRefs(batchNo);
    const storeEntries = await db.sequelize.query(
      `SELECT
         se.id,
         se.receive_date,
         se.reference_number,
         se.batch_id,
         se.product_id,
         se.qty_in,
         se.qty_out,
         se.cost_price,
         se.branch_name,
         se.source,
         se.destination,
         se.type,
         p.name AS product_name
       FROM store_entries se
       LEFT JOIN products p
         ON p.sku = se.product_id AND p.facility_id = se.facilityId
       WHERE se.facilityId = :facilityId
         AND (
           se.reference_number IN (:refs)
           OR se.batch_id IN (:refs)
         )
         AND se.type IN ('production', 'consumed')
       ORDER BY se.id ASC`,
      {
        replacements: { facilityId, refs },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );

    const ledgerEntries = await db.sequelize.query(
      `SELECT
         gl.transaction_id,
         gl.transaction_date,
         gl.account_code,
         gl.account_description,
         gl.dr,
         gl.cr,
         gl.transaction_description,
         gl.transaction_ref,
         gl.reference_number,
         gl.purpose_of_payment,
         gl.type
       FROM general_ledger gl
       WHERE gl.facility_id = :facilityId
         AND (
           gl.reference_number IN (:refs)
           OR gl.purpose_of_payment LIKE :purposeLike
         )
       ORDER BY gl.transaction_id ASC`,
      {
        replacements: {
          facilityId,
          refs,
          purposeLike: `%Batch: ${refs[0]}%`,
        },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );

    let manufacturing = null;
    let costing = null;
    // Prefer Costing & Pricing record (same source as Markup), then manufacturing.
    if (db.ProductionCostingRecord) {
      costing = await db.ProductionCostingRecord.findOne({
        where: {
          facility_id: facilityId,
          [Op.or]: [{ id: refs[0] }, { batch_no: refs[0] }],
        },
        order: [["created_at", "DESC"]],
        raw: true,
      });
      if (!costing) {
        const candidates = await db.sequelize.query(
          `SELECT *
           FROM production_costing_records
           WHERE facility_id = :facilityId
             AND (
               id IN (:refs)
               OR batch_no IN (:refs)
               OR JSON_UNQUOTE(JSON_EXTRACT(data, '$.batchNo')) IN (:refs)
             )
             AND LOWER(COALESCE(status, '')) <> 'rejected'
           ORDER BY created_at DESC
           LIMIT 1`,
          {
            replacements: { facilityId, refs },
            type: db.sequelize.QueryTypes.SELECT,
          },
        );
        costing = candidates[0] || null;
      }
    }
    if (db.ProductionManufacturingRecord) {
      manufacturing = await db.ProductionManufacturingRecord.findOne({
        where: {
          facility_id: facilityId,
          [Op.or]: [{ id: refs[0] }, { batch_no: refs[0] }],
        },
        order: [["created_at", "DESC"]],
        raw: true,
      });
    }

    const items = storeEntries.map(storeItemFromRow);
    const batchPayload =
      parseJsonMaybe(costing?.data) || parseJsonMaybe(manufacturing?.data);

    const { productGroups, sharedCosts } = buildProductGroups({
      items,
      ledgerEntries,
      batchPayload,
    });

    return res.json({
      success: true,
      data: {
        batch_no: refs[0],
        // Prefer costing production_date (Costing & Pricing), then store receive_date
        production_date:
          costing?.production_date ||
          storeEntries.find((se) => parseFloat(se.qty_in || 0) > 0)
            ?.receive_date ||
          storeEntries[0]?.receive_date ||
          ledgerEntries[0]?.transaction_date ||
          manufacturing?.production_date ||
          null,
        status: costing?.status || manufacturing?.status || "draft",
        type:
          costing?.type ||
          manufacturing?.type ||
          batchPayload?.costingType ||
          null,
        costing_record_id: costing?.id || null,
        /** Full Costing & Pricing JSON — same shape as Markup `/markup/costing/:id` */
        costingData: batchPayload || null,
        qtyUse: batchPayload?.qtyUse ?? batchPayload?.sharedCostQtyUse ?? 1,
        templateByProduct: batchPayload?.templateByProduct || null,
        items,
        productGroups,
        sharedCosts,
        storeEntries,
        ledgerEntries,
      },
    });
  } catch (error) {
    console.error("getBatchPostings error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load batch postings",
      error: error.message,
    });
  }
};

/**
 * Correct production batch: if date/qty changed, delete store + ledger
 * postings for the batch and re-insert them with the corrected values.
 */
/**
 * Correct production batch: backup existing store + ledger + costing snapshot,
 * delete postings, then rebuild from corrected qty/rates (costing-shaped data).
 */
exports.correctBatch = async (req, res) => {
  const {
    facilityId,
    batchNo,
    batchId,
    productionDate,
    items: itemUpdates = [],
    productGroups: productGroupsPayload = [],
    sharedCosts: sharedCostsPayload = null,
    markupSharedCosts: markupSharedCostsPayload = null,
    qtyUse: qtyUsePayload = null,
    templateByProduct: templateByProductPayload = null,
    userId,
  } = req.body || {};

  const batch = String(batchNo || batchId || "").trim();
  if (!facilityId || !batch) {
    return res.status(400).json({
      success: false,
      message: "facilityId and batchNo are required",
    });
  }

  let nextDate = null;
  if (productionDate) {
    const parsed = moment(productionDate, "YYYY-MM-DD", true);
    if (!parsed.isValid()) {
      return res.status(400).json({
        success: false,
        message: "productionDate must be YYYY-MM-DD",
      });
    }
    nextDate = parsed.format("YYYY-MM-DD");
  }

  let transaction;
  try {
    await assertProductionCorrectionEnabled(facilityId);
    transaction = await db.sequelize.transaction();
    const refs = batchRefs(batch);
    const purposeLike = `%Batch: ${batch}%`;

    const existingStore = await db.sequelize.query(
      `SELECT *
       FROM store_entries
       WHERE facilityId = :facilityId
         AND (
           reference_number IN (:refs)
           OR batch_id IN (:refs)
         )
         AND type IN ('production', 'consumed')
       ORDER BY id ASC`,
      {
        replacements: { facilityId, refs },
        type: db.sequelize.QueryTypes.SELECT,
        transaction,
      },
    );

    const existingLedger = await db.sequelize.query(
      `SELECT *
       FROM general_ledger
       WHERE facility_id = :facilityId
         AND (
           reference_number IN (:refs)
           OR purpose_of_payment LIKE :purposeLike
         )
       ORDER BY transaction_id ASC`,
      {
        replacements: { facilityId, refs, purposeLike },
        type: db.sequelize.QueryTypes.SELECT,
        transaction,
      },
    );

    const costing = await resolveCostingRecord(facilityId, refs, transaction);
    const costingData = parseJsonMaybe(costing?.data);

    if (!existingStore.length && !existingLedger.length) {
      // Still allow date / costing JSON patch when postings are missing
      if (!nextDate && !(Array.isArray(itemUpdates) && itemUpdates.length)) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: "No store or ledger postings found for this batch",
        });
      }
    }

    const updatesById = new Map();
    const updatesBySku = new Map();
    for (const line of Array.isArray(itemUpdates) ? itemUpdates : []) {
      const id = parseInt(line.store_entry_id || line.id, 10);
      const qty = parseFloat(line.qty ?? line.quantity ?? NaN);
      const cost_price = parseFloat(line.cost_price ?? line.rate ?? NaN);
      const sku = String(line.sku || line.product_id || "").trim().toUpperCase();
      if (id) {
        updatesById.set(id, {
          qty: Number.isFinite(qty) ? qty : NaN,
          cost_price: Number.isFinite(cost_price) ? cost_price : NaN,
        });
      }
      if (sku) {
        updatesBySku.set(sku, {
          qty: Number.isFinite(qty) ? qty : NaN,
          cost_price: Number.isFinite(cost_price) ? cost_price : NaN,
        });
      }
    }

    // Enrich SKU map from existing store ids
    for (const se of existingStore) {
      const upd = updatesById.get(parseInt(se.id, 10));
      if (!upd) continue;
      const sku = String(se.product_id || "").trim().toUpperCase();
      if (sku) updatesBySku.set(sku, upd);
    }

    const oldDate =
      (existingStore[0]?.receive_date &&
        moment(existingStore[0].receive_date).format("YYYY-MM-DD")) ||
      (existingLedger[0]?.transaction_date &&
        moment(existingLedger[0].transaction_date).format("YYYY-MM-DD")) ||
      (costing?.production_date &&
        moment(costing.production_date).format("YYYY-MM-DD")) ||
      null;
    const effectiveDate = nextDate || oldDate || moment().format("YYYY-MM-DD");

    let qtyChanged = false;
    for (const se of existingStore) {
      const upd = updatesById.get(parseInt(se.id, 10));
      if (!upd) continue;
      const oldQty =
        parseFloat(se.qty_in || 0) > 0
          ? parseFloat(se.qty_in || 0)
          : parseFloat(se.qty_out || 0) || 0;
      if (Number.isFinite(upd.qty) && Math.abs(oldQty - upd.qty) > 0.0001) {
        qtyChanged = true;
      }
      if (
        Number.isFinite(upd.cost_price) &&
        Math.abs(upd.cost_price - (parseFloat(se.cost_price) || 0)) > 0.0001
      ) {
        qtyChanged = true;
      }
    }

    const dateChanged = !!nextDate && oldDate && nextDate !== oldDate;
    const hasPostings = existingStore.length > 0 || existingLedger.length > 0;

    if (!dateChanged && !qtyChanged && hasPostings) {
      await transaction.rollback();
      return res.json({
        success: true,
        message: "No changes to apply",
        data: {
          batch_no: batch,
          store_entries_updated: 0,
          ledger_entries_updated: 0,
          rebuilt: false,
          archive_id: null,
        },
      });
    }

    const archiveId = await createCorrectionArchive({
      facilityId,
      batchNo: batch,
      costingRecordId: costing?.id || null,
      reason: "correct",
      archivedBy: userId || null,
      storeEntries: existingStore,
      ledgerEntries: existingLedger,
      costingData,
      meta: {
        old_production_date: oldDate,
        new_production_date: effectiveDate,
        itemUpdates,
        productGroups: productGroupsPayload,
        sharedCosts: sharedCostsPayload,
      },
      transaction,
    });

    const business = await db.business.findOne({
      where: { id: facilityId },
      attributes: ["id", "wip"],
      raw: true,
      transaction,
    });
    const wipCode = String(business?.wip || "").trim() || "WIP";
    let wipDescription = "WIP";
    if (db.AccountCategory) {
      const wipAcc = await db.AccountCategory.findOne({
        where: { facility_id: facilityId, code: wipCode },
        attributes: ["code", "description"],
        raw: true,
        transaction,
      });
      if (wipAcc?.description) wipDescription = wipAcc.description;
    }

    let newStoreRows = [];
    let newLedgerRows = [];

    if (hasPostings) {
      newStoreRows = buildCorrectedStoreRows({
        existingStore,
        updatesById,
        effectiveDate,
        batch,
        facilityId,
        userId,
      });

      const skus = [
        ...new Set(
          newStoreRows
            .map((s) => String(s.product_id || "").trim())
            .filter(Boolean),
        ),
      ];
      const inventoryAccountBySku = new Map();
      const productNameBySku = new Map();
      if (skus.length && db.Product) {
        const products = await db.Product.findAll({
          where: {
            facility_id: facilityId,
            [Op.or]: [
              { sku: { [Op.in]: skus } },
              { item_code: { [Op.in]: skus } },
            ],
          },
          attributes: ["sku", "item_code", "name", "inventory_account", "item_type"],
          raw: true,
          transaction,
        });
        for (const p of products) {
          const keys = [p.sku, p.item_code]
            .map((v) => String(v || "").trim().toUpperCase())
            .filter(Boolean);
          for (const k of keys) {
            if (p.inventory_account) {
              inventoryAccountBySku.set(k, String(p.inventory_account).trim());
            }
            if (p.name) productNameBySku.set(k, p.name);
          }
        }
      }
      // Also from existing store join names if present in raw query without names
      for (const se of existingStore) {
        const k = String(se.product_id || "").trim().toUpperCase();
        if (k && se.product_name) productNameBySku.set(k, se.product_name);
      }

      const otherCostLines = collectOtherCostLines(
        sharedCostsPayload ||
          (Array.isArray(markupSharedCostsPayload)
            ? {
                otherCosts: markupSharedCostsPayload
                  .filter(
                    (c) =>
                      (c.type || "") !== "raw_material" &&
                      (c.type || "") !== "by_product_credit" &&
                      (c.type || "") !== "by_product",
                  )
                  .map((c) => ({
                    kind: "other_cost",
                    account_code: c.descriptionCode || c.account_code,
                    product_name: c.description,
                    amount: c.amount,
                    qty: c.quantity,
                    cost_price: c.rate || c.unit_cost,
                    other_type: c.other_type,
                  })),
              }
            : null),
        productGroupsPayload,
        itemUpdates,
      );

      const ledgerRowsDirty = buildCorrectedLedgerRows({
        existingLedger,
        newStoreRows,
        otherCostLines,
        wipCode,
        wipDescription,
        inventoryAccountBySku,
        productNameBySku,
        effectiveDate,
        batch,
        facilityId,
        userId,
      });

      // Strip internal helper fields before insert
      newStoreRows = newStoreRows.map((row) => {
        const { _was_in, _sku, _old_id, ...rest } = row;
        return rest;
      });
      newLedgerRows = ledgerRowsDirty;

      await db.StoreEntry.destroy({
        where: {
          facilityId,
          type: { [Op.in]: ["production", "consumed"] },
          [Op.or]: [
            { reference_number: { [Op.in]: refs } },
            { batch_id: { [Op.in]: refs } },
          ],
        },
        transaction,
      });

      await db.GeneralLedger.destroy({
        where: {
          facility_id: facilityId,
          [Op.or]: [
            { reference_number: { [Op.in]: refs } },
            { purpose_of_payment: { [Op.like]: purposeLike } },
          ],
        },
        transaction,
      });

      if (newStoreRows.length) {
        await db.StoreEntry.bulkCreate(newStoreRows, { transaction });
      }
      if (newLedgerRows.length) {
        await db.GeneralLedger.bulkCreate(newLedgerRows, { transaction });
      }
    }

    let costingUpdated = 0;
    if (costing?.id && db.ProductionCostingRecord) {
      let patchedData = patchCostingDataQtys(costingData, updatesBySku) || {
        ...(costingData || {}),
      };
      if (Array.isArray(markupSharedCostsPayload) && markupSharedCostsPayload.length) {
        patchedData = {
          ...patchedData,
          sharedCosts: markupSharedCostsPayload.map((c) => ({
            type: c.type,
            description: c.description,
            descriptionCode: c.descriptionCode || c.account_code,
            accountHead: c.accountHead || c.account_code || c.descriptionCode,
            rawMaterialId: c.rawMaterialId,
            rawMaterialName: c.rawMaterialName,
            rawMaterialSku: c.rawMaterialSku,
            quantity: c.quantity,
            expectedQuantity: c.expectedQuantity ?? c.quantity,
            actualQty: c.actualQty,
            actual_qty: c.actualQty,
            isActualQtyManuallySet: c.isActualQtyManuallySet,
            unit_cost: c.unit_cost,
            rate: c.rate,
            other_type: c.other_type,
            otherType: c.other_type,
            percentage_basis: c.percentage_basis,
            percentageBasis: c.percentage_basis,
            amount: c.amount,
          })),
          qtyUse: qtyUsePayload ?? patchedData.qtyUse ?? 1,
          templateByProduct:
            templateByProductPayload || patchedData.templateByProduct || null,
        };
      }
      const updateFields = {
        updated_at: new Date(),
      };
      if (nextDate) updateFields.production_date = nextDate;
      if (patchedData) updateFields.data = patchedData;
      const [count] = await db.ProductionCostingRecord.update(updateFields, {
        where: { id: costing.id, facility_id: facilityId },
        transaction,
      });
      costingUpdated = count || 0;
    } else if (nextDate && db.ProductionCostingRecord) {
      const [count] = await db.ProductionCostingRecord.update(
        { production_date: nextDate, updated_at: new Date() },
        {
          where: {
            facility_id: facilityId,
            [Op.or]: [{ id: batch }, { batch_no: batch }],
          },
          transaction,
        },
      );
      costingUpdated = count || 0;
    }

    if (nextDate && db.ProductionManufacturingRecord) {
      await db.ProductionManufacturingRecord.update(
        { production_date: nextDate, updated_at: new Date() },
        {
          where: {
            facility_id: facilityId,
            [Op.or]: [{ id: batch }, { batch_no: batch }],
          },
          transaction,
        },
      );
    }

    const updatedLedger = await db.sequelize.query(
      `SELECT
         gl.transaction_id,
         gl.transaction_date,
         gl.account_code,
         gl.account_description,
         gl.dr,
         gl.cr,
         gl.transaction_description,
         gl.transaction_ref,
         gl.reference_number
       FROM general_ledger gl
       WHERE gl.facility_id = :facilityId
         AND (
           gl.reference_number IN (:refs)
           OR gl.purpose_of_payment LIKE :purposeLike
         )
       ORDER BY gl.transaction_id ASC`,
      {
        replacements: { facilityId, refs, purposeLike },
        type: db.sequelize.QueryTypes.SELECT,
        transaction,
      },
    );

    await transaction.commit();
    return res.json({
      success: true,
      message: archiveId
        ? "Backup saved · store/ledger rebuilt from corrected costing data"
        : "Production batch corrected (postings rebuilt)",
      data: {
        batch_no: batch,
        production_date: effectiveDate,
        rebuilt: hasPostings,
        archive_id: archiveId,
        store_entries_updated: newStoreRows.length,
        ledger_entries_updated: newLedgerRows.length,
        costing_updated: costingUpdated,
        ledgerEntries: updatedLedger,
      },
    });
  } catch (err) {
    console.error("correctBatch error:", err);
    if (transaction) await transaction.rollback().catch(() => {});
    const status = err.status || 500;
    return res.status(status).json({
      success: false,
      message: err.message || "Failed to correct production batch",
    });
  }
};

/**
 * Delete store + ledger postings for a production batch (archive first).
 */
exports.deleteBatchWithPostings = async (req, res) => {
  const { facilityId, batchNo, batchId, userId } = req.body || {};
  const batch = String(batchNo || batchId || "").trim();
  if (!facilityId || !batch) {
    return res.status(400).json({
      success: false,
      message: "facilityId and batchNo are required",
    });
  }

  let transaction;
  try {
    await assertProductionCorrectionEnabled(facilityId);
    transaction = await db.sequelize.transaction();
    const refs = batchRefs(batch);
    const purposeLike = `%Batch: ${batch}%`;

    const existingStore = await db.sequelize.query(
      `SELECT *
       FROM store_entries
       WHERE facilityId = :facilityId
         AND (
           reference_number IN (:refs)
           OR batch_id IN (:refs)
         )
         AND type IN ('production', 'consumed')
       ORDER BY id ASC`,
      {
        replacements: { facilityId, refs },
        type: db.sequelize.QueryTypes.SELECT,
        transaction,
      },
    );

    const existingLedger = await db.sequelize.query(
      `SELECT *
       FROM general_ledger
       WHERE facility_id = :facilityId
         AND (
           reference_number IN (:refs)
           OR purpose_of_payment LIKE :purposeLike
         )
       ORDER BY transaction_id ASC`,
      {
        replacements: { facilityId, refs, purposeLike },
        type: db.sequelize.QueryTypes.SELECT,
        transaction,
      },
    );

    const costing = await resolveCostingRecord(facilityId, refs, transaction);
    const costingData = parseJsonMaybe(costing?.data);

    const archiveId = await createCorrectionArchive({
      facilityId,
      batchNo: batch,
      costingRecordId: costing?.id || null,
      reason: "delete",
      archivedBy: userId || null,
      storeEntries: existingStore,
      ledgerEntries: existingLedger,
      costingData,
      meta: {
        delete_postings: true,
        delete_costing_record: true,
      },
      transaction,
    });

    const deletedStore = await db.StoreEntry.destroy({
      where: {
        facilityId,
        type: { [Op.in]: ["production", "consumed"] },
        [Op.or]: [
          { reference_number: { [Op.in]: refs } },
          { batch_id: { [Op.in]: refs } },
        ],
      },
      transaction,
    });

    const deletedLedger = await db.GeneralLedger.destroy({
      where: {
        facility_id: facilityId,
        [Op.or]: [
          { reference_number: { [Op.in]: refs } },
          { purpose_of_payment: { [Op.like]: purposeLike } },
        ],
      },
      transaction,
    });

    let deletedMfg = 0;
    let deletedCosting = 0;
    if (db.ProductionManufacturingRecord) {
      deletedMfg = await db.ProductionManufacturingRecord.destroy({
        where: {
          facility_id: facilityId,
          [Op.or]: [{ id: batch }, { batch_no: batch }],
        },
        transaction,
      });
    }
    if (db.ProductionCostingRecord) {
      deletedCosting = await db.ProductionCostingRecord.destroy({
        where: {
          facility_id: facilityId,
          [Op.or]: [{ id: batch }, { batch_no: batch }],
        },
        transaction,
      });
    }

    await transaction.commit();
    return res.json({
      success: true,
      message: archiveId
        ? "Backup saved · production batch postings deleted"
        : "Production batch postings deleted",
      data: {
        batch_no: batch,
        archive_id: archiveId,
        store_deleted: deletedStore,
        ledger_deleted: deletedLedger,
        manufacturing_deleted: deletedMfg,
        costing_deleted: deletedCosting,
      },
    });
  } catch (err) {
    console.error("deleteBatchWithPostings error:", err);
    if (transaction) await transaction.rollback().catch(() => {});
    const status = err.status || 500;
    return res.status(status).json({
      success: false,
      message: err.message || "Failed to delete production batch",
    });
  }
};

exports.parseEnableFlag = parseEnableFlag;
