const db = require("../models");
const moment = require("moment");
const { v4: uuidv4 } = require("uuid");
const { persistProductImages } = require("../utils/productImageStorage");
const Product = db.products;
const ProductMultiplier = db.product_multipliers;

const ONLINE_ELIGIBLE_ITEM_TYPES = [
  "Finished Good",
  "Resalable",
  "By-Product",
  "Service",
];

// Number generator function - returns a Promise
async function numberGenerator({ query_type = "", facilityId = "" }) {
  try {
    const result = await db.sequelize.query(
      "CALL nurmber_generator1(:query_type,:facilityId)",
      {
        replacements: {
          query_type,
          facilityId,
        },
        type: db.sequelize.QueryTypes.RAW,
      }
    );
    return result;
  } catch (err) {
    console.error("Error in numberGenerator:", err);
    throw err;
  }
}

// Create a new product
exports.createProduct = async (req, res) => {
  try {
    const {
      name,
      sku,
      itemType,
      imageUrl,
      sales,
      purchase,
      inventory,
      settings,
      facilityId,
      taxable,
    } = req.body;

    // Validate required fields
    if (!name || !itemType || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: name, itemType, facilityId",
      });
    }

    try {
      const existing = await db.Product.findOne({
        where: {
          facility_id: facilityId,
          [db.Sequelize.Op.and]: db.sequelize.where(
            db.sequelize.fn(
              "LOWER",
              db.sequelize.fn("TRIM", db.sequelize.col("name")),
            ),
            String(name).trim().toLowerCase(),
          ),
        },
        attributes: ["id"],
      });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: `Product name "${String(name).trim()}" already exists. Product name must be unique.`,
        });
      }
    } catch (dupErr) {
      console.error("createProduct name check:", dupErr);
    }

    // Generate product ID using numberGenerator
    numberGenerator(
      { query_type: "PRODUCT", facilityId },
      async (result) => {
        try {
          const productId = result[0]?.id || `PROD-${Date.now()}`;

          // Generate SKU if not provided
          const generatedSku = sku || `PROD-${Date.now()}`;

          // Create product using Sequelize model
          const product = await db.Product.create({
            facility_id: facilityId,
            name,
            sku: generatedSku,
            item_type: itemType,
            image_url: imageUrl || null,
            sales_description: sales?.description || null,
            selling_price: sales?.price || 0,
            tax_rate: sales?.taxRate || "None",
            revenue_account: sales?.revenueAccount || null,
            purchase_description: purchase?.description || null,
            cost_price: purchase?.costPrice || 0,
            supplier_id: purchase?.supplierId || null,
            expense_account: purchase?.expenseAccount || null,
            stock_quantity: inventory?.quantity || 0,
            reorder_level: inventory?.reorderLevel || 0,
            preferred_supplier_id: inventory?.preferredSupplierId || null,
            warehouse_id: inventory?.warehouseId || null,
            unit_of_measure: inventory?.unitOfMeasure || "pcs",
            status: settings?.status || "Active",
            taxable: taxable || "Taxable",
            tags: settings?.tags || [],
            notes: settings?.notes || null,
          });

          res.status(201).json({
            success: true,
            data: {
              productId: product.id,
              message: "Product created successfully",
            },
          });
        } catch (createError) {
          console.error("Error creating product:", createError);
          res.status(500).json({
            success: false,
            message: "Error creating product",
            error: createError.message,
          });
        }
      },
      (error) => {
        console.error("Error generating product ID:", error);
        res.status(500).json({
          success: false,
          message: "Error generating product ID",
          error: error.message,
        });
      }
    );
  } catch (error) {
    console.error("Error in createProduct:", error);
    res.status(500).json({
      success: false,
      message: "Error creating product",
      error: error.message,
    });
  }
};

