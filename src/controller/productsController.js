const db = require("../models");
const moment = require("moment");
const { v4: uuidv4 } = require("uuid");
const { Op } = require("sequelize");
const { validateBranchIdById } = require("../services/branchResolver");
const { STORE_ENTRY_TYPE } = require("../constants/storeEntryTypes");
const {
  verifyProductAccountsAndBranch,
} = require("../services/productAccountValidation");

// Get products list with pagination and search
exports.getProductsList = async (req, res) => {
  try {
    const { facilityId } = req.params;
    const {
      search,
      page = 1,
      limit = 10,
      itemType,
      status,
      category,
      sortBy = "created_at",
      sortOrder = "DESC",
      businessType = "retailers", // Default business type
    } = req.query;

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
    };

    // Add search condition if provided
    if (search) {
      whereConditions[db.Sequelize.Op.or] = [
        { name: { [db.Sequelize.Op.like]: `%${search}%` } },
        { sku: { [db.Sequelize.Op.like]: `%${search}%` } },
        { category: { [db.Sequelize.Op.like]: `%${search}%` } },
      ];
    }

    // Multiple item types: ?itemTypes=Finished Good,Resalable (comma-separated)
    const itemTypesParam = req.query.itemTypes;
    if (itemTypesParam) {
      const types = String(itemTypesParam)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      if (types.length) {
        whereConditions.item_type = { [Op.in]: types };
      }
    } else if (itemType) {
      whereConditions.item_type = itemType;
    }

    // Add status filter if provided
    if (status) {
      whereConditions.status = status;
    }

    // Add category filter if provided
    if (category) {
      whereConditions.category = category;
    }

    // Validate sortBy field
    const allowedSortFields = [
      "name",
      "sku",
      "item_type",
      "category",
      "quantity",
      "selling_price",
      "cost_price",
      "status",
      "created_at",
      "updated_at",
    ];
    const validSortBy = allowedSortFields.includes(sortBy)
      ? sortBy
      : "created_at";
    const validSortOrder = ["ASC", "DESC"].includes(sortOrder.toUpperCase())
      ? sortOrder.toUpperCase()
      : "DESC";

    // Get products with pagination
    const { count, rows: products } = await db.Product.findAndCountAll({
      where: whereConditions,
      order: [[validSortBy, validSortOrder]],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    // For services business type, we don't need inventory batches
    // For other business types, we can include batch information
    const enrichedProducts = await Promise.all(
      products.map(async (product) => {
        if (businessType === "services") {
          // Services don't need inventory tracking
          return {
            ...product.toJSON(),
            quantity_on_hand: 0,
            avg_unit_cost: 0,
            total_value: 0,
            active_batches: 0,
          };
        } else {
          // Get inventory information for non-service businesses
          try {
            // Get current valuation
            const valuation = await db.InventoryValuation.findOne({
              where: {
                product_id: product.id,
                facility_id: facilityId,
              },
            });

            // Get batch count
            const batchCount = await db.InventoryBatch.count({
              where: {
                product_id: product.id,
                facility_id: facilityId,
                status: "ACTIVE",
                quantity_on_hand: {
                  [db.Sequelize.Op.gt]: 0,
                },
              },
            });

            return {
              ...product.toJSON(),
              quantity_on_hand: valuation?.quantity_on_hand || 0,
              avg_unit_cost: valuation?.avg_unit_cost || 0,
              total_value: valuation?.total_value || 0,
              valuation_method: valuation?.valuation_method || "WAC",
              active_batches: batchCount,
            };
          } catch (error) {
            // Return product as is if there's an error getting inventory info
            return {
              ...product.toJSON(),
              quantity_on_hand: 0,
              avg_unit_cost: 0,
              total_value: 0,
              active_batches: 0,
            };
          }
        }
      })
    );

    // Calculate additional metrics
    const totalProducts = count;
    const inStockProducts = enrichedProducts.filter(
      (p) => (p.quantity_on_hand || 0) > 0
    ).length;
    const lowStockProducts = enrichedProducts.filter((p) => {
      const quantity = p.quantity_on_hand || 0;
      const reorderLevel = p.reorder_level || 0;
      return quantity <= reorderLevel && quantity > 0;
    }).length;
    const outOfStockProducts = enrichedProducts.filter(
      (p) => (p.quantity_on_hand || 0) === 0
    ).length;

    // Calculate total inventory value
    const totalInventoryValue = enrichedProducts.reduce((sum, product) => {
      return sum + (product.total_value || 0);
    }, 0);

    // Calculate total sales value
    const totalSalesValue = enrichedProducts.reduce((sum, product) => {
      return (
        sum + (product.quantity_on_hand || 0) * (product.selling_price || 0)
      );
    }, 0);

    res.status(200).json({
      success: true,
      data: enrichedProducts,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit),
        hasNextPage: page < Math.ceil(count / limit),
        hasPrevPage: page > 1,
      },
      metrics: {
        totalProducts,
        inStockProducts,
        lowStockProducts,
        outOfStockProducts,
        totalInventoryValue,
        totalSalesValue,
      },
    });
  } catch (error) {
    console.error("Error fetching products list:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching products list",
      error: error.message,
    });
  }
};

