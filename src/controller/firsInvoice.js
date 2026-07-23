/**
 * FIRS/NRS E-Invoicing controller (System Integrator / Access Point).
 *
 * Aligns with FIRS e-Invoicing docs:
 * https://einvoice.firs.gov.ng/docs/introduction?version=1.1
 *
 * Clients authenticate with OAuth 2.0 Bearer tokens from
 * POST /api/v1/invoice/oauth/token — NOT a SystemSpecs secretKey header.
 *
 * Optional upstream APP transmission: set FIRS_EINVOICE_BASE_URL to forward
 * accepted payloads to an NRS access-point host with the caller's Bearer token.
 * When unset, FlowBooks accepts and records the invoice locally (SI sandbox).
 */

const crypto = require("crypto");
const db = require("../models");
const { allowGlobalClient } = require("../middleware/eInvoicingAuth");
const {
  createInvoiceSchema,
  statusSchema,
  paymentNotifySchema,
  validate: validateWithJoi,
} = require("../validation/eInvoicing");

const FIRS_EINVOICE_BASE_URL = (
  process.env.FIRS_EINVOICE_BASE_URL ||
  process.env.NRS_EINVOICE_BASE_URL ||
  ""
).replace(/\/$/, "");

function resolveBusinessId(body = {}, req = {}) {
  if (body.business_id != null && String(body.business_id).trim() !== "") {
    return String(body.business_id).trim();
  }
  if (body.facilityId != null && String(body.facilityId).trim() !== "") {
    return String(body.facilityId).trim();
  }
  if (req.oauth?.business_id) return String(req.oauth.business_id);
  if (req.user?.nrs_business_id) return String(req.user.nrs_business_id);
  if (req.user?.facilityId) return String(req.user.facilityId);
  return null;
}

/** Ensure caller may act on the given business_id (OAuth client or user JWT). */
function ensureBusinessAccess(req, businessId) {
  if (req.oauth) {
    const oauthBusiness = req.oauth.business_id
      ? String(req.oauth.business_id)
      : null;
    if (!oauthBusiness) {
      return {
        allowed: allowGlobalClient(),
        status: 403,
        expectedBusinessId: null,
        reason: allowGlobalClient()
          ? null
          : "OAuth client has no bound business_id. Save NRS Business ID in Developer tools, then re-request a token (or rotate credentials).",
      };
    }
    return {
      allowed: oauthBusiness === String(businessId),
      status: 403,
      expectedBusinessId: oauthBusiness,
    };
  }

  const user = req.user;
  if (!user || !user.facilityId) return { allowed: false, status: 401 };
  const isSuperAdmin =
    user.role && String(user.role).toLowerCase() === "superadmin";
  if (isSuperAdmin) return { allowed: true };

  const userBusiness = String(user.facilityId);
  const requestedBusiness = String(businessId);
  const userNrsBusiness =
    user.nrs_business_id != null ? String(user.nrs_business_id) : null;

  const allowed =
    userBusiness === requestedBusiness ||
    (userNrsBusiness && userNrsBusiness === requestedBusiness);

  return {
    allowed,
    status: 403,
    expectedBusinessId: userNrsBusiness || userBusiness,
  };
}

/** Generic 403/401 — do not leak expected business_id to clients. */
function sendAuthzDenied(res, authz) {
  return res.status(authz.status).json({
    success: false,
    message:
      authz.status === 401
        ? "Unauthorized"
        : authz.reason ||
          "Forbidden: you may only act on your own business.",
  });
}

function bearerFromRequest(req) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return null;
}

/**
 * Forward to optional upstream FIRS/NRS APP using Bearer auth (FIRS-aligned).
 * Returns null when no upstream is configured.
 * Sandbox/testing OAuth clients never hit live upstream unless explicitly allowed.
 */
async function proxyToFirs(method, path, body, bearerToken, environment) {
  if (!FIRS_EINVOICE_BASE_URL) return null;
  if (
    environment === "testing" &&
    process.env.EINVOICING_ALLOW_TEST_UPSTREAM !== "true"
  ) {
    return null;
  }

  const url = `${FIRS_EINVOICE_BASE_URL}${path}`;
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;

  const opts = { method, headers };
  if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
    opts.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, opts);
    const status = response.status || 500;
    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { message: text };
      }
    }
    return { status, data: payload };
  } catch (err) {
    throw err;
  }
}

