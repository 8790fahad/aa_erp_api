"use strict";

/**
 * KYC auth — signup / phone OTP / login (password + email OTP) / email verification against `kyc_users` only.
 * Intentionally does NOT create AA ERP `users` or business records.
 */

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const { MailtrapTransport } = require("mailtrap");
const db = require("../models");
const { mailFrom } = require("../config/mailFrom");
const SMS = require("../services/smsApi");
const { verifyRecaptchaToken } = require("../utils/recaptcha");

const JWT_SECRET = (() => {
  const secret = process.env.JWT_SECRET_KEY || process.env.JWT_SECRET;
  if (secret && String(secret).length >= 16) return String(secret);
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET_KEY is missing or too short (>=16 chars required in production).",
    );
  }
  console.warn(
    "[kycAuth] JWT_SECRET_KEY unset/weak — using insecure dev-only secret. Do not expose this host publicly.",
  );
  return "insecure-dev-only-secret-change-me";
})();

const MIN_PASSWORD_LENGTH = 8;

// Temporary: accept legacy plaintext OTP/reset/verification tokens once, to bridge
// rows created before hashing. Set KYC_ALLOW_LEGACY_PLAINTEXT=false (default) to
// remove this compatibility path after data migration is confirmed complete.
const ALLOW_LEGACY_PLAINTEXT =
  process.env.KYC_ALLOW_LEGACY_PLAINTEXT === "true";

