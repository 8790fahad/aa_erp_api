"use strict";

const db = require("../models");
const {
  notifyWorkflowPosting,
  WORKFLOW_NEXT,
  sendHtmlMail,
  escapeHtml,
} = require("./workflowMail");
const {
  getEmailBranding,
  buildCompanyMailFooter,
} = require("../config/emailBranding");

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function periodLabel(month, year) {
  const m = parseInt(month, 10);
  const name = MONTH_NAMES[m - 1] || String(month || "");
  return `${name} ${year}`.trim();
}

function payrollDocumentId(month, year) {
  const m = String(parseInt(month, 10) || month || "").padStart(2, "0");
  return `PAY-${year}-${m}`;
}

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseNamedAmounts(raw) {
  if (!raw) return {};
  let data = raw;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return {};
    }
  }
  if (Array.isArray(data)) {
    const map = {};
    data.forEach((item, idx) => {
      if (item == null) return;
      if (typeof item === "object") {
        const name = item.name || item.title || `Item ${idx + 1}`;
        const amt = parseFloat(item.amount ?? item.value ?? 0);
        if (name && Number.isFinite(amt) && amt !== 0) map[String(name)] = amt;
        return;
      }
      const amt = parseFloat(item);
      if (Number.isFinite(amt) && amt !== 0) map[`Item ${idx + 1}`] = amt;
    });
    return map;
  }
  if (typeof data === "object") {
    const map = {};
    for (const [key, value] of Object.entries(data)) {
      if (!key || /^\d+$/.test(String(key))) continue;
      const amt = parseFloat(value);
      if (Number.isFinite(amt) && amt !== 0) map[key] = amt;
    }
    return map;
  }
  return {};
}

function sumMap(map) {
  return Object.values(map || {}).reduce(
    (sum, value) => sum + (parseFloat(value) || 0),
    0,
  );
}

function employeeDisplayName(employee) {
  const name = `${employee?.firstName || ""} ${employee?.lastName || ""}`.trim();
  if (name) return name;
  const userName = `${employee?.user?.firstname || ""} ${employee?.user?.lastname || ""}`.trim();
  return userName || "Employee";
}

function resolveEmployeeEmail(employee) {
  const userEmail = String(employee?.user?.email || "").trim();
  if (userEmail.includes("@")) return userEmail;
  const contact = String(employee?.contactInfo || "").trim();
  if (contact.includes("@")) return contact;
  return "";
}

function amountRowsHtml(rows) {
  return rows
    .filter((row) => row && Number.isFinite(row.amount) && row.amount !== 0)
    .map(
      (row) => `
        <tr>
          <td style="padding:8px 0;color:#555;font-size:13px;border-bottom:1px solid #f1f1f1;">${escapeHtml(row.label)}</td>
          <td style="padding:8px 0;color:#111;font-size:13px;font-weight:600;text-align:right;border-bottom:1px solid #f1f1f1;">${escapeHtml(formatMoney(row.amount))}</td>
        </tr>`,
    )
    .join("");
}

