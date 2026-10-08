"use strict";

const db = require("../models");
const { Op } = require("sequelize");
const creditNoteController = require("./creditNoteController");

function mapGrant(row) {
  if (!row) return null;
  const r = row.toJSON ? row.toJSON() : row;
  return {
    id: r.id,
    basis: r.basis === "purchase" ? "purchase" : "sales",
    partyName: r.party_name,
    partyNo: r.party_no || "",
    amount: parseFloat(r.amount) || 0,
    note: r.note || "",
    grantDate: r.grant_date,
    status: r.status || "pending",
    payoutType: r.payout_type || "credit",
    creditNoteNumber: r.credit_note_number || "",
    modeOfPayment: r.mode_of_payment || "",
    paymentReference: r.payment_reference || "",
    chequeNo: r.cheque_no || "",
    createdAt: r.created_at,
  };
}

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
    Promise.resolve(
      creditNoteController.createCreditNote(fakeReq, fakeRes),
    ).catch(reject);
  });
}

async function findOffsetAccount(facilityId, isPurchase) {
  if (isPurchase) {
    let account = await db.AccountCategory.findOne({
      where: {
        facility_id: String(facilityId),
        description: { [Op.like]: "%Purchase Return%" },
        display: 1,
      },
      order: [["level", "ASC"]],
    });
    if (!account) {
      account = await db.AccountCategory.findOne({
        where: {
          facility_id: String(facilityId),
          description: { [Op.like]: "%Discount%" },
          display: 1,
        },
        order: [["level", "ASC"]],
      });
    }
    if (!account) {
      account = await db.AccountCategory.findOne({
        where: {
          facility_id: String(facilityId),
          code: "112301",
          display: 1,
        },
      });
    }
    return account;
  }

  let account = await db.AccountCategory.findOne({
    where: {
      facility_id: String(facilityId),
      description: { [Op.like]: "%Discount Allowed%" },
      display: 1,
    },
    order: [["level", "ASC"]],
  });
  if (!account) {
    account = await db.AccountCategory.findOne({
      where: {
        facility_id: String(facilityId),
        description: { [Op.like]: "%Sales Returns%" },
        display: 1,
      },
      order: [["level", "ASC"]],
    });
  }
  if (!account) {
    account = await db.AccountCategory.findOne({
      where: {
        facility_id: String(facilityId),
        code: "600100",
        display: 1,
      },
    });
  }
  return account;
}

async function loadGrant(id, facilityId) {
  return db.RebateGrant.findOne({
    where: { id: Number(id), facility_id: String(facilityId) },
  });
}

/** GET /api/v1/rebate-ledger/grants?facilityId= */
exports.listGrants = async (req, res) => {
  try {
    const facilityId = req.query.facilityId || req.body?.facilityId;
    if (!facilityId) {
      return res
        .status(400)
        .json({ success: false, message: "facilityId is required" });
    }
    if (!db.RebateGrant) {
      return res.json({ success: true, results: [] });
    }
    const rows = await db.RebateGrant.findAll({
      where: { facility_id: String(facilityId) },
      order: [["grant_date", "DESC"], ["id", "DESC"]],
    });
    return res.json({
      success: true,
      results: rows.map(mapGrant),
    });
  } catch (err) {
    console.error("listGrants", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to load discretionary rebates",
    });
  }
};

/**
 * POST /api/v1/rebate-ledger/grants
 * Record a fixed rebate for someone who did not reach a rebate rule.
 * settle: record | credit | cash
 */
