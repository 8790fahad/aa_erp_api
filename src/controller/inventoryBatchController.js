const db = require("../models");
const InventoryValuationService = require("../services/InventoryValuationService");
const { v4: uuidv4 } = require("uuid");
const moment = require("moment");
const { STORE_ENTRY_TYPE } = require("../constants/storeEntryTypes");

// Get inventory list with batch tracking
exports.getInventoryWithBatches = async (req, res) => {
  try {
    const { facilityId, page = 1, limit = 10, search = "" } = req.query;
    const offset = (page - 1) * limit;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Build where conditions for search
    let productWhere = {
      facility_id: facilityId,
    };

    if (search) {
      productWhere[db.Sequelize.Op.or] = [
        { name: { [db.Sequelize.Op.like]: `%${search}%` } },
        { sku: { [db.Sequelize.Op.like]: `%${search}%` } },
        { category: { [db.Sequelize.Op.like]: `%${search}%` } },
      ];
    }

    // Get products with pagination
    const { count, rows: products } = await db.Product.findAndCountAll({
      where: productWhere,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["created_at", "DESC"]],
      include: [
        {
          model: db.InventoryBatch,
          as: "batches",
          where: {
            status: "ACTIVE",
            quantity_on_hand: {
              [db.Sequelize.Op.gt]: 0,
            },
          },
          required: false,
        },
      ],
    });

    // Calculate inventory data for each product
    const inventoryData = await Promise.all(
      products.map(async (product) => {
        // Get current valuation
        const valuation = await InventoryValuationService.getCurrentValuation(
          product.id,
          facilityId
        );

        // Get batch count
        const activeBatches = product.batches
          ? product.batches.filter((batch) => batch.status === "ACTIVE")
          : [];

        return {
          id: product.id,
          uuid: product.uuid,
          sku: product.sku,
          name: product.name,
          category: product.category,
          item_type: product.item_type,
          unit_of_measure: product.unit_of_measure,
          selling_price: product.selling_price,
          cost_price: product.cost_price,
          reorder_level: product.reorder_level,
          status: product.status,
          quantity_on_hand: valuation.quantity_on_hand || 0,
          avg_unit_cost: valuation.avg_unit_cost || 0,
          total_value: valuation.total_value || 0,
          valuation_method: valuation.valuation_method || "WAC",
          active_batches: activeBatches.length,
          created_at: product.created_at,
          updated_at: product.updated_at,
        };
      })
    );

    res.status(200).json({
      success: true,
      data: inventoryData,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Error fetching inventory with batches:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching inventory data",
      error: error.message,
    });
  }
};

// Get detailed inventory item with batch information
exports.getInventoryItemDetails = async (req, res) => {
  try {
    const { productId, facilityId } = req.query;

    if (!productId || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "productId and facilityId are required",
      });
    }

    // Get product details
    const product = await db.Product.findByPk(productId, {
      include: [
        {
          model: db.InventoryBatch,
          as: "batches",
          where: {
            facility_id: facilityId,
          },
          required: false,
        },
      ],
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Get current valuation
    const valuation = await InventoryValuationService.getCurrentValuation(
      productId,
      facilityId
    );

    // Get batch details
    const batches = await InventoryValuationService.getProductBatches(
      productId,
      facilityId
    );

    // Calculate batch summary
    const batchSummary = {
      total_batches: batches.length,
      active_batches: batches.filter((b) => b.status === "ACTIVE").length,
      expired_batches: batches.filter((b) => b.status === "EXPIRED").length,
      total_quantity: batches.reduce(
        (sum, batch) => sum + parseFloat(batch.quantity_on_hand || 0),
        0
      ),
    };

    res.status(200).json({
      success: true,
      data: {
        product: {
          id: product.id,
          uuid: product.uuid,
          sku: product.sku,
          name: product.name,
          category: product.category,
          item_type: product.item_type,
          unit_of_measure: product.unit_of_measure,
          selling_price: product.selling_price,
          cost_price: product.cost_price,
          reorder_level: product.reorder_level,
          status: product.status,
          created_at: product.created_at,
          updated_at: product.updated_at,
        },
        valuation: {
          quantity_on_hand: valuation.quantity_on_hand || 0,
          avg_unit_cost: valuation.avg_unit_cost || 0,
          total_value: valuation.total_value || 0,
          valuation_method: valuation.valuation_method || "WAC",
        },
        batch_summary: batchSummary,
        batches: batches,
      },
    });
  } catch (error) {
    console.error("Error fetching inventory item details:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching inventory item details",
      error: error.message,
    });
  }
};

