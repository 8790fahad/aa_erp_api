"use strict";

/**
 * Switch staff multi-assignment from departments to branches.
 *
 *   - Adds a `user_branches` junction table so a staff member can belong
 *     to multiple branches. `users.branchId` is kept and now holds the
 *     user's *primary* branch id, mirrored from the junction's
 *     `is_primary = 1` row (legacy single-branch reads keep working).
 *   - Drops the previously added `user_departments` table since the
 *     business does not use multi-department any more.
 *
 * `business.default_receipt_type` from the previous migration is left in
 * place — it isn't related to staff assignment.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    // ------------------------------------------------------------------
    // 1) user_branches junction
    // ------------------------------------------------------------------
    const userBranchesExists = await queryInterface
      .describeTable("user_branches")
      .catch(() => null);

    if (!userBranchesExists) {
      await queryInterface.createTable("user_branches", {
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
        branch_id: {
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
            "true = branch mirrored back to users.branchId (single-branch legacy paths)",
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

      await queryInterface.sequelize.query(
        "ALTER TABLE `user_branches` " +
          "ADD UNIQUE KEY `uniq_user_branch` (`user_id`, `branch_id`)"
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

    await addIndex("user_branches", "idx_ub_user_id", ["user_id"]);
    await addIndex("user_branches", "idx_ub_branch_id", ["branch_id"]);
    await addIndex("user_branches", "idx_ub_facility_id", ["facility_id"]);

    // Backfill: every user that already has a single branchId becomes a
    // primary row in user_branches.
    await queryInterface.sequelize.query(
      `INSERT IGNORE INTO user_branches (user_id, branch_id, facility_id, is_primary, created_at, updated_at)
         SELECT u.id, u.branchId, u.facilityId, 1, NOW(), NOW()
           FROM users u
          WHERE u.branchId IS NOT NULL
            AND u.facilityId IS NOT NULL`
    );

    // ------------------------------------------------------------------
    // 2) Drop the now-unused user_departments table from the previous
    //    migration. We leave users.departmentId in place so any single-
    //    department code paths (HR forms, reports) keep working.
    // ------------------------------------------------------------------
    await queryInterface.dropTable("user_departments").catch(() => {});
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;
    await queryInterface.dropTable("user_branches").catch(() => {});
  },
};
