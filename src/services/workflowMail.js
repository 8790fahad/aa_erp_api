"use strict";

const { QueryTypes } = require("sequelize");
const db = require("../models");
const {
  sendLiveEmail,
  getLiveMailTransport,
  describeMailSendError,
} = require("../config/mailTransport");
const { mailFrom } = require("../config/mailFrom");
const {
  getEmailBranding,
  buildCompanyMailFooter,
} = require("../config/emailBranding");
const { getPublicFrontendUrl } = require("../config/frontendUrl");

const SUPERUSER_KEYS = ["Administrator", "Super Administrator", "Admin"];

/**
 * Process email channels (Settings → Process Emails).
 * Each process has nested `steps` you can turn on/off independently.
 * Storage keys are `processId.stepId` (e.g. invoice.verification).
 */
const WORKFLOW_MAIL_PROCESSES = [
  {
    id: "invoice",
    label: "Sales invoices",
    steps: [
      {
        id: "actor",
        label: "Person who posted the invoice",
        sentTo: "Confirmation email to the user who created or posted the invoice",
      },
      {
        id: "discount",
        label: "Discount approval",
        sentTo: "Collection Reconciliation (Discount) / Verification Points users",
      },
      {
        id: "credit",
        label: "Credit approval",
        sentTo: "Verification Points (Credit) users",
      },
      {
        id: "deposit",
        label: "Apply deposit",
        sentTo: "Verification Points (Apply Deposit) users",
      },
      {
        id: "payment_mode",
        label: "Payment mode approval",
        sentTo: "Verification Points (Payment Mode) users",
      },
      {
        id: "verification",
        label: "Verification Points / Cashier",
        sentTo: "Cashiers and Verification Points collectors",
      },
      {
        id: "separation",
        label: "Invoice Separation",
        sentTo: "Invoice Separation users",
      },
      {
        id: "warehouse",
        label: "Warehouse Collection",
        sentTo: "Warehouse Collection / Warehouse Requests users",
      },
    ],
  },
  {
    id: "memo",
    label: "Memos",
    steps: [
      {
        id: "actor",
        label: "Person who posted the memo",
        sentTo: "Confirmation email to the user who posted the memo",
      },
      {
        id: "approval",
        label: "Memo approval",
        sentTo: "Internal Audit / Administrative Review / Pending Memos users",
      },
      {
        id: "raiser",
        label: "Memo raiser (returned / rejected / status)",
        sentTo: "The staff member who originally raised the memo",
      },
      {
        id: "bill",
        label: "Bill (after approval)",
        sentTo: "Bill / Create Bill / View Expenses Memos users",
      },
    ],
  },
  {
    id: "purchase_requisition",
    label: "Purchase requisitions",
    steps: [
      {
        id: "actor",
        label: "Person who posted the PR",
        sentTo: "Confirmation email to the user who posted the requisition",
      },
      {
        id: "approval",
        label: "Purchase Order approval",
        sentTo: "Approve Purchase Order / Goods received users",
      },
      {
        id: "bill",
        label: "Bill",
        sentTo: "Bill / Create Bill users",
      },
    ],
  },
  {
    id: "purchase_order",
    label: "Purchase orders",
    steps: [
      {
        id: "actor",
        label: "Person who posted the PO",
        sentTo: "Confirmation email to the user who posted the purchase order",
      },
      {
        id: "approval",
        label: "Approve Purchase Order",
        sentTo: "Approve Purchase Order / Goods received users",
      },
    ],
  },
  {
    id: "goods_transfer",
    label: "Goods transfers",
    steps: [
      {
        id: "actor",
        label: "Person who posted the transfer",
        sentTo: "Confirmation email to the user who posted the transfer",
      },
      {
        id: "approval",
        label: "Pending Approvals",
        sentTo: "Pending Approvals / Goods users",
      },
    ],
  },
  {
    id: "journal",
    label: "Journal entries",
    steps: [
      {
        id: "actor",
        label: "Person who posted the journal",
        sentTo: "Confirmation email to the user who posted the journal",
      },
      {
        id: "next",
        label: "Journal Entries queue",
        sentTo: "Journal Entries users who need to post or view it",
      },
    ],
  },
  {
    id: "production",
    label: "Production",
    steps: [
      {
        id: "actor",
        label: "Person who posted production",
        sentTo: "Confirmation email to the user who posted production",
      },
      {
        id: "price_setup",
        label: "Price Setup",
        sentTo: "Price Setup users for costing follow-up",
      },
    ],
  },
  {
    id: "payroll",
    label: "Payroll",
    steps: [
      {
        id: "actor",
        label: "Person who ran payroll",
        sentTo: "Confirmation email to the user who ran or posted payroll",
      },
      {
        id: "confirm",
        label: "Payroll History / confirm",
        sentTo: "Payroll History / Processing users",
      },
      {
        id: "payment",
        label: "Payroll Payment",
        sentTo: "Payroll Payment users",
      },
    ],
  },
  {
    id: "credit_note",
    label: "Credit notes",
    steps: [
      {
        id: "actor",
        label: "Person who posted the credit note",
        sentTo: "Confirmation email to the user who posted the credit note",
      },
      {
        id: "next",
        label: "Credit Notes queue",
        sentTo: "Credit Notes users",
      },
    ],
  },
  {
    id: "price_update",
    label: "Price updates",
    steps: [
      {
        id: "actor",
        label: "Person who changed prices",
        sentTo: "Confirmation email to the user who updated prices",
      },
      {
        id: "next",
        label: "Price Setup / Sales",
        sentTo: "Price Setup, Make sales, Invoices, and Products users",
      },
    ],
  },
  {
    id: "deposit_git",
    label: "Deposit to GIT",
    steps: [
      {
        id: "actor",
        label: "Person who posted the deposit",
        sentTo: "Confirmation email to the user who posted the deposit",
      },
      {
        id: "pay_bills",
        label: "Pay Bills",
        sentTo: "Pay Bills / Create Bill users",
      },
    ],
  },
  {
    id: "rebate",
    label: "Rebates",
    steps: [
      {
        id: "actor",
        label: "Person who posted the rebate",
        sentTo: "Confirmation email to the user who posted the rebate",
      },
      {
        id: "next",
        label: "Next rebate step",
        sentTo: "Users on the next rebate action",
      },
    ],
  },
  {
    id: "vat_return",
    label: "VAT return reminders",
    steps: [
      {
        id: "next",
        label: "VAT return owners",
        sentTo: "Users responsible for the VAT return / next VAT action",
      },
    ],
  },
];

