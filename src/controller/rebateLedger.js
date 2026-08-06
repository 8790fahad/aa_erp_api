"use strict";

const db = require("../models");
const { Op } = require("sequelize");
const creditNoteController = require("./creditNoteController");

function mapRule(row) {
  if (!row) return null;
  const r = row.toJSON ? row.toJSON() : row;
  return {
    id: r.id,
    name: r.name,
    product: r.product_name,
    productSku: r.product_sku || "",
    period: r.period_label,
    fromDate: r.from_date,
    toDate: r.to_date,
    minQty: parseFloat(r.min_qty) || 0,
    rebatePercent: parseFloat(r.rebate_percent) || 0,
    facilityId: r.facility_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function statusKey(customerName, ruleId) {
  return `${customerName}|${ruleId}`;
}

/** GET /api/v1/rebate-ledger/rules?facilityId= */
exports.listRules = async (req, res) => {
  try {
    const facilityId = req.query.facilityId || req.body?.facilityId;
    if (!facilityId) {
      return res
        .status(400)
        .json({ success: false, message: "facilityId is required" });
    }
    const rows = await db.RebateRule.findAll({
      where: { facility_id: String(facilityId) },
      order: [
        ["from_date", "DESC"],
        ["id", "DESC"],
      ],
    });
    return res.json({
      success: true,
      results: rows.map(mapRule),
    });
  } catch (err) {
    console.error("listRules", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to load rebate rules",
    });
  }
};

/** POST /api/v1/rebate-ledger/rules */
exports.createRule = async (req, res) => {
  try {
    const {
      facilityId,
      name,
      product,
      productSku,
      period,
      fromDate,
      toDate,
      minQty,
      rebatePercent,
      userId,
    } = req.body || {};

    if (!facilityId || !name || !period || !fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        message: "facilityId, name, period, fromDate, and toDate are required",
      });
    }
    const qty = parseFloat(minQty);
    const pct = parseFloat(rebatePercent);
    if (!Number.isFinite(qty) || qty < 0 || !Number.isFinite(pct) || pct < 0) {
      return res.status(400).json({
        success: false,
        message: "minQty and rebatePercent must be valid numbers",
      });
    }

    const row = await db.RebateRule.create({
      facility_id: String(facilityId),
      name: String(name).trim(),
      product_name: String(product || "All products").trim() || "All products",
      product_sku: productSku ? String(productSku).trim() : null,
      period_label: String(period).trim(),
      from_date: fromDate,
      to_date: toDate,
      min_qty: qty,
      rebate_percent: pct,
      created_by: userId ? String(userId) : null,
      updated_by: userId ? String(userId) : null,
    });

    return res.json({ success: true, result: mapRule(row) });
  } catch (err) {
    console.error("createRule", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to create rebate rule",
    });
  }
};

/** DELETE /api/v1/rebate-ledger/rules/:id?facilityId= */
exports.deleteRule = async (req, res) => {
  try {
    const { id } = req.params;
    const facilityId = req.query.facilityId || req.body?.facilityId;
    if (!facilityId) {
      return res
        .status(400)
        .json({ success: false, message: "facilityId is required" });
    }
    const deleted = await db.RebateRule.destroy({
      where: { id: Number(id), facility_id: String(facilityId) },
    });
    if (!deleted) {
      return res
        .status(404)
        .json({ success: false, message: "Rule not found" });
    }
    await db.RebateStatus.destroy({
      where: { rule_id: Number(id), facility_id: String(facilityId) },
    });
    return res.json({ success: true, message: "Rule deleted" });
  } catch (err) {
    console.error("deleteRule", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to delete rebate rule",
    });
  }
};

