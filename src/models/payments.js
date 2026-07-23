"use strict";
module.exports = (sequelize, DataTypes) => {
  const Payment = sequelize.define(
    "Payment",
    {
      payment_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      customerNo: { type: DataTypes.STRING, allowNull: false },
      payment_ref: { type: DataTypes.STRING, allowNull: false },
      amount: { type: DataTypes.DECIMAL(20, 2), allowNull: false },
      payment_date: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      mode_of_payment: { type: DataTypes.STRING },
      facilityId: { type: DataTypes.STRING },
    },
    { tableName: "payments", timestamps: false }
  );

  Payment.associate = function (models) {
    // Payment belongs to Customer
    if (models.Customer) {
      Payment.belongsTo(models.Customer, { foreignKey: "customerNo" });
    }

    // Payment has many PaymentApplications
    if (models.PaymentApplication) {
      Payment.hasMany(models.PaymentApplication, { foreignKey: "payment_id" });
    }
  };

  return Payment;
};
