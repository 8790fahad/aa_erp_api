"use strict";
module.exports = (sequelize, DataTypes) => {
  const Customer = sequelize.define(
    "Customer",
    {
      customerNo: { type: DataTypes.STRING, primaryKey: true },
      facilityId: {
        type: DataTypes.STRING,
        primaryKey: true,
        references: {
          model: "business",
          key: "id",
        },
      },
      account_head: { type: DataTypes.STRING },
      balance: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: true,
      },
      fullname: { type: DataTypes.STRING },
      entity_type: {
        type: DataTypes.ENUM("business", "individual"),
        allowNull: false,
        defaultValue: "business",
      },
      company_name: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      salutation: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      first_name: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      last_name: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      store_name: { type: DataTypes.STRING },
      address: { type: DataTypes.STRING },
      phone: { type: DataTypes.STRING },
      mobile: {
        type: DataTypes.STRING(30),
        allowNull: true,
      },
      email: { type: DataTypes.STRING },
      tin: { type: DataTypes.STRING, allowNull: true },
      language: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      currency: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      payment_terms: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      tax_rate: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      company_id: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      enable_portal: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      remarks: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      customer_type: { type: DataTypes.STRING, allowNull: false },
      receivable_code: {
        type: DataTypes.STRING,
        allowNull: false,
        references: {
          model: "account",
          key: "head",
        },
      },
      receivable_accural_code: {
        type: DataTypes.STRING,
        allowNull: false,
        references: {
          model: "account",
          key: "head",
        },
      },

      status: { type: DataTypes.STRING, defaultValue: "pending" },
      branch_id: { type: DataTypes.INTEGER, allowNull: true },
      credit_limit: { type: DataTypes.INTEGER },
      created_by: {
        type: DataTypes.STRING(50),
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
      },
    },
    {
      tableName: "customers",
      timestamps: true,
      charset: "latin1",
      collate: "latin1_swedish_ci",
    },
  );

  Customer.associate = function (models) {
    if (models.Invoice) {
      Customer.hasMany(models.Invoice, { foreignKey: "customerNo" });
    }

    if (models.Payment) {
      Customer.hasMany(models.Payment, { foreignKey: "customerNo" });
    }

    if (models.CustomerEntry) {
      Customer.hasMany(models.CustomerEntry, {
        foreignKey: "customerNo",
        as: "customerEntries",
      });
    }

    if (models.User) {
      Customer.belongsTo(models.User, {
        foreignKey: "created_by",
        as: "creator",
      });
    }

    if (models.Business) {
      Customer.belongsTo(models.Business, {
        foreignKey: "facilityId",
        targetKey: "id",
        as: "business",
      });
    }

    if (models.Account) {
      Customer.belongsTo(models.Account, {
        foreignKey: "receivable_code",
        targetKey: "head",
        as: "account",
      });
    }

    if (models.CustomerContact) {
      Customer.hasMany(models.CustomerContact, {
        foreignKey: "customer_no",
        sourceKey: "customerNo",
        constraints: false,
        as: "contacts",
      });
    }

    if (models.CustomerAddress) {
      Customer.hasMany(models.CustomerAddress, {
        foreignKey: "customer_no",
        sourceKey: "customerNo",
        constraints: false,
        as: "addresses",
      });
    }
  };

  return Customer;
};
