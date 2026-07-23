const db = require("../models");
const { Op } = require("sequelize");
const { resolvePublicAssetUrl } = require("../utils/productImageStorage");
const { SELLABLE_ZONES } = require("../services/sellableStock");

const getBusinessModel = () => db.business || db.Business;

const parseMarketplaceSocialMedia = (value) => {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  return value;
};

const getProductPrimaryImage = (product) => {
  if (product?.image_url) return product.image_url;
  const images = getProductImagesList(product);
  return images.length ? images[0] : null;
};

const getProductImagesList = (product) => {
  const images = product?.product_images;
  if (Array.isArray(images) && images.length) {
    return images.filter(Boolean);
  }
  if (typeof images === "string" && images.trim()) {
    try {
      const parsed = JSON.parse(images);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [images];
    } catch {
      return [images];
    }
  }
  return product?.image_url ? [product.image_url] : [];
};

const CATALOG_ITEM_TYPES = ["Service", "Finished Good", "Resalable"];

const resolveCatalogItemTypes = (itemTypesParam) => {
  if (itemTypesParam && String(itemTypesParam).trim()) {
    const parsed = String(itemTypesParam)
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (parsed.length) return parsed;
  }
  return CATALOG_ITEM_TYPES;
};

const formatCatalogProduct = (product, stockInfo = 0, req) => {
  const images = getProductImagesList(product)
    .map((img) => resolvePublicAssetUrl(img, req))
    .filter(Boolean);
  const primaryRaw = getProductPrimaryImage(product);
  const primaryImage =
    resolvePublicAssetUrl(primaryRaw, req) || images[0] || null;
  const isService = product.item_type === "Service";

  const stockPayload =
    stockInfo && typeof stockInfo === "object" && !Array.isArray(stockInfo)
      ? stockInfo
      : { stock: Math.max(0, parseFloat(stockInfo) || 0), branches: [] };

  const qtyOnHand = Math.max(0, parseFloat(stockPayload.stock) || 0);
  const branches = Array.isArray(stockPayload.branches)
    ? stockPayload.branches
    : [];
  const primaryBranch = branches[0] || null;

  return {
    id: String(product.id),
    name: product.name,
    sku: product.sku,
    selling_price: parseFloat(product.selling_price) || 0,
    price: parseFloat(product.selling_price) || 0,
    vat: product.taxable === "Taxable",
    taxable: product.taxable,
    /** Services are always orderable; goods use sellable store balance. */
    stock: isService ? null : qtyOnHand,
    quantity_on_hand: isService ? null : qtyOnHand,
    available: isService || qtyOnHand > 0,
    isService,
    branch_id: primaryBranch?.branchId ?? null,
    branch_name: primaryBranch?.branchName || null,
    balance: isService ? null : qtyOnHand,
    branches: isService ? [] : branches,
    image: primaryImage,
    image_url: primaryImage,
    images,
    product_images: images,
    category: product.category || product.item_type || null,
    item_type: product.item_type,
    itemType: product.item_type,
    uom: product.unit_of_measure || "pcs",
    description: product.marketplace_description || "",
  };
};

/**
 * Sellable stock by physical branch from store_entries (zone: for sales).
 * Falls back to inventory_valuation facility total when no store rows exist.
 * Returns Map<productId, { stock, branches: [{ branchId, branchName, balance }] }>
 */
