const db = require("../models");

// controllers/numberGeneratorController.js
exports.getAndUpdateNumber = async (prefix, facilityId) => {

  try {
    const results = await db.sequelize.query(
      `SELECT code_no
       FROM number_generator
       WHERE prefix = :prefix
         AND facilityId = :facilityId`,
      {
        replacements: { prefix, facilityId },
        type: db.Sequelize.QueryTypes.SELECT,
      }
    );

    if (!results || results.length === 0) {
      await db.sequelize.query(
        `INSERT INTO number_generator (description, prefix, code_no, facilityId)
         VALUES (:description, :prefix, 2, :facilityId)`,
        { replacements: { description:prefix, prefix, facilityId } }
      );
      return 1;
    }

    const currentNumber = results[0].code_no;
    await db.sequelize.query(
      `UPDATE number_generator
       SET code_no = code_no + 1
       WHERE prefix = :prefix
         AND facilityId = :facilityId`,
      {
        replacements: { prefix, facilityId },
      }
    );
    return currentNumber;
  } catch (error) {
    console.error("Error getting/updating number:", error);
    throw error; // Changed from res.status(...) since res is not available here
  }
};
