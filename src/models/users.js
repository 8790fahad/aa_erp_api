"use strict";
module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define(
    "users",
    {
      id: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
        primaryKey: true,
      },
      facilityId: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
      },
      firstname: DataTypes.STRING,
      lastname: DataTypes.STRING,
      username: { type: DataTypes.STRING, allowNull: true },
      email: DataTypes.STRING,
      password: DataTypes.STRING,
      image: DataTypes.STRING,
      verificationToken: DataTypes.STRING,
      verificationExpires: DataTypes.DATE,
      createdBy: DataTypes.STRING,
      status: {
        type: DataTypes.STRING,
      },
      referralId: DataTypes.STRING,
      lastLogin: DataTypes.STRING,
      address: DataTypes.STRING,
      signature: {
        type: DataTypes.TEXT("long"),
        allowNull: true,
      },
      phone: {
        type: DataTypes.STRING,
        unique: true,
        allowNull: false,
      },
      departmentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      code: DataTypes.STRING,
      role: DataTypes.STRING,
      /** Cashier role only: "cash" | "transfer" — which payments they collect. */
      cashier_type: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      store: DataTypes.STRING,
      branchId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {}
  );
  User.associate = (models) => {
    User.belongsTo(models.Department, {
      foreignKey: "departmentId",
      as: "department",
    });

    // Multi-branch support via user_branches junction.
    // users.branchId is kept and points to the user's primary branch
    // (mirrored from the junction row with is_primary = 1).
    if (models.Branch && models.UserBranch) {
      User.belongsToMany(models.Branch, {
        through: models.UserBranch,
        foreignKey: "user_id",
        otherKey: "branch_id",
        as: "branches",
      });
      User.hasMany(models.UserBranch, {
        foreignKey: "user_id",
        as: "branchLinks",
      });
    }

    // User has many Memberships
    if (models.membership) {
      User.hasMany(models.membership, {
        foreignKey: "user_id",
        as: "memberships",
      });
    }

    // User has many Customers (created by this user)
    if (models.Customer) {
      User.hasMany(models.Customer, {
        foreignKey: "created_by",
        as: "createdCustomers",
      });
    }

    // User has many CustomerEntries (created by this user)
    if (models.CustomerEntry) {
      User.hasMany(models.CustomerEntry, {
        foreignKey: "created_by",
        as: "createdCustomerEntries",
      });
    }
    User.belongsTo(models.Branch, {
      foreignKey: "branchId",
      as: "branch",
    });
  };
  return User;
};
