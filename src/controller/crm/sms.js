"use strict";

const db = require("../../models");
const smsApi = require("../../services/smsApi");
const { CUSTOMER_NAME_SQL } = require("./classification");

function facilityFrom(req) {
  return (
    req.query.facilityId ||
    req.body.facilityId ||
    req.headers["x-facility-id"] ||
    null
  );
}

function renderTemplate(body, vars = {}) {
  return String(body || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    return vars[key] != null ? String(vars[key]) : "";
  });
}

function sendSmsPromise(phone, message) {
  return new Promise((resolve, reject) => {
    smsApi.send(
      phone,
      message,
      (resp) => resolve(resp),
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
    );
  });
}

exports.listTemplates = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    if (!facilityId) {
      return res.status(400).json({ success: false, error: "facilityId required" });
    }
    const rows = await db.CrmSmsTemplate.findAll({
      where: { facility_id: facilityId },
      order: [["updated_at", "DESC"]],
    });
    return res.json({ success: true, results: rows });
  } catch (error) {
    console.error("crm.listTemplates:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.createTemplate = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    const { name, body, variables, is_active = true, created_by } = req.body;
    if (!facilityId || !name || !body) {
      return res
        .status(400)
        .json({ success: false, error: "facilityId, name, body required" });
    }
    const row = await db.CrmSmsTemplate.create({
      facility_id: facilityId,
      name,
      body,
      variables: variables || ["customer_name", "customer_no"],
      is_active: !!is_active,
      created_by: created_by || null,
    });
    return res.json({ success: true, results: row });
  } catch (error) {
    console.error("crm.createTemplate:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.updateTemplate = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    const { id } = req.params;
    const row = await db.CrmSmsTemplate.findOne({
      where: { id, facility_id: facilityId },
    });
    if (!row) {
      return res.status(404).json({ success: false, error: "Not found" });
    }
    const patch = {};
    for (const k of ["name", "body", "variables", "is_active"]) {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    }
    await row.update(patch);
    return res.json({ success: true, results: row });
  } catch (error) {
    console.error("crm.updateTemplate:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.deleteTemplate = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    const { id } = req.params;
    const n = await db.CrmSmsTemplate.destroy({
      where: { id, facility_id: facilityId },
    });
    return res.json({ success: true, deleted: n });
  } catch (error) {
    console.error("crm.deleteTemplate:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.listSmsLogs = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    if (!facilityId) {
      return res.status(400).json({ success: false, error: "facilityId required" });
    }
    const { limit = 100, status } = req.query;
    const where = { facility_id: facilityId };
    if (status) where.status = status;
    const rows = await db.CrmSmsLog.findAll({
      where,
      order: [["created_at", "DESC"]],
      limit: Math.min(200, parseInt(limit, 10) || 100),
    });
    return res.json({ success: true, results: rows });
  } catch (error) {
    console.error("crm.listSmsLogs:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/v1/crm/sms/send
 * body: {
 *   facilityId, message?, template_id?,
 *   recipients: [{ customer_no?, phone?, customer_name? }],
 *   customerNos?: string[],
 *   dry_run?: boolean,
 *   sent_by?
 * }
 */
exports.sendBulkSms = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    const {
      message,
      template_id,
      recipients = [],
      customerNos = [],
      dry_run = false,
      sent_by,
    } = req.body;

    if (!facilityId) {
      return res.status(400).json({ success: false, error: "facilityId required" });
    }

    let template = null;
    let templateBody = message;
    if (template_id) {
      template = await db.CrmSmsTemplate.findOne({
        where: { id: template_id, facility_id: facilityId },
      });
      if (!template) {
        return res
          .status(404)
          .json({ success: false, error: "Template not found" });
      }
      templateBody = template.body;
    }
    if (!templateBody || !String(templateBody).trim()) {
      return res
        .status(400)
        .json({ success: false, error: "message or template_id required" });
    }

    let dest = Array.isArray(recipients) ? [...recipients] : [];

    if (Array.isArray(customerNos) && customerNos.length) {
      const rows = await db.sequelize.query(
        `
          SELECT
            c.customerNo AS customer_no,
            ${CUSTOMER_NAME_SQL} AS customer_name,
            COALESCE(NULLIF(TRIM(c.mobile), ''), NULLIF(TRIM(c.phone), '')) AS phone
          FROM customers c
          WHERE c.facilityId = :facilityId
            AND c.customerNo IN (:customerNos)
        `,
        {
          replacements: { facilityId, customerNos },
          type: db.sequelize.QueryTypes.SELECT,
        },
      );
      dest = dest.concat(
        rows.map((r) => ({
          customer_no: r.customer_no,
          customer_name: r.customer_name,
          phone: r.phone,
        })),
      );
    }

    // de-dupe by phone
    const seen = new Set();
    dest = dest.filter((r) => {
      const phone = String(r.phone || "").trim();
      if (!phone) return false;
      if (seen.has(phone)) return false;
      seen.add(phone);
      return true;
    });

    if (!dest.length) {
      return res
        .status(400)
        .json({ success: false, error: "No valid recipients with phone numbers" });
    }

    if (dry_run) {
      return res.json({
        success: true,
        dry_run: true,
        count: dest.length,
        preview: dest.slice(0, 20).map((r) => ({
          customer_no: r.customer_no,
          phone: r.phone,
          message: renderTemplate(templateBody, {
            customer_name: r.customer_name || "",
            customer_no: r.customer_no || "",
          }),
        })),
      });
    }

    const results = [];
    for (const r of dest) {
      const msg = renderTemplate(templateBody, {
        customer_name: r.customer_name || "",
        customer_no: r.customer_no || "",
      });

      const log = await db.CrmSmsLog.create({
        facility_id: facilityId,
        customer_no: r.customer_no || null,
        phone: r.phone,
        message: msg,
        template_id: template_id || null,
        status: "queued",
        sent_by: sent_by || null,
      });

      try {
        const resp = await sendSmsPromise(r.phone, msg);
        await log.update({
          status: "sent",
          provider_response: JSON.stringify(resp).slice(0, 4000),
          sent_at: new Date(),
        });

        if (r.customer_no) {
          await db.CrmActivity.create({
            facility_id: facilityId,
            customer_no: r.customer_no,
            activity_type: "sms",
            subject: "Bulk SMS",
            body: msg,
            status: "completed",
            completed_at: new Date(),
            created_by: sent_by || null,
          });
          const [meta] = await db.CrmCustomerMeta.findOrCreate({
            where: {
              facility_id: facilityId,
              customer_no: r.customer_no,
            },
            defaults: {
              facility_id: facilityId,
              customer_no: r.customer_no,
              crm_status: "Active",
              last_interaction_at: new Date(),
            },
          });
          await meta.update({ last_interaction_at: new Date() });
        }

        results.push({ phone: r.phone, status: "sent", id: log.id });
      } catch (err) {
        await log.update({
          status: "failed",
          error_message: err.message || String(err),
        });
        results.push({
          phone: r.phone,
          status: "failed",
          error: err.message || String(err),
          id: log.id,
        });
      }
    }

    const sent = results.filter((r) => r.status === "sent").length;
    const failed = results.filter((r) => r.status === "failed").length;

    return res.json({
      success: true,
      sent,
      failed,
      results,
    });
  } catch (error) {
    console.error("crm.sendBulkSms:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
