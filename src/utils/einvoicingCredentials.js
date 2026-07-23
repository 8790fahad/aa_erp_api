/**
 * E-Invoicing per-client credential helpers.
 *
 * Credentials are environment-scoped:
 * - testing  → issued at KYC signup (prefix fbk_test_)
 * - production → issued when KYC is approved/complete (prefix fbk_live_)
 *
 * A KYC client may hold both rows. The plaintext `client_secret` is generated,
 * hashed with bcrypt, and returned to the caller only once (issue/rotate).
 * Only the hash is persisted.
 */

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("../models");

const SALT_ROUNDS = 10;

const ENVIRONMENTS = Object.freeze({
  TESTING: "testing",
  PRODUCTION: "production",
});

const CLIENT_ID_PREFIX = Object.freeze({
  testing: "fbk_test_",
  production: "fbk_live_",
});

function normalizeEnvironment(environment) {
  const env = String(environment || ENVIRONMENTS.PRODUCTION).toLowerCase();
  if (env === "test" || env === "testing" || env === "dev" || env === "sandbox") {
    return ENVIRONMENTS.TESTING;
  }
  if (env === "prod" || env === "production" || env === "live") {
    return ENVIRONMENTS.PRODUCTION;
  }
  throw new Error(`Invalid environment: ${environment}`);
}

function generateClientId(environment = ENVIRONMENTS.PRODUCTION) {
  const env = normalizeEnvironment(environment);
  return CLIENT_ID_PREFIX[env] + crypto.randomBytes(18).toString("hex");
}

function generateClientSecret() {
  // URL-safe, high-entropy secret (~43 chars).
  return crypto.randomBytes(32).toString("base64url");
}

async function hashSecret(secret) {
  return bcrypt.hash(secret, SALT_ROUNDS);
}

