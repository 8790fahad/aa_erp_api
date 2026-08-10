/**
 * Normalize Nigerian phone numbers to MSISDN form: 234XXXXXXXXXX
 * Accepts 080…, 801…, 234…, +234…, 00234…
 */
function normalizeNigerianPhone(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) {
    digits = `234${digits.slice(1)}`;
  } else if (!digits.startsWith("234") && digits.length === 10) {
    digits = `234${digits}`;
  }
  return digits;
}

/** Valid Nigerian mobile MSISDN: 234 + 10 digits starting with 7/8/9 */
function isValidNigerianPhone(phone) {
  const normalized = normalizeNigerianPhone(phone);
  return /^234[789]\d{9}$/.test(normalized);
}

const NIGERIAN_PHONE_HINT =
  "Enter a valid Nigerian phone number (e.g. 08012345678 or 8012345678)";

module.exports = {
  normalizeNigerianPhone,
  isValidNigerianPhone,
  NIGERIAN_PHONE_HINT,
};
