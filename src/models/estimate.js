module.exports = (sequelize, DataTypes) => {
  const Estimate = sequelize.define(
    "Estimate",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      project_number: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      customer_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      customer_name: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      billing_address: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      estimate_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },

      message_on_estimate: {
        type: DataTypes.TEXT,
        allowNull: true,
      },

      facility_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM(
          "Draft",
          "Sent",
          "Accepted",
          "Invoiced",
          "Expired",
          "Declined",
        ),
        defaultValue: "Draft",
      },
      created_by: {
        type: DataTypes.STRING,
        allowNull: true, // Or false if we enforce user tracking
      },
      subtotal: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      },
      tax_amount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      },
      total: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      },
      data: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: "Stores line_items, taxes, and other structured estimate data",
      },
    },
    {
      tableName: "estimates",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  );

  return Estimate;
};
