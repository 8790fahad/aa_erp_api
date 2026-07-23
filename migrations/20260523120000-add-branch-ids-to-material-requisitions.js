"use strict";

/**
 * Material Requisitions get two integer FK columns referencing branches.id:
 *   - requesting_branch_id: branch that needs the materials (set at creation)
 *   - source_branch_id:     branch the materials are pulled from (set at approval)
 *
 * If a previous migration ever created the legacy STRING(100) columns
 * `requesting_branch` / `source_branch` we drop them — they were never
 * actually used (the controllers passed values through but no SELECT/JOIN
 * relied on them). Doing this cleanly avoids confusion later.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const cols = await queryInterface
      .describeTable("material_requisitions")
      .catch(() => null);
    if (!cols) return; // table doesn't exist yet on a fresh install

    // Drop legacy string columns if they were created by an old migration
    if (cols.requesting_branch && cols.requesting_branch.type
      && String(cols.requesting_branch.type).toUpperCase().startsWith("VARCHAR")) {
      await queryInterface.removeColumn("material_requisitions", "requesting_branch");
    }
    if (cols.source_branch && cols.source_branch.type
      && String(cols.source_branch.type).toUpperCase().startsWith("VARCHAR")) {
      await queryInterface.removeColumn("material_requisitions", "source_branch");
    }

    const after = await queryInterface.describeTable("material_requisitions");

    if (!after.requesting_branch_id) {
      await queryInterface.addColumn("material_requisitions", "requesting_branch_id", {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: null,
        comment: "branches.id of the branch that requested the materials",
      });
    }

    if (!after.source_branch_id) {
      await queryInterface.addColumn("material_requisitions", "source_branch_id", {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: null,
        comment: "branches.id of the branch the approver issued materials from",
      });
    }

    const addIndex = async (name, col) => {
      const [idx] = await queryInterface.sequelize.query(
        `SHOW INDEX FROM \`material_requisitions\` WHERE Key_name = '${name}'`
      );
      if (!idx.length) {
        await queryInterface.sequelize.query(
          `ALTER TABLE \`material_requisitions\` ADD INDEX \`${name}\` (\`${col}\`)`
        );
      }
    };
    await addIndex("idx_mr_requesting_branch_id", "requesting_branch_id");
    await addIndex("idx_mr_source_branch_id", "source_branch_id");
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    await queryInterface.sequelize
      .query("ALTER TABLE `material_requisitions` DROP INDEX `idx_mr_source_branch_id`")
      .catch(() => {});
    await queryInterface.sequelize
      .query("ALTER TABLE `material_requisitions` DROP INDEX `idx_mr_requesting_branch_id`")
      .catch(() => {});
    await queryInterface
      .removeColumn("material_requisitions", "source_branch_id")
      .catch(() => {});
    await queryInterface
      .removeColumn("material_requisitions", "requesting_branch_id")
      .catch(() => {});
  },
};
