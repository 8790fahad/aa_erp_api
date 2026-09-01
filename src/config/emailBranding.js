"use strict";

const { applyMailEnvFromFile } = require("./mailTransport");

const DEFAULT_WEBSITE = "https://ashiru-ali.com";
const DEFAULT_EMAIL = "hello@ashiru-ali.com";
const DEFAULT_NAME = "Nexifour LLC";
const DEFAULT_PHONE = "+2348067643479";
const DEFAULT_TWITTER = "https://x.com/aa_erpng";
const DEFAULT_INSTAGRAM = "https://www.instagram.com/aa_erpng";
const DEFAULT_LINKEDIN = "https://www.linkedin.com/company/aa_erpng";
const DEFAULT_FACEBOOK = "https://www.facebook.com/aa_erpng";

function looksLikeFlowbooks(value) {
  return /flowbooks/i.test(String(value || ""));
}

function pick(value, fallback) {
  const v = String(value || "").trim();
  if (!v || looksLikeFlowbooks(v)) return fallback;
  return v;
}

function getEmailBranding() {
  applyMailEnvFromFile();
  return {
    companyName: pick(
      process.env.MAIL_FROM_NAME || process.env.COMPANY_NAME,
      DEFAULT_NAME,
    ),
    companyWebsite: pick(process.env.COMPANY_WEBSITE, DEFAULT_WEBSITE),
    companyEmail: pick(process.env.COMPANY_EMAIL, DEFAULT_EMAIL),
    companyPhone: pick(process.env.COMPANY_PHONE, DEFAULT_PHONE),
    companyTwitter: pick(process.env.COMPANY_TWITTER, DEFAULT_TWITTER),
    companyInstagram: pick(process.env.COMPANY_INSTAGRAM, DEFAULT_INSTAGRAM),
    companyLinkedIn: pick(process.env.COMPANY_LINKEDIN, DEFAULT_LINKEDIN),
    companyFacebook: pick(
      process.env.COMPANY_FACEBOOK || process.env.COMPANY_FACESBOOK,
      DEFAULT_FACEBOOK,
    ),
  };
}

function buildCompanyMailFooter(branding = getEmailBranding()) {
  const {
    companyWebsite,
    companyEmail,
    companyPhone,
    companyTwitter,
    companyInstagram,
    companyLinkedIn,
    companyFacebook,
  } = branding;

  return `
    <div style="border-top:1px solid #eee;padding:16px 24px 20px 24px;font-size:12px;color:#666;line-height:1.6;">
      <div style="margin-bottom:8px;">
        Website:
        <a href="${companyWebsite}" style="color:#4267B2;text-decoration:none;">
          ${companyWebsite}
        </a>
      </div>
      <div style="margin-bottom:8px;">
        Email:
        <a href="mailto:${companyEmail}" style="color:#4267B2;text-decoration:none;">
          ${companyEmail}
        </a>
      </div>
      <div style="margin-bottom:8px;">
        Phone: ${companyPhone}
      </div>
      <div>
        <p style="margin:0 0 8px 0;font-size:12px;color:#666;">Follow us:</p>
        <a href="${companyTwitter}" style="display:inline-block;margin-right:12px;">
          <img src="https://img.icons8.com/color/48/twitterx--v1.png"
               width="28" height="28" alt="Twitter" style="display:block;" />
        </a>
        <a href="${companyInstagram}" style="display:inline-block;margin-right:12px;">
          <img src="https://img.icons8.com/color/48/instagram-new.png"
               width="28" height="28" alt="Instagram" style="display:block;" />
        </a>
        <a href="${companyLinkedIn}" style="display:inline-block;margin-right:12px;">
          <img src="https://img.icons8.com/color/48/linkedin.png"
               width="28" height="28" alt="LinkedIn" style="display:block;" />
        </a>
        <a href="${companyFacebook}" style="display:inline-block;">
          <img src="https://img.icons8.com/color/48/facebook.png"
               width="28" height="28" alt="Facebook" style="display:block;" />
        </a>
      </div>
    </div>
  `;
}

module.exports = {
  getEmailBranding,
  buildCompanyMailFooter,
  looksLikeFlowbooks,
};