function hashSecret(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function secretsEqual(stored, provided) {
  const hashed = hashSecret(provided);
  const storedStr = String(stored || "");
  const hashedBuf = Buffer.from(hashed, "utf8");
  const storedBuf = Buffer.from(storedStr, "utf8");

  if (storedBuf.length === hashedBuf.length) {
    try {
      if (crypto.timingSafeEqual(storedBuf, hashedBuf)) return true;
    } catch {
      // fall through to legacy check
    }
  }

  // Legacy plaintext migration (opt-in): accept once if stored value is not a
  // 64-char hex hash. Disabled by default; enable only during migration.
  if (ALLOW_LEGACY_PLAINTEXT) {
    const looksHashed =
      storedStr.length === 64 && /^[0-9a-f]+$/i.test(storedStr);
    if (!looksHashed && storedStr === String(provided)) {
      return true;
    }
  }
  return false;
}

function encodeBvn(bvn) {
  const digits = String(bvn || "").replace(/\D/g, "");
  return `sha256:${hashSecret(digits)}:${digits.slice(-4)}`;
}

function maskBvn(bvn) {
  const s = String(bvn || "");
  const encoded = s.match(/^sha256:[0-9a-f]{64}:(\d{4})$/i);
  if (encoded) return `*******${encoded[1]}`;
  if (s.length < 4) return "****";
  // Legacy plaintext rows are masked on output until migrated by edit/save.
  return `*******${s.slice(-4)}`;
}

const KYC_ADMIN_API_KEY = process.env.KYC_ADMIN_API_KEY || "";
let kycAdminKeyWarned = false;

function getKycFrontendBaseUrl() {
  // Dev emails → local Connect app; production emails → live Connect.
  const isProd = process.env.NODE_ENV === "production";
  const raw = isProd
    ? process.env.KYC_FRONTEND_URL_PROD ||
      process.env.KYC_FRONTEND_URL ||
      "https://connect.aa_erp.org"
    : process.env.KYC_FRONTEND_URL_DEV || "http://localhost:5173";
  return String(raw).replace(/\/$/, "");
}

function buildVerificationUrl(token, email) {
  const params = new URLSearchParams({
    token: String(token),
    type: "login",
    email: String(email),
  });
  return `${getKycFrontendBaseUrl()}/verify-email?${params.toString()}`;
}

const LOGIN_OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const PHONE_OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

function createMailTransport() {
  return nodemailer.createTransport(
    MailtrapTransport({
      token: process.env.MAILTRAP_TOKEN,
    }),
  );
}

function getCompanyMailBranding() {
  return {
    companyLogoUrl:
      process.env.COMPANY_LOGO_URL ||
      "https://res.cloudinary.com/drxkp1erj/image/upload/aa_erp-blue_utcqmg.png",
    companyWebsite: process.env.COMPANY_WEBSITE || "https://aa_erp.org",
    companyEmail: process.env.COMPANY_EMAIL || "hello@aa_erp.org",
    companyPhone: process.env.COMPANY_PHONE || "+2348067643479",
    companyTwitter: process.env.COMPANY_TWITTER || "https://x.com/aa_erpng",
    companyInstagram:
      process.env.COMPANY_INSTAGRAM || "https://www.instagram.com/aa_erpng",
    companyLinkedIn:
      process.env.COMPANY_LINKEDIN ||
      "https://www.linkedin.com/company/aa_erpng",
    companyFacebook:
      process.env.COMPANY_FACEBOOK || "https://www.facebook.com/aa_erpng",
  };
}

/** Standard AA ERP mail footer (website, email, phone, social icons). */
function buildCompanyMailFooter(branding = getCompanyMailBranding()) {
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

function generateLoginOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function generatePhoneOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

/** BulkSMS DND/OTP template: display 6-digit codes as XXX_XXX. */
function formatOtpForSms(otp) {
  const digits = String(otp || "").replace(/\D/g, "");
  if (digits.length === 6) {
    return `${digits.slice(0, 3)}_${digits.slice(3)}`;
  }
  return digits;
}

/** Accept user input with or without separators (e.g. 160_454 → 160454). */
function normalizeOtpInput(otp) {
  return String(otp || "").replace(/\D/g, "");
}

/** Normalize to BulkSMS-friendly Nigerian MSISDN (234…). */
function normalizePhoneForSms(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  // 0023480… → 23480…
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) {
    digits = `234${digits.slice(1)}`;
  } else if (!digits.startsWith("234") && digits.length === 10) {
    digits = `234${digits}`;
  }
  return digits;
}

function sendSmsAsync(phone, message, options = {}) {
  return new Promise((resolve, reject) => {
    SMS.send(
      phone,
      message,
      (resp) => resolve(resp),
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
      options,
    );
  });
}

async function saveAndSendPhoneOtp(user) {
  const otp = generatePhoneOtp();
  user.phone_code = hashSecret(otp);
  user.phone_code_expires = new Date(Date.now() + PHONE_OTP_TTL_MS);
  await user.save();

  const to = normalizePhoneForSms(user.phone);
  if (!to) {
    throw new Error("A valid phone number is required to send SMS");
  }

  const message = `Your AA ERP One-time Pass is ${formatOtpForSms(otp)}. Use immediately`;
  let smsSent = false;
  let smsError = null;
  try {
    const resp = await SMS.sendOtpReliable(to, message);
    smsSent = true;
    console.info(
      "[kycAuth] phone OTP SMS accepted for",
      to,
      "provider=",
      resp?.provider || "bulksms",
      "gateway_used=",
      resp?.data?.gateway_used || null,
      "message_id=",
      resp?.data?.message_id || null,
    );
  } catch (smsErr) {
    smsError = smsErr;
    console.error("[kycAuth] phone OTP SMS failed:", smsErr.message || smsErr);
  }

  if (process.env.NODE_ENV !== "production") {
    console.info(`[kycAuth] DEV phone OTP for ${to}: ${otp}`);
  }

  return { otp, smsSent, smsError, to };
}

async function sendVerificationEmail({ email, firstName, token }) {
  const verificationUrl = buildVerificationUrl(token, email);
  const transport = createMailTransport();
  const branding = getCompanyMailBranding();
  const { companyLogoUrl } = branding;

  await transport.sendMail({
    from: mailFrom("AA ERP KYC"),
    to: email,
    subject: "AA ERP KYC - Verify your email",
    category: "KYC Email Verification",
    html: `
      <div style="background-color:#f5f5f7;padding:24px 0;font-family:Arial,sans-serif;">
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.06);">
          <div style="padding:20px 24px 0 24px;">
            <img src="${companyLogoUrl}" alt="AA ERP" style="display:block;height:32px;width:auto;object-fit:contain;" />
          </div>
          <div style="padding:24px 24px 16px 24px;">
            <h2 style="margin:0 0 16px;font-size:22px;color:#111;">Hi ${firstName || "there"}!</h2>
            <p style="margin:0 0 12px;font-size:14px;color:#333;line-height:1.6;">
              Welcome to <strong style="color:#4267B2;">AA ERP KYC</strong>.
            </p>
            <p style="margin:0 0 20px;font-size:14px;color:#333;line-height:1.6;">
              Please verify your email address to activate your account.
            </p>
            <div style="text-align:center;margin-bottom:20px;">
              <a href="${verificationUrl}"
                 style="display:inline-block;background:#4267B2;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
                Verify Email
              </a>
            </div>
            <p style="margin:0 0 24px;font-size:12px;color:#777;line-height:1.6;">
              If you did not create this account, you can ignore this email.
            </p>
            <p style="margin:0 0 8px;font-size:13px;color:#555;">
              With respect,<br/>
              <strong>AA ERP Team</strong>
            </p>
          </div>
          ${buildCompanyMailFooter(branding)}
        </div>
      </div>
    `,
  });
}

async function sendLoginOtpEmail({ email, firstName, otp }) {
  const transport = createMailTransport();
  const branding = getCompanyMailBranding();
  const { companyLogoUrl } = branding;

  await transport.sendMail({
    from: mailFrom("AA ERP KYC"),
    to: email,
    subject: "Your AA ERP KYC login code",
    category: "KYC Login OTP",
    html: `
      <div style="background-color:#f5f5f7;padding:24px 0;font-family:Arial,sans-serif;">
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.06);">
          <div style="padding:20px 24px 0 24px;">
            <img src="${companyLogoUrl}" alt="AA ERP" style="display:block;height:32px;width:auto;object-fit:contain;" />
          </div>
          <div style="padding:24px 24px 16px 24px;">
            <h2 style="margin:0 0 16px;font-size:22px;color:#111;">Hi ${firstName || "there"}!</h2>
            <p style="margin:0 0 12px;font-size:14px;color:#333;line-height:1.6;">
              Use this code to finish signing in to <strong style="color:#4267B2;">AA ERP KYC</strong>.
            </p>
            <div style="text-align:center;margin:24px 0;">
              <div style="display:inline-block;background:#f0f4ff;color:#111;padding:14px 28px;border-radius:8px;font-size:28px;letter-spacing:8px;font-weight:bold;">
                ${otp}
              </div>
            </div>
            <p style="margin:0 0 24px;font-size:14px;color:#333;line-height:1.6;">
              This code expires in 10 minutes. If you did not try to sign in, you can ignore this email.
            </p>
            <p style="margin:0 0 8px;font-size:13px;color:#555;">
              With respect,<br/>
              <strong>AA ERP Team</strong>
            </p>
          </div>
          ${buildCompanyMailFooter(branding)}
        </div>
      </div>
    `,
  });
}

function issueKycJwt(user) {
  const payload = {
    id: user.id,
    email: user.email,
    scope: "kyc",
  };
  const token = jwt.sign(payload, JWT_SECRET, {
    expiresIn: "7d",
    algorithm: "HS256",
  });
  return {
    success: true,
    token: `Bearer ${token}`,
    user: publicKycUser(user),
    business: null,
  };
}

/** Prevent SMTP hangs from stalling login until the reverse proxy drops CORS headers. */
async function saveAndSendLoginOtp(user) {
  const otp = generateLoginOtp();
  user.code = hashSecret(otp);
  user.expiring_code = new Date(Date.now() + LOGIN_OTP_TTL_MS);
  await user.save();

  // Never block HTTP login on SMTP. A hung Mailtrap call used to stall until
  // Apache cut the connection — browsers then report a misleading CORS error.
  const emailPromise = sendLoginOtpEmail({
    email: user.email,
    firstName: user.first_name,
    otp,
  });
  emailPromise.catch((emailErr) => {
    console.error(
      "[kycAuth] Login OTP email failed:",
      emailErr?.message || emailErr,
    );
  });

  if (process.env.NODE_ENV !== "production") {
    console.info(`[kycAuth] DEV login OTP for ${user.email}: ${otp}`);
  }

  return otp;
}

function publicKycUser(row) {
  const status = row.status;
  const emailVerified =
    Boolean(row.email_verified) ||
    status === "verified" ||
    status === "approved";
  return {
    id: row.id,
    email: row.email,
    firstname: row.first_name,
    lastname: row.last_name,
    fullname: [row.first_name, row.last_name].filter(Boolean).join(" "),
    phone: row.phone,
    busName: row.business_name,
    country: row.country,
    status,
    emailVerified,
    phoneVerified: Boolean(row.phone_verified),
    kycSubmitted: Boolean(row.kyc_submitted_at) || status === "approved",
    kycSubmittedAt: row.kyc_submitted_at || null,
  };
}

exports.checkEmailExists = async (req, res) => {
  const { email } = req.body;
  if (!email || !String(email).trim()) {
    return res.status(400).json({
      success: false,
      exists: false,
      message: "Email is required",
    });
  }

  try {
    // Avoid exposing registration state from this helper. The signup endpoint
    // performs the authoritative duplicate check.
    return res.json({
      success: true,
      exists: false,
      message: "If this email can be used, signup may continue.",
    });
  } catch (err) {
    console.error("[kycAuth] checkEmailExists:", err);
    return res.status(500).json({
      success: false,
      exists: false,
      message: "Error checking email availability",
    });
  }
};

exports.signup = async (req, res) => {
  const {
    email,
    password,
    firstname = "",
    lastname = "",
    phone = "",
    busName = "",
    country = "NG",
    recaptchaToken = "",
  } = req.body || {};

  const trimmedEmail = String(email || "")
    .trim()
    .toLowerCase();
  const trimmedPhone = String(phone || "").trim();

  if (!trimmedEmail || !password) {
    return res.status(400).json({
      success: false,
      msg: "Email and password are required",
    });
  }
  if (!trimmedPhone) {
    return res.status(400).json({
      success: false,
      msg: "Phone number is required",
    });
  }
  if (!normalizePhoneForSms(trimmedPhone)) {
    return res.status(400).json({
      success: false,
      msg: "Enter a valid phone number",
    });
  }
  if (String(password).length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({
      success: false,
      msg: `Your password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    });
  }

  const captcha = await verifyRecaptchaToken(recaptchaToken, {
    remoteip: req.ip || req.connection?.remoteAddress,
    userAgent: req.get("user-agent") || undefined,
    expectedAction: "signup",
  });
  if (!captcha.ok) {
    const detail =
      Array.isArray(captcha.errorCodes) && captcha.errorCodes.length
        ? ` (${captcha.errorCodes.join(", ")})`
        : "";
    console.warn("[kycAuth] signup reCAPTCHA rejected:", captcha);
    return res.status(400).json({
      success: false,
      msg:
        captcha.errorCodes?.includes("missing-enterprise-config")
          ? "reCAPTCHA is not fully configured on the server (set RECAPTCHA_PROJECT_ID and RECAPTCHA_API_KEY)"
          : `Please complete the reCAPTCHA verification${process.env.NODE_ENV !== "production" ? detail : ""}`,
    });
  }

  try {
    const existing = await db.KycUser.findOne({
      where: { email: trimmedEmail },
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        msg: "Unable to complete signup with the provided details.",
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(String(password), salt);
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const kycUser = await db.KycUser.create({
      business_name: busName || null,
      country: country || "NG",
      first_name: firstname || null,
      last_name: lastname || null,
      email: trimmedEmail,
      phone: trimmedPhone,
      password: hashedPassword,
      verification_token: hashSecret(verificationToken),
      verification_expires: verificationExpires,
      email_verified: false,
      phone_verified: false,
      status: "pending",
    });

    let smsSent = false;
    let phoneOtp = null;
    try {
      const phoneResult = await saveAndSendPhoneOtp(kycUser);
      smsSent = phoneResult.smsSent;
      phoneOtp = phoneResult.otp;
    } catch (phoneErr) {
      console.error("[kycAuth] phone OTP setup failed:", phoneErr);
    }

    // TESTING e-invoicing credentials removed — e-invoicing is not enabled for this build.

    const payload = {
      success: true,
      msg: smsSent
        ? "Account created. Enter the SMS code sent to your phone."
        : "Account created. SMS may not have delivered — request a resend if needed.",
      phoneVerificationRequired: true,
      smsSent,
      user: publicKycUser(kycUser),
    };
    // Local/dev only — helps verify flow when carrier delivery is delayed.
    if (process.env.NODE_ENV !== "production" && phoneOtp) {
      payload.devPhoneOtp = phoneOtp;
    }

    return res.json(payload);
  } catch (err) {
    console.error("[kycAuth] signup:", err);
    return res.status(500).json({
      success: false,
      msg: err.message || "Registration failed",
    });
  }
};

exports.verifyPhoneOtp = async (req, res) => {
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  const otp = normalizeOtpInput(req.body?.otp);

  if (!email || !otp) {
    return res.status(400).json({
      success: false,
      message: "Email and verification code are required",
    });
  }

  try {
    const user = await db.KycUser.findOne({ where: { email } });
    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification code",
      });
    }
    if (user.phone_verified) {
      return res.json({
        success: true,
        message: "Phone already verified. Check your email to continue.",
        phoneVerified: true,
      });
    }
    if (!user.phone_code || !secretsEqual(user.phone_code, otp)) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification code",
      });
    }
    if (
      user.phone_code_expires &&
      new Date(user.phone_code_expires).getTime() < Date.now()
    ) {
      return res.status(400).json({
        success: false,
        message: "Verification code has expired. Request a new one.",
      });
    }

    user.phone_verified = true;
    user.phone_code = null;
    user.phone_code_expires = null;
    await user.save();

    // Send email verification only after phone is confirmed.
    try {
      const verificationToken = crypto.randomBytes(32).toString("hex");
      const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
      user.verification_token = hashSecret(verificationToken);
      user.verification_expires = verificationExpires;
      await user.save();

      await sendVerificationEmail({
        email: user.email,
        firstName: user.first_name,
        token: verificationToken,
      });
    } catch (emailErr) {
      console.error("[kycAuth] verification email after phone OTP failed:", emailErr);
    }

    return res.json({
      success: true,
      message: "Phone verified. Check your email to activate your account.",
      phoneVerified: true,
      user: publicKycUser(user),
    });
  } catch (err) {
    console.error("[kycAuth] verifyPhoneOtp:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to verify phone number",
    });
  }
};

exports.resendPhoneOtp = async (req, res) => {
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  const recaptchaToken = String(req.body?.recaptchaToken || "").trim();

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Email is required",
    });
  }

  const captcha = await verifyRecaptchaToken(recaptchaToken, {
    remoteip: req.ip || req.connection?.remoteAddress,
    userAgent: req.get("user-agent") || undefined,
    expectedAction: "resend_phone",
  });
  if (!captcha.ok) {
    return res.status(400).json({
      success: false,
      message: "Please complete the reCAPTCHA verification",
    });
  }

  try {
    const user = await db.KycUser.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found with that email",
      });
    }
    if (user.phone_verified) {
      return res.status(400).json({
        success: false,
        message: "Phone number is already verified",
      });
    }
    if (user.status === "suspended") {
      return res.status(403).json({
        success: false,
        message: "Your account has been suspended",
      });
    }
    if (!user.phone) {
      return res.status(400).json({
        success: false,
        message: "No phone number on this account",
      });
    }

    const { smsSent, otp } = await saveAndSendPhoneOtp(user);
    const payload = {
      success: true,
      smsSent,
      message: smsSent
        ? "A new verification code has been sent to your phone"
        : "Verification code generated, but SMS could not be delivered. Try again shortly.",
    };
    if (process.env.NODE_ENV !== "production" && otp) {
      payload.devPhoneOtp = otp;
    }
    return res.json(payload);
  } catch (err) {
    console.error("[kycAuth] resendPhoneOtp:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to resend phone verification code",
    });
  }
};

exports.resendVerification = async (req, res) => {
  const email = String(req.query.email || req.body?.email || "")
    .trim()
    .toLowerCase();
  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Email is required",
    });
  }

  const okResponse = {
    success: true,
    message:
      "If the account is eligible, a verification email will be sent shortly.",
  };

  try {
    const user = await db.KycUser.findOne({ where: { email } });
    if (!user) {
      return res.json(okResponse);
    }
    if (user.email_verified || user.status === "verified") {
      return res.json(okResponse);
    }
    if (!user.phone_verified) {
      return res.json(okResponse);
    }
    if (user.status === "suspended") {
      return res.json(okResponse);
    }

    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    user.verification_token = hashSecret(verificationToken);
    user.verification_expires = verificationExpires;
    await user.save();

    await sendVerificationEmail({
      email,
      firstName: user.first_name,
      token: verificationToken,
    });

    return res.json(okResponse);
  } catch (err) {
    console.error("[kycAuth] resendVerification:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to send verification email",
    });
  }
};

function buildPasswordResetUrl(token, email) {
  const params = new URLSearchParams({
    token: String(token),
    email: String(email),
  });
  return `${getKycFrontendBaseUrl()}/reset-password?${params.toString()}`;
}

async function sendPasswordResetEmail({ email, firstName, token }) {
  const resetUrl = buildPasswordResetUrl(token, email);
  const transport = createMailTransport();
  const branding = getCompanyMailBranding();
  const { companyLogoUrl } = branding;

  await transport.sendMail({
    from: mailFrom("AA ERP KYC"),
    to: email,
    subject: "Reset your AA ERP KYC password",
    category: "KYC Password Reset",
    html: `
      <div style="background-color:#f5f5f7;padding:24px 0;font-family:Arial,sans-serif;">
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.06);">
          <div style="padding:20px 24px 0 24px;">
            <img src="${companyLogoUrl}" alt="AA ERP" style="display:block;height:32px;width:auto;" />
          </div>
          <div style="padding:24px 24px 16px 24px;">
            <h2 style="margin:0 0 16px;font-size:22px;color:#111;">Hi ${firstName || "there"}!</h2>
            <p style="margin:0 0 12px;font-size:14px;color:#333;line-height:1.6;">
              We received a request to reset your <strong style="color:#4267B2;">AA ERP KYC</strong> password.
            </p>
            <p style="margin:0 0 20px;font-size:14px;color:#333;line-height:1.6;">
              Click the button below to choose a new password. This link expires in 1 hour.
            </p>
            <div style="text-align:center;margin-bottom:20px;">
              <a href="${resetUrl}"
                 style="display:inline-block;background:#4267B2;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
                Reset Password
              </a>
            </div>
            <p style="margin:0 0 24px;font-size:12px;color:#777;line-height:1.6;">
              If you did not request a password reset, you can ignore this email.
            </p>
            <p style="margin:0 0 8px;font-size:13px;color:#555;">
              With respect,<br/>
              <strong>AA ERP Team</strong>
            </p>
          </div>
          ${buildCompanyMailFooter(branding)}
        </div>
      </div>
    `,
  });
}

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

exports.forgotPassword = async (req, res) => {
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Email is required",
    });
  }

  // Always return the same success message to avoid account enumeration.
  const okResponse = {
    success: true,
    message:
      "If an account exists for that email, we sent a password reset link. Check your inbox.",
  };

  try {
    const user = await db.KycUser.findOne({ where: { email } });
    if (!user || user.status === "suspended") {
      return res.json(okResponse);
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    user.reset_token = hashSecret(resetToken);
    user.reset_expires = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
    await user.save();

    try {
      await sendPasswordResetEmail({
        email: user.email,
        firstName: user.first_name,
        token: resetToken,
      });
    } catch (emailErr) {
      console.error("[kycAuth] forgotPassword email failed:", emailErr);
      return res.status(500).json({
        success: false,
        message: "Could not send reset email. Please try again.",
      });
    }

    return res.json(okResponse);
  } catch (err) {
    console.error("[kycAuth] forgotPassword:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to process password reset request",
    });
  }
};

exports.resetPassword = async (req, res) => {
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  const token = String(req.body?.token || "").trim();
  const password = String(req.body?.password || "");

  if (!email || !token || !password) {
    return res.status(400).json({
      success: false,
      message: "Email, token, and new password are required",
    });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({
      success: false,
      message: `Your password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    });
  }

  try {
    const user = await db.KycUser.findOne({ where: { email } });
    if (!user || !secretsEqual(user.reset_token, token)) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset link",
      });
    }
    if (
      user.reset_expires &&
      new Date(user.reset_expires).getTime() < Date.now()
    ) {
      return res.status(400).json({
        success: false,
        message: "This reset link has expired. Request a new one.",
      });
    }
    if (user.status === "suspended") {
      return res.status(403).json({
        success: false,
        message: "Your account has been suspended",
      });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    user.reset_token = null;
    user.reset_expires = null;
    // Clear any pending login OTP so the new password is used cleanly.
    user.code = null;
    user.expiring_code = null;
    await user.save();

    return res.json({
      success: true,
      message: "Password has been reset successfully. You can now sign in.",
    });
  } catch (err) {
    console.error("[kycAuth] resetPassword:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to reset password",
    });
  }
};

