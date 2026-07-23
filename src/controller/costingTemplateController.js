const db = require("../models");

// Get all costing templates
exports.getCostingTemplates = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Get Finished Good products that have costing templates (notes containing "Costing Template")
    const products = await db.Product.findAll({
      where: {
        facility_id: facilityId,
        item_type: "Finished Good",
        status: "Active",
      },
      order: [["created_at", "DESC"]],
    });

    // Map products to template format - extract costing template items from JSON or notes
    const templates = [];
    products.forEach((product) => {
      // First try to get structured items from JSON column
      if (product.costing_template_items && Array.isArray(product.costing_template_items)) {
        product.costing_template_items.forEach((item, itemIndex) => {
          templates.push({
            id: `${product.id}-${itemIndex}`,
            product_id: product.id,
            finished_good_product_id: product.id,
            type: item.type || "other",
            description: item.description || product.name,
            description_code: item.description_code || null,
            quantity: item.quantity || 0,
            other_type: item.other_type || null,
            rate: item.rate || null,
            percentage_basis: item.percentage_basis || null,
            amount: product.cost_price * (item.quantity || 0),
            raw_material_id: item.raw_material_id || null,
            raw_material_name: item.raw_material_name || null,
            raw_material_sku: item.raw_material_sku || null,
            costing_units: product.costing_units || null,
            created_at: product.created_at,
            updated_at: product.updated_at,
          });
        });
      }
      // Fallback to parsing notes if no JSON data
      else if (product.notes && product.notes.includes("Costing Template")) {
        // Parse notes to extract template items
        const noteLines = product.notes.split("\n");
        noteLines.forEach((line, lineIndex) => {
          if (line.includes("Costing Template Item")) {
            // Extract information from note line
            const typeMatch = line.match(/Type:\s*(\w+)/);
            const descMatch = line.match(/Description:\s*([^,]+)/);
            const descCodeMatch = line.match(/DescriptionCode:\s*([^,]+)/);
            const qtyMatch = line.match(/Quantity:\s*([\d.]+)/);
            const percentageMatch = line.match(/Percentage:\s*([\d.]+)/);
            const otherTypeMatch = line.match(/InputType:\s*(\w+)/);
            const rateMatch = line.match(/Rate:\s*([\d.]+)/);
            const rawMaterialIdMatch = line.match(/RawMaterialId:\s*([^,]+)/);
            const rawMaterialNameMatch = line.match(
              /RawMaterialName:\s*([^,]+)/
            );
            const rawMaterialSkuMatch = line.match(/RawMaterialSku:\s*([^,]+)/);

            const type = typeMatch ? typeMatch[1] : "other";
            const description = descMatch ? descMatch[1].trim() : product.name;
            const description_code = descCodeMatch
              ? descCodeMatch[1].trim()
              : null;
            // For percentage type, use percentage value; otherwise use quantity
            const quantity = percentageMatch
              ? parseFloat(percentageMatch[1])
              : qtyMatch
              ? parseFloat(qtyMatch[1])
              : 0;
            const other_type = otherTypeMatch ? otherTypeMatch[1] : null;
            const rate = rateMatch ? parseFloat(rateMatch[1]) : null;
            const raw_material_id = rawMaterialIdMatch
              ? rawMaterialIdMatch[1].trim()
              : null;
            const raw_material_name = rawMaterialNameMatch
              ? rawMaterialNameMatch[1].trim()
              : null;
            const raw_material_sku = rawMaterialSkuMatch
              ? rawMaterialSkuMatch[1].trim()
              : null;

            templates.push({
              id: `${product.id}-${lineIndex}`, // Unique ID for each template item
              product_id: product.id,
              finished_good_product_id: product.id,
              type: type,
              description: description,
              description_code: description_code,
              quantity: quantity,
              other_type: other_type,
              rate: rate,
              amount: product.cost_price * quantity,
              raw_material_id: raw_material_id,
              raw_material_name: raw_material_name,
              raw_material_sku: raw_material_sku,
              costing_units: product.costing_units || null,
              created_at: product.created_at,
              updated_at: product.updated_at,
            });
          }
        });
      }
    });

    res.status(200).json({
      success: true,
      data: templates,
      message: "Costing templates retrieved successfully",
    });
  } catch (error) {
    console.error("Error fetching costing templates:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching costing templates",
      error: error.message,
    });
  }
};

