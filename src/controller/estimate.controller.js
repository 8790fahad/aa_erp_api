const db = require("../models");
const { Op } = require("sequelize");

// Create a new estimate
exports.createEstimate = async (req, res) => {
    const transaction = await db.sequelize.transaction();
    try {
        const {
            project_number,
            customer_id,
            customer_name,
            email,
            cc_bcc,
            billing_address,
            estimate_date,
            expiration_date,
            message_on_estimate,
            subtotal,
            tax_amount,
            total,
            facilityId,
            line_items,
            taxes,
        } = req.body;

        if (!facilityId || !customer_id || !estimate_date) {
            await transaction.rollback();
            return res.status(400).json({
                success: false,
                message: "Missing required fields: facilityId, customer_id, estimate_date",
            });
        }

        const data = {
            line_items: line_items || [],
            taxes: taxes || [],
        };

        const estimate = await db.Estimate.create(
            {
                project_number,
                customer_id,
                customer_name: customer_name || "",
                email,
                cc_bcc,
                billing_address,
                estimate_date,
                expiration_date: expiration_date || null,
                message_on_estimate,
                subtotal: subtotal ?? 0,
                tax_amount: tax_amount ?? 0,
                total: total ?? 0,
                facility_id: facilityId,
                status: "Draft",
                data,
            },
            { transaction }
        );

        await transaction.commit();

        const createdEstimate = await db.Estimate.findByPk(estimate.id);

        res.status(201).json({
            success: true,
            message: "Estimate created successfully",
            data: createdEstimate,
        });
    } catch (error) {
        await transaction.rollback();
        console.error("Error creating estimate:", error);
        res.status(500).json({
            success: false,
            message: "Error creating estimate",
            error: error.message,
        });
    }
};

// Get estimates by facility
exports.getEstimates = async (req, res) => {
    try {
        const { facilityId } = req.params;
        const { page = 1, limit = 100, search, project_number } = req.query;
        const offset = (page - 1) * limit;

        const whereConditions = { facility_id: facilityId };

        if (project_number) {
            whereConditions.project_number = project_number;
        }

        if (search) {
            whereConditions[Op.or] = [
                { customer_name: { [Op.like]: `%${search}%` } },
                { project_number: { [Op.like]: `%${search}%` } },
                { id: { [Op.like]: `%${search}%` } } // Search by ID as estimate number
            ];
        }

        const { count, rows } = await db.Estimate.findAndCountAll({
            where: whereConditions,
            order: [["created_at", "DESC"]],
            limit: parseInt(limit),
            offset: parseInt(offset),
        });

        res.status(200).json({
            success: true,
            data: rows,
            pagination: {
                total: count,
                page: parseInt(page),
                pages: Math.ceil(count / limit),
            },
        });
    } catch (error) {
        console.error("Error fetching estimates:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching estimates",
            error: error.message,
        });
    }
};
