const db = require("../models");
const { Op } = require("sequelize");
const { v4: uuidv4 } = require("uuid");

// Clock in
exports.clockIn = async (req, res) => {
  try {
    const { employeeId, facilityId, createdBy } = req.body;
    
    // Validate required fields
    if (!employeeId || !facilityId || !createdBy) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: employeeId, facilityId, and createdBy are required",
      });
    }
    const currentDate = new Date().toISOString().split("T")[0];
    const currentTime = new Date().toTimeString().split(" ")[0];

    // Check if it's a public holiday
    const isPublicHoliday = await checkPublicHoliday(facilityId, currentDate);
    if (isPublicHoliday) {
      return res.status(400).json({
        success: false,
        message: "Attendance not required on public holidays",
      });
    }

    // Check if employee is on leave today
    const isOnLeave = await checkEmployeeLeave(
      employeeId,
      facilityId,
      currentDate
    );
    if (isOnLeave) {
      return res.status(400).json({
        success: false,
        message: "Employee is on leave today",
        leaveInfo: isOnLeave,
      });
    }

    // Check if already clocked in today
    const existingAttendance = await db.attendance.findOne({
      where: {
        employeeId,
        facilityId,
        date: currentDate,
      },
    });

    if (existingAttendance && existingAttendance.clockInTime) {
      return res.status(400).json({
        success: false,
        message: "Already clocked in today",
      });
    }

    // Create or update attendance record
    let attendance;
    if (existingAttendance) {
      attendance = await existingAttendance.update({
        clockInTime: currentTime,
        status: "Present",
        updatedBy: createdBy,
      });
    } else {
      attendance = await db.attendance.create({
        id: uuidv4(),
        employeeId,
        facilityId,
        date: currentDate,
        clockInTime: currentTime,
        status: "Present",
        createdBy,
      });
    }

    res.json({
      success: true,
      message: "Clocked in successfully",
      data: attendance,
    });
  } catch (error) {
    console.error("Error clocking in:", error);
    res.status(500).json({
      success: false,
      message: "Error clocking in",
      error: error.message,
    });
  }
};

// Clock out
exports.clockOut = async (req, res) => {
  try {
    const { employeeId, facilityId, createdBy } = req.body;
    
    // Validate required fields
    if (!employeeId || !facilityId || !createdBy) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: employeeId, facilityId, and createdBy are required",
      });
    }
    const currentDate = new Date().toISOString().split("T")[0];
    const currentTime = new Date().toTimeString().split(" ")[0];

    // Check if it's a public holiday
    const isPublicHoliday = await checkPublicHoliday(facilityId, currentDate);
    if (isPublicHoliday) {
      return res.status(400).json({
        success: false,
        message: "Attendance not required on public holidays",
      });
    }

    // Find today's attendance record
    const attendance = await db.attendance.findOne({
      where: {
        employeeId,
        facilityId,
        date: currentDate,
      },
    });

    if (!attendance) {
      return res.status(400).json({
        success: false,
        message: "No clock-in record found for today",
      });
    }

    if (!attendance.clockInTime) {
      return res.status(400).json({
        success: false,
        message: "Must clock in before clocking out",
      });
    }

    if (attendance.clockOutTime) {
      return res.status(400).json({
        success: false,
        message: "Already clocked out today",
      });
    }

    // Calculate total hours
    const clockInTime = new Date(`${currentDate} ${attendance.clockInTime}`);
    const clockOutTime = new Date(`${currentDate} ${currentTime}`);
    const totalHours = (clockOutTime - clockInTime) / (1000 * 60 * 60);

    // Calculate overtime (assuming 8 hours is standard)
    const standardHours = 8;
    const overtimeHours = Math.max(0, totalHours - standardHours);

    // Update attendance record
    const updatedAttendance = await attendance.update({
      clockOutTime: currentTime,
      totalHours: parseFloat((totalHours || 0).toFixed(2)),
      overtimeHours: parseFloat((overtimeHours || 0).toFixed(2)),
      updatedBy: createdBy,
    });

    res.json({
      success: true,
      message: "Clocked out successfully",
      data: updatedAttendance,
    });
  } catch (error) {
    console.error("Error clocking out:", error);
    res.status(500).json({
      success: false,
      message: "Error clocking out",
      error: error.message,
    });
  }
};

