const db = require("../models");
const LeaveType = db.leave_types;

// Create leave type
exports.createLeaveType = async (req, res) => {
  try {
    const {
      facilityId,
      name,
      code,
      maxDays,
      isPaid,
      requiresApproval,
      description,
      color,
    } = req.body;

    // Validate required fields
    if (!facilityId || !name || !code || maxDays === undefined) {
      return res.status(400).json({
        success: false,
        message: "facilityId, name, code, and maxDays are required",
      });
    }

    // Check if code already exists
    const existingLeaveType = await LeaveType.findOne({
      where: { code, facilityId },
    });

    if (existingLeaveType) {
      return res.status(400).json({
        success: false,
        message: "Leave type code already exists",
      });
    }

    const leaveType = await LeaveType.create({
      facilityId,
      name,
      code: code.toUpperCase(),
      maxDays: parseInt(maxDays),
      isPaid: Boolean(isPaid),
      requiresApproval: Boolean(requiresApproval),
      description: description || "",
      color: color || "#3B82F6",
    });

    res.status(201).json({
      success: true,
      message: "Leave type created successfully",
      results: leaveType,
    });
  } catch (error) {
    console.error("Error creating leave type:", error);
    res.status(500).json({
      success: false,
      message: "Error creating leave type",
      error: error.message,
    });
  }
};

// Get all leave types for a facility
exports.getLeaveTypes = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const leaveTypes = await LeaveType.findAll({
      where: { facilityId, status: "active" },
      order: [["name", "ASC"]],
    });

    res.json({
      success: true,
      results: leaveTypes,
    });
  } catch (error) {
    console.error("Error fetching leave types:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching leave types",
      error: error.message,
    });
  }
};

// Get single leave type
exports.getLeaveTypeById = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const leaveType = await LeaveType.findOne({
      where: { id, facilityId },
    });

    if (!leaveType) {
      return res.status(404).json({
        success: false,
        message: "Leave type not found",
      });
    }

    res.json({
      success: true,
      results: leaveType,
    });
  } catch (error) {
    console.error("Error fetching leave type:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching leave type",
      error: error.message,
    });
  }
};

// Update leave type
exports.updateLeaveType = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      facilityId,
      name,
      code,
      maxDays,
      isPaid,
      requiresApproval,
      description,
      color,
    } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const leaveType = await LeaveType.findOne({
      where: { id, facilityId },
    });

    if (!leaveType) {
      return res.status(404).json({
        success: false,
        message: "Leave type not found",
      });
    }

    // Check if code already exists (excluding current record)
    if (code && code !== leaveType.code) {
      const existingLeaveType = await LeaveType.findOne({
        where: { code: code.toUpperCase(), facilityId },
      });

      if (existingLeaveType && existingLeaveType.id !== parseInt(id)) {
        return res.status(400).json({
          success: false,
          message: "Leave type code already exists",
        });
      }
    }

    await leaveType.update({
      name: name || leaveType.name,
      code: code ? code.toUpperCase() : leaveType.code,
      maxDays: maxDays !== undefined ? parseInt(maxDays) : leaveType.maxDays,
      isPaid: isPaid !== undefined ? Boolean(isPaid) : leaveType.isPaid,
      requiresApproval:
        requiresApproval !== undefined
          ? Boolean(requiresApproval)
          : leaveType.requiresApproval,
      description:
        description !== undefined ? description : leaveType.description,
      color: color || leaveType.color,
    });

    res.json({
      success: true,
      message: "Leave type updated successfully",
      results: leaveType,
    });
  } catch (error) {
    console.error("Error updating leave type:", error);
    res.status(500).json({
      success: false,
      message: "Error updating leave type",
      error: error.message,
    });
  }
};

// Delete leave type
exports.deleteLeaveType = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const leaveType = await LeaveType.findOne({
      where: { id, facilityId },
    });

    if (!leaveType) {
      return res.status(404).json({
        success: false,
        message: "Leave type not found",
      });
    }

    // Soft delete by setting status to inactive
    await leaveType.update({ status: "inactive" });

    res.json({
      success: true,
      message: "Leave type deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting leave type:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting leave type",
      error: error.message,
    });
  }
};

