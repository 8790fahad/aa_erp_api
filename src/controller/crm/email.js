"use strict";

const nodemailer = require("nodemailer");
const { MailtrapTransport } = require("mailtrap");
const db = require("../../models");
const { CUSTOMER_NAME_SQL } = require("./classification");
const { CRM_MAX_RECIPIENTS } = require("../../middleware/crmAuth");
const { mailFrom } = require("../../config/mailFrom");
const { getLiveMailTransport } = require("../../config/mailTransport");

function facilityFrom(req) {
  return (
    req.crmFacilityId ||
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

function getMailtrapTransport({ forLiveSend = false } = {}) {
  // Live Outreach must deliver to real inboxes. Mailtrap sandbox never does.
  if (forLiveSend) {
    return getLiveMailTransport();
  }

  if (process.env.MAILTRAP_USER && process.env.MAILTRAP_PASS) {
    return {
      transport: nodemailer.createTransport({
        host: "sandbox.smtp.mailtrap.io",
        port: 2525,
        secure: false,
        auth: {
          user: process.env.MAILTRAP_USER,
          pass: process.env.MAILTRAP_PASS,
        },
      }),
      mode: "sandbox",
    };
  }
  if (process.env.MAILTRAP_TOKEN) {
    return {
      transport: nodemailer.createTransport(
        MailtrapTransport({ token: process.env.MAILTRAP_TOKEN }),
      ),
      mode: "api",
    };
  }
  throw new Error(
    "Mailtrap is not configured. Set MAILTRAP_TOKEN or MAILTRAP_USER/MAILTRAP_PASS.",
  );
}

function fromAddress() {
  return mailFrom();
}

function parseJsonField(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function parseBool(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null || value === "") return false;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

/** Build nodemailer attachments from multer files and/or JSON base64 payloads. */
function buildAttachments(req) {
  const out = [];
  const files = Array.isArray(req.files) ? req.files : [];
  for (const f of files) {
    out.push({
      filename: f.originalname || f.filename || "attachment",
      content: f.buffer,
      contentType: f.mimetype || undefined,
    });
  }

  const raw = parseJsonField(req.body.attachments, []);
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || !item.content) continue;
      const buf = Buffer.from(String(item.content), "base64");
      out.push({
        filename: item.filename || item.name || "attachment",
        content: buf,
        contentType: item.contentType || item.type || undefined,
      });
    }
  }
  return out.slice(0, 5);
}

