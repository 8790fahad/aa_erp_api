"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Memo extends Model {
    static associate(models) {
      // Memo has many ItemList
      if (models.ItemList) {
        Memo.hasMany(models.ItemList, {
          foreignKey: "memo_id",
          sourceKey: "memo_id",
          as: "items",
        });
      }

      // Memo belongs to Business/Facility
      if (models.Business) {
        Memo.belongsTo(models.Business, {
          foreignKey: "facilityId",
          as: "business",
        });
      }

      // Memo belongs to User (raise_by)
      if (models.User) {
        Memo.belongsTo(models.User, {
          foreignKey: "raise_by",
          as: "raiser",
        });
      }

      // Memo belongs to User (user_id)
      if (models.User) {
        Memo.belongsTo(models.User, {
          foreignKey: "user_id",
          as: "user",
        });
      }

      // Memo belongs to Supplier (supplier_number)
      if (models.SuppliersInfo) {
        Memo.belongsTo(models.SuppliersInfo, {
          foreignKey: "supplier_number",
          targetKey: "supplier_number",
          as: "supplier",
        });
      }
    }
  }

  Memo.init(
    {
      // id: {
      //   type: DataTypes.INTEGER,
      //   primaryKey: true,
      //   autoIncrement: true,
      //   allowNull: false,
      //   field: "id",
      // },
      from_name: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "from_name",
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: "date",
      },
      purpose: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "purpose",
      },
      memo_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
        primaryKey: true,
        field: "memo_id",
      },
      amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0.0,
        field: "amount",
      },
      remark: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "remark",
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: true,
        defaultValue: "pending",
        field: "status",
      },
      facilityId: {
        type: DataTypes.STRING(155),
        allowNull: true,
        field: "facilityId",
      },
      raise_by: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: "raise_by",
      },
      user_id: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: "user_id",
      },
      subject: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: "subject",
      },
      details: {
        type: DataTypes.STRING(500),
        allowNull: true,
        field: "details",
      },
      recipient: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: "recipient",
      },
      description: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: "description",
      },
      total: {
        type: DataTypes.DECIMAL(50, 2),
        allowNull: true,
        defaultValue: 0.0,
        field: "total",
      },
      pr_no: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: "pr_no",
      },
      reference_number: {
        type: DataTypes.STRING(20),
        allowNull: true,
        field: "reference_number",
      },
      priority: {
        type: DataTypes.ENUM("Medium", "High", "Low"),
        allowNull: true,
        defaultValue: "Medium",
        field: "priority",
      },
      supplier_name: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "supplier_name",
      },
      supplier_code: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: "supplier_code",
      },
      supplier_number: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: "supplier_number",
      },
    },
    {
      sequelize,
      modelName: "Memo",
      tableName: "memo",
      timestamps: true,
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    }
  );

  return Memo;
};
