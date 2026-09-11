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

const NEXT_STEP_BY_STATUS = {
  pending: {
    moduleTitles: ["Initiate Memo", "Internal Audit", "Pending Memos"],
    nextLabel: "Memo approval",
    actionPath: "/app/account/initiate-memo",
    actionVerb: "review",
  },
  requested: {
    moduleTitles: ["Initiate Memo", "Internal Audit", "Pending Memos"],
    nextLabel: "Memo approval",
    actionPath: "/app/account/initiate-memo",
    actionVerb: "review",
  },
  reviewed: {
    moduleTitles: ["Initiate Memo", "Administrative Review"],
    nextLabel: "Memo approval",
    actionPath: "/app/account/initiate-memo",
    actionVerb: "approve",
  },
  verified: {
    moduleTitles: ["Initiate Memo", "Administrative Review"],
    nextLabel: "Memo approval",
    actionPath: "/app/account/initiate-memo",
    actionVerb: "approve",
  },
  returned: {
    moduleTitles: ["Initiate Memo"],
    nextLabel: "Initiate Memo",
    actionPath: "/app/account/initiate-memo",
    actionVerb: "update",
    notifyRaiser: true,
  },
  rejected: {
    moduleTitles: ["Initiate Memo"],
    nextLabel: "Initiate Memo",
    actionPath: "/app/account/initiate-memo",
    actionVerb: "review",
    notifyRaiser: true,
  },
  approved: {
    moduleTitles: ["Bill", "Billing Expense", "Create Bill", "View Expenses Memos"],
    nextLabel: "Bill",
    actionPath: "/app/expenses/billing",
    actionVerb: "bill",
    notifyRaiser: true,
  },
  completed: {
    moduleTitles: [],
    nextLabel: null,
    actionPath: "/app/account/initiate-memo",
    actionVerb: "view",
    notifyRaiser: true,
  },
};

const WORKFLOW_NEXT = {
  productionCosting: {
    moduleTitles: ["Price Setup"],
    nextLabel: "Price Setup",
    actionPath: "/app/sales/price-setup",
    actionVerb: "cost",
  },
  purchaseBilling: {
    moduleTitles: ["Bill", "Billing Expense", "Create Bill"],
    nextLabel: "Bill",
    actionPath: "/app/expenses/billing",
    actionVerb: "bill",
  },
  purchaseApproval: {
    moduleTitles: ["Approve Purchase Order", "Goods received"],
    nextLabel: "Approve Purchase Order",
    actionPath: "/app/purchase/purchase-requisition",
    actionVerb: "approve",
  },
  goodsTransferApproval: {
    moduleTitles: ["Pending Approvals", "Goods"],
    nextLabel: "Pending Approvals",
    actionPath: "/app/purchase/inventory?tab=goods-transfer",
    actionVerb: "approve",
  },
  journalPosting: {
    moduleTitles: ["Journal Entries"],
    nextLabel: "Journal Entries",
    actionPath: "/app/account/journal-entries",
    actionVerb: "post",
  },
  journalView: {
    moduleTitles: ["Journal Entries"],
    nextLabel: "Journal Entries",
    actionPath: "/app/account/journal-entries",
    actionVerb: "view",
  },
  invoiceList: {
    moduleTitles: ["Invoice List"],
    nextLabel: "Invoice List",
    actionPath: "/app/sales/invoices",
    actionVerb: "view",
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
  },
  payrollPayment: {
    moduleTitles: ["Payroll Payment", "Payroll Processing"],
    nextLabel: "Payroll Payment",
    actionPath: "/app/admin/hr/payroll?tab=payment",
    actionVerb: "pay",
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
  },
  creditNote: {
    moduleTitles: ["Credit Notes", "Credit & Debit Note", "Credit Note"],
    nextLabel: "Credit Notes",
    actionPath: "/app/payments/credit-note/party-customer",
    actionVerb: "view",
  },
  priceUpdate: {
    moduleTitles: ["Price Setup", "Make sales", "Invoices", "Products"],
    nextLabel: "Price Setup",
    actionPath: "/app/sales/price-setup",
    actionVerb: "review",
  },
  depositToGit: {
    moduleTitles: ["Pay Bills", "Pay Bill", "See All Pay Bills", "Create Bill"],
    nextLabel: "Pay Bills",
    actionPath: "/app/payments/pay-bills",
    actionVerb: "review",
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
    };
  }
  if (s === "awaiting_payment") {
    return {
      moduleTitles: [
        "Verification Points",
        "Apply Deposit",
        "Collection Points",
      ],
      nextLabel: "Verification Points (Apply Deposit)",
      actionPath: "/app/payments/verification-points",
      actionVerb: "apply deposit to",
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
    };
  }
  if (s === "completed") {
    return {
      moduleTitles: [],
      nextLabel: null,
      actionPath: "/app/sales/invoices",
      actionVerb: "view",
    };
  }
  return WORKFLOW_NEXT.invoiceList;
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

    if (actor?.email && !isSuspended(actor.status)) {
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

    const actorEmailsSent = new Set();

    if (actor?.email && !isSuspended(actor.status)) {
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
      );

    if (step?.notifyRaiser && raiser?.email && !isSuspended(raiser.status)) {
      const raiserEmail = String(raiser.email).trim().toLowerCase();
      const alreadyNotified =
        actorEmailsSent.has(raiserEmail) ||
        nextRecipients.some(
          (user) => String(user.email || "").trim().toLowerCase() === raiserEmail,
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

    const results = await Promise.allSettled(nextMails);
    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length) {
      console.error(
        `[workflowMail] ${failed.length} memo next-step email(s) failed for ${memo.memo_id}`,
        failed.map((result) => result.reason?.message || result.reason),
      );
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
  WORKFLOW_NEXT,
  sendHtmlMail,
  wrapMailHtml,
  escapeHtml,
  buildDetailsTable,
};