exports.verifyEmail = async (req, res) => {
  const token = String(req.query.token || "");
  const email = String(req.query.email || "")
    .trim()
    .toLowerCase();

  if (!token || !email) {
    return res.status(400).json({
      success: false,
      message: "Invalid or incomplete verification link",
    });
  }

  try {
    const user = await db.KycUser.findOne({ where: { email } });
    if (!user) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid or expired token. Request a new verification email from the sign-up screen, or sign in if you already verified.",
      });
    }

    if (!secretsEqual(user.verification_token, token)) {
      if (
        user.email_verified ||
        user.status === "verified" ||
        user.status === "approved"
      ) {
        return res.json({
          success: true,
          alreadyVerified: true,
          message: "Your email is already verified. You can sign in.",
        });
      }
      return res.status(400).json({
        success: false,
        message:
          "Invalid or expired token. Request a new verification email from the sign-up screen, or sign in if you already verified.",
      });
    }
    if (
      user.verification_expires &&
      new Date(user.verification_expires).getTime() < Date.now()
    ) {
      return res.status(400).json({
        success: false,
        message: "Token has expired. Please request a new verification email.",
      });
    }

    user.email_verified = true;
    user.status = "verified";
    user.verification_token = null;
    user.verification_expires = null;
    await user.save();

    return res.json({
      success: true,
      message: "Email verified successfully! You can now sign in.",
    });
  } catch (err) {
    console.error("[kycAuth] verifyEmail:", err);
    return res.status(500).json({
      success: false,
      message: "Server error during verification",
    });
  }
};

