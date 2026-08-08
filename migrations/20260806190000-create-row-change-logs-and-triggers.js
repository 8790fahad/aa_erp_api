"use strict";

const {
  DEFAULT_AUDITED_TABLES,
  tableExists,
  installTableTriggers,
  dropTableTriggers,
} = require("./lib/rowChangeAuditTriggers");

/**
 * Standard row-change audit:
 * - `row_change_logs` table (before/after JSON backup on INSERT/UPDATE/DELETE)
 * - Triggers on core business tables (no stored procedures)
 * - Soft FK-style indexes linked to business / users where possible
 *
 * App sets session vars before writes:
 *   SET @aa_audit_user_id = '...';
 *   SET @aa_audit_facility_id = '...';
 * (see src/middleware/auditContext.js)
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const sequelize = queryInterface.sequelize;

    if (!(await tableExists(queryInterface, "row_change_logs"))) {
      await queryInterface.createTable("row_change_logs", {
        id: {
          type: Sequelize.BIGINT,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
        },
        table_name: {
          type: Sequelize.STRING(120),
          allowNull: false,
        },
        action: {
          type: Sequelize.ENUM("INSERT", "UPDATE", "DELETE"),
          allowNull: false,
        },
        facility_id: {
          type: Sequelize.STRING(50),
          allowNull: false,
          defaultValue: "",
        },
        row_pk: {
          type: Sequelize.STRING(191),
          allowNull: true,
        },
        user_id: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        before_data: {
          type: Sequelize.JSON,
          allowNull: true,
        },
        after_data: {
          type: Sequelize.JSON,
          allowNull: true,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
      });

      await queryInterface.addIndex(
        "row_change_logs",
        ["facility_id", "created_at"],
        { name: "idx_rcl_facility_created" },
      );
      await queryInterface.addIndex(
        "row_change_logs",
        ["table_name", "row_pk"],
        { name: "idx_rcl_table_pk" },
      );
      await queryInterface.addIndex(
        "row_change_logs",
        ["facility_id", "table_name", "action"],
        { name: "idx_rcl_facility_table_action" },
      );
    }

    // Ensure activity_audits exists (idempotent with earlier migration)
    if (!(await tableExists(queryInterface, "activity_audits"))) {
      await queryInterface.createTable("activity_audits", {
        id: {
          type: Sequelize.BIGINT,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
        },
        facility_id: {
          type: Sequelize.STRING(50),
          allowNull: false,
        },
        user_id: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        action: {
          type: Sequelize.STRING(40),
          allowNull: false,
        },
        entity_type: {
          type: Sequelize.STRING(80),
          allowNull: false,
        },
        entity_id: {
          type: Sequelize.STRING(120),
          allowNull: true,
        },
        entity_label: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        before_data: {
          type: Sequelize.JSON,
          allowNull: true,
        },
        after_data: {
          type: Sequelize.JSON,
          allowNull: true,
        },
        remark: {
          type: Sequelize.STRING(500),
          allowNull: true,
        },
        meta: {
          type: Sequelize.JSON,
          allowNull: true,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
      });
    }

    // Logical relationships via indexes (hard FKs omitted: legacy varchar ids / cascade risk)
    // Documented associations: facility_id → business.id, user_id → users.id

    let installed = 0;
    for (const table of DEFAULT_AUDITED_TABLES) {
      try {
        const ok = await installTableTriggers(
          queryInterface,
          sequelize,
          table,
        );
        if (ok) {
          installed += 1;
          console.log(`  ✓ audit triggers: ${table}`);
        }
      } catch (err) {
        console.warn(
          `  ⚠ audit triggers skipped for ${table}: ${err.message}`,
        );
      }
    }
    console.log(`  → installed row-change triggers on ${installed} tables`);

    // Legacy workflow log triggers for purchase_requisition → logs (no procedure)
    if (await tableExists(queryInterface, "purchase_requisition")) {
      if (await tableExists(queryInterface, "logs")) {
        await sequelize.query("DROP TRIGGER IF EXISTS `aa_pr_ai_logs`");
        await sequelize.query("DROP TRIGGER IF EXISTS `aa_pr_au_logs`");
        await sequelize.query(`
          CREATE TRIGGER \`aa_pr_ai_logs\`
          AFTER INSERT ON \`purchase_requisition\`
          FOR EACH ROW
          BEGIN
            INSERT INTO \`logs\`
              (\`type\`, \`name\`, \`amount\`, \`role\`, \`id_link\`, \`remark\`, \`user_id\`, \`status\`, \`facilityId\`, \`date\`)
            VALUES (
              'material requisition created',
              'Purchase',
              NULL,
              NULL,
              NEW.pr_no,
              COALESCE(LEFT(NEW.reason, 250), ''),
              COALESCE(NULLIF(CAST(@aa_audit_user_id AS CHAR(50)), ''), CAST(NEW.user_id AS CHAR(50)), '0'),
              UPPER(LEFT(COALESCE(NEW.status, 'PENDING'), 100)),
              NEW.facilityId,
              NOW()
            );
          END
        `);
        await sequelize.query(`
          CREATE TRIGGER \`aa_pr_au_logs\`
          AFTER UPDATE ON \`purchase_requisition\`
          FOR EACH ROW
          BEGIN
            INSERT INTO \`logs\`
              (\`type\`, \`name\`, \`amount\`, \`role\`, \`id_link\`, \`remark\`, \`user_id\`, \`status\`, \`facilityId\`, \`date\`)
            VALUES (
              'material requisition updated',
              'Purchase',
              NULL,
              NULL,
              NEW.pr_no,
              COALESCE(LEFT(NEW.reason, 250), ''),
              COALESCE(NULLIF(CAST(@aa_audit_user_id AS CHAR(50)), ''), CAST(NEW.user_id AS CHAR(50)), '0'),
              UPPER(LEFT(COALESCE(NEW.status, 'PENDING'), 100)),
              NEW.facilityId,
              NOW()
            );
          END
        `);
        console.log("  ✓ purchase_requisition → logs triggers");
      }
    }
  },

  async down(queryInterface) {
    const sequelize = queryInterface.sequelize;
    await sequelize.query("DROP TRIGGER IF EXISTS `aa_pr_ai_logs`");
    await sequelize.query("DROP TRIGGER IF EXISTS `aa_pr_au_logs`");

    for (const table of DEFAULT_AUDITED_TABLES) {
      try {
        await dropTableTriggers(sequelize, table);
      } catch (_) {
        /* ignore */
      }
    }

    if (await tableExists(queryInterface, "row_change_logs")) {
      await queryInterface.dropTable("row_change_logs");
    }
  },
};
