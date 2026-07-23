const db = require("../models");
const moment = require("moment");
const { v4: uuidv4 } = require("uuid");

// Add Finished Goods
exports.addFinishedGoods = async (req, res) => {
  try {
    const {
      facilityId,
      productionOrderId,
      productName,
      batchNo,
      quantity,
      costPerUnit,
      warehouseLocation,
      expiryDate,
      createdBy,
    } = req.body;

    if (!facilityId || !productName || !batchNo || !quantity || !costPerUnit) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: facilityId, productName, batchNo, quantity, costPerUnit",
      });
    }

    const finishedGoodId = `FG-${Date.now()}`;
    const totalCost = quantity * costPerUnit;

    const finishedGoodData = {
      id: finishedGoodId,
      facility_id: facilityId,
      production_order_id: productionOrderId || null,
      product_name: productName,
      batch_no: batchNo,
      quantity: quantity,
      cost_per_unit: costPerUnit,
      total_cost: totalCost,
      status: "available",
      warehouse_location: warehouseLocation || null,
      expiry_date: expiryDate || null,
      created_at: moment().format("YYYY-MM-DD HH:mm:ss"),
    };

    await db.sequelize.query(
      `INSERT INTO finished_goods (id, facility_id, production_order_id, product_name, batch_no, quantity, cost_per_unit, total_cost, status, warehouse_location, expiry_date, created_at)
       VALUES (:id, :facility_id, :production_order_id, :product_name, :batch_no, :quantity, :cost_per_unit, :total_cost, :status, :warehouse_location, :expiry_date, :created_at)`,
      {
        replacements: finishedGoodData,
        type: db.sequelize.QueryTypes.INSERT,
      }
    );

    res.status(201).json({
      success: true,
      data: {
        finishedGoodId,
        batchNo,
        totalCost,
        message: "Finished goods added successfully",
      },
    });
  } catch (error) {
    console.error("Error adding finished goods:", error);
    res.status(500).json({
      success: false,
      message: "Error adding finished goods",
      error: error.message,
    });
  }
};

// Transfer Finished Goods
exports.transferFinishedGoods = async (req, res) => {
  try {
    const {
      facilityId,
      finishedGoodId,
      fromLocation,
      toLocation,
      quantity,
      transferredBy,
      notes,
    } = req.body;

    if (!facilityId || !finishedGoodId || !toLocation || !quantity) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: facilityId, finishedGoodId, toLocation, quantity",
      });
    }

    const transaction = await db.sequelize.transaction();

    try {
      // Check available quantity
      const stockQuery = `SELECT quantity, warehouse_location FROM finished_goods WHERE id = :finishedGoodId AND facility_id = :facilityId`;
      const stockResult = await db.sequelize.query(stockQuery, {
        replacements: { finishedGoodId, facilityId },
        type: db.sequelize.QueryTypes.SELECT,
        transaction,
      });

      if (stockResult.length === 0) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: "Finished goods not found",
        });
      }

      const availableQty = parseFloat(stockResult[0].quantity);
      if (availableQty < quantity) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Insufficient quantity for transfer",
        });
      }

      // Create transfer record
      const transferId = uuidv4();
      const transferData = {
        id: transferId,
        facility_id: facilityId,
        finished_good_id: finishedGoodId,
        from_location: fromLocation || stockResult[0].warehouse_location,
        to_location: toLocation,
        quantity: quantity,
        transferred_by: transferredBy,
        transfer_date: moment().format("YYYY-MM-DD"),
        notes: notes || null,
        created_at: moment().format("YYYY-MM-DD HH:mm:ss"),
      };

      await db.sequelize.query(
        `INSERT INTO finished_good_transfers (id, facility_id, finished_good_id, from_location, to_location, quantity, transferred_by, transfer_date, notes, created_at)
         VALUES (:id, :facility_id, :finished_good_id, :from_location, :to_location, :quantity, :transferred_by, :transfer_date, :notes, :created_at)`,
        {
          replacements: transferData,
          type: db.sequelize.QueryTypes.INSERT,
          transaction,
        }
      );

      // Update finished goods location
      await db.sequelize.query(
        `UPDATE finished_goods SET warehouse_location = :to_location WHERE id = :finished_good_id AND facility_id = :facility_id`,
        {
          replacements: {
            to_location: toLocation,
            finished_good_id: finishedGoodId,
            facility_id: facilityId,
          },
          type: db.sequelize.QueryTypes.UPDATE,
          transaction,
        }
      );

      await transaction.commit();

      res.status(200).json({
        success: true,
        data: {
          transferId,
          message: "Finished goods transferred successfully",
        },
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error("Error transferring finished goods:", error);
    res.status(500).json({
      success: false,
      message: "Error transferring finished goods",
      error: error.message,
    });
  }
};