exports.createGrant = async (req, res) => {
  try {
    const {
      facilityId,
      userId,
      basis,
      partyName,
      partyNo,
      amount,
      note,
      grantDate,
      settle,
    } = req.body || {};

    const party = String(partyName || "").trim();
    const partyId = String(partyNo || "").trim();
    const value = parseFloat(String(amount ?? "").replace(/,/g, ""));
    const kind = basis === "purchase" ? "purchase" : "sales";
    const how = ["record", "credit", "cash"].includes(settle) ? settle : "record";

    if (!facilityId || !userId || !party) {
      return res.status(400).json({
        success: false,
        message: "facilityId, userId, and the customer or supplier are required",
      });
    }
    if (!Number.isFinite(value) || value <= 0) {
      return res.status(400).json({
        success: false,
        message: "Enter the rebate amount, for example 100000000",
      });
    }
    if (how !== "record" && !partyId) {
      return res.status(400).json({
        success: false,
        message: "Select the customer or supplier from the list so the rebate can be posted",
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const row = await db.RebateGrant.create({
      facility_id: String(facilityId),
      basis: kind,
      party_name: party,
      party_no: partyId || null,
      amount: value,
      note:
        String(note || "").trim() ||
        "Discretionary rebate. No volume target was reached.",
      grant_date: String(grantDate || today).slice(0, 10),
      status: "pending",
      payout_type: how === "cash" ? "cash" : "credit",
      created_by: String(userId),
      updated_by: String(userId),
    });

    if (how === "credit") {
      const issued = await settleGrantCredit(row, req.body);
      if (!issued.ok) {
        return res.status(issued.statusCode || 400).json({
          success: false,
          message: `Rebate recorded, but the credit note was not issued. ${issued.message}`,
          data: mapGrant(await row.reload()),
        });
      }
      return res.status(201).json({
        success: true,
        message: issued.message,
        data: issued.data,
      });
    }

    if (how === "cash") {
      const paid = await settleGrantPayment(row, req.body);
      if (!paid.ok) {
        return res.status(paid.statusCode || 400).json({
          success: false,
          message: `Rebate recorded, but the payment was not posted. ${paid.message}`,
          data: mapGrant(await row.reload()),
        });
      }
      return res.status(201).json({
        success: true,
        message: paid.message,
        data: paid.data,
      });
    }

    return res.status(201).json({
      success: true,
      message: "Discretionary rebate recorded",
      data: mapGrant(row),
    });
  } catch (err) {
    console.error("createGrant", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to record rebate",
    });
  }
};

exports.issueGrantCreditNote = async (req, res) => {
  try {
    const facilityId = req.body?.facilityId;
    const grant = await loadGrant(req.params.id, facilityId);
    if (!grant) {
      return res.status(404).json({ success: false, message: "Rebate not found" });
    }
    const issued = await settleGrantCredit(grant, req.body);
    if (!issued.ok) {
      return res.status(issued.statusCode || 400).json({
        success: false,
        message: issued.message,
      });
    }
    return res.status(201).json({
      success: true,
      message: issued.message,
      data: issued.data,
    });
  } catch (err) {
    console.error("issueGrantCreditNote", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to issue rebate credit note",
    });
  }
};

exports.issueGrantPayment = async (req, res) => {
  try {
    const facilityId = req.body?.facilityId;
    const grant = await loadGrant(req.params.id, facilityId);
    if (!grant) {
      return res.status(404).json({ success: false, message: "Rebate not found" });
    }
    const paid = await settleGrantPayment(grant, req.body);
    if (!paid.ok) {
      return res.status(paid.statusCode || 400).json({
        success: false,
        message: paid.message,
      });
    }
    return res.status(201).json({
      success: true,
      message: paid.message,
      data: paid.data,
    });
  } catch (err) {
    console.error("issueGrantPayment", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to pay rebate",
    });
  }
};

exports.deleteGrant = async (req, res) => {
  try {
    const facilityId = req.query.facilityId || req.body?.facilityId;
    const grant = await loadGrant(req.params.id, facilityId);
    if (!grant) {
      return res.status(404).json({ success: false, message: "Rebate not found" });
    }
    if (grant.status === "paid" || grant.credit_note_number || grant.payment_reference) {
      return res.status(400).json({
        success: false,
        message: "This rebate is already settled and cannot be removed",
      });
    }
    await grant.destroy();
    return res.json({ success: true, message: "Rebate removed" });
  } catch (err) {
    console.error("deleteGrant", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to remove rebate",
    });
  }
};