/** GET /api/v1/rebate-ledger/statuses?facilityId= */
exports.listStatuses = async (req, res) => {
  try {
    const facilityId = req.query.facilityId || req.body?.facilityId;
    if (!facilityId) {
      return res
        .status(400)
        .json({ success: false, message: "facilityId is required" });
    }
    const rows = await db.RebateStatus.findAll({
      where: { facility_id: String(facilityId) },
    });
    const map = {};
    for (const row of rows) {
      const r = row.toJSON ? row.toJSON() : row;
      map[statusKey(r.customer_name, r.rule_id)] = {
        status: r.status,
        payoutType: r.payout_type,
        customerNo: r.customer_no || "",
        creditNoteNumber: r.credit_note_number || "",
        ruleId: r.rule_id,
        customer: r.customer_name,
      };
    }
    return res.json({ success: true, results: map });
  } catch (err) {
    console.error("listStatuses", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to load rebate statuses",
    });
  }
};

/** PUT /api/v1/rebate-ledger/statuses */
exports.upsertStatus = async (req, res) => {
  try {
    const {
      facilityId,
      ruleId,
      customer,
      customerNo,
      status,
      payoutType,
      userId,
    } = req.body || {};

    if (!facilityId || !ruleId || !customer) {
      return res.status(400).json({
        success: false,
        message: "facilityId, ruleId, and customer are required",
      });
    }

    const allowedStatus = ["pending", "approved", "paid"];
    const allowedPayout = ["credit", "cash"];
    const nextStatus = allowedStatus.includes(status) ? status : "pending";
    const nextPayout = allowedPayout.includes(payoutType)
      ? payoutType
      : "credit";

    const rule = await db.RebateRule.findOne({
      where: { id: Number(ruleId), facility_id: String(facilityId) },
    });
    if (!rule) {
      return res
        .status(404)
        .json({ success: false, message: "Rule not found" });
    }

    const customerName = String(customer).trim();
    const [row] = await db.RebateStatus.findOrCreate({
      where: {
        facility_id: String(facilityId),
        rule_id: Number(ruleId),
        customer_name: customerName,
      },
      defaults: {
        customer_no: customerNo ? String(customerNo) : null,
        status: nextStatus,
        payout_type: nextPayout,
        updated_by: userId ? String(userId) : null,
      },
    });

    await row.update({
      status: nextStatus,
      payout_type: nextPayout,
      customer_no: customerNo ? String(customerNo) : row.customer_no,
      updated_by: userId ? String(userId) : row.updated_by,
    });

    return res.json({
      success: true,
      result: {
        key: statusKey(customerName, ruleId),
        status: row.status,
        payoutType: row.payout_type,
        creditNoteNumber: row.credit_note_number || "",
      },
    });
  } catch (err) {
    console.error("upsertStatus", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to update rebate status",
    });
  }
};

function runCreateCreditNote(body) {
  return new Promise((resolve, reject) => {
    const fakeReq = { body };
    const fakeRes = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ statusCode: this.statusCode || 200, payload });
      },
    };
    Promise.resolve(creditNoteController.createCreditNote(fakeReq, fakeRes)).catch(
      reject,
    );
  });
}