const PROCESS_IDS = new Set(WORKFLOW_MAIL_PROCESSES.map((p) => p.id));

function allStepKeys() {
  const keys = [];
  for (const p of WORKFLOW_MAIL_PROCESSES) {
    for (const s of p.steps || []) {
      keys.push(`${p.id}.${s.id}`);
    }
  }
  return keys;
}

const STEP_KEYS = new Set(allStepKeys());

function documentTypeToProcessId(documentType) {
  const t = String(documentType || "")
    .trim()
    .toLowerCase();
  if (!t) return null;
  if (t.includes("invoice")) return "invoice";
  if (t.includes("memo")) return "memo";
  if (t.includes("purchase requisition") || t === "pr") {
    return "purchase_requisition";
  }
  if (t.includes("purchase order") || t === "po") return "purchase_order";
  if (t.includes("goods transfer")) return "goods_transfer";
  if (t.includes("journal")) return "journal";
  if (t.includes("production")) return "production";
  if (t.includes("payroll")) return "payroll";
  if (t.includes("credit")) return "credit_note";
  if (t.includes("price")) return "price_update";
  if (t.includes("deposit") || t.includes("git")) return "deposit_git";
  if (t.includes("rebate")) return "rebate";
  if (t.includes("vat")) return "vat_return";
  return null;
}

function defaultProcessMap() {
  const map = {};
  for (const key of STEP_KEYS) map[key] = true;
  return map;
}

function isTruthyFlag(v) {
  return !(v === false || v === 0 || v === "0" || v === "false");
}

function normalizeProcessMap(raw) {
  const base = defaultProcessMap();
  if (raw == null || raw === "") return base;
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      return base;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return base;
  }

  // Legacy: parent process id alone → apply to every nested step
  for (const process of WORKFLOW_MAIL_PROCESSES) {
    if (!Object.prototype.hasOwnProperty.call(parsed, process.id)) continue;
    const parentOn = isTruthyFlag(parsed[process.id]);
    for (const step of process.steps || []) {
      base[`${process.id}.${step.id}`] = parentOn;
    }
  }

  for (const key of STEP_KEYS) {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      base[key] = isTruthyFlag(parsed[key]);
    }
  }
  return base;
}

function stepStorageKey(processId, stepId) {
  if (!processId || !stepId) return null;
  return `${processId}.${stepId}`;
}

const NEXT_STEP_BY_STATUS = {
  pending: {
    moduleTitles: ["Initiate Memo", "Internal Audit", "Pending Memos"],
    nextLabel: "Memo approval",
    actionPath: "/app/account/initiate-memo",
    actionVerb: "review",
    mailStepId: "approval",
  },
  requested: {
    moduleTitles: ["Initiate Memo", "Internal Audit", "Pending Memos"],
    nextLabel: "Memo approval",
    actionPath: "/app/account/initiate-memo",
    actionVerb: "review",
    mailStepId: "approval",
  },
  reviewed: {
    moduleTitles: ["Initiate Memo", "Administrative Review"],
    nextLabel: "Memo approval",
    actionPath: "/app/account/initiate-memo",
    actionVerb: "approve",
    mailStepId: "approval",
  },
  verified: {
    moduleTitles: ["Initiate Memo", "Administrative Review"],
    nextLabel: "Memo approval",
    actionPath: "/app/account/initiate-memo",
    actionVerb: "approve",
    mailStepId: "approval",
  },
  returned: {
    moduleTitles: ["Initiate Memo"],
    nextLabel: "Initiate Memo",
    actionPath: "/app/account/initiate-memo",
    actionVerb: "update",
    notifyRaiser: true,
    mailStepId: "raiser",
  },
  rejected: {
    moduleTitles: ["Initiate Memo"],
    nextLabel: "Initiate Memo",
    actionPath: "/app/account/initiate-memo",
    actionVerb: "review",
    notifyRaiser: true,
    mailStepId: "raiser",
  },
  approved: {
    moduleTitles: ["Bill", "Billing Expense", "Create Bill", "View Expenses Memos"],
    nextLabel: "Bill",
    actionPath: "/app/expenses/billing",
    actionVerb: "bill",
    notifyRaiser: true,
    mailStepId: "bill",
  },
  completed: {
    moduleTitles: [],
    nextLabel: null,
    actionPath: "/app/account/initiate-memo",
    actionVerb: "view",
    notifyRaiser: true,
    mailStepId: "raiser",
  },
};

