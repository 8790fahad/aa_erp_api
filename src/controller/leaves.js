const db = require("../models");
const { Op } = require("sequelize");
const { v4: uuidv4 } = require("uuid");

// Apply for leave
exports.applyLeave = async (req, res) => {
  try {
    const { employeeId, leaveType, startDate, endDate, reason, attachmentUrl, facilityId } =
      req.body;

    // Validate required fields
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const createdBy = req.user?.id || "system"; // Fallback if no user

    // Calculate total days
    const start = new Date(startDate);
    const end = new Date(endDate);
    const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

    // Check leave balance and create if not exists
    const currentYear = new Date().getFullYear();
    let leaveBalance = await db.leave_balances.findOne({
      where: {
        employeeId,
        facilityId,
        year: currentYear,
        leaveType,
      },
    });

    // If leave balance doesn't exist, create it with max days from leave type
    if (!leaveBalance) {
      // Get leave type details to get max days
      const leaveTypeDetails = await db.leave_types.findOne({
        where: {
          code: leaveType,
          facilityId,
        },
      });

      if (!leaveTypeDetails) {
        return res.status(400).json({
          success: false,
          message: "Leave type not found",
        });
      }

      // Create leave balance with max days
      leaveBalance = await db.leave_balances.create({
        employeeId,
        facilityId,
        leaveType,
        year: currentYear,
        totalDays: leaveTypeDetails.maxDays,
        usedDays: 0,
        remainingDays: leaveTypeDetails.maxDays,
        createdBy: createdBy,
      });
    }

    if (leaveBalance.remainingDays < totalDays) {
      return res.status(400).json({
        success: false,
        message: `Insufficient leave balance. Available: ${leaveBalance.remainingDays} days, Requested: ${totalDays} days`,
      });
    }

    // Check for overlapping leaves
    const overlappingLeave = await db.leaves.findOne({
      where: {
        employeeId,
        facilityId,
        status: ["Pending", "Approved", "Returned Early"],
        [Op.or]: [
          {
            startDate: { [Op.between]: [startDate, endDate] },
          },
          {
            endDate: { [Op.between]: [startDate, endDate] },
          },
          {
            [Op.and]: [
              { startDate: { [Op.lte]: startDate } },
              { endDate: { [Op.gte]: endDate } },
            ],
          },
        ],
      },
    });

    if (overlappingLeave) {
      return res.status(400).json({
        success: false,
        message: "You already have a leave request for this period",
      });
    }

    const leave = await db.leaves.create({
      id: uuidv4(),
      employeeId,
      facilityId,
      leaveType,
      startDate,
      endDate,
      totalDays,
      reason,
      attachmentUrl,
      createdBy,
      status: "Pending",
    });

    res.status(201).json({
      success: true,
      message: "Leave application submitted successfully",
      data: leave,
    });
  } catch (error) {
    console.error("Error applying for leave:", error);
    res.status(500).json({
      success: false,
      message: "Error applying for leave",
      error: error.message,
    });
  }
};

// Get all leave requests
exports.getAllLeaves = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, leaveType, employeeId, facilityId } = req.query;
    
    // Validate required fields
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }
    
    const offset = (page - 1) * limit;

    let whereClause = { facilityId };

    if (status) {
      whereClause.status = status;
    }

    if (leaveType) {
      whereClause.leaveType = leaveType;
    }

    if (employeeId) {
      whereClause.employeeId = employeeId;
    }

    const { count, rows } = await db.leaves.findAndCountAll({
      where: whereClause,
      include: [
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
        {
          model: db.users,
          as: "approver",
          attributes: ["id", "firstname", "lastname"],
        },
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["createdAt", "DESC"]],
    });

    res.json({
      success: true,
      data: {
        leaves: rows,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(count / limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching leaves:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching leaves",
      error: error.message,
    });
  }
};

// Approve leave
exports.approveLeave = async (req, res) => {
  try {
    const { id } = req.params;
    const { comments, facilityId } = req.body;
    
    // Validate required fields
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }
    
    const approverId = req.user?.id || "system"; // Fallback if no user

    const leave = await db.leaves.findOne({
      where: { id, facilityId },
      include: [
        {
          model: db.employees,
          as: "employee",
        },
      ],
    });

    if (!leave) {
      return res.status(404).json({
        success: false,
        message: "Leave request not found",
      });
    }

    if (leave.status !== "Pending") {
      return res.status(400).json({
        success: false,
        message: "Leave request has already been processed",
      });
    }

    // Update leave status
    await leave.update({
      status: "Approved",
      approverId,
      approvedAt: new Date(),
      updatedBy: approverId,
    });

    // Update leave balance
    const currentYear = new Date().getFullYear();
    const leaveBalance = await db.leave_balances.findOne({
      where: {
        employeeId: leave.employeeId,
        facilityId,
        year: currentYear,
        leaveType: leave.leaveType,
      },
    });

    if (leaveBalance) {
      await leaveBalance.update({
        usedDays: leaveBalance.usedDays + leave.totalDays,
        remainingDays: leaveBalance.remainingDays - leave.totalDays,
        updatedBy: approverId,
      });
    }

    res.json({
      success: true,
      message: "Leave request approved successfully",
      data: leave,
    });
  } catch (error) {
    console.error("Error approving leave:", error);
    res.status(500).json({
      success: false,
      message: "Error approving leave",
      error: error.message,
    });
  }
};