function buildIrn(body = {}) {
  if (body.irn && String(body.irn).trim()) return String(body.irn).trim();

  const invoiceNo =
    body.invoiceRef ||
    body.invoice_ref ||
    body.invoice_number ||
    body.invoiceNo ||
    `INV-${Date.now()}`;
  const serviceId =
    body.service_id ||
    body.serviceId ||
    process.env.NRS_SERVICE_ID ||
    "SVC001";
  const issueDateRaw =
    body.issue_date || body.issueDate || new Date().toISOString().slice(0, 10);
  const yyyymmdd = String(issueDateRaw).replace(/-/g, "").slice(0, 8);
  return `${invoiceNo}-${serviceId}-${yyyymmdd}`;
}

function normalizeCreatePayload(body = {}, businessId, irn) {
  const payload = { ...body, business_id: businessId, irn };

  if (!payload.issue_date && payload.issueDate) {
    payload.issue_date = payload.issueDate;
  }
  if (!payload.due_date && payload.dueDate) {
    payload.due_date = payload.dueDate;
  }
  if (!payload.document_currency_code && payload.currency) {
    payload.document_currency_code = payload.currency;
  }
  if (!payload.payment_status && payload.status) {
    const map = {
      issued: "PENDING",
      pending: "PENDING",
      paid: "PAID",
      rejected: "REJECTED",
      partial: "PARTIAL",
      partially_paid: "PARTIAL",
      overdue: "PENDING",
    };
    payload.payment_status =
      map[String(payload.status).toLowerCase()] || "PENDING";
  }
  if (!payload.payment_status) payload.payment_status = "PENDING";

  return payload;
}

function toPublicRecord(row) {
  const plain = row.toJSON ? row.toJSON() : row;
  return {
    business_id: plain.business_id,
    irn: plain.irn,
    invoice_kind: plain.invoice_kind,
    payment_status: plain.payment_status,
    clearance_status: plain.clearance_status,
    transmission_status: plain.transmission_status,
    qr_code: plain.qr_code,
    reference: plain.reference,
    updated_at: plain.updated_at || plain.updatedAt,
  };
}

/** Round money to 2 decimal places (currency-safe comparisons). */
function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Normalize Sequelize/mysql2 JSON fields that may arrive as objects or strings.
 */
function asJsonObject(value) {
  if (value == null) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      /* ignore */
    }
  }
  return {};
}

/**
 * Invoice payable total from stored create payload.
 * Prefers legal_monetary_total.payable_amount.
 */
function resolveInvoicePayable(record) {
  const payload = asJsonObject(record?.payload);
  const totals = asJsonObject(payload.legal_monetary_total);
  return (
    money(totals.payable_amount) ??
    money(totals.tax_inclusive_amount) ??
    money(payload.payable_amount) ??
    money(payload.total_amount) ??
    null
  );
}

/** Cumulative amount already recorded as paid on this invoice. */
function resolveAmountPaid(record) {
  const payload = asJsonObject(record?.payload);
  const paid =
    money(payload.amount_paid_total) ??
    money(payload.amount_paid) ??
    money(payload.paid_total);
  if (paid != null && paid >= 0) return paid;

  // Legacy single payment_amount field (treat as cumulative if present)
  const legacy = money(payload.payment_amount);
  if (legacy != null && legacy > 0 && record?.payment_status === "PAID") {
    return resolveInvoicePayable(record) ?? legacy;
  }
  if (legacy != null && legacy > 0) return legacy;
  return 0;
}

/**
 * Apply PARTIAL / PAID amount rules against invoice total and remaining balance.
 * `amount` on PARTIAL is this installment (not cumulative).
 *
 * @returns {{ ok: true, paymentStatus, installment, amountPaidTotal, payable, balance } | { ok: false, status, message, details }}
 */