const WORKFLOW_NEXT = {
  productionCosting: {
    moduleTitles: ["Price Setup"],
    nextLabel: "Price Setup",
    actionPath: "/app/sales/price-setup",
    actionVerb: "cost",
    mailStepId: "price_setup",
  },
  purchaseBilling: {
    moduleTitles: ["Bill", "Billing Expense", "Create Bill"],
    nextLabel: "Bill",
    actionPath: "/app/expenses/billing",
    actionVerb: "bill",
    mailStepId: "bill",
  },
  purchaseApproval: {
    moduleTitles: ["Approve Purchase Order", "Goods received"],
    nextLabel: "Approve Purchase Order",
    actionPath: "/app/purchase/purchase-requisition",
    actionVerb: "approve",
    mailStepId: "approval",
  },
  goodsTransferApproval: {
    moduleTitles: ["Pending Approvals", "Goods"],
    nextLabel: "Pending Approvals",
    actionPath: "/app/purchase/inventory?tab=goods-transfer",
    actionVerb: "approve",
    mailStepId: "approval",
  },
  journalPosting: {
    moduleTitles: ["Journal Entries"],
    nextLabel: "Journal Entries",
    actionPath: "/app/account/journal-entries",
    actionVerb: "post",
    mailStepId: "next",
  },
  journalView: {
    moduleTitles: ["Journal Entries"],
    nextLabel: "Journal Entries",
    actionPath: "/app/account/journal-entries",
    actionVerb: "view",
    mailStepId: "next",
  },
  invoiceList: {
    moduleTitles: ["Invoice List"],
    nextLabel: "Invoice List",
    actionPath: "/app/sales/invoices",
    actionVerb: "view",
    mailStepId: "verification",
  },
  payrollConfirm: {
    moduleTitles: [
      "Payroll Payment",
      "Payroll History",
      "Payroll Processing",
      "Run Payroll",
    ],
    nextLabel: "Payroll History",
    actionPath: "/app/admin/hr/payroll?tab=history",
    actionVerb: "confirm",
    mailStepId: "confirm",
  },
  payrollPayment: {
    moduleTitles: ["Payroll Payment", "Payroll Processing"],
    nextLabel: "Payroll Payment",
    actionPath: "/app/admin/hr/payroll?tab=payment",
    actionVerb: "pay",
    mailStepId: "payment",
  },
  payrollHistory: {
    moduleTitles: [
      "Payroll History",
      "Payroll Payment",
      "Payroll Processing",
    ],
    nextLabel: "Payroll History",
    actionPath: "/app/admin/hr/payroll?tab=history",
    actionVerb: "view",
    mailStepId: "confirm",
  },
  creditNote: {
    moduleTitles: ["Credit Notes", "Credit & Debit Note", "Credit Note"],
    nextLabel: "Credit Notes",
    actionPath: "/app/payments/credit-note/party-customer",
    actionVerb: "view",
    mailStepId: "next",
  },
  priceUpdate: {
    moduleTitles: ["Price Setup", "Make sales", "Invoices", "Products"],
    nextLabel: "Price Setup",
    actionPath: "/app/sales/price-setup",
    actionVerb: "review",
    mailStepId: "next",
  },
  depositToGit: {
    moduleTitles: ["Pay Bills", "Pay Bill", "See All Pay Bills", "Create Bill"],
    nextLabel: "Pay Bills",
    actionPath: "/app/payments/pay-bills",
    actionVerb: "review",
    mailStepId: "pay_bills",
  },
};

