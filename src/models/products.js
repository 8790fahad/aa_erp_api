const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Product extends Model {
    static associate(models) {
      // Product belongs to a ProductGroup
      if (models.ProductGroup) {
        Product.belongsTo(models.ProductGroup, {
          foreignKey: "group_id",
          as: "group",
        });
      }
      if (models.SemiFinishedCostingTemplate) {
        Product.hasMany(models.SemiFinishedCostingTemplate, {
          foreignKey: "product_id",
          as: "semiFinishedCostingTemplates",
        });
      }
      // Product belongs to a Facility
      // if (models.Business) {
      //   Product.belongsTo(models.Business, {
      //     foreignKey: "facility_id",
      //     targetKey: "id",
      //     as: "facility",
      //   });
      // }
      // Product has many StoreEntries
      // if (models.StoreEntry) {
      //   Product.hasMany(models.StoreEntry, {
      //     foreignKey: "product_id",
      //     as: "storeEntries",
      //   });
      // }
      // Product has many InventoryBatches
      // if (models.InventoryBatch) {
      //   Product.hasMany(models.InventoryBatch, {
      //     foreignKey: "product_id",
      //     as: "batches",
      //   });
      // }
      // Product has one current InventoryValuation
      // if (models.InventoryValuation) {
      //   Product.hasOne(models.InventoryValuation, {
      //     foreignKey: "product_id",
      //     as: "valuation",
      //   });
      // }
    }
  }

  Product.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        autoIncrement: true,
      },
      facility_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
        collate: "latin1_swedish_ci", // ✅ collation set here
        references: {
          model: "business", // table name must match exactly
          key: "id",
        },
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: { notEmpty: true },
      },
      sku: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: { notEmpty: true },
      },
      item_type: {
        type: DataTypes.ENUM(
          "Raw Material",
          "Finished Good",
          "Resalable",
          "Service",
          "By-Product",
          "Semi Finished"
        ),
        allowNull: false,
      },
      image_url: DataTypes.TEXT("long"),
      product_images: DataTypes.JSON,
      marketplace_description: DataTypes.TEXT,

      // Sales info
      sales_description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      selling_price: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0 },
      },
      revenue_account: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // Sales target / limit (null = unlimited)
      daily_sales_limit: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null,
      },
      weekly_sales_limit: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null,
      },
      monthly_sales_limit: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null,
      },
      // When true, product cannot be sold on sales invoices
      sales_stopped: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Purchase info
      purchase_description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      cost_price: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0 },
      },
      is_purchased: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      supplier_id: {
        type: DataTypes.STRING(10), // Match supplier_number length from SuppliersInfo
        allowNull: true,
      },
      cogs_head: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      // Inventory info
      reorder_level: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0 },
      },
      supplier_id: {
        type: DataTypes.STRING(10), // Match supplier_number length from SuppliersInfo
        allowNull: true,
      },
      warehouse_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      category: DataTypes.STRING,
      unit_of_measure: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "pcs",
      },
      inventory_account: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      deposit_liability_account: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      // Markup info
      mark_up: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0,
      },
      markup_mode: {
        type: DataTypes.ENUM("percentage", "fixed"),
        allowNull: true,
        defaultValue: "percentage",
      },

      // Settings
      status: {
        type: DataTypes.ENUM("Active", "Inactive"),
        allowNull: false,
        defaultValue: "Active",
      },
      taxable: {
        type: DataTypes.ENUM(
          "Taxable",
          "Non-Taxable",
          "Exempted",
          "Zero Rated",
        ),
        allowNull: false,
        validate: {
          notEmpty: true,
        },
      },
      // Controls whether this product is available in online/WhatsApp catalogs
      online_enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      tags: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
      },
      notes: DataTypes.TEXT,
      line_of_business: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment:
          "Indicates if this product/service is the main line of business",
      },
      line_of_business: {
        type: DataTypes.ENUM("true", "false"),
        allowNull: false,
        defaultValue: "true",
      },
      group_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "product_groups",
          key: "id",
        },
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: "Product",
      tableName: "products",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        {
          unique: true,
          fields: ["sku", "facility_id"], // Composite unique key
        },
        {
          unique: true,
          name: "products_facility_name_uq",
          fields: ["facility_id", "name"],
        },
        { fields: ["facility_id"] },
        { fields: ["item_type"] },
        { fields: ["status"] },
        { fields: ["supplier_id"] },
        { fields: ["warehouse_id"] },
      ],
    }
  );

  return Product;
};
