import { getCurrentUnitCost } from "./inventory";
import { calculateValuation } from "./transactions";

const db = require("../models");
const moment = require("moment");
const { v4: uuidv4 } = require("uuid");
const { Product, StoreEntry, GeneralLedger, Account } = db;
const { getAndUpdateNumber } = require("../services/numberGen");
const { STORE_ENTRY_TYPE } = require("../constants/storeEntryTypes");
// Create Material Requisition
exports.createMaterialRequisition = async (req, res) => {
  try {
    const {
      facilityId,
      productName,
      productCode,
      quantityRequired,
      priority,
      notes,
      materials,
      createdBy,
      requesting_branch_id,
    } = req.body;

    if (
      !facilityId ||
      !materials ||
      !Array.isArray(materials) ||
      materials.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: facilityId, materials",
      });
    }

    // Raw material / semi-finished requisitions are facility-wide (no branch).
    const requestingBranchId = null;

    const transaction = await db.sequelize.transaction();
    const requisitionId = await getAndUpdateNumber("MR", facilityId);
    const requisitionNumber = `MR-${requisitionId}`;
    try {
      // Calculate total cost
      let totalCost = 0;
      const requisitionItems = materials.map((item, index) => {
        const itemTotal = item.quantity_requested * item.unit_cost;
        totalCost += itemTotal;
        return {
          requisition_id: requisitionNumber,
          product_id: item.product_id || item.id,
          product_name: item.item_name || item.product_name,
          product_code: item.item_code || item.product_code,
          category: item.category,
          unit_of_measure: item.unit_of_measure,
          quantity_requested: item.quantity_requested,
          unit_cost: item.unit_cost || item.cost_price || 0,
          total_cost: itemTotal,
          facilityId: facilityId,
          notes: item.notes || null,
          created_at: moment().format("YYYY-MM-DD HH:mm:ss"),
        };
      });

      // Create Material Requisition (source branch is decided at approval time)
      await db.sequelize.query(
        `INSERT INTO material_requisitions ( id, facility_id, product_name, product_code, quantity_required, status,
        priority, notes, created_by, requesting_branch_id, created_at)
         VALUES (:id, :facility_id, :product_name, :product_code, :quantity_required, :status, :priority,
         :notes, :created_by, :requesting_branch_id, :created_at)`,
        {
          replacements: {
            id: requisitionNumber,
            facility_id: facilityId,
            product_name: productName || null,
            product_code: productCode || null,
            quantity_required: quantityRequired || 0,
            status: "pending",
            priority: priority || "medium",
            notes: notes || null,
            requesting_branch_id: requestingBranchId,
            created_by: createdBy,
            created_at: moment().format("YYYY-MM-DD HH:mm:ss"),
          },
          type: db.sequelize.QueryTypes.INSERT,
          transaction,
        }
      );

      // Create Material Requisition Items
      for (const item of requisitionItems) {
        await db.sequelize.query(
          `INSERT INTO material_requisition_items (facilityId, requisition_id, product_id, product_name, product_code, category, unit_of_measure, quantity_requested, unit_cost, total_cost, notes, created_at)
           VALUES (:facilityId,  :requisition_id, :product_id, :product_name, :product_code, :category, :unit_of_measure, :quantity_requested, :unit_cost, :total_cost, :notes, :created_at)`,
          {
            replacements: item,
            type: db.sequelize.QueryTypes.INSERT,
            transaction,
          }
        );
      }

      await transaction.commit();

      res.status(201).json({
        success: true,
        data: {
          requisitionId: requisitionNumber,
          requisitionNumber,
          productName,
          totalCost,
          message: "Material Requisition created successfully",
        },
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error("Error creating Material Requisition:", error);
    res.status(500).json({
      success: false,
      message: "Error creating Material Requisition",
      error: error.message,
    });
  }
};

// Get Material Requisitions
exports.getMaterialRequisitions = async (req, res) => {
  try {
    const { facilityId, status, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    let whereClause = "WHERE mr.facility_id = :facilityId";
    const replacements = {
      facilityId,
      limit: parseInt(limit),
      offset: parseInt(offset),
    };

    if (status) {
      whereClause += " AND mr.status = :status";
      replacements.status = status;
    }

    const query = `
      SELECT
        mr.id,
        mr.facility_id,
        mr.product_name,
        mr.product_code,
        mr.quantity_required,
        mr.status,
        mr.priority,
        mr.notes,
        mr.approved_by,
        mr.approved_at,
        mr.created_by,
        mr.created_at,
        mr.updated_at,
        CONCAT(u.firstname, ' ', u.lastname) as creator_name
      FROM material_requisitions mr
      LEFT JOIN users u ON mr.created_by = u.id AND u.facilityId = mr.facility_id
      ${whereClause}
      GROUP BY
        mr.id, mr.facility_id, mr.product_name, mr.product_code,
        mr.quantity_required, mr.status, mr.priority, mr.notes,
        mr.approved_by, mr.approved_at, mr.created_by, mr.created_at,
        mr.updated_at, u.firstname, u.lastname
      ORDER BY mr.created_at DESC
      LIMIT :limit OFFSET :offset
    `;
    const requisitions = await db.sequelize.query(query, {
      replacements,
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Get total count
    const countQuery = `SELECT COUNT(DISTINCT mr.id) as total FROM material_requisitions mr ${whereClause}`;
    const countResult = await db.sequelize.query(countQuery, {
      replacements: { facilityId, ...(status && { status }) },
      type: db.sequelize.QueryTypes.SELECT,
    });

    res.status(200).json({
      success: true,
      data: {
        requisitions,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(countResult[0].total / limit),
          totalItems: countResult[0].total,
          itemsPerPage: parseInt(limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching material requisitions:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching material requisitions",
      error: error.message,
    });
  }
};

// Get Material Requisition by ID with Items
exports.getMaterialRequisitionById = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId } = req.query;

    if (!id || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "id and facilityId are required",
      });
    }

    const requisitionQuery = `
      SELECT
        mr.*,
        CONCAT(u.firstname, ' ', u.lastname) as creator_name,
        CONCAT(approver.firstname, ' ', approver.lastname) as approver_name
      FROM material_requisitions mr
      LEFT JOIN users u ON mr.created_by = u.id
      LEFT JOIN users approver ON mr.approved_by = approver.id
      WHERE mr.id = :id AND mr.facility_id = :facilityId
    `;

    const requisitionResult = await db.sequelize.query(requisitionQuery, {
      replacements: { id, facilityId },
      type: db.sequelize.QueryTypes.SELECT,
    });

    if (requisitionResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Material requisition not found",
      });
    }

    const requisition = requisitionResult[0];

    // Get requisition items. quantity_balance is facility-wide raw material stock.
    const itemsQuery = `
      SELECT
        mri.id,
        mri.requisition_id,
        mri.product_id,
        mri.product_name,
        mri.product_code,
        mri.category,
        mri.unit_of_measure,
        mri.quantity_requested,
        mri.quantity_approved,
        mri.quantity_issued,
        mri.unit_cost,
        mri.total_cost,
        IFNULL((
            SELECT SUM(se.qty_in) - SUM(se.qty_out)
            FROM store_entries se
            WHERE se.product_id = mri.product_code
              AND se.facilityId = :facilityId
              AND LOWER(TRIM(se.branch_name)) = 'raw material'
        ), 0) AS quantity_balance,
        mri.notes,
        mri.created_at,
        mri.updated_at,
        mri.sku,
        mri.facilityId
      FROM material_requisition_items mri
      WHERE mri.requisition_id = :id
        AND mri.facilityId = :facilityId
      ORDER BY mri.created_at ASC;
    `;

    const items = await db.sequelize.query(itemsQuery, {
      replacements: { id, facilityId },
      type: db.sequelize.QueryTypes.SELECT,
    });

    res.status(200).json({
      success: true,
      data: {
        requisition,
        items,
      },
    });
  } catch (error) {
    console.error("Error fetching material requisition:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching material requisition",
      error: error.message,
    });
  }
};
const getProductBalance = async (productId, facilityId) => {
  const product = await db.sequelize.query(
    `SELECT
      SUM(se.qty_in) - SUM(se.qty_out)
    FROM store_entries se
    WHERE se.product_id = :productId AND se.facilityId = :facilityId AND se.destination = 'Main Warehouse'
    `
  );
  return product.quantity_balance;
};
// Update Material Requisition
exports.updateMaterialRequisition = async (req, res) => {
  try {
    const {
      id,
      facilityId,
      productName,
      productCode,
      quantityRequired,
      priority,
      status,
      notes,
      materials,
    } = req.body;

    if (!id || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: id, facilityId",
      });
    }

    const transaction = await db.sequelize.transaction();

    try {
      // Update Material Requisition
      const updateData = {
        updated_at: moment().format("YYYY-MM-DD HH:mm:ss"),
      };

      const updateFields = [];
      const replacements = { id, facilityId };

      if (productName) {
        updateFields.push("product_name = :product_name");
        replacements.product_name = productName;
      }

      if (productCode) {
        updateFields.push("product_code = :product_code");
        replacements.product_code = productCode;
      }

      if (quantityRequired !== undefined) {
        updateFields.push("quantity_required = :quantity_required");
        replacements.quantity_required = quantityRequired;
      }

      if (priority) {
        updateFields.push("priority = :priority");
        replacements.priority = priority;
      }

      if (status) {
        updateFields.push("status = :status");
        replacements.status = status;
      }

      if (notes !== undefined) {
        updateFields.push("notes = :notes");
        replacements.notes = notes;
      }

      if (updateFields.length > 0) {
        updateFields.push("updated_at = :updated_at");

        await db.sequelize.query(
          `UPDATE material_requisitions SET ${updateFields.join(
            ", "
          )} WHERE id = :id AND facility_id = :facilityId`,
          {
            replacements,
            type: db.sequelize.QueryTypes.UPDATE,
            transaction,
          }
        );
      }

      // If materials are provided, update items
      if (materials && Array.isArray(materials)) {
        // First, delete existing items
        await db.sequelize.query(
          `DELETE FROM material_requisition_items WHERE requisition_id = :id`,
          {
            replacements: { id },
            type: db.sequelize.QueryTypes.DELETE,
            transaction,
          }
        );

        // Then insert new items
        for (const item of materials) {
          const itemData = {
            id: uuidv4(),
            requisition_id: id,
            product_id: item.product_id || item.id,
            product_name: item.item_name || item.product_name,
            product_code: item.item_code || item.product_code,
            category: item.category,
            unit_of_measure: item.unit_of_measure,
            quantity_requested: item.quantity_requested,
            unit_cost: item.unit_cost || item.cost_price || 0,
            total_cost:
              item.quantity_requested *
              (item.unit_cost || item.cost_price || 0),
            notes: item.notes || null,
            created_at: moment().format("YYYY-MM-DD HH:mm:ss"),
          };

          await db.sequelize.query(
            `INSERT INTO material_requisition_items (id, requisition_id, product_id, product_name, product_code, category, unit_of_measure, quantity_requested, unit_cost, total_cost, notes, created_at)
             VALUES (:id, :requisition_id, :product_id, :product_name, :product_code, :category, :unit_of_measure, :quantity_requested, :unit_cost, :total_cost, :notes, :created_at)`,
            {
              replacements: itemData,
              type: db.sequelize.QueryTypes.INSERT,
              transaction,
            }
          );
        }
      }

      await transaction.commit();

      res.status(200).json({
        success: true,
        data: {
          id,
          message: "Material Requisition updated successfully",
        },
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error("Error updating material requisition:", error);
    res.status(500).json({
      success: false,
      message: "Error updating material requisition",
      error: error.message,
    });
  }
};

export const approveMaterialRequisition = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  console.log(req.body, "=======================>req.body");
  try {
    const {
      id,               // Requisition ID
      facilityId,
      approvedBy,
      wip,              // WIP account code (e.g., "WIP-001")
      approval_date,    // Approval date for transaction_date in GeneralLedger
      items,            // Array of { id: item_id, product_id: sku, quantity_approved }
      source_branch_id, // Branch the materials are physically pulled from (set at approval)
    } = req.body;

    if (!id || !facilityId || !approvedBy || !wip || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: id, facilityId, approvedBy, wip, or items array",
      });
    }

    // Source branch is optional — raw material stock is not branch-scoped.
    const sourceBranchId =
      source_branch_id != null && String(source_branch_id).trim() !== ""
        ? parseInt(source_branch_id, 10)
        : null;
    if (
      sourceBranchId != null &&
      (!Number.isFinite(sourceBranchId) || sourceBranchId <= 0)
    ) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Invalid source_branch_id",
      });
    }
    if (sourceBranchId) {
      const sourceBranch = await db.Branch.findOne({
        where: { id: sourceBranchId, facilityId },
        attributes: ["id"],
        transaction,
      });
      if (!sourceBranch) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "source_branch_id does not belong to this facility",
        });
      }
    }

    const approvalDate = approval_date
      ? moment(approval_date).format("YYYY-MM-DD HH:mm:ss")
      : moment().format("YYYY-MM-DD HH:mm:ss");

    // 1. Update requisition status to approved (also persist source branch)
    const [, updated] = await db.sequelize.query(
      `UPDATE material_requisitions
       SET status = 'approved',
           approved_by = :approvedBy,
           approved_at = :approvalDate,
           source_branch_id = :sourceBranchId,
           updated_at = NOW()
       WHERE id = :id AND facility_id = :facilityId`,
      {
        replacements: {
          id,
          facilityId,
          approvedBy,
          approvalDate,
          sourceBranchId,
        },
        type: db.sequelize.QueryTypes.UPDATE,
        transaction,
      }
    );

    if (updated === 0) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Material requisition not found or already processed",
      });
    }

    let totalCOGS = 0;

    // Process each item one by one
    for (const item of items) {
      const { id: itemId, product_id: sku, quantity_approved } = item;

      if (!itemId || !sku || !quantity_approved || quantity_approved <= 0) {
        throw new Error(`Invalid item data: ${JSON.stringify(item)}`);
      }

      // 2. Confirm stock is actually available at the source branch before
      //    moving anything.
      const balanceRows = await db.sequelize.query(
        `SELECT IFNULL(SUM(qty_in) - SUM(qty_out), 0) AS balance
         FROM store_entries
         WHERE product_id = :sku
           AND facilityId = :facilityId
           AND LOWER(TRIM(branch_name)) = 'raw material'`,
        {
          replacements: { sku, facilityId },
          type: db.sequelize.QueryTypes.SELECT,
          transaction,
        }
      );
      const available = parseFloat(balanceRows?.[0]?.balance || 0);
      if (available + 1e-6 < parseFloat(quantity_approved)) {
        throw new Error(
          `Insufficient raw-material stock for ${sku} at source branch (available ${available}, requested ${quantity_approved})`
        );
      }

      // 3. Update material_requisition_items
      await db.MaterialRequisitionItem.update(
        {
          quantity_approved,
          updated_at: new Date(),
        },
        {
          where: { id: itemId, requisition_id: id },
          transaction,
        }
      );

      // 4. Fetch product with inventory account
      const product = await db.Product.findOne({
        where: { sku, facility_id: facilityId },
        attributes: ["id", "sku", "name", "inventory_account"],
        transaction,
      });

      if (!product) {
        throw new Error(`Product with SKU ${sku} not found in facility ${facilityId}`);
      }

      // 5. Get business valuation method
      const business = await db.business.findOne({
        where: { id: facilityId },
        attributes: ["inv_ev_m"],
        raw: true,
        transaction,
      });

      const valuationMethod = business?.inv_ev_m || "Weighted Average Cost";
      const methodKey = valuationMethod === "Weighted Average Cost" ? "WAC" : valuationMethod;

      // 6. Calculate COGS using proper valuation
      const { calculatedCostPrice } = await getCurrentUnitCost(
        product.sku,
        facilityId,
        methodKey
      );
      const unitCost = calculatedCostPrice || 0;
      const totalCost = unitCost * quantity_approved;
      totalCOGS += totalCost;

      // 7. Validate Inventory & WIP Accounts
      const inventoryAccount = await db.AccountCategory.findOne({
        where: { code: product.inventory_account, facility_id: facilityId },
        transaction,
      });

      if (!inventoryAccount) {
        throw new Error(`Inventory account '${product.inventory_account}' not found for product ${sku}`);
      }

      const wipAccount = await db.AccountCategory.findOne({
        where: { code: wip, facility_id: facilityId },
        transaction,
      });

      if (!wipAccount) {
        throw new Error(`WIP account '${wip}' not found`);
      }

      const referenceNo = String(id).startsWith("MR-") ? String(id) : `MR-${id}`;
      const today = moment().format("YYYY-MM-DD");
      const transactionDate = approval_date
        ? moment(approval_date).format("YYYY-MM-DD")
        : today;

      // 8. Stock movement (facility-wide — no branch on raw material / WIP)
      // material_issue: RM moved to WIP; not consumed until production posts.
      await db.StoreEntry.create(
        {
          receive_date: transactionDate,
          reference_number: referenceNo,
          product_id: sku,
          qty_out: quantity_approved,
          qty_in: 0,
          cost_price: unitCost,
          branch_name: "Raw Material",
          branchId: 0,
          source: "Raw Material",
          destination: "Work in Progress",
          inserted_by: approvedBy,
          facilityId,
          status: "approved",
          type: STORE_ENTRY_TYPE.MATERIAL_ISSUE,
        },
        { transaction }
      );

      await db.StoreEntry.create(
        {
          receive_date: transactionDate,
          reference_number: referenceNo,
          product_id: sku,
          qty_in: quantity_approved,
          qty_out: 0,
          cost_price: unitCost,
          branch_name: "Work in Progress",
          branchId: 0,
          source: "Raw Material",
          destination: "Work in Progress",
          inserted_by: approvedBy,
          facilityId,
          status: "approved",
          type: STORE_ENTRY_TYPE.MATERIAL_ISSUE,
        },
        { transaction }
      );

      // 8. Journal Entries: Dr WIP, Cr Inventory
      // const description = product.name || ;

      // Debit WIP
      await db.GeneralLedger.create(
        {
          transaction_date: transactionDate,
          account_code: wipAccount.code,
          account_subhead: wipAccount.subhead || 0,
          dr: totalCost,
          cr: 0,
          account_description: wipAccount.description,
          transaction_ref: referenceNo,
          purpose_of_payment: "Material Requisition Approval",
          transaction_description:  product.name || wipAccount.description,
          reference_number: id,
          created_by: approvedBy,
          facility_id: facilityId,
          status: "saved",
          type: "inventory",
        },
        { transaction }
      );

      // Credit Inventory
      await db.GeneralLedger.create(
        {
          transaction_date: transactionDate,
          account_code: inventoryAccount.code,
          account_subhead: inventoryAccount.subhead || 0,
          dr: 0,
          cr: totalCost,
          account_description: inventoryAccount.description,
          transaction_ref: referenceNo,
          purpose_of_payment: "Material Requisition Approval",
          transaction_description: product.name || inventoryAccount.description,
          reference_number: id,
          created_by: approvedBy,
          facility_id: facilityId,
          status: "saved",
          type: "inventory",
        },
        { transaction }
      );
    }

    // All good — commit transaction
    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "Material requisition approved successfully and transferred to WIP",
      data: { totalCOGS: parseFloat(totalCOGS.toFixed(2)) },
    });

  } catch (error) {
    await transaction.rollback();
    console.error("Error approving material requisition:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to approve material requisition",
      error: error.message,
    });
  }
};

