"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) =>
      typeof t === "string"
        ? t.toLowerCase()
        : String(t.tableName || t).toLowerCase(),
    );
    if (names.includes("activity_audits")) return;

    await queryInterface.createTable("activity_audits", {
      id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      facility_id: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      user_id: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      action: {
        type: Sequelize.STRING(40),
        allowNull: false,
        comment: "create | update | delete | apply | status_change",
      },
      entity_type: {
        type: Sequelize.STRING(80),
        allowNull: false,
      },
      entity_id: {
        type: Sequelize.STRING(120),
        allowNull: true,
      },
      entity_label: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      before_data: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      after_data: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      remark: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      meta: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    await queryInterface.addIndex("activity_audits", ["facility_id", "created_at"], {
      name: "idx_activity_audits_facility_created",
    });
    await queryInterface.addIndex(
      "activity_audits",
      ["facility_id", "entity_type", "entity_id"],
      { name: "idx_activity_audits_entity" },
    );
    await queryInterface.addIndex("activity_audits", ["facility_id", "action"], {
      name: "idx_activity_audits_action",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("activity_audits");
  },
};