// Get all products for a facility
exports.getProducts = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // const products = await db.Product.findAll({
    //   where: { facility_id: facilityId },
    //   order: [["created_at", "DESC"]],
    // });
    const products = await db.Product.findAll({
      where: { facility_id: facilityId },
      attributes: [
        "id",
        "name",
        "sku",
        "item_type",
        "category",
        "unit_of_measure",
        "cost_price",
        "selling_price",
        "status",
        "taxable",
        "online_enabled",
        "image_url",
        "product_images",
        "marketplace_description",
        "reorder_level",
        "revenue_account",
        "cogs_head",
        "inventory_account",
        "daily_sales_limit",
        "weekly_sales_limit",
        "monthly_sales_limit",
        "sales_stopped",
        "created_at",
        "updated_at",
      ],
      order: [["name", "ASC"]],
    });

    res.json({
      success: true,
      data: products,
    });
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching products",
      error: error.message,
    });
  }
};

// Get product by ID
exports.getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId } = req.query;

    const product = await db.Product.findOne({
      where: {
        id: id,
        facility_id: facilityId,
      },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.json({
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

// Update product
exports.updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      sku,
      itemType,
      imageUrl,
      sales,
      purchase,
      inventory,
      settings,
      facilityId,
    } = req.body;

    // Find the product first
    const product = await db.Product.findOne({
      where: {
        id: id,
        facility_id: facilityId,
      },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Update the product
    await product.update({
      name,
      sku: sku || product.sku,
      item_type: itemType,
      image_url: imageUrl || null,
      sales_description: sales?.description || null,
      selling_price: sales?.price || 0,
      tax_rate: sales?.taxRate || "None",
      revenue_account: sales?.revenueAccount || null,
      purchase_description: purchase?.description || null,
      cost_price: purchase?.costPrice || 0,
      supplier_id: purchase?.supplierId || null,
      expense_account: purchase?.expenseAccount || null,
      stock_quantity: inventory?.quantity || 0,
      reorder_level: inventory?.reorderLevel || 0,
      preferred_supplier_id: inventory?.preferredSupplierId || null,
      warehouse_id: inventory?.warehouseId || null,
      unit_of_measure: inventory?.unitOfMeasure || "pcs",
      status: settings?.status || "Active",
      taxable:
        settings?.taxable !== undefined ? settings.taxable : product.taxable,
      tags: settings?.tags || [],
      notes: settings?.notes || null,
    });

    res.json({
      success: true,
      data: {
        productId: id,
        message: "Product updated successfully",
      },
    });
  } catch (error) {
    console.error("Error updating product:", error);
    res.status(500).json({
      success: false,
      message: "Error updating product",
      error: error.message,
    });
  }
};

// Update only the `notes` field on a product (used to persist semi-finished
// costing data as JSON, similar to product_groups.notes for shared costing).
exports.updateProductNotes = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes, facilityId } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const product = await db.Product.findOne({
      where: {
        id: id,
        facility_id: facilityId,
      },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    await product.update({
      notes: notes == null ? null : String(notes),
    });

    res.json({
      success: true,
      data: {
        productId: id,
        message: "Product notes updated successfully",
      },
    });
  } catch (error) {
    console.error("Error updating product notes:", error);
    res.status(500).json({
      success: false,
      message: "Error updating product notes",
      error: error.message,
    });
  }
};

// Update product taxable status
exports.updateProductTaxable = async (req, res) => {
  try {
    const { id } = req.params;
    const { taxable, facilityId } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    if (!taxable || !["Taxable", "Not Taxable"].includes(taxable)) {
      return res.status(400).json({
        success: false,
        message: "taxable must be either 'Taxable' or 'Not Taxable'",
      });
    }

    const product = await db.Product.findOne({
      where: {
        id: id,
        facility_id: facilityId,
      },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    await product.update({
      taxable: taxable,
    });

    res.json({
      success: true,
      data: {
        productId: id,
        taxable: taxable,
        message: "Product taxable status updated successfully",
      },
    });
  } catch (error) {
    console.error("Error updating product taxable status:", error);
    res.status(500).json({
      success: false,
      message: "Error updating product taxable status",
      error: error.message,
    });
  }
};

// Update product online_enabled flag (for online/WhatsApp catalog availability)
exports.updateProductOnlineStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { online_enabled, facilityId } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    if (typeof online_enabled === "undefined") {
      return res.status(400).json({
        success: false,
        message: "online_enabled is required (boolean)",
      });
    }

    const product = await db.Product.findOne({
      where: {
        id: id,
        facility_id: facilityId,
      },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const enablingOnline = Boolean(online_enabled);
    if (
      enablingOnline &&
      !ONLINE_ELIGIBLE_ITEM_TYPES.includes(product.item_type)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Only Finished Good, Resalable, By-Product, and Service items can be enabled for online ordering",
      });
    }

    await product.update({
      online_enabled: enablingOnline,
    });

    res.json({
      success: true,
      data: {
        productId: id,
        online_enabled: Boolean(online_enabled),
        message: "Product online status updated successfully",
      },
    });
  } catch (error) {
    console.error("Error updating product online status:", error);
    res.status(500).json({
      success: false,
      message: "Error updating product online status",
      error: error.message,
    });
  }
};

// Toggle product status (Active <-> Inactive)
exports.updateProductStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId } = req.body;

    if (!facilityId) {
      return res.status(400).json({ success: false, message: "facilityId is required" });
    }

    const product = await db.Product.findOne({
      where: { id, facility_id: facilityId },
    });

    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const newStatus = product.status === "Active" ? "Inactive" : "Active";
    await product.update({ status: newStatus });

    res.json({
      success: true,
      data: { productId: id, status: newStatus },
    });
  } catch (error) {
    console.error("Error toggling product status:", error);
    res.status(500).json({ success: false, message: "Error toggling product status", error: error.message });
  }
};

