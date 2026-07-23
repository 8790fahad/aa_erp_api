const db = require("../models");
const moment = require("moment");
const { v4: uuidv4 } = require("uuid");
const { Op } = require("sequelize");
const { Product, Account } = require("../models");
const { getAndUpdateNumber } = require("../services/numberGen");

function costingBatchKey(row = {}) {
  const batch = String(row.batch_no || row.batch_id || "").trim();
  const id = String(row.id || "").trim();
  if (batch) return batch;
  if (/^Batch-/i.test(id)) return id;
  return id;
}

function dedupeCostingRows(rows = []) {
  const byBatchKey = new Map();
  for (const row of rows) {
    const key = costingBatchKey(row);
    if (!key) continue;
    const prev = byBatchKey.get(key);
    if (!prev) {
      byBatchKey.set(key, row);
      continue;
    }
    const rowTime = new Date(row.created_at || 0).getTime();
    const prevTime = new Date(prev.created_at || 0).getTime();
    if (rowTime > prevTime) {
      byBatchKey.set(key, row);
      continue;
    }
    if (rowTime === prevTime) {
      const rowIdMatchesBatch =
        String(row.id || "").trim() === String(row.batch_no || "").trim();
      const prevIdMatchesBatch =
        String(prev.id || "").trim() === String(prev.batch_no || "").trim();
      if (rowIdMatchesBatch && !prevIdMatchesBatch) {
        byBatchKey.set(key, row);
      }
    }
  }
  return Array.from(byBatchKey.values()).sort(
    (a, b) =>
      new Date(b.created_at || 0).getTime() -
      new Date(a.created_at || 0).getTime(),
  );
}

async function cleanupDuplicateCostingRecords(facilityId) {
  const rows = await db.ProductionCostingRecord.findAll({
    where: { facility_id: facilityId },
    order: [["created_at", "DESC"]],
    attributes: ["id", "batch_no", "created_at"],
  });
  const seenKeys = new Set();
  const duplicateIds = [];
  for (const row of rows) {
    const key = costingBatchKey(row);
    if (!key) continue;
    if (seenKeys.has(key)) {
      duplicateIds.push(row.id);
      continue;
    }
    seenKeys.add(key);
  }
  if (duplicateIds.length === 0) return 0;
  await db.ProductionCostingRecord.destroy({
    where: {
      facility_id: facilityId,
      id: { [Op.in]: duplicateIds },
    },
  });
  return duplicateIds.length;
}

