const db = require("../models");

/**
 * Collation-safe equality for MySQL string columns.
 * Avoids "Illegal mix of collations (utf8mb4_unicode_ci … utf8mb4_0900_ai_ci)".
 */
function binEq(columnSql, paramName) {
  return `BINARY ${columnSql} = BINARY :${paramName}`;
}

/**
 * Take the next number in one locked update.
 * A separate SELECT then UPDATE let two sales read the same number
 * before either one finished writing the invoice.
 * LAST_INSERT_ID(code_no + 1) stores the new value and returns it on this connection.
 * The caller receives the previous value, which is the number just issued.
 */
async function allocateNumber(prefix, facilityId, transaction) {
  const replacements = { prefix, facilityId, description: prefix };
  const affectedRowsOf = (queryResult) => {
    const parts = Array.isArray(queryResult) ? queryResult : [queryResult];
    for (const part of parts) {
      const count = Number(part?.affectedRows);
      if (Number.isFinite(count)) return count;
    }
    return 0;
  };

  const updated = await db.sequelize.query(
    `UPDATE number_generator
     SET code_no = LAST_INSERT_ID(code_no + 1)
     WHERE ${binEq("prefix", "prefix")}
       AND ${binEq("facilityId", "facilityId")}
     LIMIT 1`,
    {
      replacements,
      transaction,
    },
  );
  const affected = affectedRowsOf(updated);

  if (!affected) {
    try {
      await db.sequelize.query(
        `INSERT INTO number_generator (description, prefix, code_no, facilityId)
         VALUES (:description, :prefix, 2, :facilityId)`,
        {
          replacements,
          transaction,
        },
      );
      return 1;
    } catch (insertError) {
      const again = await db.sequelize.query(
        `UPDATE number_generator
         SET code_no = LAST_INSERT_ID(code_no + 1)
         WHERE ${binEq("prefix", "prefix")}
           AND ${binEq("facilityId", "facilityId")}
         LIMIT 1`,
        {
          replacements,
          transaction,
        },
      );
      if (!affectedRowsOf(again)) throw insertError;
    }
  }

  const rows = await db.sequelize.query(
    `SELECT LAST_INSERT_ID() AS assigned`,
    {
      replacements,
      type: db.Sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  const assigned = Number(rows?.[0]?.assigned);
  if (!Number.isFinite(assigned) || assigned <= 1) {
    throw new Error(`Could not allocate the next ${prefix} number`);
  }
  return assigned - 1;
}

// controllers/numberGeneratorController.js
exports.getAndUpdateNumber = async (prefix, facilityId, transaction = null) => {
  try {
    // Commit the counter on its own. A sale stays open while it posts every
    // line, and holding this row until that commit made the next cashier wait
    // and sometimes take the same invoice number.
    if (transaction) {
      return allocateNumber(prefix, facilityId, transaction);
    }
    return db.sequelize.transaction((trx) =>
      allocateNumber(prefix, facilityId, trx),
    );
  } catch (error) {
    console.error("Error getting/updating number:", error);
    throw error;
  }
};
