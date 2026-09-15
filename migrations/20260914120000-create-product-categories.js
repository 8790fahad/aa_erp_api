"use strict";

/** Facility product categories (selectable on product form). */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const names = (tables || []).map((t) =>
      String(typeof t === "string" ? t : t.tableName || t.name || "").toLowerCase(),
    );
    if (names.includes("product_categories")) return;

    await queryInterface.createTable("product_categories", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      facility_id: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING(120),
        allowNull: false,
      },
      description: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM("active", "inactive"),
        allowNull: false,
        defaultValue: "active",
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    await queryInterface.addIndex("product_categories", ["facility_id"], {
      name: "product_categories_facility_id",
    });
    await queryInterface.addIndex(
      "product_categories",
      ["facility_id", "name"],
      {
        unique: true,
        name: "product_categories_facility_name_unique",
      },
    );

    // Seed from distinct product.category values already in use
    await queryInterface.sequelize.query(`
      INSERT IGNORE INTO product_categories (facility_id, name, status, created_at, updated_at)
      SELECT DISTINCT
        p.facility_id,
        TRIM(p.category),
        'active',
        NOW(),
        NOW()
      FROM products p
      WHERE p.facility_id IS NOT NULL
        AND p.category IS NOT NULL
        AND TRIM(p.category) != ''
        AND LOWER(TRIM(p.category)) NOT IN ('general')
    `);
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    const names = (tables || []).map((t) =>
      String(typeof t === "string" ? t : t.tableName || t.name || "").toLowerCase(),
    );
    if (names.includes("product_categories")) {
      await queryInterface.dropTable("product_categories");
    }
  },
};