// Issue Materials (Create Store Entries)
exports.issueMaterials = async (req, res) => {
  try {
    const {
      requisitionId,
      facilityId,
      issuedBy,
      items, // Array of items to be issued with quantities
    } = req.body;

    if (
      !requisitionId ||
      !facilityId ||
      !issuedBy ||
      !items ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: requisitionId, facilityId, issuedBy, items",
      });
    }

    const transaction = await db.sequelize.transaction();

    try {
      // Create store entries for each issued item (qty_out)
      for (const item of items) {
        // Get product details
        const product = await db.Product.findOne({
          where: {
            id: item.product_id,
            facility_id: facilityId,
          },
          transaction,
        });

        if (!product) {
          throw new Error(`Product ${item.product_id} not found`);
        }

        // Create store entry for material issuance (qty_out)
        await db.StoreEntry.create(
          {
            receive_date: moment().format("YYYY-MM-DD"),
            reference_number: requisitionId,
            qty_in: 0,
            qty_out: item.quantity_issued,
            cost_price: product.cost_price || 0,
            selling_price: product.selling_price || 0,
            facilityId: facilityId,
            inserted_by: issuedBy,
            product_id: product.sku,
            branch_name: "Raw Material",
            branchId: 0,
            source: "Raw Material",
            destination: "Work in Progress",
            status: "approved",
            type: STORE_ENTRY_TYPE.MATERIAL_ISSUE,
          },
          { transaction }
        );

        // Update issued quantity in requisition item
        await db.sequelize.query(
          `UPDATE material_requisition_items SET quantity_issued = :quantity_issued, updated_at = :updated_at WHERE id = :id AND requisition_id = :requisition_id`,
          {
            replacements: {
              id: item.id,
              requisition_id: requisitionId,
              quantity_issued: item.quantity_issued,
              updated_at: moment().format("YYYY-MM-DD HH:mm:ss"),
            },
            type: db.sequelize.QueryTypes.UPDATE,
            transaction,
          }
        );
      }

      // Check if all items are issued, then update requisition status
      const itemsQuery = `SELECT * FROM material_requisition_items WHERE requisition_id = :requisition_id`;
      const itemsResult = await db.sequelize.query(itemsQuery, {
        replacements: { requisition_id: requisitionId },
        type: db.sequelize.QueryTypes.SELECT,
        transaction,
      });

      const allItemsIssued = itemsResult.every(
        (item) =>
          parseFloat(item.quantity_issued || 0) >=
          parseFloat(item.quantity_approved || item.quantity_requested || 0)
      );

      if (allItemsIssued) {
        await db.sequelize.query(
          `UPDATE material_requisitions SET status = 'completed', updated_at = :updated_at WHERE id = :id AND facility_id = :facilityId`,
          {
            replacements: {
              id: requisitionId,
              facilityId,
              updated_at: moment().format("YYYY-MM-DD HH:mm:ss"),
            },
            type: db.sequelize.QueryTypes.UPDATE,
            transaction,
          }
        );
      }

      await transaction.commit();

      res.status(200).json({
        success: true,
        data: {
          requisitionId,
          message: "Materials issued successfully",
        },
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error("Error issuing materials:", error);
    res.status(500).json({
      success: false,
      message: "Error issuing materials",
      error: error.message,
    });
  }
};

function materialRequisitionRefs(id) {
  const raw = String(id || "").trim();
  // Canonical ref is the requisition id (already "MR-4170" when prefixed).
  const referenceNo = raw.startsWith("MR-") ? raw : `MR-${raw}`;
  // Older approvals wrote store/GL as "MR-MR-4170" (double prefix).
  const legacyDouble = referenceNo.startsWith("MR-MR-")
    ? referenceNo
    : `MR-${referenceNo}`;
  return {
    id: raw,
    referenceNo,
    refs: [...new Set([raw, referenceNo, legacyDouble])],
  };
}

/**
 * Load approved MR with items, store_entries qty, and general_ledger lines
 * for correction UI.
 */
exports.getMaterialRequisitionPostings = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId } = req.query;
    if (!id || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "id and facilityId are required",
      });
    }

    const { id: reqId, refs } = materialRequisitionRefs(id);

    const mrRows = await db.sequelize.query(
      `SELECT mr.*,
              CONCAT(u.firstname, ' ', u.lastname) AS creator_name
       FROM material_requisitions mr
       LEFT JOIN users u ON mr.created_by = u.id
       WHERE mr.id = :id AND mr.facility_id = :facilityId
       LIMIT 1`,
      {
        replacements: { id: reqId, facilityId },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );
    const requisition = mrRows[0];
    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: "Material requisition not found",
      });
    }

    const items = await db.sequelize.query(
      `SELECT
         mri.id,
         mri.product_id,
         mri.product_name,
         mri.product_code,
         mri.sku,
         mri.category,
         mri.unit_of_measure,
         mri.quantity_requested,
         mri.quantity_approved,
         mri.quantity_issued,
         mri.unit_cost,
         mri.total_cost
       FROM material_requisition_items mri
       WHERE mri.requisition_id = :id
       ORDER BY mri.created_at ASC`,
      {
        replacements: { id: reqId },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );

    const storeEntries = await db.sequelize.query(
      `SELECT
         se.id,
         se.receive_date,
         se.reference_number,
         se.product_id,
         se.qty_in,
         se.qty_out,
         se.cost_price,
         se.branch_name,
         se.source,
         se.destination,
         se.type
       FROM store_entries se
       WHERE se.facilityId = :facilityId
         AND se.reference_number IN (:refs)
       ORDER BY se.id ASC`,
      {
        replacements: {
          facilityId,
          refs,
        },
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
           OR gl.transaction_ref IN (:refs)
         )
       ORDER BY gl.transaction_id ASC`,
      {
        replacements: { facilityId, refs },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );

    const itemsWithStore = items.map((item) => {
      const sku = String(
        item.product_code || item.sku || item.product_id || "",
      ).trim();
      const relatedStore = storeEntries.filter(
        (se) =>
          String(se.product_id || "").trim().toLowerCase() ===
          sku.toLowerCase(),
      );
      const rmOut = relatedStore.find(
        (se) =>
          parseFloat(se.qty_out || 0) > 0 &&
          String(se.branch_name || "")
            .toLowerCase()
            .includes("raw"),
      );
      const wipIn = relatedStore.find(
        (se) =>
          parseFloat(se.qty_in || 0) > 0 &&
          String(se.branch_name || "")
            .toLowerCase()
            .includes("progress"),
      );
      const storeQty =
        parseFloat(rmOut?.qty_out || wipIn?.qty_in || 0) ||
        parseFloat(item.quantity_approved || item.quantity_requested || 0) ||
        0;
      const unitCost =
        parseFloat(rmOut?.cost_price || wipIn?.cost_price || item.unit_cost || 0) ||
        0;

      return {
        ...item,
        sku,
        store_qty: storeQty,
        unit_cost: unitCost,
        approved_qty: storeQty,
        store_entry_ids: relatedStore.map((s) => s.id),
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        requisition,
        items: itemsWithStore,
        storeEntries,
        ledgerEntries,
      },
    });
  } catch (error) {
    console.error("Error loading material requisition postings:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load requisition postings",
      error: error.message,
    });
  }
};

/**
 * Correct an approved material requisition: update notes/priority/date/qty
 * and sync linked store_entries + general_ledger.
 */
exports.correctMaterialRequisition = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const {
      id,
      facilityId,
      priority,
      notes,
      transactionDate,
      items: itemUpdates = [],
    } = req.body || {};

    if (!id || !facilityId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "id and facilityId are required",
      });
    }

    const { id: reqId, refs, referenceNo } = materialRequisitionRefs(id);

    const mrRows = await db.sequelize.query(
      `SELECT id, status, approved_at, notes, priority, approved_by, created_by
       FROM material_requisitions
       WHERE id = :id AND facility_id = :facilityId
       LIMIT 1`,
      {
        replacements: { id: reqId, facilityId },
        type: db.sequelize.QueryTypes.SELECT,
        transaction,
      },
    );
    const mr = mrRows[0];

    if (!mr) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Material requisition not found",
      });
    }

    if (String(mr.status || "").toLowerCase() !== "approved") {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Only approved requisitions can be corrected here",
      });
    }

    const updateFields = ["updated_at = NOW()"];
    const replacements = { id: reqId, facilityId };

    if (priority) {
      updateFields.push("priority = :priority");
      replacements.priority = priority;
    }
    if (notes !== undefined) {
      updateFields.push("notes = :notes");
      replacements.notes = notes;
    }

    let nextDate = null;
    if (transactionDate) {
      const parsed = moment(transactionDate, "YYYY-MM-DD", true);
      if (!parsed.isValid()) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "transactionDate must be YYYY-MM-DD",
        });
      }
      nextDate = parsed.format("YYYY-MM-DD");
      updateFields.push("approved_at = :approvedAt");
      replacements.approvedAt = `${nextDate} 00:00:00`;
    }

    await db.sequelize.query(
      `UPDATE material_requisitions
       SET ${updateFields.join(", ")}
       WHERE id = :id AND facility_id = :facilityId`,
      {
        replacements,
        type: db.sequelize.QueryTypes.UPDATE,
        transaction,
      },
    );

    let storeUpdated = 0;
    let ledgerUpdated = 0;

    if (nextDate) {
      await db.sequelize.query(
        `UPDATE store_entries
         SET receive_date = :nextDate
         WHERE facilityId = :facilityId
           AND reference_number IN (:refs)`,
        {
          replacements: {
            nextDate,
            facilityId,
            refs,
          },
          type: db.sequelize.QueryTypes.UPDATE,
          transaction,
        },
      );

      await db.sequelize.query(
        `UPDATE general_ledger
         SET transaction_date = :nextDate
         WHERE facility_id = :facilityId
           AND (
             reference_number IN (:refs)
             OR transaction_ref IN (:refs)
           )`,
        {
          replacements: { nextDate, facilityId, refs },
          type: db.sequelize.QueryTypes.UPDATE,
          transaction,
        },
      );
    }

    // Qty corrections → store + ledger amounts
    if (Array.isArray(itemUpdates) && itemUpdates.length > 0) {
      for (const line of itemUpdates) {
        const sku = String(
          line.sku || line.product_code || line.product_id || "",
        ).trim();
        const newQty = parseFloat(line.quantity_approved ?? line.qty ?? 0);
        if (!sku || !(newQty >= 0)) continue;

        const itemRows = await db.sequelize.query(
          `SELECT id, product_name, product_code, sku, product_id, unit_cost,
                  quantity_approved
           FROM material_requisition_items
           WHERE requisition_id = :reqId
             AND (
               product_code = :sku
               OR sku = :sku
               OR product_id = :sku
             )
           LIMIT 1`,
          {
            replacements: { reqId, sku },
            type: db.sequelize.QueryTypes.SELECT,
            transaction,
          },
        );
        const item = itemRows[0];
        if (!item) continue;

        const unitCost = parseFloat(line.unit_cost ?? item.unit_cost ?? 0) || 0;
        const newAmount = Number((newQty * unitCost).toFixed(4));
        const oldQty = parseFloat(item.quantity_approved || 0) || 0;

        await db.sequelize.query(
          `UPDATE material_requisition_items
           SET quantity_approved = :newQty,
               total_cost = :newAmount,
               updated_at = NOW()
           WHERE id = :itemId`,
          {
            replacements: {
              newQty,
              newAmount,
              itemId: item.id,
            },
            type: db.sequelize.QueryTypes.UPDATE,
            transaction,
          },
        );

        // Store product_id is usually the SKU / product_code (e.g. RM061)
        const storeProductId = String(
          item.product_code || item.sku || sku,
        ).trim();
        const productKeys = [
          ...new Set(
            [storeProductId, sku, item.product_id, item.sku, item.product_code]
              .map((v) => String(v || "").trim())
              .filter(Boolean),
          ),
        ];
        const receiveDate =
          nextDate ||
          (mr.approved_at
            ? moment(mr.approved_at).format("YYYY-MM-DD")
            : moment().format("YYYY-MM-DD"));

        const existingStore = await db.sequelize.query(
          `SELECT id, product_id, qty_in, qty_out, branch_name, cost_price
           FROM store_entries
           WHERE facilityId = :facilityId
             AND reference_number IN (:refs)
             AND product_id IN (:productKeys)
           ORDER BY id ASC`,
          {
            replacements: { facilityId, refs, productKeys },
            type: db.sequelize.QueryTypes.SELECT,
            transaction,
          },
        );

        const isRmLeg = (se) =>
          parseFloat(se.qty_out || 0) > 0 ||
          String(se.branch_name || "")
            .toLowerCase()
            .includes("raw");
        const isWipLeg = (se) =>
          parseFloat(se.qty_in || 0) > 0 ||
          String(se.branch_name || "")
            .toLowerCase()
            .includes("progress");

        const rmLegs = existingStore.filter(isRmLeg);
        const wipLegs = existingStore.filter(isWipLeg);
        const keepRm = rmLegs[0] || null;
        const keepWip = wipLegs[0] || null;
        const duplicateIds = [
          ...rmLegs.slice(1).map((r) => r.id),
          ...wipLegs.slice(1).map((r) => r.id),
        ];

        if (duplicateIds.length) {
          await db.StoreEntry.destroy({
            where: { id: { [db.Sequelize.Op.in]: duplicateIds } },
            transaction,
          });
        }

        if (keepRm) {
          await db.sequelize.query(
            `UPDATE store_entries
             SET qty_out = :newQty,
                 qty_in = 0,
                 cost_price = CASE
                   WHEN :unitCost > 0 THEN :unitCost
                   ELSE cost_price
                 END,
                 receive_date = COALESCE(:receiveDate, receive_date)
             WHERE id = :id AND facilityId = :facilityId`,
            {
              replacements: {
                newQty,
                unitCost,
                receiveDate: nextDate || null,
                id: keepRm.id,
                facilityId,
              },
              type: db.sequelize.QueryTypes.UPDATE,
              transaction,
            },
          );
          storeUpdated += 1;
        } else if (newQty > 0) {
          await db.StoreEntry.create(
            {
              receive_date: receiveDate,
              reference_number: referenceNo,
              product_id: storeProductId,
              qty_out: newQty,
              qty_in: 0,
              cost_price: unitCost,
              branch_name: "Raw Material",
              branchId: 0,
              source: "Raw Material",
              destination: "Work in Progress",
              inserted_by: mr.approved_by || mr.created_by || null,
              facilityId,
              status: "approved",
              type: STORE_ENTRY_TYPE.MATERIAL_ISSUE,
              createdAt: new Date(),
              markup_mode: "percentage",
              mark_up: 0,
              multple: "1",
              location: "Warehouse",
            },
            { transaction },
          );
          storeUpdated += 1;
        }

        if (keepWip) {
          await db.sequelize.query(
            `UPDATE store_entries
             SET qty_in = :newQty,
                 qty_out = 0,
                 cost_price = CASE
                   WHEN :unitCost > 0 THEN :unitCost
                   ELSE cost_price
                 END,
                 receive_date = COALESCE(:receiveDate, receive_date)
             WHERE id = :id AND facilityId = :facilityId`,
            {
              replacements: {
                newQty,
                unitCost,
                receiveDate: nextDate || null,
                id: keepWip.id,
                facilityId,
              },
              type: db.sequelize.QueryTypes.UPDATE,
              transaction,
            },
          );
          storeUpdated += 1;
        } else if (newQty > 0) {
          await db.StoreEntry.create(
            {
              receive_date: receiveDate,
              reference_number: referenceNo,
              product_id: storeProductId,
              qty_in: newQty,
              qty_out: 0,
              cost_price: unitCost,
              branch_name: "Work in Progress",
              branchId: 0,
              source: "Raw Material",
              destination: "Work in Progress",
              inserted_by: mr.approved_by || mr.created_by || null,
              facilityId,
              status: "approved",
              type: STORE_ENTRY_TYPE.MATERIAL_ISSUE,
              createdAt: new Date(),
              markup_mode: "percentage",
              mark_up: 0,
              multple: "1",
              location: "Warehouse",
            },
            { transaction },
          );
          storeUpdated += 1;
        }

        // Match ledger lines for this product (by description or prior amount)
        const productName = String(item.product_name || "").trim();
        const oldAmount = Number((oldQty * unitCost).toFixed(4));

        const glRows = await db.sequelize.query(
          `SELECT transaction_id, dr, cr, transaction_description
           FROM general_ledger
           WHERE facility_id = :facilityId
             AND (
               reference_number IN (:refs)
               OR transaction_ref IN (:refs)
             )`,
          {
            replacements: { facilityId, refs },
            type: db.sequelize.QueryTypes.SELECT,
            transaction,
          },
        );

        for (const gl of glRows) {
          const desc = String(gl.transaction_description || "").trim();
          const glAmt = Math.max(parseFloat(gl.dr || 0), parseFloat(gl.cr || 0));
          const nameMatch =
            productName &&
            desc.toLowerCase() === productName.toLowerCase();
          const amountMatch =
            oldAmount > 0 && Math.abs(glAmt - oldAmount) < 0.02;
          if (!nameMatch && !amountMatch) continue;

          const nextDr = parseFloat(gl.dr || 0) > 0 ? newAmount : 0;
          const nextCr = parseFloat(gl.cr || 0) > 0 ? newAmount : 0;
          await db.sequelize.query(
            `UPDATE general_ledger
             SET dr = :nextDr, cr = :nextCr
             WHERE transaction_id = :txnId
               AND facility_id = :facilityId`,
            {
              replacements: {
                nextDr,
                nextCr,
                txnId: gl.transaction_id,
                facilityId,
              },
              type: db.sequelize.QueryTypes.UPDATE,
              transaction,
            },
          );
          ledgerUpdated += 1;
        }
      }

      // Sync header quantity_required to sum of approved
      await db.sequelize.query(
        `UPDATE material_requisitions mr
         SET quantity_required = (
           SELECT COALESCE(SUM(quantity_approved), 0)
           FROM material_requisition_items mri
           WHERE mri.requisition_id = mr.id
         ),
         updated_at = NOW()
         WHERE mr.id = :reqId AND mr.facility_id = :facilityId`,
        {
          replacements: { reqId, facilityId },
          type: db.sequelize.QueryTypes.UPDATE,
          transaction,
        },
      );
    }

    // Count date-touched store/ledger if not already from qty path
    if (nextDate && storeUpdated === 0) {
      const storeCountRows = await db.sequelize.query(
        `SELECT COUNT(*) AS cnt FROM store_entries
         WHERE facilityId = :facilityId
           AND reference_number IN (:refs)`,
        {
          replacements: {
            facilityId,
            refs,
          },
          type: db.sequelize.QueryTypes.SELECT,
          transaction,
        },
      );
      storeUpdated = parseInt(storeCountRows?.[0]?.cnt || 0, 10);
    }
    if (nextDate && ledgerUpdated === 0) {
      const ledgerCountRows = await db.sequelize.query(
        `SELECT COUNT(*) AS cnt FROM general_ledger
         WHERE facility_id = :facilityId
           AND (
             reference_number IN (:refs)
             OR transaction_ref IN (:refs)
           )`,
        {
          replacements: { facilityId, refs },
          type: db.sequelize.QueryTypes.SELECT,
          transaction,
        },
      );
      ledgerUpdated = parseInt(ledgerCountRows?.[0]?.cnt || 0, 10);
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
           OR gl.transaction_ref IN (:refs)
         )
       ORDER BY gl.transaction_id ASC`,
      {
        replacements: { facilityId, refs },
        type: db.sequelize.QueryTypes.SELECT,
        transaction,
      },
    );

    await transaction.commit();
    return res.status(200).json({
      success: true,
      message: "Material requisition corrected (store entries and ledger synced)",
      data: {
        id: reqId,
        store_entries_updated: storeUpdated,
        ledger_entries_updated: ledgerUpdated,
        transaction_date: nextDate,
        ledgerEntries: updatedLedger,
      },
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Error correcting material requisition:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to correct material requisition",
      error: error.message,
    });
  }
};

