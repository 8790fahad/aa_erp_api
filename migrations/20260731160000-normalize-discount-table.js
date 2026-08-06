"use strict";

/**
 * Normalize `discount_table`:
 * - Align facilityId with business.id (VARCHAR(50))
 * - Add min_order_amount + customer_type (used by sales UI)
 * - Enforce NOT NULL status + timestamps
 * - Unique discount name per facility
 * - FK → business, composite FK → account_category(code, facility_id)
 * - CHECK value > 0; percentage discounts must be ≤ 100
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const table = await queryInterface.describeTable("discount_table");

    // Backfill timestamps before making them NOT NULL
    await queryInterface.sequelize.query(`
      UPDATE discount_table
      SET created_at = COALESCE(created_at, NOW()),
          updated_at = COALESCE(updated_at, NOW())
      WHERE created_at IS NULL OR updated_at IS NULL
    `);

    await queryInterface.sequelize.query(`
      UPDATE discount_table
      SET status = 'active'
      WHERE status IS NULL OR status = ''
    `);

    await queryInterface.sequelize.query(`
      UPDATE discount_table
      SET value = 0.01
      WHERE value IS NULL OR value <= 0
    `);

    if (!table.min_order_amount) {
      await queryInterface.addColumn("discount_table", "min_order_amount", {
        type: Sequelize.DECIMAL(20, 2),
        allowNull: false,
        defaultValue: 0,
        comment: "Minimum invoice subtotal required to apply this discount",
      });
    }

    if (!table.customer_type) {
      await queryInterface.addColumn("discount_table", "customer_type", {
        type: Sequelize.STRING(100),
        allowNull: true,
        defaultValue: null,
        comment:
          "Optional customer type this discount applies to (NULL = all types)",
      });
    }

    // Align facilityId length with business.id
    await queryInterface.changeColumn("discount_table", "facilityId", {
      type: Sequelize.STRING(50),
      allowNull: false,
    });

    await queryInterface.changeColumn("discount_table", "discount_name", {
      type: Sequelize.STRING(150),
      allowNull: false,
    });

    await queryInterface.changeColumn("discount_table", "discount_account_head", {
      type: Sequelize.STRING(20),
      allowNull: false,
      comment: "Chart of account code (account_category.code)",
    });

    await queryInterface.changeColumn("discount_table", "status", {
      type: Sequelize.ENUM("active", "disabled"),
      allowNull: false,
      defaultValue: "active",
    });

    await queryInterface.changeColumn("discount_table", "created_at", {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
    });

    await queryInterface.changeColumn("discount_table", "updated_at", {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal(
        "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
      ),
    });

    // Drop old indexes/constraints if re-running
    const [indexes] = await queryInterface.sequelize.query(
      `SHOW INDEX FROM discount_table`,
    );
    const indexNames = new Set(indexes.map((i) => i.Key_name));

    if (!indexNames.has("uq_discount_name_per_facility")) {
      await queryInterface.addIndex("discount_table", ["facilityId", "discount_name"], {
        unique: true,
        name: "uq_discount_name_per_facility",
      });
    }

    if (!indexNames.has("idx_discount_facility_status")) {
      await queryInterface.addIndex("discount_table", ["facilityId", "status"], {
        name: "idx_discount_facility_status",
      });
    }

    if (!indexNames.has("idx_discount_account_head_facility")) {
      await queryInterface.addIndex(
        "discount_table",
        ["discount_account_head", "facilityId"],
        { name: "idx_discount_account_head_facility" },
      );
    }

    // Foreign keys — ignore if already present
    const [fks] = await queryInterface.sequelize.query(`
      SELECT CONSTRAINT_NAME
      FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'discount_table'
        AND CONSTRAINT_TYPE = 'FOREIGN KEY'
    `);
    const fkNames = new Set(fks.map((r) => r.CONSTRAINT_NAME));

    if (!fkNames.has("fk_discount_facility")) {
      await queryInterface.sequelize.query(`
        ALTER TABLE discount_table
        ADD CONSTRAINT fk_discount_facility
          FOREIGN KEY (facilityId) REFERENCES business(id)
          ON UPDATE CASCADE
          ON DELETE CASCADE
      `);
    }

    if (!fkNames.has("fk_discount_account_head")) {
      try {
        await queryInterface.sequelize.query(`
          ALTER TABLE discount_table
          ADD CONSTRAINT fk_discount_account_head
            FOREIGN KEY (discount_account_head, facilityId)
            REFERENCES account_category(code, facility_id)
            ON UPDATE CASCADE
            ON DELETE RESTRICT
        `);
      } catch (err) {
        // Type/length mismatch or missing CoA rows — keep index, skip hard FK
        console.warn(
          "Skipping fk_discount_account_head:",
          err.message || err,
        );
      }
    }

    // CHECK constraints (MariaDB 10.2+ / MySQL 8+)
    const [checks] = await queryInterface.sequelize.query(`
      SELECT CONSTRAINT_NAME
      FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'discount_table'
        AND CONSTRAINT_TYPE = 'CHECK'
    `);
    const checkNames = new Set(checks.map((r) => r.CONSTRAINT_NAME));

    if (!checkNames.has("chk_discount_value_positive")) {
      await queryInterface.sequelize.query(`
        ALTER TABLE discount_table
        ADD CONSTRAINT chk_discount_value_positive
          CHECK (value > 0)
      `);
    }

    if (!checkNames.has("chk_discount_percentage_range")) {
      await queryInterface.sequelize.query(`
        ALTER TABLE discount_table
        ADD CONSTRAINT chk_discount_percentage_range
          CHECK (
            discount_type <> 'Percentage'
            OR (value > 0 AND value <= 100)
          )
      `);
    }

    if (!checkNames.has("chk_discount_min_order_nonneg")) {
      await queryInterface.sequelize.query(`
        ALTER TABLE discount_table
        ADD CONSTRAINT chk_discount_min_order_nonneg
          CHECK (min_order_amount >= 0)
      `);
    }
  },

  async down(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const dropFk = async (name) => {
      try {
        await queryInterface.sequelize.query(
          `ALTER TABLE discount_table DROP FOREIGN KEY \`${name}\``,
        );
      } catch (_) {
        /* ignore */
      }
    };
    const dropCheck = async (name) => {
      try {
        await queryInterface.sequelize.query(
          `ALTER TABLE discount_table DROP CHECK \`${name}\``,
        );
      } catch (_) {
        /* ignore */
      }
    };
    const dropIndex = async (name) => {
      try {
        await queryInterface.removeIndex("discount_table", name);
      } catch (_) {
        /* ignore */
      }
    };

    await dropFk("fk_discount_account_head");
    await dropFk("fk_discount_facility");
    await dropCheck("chk_discount_value_positive");
    await dropCheck("chk_discount_percentage_range");
    await dropCheck("chk_discount_min_order_nonneg");
    await dropIndex("uq_discount_name_per_facility");
    await dropIndex("idx_discount_facility_status");
    await dropIndex("idx_discount_account_head_facility");

    const table = await queryInterface.describeTable("discount_table");
    if (table.min_order_amount) {
      await queryInterface.removeColumn("discount_table", "min_order_amount");
    }
    if (table.customer_type) {
      await queryInterface.removeColumn("discount_table", "customer_type");
    }
  },
};
