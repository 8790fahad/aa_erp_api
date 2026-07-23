const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class ProductGroup extends Model {
    static associate(models) {
      // ProductGroup belongs to a Facility
      if (models.Business) {
        ProductGroup.belongsTo(models.Business, {
          foreignKey: "facility_id",
          targetKey: "id",
          as: "facility",
        });
      }

      // ProductGroup has many Products
      if (models.Product) {
        ProductGroup.hasMany(models.Product, {
          foreignKey: "group_id",
          as: "products",
        });
      }
    }
  }

  ProductGroup.init(
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
        collate: "latin1_swedish_ci",
        references: {
          model: "business",
          key: "id",
        },
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: { notEmpty: true },
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      notes: {
        type: DataTypes.JSON,
        allowNull: true,
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
      modelName: "ProductGroup",
      tableName: "product_groups",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        { fields: ["facility_id"] },
        {
          unique: true,
          fields: ["name", "facility_id"],
        },
      ],
    }
  );

  return ProductGroup;
};
