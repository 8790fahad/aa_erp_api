"use strict";
module.exports = (sequelize, DataTypes) => {
  const PaymentApplication = sequelize.define(
    "PaymentApplication",
    {
      payment_app_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      payment_id: { type: DataTypes.INTEGER, allowNull: false },
      invoice_id: { type: DataTypes.INTEGER, allowNull: false },
      applied_amount: { type: DataTypes.DECIMAL(20, 2), allowNull: false },
    },
    { tableName: "payment_applications", timestamps: false }
  );

  PaymentApplication.associate = function (models) {
    // PaymentApplication belongs to Payment
    if (models.Payment) {
      PaymentApplication.belongsTo(models.Payment, {
        foreignKey: "payment_id",
      });
    }

    // PaymentApplication belongs to Invoice
    if (models.Invoice) {
      PaymentApplication.belongsTo(models.Invoice, {
        foreignKey: "invoice_id",
      });
    }
  };

  return PaymentApplication;
};
