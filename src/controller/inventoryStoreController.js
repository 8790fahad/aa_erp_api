const db = require("../models");
const moment = require("moment");

/** Normalize mixed latin1 / utf8mb4 columns before comparing. */
const sqlEq = (a, b) =>
  `CONVERT(${a} USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(${b} USING utf8mb4) COLLATE utf8mb4_general_ci`;

// Get inventory list from store entries with current stock levels
exports.getInventoryFromStoreEntries = async (req, res) => {
  try {
    const { facilityId, item_type } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    let replacements = { facilityId, item_type };

    // Get current stock levels by aggregating store entries
    // This query calculates the current quantity by summing qty_in and subtracting qty_out
    let query;
    if (item_type && item_type !== "all") {
      query = `SELECT * FROM general_inventory where branch_name=:item_type and  facilityId=:facilityId and qty>0`;
    } else {
      query = `SELECT * FROM general_inventory where   facilityId=:facilityId and qty>0`;
    }
    const inventoryItems = await db.sequelize.query(query, {
      replacements,
      type: db.sequelize.QueryTypes.SELECT,
    });

    res.status(200).json({
      success: true,
      results: inventoryItems,
      count: inventoryItems.length,
    });
  } catch (error) {
    console.error("Error fetching inventory from store entries:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching inventory data",
      error: error.message,
    });
  }
};