// Receive inventory (create new batch)
exports.receiveInventory = async (req, res) => {
  try {
    const {
      productId,
      facilityId,
      quantity,
      unitCost,
      receiptDate,
      expiryDate,
      supplierId,
      batchNumber,
      location,
      supplierBatchNumber,
    } = req.body;

    if (
      !productId ||
      !facilityId ||
      !quantity ||
      !unitCost ||
      !receiptDate
    ) {
      return res.status(400).json({
        success: false,
        message:
          "productId, facilityId, quantity, unitCost, and receiptDate are required",
      });
    }

    const transaction = await db.sequelize.transaction();

    try {
      // Get product
      const product = await db.Product.findByPk(productId, {
        transaction,
      });

      if (!product) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      // Generate batch number if not provided
      const generatedBatchNumber = batchNumber || `BATCH-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      // Create new batch
      const batch = await db.InventoryBatch.create(
        {
          batch_number: generatedBatchNumber,
          product_id: productId,
          facility_id: facilityId,
          quantity_on_hand: quantity,
          unit_cost: unitCost,
          total_value: quantity * unitCost,
          receipt_date: receiptDate,
          expiry_date: expiryDate || null,
          supplier_batch_number: supplierBatchNumber || null,
          supplier_id: supplierId || null,
          location: location || null,
          status: expiryDate && new Date(expiryDate) < new Date() ? "EXPIRED" : "ACTIVE",
        },
        { transaction }
      );

      // Create store entry for this receipt
      const storeEntry = await db.StoreEntry.create(
        {
          product_id: productId,
          batch_id: batch.id,
          qty_in: quantity,
          qty_out: 0,
          transaction_type: "IN",
          cost_price: unitCost,
          selling_price: product.selling_price || 0,
          source: "Purchase",
          destination: location || "Warehouse",
          facilityId: facilityId,
          inserted_time: new Date(),
          inserted_by: req.user?.id || "system",
          reference_number: generatedBatchNumber,
          po_no: `PO-${Date.now()}`,
          status: "Active",
          activation: "Active",
          type: STORE_ENTRY_TYPE.PURCHASE,
        },
        { transaction }
      );

      // Update product valuation
      await InventoryValuationService.updateValuation(
        productId,
        facilityId,
        "WAC" // Default to WAC
      );

      await transaction.commit();

      res.status(201).json({
        success: true,
        data: {
          batch,
          storeEntry,
          message: "Inventory received successfully",
        },
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error("Error receiving inventory:", error);
    res.status(500).json({
      success: false,
      message: "Error receiving inventory",
      error: error.message,
    });
  }
};

// Issue inventory (reduce from batches)
exports.issueInventory = async (req, res) => {
  try {
    const { productId, facilityId, quantity, method = "FIFO" } = req.body;

    if (!productId || !facilityId || !quantity) {
      return res.status(400).json({
        success: false,
        message: "productId, facilityId, and quantity are required",
      });
    }

    const transaction = await db.sequelize.transaction();

    try {
      // Get product
      const product = await db.Product.findByPk(productId, {
        transaction,
      });

      if (!product) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      // Get current valuation to check available quantity
      const valuation = await InventoryValuationService.getCurrentValuation(
        productId,
        facilityId
      );

      if (parseFloat(valuation.quantity_on_hand) < parseFloat(quantity)) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Insufficient inventory available",
        });
      }

      // Get batches based on valuation method
      let batchesToIssue = [];
      let remainingQuantity = parseFloat(quantity);

      if (method === "FIFO") {
        // Get batches ordered by receipt date (oldest first)
        const batches = await db.InventoryBatch.findAll({
          where: {
            product_id: productId,
            facility_id: facilityId,
            status: "ACTIVE",
            quantity_on_hand: {
              [db.Sequelize.Op.gt]: 0,
            },
          },
          order: [["receipt_date", "ASC"]],
          transaction,
        });

        for (const batch of batches) {
          if (remainingQuantity <= 0) break;

          const batchQuantity = parseFloat(batch.quantity_on_hand);
          const issueQuantity = Math.min(batchQuantity, remainingQuantity);

          batchesToIssue.push({
            batchId: batch.id,
            issueQuantity,
            unitCost: parseFloat(batch.unit_cost),
          });

          remainingQuantity -= issueQuantity;
        }
      } else {
        // For WAC and SPECIFIC, we'll simplify the logic
        const batches = await db.InventoryBatch.findAll({
          where: {
            product_id: productId,
            facility_id: facilityId,
            status: "ACTIVE",
            quantity_on_hand: {
              [db.Sequelize.Op.gt]: 0,
            },
          },
          transaction,
        });

        // Distribute quantity across batches proportionally
        const totalAvailable = batches.reduce(
          (sum, batch) => sum + parseFloat(batch.quantity_on_hand),
          0
        );

        for (const batch of batches) {
          if (remainingQuantity <= 0) break;

          const batchQuantity = parseFloat(batch.quantity_on_hand);
          const proportionalIssue = (batchQuantity / totalAvailable) * parseFloat(quantity);
          const issueQuantity = Math.min(batchQuantity, proportionalIssue, remainingQuantity);

          batchesToIssue.push({
            batchId: batch.id,
            issueQuantity,
            unitCost: parseFloat(batch.unit_cost),
          });

          remainingQuantity -= issueQuantity;
        }
      }

      // Create store entries for each batch issuance
      const storeEntries = [];
      let totalCost = 0;

      for (const batchInfo of batchesToIssue) {
        const batch = await db.InventoryBatch.findByPk(
          batchInfo.batchId,
          { transaction }
        );

        // Update batch quantity
        const newQuantity = parseFloat(batch.quantity_on_hand) - batchInfo.issueQuantity;
        await batch.update(
          {
            quantity_on_hand: newQuantity,
            total_value: newQuantity * parseFloat(batch.unit_cost),
            status: newQuantity <= 0 ? "SOLD" : batch.status,
            updated_at: new Date(),
          },
          { transaction }
        );

        // Create store entry
        const storeEntry = await db.StoreEntry.create(
          {
            product_id: productId,
            batch_id: batchInfo.batchId,
            qty_in: 0,
            qty_out: batchInfo.issueQuantity,
            transaction_type: "OUT",
            cost_price: batchInfo.unitCost,
            selling_price: product.selling_price || 0,
            source: "Warehouse",
            destination: "Usage",
            facilityId: facilityId,
            inserted_time: new Date(),
            inserted_by: req.user?.id || "system",
            reference_number: `ISSUE-${Date.now()}`,
            po_no: `ISSUE-${Date.now()}`,
            status: "Active",
            activation: "Active",
            type: STORE_ENTRY_TYPE.ADJUSTMENT,
          },
          { transaction }
        );
        totalCost += batchInfo.issueQuantity * batchInfo.unitCost;
      }

      // Update product valuation
      await InventoryValuationService.updateValuation(
        productId,
        facilityId,
        method
      );

      await transaction.commit();

      res.status(200).json({
        success: true,
        data: {
          storeEntries,
          totalCost,
          batchesIssued: batchesToIssue.length,
          message: "Inventory issued successfully",
        },
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error("Error issuing inventory:", error);
    res.status(500).json({
      success: false,
      message: "Error issuing inventory",
      error: error.message,
    });
  }
};

// Get low stock alerts
exports.getLowStockAlerts = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Get products with stock below reorder level
    const lowStockItems = await db.Product.findAll({
      where: {
        facility_id: facilityId,
      },
      include: [
        {
          model: db.InventoryValuation,
          as: "valuation",
          where: {
            quantity_on_hand: {
              [db.Sequelize.Op.lte]: db.Sequelize.col("reorder_level"),
            },
            quantity_on_hand: {
              [db.Sequelize.Op.gt]: 0,
            },
          },
          required: true,
        },
      ],
      order: [["valuation", "quantity_on_hand", "ASC"]],
    });

    const formattedItems = lowStockItems.map((item) => ({
      id: item.id,
      sku: item.sku,
      name: item.name,
      category: item.category,
      current_stock: item.valuation.quantity_on_hand,
      reorder_level: item.reorder_level,
      unit_of_measure: item.unit_of_measure,
      status: "LOW_STOCK",
    }));

    res.status(200).json({
      success: true,
      data: formattedItems,
      count: formattedItems.length,
    });
  } catch (error) {
    console.error("Error fetching low stock alerts:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching low stock alerts",
      error: error.message,
    });
  }
};

// Get out of stock items
exports.getOutOfStockItems = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Get products with zero stock
    const outOfStockItems = await db.Product.findAll({
      where: {
        facility_id: facilityId,
      },
      include: [
        {
          model: db.InventoryValuation,
          as: "valuation",
          where: {
            quantity_on_hand: 0,
          },
          required: true,
        },
      ],
      order: [["name", "ASC"]],
    });

    const formattedItems = outOfStockItems.map((item) => ({
      id: item.id,
      sku: item.sku,
      name: item.name,
      category: item.category,
      current_stock: 0,
      reorder_level: item.reorder_level,
      unit_of_measure: item.unit_of_measure,
      status: "OUT_OF_STOCK",
    }));

    res.status(200).json({
      success: true,
      data: formattedItems,
      count: formattedItems.length,
    });
  } catch (error) {
    console.error("Error fetching out of stock items:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching out of stock items",
      error: error.message,
    });
  }
};

// Get batch details
exports.getBatchDetails = async (req, res) => {
  try {
    const { batchId, facilityId } = req.query;

    if (!batchId || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "batchId and facilityId are required",
      });
    }

    const batch = await db.InventoryBatch.findByPk(batchId, {
      include: [
        {
          model: db.Product,
          as: "product",
          attributes: ["id", "sku", "name", "category", "unit_of_measure"],
        },
        {
          model: db.StoreEntry,
          as: "transactions",
          attributes: [
            "id",
            "qty_in",
            "qty_out",
            "cost_price",
            "transaction_type",
            "source",
            "destination",
            "inserted_time",
            "reference_number",
          ],
          order: [["inserted_time", "DESC"]],
        },
      ],
    });

    if (!batch) {
      return res.status(404).json({
        success: false,
        message: "Batch not found",
      });
    }

    res.status(200).json({
      success: true,
      data: batch,
    });
  } catch (error) {
    console.error("Error fetching batch details:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching batch details",
      error: error.message,
    });
  }
};