/** POST /api/v1/rebate-ledger/issue-credit-note */
exports.issueCreditNote = async (req, res) => {
  try {
    const {
      facilityId,
      userId,
      ruleId,
      customer,
      customerNo,
      rebateAmount,
    } = req.body || {};

    if (!facilityId || !userId || !ruleId || !customer) {
      return res.status(400).json({
        success: false,
        message: "facilityId, userId, ruleId, and customer are required",
      });
    }

    const amount = parseFloat(rebateAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "rebateAmount must be a positive number",
      });
    }

    if (!customerNo) {
      return res.status(400).json({
        success: false,
        message:
          "customerNo is required to issue a credit note. Ensure billing lines include the customer number.",
      });
    }

    const rule = await db.RebateRule.findOne({
      where: { id: Number(ruleId), facility_id: String(facilityId) },
    });
    if (!rule) {
      return res
        .status(404)
        .json({ success: false, message: "Rule not found" });
    }

    const customerName = String(customer).trim();
    let statusRow = await db.RebateStatus.findOne({
      where: {
        facility_id: String(facilityId),
        rule_id: Number(ruleId),
        customer_name: customerName,
      },
    });

    if (statusRow?.credit_note_number) {
      return res.status(409).json({
        success: false,
        message: `Credit note already issued (${statusRow.credit_note_number})`,
        data: {
          creditNoteNumber: statusRow.credit_note_number,
        },
      });
    }

    let discountAccount = await db.AccountCategory.findOne({
      where: {
        facility_id: String(facilityId),
        description: { [Op.like]: "%Discount Allowed%" },
        level: 2,
      },
    });
    if (!discountAccount) {
      discountAccount = await db.AccountCategory.findOne({
        where: {
          facility_id: String(facilityId),
          description: { [Op.like]: "%Sales Returns%" },
          level: 2,
        },
      });
    }
    if (!discountAccount) {
      discountAccount = await db.AccountCategory.findOne({
        where: {
          facility_id: String(facilityId),
          description: { [Op.like]: "%Income Adjustment%" },
          level: 2,
        },
      });
    }

    const productLabel = rule.product_name || "All products";
    const lineDescription = `Volume rebate — ${rule.name} (${rule.period_label}) · ${productLabel}`;
    const today = new Date().toISOString().slice(0, 10);

    const cnResult = await runCreateCreditNote({
      facilityId: String(facilityId),
      userId: String(userId),
      type: "customer",
      customerId: String(customerNo),
      date: today,
      reference: `REBATE-${rule.id}`,
      reason: `Post-sale volume rebate: ${rule.name} (${rule.period_label})`,
      reasonCategory: "DISCOUNT",
      paymentAdjustmentMethod: "offset_outstanding",
      discount: {
        type: "percent",
        scope: "rebate",
        value: parseFloat(rule.rebate_percent) || 0,
      },
      lineItems: [
        {
          account: discountAccount
            ? {
                code: discountAccount.code,
                description: discountAccount.description,
                head: discountAccount.code,
              }
            : { code: "", description: "Discount Allowed", head: "" },
          description: lineDescription,
          quantity: 1,
          rate: amount,
          amount,
          lineKind: "service",
        },
      ],
      subtotal: amount,
      vatAmount: 0,
      totalAmount: amount,
      vatRate: 0,
    });

    if (!cnResult.payload?.success) {
      return res.status(cnResult.statusCode || 400).json({
        success: false,
        message:
          cnResult.payload?.message || "Failed to create rebate credit note",
        error: cnResult.payload?.error,
      });
    }

    const creditNoteNumber = cnResult.payload.data.creditNoteNumber;
    const entityName =
      cnResult.payload.data.entityName || customerName;

    if (!statusRow) {
      statusRow = await db.RebateStatus.create({
        facility_id: String(facilityId),
        rule_id: Number(ruleId),
        customer_name: customerName,
        customer_no: String(customerNo),
        status: "paid",
        payout_type: "credit",
        credit_note_number: creditNoteNumber,
        updated_by: String(userId),
      });
    } else {
      await statusRow.update({
        status: "paid",
        payout_type: "credit",
        customer_no: String(customerNo),
        credit_note_number: creditNoteNumber,
        updated_by: String(userId),
      });
    }

    return res.status(201).json({
      success: true,
      message: "Rebate credit note issued",
      data: {
        creditNoteNumber,
        customer: entityName,
        customerNo: String(customerNo),
        date: today,
        reason: `Post-sale volume rebate: ${rule.name} (${rule.period_label})`,
        lineDescription,
        amount,
        ruleName: rule.name,
        period: rule.period_label,
        product: productLabel,
        rebatePercent: parseFloat(rule.rebate_percent) || 0,
        status: "paid",
        payoutType: "credit",
      },
    });
  } catch (err) {
    console.error("issueCreditNote", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to issue rebate credit note",
    });
  }
};
