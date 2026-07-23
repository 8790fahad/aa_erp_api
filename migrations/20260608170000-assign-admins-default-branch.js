"use strict";

/**
 * Backfill branch assignment for existing admins.
 *
 * The Sales page (and other branch-aware screens) now show only the branches a
 * user is assigned to. Admins created before multi-branch assignment have no
 * row in `user_branches`, which previously fell back to "all branches".
 *
 * This migration assigns every Admin that has no branch assignment to their
 * facility's default branch, mirroring it into:
 *   - user_branches (is_primary = 1)
 *   - users.branchId
 *   - membership.branch_id
 */
module.exports = {
  up: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const QT = queryInterface.sequelize.QueryTypes;

    // Admins (or users with no branch assignment) whose facility has a default
    // branch, and who currently have no row in user_branches.
    const rows = await queryInterface.sequelize.query(
      `SELECT u.id AS user_id, u.facilityId AS facility_id, u.email AS email,
              b.id AS branch_id
         FROM users u
         JOIN branches b
           ON b.facilityId = u.facilityId
          AND b.is_default = 1
        WHERE u.facilityId IS NOT NULL
          AND LOWER(u.role) = 'admin'
          AND NOT EXISTS (
            SELECT 1 FROM user_branches ub WHERE ub.user_id = u.id
          )`,
      { type: QT.SELECT }
    );

    for (const row of rows) {
      // 1) Junction row (primary).
      await queryInterface.sequelize.query(
        `INSERT IGNORE INTO user_branches
           (user_id, branch_id, facility_id, is_primary, created_at, updated_at)
         VALUES (:userId, :branchId, :facilityId, 1, NOW(), NOW())`,
        {
          replacements: {
            userId: row.user_id,
            branchId: row.branch_id,
            facilityId: row.facility_id,
          },
          type: QT.INSERT,
        }
      );

      // 2) Mirror to users.branchId for legacy single-branch reads.
      await queryInterface.sequelize.query(
        `UPDATE users SET branchId = :branchId, updatedAt = NOW()
          WHERE id = :userId AND facilityId = :facilityId`,
        {
          replacements: {
            branchId: row.branch_id,
            userId: row.user_id,
            facilityId: row.facility_id,
          },
          type: QT.UPDATE,
        }
      );

      // 3) Mirror to membership.branch_id (authoritative for role/branch).
      await queryInterface.sequelize.query(
        `UPDATE membership SET branch_id = :branchId
          WHERE business_id = :facilityId
            AND user_id = :userId
            AND (branch_id IS NULL OR branch_id = 0)`,
        {
          replacements: {
            branchId: row.branch_id,
            facilityId: row.facility_id,
            userId: row.user_id,
          },
          type: QT.UPDATE,
        }
      );
    }
  },

  down: async () => {
    // Non-reversible data backfill; intentionally a no-op.
  },
};
