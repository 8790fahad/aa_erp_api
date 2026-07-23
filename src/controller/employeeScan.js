const db = require("../models");

const normalizeScanValue = (value) =>
  String(value || "")
    .replace(/[\r\n\t]/g, "")
    .trim();

exports.scanEmployee = async (req, res) => {
  try {
    const { employeeId, facilityId } = req.body;
    const scanValue = normalizeScanValue(employeeId);

    if (!scanValue || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "Employee ID and Facility ID are required",
      });
    }

    // Match employeeId (e.g. EMP-001), internal id, or numeric id from barcode
    const employee = await db.sequelize.query(
      `SELECT
        id,
        employeeId,
        firstName,
        lastName,
        contactInfo,
        departmentId,
        designation,
        status,
        facilityId
      FROM employees
      WHERE facilityId = :facilityId
      AND status = 'active'
      AND (
        employeeId = :scanValue
        OR id = :scanValue
        OR CAST(id AS CHAR) = :scanValue
      )
      LIMIT 1`,
      {
        replacements: { scanValue, facilityId },
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    if (employee.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Employee not found or inactive",
      });
    }

    res.status(200).json({
      success: true,
      data: employee[0],
    });
  } catch (error) {
    console.error("Error scanning employee:", error);
    res.status(500).json({
      success: false,
      message: "Error scanning employee",
      error: error.message,
    });
  }
};