async function settleGrantCredit(grant, body) {
  const facilityId = body.facilityId;
  const userId = body.userId;
  if (!facilityId || !userId) {
    return { ok: false, statusCode: 400, message: "facilityId and userId are required" };
  }
  if (grant.credit_note_number || grant.payment_reference) {
    return {
      ok: false,
      statusCode: 409,
      message: `Already settled (${grant.credit_note_number || grant.payment_reference})`,
    };
  }
  const partyId = String(grant.party_no || "").trim();
  if (!partyId) {
    return {
      ok: false,
      statusCode: 400,
      message: "Customer or supplier number is missing on this rebate",
    };
  }

  const isPurchase = grant.basis === "purchase";
  const amount = parseFloat(grant.amount) || 0;
  const offset = await findOffsetAccount(facilityId, isPurchase);
  const note = String(grant.note || "Discretionary rebate").trim();
  const reason = `Discretionary rebate (no volume target reached): ${note}`.slice(0, 500);
  const lineDescription = `Discretionary rebate — ${grant.party_name} · ${note}`.slice(0, 500);
  const today = String(grant.grant_date || new Date().toISOString().slice(0, 10)).slice(0, 10);

  const account = offset
    ? {
        code: offset.code,
        description: offset.description,
        head: offset.code,
      }
    : {
        code: "",
        description: isPurchase ? "Purchase Returns" : "Discount Allowed",
        head: "",
      };

  const cnBody = {
    facilityId: String(facilityId),
    userId: String(userId),
    type: isPurchase ? "supplier" : "customer",
    ...(isPurchase
      ? { supplierId: partyId }
      : { customerId: partyId }),
    date: today,
    reference: `REBATE-G-${grant.id}`,
    reason,
    reasonCategory: "DISCOUNT",
    paymentAdjustmentMethod: "offset_outstanding",
    discount: { type: "amount", scope: "rebate", value: amount },
    lineItems: [
      {
        account,
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
    return {
      ok: false,
      statusCode: cnResult.statusCode || 400,
      message:
        cnResult.payload?.message ||
        (isPurchase
          ? "Failed to create vendor credit"
          : "Failed to create rebate credit note"),
    };
  }

  const creditNoteNumber = cnResult.payload.data.creditNoteNumber;
  await grant.update({
    status: "paid",
    payout_type: "credit",
    credit_note_number: creditNoteNumber,
    updated_by: String(userId),
  });

  return {
    ok: true,
    message: isPurchase
      ? "Discretionary vendor credit issued"
      : "Discretionary rebate credit note issued",
    data: {
      ...mapGrant(grant),
      creditNoteNumber,
      reason,
      lineDescription,
      date: today,
      amount,
    },
  };
}

async function settleGrantPayment(grant, body) {
  const {
    facilityId,
    userId,
    modeOfPayment,
    accountHead,
    bankAccount,
    chequeNo,
    paymentDate,
  } = body || {};

  if (!facilityId || !userId) {
    return { ok: false, statusCode: 400, message: "facilityId and userId are required" };
  }
  if (grant.credit_note_number || grant.payment_reference) {
    return {
      ok: false,
      statusCode: 409,
      message: `Already settled (${grant.credit_note_number || grant.payment_reference})`,
    };
  }

  const amount = parseFloat(grant.amount) || 0;
  if (amount <= 0) {
    return { ok: false, statusCode: 400, message: "Rebate amount must be greater than zero" };
  }

  const mode = String(modeOfPayment || "").toLowerCase();
  if (!["cash", "bank", "cheque"].includes(mode)) {
    return {
      ok: false,
      statusCode: 400,
      message: "modeOfPayment must be cash, bank, or cheque",
    };
  }
  if (mode === "cheque" && !String(chequeNo || "").trim()) {
    return { ok: false, statusCode: 400, message: "chequeNo is required for cheque payments" };
  }

  const isPurchase = grant.basis === "purchase";
  const party = grant.party_name;
  const transaction = await db.sequelize.transaction();
  try {
    const rebateAccount = await findOffsetAccount(facilityId, isPurchase);
    if (!rebateAccount) {
      await transaction.rollback();
      return {
        ok: false,
        statusCode: 400,
        message: isPurchase
          ? "Purchase Returns / Discount account not found"
          : "Sales Returns / Discount account not found in Chart of Accounts",
      };
    }

    let paymentAccount = null;
    let bankAcc = null;
    if (mode === "cash") {
      const cashCode =
        accountHead?.head || accountHead?.code || accountHead?.account_code || "";
      if (!cashCode) {
        await transaction.rollback();
        return {
          ok: false,
          statusCode: 400,
          message: "Select a cash account",
        };
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
        return {
          ok: false,
          statusCode: 400,
          message: `Cash account not found: ${cashCode}`,
        };
      }
    } else {
      const bankId = bankAccount?.id;
      if (!bankId) {
        await transaction.rollback();
        return {
          ok: false,
          statusCode: 400,
          message: "Select a bank account",
        };
      }
      bankAcc = await db.bank_account.findOne({
        where: {
          id: bankId,
          facilityId: String(facilityId),
          status: "active",
        },
        transaction,
      });
      if (!bankAcc?.head) {
        await transaction.rollback();
        return {
          ok: false,
          statusCode: 400,
          message: bankAcc
            ? `Bank account '${bankAcc.account_name}' has no GL head assigned`
            : "Bank account not found or inactive",
        };
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
        return {
          ok: false,
          statusCode: 400,
          message: `GL account not found for bank head: ${bankAcc.head}`,
        };
      }
    }

    const { getAndUpdateNumber } = require("../services/numberGen");
    const seq = await getAndUpdateNumber("rebate_pay", String(facilityId));
    const seqNum =
      typeof seq === "object" && seq?.message
        ? Date.now() % 100000
        : parseInt(seq, 10) || Date.now() % 100000;
    const yy = new Date().getFullYear().toString().slice(-2);
    const paymentRef = `REB-P-${yy}-${String(seqNum).padStart(4, "0")}`;
    const today = (paymentDate || grant.grant_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const note = String(grant.note || "Discretionary rebate").trim();
    const desc =
      `${isPurchase ? "Discretionary rebate received" : "Discretionary rebate paid"} — ${party} · ${note}. No volume target was reached.`.slice(0, 500);
    const purpose = `Rebate payout ${paymentRef}`.slice(0, 150);

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
          payee: String(party).slice(0, 250),
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
      await pushGl(paymentAccount, amount, 0, "DR");
      await pushGl(rebateAccount, 0, amount, "CR");
    } else {
      await pushGl(rebateAccount, amount, 0, "DR");
      await pushGl(paymentAccount, 0, amount, "CR");
    }

    await grant.update(
      {
        status: "paid",
        payout_type: "cash",
        mode_of_payment: mode,
        payment_reference: paymentRef,
        bank_account_id: bankAcc ? String(bankAcc.id) : null,
        cheque_no: mode === "cheque" ? String(chequeNo).trim() : null,
        updated_by: String(userId),
      },
      { transaction },
    );

    await transaction.commit();
    return {
      ok: true,
      message: isPurchase
        ? `Discretionary rebate received via ${mode}`
        : `Discretionary rebate paid via ${mode}`,
      data: {
        ...mapGrant(grant),
        paymentReference: paymentRef,
        modeOfPayment: mode,
        amount,
        date: today,
      },
    };
  } catch (err) {
    await transaction.rollback().catch(() => {});
    console.error("settleGrantPayment", err);
    return {
      ok: false,
      statusCode: 500,
      message: err.message || "Failed to post rebate payment",
    };
  }
}