exports.login = async (req, res) => {
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  const password = String(req.body?.password || "");

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email and password are required",
    });
  }

  try {
    const user = await db.KycUser.findOne({ where: { email } });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }
    if (user.status === "suspended") {
      return res.status(403).json({
        success: false,
        message: "Your account has been suspended",
      });
    }
    if (!user.email_verified && user.status !== "verified") {
      return res.status(403).json({
        success: false,
        message: "Unable to sign in. Complete the required account verification steps.",
      });
    }
    if (!user.phone_verified) {
      return res.status(403).json({
        success: false,
        message: "Unable to sign in. Complete the required account verification steps.",
        phoneVerificationRequired: true,
      });
    }
    if (!user.password) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    try {
      await saveAndSendLoginOtp(user);
    } catch (emailErr) {
      console.error("[kycAuth] login OTP failed:", emailErr);
      return res.status(500).json({
        success: false,
        message: "Could not send login code. Please try again.",
      });
    }

    return res.json({
      success: true,
      requiresOtp: true,
      email: user.email,
      message: "A login code has been sent to your email",
    });
  } catch (err) {
    console.error("[kycAuth] login:", err);
    return res.status(500).json({
      success: false,
      message: "Server error during login",
    });
  }
};

exports.verifyLoginOtp = async (req, res) => {
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  const otp = String(req.body?.otp ?? "").trim();

  if (!email || !otp) {
    return res.status(400).json({
      success: false,
      message: "Email and OTP are required",
    });
  }

  try {
    const user = await db.KycUser.findOne({ where: { email } });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid login code",
      });
    }
    if (user.status === "suspended") {
      return res.status(403).json({
        success: false,
        message: "Your account has been suspended",
      });
    }
    if (!user.email_verified && user.status !== "verified") {
      return res.status(403).json({
        success: false,
        message: "Your account is not yet verified, check mail for verification",
      });
    }

    if (!user.code || !secretsEqual(user.code, otp)) {
      return res.status(401).json({
        success: false,
        message: "Invalid login code",
      });
    }
    if (
      !user.expiring_code ||
      new Date(user.expiring_code).getTime() < Date.now()
    ) {
      return res.status(401).json({
        success: false,
        message: "Login code has expired",
      });
    }

    user.code = null;
    user.expiring_code = null;
    await user.save();

    return res.json(issueKycJwt(user));
  } catch (err) {
    console.error("[kycAuth] verifyLoginOtp:", err);
    return res.status(500).json({
      success: false,
      message: "Server error during OTP verification",
    });
  }
};

