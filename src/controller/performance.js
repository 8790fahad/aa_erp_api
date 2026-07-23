const db = require("../models");
const { Op } = require("sequelize");
const { v4: uuidv4 } = require("uuid");

// Create performance review
exports.createPerformanceReview = async (req, res) => {
  try {
    const {
      employeeId,
      period,
      periodType,
      kpiScores,
      overallRating,
      selfRating,
      comments,
      goals,
      achievements,
      improvementAreas,
    } = req.body;

    const facilityId = req.user.facilityId;
    const createdBy = req.user.id;

    // Check if performance review already exists for this period
    const existingReview = await db.performance.findOne({
      where: {
        employeeId,
        facilityId,
        period,
      },
    });

    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: "Performance review already exists for this period",
      });
    }

    const performance = await db.performance.create({
      id: uuidv4(),
      employeeId,
      facilityId,
      period,
      periodType,
      kpiScores: kpiScores || {},
      overallRating,
      selfRating,
      comments,
      goals: goals || [],
      achievements: achievements || [],
      improvementAreas: improvementAreas || [],
      status: "Draft",
      createdBy,
    });

    res.status(201).json({
      success: true,
      message: "Performance review created successfully",
      data: performance,
    });
  } catch (error) {
    console.error("Error creating performance review:", error);
    res.status(500).json({
      success: false,
      message: "Error creating performance review",
      error: error.message,
    });
  }
};

// Get performance reviews
exports.getPerformanceReviews = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      employeeId,
      period,
      status,
      periodType,
    } = req.query;
    const facilityId = req.user.facilityId;
    const offset = (page - 1) * limit;

    let whereClause = { facilityId };

    if (employeeId) {
      whereClause.employeeId = employeeId;
    }

    if (period) {
      whereClause.period = period;
    }

    if (status) {
      whereClause.status = status;
    }

    if (periodType) {
      whereClause.periodType = periodType;
    }

    const { count, rows } = await db.performance.findAndCountAll({
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
          as: "reviewer",
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
        performance: rows,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(count / limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching performance reviews:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching performance reviews",
      error: error.message,
    });
  }
};

// Update performance review (self review)
exports.updateSelfReview = async (req, res) => {
  try {
    const { id } = req.params;
    const { selfRating, comments, achievements, improvementAreas } = req.body;

    const facilityId = req.user.facilityId;
    const updatedBy = req.user.id;

    const performance = await db.performance.findOne({
      where: { id, facilityId },
    });

    if (!performance) {
      return res.status(404).json({
        success: false,
        message: "Performance review not found",
      });
    }

    if (
      performance.status !== "Draft" &&
      performance.status !== "Self Review"
    ) {
      return res.status(400).json({
        success: false,
        message: "Cannot update performance review in current status",
      });
    }

    const updatedPerformance = await performance.update({
      selfRating,
      comments,
      achievements,
      improvementAreas,
      status: "Self Review",
      updatedBy,
    });

    res.json({
      success: true,
      message: "Self review updated successfully",
      data: updatedPerformance,
    });
  } catch (error) {
    console.error("Error updating self review:", error);
    res.status(500).json({
      success: false,
      message: "Error updating self review",
      error: error.message,
    });
  }
};

// Manager review
exports.managerReview = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      managerRating,
      managerComments,
      promotionRecommendation,
      salaryAdjustmentRecommendation,
    } = req.body;

    const facilityId = req.user.facilityId;
    const reviewedBy = req.user.id;

    const performance = await db.performance.findOne({
      where: { id, facilityId },
    });

    if (!performance) {
      return res.status(404).json({
        success: false,
        message: "Performance review not found",
      });
    }

    if (
      performance.status !== "Self Review" &&
      performance.status !== "Manager Review"
    ) {
      return res.status(400).json({
        success: false,
        message: "Cannot perform manager review in current status",
      });
    }

    // Calculate overall rating (average of self and manager rating)
    const overallRating =
      performance.selfRating && managerRating
        ? Math.round((performance.selfRating + managerRating) / 2)
        : managerRating || performance.overallRating;

    const updatedPerformance = await performance.update({
      managerRating,
      managerComments,
      overallRating,
      promotionRecommendation,
      salaryAdjustmentRecommendation,
      status: "Completed",
      reviewedBy,
      reviewedAt: new Date(),
      updatedBy: reviewedBy,
    });

    res.json({
      success: true,
      message: "Manager review completed successfully",
      data: updatedPerformance,
    });
  } catch (error) {
    console.error("Error completing manager review:", error);
    res.status(500).json({
      success: false,
      message: "Error completing manager review",
      error: error.message,
    });
  }
};

