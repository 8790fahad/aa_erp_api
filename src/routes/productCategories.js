"use strict";

module.exports = (app) => {
  const db = require("../models");
  const { ProductCategory, sequelize } = db;
  const { Op } = db.Sequelize;

  const ensureTable = async () => {
    const [rows] = await sequelize.query(`SHOW TABLES LIKE 'product_categories'`);
    if (rows?.length) return;
    await sequelize.query(`
      CREATE TABLE product_categories (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        facility_id VARCHAR(50) NOT NULL,
        name VARCHAR(120) NOT NULL,
        description VARCHAR(255) NULL,
        status ENUM('active','inactive') NOT NULL DEFAULT 'active',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY product_categories_facility_name_unique (facility_id, name),
        KEY product_categories_facility_id (facility_id)
      )
    `);
  };

  const findByNameInsensitive = async (facilityId, name, { excludeId } = {}) => {
    const trimmed = String(name || "").trim();
    if (!trimmed) return null;
    const where = {
      facility_id: String(facilityId),
      [Op.and]: sequelize.where(
        sequelize.fn("LOWER", sequelize.col("name")),
        trimmed.toLowerCase(),
      ),
    };
    if (excludeId) {
      where.id = { [Op.ne]: excludeId };
    }
    return ProductCategory.findOne({ where });
  };

  // GET /api/product-categories?facilityId=
  app.get("/api/product-categories", async (req, res) => {
    try {
      await ensureTable();
      const facilityId = req.query.facilityId || req.query.facility_id;
      if (!facilityId) {
        return res.status(400).json({
          success: false,
          message: "facilityId is required",
        });
      }
      const includeInactive =
        String(req.query.includeInactive || "") === "1" ||
        String(req.query.includeInactive || "").toLowerCase() === "true";

      const where = { facility_id: String(facilityId) };
      if (!includeInactive) where.status = "active";

      const rows = await ProductCategory.findAll({
        where,
        order: [["name", "ASC"]],
      });

      return res.json({ success: true, results: rows, data: rows });
    } catch (error) {
      console.error("get product-categories:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to load categories",
      });
    }
  });

  // POST /api/product-categories  { facilityId, name, description? }
  app.post("/api/product-categories", async (req, res) => {
    try {
      await ensureTable();
      const facilityId = req.body.facilityId || req.body.facility_id;
      const name = String(req.body.name || "").trim();
      const description = req.body.description
        ? String(req.body.description).trim()
        : null;

      if (!facilityId || !name) {
        return res.status(400).json({
          success: false,
          message: "facilityId and name are required",
        });
      }
      if (name.length > 120) {
        return res.status(400).json({
          success: false,
          message: "Category name is too long",
        });
      }

      const existing = await findByNameInsensitive(facilityId, name);
      if (existing) {
        if (String(existing.status).toLowerCase() === "active") {
          return res.status(409).json({
            success: false,
            message: `Category "${existing.name}" already exists for this business`,
            results: existing,
            data: existing,
          });
        }
        // Reactivate previously removed category instead of inserting a duplicate
        await existing.update({
          status: "active",
          name,
          description:
            description !== null ? description : existing.description,
        });
        return res.json({
          success: true,
          results: existing,
          data: existing,
          message: "Category restored",
        });
      }

      const created = await ProductCategory.create({
        facility_id: String(facilityId),
        name,
        description,
        status: "active",
      });

      return res.json({
        success: true,
        results: created,
        data: created,
        message: "Category created",
      });
    } catch (error) {
      // Unique index race / collation collision
      if (
        error?.name === "SequelizeUniqueConstraintError" ||
        Number(error?.original?.errno) === 1062
      ) {
        return res.status(409).json({
          success: false,
          message: "Category name already exists for this business",
        });
      }
      console.error("create product-category:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to create category",
      });
    }
  });

  // PUT /api/product-categories/:id
  app.put("/api/product-categories/:id", async (req, res) => {
    try {
      await ensureTable();
      const id = parseInt(req.params.id, 10);
      const facilityId = req.body.facilityId || req.body.facility_id;
      if (!id || !facilityId) {
        return res.status(400).json({
          success: false,
          message: "id and facilityId are required",
        });
      }

      const row = await ProductCategory.findOne({
        where: { id, facility_id: String(facilityId) },
      });
      if (!row) {
        return res.status(404).json({
          success: false,
          message: "Category not found",
        });
      }

      const patch = {};
      if (req.body.name != null) {
        const name = String(req.body.name).trim();
        if (!name) {
          return res.status(400).json({
            success: false,
            message: "Name cannot be empty",
          });
        }
        const clash = await findByNameInsensitive(facilityId, name, {
          excludeId: id,
        });
        if (clash && String(clash.status).toLowerCase() === "active") {
          return res.status(409).json({
            success: false,
            message: `Category "${clash.name}" already exists for this business`,
          });
        }
        patch.name = name;
      }
      if (req.body.description !== undefined) {
        patch.description = req.body.description
          ? String(req.body.description).trim()
          : null;
      }
      if (req.body.status != null) {
        const st = String(req.body.status).toLowerCase();
        if (st === "active" || st === "inactive") patch.status = st;
      }

      await row.update(patch);
      return res.json({
        success: true,
        results: row,
        data: row,
        message: "Category updated",
      });
    } catch (error) {
      if (
        error?.name === "SequelizeUniqueConstraintError" ||
        Number(error?.original?.errno) === 1062
      ) {
        return res.status(409).json({
          success: false,
          message: "Category name already exists for this business",
        });
      }
      console.error("update product-category:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to update category",
      });
    }
  });

  // DELETE /api/product-categories/:id?facilityId=
  app.delete("/api/product-categories/:id", async (req, res) => {
    try {
      await ensureTable();
      const id = parseInt(req.params.id, 10);
      const facilityId =
        req.query.facilityId ||
        req.query.facility_id ||
        req.body?.facilityId ||
        req.body?.facility_id;
      if (!id || !facilityId) {
        return res.status(400).json({
          success: false,
          message: "id and facilityId are required",
        });
      }

      const row = await ProductCategory.findOne({
        where: { id, facility_id: String(facilityId) },
      });
      if (!row) {
        return res.status(404).json({
          success: false,
          message: "Category not found",
        });
      }

      // Soft-delete so products that still reference the name stay readable
      await row.update({ status: "inactive" });
      return res.json({
        success: true,
        message: "Category removed",
      });
    } catch (error) {
      console.error("delete product-category:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to delete category",
      });
    }
  });
};