exports.resendLoginOtp = async (req, res) => {
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Email is required",
    });
  }

  const okResponse = {
    success: true,
    requiresOtp: true,
    email,
    message: "If the account is eligible, a new login code will be sent.",
  };

  try {
    const user = await db.KycUser.findOne({ where: { email } });
    if (!user) {
      return res.json(okResponse);
    }
    if (user.status === "suspended") {
      return res.json(okResponse);
    }
    if (!user.email_verified && user.status !== "verified") {
      return res.json(okResponse);
    }

    try {
      await saveAndSendLoginOtp(user);
    } catch (emailErr) {
      console.error("[kycAuth] resend login OTP email failed:", emailErr);
      return res.status(500).json({
        success: false,
        message: "Could not send login code. Please try again.",
      });
    }

    return res.json(okResponse);
  } catch (err) {
    console.error("[kycAuth] resendLoginOtp:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while resending login code",
    });
  }
};

/**
 * Middleware: Bearer JWT with scope "kyc" for KYC dashboard APIs.
 */
exports.requireKycJwt = async (req, res, next) => {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Authorization Bearer token required",
    });
  }

  try {
    const raw = auth.slice(7).trim();
    const payload = jwt.verify(raw, JWT_SECRET, { algorithms: ["HS256"] });
    if (payload.scope !== "kyc" || !payload.id) {
      return res.status(401).json({
        success: false,
        message: "Invalid KYC token",
      });
    }
    const user = await db.KycUser.findByPk(payload.id);
    if (!user || user.status === "suspended") {
      return res.status(401).json({
        success: false,
        message: "KYC account not found or suspended",
      });
    }
    req.kycUser = user;
    return next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired KYC token",
    });
  }
};

/** GET /api/kyc/me — current KYC profile (email/phone verification flags). */
exports.getMe = async (req, res) => {
  try {
    const user = req.kycUser;
    return res.json({
      success: true,
      user: publicKycUser(user),
    });
  } catch (err) {
    console.error("[kycAuth] getMe:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load profile",
    });
  }
};

function publicKycContact(row) {
  return {
    id: row.id,
    title: row.title,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** GET /api/kyc/contact-information — saved KYC contact person (not main users table). */
exports.getContactInformation = async (req, res) => {
  try {
    const record = await db.KycContactInformation.findOne({
      where: { kyc_user_id: req.kycUser.id },
    });
    return res.json({
      success: true,
      contact: record ? publicKycContact(record) : null,
      complete: Boolean(record),
    });
  } catch (err) {
    console.error("[kycAuth] getContactInformation:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load contact information",
    });
  }
};

/** POST /api/kyc/contact-information — upsert KYC contact person details. */
exports.saveContactInformation = async (req, res) => {
  const title = String(req.body?.title || "").trim();
  const firstName = String(
    req.body?.firstName || req.body?.first_name || "",
  ).trim();
  const lastName = String(
    req.body?.lastName || req.body?.last_name || "",
  ).trim();
  const phone = String(req.body?.phone || "").trim();

  if (!title || !firstName || !lastName || !phone) {
    return res.status(400).json({
      success: false,
      message: "Title, first name, last name, and phone are required",
    });
  }

  try {
    const [record, created] = await db.KycContactInformation.findOrCreate({
      where: { kyc_user_id: req.kycUser.id },
      defaults: {
        title,
        first_name: firstName,
        last_name: lastName,
        phone,
      },
    });

    if (!created) {
      record.title = title;
      record.first_name = firstName;
      record.last_name = lastName;
      record.phone = phone;
      await record.save();
    }

    return res.json({
      success: true,
      message: "Contact information saved",
      contact: publicKycContact(record),
      complete: true,
    });
  } catch (err) {
    console.error("[kycAuth] saveContactInformation:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to save contact information",
    });
  }
};

function publicKycStakeholder(row) {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    gender: row.gender,
    dateOfBirth: row.date_of_birth,
    phone: row.phone,
    bvn: maskBvn(row.bvn),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseStakeholderBody(body) {
  const firstName = String(body?.firstName || body?.first_name || "").trim();
  const lastName = String(body?.lastName || body?.last_name || "").trim();
  const gender = String(body?.gender || "").trim();
  const dateOfBirth = String(
    body?.dateOfBirth || body?.date_of_birth || "",
  ).trim();
  const phone = String(body?.phone || "").trim();
  const bvn = String(body?.bvn || "").trim();

  const errors = [];
  if (!firstName) errors.push("first name is required");
  if (!lastName) errors.push("last name is required");
  if (!gender) errors.push("gender is required");
  if (!dateOfBirth) errors.push("date of birth is required");
  if (!phone) errors.push("phone is required");
  if (!/^\d{11}$/.test(bvn)) errors.push("BVN must be an 11-digit number");

  return {
    errors,
    values: {
      first_name: firstName,
      last_name: lastName,
      gender,
      date_of_birth: dateOfBirth,
      phone,
      bvn: encodeBvn(bvn),
    },
  };
}

/** GET /api/kyc/stakeholders */
exports.listStakeholders = async (req, res) => {
  try {
    const rows = await db.KycStakeholder.findAll({
      where: { kyc_user_id: req.kycUser.id },
      order: [["created_at", "ASC"]],
    });
    return res.json({
      success: true,
      stakeholders: rows.map(publicKycStakeholder),
    });
  } catch (err) {
    console.error("[kycAuth] listStakeholders:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load stakeholders",
    });
  }
};