// Reject leave
exports.rejectLeave = async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionReason, facilityId } = req.body;
    
    // Validate required fields
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }
    
    const approverId = req.user?.id || "system"; // Fallback if no user

    const leave = await db.leaves.findOne({
      where: { id, facilityId },
    });

    if (!leave) {
      return res.status(404).json({
        success: false,
        message: "Leave request not found",
      });
    }

    if (leave.status !== "Pending") {
      return res.status(400).json({
        success: false,
        message: "Leave request has already been processed",
      });
    }

    await leave.update({
      status: "Rejected",
      approverId,
      approvedAt: new Date(),
      rejectionReason,
      updatedBy: approverId,
    });

    res.json({
      success: true,
      message: "Leave request rejected",
      data: leave,
    });
  } catch (error) {
    console.error("Error rejecting leave:", error);
    res.status(500).json({
      success: false,
      message: "Error rejecting leave",
      error: error.message,
    });
  }
};

// Get leave balance for employee
exports.getLeaveBalance = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { facilityId } = req.query;
    
    // Validate required fields
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }
    
    const currentYear = new Date().getFullYear();

    const leaveBalances = await db.leave_balances.findAll({
      where: {
        employeeId,
        facilityId,
        year: currentYear,
      },
      include: [
        {
          model: db.employees,
          as: "employee",
          attributes: ["employeeId", "firstName", "lastName"],
        },
      ],
    });

    res.json({
      success: true,
      data: leaveBalances,
    });
  } catch (error) {
    console.error("Error fetching leave balance:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching leave balance",
      error: error.message,
    });
  }
};

// Cancel leave request
exports.cancelLeave = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId } = req.body;
    
    // Validate required fields
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }
    
    const updatedBy = req.user?.id || "system"; // Fallback if no user

    const leave = await db.leaves.findOne({
      where: { id, facilityId },
    });

    if (!leave) {
      return res.status(404).json({
        success: false,
        message: "Leave request not found",
      });
    }

    if (leave.status !== "Pending") {
      return res.status(400).json({
        success: false,
        message: "Cannot cancel leave request that has been processed",
      });
    }

    await leave.update({
      status: "Cancelled",
      updatedBy,
    });

    res.json({
      success: true,
      message: "Leave request cancelled successfully",
    });
  } catch (error) {
    console.error("Error cancelling leave:", error);
    res.status(500).json({
      success: false,
      message: "Error cancelling leave",
      error: error.message,
    });
  }
};

// Early return from approved leave (shorten end date + restore unused balance)
exports.earlyReturnLeave = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId, returnDate, reason } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    if (!returnDate) {
      return res.status(400).json({
        success: false,
        message: "Return date is required",
      });
    }

    if (!reason || !String(reason).trim()) {
      return res.status(400).json({
        success: false,
        message: "Please provide a reason for early return",
      });
    }

    const updatedBy = req.user?.id || "system";

    const leave = await db.leaves.findOne({
      where: { id, facilityId },
    });

    if (!leave) {
      return res.status(404).json({
        success: false,
        message: "Leave request not found",
      });
    }

    if (leave.status !== "Approved") {
      return res.status(400).json({
        success: false,
        message: "Only approved leave can be marked as early return",
      });
    }

    const start = new Date(leave.startDate);
    const originalEnd = new Date(leave.endDate);
    const actualReturn = new Date(returnDate);

    // Normalize to date-only comparison
    start.setHours(0, 0, 0, 0);
    originalEnd.setHours(0, 0, 0, 0);
    actualReturn.setHours(0, 0, 0, 0);

    if (Number.isNaN(actualReturn.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid return date",
      });
    }

    if (actualReturn < start) {
      return res.status(400).json({
        success: false,
        message: "Return date cannot be before the leave start date",
      });
    }

    if (actualReturn >= originalEnd) {
      return res.status(400).json({
        success: false,
        message: "Return date must be before the original end date",
      });
    }

    const oldTotalDays = leave.totalDays;
    const newTotalDays =
      Math.ceil((actualReturn - start) / (1000 * 60 * 60 * 24)) + 1;
    const daysRestored = oldTotalDays - newTotalDays;

    if (daysRestored <= 0) {
      return res.status(400).json({
        success: false,
        message: "Early return must shorten the leave period",
      });
    }

    await leave.update({
      originalEndDate: leave.originalEndDate || leave.endDate,
      earlyReturnDate: returnDate,
      earlyReturnReason: String(reason).trim(),
      endDate: returnDate,
      totalDays: newTotalDays,
      status: "Returned Early",
      updatedBy,
    });

    // Restore unused days to leave balance
    const currentYear = new Date(leave.startDate).getFullYear();
    const leaveBalance = await db.leave_balances.findOne({
      where: {
        employeeId: leave.employeeId,
        facilityId,
        year: currentYear,
        leaveType: leave.leaveType,
      },
    });

    if (leaveBalance) {
      await leaveBalance.update({
        usedDays: Math.max(0, leaveBalance.usedDays - daysRestored),
        remainingDays: leaveBalance.remainingDays + daysRestored,
        updatedBy,
      });
    }

    res.json({
      success: true,
      message: `Early return recorded. ${daysRestored} day(s) restored to leave balance.`,
      data: {
        leave,
        daysRestored,
        newTotalDays,
      },
    });
  } catch (error) {
    console.error("Error recording early return:", error);
    res.status(500).json({
      success: false,
      message: "Error recording early return",
      error: error.message,
    });
  }
};

