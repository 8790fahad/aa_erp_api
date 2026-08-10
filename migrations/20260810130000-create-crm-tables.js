"use strict";

/** Phase 1 CRM tables — facility-scoped retention CRM. */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tables = await queryInterface.showAllTables();
    const existing = new Set(
      (tables || []).map((t) =>
        typeof t === "string" ? t.toLowerCase() : String(t).toLowerCase(),
      ),
    );

    if (!existing.has("crm_settings")) {
      await queryInterface.createTable("crm_settings", {
        id: {
          type: Sequelize.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        facility_id: {
          type: Sequelize.STRING(50),
          allowNull: false,
          unique: true,
        },
        dormant_days: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 90,
        },
        inactive_days: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 180,
        },
        lost_days: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 365,
        },
        vip_min_sales: {
          type: Sequelize.DECIMAL(20, 2),
          allowNull: false,
          defaultValue: 1000000,
        },
        regular_days: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 60,
        },
        active_days: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 30,
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
    }

    if (!existing.has("crm_customer_meta")) {
      await queryInterface.createTable("crm_customer_meta", {
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
          allowNull: false,
        },
        crm_status: {
          type: Sequelize.STRING(30),
          allowNull: false,
          defaultValue: "New",
        },
        segment_key: {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        assigned_user_id: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        last_interaction_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        next_followup_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        notes: {
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
          defaultValue: Sequelize.literal(
            "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
          ),
        },
      });
      await queryInterface.addIndex("crm_customer_meta", {
        fields: ["facility_id", "customer_no"],
        unique: true,
        name: "crm_customer_meta_facility_customer_uq",
      });
      await queryInterface.addIndex("crm_customer_meta", {
        fields: ["facility_id", "crm_status"],
        name: "crm_customer_meta_status_idx",
      });
      await queryInterface.addIndex("crm_customer_meta", {
        fields: ["facility_id", "segment_key"],
        name: "crm_customer_meta_segment_idx",
      });
    }

    if (!existing.has("crm_activities")) {
      await queryInterface.createTable("crm_activities", {
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
          allowNull: false,
        },
        activity_type: {
          type: Sequelize.ENUM(
            "call",
            "meeting",
            "note",
            "task",
            "sms",
            "email",
            "other",
          ),
          allowNull: false,
          defaultValue: "note",
        },
        subject: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        body: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        status: {
          type: Sequelize.STRING(30),
          allowNull: false,
          defaultValue: "completed",
        },
        due_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        completed_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        created_by: {
          type: Sequelize.STRING(50),
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
      await queryInterface.addIndex("crm_activities", {
        fields: ["facility_id", "customer_no"],
        name: "crm_activities_customer_idx",
      });
      await queryInterface.addIndex("crm_activities", {
        fields: ["facility_id", "created_at"],
        name: "crm_activities_created_idx",
      });
    }

    if (!existing.has("crm_followups")) {
      await queryInterface.createTable("crm_followups", {
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
          allowNull: false,
        },
        title: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
        notes: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        due_at: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        status: {
          type: Sequelize.ENUM("pending", "done", "cancelled", "overdue"),
          allowNull: false,
          defaultValue: "pending",
        },
        assigned_user_id: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        completed_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        created_by: {
          type: Sequelize.STRING(50),
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
      await queryInterface.addIndex("crm_followups", {
        fields: ["facility_id", "status", "due_at"],
        name: "crm_followups_status_due_idx",
      });
      await queryInterface.addIndex("crm_followups", {
        fields: ["facility_id", "customer_no"],
        name: "crm_followups_customer_idx",
      });
    }

    if (!existing.has("crm_segments")) {
      await queryInterface.createTable("crm_segments", {
        id: {
          type: Sequelize.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        facility_id: {
          type: Sequelize.STRING(50),
          allowNull: false,
        },
        segment_key: {
          type: Sequelize.STRING(100),
          allowNull: false,
        },
        name: {
          type: Sequelize.STRING(150),
          allowNull: false,
        },
        description: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        is_builtin: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        filters: {
          type: Sequelize.JSON,
          allowNull: true,
        },
        created_by: {
          type: Sequelize.STRING(50),
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
      await queryInterface.addIndex("crm_segments", {
        fields: ["facility_id", "segment_key"],
        unique: true,
        name: "crm_segments_facility_key_uq",
      });
    }

    if (!existing.has("crm_sms_templates")) {
      await queryInterface.createTable("crm_sms_templates", {
        id: {
          type: Sequelize.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        facility_id: {
          type: Sequelize.STRING(50),
          allowNull: false,
        },
        name: {
          type: Sequelize.STRING(150),
          allowNull: false,
        },
        body: {
          type: Sequelize.TEXT,
          allowNull: false,
        },
        variables: {
          type: Sequelize.JSON,
          allowNull: true,
        },
        is_active: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        created_by: {
          type: Sequelize.STRING(50),
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
      await queryInterface.addIndex("crm_sms_templates", {
        fields: ["facility_id", "is_active"],
        name: "crm_sms_templates_facility_active_idx",
      });
    }

    if (!existing.has("crm_sms_logs")) {
      await queryInterface.createTable("crm_sms_logs", {
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
        phone: {
          type: Sequelize.STRING(30),
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
      await queryInterface.addIndex("crm_sms_logs", {
        fields: ["facility_id", "created_at"],
        name: "crm_sms_logs_facility_created_idx",
      });
      await queryInterface.addIndex("crm_sms_logs", {
        fields: ["facility_id", "status"],
        name: "crm_sms_logs_status_idx",
      });
    }
  },

  down: async (queryInterface) => {
    for (const table of [
      "crm_sms_logs",
      "crm_sms_templates",
      "crm_segments",
      "crm_followups",
      "crm_activities",
      "crm_customer_meta",
      "crm_settings",
    ]) {
      try {
        await queryInterface.dropTable(table);
      } catch (_) {
        /* ignore */
      }
    }
  },
};