exports.createProductionRecord = async (req, res) => {
  try {
    const {
      facilityId,
      productionDate,
      productionLine,
      notes,
      productionItems,
      products, // For joint_shared costing
      sharedCosts, // For joint_shared costing
      sharedJointWaste, // Section-level waste for joint_shared
      output, // For joint_shared costing
      qtyUse,
      runStatus,
      createdBy,
      batchNo,
      costingType,
      sessionHistory,
      templateByProduct,
    } = req.body;

    console.log(req.body, "=============> productionRecords");

    // Validate required fields based on costing type
    if (!facilityId || !productionDate) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: facilityId, productionDate",
      });
    }

    // For joint_shared, check for products; for job_specific, check for productionItems
    let dataToStore;
    if (costingType === "joint_shared") {
      if (!products || !Array.isArray(products) || products.length === 0) {
        return res.status(400).json({
          success: false,
          message:
            "Missing required fields: products (for joint_shared costing)",
        });
      }
      // Build complete data structure for joint_shared
      dataToStore = {
        costingType: "joint_shared",
        output: output || 1,
        qtyUse: qtyUse || 1,
        runStatus: runStatus || "complete",
        sharedCosts: sharedCosts || [],
        products: products,
        sharedJointWaste:
          sharedJointWaste && typeof sharedJointWaste === "object"
            ? sharedJointWaste
            : null,
        ...(templateByProduct && typeof templateByProduct === "object"
          ? { templateByProduct }
          : {}),
      };
    } else {
      if (
        !productionItems ||
        !Array.isArray(productionItems) ||
        productionItems.length === 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Missing required fields: productionItems",
        });
      }
      dataToStore = {
        costingType: "job_specific",
        runStatus: runStatus || "complete",
        products: productionItems,
      };
    }

    const resolvedBatchNo =
      batchNo ||
      `Batch-${String(await getAndUpdateNumber("production_batch", facilityId)).padStart(5, "0")}`;
    const productionRecordId = resolvedBatchNo;
    const existingRecord = await db.ProductionRecord.findByPk(productionRecordId);
    const existingData = existingRecord?.dataValues?.data || {};
    const normalizedSessionHistory = Array.isArray(sessionHistory)
      ? sessionHistory
      : Array.isArray(existingData.sessionHistory)
        ? existingData.sessionHistory
        : [];
    dataToStore.sessionHistory = normalizedSessionHistory;
    dataToStore.batchNo = resolvedBatchNo;
    const transaction = await db.sequelize.transaction();

    try {
      const linkedBatchNo = resolvedBatchNo;
      const basePayload = {
        id: productionRecordId,
        facility_id: facilityId,
        production_date: productionDate,
        production_line: productionLine || null,
        batch_no: linkedBatchNo,
        notes: notes || null,
        type: costingType || "job_specific",
        data: dataToStore,
        status: runStatus === "partial" ? "draft" : "completed",
        created_by: createdBy,
        updated_at: moment().toDate(),
      };

      await db.ProductionRecord.upsert(
        {
          ...basePayload,
          created_at: moment().toDate(),
        },
        { transaction },
      );

      // Mirror into dedicated costing table (one row per batch).
      if (db.ProductionCostingRecord) {
        const existingCosting = await db.ProductionCostingRecord.findOne({
          where: { facility_id: facilityId, batch_no: linkedBatchNo },
          transaction,
        });
        const costingPayload = {
          ...basePayload,
          status: "draft",
          updated_at: moment().toDate(),
        };
        let keptCostingId;
        if (existingCosting) {
          keptCostingId = existingCosting.id;
          await existingCosting.update(costingPayload, { transaction });
        } else {
          keptCostingId = uuidv4();
          await db.ProductionCostingRecord.create(
            {
              ...costingPayload,
              id: keptCostingId,
              created_at: moment().toDate(),
            },
            { transaction },
          );
        }
        await db.ProductionCostingRecord.destroy({
          where: {
            facility_id: facilityId,
            batch_no: linkedBatchNo,
            id: { [Op.ne]: keptCostingId },
          },
          transaction,
        });
      }

      await transaction.commit();
      res.status(201).json({
        success: true,
        data: {
          productionRecordId,
          message: "Production record saved successfully",
        },
      });
    } catch (error) {
      await transaction.rollback();
      console.error("Error creating production record:", error);
      res.status(500).json({
        success: false,
        message: "Error creating production record",
        error: error.message,
      });
    }
  } catch (error) {
    console.error("Error creating production record:", error);
    res.status(500).json({
      success: false,
      message: "Error creating production record",
      error: error.message,
    });
  }
};