// Get attendance report
exports.getAttendanceReport = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      employeeId,
      startDate,
      endDate,
      status,
      departmentId,
      facilityId,
    } = req.query;
    
    // Validate required fields
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required in query parameters",
      });
    }
    const offset = (page - 1) * limit;

    let whereClause = { facilityId };

    if (employeeId && employeeId !== "undefined") {
      whereClause.employeeId = employeeId;
    }

    if (startDate && endDate) {
      whereClause.date = {
        [Op.between]: [startDate, endDate],
      };
    }

    if (status) {
      whereClause.status = status;
    }

    let includeClause = [
      {
        model: db.employees,
        as: "employee",
        attributes: [
          "id",
          "employeeId",
          "firstName",
          "lastName",
          "designation",
        ],
        include: [
          {
            model: db.Department,
            as: "department",
            attributes: ["departmentName"],
          },
        ],
      },
    ];

    // Filter by department if specified
    if (departmentId) {
      includeClause[0].where = { departmentId };
    }

    const { count, rows } = await db.attendance.findAndCountAll({
      where: whereClause,
      include: includeClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["date", "DESC"]],
    });

    // Calculate summary statistics
    const summary = await calculateAttendanceSummary(
      facilityId,
      startDate,
      endDate,
      departmentId
    );

    res.json({
      success: true,
      data: {
        attendance: rows,
        summary,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(count / limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching attendance report:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching attendance report",
      error: error.message,
    });
  }
};

// Manual attendance entry
exports.manualAttendanceEntry = async (req, res) => {
  try {
    const { employeeId, date, clockInTime, clockOutTime, status, remarks, facilityId, createdBy } =
      req.body;

    // Validate required fields
    if (!employeeId || !date || !facilityId || !createdBy) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: employeeId, date, facilityId, and createdBy are required",
      });
    }

    // Upsert — allow attendance more than once (update if same day exists)
    const existingAttendance = await db.attendance.findOne({
      where: {
        employeeId,
        facilityId,
        date,
      },
    });

    // Calculate total hours if both times are provided
    let totalHours = 0;
    let overtimeHours = 0;

    if (clockInTime && clockOutTime) {
      const clockIn = new Date(`${date} ${clockInTime}`);
      const clockOut = new Date(`${date} ${clockOutTime}`);
      totalHours = (clockOut - clockIn) / (1000 * 60 * 60);

      const standardHours = 8;
      overtimeHours = Math.max(0, totalHours - standardHours);
    }

    const payload = {
      clockInTime,
      clockOutTime,
      totalHours: parseFloat((totalHours || 0).toFixed(2)),
      overtimeHours: parseFloat((overtimeHours || 0).toFixed(2)),
      status,
      remarks,
      isManualEntry: true,
    };

    let attendance;
    if (existingAttendance) {
      attendance = await existingAttendance.update({
        ...payload,
        updatedBy: createdBy,
      });
    } else {
      attendance = await db.attendance.create({
        id: uuidv4(),
        employeeId,
        facilityId,
        date,
        createdBy,
        ...payload,
      });
    }

    res.status(existingAttendance ? 200 : 201).json({
      success: true,
      message: existingAttendance
        ? "Attendance updated successfully"
        : "Manual attendance entry created successfully",
      data: attendance,
    });
    return;
  } catch (error) {
    console.error("Error creating manual attendance entry:", error);
    res.status(500).json({
      success: false,
      message: "Error creating manual attendance entry",
      error: error.message,
    });
  }
};

// Approve attendance
exports.approveAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId, approvedBy } = req.body;
    
    // Validate required fields
    if (!facilityId || !approvedBy) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: facilityId and approvedBy are required",
      });
    }

    const attendance = await db.attendance.findOne({
      where: { id, facilityId },
    });

    if (!attendance) {
      return res.status(404).json({
        success: false,
        message: "Attendance record not found",
      });
    }

    const updatedAttendance = await attendance.update({
      approvedBy,
      approvedAt: new Date(),
      updatedBy: approvedBy,
    });

    res.json({
      success: true,
      message: "Attendance approved successfully",
      data: updatedAttendance,
    });
  } catch (error) {
    console.error("Error approving attendance:", error);
    res.status(500).json({
      success: false,
      message: "Error approving attendance",
      error: error.message,
    });
  }
};

// Helper function to calculate attendance summary
async function calculateAttendanceSummary(
  facilityId,
  startDate,
  endDate,
  departmentId
) {
  let whereClause = { facilityId };

  if (startDate && endDate) {
    whereClause.date = {
      [Op.between]: [startDate, endDate],
    };
  }

  let includeClause = [
    {
      model: db.employees,
      as: "employee",
      attributes: ["id", "departmentId"],
    },
  ];

  if (departmentId) {
    includeClause[0].where = { departmentId };
  }

  const attendanceRecords = await db.attendance.findAll({
    where: whereClause,
    include: includeClause,
  });

  const totalRecords = attendanceRecords.length;
  const presentCount = attendanceRecords.filter(
    (a) => a.status === "Present"
  ).length;
  const absentCount = attendanceRecords.filter(
    (a) => a.status === "Absent"
  ).length;
  const lateCount = attendanceRecords.filter((a) => a.status === "Late").length;
  const totalOvertimeHours = attendanceRecords.reduce(
    (sum, a) => {
      const overtimeHours = a.overtimeHours;
      // Ensure overtimeHours is a valid number
      const numericOvertimeHours = typeof overtimeHours === 'number' && !isNaN(overtimeHours) 
        ? overtimeHours 
        : 0;
      return sum + numericOvertimeHours;
    },
    0
  );

  return {
    totalRecords,
    presentCount,
    absentCount,
    lateCount,
    totalOvertimeHours: parseFloat((totalOvertimeHours || 0).toFixed(2)),
    attendanceRate:
      totalRecords > 0 ? ((presentCount / totalRecords) * 100).toFixed(2) : 0,
  };
}

