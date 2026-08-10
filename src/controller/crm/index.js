"use strict";

const db = require("../../models");
const {
  CUSTOMER_NAME_SQL,
  SALES_METRICS_SUBQUERY,
  OUTSTANDING_SUBQUERY,
  getOrCreateSettings,
  ensureBuiltinSegments,
  classifyFacility,
} = require("./classification");

function facilityFrom(req) {
  return (
    req.query.facilityId ||
    req.body.facilityId ||
    req.headers["x-facility-id"] ||
    null
  );
}

exports.getDashboard = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    if (!facilityId) {
      return res.status(400).json({ success: false, error: "facilityId required" });
    }

    await ensureBuiltinSegments(facilityId);

    const [statusRows, followupRows, activityRows, salesRows, outstandingRows] =
      await Promise.all([
        db.sequelize.query(
          `
            SELECT COALESCE(meta.crm_status, 'New') AS crm_status, COUNT(*) AS cnt
            FROM customers c
            LEFT JOIN crm_customer_meta meta
              ON meta.facility_id = c.facilityId AND meta.customer_no = c.customerNo
            WHERE c.facilityId = :facilityId
            GROUP BY COALESCE(meta.crm_status, 'New')
          `,
          {
            replacements: { facilityId },
            type: db.sequelize.QueryTypes.SELECT,
          },
        ),
        db.sequelize.query(
          `
            SELECT
              SUM(CASE WHEN status = 'pending' AND due_at >= NOW() THEN 1 ELSE 0 END) AS upcoming,
              SUM(CASE WHEN status = 'pending' AND due_at < NOW() THEN 1 ELSE 0 END) AS overdue,
              SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
            FROM crm_followups
            WHERE facility_id = :facilityId
          `,
          {
            replacements: { facilityId },
            type: db.sequelize.QueryTypes.SELECT,
          },
        ),
        db.sequelize.query(
          `
            SELECT COUNT(*) AS cnt
            FROM crm_activities
            WHERE facility_id = :facilityId
              AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
          `,
          {
            replacements: { facilityId },
            type: db.sequelize.QueryTypes.SELECT,
          },
        ),
        db.sequelize.query(
          `
            SELECT
              COUNT(DISTINCT ref_number) AS buyers,
              COALESCE(SUM(amount), 0) AS total_sales,
              COUNT(*) AS invoice_count
            FROM invoices
            WHERE facility_id = :facilityId AND type = 'sales'
          `,
          {
            replacements: { facilityId },
            type: db.sequelize.QueryTypes.SELECT,
          },
        ),
        db.sequelize.query(
          `
            SELECT COALESCE(SUM(outstanding), 0) AS outstanding, COALESCE(SUM(overdue), 0) AS overdue
            FROM (${OUTSTANDING_SUBQUERY}) o
          `,
          {
            replacements: { facilityId },
            type: db.sequelize.QueryTypes.SELECT,
          },
        ),
      ]);

    const byStatus = {};
    let totalCustomers = 0;
    for (const r of statusRows) {
      byStatus[r.crm_status] = Number(r.cnt || 0);
      totalCustomers += Number(r.cnt || 0);
    }

    const followups = followupRows[0] || {};
    const sales = salesRows[0] || {};
    const outstanding = outstandingRows[0] || {};

    return res.json({
      success: true,
      results: {
        totalCustomers,
        byStatus,
        followups: {
          upcoming: Number(followups.upcoming || 0),
          overdue: Number(followups.overdue || 0),
          done: Number(followups.done || 0),
        },
        activitiesLast7Days: Number(activityRows[0]?.cnt || 0),
        sales: {
          buyers: Number(sales.buyers || 0),
          totalSales: Number(sales.total_sales || 0),
          invoiceCount: Number(sales.invoice_count || 0),
        },
        outstanding: Number(outstanding.outstanding || 0),
        overdue: Number(outstanding.overdue || 0),
      },
    });
  } catch (error) {
    console.error("crm.getDashboard:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.listCustomers = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    if (!facilityId) {
      return res.status(400).json({ success: false, error: "facilityId required" });
    }

    const {
      search = "",
      crm_status,
      segment_key,
      assigned_user_id,
      has_outstanding,
      page = 1,
      limit = 50,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const where = ["c.facilityId = :facilityId"];
    const replacements = { facilityId, limit: limitNum, offset };

    if (search && String(search).trim()) {
      where.push(
        `(c.customerNo LIKE :search OR c.fullname LIKE :search OR c.company_name LIKE :search OR c.phone LIKE :search OR c.mobile LIKE :search OR c.email LIKE :search)`,
      );
      replacements.search = `%${String(search).trim()}%`;
    }
    if (crm_status) {
      where.push(`COALESCE(meta.crm_status, 'New') = :crm_status`);
      replacements.crm_status = crm_status;
    }
    if (segment_key) {
      where.push(`meta.segment_key = :segment_key`);
      replacements.segment_key = segment_key;
    }
    if (assigned_user_id) {
      where.push(`meta.assigned_user_id = :assigned_user_id`);
      replacements.assigned_user_id = assigned_user_id;
    }
    if (has_outstanding === "1" || has_outstanding === "true") {
      where.push(`COALESCE(o.outstanding, 0) > 0.001`);
    }

    const baseFrom = `
      FROM customers c
      LEFT JOIN crm_customer_meta meta
        ON meta.facility_id = c.facilityId AND meta.customer_no = c.customerNo
      LEFT JOIN (${SALES_METRICS_SUBQUERY}) m
        ON m.customer_no = c.customerNo AND m.facility_id = c.facilityId
      LEFT JOIN (${OUTSTANDING_SUBQUERY}) o
        ON o.customer_no = c.customerNo AND o.facility_id = c.facilityId
      WHERE ${where.join(" AND ")}
    `;

    const [countRow] = await db.sequelize.query(
      `SELECT COUNT(*) AS total ${baseFrom}`,
      { replacements, type: db.sequelize.QueryTypes.SELECT },
    );

    const rows = await db.sequelize.query(
      `
        SELECT
          c.customerNo AS customer_no,
          ${CUSTOMER_NAME_SQL} AS customer_name,
          c.phone,
          c.mobile,
          c.email,
          c.status AS customer_status,
          COALESCE(meta.crm_status, 'New') AS crm_status,
          meta.segment_key,
          meta.assigned_user_id,
          meta.last_interaction_at,
          meta.next_followup_at,
          COALESCE(m.invoice_count, 0) AS invoice_count,
          COALESCE(m.total_sales, 0) AS total_sales,
          m.first_purchase,
          m.last_purchase,
          COALESCE(o.outstanding, 0) AS outstanding,
          COALESCE(o.overdue, 0) AS overdue
        ${baseFrom}
        ORDER BY COALESCE(m.last_purchase, c.createdAt) DESC
        LIMIT :limit OFFSET :offset
      `,
      { replacements, type: db.sequelize.QueryTypes.SELECT },
    );

    return res.json({
      success: true,
      results: rows,
      total: Number(countRow?.total || 0),
      page: pageNum,
      limit: limitNum,
    });
  } catch (error) {
    console.error("crm.listCustomers:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.getCustomer360 = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    const customerNo = req.params.customerNo;
    if (!facilityId || !customerNo) {
      return res
        .status(400)
        .json({ success: false, error: "facilityId and customerNo required" });
    }

    const [customerRows] = await db.sequelize.query(
      `
        SELECT
          c.*,
          ${CUSTOMER_NAME_SQL} AS customer_name,
          COALESCE(meta.crm_status, 'New') AS crm_status,
          meta.segment_key,
          meta.assigned_user_id,
          meta.last_interaction_at,
          meta.next_followup_at,
          meta.notes AS crm_notes,
          COALESCE(m.invoice_count, 0) AS invoice_count,
          COALESCE(m.total_sales, 0) AS total_sales,
          m.first_purchase,
          m.last_purchase,
          COALESCE(o.outstanding, 0) AS outstanding,
          COALESCE(o.overdue, 0) AS overdue
        FROM customers c
        LEFT JOIN crm_customer_meta meta
          ON meta.facility_id = c.facilityId AND meta.customer_no = c.customerNo
        LEFT JOIN (${SALES_METRICS_SUBQUERY}) m
          ON m.customer_no = c.customerNo AND m.facility_id = c.facilityId
        LEFT JOIN (${OUTSTANDING_SUBQUERY}) o
          ON o.customer_no = c.customerNo AND o.facility_id = c.facilityId
        WHERE c.facilityId = :facilityId AND c.customerNo = :customerNo
        LIMIT 1
      `,
      {
        replacements: { facilityId, customerNo },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );

    if (!customerRows) {
      return res.status(404).json({ success: false, error: "Customer not found" });
    }

    const [recentInvoices, contacts] = await Promise.all([
      db.sequelize.query(
        `
          SELECT invoice_ref, transaction_date, due_date, amount, description
          FROM invoices
          WHERE facility_id = :facilityId AND type = 'sales' AND ref_number = :customerNo
          ORDER BY transaction_date DESC
          LIMIT 20
        `,
        {
          replacements: { facilityId, customerNo },
          type: db.sequelize.QueryTypes.SELECT,
        },
      ),
      db.CustomerContact
        ? db.CustomerContact.findAll({
            where: { facility_id: facilityId, customer_no: customerNo },
            limit: 20,
          })
        : Promise.resolve([]),
    ]);

    return res.json({
      success: true,
      results: {
        customer: customerRows,
        recentInvoices,
        contacts,
      },
    });
  } catch (error) {
    console.error("crm.getCustomer360:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.getCustomerTimeline = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    const customerNo = req.params.customerNo;
    if (!facilityId || !customerNo) {
      return res
        .status(400)
        .json({ success: false, error: "facilityId and customerNo required" });
    }

    const [activities, followups, invoices] = await Promise.all([
      db.CrmActivity.findAll({
        where: { facility_id: facilityId, customer_no: customerNo },
        order: [["created_at", "DESC"]],
        limit: 50,
      }),
      db.CrmFollowup.findAll({
        where: { facility_id: facilityId, customer_no: customerNo },
        order: [["due_at", "DESC"]],
        limit: 50,
      }),
      db.sequelize.query(
        `
          SELECT invoice_ref, transaction_date, amount, description
          FROM invoices
          WHERE facility_id = :facilityId AND type = 'sales' AND ref_number = :customerNo
          ORDER BY transaction_date DESC
          LIMIT 20
        `,
        {
          replacements: { facilityId, customerNo },
          type: db.sequelize.QueryTypes.SELECT,
        },
      ),
    ]);

    const events = [
      ...activities.map((a) => ({
        type: "activity",
        subtype: a.activity_type,
        title: a.subject || a.activity_type,
        body: a.body,
        at: a.created_at,
        id: a.id,
        status: a.status,
      })),
      ...followups.map((f) => ({
        type: "followup",
        subtype: f.status,
        title: f.title,
        body: f.notes,
        at: f.due_at,
        id: f.id,
        status: f.status,
      })),
      ...invoices.map((inv) => ({
        type: "invoice",
        subtype: "sales",
        title: inv.invoice_ref,
        body: inv.description,
        at: inv.transaction_date,
        id: inv.invoice_ref,
        amount: inv.amount,
      })),
    ].sort((a, b) => new Date(b.at) - new Date(a.at));

    return res.json({ success: true, results: events });
  } catch (error) {
    console.error("crm.getCustomerTimeline:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.updateCustomerMeta = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    const customerNo = req.params.customerNo;
    if (!facilityId || !customerNo) {
      return res
        .status(400)
        .json({ success: false, error: "facilityId and customerNo required" });
    }

    const {
      crm_status,
      segment_key,
      assigned_user_id,
      notes,
      next_followup_at,
      last_interaction_at,
    } = req.body;

    const [meta] = await db.CrmCustomerMeta.findOrCreate({
      where: { facility_id: facilityId, customer_no: customerNo },
      defaults: {
        facility_id: facilityId,
        customer_no: customerNo,
        crm_status: crm_status || "New",
      },
    });

    const patch = {};
    if (crm_status !== undefined) patch.crm_status = crm_status;
    if (segment_key !== undefined) patch.segment_key = segment_key;
    if (assigned_user_id !== undefined) patch.assigned_user_id = assigned_user_id;
    if (notes !== undefined) patch.notes = notes;
    if (next_followup_at !== undefined) patch.next_followup_at = next_followup_at;
    if (last_interaction_at !== undefined) {
      patch.last_interaction_at = last_interaction_at;
    }

    await meta.update(patch);
    return res.json({ success: true, results: meta });
  } catch (error) {
    console.error("crm.updateCustomerMeta:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.bulkUpdateMeta = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    const { customerNos = [], segment_key, assigned_user_id, crm_status } =
      req.body;
    if (!facilityId || !Array.isArray(customerNos) || !customerNos.length) {
      return res.status(400).json({
        success: false,
        error: "facilityId and customerNos[] required",
      });
    }

    let updated = 0;
    for (const customerNo of customerNos) {
      const [meta] = await db.CrmCustomerMeta.findOrCreate({
        where: { facility_id: facilityId, customer_no: customerNo },
        defaults: {
          facility_id: facilityId,
          customer_no: customerNo,
          crm_status: crm_status || "New",
          segment_key: segment_key || null,
          assigned_user_id: assigned_user_id || null,
        },
      });
      const patch = {};
      if (segment_key !== undefined) patch.segment_key = segment_key;
      if (assigned_user_id !== undefined) patch.assigned_user_id = assigned_user_id;
      if (crm_status !== undefined) patch.crm_status = crm_status;
      if (Object.keys(patch).length) {
        await meta.update(patch);
      }
      updated += 1;
    }

    return res.json({ success: true, updated });
  } catch (error) {
    console.error("crm.bulkUpdateMeta:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ——— Activities ———
exports.listActivities = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    if (!facilityId) {
      return res.status(400).json({ success: false, error: "facilityId required" });
    }
    const { customer_no, activity_type, limit = 100 } = req.query;
    const where = { facility_id: facilityId };
    if (customer_no) where.customer_no = customer_no;
    if (activity_type) where.activity_type = activity_type;

    const rows = await db.CrmActivity.findAll({
      where,
      order: [["created_at", "DESC"]],
      limit: Math.min(200, parseInt(limit, 10) || 100),
    });
    return res.json({ success: true, results: rows });
  } catch (error) {
    console.error("crm.listActivities:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.createActivity = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    const {
      customer_no,
      activity_type = "note",
      subject,
      body,
      status = "completed",
      due_at,
      created_by,
    } = req.body;
    if (!facilityId || !customer_no) {
      return res
        .status(400)
        .json({ success: false, error: "facilityId and customer_no required" });
    }

    const row = await db.CrmActivity.create({
      facility_id: facilityId,
      customer_no,
      activity_type,
      subject,
      body,
      status,
      due_at: due_at || null,
      completed_at: status === "completed" ? new Date() : null,
      created_by: created_by || null,
    });

    await db.CrmCustomerMeta.findOrCreate({
      where: { facility_id: facilityId, customer_no },
      defaults: {
        facility_id: facilityId,
        customer_no,
        crm_status: "Active",
        last_interaction_at: new Date(),
      },
    }).then(async ([meta]) => {
      await meta.update({ last_interaction_at: new Date() });
    });

    return res.json({ success: true, results: row });
  } catch (error) {
    console.error("crm.createActivity:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.updateActivity = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    const { id } = req.params;
    const row = await db.CrmActivity.findOne({
      where: { id, facility_id: facilityId },
    });
    if (!row) {
      return res.status(404).json({ success: false, error: "Not found" });
    }
    const allowed = [
      "activity_type",
      "subject",
      "body",
      "status",
      "due_at",
      "completed_at",
    ];
    const patch = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    }
    if (patch.status === "completed" && !patch.completed_at) {
      patch.completed_at = new Date();
    }
    await row.update(patch);
    return res.json({ success: true, results: row });
  } catch (error) {
    console.error("crm.updateActivity:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.deleteActivity = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    const { id } = req.params;
    const n = await db.CrmActivity.destroy({
      where: { id, facility_id: facilityId },
    });
    return res.json({ success: true, deleted: n });
  } catch (error) {
    console.error("crm.deleteActivity:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ——— Follow-ups ———
exports.listFollowups = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    if (!facilityId) {
      return res.status(400).json({ success: false, error: "facilityId required" });
    }
    const { customer_no, status, limit = 100 } = req.query;
    const where = { facility_id: facilityId };
    if (customer_no) where.customer_no = customer_no;
    if (status) where.status = status;

    // Mark overdue
    await db.sequelize.query(
      `
        UPDATE crm_followups
        SET status = 'overdue'
        WHERE facility_id = :facilityId
          AND status = 'pending'
          AND due_at < NOW()
      `,
      { replacements: { facilityId } },
    );

    const rows = await db.CrmFollowup.findAll({
      where,
      order: [["due_at", "ASC"]],
      limit: Math.min(200, parseInt(limit, 10) || 100),
    });
    return res.json({ success: true, results: rows });
  } catch (error) {
    console.error("crm.listFollowups:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.createFollowup = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    const {
      customer_no,
      title,
      notes,
      due_at,
      assigned_user_id,
      created_by,
    } = req.body;
    if (!facilityId || !customer_no || !title || !due_at) {
      return res.status(400).json({
        success: false,
        error: "facilityId, customer_no, title, due_at required",
      });
    }

    const row = await db.CrmFollowup.create({
      facility_id: facilityId,
      customer_no,
      title,
      notes: notes || null,
      due_at,
      status: "pending",
      assigned_user_id: assigned_user_id || null,
      created_by: created_by || null,
    });

    const [meta] = await db.CrmCustomerMeta.findOrCreate({
      where: { facility_id: facilityId, customer_no },
      defaults: {
        facility_id: facilityId,
        customer_no,
        crm_status: "Active",
        next_followup_at: due_at,
      },
    });
    await meta.update({ next_followup_at: due_at });

    return res.json({ success: true, results: row });
  } catch (error) {
    console.error("crm.createFollowup:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.updateFollowup = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    const { id } = req.params;
    const row = await db.CrmFollowup.findOne({
      where: { id, facility_id: facilityId },
    });
    if (!row) {
      return res.status(404).json({ success: false, error: "Not found" });
    }
    const allowed = [
      "title",
      "notes",
      "due_at",
      "status",
      "assigned_user_id",
      "completed_at",
    ];
    const patch = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    }
    if (patch.status === "done" && !patch.completed_at) {
      patch.completed_at = new Date();
    }
    await row.update(patch);
    return res.json({ success: true, results: row });
  } catch (error) {
    console.error("crm.updateFollowup:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.deleteFollowup = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    const { id } = req.params;
    const n = await db.CrmFollowup.destroy({
      where: { id, facility_id: facilityId },
    });
    return res.json({ success: true, deleted: n });
  } catch (error) {
    console.error("crm.deleteFollowup:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ——— Segments ———
exports.listSegments = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    if (!facilityId) {
      return res.status(400).json({ success: false, error: "facilityId required" });
    }
    await ensureBuiltinSegments(facilityId);
    const rows = await db.CrmSegment.findAll({
      where: { facility_id: facilityId },
      order: [["is_builtin", "DESC"], ["name", "ASC"]],
    });
    return res.json({ success: true, results: rows });
  } catch (error) {
    console.error("crm.listSegments:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.createSegment = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    const { name, description, filters, created_by, segment_key } = req.body;
    if (!facilityId || !name) {
      return res
        .status(400)
        .json({ success: false, error: "facilityId and name required" });
    }
    const key =
      segment_key ||
      String(name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 80) ||
      `seg_${Date.now()}`;

    const row = await db.CrmSegment.create({
      facility_id: facilityId,
      segment_key: key,
      name,
      description: description || null,
      filters: filters || null,
      is_builtin: false,
      created_by: created_by || null,
    });
    return res.json({ success: true, results: row });
  } catch (error) {
    console.error("crm.createSegment:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.updateSegment = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    const { id } = req.params;
    const row = await db.CrmSegment.findOne({
      where: { id, facility_id: facilityId },
    });
    if (!row) {
      return res.status(404).json({ success: false, error: "Not found" });
    }
    if (row.is_builtin) {
      return res
        .status(400)
        .json({ success: false, error: "Built-in segments cannot be edited" });
    }
    const patch = {};
    for (const k of ["name", "description", "filters"]) {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    }
    await row.update(patch);
    return res.json({ success: true, results: row });
  } catch (error) {
    console.error("crm.updateSegment:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.deleteSegment = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    const { id } = req.params;
    const row = await db.CrmSegment.findOne({
      where: { id, facility_id: facilityId },
    });
    if (!row) {
      return res.status(404).json({ success: false, error: "Not found" });
    }
    if (row.is_builtin) {
      return res
        .status(400)
        .json({ success: false, error: "Built-in segments cannot be deleted" });
    }
    await row.destroy();
    return res.json({ success: true, deleted: 1 });
  } catch (error) {
    console.error("crm.deleteSegment:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ——— Settings + classify ———
exports.getSettings = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    if (!facilityId) {
      return res.status(400).json({ success: false, error: "facilityId required" });
    }
    const settings = await getOrCreateSettings(facilityId);
    return res.json({ success: true, results: settings });
  } catch (error) {
    console.error("crm.getSettings:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    if (!facilityId) {
      return res.status(400).json({ success: false, error: "facilityId required" });
    }
    const settings = await getOrCreateSettings(facilityId);
    const allowed = [
      "dormant_days",
      "inactive_days",
      "lost_days",
      "vip_min_sales",
      "regular_days",
      "active_days",
    ];
    const patch = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    }
    await settings.update(patch);
    return res.json({ success: true, results: settings });
  } catch (error) {
    console.error("crm.updateSettings:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.classify = async (req, res) => {
  try {
    const facilityId = facilityFrom(req);
    if (!facilityId) {
      return res.status(400).json({ success: false, error: "facilityId required" });
    }
    const result = await classifyFacility(facilityId);
    return res.json({ success: true, results: result });
  } catch (error) {
    console.error("crm.classify:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