/** POST /api/kyc/stakeholders */
exports.createStakeholder = async (req, res) => {
  const { errors, values } = parseStakeholderBody(req.body || {});
  if (errors.length) {
    return res.status(400).json({
      success: false,
      message: errors.join("; "),
    });
  }

  try {
    const row = await db.KycStakeholder.create({
      kyc_user_id: req.kycUser.id,
      ...values,
    });
    return res.status(201).json({
      success: true,
      message: "Stakeholder saved",
      stakeholder: publicKycStakeholder(row),
    });
  } catch (err) {
    console.error("[kycAuth] createStakeholder:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to save stakeholder",
    });
  }
};

/** PUT /api/kyc/stakeholders/:id */
exports.updateStakeholder = async (req, res) => {
  const { errors, values } = parseStakeholderBody(req.body || {});
  if (errors.length) {
    return res.status(400).json({
      success: false,
      message: errors.join("; "),
    });
  }

  try {
    const row = await db.KycStakeholder.findOne({
      where: { id: req.params.id, kyc_user_id: req.kycUser.id },
    });
    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Stakeholder not found",
      });
    }

    await row.update(values);
    return res.json({
      success: true,
      message: "Stakeholder updated",
      stakeholder: publicKycStakeholder(row),
    });
  } catch (err) {
    console.error("[kycAuth] updateStakeholder:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to update stakeholder",
    });
  }
};

/** DELETE /api/kyc/stakeholders/:id */
exports.deleteStakeholder = async (req, res) => {
  try {
    const row = await db.KycStakeholder.findOne({
      where: { id: req.params.id, kyc_user_id: req.kycUser.id },
    });
    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Stakeholder not found",
      });
    }

    await row.destroy();
    return res.json({
      success: true,
      message: "Stakeholder removed",
    });
  } catch (err) {
    console.error("[kycAuth] deleteStakeholder:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to remove stakeholder",
    });
  }
};

const SUPPORTED_KYC_SERVICES = [
  {
    key: "e_invoice",
    label: "E-Invoice",
    description: "FIRS / NRS e-invoicing API credentials and merchant IDs",
  },
];

function publicServiceSettings(row, serviceMeta) {
  return {
    service: row?.service || serviceMeta.key,
    label: serviceMeta.label,
    description: serviceMeta.description,
    nrsBusinessId: row?.nrs_business_id || "",
    nrsServiceId: row?.nrs_service_id || "",
    configured: Boolean(row?.nrs_business_id && row?.nrs_service_id),
    updatedAt: row?.updated_at || null,
  };
}

/** GET /api/kyc/service-settings — list available services + saved NRS IDs. */
exports.getServiceSettings = async (req, res) => {
  try {
    const rows = await db.KycServiceSettings.findAll({
      where: { kyc_user_id: req.kycUser.id },
    });
    const byService = new Map(rows.map((r) => [r.service, r]));
    const services = SUPPORTED_KYC_SERVICES.map((meta) =>
      publicServiceSettings(byService.get(meta.key), meta),
    );
    return res.json({ success: true, services });
  } catch (err) {
    console.error("[kycAuth] getServiceSettings:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load service settings",
    });
  }
};

/** PUT /api/kyc/service-settings — save NRS IDs for a selected service (editable later). */
exports.saveServiceSettings = async (req, res) => {
  const service = String(req.body?.service || "e_invoice").trim();
  const nrsBusinessId = String(
    req.body?.nrsBusinessId || req.body?.nrs_business_id || "",
  ).trim();
  const nrsServiceId = String(
    req.body?.nrsServiceId || req.body?.nrs_service_id || "",
  ).trim();

  const meta = SUPPORTED_KYC_SERVICES.find((s) => s.key === service);
  if (!meta) {
    return res.status(400).json({
      success: false,
      message: "Unsupported service. Currently only e_invoice is available.",
    });
  }
  if (!nrsBusinessId || !nrsServiceId) {
    return res.status(400).json({
      success: false,
      message: "NRS Business ID and NRS Service ID are required",
    });
  }

  try {
    const [row] = await db.KycServiceSettings.findOrCreate({
      where: { kyc_user_id: req.kycUser.id, service },
      defaults: {
        nrs_business_id: nrsBusinessId,
        nrs_service_id: nrsServiceId,
      },
    });

    if (
      row.nrs_business_id !== nrsBusinessId ||
      row.nrs_service_id !== nrsServiceId
    ) {
      row.nrs_business_id = nrsBusinessId;
      row.nrs_service_id = nrsServiceId;
      await row.save();
    }

    // Sandbox only: bind testing OAuth clients to the saved NRS Business ID.
    // Production client business_id is set only by admin KYC completion (not client self-claim).
    if (service === "e_invoice") {
      await db.EInvoicingClient.update(
        { business_id: nrsBusinessId },
        {
          where: {
            kyc_user_id: req.kycUser.id,
            environment: "testing",
          },
        },
      );
    }

    return res.json({
      success: true,
      message: "Service settings saved. You can edit these later.",
      settings: publicServiceSettings(row, meta),
    });
  } catch (err) {
    console.error("[kycAuth] saveServiceSettings:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to save service settings",
    });
  }
};

/** POST /api/kyc/submit-review — client confirms KYC submission for admin review. */
exports.submitKycForReview = async (req, res) => {
  try {
    const user = req.kycUser;

    if (user.status === "suspended") {
      return res.status(403).json({
        success: false,
        message: "Your account has been suspended",
      });
    }

    if (!user.phone_verified) {
      return res.status(400).json({
        success: false,
        message: "Verify your phone number before submitting for review",
      });
    }

    if (
      !user.email_verified &&
      user.status !== "verified" &&
      user.status !== "approved"
    ) {
      return res.status(400).json({
        success: false,
        message: "Verify your email before submitting for review",
      });
    }

    if (user.status === "approved") {
      return res.json({
        success: true,
        alreadySubmitted: true,
        message: "Your KYC is already approved",
        user: publicKycUser(user),
      });
    }

    if (user.kyc_submitted_at) {
      return res.json({
        success: true,
        alreadySubmitted: true,
        message: "Your KYC was already submitted and is pending review",
        user: publicKycUser(user),
      });
    }

    user.kyc_submitted_at = new Date();
    if (user.status === "pending") {
      user.status = "verified";
    }
    await user.save();

    return res.json({
      success: true,
      alreadySubmitted: false,
      message:
        "KYC submitted for review. Our team will notify you once it is approved.",
      user: publicKycUser(user),
    });
  } catch (err) {
    console.error("[kycAuth] submitKycForReview:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to submit KYC for review",
    });
  }
};