const buildCatalogStockMap = async (products, facilityId) => {
  const stockMap = new Map();
  const skuToProductIds = new Map();

  for (const p of products || []) {
    stockMap.set(p.id, { stock: 0, branches: [] });
    const sku = String(p.sku || "").trim();
    if (!sku) continue;
    if (!skuToProductIds.has(sku)) skuToProductIds.set(sku, []);
    skuToProductIds.get(sku).push(p.id);
  }

  const skus = [...skuToProductIds.keys()];
  if (!skus.length || !facilityId) return stockMap;

  const zoneList = [...SELLABLE_ZONES, "ready for sales"]
    .map((z) => `'${z}'`)
    .join(", ");

  try {
    // Prefer sales_dep (same source Make Sale uses) when available
    let rows = [];
    try {
      rows = await db.sequelize.query(
        `
        SELECT
          COALESCE(sd.sku, sd.product_id) AS sku,
          sd.branchId AS branch_id,
          COALESCE(
            NULLIF(TRIM(b.branch_name), ''),
            NULLIF(TRIM(sd.branch_name), ''),
            'Store'
          ) AS branch_name,
          SUM(COALESCE(sd.balance, 0)) AS balance
        FROM sales_dep sd
        LEFT JOIN branches b
          ON b.id = sd.branchId
          AND b.facilityId = sd.facilityId
        WHERE sd.facilityId = :facilityId
          AND (sd.sku IN (:skus) OR sd.product_id IN (:skus))
          AND (sd.expiry_date IS NULL OR sd.expiry_date >= CURDATE())
        GROUP BY
          COALESCE(sd.sku, sd.product_id),
          sd.branchId,
          COALESCE(
            NULLIF(TRIM(b.branch_name), ''),
            NULLIF(TRIM(sd.branch_name), ''),
            'Store'
          )
        HAVING SUM(COALESCE(sd.balance, 0)) > 0
        ORDER BY balance DESC
        `,
        {
          replacements: { facilityId, skus },
          type: db.sequelize.QueryTypes.SELECT,
        },
      );
    } catch (salesDepErr) {
      console.warn(
        "catalog sales_dep lookup failed, falling back to store_entries:",
        salesDepErr.message,
      );
    }

    if (!rows.length) {
      rows = await db.sequelize.query(
        `
        SELECT
          se.product_id AS sku,
          se.branchId AS branch_id,
          COALESCE(
            NULLIF(TRIM(b.branch_name), ''),
            NULLIF(TRIM(se.branch_name), ''),
            'Store'
          ) AS branch_name,
          SUM(COALESCE(se.qty_in, 0) - COALESCE(se.qty_out, 0)) AS balance
        FROM store_entries se
        LEFT JOIN branches b
          ON b.id = se.branchId
          AND b.facilityId = se.facilityId
        WHERE se.facilityId = :facilityId
          AND se.product_id IN (:skus)
          AND LOWER(TRIM(se.branch_name)) IN (${zoneList})
        GROUP BY
          se.product_id,
          se.branchId,
          COALESCE(
            NULLIF(TRIM(b.branch_name), ''),
            NULLIF(TRIM(se.branch_name), ''),
            'Store'
          )
        HAVING SUM(COALESCE(se.qty_in, 0) - COALESCE(se.qty_out, 0)) > 0
        ORDER BY balance DESC
        `,
        {
          replacements: { facilityId, skus },
          type: db.sequelize.QueryTypes.SELECT,
        },
      );
    }

    const branchesBySku = new Map();
    for (const row of rows) {
      const sku = String(row.sku || "").trim();
      const balance = parseFloat(row.balance || 0) || 0;
      if (!sku || balance <= 0) continue;
      if (!branchesBySku.has(sku)) branchesBySku.set(sku, []);
      branchesBySku.get(sku).push({
        branchId: row.branch_id != null ? Number(row.branch_id) : null,
        branchName: String(row.branch_name || "Store").trim() || "Store",
        balance,
      });
    }

    for (const [sku, branches] of branchesBySku.entries()) {
      const total = branches.reduce((s, b) => s + (b.balance || 0), 0);
      for (const productId of skuToProductIds.get(sku) || []) {
        stockMap.set(productId, {
          stock: total,
          branches: branches.sort((a, b) => b.balance - a.balance),
        });
      }
    }

    // Fallback: inventory_valuation when a SKU has no sellable store balance
    const missingSkus = skus.filter((sku) => !branchesBySku.has(sku));
    if (missingSkus.length && db.InventoryValuation) {
      const vals = await db.InventoryValuation.findAll({
        where: {
          facility_id: facilityId,
          product_id: { [Op.in]: missingSkus },
        },
        attributes: ["product_id", "quantity_on_hand"],
      });
      const qtyBySku = new Map();
      for (const row of vals) {
        const sku = String(row.product_id || "").trim();
        const qty = Math.max(0, parseFloat(row.quantity_on_hand || 0) || 0);
        qtyBySku.set(sku, (qtyBySku.get(sku) || 0) + qty);
      }
      for (const [sku, qty] of qtyBySku.entries()) {
        if (qty <= 0) continue;
        for (const productId of skuToProductIds.get(sku) || []) {
          stockMap.set(productId, {
            stock: qty,
            branches: [{ branchId: null, branchName: "Inventory", balance: qty }],
          });
        }
      }
    }
  } catch (err) {
    console.error("buildCatalogStockMap error:", err.message);
  }

  return stockMap;
};