// Get Production Costing Records (isolated for markup/costing page)
exports.getProductionCostingRecords = async (req, res) => {
  try {
    const { facilityId, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    await cleanupDuplicateCostingRecords(facilityId);

    const query = `
      SELECT
        pr.*,
        COALESCE(
          pr.batch_no,
          JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.batchNo')),
          pr.id
        ) AS batch_id,
        CAST(JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.products[0].finishedGoods[0].goodQuantity')) AS DECIMAL(18,4)) AS good_qty,
        CAST(JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.products[0].finishedGoods[0].wasteQuantity')) AS DECIMAL(18,4)) AS waste_qty,
        CAST(JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.products[0].finishedGoods[0].yieldPct')) AS DECIMAL(10,2)) AS yield_pct,
        JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.runStatus')) AS run_status,
        (
          SELECT CONCAT(u.firstname, ' ', u.lastname)
          FROM users u
          WHERE u.id = pr.created_by
          LIMIT 1
        ) AS creator_name
      FROM production_costing_records pr
      WHERE pr.facility_id = :facilityId
        AND LOWER(COALESCE(pr.status, '')) <> 'rejected'
      ORDER BY pr.created_at DESC
    `;

    const productionRecordsRaw = await db.sequelize.query(query, {
      replacements: {
        facilityId,
      },
      type: db.sequelize.QueryTypes.SELECT,
    });

    const dedupedRecords = dedupeCostingRows(productionRecordsRaw);
    const offsetNum = parseInt(offset, 10);
    const limitNum = parseInt(limit, 10);
    const productionRecords = dedupedRecords.slice(
      offsetNum,
      offsetNum + limitNum,
    );

    res.status(200).json({
      success: true,
      data: {
        productionRecords,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(dedupedRecords.length / limitNum) || 1,
          totalItems: dedupedRecords.length,
          itemsPerPage: limitNum,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching production costing records:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching production costing records",
      error: error.message,
    });
  }
};

// Get Production Records
exports.getProductionRecords = async (req, res) => {
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
        pr.*,
        CAST(
          COALESCE(
            JSON_UNQUOTE(
              JSON_EXTRACT(
                pr.data,
                CONCAT(
                  '$.sessionHistory[',
                  GREATEST(
                    COALESCE(JSON_LENGTH(JSON_EXTRACT(pr.data, '$.sessionHistory')), 0) - 1,
                    0
                  ),
                  '].goodQty'
                )
              )
            ),
            JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.products[0].finishedGoods[0].goodQuantity'))
          ) AS DECIMAL(18,4)
        ) AS good_qty,
        CAST(
          COALESCE(
            JSON_UNQUOTE(
              JSON_EXTRACT(
                pr.data,
                CONCAT(
                  '$.sessionHistory[',
                  GREATEST(
                    COALESCE(JSON_LENGTH(JSON_EXTRACT(pr.data, '$.sessionHistory')), 0) - 1,
                    0
                  ),
                  '].brokenQty'
                )
              )
            ),
            JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.products[0].finishedGoods[0].wasteQuantity'))
          ) AS DECIMAL(18,4)
        ) AS waste_qty,
        CAST(JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.products[0].finishedGoods[0].yieldPct')) AS DECIMAL(10,2)) AS yield_pct,
        JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.runStatus')) AS run_status,
        CONCAT(u.firstname, ' ', u.lastname) as creator_name
      FROM production_records pr
      LEFT JOIN users u ON pr.created_by = u.id
      WHERE pr.facility_id = :facilityId
      ORDER BY pr.created_at DESC
      LIMIT :limit OFFSET :offset
    `;

    const productionRecords = await db.sequelize.query(query, {
      replacements: {
        facilityId,
        limit: parseInt(limit),
        offset: parseInt(offset),
      },
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM production_records WHERE facility_id = :facilityId`;
    const countResult = await db.sequelize.query(countQuery, {
      replacements: { facilityId },
      type: db.sequelize.QueryTypes.SELECT,
    });

    res.status(200).json({
      success: true,
      data: {
        productionRecords,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(countResult[0].total / limit),
          totalItems: countResult[0].total,
          itemsPerPage: parseInt(limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching production records:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching production records",
      error: error.message,
    });
  }
};

// Get Production Record by ID with Details
exports.getProductionRecordById = async (req, res) => {
  try {
    const { id, facilityId } = req.query;

    if (!id || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "id and facilityId are required",
      });
    }

    // Get production record details
    const recordQuery = `
      SELECT
        pr.*,
        CONCAT(u.firstname, ' ', u.lastname) as creator_name
      FROM production_records pr
      LEFT JOIN users u ON pr.created_by = u.id
      WHERE pr.id = :id AND pr.facility_id = :facilityId
    `;

    const recordResult = await db.sequelize.query(recordQuery, {
      replacements: { id, facilityId },
      type: db.sequelize.QueryTypes.SELECT,
    });

    if (recordResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Production record not found",
      });
    }

    const productionRecord = recordResult[0];

    // Get finished goods
    const finishedGoodsQuery = `
      SELECT *
      FROM production_record_items
      WHERE production_record_id = :id
      ORDER BY created_at ASC
    `;

    const finishedGoods = await db.sequelize.query(finishedGoodsQuery, {
      replacements: { id },
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Get WIP consumption
    const wipConsumptionQuery = `
      SELECT *
      FROM production_consumptions
      WHERE production_record_id = :id
      ORDER BY created_at ASC
    `;

    const wipConsumption = await db.sequelize.query(wipConsumptionQuery, {
      replacements: { id },
      type: db.sequelize.QueryTypes.SELECT,
    });

    res.status(200).json({
      success: true,
      data: {
        productionRecord,
        finishedGoods,
        wipConsumption,
      },
    });
  } catch (error) {
    console.error("Error fetching production record:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching production record",
      error: error.message,
    });
  }
};

// Get Finished Goods from WIP (Work in Progress) - Get from store_entries
exports.getFinishedGoodsFromWIP = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Query to get finished goods from store_entries where they are added as production output
    const query = `
      SELECT
        se.*,
        p.name as product_name,
        p.category,
        p.sku,
        pm.multiplier_value as applied_multiplier
      FROM store_entries se
      LEFT JOIN products p ON se.product_id = p.sku
      LEFT JOIN product_multipliers pm ON se.multiplier_id = pm.id
      WHERE se.facilityId = :facilityId
        AND se.store_type = 'Production'
        AND se.subhead = 'Finished Goods'
        AND se.transaction_type = 'IN'
      ORDER BY se.inserted_time DESC
    `;

    const finishedGoods = await db.sequelize.query(query, {
      replacements: { facilityId },
      type: db.sequelize.QueryTypes.SELECT,
    });

    res.status(200).json({
      success: true,
      data: finishedGoods,
    });
  } catch (error) {
    console.error("Error fetching finished goods from WIP:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching finished goods from WIP",
      error: error.message,
    });
  }
};

