// models/JournalEntry.js
// Note: This model may not match the actual database structure
// The journal_entries table might not exist or have different columns
// All operations use raw SQL queries instead of this model
module.exports = (sequelize, DataTypes) => {
    const JournalEntry = sequelize.define(
      "JournalEntry",
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          allowNull: true, // Make it nullable in case column doesn't exist
        },
        transaction_ref: {
          type: DataTypes.STRING(100),
          allowNull: false,
        },
        reference_number: {
          type: DataTypes.STRING(50),
          allowNull: false,
        },
        entry_date: {
          type: DataTypes.DATEONLY,
          allowNull: false,
        },
        currency: {
          type: DataTypes.STRING(3),
          defaultValue: "NGN",
        },
        description: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        total_debit: {
          type: DataTypes.DECIMAL(15, 2),
          defaultValue: 0,
        },
        total_credit: {
          type: DataTypes.DECIMAL(15, 2),
          defaultValue: 0,
        },
        status: {
          type: DataTypes.STRING(20),
          defaultValue: "draft",
        },
        created_by: {
          type: DataTypes.STRING(100),
          allowNull: true,
        },
        facility_id: {
          type: DataTypes.STRING(50),
          allowNull: false,
        },
      },
      {
        tableName: "journal_entries",
        timestamps: true,
        freezeTableName: true,
        // Disable auto-sync to avoid validation errors
        syncOnAssociation: false,
        // Use minimal validation
        validate: {},
      }
    );

    // Disable table existence check
    JournalEntry.removeAttribute = function() {
      // No-op to prevent attribute removal issues
    };

    JournalEntry.associate = (models) => {
      JournalEntry.hasMany(models.GeneralLedger, {
        foreignKey: "transaction_ref",
        sourceKey: "transaction_ref",
        as: "lines",
      });
    };

    return JournalEntry;
  };