function applyPaymentAmountControls({
  record,
  paymentStatus,
  amount,
}) {
  const payable = record ? resolveInvoicePayable(record) : null;
  const alreadyPaid = record ? resolveAmountPaid(record) : 0;
  const currentStatus = String(record?.payment_status || "PENDING").toUpperCase();

  if (currentStatus === "PAID") {
    return {
      ok: false,
      status: 400,
      message: "Invoice is already fully paid",
      details: [
        "This invoice payment_status is PAID. No further payment notifications are accepted.",
      ],
    };
  }

  if (currentStatus === "REJECTED" && paymentStatus === "PARTIAL") {
    return {
      ok: false,
      status: 400,
      message: "Cannot partially pay a rejected invoice",
      details: ["payment_status REJECTED invoices cannot accept PARTIAL payments."],
    };
  }

  if (paymentStatus === "REJECTED") {
    return {
      ok: true,
      paymentStatus: "REJECTED",
      installment: null,
      amountPaidTotal: alreadyPaid,
      payable,
      balance: payable != null ? money(payable - alreadyPaid) : null,
    };
  }

  if (paymentStatus === "PENDING") {
    return {
      ok: true,
      paymentStatus: "PENDING",
      installment: null,
      amountPaidTotal: alreadyPaid,
      payable,
      balance: payable != null ? money(payable - alreadyPaid) : null,
    };
  }

  // PAID or PARTIAL need an invoice with a known payable amount for controls
  if (!record) {
    return {
      ok: false,
      status: 404,
      message: "Invoice not found",
      details: [
        "Create the invoice first before sending payment notifications that require amount control.",
      ],
    };
  }

  if (payable == null || payable <= 0) {
    return {
      ok: false,
      status: 400,
      message: "Invoice payable amount is missing",
      details: [
        "Invoice has no legal_monetary_total.payable_amount. Recreate the invoice with a valid payable_amount.",
      ],
    };
  }

  const balance = money(payable - alreadyPaid);
  if (balance <= 0) {
    return {
      ok: false,
      status: 400,
      message: "Invoice is already fully paid",
      details: [
        `payable_amount=${payable}, amount_paid_total=${alreadyPaid}, balance=0`,
      ],
    };
  }

  if (paymentStatus === "PAID") {
    // Full settlement — optional amount must cover remaining balance (or omit to pay balance)
    let installment = amount != null ? money(amount) : balance;
    if (installment == null || installment <= 0) {
      return {
        ok: false,
        status: 400,
        message: "amount must be a positive number when provided",
        details: ["amount must be greater than 0"],
      };
    }
    if (installment > balance) {
      return {
        ok: false,
        status: 400,
        message: "amount exceeds remaining balance",
        details: [
          `amount (${installment}) cannot exceed remaining balance (${balance}). payable_amount=${payable}, amount_paid_total=${alreadyPaid}`,
        ],
      };
    }
    if (installment < balance) {
      return {
        ok: false,
        status: 400,
        message: "amount is less than remaining balance for PAID",
        details: [
          `For payment_status PAID, amount must equal remaining balance (${balance}), or omit amount to settle in full. Use PARTIAL for installments.`,
        ],
      };
    }
    return {
      ok: true,
      paymentStatus: "PAID",
      installment: balance,
      amountPaidTotal: payable,
      payable,
      balance: 0,
    };
  }

  // PARTIAL — amount is this installment
  const installment = money(amount);
  if (installment == null || installment <= 0) {
    return {
      ok: false,
      status: 400,
      message: "amount is required when payment_status is PARTIAL",
      details: ["amount must be a positive number (this payment installment)"],
    };
  }

  if (installment > payable) {
    return {
      ok: false,
      status: 400,
      message: "amount exceeds invoice payable amount",
      details: [
        `amount (${installment}) cannot exceed invoice payable_amount (${payable})`,
      ],
    };
  }

  if (installment > balance) {
    return {
      ok: false,
      status: 400,
      message: "amount exceeds remaining balance",
      details: [
        `amount (${installment}) cannot exceed remaining balance (${balance}). payable_amount=${payable}, amount_paid_total=${alreadyPaid}`,
      ],
    };
  }

  const amountPaidTotal = money(alreadyPaid + installment);
  // Completing the balance via PARTIAL auto-promotes to PAID
  const nextStatus =
    amountPaidTotal >= payable || money(payable - amountPaidTotal) === 0
      ? "PAID"
      : "PARTIAL";

  return {
    ok: true,
    paymentStatus: nextStatus,
    installment,
    amountPaidTotal: nextStatus === "PAID" ? payable : amountPaidTotal,
    payable,
    balance: nextStatus === "PAID" ? 0 : money(payable - amountPaidTotal),
  };
}