/**
 * Delete an approved material requisition and linked store_entries + ledger.
 */
exports.deleteMaterialRequisitionWithPostings = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { id, facilityId } = req.body || {};
    if (!id || !facilityId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "id and facilityId are required",
      });
    }

    const { id: reqId, refs } = materialRequisitionRefs(id);

    const mrRows = await db.sequelize.query(
      `SELECT id, status FROM material_requisitions
       WHERE id = :id AND facility_id = :facilityId
       LIMIT 1`,
      {
        replacements: { id: reqId, facilityId },
        type: db.sequelize.QueryTypes.SELECT,
        transaction,
      },
    );
    const mr = mrRows[0];
    if (!mr) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Material requisition not found",
      });
    }

    const deletedStore = await db.StoreEntry.destroy({
      where: {
        facilityId,
        reference_number: { [db.Sequelize.Op.in]: refs },
      },
      transaction,
    });

    const deletedLedger = await db.GeneralLedger.destroy({
      where: {
        facility_id: facilityId,
        [db.Sequelize.Op.or]: [
          { reference_number: { [db.Sequelize.Op.in]: refs } },
          { transaction_ref: { [db.Sequelize.Op.in]: refs } },
        ],
      },
      transaction,
    });

    await db.sequelize.query(
      `DELETE FROM material_requisition_items WHERE requisition_id = :id`,
      {
        replacements: { id: reqId },
        type: db.sequelize.QueryTypes.DELETE,
        transaction,
      },
    );

    await db.sequelize.query(
      `DELETE FROM material_requisitions
       WHERE id = :id AND facility_id = :facilityId`,
      {
        replacements: { id: reqId, facilityId },
        type: db.sequelize.QueryTypes.DELETE,
        transaction,
      },
    );

    await transaction.commit();
    return res.status(200).json({
      success: true,
      message:
        "Material requisition deleted with linked store entries and ledger",
      data: {
        id: reqId,
        deleted_store_entries: deletedStore || 0,
        deleted_ledger_entries: deletedLedger || 0,
      },
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Error deleting material requisition with postings:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete material requisition",
      error: error.message,
    });
  }
};

