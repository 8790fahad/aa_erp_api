"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class ProductionCorrectionArchive extends Model {
    static associate() {
      // Snapshot table — no associations required
    }
  }

  ProductionCorrectionArchive.init(
    {
      id: {
        type: DataTypes.STRING(50),
        primaryKey: true,
        allowNull: false,
      },
      facility_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      batch_no: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      costing_record_id: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      reason: {
        type: DataTypes.ENUM("correct", "delete"),
        allowNull: false,
        defaultValue: "correct",
      },
      archived_by: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      archived_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      store_entries: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      ledger_entries: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      costing_data: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      meta: {
        type: DataTypes.JSON,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "ProductionCorrectionArchive",
      tableName: "production_correction_archives",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  );

  return ProductionCorrectionArchive;
};
