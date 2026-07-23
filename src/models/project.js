"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
    class Project extends Model {
        static associate(models) {
            // Facility relationship
            if (models.Business) {
                Project.belongsTo(models.Business, {
                    foreignKey: "facilityId",
                    as: "facility",
                });
            }

            // Customer relationship
            if (models.CustomersInfo) {
                Project.belongsTo(models.CustomersInfo, {
                    foreignKey: "customer_number",
                    targetKey: "customer_number",
                    as: "customerInfo",
                });
            }

            // Created by user relationship
            if (models.User) {
                Project.belongsTo(models.User, {
                    foreignKey: "created_by",
                    as: "creator",
                });
            }
        }
    }

    Project.init(
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
                allowNull: false,
            },
            facilityId: {
                type: DataTypes.STRING(50),
                allowNull: false,
            },
            project_number: {
                type: DataTypes.STRING(20),
                allowNull: false,
                unique: true,
            },
            project_name: {
                type: DataTypes.STRING(200),
                allowNull: false,
            },
            customer: {
                type: DataTypes.STRING(100),
                allowNull: false,
            },
            customer_number: {
                type: DataTypes.STRING(20),
                allowNull: true,
            },
            start_date: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            end_date: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            progress_status: {
                type: DataTypes.STRING(20),
                defaultValue: "not-started",
                validate: {
                    isIn: [
                        [
                            "not-started",
                            "in-progress",
                            "on-hold",
                            "completed",
                            "cancelled",
                        ],
                    ],
                },
            },
            notes: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            total_income: {
                type: DataTypes.DECIMAL(20, 2),
                defaultValue: 0.0,
                allowNull: false,
            },
            total_cost: {
                type: DataTypes.DECIMAL(20, 2),
                defaultValue: 0.0,
                allowNull: false,
            },
            profit: {
                type: DataTypes.VIRTUAL,
                get() {
                    const income = parseFloat(this.getDataValue("total_income") || 0);
                    const cost = parseFloat(this.getDataValue("total_cost") || 0);
                    return income - cost;
                },
            },
            status: {
                type: DataTypes.STRING(20),
                defaultValue: "active",
                validate: { isIn: [["active", "inactive", "archived"]] },
            },
            follow_up_status: {
                type: DataTypes.STRING(50),
                allowNull: true,
                defaultValue: null,
            },
            created_by: {
                type: DataTypes.INTEGER,
                allowNull: true,
            },
            created_at: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW,
                allowNull: false,
            },
            updated_at: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW,
                allowNull: false,
            },
        },
        {
            sequelize,
            modelName: "Project",
            tableName: "projects",
            timestamps: true,
            createdAt: "created_at",
            updatedAt: "updated_at",
            indexes: [
                { unique: true, fields: ["project_number"] },
                { fields: ["facilityId"] },
                { fields: ["customer_number"] },
                { fields: ["progress_status"] },
                { fields: ["status"] },
                { fields: ["follow_up_status"] },
                { fields: ["created_at"] },
            ],
        }
    );

    return Project;
};