// Get Production Items
exports.getProductionItems = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Query to get all production items (finished goods and WIP consumption)
    const query = `
      SELECT
        pri.*,
        pr.production_date,
        pr.production_line,
        pr.status as production_status,
        'finished_good' as item_type
      FROM production_record_items pri
      JOIN production_records pr ON pri.production_record_id = pr.id
      WHERE pr.facility_id = :facilityId
        AND pr.status = 'completed'

      UNION ALL

      SELECT
        pc.product_id,
        pc.product_name,
        pc.quantity,
        pc.unit_cost,
        pc.total_cost,
        pc.created_at,
        pr.production_date,
        pr.production_line,
        pr.status as production_status,
        'wip_consumption' as item_type
      FROM production_consumptions pc
      JOIN production_records pr ON pc.production_record_id = pr.id
      WHERE pr.facility_id = :facilityId
        AND pr.status = 'completed'

      ORDER BY production_date DESC
    `;

    const productionItems = await db.sequelize.query(query, {
      replacements: { facilityId },
      type: db.sequelize.QueryTypes.SELECT,
    });

    res.status(200).json({
      success: true,
      data: productionItems,
    });
  } catch (error) {
    console.error("Error fetching production items:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching production items",
      error: error.message,
    });
  }
};

/**
 * Reject a draft costing record so it leaves the Costing queue and
 * is excluded from production reports. Syncs manufacturing record status.
 */
exports.rejectCostingRecord = async (req, res) => {
  const { id } = req.params;
  const facilityId = req.body?.facilityId || req.query?.facilityId;
  const reason = String(req.body?.reason || "").trim();

  if (!id) {
    return res.status(400).json({
      success: false,
      message: "Costing record id is required",
    });
  }
  if (!facilityId) {
    return res.status(400).json({
      success: false,
      message: "facilityId is required",
    });
  }

  let transaction;
  try {
    transaction = await db.sequelize.transaction();

    const costing = await db.ProductionCostingRecord.findOne({
      where: { id, facility_id: facilityId },
      transaction,
    });

    if (!costing) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Costing record not found",
      });
    }

    const currentStatus = String(costing.status || "").toLowerCase();
    if (currentStatus === "rejected") {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "This batch is already rejected",
      });
    }
    if (currentStatus === "completed") {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Completed batches cannot be rejected",
      });
    }

    const batchNo = String(costing.batch_no || "").trim();
    const now = new Date();
    let nextData = costing.data;
    try {
      const parsed =
        typeof costing.data === "string"
          ? JSON.parse(costing.data || "{}")
          : costing.data || {};
      nextData = {
        ...parsed,
        rejectedAt: now.toISOString(),
        ...(reason ? { rejectReason: reason } : {}),
      };
    } catch (_) {
      nextData = costing.data;
    }

    await costing.update(
      {
        status: "rejected",
        data: nextData,
        updated_at: now,
      },
      { transaction },
    );

    if (db.ProductionManufacturingRecord) {
      const orClauses = [{ id }];
      if (batchNo) {
        orClauses.push({ batch_no: batchNo });
        orClauses.push({ id: batchNo });
      }

      const mfgRows = await db.ProductionManufacturingRecord.findAll({
        where: {
          facility_id: facilityId,
          [Op.or]: orClauses,
        },
        transaction,
      });

      for (const mfg of mfgRows) {
        let mfgData = mfg.data;
        try {
          const parsed =
            typeof mfg.data === "string"
              ? JSON.parse(mfg.data || "{}")
              : mfg.data || {};
          mfgData = {
            ...parsed,
            rejectedAt: now.toISOString(),
            ...(reason ? { rejectReason: reason } : {}),
          };
        } catch (_) {
          mfgData = mfg.data;
        }
        await mfg.update(
          {
            status: "rejected",
            data: mfgData,
            updated_at: now,
          },
          { transaction },
        );
      }
    }

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "Batch rejected successfully",
      data: {
        id: costing.id,
        batch_no: batchNo || costing.id,
        status: "rejected",
      },
    });
  } catch (error) {
    console.error("Error rejecting costing record:", error);
    if (transaction) await transaction.rollback().catch(() => {});
    return res.status(500).json({
      success: false,
      message: "Failed to reject costing record",
      error: error.message,
    });
  }
};