// Get detailed inventory item with transaction history
exports.getInventoryItemDetails = async (req, res) => {
  try {
    const { productId, facilityId, salesType, fromDate, toDate, branchId } =
      req.query;

    if (!productId || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "productId and facilityId are required",
      });
    }

    const parsedBranchId = parseInt(branchId, 10);
    const hasBranchFilter =
      Number.isInteger(parsedBranchId) && parsedBranchId > 0;
    const stockBranchJoin = hasBranchFilter
      ? " AND se.branchId = :branchId"
      : "";

    // Get product details (stock scoped to the warehouse you opened from)
    const productQuery = `
      SELECT
        p.*,
        COALESCE(SUM(se.qty_in), 0) - COALESCE(SUM(se.qty_out), 0) as current_stock,
        -- Calculate total value based on current stock and cost price
        (COALESCE(SUM(se.qty_in), 0) - COALESCE(SUM(se.qty_out), 0)) * p.cost_price as total_value
      FROM products p
      LEFT JOIN store_entries se ON p.sku = se.product_id AND se.facilityId = :facilityId${stockBranchJoin}
      WHERE p.sku = :productId AND p.facility_id = :facilityId
      GROUP BY
        p.id, p.sku, p.name, p.facility_id, p.category, p.item_type, p.unit_of_measure,
        p.cost_price, p.selling_price, p.reorder_level, p.status, p.created_at,
        p.updated_at, p.image_url, p.revenue_account, p.is_purchased,
        p.supplier_id, p.cogs_head, p.warehouse_id, p.inventory_account,
        p.deposit_liability_account, p.mark_up, p.markup_mode,
        p.taxable, p.online_enabled, p.tags, p.notes, p.line_of_business, p.group_id
    `;

    const productReplacements = { productId, facilityId };
    if (hasBranchFilter) productReplacements.branchId = parsedBranchId;

    const productResult = await db.sequelize.query(productQuery, {
      replacements: productReplacements,
      type: db.sequelize.QueryTypes.SELECT,
    });

    if (productResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const product = productResult[0];

    // Build WHERE clause for type filtering
    let salesTypeCondition = "";
    let dateCondition = "";
    let branchCondition = "";
    let replacements = { productId, facilityId };

    if (salesType && salesType !== "all" && salesType !== "null" && salesType !== "undefined") {
      salesTypeCondition = "AND se.type = :salesType";
      replacements.salesType = salesType;
    }

    const from = String(fromDate || "").trim();
    const to = String(toDate || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      dateCondition += " AND DATE(COALESCE(se.createdAt, se.inserted_time, se.receive_date)) >= :fromDate";
      replacements.fromDate = from;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      dateCondition += " AND DATE(COALESCE(se.createdAt, se.inserted_time, se.receive_date)) <= :toDate";
      replacements.toDate = to;
    }

    if (hasBranchFilter) {
      branchCondition = " AND se.branchId = :branchId";
      replacements.branchId = parsedBranchId;
    }

    // Get detailed transaction history with enhanced information
    const historyQuery = `
      SELECT
        se.*,
        CASE
          WHEN se.qty_in > 0 THEN 'IN'
          WHEN se.qty_out > 0 THEN 'OUT'
          ELSE 'OTHER'
        END as movement_type,
        -- Add computed fields for easier display
        COALESCE(se.qty_in, 0) as quantity_in,
        COALESCE(se.qty_out, 0) as quantity_out,
        -- Calculate unit cost based on transaction type
        CASE
          WHEN se.qty_in > 0 THEN se.cost_price
          WHEN se.qty_out > 0 THEN se.selling_price
          ELSE 0
        END as unit_cost,
        -- Calculate total value for this transaction
        CASE
          WHEN se.qty_in > 0 THEN se.qty_in * se.cost_price
          WHEN se.qty_out > 0 THEN se.qty_out * se.selling_price
          ELSE 0
        END as transaction_value,
        -- Add source/destination information for better context
        COALESCE(se.source, '') as source_info,
        COALESCE(se.destination, '') as destination_info,
        -- Add transaction type description
        CASE se.type
          WHEN 'IN' THEN 'Goods Received'
          WHEN 'OUT' THEN 'Goods Issued'
          WHEN 'TRANSFER' THEN 'Stock Transfer'
          ELSE se.type
        END as transaction_description,
        COALESCE(br.branch_name, se.branch_name, se.location, '') AS warehouse_name
      FROM store_entries se
      LEFT JOIN branches br
        ON br.id = se.branchId
        AND br.facilityId = se.facilityId
      WHERE se.product_id = :productId AND se.facilityId = :facilityId ${salesTypeCondition}${dateCondition}${branchCondition}
      ORDER BY se.createdAt DESC
      LIMIT 500
    `;

    const transactionHistory = await db.sequelize.query(historyQuery, {
      replacements,
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Calculate summary statistics
    const summaryStats = {
      totalReceived: transactionHistory
        .filter((tx) => tx.movement_type === "IN")
        .reduce((sum, tx) => sum + (parseFloat(tx.quantity_in) || 0), 0),
      totalIssued: transactionHistory
        .filter((tx) => tx.movement_type === "OUT")
        .reduce((sum, tx) => sum + (parseFloat(tx.quantity_out) || 0), 0),
      averageCost:
        transactionHistory.length > 0
          ? transactionHistory.reduce(
              (sum, tx) => sum + (parseFloat(tx.unit_cost) || 0),
              0
            ) / transactionHistory.length
          : 0,
      transactionCount: transactionHistory.length,
      // Sales type specific counts
      purchaseCount: transactionHistory.filter(
        (tx) => tx.type && tx.type.toLowerCase() === "purchase"
      ).length,
      wipCount: transactionHistory.filter(
        (tx) => tx.type && tx.type.toLowerCase() === "wip"
      ).length,
      salesCount: transactionHistory.filter(
        (tx) => tx.type && tx.type.toLowerCase() === "sales"
      ).length,
    };

    // Group transactions by type for better visualization
    const groupedTransactions = {
      incoming: transactionHistory.filter((tx) => tx.movement_type === "IN"),
      outgoing: transactionHistory.filter((tx) => tx.movement_type === "OUT"),
      other: transactionHistory.filter((tx) => tx.movement_type === "OTHER"),
      // Group by type
      purchase: transactionHistory.filter(
        (tx) => tx.type && tx.type.toLowerCase() === "purchase"
      ),
      wip: transactionHistory.filter(
        (tx) => tx.type && tx.type.toLowerCase() === "wip"
      ),
      sales: transactionHistory.filter(
        (tx) => tx.type && tx.type.toLowerCase() === "sales"
      ),
    };

    // Calculate balances by sales_type
    const balancesByType = {
      purchase: {
        quantity: groupedTransactions.purchase.reduce(
          (sum, tx) =>
            sum +
            (parseFloat(tx.quantity_in || 0) -
              parseFloat(tx.quantity_out || 0)),
          0
        ),
        value: groupedTransactions.purchase.reduce(
          (sum, tx) => sum + (parseFloat(tx.transaction_value) || 0),
          0
        ),
      },
      wip: {
        quantity: groupedTransactions.wip.reduce(
          (sum, tx) =>
            sum +
            (parseFloat(tx.quantity_in || 0) -
              parseFloat(tx.quantity_out || 0)),
          0
        ),
        value: groupedTransactions.wip.reduce(
          (sum, tx) => sum + (parseFloat(tx.transaction_value) || 0),
          0
        ),
      },
      sales: {
        quantity: groupedTransactions.sales.reduce(
          (sum, tx) =>
            sum +
            (parseFloat(tx.quantity_in || 0) -
              parseFloat(tx.quantity_out || 0)),
          0
        ),
        value: groupedTransactions.sales.reduce(
          (sum, tx) => sum + (parseFloat(tx.transaction_value) || 0),
          0
        ),
      },
    };

    res.status(200).json({
      success: true,
      data: {
        product,
        transactionHistory,
        summaryStats,
        groupedTransactions,
        balancesByType,
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
    const query = `
      SELECT
        p.id as product_id,
        p.sku,
        p.name as item_name,
        p.category,
        p.unit_of_measure,
        p.reorder_level,
        p.cost_price,
        COALESCE(SUM(se.qty_in), 0) - COALESCE(SUM(se.qty_out), 0) as current_stock,
        (COALESCE(SUM(se.qty_in), 0) - COALESCE(SUM(se.qty_out), 0)) * p.cost_price as stock_value
      FROM products p
      LEFT JOIN store_entries se ON p.sku = se.product_id AND se.facilityId = :facilityId
      WHERE p.facility_id = :facilityId
      GROUP BY
        p.id, p.sku, p.name, p.category, p.unit_of_measure,
        p.reorder_level, p.cost_price
      HAVING current_stock <= p.reorder_level AND current_stock > 0
      ORDER BY current_stock ASC
    `;

    const lowStockItems = await db.sequelize.query(query, {
      replacements: { facilityId },
      type: db.sequelize.QueryTypes.SELECT,
    });

    res.status(200).json({
      success: true,
      results: lowStockItems,
      count: lowStockItems.length,
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
    const query = `
      SELECT
        p.id as product_id,
        p.sku,
        p.name as item_name,
        p.category,
        p.unit_of_measure,
        p.cost_price,
        p.reorder_level
      FROM products p
      LEFT JOIN store_entries se ON p.sku = se.product_id AND se.facilityId = :facilityId
      WHERE p.facility_id = :facilityId
      GROUP BY
        p.id, p.sku, p.name, p.category, p.unit_of_measure,
        p.cost_price, p.reorder_level
      HAVING COALESCE(SUM(se.qty_in), 0) - COALESCE(SUM(se.qty_out), 0) = 0
      ORDER BY p.name ASC
    `;

    const outOfStockItems = await db.sequelize.query(query, {
      replacements: { facilityId },
      type: db.sequelize.QueryTypes.SELECT,
    });

    res.status(200).json({
      success: true,
      results: outOfStockItems,
      count: outOfStockItems.length,
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

// Get inventory balances by sales_type
exports.getInventoryBalancesBySalesType = async (req, res) => {
  try {
    const { facilityId, productId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Build WHERE clause for product filtering
    let productCondition = "";
    let replacements = { facilityId };

    if (productId) {
      productCondition = "AND p.sku = :productId";
      replacements.productId = productId;
    }

    // Get inventory balances grouped by sales_type
    const query = `
      SELECT
        p.id as product_id,
        p.sku,
        p.name as item_name,
        p.category,
        p.unit_of_measure,
        p.cost_price,
        se.sales_type,
        -- Calculate balances for each sales_type
        COALESCE(SUM(se.qty_in), 0) - COALESCE(SUM(se.qty_out), 0) as balance_quantity,
        (COALESCE(SUM(se.qty_in), 0) - COALESCE(SUM(se.qty_out), 0)) * p.cost_price as balance_value,
        -- Count transactions for each sales_type
        COUNT(se.id) as transaction_count
      FROM products p
      LEFT JOIN store_entries se ON p.sku = se.product_id AND se.facilityId = :facilityId
      WHERE p.facility_id = :facilityId ${productCondition}
      GROUP BY
        p.id, p.sku, p.name, p.category, p.unit_of_measure,
        p.cost_price, se.sales_type
      HAVING balance_quantity > 0
      ORDER BY p.name ASC, se.sales_type ASC
    `;

    const balances = await db.sequelize.query(query, {
      replacements,
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Group balances by sales_type
    const groupedBalances = balances.reduce((acc, item) => {
      const type = item.sales_type || "unknown";
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(item);
      return acc;
    }, {});

    // Calculate summary by sales_type
    const summary = Object.keys(groupedBalances).reduce((acc, type) => {
      const items = groupedBalances[type];
      acc[type] = {
        totalQuantity: items.reduce(
          (sum, item) => sum + (parseFloat(item.balance_quantity) || 0),
          0
        ),
        totalValue: items.reduce(
          (sum, item) => sum + (parseFloat(item.balance_value) || 0),
          0
        ),
        itemCount: items.length,
      };
      return acc;
    }, {});

    res.status(200).json({
      success: true,
      data: {
        balances: groupedBalances,
        summary,
      },
    });
  } catch (error) {
    console.error("Error fetching inventory balances by sales_type:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching inventory balances by sales_type",
      error: error.message,
    });
  }
};

// Get transaction history by sales_type
exports.getTransactionHistoryBySalesType = async (req, res) => {
  try {
    const { facilityId, salesType, limit = 100 } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    if (!salesType) {
      return res.status(400).json({
        success: false,
        message: "salesType is required",
      });
    }

    // Get transaction history filtered by sales_type
    const query = `
      SELECT
        se.*,
        p.name as product_name,
        p.category as product_category,
        p.unit_of_measure,
        -- Determine movement type
        CASE
          WHEN se.qty_in > 0 THEN 'IN'
          WHEN se.qty_out > 0 THEN 'OUT'
          ELSE 'OTHER'
        END as movement_type,
        -- Calculate transaction value
        CASE
          WHEN se.qty_in > 0 THEN se.qty_in * se.cost_price
          WHEN se.qty_out > 0 THEN se.qty_out * se.selling_price
          ELSE 0
        END as transaction_value
      FROM store_entries se
      LEFT JOIN products p ON se.product_id = p.sku
      WHERE se.facilityId = :facilityId
        AND se.sales_type = :salesType
      ORDER BY se.createdAt DESC
      LIMIT :limit
    `;

    const history = await db.sequelize.query(query, {
      replacements: {
        facilityId,
        salesType,
        limit: parseInt(limit),
      },
      type: db.sequelize.QueryTypes.SELECT,
    });

    res.status(200).json({
      success: true,
      data: history,
      count: history.length,
    });
  } catch (error) {
    console.error("Error fetching transaction history by sales_type:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching transaction history by sales_type",
      error: error.message,
    });
  }
};
exports.getRawMaterialInventoryForCostingTemplate = async (req, res) => {
  try {
    const { facilityId, branch_name } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    let query = `
      SELECT
        name,
        sku as product_id,
        category,
        unit_of_measure,
        cost_price,
        reorder_level
      FROM products
      WHERE facility_id = :facilityId and  item_type = 'Raw Material'
    `;

    let replacements = { facilityId };



    query += " ORDER BY name ASC";

    const inventoryItems = await db.sequelize.query(query, {
      replacements,
      type: db.sequelize.QueryTypes.SELECT,
    });

    res.status(200).json({
      success: true,
      results: inventoryItems,
      count: inventoryItems.length,
    });
  } catch (error) {
    console.error("Error fetching raw material inventory:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching raw material inventory data",
      error: error.message,
    });
  }
};
// Get raw material inventory list
exports.getRawMaterialInventory = async (req, res) => {
  try {
    const { facilityId, branch_name } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const replacements = { facilityId };
    let branchCondition = " AND se.facilityId = :facilityId";

    if (branch_name && branch_name !== "all") {
      branchCondition += " AND se.branch_name = :branch_name";
      replacements.branch_name = branch_name;
    } else {
      branchCondition = " AND se.facilityId = :facilityId";
    }

    const query = `
      SELECT
        SUM(se.qty_in) - SUM(se.qty_out) AS qty,
        se.branch_name,
        se.product_id,
        p.name,
        p.item_type,
        p.unit_of_measure,
        se.expiry_date,
        se.location,
        se.status
      FROM store_entries se
      JOIN products p ON se.product_id = p.sku
      WHERE se.facilityId = :facilityId
        ${branch_name && branch_name !== "all" ? "AND se.branch_name = :branch_name" : ""}
        AND p.facility_id = :facilityId
        AND p.item_type = 'Raw Material'
      GROUP BY
        se.branch_name,
        se.status,
        se.facilityId,
        se.product_id,
        p.name,
        p.item_type,
        p.unit_of_measure,
        se.expiry_date,
        se.location
      HAVING qty > 0
      ORDER BY p.name ASC
    `;

    const inventoryItems = await db.sequelize.query(query, {
      replacements,
      type: db.sequelize.QueryTypes.SELECT,
    });

    res.status(200).json({
      success: true,
      results: inventoryItems,
      count: inventoryItems.length,
    });
  } catch (error) {
    console.error("Error fetching raw material inventory:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching raw material inventory data",
      error: error.message,
    });
  }
};


// Get raw material inventory list — one row per product, aggregated across all branches
exports.getInventoryListAll = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const query = `
      SELECT
        SUM(se.qty_in) - SUM(se.qty_out) AS qty,
        'Raw Material' AS branch_name,
        se.product_id,
        p.name,
        p.item_type,
        p.unit_of_measure,
        MAX(se.expiry_date) AS expiry_date,
        MAX(se.location) AS location,
        MAX(se.status) AS status
      FROM store_entries se
      JOIN products p ON se.product_id = p.sku
      WHERE se.facilityId = :facilityId
        AND p.facility_id = :facilityId
        AND p.item_type = 'Raw Material'
        AND LOWER(TRIM(se.branch_name)) = 'raw material'
      GROUP BY
        se.facilityId,
        se.product_id,
        p.name,
        p.item_type,
        p.unit_of_measure
      HAVING qty > 0
      ORDER BY p.name ASC
    `;

    const inventoryItems = await db.sequelize.query(query, {
      replacements: { facilityId },
      type: db.sequelize.QueryTypes.SELECT,
    });

    res.status(200).json({
      success: true,
      results: inventoryItems,
      count: inventoryItems.length,
    });
  } catch (error) {
    console.error("Error fetching inventory list:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching inventory list",
      error: error.message,
    });
  }
};

// Get inventory list from store_entries for Inventory List page (branch 'for sales' or filtered)
exports.getInventoryForGoodsTransferByBranch = async (req, res) => {
  try {
    const { facilityId, branch_name } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const replacements = { facilityId };
    let branchCondition = "";
    if (branch_name && branch_name !== "all" && branch_name !== "") {
      branchCondition = " AND se.branch_name = :branch_name";
      replacements.branch_name = branch_name;
    } else {
      branchCondition = " AND se.branch_name = 'for sales'";
    }

    const query = `
      SELECT
        SUM(se.qty_in) - SUM(se.qty_out) AS qty,
        se.branch_name,
        se.product_id,
        p.name,
        p.item_type,
        p.unit_of_measure,
        se.expiry_date,
        se.location,
        se.status
      FROM store_entries se
      JOIN products p ON se.product_id = p.sku
      WHERE se.facilityId = :facilityId
        ${branchCondition}
      GROUP BY
        se.branch_name,
        se.status,
        se.facilityId,
        se.product_id,
        p.name,
        p.item_type,
        p.unit_of_measure,
        se.expiry_date,
        se.location
      HAVING qty > 0
      ORDER BY p.name ASC
    `;

    const inventoryItems = await db.sequelize.query(query, {
      replacements,
      type: db.sequelize.QueryTypes.SELECT,
    });

    res.status(200).json({
      success: true,
      results: inventoryItems,
      count: inventoryItems.length,
    });
  } catch (error) {
    console.error("Error fetching inventory for goods transfer by branch:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching inventory for goods transfer by branch",
      error: error.message,
    });
  }
};

// Get products allowed for goods transfer (Finished Good, By-Product, Resalable)
// joined with store_entries so the frontend gets the real available quantity
// at the selected source branch.
//
// Optional filters:
//   - branchId    : numeric branches.id; restricts qty to that branch only.
//   - branch_name : kept for backwards compat — accepts either a branch name
//                   (e.g. "Main Store") OR a store-zone name (e.g. "for sales").
//                   Filters by zone (`store_entries.branch_name`) when it
//                   matches a known zone string, otherwise resolves the
//                   branches.id by name and filters on it.
exports.getGoodsTransferProducts = async (req, res) => {
  // Same branch-aware stock as /inventory/goods-transfer/list
  return exports.getInventoryForGoodsTransfer(req, res);
};

// Get inventory for goods transfer (Finished Good, Resalable, By-Product)
// Source of truth is the products table (products.js model),
// with optional stock/branch information coming from store_entries.
exports.getInventoryForGoodsTransfer = async (req, res) => {
  try {
    const { facilityId, branch_name, branchId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const replacements = { facilityId };
    const parsedBranchId = parseInt(branchId, 10);
    const zoneList = ["for sales", "for sale"]
      .map((z) => `'${z}'`)
      .join(", ");

    let branchCondition = "";
    if (
      Number.isInteger(parsedBranchId) &&
      parsedBranchId > 0
    ) {
      branchCondition = `
        AND LOWER(TRIM(se.branch_name)) IN (${zoneList})
        AND (
          se.branchId = :branchId
          OR (
            p.item_type = 'By-Product'
            AND (se.branchId = 0 OR se.branchId IS NULL)
          )
        )`;
      replacements.branchId = parsedBranchId;
    } else if (branch_name && branch_name !== "all" && branch_name !== "") {
      branchCondition = " AND LOWER(TRIM(se.branch_name)) = LOWER(TRIM(:branch_name))";
      replacements.branch_name = branch_name;
    } else {
      branchCondition = ` AND LOWER(TRIM(se.branch_name)) IN (${zoneList})`;
    }

    // Stock at the selected branch from store_entries (sellable zone only).
    // Matches approval-time balance in goodsTransfers.getAvailableQty.
    const query = `
      SELECT
        SUM(se.qty_in) - SUM(se.qty_out) AS qty,
        COALESCE(MAX(se.branch_name), 'for sales') AS branch_name,
        se.branchId AS branch_id,
        se.product_id,
        p.name,
        p.sku AS item_code,
        p.unit_of_measure,
        p.cost_price AS cost,
        p.selling_price,
        p.item_type,
        p.mark_up
      FROM store_entries se
      INNER JOIN products p
        ON ${sqlEq("se.product_id", "p.sku")}
        AND ${sqlEq("se.facilityId", "p.facility_id")}
      WHERE se.facilityId = :facilityId
        AND p.facility_id = :facilityId
        AND p.item_type IN ('Finished Good', 'Resalable', 'By-Product')
        AND p.status = 'Active'
        ${branchCondition}
      GROUP BY
        se.product_id,
        se.branchId,
        p.name,
        p.sku,
        p.unit_of_measure,
        p.cost_price,
        p.selling_price,
        p.item_type,
        p.mark_up
      HAVING qty > 0
      ORDER BY p.name ASC
    `;

    const inventoryItems = await db.sequelize.query(query, {
      replacements,
      type: db.sequelize.QueryTypes.SELECT,
    });

    const results = inventoryItems.map((item) => ({
      ...item,
      product_id: item.product_id,
      name: item.name,
      item_name: item.name,
      item_code: item.item_code || item.product_id,
      unit_of_measure: item.unit_of_measure || "Pcs",
      qty: parseFloat(item.qty) || 0,
    }));

    res.status(200).json({
      success: true,
      results,
      count: results.length,
    });
  } catch (error) {
    console.error("Error fetching inventory for goods transfer:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching inventory data",
      error: error.message,
    });
  }
};

// Get sales_type summary report
exports.getSalesTypeSummaryReport = async (req, res) => {
  try {
    const { facilityId, startDate, endDate } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Build date range condition
    let dateCondition = "";
    let replacements = { facilityId };

    if (startDate && endDate) {
      dateCondition = "AND DATE(se.createdAt) BETWEEN :startDate AND :endDate";
      replacements.startDate = startDate;
      replacements.endDate = endDate;
    }

    // Get summary report by sales_type
    const query = `
      SELECT
        se.sales_type,
        COUNT(DISTINCT se.product_id) as product_count,
        COUNT(se.id) as transaction_count,
        SUM(COALESCE(se.qty_in, 0)) as total_qty_in,
        SUM(COALESCE(se.qty_out, 0)) as total_qty_out,
        -- Calculate total values
        SUM(CASE
          WHEN se.qty_in > 0 THEN se.qty_in * se.cost_price
          WHEN se.qty_out > 0 THEN se.qty_out * se.selling_price
          ELSE 0
        END) as total_value
      FROM store_entries se
      WHERE se.facilityId = :facilityId ${dateCondition}
      GROUP BY se.sales_type
      ORDER BY total_value DESC
    `;

    const summary = await db.sequelize.query(query, {
      replacements,
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Calculate grand totals
    const grandTotal = {
      productCount: summary.reduce(
        (sum, item) => sum + (parseInt(item.product_count) || 0),
        0
      ),
      transactionCount: summary.reduce(
        (sum, item) => sum + (parseInt(item.transaction_count) || 0),
        0
      ),
      totalQtyIn: summary.reduce(
        (sum, item) => sum + (parseFloat(item.total_qty_in) || 0),
        0
      ),
      totalQtyOut: summary.reduce(
        (sum, item) => sum + (parseFloat(item.total_qty_out) || 0),
        0
      ),
      totalValue: summary.reduce(
        (sum, item) => sum + (parseFloat(item.total_value) || 0),
        0
      ),
    };

    res.status(200).json({
      success: true,
      data: {
        summary,
        grandTotal,
      },
    });
  } catch (error) {
    console.error("Error fetching sales_type summary report:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching sales_type summary report",
      error: error.message,
    });
  }
};

// ==================== RAW MATERIAL INVENTORY BY DEPARTMENT ====================
// Returns ALL branches where item_type='Raw Material' has stock > 0
// Optional filter by departmentId
exports.getRawMaterialInventoryByDepartment = async (req, res) => {
  try {
    const { facilityId, departmentId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const replacements = { facilityId };
    let deptCondition = "";

    if (
      departmentId &&
      departmentId !== "all" &&
      departmentId !== "null" &&
      departmentId !== "undefined"
    ) {
      deptCondition = "AND se.departmentId = :departmentId";
      replacements.departmentId = departmentId;
    }

    const query = `
      SELECT
        p.sku,
        p.name,
        p.category,
        p.item_type,
        p.unit_of_measure,
        p.cost_price,
        se.branch_name,
        se.departmentId,
        d.departmentName,
        se.expiry_date,
        se.facilityId,
        SUM(COALESCE(se.qty_in, 0)) - SUM(COALESCE(se.qty_out, 0)) AS balance,
        (SUM(COALESCE(se.qty_in, 0)) - SUM(COALESCE(se.qty_out, 0))) * p.cost_price AS total_value
      FROM store_entries se
      JOIN products p
        ON se.product_id = p.sku
        AND p.facility_id = :facilityId
        AND p.item_type = 'Raw Material'
      LEFT JOIN Departments d ON se.departmentId = d.id
      WHERE se.facilityId = :facilityId
        ${deptCondition}
      GROUP BY
        p.sku, p.name, p.category, p.item_type, p.unit_of_measure,
        p.cost_price, se.branch_name, se.departmentId, d.departmentName,
        se.expiry_date, se.facilityId
      HAVING balance > 0
      ORDER BY p.name ASC, se.branch_name ASC
    `;

    const items = await db.sequelize.query(query, {
      replacements,
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Summary stats
    const totalBalance = items.reduce(
      (sum, i) => sum + (parseFloat(i.balance) || 0),
      0
    );
    const totalValue = items.reduce(
      (sum, i) => sum + (parseFloat(i.total_value) || 0),
      0
    );

    res.status(200).json({
      success: true,
      results: items,
      count: items.length,
      summary: { totalBalance, totalValue },
    });
  } catch (error) {
    console.error("Error fetching raw material inventory by department:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching raw material inventory by department",
      error: error.message,
    });
  }
};

// ==================== WIP INVENTORY — DIRECT JOIN (no VIEW dependency) ====================
// Replaces the wip_inventory VIEW query with a direct store_entries JOIN products query
// Optional filter by departmentId
exports.getWipInventoryDirect = async (req, res) => {
  try {
    const { facilityId, departmentId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const replacements = { facilityId };
    let deptCondition = "";

    if (
      departmentId &&
      departmentId !== "all" &&
      departmentId !== "null" &&
      departmentId !== "undefined"
    ) {
      deptCondition = "AND se.departmentId = :departmentId";
      replacements.departmentId = departmentId;
    }

    const query = `
      SELECT
        p.sku,
        p.name,
        p.category,
        p.item_type,
        p.unit_of_measure,
        p.cost_price,
        p.status,
        se.branch_name,
        se.departmentId,
        d.departmentName,
        se.expiry_date,
        se.facilityId,
        SUM(COALESCE(se.qty_in, 0)) - SUM(COALESCE(se.qty_out, 0)) AS balance,
        SUM(COALESCE(se.qty_in, 0)) - SUM(COALESCE(se.qty_out, 0)) AS qty,
        (SUM(COALESCE(se.qty_in, 0)) - SUM(COALESCE(se.qty_out, 0))) * p.cost_price AS total_value
      FROM store_entries se
      JOIN products p
        ON se.product_id = p.sku
        AND p.facility_id = :facilityId
      LEFT JOIN Departments d ON se.departmentId = d.id
      WHERE se.facilityId = :facilityId
        AND se.branch_name = 'Work in Progress'
        AND (se.expiry_date IS NULL OR se.expiry_date >= CURDATE())
        ${deptCondition}
      GROUP BY
        p.sku, p.name, p.category, p.item_type, p.unit_of_measure,
        p.cost_price, p.status, se.branch_name, se.departmentId,
        d.departmentName, se.expiry_date, se.facilityId
      HAVING balance > 0
      ORDER BY p.name ASC
    `;

    const items = await db.sequelize.query(query, {
      replacements,
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Summary stats
    const totalBalance = items.reduce(
      (sum, i) => sum + (parseFloat(i.balance) || 0),
      0
    );
    const totalValue = items.reduce(
      (sum, i) => sum + (parseFloat(i.total_value) || 0),
      0
    );

    res.status(200).json({
      success: true,
      results: items,
      count: items.length,
      summary: { totalBalance, totalValue },
    });
  } catch (error) {
    console.error("Error fetching WIP inventory (direct):", error);
    res.status(500).json({
      success: false,
      message: "Error fetching WIP inventory",
      error: error.message,
    });
  }
};