// Helper function to check if a date is a public holiday
async function checkPublicHoliday(facilityId, date) {
  try {
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
    return holiday.length > 0;
  } catch (error) {
    const code =
      error?.code ||
      error?.parent?.code ||
      error?.original?.code ||
      error?.original?.errno;
    if (code === "ER_NO_SUCH_TABLE" || code === 1146) {
      return false;
    }
    console.error("Error checking public holiday:", error);
    return false;
  }
}

// Simple attendance recording (present/absent)
exports.recordAttendance = async (req, res) => {
  try {
    const { employeeId, facilityId, createdBy } = req.body;
    
    // Validate required fields
    if (!employeeId || !facilityId || !createdBy) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: employeeId, facilityId, and createdBy are required",
      });
    }
    
    const currentDate = new Date().toISOString().split("T")[0];
    const currentTime = new Date().toTimeString().split(" ")[0];

    // Check if it's a public holiday
    const isPublicHoliday = await checkPublicHoliday(facilityId, currentDate);
    if (isPublicHoliday) {
      return res.status(400).json({
        success: false,
        message: "Attendance not required on public holidays",
      });
    }

    // Check if employee is on leave today
    const isOnLeave = await checkEmployeeLeave(
      employeeId,
      facilityId,
      currentDate
    );
    if (isOnLeave) {
      // If employee is on leave, record it as "On Leave" status
      const existingAttendance = await db.attendance.findOne({
        where: {
          employeeId,
          facilityId,
          date: currentDate,
        },
      });

      let attendance;
      if (existingAttendance) {
        attendance = await existingAttendance.update({
          status: "On Leave",
          remarks: `Leave: ${isOnLeave.leaveType}`,
          updatedBy: createdBy,
        });
      } else {
        attendance = await db.attendance.create({
          id: uuidv4(),
          employeeId,
          facilityId,
          date: currentDate,
          status: "On Leave",
          remarks: `Leave: ${isOnLeave.leaveType}`,
          createdBy,
        });
      }

      return res.json({
        success: true,
        message: `Employee is on ${isOnLeave.leaveType} leave today`,
        data: attendance,
        leaveInfo: isOnLeave,
      });
    }

    // Check if attendance already recorded today — allow update (re-record)
    const existingAttendance = await db.attendance.findOne({
      where: {
        employeeId,
        facilityId,
        date: currentDate,
      },
    });

    if (existingAttendance) {
      const attendance = await existingAttendance.update({
        clockInTime: existingAttendance.clockInTime || currentTime,
        status: "Present",
        updatedBy: createdBy,
      });
      return res.json({
        success: true,
        message: "Attendance updated for today",
        data: attendance,
      });
    }

    // Record attendance as present
    const attendance = await db.attendance.create({
      id: uuidv4(),
      employeeId,
      facilityId,
      date: currentDate,
      clockInTime: currentTime,
      status: "Present",
      createdBy,
    });

    res.json({
      success: true,
      message: "Attendance recorded successfully",
      data: attendance,
    });
  } catch (error) {
    console.error("Error recording attendance:", error);
    res.status(500).json({
      success: false,
      message: "Error recording attendance",
      error: error.message,
    });
  }
};

