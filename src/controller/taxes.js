const db = require("../models");
const { Op } = require("sequelize");

// Get all taxes for a facility
const getTaxes = async (req, res) => {
  try {
    const { facilityId, query_type } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    let whereClause = { facilityId };

    // Add search functionality if needed
    if (req.query.search) {
      whereClause[Op.or] = [
        { description: { [Op.like]: `%${req.query.search}%` } },
        { rate: { [Op.like]: `%${req.query.search}%` } },
      ];
    }

    const taxes = await db.Tax.findAll({
      where: whereClause,
      order: [["description", "ASC"]],
    });

    res.json({
      success: true,
      results: taxes,
      count: taxes.length,
    });
  } catch (error) {
    console.error("Error fetching taxes:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching taxes",
      error: error.message,
    });
  }
};
/**
 * DB ENUM is Sales | Purchase | Other — queries often send lowercase "purchase" / "sales".
 */
function normalizeTaxCategoryForQuery(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  const s = String(raw).trim();
  const lower = s.toLowerCase();
  if (lower === "purchase") return "Purchase";
  if (lower === "sales") return "Sales";
  if (lower === "other") return "Other";
  if (["Purchase", "Sales", "Other"].includes(s)) return s;
  return null;
}

const getTaxesByCategory = async (req, res) => {
  try {
    const { facilityId, tax_category } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const normalized = normalizeTaxCategoryForQuery(tax_category);
    if (!normalized) {
      return res.status(400).json({
        success: false,
        message:
          "tax_category is required and must be purchase, sales, or other (case-insensitive)",
      });
    }

    const taxes = await db.Tax.findAll({
      where: { facilityId, tax_category: normalized },
      order: [["description", "ASC"]],
    });

    res.json({
      success: true,
      results: taxes,
      count: taxes.length,
    });
  } catch (error) {
    console.error("Error fetching taxes:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching taxes",
      error: error.message,
    });
  }
};
// Get a specific tax by ID
const getTaxById = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const tax = await db.Tax.findOne({
      where: { id, facilityId },
    });

    if (!tax) {
      return res.status(404).json({
        success: false,
        message: "Tax not found",
      });
    }

    res.json({
      success: true,
      results: tax,
    });
  } catch (error) {
    console.error("Error fetching tax:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching tax",
      error: error.message,
    });
  }
};

// Create a new tax
const createTax = async (req, res) => {
  try {
    const {
      description,
      rate_type,
      rate,
      account_sub_head,
      tax_category,
      head,
      facilityId,
      createdBy,
      inclusive_type,
    } = req.body;

    // Validate required fields
    if (
      !description ||
      !rate_type ||
      !tax_category ||
      !rate ||
      !account_sub_head ||
      !facilityId ||
      !createdBy ||
      !inclusive_type
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: description, rate_type, rate, tax_category, account_sub_head, inclusive_type, facilityId, createdBy",
      });
    }

    // Validate inclusive_type value
    if (!["inclusive", "exclusive"].includes(inclusive_type)) {
      return res.status(400).json({
        success: false,
        message: "inclusive_type must be either 'inclusive' or 'exclusive'",
      });
    }

    // Check if tax with same head and facilityId already exists (only if head is not null)
    if (head) {
      const existingTax = await db.Tax.findOne({
        where: { head, facilityId },
      });

      if (existingTax) {
        return res.status(400).json({
          success: false,
          message:
            "Tax with this account head already exists for this facility",
        });
      }
    }

    const tax = await db.Tax.create({
      description,
      rate_type,
      rate,
      tax_category: normalizeTaxCategoryForQuery(tax_category) || tax_category,
      account_sub_head,
      head,
      facilityId,
      taxes_created_by: createdBy,
      inclusive_type,
    });

    res.status(201).json({
      success: true,
      results: tax,
      message: "Tax created successfully",
    });
  } catch (error) {
    console.error("Error creating tax:", error);
    res.status(500).json({
      success: false,
      message: "Error creating tax",
      error: error.message,
    });
  }
};

// Update a tax
const updateTax = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      description,
      rate_type,
      rate,
      tax_category,
      account_sub_head,
      head,
      facilityId,
      inclusive_type,
    } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Validate inclusive_type if provided
    if (inclusive_type && !["inclusive", "exclusive"].includes(inclusive_type)) {
      return res.status(400).json({
        success: false,
        message: "inclusive_type must be either 'inclusive' or 'exclusive'",
      });
    }

    const tax = await db.Tax.findOne({
      where: { id, facilityId },
    });

    if (!tax) {
      return res.status(404).json({
        success: false,
        message: "Tax not found",
      });
    }

    // Check if updating head would create a duplicate (only if head is not null)
    if (head && head !== tax.head) {
      const existingTax = await db.Tax.findOne({
        where: { head, facilityId, id: { [Op.ne]: id } },
      });

      if (existingTax) {
        return res.status(400).json({
          success: false,
          message:
            "Tax with this account head already exists for this facility",
        });
      }
    }

    await tax.update({
      description: description || tax.description,
      rate_type: rate_type || tax.rate_type,
      rate: rate || tax.rate,
      tax_category: tax_category
        ? normalizeTaxCategoryForQuery(tax_category) || tax_category
        : tax.tax_category,
      account_sub_head:
        account_sub_head !== undefined
          ? account_sub_head
          : tax.account_sub_head,
      head: head || tax.head,
      inclusive_type: inclusive_type !== undefined ? inclusive_type : tax.inclusive_type,
    });

    res.json({
      success: true,
      results: tax,
      message: "Tax updated successfully",
    });
  } catch (error) {
    console.error("Error updating tax:", error);
    res.status(500).json({
      success: false,
      message: "Error updating tax",
      error: error.message,
    });
  }
};

// Delete a tax
const deleteTax = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const tax = await db.Tax.findOne({
      where: { id, facilityId },
    });

    if (!tax) {
      return res.status(404).json({
        success: false,
        message: "Tax not found",
      });
    }

    await tax.destroy();

    res.json({
      success: true,
      message: "Tax deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting tax:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting tax",
      error: error.message,
    });
  }
};

module.exports = {
  getTaxes,
  getTaxById,
  createTax,
  updateTax,
  deleteTax,
  getTaxesByCategory,
};
