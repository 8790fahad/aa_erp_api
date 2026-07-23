"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class ItemList extends Model {
    static associate(models) {
      // ItemList belongs to Memo
      if (models.Memo) {
        ItemList.belongsTo(models.Memo, {
          foreignKey: "memo_id",
          targetKey: "memo_id",
          as: "memo",
        });
      }

      // ItemList belongs to Business/Facility
      if (models.Business) {
        ItemList.belongsTo(models.Business, {
          foreignKey: "facilityId",
          as: "business",
        });
      }
    }
  }

  ItemList.init(
    {
      item_list_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
        field: "item_list_id",
      },
      memo_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "memo_id",
      },
      item_name: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "item_name",
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "description",
      },
      unit_cost: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0.0,
        field: "unit_cost",
      },
      quantity: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 1,
        field: "quantity",
      },
      item_code: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: "item_code",
      },
      item_subhead: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: "item_subhead",
      },
      facilityId: {
        type: DataTypes.STRING(155),
        allowNull: true,
        field: "facilityId",
      },
      // createdAt: {
      //   type: DataTypes.DATE,
      //   allowNull: true,
      //   defaultValue: DataTypes.NOW,
      //   field: "createdAt",
      // },
      // updatedAt: {
      //   type: DataTypes.DATE,
      //   allowNull: true,
      //   field: "updatedAt",
      // },
    },
    {
      sequelize,
      modelName: "ItemList",
      tableName: "item_list",
      timestamps: false,
      indexes: [
        { fields: ["memo_id"] },
        { fields: ["facilityId"] },
        { fields: ["item_code"] },
      ],
    }
  );

  return ItemList;
};
