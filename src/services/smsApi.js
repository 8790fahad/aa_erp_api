"use strict";

/**
 * SMS sending — BulkSMS Nigeria (primary) + optional Twilio fallback for OTP.
 */
const request = require("request");

const BULKSMS_API_BASE =
  process.env.BULKSMS_API_BASE || "https://www.bulksmsnigeria.com/api/v2";
const BULKSMS_API_TOKEN = process.env.BULKSMS_API_TOKEN || "";
const BULKSMS_SENDER_ID = process.env.BULKSMS_SENDER_ID || "FLOWBOOKS";
/** Preferred OTP route — corporate/DND. Account must have this gateway enabled. */
const BULKSMS_OTP_GATEWAY =
  process.env.BULKSMS_OTP_GATEWAY || "direct-corporate";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_FROM = process.env.TWILIO_FROM || "";

function isBulkSmsSuccess(responseBody, httpStatus) {
  if (httpStatus && (httpStatus < 200 || httpStatus >= 300)) return false;
  if (!responseBody || typeof responseBody !== "object") return false;
  const status = String(responseBody.status || "").toLowerCase();
  const code = String(responseBody.code || "");
  return status === "success" || code === "BSNG-0000";
}

function postBulkSms(body) {
  return new Promise((resolve, reject) => {
    if (!BULKSMS_API_TOKEN) {
      return reject(new Error("BULKSMS_API_TOKEN is not configured"));
    }

    request(
      {
        method: "POST",
        url: `${BULKSMS_API_BASE}/sms`,
        headers: {
          Authorization: `Bearer ${BULKSMS_API_TOKEN}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        json: true,
        body,
        timeout: 30000,
        proxy: false,
      },
      (error, response, responseBody) => {
        if (error) {
          console.error("[smsApi] BulkSMS request error:", error.message || error);
          return reject(error instanceof Error ? error : new Error(String(error)));
        }

        const httpStatus = response && response.statusCode;
        console.info(
          "[smsApi] BulkSMS response:",
          httpStatus,
          typeof responseBody === "object"
            ? JSON.stringify(responseBody)
            : String(responseBody),
        );

        if (!isBulkSmsSuccess(responseBody, httpStatus)) {
          const msg =
            (responseBody &&
              (responseBody.message ||
                responseBody.error?.message ||
                responseBody.error)) ||
            `BulkSMS send failed (HTTP ${httpStatus})`;
          return reject(new Error(String(msg)));
        }

        resolve(responseBody);
      },
    );
  });
}

function toE164Nigeria(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) {
    digits = `234${digits.slice(1)}`;
  } else if (!digits.startsWith("234") && digits.length === 10) {
    digits = `234${digits}`;
  }
  if (!digits.startsWith("234")) return null;
  return `+${digits}`;
}

async function sendViaTwilio(phone, message) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM) {
    throw new Error("Twilio is not configured");
  }
  const to = toE164Nigeria(phone) || (String(phone).startsWith("+") ? phone : null);
  if (!to) throw new Error("Invalid phone for Twilio");

  // Lazy-require so BulkSMS-only deploys don't need twilio at runtime if unused.
  const twilio = require("twilio")(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  const result = await twilio.messages.create({
    from: TWILIO_FROM,
    to,
    body: message,
  });
  console.info("[smsApi] Twilio sent sid=", result.sid, "to=", to);
  return {
    status: "success",
    provider: "twilio",
    data: { message_id: result.sid, gateway_used: "twilio" },
  };
}

/**
 * Legacy callback-style send (used across the app).
 */
exports.send = (
  phone,
  message,
  callback = (f) => f,
  err = (f) => f,
  options = {},
) => {
  const body = {
    from: BULKSMS_SENDER_ID,
    to: phone,
    body: message,
  };
  if (options.gateway) body.gateway = options.gateway;
  else if (options.dnd != null) body.dnd = options.dnd;

  postBulkSms(body)
    .then((resp) => callback(resp))
    .catch((e) => err(e));
};

/**
 * Reliable OTP send for KYC / auth.
 * Tries BulkSMS corporate/DND routes, then optional Twilio fallback.
 */
exports.sendOtpReliable = async (phone, message) => {
  const attempts = [
    { gateway: BULKSMS_OTP_GATEWAY },
    { gateway: "otp" },
    { gateway: "dual-backup" },
    // Legacy DND flag used by older BulkSMS integrations
    { dnd: "2" },
    { gateway: "direct-refund" },
  ];

  // De-dupe by JSON key
  const seen = new Set();
  const uniqueAttempts = attempts.filter((a) => {
    const key = JSON.stringify(a);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let lastError = null;
  for (const opts of uniqueAttempts) {
    try {
      const body = {
        from: BULKSMS_SENDER_ID,
        to: phone,
        body: message,
        ...opts,
      };
      const resp = await postBulkSms(body);
      const used = resp?.data?.gateway_used || opts.gateway || "dnd";
      console.info("[smsApi] OTP accepted via BulkSMS gateway_used=", used);
      return { ...resp, provider: "bulksms", requested: opts };
    } catch (e) {
      lastError = e;
      console.warn(
        "[smsApi] BulkSMS OTP attempt failed:",
        JSON.stringify(opts),
        e.message || e,
      );
    }
  }

  // Twilio fallback when configured
  try {
    return await sendViaTwilio(phone, message);
  } catch (twilioErr) {
    console.warn("[smsApi] Twilio OTP fallback failed:", twilioErr.message || twilioErr);
    throw lastError || twilioErr;
  }
};

/** Convenience callback wrapper around sendOtpReliable. */
exports.sendOtp = (phone, message, callback = (f) => f, err = (f) => f) => {
  exports
    .sendOtpReliable(phone, message)
    .then((resp) => callback(resp))
    .catch((e) => err(e));
};

exports.toE164Nigeria = toE164Nigeria;

/**
 * Digits for BulkSMS Nigeria (234xxxxxxxxxx). Falls back to stripped digits.
 */
exports.normalizeBulkSmsPhone = function normalizeBulkSmsPhone(phone) {
  const e164 = toE164Nigeria(phone);
  if (e164) return e164.replace(/^\+/, "");
  const digits = String(phone || "").replace(/\D/g, "");
  return digits || null;
};

/** Legacy Twilio helper kept for older call sites. */
exports.sendSMS = (recipient, content) => {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM) {
    console.error("[smsApi] sendSMS: Twilio not configured");
    return;
  }
  const client = require("twilio")(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  client.messages
    .create({ from: TWILIO_FROM, to: recipient, body: content })
    .then((message) => console.log(message.sid))
    .catch((e) => console.error("[smsApi] sendSMS failed:", e.message || e));
};
