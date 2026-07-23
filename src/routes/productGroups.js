module.exports = (app) => {
  const { ProductGroup, Product, sequelize } = require("../models");

  // Get all product groups for a facility
  app.get("/api/product-groups", async (req, res) => {
    try {
      const { facilityId } = req.query;

      if (!facilityId) {
        return res.status(400).json({
          success: false,
          message: "facilityId is required",
        });
      }

      const groups = await ProductGroup.findAll({
        where: { facility_id: facilityId },
        include: [
          {
            model: Product,
            as: "products",
            attributes: ["id", "name", "sku"],
          },
        ],
        order: [["created_at", "DESC"]],
      });

      res.json({
        success: true,
        data: groups,
      });
    } catch (error) {
      console.error("Error fetching product groups:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch product groups",
        error: error.message,
      });
    }
  });

  // Create a new product group
  app.post("/api/product-groups", async (req, res) => {
    const transaction = await sequelize.transaction();
    console.log(req.body);
    try {
      const { facilityId, name, description, productIds, notes } = req.body;

      if (!facilityId || !name) {
        if (!transaction.finished) {
          await transaction.rollback();
        }
        return res.status(400).json({
          success: false,
          message: "facilityId and name are required",
        });
      }

      // Create a new product group
      const newGroup = await ProductGroup.create(
        {
          facility_id: facilityId,
          name,
          description: description || null,
          notes: notes || null,
        },
        { transaction }
      );

      // Update products with the new group_id if productIds provided
      if (productIds && productIds.length > 0) {
        await Product.update(
          { group_id: newGroup.id },
          {
            where: {
              id: productIds,
              facility_id: facilityId,
              item_type: "Finished Good",
            },
            transaction,
          }
        );
      }

      await transaction.commit();

      res.json({
        success: true,
        data: newGroup,
        message: "Product group created successfully",
      });
    } catch (error) {
      // Only rollback if transaction hasn't been committed
      if (!transaction.finished) {
        await transaction.rollback();
      }
      console.error("Error creating product group:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create product group",
        error: error.message,
      });
    }
  });

  // Update a product group
  app.put("/api/product-groups/:id", async (req, res) => {
    const transaction = await sequelize.transaction();

    try {
      const { id } = req.params;
      const { facilityId, name, description, notes, productIds } = req.body;

      if (!facilityId) {
        if (!transaction.finished) {
          await transaction.rollback();
        }
        return res.status(400).json({
          success: false,
          message: "facilityId is required",
        });
      }

      // Find the group
      const group = await ProductGroup.findOne({
        where: {
          id: id,
          facility_id: facilityId,
        },
        transaction,
      });

      if (!group) {
        if (!transaction.finished) {
          await transaction.rollback();
        }
        return res.status(404).json({
          success: false,
          message: "Product group not found",
        });
      }

      // Update the group
      await group.update(
        {
          name: name || group.name,
          description:
            description !== undefined ? description : group.description,
          notes: notes !== undefined ? notes : group.notes,
        },
        { transaction }
      );

      // Update products with group_id if productIds provided
      if (productIds !== undefined) {
        // Remove all products from this group first
        await Product.update(
          { group_id: null },
          {
            where: {
              group_id: id,
              facility_id: facilityId,
            },
            transaction,
          }
        );

        // Add selected products to the group
        if (productIds && productIds.length > 0) {
          await Product.update(
            { group_id: id },
            {
              where: {
                id: productIds,
                facility_id: facilityId,
                item_type: "Finished Good",
              },
              transaction,
            }
          );
        }
      }

      await transaction.commit();

      res.json({
        success: true,
        data: group,
        message: "Product group updated successfully",
      });
    } catch (error) {
      // Only rollback if transaction hasn't been committed
      if (!transaction.finished) {
        await transaction.rollback();
      }
      console.error("Error updating product group:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update product group",
        error: error.message,
      });
    }
  });

  // Update products in a group
  app.put("/api/product-groups/:id/products", async (req, res) => {
    const transaction = await sequelize.transaction();

    try {
      const { id } = req.params;
      const { facilityId, productIds } = req.body;

      if (!facilityId) {
        if (!transaction.finished) {
          await transaction.rollback();
        }
        return res.status(400).json({
          success: false,
          message: "facilityId is required",
        });
      }

      // Remove all products from this group first
      await Product.update(
        { group_id: null },
        {
          where: {
            group_id: id,
            facility_id: facilityId,
          },
          transaction,
        }
      );

      // Add selected products to the group
      if (productIds && productIds.length > 0) {
        await Product.update(
          { group_id: id },
          {
            where: {
              id: productIds,
              facility_id: facilityId,
              item_type: "Finished Good",
            },
            transaction,
          }
        );
      }

      await transaction.commit();

      res.json({
        success: true,
        message: "Product group updated successfully",
      });
    } catch (error) {
      // Only rollback if transaction hasn't been committed
      if (!transaction.finished) {
        await transaction.rollback();
      }
      console.error("Error updating product group:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update product group",
        error: error.message,
      });
    }
  });
};