const getMarketplaceBusiness = async (facilityId) => {
  const Business = getBusinessModel();
  if (!Business) {
    return null;
  }

  const business = await Business.findOne({
    where: { id: facilityId },
    attributes: [
      "id",
      "business_name",
      "business_logo",
      "description",
      "business_phone",
      "business_email",
      "business_address",
      "enable_online_ordering",
      "link_user",
      "enable_marketplace_social_media",
      "marketplace_social_media",
    ],
  });

  if (!business) {
    return null;
  }

  return business;
};

/**
 * GET /api/catalog/products?facilityId=xxx
 * Returns products and services with online_enabled=true for marketplace (FlowSpace)
 */
exports.getCatalogProducts = async (req, res) => {
  try {
    const { facilityId, search, category, itemTypes } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const allowedItemTypes = resolveCatalogItemTypes(itemTypes);

    const business = await getMarketplaceBusiness(facilityId);

    if (!business) {
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }

    if (!business.enable_online_ordering) {
      return res.status(403).json({
        success: false,
        message: "Online ordering is disabled for this business",
      });
    }

    const andConditions = [
      { facility_id: facilityId },
      { status: "Active" },
      { online_enabled: true },
      {
        [Op.or]: allowedItemTypes.map((type) => ({ item_type: type })),
      },
    ];

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      andConditions.push({
        [Op.or]: [
          { name: { [Op.like]: term } },
          { sku: { [Op.like]: term } },
          { category: { [Op.like]: term } },
        ],
      });
    }

    if (category && category.trim()) {
      andConditions.push({
        category: { [Op.like]: `%${category.trim()}%` },
      });
    }

    const products = await db.Product.findAll({
      where: { [Op.and]: andConditions },
      attributes: [
        "id",
        "name",
        "sku",
        "selling_price",
        "taxable",
        "image_url",
        "product_images",
        "marketplace_description",
        "category",
        "item_type",
        "unit_of_measure",
      ],
      order: [["name", "ASC"]],
      limit: 200,
    });

    const stockMap = await buildCatalogStockMap(products, facilityId);

    const formatted = products.map((p) => {
      const stock = stockMap.get(p.id) ?? { stock: 0, branches: [] };
      return formatCatalogProduct(p, stock, req);
    });

    res.json(formatted);
  } catch (error) {
    console.error("Error fetching catalog products:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch catalog products",
      error: error.message,
    });
  }
};

/**
 * GET /api/catalog/business?facilityId=xxx
 * Returns business profile for marketplace storefront
 */
exports.getCatalogBusiness = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const business = await getMarketplaceBusiness(facilityId);

    if (!business) {
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }

    if (!business.enable_online_ordering) {
      return res.status(403).json({
        success: false,
        message: "Online ordering is disabled for this business",
      });
    }

    return res.json({
      id: business.id,
      name: business.business_name,
      logo: resolvePublicAssetUrl(business.business_logo, req),
      description: business.description || null,
      phone: business.business_phone || null,
      email: business.business_email || null,
      address: business.business_address || null,
      linkUser: business.link_user || null,
      onlineOrdering: Boolean(business.enable_online_ordering),
      enableSocialMedia: Boolean(business.enable_marketplace_social_media),
      socialMedia: business.enable_marketplace_social_media
        ? parseMarketplaceSocialMedia(business.marketplace_social_media)
        : null,
    });
  } catch (error) {
    console.error("Error fetching catalog business:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch catalog business",
      error: error.message,
    });
  }
};

/**
 * GET /api/catalog/login-branding?slug=aafood
 * Public branding for /login/:slug — logo, name, colors (no online-ordering requirement).
 */
exports.getLoginBranding = async (req, res) => {
  try {
    const raw =
      req.query.slug ||
      req.query.link_user ||
      req.query.username ||
      req.params?.slug ||
      "";
    const slug = String(raw)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "");

    if (!slug || slug.length < 2) {
      return res.status(400).json({
        success: false,
        message: "slug is required",
      });
    }

    const Business = getBusinessModel();
    if (!Business) {
      return res.status(500).json({
        success: false,
        message: "Business model unavailable",
      });
    }

    const { Op } = require("sequelize");
    const business = await Business.findOne({
      where: {
        [Op.or]: [{ link_user: slug }, { marketplace_slug: slug }],
      },
      attributes: [
        "id",
        "business_name",
        "business_logo",
        "description",
        "primary_color",
        "secondary_color",
        "link_user",
        "marketplace_slug",
      ],
    });

    if (!business) {
      return res.status(404).json({
        success: false,
        message: "Business not found for this login link",
      });
    }

    const logo =
      resolvePublicAssetUrl(business.business_logo, req) ||
      business.business_logo ||
      null;

    return res.json({
      success: true,
      data: {
        id: business.id,
        business_name: business.business_name,
        logo,
        description: business.description || null,
        primary_color: business.primary_color || "#4267B2",
        secondary_color: business.secondary_color || null,
        link_user: business.link_user || null,
        slug: business.marketplace_slug || business.link_user || slug,
      },
    });
  } catch (error) {
    console.error("Error fetching login branding:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load login branding",
      error: error.message,
    });
  }
};

