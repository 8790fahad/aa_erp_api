"use strict";

/** CRM email outreach: channel on templates + email send logs. */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tables = await queryInterface.showAllTables();
    const existing = new Set(
      (tables || []).map((t) =>
        typeof t === "string" ? t.toLowerCase() : String(t).toLowerCase(),
      ),
    );

    if (existing.has("crm_sms_templates")) {
      const desc = await queryInterface.describeTable("crm_sms_templates");
      if (!desc.channel) {
        await queryInterface.addColumn("crm_sms_templates", "channel", {
          type: Sequelize.ENUM("sms", "email"),
          allowNull: false,
          defaultValue: "sms",
          after: "name",
        });
      }
      if (!desc.subject) {
        await queryInterface.addColumn("crm_sms_templates", "subject", {
          type: Sequelize.STRING(255),
          allowNull: true,
          after: "channel",
        });
      }
    }

    if (!existing.has("crm_email_logs")) {
      await queryInterface.createTable("crm_email_logs", {
        id: {
          type: Sequelize.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        facility_id: {
          type: Sequelize.STRING(50),
          allowNull: false,
        },
        customer_no: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        email: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
        subject: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
        message: {
          type: Sequelize.TEXT,
          allowNull: false,
        },
        template_id: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        status: {
          type: Sequelize.ENUM("queued", "sent", "failed"),
          allowNull: false,
          defaultValue: "queued",
        },
        provider_response: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        error_message: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        sent_by: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        sent_at: {
          type: Sequelize.DATE,
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
          defaultValue: Sequelize.literal(
            "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
          ),
        },
      });
      await queryInterface.addIndex("crm_email_logs", ["facility_id"], {
        name: "crm_email_logs_facility_idx",
      });
      await queryInterface.addIndex("crm_email_logs", ["status"], {
        name: "crm_email_logs_status_idx",
      });
    }
  },

  down: async (queryInterface) => {
    const tables = await queryInterface.showAllTables();
    const existing = new Set(
      (tables || []).map((t) =>
        typeof t === "string" ? t.toLowerCase() : String(t).toLowerCase(),
      ),
    );
    if (existing.has("crm_email_logs")) {
      await queryInterface.dropTable("crm_email_logs");
    }
    if (existing.has("crm_sms_templates")) {
      const desc = await queryInterface.describeTable("crm_sms_templates");
      if (desc.subject) {
        await queryInterface.removeColumn("crm_sms_templates", "subject");
      }
      if (desc.channel) {
        await queryInterface.removeColumn("crm_sms_templates", "channel");
      }
    }
  },
};
