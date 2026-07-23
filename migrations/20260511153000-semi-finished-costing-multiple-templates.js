"use strict";

/**
 * Allow multiple costing templates per semi-finished product:
 * - template_name (unique per facility + product)
 * - is_default (which recipe Mixture / integrations prefer)
 * Drops uniq (facility_id, product_id).
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const [tables] = await queryInterface.sequelize.query(
      "SHOW TABLES LIKE 'semi_finished_costing_templates';"
    );
    if (!Array.isArray(tables) || tables.length === 0) return;

    const [cols] = await queryInterface.sequelize.query(
      "SHOW COLUMNS FROM semi_finished_costing_templates LIKE 'template_name';"
    );
    if (!Array.isArray(cols) || cols.length === 0) {
      await queryInterface.addColumn(
        "semi_finished_costing_templates",
        "template_name",
        {
          type: Sequelize.STRING(255),
          allowNull: false,
          defaultValue: "Default",
        }
      );
    }

    const [colsDef] = await queryInterface.sequelize.query(
      "SHOW COLUMNS FROM semi_finished_costing_templates LIKE 'is_default';"
    );
    if (!Array.isArray(colsDef) || colsDef.length === 0) {
      await queryInterface.addColumn(
        "semi_finished_costing_templates",
        "is_default",
        {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        }
      );
    }

    // Backfill null/empty names (if column existed without default)
    await queryInterface.sequelize.query(
      `UPDATE semi_finished_costing_templates
       SET template_name = 'Default'
       WHERE template_name IS NULL OR template_name = ''`
    );

    const [indexes] = await queryInterface.sequelize.query(
      "SHOW INDEX FROM semi_finished_costing_templates WHERE Key_name = 'uniq_semi_finished_costing_facility_product'"
    );
    if (Array.isArray(indexes) && indexes.length > 0) {
      await queryInterface.removeIndex(
        "semi_finished_costing_templates",
        "uniq_semi_finished_costing_facility_product"
      );
    }

    const [idxComposite] = await queryInterface.sequelize.query(
      "SHOW INDEX FROM semi_finished_costing_templates WHERE Key_name = 'uniq_semi_finished_costing_facility_prod_name'"
    );
    if (!Array.isArray(idxComposite) || idxComposite.length === 0) {
      await queryInterface.addIndex(
        "semi_finished_costing_templates",
        ["facility_id", "product_id", "template_name"],
        {
          unique: true,
          name: "uniq_semi_finished_costing_facility_prod_name",
        }
      );
    }

    const [idxLookup] = await queryInterface.sequelize.query(
      "SHOW INDEX FROM semi_finished_costing_templates WHERE Key_name = 'idx_semi_finished_costing_facility_product'"
    );
    if (!Array.isArray(idxLookup) || idxLookup.length === 0) {
      await queryInterface.addIndex(
        "semi_finished_costing_templates",
        ["facility_id", "product_id"],
        { name: "idx_semi_finished_costing_facility_product" }
      );
    }
  },

  down: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const [tables] = await queryInterface.sequelize.query(
      "SHOW TABLES LIKE 'semi_finished_costing_templates';"
    );
    if (!Array.isArray(tables) || tables.length === 0) return;

    try {
      await queryInterface.removeIndex(
        "semi_finished_costing_templates",
        "uniq_semi_finished_costing_facility_prod_name"
      );
    } catch (_) {
      /* ignore */
    }
    try {
      await queryInterface.removeIndex(
        "semi_finished_costing_templates",
        "idx_semi_finished_costing_facility_product"
      );
    } catch (_) {
      /* ignore */
    }

    try {
      await queryInterface.removeColumn(
        "semi_finished_costing_templates",
        "template_name"
      );
    } catch (_) {
      /* ignore */
    }
    try {
      await queryInterface.removeColumn(
        "semi_finished_costing_templates",
        "is_default"
      );
    } catch (_) {
      /* ignore */
    }

    await queryInterface.addIndex(
      "semi_finished_costing_templates",
      ["facility_id", "product_id"],
      {
        unique: true,
        name: "uniq_semi_finished_costing_facility_product",
      }
    );
  },
};
