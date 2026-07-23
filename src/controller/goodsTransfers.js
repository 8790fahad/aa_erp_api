"use strict";

const { v4: uuidv4 } = require("uuid");
const moment = require("moment");
const db = require("../models");
const inventoryCtrl = require("./inventory");
const { STORE_ENTRY_TYPE } = require("../constants/storeEntryTypes");

/**
 * Goods Transfer flow:
 *   POST /api/v1/goods-transfers              → create pending request
 *   GET  /api/v1/goods-transfers              → list (status filter optional)
 *   GET  /api/v1/goods-transfers/:id          → header + items
 *   POST /api/v1/goods-transfers/:id/approve  → validate stock, move it,
 *                                               mark approved
 *   POST /api/v1/goods-transfers/:id/reject   → mark rejected (no stock move)
 *
 * Inventory model
 *   The transfer takes sellable items (Finished Good / Resalable / By-Product)
 *   from the source branch and drops them into the destination branch.
 *   At approval we write two store_entries per line:
 *     - qty_out @ source_branch_id     (branch_name='for sales')
 *     - qty_in  @ destination_branch_id (branch_name='for sales')
 *   The pending state never touches store_entries.
 */

const ZONE = "for sales";
const SELLABLE_ZONES = ["for sales", "for sale"];
/** Normalize mixed latin1 / utf8mb4 columns before comparing. */
const skuEq = (a, b) =>
  `CONVERT(${a} USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(${b} USING utf8mb4) COLLATE utf8mb4_general_ci`;

const userDisplayName = (user) => {
  if (!user) return "User";
  const fullname = user.fullname || `${user.firstname || ""} ${user.lastname || ""}`.trim();
  const display = fullname || user.username || user.email || "User";
  return user.role ? `${display} (${user.role})` : display;
};

// Compute available qty at branch X for an SKU (sellable zone: for sales).
// By-Product rows often have branchId 0 when posted from production — include
// those at the source branch so approvers see the real transferable balance.
async function getAvailableQty({ sku, facilityId, branchId, transaction }) {
  const parsedBranchId = parseInt(branchId, 10);
  const branchFilter =
    Number.isInteger(parsedBranchId) && parsedBranchId > 0
      ? `AND (
           se.branchId = :branchId
           OR (
             EXISTS (
               SELECT 1 FROM products p
                WHERE ${skuEq("p.sku", "se.product_id")}
                  AND ${skuEq("p.facility_id", "se.facilityId")}
                  AND p.item_type = 'By-Product'
             )
             AND (se.branchId = 0 OR se.branchId IS NULL)
           )
         )`
      : "";

  const zoneList = SELLABLE_ZONES.map((z) => `'${z}'`).join(", ");
  const rows = await db.sequelize.query(
    `SELECT IFNULL(SUM(se.qty_in) - SUM(se.qty_out), 0) AS balance
       FROM store_entries se
      WHERE se.product_id = :sku
        AND se.facilityId = :facilityId
        AND LOWER(TRIM(se.branch_name)) IN (${zoneList})
        ${branchFilter}`,
    {
      replacements: {
        sku,
        facilityId,
        ...(Number.isInteger(parsedBranchId) && parsedBranchId > 0
          ? { branchId: parsedBranchId }
          : {}),
      },
      type: db.sequelize.QueryTypes.SELECT,
      transaction,
    }
  );
  return parseFloat(rows?.[0]?.balance || 0);
}

function valuationMethodKey(invEvM) {
  const method = invEvM || "Weighted Average Cost";
  return method === "Weighted Average Cost" ? "WAC" : method;
}

