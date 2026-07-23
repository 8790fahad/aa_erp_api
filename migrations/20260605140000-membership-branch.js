"use strict";

/**
 * Staff role + branch are now sourced from the `membership` table rather than
 * the `users` table. `membership.role` already existed; this migration adds a
 * `membership.branch_id` column so a staff member's branch is stored per
 * business membership.
 *
 * Existing `users.branchId` values are backfilled into the matching membership
 * row (matched by business + email) so current assignments are preserved.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const membershipCols = await queryInterface
      .describeTable("membership")
      .catch(() => null);

    if (membershipCols && !membershipCols.branch_id) {
      await queryInterface.addColumn("membership", "branch_id", {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment:
          "Staff member's branch for this business membership (source of truth for branch).",
      });
    }

    // Index for branch lookups/joins
    const [idx] = await queryInterface.sequelize.query(
      "SHOW INDEX FROM `membership` WHERE Key_name = 'idx_membership_branch_id'"
    );
    if (!idx.length) {
      await queryInterface.sequelize
        .query(
          "ALTER TABLE `membership` ADD INDEX `idx_membership_branch_id` (`branch_id`)"
        )
        .catch(() => {});
    }

    // Backfill from users.branchId (matched by business + email).
    await queryInterface.sequelize
      .query(
        `UPDATE membership m
            JOIN users u
              ON u.email = m.email
             AND u.facilityId = m.business_id
             SET m.branch_id = u.branchId
           WHERE u.branchId IS NOT NULL
             AND (m.branch_id IS NULL OR m.branch_id = 0)`
      )
      .catch(() => {});
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    await queryInterface.sequelize
      .query(
        "ALTER TABLE `membership` DROP INDEX `idx_membership_branch_id`"
      )
      .catch(() => {});
    await queryInterface
      .removeColumn("membership", "branch_id")
      .catch(() => {});
  },
};
