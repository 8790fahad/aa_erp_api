// "use strict";

// const { Model } = require("sequelize");

// module.exports = (sequelize, DataTypes) => {
//   class Product extends Model {
//     static associate(models) {
//       // Product belongs to a facility
//       if (models.Facility) {
//         Product.belongsTo(models.Facility, {
//           foreignKey: "facility_id",
//           as: "facility",
//         });
//       }

//       // Product belongs to a supplier (for purchase info)
//       if (models.Supplier) {
//         Product.belongsTo(models.Supplier, {
//           foreignKey: "supplier_id",
//           as: "supplier",  
//         });

//         // Product belongs to a preferred supplier (for inventory)
//         Product.belongsTo(models.Supplier, {
//           foreignKey: "preferred_supplier_id",
//           as: "preferredSupplier",
//         });
//       }

//       // Product belongs to a warehouse
//       // if (models.Warehouse) {
//       //   Product.belongsTo(models.Warehouse, {
//       //     foreignKey: "warehouse_id",
//       //     as: "warehouse",
//       //   });
//       // }

//       // Product belongs to revenue account
//       // if (models.Account) {
//       //   Product.belongsTo(models.Account, {
//       //     foreignKey: "revenue_account",
//       //     as: "revenueAccount",
//       //   });

//       //   // Product belongs to expense account
//       //   Product.belongsTo(models.Account, {
//       //     foreignKey: "expense_account",
//       //     as: "expenseAccount",
//       //   });
//       // }
//     }
//   }

//   Product.init(
//     {
//       id: {
//         type: DataTypes.STRING,
//         primaryKey: true,
//         allowNull: false,
//       },
//       facility_id: {
//         type: DataTypes.STRING,
//         allowNull: false,
//       },
//       name: {
//         type: DataTypes.STRING,
//         allowNull: false,
//         validate: {
//           notEmpty: true,
//         },
//       },
//       sku: {
//         type: DataTypes.STRING,
//         allowNull: false,
//         unique: true,
//         validate: {
//           notEmpty: true,
//         },
//       },
//       item_type: {
//         type: DataTypes.ENUM("Inventory", "Non-inventory", "Service", "Bundle"),
//         allowNull: false,
//         defaultValue: "Inventory",
//       },
//       image_url: {
//         type: DataTypes.TEXT,
//         allowNull: true,
//       },
//       // Sales Information
//       sales_description: {
//         type: DataTypes.TEXT,
//         allowNull: true,
//       },
//       selling_price: {
//         type: DataTypes.DECIMAL(15, 2),
//         allowNull: false,
//         defaultValue: 0,
//         validate: {
//           min: 0,
//         },
//       },
//       tax_rate: {
//         type: DataTypes.ENUM("VAT-7.5%", "WHT-5%", "WHT-10%", "None"),
//         allowNull: false,
//         defaultValue: "None",
//       },
//       revenue_account: {
//         type: DataTypes.STRING,
//         allowNull: true,
//       },
//       // Purchase Information
//       purchase_description: {
//         type: DataTypes.TEXT,
//         allowNull: true,
//       },
//       cost_price: {
//         type: DataTypes.DECIMAL(15, 2),
//         allowNull: false,
//         defaultValue: 0,
//         validate: {
//           min: 0,
//         },
//       },
//       supplier_id: {
//         type: DataTypes.STRING,
//         allowNull: true,
//       },
//       expense_account: {
//         type: DataTypes.STRING,
//         allowNull: true,
//       },
//       // Inventory Information
//       stock_quantity: {
//         type: DataTypes.INTEGER,
//         allowNull: false,
//         defaultValue: 0,
//         validate: {
//           min: 0,
//         },
//       },
//       reorder_level: {
//         type: DataTypes.INTEGER,
//         allowNull: false,
//         defaultValue: 0,
//         validate: {
//           min: 0,
//         },
//       },
//       preferred_supplier_id: {
//         type: DataTypes.STRING,
//         allowNull: true,
//       },
//       warehouse_id: {
//         type: DataTypes.STRING,
//         allowNull: true,
//       },
//       category: {
//         type: DataTypes.STRING,
//         allowNull: true,
//       },
//       unit_of_measure: {
//         type: DataTypes.STRING,
//         allowNull: false,
//         defaultValue: "pcs",
//       },
//       // Settings
//       status: {
//         type: DataTypes.ENUM("Active", "Inactive"),
//         allowNull: false,
//         defaultValue: "Active",
//       },
//       tags: {
//         type: DataTypes.JSON,
//         allowNull: true,
//         defaultValue: [],
//       },
//       notes: {
//         type: DataTypes.TEXT,
//         allowNull: true,
//       },
//       created_at: {
//         type: DataTypes.DATE,
//         allowNull: false,
//         defaultValue: DataTypes.NOW,
//       },
//       updated_at: {
//         type: DataTypes.DATE,
//         allowNull: false,
//         defaultValue: DataTypes.NOW,
//       },
//     },
//     {
//       sequelize,
//       modelName: "Product",
//       tableName: "products",
//       timestamps: true,
//       createdAt: "created_at",
//       updatedAt: "updated_at",
//       indexes: [
//         {
//           unique: true,
//           fields: ["sku", "facility_id"],
//         },
//         {
//           fields: ["facility_id"],
//         },
//         {
//           fields: ["item_type"],
//         },
//         {
//           fields: ["status"],
//         },
//         {
//           fields: ["supplier_id"],
//         },
//         // {
//         //   fields: ["warehouse_id"],
//         // },
//       ],
//     }
//   );

//   return Product;
// };