// Get single product by ID
exports.getProductById = async (req, res) => {
  try {
    const { facilityId, productId } = req.params;

    if (!facilityId || !productId) {
      return res.status(400).json({
        success: false,
        message: "facilityId and productId are required",
      });
    }

    const product = await db.Product.findOne({
      where: {
        id: productId,
        facility_id: facilityId,
      },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    let quantity_on_hand = 0;
    try {
      const rows = await db.sequelize.query(
        `SELECT IFNULL(SUM(qty_in) - SUM(qty_out), 0) AS balance
           FROM store_entries
          WHERE product_id = :sku
            AND facilityId = :facilityId`,
        {
          replacements: { sku: product.sku, facilityId },
          type: db.sequelize.QueryTypes.SELECT,
        },
      );
      quantity_on_hand = parseFloat(rows?.[0]?.balance || 0) || 0;
    } catch (stockErr) {
      console.warn("Could not load product stock balance:", stockErr.message);
    }

    const data = product.toJSON ? product.toJSON() : { ...product };
    data.quantity_on_hand = quantity_on_hand;

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Error fetching product:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching product",
      error: error.message,
    });
  }
};
exports.getProductByType = async (req, res) => {
  try {
    const { facilityId } = req.params;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId are required",
      });
    }

    const product = await db.Product.findAll({
      where: {
        item_type: {
          [Op.in]: [
            "Raw Material",
            "Resalable",
          ],
        },
        facility_id: facilityId,
      },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.status(200).json({
      success: true,
      data: product,
    });
  } catch (error) {
    console.error("Error fetching product:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching product",
      error: error.message,
    });
  }
};

exports.getProductByItemType = async (req, res) => {
  try {
    const { facilityId } = req.params;
    const { item_type = "" } = req.query;

    if (!facilityId || !item_type) {
      return res.status(400).json({
        success: false,
        message: "FacilityId and item type are required",
      });
    }

    // Support a single type or a comma-separated list (e.g. "Finished Good,Resalable").
    const itemTypes = String(item_type)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const product = await db.Product.findAll({
      where: {
        item_type:
          itemTypes.length > 1 ? { [Op.in]: itemTypes } : itemTypes[0],
        facility_id: facilityId,
      },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.status(200).json({
      success: true,
      data: product,
    });
  } catch (error) {
    console.error("Error fetching product:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching product",
      error: error.message,
    });
  }
};

// Get product categories
exports.getProductCategories = async (req, res) => {
  try {
    const { facilityId } = req.params;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const categories = await db.Product.findAll({
      where: {
        facility_id: facilityId,
        category: { [db.Sequelize.Op.ne]: null },
      },
      attributes: [
        [db.Sequelize.fn("DISTINCT", db.Sequelize.col("category")), "category"],
      ],
      order: [["category", "ASC"]],
    });

    res.status(200).json({
      success: true,
      data: categories.map((cat) => cat.category).filter(Boolean),
    });
  } catch (error) {
    console.error("Error fetching product categories:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching product categories",
      error: error.message,
    });
  }
};