function nextStepForSaleStatus(status, paymentType) {
  const s = String(status || "")
    .trim()
    .toLowerCase();
  const pt = String(paymentType || "")
    .trim()
    .toLowerCase();

  if (s === "awaiting_discount_approval") {
    return {
      moduleTitles: [
        "Collection Reconciliation",
        "Discount Collection",
        "Verification Points",
        "Collection Points",
      ],
      nextLabel: "Collection Reconciliation (Discount)",
      actionPath: "/app/payments/collection-reconciliation?tab=discount",
      actionVerb: "approve the discount on",
      mailStepId: "discount",
    };
  }
  if (s === "awaiting_credit_approval") {
    return {
      moduleTitles: [
        "Verification Points",
        "Credit Collection",
        "Collection Points",
      ],
      nextLabel: "Verification Points (Credit)",
      actionPath: "/app/payments/verification-points",
      actionVerb: "approve credit for",
      mailStepId: "credit",
    };
  }
  if (s === "awaiting_payment") {
    if (pt === "apply_credit" || pt === "apply credit") {
      return {
        moduleTitles: [
          "Verification Points",
          "Apply Credit",
          "Collection Points",
        ],
        nextLabel: "Verification Points (Apply Credit)",
        actionPath: "/app/payments/verification-points?tab=deposit",
        actionVerb: "apply credit to",
      };
    }
    return {
      moduleTitles: [
        "Verification Points",
        "Apply Deposit",
        "Collection Points",
      ],
      nextLabel: "Verification Points (Apply Deposit)",
      actionPath: "/app/payments/verification-points?tab=deposit",
      actionVerb: "apply deposit to",
      mailStepId: "deposit",
    };
  }
  if (s === "awaiting_payment_mode_approval") {
    return {
      moduleTitles: [
        "Verification Points",
        "Switch Payment Mode",
        "Collection Points",
      ],
      nextLabel: "Verification Points (Payment Mode)",
      actionPath: "/app/payments/verification-points",
      actionVerb: "approve the payment mode for",
      mailStepId: "payment_mode",
    };
  }
  if (s === "awaiting_cashier_confirm" || s === "awaiting_payment_method") {
    const titles = [
      "Verification Points",
      "Collection Points",
      "Cashier",
    ];
    if (pt === "cash") titles.push("Cash Collection");
    else if (pt === "transfer" || pt === "bank") titles.push("Transfer Collection");
    else if (pt === "card") titles.push("POS Collection", "Card Collection");
    else {
      titles.push(
        "Cash Collection",
        "Transfer Collection",
        "POS Collection",
        "Card Collection",
      );
    }
    return {
      moduleTitles: titles,
      nextLabel: "Verification Points",
      actionPath: "/app/payments/verification-points",
      actionVerb: "collect payment for",
      mailStepId: "verification",
    };
  }
  if (
    s === "invoice_separation" ||
    s === "payment_confirmed" ||
    s === "credit_approved"
  ) {
    return {
      moduleTitles: ["Invoice Separation", "Separation"],
      nextLabel: "Invoice Separation",
      actionPath: "/app/sales/separation",
      actionVerb: "separate",
      mailStepId: "separation",
    };
  }
  if (
    s === "warehouse_picking" ||
    s === "final_invoice" ||
    s === "dual_signature" ||
    s === "goods_released"
  ) {
    return {
      moduleTitles: ["Warehouse Collection", "Warehouse Requests"],
      nextLabel: "Warehouse Collection",
      actionPath: "/app/sales/warehouse-requests",
      actionVerb: "collect",
      mailStepId: "warehouse",
    };
  }
  if (s === "completed") {
    return {
      moduleTitles: [],
      nextLabel: null,
      actionPath: "/app/sales/invoices",
      actionVerb: "view",
      mailStepId: null,
    };
  }
  return { ...WORKFLOW_NEXT.invoiceList, mailStepId: "verification" };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function displayName(user) {
  const name = `${user?.firstname || ""} ${user?.lastname || ""}`.trim();
  return name || user?.fullname || "there";
}

function parsePrivilegeList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  const raw = String(value || "").trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch (_) {
      // fall through to comma split
    }
  }
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function listIncludesTitle(list, title) {
  const wanted = String(title || "")
    .trim()
    .toLowerCase();
  if (!wanted) return false;
  return (Array.isArray(list) ? list : []).some(
    (item) => String(item).trim().toLowerCase() === wanted,
  );
}

function isSuperuser(functionalities, accessTo) {
  return SUPERUSER_KEYS.some(
    (key) => listIncludesTitle(functionalities, key) || listIncludesTitle(accessTo, key),
  );
}

function isSuspended(status) {
  const normalized = String(status || "")
    .trim()
    .toLowerCase();
  return ["suspended", "inactive", "rejected", "disabled"].includes(normalized);
}

function asStringId(value) {
  if (value == null || value === "") return "";
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return String(value);
}

function stepForStatus(status) {
  return NEXT_STEP_BY_STATUS[String(status || "").trim().toLowerCase()] || null;
}

