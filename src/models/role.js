"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Role extends Model {
    static associate(models) {
      // Role belongs to a Facility
      if (models.Business) {
        Role.belongsTo(models.Business, {
          foreignKey: "facilityId",
          as: "facility",
        });
      }

      // Role has many Users
      if (models.User) {
        Role.hasMany(models.User, {
          foreignKey: "roleId",
          as: "users",
        });
      }
    }
  }

  Role.init(
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
        comment: "Role name",
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "description",
        comment: "Role description",
      },
      facilityId: {
        type: DataTypes.STRING(50),
        allowNull: false,
        field: "facilityId",
        comment: "Facility ID that owns this role",
      },
      status: {
        type: DataTypes.ENUM("active", "inactive"),
        allowNull: false,
        defaultValue: "active",
        field: "status",
        comment: "Role status (active, inactive)",
      },
      permissions: {
        type: DataTypes.JSON,
        allowNull: true,
        field: "permissions",
        comment: "Role permissions as JSON",
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
      modelName: "Role",
      tableName: "roles",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        {
          fields: ["facilityId"],
          name: "idx_roles_facility_id",
        },
        {
          fields: ["status"],
          name: "idx_roles_status",
        },
        {
          fields: ["name"],
          name: "idx_roles_name",
        },
        {
          unique: true,
          fields: ["name", "facilityId"],
          name: "unique_role_name_per_facility",
        },
      ],
      comment: "User roles table",
    }
  );

  return Role;
};
