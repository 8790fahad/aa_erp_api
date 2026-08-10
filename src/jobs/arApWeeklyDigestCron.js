"use strict";

const cron = require("node-cron");
const moment = require("moment");
const db = require("../models");
const {
  fetchReceivablePayableSummary,
} = require("../services/financialDashboard");
const { newMail } = require("../services/emailApi");

const formatNaira = (amount) =>
  `₦${Number(amount || 0).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function agingTable(aging) {
  const rows = [
    ["Current", aging?.current],
    ["1–30 days", aging?.["1_30"]],
    ["31–60 days", aging?.["31_60"]],
    ["61–90 days", aging?.["61_90"]],
    ["90+ days", aging?.["90_plus"]],
  ];
  return rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;">${label}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${formatNaira(value)}</td></tr>`,
    )
    .join("");
}

function buildEmailHtml(businessName, summary, asOf) {
  return `
    <div style="font-family:Arial,sans-serif;color:#1f2937;max-width:640px;">
      <h2 style="color:#1a2d5e;margin-bottom:4px;">Weekly Receivable &amp; Payable Digest</h2>
      <p style="margin-top:0;color:#6b7280;">${businessName || "Your business"} · As of ${asOf}</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr>
          <td style="padding:14px;background:#f0fdf4;border-radius:8px;">
            <div style="font-size:12px;color:#059669;">Total Receivable</div>
            <div style="font-size:22px;font-weight:700;">${formatNaira(summary.totalReceivable)}</div>
          </td>
          <td style="width:12px;"></td>
          <td style="padding:14px;background:#fff7ed;border-radius:8px;">
            <div style="font-size:12px;color:#c2410c;">Total Payable</div>
            <div style="font-size:22px;font-weight:700;">${formatNaira(summary.totalPayable)}</div>
          </td>
        </tr>
      </table>
      <h3 style="font-size:14px;color:#1a2d5e;">Receivable aging</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">${agingTable(summary.receivableAging)}</table>
      <h3 style="font-size:14px;color:#1a2d5e;margin-top:20px;">Payable aging</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">${agingTable(summary.payableAging)}</table>
      <p style="font-size:12px;color:#9ca3af;margin-top:24px;">Sent automatically every Monday by Inventria.</p>
    </div>
  `;
}

async function getFacilityRecipients(facilityId) {
  const rows = await db.sequelize.query(
    `
      SELECT DISTINCT email, firstname, lastname
      FROM users
      WHERE facilityId = :facilityId
        AND email IS NOT NULL
        AND TRIM(email) != ''
        AND IFNULL(LOWER(status), 'active') NOT IN ('inactive', 'disabled', 'deleted', '0')
      LIMIT 20
    `,
    {
      replacements: { facilityId },
      type: db.sequelize.QueryTypes.SELECT,
    },
  );
  return (rows || []).filter((r) => r?.email);
}

async function processFacility(business) {
  const facilityId = business.id;
  const asOf = moment().format("YYYY-MM-DD");
  const summary = await fetchReceivablePayableSummary(
    db.sequelize,
    facilityId,
    asOf,
  );
  const recipients = await getFacilityRecipients(facilityId);
  if (!recipients.length) {
    console.log(
      `[ar-ap-digest] No recipients for ${business.business_name || facilityId}`,
    );
    return { facilityId, sent: 0 };
  }

  const html = buildEmailHtml(business.business_name, summary, asOf);
  const subject = `Weekly AR/AP digest — ${business.business_name || "Business"} (${asOf})`;

  let sent = 0;
  for (const user of recipients) {
    try {
      newMail(user.email, subject, html);
      sent += 1;
    } catch (err) {
      console.error(
        `[ar-ap-digest] Failed to email ${user.email}:`,
        err.message,
      );
    }
  }

  console.log(
    `[ar-ap-digest] ${business.business_name || facilityId}: AR ${summary.totalReceivable} / AP ${summary.totalPayable} → ${sent} email(s)`,
  );
  return { facilityId, sent };
}

async function runArApWeeklyDigest() {
  console.log("[ar-ap-digest] Starting weekly receivable/payable digest…");
  const businesses = await db.business.findAll({
    attributes: ["id", "business_name"],
    limit: 500,
  });

  let totalSent = 0;
  for (const biz of businesses || []) {
    try {
      const result = await processFacility(biz);
      totalSent += result.sent || 0;
    } catch (err) {
      console.error(
        `[ar-ap-digest] Facility ${biz.id} failed:`,
        err.message,
      );
    }
  }
  console.log(`[ar-ap-digest] Done. Emails sent: ${totalSent}`);
  return { totalSent, facilities: (businesses || []).length };
}

/**
 * Weekly receivable & payable email digest.
 * Default: every Monday at 08:00 server time.
 * Override with AR_AP_DIGEST_CRON_SCHEDULE; disable with ENABLE_AR_AP_DIGEST_CRON=false.
 */
function startArApWeeklyDigestCron() {
  if (process.env.ENABLE_AR_AP_DIGEST_CRON === "false") {
    console.log(
      "[ar-ap-digest] Cron disabled via ENABLE_AR_AP_DIGEST_CRON=false",
    );
    return null;
  }

  const schedule = process.env.AR_AP_DIGEST_CRON_SCHEDULE || "0 8 * * 1";
  const task = cron.schedule(schedule, () => {
    runArApWeeklyDigest().catch((err) =>
      console.error("[ar-ap-digest] Run failed:", err.message),
    );
  });
  console.log(`[ar-ap-digest] Cron scheduled (${schedule})`);
  return task;
}

module.exports = {
  startArApWeeklyDigestCron,
  runArApWeeklyDigest,
  processFacility,
};
