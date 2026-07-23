const db = require("../models");

exports.recordLeaveAttendance = async (req, res) => {
  try {
    const { employeeId, facilityId, leaveTypeId, date, reason } = req.body;

    if (!employeeId || !facilityId || !leaveTypeId || !date) {
      return res.status(400).json({
        success: false,
        message:
          "Employee ID, Facility ID, Leave Type ID, and date are required",
      });
    }

    // Check if attendance already exists for this date
    const existingAttendance = await db.sequelize.query(
      `SELECT * FROM attendance
       WHERE employeeId = :employeeId
       AND facilityId = :facilityId
       AND attendance_date = :date`,
      {
        replacements: { employeeId, facilityId, date },
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    if (existingAttendance.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Attendance already recorded for this date",
      });
    }

    // Get leave type information
    const leaveType = await db.sequelize.query(
      `SELECT * FROM leave_types
       WHERE id = :leaveTypeId
       AND facilityId = :facilityId
       AND status = 'active'`,
      {
        replacements: { leaveTypeId, facilityId },
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    if (leaveType.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Leave type not found",
      });
    }

    const attendanceId = `ATT-${Date.now()}`;
    const leaveTypeInfo = leaveType[0];

    // Create leave attendance record
    await db.sequelize.query(
      `INSERT INTO attendance
       (id, employeeId, facilityId, attendance_date, status, leaveTypeId, leaveReason, clockInTime, clockOutTime, totalHours, overtimeHours, created_at)
       VALUES (:id, :employeeId, :facilityId, :date, 'On Leave', :leaveTypeId, :reason, NULL, NULL, 0, 0, NOW())`,
      {
        replacements: {
          id: attendanceId,
          employeeId,
          facilityId,
          date,
          leaveTypeId,
          reason: reason || null,
        },
        type: db.sequelize.QueryTypes.INSERT,
      }
    );

    // Return the attendance record with leave type information
    const attendanceRecord = {
      id: attendanceId,
      employeeId,
      facilityId,
      attendance_date: date,
      status: "On Leave",
      leaveTypeId,
      leaveTypeName: leaveTypeInfo.name,
      leaveReason: reason || null,
      clockInTime: null,
      clockOutTime: null,
      totalHours: 0,
      overtimeHours: 0,
    };

    res.status(201).json({
      success: true,
      data: attendanceRecord,
    });
  } catch (error) {
    console.error("Error recording leave attendance:", error);
    res.status(500).json({
      success: false,
      message: "Error recording leave attendance",
      error: error.message,
    });
  }
};

exports.getLeaveAttendance = async (req, res) => {
  try {
    const { employeeId, facilityId, startDate, endDate } = req.query;

    if (!employeeId || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "Employee ID and Facility ID are required",
      });
    }

    let whereClause =
      "WHERE a.employeeId = :employeeId AND a.facilityId = :facilityId AND a.leaveTypeId IS NOT NULL";
    const replacements = { employeeId, facilityId };

    if (startDate && endDate) {
      whereClause += " AND a.attendance_date BETWEEN :startDate AND :endDate";
      replacements.startDate = startDate;
      replacements.endDate = endDate;
    }

    const leaveAttendance = await db.sequelize.query(
      `SELECT
        a.*,
        lt.name as leaveTypeName,
        lt.description as leaveTypeDescription,
        e.firstName,
        e.lastName,
        e.employeeId as empId
      FROM attendance a
      LEFT JOIN leave_types lt ON a.leaveTypeId = lt.id
      LEFT JOIN employees e ON a.employeeId = e.id
      ${whereClause}
      ORDER BY a.attendance_date DESC`,
      {
        replacements,
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    res.status(200).json({
      success: true,
      data: leaveAttendance,
    });
  } catch (error) {
    console.error("Error fetching leave attendance:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching leave attendance",
      error: error.message,
    });
  }
};

