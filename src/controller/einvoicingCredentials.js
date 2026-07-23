/**
 * E-Invoicing credential management (per-business).
 *
 * These endpoints are protected by the standard user JWT. The business is
 * always derived from the authenticated principal — clients cannot manage
 * credentials for a business they don't own.
 */

const {
  issueCredentialForBusiness,
  getCredentialMeta,
  listCredentialsForBusiness,
  normalizeEnvironment,
  ENVIRONMENTS,
} = require("../utils/einvoicingCredentials");
const { resolveAuthBusinessId } = require("../middleware/eInvoicingAuth");

function canManageInvoiceCredentials(user = {}) {
  const role = String(user.role || "").toLowerCase();
  return role === "admin" || role === "superadmin" || role === "owner";
}

/**
 * GET /api/v1/invoice/credentials — credential metadata (no secret).
 * Optional query: ?environment=testing|production
 * Without environment, returns all credential rows + legacy `data` = production.
 */
exports.getCredentials = async (req, res) => {
  const businessId = resolveAuthBusinessId(req);
  if (!businessId) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized: no business associated with this account.",
    });
  }

  try {
    if (req.query.environment) {
      let environment;
      try {
        environment = normalizeEnvironment(req.query.environment);
      } catch {
        return res.status(400).json({
          success: false,
          message: 'environment must be "testing" or "production"',
        });
      }
      const meta = await getCredentialMeta(businessId, environment);
      if (!meta) {
        return res.status(404).json({
          success: false,
          message: `No ${environment} e-invoicing credentials found for this business.`,
        });
      }
      return res.status(200).json({ success: true, data: meta });
    }

    const credentials = await listCredentialsForBusiness(businessId);
    if (!credentials.length) {
      return res.status(404).json({
        success: false,
        message:
          "No e-invoicing credentials found for this business. Rotate to generate a new pair.",
      });
    }

    const production =
      credentials.find((c) => c.environment === ENVIRONMENTS.PRODUCTION) ||
      credentials[0];

    return res.status(200).json({
      success: true,
      data: production,
      credentials,
    });
  } catch (err) {
    console.error("getCredentials error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to load credentials." });
  }
};

/**
 * POST /api/v1/invoice/credentials/rotate — (re)generate the secret.
 * Body: { environment?: "testing"|"production", name?: string }
 * Defaults to production. Returns the plaintext client_secret ONCE.
 */
exports.rotateCredentials = async (req, res) => {
  if (!canManageInvoiceCredentials(req.user)) {
    return res.status(403).json({
      success: false,
      message: "Forbidden: admin access is required to rotate credentials.",
    });
  }

  const businessId = resolveAuthBusinessId(req);
  if (!businessId) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized: no business associated with this account.",
    });
  }

  let environment = ENVIRONMENTS.PRODUCTION;
  try {
    if (req.body?.environment) {
      environment = normalizeEnvironment(req.body.environment);
    }
  } catch {
    return res.status(400).json({
      success: false,
      message: 'environment must be "testing" or "production"',
    });
  }

  try {
    const cred = await issueCredentialForBusiness({
      businessId,
      name: req.body?.name,
      environment,
    });
    return res.status(200).json({
      success: true,
      message: cred.rotated
        ? "Credentials rotated. Previous secret is now invalid."
        : "Credentials created.",
      data: {
        client_id: cred.client_id,
        client_secret: cred.client_secret,
        environment: cred.environment,
        business_id: cred.business_id,
        note: "Store client_secret securely — it will not be shown again.",
      },
    });
  } catch (err) {
    console.error("rotateCredentials error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to rotate credentials." });
  }
};
