/**
 * OAuth 2.0 client credentials for FlowBooks E-Invoicing API.
 * Standard system-to-system (M2M) auth aligned with FIRS e-Invoicing docs.
 * @see https://einvoice.firs.gov.ng/docs/introduction?version=1.1
 *
 * Access tokens are short-lived Bearer JWTs (default TTL 3600s, scope e-invoicing)
 * minted at POST /api/v1/invoice/oauth/token. Client secrets are never sent on
 * invoice create/status/payment requests.
 */

const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const {
  verifyCredentials,
  resolveKycNrsBusinessId,
} = require("../utils/einvoicingCredentials");
const db = require("../models");

/**
 * Signing secret for e-invoicing access tokens. Prefer a dedicated
 * EINVOICING_JWT_SECRET so a compromise of app JWT_SECRET_KEY cannot forge
 * e-invoicing tokens. Never fall back to a hard-coded default in production.
 */
const JWT_SECRET = (() => {
  const dedicated = process.env.EINVOICING_JWT_SECRET;
  const fallback = process.env.JWT_SECRET_KEY;
  if (dedicated && dedicated.length >= 16) return dedicated;
  if (fallback && fallback.length >= 16) {
    console.warn(
      "[eInvoicingAuth] EINVOICING_JWT_SECRET is unset — falling back to JWT_SECRET_KEY. Set a dedicated EINVOICING_JWT_SECRET in production.",
    );
    return fallback;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "EINVOICING_JWT_SECRET or JWT_SECRET_KEY is missing or too short. Set a strong secret (>=16 chars) before starting in production.",
    );
  }
  console.warn(
    "[eInvoicingAuth] EINVOICING_JWT_SECRET / JWT_SECRET_KEY is unset/weak — using an insecure dev-only secret. DO NOT use in production.",
  );
  return "insecure-dev-only-secret-change-me";
})();

function isProduction() {
  return process.env.NODE_ENV === "production";
}

/** Dangerous flags are ignored in production unless explicitly re-enabled. */
function dangerousFlagsAllowed() {
  return process.env.EINVOICING_ALLOW_DANGEROUS_FLAGS === "true";
}

function allowInsecureTransport() {
  if (!isProduction()) return true;
  if (process.env.EINVOICING_ALLOW_INSECURE !== "true") return false;
  if (!dangerousFlagsAllowed()) {
    console.warn(
      "[eInvoicingAuth] EINVOICING_ALLOW_INSECURE ignored in production (set EINVOICING_ALLOW_DANGEROUS_FLAGS=true to override).",
    );
    return false;
  }
  return true;
}

function allowGlobalClient() {
  if (process.env.EINVOICING_ALLOW_GLOBAL_CLIENT !== "true") return false;
  if (isProduction() && !dangerousFlagsAllowed()) {
    console.warn(
      "[eInvoicingAuth] EINVOICING_ALLOW_GLOBAL_CLIENT ignored in production.",
    );
    return false;
  }
  return true;
}

function allowUserJwt() {
  if (process.env.EINVOICING_ALLOW_USER_JWT !== "true") return false;
  if (isProduction() && !dangerousFlagsAllowed()) {
    console.warn(
      "[eInvoicingAuth] EINVOICING_ALLOW_USER_JWT ignored in production.",
    );
    return false;
  }
  return true;
}

function allowBodyCredentials() {
  if (!isProduction()) return true;
  return process.env.EINVOICING_ALLOW_BODY_CREDENTIALS === "true";
}
const CLIENT_ID =
  process.env.EINVOICING_OAUTH_CLIENT_ID ||
  process.env.NRS_OAUTH_CLIENT_ID ||
  "";
const CLIENT_SECRET =
  process.env.EINVOICING_OAUTH_CLIENT_SECRET ||
  process.env.NRS_OAUTH_CLIENT_SECRET ||
  "";
const TOKEN_TTL_SEC = Number(process.env.EINVOICING_OAUTH_TOKEN_TTL || 3600);
const NRS_BUSINESS_ID = process.env.NRS_BUSINESS_ID || "";