function actionUrl(path) {
  const base = getPublicFrontendUrl().replace(/\/$/, "");
  const suffix = String(path || "/app");
  return `${base}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}

async function getUserById(userId) {
  const id = asStringId(userId);
  if (!id) return null;
  const rows = await db.sequelize.query(
    `SELECT id, email, firstname, lastname, status
     FROM users
     WHERE id = :id
        OR CONVERT(id USING utf8mb4) = CONVERT(:id USING utf8mb4)
     LIMIT 1`,
    { replacements: { id }, type: QueryTypes.SELECT },
  );
  return rows[0] || null;
}

function membershipHasPrivilege(row, titles) {
  const funcs = parsePrivilegeList(row.functionalities);
  const access = parsePrivilegeList(row.access_to);
  const role = String(row.role || "").trim();
  if (isSuperuser(funcs, access)) return true;
  if (titles.some((title) => listIncludesTitle(funcs, title) || listIncludesTitle(access, title))) {
    return true;
  }
  if (role && titles.some((title) => String(title).trim().toLowerCase() === role.toLowerCase())) {
    return true;
  }
  return false;
}

async function getUsersWithPrivilegeAccess(
  businessId,
  moduleTitles,
  extraUserIds = [],
) {
  const titles = (Array.isArray(moduleTitles) ? moduleTitles : [moduleTitles])
    .map((title) => String(title || "").trim())
    .filter(Boolean);
  const extras = (Array.isArray(extraUserIds) ? extraUserIds : [extraUserIds])
    .map((id) => asStringId(id))
    .filter(Boolean);
  if (!businessId || (!titles.length && !extras.length)) return [];

  const memberships = await db.sequelize.query(
    `SELECT user_id, access_to, functionalities, role
     FROM membership
     WHERE business_id = :businessId
        OR CONVERT(business_id USING utf8mb4) = CONVERT(:businessId USING utf8mb4)`,
    { replacements: { businessId: String(businessId) }, type: QueryTypes.SELECT },
  );

  const matched = (memberships || []).filter((row) => {
    const uid = asStringId(row.user_id);
    if (uid && extras.includes(uid)) return true;
    return titles.length ? membershipHasPrivilege(row, titles) : false;
  });

  const extraOnly = extras.filter(
    (id) => !matched.some((row) => asStringId(row.user_id) === id),
  );

  const userIds = [
    ...new Set(
      [...matched.map((row) => asStringId(row.user_id)), ...extraOnly].filter(Boolean),
    ),
  ];
  if (!userIds.length) return [];

  const users = await db.sequelize.query(
    `SELECT id, email, firstname, lastname, status
     FROM users
     WHERE id IN (:userIds)`,
    { replacements: { userIds }, type: QueryTypes.SELECT },
  );

  const usersById = new Map();
  for (const user of users || []) {
    const uid = asStringId(user.id);
    if (uid) usersById.set(uid, user);
  }

  const recipients = [];
  const seen = new Set();
  for (const id of userIds) {
    const user = usersById.get(id);
    const email = String(user?.email || "")
      .trim()
      .toLowerCase();
    if (!email || seen.has(email) || isSuspended(user?.status)) continue;
    seen.add(email);
    recipients.push({
      id: user?.id || id,
      email: user.email,
      firstname: user.firstname || "",
      lastname: user.lastname || "",
    });
  }
  return recipients;
}

function wrapMailHtml({ firstName, intro, body, ctaLabel, ctaUrl, extra }) {
  const branding = getEmailBranding();
  const product = branding.companyName || "AA ERP";
  return `
    <div style="background-color:#f5f5f7;padding:24px 0;font-family:Arial,sans-serif;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.06);">
        <div style="padding:20px 24px 0 24px;">
          <img src="${escapeHtml(branding.companyLogoUrl)}" alt="${escapeHtml(product)}" style="display:block;height:32px;width:auto;object-fit:contain;" />
        </div>
        <div style="padding:24px 24px 16px 24px;">
          <h2 style="margin:0 0 16px;font-size:22px;color:#111;">Hi ${escapeHtml(firstName)}!</h2>
          <p style="margin:0 0 12px;font-size:14px;color:#333;line-height:1.6;">
            ${intro}
          </p>
          ${body || ""}
          ${extra || ""}
          ${
            ctaUrl
              ? `<div style="text-align:center;margin:24px 0 8px;">
                  <a href="${escapeHtml(ctaUrl)}"
                     style="display:inline-block;background:#4267B2;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
                    ${escapeHtml(ctaLabel || `Open in ${product}`)}
                  </a>
                </div>`
              : ""
          }
          <p style="margin:24px 0 8px;font-size:13px;color:#555;">
            With respect,<br/>
            <strong>${escapeHtml(product)} Team</strong>
          </p>
        </div>
        ${buildCompanyMailFooter(branding)}
      </div>
    </div>
  `;
}

function buildDetailsTable(rows = []) {
  const html = rows
    .filter(
      ([, value]) =>
        value !== undefined && value !== null && String(value).trim() !== "",
    )
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:8px 0;color:#666;width:40%;font-size:14px;">${escapeHtml(label)}</td>
          <td style="padding:8px 0;color:#111;font-size:14px;font-weight:600;">${escapeHtml(value)}</td>
        </tr>`,
    )
    .join("");
  return `<table style="width:100%;border-collapse:collapse;margin:16px 0;">${html}</table>`;
}

let workflowMailColReady = false;
async function ensureWorkflowMailColumn() {
  if (workflowMailColReady) return;
  try {
    const cols = await db.sequelize.query("SHOW COLUMNS FROM business", {
      type: QueryTypes.SELECT,
    });
    const have = new Set(
      (cols || []).map((c) => String(c.Field || c.field || "")),
    );
    if (!have.has("workflow_mail_enabled")) {
      await db.sequelize.query(
        `ALTER TABLE business ADD COLUMN workflow_mail_enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Process workflow emails on/off'`,
      );
    }
    if (!have.has("workflow_mail_processes")) {
      await db.sequelize.query(
        `ALTER TABLE business ADD COLUMN workflow_mail_processes JSON NULL COMMENT 'Per-process email toggles (JSON object)'`,
      );
    }
    workflowMailColReady = true;
  } catch (err) {
    console.warn("[workflowMail] ensureWorkflowMailColumn:", err.message);
  }
}

/**
 * Business setting: process emails.
 * processKey can be a parent id (`invoice`) or a step key (`invoice.verification`).
 * Master off disables all; missing step defaults to on when master is on.
 */
