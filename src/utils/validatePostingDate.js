/**
 * Posting date rules for general_ledger and journal entries.
 * - Not before 1 Jan 2025
 * - Not after today (local calendar date)
 *
 * Only accepts ISO YYYY-MM-DD (or Date) to avoid ambiguous parses (e.g. year 0226).
 */

const MIN_POSTING_DATE = "2025-01-01";

class PostingDateValidationError extends Error {
  constructor(message, field = "transaction_date") {
    super(message);
    this.name = "PostingDateValidationError";
    this.field = field;
  }
}

function getMaxPostingDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Normalize to YYYY-MM-DD or return null when invalid / ambiguous.
 */
function normalizePostingDate(value) {
  if (value == null || value === "") return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  const s = String(value).trim();
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!isoMatch) return null;

  const year = parseInt(isoMatch[1], 10);
  const month = parseInt(isoMatch[2], 10);
  const day = parseInt(isoMatch[3], 10);
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const test = new Date(year, month - 1, day);
  if (
    test.getFullYear() !== year ||
    test.getMonth() !== month - 1 ||
    test.getDate() !== day
  ) {
    return null;
  }

  return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
}

/**
 * Validate and return normalized YYYY-MM-DD. Throws PostingDateValidationError.
 */
function validatePostingDate(value, { field = "transaction_date" } = {}) {
  const normalized = normalizePostingDate(value);
  if (!normalized) {
    throw new PostingDateValidationError(
      `Invalid ${field}: use a valid date in YYYY-MM-DD format`,
      field,
    );
  }

  if (normalized < MIN_POSTING_DATE) {
    throw new PostingDateValidationError(
      `Invalid ${field}: cannot be before 1 January 2025 (${normalized})`,
      field,
    );
  }

  const maxDate = getMaxPostingDate();
  if (normalized > maxDate) {
    throw new PostingDateValidationError(
      `Invalid ${field}: cannot be in the future (${normalized})`,
      field,
    );
  }

  return normalized;
}

module.exports = {
  MIN_POSTING_DATE,
  PostingDateValidationError,
  getMaxPostingDate,
  normalizePostingDate,
  validatePostingDate,
};