// Create costing templates in bulk and associate with finished good product
exports.createCostingTemplatesBulk = async (req, res) => {
  const transaction = await db.sequelize.transaction();

  try {
    const { facilityId, createdBy, finished_good_product_id, items } = req.body;

    if (!facilityId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    if (!finished_good_product_id) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "finished_good_product_id is required",
      });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "items array is required and must not be empty",
      });
    }

    // Verify the finished good product exists
    const finishedGoodProduct = await db.Product.findOne({
      where: {
        id: finished_good_product_id,
        facility_id: facilityId,
        item_type: "Finished Good",
      },
      transaction,
    });

    if (!finishedGoodProduct) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Finished Good product not found",
      });
    }

    const createdTemplates = [];
    const errors = [];

    // Process each item - these are raw materials or other items for the costing template
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      try {
        // Store template data in product notes or create a separate table entry
        // For now, we'll update the product notes to include costing template items
        let templateNote = `Costing Template Item ${i + 1}: Type: ${
          item.type
        }, Description: ${item.description || item.raw_material_name}`;

        // Ingredient types (raw_material, semi_finished), show quantity
        if (item.type === "raw_material" || item.type === "semi_finished") {
          templateNote += `, Quantity: ${item.quantity}`;
        } else if (item.type === "other" || item.type === "by_product_credit") {
          // For "other" and "by_product_credit" types, show rate or percentage based on other_type
          if (item.other_type === "rate" && item.rate) {
            templateNote += `, Rate: ${item.rate}`;
          } else if (item.other_type === "percentage" && item.quantity) {
            templateNote += `, Percentage: ${item.quantity}`;
          } else {
            // Fallback to quantity if other_type is not set
            templateNote += `, Quantity: ${item.quantity || 0}`;
          }
        } else {
          // Default fallback
          templateNote += `, Quantity: ${item.quantity || 0}`;
        }

        // Add description code for "other" and "by_product_credit" type items
        if (
          (item.type === "other" || item.type === "by_product_credit") &&
          item.description_code
        ) {
          templateNote += `, DescriptionCode: ${item.description_code}`;
        }

        // Add other_type for "other" and "by_product_credit" type items
        if (
          (item.type === "other" || item.type === "by_product_credit") &&
          item.other_type
        ) {
          templateNote += `, InputType: ${item.other_type}`;
        }

        // Add ingredient details for raw_material/semi_finished type items
        if (item.type === "raw_material" || item.type === "semi_finished") {
          if (item.raw_material_id) {
            templateNote += `, RawMaterialId: ${item.raw_material_id}`;
          }
          if (item.raw_material_name) {
            templateNote += `, RawMaterialName: ${item.raw_material_name}`;
          }
          if (item.raw_material_sku) {
            templateNote += `, RawMaterialSku: ${item.raw_material_sku}`;
          }
        }

        // Update product notes to include costing template information
        const existingNotes = finishedGoodProduct.notes || "";
        const updatedNotes = existingNotes
          ? `${existingNotes}\n${templateNote}`
          : `Costing Template Items:\n${templateNote}`;

        finishedGoodProduct.notes = updatedNotes;
        
        // Also store structured costing template items in JSON format
        const existingItems = finishedGoodProduct.costing_template_items || [];
        const structuredItem = {
          index: existingItems.length + 1,
          type: item.type,
          description: item.description || item.raw_material_name,
          quantity: item.quantity || 0,
          description_code: item.description_code || null,
          account_head: item.account_head || null,
          other_type: item.other_type || null,
          rate: item.rate || null,
          percentage_basis: item.percentage_basis || null,
          raw_material_id: item.raw_material_id || null,
          raw_material_name: item.raw_material_name || null,
          raw_material_sku: item.raw_material_sku || null,
        };
        finishedGoodProduct.costing_template_items = [...existingItems, structuredItem];
        
        await finishedGoodProduct.save({ transaction });

        createdTemplates.push({
          id: finished_good_product_id,
          finished_good_product_id: finished_good_product_id,
          product_id: finished_good_product_id,
          type: item.type,
          description: item.description || item.raw_material_name,
          description_code: item.description_code || null,
          quantity: item.quantity,
          other_type: item.other_type || null,
          rate: item.rate || null,
          amount: item.amount,
          raw_material_id: item.raw_material_id || null,
          raw_material_name: item.raw_material_name || null,
          raw_material_sku: item.raw_material_sku || null,
          created_at: new Date(),
        });
      } catch (itemError) {
        console.error(`Error processing item ${i + 1}:`, itemError);
        errors.push({
          index: i + 1,
          item: item,
          error: itemError.message,
        });
      }
    }

    if (errors.length > 0 && createdTemplates.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Failed to create any costing templates",
        errors: errors,
      });
    }

    await transaction.commit();

    res.status(201).json({
      success: true,
      data: {
        finished_good_product: {
          id: finishedGoodProduct.id,
          name: finishedGoodProduct.name,
          sku: finishedGoodProduct.sku,
        },
        created: createdTemplates,
        failed: errors,
        summary: {
          total: items.length,
          successful: createdTemplates.length,
          failed: errors.length,
        },
      },
      message: `${createdTemplates.length} costing template item(s) added to product "${finishedGoodProduct.name}" successfully`,
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Error creating costing templates:", error);
    res.status(500).json({
      success: false,
      message: "Error creating costing templates",
      error: error.message,
    });
  }
};

