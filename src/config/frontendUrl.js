"use strict";

/** Public ERP frontend origin used in password-reset and verification emails. */
function getPublicFrontendUrl() {
  const isProd = process.env.NODE_ENV === "production";
  const raw =
    process.env.PUBLIC_FRONTEND_URL ||
    process.env.KYC_FRONTEND_URL ||
    (isProd
      ? process.env.KYC_FRONTEND_URL_PROD
      : process.env.KYC_FRONTEND_URL_DEV) ||
    "https://ashiru-ali.com";
  return String(raw).replace(/\/$/, "");
}

module.exports = { getPublicFrontendUrl };
