"use strict";

/**
 * Extend einvoicing_clients for KYC lifecycle credentials:
 * - environment: testing | production
 * - kyc_user_id: link to KYC client (nullable for legacy business-only rows)
 * - business_id: nullable for KYC signup before a FlowBooks business exists
 * - unique per (kyc_user_id, environment) and (business_id, environment)
 *
 * Also adds kyc_users.status value "approved" (KYC complete ≠ email verified).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // --- einvoicing_clients ---
    const eiDesc = await queryInterface.describeTable("einvoicing_clients");

    if (!eiDesc.environment) {
      await queryInterface.addColumn("einvoicing_clients", "environment", {
        type: Sequelize.ENUM("testing", "production"),
        allowNull: false,
        defaultValue: "production",
        comment: "Sandbox/testing vs live/production credentials",
      });
    }

    if (!eiDesc.kyc_user_id) {
      await queryInterface.addColumn("einvoicing_clients", "kyc_user_id", {
        type: Sequelize.UUID,
        allowNull: true,
        comment: "KYC client that owns this credential pair",
      });
    }

    // Allow null business_id for KYC-only credentials (no facility yet).
    if (eiDesc.business_id && eiDesc.business_id.allowNull === false) {
      await queryInterface.changeColumn("einvoicing_clients", "business_id", {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: "FlowBooks business/facility id (optional until linked)",
      });
    }

    // Replace one-credential-per-business with one-per-(owner, environment).
    const indexes = await queryInterface.showIndex("einvoicing_clients");
    const uniqueBizOnly = indexes.filter(
      (i) =>
        i.unique &&
        Array.isArray(i.fields) &&
        i.fields.length === 1 &&
        (i.fields[0] === "business_id" || i.fields[0]?.attribute === "business_id"),
    );
    // sequelize-cli / older sync may name this either way
    const namedBizUnique = indexes.find(
      (i) =>
        i.name === "einvoicing_clients_business_id" ||
        (i.name === "business_id" && i.unique),
    );
    const toRemove = new Set([
      ...uniqueBizOnly.map((i) => i.name),
      ...(namedBizUnique ? [namedBizUnique.name] : []),
    ]);
    for (const name of toRemove) {
      try {
        await queryInterface.removeIndex("einvoicing_clients", name);
      } catch (err) {
        console.warn(`Could not remove index ${name}:`, err.message);
      }
    }

    const indexesAfter = await queryInterface.showIndex("einvoicing_clients");
    const indexNames = new Set(indexesAfter.map((i) => i.name));
    if (!indexNames.has("einvoicing_clients_business_env")) {
      await queryInterface.addIndex(
        "einvoicing_clients",
        ["business_id", "environment"],
        {
          name: "einvoicing_clients_business_env",
          unique: true,
        },
      );
    }
    if (!indexNames.has("einvoicing_clients_kyc_env")) {
      await queryInterface.addIndex(
        "einvoicing_clients",
        ["kyc_user_id", "environment"],
        {
          name: "einvoicing_clients_kyc_env",
          unique: true,
        },
      );
    }
    if (!indexNames.has("einvoicing_clients_kyc_user_id")) {
      await queryInterface.addIndex("einvoicing_clients", ["kyc_user_id"], {
        name: "einvoicing_clients_kyc_user_id",
      });
    }

    // --- kyc_users.status: add approved ---
    // MySQL ENUM alteration: expand enum values.
    await queryInterface.sequelize.query(`
      ALTER TABLE kyc_users
      MODIFY COLUMN status ENUM('pending', 'verified', 'approved', 'suspended')
      NOT NULL DEFAULT 'pending'
    `);
  },

  async down(queryInterface, Sequelize) {
    const indexes = await queryInterface.showIndex("einvoicing_clients");
    const indexNames = new Set(indexes.map((i) => i.name));

    if (indexNames.has("einvoicing_clients_kyc_user_id")) {
      await queryInterface.removeIndex(
        "einvoicing_clients",
        "einvoicing_clients_kyc_user_id",
      );
    }
    if (indexNames.has("einvoicing_clients_kyc_env")) {
      await queryInterface.removeIndex(
        "einvoicing_clients",
        "einvoicing_clients_kyc_env",
      );
    }
    if (indexNames.has("einvoicing_clients_business_env")) {
      await queryInterface.removeIndex(
        "einvoicing_clients",
        "einvoicing_clients_business_env",
      );
    }

    await queryInterface.addIndex("einvoicing_clients", ["business_id"], {
      name: "einvoicing_clients_business_id",
      unique: true,
    });

    const eiDesc = await queryInterface.describeTable("einvoicing_clients");
    if (eiDesc.kyc_user_id) {
      await queryInterface.removeColumn("einvoicing_clients", "kyc_user_id");
    }
    if (eiDesc.environment) {
      await queryInterface.removeColumn("einvoicing_clients", "environment");
    }

    await queryInterface.changeColumn("einvoicing_clients", "business_id", {
      type: Sequelize.STRING(50),
      allowNull: false,
    });

    // Shrink status enum only if no approved rows remain.
    await queryInterface.sequelize.query(`
      UPDATE kyc_users SET status = 'verified' WHERE status = 'approved'
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE kyc_users
      MODIFY COLUMN status ENUM('pending', 'verified', 'suspended')
      NOT NULL DEFAULT 'pending'
    `);
  },
};
