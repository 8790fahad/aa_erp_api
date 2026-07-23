/**
 * Customer Type Controller
 *
 * This controller handles all customer type-related operations including:
 * - CRUD operations for customer types
 * - Customer type management
 */

const db = require("../models");
const { Op } = require("sequelize");

// Get all customer types for a facility
exports.getCustomerTypesList = async (req, res) => {
    try {
        const { facilityId, status, search } = req.query;

        if (!facilityId) {
            return res.status(400).json({
                success: false,
                message: "Facility ID is required",
            });
        }

        let whereClause = { facilityId };

        // Add status filter if provided
        if (status && status !== "all") {
            whereClause.status = status;
        }

        // Add search filter if provided
        if (search) {
            whereClause[db.Sequelize.Op.or] = [
                { name: { [db.Sequelize.Op.like]: `%${search}%` } },
                { description: { [db.Sequelize.Op.like]: `%${search}%` } },
            ];
        }

        const customerTypes = await db.CustomerType.findAll({
            where: whereClause,
            order: [["name", "ASC"]],
        });

        res.json({
            success: true,
            results: customerTypes,
            count: customerTypes.length,
        });
    } catch (error) {
        console.error("Error fetching customer types:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching customer types",
            error: error.message,
        });
    }
};

// Get customer types for dropdown/select options
exports.getCustomerTypesForSelect = async (req, res) => {
    try {
        const { facilityId } = req.body;

        if (!facilityId) {
            return res.status(400).json({
                success: false,
                message: "Facility ID is required",
            });
        }

        const customerTypes = await db.CustomerType.findAll({
            where: {
                facilityId,
                status: "active", // Only get active customer types for selection
            },
            attributes: ["id", "name", "description"],
            order: [["name", "ASC"]],
        });

        // Transform to the format expected by the frontend
        const formattedCustomerTypes = customerTypes.map((customerType) => ({
            value: customerType.name,
            label: customerType.name,
        }));

        res.json({
            success: true,
            results: formattedCustomerTypes,
            count: formattedCustomerTypes.length,
        });
    } catch (error) {
        console.error("Error fetching customer types for select:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching customer types for select",
            error: error.message,
        });
    }
};

// Get single customer type by ID
exports.getCustomerType = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Customer type ID is required",
            });
        }

        const customerType = await db.CustomerType.findByPk(id);

        if (!customerType) {
            return res.status(404).json({
                success: false,
                message: "Customer type not found",
            });
        }

        res.json({
            success: true,
            result: customerType,
        });
    } catch (error) {
        console.error("Error fetching customer type:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching customer type",
            error: error.message,
        });
    }
};

// Create customer type
exports.createCustomerType = async (req, res) => {
    try {
        const { name, description, status, facilityId } = req.body;

        if (!name || !facilityId) {
            return res.status(400).json({
                success: false,
                message: "Customer type name and facility ID are required",
            });
        }

        // Check if customer type name already exists in the facility
        const existingCustomerType = await db.CustomerType.findOne({
            where: {
                facilityId,
                name,
            },
        });

        if (existingCustomerType) {
            return res.status(400).json({
                success: false,
                message: "Customer type with this name already exists in this facility",
            });
        }

        const customerType = await db.CustomerType.create({
            name,
            description: description || null,
            status: status || "active",
            facilityId,
        });

        res.status(201).json({
            success: true,
            message: "Customer type created successfully",
            result: customerType,
        });
    } catch (error) {
        console.error("Error creating customer type:", error);
        res.status(500).json({
            success: false,
            message: "Error creating customer type",
            error: error.message,
        });
    }
};

// Update customer type
exports.updateCustomerType = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Customer type ID is required",
            });
        }

        // Remove fields that shouldn't be updated
        delete updateData.id;
        delete updateData.created_at;

        const [updatedRowsCount] = await db.CustomerType.update(updateData, {
            where: { id },
        });

        if (updatedRowsCount === 0) {
            return res.status(404).json({
                success: false,
                message: "Customer type not found",
            });
        }

        // Fetch updated customer type
        const updatedCustomerType = await db.CustomerType.findByPk(id);

        res.json({
            success: true,
            message: "Customer type updated successfully",
            result: updatedCustomerType,
        });
    } catch (error) {
        console.error("Error updating customer type:", error);
        res.status(500).json({
            success: false,
            message: "Error updating customer type",
            error: error.message,
        });
    }
};

// Toggle customer type status (activate/deactivate)
exports.toggleCustomerTypeStatus = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Customer type ID is required",
            });
        }

        // Get current customer type
        const customerType = await db.CustomerType.findByPk(id);

        if (!customerType) {
            return res.status(404).json({
                success: false,
                message: "Customer type not found",
            });
        }

        // Toggle status
        const newStatus = customerType.status === "active" ? "inactive" : "active";

        const [updatedRowsCount] = await db.CustomerType.update(
            { status: newStatus },
            { where: { id } }
        );

        if (updatedRowsCount === 0) {
            return res.status(404).json({
                success: false,
                message: "Customer type not found",
            });
        }

        // Fetch updated customer type
        const updatedCustomerType = await db.CustomerType.findByPk(id);

        res.json({
            success: true,
            message: `Customer type ${newStatus === "active" ? "activated" : "deactivated"
                } successfully`,
            result: updatedCustomerType,
        });
    } catch (error) {
        console.error("Error toggling customer type status:", error);
        res.status(500).json({
            success: false,
            message: "Error updating customer type status",
            error: error.message,
        });
    }
};

// Delete customer type
exports.deleteCustomerType = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Customer type ID is required",
            });
        }

        // Check if customer type exists first
        const customerType = await db.CustomerType.findByPk(id);

        if (!customerType) {
            return res.status(404).json({
                success: false,
                message: "Customer type not found",
            });
        }

        // Check if customer type is being used by any customers
        const customersWithCustomerType = await db.Customer.count({
            where: { customer_type: customerType.name },
        });

        if (customersWithCustomerType > 0) {
            return res.status(400).json({
                success: false,
                message: `Cannot delete customer type. ${customersWithCustomerType} customer(s) are currently assigned to this customer type.`,
            });
        }

        const deletedRowsCount = await db.CustomerType.destroy({
            where: { id },
        });

        if (deletedRowsCount === 0) {
            return res.status(404).json({
                success: false,
                message: "Customer type not found",
            });
        }

        res.json({
            success: true,
            message: "Customer type deleted successfully",
        });
    } catch (error) {
        console.error("Error deleting customer type:", error);
        res.status(500).json({
            success: false,
            message: "Error deleting customer type",
            error: error.message,
        });
    }
};
