const db = require("../models");

// Get Multipliers by Facility
exports.getMultipliersByFacility = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required"
      });
    }

    const multipliers = await db.product_multipliers.findAll({
      where: {
        facilityId: facilityId,
        status: 'active'
      },
      order: [['createdAt', 'DESC']]
    });

    res.status(200).json({
      success: true,
      data: multipliers
    });

  } catch (error) {
    console.error('Error fetching multipliers:', error);
    res.status(500).json({
      success: false,
      message: "Error fetching multipliers",
      error: error.message
    });
  }
};

// Get products with their associated multipliers
exports.getProductsWithMultipliers = async (req, res) => {
  try {
    const { facilityId, sku } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required"
      });
    }

    if (!sku) {
      return res.status(400).json({
        success: false,
        message: "sku is required"
      });
    }

    // Then, get all multipliers for these products
    const multipliers = await db.product_multipliers.findAll({
      where: {
        facilityId: facilityId,
        status: 'active',
        sku: sku
      },
      order: [['createdAt', 'DESC']]
    });

    // Combine products with their multipliers


    res.status(200).json({
      success: true,
      data: multipliers
    });

  } catch (error) {
    console.error('Error fetching products with multipliers:', error);
    res.status(500).json({
      success: false,
      message: "Error fetching products with multipliers",
      error: error.message
    });
  }
};