function parseBasicAuth(header = "") {
  if (!header.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    if (sep === -1) return null;
    return {
      client_id: decoded.slice(0, sep),
      client_secret: decoded.slice(sep + 1),
    };
  } catch {
    return null;
  }
}

function credentialsFromBody(body = {}) {
  const client_id =
    body.client_id || body.ClientId || body.clientId || body.clientID;
  const client_secret =
    body.client_secret || body.ClientSecret || body.clientSecret;
  if (!client_id || !client_secret) return null;
  return { client_id, client_secret };
}

/** Constant-time string comparison to avoid credential timing side-channels. */
function safeEqual(a = "", b = "") {
  const bufA = Buffer.from(String(a), "utf8");
  const bufB = Buffer.from(String(b), "utf8");
  if (bufA.length !== bufB.length) {
    // Still run a comparison against a same-length buffer to keep timing flat.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function validateClientCredentials(client_id, client_secret) {
  if (!CLIENT_ID || !CLIENT_SECRET) return false;
  const idOk = safeEqual(client_id, CLIENT_ID);
  const secretOk = safeEqual(client_secret, CLIENT_SECRET);
  return idOk && secretOk;
}

function issueAccessToken(client_id, business_id, extras = {}) {
  const now = Math.floor(Date.now() / 1000);
  const boundBusiness =
    (business_id && String(business_id).trim()) ||
    (NRS_BUSINESS_ID && String(NRS_BUSINESS_ID).trim()) ||
    null;
  const environment =
    (extras.environment && String(extras.environment).trim()) || null;
  const payload = {
    sub: client_id,
    scope: "e-invoicing",
    iat: now,
    exp: now + TOKEN_TTL_SEC,
  };
  // Always embed when known — create-invoice requires this claim.
  if (boundBusiness) payload.business_id = boundBusiness;
  if (environment) payload.environment = environment;
  if (extras.kyc_user_id) payload.kyc_user_id = extras.kyc_user_id;

  const access_token = jwt.sign(payload, JWT_SECRET, { algorithm: "HS256" });
  return {
    access_token,
    token_type: "bearer",
    expires_in: TOKEN_TTL_SEC,
    scope: "e-invoicing",
    environment: environment || undefined,
    business_id: boundBusiness,
  };
}

/**
 * Resolve a client_id/client_secret pair to a business.
 * Prefers the per-business credential store; falls back to the optional global
 * env credentials for backward compatibility.
 * @returns {Promise<{client_id: string, business_id: string, environment?: string, kyc_user_id?: string}|null>}
 */
async function resolveClient(client_id, client_secret) {
  const stored = await verifyCredentials(client_id, client_secret);
  if (stored) return stored;

  if (
    CLIENT_ID &&
    CLIENT_SECRET &&
    validateClientCredentials(client_id, client_secret)
  ) {
    return {
      client_id,
      business_id: NRS_BUSINESS_ID || "",
      environment: "production",
    };
  }
  return null;
}

/** POST /api/v1/invoice/oauth/token — OAuth 2.0 client credentials */
async function oauthToken(req, res) {
  if (!requireHttps(req)) {
    return res.status(403).json({
      error: "insecure_transport",
      error_description:
        "HTTPS is required to request an access token. Use https:// (not http://) in Postman, and ensure the reverse proxy sets X-Forwarded-Proto: https.",
    });
  }

  const basic = parseBasicAuth(req.headers.authorization);
  const bodyCreds = credentialsFromBody(req.body);
  if (bodyCreds && !basic && !allowBodyCredentials()) {
    return res.status(400).json({
      error: "invalid_request",
      error_description:
        "Provide client credentials via Authorization: Basic header. Body client_id/client_secret are not accepted in production.",
    });
  }
  const creds = basic || bodyCreds;

  if (!creds) {
    return res.status(400).json({
      error: "invalid_request",
      error_description:
        "Provide client credentials via Authorization: Basic header or client_id/client_secret in body.",
    });
  }

  const grantType =
    req.body?.grant_type || req.query?.grant_type || "client_credentials";
  if (grantType !== "client_credentials") {
    return res.status(400).json({
      error: "unsupported_grant_type",
      error_description: "Only grant_type=client_credentials is supported.",
    });
  }

  let client;
  try {
    client = await resolveClient(creds.client_id, creds.client_secret);
  } catch (err) {
    console.error("e-invoicing credential lookup failed:", err.message);
    return res.status(500).json({
      error: "server_error",
      error_description: "Unable to validate client credentials.",
    });
  }

  if (!client) {
    return res.status(401).json({
      error: "invalid_client",
      error_description: "Invalid client credentials.",
    });
  }

  // Prefer row value; backfill from KYC NRS settings when still null.
  let businessId =
    (client.business_id && String(client.business_id).trim()) || "";
  if (!businessId && client.kyc_user_id) {
    try {
      businessId = (await resolveKycNrsBusinessId(client.kyc_user_id)) || "";
      if (businessId && db.EInvoicingClient) {
        await db.EInvoicingClient.update(
          { business_id: businessId },
          { where: { client_id: client.client_id, status: "active" } },
        );
      }
    } catch (err) {
      console.error(
        "[eInvoicingAuth] NRS business_id backfill failed:",
        err.message || err,
      );
    }
  }
  if (!businessId && NRS_BUSINESS_ID) {
    businessId = String(NRS_BUSINESS_ID).trim();
  }

  const tokenResponse = issueAccessToken(client.client_id, businessId || null, {
    environment: client.environment || null,
    kyc_user_id: client.kyc_user_id,
  });

  return res.status(200).json({
    ...tokenResponse,
    client_id: client.client_id,
    business_id: businessId || null,
    environment: client.environment || tokenResponse.environment || null,
  });
}

function verifyOAuthToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
    if (payload.scope !== "e-invoicing") return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Reject non-HTTPS requests in production so credentials/tokens are never sent
 * in plaintext. Uses Express req.secure (trust proxy) plus common reverse-proxy
 * HTTPS signals (Apache/nginx) when a proxy hop is trusted.
 */
function isLoopbackPeer(req) {
  const peer = String(req.socket?.remoteAddress || "");
  return (
    peer === "127.0.0.1" ||
    peer === "::1" ||
    peer === "::ffff:127.0.0.1"
  );
}

function isHttpsRequest(req) {
  // True TLS terminated on this socket
  if (req.socket?.encrypted === true) return true;

  const trustForwarded =
    process.env.EINVOICING_TRUST_FORWARDED_PROTO === "true" ||
    isLoopbackPeer(req);

  if (!trustForwarded) return false;

  // Express trust-proxy hop (only when we decided the peer is trusted)
  if (req.secure === true) return true;
  if (String(req.protocol || "").toLowerCase() === "https") return true;

  const forwarded = String(req.get("x-forwarded-proto") || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (forwarded === "https") return true;

  const ssl = String(req.get("x-forwarded-ssl") || "").toLowerCase();
  if (ssl === "on" || ssl === "1") return true;
  const frontEndHttps = String(req.get("front-end-https") || "").toLowerCase();
  if (frontEndHttps === "on") return true;

  // Local reverse proxy that omits X-Forwarded-Proto — only on loopback,
  // and only when explicitly allowed (default true for same-host Apache/nginx).
  const trustLocalProxy = process.env.EINVOICING_TRUST_LOCAL_PROXY !== "false";
  if (
    trustLocalProxy &&
    isLoopbackPeer(req) &&
    (req.get("x-forwarded-for") || req.get("x-real-ip"))
  ) {
    return true;
  }

  return false;
}

function requireHttps(req) {
  if (allowInsecureTransport()) return true;
  return isHttpsRequest(req);
}

/**
 * System-to-system Bearer auth for invoice APIs (FIRS-aligned).
 *
 * Primary: OAuth access_token from POST /api/v1/invoice/oauth/token.
 * Optional: user JWT only when EINVOICING_ALLOW_USER_JWT=true (UI/dev helper).
 * Long-lived client secrets must never be sent on data requests.
 */
function authenticateEInvoicing(passport) {
  const userJwt = passport.authenticate("jwt", { session: false });
  const allowUserJwtFlag = allowUserJwt();

  return async (req, res, next) => {
    if (!requireHttps(req)) {
      return res.status(403).json({
        error: "insecure_transport",
        error_description: "HTTPS is required for e-invoicing requests.",
      });
    }

    const auth = req.headers.authorization || "";
    if (!auth.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "invalid_token",
        error_description:
          "Authorization Bearer access_token required (system-to-system). Obtain one from POST /api/v1/invoice/oauth/token.",
      });
    }

    const token = auth.slice(7).trim();
    const oauth = verifyOAuthToken(token);
    if (oauth) {
      let businessId = oauth.business_id || NRS_BUSINESS_ID || null;
      // Tokens minted before business_id was bound: refresh from client row / KYC.
      if (!businessId && oauth.sub && db.EInvoicingClient) {
        try {
          const row = await db.EInvoicingClient.findOne({
            where: { client_id: oauth.sub, status: "active" },
          });
          if (row?.business_id) {
            businessId = String(row.business_id);
          } else if (row?.kyc_user_id) {
            businessId = await resolveKycNrsBusinessId(row.kyc_user_id);
            if (businessId && !row.business_id) {
              row.business_id = businessId;
              row.save().catch(() => {});
            }
          }
        } catch (err) {
          console.error(
            "[eInvoicingAuth] business_id refresh failed:",
            err.message || err,
          );
        }
      }

      req.oauth = {
        client_id: oauth.sub,
        sub: oauth.sub,
        business_id: businessId || null,
        environment: oauth.environment || null,
        kyc_user_id: oauth.kyc_user_id || null,
        scope: oauth.scope,
      };
      return next();
    }

    if (allowUserJwtFlag) {
      return userJwt(req, res, next);
    }

    return res.status(401).json({
      error: "invalid_token",
      error_description:
        "Invalid or expired OAuth access_token. Request a new token with grant_type=client_credentials.",
    });
  };
}