// Get product statistics
exports.getProductStats = async (req, res) => {
  try {
    const { facilityId } = req.params;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const stats = await db.Product.findAll({
      where: { facility_id: facilityId },
      attributes: [
        [db.Sequelize.fn("COUNT", db.Sequelize.col("id")), "totalProducts"],
        [db.Sequelize.fn("SUM", db.Sequelize.col("quantity")), "totalQuantity"],
        [
          db.Sequelize.fn("SUM", db.Sequelize.literal("quantity * cost_price")),
          "totalInventoryValue",
        ],
        [
          db.Sequelize.fn(
            "SUM",
            db.Sequelize.literal("quantity * selling_price")
          ),
          "totalSalesValue",
        ],
        [
          db.Sequelize.fn("AVG", db.Sequelize.col("selling_price")),
          "avgSellingPrice",
        ],
        [
          db.Sequelize.fn("AVG", db.Sequelize.col("cost_price")),
          "avgCostPrice",
        ],
      ],
      raw: true,
    });

    // Get item type distribution
    const itemTypeStats = await db.Product.findAll({
      where: { facility_id: facilityId },
      attributes: [
        "item_type",
        [db.Sequelize.fn("COUNT", db.Sequelize.col("id")), "count"],
      ],
      group: ["item_type"],
      raw: true,
    });

    // Get status distribution
    const statusStats = await db.Product.findAll({
      where: { facility_id: facilityId },
      attributes: [
        "status",
        [db.Sequelize.fn("COUNT", db.Sequelize.col("id")), "count"],
      ],
      group: ["status"],
      raw: true,
    });

    res.status(200).json({
      success: true,
      data: {
        overview: stats[0] || {},
        itemTypeDistribution: itemTypeStats,
        statusDistribution: statusStats,
      },
    });
  } catch (error) {
    console.error("Error fetching product statistics:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching product statistics",
      error: error.message,
    });
  }
};

