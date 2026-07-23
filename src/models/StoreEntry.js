"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class StoreEntry extends Model {
    static associate(models) {
      // 🔗 StoreEntry belongs to Product
      if (models.Product) {
        StoreEntry.belongsTo(models.Product, {
          foreignKey: "product_id",
          as: "product",
        });
      }

      // 🔗 StoreEntry belongs to InventoryBatch (optional)


      // 🔗 StoreEntry belongs to ProductMultiplier (optional)
      if (models.ProductMultiplier) {
        StoreEntry.belongsTo(models.ProductMultiplier, {
          foreignKey: "multiplier_id",
          as: "multiplier",
        });
      }
    }
  }

  StoreEntry.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      receive_date: DataTypes.STRING(50),
      reference_number: DataTypes.STRING(20),

      // Quantities
      qty_in: {
        type: DataTypes.DECIMAL(20, 4),
        defaultValue: 0,
      },
      multple: {
        type: DataTypes.STRING(100),
        defaultValue: "1",
      },
      location: {
        type: DataTypes.STRING(100),
        defaultValue: "Warehouse",
      },
      qty_out: {
        type: DataTypes.DECIMAL(20, 4),
        defaultValue: 0,
      },
      expiry_date: DataTypes.DATE,
      // Pricing
      cost_price: DataTypes.DECIMAL(20, 2),
      selling_price: DataTypes.DECIMAL(20, 2),
      mark_up: DataTypes.DECIMAL(10, 2),
      markup_mode: DataTypes.STRING(20),
      // Transfer info
      branch_name: DataTypes.STRING(100),
      inserted_by: DataTypes.STRING(50),
      facilityId: DataTypes.STRING(50),
      truckNo: DataTypes.STRING(50),
      waybillNo: DataTypes.STRING(50),
      // Supplier info
      supplier_code: DataTypes.STRING(150),

      type: {
        type: DataTypes.STRING(30),
        defaultValue: "sales",
        comment:
          "Movement type: sales, service, pro-bono, purchase, opening_balance, production, consumed, material_issue, transfer, adjustment, etc.",
      },

      source: {
        type: DataTypes.STRING(150),
        allowNull: false,
      },
      destination: {
        type: DataTypes.STRING(150),
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },

      // ✅ Proper FK reference to Product
      product_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: {
          model: "products",
          key: "sku",
        },
      },

      // 🆕 FK reference to InventoryBatch (optional)
      batch_id: {
        type: DataTypes.INTEGER,
        allowNull: true
      },

      // 🆕 FK reference to Product Multiplier (optional)
      multiplier_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "product_multipliers",
          key: "id",
        },
      },

      branchId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: "FK to branches.id — 0 = Unassigned sentinel",
        references: {
          model: "branches",
          key: "id",
        },
      },

      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: "StoreEntry",
      tableName: "store_entries",
      timestamps: false, // keep manual inserted_time
      hooks: {
        // sales_dep is a DB VIEW, not a writable table.
        // Inventory movement is already persisted via store_entries rows.
        afterCreate: async () => {},
      },
    }
  );

  return StoreEntry;
};
