"use strict";

/**
 * Google reCAPTCHA verification for KYC Connect.
 *
 * Prefers reCAPTCHA Enterprise (createAssessment) when
 * RECAPTCHA_PROJECT_ID + RECAPTCHA_API_KEY + RECAPTCHA_SITE_KEY are set.
 * Falls back to classic siteverify with RECAPTCHA_SECRET_KEY (or Google's
 * always-pass test secret in non-production).
 *
 * If an Enterprise site key is configured but project/API key are missing,
 * classic verify cannot validate Enterprise tokens — in non-production we
 * accept a present token with a warning so local signup can proceed.
 */

const GOOGLE_TEST_SECRET = "6LeIxAcTAAAAAGG-vFI1TnRWxMZYLuL1nSUV6mBv";
const SITEVERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";
const DEFAULT_SCORE_THRESHOLD = 0.5;

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function getClassicSecret() {
  const configured = String(process.env.RECAPTCHA_SECRET_KEY || "").trim();
  if (configured) return configured;
  if (!isProduction()) return GOOGLE_TEST_SECRET;
  return "";
}

function getEnterpriseConfig() {
  return {
    projectId: String(process.env.RECAPTCHA_PROJECT_ID || "").trim(),
    apiKey: String(process.env.RECAPTCHA_API_KEY || "").trim(),
    siteKey: String(process.env.RECAPTCHA_SITE_KEY || "").trim(),
    scoreThreshold: Number(process.env.RECAPTCHA_SCORE_THRESHOLD || DEFAULT_SCORE_THRESHOLD),
  };
}

async function verifyClassic(token, remoteip) {
  const secret = getClassicSecret();
  if (!secret) {
    return { ok: false, errorCodes: ["missing-secret"] };
  }

  const body = new URLSearchParams({
    secret,
    response: String(token),
  });
  if (remoteip) body.set("remoteip", String(remoteip));

  const res = await fetch(SITEVERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();
  return {
    ok: Boolean(data.success),
    errorCodes: Array.isArray(data["error-codes"]) ? data["error-codes"] : undefined,
    mode: "classic",
  };
}

async function verifyEnterprise(token, { remoteip, userAgent, expectedAction } = {}) {
  const { projectId, apiKey, siteKey, scoreThreshold } = getEnterpriseConfig();
  if (!projectId || !apiKey || !siteKey) {
    return { ok: false, errorCodes: ["missing-enterprise-config"] };
  }

  const url = `https://recaptchaenterprise.googleapis.com/v1/projects/${encodeURIComponent(
    projectId,
  )}/assessments?key=${encodeURIComponent(apiKey)}`;

  const event = {
    token: String(token),
    siteKey,
  };
  if (expectedAction) event.expectedAction = String(expectedAction);
  if (remoteip) event.userIpAddress = String(remoteip);
  if (userAgent) event.userAgent = String(userAgent);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event }),
  });
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    console.error("[recaptcha] enterprise assessment HTTP error:", res.status, data);
    return {
      ok: false,
      errorCodes: [data?.error?.status || `http-${res.status}`],
      mode: "enterprise",
    };
  }

  const tokenProps = data?.tokenProperties || {};
  const risk = data?.riskAnalysis || {};
  const score = typeof risk.score === "number" ? risk.score : 0;
  const valid = Boolean(tokenProps.valid);
  const actionOk =
    !expectedAction ||
    !tokenProps.action ||
    String(tokenProps.action) === String(expectedAction);

  if (!valid) {
    return {
      ok: false,
      errorCodes: [tokenProps.invalidReason || "invalid-token"],
      score,
      mode: "enterprise",
    };
  }
  if (!actionOk) {
    return {
      ok: false,
      errorCodes: ["action-mismatch"],
      score,
      mode: "enterprise",
    };
  }
  if (score < scoreThreshold) {
    return {
      ok: false,
      errorCodes: ["low-score"],
      score,
      mode: "enterprise",
    };
  }

  return { ok: true, score, mode: "enterprise" };
}

/**
 * @param {string} token
 * @param {{ remoteip?: string, userAgent?: string, expectedAction?: string }} [opts]
 */
async function verifyRecaptchaToken(token, opts = {}) {
  const trimmed = String(token || "").trim();
  if (!trimmed) {
    return { ok: false, errorCodes: ["missing-input-response"] };
  }

  const enterprise = getEnterpriseConfig();
  const enterpriseReady = Boolean(
    enterprise.projectId && enterprise.apiKey && enterprise.siteKey,
  );
  const enterprisePartial = Boolean(enterprise.siteKey && !enterpriseReady);

  try {
    if (enterpriseReady) {
      return await verifyEnterprise(trimmed, opts);
    }

    // Enterprise site key without project/API key — classic siteverify cannot
    // validate Enterprise tokens. Allow through in non-production only.
    if (enterprisePartial) {
      if (!isProduction()) {
        console.warn(
          "[recaptcha] RECAPTCHA_PROJECT_ID / RECAPTCHA_API_KEY missing — accepting token in development only",
        );
        return { ok: true, mode: "dev-bypass", errorCodes: ["enterprise-config-incomplete"] };
      }
      console.error(
        "[recaptcha] Enterprise site key set but RECAPTCHA_PROJECT_ID / RECAPTCHA_API_KEY are missing",
      );
      return { ok: false, errorCodes: ["missing-enterprise-config"] };
    }

    return await verifyClassic(trimmed, opts.remoteip);
  } catch (err) {
    console.error("[recaptcha] verification failed:", err);
    return { ok: false, errorCodes: ["verification-request-failed"] };
  }
}

module.exports = {
  verifyRecaptchaToken,
  getEnterpriseConfig,
};
