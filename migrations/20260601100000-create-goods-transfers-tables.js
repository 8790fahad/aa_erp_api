"use strict";

/**
 * Goods Transfer schema:
 *   goods_transfers       — header (one row per transfer request)
 *   goods_transfer_items  — line items (qty/product per transfer)
 *
 * The flow goes: pending (request submitted) → approved (stock moved) or
 * rejected. We persist the whole request so `Pending Approvals` and
 * `Transfer History` survive page refreshes and can be audited.
 *
 * Inventory movement (qty_out @ source branch, qty_in @ destination branch)
 * happens at approval time only — the pending state never touches store_entries.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    // ---------- goods_transfers ----------
    const headerExists = await queryInterface
      .describeTable("goods_transfers")
      .catch(() => null);

    if (!headerExists) {
      await queryInterface.createTable("goods_transfers", {
        id: {
          type: Sequelize.STRING(50),
          primaryKey: true,
          allowNull: false,
        },
        transfer_no: {
          type: Sequelize.STRING(50),
          allowNull: false,
          unique: true,
        },
        facility_id: {
          type: Sequelize.STRING(50),
          allowNull: false,
        },
        source_branch_id: {
          type: Sequelize.INTEGER,
          allowNull: false,
          comment: "branches.id — physical From location",
        },
        destination_branch_id: {
          type: Sequelize.INTEGER,
          allowNull: false,
          comment: "branches.id — physical To location",
        },
        transfer_date: {
          type: Sequelize.DATEONLY,
          allowNull: false,
        },
        status: {
          type: Sequelize.ENUM("pending", "approved", "rejected", "cancelled"),
          allowNull: false,
          defaultValue: "pending",
        },
        notes: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        initiated_by: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        initiated_by_name: {
          type: Sequelize.STRING(150),
          allowNull: true,
        },
        approved_by: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        approved_by_name: {
          type: Sequelize.STRING(150),
          allowNull: true,
        },
        approved_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        rejected_by: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        rejected_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        rejection_reason: {
          type: Sequelize.TEXT,
          allowNull: true,
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
    }

    const addIndex = async (table, name, cols) => {
      const [idx] = await queryInterface.sequelize.query(
        `SHOW INDEX FROM \`${table}\` WHERE Key_name = '${name}'`
      );
      if (!idx.length) {
        await queryInterface.sequelize.query(
          `ALTER TABLE \`${table}\` ADD INDEX \`${name}\` (${cols.map((c) => `\`${c}\``).join(",")})`
        );
      }
    };

    await addIndex("goods_transfers", "idx_gt_facility_status", [
      "facility_id",
      "status",
    ]);
    await addIndex("goods_transfers", "idx_gt_source_branch", [
      "source_branch_id",
    ]);
    await addIndex("goods_transfers", "idx_gt_dest_branch", [
      "destination_branch_id",
    ]);
    await addIndex("goods_transfers", "idx_gt_transfer_date", [
      "transfer_date",
    ]);

    // ---------- goods_transfer_items ----------
    const itemsExists = await queryInterface
      .describeTable("goods_transfer_items")
      .catch(() => null);

    if (!itemsExists) {
      await queryInterface.createTable("goods_transfer_items", {
        id: {
          type: Sequelize.INTEGER,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false,
        },
        transfer_id: {
          type: Sequelize.STRING(50),
          allowNull: false,
          comment: "FK to goods_transfers.id",
        },
        product_id: {
          type: Sequelize.STRING(50),
          allowNull: false,
          comment: "products.sku",
        },
        item_name: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        quantity: {
          type: Sequelize.DECIMAL(20, 4),
          allowNull: false,
          defaultValue: 0,
        },
        unit_of_measure: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        cost_price: {
          type: Sequelize.DECIMAL(20, 2),
          allowNull: true,
        },
        selling_price: {
          type: Sequelize.DECIMAL(20, 2),
          allowNull: true,
        },
        mark_up: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: true,
        },
        expiry_date: {
          type: Sequelize.DATEONLY,
          allowNull: true,
        },
        supplier_code: {
          type: Sequelize.STRING(150),
          allowNull: true,
        },
        supplier_name: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        from_qty_snapshot: {
          type: Sequelize.DECIMAL(20, 4),
          allowNull: true,
          comment: "Available qty at source when request was submitted",
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

      // FK from goods_transfer_items.transfer_id → goods_transfers.id
      await queryInterface.sequelize.query(
        "ALTER TABLE `goods_transfer_items` " +
          "ADD CONSTRAINT `fk_gti_transfer_id` " +
          "FOREIGN KEY (`transfer_id`) REFERENCES `goods_transfers`(`id`) " +
          "ON DELETE CASCADE ON UPDATE CASCADE"
      );
    }

    await addIndex("goods_transfer_items", "idx_gti_transfer_id", [
      "transfer_id",
    ]);
    await addIndex("goods_transfer_items", "idx_gti_product_id", [
      "product_id",
    ]);
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    await queryInterface.sequelize
      .query(
        "ALTER TABLE `goods_transfer_items` DROP FOREIGN KEY `fk_gti_transfer_id`"
      )
      .catch(() => {});
    await queryInterface.dropTable("goods_transfer_items").catch(() => {});
    await queryInterface.dropTable("goods_transfers").catch(() => {});
  },
};