async function isWorkflowMailEnabled(facilityId, processKey = null) {
  if (!facilityId) return true;
  try {
    await ensureWorkflowMailColumn();
    const rows = await db.sequelize.query(
      `SELECT workflow_mail_enabled, workflow_mail_processes
       FROM business WHERE id = :facilityId LIMIT 1`,
      {
        replacements: { facilityId: String(facilityId) },
        type: QueryTypes.SELECT,
      },
    );
    if (!rows?.length) return true;
    const raw = rows[0].workflow_mail_enabled;
    if (raw === false || raw === 0 || raw === "0") return false;
    if (!processKey) return true;
    const key = String(processKey).trim();
    const map = normalizeProcessMap(rows[0].workflow_mail_processes);
    if (STEP_KEYS.has(key)) return map[key] !== false;
    if (PROCESS_IDS.has(key)) {
      const process = WORKFLOW_MAIL_PROCESSES.find((p) => p.id === key);
      const steps = process?.steps || [];
      if (!steps.length) return true;
      return steps.some((s) => map[`${key}.${s.id}`] !== false);
    }
    return true;
  } catch (err) {
    console.warn("[workflowMail] isWorkflowMailEnabled:", err.message);
    return true;
  }
}

async function isWorkflowMailStepEnabled(facilityId, processId, stepId) {
  if (!processId || !stepId) {
    return isWorkflowMailEnabled(facilityId, processId || null);
  }
  return isWorkflowMailEnabled(facilityId, stepStorageKey(processId, stepId));
}

async function sendHtmlMail({ to, subject, html, category }) {
  try {
    await sendLiveEmail({ to, subject, html, category });
    return;
  } catch (err) {
    const msg = String(err?.message || err || "");
    if (!/MAILTRAP_TOKEN is not set/i.test(msg)) {
      try {
        const { transport } = getLiveMailTransport();
        await transport.sendMail({
          from: mailFrom(),
          to,
          subject,
          html,
        });
        return;
      } catch (fallbackErr) {
        const detail = describeMailSendError(fallbackErr);
        throw new Error(detail || fallbackErr.message || msg);
      }
    }
    const { transport } = getLiveMailTransport();
    await transport.sendMail({
      from: mailFrom(),
      to,
      subject,
      html,
    });
  }
}

async function notifyInAppNextStep({
  facilityId,
  recipients,
  actorUserId,
  type,
  title,
  body,
  link,
  entityType,
  entityId,
}) {
  if (!recipients?.length) return;
  try {
    const { notifySpecificUsers } = require("./notifications");
    await notifySpecificUsers({
      facilityId,
      userIds: recipients.map((user) => user.id).filter(Boolean),
      actorUserId,
      type,
      title,
      body,
      link,
      entityType,
      entityId,
    });
  } catch (err) {
    console.warn("[workflowMail] in-app notify skipped:", err?.message || err);
  }
}

/**
 * Email the actor, then everyone with permission on the next page/link.
 */
async function notifyWorkflowPosting({
  facilityId,
  actorUserId,
  documentId,
  documentType,
  details = [],
  remark = "",
  nextStep,
  extraUserIds = [],
  inAppType = "workflow",
  eventLabel = "posted",
  actorIntro = null,
  nextIntro = null,
} = {}) {
  try {
    if (!facilityId || !documentId || !documentType) return;

    const processId = documentTypeToProcessId(documentType);
    const actorMailOn = await isWorkflowMailStepEnabled(
      facilityId,
      processId,
      "actor",
    );
    const nextMailOn = nextStep?.mailStepId
      ? await isWorkflowMailStepEnabled(
          facilityId,
          processId,
          nextStep.mailStepId,
        )
      : false;
    const actor = await getUserById(actorUserId);
    const detailsTable = buildDetailsTable(details);
    const remarkHtml = remark
      ? `<p style="margin:0 0 12px;font-size:14px;color:#333;line-height:1.6;"><strong>Remark:</strong> ${escapeHtml(remark)}</p>`
      : "";
    const actorEmailsSent = new Set();
    const nextLine = nextStep?.nextLabel
      ? `It has been sent to <strong>${escapeHtml(nextStep.nextLabel)}</strong> for the next action.`
      : "";
    const typeLabel = String(documentType);
    const verb = String(eventLabel || "posted");
    const actorHtmlIntro =
      actorIntro ||
      `Your ${escapeHtml(typeLabel.toLowerCase())} <strong>${escapeHtml(documentId)}</strong> has been ${escapeHtml(verb)} successfully. ${nextLine}`;
    const nextHtmlIntro =
      nextIntro ||
      `A ${escapeHtml(typeLabel.toLowerCase())} is waiting in <strong>${escapeHtml(nextStep?.nextLabel || "your queue")}</strong>. Please ${escapeHtml(nextStep?.actionVerb || "action")} it.`;

    if (actorMailOn && actor?.email && !isSuspended(actor.status)) {
      await sendHtmlMail({
        to: actor.email,
        subject: `${typeLabel} ${documentId} ${verb}`,
        category: `${typeLabel} ${verb} confirmation`,
        html: wrapMailHtml({
          firstName: displayName(actor),
          intro: actorHtmlIntro,
          body: detailsTable,
          extra: remarkHtml,
          ctaLabel: `View ${typeLabel.toLowerCase()}`,
          ctaUrl: actionUrl(nextStep?.actionPath || "/app"),
        }),
      });
      actorEmailsSent.add(String(actor.email).trim().toLowerCase());
    }

    const nextRecipients = nextStep?.moduleTitles?.length || extraUserIds?.length
      ? await getUsersWithPrivilegeAccess(
          facilityId,
          nextStep?.moduleTitles || [],
          extraUserIds,
        )
      : [];

    if (nextMailOn) {
      const nextMails = nextRecipients
        .filter((user) => {
          const email = String(user.email || "")
            .trim()
            .toLowerCase();
          return email && !actorEmailsSent.has(email);
        })
        .map((user) =>
          sendHtmlMail({
            to: user.email,
            subject: `${typeLabel} ${documentId} needs your ${nextStep?.actionVerb || "action"}`,
            category: `${typeLabel} Next Step`,
            html: wrapMailHtml({
              firstName: displayName(user),
              intro: nextHtmlIntro,
              body: detailsTable,
              extra: remarkHtml,
              ctaLabel: `Open ${nextStep?.nextLabel || typeLabel}`,
              ctaUrl: actionUrl(nextStep?.actionPath || "/app"),
            }),
          }),
        );

      const results = await Promise.allSettled(nextMails);
      const failed = results.filter((result) => result.status === "rejected");
      if (failed.length) {
        console.error(
          `[workflowMail] ${failed.length} ${typeLabel} next-step email(s) failed for ${documentId}`,
          failed.map((result) => result.reason?.message || result.reason),
        );
      }
    }

    await notifyInAppNextStep({
      facilityId,
      recipients: nextRecipients.filter((user) => {
        const id = asStringId(user.id);
        return id && id !== asStringId(actorUserId);
      }),
      actorUserId,
      type: String(inAppType).slice(0, 40),
      title: `${typeLabel} ${documentId} needs ${nextStep?.actionVerb || "action"}`,
      body: nextStep?.nextLabel
        ? `Waiting in ${nextStep.nextLabel}`
        : `${typeLabel} ${verb}`,
      link: nextStep?.actionPath || null,
      entityType: String(typeLabel).toLowerCase().replace(/\s+/g, "_"),
      entityId: documentId,
    });
  } catch (error) {
    console.error(
      `[workflowMail] Failed to send ${documentType} ${eventLabel} emails:`,
      error?.message || error,
    );
  }
}