// Create Bill of Materials
exports.createBillOfMaterials = async (req, res) => {
  try {
    const { facilityId, productName, version, description, items, createdBy } =
      req.body;

    if (
      !facilityId ||
      !productName ||
      !items ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: facilityId, productName, items",
      });
    }

    const bomId = `BOM-${Date.now()}`;
    const transaction = await db.sequelize.transaction();

    try {
      // Calculate total cost
      let totalCost = 0;
      const bomItems = items.map((item, index) => {
        const itemTotal = item.quantityRequired * item.unitCost;
        totalCost += itemTotal;
        return {
          id: uuidv4(),
          bom_id: bomId,
          material_id: item.materialId,
          quantity_required: item.quantityRequired,
          unit_cost: item.unitCost,
          total_cost: itemTotal,
          sequence: index + 1,
          notes: item.notes || null,
          created_at: moment().format("YYYY-MM-DD HH:mm:ss"),
        };
      });

      // Create BOM
      const bomData = {
        id: bomId,
        facility_id: facilityId,
        product_name: productName,
        version: version || "1.0",
        status: "active",
        description: description || null,
        total_cost: totalCost,
        created_by: createdBy,
        created_at: moment().format("YYYY-MM-DD HH:mm:ss"),
      };

      await db.sequelize.query(
        `INSERT INTO bill_of_materials (id, facility_id, product_name, version, status, description, total_cost, created_by, created_at)
         VALUES (:id, :facility_id, :product_name, :version, :status, :description, :total_cost, :created_by, :created_at)`,
        {
          replacements: bomData,
          type: db.sequelize.QueryTypes.INSERT,
          transaction,
        }
      );

      // Create BOM Items
      for (const item of bomItems) {
        await db.sequelize.query(
          `INSERT INTO bill_of_material_items (id, bom_id, material_id, quantity_required, unit_cost, total_cost, sequence, notes, created_at)
           VALUES (:id, :bom_id, :material_id, :quantity_required, :unit_cost, :total_cost, :sequence, :notes, :created_at)`,
          {
            replacements: item,
            type: db.sequelize.QueryTypes.INSERT,
            transaction,
          }
        );
      }

      await transaction.commit();

      res.status(201).json({
        success: true,
        data: {
          bomId,
          productName,
          totalCost,
          message: "Bill of Materials created successfully",
        },
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error("Error creating BOM:", error);
    res.status(500).json({
      success: false,
      message: "Error creating Bill of Materials",
      error: error.message,
    });
  }
};

// Create Production Order
exports.createProductionOrder = async (req, res) => {
  try {
    const {
      facilityId,
      bomId,
      quantityPlanned,
      startDate,
      endDate,
      priority,
      notes,
      createdBy,
    } = req.body;

    if (!facilityId || !bomId || !quantityPlanned) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: facilityId, bomId, quantityPlanned",
      });
    }

    const orderId = `WO-${Date.now()}`;
    const orderNumber = `WO-${Date.now()}`;

    // Get BOM details
    const bomQuery = `
      SELECT bom.*,
             GROUP_CONCAT(
               CONCAT(bomi.material_id, ':', bomi.quantity_required, ':', bomi.unit_cost)
               SEPARATOR '|'
             ) as bom_items
      FROM bill_of_materials bom
      LEFT JOIN bill_of_material_items bomi ON bom.id = bomi.bom_id
      WHERE bom.id = :bomId AND bom.facility_id = :facilityId
      GROUP BY bom.id
    `;

    const bomResult = await db.sequelize.query(bomQuery, {
      replacements: { bomId, facilityId },
      type: db.sequelize.QueryTypes.SELECT,
    });

    if (bomResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Bill of Materials not found",
      });
    }

    const bom = bomResult[0];
    const transaction = await db.sequelize.transaction();

    try {
      // Create Production Order
      const orderData = {
        id: orderId,
        facility_id: facilityId,
        bom_id: bomId,
        order_number: orderNumber,
        quantity_planned: quantityPlanned,
        quantity_actual: 0,
        status: "planned",
        start_date: startDate || null,
        end_date: endDate || null,
        priority: priority || "medium",
        notes: notes || null,
        created_by: createdBy,
        created_at: moment().format("YYYY-MM-DD HH:mm:ss"),
      };

      await db.sequelize.query(
        `INSERT INTO production_orders (id, facility_id, bom_id, order_number, quantity_planned, quantity_actual, status, start_date, end_date, priority, notes, created_by, created_at)
         VALUES (:id, :facility_id, :bom_id, :order_number, :quantity_planned, :quantity_actual, :status, :start_date, :end_date, :priority, :notes, :created_by, :created_at)`,
        {
          replacements: orderData,
          type: db.sequelize.QueryTypes.INSERT,
          transaction,
        }
      );

      // Check material availability
      const bomItems = bom.bom_items ? bom.bom_items.split("|") : [];
      const materialChecks = [];

      for (const item of bomItems) {
        const [materialId, quantityRequired, unitCost] = item.split(":");
        const requiredQty = parseFloat(quantityRequired) * quantityPlanned;

        const stockQuery = `SELECT stock_qty FROM materials WHERE id = :materialId AND facility_id = :facilityId`;
        const stockResult = await db.sequelize.query(stockQuery, {
          replacements: { materialId, facilityId },
          type: db.sequelize.QueryTypes.SELECT,
          transaction,
        });

        if (stockResult.length === 0) {
          throw new Error(`Material ${materialId} not found`);
        }

        const availableStock = parseFloat(stockResult[0].stock_qty);
        materialChecks.push({
          materialId,
          required: requiredQty,
          available: availableStock,
          sufficient: availableStock >= requiredQty,
        });
      }

      // Check if all materials are available
      const insufficientMaterials = materialChecks.filter(
        (check) => !check.sufficient
      );
      if (insufficientMaterials.length > 0) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Insufficient materials for production",
          insufficientMaterials,
        });
      }

      await transaction.commit();

      res.status(201).json({
        success: true,
        data: {
          orderId,
          orderNumber,
          quantityPlanned,
          materialChecks,
          message: "Production Order created successfully",
        },
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error("Error creating production order:", error);
    res.status(500).json({
      success: false,
      message: "Error creating production order",
      error: error.message,
    });
  }
};

