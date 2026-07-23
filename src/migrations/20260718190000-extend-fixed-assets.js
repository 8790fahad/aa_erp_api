"use strict";

/**
 * Extend the fixed-asset register:
 *  - asset naming, supplier, attachments and FIRS capital-allowance fields on `assets`
 *  - add "Written Off" to the asset status ENUM
 *  - transfer audit columns (fromDepartment / toDepartment) on `asset_transactions`
 */
async function tableExists(queryInterface, tableName) {
  const tables = await queryInterface.showAllTables();
  const normalized = tables.map((t) =>
    typeof t === "string" ? t.toLowerCase() : String(t).toLowerCase()
  );
  return normalized.includes(tableName.toLowerCase());
}

async function columnExists(queryInterface, tableName, columnName) {
  try {
    const description = await queryInterface.describeTable(tableName);
    return Object.prototype.hasOwnProperty.call(description, columnName);
  } catch (e) {
    return false;
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    if (await tableExists(queryInterface, "assets")) {
      const addColumn = async (name, spec) => {
        if (!(await columnExists(queryInterface, "assets", name))) {
          await queryInterface.addColumn("assets", name, spec);
        }
      };

      await addColumn("asset_name", {
        type: Sequelize.STRING(255),
        allowNull: true,
      });
      await addColumn("supplier_number", {
        type: Sequelize.STRING(255),
        allowNull: true,
      });
      await addColumn("supplier_name", {
        type: Sequelize.STRING(255),
        allowNull: true,
      });
      await addColumn("attachment_urls", {
        type: Sequelize.TEXT,
        allowNull: true,
      });
      await addColumn("firs_allowance_rate", {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: true,
      });
      await addColumn("firs_written_down_value", {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: true,
      });
      await addColumn("firs_allowance_to_date", {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      });

      // Extend status ENUM to include "Written Off".
      await queryInterface.changeColumn("assets", "status", {
        type: Sequelize.ENUM(
          "Active",
          "Disposed",
          "Impaired",
          "Under Maintenance",
          "Written Off"
        ),
        allowNull: false,
        defaultValue: "Active",
      });
    }

    if (await tableExists(queryInterface, "asset_transactions")) {
      if (!(await columnExists(queryInterface, "asset_transactions", "fromDepartment"))) {
        await queryInterface.addColumn("asset_transactions", "fromDepartment", {
          type: Sequelize.STRING(255),
          allowNull: true,
        });
      }
      if (!(await columnExists(queryInterface, "asset_transactions", "toDepartment"))) {
        await queryInterface.addColumn("asset_transactions", "toDepartment", {
          type: Sequelize.STRING(255),
          allowNull: true,
        });
      }
    }
  },

  async down(queryInterface, Sequelize) {
    if (await tableExists(queryInterface, "assets")) {
      const dropColumn = async (name) => {
        if (await columnExists(queryInterface, "assets", name)) {
          await queryInterface.removeColumn("assets", name);
        }
      };
      await dropColumn("asset_name");
      await dropColumn("supplier_number");
      await dropColumn("supplier_name");
      await dropColumn("attachment_urls");
      await dropColumn("firs_allowance_rate");
      await dropColumn("firs_written_down_value");
      await dropColumn("firs_allowance_to_date");

      await queryInterface.changeColumn("assets", "status", {
        type: Sequelize.ENUM(
          "Active",
          "Disposed",
          "Impaired",
          "Under Maintenance"
        ),
        allowNull: false,
        defaultValue: "Active",
      });
    }

    if (await tableExists(queryInterface, "asset_transactions")) {
      if (await columnExists(queryInterface, "asset_transactions", "fromDepartment")) {
        await queryInterface.removeColumn("asset_transactions", "fromDepartment");
      }
      if (await columnExists(queryInterface, "asset_transactions", "toDepartment")) {
        await queryInterface.removeColumn("asset_transactions", "toDepartment");
      }
    }
  },
};
