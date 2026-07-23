"use strict";

/**
 * KYC auth routes — isolated from FlowBooks `/api/auth/*` user/business signup.
 */
const rateLimit = require("express-rate-limit");
const passport = require("passport");
const kycAuth = require("../controller/kycAuth");

const loginOtpResendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    return `${req.ip || "unknown"}:${email || "no-email"}`;
  },
  message: {
    success: false,
    message: "Please wait 60 seconds before requesting another login code",
  },
});

const phoneOtpResendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    return `phone-otp:${req.ip || "unknown"}:${email || "no-email"}`;
  },
  message: {
    success: false,
    message: "Please wait 60 seconds before requesting another phone code",
  },
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    return `forgot:${req.ip || "unknown"}:${email || "no-email"}`;
  },
  message: {
    success: false,
    message: "Please wait before requesting another password reset email",
  },
});

const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    return `otp-verify:${req.ip || "unknown"}:${email || "no-email"}`;
  },
  message: {
    success: false,
    message: "Too many verification attempts. Please wait and try again.",
  },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    return `kyc-login:${req.ip || "unknown"}:${email || "no-email"}`;
  },
  message: {
    success: false,
    message: "Too many login attempts. Please wait and try again.",
  },
});

const checkEmailExistsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `check-email:${req.ip || "unknown"}`,
  message: {
    success: false,
    exists: false,
    message: "Too many email checks. Please wait and try again.",
  },
});

/** Optional user JWT — used so admin/superadmin can call /complete without API key. */
const optionalUserJwt = (req, res, next) => {
  passport.authenticate("jwt", { session: false }, (err, user) => {
    if (!err && user) req.user = user;
    return next();
  })(req, res, next);
};

const upload = require("../config/new_multer");

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `kyc-signup:${req.ip || "unknown"}`,
  message: {
    success: false,
    message: "Too many sign-up attempts. Please wait and try again.",
  },
});

module.exports = (app) => {
  app.post(
    "/api/kyc/check-email-exists",
    checkEmailExistsLimiter,
    kycAuth.checkEmailExists,
  );
  app.post("/api/kyc/sign-up", signupLimiter, kycAuth.signup);
  app.post(
    "/api/kyc/verify-phone-otp",
    otpVerifyLimiter,
    kycAuth.verifyPhoneOtp,
  );
  app.post(
    "/api/kyc/resend-phone-otp",
    phoneOtpResendLimiter,
    kycAuth.resendPhoneOtp,
  );
  app.post(
    "/api/kyc/forgot-password",
    forgotPasswordLimiter,
    kycAuth.forgotPassword,
  );
  app.post("/api/kyc/reset-password", otpVerifyLimiter, kycAuth.resetPassword);
  app.post("/api/kyc/login", loginLimiter, kycAuth.login);
  app.post(
    "/api/kyc/verify-login-otp",
    otpVerifyLimiter,
    kycAuth.verifyLoginOtp,
  );
  app.post(
    "/api/kyc/resend-login-otp",
    loginOtpResendLimiter,
    kycAuth.resendLoginOtp,
  );
  app.get("/api/kyc/verify-user", kycAuth.resendVerification);
  app.get("/api/kyc/verify", kycAuth.verifyEmail);

  // Admin: mark KYC complete → issue PRODUCTION credentials
  app.post("/api/kyc/complete", optionalUserJwt, kycAuth.completeKyc);

  // Authenticated KYC client credential management
  app.get("/api/kyc/me", kycAuth.requireKycJwt, kycAuth.getMe);
  app.get(
    "/api/kyc/contact-information",
    kycAuth.requireKycJwt,
    kycAuth.getContactInformation,
  );
  app.post(
    "/api/kyc/contact-information",
    kycAuth.requireKycJwt,
    kycAuth.saveContactInformation,
  );
  app.get("/api/kyc/stakeholders", kycAuth.requireKycJwt, kycAuth.listStakeholders);
  app.post(
    "/api/kyc/stakeholders",
    kycAuth.requireKycJwt,
    kycAuth.createStakeholder,
  );
  app.put(
    "/api/kyc/stakeholders/:id",
    kycAuth.requireKycJwt,
    kycAuth.updateStakeholder,
  );
  app.delete(
    "/api/kyc/stakeholders/:id",
    kycAuth.requireKycJwt,
    kycAuth.deleteStakeholder,
  );
  app.get(
    "/api/kyc/service-settings",
    kycAuth.requireKycJwt,
    kycAuth.getServiceSettings,
  );
  app.put(
    "/api/kyc/service-settings",
    kycAuth.requireKycJwt,
    kycAuth.saveServiceSettings,
  );
  app.post(
    "/api/kyc/submit-review",
    kycAuth.requireKycJwt,
    kycAuth.submitKycForReview,
  );
  app.get(
    "/api/kyc/credentials",
    kycAuth.requireKycJwt,
    kycAuth.listKycCredentials,
  );
  app.post(
    "/api/kyc/credentials/rotate",
    kycAuth.requireKycJwt,
    kycAuth.rotateKycCredentials,
  );

  // Business registration / brand profile / terms (Get Started)
  app.get(
    "/api/kyc/business-information",
    kycAuth.requireKycJwt,
    kycAuth.getBusinessInformation,
  );
  app.put(
    "/api/kyc/business-information",
    kycAuth.requireKycJwt,
    kycAuth.saveBusinessInformation,
  );
  app.get(
    "/api/kyc/business-documents",
    kycAuth.requireKycJwt,
    kycAuth.listBusinessDocuments,
  );
  app.post(
    "/api/kyc/business-documents",
    kycAuth.requireKycJwt,
    (req, res, next) => {
      upload.single("file")(req, res, (err) => {
        if (err) {
          return res.status(400).json({
            success: false,
            message: err.message || "Upload failed",
          });
        }
        return next();
      });
    },
    kycAuth.uploadBusinessDocument,
  );
  app.delete(
    "/api/kyc/business-documents/:id",
    kycAuth.requireKycJwt,
    kycAuth.deleteBusinessDocument,
  );
  app.get(
    "/api/kyc/terms",
    kycAuth.requireKycJwt,
    kycAuth.getTermsAcceptance,
  );
  app.post(
    "/api/kyc/terms",
    kycAuth.requireKycJwt,
    kycAuth.saveTermsAcceptance,
  );
};
