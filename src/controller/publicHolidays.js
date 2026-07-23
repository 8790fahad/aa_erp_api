const db = require("../models");

const isMissingTableError = (error) => {
  const code =
    error?.code ||
    error?.parent?.code ||
    error?.original?.code ||
    error?.original?.errno;
  return code === "ER_NO_SUCH_TABLE" || code === 1146;
};

const isValidFacilityId = (facilityId) => {
  if (facilityId == null || facilityId === "") return false;
  const value = String(facilityId).trim();
  return value.length > 0 && value !== "undefined" && value !== "null";
};

exports.checkPublicHoliday = async (req, res) => {
  try {
    const { facilityId, date } = req.query;

    if (!isValidFacilityId(facilityId) || !date) {
      return res.status(400).json({
        success: false,
        message: "Facility ID and date are required",
      });
    }

    // Check if the date is a public holiday
    const holiday = await db.sequelize.query(
      `SELECT * FROM public_holidays
       WHERE facilityId = :facilityId
       AND holiday_date = :date
       AND status = 'active'`,
      {
        replacements: { facilityId, date },
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    res.status(200).json({
      success: true,
      isHoliday: holiday.length > 0,
      holiday: holiday.length > 0 ? holiday[0] : null,
    });
  } catch (error) {
    if (isMissingTableError(error)) {
      return res.status(200).json({
        success: true,
        isHoliday: false,
        holiday: null,
      });
    }

    console.error("Error checking public holiday:", error);
    res.status(500).json({
      success: false,
      message: "Error checking public holiday",
      error: error.message,
    });
  }
};

exports.getPublicHolidays = async (req, res) => {
  try {
    const { facilityId, year } = req.query;

    if (!isValidFacilityId(facilityId)) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
      });
    }

    const currentYear = year || new Date().getFullYear();
    const startDate = `${currentYear}-01-01`;
    const endDate = `${currentYear}-12-31`;

    const holidays = await db.sequelize.query(
      `SELECT * FROM public_holidays
       WHERE facilityId = :facilityId
       AND holiday_date BETWEEN :startDate AND :endDate
       AND status = 'active'
       ORDER BY holiday_date`,
      {
        replacements: { facilityId, startDate, endDate },
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    res.status(200).json({
      success: true,
      data: holidays,
    });
  } catch (error) {
    if (isMissingTableError(error)) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    console.error("Error fetching public holidays:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching public holidays",
      error: error.message,
    });
  }
};

exports.createPublicHoliday = async (req, res) => {
  try {
    const {
      facilityId,
      holidayName,
      holidayDate,
      description,
      isRecurring = false,
      createdBy,
    } = req.body;

    if (!facilityId || !holidayName || !holidayDate) {
      return res.status(400).json({
        success: false,
        message: "Facility ID, holiday name, and date are required",
      });
    }

    const holidayId = `HOL-${Date.now()}`;

    await db.sequelize.query(
      `INSERT INTO public_holidays
       (id, facilityId, holiday_name, holiday_date, description, is_recurring, status, created_by, created_at)
       VALUES (:id, :facilityId, :holidayName, :holidayDate, :description, :isRecurring, 'active', :createdBy, NOW())`,
      {
        replacements: {
          id: holidayId,
          facilityId,
          holidayName,
          holidayDate,
          description: description || null,
          isRecurring,
          createdBy,
        },
        type: db.sequelize.QueryTypes.INSERT,
      }
    );

    res.status(201).json({
      success: true,
      data: {
        holidayId,
        message: "Public holiday created successfully",
      },
    });
  } catch (error) {
    console.error("Error creating public holiday:", error);
    res.status(500).json({
      success: false,
      message: "Error creating public holiday",
      error: error.message,
    });
  }
};