/**
 * GET /api/catalog/resolve-slug?slug=ma  OR  ?link_user=myshop
 * Resolves a marketplace username/slug to facilityId
 */
exports.resolveMarketplaceSlug = async (req, res) => {
  try {
    const raw =
      req.query.link_user || req.query.slug || req.query.username || "";
    const linkUser = String(raw)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "");

    if (!linkUser || linkUser.length < 3) {
      return res.status(400).json({
        success: false,
        message: "link_user or slug is required",
      });
    }

    const Business = getBusinessModel();
    if (!Business) {
      return res.status(500).json({
        success: false,
        message: "Business model unavailable",
      });
    }

    const { Op } = require("sequelize");
    const business = await Business.findOne({
      where: {
        [Op.or]: [{ link_user: linkUser }, { marketplace_slug: linkUser }],
      },
      attributes: [
        "id",
        "enable_online_ordering",
        "link_user",
        "marketplace_slug",
      ],
    });

    if (!business) {
      return res.status(404).json({
        success: false,
        message: "Marketplace link not found",
      });
    }

    if (!business.enable_online_ordering) {
      return res.status(403).json({
        success: false,
        message: "Online ordering is disabled for this business",
      });
    }

    return res.json({
      success: true,
      facilityId: business.id,
      link_user: business.link_user,
      slug: business.marketplace_slug,
    });
  } catch (error) {
    console.error("Error resolving marketplace slug:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to resolve marketplace slug",
      error: error.message,
    });
  }
};

/**
 * GET /api/catalog/storefront?facilityId=xxx
 * Returns business + products in one payload for marketplace
 */
exports.getCatalogStorefront = async (req, res) => {
  try {
    const { facilityId, search, category, itemTypes } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const allowedItemTypes = resolveCatalogItemTypes(itemTypes);

    const business = await getMarketplaceBusiness(facilityId);
    if (!business) {
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }

    if (!business.enable_online_ordering) {
      return res.status(403).json({
        success: false,
        message: "Online ordering is disabled for this business",
      });
    }

    const andConditions = [
      { facility_id: facilityId },
      { status: "Active" },
      { online_enabled: true },
      {
        [Op.or]: allowedItemTypes.map((type) => ({ item_type: type })),
      },
    ];

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      andConditions.push({
        [Op.or]: [
          { name: { [Op.like]: term } },
          { sku: { [Op.like]: term } },
          { category: { [Op.like]: term } },
        ],
      });
    }

    if (category && category.trim()) {
      andConditions.push({
        category: { [Op.like]: `%${category.trim()}%` },
      });
    }

    const products = await db.Product.findAll({
      where: { [Op.and]: andConditions },
      attributes: [
        "id",
        "name",
        "sku",
        "selling_price",
        "taxable",
        "image_url",
        "product_images",
        "marketplace_description",
        "category",
        "item_type",
        "unit_of_measure",
      ],
      order: [["name", "ASC"]],
      limit: 200,
    });

    const stockMap = await buildCatalogStockMap(products, facilityId);

    return res.json({
      business: {
        id: business.id,
        name: business.business_name,
        logo: resolvePublicAssetUrl(business.business_logo, req),
        description: business.description || null,
        phone: business.business_phone || null,
        email: business.business_email || null,
        address: business.business_address || null,
        onlineOrdering: Boolean(business.enable_online_ordering),
      },
      products: products.map((p) =>
        formatCatalogProduct(
          p,
          stockMap.get(p.id) ?? { stock: 0, branches: [] },
          req,
        ),
      ),
    });
  } catch (error) {
    console.error("Error fetching catalog storefront:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch catalog storefront",
      error: error.message,
    });
  }
};