// Update costing template (single item - legacy)
exports.updateCostingTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId, ...updateData } = req.body;

    // id may be "productId-itemIndex" format - extract productId
    const productId = String(id).includes("-")
      ? String(id).split("-")[0]
      : id;

    const product = await db.Product.findOne({
      where: {
        id: productId,
        facility_id: facilityId,
      },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Costing template not found",
      });
    }

    // Update product
    if (updateData.description) {
      product.name = updateData.description;
    }
    if (updateData.amount !== undefined && updateData.quantity > 0) {
      product.cost_price =
        parseFloat(updateData.amount) / parseFloat(updateData.quantity);
    }

    // Update notes to include quantity
    if (updateData.quantity !== undefined) {
      const typeMatch = product.notes?.match(/Type:\s*(\w+)/);
      const type = typeMatch ? typeMatch[1] : "other";
      product.notes = `Created from costing template. Type: ${type}. Quantity: ${updateData.quantity}`;
    }

    await product.save();

    res.status(200).json({
      success: true,
      data: product,
      message: "Costing template updated successfully",
    });
  } catch (error) {
    console.error("Error updating costing template:", error);
    res.status(500).json({
      success: false,
      message: "Error updating costing template",
      error: error.message,
    });
  }
};

// Update all costing template items for a product (bulk replace)
exports.updateProductCostingItems = async (req, res) => {
  try {
    const { productId } = req.params;
    const { facilityId, items } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({
        success: false,
        message: "items array is required",
      });
    }

    const product = await db.Product.findOne({
      where: {
        id: productId,
        facility_id: facilityId,
        item_type: "Finished Good",
      },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Build structured items for costing_template_items
    const structuredItems = items.map((item, index) => ({
      index: index + 1,
      type: item.type || "other",
      description: item.description || item.raw_material_name || "",
      quantity: parseFloat(item.quantity) || 0,
      description_code: item.description_code || null,
      account_head: item.account_head || null,
      other_type: item.other_type || null,
      rate: item.rate != null ? String(item.rate) : null,
      percentage_basis: item.percentage_basis || null,
      raw_material_id: item.raw_material_id || null,
      raw_material_name: item.raw_material_name || null,
      raw_material_sku: item.raw_material_sku || null,
    }));

    // Update product's costing_template_items
    product.costing_template_items = structuredItems;

    // Also update notes for backward compatibility
    let notesText = "Costing Template Items:\n";
    structuredItems.forEach((item, i) => {
      let line = `Costing Template Item ${i + 1}: Type: ${item.type}, Description: ${item.description}`;
      if (item.type === "raw_material" || item.type === "semi_finished") {
        line += `, Quantity: ${item.quantity}`;
        if (item.raw_material_id) line += `, RawMaterialId: ${item.raw_material_id}`;
        if (item.raw_material_name) line += `, RawMaterialName: ${item.raw_material_name}`;
        if (item.raw_material_sku) line += `, RawMaterialSku: ${item.raw_material_sku}`;
        if (item.rate) line += `, Rate: ${item.rate}`;
      } else {
        if (item.other_type === "rate" && item.rate) {
          line += `, Rate: ${item.rate}`;
        } else if (item.other_type === "percentage" && item.quantity) {
          line += `, Percentage: ${item.quantity}`;
          if (item.percentage_basis) line += `, PercentageBasis: ${item.percentage_basis}`;
        }
        if (item.description_code) line += `, DescriptionCode: ${item.description_code}`;
        if (item.account_head) line += `, AccountHead: ${item.account_head}`;
        if (item.other_type) line += `, InputType: ${item.other_type}`;
      }
      notesText += line + "\n";
    });
    product.notes = notesText;

    await product.save();

    res.status(200).json({
      success: true,
      data: { product, items: structuredItems },
      message: "Costing template items updated successfully",
    });
  } catch (error) {
    console.error("Error updating product costing items:", error);
    res.status(500).json({
      success: false,
      message: "Error updating costing template items",
      error: error.message,
    });
  }
};

// Create shared costing template for multiple products
exports.createSharedCostingTemplate = async (req, res) => {
  const transaction = await db.sequelize.transaction();

  try {
    const { 
      facilityId, 
      createdBy, 
      costing_type, 
      shared_costing_name, 
      shared_costs, 
      products,
      output_percentage_display,
      units_display
    } = req.body;

    if (!facilityId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    if (!shared_costing_name) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "shared_costing_name is required",
      });
    }

    if (!products || !Array.isArray(products) || products.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "products array is required and must not be empty",
      });
    }

    // Find or create a product group for this shared costing
    let productGroup = await db.ProductGroup.findOne({
      where: {
        facility_id: facilityId,
        name: shared_costing_name,
      },
      transaction,
    });

    if (!productGroup) {
      productGroup = await db.ProductGroup.create({
        facility_id: facilityId,
        name: shared_costing_name,
        description: `Shared costing template group for ${shared_costing_name}`,
      }, { transaction });
    }

    // Build shared costing template notes for the ProductGroup
    let templateNotes = `Shared Costing Template: ${shared_costing_name}\n`;
    templateNotes += `Created: ${new Date().toISOString()}\n`;
    templateNotes += `Created By: ${createdBy}\n\n`;
    
    // Add output percentage if provided
    if (output_percentage_display) {
      templateNotes += `Output Percentage: ${output_percentage_display}%\n\n`;
    }
    
    // Add shared costs
    if (shared_costs && shared_costs.length > 0) {
      templateNotes += "Shared Costs:\n";
      shared_costs.forEach((cost, costIndex) => {
        let costNote = `  ${costIndex + 1}. Type: ${cost.type}, Description: ${cost.description}`;
        
        if (cost.type === "raw_material" || cost.type === "semi_finished") {
          costNote += `, Quantity: ${cost.quantity}`;
          if (cost.raw_material_id) costNote += `, RawMaterialId: ${cost.raw_material_id}`;
          if (cost.raw_material_name) costNote += `, RawMaterialName: ${cost.raw_material_name}`;
          if (cost.raw_material_sku) costNote += `, RawMaterialSku: ${cost.raw_material_sku}`;
        } else {
          if (cost.other_type === "rate" && cost.rate) {
            costNote += `, Rate: ${cost.rate}`;
          } else if (cost.other_type === "percentage" && cost.quantity) {
            costNote += `, Percentage: ${cost.quantity}`;
            if (cost.percentage_basis) costNote += `, PercentageBasis: ${cost.percentage_basis}`;
          }
          if (cost.description_code) costNote += `, DescriptionCode: ${cost.description_code}`;
          if (cost.account_head) costNote += `, AccountHead: ${cost.account_head}`;
          if (cost.other_type) costNote += `, InputType: ${cost.other_type}`;
        }
        
        templateNotes += costNote + "\n";
      });
      templateNotes += "\n";
    }

    // Add products and their specific items
    templateNotes += "Products in this shared costing:\n";
    const createdTemplates = [];
    const errors = [];
    const productIds = [];

    for (let i = 0; i < products.length; i++) {
      const productData = products[i];
      const { finished_good_product_id, items } = productData;

      try {
        // Verify the finished good product exists
        const finishedGoodProduct = await db.Product.findOne({
          where: {
            id: finished_good_product_id,
            facility_id: facilityId,
            item_type: "Finished Good",
          },
          transaction,
        });

        if (!finishedGoodProduct) {
          errors.push({
            product_id: finished_good_product_id,
            error: "Finished Good product not found",
          });
          continue;
        }

        productIds.push(finished_good_product_id);
        templateNotes += `  ${i + 1}. ${finishedGoodProduct.name} (${finishedGoodProduct.sku || finishedGoodProduct.id})`;
        
        // Add units if provided for this product
        if (productData.units) {
          templateNotes += `, Units: ${productData.units}`;
        }
        templateNotes += `\n`;

        // Add product-specific items to group notes
        if (items && items.length > 0) {
          templateNotes += "     Product Specific Items:\n";
          items.forEach((item, itemIndex) => {
            let itemNote = `       ${itemIndex + 1}. Type: ${item.type}, Description: ${item.description}`;
            
            if (item.type === "raw_material" || item.type === "semi_finished") {
              itemNote += `, Quantity: ${item.quantity}`;
              if (item.raw_material_id) itemNote += `, RawMaterialId: ${item.raw_material_id}`;
              if (item.raw_material_name) itemNote += `, RawMaterialName: ${item.raw_material_name}`;
              if (item.raw_material_sku) itemNote += `, RawMaterialSku: ${item.raw_material_sku}`;
            } else {
              if (item.other_type === "rate" && item.rate) {
                itemNote += `, Rate: ${item.rate}`;
              } else if (item.other_type === "percentage" && item.quantity) {
                itemNote += `, Percentage: ${item.quantity}`;
                if (item.percentage_basis) itemNote += `, PercentageBasis: ${item.percentage_basis}`;
              }
              if (item.description_code) itemNote += `, DescriptionCode: ${item.description_code}`;
              if (item.account_head) itemNote += `, AccountHead: ${item.account_head}`;
              if (item.other_type) itemNote += `, InputType: ${item.other_type}`;
            }
            
            templateNotes += itemNote + "\n";
          });
        }
        
        // ============================================================
        // BUILD AND SAVE COSTING TEMPLATE ITEMS TO PRODUCT'S NOTES
        // Only save Product Specific Items (NOT shared costs)
        // Shared costs remain only in ProductGroup notes
        // ============================================================
        if (items && items.length > 0) {
          let productCostingNotes = "Costing Template Items:\n";
          
          // Add only product-specific items to product's costing template
          items.forEach((item, itemIndex) => {
            let itemNote = `Costing Template Item ${itemIndex + 1}: Type: ${item.type}, Description: ${item.description}`;
            
            if (item.type === "raw_material" || item.type === "semi_finished") {
              itemNote += `, Quantity: ${item.quantity || 0}`;
              if (item.raw_material_id) itemNote += `, RawMaterialId: ${item.raw_material_id}`;
              if (item.raw_material_name) itemNote += `, RawMaterialName: ${item.raw_material_name}`;
              if (item.raw_material_sku) itemNote += `, RawMaterialSku: ${item.raw_material_sku}`;
            } else {
              if (item.other_type === "rate" && item.rate) {
                itemNote += `, Rate: ${item.rate}`;
              } else if (item.other_type === "percentage" && item.quantity) {
                itemNote += `, Percentage: ${item.quantity}`;
                if (item.percentage_basis) itemNote += `, PercentageBasis: ${item.percentage_basis}`;
              }
              if (item.description_code) itemNote += `, DescriptionCode: ${item.description_code}`;
              if (item.account_head) itemNote += `, AccountHead: ${item.account_head}`;
              if (item.other_type) itemNote += `, InputType: ${item.other_type}`;
            }
            
            productCostingNotes += itemNote + "\n";
          });
          
          // Save only product-specific items to product's notes field
          finishedGoodProduct.notes = productCostingNotes;
        }
        
        await finishedGoodProduct.save({ transaction });
        templateNotes += "\n";

        createdTemplates.push({
          product_id: finished_good_product_id,
          product_name: finishedGoodProduct.name,
          shared_costing_name: shared_costing_name,
          shared_costs_count: shared_costs ? shared_costs.length : 0,
          product_items_count: items ? items.length : 0,
        });

      } catch (productError) {
        console.error(`Error processing product ${finished_good_product_id}:`, productError);
        errors.push({
          product_id: finished_good_product_id,
          error: productError.message,
        });
      }
    }

    // Update ProductGroup notes with the shared costing template
    productGroup.notes = templateNotes;
    
    // Also store structured data in JSON columns
    productGroup.shared_costs = shared_costs ? shared_costs.map((cost, index) => ({
      index: index + 1,
      type: cost.type,
      description: cost.description,
      quantity: cost.quantity || 0,
      description_code: cost.description_code || null,
      account_head: cost.account_head || null,
      other_type: cost.other_type || null,
      rate: cost.rate || null,
      percentage_basis: cost.percentage_basis || null,
      raw_material_id: cost.raw_material_id || null,
      raw_material_name: cost.raw_material_name || null,
      raw_material_sku: cost.raw_material_sku || null,
    })) : [];
    
    productGroup.output_percentage = output_percentage_display ? parseFloat(output_percentage_display) : null;
    productGroup.costing_type = costing_type || 'shared';
    
    await productGroup.save({ transaction });

    // Assign products to this group
    if (productIds.length > 0) {
      await db.Product.update(
        { group_id: productGroup.id },
        {
          where: {
            id: productIds,
            facility_id: facilityId,
          },
          transaction,
        }
      );
    }

    if (errors.length > 0 && createdTemplates.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Failed to create any shared costing templates",
        errors: errors,
      });
    }

    await transaction.commit();

    res.status(201).json({
      success: true,
      data: {
        product_group_id: productGroup.id,
        shared_costing_name: shared_costing_name,
        created: createdTemplates,
        failed: errors,
        summary: {
          total_products: products.length,
          successful: createdTemplates.length,
          failed: errors.length,
        },
      },
      message: `Shared costing template "${shared_costing_name}" created successfully for ${createdTemplates.length} product(s) and saved to ProductGroup notes`,
    });

  } catch (error) {
    await transaction.rollback();
    console.error("Error creating shared costing template:", error);
    res.status(500).json({
      success: false,
      message: "Error creating shared costing template",
      error: error.message,
    });
  }
};

// Delete costing template
exports.deleteCostingTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const product = await db.Product.findOne({
      where: {
        id: id,
        facility_id: facilityId,
        item_type: "Finished Good",
      },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Costing template not found",
      });
    }

    // Soft delete by setting status to Inactive
    product.status = "Inactive";
    await product.save();

    res.status(200).json({
      success: true,
      message: "Costing template deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting costing template:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting costing template",
      error: error.message,
    });
  }
};