// Create product with store entry
exports.createProductWithStoreEntry = async (req, res) => {
  try {
    console.log("=== PRODUCTS CONTROLLER CALLED ===");
    console.log("Creating product with store entry...");
    console.log("Request body:", req.body);
    console.log("Request URL:", req.url);
    console.log("Request method:", req.method);

    const {
      item_name: name,
      sku,
      item_type,
      image_url,
      facility_id,
      user_id,
      selling_price = 0,
      sales_description = "",
      revenue_account = "",
      daily_sales_limit = null,
      weekly_sales_limit = null,
      monthly_sales_limit = null,
      cost_price = 0,
      purchase_description = "",
      quantity = 0,
      reorder_level = 0,
      inventory_account = "",
      cogs_head,
      expiry_date = null,
      batch_number = null,
      deposit_liability_account = "",
      status = "Active",
      tags = "",
      notes = "",
      // opening_balance_date = moment().format("YYYY-MM-DD"),
      supplier_id = "",
      warehouse_id = "",
      branch_id = null,
      category = "",
      unit = "",
      taxable,
      line_of_business = "",
      opening_balance_equity = "",
      as_of_date = moment().format("YYYY-MM-DD"),
    } = req.body;

    const parsedBranchId =
      branch_id == null || branch_id === "" || branch_id === "all"
        ? null
        : parseInt(branch_id, 10) || null;

    // Convert line_of_business to string
    const lineOfBusinessString = String(line_of_business);

    // Local defaults for fields not in payload
    let cogs_account = cogs_head;
    // Store entry defaults (not in payload)
    const source = "Initial Stock";
    const destination =
      item_type === "Raw Material" || item_type === "Semi Finished"
        ? "Raw Material"
        : item_type.includes("Finished Good") || item_type.includes("Resalable")
        ? item_type.includes("Returnable Assets")
          ? "Returnable Assets"
          : "Finished Good"
        : item_type.includes("Sales")
        ? "Sales"
        : "Sales";
    const supplier_code = "";

    // Validate required fields
    if (!name || !item_type || !facility_id) {
      console.log("Missing required fields:", { name, item_type, facility_id });
      return res.status(400).json({
        success: false,
        message: "Missing required fields: name, item_type, facility_id",
      });
    }

    // Validate accounts based on item_type
    const inventoryTypes = [
      "Raw Material",
      "Semi Finished",
      "Finished Good",
      "Resalable",
    ];
    const isInventoryItem = inventoryTypes.includes(item_type);

    if (isInventoryItem) {
      if (!inventory_account) {
        return res.status(400).json({
          success: false,
          message:
            "Inventory Account is required for inventory items (Raw Material, Semi Finished, Finished Good, Resalable).",
        });
      }
      if (!cogs_account) {
        return res.status(400).json({
          success: false,
          message: "COGS Account is required for inventory items.",
        });
      }
      if (
        item_type === "Finished Good" ||
        item_type === "Resalable" ||
        item_type === "Consumable"
      ) {
        if (!revenue_account) {
          return res.status(400).json({
            success: false,
            message:
              "Revenue Account is required for Finished Good, Resalable, or Consumable.",
          });
        }
      }
    } else {
      if (!revenue_account) {
        return res.status(400).json({
          success: false,
          message:
            "Revenue Account is required for non-inventory items (Other, Service).",
        });
      }
      cogs_account = "";
    }

    // Verify accounts exist in account_category and branch exists in branches
    const refs = await verifyProductAccountsAndBranch({
      facilityId: facility_id,
      itemType: item_type,
      revenueAccount: revenue_account,
      cogsAccount: cogs_account || cogs_head,
      inventoryAccount: inventory_account,
      branchId: parsedBranchId,
      quantity,
      requireBranchWhenStock: true,
    });
    if (!refs.ok) {
      return res.status(400).json({
        success: false,
        message: refs.message,
      });
    }

    // Handle store entry creation based on inventory item and quantity
    const qty_in = quantity;
    const shouldCreateStoreEntry = isInventoryItem && qty_in > 0;

    const transaction = await db.sequelize.transaction();

    try {
      console.log("Creating product in database...");
      // Create product
      const product = await db.Product.create(
        {
          name,
          sku: sku || `PROD-${Date.now()}`,
          item_type,
          image_url: image_url || "",
          facility_id,
          selling_price,
          sales_description: sales_description || null,
          revenue_account,
          daily_sales_limit:
            daily_sales_limit === "" || daily_sales_limit == null
              ? null
              : parseInt(daily_sales_limit, 10) || null,
          weekly_sales_limit:
            weekly_sales_limit === "" || weekly_sales_limit == null
              ? null
              : parseInt(weekly_sales_limit, 10) || null,
          monthly_sales_limit:
            monthly_sales_limit === "" || monthly_sales_limit == null
              ? null
              : parseInt(monthly_sales_limit, 10) || null,
          cost_price,
          purchase_description: purchase_description || null,
          cogs_head,
          supplier_id,
          reorder_level,
          warehouse_id,
          category,
          inventory_account,
          unit_of_measure: unit,
          status,
          deposit_liability_account,
          tags: tags,
          notes,
          taxable: taxable || "Taxable",
          line_of_business: line_of_business ? 1 : 0,
        },
        { transaction }
      );

      let storeEntry = null;

      // Create store entry if requested and quantity > 0
      if (shouldCreateStoreEntry && qty_in > 0) {
        console.log("Creating store entry...", {
          shouldCreateStoreEntry,
          qty_in,
        });

        // Create store entry for this receipt
        storeEntry = await db.StoreEntry.create(
          {
            product_id: product.sku, // Reference by product ID now
            batch_id: batch_number || null,
            qty_in: qty_in,
            qty_out: 0,
            cost_price: cost_price || 0,
            selling_price: selling_price || 0,
            supplier_code: supplier_code || "",
            branch_name: item_type,
            branchId: parsedBranchId,
            source: source,
            destination: destination,
            facilityId: facility_id,
            status: "Active",
            inserted_by: user_id,

            type: STORE_ENTRY_TYPE.OPENING_BALANCE,
            receive_date: new Date().toISOString().split("T")[0],
            reference_number: `${Date.now()}`,
            truckNo: "",
            waybillNo: "",
            otherInfo: "Initial stock entry",
            expiry_date: expiry_date || null,
          },
          { transaction }
        );

        // console.log("opening_balance_date", opening_balance_date);

        if (quantity > 0 && cost_price > 0) {
          const amount = cost_price * quantity;
          const narration = `Opening Balance - ${name} - Qty: ${quantity} @ ${cost_price}`;
          const ref = `OB-${Date.now()}`;
          const openingBalanceDate =
            moment(as_of_date).format("YYYY-MM-DD") ||
            moment().format("YYYY-MM-DD"); // or use store opening date

          // Opening Balance Equity (credit)
          const openingBalanceEquityAccount = await db.AccountCategory.findOne({
            where: { code: opening_balance_equity, facility_id: facility_id },
            transaction,
          });

          // Inventory Asset Account (debit)
          const inventoryAccount = await db.AccountCategory.findOne({
            where: { code: inventory_account, facility_id: facility_id },
            transaction,
          });

          if (!inventoryAccount) {
            throw new Error(
              `Inventory asset account not found for facility (${facility_id}). Missing/invalid inventory_account code: ${inventory_account}`
            );
          }

          if (!openingBalanceEquityAccount) {
            throw new Error(
              `Opening balance equity account not found for facility (${facility_id}). Missing/invalid opening_balance_equity code: ${opening_balance_equity}`
            );
          }

          // ------------------------
          //  DR Inventory Asset
          // ------------------------
          await db.GeneralLedger.create(
            {
              transaction_date: openingBalanceDate,
              account_code: inventoryAccount.code,
              account_subhead: inventoryAccount.parent_code || 0,
              dr: amount,
              cr: 0,
              account_description: inventoryAccount.description,
              transaction_description: name || inventoryAccount.description,
              reference_number: `${sku}`,
              purpose_of_payment: narration,
              created_by: user_id,
              facility_id: facility_id,
              type: "OPENING_BALANCE",
              transaction_ref: `${sku}`,
            },
            { transaction }
          );

          // ------------------------
          //  CR Opening Balance Equity
          // ------------------------
          await db.GeneralLedger.create(
            {
              transaction_date: openingBalanceDate,
              account_code: openingBalanceEquityAccount.code,
              account_subhead: openingBalanceEquityAccount.parent_code || 0,
              dr: 0,
              cr: amount,
              account_description: openingBalanceEquityAccount.description,
              transaction_description:
                name || openingBalanceEquityAccount.description,
              reference_number: `${sku}`,
              purpose_of_payment: narration,
              created_by: user_id,
              facility_id: facility_id,
              type: "OPENING_BALANCE",
              transaction_ref: `${sku}`,
            },
            { transaction }
          );
        }
      }

      // await db.InventoryValuation.create({
      //   product_id: sku,
      //   facility_id: facility_id,
      //   quantity_on_hand: quantity,
      //   avg_unit_cost: cost_price,
      //   total_value: cost_price * quantity,
      // });

      await transaction.commit();

      console.log("Product created successfully:", {
        productId: product.id,
        storeEntryId: storeEntry?.id,
      });
      res.status(201).json({
        success: true,
        message: "Product created successfully",
        data: {
          product,
          storeEntry,
        },
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error("Error creating product with store entry:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({
      success: false,
      message: "Error creating product",
      error: error.message,
    });
  }
};

// bulkCreateProductsWithStoreEntries.j
exports.bulkCreateProductsFinishedGoodAndResalable = async (req, res) => {
  const transaction = await db.sequelize.transaction();

  try {
    const products = req.body;

    if (!Array.isArray(products) || products.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Request body must be a non-empty array of products",
      });
    }

    const allowedTypes = ["Resalable", "Finished Good", "By-Product"];
    const created = [];
    const batchTs = Date.now().toString(36);

    for (let i = 0; i < products.length; i++) {
      const item = products[i];
      const index = i + 1;

      const {
        item_name: name,
        sku,
        item_type,
        image_url,
        facility_id,
        user_id,
        selling_price = 0,
        sales_description = "",
        revenue_account,
        daily_sales_limit = null,
        weekly_sales_limit = null,
        monthly_sales_limit = null,
        cost_price = 0,
        purchase_description = "",
        quantity = 0,
        branch_id = 0,
        reorder_level = 0,
        inventory_account,
        cogs_head,
        expiry_date = null,
        batch_number = null,
        deposit_liability_account = "",
        status = "Active",
        tags = "",
        notes = "",
        group_id = "",
        supplier_id = "",
        warehouse_id = "",
        taxable,
        category = "",
        unit = "",
        line_of_business = "",
        opening_balance_equity = "",
        as_of_date = moment().format("YYYY-MM-DD"),
      } = item;

      if (!name || !item_type || !facility_id || !user_id) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Item #${index} (${name || "unknown"}): Missing required fields (item_name, item_type, facility_id, user_id)`,
          failedAt: index,
        });
      }

      if (!allowedTypes.some((type) => item_type.includes(type))) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Item #${index} (${name}): Item type must be Resalable, Finished Good, or By-Product. Got: ${item_type}`,
          failedAt: index,
        });
      }

      if (!inventory_account) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Item #${index} (${name}): Inventory Account is required`,
          failedAt: index,
        });
      }

      if (!cogs_head) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Item #${index} (${name}): COGS Account is required`,
          failedAt: index,
        });
      }

      if (!revenue_account) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Item #${index} (${name}): Revenue Account is required`,
          failedAt: index,
        });
      }

      const shouldCreateStoreEntry = quantity > 0;
      const branchIdValue = parseInt(branch_id, 10) || 0;

      const refs = await verifyProductAccountsAndBranch({
        facilityId: facility_id,
        itemType: item_type,
        revenueAccount: revenue_account,
        cogsAccount: cogs_head,
        inventoryAccount: inventory_account,
        branchId: branchIdValue,
        quantity,
        requireBranchWhenStock: true,
        transaction,
      });
      if (!refs.ok) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Item #${index} (${name}): ${refs.message}`,
          failedAt: index,
        });
      }

      // Branch is required for the inventory record when there is opening stock
      if (shouldCreateStoreEntry && !branchIdValue) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Item #${index} (${name}): Branch ID is required when stock quantity is greater than 0`,
          failedAt: index,
        });
      }

      if (shouldCreateStoreEntry) {
        const branchExists = await validateBranchIdById(
          facility_id,
          branchIdValue,
          transaction
        );
        if (!branchExists) {
          await transaction.rollback();
          return res.status(400).json({
            success: false,
            message: `Item #${index} (${name}): Branch ID ${branchIdValue} does not exist for this business`,
            failedAt: index,
          });
        }
      }

      const product = await db.Product.create(
        {
          name: name.trim(),
          sku: sku || `PROD-${Date.now()}-${index}`,
          item_type,
          image_url: image_url || "",
          facility_id,
          selling_price,
          sales_description: sales_description || null,
          revenue_account,
          daily_sales_limit:
            daily_sales_limit === "" || daily_sales_limit == null
              ? null
              : parseInt(daily_sales_limit, 10) || null,
          weekly_sales_limit:
            weekly_sales_limit === "" || weekly_sales_limit == null
              ? null
              : parseInt(weekly_sales_limit, 10) || null,
          monthly_sales_limit:
            monthly_sales_limit === "" || monthly_sales_limit == null
              ? null
              : parseInt(monthly_sales_limit, 10) || null,
          cost_price,
          purchase_description: purchase_description || null,
          cogs_head,
          supplier_id,
          reorder_level,
          warehouse_id,
          taxable,
          category,
          inventory_account,
          unit_of_measure: unit,
          status,
          deposit_liability_account,
          tags: tags || "",
          notes: notes || "",
          group_id: group_id || "",
          line_of_business: line_of_business ? 1 : 0,
        },
        { transaction }
      );

      let storeEntry = null;

      if (shouldCreateStoreEntry) {
        const destination = item_type.includes("Returnable Assets")
          ? "Returnable Assets"
          : "Finished Good";

        const refNum = `BK-${batchTs}-${index}`;

        storeEntry = await db.StoreEntry.create(
          {
            product_id: product.sku,
            batch_id: batch_number || null,
            qty_in: quantity,
            qty_out: 0,
            cost_price: cost_price || 0,
            selling_price: selling_price || 0,
            supplier_code: "",
            branch_name: item_type,
            branchId: branchIdValue,
            source: "Initial Stock",
            destination,
            facilityId: facility_id,
            status: "Active",
            inserted_by: user_id,
            type: STORE_ENTRY_TYPE.OPENING_BALANCE,
            receive_date: new Date().toISOString().split("T")[0],
            reference_number: refNum,
            truckNo: "",
            waybillNo: "",
            otherInfo: "Bulk initial stock entry",
            expiry_date: expiry_date || null,
          },
          { transaction }
        );

        if (quantity > 0 && cost_price > 0 && opening_balance_equity) {
          const amount = cost_price * quantity;
          const narration = `Opening Balance (Bulk) - ${name} - Qty: ${quantity} @ ${cost_price}`;
          const transactionDate = moment(as_of_date).format("YYYY-MM-DD");

          const inventoryAcct = await db.AccountCategory.findOne({
            where: { code: inventory_account, facility_id },
            transaction,
          });

          const equityAcct = await db.AccountCategory.findOne({
            where: { code: opening_balance_equity, facility_id },
            transaction,
          });

          if (!inventoryAcct || !equityAcct) {
            await transaction.rollback();
            return res.status(400).json({
              success: false,
              message: `Item #${index} (${name}): Invalid inventory_account or opening_balance_equity code`,
              failedAt: index,
            });
          }

          await db.GeneralLedger.create(
            {
              transaction_date: transactionDate,
              account_code: inventoryAcct.code,
              account_subhead: inventoryAcct.parent_code || 0,
              dr: amount,
              cr: 0,
              account_description: inventoryAcct.description,
              transaction_description: name,
              reference_number: product.sku,
              purpose_of_payment: narration,
              created_by: user_id,
              facility_id,
              type: "OPENING_BALANCE",
              transaction_ref: product.sku,
            },
            { transaction }
          );

          await db.GeneralLedger.create(
            {
              transaction_date: transactionDate,
              account_code: equityAcct.code,
              account_subhead: equityAcct.parent_code || 0,
              dr: 0,
              cr: amount,
              account_description: equityAcct.description,
              transaction_description: name,
              reference_number: product.sku,
              purpose_of_payment: narration,
              created_by: user_id,
              facility_id,
              type: "OPENING_BALANCE",
              transaction_ref: product.sku,
            },
            { transaction }
          );
        }
      }

      created.push({
        index,
        sku: product.sku,
        name,
        storeEntryId: storeEntry?.id || null,
      });
    }

    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: `Successfully created ${created.length} products`,
      summary: {
        total: products.length,
        created: created.length,
        failed: 0,
      },
      data: { created, failed: [] },
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Error in bulk product creation:", error);
    return res.status(500).json({
      success: false,
      message: `Bulk product creation failed at processing stage: ${error.message}`,
      error: error.message,
    });
  }
};

