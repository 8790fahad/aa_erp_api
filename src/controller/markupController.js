const db = require("../models");

// Get goods available for markup (these are the produced goods)
exports.getGoodsForMarkup = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Query to get items that are ready for markup from store_entries
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
        AND se.status = 'Added'
        AND se.activation = 'Active'
        AND se.qty_in > se.qty_out  -- Only items with remaining quantity
        AND (
          se.store_type = 'Production' OR
          se.subhead = 'Finished Goods' OR
          se.store_type LIKE '%Production%'
        )
      ORDER BY se.inserted_time DESC
    `;

    const goodsForMarkup = await db.sequelize.query(query, {
      replacements: { facilityId },
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Calculate available quantity for each item
    const goodsWithAvailableQty = goodsForMarkup.map((item) => ({
      ...item,
      available_quantity:
        parseFloat(item.qty_in || 0) - parseFloat(item.qty_out || 0),
      balance: parseFloat(item.qty_in || 0) - parseFloat(item.qty_out || 0),
    }));

    res.status(200).json({
      success: true,
      data: goodsWithAvailableQty,
    });
  } catch (error) {
    console.error("Error fetching goods for markup:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching goods for markup",
      error: error.message,
    });
  }
};

// Update markup for specific item
exports.updateMarkup = async (req, res) => {
  try {
    const {
      sellingPrice,
      product_id,
      expiry_date,
      multiplier_id,
      sku,
      unit_of_measure,
      mark_up,
      markup_mode,
      id,
    } = req.body;
    console.log(req.body, "=============> req.body");
    if (!sellingPrice) {
      return res.status(400).json({
        success: false,
        message: "Selling price is required",
      });
    }

    // Build WHERE conditions
    const whereConditions = [];
    const replacements = {
      id: id,
      selling_price: sellingPrice,
      mark_up: mark_up,
      markup_mode: markup_mode,
      branch_name: "for sales",
    };

    if (product_id) {
      whereConditions.push("`product_id` = :product_id");
      replacements.product_id = product_id;
    }

    if (expiry_date !== undefined) {
      if (expiry_date === null) {
        whereConditions.push("`expiry_date` IS NULL");
      } else {
        whereConditions.push("`expiry_date` = :expiry_date");
        replacements.expiry_date = expiry_date;
      }
    }

    if (multiplier_id !== undefined) {
      if (multiplier_id === null) {
        whereConditions.push("`multiplier_id` IS NULL");
      } else {
        whereConditions.push("`multiplier_id` = :multiplier_id");
        replacements.multiplier_id = multiplier_id;
      }
    }

    // if (sku) {
    //   whereConditions.push("`sku` = :sku");
    //   replacements.sku = sku;
    // }

    // if (unit_of_measure) {
    //   whereConditions.push("`unit_of_measure` = :unit_of_measure");
    //   replacements.unit_of_measure = unit_of_measure;
    // }

    if (whereConditions.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Insufficient data to identify the record to update",
      });
    }

    const updateQuery = `UPDATE \`store_entries\`
      SET \`selling_price\` = :selling_price, \`branch_name\` = :branch_name, \`mark_up\` = :mark_up, \`markup_mode\` = :markup_mode
      WHERE id=${id}`;

    console.log(updateQuery, "=============> updateQuery");
    console.log(replacements, "=============> replacements");

    const [updatedRows] = await db.sequelize.query(updateQuery, {
      replacements,
      type: db.sequelize.QueryTypes.UPDATE,
    });

    if (updatedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Selling price updated successfully",
    });
  } catch (error) {
    console.error("Error updating markup:", error);
    res.status(500).json({
      success: false,
      message: "Error updating markup",
      error: error.message,
    });
  }
};
exports.updateMarkupSellingPrice = async (req, res) => {
  try {
    const {
      product_id,
      multiplier_id,
      expiry_date,
      selling_price,
      facilityId,
    } = req.body;

    // Validate required fields
    if (!product_id || !selling_price) {
      return res.status(400).json({
        success: false,
        message: "product_id and selling_price are required",
      });
    }

    // Build WHERE conditions
    const whereConditions = ["`product_id` = :product_id"];
    const replacements = {
      product_id,
      selling_price: parseFloat(selling_price),
    };

    if (facilityId) {
      whereConditions.push("`facilityId` = :facilityId");
      replacements.facilityId = facilityId;
    }

    if (multiplier_id !== undefined) {
      if (multiplier_id === null || multiplier_id === "") {
        whereConditions.push(
          "(`multiplier_id` IS NULL OR `multiplier_id` = '')"
        );
      } else {
        whereConditions.push("`multiplier_id` = :multiplier_id");
        replacements.multiplier_id = multiplier_id;
      }
    }

    if (expiry_date !== undefined) {
      if (expiry_date === null || expiry_date === "") {
        whereConditions.push("(`expiry_date` IS NULL OR `expiry_date` = '')");
      } else {
        whereConditions.push("`expiry_date` = :expiry_date");
        replacements.expiry_date = expiry_date;
      }
    }

    const updateQuery = `
      UPDATE \`store_entries\`
      SET \`selling_price\` = :selling_price
      WHERE ${whereConditions.join(" AND ")}
    `;

    console.log(updateQuery, "=============> updateQuery");
    console.log(replacements, "=============> replacements");

    const [result] = await db.sequelize.query(updateQuery, {
      replacements,
      type: db.sequelize.QueryTypes.UPDATE,
    });

    res.status(200).json({
      success: true,
      message: "Selling price updated successfully",
      affectedRows: result,
    });
  } catch (error) {
    console.error("Error updating markup selling price:", error);
    res.status(500).json({
      success: false,
      message: "Error updating markup selling price",
      error: error.message,
    });
  }
};
