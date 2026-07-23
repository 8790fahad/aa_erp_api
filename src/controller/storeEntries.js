const db = require("../models");
const { Op } = require("sequelize");
const { authenticate } = require("../config/passport");
const { STORE_ENTRY_TYPE } = require("../constants/storeEntryTypes");

// Get all store entries
const getStoreEntries = async (req, res) => {
  try {
    const {
      facilityId,
      productId,
      transactionType,
      status,
      reference_number,
      page = 1,
      limit = 10,
    } = req.query;

    const whereClause = {};
    if (facilityId) whereClause.facilityId = facilityId;
    if (productId) whereClause.product_id = productId;
    if (transactionType) whereClause.transaction_type = transactionType;
    if (status) whereClause.status = status;
    if (reference_number) whereClause.reference_number = reference_number;

    const offset = (page - 1) * limit;

    const { count, rows } = await db.StoreEntry.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: db.Product,
          as: "product",
          attributes: ["id", "name", "sku", "item_type"],
        },
      ],
      order: [["inserted_time", "DESC"]],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    res.json({
      success: true,
      results: rows,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
    });
  } catch (error) {
    console.error("Error fetching store entries:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching store entries",
      error: error.message,
    });
  }
};

// Get single store entry
const getStoreEntry = async (req, res) => {
  try {
    const { id } = req.params;

    const storeEntry = await db.StoreEntry.findByPk(id, {
      include: [
        {
          model: db.Product,
          as: "product",
          attributes: [
            "id",
            "name",
            "sku",
            "item_type",
            "selling_price",
            "cost_price",
          ],
        },
      ],
    });

    if (!storeEntry) {
      return res.status(404).json({
        success: false,
        message: "Store entry not found",
      });
    }

    res.json({
      success: true,
      results: storeEntry,
    });
  } catch (error) {
    console.error("Error fetching store entry:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching store entry",
      error: error.message,
    });
  }
};

// Create new store entry
const createStoreEntry = async (req, res) => {
  try {
    const {
      product_id,
      facilityId,
      qty_in = 0,
      qty_out = 0,
      transaction_type,
      cost_price = 0,
      selling_price = 0,
      supplier_code = "",
      supplier_name = "",
      source = "Manual Entry",
      destination = "Warehouse",
      status = "Active",
      activation = "Active",
      item_status = "Available",
      inserted_by = "System",
      trn_number,
      uniqueId,
      item_category = "General",
      sales_type = "sales",
      version_id,
      receive_date,
      reference_number,
      subhead = "MANUAL",
      barcode = "",
      grn_no = "",
      mark_up = 0,
      markup_mode = "Fixed",
      transfer_from = "Manual",
      transfer_to = "Warehouse",
      branch_name = "Main Branch",
      truckNo = "",
      waybillNo = "",
      otherInfo = "",
    } = req.body;

    // Validate required fields
    if (!product_id || !facilityId || !transaction_type) {
      return res.status(400).json({
        success: false,
        message: "product_id, facilityId, and transaction_type are required",
      });
    }

    // Check if product exists
    const product = await db.Product.findByPk(product_id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Generate unique identifiers if not provided
    const finalTrnNumber = trn_number || `${transaction_type}-${Date.now()}`;
    const finalUniqueId =
      uniqueId || `${transaction_type}-${product_id}-${Date.now()}`;
    const finalVersionId = version_id || `v1-${Date.now()}`;
    const finalReceiveDate =
      receive_date || new Date().toISOString().split("T")[0];
    const finalReferenceNumber = reference_number || `REF-${Date.now()}`;
    const finalGrnNo = grn_no || `GRN-${Date.now()}`;

    const storeEntry = await db.StoreEntry.create({
      product_id,
      facilityId,
      qty_in,
      qty_out,
      type: transaction_type || sales_type || STORE_ENTRY_TYPE.ADJUSTMENT,
      cost_price,
      selling_price,
      supplier_code,
      supplier_name,
      source,
      destination,
      status,
      activation,
      item_status,
      inserted_time: new Date(),
      inserted_by,
      trn_number: finalTrnNumber,
      uniqueId: finalUniqueId,
      item_category,
      sales_type,
      version_id: finalVersionId,
      receive_date: finalReceiveDate,
      reference_number: finalReferenceNumber,
      subhead,
      barcode: barcode || product.sku,
      grn_no: finalGrnNo,
      mark_up,
      markup_mode,
      transfer_from,
      transfer_to,
      branch_name,
      truckNo,
      waybillNo,
      otherInfo,
    });

    // Include product details in response
    const storeEntryWithProduct = await db.StoreEntry.findByPk(storeEntry.id, {
      include: [
        {
          model: db.Product,
          as: "product",
          attributes: ["id", "name", "sku", "item_type"],
        },
      ],
    });

    res.status(201).json({
      success: true,
      message: "Store entry created successfully",
      results: storeEntryWithProduct,
    });
  } catch (error) {
    console.error("Error creating store entry:", error);
    res.status(500).json({
      success: false,
      message: "Error creating store entry",
      error: error.message,
    });
  }
};

// Update store entry
const updateStoreEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const storeEntry = await db.StoreEntry.findByPk(id);
    if (!storeEntry) {
      return res.status(404).json({
        success: false,
        message: "Store entry not found",
      });
    }

    await storeEntry.update(updateData);

    const updatedStoreEntry = await db.StoreEntry.findByPk(id, {
      include: [
        {
          model: db.Product,
          as: "product",
          attributes: ["id", "name", "sku", "item_type"],
        },
      ],
    });

    res.json({
      success: true,
      message: "Store entry updated successfully",
      results: updatedStoreEntry,
    });
  } catch (error) {
    console.error("Error updating store entry:", error);
    res.status(500).json({
      success: false,
      message: "Error updating store entry",
      error: error.message,
    });
  }
};

// Delete store entry
const deleteStoreEntry = async (req, res) => {
  try {
    const { id } = req.params;

    const storeEntry = await db.StoreEntry.findByPk(id);
    if (!storeEntry) {
      return res.status(404).json({
        success: false,
        message: "Store entry not found",
      });
    }

    await storeEntry.destroy();

    res.json({
      success: true,
      message: "Store entry deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting store entry:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting store entry",
      error: error.message,
    });
  }
};

// Get store entries by product
const getStoreEntriesByProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const { facilityId } = req.query;

    const whereClause = { product_id: productId };
    if (facilityId) whereClause.facilityId = facilityId;

    const storeEntries = await db.StoreEntry.findAll({
      where: whereClause,
      include: [
        {
          model: db.Product,
          as: "product",
          attributes: ["id", "name", "sku", "item_type"],
        },
      ],
      order: [["inserted_time", "DESC"]],
    });

    res.json({
      success: true,
      results: storeEntries,
    });
  } catch (error) {
    console.error("Error fetching store entries by product:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching store entries by product",
      error: error.message,
    });
  }
};

module.exports = {
  getStoreEntries,
  getStoreEntry,
  createStoreEntry,
  updateStoreEntry,
  deleteStoreEntry,
  getStoreEntriesByProduct,
};