async function upsertLocalInvoice(payload, extra = {}) {
  const Model = db.NrsEInvoice;
  if (!Model) {
    throw new Error(
      "NrsEInvoice model not loaded. Restart API after adding src/models/nrs_einvoice.js",
    );
  }

  const reference = extra.reference || crypto.randomUUID();
  const values = {
    business_id: payload.business_id,
    irn: payload.irn,
    invoice_kind: payload.invoice_kind || null,
    payment_status: payload.payment_status || "PENDING",
    clearance_status: extra.clearance_status || "ACCEPTED",
    transmission_status: extra.transmission_status || "QUEUED",
    qr_code: extra.qr_code || null,
    reference,
    payload,
    upstream: extra.upstream || null,
  };

  const existing = await Model.findOne({
    where: { business_id: payload.business_id, irn: payload.irn },
  });
  if (existing) {
    await existing.update(values);
    return existing;
  }
  return Model.create(values);
}

/** Create-only — IRN must be unique per business (no overwrite). */
async function createLocalInvoice(payload, extra = {}) {
  const Model = db.NrsEInvoice;
  if (!Model) {
    throw new Error(
      "NrsEInvoice model not loaded. Restart API after adding src/models/nrs_einvoice.js",
    );
  }

  const existing = await Model.findOne({
    where: { business_id: payload.business_id, irn: payload.irn },
  });
  if (existing) {
    const err = new Error(
      `Duplicate IRN: an invoice with irn "${payload.irn}" already exists for this business_id`,
    );
    err.code = "DUPLICATE_IRN";
    err.status = 409;
    err.existing = existing;
    throw err;
  }

  return Model.create({
    business_id: payload.business_id,
    irn: payload.irn,
    invoice_kind: payload.invoice_kind || null,
    payment_status: payload.payment_status || "PENDING",
    clearance_status: extra.clearance_status || "ACCEPTED",
    transmission_status: extra.transmission_status || "QUEUED",
    qr_code: extra.qr_code || null,
    reference: extra.reference || crypto.randomUUID(),
    payload,
    upstream: extra.upstream || null,
  });
}

async function findExactInvoice(businessId, irn) {
  const Model = db.NrsEInvoice;
  if (!Model) return null;
  return Model.findOne({
    where: { business_id: businessId, irn },
  });
}

async function findInvoice(businessId, irn) {
  // Exact match only — never Op.like with user input (wildcard IDOR risk).
  return findExactInvoice(businessId, irn);
}

/**
 * Create Invoice — FIRS/NRS schema
 * POST /api/v1/invoice/create
 */