const normalizeProductImagesInput = (value) => {
  if (!value) return [];
  let list = value;
  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch {
      list = [value];
    }
  }
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list
    .map((item) => String(item || "").trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
};

// Update product selling price from product list quick action
exports.updateProductSellingPrice = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId, selling_price } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const price = parseFloat(selling_price);
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({
        success: false,
        message: "selling_price must be a valid number greater than or equal to 0",
      });
    }

    const product = await db.Product.findOne({
      where: { id, facility_id: facilityId },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    await product.update({ selling_price: price });

    res.json({
      success: true,
      data: {
        productId: id,
        selling_price: price,
        message: "Product price updated successfully",
      },
    });
  } catch (error) {
    console.error("Error updating product selling price:", error);
    res.status(500).json({
      success: false,
      message: "Error updating product selling price",
      error: error.message,
    });
  }
};

// Set / clear sales target (daily | weekly | monthly) from product list
exports.updateProductSalesTarget = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId, period, quantity } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const allowed = ["none", "daily", "weekly", "monthly"];
    const periodNorm = String(period || "none").toLowerCase();
    if (!allowed.includes(periodNorm)) {
      return res.status(400).json({
        success: false,
        message: "period must be none, daily, weekly, or monthly",
      });
    }

    let qty = null;
    if (periodNorm !== "none") {
      qty = parseInt(String(quantity).replace(/,/g, ""), 10);
      if (!Number.isFinite(qty) || qty <= 0) {
        return res.status(400).json({
          success: false,
          message: "quantity must be a positive whole number",
        });
      }
    }

    const product = await db.Product.findOne({
      where: { id, facility_id: facilityId },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const payload = {
      daily_sales_limit: null,
      weekly_sales_limit: null,
      monthly_sales_limit: null,
    };
    if (periodNorm === "daily") payload.daily_sales_limit = qty;
    if (periodNorm === "weekly") payload.weekly_sales_limit = qty;
    if (periodNorm === "monthly") payload.monthly_sales_limit = qty;

    await product.update(payload);

    res.json({
      success: true,
      data: {
        productId: id,
        ...payload,
        message: "Sales target updated successfully",
      },
    });
  } catch (error) {
    console.error("Error updating product sales target:", error);
    res.status(500).json({
      success: false,
      message: "Error updating product sales target",
      error: error.message,
    });
  }
};

// Toggle stop-sales flag from product list
exports.updateProductStopSales = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId, sales_stopped } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    if (typeof sales_stopped !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "sales_stopped must be a boolean",
      });
    }

    const product = await db.Product.findOne({
      where: { id, facility_id: facilityId },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    await product.update({ sales_stopped });

    res.json({
      success: true,
      data: {
        productId: id,
        sales_stopped,
        message: sales_stopped
          ? "Sales stopped for this product"
          : "Sales resumed for this product",
      },
    });
  } catch (error) {
    console.error("Error updating product stop sales:", error);
    res.status(500).json({
      success: false,
      message: "Error updating product stop sales",
      error: error.message,
    });
  }
};

