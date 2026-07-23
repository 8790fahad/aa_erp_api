// models/AccountCategory.js
"use strict";

const { QueryTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  const AccountCategory = sequelize.define(
    "AccountCategory",
    {
      id: {
        type: DataTypes.BIGINT,
        autoIncrement: true,
        allowNull: false,
        unique: true,
      },
      code: {
        type: DataTypes.STRING(20),
        allowNull: false,
        primaryKey: true,
        comment: "Unique code like etc. (unique per facility_id)",
      },
      parentCode: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "0",
        field: "parent_code", // maps to DB column
      },
      level: {
        type: DataTypes.TINYINT,
        allowNull: false,
      },
      category: {
        type: DataTypes.ENUM(
          "assets",
          "liabilities",
          "equity",
          "revenue",
          "expenses",
        ),
        allowNull: false,
      },
      type: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: "Account type (e.g. Current assets, Non-current assets)",
      },
      description: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      accountNature: {
        type: DataTypes.ENUM(
          "ASSET",
          "LIABILITY",
          "EQUITY",
          "REVENUE",
          "EXPENSE",
        ),
        allowNull: false,
        field: "account_nature",
      },

      facilityId: {
        type: DataTypes.STRING(36),
        allowNull: false,
        primaryKey: true,
        defaultValue: "ae9d49ee-3f9c-4f1e-bd6c-d2f18c61269f",
        field: "facility_id",
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        field: "is_active",
      },
      subcategory: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      display: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        field: "display",
      },
    },
    {
      tableName: "account_category",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        {
          unique: true,
          fields: ["id"],
          name: "unique_account_category_id",
        },
        {
          unique: true,
          fields: ["code", "facility_id"],
          name: "unique_code_per_facility",
        },
        { fields: ["parent_code"] },
        { fields: ["facility_id"] },
        { fields: ["level"] },
        { fields: ["category"] },
        { fields: ["facility_id", "parent_code"] },
      ],
    },
  );

  /**
   * Next code (must match MySQL `generate_account_code`):
   * - parent "1".."5" OR any six-digit [1-5]xxxxx → next flat six-digit code for that nature (100001, 100002, …).
   * Source: migrations/20260418120000-generate-account-code-flat-six-digit-only.js
   */
  AccountCategory.generateNextCode = async function (parentCode, facilityId) {
    const pc =
      parentCode === null || parentCode === undefined
        ? ""
        : String(parentCode).trim();
    if (!pc) {
      throw new Error(
        "parentCode is required (nature digit 1–5 or a six-digit account code, e.g. 100001)",
      );
    }

    let nature;
    if (/^[1-5]$/.test(pc)) {
      nature = pc;
    } else if (/^[1-5]\d{5}$/.test(pc)) {
      nature = pc[0];
    } else {
      throw new Error(
        "parentCode must be nature 1–5 or a six-digit account code (e.g. 100001)",
      );
    }

    const rows = await sequelize.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(code, 2, 5) AS UNSIGNED)), 0) AS maxseq
       FROM account_category
       WHERE facility_id = :facilityId
         AND code REGEXP '^[1-5][0-9]{5}$'
         AND LEFT(code, 1) = :nature`,
      {
        replacements: { facilityId, nature },
        type: QueryTypes.SELECT,
      },
    );
    const maxseq = parseInt(rows[0]?.maxseq, 10);
    const next = (Number.isFinite(maxseq) ? maxseq : 0) + 1;
    if (next > 99999) {
      throw new Error("Maximum sequence (99999) reached for this nature");
    }
    return `${nature}${String(next).padStart(5, "0")}`;
  };

  // Relationships
  AccountCategory.associate = function (models) {
    AccountCategory.hasMany(AccountCategory, {
      foreignKey: "parentCode",
      sourceKey: "code",
      as: "children",
      constraints: false,
    });

    AccountCategory.belongsTo(AccountCategory, {
      foreignKey: "parentCode",
      targetKey: "code",
      as: "parent",
      constraints: false,
    });

    if (models.Business) {
      AccountCategory.belongsTo(models.Business, {
        foreignKey: "facilityId",
        as: "facility",
      });
    }
  };

  return AccountCategory;
};