function assertKycAdmin(req) {
  const role = String(req.user?.role || "").toLowerCase();
  if (role === "superadmin" || role === "admin") {
    return true;
  }

  const headerKey = String(req.headers["x-kyc-admin-key"] || "");
  if (!headerKey) {
    return false;
  }

  const isProd = process.env.NODE_ENV === "production";
  if (isProd && (!KYC_ADMIN_API_KEY || KYC_ADMIN_API_KEY.length < 24)) {
    if (!kycAdminKeyWarned) {
      console.warn(
        "[kycAuth] KYC_ADMIN_API_KEY is missing or shorter than 24 chars — API-key auth disabled in production.",
      );
      kycAdminKeyWarned = true;
    }
    return false;
  }

  if (!KYC_ADMIN_API_KEY) {
    return false;
  }

  const weakPlaceholders = new Set([
    "your_kyc_admin_api_key_here",
    "changeme",
    "password",
    "admin",
    "secret",
  ]);
  if (
    weakPlaceholders.has(String(KYC_ADMIN_API_KEY).toLowerCase()) ||
    /^your[_-]/i.test(String(KYC_ADMIN_API_KEY))
  ) {
    if (!kycAdminKeyWarned) {
      console.warn(
        "[kycAuth] KYC_ADMIN_API_KEY looks like a placeholder — API-key auth disabled.",
      );
      kycAdminKeyWarned = true;
    }
    return false;
  }

  const provided = Buffer.from(String(headerKey), "utf8");
  const expected = Buffer.from(KYC_ADMIN_API_KEY, "utf8");
  if (provided.length !== expected.length) {
    try {
      crypto.timingSafeEqual(provided, provided);
    } catch {
      // keep timing flat
    }
    return false;
  }
  return crypto.timingSafeEqual(provided, expected);
}

/**
 * POST /api/kyc/complete
 *
 * KYC-complete trigger (NOT email verification).
 * Marks the KYC user as `approved` and issues PRODUCTION credentials.
 * Auth: X-KYC-Admin-Key (env KYC_ADMIN_API_KEY) or admin/superadmin user JWT.
 *
 * Body: { email } or { kycUserId }
 * Optional: { facilityId } to link business_id on the credential.
 */
exports.completeKyc = async (req, res) => {
  if (!assertKycAdmin(req)) {
    return res.status(403).json({
      success: false,
      message:
        "Forbidden: KYC completion requires admin access (X-KYC-Admin-Key or admin JWT).",
    });
  }

  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  const kycUserId = req.body?.kycUserId || req.body?.kyc_user_id || null;
  const facilityId =
    req.body?.facilityId || req.body?.facility_id || req.body?.businessId || null;

  if (!email && !kycUserId) {
    return res.status(400).json({
      success: false,
      message: "email or kycUserId is required",
    });
  }

  try {
    const user = kycUserId
      ? await db.KycUser.findByPk(kycUserId)
      : await db.KycUser.findOne({ where: { email } });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "KYC user not found",
      });
    }
    if (user.status === "suspended") {
      return res.status(403).json({
        success: false,
        message: "Cannot approve a suspended account",
      });
    }
    if (!user.email_verified && user.status !== "verified" && user.status !== "approved") {
      return res.status(400).json({
        success: false,
        message: "Email must be verified before KYC can be completed",
      });
    }

    const alreadyApproved = user.status === "approved";
    if (facilityId) {
      user.facility_id = String(facilityId);
    }
    user.status = "approved";
    if (!user.email_verified) user.email_verified = true;
    await user.save();

    return res.json({
      success: true,
      message: alreadyApproved
        ? "KYC already approved."
        : "KYC completed.",
      user: publicKycUser(user),
    });
  } catch (err) {
    console.error("[kycAuth] completeKyc:", err);
    return res.status(500).json({
      success: false,
      message: "Server error during KYC completion",
    });
  }
};

/** GET /api/kyc/credentials — e-invoicing removed */
exports.listKycCredentials = async (_req, res) => {
  return res.status(410).json({
    success: false,
    message: "E-invoicing credentials are no longer available",
  });
};

/**
 * POST /api/kyc/credentials/rotate — e-invoicing removed
 */
exports.rotateKycCredentials = async (_req, res) => {
  return res.status(410).json({
    success: false,
    message: "E-invoicing credentials are no longer available",
  });
};

const ALLOWED_KYC_DOC_TYPES = new Set([
  "cac_certificate",
  "memorandum",
  "utility_bill",
  "tax_clearance",
  "other",
]);