// Update product images (multiple) from product list quick action
exports.updateProductImages = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId, product_images, image_url } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const product = await db.Product.findOne({
      where: { id, facility_id: facilityId },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const images = normalizeProductImagesInput(product_images);
    const rawPrimary = String(image_url || "").trim();
    const sourceImages = rawPrimary
      ? [rawPrimary, ...images.filter((img) => img !== rawPrimary)]
      : images;

    const persistedImages = await persistProductImages(sourceImages, {
      facilityId,
      productId: id,
      req,
    });

    const primaryImage = persistedImages[0] || null;
    const orderedImages = persistedImages;

    await product.update({
      product_images: orderedImages,
      image_url: primaryImage,
    });

    res.json({
      success: true,
      data: {
        productId: id,
        image_url: primaryImage,
        product_images: orderedImages,
        message: "Product images updated successfully",
      },
    });
  } catch (error) {
    console.error("Error updating product images:", error);
    const statusCode =
      /invalid|exceeds|limit/i.test(error.message || "") ? 400 : 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error updating product images",
      error: error.message,
    });
  }
};

// Update marketplace description from product list quick action
exports.updateProductDescription = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId, marketplace_description } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const product = await db.Product.findOne({
      where: { id, facility_id: facilityId },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const description = String(marketplace_description ?? "").trim();

    await product.update({ marketplace_description: description || null });

    res.json({
      success: true,
      data: {
        productId: id,
        marketplace_description: description || null,
        message: "Product description updated successfully",
      },
    });
  } catch (error) {
    console.error("Error updating product description:", error);
    res.status(500).json({
      success: false,
      message: "Error updating product description",
      error: error.message,
    });
  }
};