// Update product (and optionally add opening stock)
exports.updateProduct = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { facilityId, productId } = req.params;
    const updateData = req.body || {};

    if (!facilityId || !productId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId and productId are required",
      });
    }

    const product = await db.Product.findOne({
      where: {
        id: productId,
        facility_id: facilityId,
      },
      transaction,
    });

    if (!product) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const allowedKeys = [
      "name",
      "sku",
      "category",
      "unit_of_measure",
      "item_type",
      "status",
      "selling_price",
      "cost_price",
      "mark_up",
      "markup_mode",
      "reorder_level",
      "taxable",
      "notes",
      "tags",
      "image_url",
      "cogs_head",
      "revenue_account",
      "sales_description",
      "purchase_description",
      "daily_sales_limit",
      "weekly_sales_limit",
      "monthly_sales_limit",
      "inventory_account",
      "deposit_liability_account",
      "supplier_id",
      "warehouse_id",
      "group_id",
      "is_purchased",
      "online_enabled",
    ];
    const safeUpdate = {};
    for (const key of allowedKeys) {
      if (Object.prototype.hasOwnProperty.call(updateData, key)) {
        safeUpdate[key] = updateData[key];
      }
    }

    await product.update(safeUpdate, { transaction });

    const quantity = parseFloat(updateData.quantity) || 0;
    const cost_price =
      updateData.cost_price != null
        ? parseFloat(updateData.cost_price)
        : parseFloat(product.cost_price) || 0;
    const selling_price =
      updateData.selling_price != null
        ? parseFloat(updateData.selling_price)
        : parseFloat(product.selling_price) || 0;
    const inventory_account =
      updateData.inventory_account || product.inventory_account || "";
    const revenue_account =
      updateData.revenue_account || product.revenue_account || "";
    const cogs_head = updateData.cogs_head || product.cogs_head || "";
    const opening_balance_equity = updateData.opening_balance_equity || "";
    const as_of_date =
      updateData.as_of_date || moment().format("YYYY-MM-DD");
    const user_id = updateData.user_id || null;
    const item_type = updateData.item_type || product.item_type;
    const branch_id = updateData.branch_id;
    const parsedBranchId =
      branch_id == null || branch_id === "" || branch_id === "all"
        ? 0
        : parseInt(branch_id, 10) || 0;
    const expiry_date = updateData.expiry_date || null;
    const batch_number = updateData.batch_number || null;

    const accountCheck = await verifyProductAccountsAndBranch({
      facilityId,
      itemType: item_type,
      revenueAccount: revenue_account,
      cogsAccount: cogs_head,
      inventoryAccount: inventory_account,
      branchId: parsedBranchId,
      quantity,
      requireBranchWhenStock: true,
      transaction,
    });
    if (!accountCheck.ok) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: accountCheck.message,
      });
    }

    const inventoryTypes = [
      "Raw Material",
      "Semi Finished",
      "Finished Good",
      "Resalable",
      "By-Product",
    ];
    const isInventoryItem = inventoryTypes.includes(item_type);

    let storeEntry = null;
    if (isInventoryItem && quantity > 0) {
      if (!inventory_account) {
        throw new Error(
          "Inventory account is required when adding stock quantity",
        );
      }
      if (cost_price <= 0) {
        throw new Error(
          "Cost price must be greater than 0 when adding stock quantity",
        );
      }
      if (!as_of_date) {
        throw new Error(
          "Opening balance date is required when adding stock quantity",
        );
      }

      const destination =
        item_type === "Raw Material" || item_type === "Semi Finished"
          ? "Raw Material"
          : item_type.includes("Finished Good") ||
              item_type.includes("Resalable")
            ? "Finished Good"
            : "Sales";

      storeEntry = await db.StoreEntry.create(
        {
          product_id: product.sku,
          batch_id: batch_number || null,
          qty_in: quantity,
          qty_out: 0,
          cost_price: cost_price || 0,
          selling_price: selling_price || 0,
          supplier_code: "",
          branch_name: item_type,
          branchId: parsedBranchId,
          source: "Initial Stock",
          destination,
          facilityId: facilityId,
          status: "Active",
          inserted_by: user_id,
          type: STORE_ENTRY_TYPE.OPENING_BALANCE,
          receive_date: moment(as_of_date).format("YYYY-MM-DD"),
          reference_number: `${Date.now()}`,
          truckNo: "",
          waybillNo: "",
          otherInfo: "Stock added on product update",
          expiry_date: expiry_date || null,
        },
        { transaction },
      );

      if (quantity > 0 && cost_price > 0 && opening_balance_equity) {
        const amount = cost_price * quantity;
        const narration = `Opening Balance - ${product.name} - Qty: ${quantity} @ ${cost_price}`;
        const openingBalanceDate = moment(as_of_date).format("YYYY-MM-DD");

        const openingBalanceEquityAccount = await db.AccountCategory.findOne({
          where: { code: opening_balance_equity, facility_id: facilityId },
          transaction,
        });
        const inventoryAccount = await db.AccountCategory.findOne({
          where: { code: inventory_account, facility_id: facilityId },
          transaction,
        });

        if (!inventoryAccount) {
          throw new Error(
            `Inventory asset account not found (${inventory_account})`,
          );
        }
        if (!openingBalanceEquityAccount) {
          throw new Error(
            `Opening balance equity account not found (${opening_balance_equity})`,
          );
        }

        await db.GeneralLedger.create(
          {
            transaction_date: openingBalanceDate,
            account_code: inventoryAccount.code,
            account_subhead: inventoryAccount.parent_code || 0,
            dr: amount,
            cr: 0,
            account_description: inventoryAccount.description,
            transaction_description: product.name || inventoryAccount.description,
            reference_number: `${product.sku}`,
            purpose_of_payment: narration,
            created_by: user_id,
            facility_id: facilityId,
            type: "OPENING_BALANCE",
            transaction_ref: `${product.sku}`,
          },
          { transaction },
        );

        await db.GeneralLedger.create(
          {
            transaction_date: openingBalanceDate,
            account_code: openingBalanceEquityAccount.code,
            account_subhead: openingBalanceEquityAccount.parent_code || 0,
            dr: 0,
            cr: amount,
            account_description: openingBalanceEquityAccount.description,
            transaction_description:
              product.name || openingBalanceEquityAccount.description,
            reference_number: `${product.sku}`,
            purpose_of_payment: narration,
            created_by: user_id,
            facility_id: facilityId,
            type: "OPENING_BALANCE",
            transaction_ref: `${product.sku}`,
          },
          { transaction },
        );
      }
    }

    await transaction.commit();

    res.status(200).json({
      success: true,
      message:
        quantity > 0
          ? "Product updated and stock added successfully"
          : "Product updated successfully",
      data: product,
      storeEntryId: storeEntry?.id || null,
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Error updating product:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Error updating product",
      error: error.message,
    });
  }
};