// Update Production Progress
exports.updateProductionProgress = async (req, res) => {
  try {
    const { facilityId, orderId, quantityActual, status, notes } = req.body;

    if (!facilityId || !orderId) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: facilityId, orderId",
      });
    }

    const transaction = await db.sequelize.transaction();

    try {
      // Update production order
      const updateData = {
        quantity_actual: quantityActual || null,
        status: status || null,
        updated_at: moment().format("YYYY-MM-DD HH:mm:ss"),
      };

      const updateFields = [];
      const replacements = { orderId, facilityId };

      if (quantityActual !== undefined) {
        updateFields.push("quantity_actual = :quantity_actual");
        replacements.quantity_actual = quantityActual;
      }

      if (status) {
        updateFields.push("status = :status");
        replacements.status = status;
      }

      if (updateFields.length > 0) {
        updateFields.push("updated_at = :updated_at");

        await db.sequelize.query(
          `UPDATE production_orders SET ${updateFields.join(
            ", "
          )} WHERE id = :orderId AND facility_id = :facilityId`,
          {
            replacements,
            type: db.sequelize.QueryTypes.UPDATE,
            transaction,
          }
        );
      }

      // If status is completed, issue materials and create finished goods
      if (status === "completed" && quantityActual > 0) {
        // Get BOM details
        const bomQuery = `
          SELECT po.bom_id, bom.product_name,
                 GROUP_CONCAT(
                   CONCAT(bomi.material_id, ':', bomi.quantity_required, ':', bomi.unit_cost)
                   SEPARATOR '|'
                 ) as bom_items
          FROM production_orders po
          JOIN bill_of_materials bom ON po.bom_id = bom.id
          LEFT JOIN bill_of_material_items bomi ON bom.id = bomi.bom_id
          WHERE po.id = :orderId AND po.facility_id = :facilityId
          GROUP BY po.id
        `;

        const bomResult = await db.sequelize.query(bomQuery, {
          replacements: { orderId, facilityId },
          type: db.sequelize.QueryTypes.SELECT,
          transaction,
        });

        if (bomResult.length > 0) {
          const bom = bomResult[0];
          const bomItems = bom.bom_items ? bom.bom_items.split("|") : [];

          // Issue materials
          for (const item of bomItems) {
            const [materialId, quantityRequired, unitCost] = item.split(":");
            const issuedQty = parseFloat(quantityRequired) * quantityActual;

            // Create material issuance record
            const issuanceId = uuidv4();
            await db.sequelize.query(
              `INSERT INTO material_issuances (id, facility_id, production_order_id, material_id, quantity_issued, unit_cost, total_cost, issued_by, issued_date, created_at)
               VALUES (:id, :facility_id, :production_order_id, :material_id, :quantity_issued, :unit_cost, :total_cost, :issued_by, :issued_date, :created_at)`,
              {
                replacements: {
                  id: issuanceId,
                  facility_id: facilityId,
                  production_order_id: orderId,
                  material_id: materialId,
                  quantity_issued: issuedQty,
                  unit_cost: parseFloat(unitCost),
                  total_cost: issuedQty * parseFloat(unitCost),
                  issued_by: "system",
                  issued_date: moment().format("YYYY-MM-DD"),
                  created_at: moment().format("YYYY-MM-DD HH:mm:ss"),
                },
                type: db.sequelize.QueryTypes.INSERT,
                transaction,
              }
            );

            // Update material stock
            await db.sequelize.query(
              `UPDATE materials SET stock_qty = stock_qty - :quantity WHERE id = :material_id AND facility_id = :facility_id`,
              {
                replacements: {
                  quantity: issuedQty,
                  material_id: materialId,
                  facility_id: facilityId,
                },
                type: db.sequelize.QueryTypes.UPDATE,
                transaction,
              }
            );
          }

          // Create finished goods
          const finishedGoodId = uuidv4();
          const batchNo = `BATCH-${Date.now()}`;
          const totalCost = bomItems.reduce((sum, item) => {
            const [materialId, quantityRequired, unitCost] = item.split(":");
            return (
              sum +
              parseFloat(quantityRequired) *
                parseFloat(unitCost) *
                quantityActual
            );
          }, 0);

          await db.sequelize.query(
            `INSERT INTO finished_goods (id, facility_id, production_order_id, product_name, batch_no, quantity, cost_per_unit, total_cost, status, created_at)
             VALUES (:id, :facility_id, :production_order_id, :product_name, :batch_no, :quantity, :cost_per_unit, :total_cost, :status, :created_at)`,
            {
              replacements: {
                id: finishedGoodId,
                facility_id: facilityId,
                production_order_id: orderId,
                product_name: bom.product_name,
                batch_no: batchNo,
                quantity: quantityActual,
                cost_per_unit: totalCost / quantityActual,
                total_cost: totalCost,
                status: "available",
                created_at: moment().format("YYYY-MM-DD HH:mm:ss"),
              },
              type: db.sequelize.QueryTypes.INSERT,
              transaction,
            }
          );
        }
      }

      await transaction.commit();

      res.status(200).json({
        success: true,
        data: {
          orderId,
          message: "Production progress updated successfully",
        },
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error("Error updating production progress:", error);
    res.status(500).json({
      success: false,
      message: "Error updating production progress",
      error: error.message,
    });
  }
};

// Get Production Orders
exports.getProductionOrders = async (req, res) => {
  try {
    const { facilityId, status, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    let whereClause = "WHERE po.facility_id = :facilityId";
    const replacements = {
      facilityId,
      limit: parseInt(limit),
      offset: parseInt(offset),
    };

    if (status) {
      whereClause += " AND po.status = :status";
      replacements.status = status;
    }

    const query = `
      SELECT
        po.*,
        bom.product_name,
        bom.total_cost as bom_total_cost
      FROM production_orders po
      LEFT JOIN bill_of_materials bom ON po.bom_id = bom.id
      ${whereClause}
      ORDER BY po.created_at DESC
      LIMIT :limit OFFSET :offset
    `;

    const productionOrders = await db.sequelize.query(query, {
      replacements,
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM production_orders po ${whereClause}`;
    const countResult = await db.sequelize.query(countQuery, {
      replacements: { facilityId, status },
      type: db.sequelize.QueryTypes.SELECT,
    });

    res.status(200).json({
      success: true,
      data: {
        productionOrders,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(countResult[0].total / limit),
          totalItems: countResult[0].total,
          itemsPerPage: parseInt(limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching production orders:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching production orders",
      error: error.message,
    });
  }
};

// Get Bill of Materials
exports.getBillOfMaterials = async (req, res) => {
  try {
    const { facilityId, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const query = `
      SELECT
        bom.*,
        GROUP_CONCAT(
          CONCAT(
            m.name, ':', bomi.quantity_required, ':', bomi.unit_cost, ':', bomi.total_cost
          ) SEPARATOR '|'
        ) as items
      FROM bill_of_materials bom
      LEFT JOIN bill_of_material_items bomi ON bom.id = bomi.bom_id
      LEFT JOIN materials m ON bomi.material_id = m.id
      WHERE bom.facility_id = :facilityId
      GROUP BY bom.id
      ORDER BY bom.created_at DESC
      LIMIT :limit OFFSET :offset
    `;

    const billOfMaterials = await db.sequelize.query(query, {
      replacements: {
        facilityId,
        limit: parseInt(limit),
        offset: parseInt(offset),
      },
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM bill_of_materials WHERE facility_id = :facilityId`;
    const countResult = await db.sequelize.query(countQuery, {
      replacements: { facilityId },
      type: db.sequelize.QueryTypes.SELECT,
    });

    res.status(200).json({
      success: true,
      data: {
        billOfMaterials,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(countResult[0].total / limit),
          totalItems: countResult[0].total,
          itemsPerPage: parseInt(limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching bill of materials:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching bill of materials",
      error: error.message,
    });
  }
};

//create requisition
exports.createRequisition = async (req, res) => {
  try {
    const {
      facilityId,
      bomId,
      quantityPlanned,
      startDate,
      endDate,
      priority,
      notes,
      createdBy,
    } = req.body;
    const requisitionId = `RE-${Date.now()}`;
    const requisitionNumber = `RE-${Date.now()}`;
    const requisitionData = {
      id: requisitionId,
      facility_id: facilityId,
      bom_id: bomId,
      requisition_number: requisitionNumber,
      quantity_planned: quantityPlanned,
      quantity_actual: 0,
      status: "planned",
      start_date: startDate || null,
      end_date: endDate || null,
      priority: priority || "medium",
      notes: notes || null,
      created_by: createdBy,
      created_at: moment().format("YYYY-MM-DD HH:mm:ss"),
    };
    await db.sequelize.query(
      `INSERT INTO requisitions (id, facility_id, bom_id, requisition_number, quantity_planned, quantity_actual, status, start_date, end_date, priority, notes, created_by, created_at)
          VALUES (:id, :facility_id, :bom_id, :requisition_number, :quantity_planned, :quantity_actual, :status, :start_date, :end_date, :priority, :notes, :created_by, :created_at)`,
      {
        replacements: requisitionData,
        type: db.sequelize.QueryTypes.INSERT,
      }
    );
    res.status(200).json({
      success: true,
      data: requisitionData,
    });
  } catch (error) {
    console.error("Error creating requisition:", error);
    res.status(500).json({
      success: false,
      message: "Error creating requisition",
      error: error.message,
    });
  }
};
// Get Production List using products model
exports.getProductionList = async (req, res) => {
  try {
    const { facilityId, search, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Build where conditions
    let whereConditions = {
      facility_id: facilityId,
      item_type: ["Finished Good", "Raw Material", "Consumable"], // Only production-related items
    };

    // Add search condition if provided
    if (search) {
      whereConditions[db.Sequelize.Op.or] = [
        { name: { [db.Sequelize.Op.like]: `%${search}%` } },
        { sku: { [db.Sequelize.Op.like]: `%${search}%` } },
        { category: { [db.Sequelize.Op.like]: `%${search}%` } },
      ];
    }

    // Get products with pagination
    const { count, rows: products } = await db.Product.findAndCountAll({
      where: whereConditions,
      include: [
        {
          model: db.Supplier,
          as: "supplier",
          attributes: ["id", "name", "contact_person"],
        },
        {
          model: db.Warehouse,
          as: "warehouse",
          attributes: ["id", "name", "location"],
        },
      ],
      order: [["created_at", "DESC"]],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    // Transform data to match ProductionList component expectations
    const productionData = products.map((product, index) => ({
      id: product.id,
      production_id: product.id,
      date: moment(product.created_at).format("YYYY-MM-DD"),
      team: product.category || "General",
      shift: "Day", // Default shift, can be customized based on business logic
      customer_name: product.supplier?.name || "Internal Production",
      customer_id: product.supplier?.id || null,
      product_name: product.name,
      sku: product.sku,
      item_type: product.item_type,
      quantity: product.quantity,
      unit_of_measure: product.unit_of_measure,
      selling_price: product.selling_price,
      cost_price: product.cost_price,
      status: product.status,
      supplier_name: product.supplier?.name,
      warehouse_name: product.warehouse?.name,
      created_at: product.created_at,
      updated_at: product.updated_at,
    }));

    res.status(200).json({
      success: true,
      results: productionData,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Error fetching production list:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching production list",
      error: error.message,
    });
  }
};
