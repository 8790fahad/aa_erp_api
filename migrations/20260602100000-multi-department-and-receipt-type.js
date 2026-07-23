"use strict";

/**
 * Two related concerns are addressed in one migration:
 *
 *  1. Multi-department per user
 *     Up to now `users.departmentId` was a single integer, so a user could
 *     only belong to one department. We add a `user_departments` junction
 *     table so a user can be assigned to many. `users.departmentId` is kept
 *     and now points to the user's *primary* department — that preserves
 *     all existing read paths (DepartmentSelect, EmployeeForm, leave UI)
 *     without forcing a coordinated frontend rewrite.
 *
 *  2. Default receipt type per business (pdf | terminal)
 *     Adds `business.default_receipt_type` so MakeSale can decide whether
 *     to render a full PDF invoice or a thermal-printer style receipt.
 *
 * Existing rows with `users.departmentId IS NOT NULL` are backfilled into
 * `user_departments` with `is_primary = 1`.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    // ------------------------------------------------------------------
    // 1) user_departments junction
    // ------------------------------------------------------------------
    const userDeptsExists = await queryInterface
      .describeTable("user_departments")
      .catch(() => null);

    if (!userDeptsExists) {
      await queryInterface.createTable("user_departments", {
        id: {
          type: Sequelize.INTEGER,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false,
        },
        user_id: {
          type: Sequelize.CHAR(36),
          allowNull: false,
        },
        department_id: {
          type: Sequelize.INTEGER,
          allowNull: false,
        },
        facility_id: {
          type: Sequelize.STRING(50),
          allowNull: false,
        },
        is_primary: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
          comment:
            "true = department mirrored back to users.departmentId (single-department legacy paths)",
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
      });

      // Unique pair: a user can't be in the same department twice
      await queryInterface.sequelize.query(
        "ALTER TABLE `user_departments` " +
          "ADD UNIQUE KEY `uniq_user_department` (`user_id`, `department_id`)"
      );
    }

    const addIndex = async (table, name, cols) => {
      const [idx] = await queryInterface.sequelize.query(
        `SHOW INDEX FROM \`${table}\` WHERE Key_name = '${name}'`
      );
      if (!idx.length) {
        await queryInterface.sequelize.query(
          `ALTER TABLE \`${table}\` ADD INDEX \`${name}\` (${cols
            .map((c) => `\`${c}\``)
            .join(",")})`
        );
      }
    };

    await addIndex("user_departments", "idx_ud_user_id", ["user_id"]);
    await addIndex("user_departments", "idx_ud_department_id", [
      "department_id",
    ]);
    await addIndex("user_departments", "idx_ud_facility_id", ["facility_id"]);

    // Backfill: every user that already has a single departmentId becomes
    // a primary row in user_departments.
    await queryInterface.sequelize.query(
      `INSERT IGNORE INTO user_departments (user_id, department_id, facility_id, is_primary, created_at, updated_at)
         SELECT u.id, u.departmentId, u.facilityId, 1, NOW(), NOW()
           FROM users u
          WHERE u.departmentId IS NOT NULL
            AND u.facilityId IS NOT NULL`
    );

    // ------------------------------------------------------------------
    // 2) business.default_receipt_type
    // ------------------------------------------------------------------
    const businessCols = await queryInterface
      .describeTable("business")
      .catch(() => null);

    if (businessCols && !businessCols.default_receipt_type) {
      await queryInterface.addColumn("business", "default_receipt_type", {
        type: Sequelize.ENUM("pdf", "terminal"),
        allowNull: false,
        defaultValue: "pdf",
        comment:
          "Default receipt format for sales — pdf (standard A4/A5 PDF) or terminal (80mm thermal printer)",
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const businessCols = await queryInterface
      .describeTable("business")
      .catch(() => null);

    if (businessCols && businessCols.default_receipt_type) {
      await queryInterface
        .removeColumn("business", "default_receipt_type")
        .catch(() => {});
      // Drop the ENUM type artifact MySQL leaves behind
      await queryInterface.sequelize
        .query(
          "ALTER TABLE `business` DROP COLUMN IF EXISTS `default_receipt_type`"
        )
        .catch(() => {});
    }

    await queryInterface.dropTable("user_departments").catch(() => {});
  },
};