// Get performance review by ID
exports.getPerformanceReviewById = async (req, res) => {
  try {
    const { id } = req.params;
    const facilityId = req.user.facilityId;

    const performance = await db.performance.findOne({
      where: { id, facilityId },
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
          as: "reviewer",
          attributes: ["id", "firstname", "lastname"],
        },
      ],
    });

    if (!performance) {
      return res.status(404).json({
        success: false,
        message: "Performance review not found",
      });
    }

    res.json({
      success: true,
      data: performance,
    });
  } catch (error) {
    console.error("Error fetching performance review:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching performance review",
      error: error.message,
    });
  }
};

// Get performance analytics
exports.getPerformanceAnalytics = async (req, res) => {
  try {
    const { year, departmentId } = req.query;
    const facilityId = req.user.facilityId;
    const currentYear = year || new Date().getFullYear();

    let whereClause = {
      facilityId,
      status: "Completed",
    };

    let includeClause = [
      {
        model: db.employees,
        as: "employee",
        attributes: ["id", "departmentId"],
        include: [
          {
            model: db.Department,
            as: "department",
            attributes: ["departmentName"],
          },
        ],
      },
    ];

    if (departmentId) {
      includeClause[0].where = { departmentId };
    }

    // Filter by year if period contains the year
    if (year) {
      whereClause.period = {
        [Op.like]: `%${year}%`,
      };
    }

    const performanceReviews = await db.performance.findAll({
      where: whereClause,
      include: includeClause,
    });

    // Calculate analytics
    const totalReviews = performanceReviews.length;
    const averageRating =
      totalReviews > 0
        ? (
            performanceReviews.reduce((sum, p) => sum + p.overallRating, 0) /
            totalReviews
          ).toFixed(2)
        : 0;

    const ratingDistribution = {
      1: performanceReviews.filter((p) => p.overallRating === 1).length,
      2: performanceReviews.filter((p) => p.overallRating === 2).length,
      3: performanceReviews.filter((p) => p.overallRating === 3).length,
      4: performanceReviews.filter((p) => p.overallRating === 4).length,
      5: performanceReviews.filter((p) => p.overallRating === 5).length,
    };

    const promotionRecommendations = performanceReviews.filter(
      (p) => p.promotionRecommendation
    ).length;
    const salaryAdjustmentRecommendations = performanceReviews.filter(
      (p) => p.salaryAdjustmentRecommendation
    ).length;

    // Department-wise analytics
    const departmentAnalytics = {};
    performanceReviews.forEach((review) => {
      const deptName = review.employee.department.departmentName;
      if (!departmentAnalytics[deptName]) {
        departmentAnalytics[deptName] = {
          totalReviews: 0,
          totalRating: 0,
          averageRating: 0,
        };
      }
      departmentAnalytics[deptName].totalReviews++;
      departmentAnalytics[deptName].totalRating += review.overallRating;
    });

    // Calculate department averages
    Object.keys(departmentAnalytics).forEach((dept) => {
      const deptData = departmentAnalytics[dept];
      deptData.averageRating = (
        deptData.totalRating / deptData.totalReviews
      ).toFixed(2);
    });

    res.json({
      success: true,
      data: {
        summary: {
          totalReviews,
          averageRating: parseFloat(averageRating),
          promotionRecommendations,
          salaryAdjustmentRecommendations,
        },
        ratingDistribution,
        departmentAnalytics,
      },
    });
  } catch (error) {
    console.error("Error fetching performance analytics:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching performance analytics",
      error: error.message,
    });
  }
};

