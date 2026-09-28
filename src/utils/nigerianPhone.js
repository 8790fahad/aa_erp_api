/**
 * Normalize Nigerian phone numbers to MSISDN form: 234 + 9 or 10 digits.
 * Accepts 080…, 801…, 234…, +234…, 00234…, including 9-digit national numbers
 * such as 801234567, 0801234567, and +234801234567.
 */
function normalizeNigerianPhone(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  // 0801234567 (10) or 08012345678 (11)
  if (digits.startsWith("0") && (digits.length === 10 || digits.length === 11)) {
    digits = `234${digits.slice(1)}`;
  } else if (
    digits.startsWith("2340") &&
    (digits.length === 13 || digits.length === 14)
  ) {
    digits = `234${digits.slice(4)}`;
  } else if (
    !digits.startsWith("234") &&
    (digits.length === 9 || digits.length === 10)
  ) {
    // 801234567 (9) or 8012345678 (10)
    digits = `234${digits}`;
  }
  return digits;
}

/** Valid Nigerian mobile: 234 + 9 or 10 digits starting with 7/8/9 */
function isValidNigerianPhone(phone) {
  const normalized = normalizeNigerianPhone(phone);
  return /^234[789]\d{8,9}$/.test(normalized);
}

const NIGERIAN_PHONE_HINT =
  "Enter a valid Nigerian phone number (e.g. 801234567, 0801234567, or +234801234567)";

module.exports = {
  normalizeNigerianPhone,
  isValidNigerianPhone,
  NIGERIAN_PHONE_HINT,
};