// Delete product — blocked if product still has stock (sum(qty_in) - sum(qty_out) > 0)
exports.deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({ success: false, message: "facilityId is required" });
    }

    const product = await db.Product.findOne({
      where: { id, facility_id: facilityId },
    });

    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    // Block deletion if the product still has stock on hand
    const [stockRow] = await db.sequelize.query(
      `SELECT COALESCE(SUM(qty_in), 0) - COALESCE(SUM(qty_out), 0) AS balance
       FROM store_entries
       WHERE product_id = :sku AND facilityId = :facilityId`,
      {
        replacements: { sku: product.sku, facilityId },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );

    const balance = parseFloat(stockRow?.balance ?? 0);
    if (balance > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete "${product.name}" — it still has ${balance} unit(s) in stock. Clear the stock first before deleting.`,
      });
    }

    await product.destroy();

    res.json({
      success: true,
      data: { productId: id, message: "Product deleted successfully" },
    });
  } catch (error) {
    console.error("Error deleting product:", error);
    res.status(500).json({ success: false, message: "Error deleting product", error: error.message });
  }
};

/** CoA brand label: "BUA PRODUCTS" → "BUA" */
function brandLabelFromCoaDescription(description) {
  const raw = String(description || "").trim();
  if (!raw) return "";
  if (/ products$/i.test(raw)) {
    return raw.replace(/\s+products$/i, "").trim();
  }
  return raw;
}

// Get product categories (product.category + CoA brand groups e.g. BUA, Dangote)
exports.getCategories = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const [byCategory, byItemType, coaBrandRows] = await Promise.all([
      db.Product.findAll({
        where: {
          facility_id: facilityId,
          category: {
            [db.Sequelize.Op.and]: [
              { [db.Sequelize.Op.ne]: null },
              { [db.Sequelize.Op.ne]: "" },
            ],
          },
        },
        attributes: [
          "category",
          [db.sequelize.fn("COUNT", db.sequelize.col("id")), "count"],
        ],
        group: ["category"],
        raw: true,
      }),
      db.Product.findAll({
        where: { facility_id: facilityId },
        attributes: [
          "item_type",
          [db.sequelize.fn("COUNT", db.sequelize.col("id")), "count"],
        ],
        group: ["item_type"],
        raw: true,
      }),
      // Inventory / revenue brand heads under CoA (… PRODUCTS)
      db.sequelize.query(
        `
          SELECT
            ac.code,
            ac.description,
            ac.category AS coa_category,
            (
              SELECT COUNT(*)
              FROM products p
              WHERE p.facility_id = ac.facility_id
                AND (
                  LOWER(TRIM(IFNULL(p.category, ''))) = LOWER(TRIM(
                    CASE
                      WHEN UPPER(TRIM(ac.description)) LIKE '% PRODUCTS'
                      THEN TRIM(SUBSTRING(TRIM(ac.description), 1, CHAR_LENGTH(TRIM(ac.description)) - 9))
                      ELSE TRIM(ac.description)
                    END
                  ))
                  OR CAST(p.revenue_account AS CHAR) IN (
                    SELECT CAST(c.code AS CHAR)
                    FROM account_category c
                    WHERE c.facility_id = ac.facility_id
                      AND CAST(c.parent_code AS CHAR) = CAST(ac.code AS CHAR)
                  )
                  OR CAST(p.cogs_head AS CHAR) IN (
                    SELECT CAST(c2.code AS CHAR)
                    FROM account_category c2
                    WHERE c2.facility_id = ac.facility_id
                      AND CAST(c2.parent_code AS CHAR) = CAST(ac.code AS CHAR)
                  )
                )
            ) AS product_count
          FROM account_category ac
          WHERE ac.facility_id = :facilityId
            AND ac.is_active = 1
            AND UPPER(TRIM(ac.description)) LIKE '% PRODUCTS'
            AND LOWER(IFNULL(ac.category, '')) IN ('assets', 'revenue')
          ORDER BY ac.description ASC
        `,
        {
          replacements: { facilityId },
          type: db.Sequelize.QueryTypes.SELECT,
        },
      ),
    ]);

    const map = new Map();

    const upsert = (name, count, source) => {
      const key = String(name || "").trim();
      if (!key) return;
      const prev = map.get(key.toLowerCase());
      if (prev) {
        prev.count = Math.max(prev.count, parseInt(count, 10) || 0);
        if (source === "category" || source === "coa") prev.source = source;
        return;
      }
      map.set(key.toLowerCase(), {
        category: key,
        count: parseInt(count, 10) || 0,
        source,
      });
    };

    (byCategory || [])
      .filter((c) => c.category)
      .forEach((c) => upsert(c.category, c.count, "category"));

    (coaBrandRows || []).forEach((row) => {
      const label = brandLabelFromCoaDescription(row.description);
      upsert(label, row.product_count, "coa");
    });

    // Fall back to item_type only when nothing else exists
    if (map.size === 0) {
      (byItemType || [])
        .filter((c) => c.item_type)
        .forEach((c) => upsert(c.item_type, c.count, "item_type"));
    }

    const formattedCategories = [...map.values()].sort((a, b) =>
      String(a.category).localeCompare(String(b.category)),
    );

    res.json({
      success: true,
      data: formattedCategories,
    });
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching categories",
      error: error.message,
    });
  }
};

// Get suppliers
exports.getSuppliers = async (req, res) => {
  try {
    const { facilityId } = req.query;

    const suppliers = await db.Supplier.findAll({
      where: { facility_id: facilityId },
      attributes: ["id", "name", "contact_person", "email", "phone", "address"],
      order: [["name", "ASC"]],
    });

    res.json({
      success: true,
      data: suppliers,
    });
  } catch (error) {
    console.error("Error fetching suppliers:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching suppliers",
      error: error.message,
    });
  }
};

// Get accounts
exports.getAccounts = async (req, res) => {
  try {
    const { facilityId } = req.query;

    const accounts = await db.Account.findAll({
      where: { facility_id: facilityId },
      attributes: ["id", "code", "name", "account_type"],
      order: [["code", "ASC"]],
    });

    res.json({
      success: true,
      data: accounts,
    });
  } catch (error) {
    console.error("Error fetching accounts:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching accounts",
      error: error.message,
    });
  }
};

// Get warehouses
exports.getWarehouses = async (req, res) => {
  try {
    const { facilityId } = req.query;

    const warehouses = await db.Warehouse.findAll({
      where: { facility_id: facilityId },
      attributes: ["id", "name", "location", "address"],
      order: [["name", "ASC"]],
    });

    res.json({
      success: true,
      data: warehouses,
    });
  } catch (error) {
    console.error("Error fetching warehouses:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching warehouses",
      error: error.message,
    });
  }
};

// Bulk import products
exports.bulkImport = async (req, res) => {
  try {
    const { products, facilityId } = req.body;

    if (!products || !Array.isArray(products)) {
      return res.status(400).json({
        success: false,
        message: "Products array is required",
      });
    }

    const results = [];
    const errors = [];

    for (const productData of products) {
      try {
        // Generate product ID using numberGenerator
        numberGenerator(
          { query_type: "PRODUCT", facilityId },
          async (result) => {
            try {
              const productId =
                result[0]?.id ||
                `PROD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

              const product = await db.Product.create({
                id: productId,
                facility_id: facilityId,
                name: productData.name,
                sku: productData.sku || productId,
                item_type: productData.itemType || "Inventory",
                image_url: productData.imageUrl || null,
                sales_description: productData.sales?.description || null,
                selling_price: productData.sales?.price || 0,
                tax_rate: productData.sales?.taxRate || "None",
                revenue_account: productData.sales?.revenueAccount || null,
                purchase_description: productData.purchase?.description || null,
                cost_price: productData.purchase?.costPrice || 0,
                supplier_id: productData.purchase?.supplierId || null,
                expense_account: productData.purchase?.expenseAccount || null,
                stock_quantity: productData.inventory?.quantity || 0,
                reorder_level: productData.inventory?.reorderLevel || 0,
                preferred_supplier_id:
                  productData.inventory?.preferredSupplierId || null,
                warehouse_id: productData.inventory?.warehouseId || null,
                unit_of_measure: productData.inventory?.unitOfMeasure || "pcs",
                status: productData.settings?.status || "Active",
                tags: productData.settings?.tags || [],
                notes: productData.settings?.notes || null,
              });

              results.push({
                productId: product.id,
                name: productData.name,
                status: "success",
              });
            } catch (createError) {
              errors.push({
                name: productData.name,
                error: createError.message,
                status: "error",
              });
            }
          },
          (error) => {
            errors.push({
              name: productData.name,
              error: error.message,
              status: "error",
            });
          }
        );
      } catch (error) {
        errors.push({
          name: productData.name,
          error: error.message,
          status: "error",
        });
      }
    }

    res.json({
      success: true,
      data: {
        imported: results.length,
        errors: errors.length,
        results,
        errors,
      },
    });
  } catch (error) {
    console.error("Error bulk importing products:", error);
    res.status(500).json({
      success: false,
      message: "Error bulk importing products",
      error: error.message,
    });
  }
};