/**
 * Brute-force / abuse protection for the credential-exchange endpoint.
 * Limits attempts per client IP so an attacker can't grind client secrets
 * (and can't tie up the server in bcrypt work). Successful token requests
 * are not counted against the limit.
 */
const oauthTokenRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.EINVOICING_OAUTH_RATE_MAX || 20),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const basic = parseBasicAuth(req.headers.authorization);
    const bodyCreds = credentialsFromBody(req.body || {});
    const clientId = basic?.client_id || bodyCreds?.client_id || "unknown";
    return `oauth:${req.ip}:${clientId}`;
  },
  message: {
    error: "too_many_requests",
    error_description:
      "Too many token requests. Please wait before trying again.",
  },
});

/**
 * Rate limit authenticated invoice data APIs (create/status/payment/transmit).
 * Keyed by IP + OAuth client so one client cannot monopolize capacity.
 * Apply AFTER authenticateEInvoicing so req.oauth is available.
 */
const invoiceApiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.EINVOICING_API_RATE_MAX || 120),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const client =
      req.oauth?.client_id || req.oauth?.sub || req.user?.id || "anon";
    return `api:${req.ip}:${client}`;
  },
  message: {
    error: "too_many_requests",
    error_description:
      "Too many e-invoicing requests. Please slow down and retry shortly.",
  },
});

function resolveAuthBusinessId(req) {
  if (req.oauth?.business_id) return String(req.oauth.business_id);
  if (req.user?.nrs_business_id) return String(req.user.nrs_business_id);
  if (req.user?.facilityId) return String(req.user.facilityId);
  return null;
}

module.exports = {
  oauthToken,
  oauthTokenRateLimiter,
  invoiceApiRateLimiter,
  authenticateEInvoicing,
  resolveAuthBusinessId,
  allowGlobalClient,
  TOKEN_TTL_SEC,
};