function publicKycBusinessInformation(row) {
  if (!row) return null;
  return {
    id: row.id,
    legalName: row.legal_name || null,
    tradingName: row.trading_name || null,
    businessType: row.business_type || null,
    registrationNumber: row.registration_number || null,
    tin: row.tin || null,
    addressLine1: row.address_line1 || null,
    addressLine2: row.address_line2 || null,
    city: row.city || null,
    state: row.state || null,
    country: row.country || null,
    postalCode: row.postal_code || null,
    industry: row.industry || null,
    website: row.website || null,
    description: row.description || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isBusinessInformationComplete(row) {
  if (!row) return false;
  return Boolean(
    String(row.legal_name || "").trim() &&
      String(row.description || "").trim() &&
      String(row.address_line1 || "").trim() &&
      String(row.city || "").trim() &&
      String(row.state || "").trim() &&
      String(row.industry || "").trim(),
  );
}

function publicKycBusinessDocument(row) {
  return {
    id: row.id,
    docType: row.doc_type,
    fileName: row.file_name,
    fileUrl: row.file_url,
    mimeType: row.mime_type || null,
    fileSize: row.file_size == null ? null : Number(row.file_size),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicKycTerms(row) {
  if (!row) return null;
  return {
    id: row.id,
    termsVersion: row.terms_version,
    accepted: Boolean(row.accepted),
    acceptedAt: row.accepted_at || null,
    acceptedIp: row.accepted_ip || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function pickBusinessInfoFields(body = {}) {
  const str = (v) => {
    if (v == null) return null;
    const s = String(v).trim();
    return s.length ? s : null;
  };
  return {
    legal_name: str(body.legalName ?? body.legal_name),
    trading_name: str(body.tradingName ?? body.trading_name),
    business_type: str(body.businessType ?? body.business_type),
    registration_number: str(
      body.registrationNumber ?? body.registration_number,
    ),
    tin: str(body.tin),
    address_line1: str(body.addressLine1 ?? body.address_line1),
    address_line2: str(body.addressLine2 ?? body.address_line2),
    city: str(body.city),
    state: str(body.state),
    country: str(body.country) || "NG",
    postal_code: str(body.postalCode ?? body.postal_code),
    industry: str(body.industry),
    website: str(body.website),
    description: str(body.description),
  };
}

/** GET /api/kyc/business-information */
exports.getBusinessInformation = async (req, res) => {
  try {
    const row = await db.KycBusinessInformation.findOne({
      where: { kyc_user_id: req.kycUser.id },
    });
    return res.json({
      success: true,
      businessInformation: publicKycBusinessInformation(row),
      complete: isBusinessInformationComplete(row),
    });
  } catch (err) {
    console.error("[kycAuth] getBusinessInformation:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load business information",
    });
  }
};

/** PUT /api/kyc/business-information */
exports.saveBusinessInformation = async (req, res) => {
  const fields = pickBusinessInfoFields(req.body || {});
  try {
    const [row, created] = await db.KycBusinessInformation.findOrCreate({
      where: { kyc_user_id: req.kycUser.id },
      defaults: { kyc_user_id: req.kycUser.id, ...fields },
    });

    if (!created) {
      // Merge: only overwrite keys present in the request body (allow partial saves).
      const body = req.body || {};
      const keyMap = {
        legalName: "legal_name",
        legal_name: "legal_name",
        tradingName: "trading_name",
        trading_name: "trading_name",
        businessType: "business_type",
        business_type: "business_type",
        registrationNumber: "registration_number",
        registration_number: "registration_number",
        tin: "tin",
        addressLine1: "address_line1",
        address_line1: "address_line1",
        addressLine2: "address_line2",
        address_line2: "address_line2",
        city: "city",
        state: "state",
        country: "country",
        postalCode: "postal_code",
        postal_code: "postal_code",
        industry: "industry",
        website: "website",
        description: "description",
      };
      for (const [incoming, column] of Object.entries(keyMap)) {
        if (Object.prototype.hasOwnProperty.call(body, incoming)) {
          row[column] = fields[column];
        }
      }
      await row.save();
    }

    return res.json({
      success: true,
      message: "Business information saved",
      businessInformation: publicKycBusinessInformation(row),
      complete: isBusinessInformationComplete(row),
    });
  } catch (err) {
    console.error("[kycAuth] saveBusinessInformation:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to save business information",
    });
  }
};

/** GET /api/kyc/business-documents */
exports.listBusinessDocuments = async (req, res) => {
  try {
    const rows = await db.KycBusinessDocument.findAll({
      where: { kyc_user_id: req.kycUser.id },
      order: [["created_at", "ASC"]],
    });
    return res.json({
      success: true,
      documents: rows.map(publicKycBusinessDocument),
    });
  } catch (err) {
    console.error("[kycAuth] listBusinessDocuments:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load business documents",
    });
  }
};

/** POST /api/kyc/business-documents — multipart: file + docType */
exports.uploadBusinessDocument = async (req, res) => {
  try {
    const docType = String(req.body?.docType || req.body?.doc_type || "").trim();
    if (!ALLOWED_KYC_DOC_TYPES.has(docType)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid docType. Use cac_certificate, memorandum, utility_bill, tax_clearance, or other.",
      });
    }
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "file is required (jpg, jpeg, png, or pdf, max 5MB)",
      });
    }

    const basePath = (process.env.BASE_PATH || "/aa_erp").replace(
      /\/$/,
      "",
    );
    const fileUrl = `${basePath}/public/uploads/${req.file.filename}`;
    const row = await db.KycBusinessDocument.create({
      kyc_user_id: req.kycUser.id,
      doc_type: docType,
      file_name: req.file.originalname || req.file.filename,
      file_url: fileUrl,
      mime_type: req.file.mimetype || null,
      file_size: req.file.size || null,
      storage_path: req.file.path || null,
    });

    return res.status(201).json({
      success: true,
      message: "Document uploaded",
      document: publicKycBusinessDocument(row),
    });
  } catch (err) {
    console.error("[kycAuth] uploadBusinessDocument:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to upload document",
    });
  }
};

/** DELETE /api/kyc/business-documents/:id */
exports.deleteBusinessDocument = async (req, res) => {
  const fs = require("fs");
  try {
    const row = await db.KycBusinessDocument.findOne({
      where: { id: req.params.id, kyc_user_id: req.kycUser.id },
    });
    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Document not found",
      });
    }

    const storagePath = row.storage_path;
    await row.destroy();
    if (storagePath) {
      try {
        fs.unlinkSync(storagePath);
      } catch {
        /* ignore missing file */
      }
    }

    return res.json({
      success: true,
      message: "Document deleted",
    });
  } catch (err) {
    console.error("[kycAuth] deleteBusinessDocument:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to delete document",
    });
  }
};

/** GET /api/kyc/terms */
exports.getTermsAcceptance = async (req, res) => {
  try {
    const row = await db.KycTermsAcceptance.findOne({
      where: { kyc_user_id: req.kycUser.id },
    });
    return res.json({
      success: true,
      terms: publicKycTerms(row),
      complete: Boolean(row?.accepted),
    });
  } catch (err) {
    console.error("[kycAuth] getTermsAcceptance:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load terms acceptance",
    });
  }
};

/** POST /api/kyc/terms */
exports.saveTermsAcceptance = async (req, res) => {
  const accepted = req.body?.accepted === true || req.body?.accepted === "true";
  if (!accepted) {
    return res.status(400).json({
      success: false,
      message: "accepted must be true",
    });
  }
  const termsVersion = String(req.body?.termsVersion || req.body?.terms_version || "1.0").trim() || "1.0";
  const acceptedIp =
    (req.headers["x-forwarded-for"] &&
      String(req.headers["x-forwarded-for"]).split(",")[0].trim()) ||
    req.ip ||
    null;

  try {
    const [row, created] = await db.KycTermsAcceptance.findOrCreate({
      where: { kyc_user_id: req.kycUser.id },
      defaults: {
        kyc_user_id: req.kycUser.id,
        terms_version: termsVersion,
        accepted: true,
        accepted_at: new Date(),
        accepted_ip: acceptedIp,
      },
    });

    if (!created) {
      row.terms_version = termsVersion;
      row.accepted = true;
      row.accepted_at = new Date();
      row.accepted_ip = acceptedIp;
      await row.save();
    }

    return res.json({
      success: true,
      message: "Terms accepted",
      terms: publicKycTerms(row),
      complete: true,
    });
  } catch (err) {
    console.error("[kycAuth] saveTermsAcceptance:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to save terms acceptance",
    });
  }
};
