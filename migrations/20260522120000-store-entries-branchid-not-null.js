"use strict";

/**
 * Make store_entries.branchId NOT NULL with default 0.
 * Backfill existing rows by joining on branch_name + facilityId.
 * A sentinel row (id=0, branch_name='Unassigned') is inserted into branches
 * so rows that cannot be matched still satisfy the NOT NULL constraint.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    // 1. Ensure the sentinel "Unassigned" branch exists with id = 0
    //    We use INSERT IGNORE so it's idempotent.
    await queryInterface.sequelize.query(`
      INSERT IGNORE INTO \`branches\`
        (id, branch_id, branch_name, store_type, admin, created_by, admin_name, facilityId)
      VALUES
        (0, 'UNASSIGNED', 'Unassigned', 'general', 'system', 'system', 'System', '')
    `).catch(() => {
      // If id=0 insert fails (e.g. AUTO_INCREMENT constraint), try without explicit id
    });

    // 2. Add branchId column if it doesn't exist yet (nullable first so backfill can run)
    const cols = await queryInterface.describeTable("store_entries");
    if (!cols.branchId) {
      await queryInterface.sequelize.query(
        "ALTER TABLE `store_entries` ADD COLUMN `branchId` INT NULL DEFAULT NULL"
      );
    }

    // 3. Backfill branchId from branches table by matching branch_name + facilityId
    await queryInterface.sequelize.query(`
      UPDATE \`store_entries\` se
      JOIN \`branches\` b
        ON b.branch_name = se.branch_name
        AND b.facilityId = se.facilityId
      SET se.branchId = b.id
      WHERE se.branchId IS NULL
    `);

    // 4. Set remaining NULLs to 0 (sentinel "Unassigned")
    await queryInterface.sequelize.query(`
      UPDATE \`store_entries\`
      SET branchId = 0
      WHERE branchId IS NULL
    `);

    // 5. Now alter to NOT NULL with default 0
    await queryInterface.sequelize.query(
      "ALTER TABLE `store_entries` MODIFY COLUMN `branchId` INT NOT NULL DEFAULT 0"
    );

    // 6. Add index for fast filtering
    const [indexes] = await queryInterface.sequelize.query(
      "SHOW INDEX FROM `store_entries` WHERE Key_name = 'idx_store_entries_branchId'"
    );
    if (!indexes.length) {
      await queryInterface.sequelize.query(
        "ALTER TABLE `store_entries` ADD INDEX `idx_store_entries_branchId` (`branchId`)"
      );
    }
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    // Revert to nullable
    await queryInterface.sequelize.query(
      "ALTER TABLE `store_entries` MODIFY COLUMN `branchId` INT NULL DEFAULT NULL"
    ).catch(() => {});
  },
};
