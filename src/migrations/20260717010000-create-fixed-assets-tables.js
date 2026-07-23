"use strict";

/**
 * Create fixed-asset register tables if missing.
 * Aligns with Sequelize models: assets, asset_transactions, asset_maintenance.
 */
async function tableExists(queryInterface, tableName) {
  const tables = await queryInterface.showAllTables();
  const normalized = tables.map((t) =>
    typeof t === "string" ? t.toLowerCase() : String(t).toLowerCase()
  );
  return normalized.includes(tableName.toLowerCase());
}

module.exports = {
  async up(queryInterface, Sequelize) {
    if (!(await tableExists(queryInterface, "assets"))) {
      await queryInterface.createTable("assets", {
        id: {
          type: Sequelize.STRING(255),
          allowNull: false,
          primaryKey: true,
        },
        facility_id: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
        department_id: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        asset_code: {
          type: Sequelize.STRING(255),
          allowNull: false,
          unique: true,
        },
        description: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
        category: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
        acquisition_date: {
          type: Sequelize.DATEONLY,
          allowNull: false,
        },
        acquisition_cost: {
          type: Sequelize.DECIMAL(15, 2),
          allowNull: false,
        },
        useful_life_years: {
          type: Sequelize.INTEGER,
          allowNull: false,
        },
        residual_value: {
          type: Sequelize.DECIMAL(15, 2),
          allowNull: false,
          defaultValue: 0,
        },
        depreciation_method: {
          type: Sequelize.ENUM(
            "Straight Line",
            "Reducing Balance",
            "Units of Production",
            "Sum of Years Digits",
            "Double Declining Balance"
          ),
          allowNull: false,
          defaultValue: "Straight Line",
        },
        depreciation_rate: {
          type: Sequelize.DECIMAL(5, 2),
          allowNull: true,
        },
        asset_account_code: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
        accumulated_depreciation_account_code: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
        depreciation_expense_account_code: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
        disposal_account_code: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        location: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        custodian: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        custodianId: {
          type: Sequelize.STRING(36),
          allowNull: true,
        },
        createdBy: {
          type: Sequelize.STRING(36),
          allowNull: true,
        },
        updatedBy: {
          type: Sequelize.STRING(36),
          allowNull: true,
        },
        status: {
          type: Sequelize.ENUM(
            "Active",
            "Disposed",
            "Impaired",
            "Under Maintenance"
          ),
          allowNull: false,
          defaultValue: "Active",
        },
        net_book_value: {
          type: Sequelize.DECIMAL(15, 2),
          allowNull: false,
          defaultValue: 0,
        },
        accumulated_depreciation: {
          type: Sequelize.DECIMAL(15, 2),
          allowNull: false,
          defaultValue: 0,
        },
        last_depreciation_date: {
          type: Sequelize.DATEONLY,
          allowNull: true,
        },
        disposal_date: {
          type: Sequelize.DATEONLY,
          allowNull: true,
        },
        disposal_proceeds: {
          type: Sequelize.DECIMAL(15, 2),
          allowNull: true,
        },
        impairment_loss: {
          type: Sequelize.DECIMAL(15, 2),
          allowNull: true,
        },
        revaluation_surplus: {
          type: Sequelize.DECIMAL(15, 2),
          allowNull: true,
        },
        notes: {
          type: Sequelize.TEXT,
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
          defaultValue: Sequelize.literal(
            "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
          ),
        },
      });

      await queryInterface.addIndex("assets", ["facility_id"]);
      await queryInterface.addIndex("assets", ["category"]);
      await queryInterface.addIndex("assets", ["status"]);
      await queryInterface.addIndex("assets", ["asset_code"], { unique: true });
    }

    if (!(await tableExists(queryInterface, "asset_transactions"))) {
      await queryInterface.createTable("asset_transactions", {
        id: {
          type: Sequelize.STRING(36),
          allowNull: false,
          primaryKey: true,
        },
        assetId: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
        transactionType: {
          type: Sequelize.ENUM(
            "Acquisition",
            "Disposal",
            "Revaluation",
            "Impairment",
            "Transfer",
            "Maintenance",
            "Depreciation"
          ),
          allowNull: false,
        },
        transactionDate: {
          type: Sequelize.DATEONLY,
          allowNull: false,
        },
        amount: {
          type: Sequelize.DECIMAL(15, 2),
          allowNull: false,
        },
        description: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        referenceNumber: {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        disposalMethod: {
          type: Sequelize.ENUM("Sale", "Scrap", "Trade-in", "Donation", "Loss"),
          allowNull: true,
        },
        disposalProceeds: {
          type: Sequelize.DECIMAL(15, 2),
          allowNull: true,
        },
        revaluationBasis: {
          type: Sequelize.STRING(200),
          allowNull: true,
        },
        revaluationDate: {
          type: Sequelize.DATEONLY,
          allowNull: true,
        },
        fromLocation: {
          type: Sequelize.STRING(200),
          allowNull: true,
        },
        toLocation: {
          type: Sequelize.STRING(200),
          allowNull: true,
        },
        fromCustodian: {
          type: Sequelize.STRING(200),
          allowNull: true,
        },
        toCustodian: {
          type: Sequelize.STRING(200),
          allowNull: true,
        },
        journalEntryId: {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        accountingPeriod: {
          type: Sequelize.STRING(20),
          allowNull: true,
        },
        facilityId: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
        createdBy: {
          type: Sequelize.STRING(36),
          allowNull: false,
        },
        approvedBy: {
          type: Sequelize.STRING(36),
          allowNull: true,
        },
        approvedAt: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        status: {
          type: Sequelize.ENUM("Pending", "Approved", "Rejected"),
          allowNull: false,
          defaultValue: "Pending",
        },
        createdAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
        updatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal(
            "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
          ),
        },
      });

      await queryInterface.addIndex("asset_transactions", ["assetId"]);
      await queryInterface.addIndex("asset_transactions", ["facilityId"]);
      await queryInterface.addIndex("asset_transactions", ["transactionType"]);
      await queryInterface.addIndex("asset_transactions", ["transactionDate"]);
      await queryInterface.addIndex("asset_transactions", ["status"]);
    }

    if (!(await tableExists(queryInterface, "asset_maintenance"))) {
      await queryInterface.createTable("asset_maintenance", {
        id: {
          type: Sequelize.STRING(36),
          allowNull: false,
          primaryKey: true,
        },
        assetId: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
        maintenanceType: {
          type: Sequelize.ENUM(
            "Preventive",
            "Corrective",
            "Emergency",
            "Routine",
            "Overhaul"
          ),
          allowNull: false,
        },
        description: {
          type: Sequelize.TEXT,
          allowNull: false,
        },
        scheduledDate: {
          type: Sequelize.DATEONLY,
          allowNull: true,
        },
        actualDate: {
          type: Sequelize.DATEONLY,
          allowNull: true,
        },
        cost: {
          type: Sequelize.DECIMAL(15, 2),
          allowNull: false,
          defaultValue: 0,
        },
        vendor: {
          type: Sequelize.STRING(200),
          allowNull: true,
        },
        technician: {
          type: Sequelize.STRING(200),
          allowNull: true,
        },
        status: {
          type: Sequelize.ENUM(
            "Scheduled",
            "In Progress",
            "Completed",
            "Cancelled",
            "Overdue"
          ),
          allowNull: false,
          defaultValue: "Scheduled",
        },
        priority: {
          type: Sequelize.ENUM("Low", "Medium", "High", "Critical"),
          allowNull: false,
          defaultValue: "Medium",
        },
        notes: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        nextMaintenanceDate: {
          type: Sequelize.DATEONLY,
          allowNull: true,
        },
        facilityId: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
        createdBy: {
          type: Sequelize.STRING(36),
          allowNull: false,
        },
        createdAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
        updatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal(
            "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
          ),
        },
      });

      await queryInterface.addIndex("asset_maintenance", ["assetId"]);
      await queryInterface.addIndex("asset_maintenance", ["facilityId"]);
      await queryInterface.addIndex("asset_maintenance", ["status"]);
      await queryInterface.addIndex("asset_maintenance", ["scheduledDate"]);
      await queryInterface.addIndex("asset_maintenance", ["priority"]);
    }
  },

  async down(queryInterface) {
    if (await tableExists(queryInterface, "asset_maintenance")) {
      await queryInterface.dropTable("asset_maintenance");
    }
    if (await tableExists(queryInterface, "asset_transactions")) {
      await queryInterface.dropTable("asset_transactions");
    }
    if (await tableExists(queryInterface, "assets")) {
      await queryInterface.dropTable("assets");
    }
  },
};
