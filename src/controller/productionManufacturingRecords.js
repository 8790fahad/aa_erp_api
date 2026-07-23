const db = require("../models");
const moment = require("moment");
const { v4: uuidv4 } = require("uuid");
const { Op } = require("sequelize");
const { getAndUpdateNumber } = require("../services/numberGen");

function manufacturingBatchKey(row = {}) {
  const batch = String(row.batch_no || "").trim();
  const id = String(row.id || "").trim();
  if (batch) return batch;
  if (/^Batch-/i.test(id)) return id;
  return id;
}

function dedupeManufacturingRows(rows = []) {
  const byBatchKey = new Map();
  for (const row of rows) {
    const key = manufacturingBatchKey(row);
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

async function cleanupDuplicateManufacturingRecords(facilityId) {
  const rows = await db.ProductionManufacturingRecord.findAll({
    where: { facility_id: facilityId },
    order: [["created_at", "DESC"]],
    attributes: ["id", "batch_no", "created_at"],
  });
  const seenKeys = new Set();
  const duplicateIds = [];
  for (const row of rows) {
    const key = manufacturingBatchKey(row);
    if (!key) continue;
    if (seenKeys.has(key)) {
      duplicateIds.push(row.id);
      continue;
    }
    seenKeys.add(key);
  }
  if (duplicateIds.length === 0) return 0;
  await db.ProductionManufacturingRecord.destroy({
    where: {
      facility_id: facilityId,
      id: { [Op.in]: duplicateIds },
    },
  });
  return duplicateIds.length;
}

exports.createManufacturingRecord = async (req, res) => {
  try {
    const {
      facilityId,
      productionDate,
      productionLine,
      notes,
      productionItems,
      products,
      sharedCosts,
      output,
      qtyUse,
      runStatus,
      createdBy,
      batchNo,
      costingType,
      sessionHistory,
      runMetrics,
      templateByProduct,
      sharedJointWaste,
    } = req.body;

    if (!facilityId || !productionDate) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: facilityId, productionDate",
      });
    }

    let dataToStore;
    if (costingType === "joint_shared") {
      if (!products || !Array.isArray(products) || products.length === 0) {
        return res.status(400).json({
          success: false,
          message:
            "Missing required fields: products (for joint_shared costing)",
        });
      }
      dataToStore = {
        costingType: "joint_shared",
        output: output || 1,
        qtyUse: qtyUse || 1,
        runStatus: runStatus || "complete",
        sharedCosts: sharedCosts || [],
        products,
        ...(templateByProduct ? { templateByProduct } : {}),
        ...(sharedJointWaste ? { sharedJointWaste } : {}),
        ...(runMetrics && typeof runMetrics === "object" ? { runMetrics } : {}),
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
        ...(runMetrics && typeof runMetrics === "object" ? { runMetrics } : {}),
      };
    }

    const resolvedBatchNo =
      batchNo ||
      `Batch-${String(await getAndUpdateNumber("production_batch", facilityId)).padStart(5, "0")}`;
    const productionRecordId = resolvedBatchNo;
    const existingRecord = await db.ProductionManufacturingRecord.findByPk(
      productionRecordId,
    );
    const existingData = existingRecord?.dataValues?.data || {};
    const normalizedSessionHistory = Array.isArray(sessionHistory)
      ? sessionHistory
      : Array.isArray(existingData.sessionHistory)
        ? existingData.sessionHistory
        : [];
    dataToStore.sessionHistory = normalizedSessionHistory;
    dataToStore.batchNo = resolvedBatchNo;

    const linkedBatchNo = resolvedBatchNo;
    const payload = {
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

    const transaction = await db.sequelize.transaction();
    try {
      // Remove legacy duplicate rows that share the same batch number but a different id.
      await db.ProductionManufacturingRecord.destroy({
        where: {
          facility_id: facilityId,
          batch_no: linkedBatchNo,
          id: { [Op.ne]: productionRecordId },
        },
        transaction,
      });

      await db.ProductionManufacturingRecord.upsert(
        {
          ...payload,
          created_at: moment().toDate(),
        },
        { transaction },
      );

      // Mirror manufacturing records into costing records (one row per batch).
      if (db.ProductionCostingRecord) {
        const existingCosting = await db.ProductionCostingRecord.findOne({
          where: { facility_id: facilityId, batch_no: linkedBatchNo },
          transaction,
        });
        const costingPayload = {
          ...payload,
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
    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    res.status(201).json({
      success: true,
      data: {
        productionRecordId,
        message: "Manufacturing record saved successfully",
      },
    });
  } catch (error) {
    console.error("Error creating manufacturing record:", error);
    res.status(500).json({
      success: false,
      message: "Error creating manufacturing record",
      error: error.message,
    });
  }
};

exports.getManufacturingRecords = async (req, res) => {
  try {
    const { facilityId, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    await cleanupDuplicateManufacturingRecords(facilityId);

    const query = `
      SELECT
        pr.*,
        CAST(
          COALESCE(
            JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.runMetrics.goodQty')),
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
            JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.runMetrics.wasteQty')),
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
        CAST(
          COALESCE(
            JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.runMetrics.yieldPct')),
            JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.products[0].finishedGoods[0].yieldPct'))
          ) AS DECIMAL(10,2)
        ) AS yield_pct,
        JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.runStatus')) AS run_status,
        (
          SELECT CONCAT(u.firstname, ' ', u.lastname)
          FROM users u
          WHERE u.id = pr.created_by
          LIMIT 1
        ) AS creator_name
      FROM production_manufacturing_records pr
      WHERE pr.facility_id = :facilityId
      ORDER BY pr.created_at DESC
    `;

    const productionRecordsRaw = await db.sequelize.query(query, {
      replacements: {
        facilityId,
      },
      type: db.sequelize.QueryTypes.SELECT,
    });

    const dedupedRecords = dedupeManufacturingRows(productionRecordsRaw);
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
    console.error("Error fetching manufacturing records:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching manufacturing records",
      error: error.message,
    });
  }
};

/**
 * Mark an incomplete (partial) manufacturing run as closed.
 * Closed runs cannot be resumed.
 */
exports.closeManufacturingRun = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId } = req.body || {};

    if (!id || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "id and facilityId are required",
      });
    }

    const record = await db.ProductionManufacturingRecord.findOne({
      where: { id, facility_id: facilityId },
    });

    if (!record) {
      return res.status(404).json({
        success: false,
        message: "Manufacturing record not found",
      });
    }

    let data = record.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        data = {};
      }
    }
    if (!data || typeof data !== "object") data = {};

    const current = String(data.runStatus || record.status || "")
      .trim()
      .toLowerCase();
    if (current === "closed" || current === "close") {
      return res.json({
        success: true,
        message: "Run is already closed",
        data: { id: record.id, runStatus: "closed" },
      });
    }
    if (current === "complete" || current === "completed") {
      return res.status(400).json({
        success: false,
        message: "Completed runs cannot be closed — they are already finished",
      });
    }

    data.runStatus = "closed";
    await record.update({
      data,
      updated_at: moment().toDate(),
    });

    return res.json({
      success: true,
      message: "Manufacturing run closed",
      data: { id: record.id, runStatus: "closed" },
    });
  } catch (error) {
    console.error("Error closing manufacturing run:", error);
    return res.status(500).json({
      success: false,
      message: "Error closing manufacturing run",
      error: error.message,
    });
  }
};