// Bulk export products
exports.bulkExport = async (req, res) => {
  try {
    const { facilityId, format = "csv" } = req.query;

    const products = await db.Product.findAll({
      where: { facility_id: facilityId },
      order: [["created_at", "DESC"]],
    });

    res.json({
      success: true,
      data: products,
    });
  } catch (error) {
    console.error("Error bulk exporting products:", error);
    res.status(500).json({
      success: false,
      message: "Error bulk exporting products",
      error: error.message,
    });
  }
};

// ==================== PRODUCT MULTIPLIERS ====================

// Create a new product multiplier
exports.createProductMultiplier = async (req, res) => {
  try {
    const {
      description,
      multiplier_value,
      multiplier_type,
      category,
      unit,
      product_id,
      product_name,
      sku,
      status,
      facilityId,
      createdBy,
    } = req.body;

    // Validate required fields
    if (
      !multiplier_type ||
      !multiplier_value ||
      !product_id ||
      !product_name ||
      !sku ||
      !facilityId ||
      !createdBy
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: multiplier_type, multiplier_value, product_id, product_name, sku, facilityId, createdBy",
      });
    }

    // Create the product multiplier
    const productMultiplier = await db.product_multipliers.create({
      multiplier_type,
      description,
      multiplier_value,
      category,
      unit,
      product_id: sku,
      product_name,
      sku,
      status: status || "active",
      facilityId,
      createdBy,
    });

    res.status(201).json({
      success: true,
      message: "Product multiplier created successfully",
      data: productMultiplier,
    });
  } catch (error) {
    console.error("Error creating product multiplier:", error);
    res.status(500).json({
      success: false,
      message: "Error creating product multiplier",
      error: error.message,
    });
  }
};

