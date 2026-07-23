const db = require("../models");
const { getAndUpdateNumber } = require("../services/numberGen");

// Get and update number for a specific query type and facility
exports._getAndUpdateNumber = async (req, res) => {
  try {
    const { query_type, facilityId } = req.params;

    // Validate required fields
    if (!query_type || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "Query type and facilityId are required",
      });
    }

    // Use the existing stored procedure
    const generatedCode = await getAndUpdateNumber(query_type, facilityId);
    res.json({
      success: true,
      results: generatedCode,
    });
  } catch (error) {
    console.error("Error in getAndUpdateNumber:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get current number without updating (for preview)
exports.getCurrentNumber = async (req, res) => {
  try {
    const { query_type, facilityId } = req.params;

    // Validate required fields
    if (!query_type || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "Query type and facilityId are required",
      });
    }

    // Query the number_generator table directly for current number
    const [rows] = await db.sequelize.query(
      `SELECT code_no, prefix
       FROM number_generator
       WHERE prefix = :query_type
         AND facilityId = :facilityId`,
      {
        replacements: { query_type, facilityId },
        type: db.Sequelize.QueryTypes.SELECT,
      }
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Query type not found for facility",
      });
    }

    const currentNumber = rows[0].code_no;
    const prefix = rows[0].prefix;
    const formattedNumber = `${prefix}-${String(currentNumber).padStart(
      6,
      "0"
    )}`;

    res.json({
      success: true,
      data: formattedNumber,
      currentNumber: currentNumber,
      message: "Current number retrieved successfully",
    });
  } catch (error) {
    console.error("Error in getCurrentNumber:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
