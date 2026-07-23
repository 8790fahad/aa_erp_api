module.exports = (sequelize, DataTypes) => {
  const LeaveType = sequelize.define(
    "leave_types",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      facilityId: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
        field: "facilityId",
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: "name",
      },
      code: {
        type: DataTypes.STRING(20),
        allowNull: false,
        field: "code",
      },
      maxDays: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: "maxDays",
      },
      isPaid: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: "isPaid",
      },
      requiresApproval: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: "requiresApproval",
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "description",
      },
      color: {
        type: DataTypes.STRING(7),
        allowNull: false,
        defaultValue: "#3B82F6",
        field: "color",
      },
      status: {
        type: DataTypes.ENUM("active", "inactive"),
        allowNull: false,
        defaultValue: "active",
        field: "status",
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: "createdAt",
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: "updatedAt",
      },
    },
    {
      tableName: "leave_types",
      timestamps: true,
      indexes: [
        {
          fields: ["facilityId"],
        },
        {
          fields: ["code", "facilityId"],
          unique: true,
        },
      ],
    }
  );

  // Define associations
  LeaveType.associate = function (models) {
    // One leave type can have many leave balances
    LeaveType.hasMany(models.leave_balances, {
      foreignKey: "leaveType",
      sourceKey: "code",
      as: "leaveBalances",
    });
  };

  return LeaveType;
};
