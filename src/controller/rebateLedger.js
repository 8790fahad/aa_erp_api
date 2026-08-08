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
    basis: r.basis === "purchase" ? "purchase" : "sales",
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
      basis,
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
    const ruleBasis = basis === "purchase" ? "purchase" : "sales";
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
      basis: ruleBasis,
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
        modeOfPayment: r.mode_of_payment || "",
        paymentReference: r.payment_reference || "",
        bankAccountId: r.bank_account_id || "",
        chequeNo: r.cheque_no || "",
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
      supplier,
      supplierNo,
      partyName,
      partyNo,
      rebateAmount,
    } = req.body || {};

    const party =
      String(partyName || customer || supplier || "").trim();
    const partyId = String(
      partyNo || customerNo || supplierNo || "",
    ).trim();

    if (!facilityId || !userId || !ruleId || !party) {
      return res.status(400).json({
        success: false,
        message: "facilityId, userId, ruleId, and party/customer are required",
      });
    }

    const amount = parseFloat(rebateAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "rebateAmount must be a positive number",
      });
    }

    if (!partyId) {
      return res.status(400).json({
        success: false,
        message:
          "Party number is required (customerNo / supplierNo). Refresh billing.",
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

    const isPurchase = rule.basis === "purchase";

    let statusRow = await db.RebateStatus.findOne({
      where: {
        facility_id: String(facilityId),
        rule_id: Number(ruleId),
        customer_name: party,
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

    let discountAccount = null;
    if (isPurchase) {
      discountAccount = await db.AccountCategory.findOne({
        where: {
          facility_id: String(facilityId),
          description: { [Op.like]: "%Purchase Return%" },
          display: 1,
        },
        order: [["level", "ASC"]],
      });
      if (!discountAccount) {
        discountAccount = await db.AccountCategory.findOne({
          where: {
            facility_id: String(facilityId),
            description: { [Op.like]: "%Discount%" },
            display: 1,
          },
          order: [["level", "ASC"]],
        });
      }
      if (!discountAccount) {
        discountAccount = await db.AccountCategory.findOne({
          where: {
            facility_id: String(facilityId),
            code: "112301",
            display: 1,
          },
        });
      }
    } else {
      discountAccount = await db.AccountCategory.findOne({
        where: {
          facility_id: String(facilityId),
          description: { [Op.like]: "%Discount Allowed%" },
          display: 1,
        },
        order: [["level", "ASC"]],
      });
      if (!discountAccount) {
        discountAccount = await db.AccountCategory.findOne({
          where: {
            facility_id: String(facilityId),
            description: { [Op.like]: "%Sales Returns%" },
            display: 1,
          },
          order: [["level", "ASC"]],
        });
      }
      if (!discountAccount) {
        discountAccount = await db.AccountCategory.findOne({
          where: {
            facility_id: String(facilityId),
            code: "600100",
            display: 1,
          },
        });
      }
    }

    const productLabel = rule.product_name || "All products";
    const lineDescription = `Volume rebate — ${rule.name} (${rule.period_label}) · ${productLabel}`;
    const today = new Date().toISOString().slice(0, 10);
    const reason = isPurchase
      ? `Post-purchase volume rebate: ${rule.name} (${rule.period_label})`
      : `Post-sale volume rebate: ${rule.name} (${rule.period_label})`;

    const cnBody = isPurchase
      ? {
          facilityId: String(facilityId),
          userId: String(userId),
          type: "supplier",
          supplierId: partyId,
          date: today,
          reference: `REBATE-${rule.id}`,
          reason,
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
                : { code: "", description: "Purchase Returns", head: "" },
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
        }
      : {
          facilityId: String(facilityId),
          userId: String(userId),
          type: "customer",
          customerId: partyId,
          date: today,
          reference: `REBATE-${rule.id}`,
          reason,
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
        };

    const cnResult = await runCreateCreditNote(cnBody);

    if (!cnResult.payload?.success) {
      return res.status(cnResult.statusCode || 400).json({
        success: false,
        message:
          cnResult.payload?.message ||
          (isPurchase
            ? "Failed to create vendor credit"
            : "Failed to create rebate credit note"),
        error: cnResult.payload?.error,
      });
    }

    const creditNoteNumber = cnResult.payload.data.creditNoteNumber;
    const entityName = cnResult.payload.data.entityName || party;

    if (!statusRow) {
      statusRow = await db.RebateStatus.create({
        facility_id: String(facilityId),
        rule_id: Number(ruleId),
        customer_name: party,
        customer_no: partyId,
        status: "paid",
        payout_type: "credit",
        credit_note_number: creditNoteNumber,
        updated_by: String(userId),
      });
    } else {
      await statusRow.update({
        status: "paid",
        payout_type: "credit",
        customer_no: partyId,
        credit_note_number: creditNoteNumber,
        updated_by: String(userId),
      });
    }

    return res.status(201).json({
      success: true,
      message: isPurchase
        ? "Rebate vendor credit issued"
        : "Rebate credit note issued",
      data: {
        creditNoteNumber,
        customer: entityName,
        customerNo: partyId,
        supplier: isPurchase ? entityName : undefined,
        supplierNo: isPurchase ? partyId : undefined,
        basis: isPurchase ? "purchase" : "sales",
        date: today,
        reason,
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

/**
 * POST /api/v1/rebate-ledger/issue-payment
 * Sales: pay customer rebate — Dr Sales Returns · Cr Cash/Bank
 * Purchase: receive vendor rebate — Dr Cash/Bank · Cr Inventory/Discount
 */
exports.issuePayment = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const {
      facilityId,
      userId,
      ruleId,
      customer,
      customerNo,
      supplier,
      supplierNo,
      partyName,
      partyNo,
      rebateAmount,
      modeOfPayment,
      accountHead,
      bankAccount,
      chequeNo,
      paymentDate,
    } = req.body || {};

    const party = String(partyName || customer || supplier || "").trim();
    const partyId = String(partyNo || customerNo || supplierNo || "").trim();

    if (!facilityId || !userId || !ruleId || !party) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId, userId, ruleId, and party/customer are required",
      });
    }

    const amount = parseFloat(rebateAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "rebateAmount must be a positive number",
      });
    }

    const mode = String(modeOfPayment || "").toLowerCase();
    if (!["cash", "bank", "cheque"].includes(mode)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "modeOfPayment must be cash, bank, or cheque",
      });
    }

    if (mode === "cheque" && !String(chequeNo || "").trim()) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "chequeNo is required for cheque payments",
      });
    }

    const rule = await db.RebateRule.findOne({
      where: { id: Number(ruleId), facility_id: String(facilityId) },
      transaction,
    });
    if (!rule) {
      await transaction.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Rule not found" });
    }

    const isPurchase = rule.basis === "purchase";
    const customerName = party;
    let statusRow = await db.RebateStatus.findOne({
      where: {
        facility_id: String(facilityId),
        rule_id: Number(ruleId),
        customer_name: customerName,
      },
      transaction,
    });

    if (statusRow?.credit_note_number || statusRow?.payment_reference) {
      await transaction.rollback();
      return res.status(409).json({
        success: false,
        message: statusRow.credit_note_number
          ? `Already settled by credit note (${statusRow.credit_note_number})`
          : `Already settled by payment (${statusRow.payment_reference})`,
        data: {
          creditNoteNumber: statusRow.credit_note_number || "",
          paymentReference: statusRow.payment_reference || "",
        },
      });
    }

    // Offset account: sales returns (pay out) or inventory/discount (receive purchase rebate)
    let rebateAccount = null;
    if (isPurchase) {
      rebateAccount = await db.AccountCategory.findOne({
        where: {
          facility_id: String(facilityId),
          description: { [Op.like]: "%Purchase Return%" },
          display: 1,
        },
        order: [["level", "ASC"]],
        transaction,
      });
      if (!rebateAccount) {
        rebateAccount = await db.AccountCategory.findOne({
          where: {
            facility_id: String(facilityId),
            description: { [Op.like]: "%Discount%" },
            display: 1,
          },
          order: [["level", "ASC"]],
          transaction,
        });
      }
      if (!rebateAccount) {
        rebateAccount = await db.AccountCategory.findOne({
          where: {
            facility_id: String(facilityId),
            code: "112301",
            display: 1,
          },
          transaction,
        });
      }
    } else {
      rebateAccount = await db.AccountCategory.findOne({
        where: {
          facility_id: String(facilityId),
          description: { [Op.like]: "%Sales Returns%" },
          display: 1,
        },
        order: [["level", "ASC"]],
        transaction,
      });
      if (!rebateAccount) {
        rebateAccount = await db.AccountCategory.findOne({
          where: {
            facility_id: String(facilityId),
            description: { [Op.like]: "%Discount Allowed%" },
            display: 1,
          },
          order: [["level", "ASC"]],
          transaction,
        });
      }
      if (!rebateAccount) {
        rebateAccount = await db.AccountCategory.findOne({
          where: {
            facility_id: String(facilityId),
            code: "600100",
            display: 1,
          },
          transaction,
        });
      }
    }
    if (!rebateAccount) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: isPurchase
          ? "Purchase Returns / Inventory / Discount account not found"
          : "Sales Returns / Discount account not found in Chart of Accounts",
      });
    }

    // Resolve cash/bank credit account
    let paymentAccount = null;
    let bankAcc = null;
    let paymentName = "";

    if (mode === "cash") {
      const cashCode =
        accountHead?.head ||
        accountHead?.code ||
        accountHead?.account_code ||
        "";
      if (!cashCode) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "accountHead (cash GL code) is required for cash payment",
        });
      }
      paymentAccount = await db.AccountCategory.findOne({
        where: {
          facility_id: String(facilityId),
          code: String(cashCode),
          display: 1,
        },
        transaction,
      });
      if (!paymentAccount) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Cash account not found: ${cashCode}`,
        });
      }
      paymentName = paymentAccount.description || "Cash";
    } else {
      const bankId = bankAccount?.id;
      if (!bankId) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "bankAccount.id is required for bank/cheque payment",
        });
      }
      bankAcc = await db.bank_account.findOne({
        where: {
          id: bankId,
          facilityId: String(facilityId),
          status: "active",
        },
        transaction,
      });
      if (!bankAcc) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Bank account not found or inactive",
        });
      }
      if (!bankAcc.head) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Bank account '${bankAcc.account_name}' has no GL head assigned`,
        });
      }
      paymentAccount = await db.AccountCategory.findOne({
        where: {
          facility_id: String(facilityId),
          code: String(bankAcc.head),
        },
        transaction,
      });
      if (!paymentAccount) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `GL account not found for bank head: ${bankAcc.head}`,
        });
      }
      paymentName = bankAcc.account_name;
    }

    const { getAndUpdateNumber } = require("../services/numberGen");
    const seq = await getAndUpdateNumber("rebate_pay", String(facilityId));
    const seqNum =
      typeof seq === "object" && seq?.message
        ? Date.now() % 100000
        : parseInt(seq, 10) || Date.now() % 100000;
    const yy = new Date().getFullYear().toString().slice(-2);
    const paymentRef = `REB-P-${yy}-${String(seqNum).padStart(4, "0")}`;
    const today = (paymentDate || new Date().toISOString().slice(0, 10)).slice(
      0,
      10,
    );
    const productLabel = rule.product_name || "All products";
    const purpose = `Rebate payout ${paymentRef}`.slice(0, 150);
    const desc =
      `${isPurchase ? "Volume rebate received" : "Volume rebate paid"} — ${rule.name} (${rule.period_label}) · ${productLabel} · ${customerName}`.slice(
        0,
        500,
      );

    const pushGl = async (account, dr, cr, lineKey) => {
      const parent =
        account.parentCode ?? account.parent_code ?? account.code ?? "0";
      await db.GeneralLedger.create(
        {
          facility_id: String(facilityId),
          transaction_date: today,
          transaction_ref: `${paymentRef}-${lineKey}`,
          reference_number: paymentRef.slice(0, 50),
          account_code: account.code,
          account_description: account.description,
          account_subhead: String(parent),
          dr: Number(Number(dr).toFixed(2)),
          cr: Number(Number(cr).toFixed(2)),
          transaction_description: desc,
          purpose_of_payment: purpose,
          payee: customerName.slice(0, 250),
          mode_of_payment: mode,
          bank_account_id: bankAcc ? String(bankAcc.id) : "",
          cheque_no: mode === "cheque" ? String(chequeNo).trim() : null,
          type: "payment",
          status: "posted",
          reconciled: "unmatched",
          created_by: String(userId),
        },
        { transaction },
      );
    };

    if (isPurchase) {
      // Receive vendor rebate: Dr Cash/Bank · Cr Inventory/Discount
      await pushGl(paymentAccount, amount, 0, "DR");
      await pushGl(rebateAccount, 0, amount, "CR");
    } else {
      // Pay customer rebate: Dr Sales Returns · Cr Cash/Bank
      await pushGl(rebateAccount, amount, 0, "DR");
      await pushGl(paymentAccount, 0, amount, "CR");
    }

    const paymentFields = {
      status: "paid",
      payout_type: "cash",
      customer_no: partyId || null,
      mode_of_payment: mode,
      payment_reference: paymentRef,
      bank_account_id: bankAcc ? String(bankAcc.id) : null,
      cheque_no: mode === "cheque" ? String(chequeNo).trim() : null,
      updated_by: String(userId),
    };

    if (!statusRow) {
      statusRow = await db.RebateStatus.create(
        {
          facility_id: String(facilityId),
          rule_id: Number(ruleId),
          customer_name: customerName,
          ...paymentFields,
        },
        { transaction },
      );
    } else {
      await statusRow.update(paymentFields, { transaction });
    }

    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: isPurchase
        ? `Purchase rebate received via ${mode}`
        : `Rebate paid via ${mode}`,
      data: {
        paymentReference: paymentRef,
        modeOfPayment: mode,
        paymentAccount: paymentName,
        customer: customerName,
        customerNo: partyId,
        basis: isPurchase ? "purchase" : "sales",
        date: today,
        amount,
        ruleName: rule.name,
        period: rule.period_label,
        product: productLabel,
        rebatePercent: parseFloat(rule.rebate_percent) || 0,
        status: "paid",
        payoutType: "cash",
        chequeNo: mode === "cheque" ? String(chequeNo).trim() : "",
        bankAccountId: bankAcc ? String(bankAcc.id) : "",
      },
    });
  } catch (err) {
    await transaction.rollback().catch(() => {});
    console.error("issuePayment", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to pay rebate claim",
    });
  }
};
