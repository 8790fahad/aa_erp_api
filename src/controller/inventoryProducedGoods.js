const db = require("../models");

// Get Produced Goods for Markup
exports.getProducedGoodsForMarkup = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required"
      });
    }

    // Query to get only finished goods from production that are available for markup
    const query = `
      SELECT 
        se.*,
        p.name as item_name,
        p.category as item_category,
        p.sku as item_code,
        pm.multiplier_value as applied_multiplier
      FROM store_entries se
      LEFT JOIN products p ON se.product_id = p.sku
      LEFT JOIN product_multipliers pm ON se.multiplier_id = pm.id
      WHERE se.facilityId = :facilityId
        AND se.store_type = 'Production'
        AND se.subhead = 'Finished Goods'
        AND se.transaction_type = 'IN'
        AND se.status = 'Added'
        AND se.activation = 'Active'
        AND se.qty_in > se.qty_out  -- Only items with remaining quantity
      ORDER BY se.inserted_time DESC
    `;

    const producedGoods = await db.sequelize.query(query, {
      replacements: { facilityId },
      type: db.sequelize.QueryTypes.SELECT
    });

    // Calculate available quantity for each item
    const goodsWithAvailableQty = producedGoods.map(item => ({
      ...item,
      available_quantity: parseFloat(item.qty_in || 0) - parseFloat(item.qty_out || 0),
      balance: parseFloat(item.qty_in || 0) - parseFloat(item.qty_out || 0)
    }));

    res.status(200).json({
      success: true,
      data: goodsWithAvailableQty
    });

  } catch (error) {
    console.error('Error fetching produced goods for markup:', error);
    res.status(500).json({
      success: false,
      message: "Error fetching produced goods for markup",
      error: error.message
    });
  }
};