// Helper function to check if employee is on leave
async function checkEmployeeLeave(employeeId, facilityId, date) {
  try {
    const leave = await db.leaves.findOne({
      where: {
        employeeId,
        facilityId,
        status: "Approved",
        startDate: { [Op.lte]: date },
        endDate: { [Op.gte]: date },
      },
      include: [
        {
          model: db.leave_types,
          as: "leaveTypeInfo",
          attributes: ["name", "description"],
        },
      ],
    });

    if (leave) {
      return {
        leaveType: leave.leaveTypeInfo?.name || leave.leaveType || "Unknown",
        reason: leave.reason,
        startDate: leave.startDate,
        endDate: leave.endDate,
      };
    }
    return null;
  } catch (error) {
    console.error("Error checking employee leave:", error);
    return null;
  }
}
// Bulk attendance upload
exports.bulkAttendanceUpload = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const { attendanceRecords, facilityId, createdBy } = req.body;

    if (!attendanceRecords || !Array.isArray(attendanceRecords)) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "attendanceRecords array is required",
      });
    }

    if (!facilityId || !createdBy) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId and createdBy are required",
      });
    }

    const processedRecords = [];
    const errors = [];

    for (let i = 0; i < attendanceRecords.length; i++) {
      const record = attendanceRecords[i];
      const rowNo = i + 1;
      try {
        const {
          employeeId: employeeCodeOrId,
          date,
          clockInTime,
          clockOutTime,
          status,
          remarks,
        } = record;

        if (!employeeCodeOrId || !date) {
          errors.push({
            row: rowNo,
            employeeId: employeeCodeOrId || null,
            date: date || null,
            error: "Employee ID and date are required",
          });
          continue;
        }

        // Resolve staff code (e.g. EMP-0001) — must exist; case-insensitive
        const code = String(employeeCodeOrId).trim();
        const looksLikeUuid =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            code
          );

        let employee = null;
        if (looksLikeUuid) {
          employee = await db.employees.findOne({
            where: { facilityId, id: code },
            transaction: t,
          });
        }
        if (!employee) {
          employee = await db.employees.findOne({
            where: {
              facilityId,
              [Op.and]: [
                db.sequelize.where(
                  db.sequelize.fn("UPPER", db.sequelize.col("employeeId")),
                  code.toUpperCase()
                ),
              ],
            },
            transaction: t,
          });
        }

        if (!employee) {
          errors.push({
            row: rowNo,
            employeeId: employeeCodeOrId,
            date,
            error: `Employee ID "${employeeCodeOrId}" does not exist. Check Employees and use the exact ID (e.g. EMP-0001).`,
          });
          continue;
        }

        const resolvedEmployeeId = employee.id;

        let totalHours = 0;
        let overtimeHours = 0;
        if (clockInTime && clockOutTime) {
          const clockIn = new Date(`${date} ${clockInTime}`);
          const clockOut = new Date(`${date} ${clockOutTime}`);
          if (!isNaN(clockIn.getTime()) && !isNaN(clockOut.getTime())) {
            totalHours = (clockOut - clockIn) / (1000 * 60 * 60);
            const standardHours = 8;
            overtimeHours = Math.max(0, totalHours - standardHours);
          }
        }

        const payload = {
          clockInTime: clockInTime || null,
          clockOutTime: clockOutTime || null,
          totalHours: parseFloat((totalHours || 0).toFixed(2)),
          overtimeHours: parseFloat((overtimeHours || 0).toFixed(2)),
          status: status || "Present",
          remarks: remarks || null,
          isManualEntry: true,
        };

        // Allow re-upload: update existing day record instead of rejecting
        const existingAttendance = await db.attendance.findOne({
          where: {
            employeeId: resolvedEmployeeId,
            facilityId,
            date,
          },
          transaction: t,
        });

        let savedRecord;
        if (existingAttendance) {
          await existingAttendance.update(payload, { transaction: t });
          savedRecord = existingAttendance;
        } else {
          savedRecord = await db.attendance.create(
            {
              id: uuidv4(),
              employeeId: resolvedEmployeeId,
              facilityId,
              date,
              createdBy,
              ...payload,
            },
            { transaction: t }
          );
        }

        processedRecords.push({
          ...savedRecord.toJSON(),
          action: existingAttendance ? "updated" : "created",
          employeeCode: code,
        });
      } catch (err) {
        errors.push({
          row: rowNo,
          employeeId: record?.employeeId || null,
          date: record?.date || null,
          error: err.message || "Unexpected error processing this row",
        });
      }
    }

    if (errors.length > 0 && processedRecords.length === 0) {
      await t.rollback();
      const firstReasons = errors
        .slice(0, 3)
        .map((e) => `Row ${e.row}: ${e.error}`)
        .join(" | ");
      return res.status(400).json({
        success: false,
        message: `Could not upload any of ${attendanceRecords.length} record(s). ${firstReasons}`,
        errors,
      });
    }

    await t.commit();

    const createdCount = processedRecords.filter((r) => r.action === "created").length;
    const updatedCount = processedRecords.filter((r) => r.action === "updated").length;

    let message = `Successfully processed ${processedRecords.length} attendance record(s)`;
    if (createdCount || updatedCount) {
      const parts = [];
      if (createdCount) parts.push(`${createdCount} created`);
      if (updatedCount) parts.push(`${updatedCount} updated`);
      message += ` (${parts.join(", ")})`;
    }
    if (errors.length > 0) {
      message += `. ${errors.length} failed.`;
    } else {
      message += ".";
    }

    res.json({
      success: true,
      message,
      data: processedRecords,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    await t.rollback();
    console.error("Error in bulk attendance upload:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Error in bulk attendance upload",
      error: error.message,
    });
  }
};