function buildPaymentSlipHtml({ payroll, employee, business, branding }) {
  const product = branding.companyName || "AA ERP";
  const companyName =
    business?.business_name || business?.name || product;
  const period = periodLabel(payroll.month, payroll.year);
  const name = employeeDisplayName(employee);
  const staffNo = employee?.employeeId || "";
  const designation = employee?.designation || "";
  const department =
    employee?.department?.departmentName ||
    employee?.department?.name ||
    "";
  const bankName = employee?.bankName || "";
  const bankAccount = employee?.bankAccount || "";

  const allowanceDetails = parseNamedAmounts(payroll.allowance_details);
  const bonusDetails = parseNamedAmounts(payroll.bonus_details);
  const deductionDetails = parseNamedAmounts(payroll.deduction_details);

  const basicSalary = parseFloat(payroll.basicSalary) || 0;
  const overtime = parseFloat(payroll.overtime) || 0;
  const paye = parseFloat(payroll.paye) || 0;
  const pension = parseFloat(payroll.pension) || 0;
  const loanRepayment = parseFloat(payroll.loanRepayment) || 0;
  const allowancesTotal =
    sumMap(allowanceDetails) || parseFloat(payroll.allowances) || 0;
  const bonusesTotal =
    sumMap(bonusDetails) || parseFloat(payroll.bonuses) || 0;
  const otherDeductionsTotal =
    sumMap(deductionDetails) || parseFloat(payroll.deductions) || 0;

  const grossPay =
    parseFloat(payroll.grossPay) ||
    basicSalary + allowancesTotal + bonusesTotal + overtime;
  const totalDeductions =
    paye + pension + otherDeductionsTotal + loanRepayment;
  const netPay =
    parseFloat(payroll.netPay) || Math.max(0, grossPay - totalDeductions);

  const earningRows = [
    { label: "Basic salary", amount: basicSalary },
    ...Object.entries(allowanceDetails).map(([label, amount]) => ({
      label,
      amount,
    })),
    ...Object.entries(bonusDetails).map(([label, amount]) => ({
      label: `${label} (Bonus)`,
      amount,
    })),
    { label: "Overtime", amount: overtime },
  ];
  if (!Object.keys(allowanceDetails).length && allowancesTotal) {
    earningRows.push({ label: "Allowances", amount: allowancesTotal });
  }
  if (!Object.keys(bonusDetails).length && bonusesTotal) {
    earningRows.push({ label: "Bonuses", amount: bonusesTotal });
  }

  const deductionRows = [
    { label: "PAYE tax", amount: paye },
    { label: "Pension", amount: pension },
    ...Object.entries(deductionDetails).map(([label, amount]) => ({
      label,
      amount,
    })),
    { label: "Loan repayment", amount: loanRepayment },
  ];
  if (!Object.keys(deductionDetails).length && otherDeductionsTotal) {
    deductionRows.push({
      label: "Other deductions",
      amount: otherDeductionsTotal,
    });
  }

  const meta = [
    ["Period", period],
    ["Employee", name],
    staffNo ? ["Staff number", staffNo] : null,
    designation ? ["Designation", designation] : null,
    department ? ["Department", department] : null,
    bankName ? ["Bank", bankName] : null,
    bankAccount ? ["Account", bankAccount] : null,
    payroll.paymentType ? ["Payment type", payroll.paymentType] : null,
  ]
    .filter(Boolean)
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:4px 0;color:#666;font-size:13px;width:38%;">${escapeHtml(label)}</td>
          <td style="padding:4px 0;color:#111;font-size:13px;font-weight:600;">${escapeHtml(value)}</td>
        </tr>`,
    )
    .join("");

  return `
    <div style="background-color:#f5f5f7;padding:24px 0;font-family:Arial,sans-serif;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.06);">
        <div style="padding:20px 24px 0 24px;">
          <img src="${escapeHtml(branding.companyLogoUrl)}" alt="${escapeHtml(product)}" style="display:block;height:32px;width:auto;object-fit:contain;" />
        </div>
        <div style="padding:24px;">
          <h2 style="margin:0 0 4px;font-size:22px;color:#111;">Payment slip</h2>
          <p style="margin:0 0 16px;font-size:14px;color:#555;">
            ${escapeHtml(companyName)} — salary payment for <strong>${escapeHtml(period)}</strong>
          </p>
          <table style="width:100%;border-collapse:collapse;margin:0 0 20px;">${meta}</table>
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="width:50%;vertical-align:top;padding-right:12px;">
                <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#fff;background:#4267B2;padding:8px 10px;border-radius:6px;margin-bottom:8px;">Earnings</div>
                <table style="width:100%;border-collapse:collapse;">
                  ${amountRowsHtml(earningRows)}
                  <tr>
                    <td style="padding:10px 0 0;font-size:13px;font-weight:700;color:#111;">Gross pay</td>
                    <td style="padding:10px 0 0;font-size:13px;font-weight:700;text-align:right;color:#111;">${escapeHtml(formatMoney(grossPay))}</td>
                  </tr>
                </table>
              </td>
              <td style="width:50%;vertical-align:top;padding-left:12px;">
                <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#fff;background:#4267B2;padding:8px 10px;border-radius:6px;margin-bottom:8px;">Deductions</div>
                <table style="width:100%;border-collapse:collapse;">
                  ${amountRowsHtml(deductionRows)}
                  <tr>
                    <td style="padding:10px 0 0;font-size:13px;font-weight:700;color:#111;">Total deductions</td>
                    <td style="padding:10px 0 0;font-size:13px;font-weight:700;text-align:right;color:#111;">${escapeHtml(formatMoney(totalDeductions))}</td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
          <div style="margin-top:20px;background:#f4f7fb;border-radius:10px;padding:16px 18px;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:14px;font-weight:700;color:#111;text-transform:uppercase;letter-spacing:0.04em;">Net pay</span>
            <span style="font-size:22px;font-weight:800;color:#4267B2;">${escapeHtml(formatMoney(netPay))}</span>
          </div>
          ${
            payroll.paymentNote
              ? `<p style="margin:16px 0 0;font-size:13px;color:#555;"><strong>Note:</strong> ${escapeHtml(payroll.paymentNote)}</p>`
              : ""
          }
          <p style="margin:20px 0 0;font-size:13px;color:#555;line-height:1.6;">
            This is your official payment slip for ${escapeHtml(period)}. Please keep it for your records.
          </p>
        </div>
        ${buildCompanyMailFooter(branding)}
      </div>
    </div>
  `;
}

async function loadBusiness(facilityId) {
  if (!facilityId || !db.business) return null;
  try {
    return await db.business.findByPk(facilityId, {
      attributes: ["id", "business_name"],
    });
  } catch (error) {
    console.warn("[payrollMail] business lookup skipped:", error?.message || error);
    return null;
  }
}

async function notifyPayrollInitiated({
  facilityId,
  actorUserId,
  month,
  year,
  summary = {},
} = {}) {
  const period = periodLabel(month, year);
  const documentId = payrollDocumentId(month, year);
  return notifyWorkflowPosting({
    facilityId,
    actorUserId,
    documentId,
    documentType: "Payroll",
    eventLabel: "initiated",
    nextStep: WORKFLOW_NEXT.payrollConfirm,
    inAppType: "payroll_initiated",
    actorIntro: `Payroll for <strong>${escapeHtml(period)}</strong> has been initiated. Confirm the batch, then release payment.`,
    nextIntro: `Payroll for <strong>${escapeHtml(period)}</strong> has been initiated. Confirm the draft records, then pay from Payroll Payment.`,
    details: [
      ["Period", period],
      ["Employees", summary.totalEmployees],
      ["Gross pay", formatMoney(summary.totalGrossPay)],
      ["Net pay", formatMoney(summary.totalNetPay)],
      ["Status", "Draft"],
    ],
  });
}

async function notifyPayrollReadyForPayment({
  facilityId,
  actorUserId,
  month,
  year,
  count,
} = {}) {
  const period = periodLabel(month, year);
  const documentId = payrollDocumentId(month, year);
  return notifyWorkflowPosting({
    facilityId,
    actorUserId,
    documentId,
    documentType: "Payroll",
    eventLabel: "confirmed",
    nextStep: WORKFLOW_NEXT.payrollPayment,
    inAppType: "payroll_ready",
    actorIntro: `Payroll for <strong>${escapeHtml(period)}</strong> is confirmed and ready for payment.`,
    nextIntro: `Payroll for <strong>${escapeHtml(period)}</strong> is waiting in <strong>Payroll Payment</strong>. Please release payment.`,
    details: [
      ["Period", period],
      ["Records confirmed", count],
      ["Status", "Processed"],
    ],
  });
}

async function sendEmployeePayslips({ facilityId, month, year, payrollIds } = {}) {
  const ids = (Array.isArray(payrollIds) ? payrollIds : []).filter(Boolean);
  if (!facilityId || !ids.length) return { sent: 0, skipped: 0, failed: 0 };

  const payrolls = await db.payroll.findAll({
    where: {
      facilityId,
      month: parseInt(month, 10),
      year: parseInt(year, 10),
      id: ids,
    },
    include: [
      {
        model: db.employees,
        as: "employee",
        include: [
          {
            model: db.users,
            as: "user",
            attributes: ["id", "email", "firstname", "lastname"],
            required: false,
          },
          ...(db.Department
            ? [
                {
                  model: db.Department,
                  as: "department",
                  attributes: ["departmentName"],
                  required: false,
                },
              ]
            : []),
        ],
      },
    ],
  });

  const business = await loadBusiness(facilityId);
  const branding = getEmailBranding();
  const period = periodLabel(month, year);
  const companyName = business?.business_name || branding.companyName || "AA ERP";

  let skipped = 0;
  const mails = [];

  for (const row of payrolls) {
    const payroll = row.get ? row.get({ plain: true }) : row;
    const employee = payroll.employee;
    const email = resolveEmployeeEmail(employee);
    if (!email) {
      skipped += 1;
      console.warn(
        `[payrollMail] No email for employee ${employee?.employeeId || payroll.employeeId} — payment slip skipped`,
      );
      continue;
    }
    mails.push(
      sendHtmlMail({
        to: email,
        subject: `Payment slip — ${period} — ${companyName}`,
        category: "Payroll Payment Slip",
        html: buildPaymentSlipHtml({
          payroll,
          employee,
          business,
          branding,
        }),
      }),
    );
  }

  const results = await Promise.allSettled(mails);
  const failed = results.filter((result) => result.status === "rejected");
  const sent = results.filter((result) => result.status === "fulfilled").length;
  if (failed.length) {
    console.error(
      `[payrollMail] ${failed.length} payment slip email(s) failed for ${payrollDocumentId(month, year)}`,
      failed.map((result) => result.reason?.message || result.reason),
    );
  }
  if (skipped) {
    console.warn(
      `[payrollMail] ${skipped} employee(s) had no email for ${payrollDocumentId(month, year)}`,
    );
  }
  return { sent, skipped, failed: failed.length };
}

async function notifyPayrollPaid({
  facilityId,
  actorUserId,
  month,
  year,
  payrollIds,
  totalRecords,
} = {}) {
  const period = periodLabel(month, year);
  const documentId = payrollDocumentId(month, year);
  await notifyWorkflowPosting({
    facilityId,
    actorUserId,
    documentId,
    documentType: "Payroll",
    eventLabel: "paid",
    nextStep: WORKFLOW_NEXT.payrollHistory,
    inAppType: "payroll_paid",
    actorIntro: `Payroll for <strong>${escapeHtml(period)}</strong> has been paid. Payment slips are being emailed to employees.`,
    nextIntro: `Payroll for <strong>${escapeHtml(period)}</strong> has been paid. Payment slips have been sent to employees.`,
    details: [
      ["Period", period],
      ["Records paid", totalRecords],
      ["Status", "Paid"],
    ],
  });

  try {
    await sendEmployeePayslips({ facilityId, month, year, payrollIds });
  } catch (error) {
    console.error(
      "[payrollMail] Failed to send employee payment slips:",
      error?.message || error,
    );
  }
}

module.exports = {
  notifyPayrollInitiated,
  notifyPayrollReadyForPayment,
  notifyPayrollPaid,
  sendEmployeePayslips,
};