// Get all product multipliers

exports.getProductMultipliers = async (req, res) => {
  try {
    const { facilityId, status, product_id, search } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const whereClause = { facilityId };
    if (status && status !== "all") whereClause.status = status;
    if (product_id) whereClause.product_id = product_id;

    if (search) {
      whereClause[db.Sequelize.Op.or] = [
        { multiplier_type: { [db.Sequelize.Op.iLike]: `%${search}%` } },
        { sku: { [db.Sequelize.Op.iLike]: `%${search}%` } },
        { description: { [db.Sequelize.Op.iLike]: `%${search}%` } },
      ];
    }

    const multipliers = await db.sequelize.query(
      `
      SELECT
        pm.id,
        pm.sku,
        p.name AS product_name,
        pm.multiplier_value,
        pm.multiplier_type,
        pm.createdAt,
        pm.updatedAt,
        pm.status
      FROM product_multipliers pm
      LEFT JOIN products p
        ON pm.sku = p.sku
      WHERE pm.facilityId = :facilityId
      ORDER BY pm.createdAt DESC
      `,
      {
        replacements: { facilityId },
        type: db.Sequelize.QueryTypes.SELECT,
      }
    );
    res.json({
      success: true,
      data: multipliers,
      count: multipliers.length,
    });
  } catch (error) {
    console.error("Error fetching product multipliers:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching product multipliers",
      error: error.message,
    });
  }
};

// Get product multiplier by ID
exports.getProductMultiplierById = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const multiplier = await db.product_multipliers.findOne({
      where: {
        id,
        facilityId,
      },
    });

    if (!multiplier) {
      return res.status(404).json({
        success: false,
        message: "Product multiplier not found",
      });
    }

    res.json({
      success: true,
      data: multiplier,
    });
  } catch (error) {
    console.error("Error fetching product multiplier:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching product multiplier",
      error: error.message,
    });
  }
};

// Update product multiplier
exports.updateProductMultiplier = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      description,
      multiplier_value,
      multiplier_type,
      category,
      unit,
      product_id,
      product_name,
      sku,
      status,
      facilityId,
    } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Find the multiplier
    const multiplier = await db.product_multipliers.findOne({
      where: {
        id,
        facilityId,
      },
    });

    if (!multiplier) {
      return res.status(404).json({
        success: false,
        message: "Product multiplier not found",
      });
    }

    // Update the multiplier
    await multiplier.update({
      description,
      multiplier_value,
      multiplier_type,
      category,
      unit,
      product_id,
      product_name,
      sku,
      status,
    });

    res.json({
      success: true,
      message: "Product multiplier updated successfully",
      data: multiplier,
    });
  } catch (error) {
    console.error("Error updating product multiplier:", error);
    res.status(500).json({
      success: false,
      message: "Error updating product multiplier",
      error: error.message,
    });
  }
};

// Delete product multiplier
exports.deleteProductMultiplier = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const multiplier = await db.product_multipliers.findOne({
      where: {
        id,
        facilityId,
      },
    });

    if (!multiplier) {
      return res.status(404).json({
        success: false,
        message: "Product multiplier not found",
      });
    }

    await multiplier.destroy();

    res.json({
      success: true,
      message: "Product multiplier deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting product multiplier:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting product multiplier",
      error: error.message,
    });
  }
};

// Toggle product multiplier status
exports.toggleProductMultiplierStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const multiplier = await db.product_multipliers.findOne({
      where: {
        id,
        facilityId,
      },
    });

    if (!multiplier) {
      return res.status(404).json({
        success: false,
        message: "Product multiplier not found",
      });
    }

    // Toggle status
    const newStatus = multiplier.status === "active" ? "inactive" : "active";
    await multiplier.update({ status: newStatus });

    res.json({
      success: true,
      message: `Product multiplier ${
        newStatus === "active" ? "activated" : "deactivated"
      } successfully`,
      data: multiplier,
    });
  } catch (error) {
    console.error("Error toggling product multiplier status:", error);
    res.status(500).json({
      success: false,
      message: "Error toggling product multiplier status",
      error: error.message,
    });
  }
};
