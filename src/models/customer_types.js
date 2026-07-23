"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
    class CustomerType extends Model {
        static associate(models) {
            // CustomerType belongs to a Business
            if (models.Business) {
                CustomerType.belongsTo(models.Business, {
                    foreignKey: "facilityId",
                    as: "business",
                });
            }

            // CustomerType has many Customers
            if (models.Customer) {
                CustomerType.hasMany(models.Customer, {
                    foreignKey: "customer_type",
                    sourceKey: "name",  // This should match the field in the customers table
                    as: "customers",
                });
            }
        }
    }

    CustomerType.init(
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
                field: "id",
                comment: "Primary key",
            },
            name: {
                type: DataTypes.STRING(100),
                allowNull: false,
                field: "name",
                comment: "Customer type name",
            },
            description: {
                type: DataTypes.TEXT,
                allowNull: true,
                field: "description",
                comment: "Customer type description",
            },
            facilityId: {
                type: DataTypes.STRING(50),
                allowNull: false,
                field: "facilityId",
                comment: "Facility ID that owns this customer type",
            },
            status: {
                type: DataTypes.ENUM("active", "inactive"),
                allowNull: false,
                defaultValue: "active",
                field: "status",
                comment: "Customer type status (active, inactive)",
            },
            created_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
                field: "created_at",
                comment: "Record creation timestamp",
            },
            updated_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
                field: "updated_at",
                comment: "Record last update timestamp",
            },
        },
        {
            sequelize,
            modelName: "CustomerType",
            tableName: "customer_types",
            timestamps: true,
            createdAt: "created_at",
            updatedAt: "updated_at",
            indexes: [
                {
                    fields: ["facilityId"],
                    name: "idx_customer_types_facility_id",
                },
                {
                    fields: ["status"],
                    name: "idx_customer_types_status",
                },
                {
                    fields: ["name"],
                    name: "idx_customer_types_name",
                },
                {
                    unique: true,
                    fields: ["name", "facilityId"],
                    name: "unique_customer_type_name_per_facility",
                },
            ],
            comment: "Customer types table",
        }
    );

    return CustomerType;
};
