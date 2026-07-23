"use strict";

module.exports = (sequelize, DataTypes) => {
  const AccountingCustomReport = sequelize.define(
    "AccountingCustomReport",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      facility_id: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      title: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      report_type: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "link",
      },
      target_path: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      external_app_path: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      date_mode: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "range",
      },
      config_json: {
        type: DataTypes.TEXT,
        allowNull: true,
        get() {
          const raw = this.getDataValue("config_json");
          if (!raw) return null;
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        },
        set(val) {
          if (val == null) {
            this.setDataValue("config_json", null);
          } else {
            this.setDataValue("config_json", JSON.stringify(val));
          }
        },
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      created_by: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
    },
    {
      tableName: "accounting_custom_reports",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return AccountingCustomReport;
};
