const db = require("../models");
const { Op } = db.Sequelize;

function buildSemiFinishedCostingNotesJson(productId, createdBy, requestItems) {
  const itemsJson = (requestItems || []).map((item) => {
    const rateVal =
      item.rate != null && item.rate !== ""
        ? String(item.rate).replace(/,/g, "")
        : "0";
    const unitCost =
      item.unit_cost != null && item.unit_cost !== ""
        ? Number(item.unit_cost)
        : rateVal
          ? parseFloat(rateVal) || 0
          : 0;
    const qty =
      item.quantity != null
        ? typeof item.quantity === "string"
          ? parseFloat(item.quantity) || 0
          : Number(item.quantity)
        : 0;

    return {
      type: item.type || "raw_material",
      description: item.description || item.raw_material_name || "",
      descriptionCode: item.description_code || item.descriptionCode || "",
      accountHead: item.account_head || item.accountHead || "",
      quantity: qty,
      rawMaterialId: String(
        item.raw_material_id ?? item.rawMaterialId ?? "",
      ),
      rawMaterialName:
        item.raw_material_name || item.rawMaterialName || "",
      rawMaterialSku:
        item.raw_material_sku || item.rawMaterialSku || "",
      otherType: item.other_type || item.otherType || "",
      rate: rateVal,
      unit_cost: unitCost,
      percentageBasis:
        item.percentage_basis || item.percentageBasis || "",
    };
  });

  const payload = {
    kind: "semi_finished_costing",
    productId: Number(productId),
    createdBy: createdBy || "",
    createdAt: new Date().toISOString(),
    items: itemsJson,
  };

  return JSON.stringify(payload, null, 2);
}

function toItemRow(templateId, lineIndex, item) {
  const rateVal = item.rate != null && item.rate !== "" ? String(item.rate) : "";
  const unitFromRate =
    rateVal !== ""
      ? parseFloat(String(rateVal).replace(/,/g, "")) || 0
      : item.unit_cost != null
        ? parseFloat(item.unit_cost) || 0
        : 0;

  return {
    template_id: templateId,
    line_index: lineIndex,
    type: item.type || "raw_material",
    description: item.description || item.raw_material_name || null,
    description_code: item.description_code || item.descriptionCode || null,
    account_head: item.account_head || item.accountHead || null,
    quantity:
      item.quantity != null ? parseFloat(item.quantity) || 0 : 0,
    raw_material_id:
      item.raw_material_id != null && item.raw_material_id !== ""
        ? String(item.raw_material_id)
        : item.rawMaterialId != null && item.rawMaterialId !== ""
          ? String(item.rawMaterialId)
          : null,
    raw_material_name:
      item.raw_material_name || item.rawMaterialName || null,
    raw_material_sku:
      item.raw_material_sku || item.rawMaterialSku || null,
    other_type: item.other_type || item.otherType || null,
    rate: rateVal || null,
    unit_cost: unitFromRate,
    percentage_basis:
      item.percentage_basis || item.percentageBasis || null,
  };
}

async function clearOtherDefaults(facilityId, productId, keepTemplateId, transaction) {
  await db.SemiFinishedCostingTemplate.update(
    { is_default: false },
    {
      where: {
        facility_id: facilityId,
        product_id: productId,
        id: { [Op.ne]: keepTemplateId },
      },
      transaction,
    },
  );
}

exports.listSemiFinishedCosting = async (req, res) => {
  try {
    const facilityId = req.query.facilityId || req.body?.facilityId;
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const rows = await db.SemiFinishedCostingTemplate.findAll({
      where: { facility_id: facilityId },
      include: [
        {
          model: db.SemiFinishedCostingTemplateItem,
          as: "items",
          separate: true,
          order: [["line_index", "ASC"]],
        },
        {
          model: db.Product,
          as: "product",
          attributes: [
            "id",
            "name",
            "sku",
            "item_type",
            "cost_price",
            "reorder_level",
            "inventory_account",
            "unit_of_measure",
          ],
        },
      ],
      order: [
        ["product_id", "ASC"],
        ["is_default", "DESC"],
        ["template_name", "ASC"],
        ["updated_at", "DESC"],
      ],
    });

    const data = rows.map((t) => ({
      template_id: t.id,
      template_name: t.template_name,
      is_default: !!t.is_default,
      product_id: t.product_id,
      facility_id: t.facility_id,
      created_by: t.created_by,
      updated_at: t.updated_at,
      notes: t.notes || null,
      product: t.product
        ? {
            id: t.product.id,
            name: t.product.name,
            sku: t.product.sku,
            item_type: t.product.item_type,
            cost_price: t.product.cost_price,
            reorder_level: t.product.reorder_level,
            inventory_account: t.product.inventory_account,
            unit_of_measure: t.product.unit_of_measure,
          }
        : null,
      items: (t.items || []).map((it) => ({
        type: it.type,
        description: it.description,
        description_code: it.description_code,
        account_head: it.account_head,
        quantity: it.quantity != null ? Number(it.quantity) : 0,
        raw_material_id: it.raw_material_id,
        raw_material_name: it.raw_material_name,
        raw_material_sku: it.raw_material_sku,
        other_type: it.other_type,
        rate: it.rate,
        unit_cost: it.unit_cost != null ? Number(it.unit_cost) : 0,
        percentage_basis: it.percentage_basis,
      })),
    }));

    return res.status(200).json({
      success: true,
      message: "Semi-finished costing templates loaded",
      data,
    });
  } catch (error) {
    console.error("listSemiFinishedCosting:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load semi-finished costing",
      error: error.message,
    });
  }
};

/**
 * Create or update template lines for a semi-finished product.
 * Body: facilityId, items[], template_id? (edit), template_name? (create / name key),
 *       is_default? (when true, clears other defaults for this product)
 */
