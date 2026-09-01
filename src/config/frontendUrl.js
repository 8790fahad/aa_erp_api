"use strict";

const { applyMailEnvFromFile } = require("./mailTransport");
const { looksLikeFlowbooks } = require("./emailBranding");

const FALLBACK_FRONTEND = "https://ashiru-ali.com";

/** Public ERP frontend origin used in password-reset and verification emails. */
function getPublicFrontendUrl() {
  applyMailEnvFromFile();
  const isProd = process.env.NODE_ENV === "production";
  const candidates = [
    process.env.PUBLIC_FRONTEND_URL,
    process.env.KYC_FRONTEND_URL,
    isProd
      ? process.env.KYC_FRONTEND_URL_PROD
      : process.env.KYC_FRONTEND_URL_DEV,
    FALLBACK_FRONTEND,
  ];
  for (const raw of candidates) {
    const url = String(raw || "")
      .trim()
      .replace(/\/$/, "");
    if (!url || looksLikeFlowbooks(url)) continue;
    return url;
  }
  return FALLBACK_FRONTEND;
}

module.exports = { getPublicFrontendUrl };
