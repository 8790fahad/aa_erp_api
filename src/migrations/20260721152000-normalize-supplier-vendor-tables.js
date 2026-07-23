"use strict";

async function tableExists(queryInterface, tableName) {
  const tables = await queryInterface.showAllTables();
  const normalized = tables.map((t) =>
    typeof t === "string" ? t.toLowerCase() : String(t).toLowerCase(),
  );
  return normalized.includes(tableName.toLowerCase());
}

async function columnExists(queryInterface, tableName, columnName) {
  const table = await queryInterface.describeTable(tableName);
  return Boolean(table[columnName]);
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Extend suppliersinfo with vendor profile fields
    const extras = [
      ["company_name", { type: Sequelize.STRING(150), allowNull: true }],
      ["salutation", { type: Sequelize.STRING(20), allowNull: true }],
      ["first_name", { type: Sequelize.STRING(100), allowNull: true }],
      ["last_name", { type: Sequelize.STRING(100), allowNull: true }],
      ["mobile", { type: Sequelize.STRING(30), allowNull: true }],
      ["language", { type: Sequelize.STRING(50), allowNull: true }],
      ["currency", { type: Sequelize.STRING(50), allowNull: true }],
      ["payment_terms", { type: Sequelize.STRING(50), allowNull: true }],
      ["remarks", { type: Sequelize.TEXT, allowNull: true }],
    ];

    for (const [col, def] of extras) {
      if (!(await columnExists(queryInterface, "suppliersinfo", col))) {
        await queryInterface.addColumn("suppliersinfo", col, def);
      }
    }

    if (!(await tableExists(queryInterface, "supplier_contacts"))) {
      await queryInterface.createTable("supplier_contacts", {
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
        supplier_number: {
          type: Sequelize.STRING(10),
          allowNull: false,
        },
        salutation: { type: Sequelize.STRING(20), allowNull: true },
        first_name: { type: Sequelize.STRING(100), allowNull: true },
        last_name: { type: Sequelize.STRING(100), allowNull: true },
        email: { type: Sequelize.STRING(100), allowNull: true },
        work_phone: { type: Sequelize.STRING(30), allowNull: true },
        mobile: { type: Sequelize.STRING(30), allowNull: true },
        is_primary: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal(
            "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
          ),
        },
      });
      await queryInterface.addIndex("supplier_contacts", [
        "facility_id",
        "supplier_number",
      ]);
    }

    if (!(await tableExists(queryInterface, "supplier_addresses"))) {
      await queryInterface.createTable("supplier_addresses", {
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
        supplier_number: {
          type: Sequelize.STRING(10),
          allowNull: false,
        },
        address_type: {
          type: Sequelize.ENUM("billing", "shipping"),
          allowNull: false,
          defaultValue: "billing",
        },
        attention: { type: Sequelize.STRING(150), allowNull: true },
        country: { type: Sequelize.STRING(100), allowNull: true },
        street1: { type: Sequelize.STRING(250), allowNull: true },
        street2: { type: Sequelize.STRING(250), allowNull: true },
        city: { type: Sequelize.STRING(100), allowNull: true },
        state: { type: Sequelize.STRING(100), allowNull: true },
        zip: { type: Sequelize.STRING(30), allowNull: true },
        phone: { type: Sequelize.STRING(30), allowNull: true },
        fax: { type: Sequelize.STRING(30), allowNull: true },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal(
            "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
          ),
        },
      });
      await queryInterface.addIndex("supplier_addresses", [
        "facility_id",
        "supplier_number",
      ]);
      await queryInterface.addIndex("supplier_addresses", ["address_type"]);
    }
  },

  async down(queryInterface) {
    if (await tableExists(queryInterface, "supplier_contacts")) {
      await queryInterface.dropTable("supplier_contacts");
    }
    if (await tableExists(queryInterface, "supplier_addresses")) {
      await queryInterface.dropTable("supplier_addresses");
    }
    const extras = [
      "company_name",
      "salutation",
      "first_name",
      "last_name",
      "mobile",
      "language",
      "currency",
      "payment_terms",
      "remarks",
    ];
    for (const col of extras) {
      if (await columnExists(queryInterface, "suppliersinfo", col)) {
        await queryInterface.removeColumn("suppliersinfo", col);
      }
    }
  },
};