exports.listEmailLogs = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    if (!facilityId) {
      return res.status(400).json({ success: false, error: "facilityId required" });
    }
    const { limit = 100, status } = req.query;
    const where = { facility_id: facilityId };
    if (status) where.status = status;
    const rows = await db.CrmEmailLog.findAll({
      where,
      order: [["created_at", "DESC"]],
      limit: Math.min(200, parseInt(limit, 10) || 100),
    });
    return res.json({ success: true, results: rows });
  } catch (error) {
    console.error("crm.listEmailLogs:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/v1/crm/email/send
 * JSON or multipart/form-data (field "attachments", max 5 files).
 * body: {
 *   facilityId, message?, subject?, template_id?,
 *   recipients: [{ customer_no?, email?, customer_name? }],
 *   customerNos?: string[],
 *   dry_run?: boolean,
 *   sent_by?,
 *   attachments?: [{ filename, content (base64), contentType? }] // JSON only
 * }
 */
exports.sendBulkEmail = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    const message = req.body.message;
    const subject = req.body.subject;
    const template_id = req.body.template_id || req.body.templateId || null;
    const sent_by = req.body.sent_by || req.body.sentBy || null;
    const dry_run = parseBool(req.body.dry_run ?? req.body.dryRun);
    let recipients = parseJsonField(req.body.recipients, []);
    let customerNos = parseJsonField(req.body.customerNos, []);
    if (!Array.isArray(recipients)) recipients = [];
    if (!Array.isArray(customerNos)) customerNos = [];

    const mailAttachments = buildAttachments(req);
    const attachmentNames = mailAttachments.map((a) => a.filename);

    if (!facilityId) {
      return res.status(400).json({ success: false, error: "facilityId required" });
    }

    let template = null;
    let templateBody = message;
    let templateSubject = subject || "";
    if (template_id) {
      template = await db.CrmSmsTemplate.findOne({
        where: {
          id: template_id,
          facility_id: facilityId,
          channel: "email",
        },
      });
      if (!template) {
        return res
          .status(404)
          .json({ success: false, error: "Email template not found" });
      }
      templateBody = template.body;
      if (!templateSubject) templateSubject = template.subject || "";
    }
    if (!templateBody || !String(templateBody).trim()) {
      return res
        .status(400)
        .json({ success: false, error: "message or template_id required" });
    }
    if (!templateSubject || !String(templateSubject).trim()) {
      return res
        .status(400)
        .json({ success: false, error: "subject is required for email" });
    }

    let dest = Array.isArray(recipients) ? [...recipients] : [];

    if (Array.isArray(customerNos) && customerNos.length) {
      const rows = await db.sequelize.query(
        `
          SELECT
            c.customerNo AS customer_no,
            ${CUSTOMER_NAME_SQL} AS customer_name,
            NULLIF(TRIM(c.email), '') AS email
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
          email: r.email,
        })),
      );
    }

    const needLookup = [
      ...new Set(
        dest
          .filter((r) => r.customer_no && !String(r.email || "").trim())
          .map((r) => r.customer_no),
      ),
    ];
    if (needLookup.length) {
      const rows = await db.sequelize.query(
        `
          SELECT
            c.customerNo AS customer_no,
            ${CUSTOMER_NAME_SQL} AS customer_name,
            NULLIF(TRIM(c.email), '') AS email
          FROM customers c
          WHERE c.facilityId = :facilityId
            AND c.customerNo IN (:customerNos)
        `,
        {
          replacements: { facilityId, customerNos: needLookup },
          type: db.sequelize.QueryTypes.SELECT,
        },
      );
      const byNo = new Map(rows.map((r) => [String(r.customer_no), r]));
      dest = dest.map((r) => {
        if (String(r.email || "").trim()) return r;
        const hit = byNo.get(String(r.customer_no));
        if (!hit) return r;
        return {
          ...r,
          email: hit.email || r.email,
          customer_name: r.customer_name || hit.customer_name,
        };
      });
    }

    const seen = new Set();
    dest = dest.filter((r) => {
      const email = String(r.email || "")
        .trim()
        .toLowerCase();
      if (!email || !email.includes("@")) return false;
      if (seen.has(email)) return false;
      seen.add(email);
      r.email = email;
      return true;
    });

    if (!dest.length) {
      return res.status(400).json({
        success: false,
        error: "No valid recipients with email addresses",
      });
    }

    if (dest.length > CRM_MAX_RECIPIENTS) {
      return res.status(400).json({
        success: false,
        error: `Too many recipients (${dest.length}). Max ${CRM_MAX_RECIPIENTS} per send.`,
      });
    }

    if (dry_run) {
      return res.json({
        success: true,
        dry_run: true,
        count: dest.length,
        attachments: attachmentNames,
        preview: dest.slice(0, 20).map((r) => {
          const vars = {
            customer_name: r.customer_name || "",
            customer_no: r.customer_no || "",
          };
          return {
            customer_no: r.customer_no,
            email: r.email,
            subject: renderTemplate(templateSubject, vars),
            message: renderTemplate(templateBody, vars),
            attachments: attachmentNames,
          };
        }),
      });
    }

    let transport;
    let mailMode = "api";
    try {
      const mail = getMailtrapTransport({ forLiveSend: true });
      transport = mail.transport;
      mailMode = mail.mode;
    } catch (cfgErr) {
      return res.status(503).json({ success: false, error: cfgErr.message });
    }

    const results = [];
    for (const r of dest) {
      const vars = {
        customer_name: r.customer_name || "",
        customer_no: r.customer_no || "",
      };
      const msg = renderTemplate(templateBody, vars);
      const subj = renderTemplate(templateSubject, vars);

      const log = await db.CrmEmailLog.create({
        facility_id: facilityId,
        customer_no: r.customer_no || null,
        email: r.email,
        subject: subj,
        message: msg,
        template_id: template_id || null,
        status: "queued",
        sent_by: sent_by || null,
      });

      try {
        const resp = await transport.sendMail({
          from: fromAddress(),
          to: r.email,
          subject: subj,
          text: msg,
          html: `<div style="font-family:system-ui,sans-serif;line-height:1.5;white-space:pre-wrap;">${msg
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")}</div>`,
          attachments: mailAttachments,
        });

        await log.update({
          status: "sent",
          provider_response: JSON.stringify({
            mailtrap: resp,
            mode: mailMode,
            attachments: attachmentNames,
          }).slice(0, 4000),
          sent_at: new Date(),
        });

        if (r.customer_no) {
          await db.CrmActivity.create({
            facility_id: facilityId,
            customer_no: r.customer_no,
            activity_type: "email",
            subject: subj,
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

        results.push({ email: r.email, status: "sent", id: log.id });
      } catch (err) {
        await log.update({
          status: "failed",
          error_message: err.message || String(err),
        });
        results.push({
          email: r.email,
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
    console.error("crm.sendBulkEmail:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
