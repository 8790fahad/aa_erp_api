module.exports = (sequelize, DataTypes) => {
  const SavedReport = sequelize.define(
    "SavedReport",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      report_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      account_codes: {
        type: DataTypes.TEXT,
        allowNull: false,
        get() {
          const raw = this.getDataValue("account_codes");
          return raw ? JSON.parse(raw) : [];
        },
        set(val) {
          this.setDataValue("account_codes", JSON.stringify(val));
        },
      },
      from_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      to_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      only_children: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      report_type: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "full",
      },
      summary_presentation: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      facility_id: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      created_by: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
    },
    {
      tableName: "saved_reports",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  );

  return SavedReport;
};
