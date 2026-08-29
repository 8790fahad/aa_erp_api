const db = require("../models");

/**
 * CALL results arrive as { code_no }, [{ code_no }] or [[{ code_no }]] depending
 * on the driver and whether Sequelize unwraps the result set.
 */
function extractReservedNumber(result) {
  if (result == null) return null;

  if (Array.isArray(result)) {
    for (const entry of result) {
      const found = extractReservedNumber(entry);
      if (found != null) return found;
    }
    return null;
  }

  if (typeof result !== "object") return null;

  const value = Number(result.code_no);
  return Number.isFinite(value) ? value : null;
}

/**
 * Reserve the next number in a facility's series and return it.
 *
 * The reservation happens inside nurmber_generator1 as a single locking
 * statement, so two concurrent callers can never receive the same number.
 * Callers must not separately advance the counter afterwards.
 */
exports.getAndUpdateNumber = async (prefix, facilityId) => {
  const result = await db.sequelize.query(
    `CALL nurmber_generator1(:prefix, :facilityId)`,
    { replacements: { prefix, facilityId } },
  );

  const reserved = extractReservedNumber(result);
  if (reserved == null) {
    throw new Error(
      `Failed to reserve a number for prefix "${prefix}" (facility ${facilityId}).`,
    );
  }

  return reserved;
};
