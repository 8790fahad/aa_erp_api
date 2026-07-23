"use strict";
module.exports = (sequelize, DataTypes) => {
  const CustomerSecurityDeposit = sequelize.define(
    "customerSecurityDeposit",
    {
      deposit_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
      },
      customerNo: {
        type: DataTypes.STRING(50),
        allowNull: false,
        comment: "Customer number (e.g., CUS-554)",
      },
      facilityId: {
        type: DataTypes.STRING(50),
        allowNull: false,
        comment: "Business/Facility ID",
      },
      amount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        comment: "Total deposit amount",
      },
      mode_of_payment: {
        type: DataTypes.ENUM("cash", "cheque", "bank"),
        allowNull: false,
        comment: "Payment method used",
      },
      bank_account_id: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: "Bank account ID for bank/cheque payments",
      },
      reference_number: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
        comment: "Unique reference number (e.g., CSD-00010)",
      },
      created_by: {
        type: DataTypes.STRING(50),
        allowNull: false,
        comment: "User ID who created the deposit",
      },
      product_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: "Product ID for the returnable item",
      },
      quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        comment: "Quantity of items",
      },
      deposit_amount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        comment: "Deposit amount per item",
      },
      total_amount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        comment: "Total amount (quantity × deposit_amount)",
      },
      transaction_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        comment: "Date of the transaction",
      },
      cheque_number: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: "Cheque number if payment method is cheque",
      },
      line_of_business: {
        type: DataTypes.ENUM("true", "false"),
        allowNull: false,
        defaultValue: "true",
      },
      status: {
        type: DataTypes.ENUM("active", "returned", "cancelled"),
        allowNull: false,
        defaultValue: "active",
        comment: "Status of the security deposit",
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "Additional notes",
      },
    },
    {
      tableName: "customer_security_deposits",
      timestamps: true,
      indexes: [
        {
          fields: ["customerNo"],
        },
        {
          fields: ["facilityId"],
        },
        {
          fields: ["reference_number"],
          unique: true,
        },
        {
          fields: ["transaction_date"],
        },
      ],
    }
  );

  CustomerSecurityDeposit.associate = (models) => {
    // CustomerSecurityDeposit belongs to Customer
    if (models.Customer) {
      CustomerSecurityDeposit.belongsTo(models.Customer, {
        foreignKey: "customerNo",
        targetKey: "customerNo",
        as: "customer",
      });
    }

    // CustomerSecurityDeposit belongs to Business
    if (models.business) {
      CustomerSecurityDeposit.belongsTo(models.business, {
        foreignKey: "facilityId",
        targetKey: "id",
        as: "business",
      });
    }

    // CustomerSecurityDeposit belongs to User (created_by)
    if (models.users) {
      CustomerSecurityDeposit.belongsTo(models.users, {
        foreignKey: "created_by",
        targetKey: "id",
        as: "creator",
      });
    }

    // CustomerSecurityDeposit belongs to Product
    if (models.Product) {
      CustomerSecurityDeposit.belongsTo(models.Product, {
        foreignKey: "product_id",
        targetKey: "id",
        as: "product",
      });
    }
  };

  return CustomerSecurityDeposit;
};