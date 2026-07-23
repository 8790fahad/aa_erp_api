"use strict";
module.exports = (sequelize, DataTypes) => {
  const Invoice = sequelize.define(
    "Invoice",
    {
      invoice_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      ref_number: { type: DataTypes.STRING, allowNull: true },
      invoice_ref: { type: DataTypes.STRING, allowNull: false },
      project_id: { type: DataTypes.INTEGER, allowNull: true },
      due_date: { type: DataTypes.DATE, allowNull: true },
      transaction_date: { type: DataTypes.DATE, allowNull: true },
      // tax_amount: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      // discount_amount: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      description: { type: DataTypes.TEXT, allowNull: false },
      amount: { type: DataTypes.DECIMAL(20, 2), allowNull: false },
      created_by: { type: DataTypes.STRING, allowNull: false },
      facility_id: { type: DataTypes.STRING, allowNull: false },
      branchId: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
      type: {
        type: DataTypes.ENUM("purchase", "sales"),
      },
      created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    },
    { tableName: "invoices", timestamps: false }
  );
  return Invoice;
};