async function notifySaleWorkflow({
  facilityId,
  actorUserId,
  saleCode,
  status,
  paymentType,
  customerName,
  amount,
  assignedCashierId = null,
  remark = "",
  eventLabel = "posted",
  details = [],
} = {}) {
  if (!facilityId || !saleCode) return;
  const nextStep = nextStepForSaleStatus(status, paymentType);
  const extraDetails = details.length
    ? details
    : [
        ["Invoice", saleCode],
        ["Customer", customerName],
        ["Payment type", paymentType],
        ["Amount", amount != null ? formatAmount(amount) : ""],
        ["Status", status],
      ];
  return notifyWorkflowPosting({
    facilityId,
    actorUserId,
    documentId: saleCode,
    documentType: "Invoice",
    details: extraDetails,
    remark,
    nextStep,
    extraUserIds: assignedCashierId ? [assignedCashierId] : [],
    inAppType: "invoice_workflow",
    eventLabel,
  });
}

async function loadMemo(memoId, facilityId) {
  if (!memoId) return null;
  const rows = await db.sequelize.query(
    facilityId
      ? `SELECT * FROM memo WHERE memo_id = :memoId AND facilityId = :facilityId LIMIT 1`
      : `SELECT * FROM memo WHERE memo_id = :memoId LIMIT 1`,
    {
      replacements: { memoId, facilityId: facilityId || "" },
      type: QueryTypes.SELECT,
    },
  );
  return rows[0] || null;
}