exports.createInvoice = async (req, res) => {
  try {
    const body = req.body || {};
    const businessId = resolveBusinessId(body, req);
    if (!businessId) {
      return res.status(400).json({
        success: false,
        message:
          "business_id is required (NRS merchant / facility identifier).",
      });
    }

    const authz = ensureBusinessAccess(req, businessId);
    if (!authz.allowed) {
      return sendAuthzDenied(res, authz);
    }

    const irn = buildIrn(body);
    const payload = normalizeCreatePayload(body, businessId, irn);
    const validated = validateWithJoi(createInvoiceSchema, payload);
    if (!validated.ok) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        details: validated.details,
      });
    }

    // IRN is a unique tracking number per business — reject duplicates
    const duplicate = await findExactInvoice(businessId, payload.irn);
    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: "Duplicate IRN",
        details: [
          `irn "${payload.irn}" is already assigned to an invoice for this business_id. Each invoice must have a unique IRN.`,
        ],
        data: {
          business_id: businessId,
          irn: payload.irn,
          existing_payment_status: duplicate.payment_status,
        },
      });
    }

    const bearer = bearerFromRequest(req);
    const upstream = await proxyToFirs(
      "POST",
      "/api/v1/invoice/create",
      payload,
      bearer,
      req.oauth?.environment,
    );

    if (upstream) {
      if (upstream.status >= 200 && upstream.status < 300) {
        const record = await createLocalInvoice(payload, {
          clearance_status: "SUBMITTED",
          transmission_status: "TRANSMITTED",
          qr_code: upstream.data?.qr_code || upstream.data?.qrCode || null,
          upstream: upstream.data,
        });
        return res.status(200).json({
          success: true,
          message: "Invoice created and submitted to FIRS",
          data: { ...toPublicRecord(record), ...upstream.data },
        });
      }
      return res.status(upstream.status).json({
        success: false,
        message:
          upstream.data?.message ||
          upstream.data?.error_description ||
          "Failed to create invoice at FIRS/NRS",
        error: upstream.data,
      });
    }

    const record = await createLocalInvoice(payload);
    return res.status(200).json({
      success: true,
      message: "Invoice accepted for FIRS/NRS e-invoicing",
      data: toPublicRecord(record),
    });
  } catch (error) {
    if (error?.code === "DUPLICATE_IRN") {
      return res.status(409).json({
        success: false,
        message: "Duplicate IRN",
        details: [error.message],
      });
    }
    // Sequelize unique constraint race
    if (
      error?.name === "SequelizeUniqueConstraintError" ||
      error?.original?.code === "ER_DUP_ENTRY"
    ) {
      return res.status(409).json({
        success: false,
        message: "Duplicate IRN",
        details: [
          "irn must be a unique tracking number. An invoice with this IRN already exists.",
        ],
      });
    }
    console.error("FIRS createInvoice error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

/**
 * Lookup Invoice Status
 * POST /api/v1/invoice/status
 */
exports.lookupInvoiceStatus = async (req, res) => {
  try {
    const body = req.body || {};
    const businessId = resolveBusinessId(body, req);
    const irn = body.irn || body.IRN || body.invoiceRef || body.invoice_ref;
    const validated = validateWithJoi(statusSchema, {
      business_id: businessId,
      irn,
    });
    if (!validated.ok) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        details: validated.details,
      });
    }

    const authz = ensureBusinessAccess(req, businessId);
    if (!authz.allowed) {
      return sendAuthzDenied(res, authz);
    }

    const bearer = bearerFromRequest(req);
    const upstream = await proxyToFirs(
      "POST",
      "/api/v1/invoice/status",
      { business_id: businessId, irn },
      bearer,
      req.oauth?.environment,
    );

    if (upstream) {
      if (upstream.status >= 200 && upstream.status < 300) {
        return res.status(200).json({
          success: true,
          data: upstream.data,
        });
      }
      return res.status(upstream.status).json({
        success: false,
        message: upstream.data?.message || "Failed to lookup invoice status",
        error: upstream.data,
      });
    }

    const record = await findInvoice(businessId, irn);
    if (!record) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found for this business_id and irn.",
      });
    }

    return res.status(200).json({
      success: true,
      data: toPublicRecord(record),
    });
  } catch (error) {
    console.error("FIRS lookupInvoiceStatus error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

/**
 * Payment Notification
 * POST /api/v1/invoice/payment/notify
 *
 * Allowed payment_status: PENDING, PAID, REJECTED, PARTIAL.
 * PARTIAL requires `amount` = this installment (not cumulative).
 * Controls:
 *  - amount cannot exceed invoice payable_amount
 *  - amount cannot exceed remaining balance (payable - amount_paid_total)
 *  - when cumulative paid reaches payable, status becomes PAID
 */
exports.paymentNotify = async (req, res) => {
  try {
    const body = req.body || {};
    const businessId = resolveBusinessId(body, req);
    const irn = body.irn || body.IRN || body.invoiceRef || body.invoice_ref;
    // Normalize legacy PARTIALLY_PAID → PARTIAL
    let paymentStatusRaw = String(
      body.payment_status || body.paymentStatus || "",
    ).trim();
    if (paymentStatusRaw === "PARTIALLY_PAID") paymentStatusRaw = "PARTIAL";

    const validated = validateWithJoi(paymentNotifySchema, {
      business_id: businessId,
      irn,
      payment_status: paymentStatusRaw,
      amount: body.amount,
      payment_amount: body.payment_amount,
      paid_amount: body.paid_amount,
      reference: body.reference,
      payment_reference: body.payment_reference,
    });
    if (!validated.ok) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        details: validated.details,
      });
    }

    const authz = ensureBusinessAccess(req, businessId);
    if (!authz.allowed) {
      return sendAuthzDenied(res, authz);
    }

    const rawAmount =
      validated.value.amount != null
        ? validated.value.amount
        : validated.value.payment_amount != null
          ? validated.value.payment_amount
          : validated.value.paid_amount;
    const amount =
      rawAmount != null && rawAmount !== "" ? Number(rawAmount) : null;

    const reference = String(
      validated.value.reference || validated.value.payment_reference || "",
    ).trim();

    const idempotencyKey = String(req.get("Idempotency-Key") || "")
      .trim()
      .slice(0, 128);

    const record = await findInvoice(businessId, irn);

    const existingPayload = asJsonObject(record?.payload);
    if (
      idempotencyKey &&
      existingPayload.last_idempotency_key === idempotencyKey &&
      existingPayload.last_idempotency_response
    ) {
      return res
        .status(200)
        .json(existingPayload.last_idempotency_response);
    }

    const applied = applyPaymentAmountControls({
      record,
      paymentStatus: validated.value.payment_status,
      amount,
    });
    if (!applied.ok) {
      return res.status(applied.status).json({
        success: false,
        message: applied.message,
        details: applied.details,
        data: {
          business_id: businessId,
          irn,
          payable_amount: resolveInvoicePayable(record),
          amount_paid_total: record ? resolveAmountPaid(record) : 0,
        },
      });
    }

    const paymentStatus = applied.paymentStatus;
    const installment = applied.installment;

    const notifyBody = {
      business_id: businessId,
      irn,
      payment_status: paymentStatus,
    };
    if (installment != null) notifyBody.amount = installment;
    if (reference) notifyBody.reference = reference;

    const paymentMeta = {
      amount_paid_total: applied.amountPaidTotal,
      payable_amount: applied.payable,
      remaining_balance: applied.balance,
      ...(installment != null ? { last_payment_amount: installment } : {}),
      ...(reference ? { payment_reference: reference } : {}),
      payment_history: [
        ...(Array.isArray(existingPayload.payment_history)
          ? existingPayload.payment_history
          : []),
        {
          at: new Date().toISOString(),
          payment_status: paymentStatus,
          amount: installment,
          reference: reference || null,
          amount_paid_total: applied.amountPaidTotal,
          remaining_balance: applied.balance,
        },
      ].slice(-50),
    };

    const bearer = bearerFromRequest(req);
    const upstream = await proxyToFirs(
      "POST",
      "/api/v1/invoice/payment/notify",
      notifyBody,
      bearer,
      req.oauth?.environment,
    );

    const buildSuccessBody = (extra = {}) => ({
      success: true,
      message:
        paymentStatus === "PAID"
          ? "Payment completed — invoice is fully paid"
          : extra.local
            ? "Payment status updated"
            : "Payment notification sent successfully",
      data: {
        ...extra.data,
        business_id: businessId,
        irn: extra.irn || record?.irn || irn,
        payment_status: paymentStatus,
        ...(installment != null ? { amount: installment } : {}),
        amount_paid_total: applied.amountPaidTotal,
        payable_amount: applied.payable,
        remaining_balance: applied.balance,
        ...(reference ? { reference } : {}),
      },
    });

    const persistPayment = async (row, responseBody) => {
      if (!row) return;
      const nextPayload = {
        ...asJsonObject(row.payload),
        ...paymentMeta,
        ...(idempotencyKey
          ? {
              last_idempotency_key: idempotencyKey,
              last_idempotency_response: responseBody,
            }
          : {}),
      };
      await row.update({
        payment_status: paymentStatus,
        payload: nextPayload,
      });
    };

    if (upstream) {
      if (upstream.status >= 200 && upstream.status < 300) {
        const body = buildSuccessBody({
          data:
            upstream.data && typeof upstream.data === "object"
              ? upstream.data
              : {},
        });
        await persistPayment(record, body);
        return res.status(200).json(body);
      }
      return res.status(upstream.status).json({
        success: false,
        message:
          upstream.data?.message || "Failed to send payment notification",
        error: upstream.data,
      });
    }

    let updated = record;
    if (record) {
      const body = buildSuccessBody({ local: true });
      await persistPayment(record, body);
      updated = record;
      return res.status(200).json(body);
    } else if (db.NrsEInvoice) {
      // PENDING / REJECTED without prior create — allow minimal local row
      const body = buildSuccessBody({ local: true });
      updated = await db.NrsEInvoice.create({
        business_id: businessId,
        irn,
        payment_status: paymentStatus,
        clearance_status: "UNKNOWN",
        transmission_status: "LOCAL",
        reference: crypto.randomUUID(),
        payload: {
          ...paymentMeta,
          ...(idempotencyKey
            ? {
                last_idempotency_key: idempotencyKey,
                last_idempotency_response: body,
              }
            : {}),
        },
      });
      body.data.irn = updated?.irn || irn;
      return res.status(200).json(body);
    }

    return res.status(200).json(
      buildSuccessBody({ local: true, irn: updated?.irn || irn }),
    );
  } catch (error) {
    console.error("FIRS paymentNotify error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

/**
 * Transmit Invoice
 * POST /api/v1/invoice/transmit/:irn
 *
 * Manually triggers transmission of a specific invoice to NRS by IRN.
 * Response shape:
 *   { "code": 200, "data": { "ok": true } }
 */
exports.transmitInvoice = async (req, res) => {
  try {
    const irn = decodeURIComponent(
      String(req.params.irn || req.params.IRN || "").trim(),
    );
    if (!irn) {
      return res.status(400).json({
        code: 400,
        data: { ok: false },
        message: "IRN is required in the path: POST /api/v1/invoice/transmit/{IRN}",
      });
    }

    const body = req.body || {};
    const businessId = resolveBusinessId(
      { ...body, business_id: body.business_id || req.query?.business_id },
      req,
    );
    if (!businessId) {
      return res.status(400).json({
        code: 400,
        data: { ok: false },
        message:
          "business_id is required (body, query, or OAuth client binding).",
      });
    }

    const authz = ensureBusinessAccess(req, businessId);
    if (!authz.allowed) {
      return res.status(authz.status).json({
        code: authz.status,
        data: { ok: false },
        message:
          authz.status === 401
            ? "Unauthorized"
            : authz.reason ||
              "Forbidden: you may only act on your own business.",
      });
    }

    const record = await findInvoice(businessId, irn);
    if (!record) {
      return res.status(404).json({
        code: 404,
        data: { ok: false },
        message: "Invoice not found for this business_id and irn.",
      });
    }

    const storedPayload = asJsonObject(record.payload);
    const payload = Object.keys(storedPayload).length
      ? storedPayload
      : { business_id: businessId, irn: record.irn };

    const bearer = bearerFromRequest(req);
    const upstream = await proxyToFirs(
      "POST",
      `/transmit/${encodeURIComponent(record.irn)}`,
      payload,
      bearer,
      req.oauth?.environment,
    );

    if (upstream) {
      if (upstream.status >= 200 && upstream.status < 300) {
        await record.update({
          transmission_status: "TRANSMITTED",
          clearance_status:
            record.clearance_status === "ACCEPTED" ||
            record.clearance_status === "UNKNOWN"
              ? "SUBMITTED"
              : record.clearance_status,
          upstream: upstream.data || record.upstream,
        });
        return res.status(200).json({
          code: 200,
          data: { ok: true },
        });
      }
      return res.status(upstream.status).json({
        code: upstream.status,
        data: { ok: false },
        message:
          upstream.data?.message ||
          upstream.data?.error_description ||
          "Failed to transmit invoice to NRS",
        error: upstream.data,
      });
    }

    // SI sandbox: no upstream configured — mark transmitted locally
    await record.update({
      transmission_status: "TRANSMITTED",
      clearance_status:
        record.clearance_status === "UNKNOWN"
          ? "ACCEPTED"
          : record.clearance_status,
    });

    return res.status(200).json({
      code: 200,
      data: { ok: true },
    });
  } catch (error) {
    console.error("FIRS transmitInvoice error:", error);
    return res.status(500).json({
      code: 500,
      data: { ok: false },
      message: error.message || "Internal server error",
    });
  }
};