exports.upsertSemiFinishedCosting = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { productId } = req.params;
    const facilityId = req.body.facilityId;
    const createdBy = req.body.createdBy || null;
    const items = req.body.items;
    const templateIdIn = req.body.template_id || req.body.templateId || null;
    const templateNameIn = req.body.template_name
      ? String(req.body.template_name).trim()
      : req.body.templateName
        ? String(req.body.templateName).trim()
        : "";
    const isDefault =
      req.body.is_default === true || req.body.isDefault === true;

    if (!facilityId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }
    if (!productId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "productId is required",
      });
    }
    if (!Array.isArray(items) || items.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "items must be a non-empty array",
      });
    }

    const product = await db.Product.findOne({
      where: {
        id: productId,
        facility_id: facilityId,
        item_type: "Semi Finished",
      },
      transaction,
    });

    if (!product) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Semi Finished product not found for this facility",
      });
    }

    let template = null;

    if (templateIdIn) {
      template = await db.SemiFinishedCostingTemplate.findOne({
        where: {
          id: templateIdIn,
          facility_id: facilityId,
          product_id: product.id,
        },
        transaction,
      });
      if (!template) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: "Costing template not found for this product",
        });
      }
    } else {
      const name = templateNameIn || "Default";
      template = await db.SemiFinishedCostingTemplate.findOne({
        where: {
          facility_id: facilityId,
          product_id: product.id,
          template_name: name,
        },
        transaction,
      });
      if (!template) {
        template = await db.SemiFinishedCostingTemplate.create(
          {
            facility_id: facilityId,
            product_id: product.id,
            template_name: name,
            is_default: false,
            created_by: createdBy,
          },
          { transaction },
        );
      }
    }

    const patch = { created_by: createdBy };
    if (isDefault) {
      patch.is_default = true;
    }
    await template.update(patch, { transaction });

    if (isDefault) {
      await clearOtherDefaults(
        facilityId,
        product.id,
        template.id,
        transaction,
      );
    }

    await db.SemiFinishedCostingTemplateItem.destroy({
      where: { template_id: template.id },
      transaction,
    });

    const rows = items.map((item, idx) => toItemRow(template.id, idx, item));
    await db.SemiFinishedCostingTemplateItem.bulkCreate(rows, {
      transaction,
    });

    const notesStr = buildSemiFinishedCostingNotesJson(
      product.id,
      createdBy,
      items,
    );
    await template.update({ notes: notesStr }, { transaction });

    await transaction.commit();

    const fresh = await db.SemiFinishedCostingTemplate.findByPk(template.id, {
      include: [
        {
          model: db.SemiFinishedCostingTemplateItem,
          as: "items",
          separate: true,
          order: [["line_index", "ASC"]],
        },
      ],
    });

    return res.status(200).json({
      success: true,
      message: "Semi-finished costing saved",
      data: {
        template_id: fresh.id,
        template_name: fresh.template_name,
        is_default: !!fresh.is_default,
        product_id: product.id,
        notes: fresh.notes || null,
        items: (fresh.items || []).map((it) => ({
          type: it.type,
          description: it.description,
          description_code: it.description_code,
          account_head: it.account_head,
          quantity: it.quantity != null ? Number(it.quantity) : 0,
          raw_material_id: it.raw_material_id,
          raw_material_name: it.raw_material_name,
          raw_material_sku: it.raw_material_sku,
          other_type: it.other_type,
          rate: it.rate,
          unit_cost: it.unit_cost != null ? Number(it.unit_cost) : 0,
          percentage_basis: it.percentage_basis,
        })),
      },
    });
  } catch (error) {
    await transaction.rollback();
    console.error("upsertSemiFinishedCosting:", error);
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({
        success: false,
        message:
          "A template with this name already exists for this product. Choose another name.",
      });
    }
    return res.status(500).json({
      success: false,
      message: "Failed to save semi-finished costing",
      error: error.message,
    });
  }
};

/** Delete a single template (and its items) by template UUID */
exports.deleteSemiFinishedCostingTemplate = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { templateId } = req.params;
    const facilityId = req.query.facilityId || req.body?.facilityId;

    if (!facilityId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const template = await db.SemiFinishedCostingTemplate.findOne({
      where: {
        id: templateId,
        facility_id: facilityId,
      },
      transaction,
    });

    if (!template) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Template not found",
      });
    }

    await db.SemiFinishedCostingTemplateItem.destroy({
      where: { template_id: template.id },
      transaction,
    });
    await template.destroy({ transaction });
    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "Semi-finished costing template removed",
    });
  } catch (error) {
    await transaction.rollback();
    console.error("deleteSemiFinishedCostingTemplate:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete semi-finished costing template",
      error: error.message,
    });
  }
};

/** @deprecated Use deleteSemiFinishedCostingTemplate — deletes one arbitrary template for product */
exports.deleteSemiFinishedCosting = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { productId } = req.params;
    const facilityId = req.query.facilityId || req.body?.facilityId;

    if (!facilityId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const templates = await db.SemiFinishedCostingTemplate.findAll({
      where: {
        facility_id: facilityId,
        product_id: productId,
      },
      transaction,
    });

    if (!templates.length) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "No templates found for this product",
      });
    }

    for (const template of templates) {
      await db.SemiFinishedCostingTemplateItem.destroy({
        where: { template_id: template.id },
        transaction,
      });
      await template.destroy({ transaction });
    }
    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "All semi-finished costing templates removed for this product",
    });
  } catch (error) {
    await transaction.rollback();
    console.error("deleteSemiFinishedCosting:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete semi-finished costing",
      error: error.message,
    });
  }
};