function toPublicMeta(row) {
  if (!row) return null;
  return {
    client_id: row.client_id,
    environment: row.environment,
    business_id: row.business_id || null,
    kyc_user_id: row.kyc_user_id || null,
    name: row.name,
    status: row.status,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toIssueResult(row, client_secret, rotated) {
  return {
    client_id: row.client_id,
    client_secret,
    environment: row.environment,
    business_id: row.business_id || null,
    kyc_user_id: row.kyc_user_id || null,
    rotated: Boolean(rotated),
  };
}

/**
 * Find an existing credential row for the given owner + environment.
 */
async function findCredentialRow({
  kycUserId = null,
  businessId = null,
  environment = ENVIRONMENTS.PRODUCTION,
  transaction = undefined,
}) {
  const env = normalizeEnvironment(environment);
  const where = { environment: env };

  if (kycUserId) {
    where.kyc_user_id = kycUserId;
  } else if (businessId) {
    where.business_id = businessId;
  } else {
    throw new Error("kycUserId or businessId is required");
  }

  return db.EInvoicingClient.findOne({ where, transaction });
}

/**
 * Create or rotate a credential for a KYC user and/or business.
 * Returns the plaintext secret ONCE — it cannot be retrieved later.
 *
 * @param {object} opts
 * @param {string} [opts.kycUserId]
 * @param {string} [opts.businessId]
 * @param {string} [opts.environment] testing | production
 * @param {string} [opts.name]
 * @param {import("sequelize").Transaction} [opts.transaction]
 */
async function issueCredential({
  kycUserId = null,
  businessId = null,
  environment = ENVIRONMENTS.PRODUCTION,
  name = null,
  transaction = undefined,
}) {
  if (!kycUserId && !businessId) {
    throw new Error("kycUserId or businessId is required");
  }

  const env = normalizeEnvironment(environment);
  const client_secret = generateClientSecret();
  const client_secret_hash = await hashSecret(client_secret);

  const existing = await findCredentialRow({
    kycUserId,
    businessId,
    environment: env,
    transaction,
  });

  if (existing) {
    // Full rotate: new client_id + secret (old pair becomes invalid immediately).
    existing.client_id = generateClientId(env);
    existing.client_secret_hash = client_secret_hash;
    existing.status = "active";
    if (name != null) existing.name = name;
    // Backfill link fields if provided later (e.g. facility linked on approve).
    if (businessId && !existing.business_id) existing.business_id = businessId;
    if (kycUserId && !existing.kyc_user_id) existing.kyc_user_id = kycUserId;
    await existing.save({ transaction });
    return toIssueResult(existing, client_secret, true);
  }

  const client_id = generateClientId(env);
  const row = await db.EInvoicingClient.create(
    {
      business_id: businessId || null,
      kyc_user_id: kycUserId || null,
      environment: env,
      client_id,
      client_secret_hash,
      name,
      status: "active",
    },
    { transaction },
  );

  return toIssueResult(row, client_secret, false);
}

/**
 * Backward-compatible helper: issue/rotate production credentials for a business.
 */
async function issueCredentialForBusiness({
  businessId,
  name = null,
  transaction = undefined,
  environment = ENVIRONMENTS.PRODUCTION,
}) {
  if (!businessId) throw new Error("businessId is required");
  return issueCredential({
    businessId,
    name,
    transaction,
    environment,
  });
}

/** Issue/rotate testing credentials for a KYC user (signup). */
async function issueTestingCredentialForKycUser({
  kycUserId,
  businessId = null,
  name = null,
  transaction = undefined,
}) {
  if (!kycUserId) throw new Error("kycUserId is required");
  return issueCredential({
    kycUserId,
    businessId,
    environment: ENVIRONMENTS.TESTING,
    name,
    transaction,
  });
}

/** Issue/rotate production credentials for a KYC user (KYC complete). */
async function issueProductionCredentialForKycUser({
  kycUserId,
  businessId = null,
  name = null,
  transaction = undefined,
}) {
  if (!kycUserId) throw new Error("kycUserId is required");
  return issueCredential({
    kycUserId,
    businessId,
    environment: ENVIRONMENTS.PRODUCTION,
    name,
    transaction,
  });
}

/** Public metadata for a single business credential (production by default). */
async function getCredentialMeta(
  businessId,
  environment = ENVIRONMENTS.PRODUCTION,
) {
  if (!businessId) return null;
  const row = await findCredentialRow({
    businessId,
    environment,
  });
  return toPublicMeta(row);
}

/** All credential metadata for a business (all environments). */
async function listCredentialsForBusiness(businessId) {
  if (!businessId) return [];
  const rows = await db.EInvoicingClient.findAll({
    where: { business_id: businessId },
    order: [["environment", "ASC"]],
  });
  return rows.map(toPublicMeta);
}

/** All credential metadata for a KYC user (all environments). */
async function listCredentialsForKycUser(kycUserId) {
  if (!kycUserId) return [];
  const rows = await db.EInvoicingClient.findAll({
    where: { kyc_user_id: kycUserId },
    order: [["environment", "ASC"]],
  });
  return rows.map(toPublicMeta);
}

/** Prefer saved NRS Business ID from KYC service settings when client row has none. */
async function resolveKycNrsBusinessId(kycUserId) {
  if (!kycUserId || !db.KycServiceSettings) return null;
  const settings = await db.KycServiceSettings.findOne({
    where: { kyc_user_id: kycUserId, service: "e_invoice" },
  });
  const id = settings?.nrs_business_id ? String(settings.nrs_business_id).trim() : "";
  return id || null;
}

/**
 * Verify a client_id/client_secret pair against the store.
 * For KYC clients, prefer NRS Business ID from service settings when
 * einvoicing_clients.business_id is still null (pre-facility link).
 * @returns {Promise<{client_id, business_id, kyc_user_id, environment}|null>}
 */
async function verifyCredentials(clientId, clientSecret) {
  if (!clientId || !clientSecret) return null;

  const row = await db.EInvoicingClient.findOne({
    where: { client_id: clientId, status: "active" },
  });
  if (!row) return null;

  const ok = await bcrypt.compare(clientSecret, row.client_secret_hash);
  if (!ok) return null;

  // Best-effort last-used tracking; never block auth on this.
  row.last_used_at = new Date();
  row.save().catch(() => {});

  let businessId = row.business_id ? String(row.business_id).trim() : null;
  // Backfill from KYC NRS settings when the client row has no business_id yet.
  // Does not overwrite an already-bound production/facility business_id.
  if (!businessId && row.kyc_user_id) {
    const nrsId = await resolveKycNrsBusinessId(row.kyc_user_id);
    if (nrsId) {
      businessId = nrsId;
      row.business_id = businessId;
      row.save().catch(() => {});
    }
  }

  return {
    client_id: row.client_id,
    business_id: businessId,
    kyc_user_id: row.kyc_user_id || null,
    environment: row.environment || null,
  };
}

module.exports = {
  ENVIRONMENTS,
  CLIENT_ID_PREFIX,
  normalizeEnvironment,
  generateClientId,
  generateClientSecret,
  issueCredential,
  issueCredentialForBusiness,
  issueTestingCredentialForKycUser,
  issueProductionCredentialForKycUser,
  getCredentialMeta,
  listCredentialsForBusiness,
  listCredentialsForKycUser,
  verifyCredentials,
  findCredentialRow,
  resolveKycNrsBusinessId,
};
