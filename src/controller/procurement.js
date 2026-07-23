const db = require("../models");
const moment = require("moment");
const { v4: uuidv4 } = require("uuid");

// Create Purchase Order
exports.createPurchaseOrder = async (req, res) => {
  try {
    const {
      facilityId,
      supplierId,
      items,
      expectedDeliveryDate,
      notes,
      createdBy,
    } = req.body;

    // Validate required fields
    if (
      !facilityId ||
      !supplierId ||
      !items ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: facilityId, supplierId, items",
      });
    }

    const poId = `PO-${Date.now()}`;
    const transaction = await db.sequelize.transaction();

    try {
      // Calculate total amount
      let totalAmount = 0;
      const poItems = items.map((item) => {
        const itemTotal = item.quantity * item.unitPrice;
        totalAmount += itemTotal;
        return {
          id: uuidv4(),
          po_id: poId,
          material_id: item.materialId,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          total_price: itemTotal,
          created_at: moment().format("YYYY-MM-DD HH:mm:ss"),
        };
      });

      // Create Purchase Order
      const poData = {
        id: poId,
        facility_id: facilityId,
        supplier_number: supplierId,
        po_number: `PO-${Date.now()}`,
        total_amount: totalAmount,
        status: "pending",
        expected_delivery_date: expectedDeliveryDate,
        notes: notes || null,
        created_by: createdBy,
        created_at: moment().format("YYYY-MM-DD HH:mm:ss"),
      };

      await db.sequelize.query(
        `INSERT INTO purchase_orders (id, facility_id, supplier_number, po_number, total_amount, status, expected_delivery_date, notes, created_by, created_at)
         VALUES (:id, :facility_id, :supplier_number, :po_number, :total_amount, :status, :expected_delivery_date, :notes, :created_by, :created_at)`,
        {
          replacements: poData,
          type: db.sequelize.QueryTypes.INSERT,
          transaction,
        }
      );

      // Create PO Items
      for (const item of poItems) {
        await db.sequelize.query(
          `INSERT INTO purchase_order_items (id, po_id, material_id, quantity, unit_price, total_price, created_at)
           VALUES (:id, :po_id, :material_id, :quantity, :unit_price, :total_price, :created_at)`,
          {
            replacements: item,
            type: db.sequelize.QueryTypes.INSERT,
            transaction,
          }
        );
      }

      // Post to General Ledger
      const accountQuery = `SELECT account_code FROM account WHERE head = '201001' AND facilityId = :facilityId LIMIT 1`;
      const accountResult = await db.sequelize.query(accountQuery, {
        replacements: { facilityId },
        type: db.sequelize.QueryTypes.SELECT,
        transaction,
      });

      if (accountResult.length > 0) {
        const accountCode = accountResult[0].account_code;

        // Debit Raw Materials Inventory
        await db.sequelize.query(
          `INSERT INTO general_ledger (transaction_date, account_code, account_subhead, dr, cr, account_description, transaction_description, reference_number, purpose_of_payment, created_by, facility_id, created_at, status, type, transaction_ref)
           VALUES (:transaction_date, :account_code, :account_subhead, :dr, :cr, :account_description, :transaction_description, :reference_number, :purpose_of_payment, :created_by, :facility_id, :created_at, :status, :type, :transaction_ref)`,
          {
            replacements: {
              transaction_date: moment().format("YYYY-MM-DD"),
              account_code: accountCode,
              account_subhead: "201001",
              dr: totalAmount,
              cr: 0,
              account_description: "Raw Materials Inventory",
              transaction_description: `Purchase Order ${poId}`,
              reference_number: poId,
              purpose_of_payment: "Raw Materials Purchase",
              created_by: createdBy,
              facility_id: facilityId,
              created_at: moment().format("YYYY-MM-DD HH:mm:ss"),
              status: "saved",
              type: "expenses",
              transaction_ref: poId,
            },
            type: db.sequelize.QueryTypes.INSERT,
            transaction,
          }
        );

        // Credit Accounts Payable
        await db.sequelize.query(
          `INSERT INTO general_ledger (transaction_date, account_code, account_subhead, dr, cr, account_description, transaction_description, reference_number, purpose_of_payment, created_by, facility_id, created_at, status, type, transaction_ref)
           VALUES (:transaction_date, :account_code, :account_subhead, :dr, :cr, :account_description, :transaction_description, :reference_number, :purpose_of_payment, :created_by, :facility_id, :created_at, :status, :type, :transaction_ref)`,
          {
            replacements: {
              transaction_date: moment().format("YYYY-MM-DD"),
              account_code: "201002",
              account_subhead: "201002",
              dr: 0,
              cr: totalAmount,
              account_description: "Accounts Payable",
              transaction_description: `Purchase Order ${poId}`,
              reference_number: poId,
              purpose_of_payment: "Raw Materials Purchase",
              created_by: createdBy,
              facility_id: facilityId,
              created_at: moment().format("YYYY-MM-DD HH:mm:ss"),
              status: "saved",
              type: "payable",
              transaction_ref: poId,
            },
            type: db.sequelize.QueryTypes.INSERT,
            transaction,
          }
        );
      }

      await transaction.commit();

      res.status(201).json({
        success: true,
        data: {
          poId,
          poNumber: poData.po_number,
          totalAmount,
          message: "Purchase Order created successfully",
        },
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error("Error creating purchase order:", error);
    res.status(500).json({
      success: false,
      message: "Error creating purchase order",
      error: error.message,
    });
  }
};

// Receive Goods (GRN)
exports.receiveGoods = async (req, res) => {
  try {
    const { facilityId, poId, receivedItems, receivedBy, notes } = req.body;

    if (
      !facilityId ||
      !poId ||
      !receivedItems ||
      !Array.isArray(receivedItems)
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: facilityId, poId, receivedItems",
      });
    }

    const grnId = `GRN-${Date.now()}`;
    const transaction = await db.sequelize.transaction();

    try {
      // Create GRN
      const grnData = {
        id: grnId,
        facility_id: facilityId,
        po_id: poId,
        grn_number: `GRN-${Date.now()}`,
        received_by: receivedBy,
        received_date: moment().format("YYYY-MM-DD"),
        notes: notes || null,
        status: "completed",
        created_at: moment().format("YYYY-MM-DD HH:mm:ss"),
      };

      await db.sequelize.query(
        `INSERT INTO goods_received_notes (id, facility_id, po_id, grn_number, received_by, received_date, notes, status, created_at)
         VALUES (:id, :facility_id, :po_id, :grn_number, :received_by, :received_date, :notes, :status, :created_at)`,
        {
          replacements: grnData,
          type: db.sequelize.QueryTypes.INSERT,
          transaction,
        }
      );

      // Process received items
      for (const item of receivedItems) {
        // Create GRN Item
        await db.sequelize.query(
          `INSERT INTO grn_items (id, grn_id, material_id, quantity_received, unit_price, total_price, created_at)
           VALUES (:id, :grn_id, :material_id, :quantity_received, :unit_price, :total_price, :created_at)`,
          {
            replacements: {
              id: uuidv4(),
              grn_id: grnId,
              material_id: item.materialId,
              quantity_received: item.quantityReceived,
              unit_price: item.unitPrice,
              total_price: item.quantityReceived * item.unitPrice,
              created_at: moment().format("YYYY-MM-DD HH:mm:ss"),
            },
            type: db.sequelize.QueryTypes.INSERT,
            transaction,
          }
        );

        // Update material stock
        await db.sequelize.query(
          `UPDATE materials SET stock_qty = stock_qty + :quantity WHERE id = :material_id AND facility_id = :facility_id`,
          {
            replacements: {
              quantity: item.quantityReceived,
              material_id: item.materialId,
              facility_id: facilityId,
            },
            type: db.sequelize.QueryTypes.UPDATE,
            transaction,
          }
        );
      }

      // Update PO status
      await db.sequelize.query(
        `UPDATE purchase_orders SET status = 'completed' WHERE id = :po_id`,
        {
          replacements: { po_id: poId },
          type: db.sequelize.QueryTypes.UPDATE,
          transaction,
        }
      );

      await transaction.commit();

      res.status(200).json({
        success: true,
        data: {
          grnId,
          grnNumber: grnData.grn_number,
          message: "Goods received successfully",
        },
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error("Error receiving goods:", error);
    res.status(500).json({
      success: false,
      message: "Error receiving goods",
      error: error.message,
    });
  }
};

// Get Purchase Orders
exports.getPurchaseOrders = async (req, res) => {
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
        s.supplier_name,
        s.contact_person,
        s.email as supplier_email
      FROM purchase_orders po
      LEFT JOIN suppliersinfo s ON po.supplier_number = s.supplier_number AND po.facility_id = s.facilityId
      ${whereClause}
      ORDER BY po.created_at DESC
      LIMIT :limit OFFSET :offset
    `;

    const purchaseOrders = await db.sequelize.query(query, {
      replacements,
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM purchase_orders po ${whereClause}`;
    const countResult = await db.sequelize.query(countQuery, {
      replacements: { facilityId, status },
      type: db.sequelize.QueryTypes.SELECT,
    });

    res.status(200).json({
      success: true,
      data: {
        purchaseOrders,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(countResult[0].total / limit),
          totalItems: countResult[0].total,
          itemsPerPage: parseInt(limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching purchase orders:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching purchase orders",
      error: error.message,
    });
  }
};

// Get Materials
exports.getMaterials = async (req, res) => {
  try {
    const { facilityId, search, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    let whereClause = "WHERE m.facility_id = :facilityId";
    const replacements = {
      facilityId,
      limit: parseInt(limit),
      offset: parseInt(offset),
    };

    if (search) {
      whereClause += " AND (m.name LIKE :search OR m.sku LIKE :search)";
      replacements.search = `%${search}%`;
    }

    const query = `
      SELECT
        m.*,
        s.supplier_name,
        s.contact_person
      FROM materials m
      LEFT JOIN suppliersinfo s ON m.supplier_id = s.supplier_number AND m.facility_id = s.facilityId
      ${whereClause}
      ORDER BY m.created_at DESC
      LIMIT :limit OFFSET :offset
    `;

    const materials = await db.sequelize.query(query, {
      replacements,
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM materials m ${whereClause}`;
    const countResult = await db.sequelize.query(countQuery, {
      replacements: { facilityId, search },
      type: db.sequelize.QueryTypes.SELECT,
    });

    res.status(200).json({
      success: true,
      data: {
        materials,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(countResult[0].total / limit),
          totalItems: countResult[0].total,
          itemsPerPage: parseInt(limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching materials:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching materials",
      error: error.message,
    });
  }
};