// Dispatch Finished Goods
exports.dispatchFinishedGoods = async (req, res) => {
  try {
    const {
      facilityId,
      finishedGoodId,
      quantity,
      customerId,
      dispatchDate,
      dispatchedBy,
      notes,
    } = req.body;

    if (!facilityId || !finishedGoodId || !quantity) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: facilityId, finishedGoodId, quantity",
      });
    }

    const transaction = await db.sequelize.transaction();

    try {
      // Check available quantity
      const stockQuery = `SELECT quantity, cost_per_unit FROM finished_goods WHERE id = :finishedGoodId AND facility_id = :facilityId AND status = 'available'`;
      const stockResult = await db.sequelize.query(stockQuery, {
        replacements: { finishedGoodId, facilityId },
        type: db.sequelize.QueryTypes.SELECT,
        transaction,
      });

      if (stockResult.length === 0) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: "Finished goods not found or not available",
        });
      }

      const availableQty = parseFloat(stockResult[0].quantity);
      if (availableQty < quantity) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Insufficient quantity for dispatch",
        });
      }

      // Create dispatch record
      const dispatchId = uuidv4();
      const dispatchData = {
        id: dispatchId,
        facility_id: facilityId,
        finished_good_id: finishedGoodId,
        customer_id: customerId || null,
        quantity: quantity,
        dispatch_date: dispatchDate || moment().format("YYYY-MM-DD"),
        dispatched_by: dispatchedBy,
        notes: notes || null,
        status: "dispatched",
        created_at: moment().format("YYYY-MM-DD HH:mm:ss"),
      };

      await db.sequelize.query(
        `INSERT INTO finished_good_dispatches (id, facility_id, finished_good_id, customer_id, quantity, dispatch_date, dispatched_by, notes, status, created_at)
         VALUES (:id, :facility_id, :finished_good_id, :customer_id, :quantity, :dispatch_date, :dispatched_by, :notes, :status, :created_at)`,
        {
          replacements: dispatchData,
          type: db.sequelize.QueryTypes.INSERT,
          transaction,
        }
      );

      // Update finished goods quantity and status
      const remainingQty = availableQty - quantity;
      const newStatus = remainingQty > 0 ? "available" : "dispatched";

      await db.sequelize.query(
        `UPDATE finished_goods SET quantity = :quantity, status = :status WHERE id = :finished_good_id AND facility_id = :facility_id`,
        {
          replacements: {
            quantity: remainingQty,
            status: newStatus,
            finished_good_id: finishedGoodId,
            facility_id: facilityId,
          },
          type: db.sequelize.QueryTypes.UPDATE,
          transaction,
        }
      );

      // Post to General Ledger for COGS
      const costPerUnit = parseFloat(stockResult[0].cost_per_unit);
      const totalCost = quantity * costPerUnit;

      // Debit COGS
      await db.sequelize.query(
        `INSERT INTO general_ledger (transaction_date, account_code, account_subhead, dr, cr, account_description, transaction_description, reference_number, purpose_of_payment, created_by, facility_id, created_at, status, type, transaction_ref)
         VALUES (:transaction_date, :account_code, :account_subhead, :dr, :cr, :account_description, :transaction_description, :reference_number, :purpose_of_payment, :created_by, :facility_id, :created_at, :status, :type, :transaction_ref)`,
        {
          replacements: {
            transaction_date: moment().format("YYYY-MM-DD"),
            account_code: "501001",
            account_subhead: "501001",
            dr: totalCost,
            cr: 0,
            account_description: "Cost of Goods Sold",
            transaction_description: `Dispatch ${dispatchId}`,
            reference_number: dispatchId,
            purpose_of_payment: "Finished Goods Dispatch",
            created_by: dispatchedBy,
            facility_id: facilityId,
            created_at: moment().format("YYYY-MM-DD HH:mm:ss"),
            status: "saved",
            type: "expenses",
            transaction_ref: dispatchId,
          },
          type: db.sequelize.QueryTypes.INSERT,
          transaction,
        }
      );

      // Credit Finished Goods Inventory
      await db.sequelize.query(
        `INSERT INTO general_ledger (transaction_date, account_code, account_subhead, dr, cr, account_description, transaction_description, reference_number, purpose_of_payment, created_by, facility_id, created_at, status, type, transaction_ref)
         VALUES (:transaction_date, :account_code, :account_subhead, :dr, :cr, :account_description, :transaction_description, :reference_number, :purpose_of_payment, :created_by, :facility_id, :created_at, :status, :type, :transaction_ref)`,
        {
          replacements: {
            transaction_date: moment().format("YYYY-MM-DD"),
            account_code: "201003",
            account_subhead: "201003",
            dr: 0,
            cr: totalCost,
            account_description: "Finished Goods Inventory",
            transaction_description: `Dispatch ${dispatchId}`,
            reference_number: dispatchId,
            purpose_of_payment: "Finished Goods Dispatch",
            created_by: dispatchedBy,
            facility_id: facilityId,
            created_at: moment().format("YYYY-MM-DD HH:mm:ss"),
            status: "saved",
            type: "expenses",
            transaction_ref: dispatchId,
          },
          type: db.sequelize.QueryTypes.INSERT,
          transaction,
        }
      );

      await transaction.commit();

      res.status(200).json({
        success: true,
        data: {
          dispatchId,
          remainingQty,
          totalCost,
          message: "Finished goods dispatched successfully",
        },
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error("Error dispatching finished goods:", error);
    res.status(500).json({
      success: false,
      message: "Error dispatching finished goods",
      error: error.message,
    });
  }
};

// Get Finished Goods
exports.getFinishedGoods = async (req, res) => {
  try {
    const { facilityId, status, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    let whereClause = "WHERE fg.facility_id = :facilityId";
    const replacements = {
      facilityId,
      limit: parseInt(limit),
      offset: parseInt(offset),
    };

    if (status) {
      whereClause += " AND fg.status = :status";
      replacements.status = status;
    }

    const query = `
      SELECT
        fg.*,
        po.order_number,
        po.quantity_planned,
        po.quantity_actual
      FROM finished_goods fg
      LEFT JOIN production_orders po ON fg.production_order_id = po.id
      ${whereClause}
      ORDER BY fg.created_at DESC
      LIMIT :limit OFFSET :offset
    `;

    const finishedGoods = await db.sequelize.query(query, {
      replacements,
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM finished_goods fg ${whereClause}`;
    const countResult = await db.sequelize.query(countQuery, {
      replacements: { facilityId, status },
      type: db.sequelize.QueryTypes.SELECT,
    });

    res.status(200).json({
      success: true,
      data: {
        finishedGoods,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(countResult[0].total / limit),
          totalItems: countResult[0].total,
          itemsPerPage: parseInt(limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching finished goods:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching finished goods",
      error: error.message,
    });
  }
};