/** Unit cost from perpetual inventory valuation (WAC / FIFO / LIFO). */
async function resolveUnitCostForTransfer({ sku, facilityId, methodKey }) {
  const { calculatedCostPrice } = await inventoryCtrl.getCurrentUnitCost(
    sku,
    facilityId,
    methodKey,
  );
  return parseFloat(calculatedCostPrice) || 0;
}

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------
exports.createGoodsTransfer = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const {
      facilityId,
      transfer_no,
      transfer_date,
      source_branch_id,
      destination_branch_id,
      notes,
      items,
    } = req.body;

    if (!facilityId) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "facilityId is required" });
    }
    if (!source_branch_id || !destination_branch_id) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "source_branch_id and destination_branch_id are required",
      });
    }
    if (parseInt(source_branch_id, 10) === parseInt(destination_branch_id, 10)) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Source and destination branch cannot be the same",
      });
    }
    if (!Array.isArray(items) || items.length === 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "At least one item is required" });
    }

    // Validate both branches actually belong to the facility.
    const branchRows = await db.Branch.findAll({
      where: {
        id: [parseInt(source_branch_id, 10), parseInt(destination_branch_id, 10)],
        facilityId,
      },
      transaction: t,
    });
    if (branchRows.length < 2) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Source or destination branch does not belong to this facility",
      });
    }

    // Validate every line: needs product_id + positive quantity. Stock is NOT
    // reserved here — only checked at approval time so concurrent transfers
    // can be queued.
    for (const it of items) {
      if (!it.product_id) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: "Each item must have a product_id",
        });
      }
      const qty = parseFloat(it.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: `Invalid quantity for ${it.item_name || it.product_id}`,
        });
      }
    }

    const id = uuidv4();
    const transferNo =
      transfer_no ||
      `TRF-${moment().format("YYYY")}-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
    const date = transfer_date
      ? moment(transfer_date).format("YYYY-MM-DD")
      : moment().format("YYYY-MM-DD");

    const initiatedBy = req.user?.id || req.body.initiated_by || null;
    const initiatedByName =
      req.body.initiated_by_name || userDisplayName(req.user) || null;

    await db.GoodsTransfer.create(
      {
        id,
        transfer_no: transferNo,
        facility_id: facilityId,
        source_branch_id: parseInt(source_branch_id, 10),
        destination_branch_id: parseInt(destination_branch_id, 10),
        transfer_date: date,
        status: "pending",
        notes: notes || null,
        initiated_by: initiatedBy,
        initiated_by_name: initiatedByName,
      },
      { transaction: t }
    );

    // Persist all line items
    const itemRows = items.map((it) => ({
      transfer_id: id,
      product_id: String(it.product_id),
      item_name: it.item_name || null,
      quantity: parseFloat(it.quantity),
      unit_of_measure: it.unit_of_measure || it.uom || "Pcs",
      cost_price: it.cost_price != null ? parseFloat(it.cost_price) : it.cost != null ? parseFloat(it.cost) : null,
      selling_price: it.selling_price != null ? parseFloat(it.selling_price) : it.price != null ? parseFloat(it.price) : null,
      mark_up: it.mark_up != null ? parseFloat(it.mark_up) : it.markup != null ? parseFloat(it.markup) : null,
      expiry_date:
        it.expiry_date && it.expiry_date !== "0000-00-00" && it.expiry_date !== "1111-11-11"
          ? moment(it.expiry_date).format("YYYY-MM-DD")
          : null,
      supplier_code: it.supplier_code || null,
      supplier_name: it.supplier_name || it.supplierName || null,
      from_qty_snapshot:
        it.from_qty_snapshot != null
          ? parseFloat(it.from_qty_snapshot)
          : it.from_qty != null
            ? parseFloat(it.from_qty)
            : null,
    }));

    await db.GoodsTransferItem.bulkCreate(itemRows, { transaction: t });

    await t.commit();

    return res.status(201).json({
      success: true,
      message: "Goods transfer request submitted",
      data: { id, transfer_no: transferNo },
    });
  } catch (error) {
    await t.rollback();
    console.error("createGoodsTransfer error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create goods transfer",
      error: error.message,
    });
  }
};

// ---------------------------------------------------------------------------
// LIST
// ---------------------------------------------------------------------------
exports.listGoodsTransfers = async (req, res) => {
  try {
    const { facilityId, status, branchId, branchIds, from, to } = req.query;
    if (!facilityId) {
      return res.status(400).json({ success: false, message: "facilityId is required" });
    }

    const replacements = { facilityId };

    // Optional date range filter (inclusive) on the transfer date.
    let dateFilter = "";
    if (from) {
      dateFilter += " AND DATE(gt.transfer_date) >= :from";
      replacements.from = from;
    }
    if (to) {
      dateFilter += " AND DATE(gt.transfer_date) <= :to";
      replacements.to = to;
    }
    let statusFilter = "";
    if (status && status !== "all") {
      // Comma-separated statuses ("pending,approved") allowed
      const statuses = String(status)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (statuses.length === 1) {
        statusFilter = "AND gt.status = :status";
        replacements.status = statuses[0];
      } else if (statuses.length > 1) {
        statusFilter = `AND gt.status IN (${statuses
          .map((_, i) => `:status_${i}`)
          .join(",")})`;
        statuses.forEach((s, i) => {
          replacements[`status_${i}`] = s;
        });
      }
    }

    let branchFilter = "";
    // Multiple branches (user's assigned branch access) — show transfers where
    // either the source or destination is one of the user's branches.
    const parsedBranchIds = String(branchIds || "")
      .split(",")
      .map((b) => parseInt(b, 10))
      .filter((b) => Number.isInteger(b));
    if (parsedBranchIds.length > 0) {
      const placeholders = parsedBranchIds.map((_, i) => `:branch_${i}`).join(",");
      branchFilter = `AND (gt.source_branch_id IN (${placeholders}) OR gt.destination_branch_id IN (${placeholders}))`;
      parsedBranchIds.forEach((b, i) => {
        replacements[`branch_${i}`] = b;
      });
    } else if (branchId && !Number.isNaN(parseInt(branchId, 10))) {
      branchFilter =
        "AND (gt.source_branch_id = :branchId OR gt.destination_branch_id = :branchId)";
      replacements.branchId = parseInt(branchId, 10);
    }

    // Optional explicit From / To location filters (AND with access filter).
    const sourceBranchId = parseInt(req.query.sourceBranchId, 10);
    const destinationBranchId = parseInt(req.query.destinationBranchId, 10);
    if (Number.isInteger(sourceBranchId)) {
      branchFilter += " AND gt.source_branch_id = :sourceBranchId";
      replacements.sourceBranchId = sourceBranchId;
    }
    if (Number.isInteger(destinationBranchId)) {
      branchFilter += " AND gt.destination_branch_id = :destinationBranchId";
      replacements.destinationBranchId = destinationBranchId;
    }

    const transfers = await db.sequelize.query(
      `SELECT
          gt.*,
          src.branch_name AS source_branch_name,
          dst.branch_name AS destination_branch_name
         FROM goods_transfers gt
         LEFT JOIN branches src ON src.id = gt.source_branch_id
         LEFT JOIN branches dst ON dst.id = gt.destination_branch_id
        WHERE gt.facility_id = :facilityId
          ${statusFilter}
          ${branchFilter}
          ${dateFilter}
        ORDER BY gt.created_at DESC`,
      { replacements, type: db.sequelize.QueryTypes.SELECT }
    );

    if (transfers.length === 0) {
      return res.status(200).json({ success: true, results: [], count: 0 });
    }

    const ids = transfers.map((t) => t.id);
    const items = await db.sequelize.query(
      `SELECT gti.*, p.name AS product_name, p.unit_of_measure AS product_uom
         FROM goods_transfer_items gti
         INNER JOIN goods_transfers gt ON gt.id = gti.transfer_id
         LEFT JOIN products p
           ON ${skuEq("p.sku", "gti.product_id")}
          AND ${skuEq("p.facility_id", "gt.facility_id")}
        WHERE gti.transfer_id IN (:ids)
          AND gt.facility_id = :facilityId`,
      {
        replacements: { ids, facilityId },
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    const grouped = items.reduce((acc, row) => {
      (acc[row.transfer_id] = acc[row.transfer_id] || []).push(row);
      return acc;
    }, {});

    const results = transfers.map((t) => ({ ...t, items: grouped[t.id] || [] }));

    // Attach live available stock (at the source branch) for pending transfers.
    // Unit cost is resolved only on approve (see approveGoodsTransfer).
    await Promise.all(
      results
        .filter((t) => t.status === "pending")
        .map(async (t) => {
          await Promise.all(
            (t.items || []).map(async (it) => {
              it.available_qty = await getAvailableQty({
                sku: it.product_id,
                facilityId,
                branchId: t.source_branch_id,
              });
            })
          );
        })
    );

    return res.status(200).json({
      success: true,
      results,
      count: results.length,
    });
  } catch (error) {
    console.error("listGoodsTransfers error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to list goods transfers",
      error: error.message,
    });
  }
};

// ---------------------------------------------------------------------------
// GET ONE
// ---------------------------------------------------------------------------
exports.getGoodsTransferById = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId } = req.query;
    if (!id || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "id and facilityId are required",
      });
    }

    const [header] = await db.sequelize.query(
      `SELECT
          gt.*,
          src.branch_name AS source_branch_name,
          dst.branch_name AS destination_branch_name
         FROM goods_transfers gt
         LEFT JOIN branches src ON src.id = gt.source_branch_id
         LEFT JOIN branches dst ON dst.id = gt.destination_branch_id
        WHERE gt.id = :id AND gt.facility_id = :facilityId`,
      {
        replacements: { id, facilityId },
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    if (!header) {
      return res.status(404).json({ success: false, message: "Transfer not found" });
    }

    const items = await db.sequelize.query(
      `SELECT gti.*, p.name AS product_name, p.unit_of_measure AS product_uom
         FROM goods_transfer_items gti
         INNER JOIN goods_transfers gt
           ON gt.id = gti.transfer_id
          AND gt.facility_id = :facilityId
         LEFT JOIN products p
           ON ${skuEq("p.sku", "gti.product_id")}
          AND ${skuEq("p.facility_id", "gt.facility_id")}
        WHERE gti.transfer_id = :id`,
      {
        replacements: { id, facilityId },
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    return res.status(200).json({
      success: true,
      data: { ...header, items },
    });
  } catch (error) {
    console.error("getGoodsTransferById error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch transfer",
      error: error.message,
    });
  }
};

// ---------------------------------------------------------------------------
// APPROVE
// ---------------------------------------------------------------------------
exports.approveGoodsTransfer = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const { id } = req.params;
    const {
      facilityId,
      approvedBy,
      approvedByName,
      approval_date,
      items: approvedItemsInput,
    } = req.body;

    // Map of GoodsTransferItem id -> approved quantity (optional override).
    const approvedQtyById = {};
    if (Array.isArray(approvedItemsInput)) {
      approvedItemsInput.forEach((row) => {
        if (row && row.id != null) {
          const q = parseFloat(row.quantity);
          if (!Number.isNaN(q)) approvedQtyById[String(row.id)] = q;
        }
      });
    }

    if (!id || !facilityId) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "id and facilityId are required",
      });
    }

    const transfer = await db.GoodsTransfer.findOne({
      where: { id, facility_id: facilityId },
      transaction: t,
    });

    if (!transfer) {
      await t.rollback();
      return res.status(404).json({ success: false, message: "Transfer not found" });
    }

    if (transfer.status !== "pending") {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `Cannot approve a transfer in status '${transfer.status}'`,
      });
    }

    const items = await db.GoodsTransferItem.findAll({
      where: { transfer_id: id },
      transaction: t,
    });

    if (items.length === 0) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Transfer has no items",
      });
    }

    // Resolve the approved quantity per line (defaults to the requested qty,
    // never exceeds what was requested).
    const effectiveQtyByLineId = {};
    for (const line of items) {
      const requested = parseFloat(line.quantity) || 0;
      let approved =
        approvedQtyById[String(line.id)] !== undefined
          ? approvedQtyById[String(line.id)]
          : requested;
      if (Number.isNaN(approved) || approved < 0) approved = 0;
      if (approved > requested) approved = requested;
      effectiveQtyByLineId[String(line.id)] = approved;
    }

    // At least one line must have an approved quantity > 0.
    const totalApproved = Object.values(effectiveQtyByLineId).reduce(
      (s, q) => s + q,
      0
    );
    if (totalApproved <= 0) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Approved quantity must be greater than 0 for at least one item",
      });
    }

    // Stock validation pass — fail fast if any single line is short.
    for (const line of items) {
      const need = effectiveQtyByLineId[String(line.id)];
      if (need <= 0) continue;
      const available = await getAvailableQty({
        sku: line.product_id,
        facilityId,
        branchId: transfer.source_branch_id,
        transaction: t,
      });
      if (available + 1e-6 < need) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${line.item_name || line.product_id} at source branch (available ${available}, approved ${need})`,
        });
      }
    }

    const approvalDate = approval_date
      ? moment(approval_date).format("YYYY-MM-DD")
      : moment().format("YYYY-MM-DD");
    const approvedAt = moment().format("YYYY-MM-DD HH:mm:ss");
    const approver = approvedBy || req.user?.id || null;
    const approverName = approvedByName || userDisplayName(req.user) || null;
    const referenceNo = `GT-${transfer.transfer_no}`;

    const business = await db.business.findOne({
      where: { id: facilityId },
      attributes: ["inv_ev_m"],
      raw: true,
      transaction: t,
    });
    const methodKey = valuationMethodKey(business?.inv_ev_m);

    // Move stock per item: qty_out @ source, qty_in @ destination.
    for (const line of items) {
      const sku = line.product_id;
      const qty = effectiveQtyByLineId[String(line.id)];
      if (qty <= 0) continue;

      const product = await db.Product.findOne({
        where: { sku, facility_id: facilityId },
        attributes: ["selling_price", "cost_price"],
        transaction: t,
      });

      const cost = await resolveUnitCostForTransfer({
        sku,
        facilityId,
        methodKey,
      });
      if (cost <= 0) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: `Could not determine inventory valuation cost for ${line.item_name || sku}. Ensure stock has been received with a cost price.`,
        });
      }

      const sell =
        line.selling_price != null && parseFloat(line.selling_price) > 0
          ? parseFloat(line.selling_price)
          : parseFloat(product?.selling_price) || cost;

      // Persist approved qty and valuation-derived cost on the line.
      line.quantity = qty;
      line.cost_price = cost;
      if (!line.selling_price || parseFloat(line.selling_price) <= 0) {
        line.selling_price = sell;
      }
      await line.save({ transaction: t });

      await db.StoreEntry.create(
        {
          receive_date: approvalDate,
          reference_number: referenceNo,
          product_id: sku,
          qty_in: 0,
          qty_out: qty,
          cost_price: cost,
          selling_price: sell,
          branch_name: ZONE,
          branchId: transfer.source_branch_id,
          source: "Branch Transfer",
          destination: "Branch Transfer",
          inserted_by: approver || "system",
          facilityId,
          status: "approved",
          type: STORE_ENTRY_TYPE.TRANSFER,
          supplier_code: line.supplier_code || sku,
        },
        { transaction: t }
      );

      await db.StoreEntry.create(
        {
          receive_date: approvalDate,
          reference_number: referenceNo,
          product_id: sku,
          qty_in: qty,
          qty_out: 0,
          cost_price: cost,
          selling_price: sell,
          branch_name: ZONE,
          branchId: transfer.destination_branch_id,
          source: "Branch Transfer",
          destination: "Branch Transfer",
          inserted_by: approver || "system",
          facilityId,
          status: "approved",
          type: STORE_ENTRY_TYPE.TRANSFER,
          supplier_code: line.supplier_code || sku,
        },
        { transaction: t }
      );
    }

    transfer.status = "approved";
    transfer.approved_by = approver;
    transfer.approved_by_name = approverName;
    transfer.approved_at = approvedAt;
    await transfer.save({ transaction: t });

    await t.commit();

    return res.status(200).json({
      success: true,
      message: "Goods transfer approved and stock moved",
      data: {
        id: transfer.id,
        transfer_no: transfer.transfer_no,
        status: transfer.status,
        approved_at: transfer.approved_at,
      },
    });
  } catch (error) {
    await t.rollback();
    console.error("approveGoodsTransfer error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to approve goods transfer",
      error: error.message,
    });
  }
};

// ---------------------------------------------------------------------------
// REJECT / CANCEL
// ---------------------------------------------------------------------------
exports.rejectGoodsTransfer = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId, rejectedBy, rejection_reason } = req.body;

    if (!id || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "id and facilityId are required",
      });
    }

    const transfer = await db.GoodsTransfer.findOne({
      where: { id, facility_id: facilityId },
    });
    if (!transfer) {
      return res.status(404).json({ success: false, message: "Transfer not found" });
    }
    if (transfer.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `Cannot reject a transfer in status '${transfer.status}'`,
      });
    }

    transfer.status = "rejected";
    transfer.rejected_by = rejectedBy || req.user?.id || null;
    transfer.rejected_at = moment().format("YYYY-MM-DD HH:mm:ss");
    transfer.rejection_reason = rejection_reason || null;
    await transfer.save();

    return res.status(200).json({
      success: true,
      message: "Goods transfer rejected",
      data: { id: transfer.id, status: transfer.status },
    });
  } catch (error) {
    console.error("rejectGoodsTransfer error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to reject goods transfer",
      error: error.message,
    });
  }
};
