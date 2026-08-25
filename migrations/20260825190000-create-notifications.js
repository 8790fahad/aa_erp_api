"use strict";

/** In-app notifications (per-user unread feed). */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) =>
      typeof t === "string"
        ? t.toLowerCase()
        : String(t.tableName || t).toLowerCase(),
    );
    if (names.includes("notifications")) return;

    await queryInterface.createTable("notifications", {
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
        allowNull: false,
        comment: "Recipient user id",
      },
      type: {
        type: Sequelize.STRING(40),
        allowNull: false,
        comment:
          "invoice_created | payment_collected | rebate_credit_note | rebate_payment",
      },
      title: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      body: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      link: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      entity_type: {
        type: Sequelize.STRING(80),
        allowNull: true,
      },
      entity_id: {
        type: Sequelize.STRING(120),
        allowNull: true,
      },
      actor_user_id: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      read_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    await queryInterface.addIndex(
      "notifications",
      ["user_id", "facility_id", "read_at"],
      { name: "idx_notifications_user_facility_read" },
    );
    await queryInterface.addIndex(
      "notifications",
      ["facility_id", "created_at"],
      { name: "idx_notifications_facility_created" },
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable("notifications");
  },
};
