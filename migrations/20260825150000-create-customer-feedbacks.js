"use strict";

/** Customer feedback submitted via QR on Goods Issue Note / invoices. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) =>
      typeof t === "string" ? t.toLowerCase() : String(t.tableName || t).toLowerCase(),
    );
    if (names.includes("customer_feedbacks")) return;

    await queryInterface.createTable("customer_feedbacks", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      facility_id: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      sale_code: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      customer_no: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      customer_name: {
        type: Sequelize.STRING(150),
        allowNull: true,
      },
      rating: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      comment: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      phone: {
        type: Sequelize.STRING(40),
        allowNull: true,
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

    await queryInterface.addIndex("customer_feedbacks", ["facility_id"], {
      name: "customer_feedbacks_facility_id",
    });
    await queryInterface.addIndex("customer_feedbacks", ["sale_code"], {
      name: "customer_feedbacks_sale_code",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("customer_feedbacks");
  },
};
