const db = require("../models");

/**
 * Collation-safe equality for MySQL string columns.
 * Avoids "Illegal mix of collations (utf8mb4_unicode_ci … utf8mb4_0900_ai_ci)".
 */
function binEq(columnSql, paramName) {
  return `BINARY ${columnSql} = BINARY :${paramName}`;
}

// controllers/numberGeneratorController.js
exports.getAndUpdateNumber = async (prefix, facilityId, transaction = null) => {
  const opts = transaction ? { transaction } : {};
  const QueryTypes = db.Sequelize.QueryTypes;

  try {
    const results = await db.sequelize.query(
      `SELECT code_no
       FROM number_generator
       WHERE ${binEq("prefix", "prefix")}
         AND ${binEq("facilityId", "facilityId")}`,
      {
        replacements: { prefix, facilityId },
        type: QueryTypes.SELECT,
        ...opts,
      },
    );

    if (!results || results.length === 0) {
      await db.sequelize.query(
        `INSERT INTO number_generator (description, prefix, code_no, facilityId)
         VALUES (:description, :prefix, 2, :facilityId)`,
        {
          replacements: { description: prefix, prefix, facilityId },
          type: QueryTypes.INSERT,
          ...opts,
        },
      );
      return 1;
    }

    const currentNumber = results[0].code_no;
    await db.sequelize.query(
      `UPDATE number_generator
       SET code_no = code_no + 1
       WHERE ${binEq("prefix", "prefix")}
         AND ${binEq("facilityId", "facilityId")}`,
      {
        replacements: { prefix, facilityId },
        type: QueryTypes.UPDATE,
        ...opts,
      },
    );
    return currentNumber;
  } catch (error) {
    console.error("Error getting/updating number:", error);
    throw error;
  }
};