async function notifyMemoWorkflow({
  facilityId,
  memoId,
  status,
  actorUserId,
  remark = "",
  memoSnapshot = {},
} = {}) {
  try {
    if (!memoId) return;

    const stored = await loadMemo(memoId, facilityId);
    const memo = {
      ...(stored || {}),
      ...memoSnapshot,
      memo_id: memoId,
      status: status || memoSnapshot.status || stored?.status,
      facilityId: facilityId || memoSnapshot.facilityId || stored?.facilityId,
    };
    const businessId = memo.facilityId;
    if (!businessId) {
      console.warn("[workflowMail] Skipping memo mail; missing facilityId for", memoId);
      return;
    }

    const step = stepForStatus(memo.status) || NEXT_STEP_BY_STATUS.pending;
    const actor = await getUserById(actorUserId || memo.user_id);
    const raiser = memo.user_id ? await getUserById(memo.user_id) : null;
    const amount = memo.total || memo.amount || 0;
    const detailsTable = buildDetailsTable([
      ["Memo ID", memo.memo_id],
      ["Subject", memo.subject],
      ["Raised by", memo.raise_by],
      ["Department / Branch", memo.from_name],
      ["Supplier", memo.supplier_name],
      ["Amount", formatAmount(amount)],
      ["Priority", memo.priority],
      ["Status", memo.status],
      ["Date", memo.date],
    ]);
    const remarkHtml = remark
      ? `<p style="margin:0 0 12px;font-size:14px;color:#333;line-height:1.6;"><strong>Remark:</strong> ${escapeHtml(remark)}</p>`
      : "";

    const actorMailOn = await isWorkflowMailStepEnabled(
      businessId,
      "memo",
      "actor",
    );
    const nextStepId = step?.mailStepId || "approval";
    const nextMailOn = await isWorkflowMailStepEnabled(
      businessId,
      "memo",
      nextStepId,
    );
    const raiserMailOn = await isWorkflowMailStepEnabled(
      businessId,
      "memo",
      "raiser",
    );
    const actorEmailsSent = new Set();

    if (actorMailOn && actor?.email && !isSuspended(actor.status)) {
      const nextLine = step?.nextLabel
        ? `It has been sent to <strong>${escapeHtml(step.nextLabel)}</strong> for the next action.`
        : "There is no further approval queue for this memo.";
      await sendHtmlMail({
        to: actor.email,
        subject: `Memo ${memo.memo_id} ${step?.nextLabel ? "posted" : "updated"}`,
        category: "Memo Posting Confirmation",
        html: wrapMailHtml({
          firstName: displayName(actor),
          intro: `Your memo <strong>${escapeHtml(memo.memo_id)}</strong> has been posted successfully. ${nextLine}`,
          body: detailsTable,
          extra: remarkHtml,
          ctaLabel: "View memo",
          ctaUrl: actionUrl(step?.actionPath || "/app/account/initiate-memo"),
        }),
      });
      actorEmailsSent.add(String(actor.email).trim().toLowerCase());
    }

    const nextRecipients = step?.moduleTitles?.length
      ? await getUsersWithPrivilegeAccess(businessId, step.moduleTitles)
      : [];

    const nextMails = [];
    if (nextMailOn) {
      nextMails.push(
        ...nextRecipients
          .filter((user) => {
            const email = String(user.email || "")
              .trim()
              .toLowerCase();
            return email && !actorEmailsSent.has(email);
          })
          .map((user) =>
            sendHtmlMail({
              to: user.email,
              subject: `Memo ${memo.memo_id} needs your ${step.actionVerb}`,
              category: "Memo Next Step",
              html: wrapMailHtml({
                firstName: displayName(user),
                intro: `A memo is waiting in <strong>${escapeHtml(step.nextLabel)}</strong>. Please ${escapeHtml(step.actionVerb)} it.`,
                body: detailsTable,
                extra: remarkHtml,
                ctaLabel: `${step.actionVerb.charAt(0).toUpperCase()}${step.actionVerb.slice(1)} memo`,
                ctaUrl: actionUrl(step.actionPath),
              }),
            }),
          ),
      );
    }

    if (
      raiserMailOn &&
      step?.notifyRaiser &&
      raiser?.email &&
      !isSuspended(raiser.status)
    ) {
      const raiserEmail = String(raiser.email).trim().toLowerCase();
      const alreadyNotified =
        actorEmailsSent.has(raiserEmail) ||
        nextRecipients.some(
          (user) =>
            String(user.email || "").trim().toLowerCase() === raiserEmail,
        );
      if (!alreadyNotified) {
        const statusLabel = String(memo.status || "updated");
        nextMails.push(
          sendHtmlMail({
            to: raiser.email,
            subject: `Memo ${memo.memo_id} was ${statusLabel}`,
            category: "Memo Status Update",
            html: wrapMailHtml({
              firstName: displayName(raiser),
              intro: `Your memo <strong>${escapeHtml(memo.memo_id)}</strong> has been <strong>${escapeHtml(statusLabel)}</strong>.`,
              body: detailsTable,
              extra: remarkHtml,
              ctaLabel: "View memo",
              ctaUrl: actionUrl("/app/account/initiate-memo"),
            }),
          }),
        );
      }
    }

    if (nextMails.length) {
      const results = await Promise.allSettled(nextMails);
      const failed = results.filter((result) => result.status === "rejected");
      if (failed.length) {
        console.error(
          `[workflowMail] ${failed.length} memo next-step email(s) failed for ${memo.memo_id}`,
          failed.map((result) => result.reason?.message || result.reason),
        );
      }
    }

    await notifyInAppNextStep({
      facilityId: businessId,
      recipients: nextRecipients.filter(
        (user) => asStringId(user.id) !== asStringId(actorUserId || memo.user_id),
      ),
      actorUserId: actorUserId || memo.user_id,
      type: "memo_workflow",
      title: `Memo ${memo.memo_id} needs ${step?.actionVerb || "action"}`,
      body: step?.nextLabel ? `Waiting in ${step.nextLabel}` : String(memo.status || ""),
      link: step?.actionPath || "/app/account/initiate-memo",
      entityType: "memo",
      entityId: memo.memo_id,
    });
  } catch (error) {
    console.error("[workflowMail] Failed to send memo posting emails:", error?.message || error);
  }
}

module.exports = {
  notifyMemoWorkflow,
  notifyWorkflowPosting,
  notifySaleWorkflow,
  nextStepForSaleStatus,
  getUsersWithPrivilegeAccess,
  isWorkflowMailEnabled,
  isWorkflowMailStepEnabled,
  WORKFLOW_NEXT,
  WORKFLOW_MAIL_PROCESSES,
  documentTypeToProcessId,
  normalizeProcessMap,
  defaultProcessMap,
  sendHtmlMail,
  wrapMailHtml,
  escapeHtml,
  buildDetailsTable,
};
