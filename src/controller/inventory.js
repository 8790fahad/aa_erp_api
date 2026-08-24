const db = require("../models");
const moment = require("moment");
const { v4: uuidv4 } = require("uuid");
const { Op } = require("sequelize");
const { getAndUpdateNumber } = require("../services/numberGen");
const { resolveBranchId, resolveBranchIds, validateBranchIdById } = require("../services/branchResolver");
const { STORE_ENTRY_TYPE } = require("../constants/storeEntryTypes");
async function numberGenerator(
  { query_type = "", facilityId = "" },
  callback = (f) => f,
  error = (f) => f,
) {
  db.sequelize
    .query("CALL nurmber_generator1(:query_type,:facilityId)", {
      replacements: {
        query_type,
        facilityId,
      },
    })
    .then(callback)
    .catch((err) => {
      console.log(err);
      error(err);
    });
}

exports.updateInventoryItemPrice = (req, res) => {
  const {
    po_no,
    item_name,
    unit_price,
    expiring_date,
    new_price,
    balance,
    new_balance,
    query_type = "",
  } = req.body;
  console.log(req.body);

  db.sequelize
    .query(
      "CALL update_inventory(:po_no,:item_name,:old_price,:expiring_date,:new_price,:new_balance)",
      {
        replacements: {
          po_no,
          item_name,
          old_price: unit_price,
          new_price,
          expiring_date,
          query_type,
          new_balance,
          balance,
        },
      },
    )
    .then((results) => res.json({ success: true, results }))
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getSupplierStatment = (req, res) => {
  const { supplierId, facilityId, from, to } = req.query;
  console.error({ valuse: req.query });
  db.sequelize
    .query("call get_supplierr_statement(:supplierId,:from,:to,:facilityId)", {
      replacements: {
        supplierId,
        from,
        to,
        facilityId,
      },
    })
    .then((results) => {
      res.json({ success: true, results });
      console.log(results);
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getItemHistory = (req, res) => {
  const today = moment().format("YYYY-MM-DD");
  const {
    facilityId = "",
    from = today,
    store,
    to = today,
    item_name,
    query_type,
  } = req.query;
  console.log(req.query);
  db.sequelize
    .query(
      "CALL get_item_history(:item_name,:facilityId,:from,:to,:query_type,:store)",
      {
        replacements: {
          item_name,
          facilityId,
          from,
          to,
          query_type,
          store,
        },
      },
    )
    .then((results) => res.json({ success: true, results }))
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

function queryBranch(
  {
    branch_id = "",
    branch_name = "",
    facilityId = "",
    phone = null,
    address = "",
    storeType = "",
    state = "",
    admin = 0,
    admin_name = "",
    created_by = "0",
    query_type = "",
    transaction = null, // Accept transaction parameter
  },
  callback = (f) => f,
  error = (f) => f,
) {
  db.sequelize
    .query(
      `CALL add_new_branch(:branch_id,:branch_name,:facilityId,:phone,:address,:storeType,:state,
    :created_at,:admin,:admin_name,:created_by,:query_type)`,
      {
        replacements: {
          branch_id,
          branch_name,
          facilityId,
          phone: phone === "" ? null : phone,
          address,
          storeType,
          state,
          created_at: moment().format("YYYY-MM-DD HH:mm"),
          admin,
          admin_name,
          created_by,
          query_type,
        },
        transaction, // Pass transaction if provided
      },
    )
    .then((results) => {
      callback(results);
    })
    .catch((err) => {
      error(err);
    });
}

exports.createBranchAPI = queryBranch;

exports.postBranch = (req, res) => {
  console.log(req.body);
  const branch_id = uuidv4();

  queryBranch(
    { ...req.body, branch_id },
    (results) => {
      res.json({ success: true, results });
    },
    (err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    },
  );
};

exports.getBranch = (req, res) => {
  queryBranch(
    req.query,
    (results) => {
      res.json({ success: true, results });
    },
    (err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    },
  );
};

exports.addCategory = (req, res) => {
  const { category = "", store = "" } = req.body;
  const { query_type } = req.params;

  db.sequelize
    .query("CALL category(:query_type, :category, :store)", {
      replacements: {
        query_type,
        category,
        store,
      },
    })
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      res.status(500).json({ err });
      console.log(err);
    });
};

exports.addProductServiceList = (req, res) => {
  const {} = req.body;

  let newCode = `ITM/${moment().format("YY")}/${code}`;
};

exports.getProductCategory = (req, res) => {
  const { store = "" } = req.body;
  const { query_type = "" } = req.query;

  db.sequelize
    .query("CALL category(:query_type, :store)", {
      replacements: {
        query_type,
        store,
      },
    })
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      res.status(500).json({ err });
      console.log(err);
    });
};

exports.getProductList = (req, res) => {
  const { query_type = "", memo_id = "" } = req.query;
  const {
    account_head = 0,
    itemName = "",
    category = "",
    type = "",
    facilityId = "",
    account_description = "",
    available = 0,
    team_id = "",
  } = req.body;

  // Cash account lookup is used by advance-payment drawers.
  // Payment Mode = Cash → only Cash on/in Hand (not equivalents / charges / banks).
  if (String(query_type).toLowerCase() === "cash") {
    return db.sequelize
      .query(
        `
        SELECT
          code AS head,
          description,
          parent_code AS subhead,
          type AS account_type
        FROM account_category
        WHERE
          facility_id = :facilityId
          AND (
            code = '112199'
            OR LOWER(COALESCE(description, '')) LIKE '%cash on hand%'
            OR LOWER(COALESCE(description, '')) LIKE '%cash in hand%'
          )
        ORDER BY
          CASE
            WHEN code = '112199' THEN 0
            WHEN LOWER(description) LIKE '%cash on hand%' THEN 1
            WHEN LOWER(description) LIKE '%cash in hand%' THEN 2
            ELSE 3
          END,
          description ASC
        `,
        {
          replacements: {
            facilityId,
          },
          type: db.sequelize.QueryTypes.SELECT,
        },
      )
      .then((results) => res.json({ success: true, results }))
      .catch((err) => {
        console.error("Cash account lookup error:", err);
        res.status(500).json({
          success: false,
          error: err.message || "Internal Server Error",
        });
      });
  }

  // Administrative account lookup.
  // Avoids the legacy `product_list` stored procedure path, which can trigger
  // collation conflicts in some MySQL 8 environments.
  if (
    String(query_type).toLowerCase() === "select_administrative_expenses"
  ) {
    return db.sequelize
      .query(
        `
        SELECT
          code AS head,
          description,
          parent_code AS subhead,
          type AS account_type
        FROM account_category
        WHERE
          facility_id = :facilityId
        ORDER BY description ASC
        `,
        {
          replacements: {
            facilityId,
          },
          type: db.sequelize.QueryTypes.SELECT,
        }
      )
      .then((results) => res.json({ success: true, results }))
      .catch((err) => {
        console.error("Administrative expense lookup error:", err);
        res.status(500).json({
          success: false,
          error: err.message || "Internal Server Error",
        });
      });
  }

  // Receivable account lookup.
  // Keeps same response shape expected by UI and avoids legacy proc errors.
  if (
    String(query_type).toLowerCase() === "select_recievable" ||
    String(query_type).toLowerCase() === "select_receivable"
  ) {
    return db.sequelize
      .query(
        `
        SELECT
          code AS head,
          description,
          parent_code AS subhead,
          type AS account_type
        FROM account_category
        WHERE
          facility_id = :facilityId
          AND (
            LOWER(COALESCE(type, '')) LIKE '%receivable%'
            OR LOWER(COALESCE(description, '')) LIKE '%receivable%'
            OR LOWER(COALESCE(subcategory, '')) LIKE '%receivable%'
          )
        ORDER BY description ASC
        `,
        {
          replacements: {
            facilityId,
          },
          type: db.sequelize.QueryTypes.SELECT,
        }
      )
      .then((results) => res.json({ success: true, results }))
      .catch((err) => {
        console.error("Receivable account lookup error:", err);
        res.status(500).json({
          success: false,
          error: err.message || "Internal Server Error",
        });
      });
  }

  numberGenerator({ query_type: "itm", facilityId }, (rev) => {
    let code = rev[0].itm;
    let _code = code;
    let newCode = `ITM/${moment().format("YY")}/${code}`;
    db.sequelize
      .query(
        `CALL product_list(:query_type, :facilityId, :itemName, :category, :type, :account_head, :item_code, :account_description, :memo_id)`,
        {
          replacements: {
            query_type,
            facilityId,
            itemName,
            category,
            type,
            account_head,
            item_code: newCode,
            account_description,
            memo_id: team_id || memo_id,
          },
        },
      )
      .then((results) => {
        db.sequelize.query(
          `update number_generator set code_no = ${
            parseInt(code) + 1
          } where prefix='itm'`,
        );
        res.json({ success: true, results });
      })
      .catch((err) => {
        console.error("DB Error:", err);
        res.status(500).json({
          success: false,
          error: err.message || "Internal Server Error",
        });
      });
  });
};
exports.getNewProductList = async (req, res) => {
  try {
    const { query_type = "select", memo_id = "" } = req.query;
    const { facilityId = "" } = req.body;

    // Use Sequelize model instead of raw query
    const { Product } = db;

    if (!Product) {
      return res.status(500).json({
        success: false,
        error: "Product model not available",
      });
    }

    // Build where conditions
    const whereConditions = {
      facility_id: facilityId,
      item_type: { [Op.in]: ["Finished Good"] },
    };
    // Query products using Sequelize model
    const products = await Product.findAll(
      {
        where: whereConditions,
        attributes: [
          "id",
          "name",
          "sku",
          "item_type",
          "category",
          "unit_of_measure",
          "cost_price",
          "selling_price",
          "status",
          "image_url",
          "reorder_level",
          "created_at",
          "updated_at",
        ],
        order: [["name", "ASC"]],
      },
      {
        replacements: {
          facilityId,
        },
      },
    );

    const formattedResults = products.map((product) => ({
      id: product.id,
      item_name: product.name,
      item_code: product.sku,
      chart_code: product.id,
      category: product.category,
      unit_of_measure: product.unit_of_measure,
      cost_price: product.cost_price,
      selling_price: product.selling_price,
      stock_quantity: product.get("available_balance"), // 👈 now correct
      item_type: product.item_type,
      status: product.status,
      image_url: product.image_url,
      sales_description: product.sales_description,
      purchase_description: product.purchase_description,
      reorder_level: product.reorder_level,
      created_at: product.created_at,
      updated_at: product.updated_at,
    }));

    res.json({
      success: true,
      results: formattedResults,
      count: formattedResults.length,
    });
  } catch (err) {
    console.error("getNewProductList Error:", err);
    res.status(500).json({
      success: false,
      error: err.message || "Internal Server Error",
    });
  }
};
exports.getNewProductList3 = async (req, res) => {
  try {
    const { facilityId = "" } = req.body;

    // Use Sequelize model instead of raw query
    const { Product } = db;

    if (!Product) {
      return res.status(500).json({
        success: false,
        error: "Product model not available",
      });
    }
    // Build where conditions
    const whereConditions = {
      facility_id: facilityId,
      item_type: { [Op.in]: ["Raw Material", "Resalable"] },
    };
    // Query products using Sequelize model
    const products = await Product.findAll(
      {
        where: whereConditions,
        attributes: [
          "id",
          "name",
          "sku",
          "item_type",
          "category",
          "unit_of_measure",
          "cost_price",
          "selling_price",
          "status",
          "image_url",
          "reorder_level",
          "created_at",
          "updated_at",
        ],
        order: [["name", "ASC"]],
      },
      {
        replacements: {
          facilityId,
        },
      },
    );

    const formattedResults = products.map((product) => ({
      id: product.id,
      item_name: product.name,
      item_code: product.sku,
      chart_code: product.id,
      category: product.category,
      unit_of_measure: product.unit_of_measure,
      cost_price: product.cost_price,
      selling_price: product.selling_price,
      stock_quantity: product.get("available_balance"), // 👈 now correct
      item_type: product.item_type,
      status: product.status,
      image_url: product.image_url,
      sales_description: product.sales_description,
      purchase_description: product.purchase_description,
      reorder_level: product.reorder_level,
      created_at: product.created_at,
      updated_at: product.updated_at,
    }));

    res.json({
      success: true,
      results: formattedResults,
      count: formattedResults.length,
    });
  } catch (err) {
    console.error("getNewProductList Error:", err);
    res.status(500).json({
      success: false,
      error: err.message || "Internal Server Error",
    });
  }
};
exports.getNewProductList2 = async (req, res) => {
  try {
    const { query_type = "select", memo_id = "" } = req.query;
    const { facilityId = "" } = req.body;

    // Use Sequelize model instead of raw query
    const { Product } = db;

    if (!Product) {
      return res.status(500).json({
        success: false,
        error: "Product model not available",
      });
    }

    // Build where conditions
    const whereConditions = {
      facility_id: facilityId,
      item_type: { [Op.in]: ["Raw Material"] },
    };
    // Query products using Sequelize model
    const products = await Product.findAll(
      {
        where: whereConditions,
        attributes: [
          "id",
          "name",
          "sku",
          "item_type",
          "category",
          "unit_of_measure",
          "cost_price",
          "selling_price",
          "status",
          "image_url",
          "reorder_level",
          "created_at",
          "updated_at",
        ],
        order: [["name", "ASC"]],
      },
      {
        replacements: {
          facilityId,
        },
      },
    );

    const formattedResults = products.map((product) => ({
      id: product.id,
      item_name: product.name,
      item_code: product.sku,
      chart_code: product.id,
      category: product.category,
      unit_of_measure: product.unit_of_measure,
      cost_price: product.cost_price,
      selling_price: product.selling_price,
      stock_quantity: product.get("available_balance"), // 👈 now correct
      item_type: product.item_type,
      status: product.status,
      image_url: product.image_url,
      sales_description: product.sales_description,
      purchase_description: product.purchase_description,
      reorder_level: product.reorder_level,
      created_at: product.created_at,
      updated_at: product.updated_at,
    }));

    res.json({
      success: true,
      results: formattedResults,
      count: formattedResults.length,
    });
  } catch (err) {
    console.error("getNewProductList Error:", err);
    res.status(500).json({
      success: false,
      error: err.message || "Internal Server Error",
    });
  }
};

exports.getProductList1 = (req, res) => {
  const { query_type = "", memo_id = "" } = req.query;
  const {
    account_head = 0,
    itemName = "",
    category = "",
    type = "",
    facilityId = 0,
    account_description = "",
    available = 0,
  } = req.body;

  console.log(req.query, "===================>query");

  db.sequelize
    .query(
      `CALL product_list(:query_type, :facilityId, :itemName, :category, :type, :account_head, :item_code, :account_description, :memo_id)`,
      {
        replacements: {
          query_type,
          facilityId,
          itemName,
          category,
          type,
          account_head,
          item_code: "",
          account_description,
          memo_id,
        },
      },
    )
    .then((results) => {
      console.log("DB Response:", results);
      res.json({ success: true, results });
    })
    .catch((err) => {
      console.error("DB Error:", err);
      res.status(500).json({
        success: false,
        error: err.message || "Internal Server Error",
      });
    });
};

exports.getInventory = (req, res) => {
  const { query_type = "" } = req.query;
  const {
    inv_id = "",
    item_code = "",
    item_name = "",
    cost_price = 0,
    markup = 0,
    sell_price = 0,
    qty_in = 0,
    qty_out = 0,
    source = "",
    destination = "",
    branch_id = "",
    facilityId = "",
  } = req.body;

  numberGenerator({ query_type: "inv", facilityId }, (rev) => {
    let code = rev[0].inv;
    let _code = code;
    let newCode = `INV/${moment().format("YY")}/${code}`;
    db.sequelize
      .query(
        `CALL inventory(:query_type, :inv_id, :item_code, :item_name, :cost_price, :markup, :sell_price, :qty_in, :qty_out, :source, :destination, :branch_id, :facilityId)`,
        {
          replacements: {
            query_type,
            inv_id: newCode,
            item_code,
            item_name,
            cost_price,
            markup,
            sell_price,
            qty_in,
            qty_out,
            source,
            destination,
            branch_id,
            facilityId,
          },
        },
      )
      .then((results) => {
        console.log("DB Response:", results);
        res.json({
          success: true,
          message: "Successfully add item to inventory",
          results,
        });
      })
      .catch((err) => {
        console.error("DB Error:", err);
        res.status(500).json({
          success: false,
          error: err.message || "Internal Server Error",
        });
      });
  });
};

exports.editStoreItem = (req, res) => {
  const {
    facilityId = "",
    item_code = "",
    item_name = "",
    selling_price = 0,
    mark_up = 0,
    status = "for sale",
    reference_number = "",
    markup_mode = "",
  } = req.body;

  const { query_type = "" } = req.params;

  db.sequelize
    .query(
      "CALL edit_store_item(:query_type, :facilityId, :item_code, :item_name, :selling_price, :mark_up, :status, :reference_number, :markup_mode)",
      {
        replacements: {
          query_type,
          facilityId,
          item_code,
          item_name,
          selling_price,
          mark_up,
          status,
          reference_number,
          markup_mode,
        },
      },
    )
    .then(() => {
      res.json({ success: true, message: "Item updated successfully." });
    })
    .catch((err) => {
      res.status(500).json({ success: false, error: err });
      console.error("editStoreItem error:", err);
    });
};

exports.transfer = (req, res) => {
  const {
    facilityId = "",
    transfer_name = "",
    transfer_code = null,
    product_name = "",
    product_code = "",
    quantity = 0,
    transfer_subhead = "",
    product_subhead = "",
    cost_price = 0,
  } = req.body;
  const queries = [];

  numberGenerator({ query_type: "mr", facilityId }, (rev) => {
    let code = rev[0].mr;
    let _code = code;
    let newCode = `REF/${moment().format("YY")}/${code}`;
    let newCode1 = `TRF/${moment().format("YY")}/${code}`;

    //insert finished goods
    queries.push(
      db.sequelize.query(
        `CALL store_entries(
          :query_type,
          :item_name,
          :qty_in,
          :selling_price,
          :transaction_date,
          :item_category,
          :item_code,
          :version_id,
          :facilityId,
          :qty_out,
          :req_no,
          :user_id,
          :cost_price,
          :supplier_code,
          :supplier_name,
          :sales_type,
          :store_name,
          :mark_up,
          :truck_no,
          :waybill_no,
          :reorder_level,
          :inserted_by,
          :branch_name,
          :po_no,
          :expire_date,
          :unit_price,
          :reference_number,
          :subhead,
          :category,
          :unit
          )`,
        {
          replacements: {
            query_type: "insert",
            item_name: transfer_name,
            qty_in: 0,
            selling_price: 0,
            transaction_date: moment().format("YYYY-MM-DD HH:mm"),
            item_category: "",
            item_code: transfer_code,
            version_id: "",
            facilityId,
            qty_out: quantity,
            req_no: newCode,
            user_id: "",
            cost_price: cost_price,
            supplier_code: null,
            supplier_name: null,
            sales_type: "",
            store_name: "",
            mark_up: 0,
            truck_no: null,
            waybill_no: null,
            reorder_level: 0,
            inserted_by: "",
            branch_name: "",
            po_no: newCode1,
            expire_date: null,
            unit_price: 0,
            reference_number: newCode,
            subhead: transfer_subhead,
            category: "",
            unit: "",
          },
        },
      ),
    );
    queries.push(
      db.sequelize.query(
        `CALL store_entries(
            :query_type,
            :item_name,
            :qty_in,
            :selling_price,
            :transaction_date,
            :item_category,
            :item_code,
            :version_id,
            :facilityId,
            :qty_out,
            :req_no,
            :user_id,
            :cost_price,
            :supplier_code,
            :supplier_name,
            :sales_type,
            :store_name,
            :mark_up,
            :truck_no,
            :waybill_no,
            :reorder_level,
            :inserted_by,
            :branch_name,
            :po_no,
            :expire_date,
            :unit_price,
            :reference_number,
            :subhead,
            :category,
            :unit
            )`,
        {
          replacements: {
            query_type: "transfer",
            item_name: product_name,
            qty_in: quantity,
            selling_price: 0,
            transaction_date: moment().format("YYYY-MM-DD HH:mm"),
            item_category: "",
            item_code: product_code,
            version_id: "",
            facilityId,
            qty_out: 0,
            req_no: newCode,
            user_id: "",
            cost_price: cost_price,
            supplier_code: null,
            supplier_name: null,
            sales_type: "",
            store_name: transfer_name,
            mark_up: 0,
            truck_no: null,
            waybill_no: null,
            reorder_level: 0,
            inserted_by: "",
            branch_name: "",
            po_no: newCode1,
            expire_date: null,
            unit_price: cost_price,
            reference_number: newCode,
            subhead: product_subhead,
            category: "",
            unit: "",
          },
        },
      ),
    );
    queries.push(
      db.sequelize.query(
        `update number_generator set code_no = ${
          parseInt(code) + 1
        } where prefix='mr'`,
      ),
    );
    Promise.all(queries)
      .then((results) => {
        res.json({ success: true, results });
      })
      .catch((err) => {
        console.log(err);
        res.status(500).json({ success: false, err });
      });
  });
};

exports.getProductType = (req, res) => {
  db.sequelize
    .query(
      `SELECT description FROM account WHERE subhead IN ( SELECT head FROM account WHERE account_type LIKE '%revenue%')`,
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getUnitCategory = (req, res) => {
  const { facilityId } = req.query;
  db.sequelize
    .query(
      `SELECT category, id, unit FROM unit_of_measurement WHERE facilityId = :facilityId`,
      {
        replacements: {
          facilityId,
        },
        type: db.sequelize.QueryTypes.SELECT,
      },
    )
    .then((results) => {
      const categorieMap = new Map();
      results.forEach((item) => {
        if (!categorieMap.has(item.category)) {
          categorieMap.set(item.category, {
            category: item.category,
            units: [item.unit],
          });
        } else {
          categorieMap.get(item.category).units.push(item.unit);
        }
      });

      const formattedResults = Array.from(categorieMap.values());

      const uniqueCategories = Array.from(
        new Set(results.map((item) => item.category)),
      );

      res.json({ success: true, results: formattedResults, uniqueCategories });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getAllMeasure = (req, res) => {
  const { facilityId = "" } = req.params;
  db.sequelize
    .query(
      "SELECT id, category, unit, status FROM unit_of_measurement WHERE facilityId = :facilityId AND status = 'active'",
      {
        replacements: { facilityId },
        type: db.sequelize.QueryTypes.SELECT,
      },
    )
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      console.error("getAllMeasure error:", err);
      res.status(500).json({ success: false, error: err.message || err });
    });
};

exports.manageUnitOfMeasure = async (req, res) => {
  const { facilityId = "", items = [], query_type = "" } = req.body;

  if (
    !facilityId ||
    !Array.isArray(items) ||
    items.length === 0 ||
    !query_type
  ) {
    return res.status(400).json({
      success: false,
      message: "Missing or invalid facilityId, query_type, or items array.",
    });
  }

  try {
    for (const item of items) {
      const { id = null, category = "", unit = "" } = item;

      await db.sequelize.query(
        "CALL unit_of_measurement(:query_type, :id, :facilityId, :category, :unit)",
        {
          replacements: {
            query_type,
            id,
            facilityId,
            category,
            unit,
          },
        },
      );
    }

    return res.json({
      success: true,
      message: `Store item details processed with query_type: ${query_type}`,
    });
  } catch (err) {
    console.error("manageUnitOfMeasure error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || err,
    });
  }
};

exports.deleteUnitOfMeasure = (req, res) => {
  const { facilityId = "", category = "", unit = "" } = req.body;
  const { id = "" } = req.query;
  const { query_type = "" } = req.params;

  db.sequelize
    .query(
      "CALL unit_of_measurement(:query_type, :id, :facilityId, :category, :unit)",
      {
        replacements: {
          query_type,
          id,
          facilityId,
          category,
          unit,
        },
      },
    )
    .then((results) => {
      res.json({
        success: true,
        message: "Unit of measure successfully deleted.",
      });
    })
    .catch((err) => {
      res.status(500).json({ err });
      console.log(err);
    });
};

exports.getItems = (req, res) => {
  db.product
    .findAll()
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      console.error("getItems error:", err);
      res.status(500).json({ success: false, error: err.message || err });
    });
};
// ==================== SUPPLIERS INFO CRUD OPERATIONS ====================

// Get all suppliers for a facility
exports.getSuppliersInfo = async (req, res) => {
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
        { supplier_name: { [db.Sequelize.Op.like]: `%${search}%` } },
        { supplier_number: { [db.Sequelize.Op.like]: `%${search}%` } },
        { email: { [db.Sequelize.Op.like]: `%${search}%` } },
        { phone: { [db.Sequelize.Op.like]: `%${search}%` } },
      ];
    }

    const suppliers = await db.SuppliersInfo.findAll({
      where: whereClause,
      order: [["supplier_name", "ASC"]],
    });

    res.json({
      success: true,
      results: suppliers,
      count: suppliers.length,
    });
  } catch (error) {
    console.error("Error fetching suppliers:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching suppliers",
      error: error.message,
    });
  }
};

// Get single supplier by ID
exports.getSupplierInfo = async (req, res) => {
  try {
    const { facilityId, supplier_number } = req.params;

    if (!facilityId || !supplier_number) {
      return res.status(400).json({
        success: false,
        message: "Facility ID and Supplier Number are required",
      });
    }

    const supplier = await db.SuppliersInfo.findOne({
      where: {
        facilityId,
        supplier_number,
      },
    });

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: "Supplier not found",
      });
    }

    res.json({
      success: true,
      result: supplier,
    });
  } catch (error) {
    console.error("Error fetching supplier:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching supplier",
      error: error.message,
    });
  }
};

// Create new supplier
exports.createSupplierInfo = async (req, res) => {
  try {
    const {
      facilityId,
      supplier_name,
      address,
      phone,
      supplier_code,
      supplier_subhead,
      status = "active",
      email,
    } = req.body;

    // Validate required fields
    if (!facilityId || !supplier_name || !supplier_code || !supplier_subhead) {
      return res.status(400).json({
        success: false,
        message:
          "Facility ID, supplier name, supplier code, and supplier subhead are required",
      });
    }

    // Generate supplier number
    const supplier_number = await generateSupplierNumber(facilityId);

    // Check if supplier with same name already exists in facility
    const existingSupplier = await db.SuppliersInfo.findOne({
      where: {
        facilityId,
        supplier_name,
      },
    });

    if (existingSupplier) {
      return res.status(400).json({
        success: false,
        message: "Supplier with this name already exists in this facility",
      });
    }

    const supplier = await db.SuppliersInfo.create({
      facilityId,
      supplier_number,
      supplier_name,
      address,
      phone,
      supplier_code,
      supplier_subhead,
      status,
      email,
      date: new Date(),
    });

    res.status(201).json({
      success: true,
      message: "Supplier created successfully",
      result: supplier,
    });
  } catch (error) {
    console.error("Error creating supplier:", error);
    res.status(500).json({
      success: false,
      message: "Error creating supplier",
      error: error.message,
    });
  }
};

// Update supplier
exports.updateSupplierInfo = async (req, res) => {
  try {
    const { facilityId, supplier_number } = req.params;
    const updateData = req.body;

    if (!facilityId || !supplier_number) {
      return res.status(400).json({
        success: false,
        message: "Facility ID and Supplier Number are required",
      });
    }

    // Remove fields that shouldn't be updated
    delete updateData.facilityId;
    delete updateData.supplier_number;
    delete updateData.date;

    const [updatedRowsCount] = await db.SuppliersInfo.update(updateData, {
      where: {
        facilityId,
        supplier_number,
      },
    });

    if (updatedRowsCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Supplier not found",
      });
    }

    // Fetch updated supplier
    const updatedSupplier = await db.SuppliersInfo.findOne({
      where: {
        facilityId,
        supplier_number,
      },
    });

    res.json({
      success: true,
      message: "Supplier updated successfully",
      result: updatedSupplier,
    });
  } catch (error) {
    console.error("Error updating supplier:", error);
    res.status(500).json({
      success: false,
      message: "Error updating supplier",
      error: error.message,
    });
  }
};

// Delete supplier (soft delete by changing status)
exports.deleteSupplierInfo = async (req, res) => {
  try {
    const { facilityId, supplier_number } = req.params;

    if (!facilityId || !supplier_number) {
      return res.status(400).json({
        success: false,
        message: "Facility ID and Supplier Number are required",
      });
    }

    const [updatedRowsCount] = await db.SuppliersInfo.update(
      { status: "inactive" },
      {
        where: {
          facilityId,
          supplier_number,
        },
      },
    );

    if (updatedRowsCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Supplier not found",
      });
    }

    res.json({
      success: true,
      message: "Supplier deactivated successfully",
    });
  } catch (error) {
    console.error("Error deleting supplier:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting supplier",
      error: error.message,
    });
  }
};

// Helper function to generate supplier number
async function generateSupplierNumber(facilityId) {
  try {
    const lastSupplier = await db.SuppliersInfo.findOne({
      where: { facilityId },
      order: [["supplier_number", "DESC"]],
    });

    if (!lastSupplier) {
      return "SUP001";
    }

    const lastNumber = parseInt(
      lastSupplier.supplier_number.replace("SUP", ""),
    );
    const nextNumber = lastNumber + 1;
    return `SUP${nextNumber.toString().padStart(3, "0")}`;
  } catch (error) {
    console.error("Error generating supplier number:", error);
    return `SUP${Date.now().toString().slice(-3)}`;
  }
}

// ==================== SUPPLIER ACCOUNT INFORMATION CRUD OPERATIONS ====================

// Get all supplier accounts for a facility
exports.getSupplierAccounts = async (req, res) => {
  try {
    const { facilityId, supplier_number, status, search } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
      });
    }

    let whereClause = { facilityId };

    // Add supplier filter if provided
    if (supplier_number) {
      whereClause.supplier_number = supplier_number;
    }

    // Add status filter if provided
    if (status && status !== "all") {
      whereClause.status = status;
    }

    // Add search filter if provided
    if (search) {
      whereClause[db.Sequelize.Op.or] = [
        { account_name: { [db.Sequelize.Op.like]: `%${search}%` } },
        { account_number: { [db.Sequelize.Op.like]: `%${search}%` } },
        { bank_name: { [db.Sequelize.Op.like]: `%${search}%` } },
      ];
    }

    const accounts = await db.SupplierAccountInformation.findAll({
      where: whereClause,
      order: [["account_name", "ASC"]],
    });

    res.json({
      success: true,
      results: accounts,
      count: accounts.length,
    });
  } catch (error) {
    console.error("Error fetching supplier accounts:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching supplier accounts",
      error: error.message,
    });
  }
};

// Get single supplier account by ID
exports.getSupplierAccount = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Account ID is required",
      });
    }

    const account = await db.SupplierAccountInformation.findByPk(id);

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Supplier account not found",
      });
    }

    res.json({
      success: true,
      result: account,
    });
  } catch (error) {
    console.error("Error fetching supplier account:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching supplier account",
      error: error.message,
    });
  }
};

// Create new supplier account
exports.createSupplierAccount = async (req, res) => {
  try {
    const {
      facilityId,
      supplier_number,
      account_name,
      account_number,
      bank_name,
      sort_code,
      bank_code,
      code,
      status = "active",
    } = req.body;

    // Validate required fields
    if (
      !facilityId ||
      !account_name ||
      !account_number ||
      !bank_name ||
      !bank_code ||
      !code
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Facility ID, account name, account number, bank name, bank code, and code are required",
      });
    }

    // Check if account number already exists in facility
    const existingAccount = await db.SuppliersInfo.findOne({
      where: {
        facilityId,
        account_number,
        status: { [db.Sequelize.Op.ne]: "deleted" },
      },
    });

    if (existingAccount) {
      return res.status(400).json({
        success: false,
        message: "Account number already exists in this facility",
      });
    }

    const account = await db.SupplierAccountInformation.create({
      facilityId,
      supplier_number,
      account_name,
      account_number,
      bank_name,
      sort_code,
      bank_code,
      code,
      status,
    });

    res.status(201).json({
      success: true,
      message: "Supplier account created successfully",
      result: account,
    });
  } catch (error) {
    console.error("Error creating supplier account:", error);
    res.status(500).json({
      success: false,
      message: "Error creating supplier account",
      error: error.message,
    });
  }
};

// Update supplier account
exports.updateSupplierAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Account ID is required",
      });
    }

    // Remove fields that shouldn't be updated
    delete updateData.id;
    delete updateData.created_at;

    const [updatedRowsCount] = await db.SupplierAccountInformation.update(
      updateData,
      {
        where: { id },
      },
    );

    if (updatedRowsCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Supplier account not found",
      });
    }

    // Fetch updated account
    const updatedAccount = await db.SupplierAccountInformation.findByPk(id);

    res.json({
      success: true,
      message: "Supplier account updated successfully",
      result: updatedAccount,
    });
  } catch (error) {
    console.error("Error updating supplier account:", error);
    res.status(500).json({
      success: false,
      message: "Error updating supplier account",
      error: error.message,
    });
  }
};

// Delete supplier account (soft delete by changing status)
exports.deleteSupplierAccount = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Account ID is required",
      });
    }

    const [updatedRowsCount] = await db.SupplierAccountInformation.update(
      { status: "deleted" },
      { where: { id } },
    );

    if (updatedRowsCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Supplier account not found",
      });
    }

    res.json({
      success: true,
      message: "Supplier account deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting supplier account:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting supplier account",
      error: error.message,
    });
  }
};

// ==================== SUPPLIER ENTRIES CRUD OPERATIONS ====================

// Get all supplier entries for a facility
// Get supplier entries by receiptNo
exports.getSupplierEntriesByReceiptNo = async (req, res) => {
  try {
    const { facilityId, receiptNo } = req.query;

    // Validate required parameters
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
      });
    }

    if (!receiptNo) {
      return res.status(400).json({
        success: false,
        message: "Receipt number is required",
      });
    }

    // Build where clause
    const whereClause = {
      facilityId: facilityId,
      receiptNo: receiptNo,
    };

    // Fetch supplier entries from database
    // Model name is SupplierEntry (singular) as defined in supplier_entries.js
    const entries = await db.SupplierEntry.findAll({
      where: whereClause,
      order: [["created_at", "DESC"]],
      raw: true,
    });

    return res.json({
      success: true,
      results: entries,
      count: entries.length,
      receiptNo: receiptNo,
      facilityId: facilityId,
    });
  } catch (error) {
    console.error("Error fetching supplier entries by receiptNo:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching supplier entries",
      error: error.message,
    });
  }
};

exports.getSupplierEntries = async (req, res) => {
  try {
    const {
      facilityId,
      supplier_number,
      from_date,
      to_date,
      search,
      receiptNo,
    } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
      });
    }

    let whereClause = { facilityId };

    // Add supplier filter if provided
    if (supplier_number) {
      whereClause.supplier_number = supplier_number;
    }

    // Add receiptNo filter if provided
    if (receiptNo) {
      whereClause.receiptNo = receiptNo;
    }

    // Add date range filter if provided
    if (from_date && to_date) {
      whereClause.created_at = {
        [db.Sequelize.Op.between]: [new Date(from_date), new Date(to_date)],
      };
    } else if (from_date) {
      whereClause.created_at = {
        [db.Sequelize.Op.gte]: new Date(from_date),
      };
    } else if (to_date) {
      whereClause.created_at = {
        [db.Sequelize.Op.lte]: new Date(to_date),
      };
    }

    // Add search filter if provided
    if (search) {
      whereClause[db.Sequelize.Op.or] = [
        { description: { [db.Sequelize.Op.like]: `%${search}%` } },
        { reference_no: { [db.Sequelize.Op.like]: `%${search}%` } },
      ];
    }

    const entries = await db.SupplierEntries.findAll({
      where: whereClause,
      order: [["created_at", "DESC"]],
    });

    res.json({
      success: true,
      results: entries,
      count: entries.length,
    });
  } catch (error) {
    console.error("Error fetching supplier entries:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching supplier entries",
      error: error.message,
    });
  }
};

// Get single supplier entry by ID
exports.getSupplierEntry = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Entry ID is required",
      });
    }

    const entry = await db.SupplierEntries.findByPk(id);

    if (!entry) {
      return res.status(404).json({
        success: false,
        message: "Supplier entry not found",
      });
    }

    res.json({
      success: true,
      result: entry,
    });
  } catch (error) {
    console.error("Error fetching supplier entry:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching supplier entry",
      error: error.message,
    });
  }
};

// Create new supplier entry
exports.createSupplierEntry = async (req, res) => {
  try {
    const {
      facilityId,
      supplier_code,
      supplier_number,
      reference_no,
      description,
      price,
      qty,
    } = req.body;

    // Validate required fields
    if (!facilityId || !price || !qty) {
      return res.status(400).json({
        success: false,
        message: "Facility ID, price, and quantity are required",
      });
    }

    const entry = await db.SupplierEntries.create({
      facilityId,
      supplier_code,
      supplier_number,
      reference_no,
      description,
      price,
      qty,
      created_at: new Date(),
    });

    res.status(201).json({
      success: true,
      message: "Supplier entry created successfully",
      result: entry,
    });
  } catch (error) {
    console.error("Error creating supplier entry:", error);
    res.status(500).json({
      success: false,
      message: "Error creating supplier entry",
      error: error.message,
    });
  }
};

// Update supplier entry
exports.updateSupplierEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Entry ID is required",
      });
    }

    // Remove fields that shouldn't be updated
    delete updateData.entry_id;
    delete updateData.created_at;

    const [updatedRowsCount] = await db.SupplierEntries.update(updateData, {
      where: { entry_id: id },
    });

    if (updatedRowsCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Supplier entry not found",
      });
    }

    // Fetch updated entry
    const updatedEntry = await db.SupplierEntries.findByPk(id);

    res.json({
      success: true,
      message: "Supplier entry updated successfully",
      result: updatedEntry,
    });
  } catch (error) {
    console.error("Error updating supplier entry:", error);
    res.status(500).json({
      success: false,
      message: "Error updating supplier entry",
      error: error.message,
    });
  }
};

// Delete supplier entry
exports.deleteSupplierEntry = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Entry ID is required",
      });
    }

    const deletedRowsCount = await db.SupplierEntries.destroy({
      where: { entry_id: id },
    });

    if (deletedRowsCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Supplier entry not found",
      });
    }

    res.json({
      success: true,
      message: "Supplier entry deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting supplier entry:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting supplier entry",
      error: error.message,
    });
  }
};

/** Weighted average cost_price from store entry rows (inbound or outbound qty > 0). */
const averagePositiveCostFromStoreRows = (rows, direction = "in") => {
  let totalQty = 0;
  let totalCost = 0;
  for (const row of rows || []) {
    const qty =
      direction === "out"
        ? parseFloat(row.qty_out) || 0
        : parseFloat(row.qty_in) || 0;
    const costPrice = parseFloat(row.cost_price) || 0;
    if (qty > 0 && costPrice > 0) {
      totalQty += qty;
      totalCost += qty * costPrice;
    }
  }
  return totalQty > 0 ? totalCost / totalQty : 0;
};

/** Most recent non-zero cost_price on the product's store ledger. */
const lastPositiveCostFromStoreRows = (rows) => {
  for (let i = (rows || []).length - 1; i >= 0; i -= 1) {
    const costPrice = parseFloat(rows[i].cost_price) || 0;
    if (costPrice > 0) return costPrice;
  }
  return 0;
};

const queryPositiveStoreCostAverage = async (
  product_id,
  facilityId,
  queryOpts,
  { qtyField = "qty_in", branchName = null } = {},
) => {
  const branchClause = branchName
    ? "AND branch_name = :branchName"
    : "";
  const [row] = await db.sequelize.query(
    `SELECT
       SUM(${qtyField} * cost_price) / NULLIF(SUM(CASE WHEN ${qtyField} > 0 AND cost_price > 0 THEN ${qtyField} ELSE 0 END), 0)
         AS avg_cost
     FROM store_entries
     WHERE product_id = :product_id
       AND facilityId = :facilityId
       AND cost_price > 0
       ${branchClause}`,
    {
      ...queryOpts,
      replacements: {
        ...queryOpts.replacements,
        ...(branchName ? { branchName } : {}),
      },
    },
  );
  return parseFloat(row?.avg_cost || 0) || 0;
};

/**
 * Resolve unit cost for inventory/WIP using business valuation settings.
 * Never returns 0 when store_entries or product master has a positive cost.
 */
exports.resolveInventoryUnitCost = async (
  product_id,
  facilityId,
  options = {},
) => {
  const {
    transaction = null,
    useDefaultCost = false,
    methodKey = "WAC",
  } = options;

  if (!product_id || !facilityId) return 0;

  const product = await db.Product.findOne({
    where: { sku: product_id, facility_id: facilityId },
    attributes: ["cost_price"],
    ...(transaction ? { transaction } : {}),
  });

  const defaultCost = parseFloat(product?.cost_price || 0) || 0;

  if (useDefaultCost) {
    return defaultCost;
  }

  const queryOpts = {
    replacements: { product_id, facilityId: String(facilityId) },
    type: db.sequelize.QueryTypes.SELECT,
    ...(transaction ? { transaction } : {}),
  };

  const { calculatedCostPrice } = await exports.getCurrentUnitCost(
    product_id,
    facilityId,
    methodKey,
  );
  let unitCost = calculatedCostPrice || 0;

  if (unitCost <= 0) {
    unitCost = await queryPositiveStoreCostAverage(
      product_id,
      facilityId,
      queryOpts,
      { qtyField: "qty_in" },
    );
  }

  if (unitCost <= 0) {
    unitCost = await queryPositiveStoreCostAverage(
      product_id,
      facilityId,
      queryOpts,
      { qtyField: "qty_out" },
    );
  }

  if (unitCost <= 0) {
    unitCost = await queryPositiveStoreCostAverage(
      product_id,
      facilityId,
      queryOpts,
      { qtyField: "qty_in", branchName: "Work in Progress" },
    );
  }

  if (unitCost <= 0 && defaultCost > 0) {
    unitCost = defaultCost;
  }

  if (unitCost <= 0) {
    const [lastRow] = await db.sequelize.query(
      `SELECT cost_price
       FROM store_entries
       WHERE product_id = :product_id
         AND facilityId = :facilityId
         AND cost_price > 0
       ORDER BY receive_date DESC, id DESC
       LIMIT 1`,
      queryOpts,
    );
    unitCost = parseFloat(lastRow?.cost_price || 0) || 0;
  }

  return Number(unitCost.toFixed(2));
};

exports.getWipInventory = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res
        .status(400)
        .json({ success: false, message: "facilityId is required" });
    }

    // 1. Get valuation method and default_valuation_source from business settings
    const business = await db.business.findOne({
      where: { id: facilityId },
      attributes: ["inv_ev_m", "default_valuation_source"],
      raw: true,
    });

    const useDefaultCost =
      business?.default_valuation_source !== "system_valuation";
    const valuationMethod = business?.inv_ev_m || "Weighted Average Cost";
    const methodKey =
      valuationMethod === "Weighted Average Cost" ? "WAC" : valuationMethod; // "FIFO", "LIFO", "WAC"

    // 2. Live WIP balances from store_entries (not the wip_inventory view —
    // that view can lag or under-report, which blocks production with false
    // "Out of WIP Stock" / Avail: 0.0000).
    // Aggregate per SKU so production matching sees one balance per material.
    const wipItems = await db.sequelize.query(
      `
      SELECT
        SUM(COALESCE(se.qty_in, 0) - COALESCE(se.qty_out, 0)) AS qty,
        SUM(COALESCE(se.qty_in, 0) - COALESCE(se.qty_out, 0)) AS available_quantity,
        SUM(COALESCE(se.qty_in, 0) - COALESCE(se.qty_out, 0)) AS stock_quantity,
        SUM(COALESCE(se.qty_in, 0) - COALESCE(se.qty_out, 0)) AS quantity,
        SUM(COALESCE(se.qty_in, 0) - COALESCE(se.qty_out, 0)) AS balance,
        'Work in Progress' AS branch_name,
        MAX(COALESCE(p.status, 'Active')) AS status,
        se.facilityId,
        p.sku AS product_id,
        p.sku AS sku,
        p.sku AS item_code,
        p.name AS name,
        p.name AS item_name,
        p.unit_of_measure AS unit_of_measure,
        COALESCE(p.cost_price, 0) AS cost_price,
        NULL AS expiry_date
      FROM store_entries se
      INNER JOIN products p
        ON p.sku = se.product_id
        AND p.facility_id = se.facilityId
      WHERE se.facilityId = :facilityId
        AND se.branch_name = 'Work in Progress'
        AND (se.expiry_date IS NULL OR se.expiry_date >= CURDATE())
        AND COALESCE(p.status, 'Active') = 'Active'
      GROUP BY
        se.facilityId,
        p.sku,
        p.name,
        p.unit_of_measure,
        p.cost_price
      HAVING SUM(COALESCE(se.qty_in, 0) - COALESCE(se.qty_out, 0)) > 0
      ORDER BY p.name ASC
      `,
      {
        replacements: { facilityId },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );

    if (wipItems.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          wipItems: [],
          summary: {
            totalWipItems: 0,
            totalWipValue: 0,
          },
        },
      });
    }

    // 3. Calculate cost for EACH item: use default_cost (product cost_price) or system valuation
    const enrichedWipItems = await Promise.all(
      wipItems.map(async (item) => {
        const unitCost = await exports.resolveInventoryUnitCost(
          item.sku,
          facilityId,
          { useDefaultCost, methodKey },
        );

        const qty = parseFloat(item.qty || item.balance || 0) || 0;
        return {
          ...item,
          qty,
          balance: qty,
          quantity: qty,
          available_quantity: qty,
          stock_quantity: qty,
          unit_cost: unitCost,
          valuation_method: useDefaultCost ? "default_cost" : methodKey,
        };
      }),
    );

    return res.status(200).json({
      success: true,
      data: {
        wipItems: enrichedWipItems,
        summary: {
          totalWipItems: enrichedWipItems.length,
          totalWipValue: enrichedWipItems.reduce(
            (sum, i) =>
              sum +
              (parseFloat(i.qty || 0) || 0) * (parseFloat(i.unit_cost || 0) || 0),
            0,
          ),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching WIP inventory:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch WIP inventory",
      error: error.message,
    });
  }
};

// Check WIP inventory availability for production
exports.checkWipInventoryAvailability = async (req, res) => {
  try {
    const { facilityId, productIds } = req.body;

    if (!facilityId) {
      return res
        .status(400)
        .json({ success: false, message: "facilityId is required" });
    }

    // Use the exact SQL query as specified
    let query = `
      SELECT
          qty,
          qty as available_quantity,
          qty as stock_quantity,
          qty as quantity,
          qty as balance,
        branch_name,
        status,
        facilityId,
        product_id,
        product_id AS sku,
        product_id AS item_code,
        name,
        name as item_name,
        unit_of_measure,
        expiry_date,
      FROM wip_inventory
      WHERE 1
    `;

    const replacements = {};

    if (facilityId) {
      query += ` AND facilityId = :facilityId`;
      replacements.facilityId = facilityId;
    }

    if (productIds && Array.isArray(productIds) && productIds.length > 0) {
      query += ` AND product_id IN (:productIds)`;
      replacements.productIds = productIds;
    }

    const wipItems = await db.sequelize.query(query, {
      replacements,
      type: db.sequelize.QueryTypes.SELECT,
    });

    return res.status(200).json({
      success: true,
      data: wipItems,
    });
  } catch (error) {
    console.error("Error checking WIP inventory availability:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to check WIP inventory availability",
      error: error.message,
    });
  }
};

// Execute WIP row actions from the WIP inventory screen.
// Supported actions:
// - return_raw_material: material still usable, move from WIP back to raw material store
// - write_off: material unusable/scrapped, remove from WIP as loss
// Accounting:
//   return_raw_material → DR product.inventory_account (Raw Material)  |  CR account_head_code (WIP)
//   write_off           → DR account_head_code (Expense/Loss)          |  CR product.inventory_account (WIP)
exports.executeWipAction = async (req, res) => {
  const transaction = await db.sequelize.transaction();

  try {
    const {
      facilityId,
      product_id,
      action,
      quantity,
      notes = "",
      account_head_code = null,  // WIP account for return | Expense/loss account for write-off
      account_head_name = null,
      inserted_by = "",
    } = req.body || {};

    // ── Validation ──────────────────────────────────────────────────────────
    if (!facilityId || !product_id || !action || !quantity) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId, product_id, action and quantity are required fields",
      });
    }

    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: "quantity must be greater than zero" });
    }

    if (action !== "return_raw_material" && action !== "write_off") {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Unsupported action. Use return_raw_material or write_off",
      });
    }

    if (!String(account_head_code || "").trim()) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "account_head_code is required",
      });
    }

    // ── Check WIP availability ───────────────────────────────────────────────
    const [wipRow] = await db.sequelize.query(
      `SELECT SUM(qty) AS qty
       FROM wip_inventory
       WHERE facilityId = :facilityId AND product_id = :product_id`,
      { replacements: { facilityId, product_id }, type: db.sequelize.QueryTypes.SELECT, transaction },
    );

    if (!wipRow || Number(wipRow.qty || 0) <= 0) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: "WIP item not found" });
    }

    const availableQty = Number(wipRow.qty || 0);
    if (qty > availableQty) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Insufficient WIP quantity. Available: ${availableQty}`,
      });
    }

    // ── Product & Business info ──────────────────────────────────────────────
    const product = await db.Product.findOne({
      where: { sku: product_id, facility_id: facilityId },
      attributes: ["name", "sku", "item_type", "inventory_account", "cost_price"],
      transaction,
    });

    const business = await db.business.findOne({
      where: { id: facilityId },
      attributes: ["business_name", "inv_ev_m", "default_valuation_source", "wip", "scrap_inventory_account"],
      raw: true,
    });

    const branchName = business?.business_name || "Main Store";

    // ── Valuation: compute server-side unit cost ─────────────────────────────
    // Chain: business valuation method → WIP avg cost → product.cost_price → 0
    const useDefaultCost =
      business?.default_valuation_source !== "system_valuation";
    let unitCost = 0;

    if (useDefaultCost) {
      unitCost = parseFloat(product?.cost_price || 0) || 0;
    } else {
      const valuationMethod = business?.inv_ev_m || "Weighted Average Cost";
      const methodKey = valuationMethod === "Weighted Average Cost" ? "WAC" : valuationMethod;
      const { calculatedCostPrice } = await exports.getCurrentUnitCost(product_id, facilityId, methodKey);
      unitCost = calculatedCostPrice || 0;
    }

    // Fallback 1: weighted avg cost of WIP store_entries for this product
    if (unitCost === 0) {
      const [wipCostRow] = await db.sequelize.query(
        `SELECT
           SUM(qty_in * cost_price) / NULLIF(SUM(CASE WHEN qty_in > 0 AND cost_price > 0 THEN qty_in ELSE 0 END), 0)
             AS wip_avg_cost
         FROM store_entries
         WHERE product_id = :product_id
           AND facilityId = :facilityId
           AND branch_name = 'Work in Progress'
           AND cost_price > 0`,
        { replacements: { product_id, facilityId }, type: db.sequelize.QueryTypes.SELECT, transaction },
      );
      unitCost = parseFloat(wipCostRow?.wip_avg_cost || 0) || 0;
    }

    // Fallback 2: product's recorded cost_price
    if (unitCost === 0) {
      unitCost = parseFloat(product?.cost_price || 0) || 0;
    }

    // Fallback 3: avg cost from ALL store_entries (no branch filter) that have cost > 0
    if (unitCost === 0) {
      const [anyCostRow] = await db.sequelize.query(
        `SELECT SUM(qty_in * cost_price) / NULLIF(SUM(CASE WHEN qty_in > 0 AND cost_price > 0 THEN qty_in ELSE 0 END), 0)
           AS avg_cost
         FROM store_entries
         WHERE product_id = :product_id
           AND facilityId = :facilityId
           AND cost_price > 0`,
        { replacements: { product_id, facilityId }, type: db.sequelize.QueryTypes.SELECT, transaction },
      );
      unitCost = parseFloat(anyCostRow?.avg_cost || 0) || 0;
    }

    const totalCost = Number((qty * unitCost).toFixed(2));

    // ── Reference number & common values ────────────────────────────────────
    const receiveDate = moment().format("YYYY-MM-DD");
    const today = receiveDate;
    const sequenceNo = await getAndUpdateNumber("wipa", facilityId);
    const refBase = `WIPA/${moment().format("YY")}/${String(sequenceNo).padStart(4, "0")}`;
    const narration = `WIP ${action === "write_off" ? "Write-off (Scrap/Loss)" : "Return to Raw Material"} — ${product?.name || product_id} | Ref: ${refBase}`;
    const writeOffDestination =
      action === "write_off"
        ? `Scrap/Loss${account_head_name ? ` (${String(account_head_name).trim()})` : ""}`
        : branchName;

    // Helper: look up account_category row by code
    const lookupAcct = async (code) => {
      if (!code) return {};
      const [row] = await db.sequelize.query(
        `SELECT code, parent_code, description FROM account_category
         WHERE code = :code AND facility_id = :facilityId LIMIT 1`,
        { replacements: { code: String(code), facilityId }, type: db.sequelize.QueryTypes.SELECT, transaction },
      );
      return row || {};
    };

    // Resolve GL account codes:
    //   write_off        → DR: account_head_code (expense/loss, user selects)
    //                       CR: business.wip (WIP inventory account)
    //   return_raw_mat   → DR: product.inventory_account (raw material account)
    //                       CR: account_head_code (WIP account, user selects)
    const wipBusinessCode   = business?.wip || null;
    const rawMaterialAcctCode = product?.inventory_account || null;

    const expenseAcctRow    = await lookupAcct(account_head_code);       // user-selected account
    const wipBusinessAcctRow = await lookupAcct(wipBusinessCode);         // business WIP account
    const rawMatAcctRow     = await lookupAcct(rawMaterialAcctCode);      // product inventory account

    // ── STEP 1: WIP Action History ───────────────────────────────────────────
    await db.WipActionHistory.create(
      {
        facility_id: String(facilityId),
        reference_number: refBase,
        product_id,
        product_name: product?.name || null,
        action_type: action,
        quantity: qty,
        unit_cost: unitCost,
        total_cost: totalCost,
        source_location: "Work in Progress",
        destination_location: action === "write_off" ? writeOffDestination : "Raw Material",
        notes: notes || null,
        created_by: inserted_by || null,
      },
      { transaction },
    );

    // ── STEP 2: Store Entries ────────────────────────────────────────────────
    // Leg 1: OUT of Work in Progress
    await db.StoreEntry.create(
      {
        product_id,
        facilityId,
        qty_in: 0,
        qty_out: qty,
        cost_price: unitCost,
        selling_price: 0,
        mark_up: 0,
        markup_mode: "percentage",
        branch_name: "Work in Progress",
        source: "Work in Progress",
        destination: action === "write_off" ? writeOffDestination : "Raw Material",
        status: "Active",
        type:
          action === "write_off"
            ? STORE_ENTRY_TYPE.ADJUSTMENT
            : STORE_ENTRY_TYPE.PRODUCTION,
        receive_date: receiveDate,
        reference_number: refBase,
        inserted_by: inserted_by || null,
        location: "Warehouse",
        expiry_date: null,
        truckNo: "",
        waybillNo: "",
        supplier_code: notes ? String(notes).slice(0, 140) : "",
        batch_id: null,
        multiplier_id: null,
        multple: "1",
      },
      { transaction },
    );

    // Leg 2: IN to Raw Material (return only)
    if (action === "return_raw_material") {
      await db.StoreEntry.create(
        {
          product_id,
          facilityId,
          qty_in: qty,
          qty_out: 0,
          cost_price: unitCost,
          selling_price: 0,
          mark_up: 0,
          markup_mode: "percentage",
          branch_name: "Raw Material",
          source: "Work in Progress",
          destination: branchName,
          status: "Active",
          type: STORE_ENTRY_TYPE.PRODUCTION,
          receive_date: receiveDate,
          reference_number: refBase,
          inserted_by: inserted_by || null,
          location: "Warehouse",
          expiry_date: null,
          truckNo: "",
          waybillNo: "",
          supplier_code: notes ? String(notes).slice(0, 140) : "",
          batch_id: null,
          multiplier_id: null,
          multple: "1",
        },
        { transaction },
      );
    }

    // ── STEP 3: Journal Entries (GL) ─────────────────────────────────────────
    if (action === "write_off") {
      // DR: Expense / Loss account selected by user in modal
      await db.GeneralLedger.create({
        transaction_date: today,
        account_code: String(account_head_code),
        account_subhead: expenseAcctRow.parent_code || "0",
        dr: totalCost,
        cr: 0,
        account_description: account_head_name || expenseAcctRow.description || "Scrap/Loss Expense",
        transaction_description: narration,
        reference_number: refBase,
        purpose_of_payment: "WIP Write-off",
        created_by: inserted_by || null,
        facility_id: facilityId,
        type: "expenses",
        transaction_ref: `${refBase}-DR`,
      }, { transaction });

      // CR: Business WIP account (source being reduced)
      const wipCrCode = wipBusinessCode || rawMaterialAcctCode;
      const wipCrRow  = wipBusinessCode ? wipBusinessAcctRow : rawMatAcctRow;
      if (wipCrCode) {
        await db.GeneralLedger.create({
          transaction_date: today,
          account_code: String(wipCrCode),
          account_subhead: wipCrRow.parent_code || "0",
          dr: 0,
          cr: totalCost,
          account_description: wipCrRow.description || "WIP Inventory",
          transaction_description: narration,
          reference_number: refBase,
          purpose_of_payment: "WIP Write-off",
          created_by: inserted_by || null,
          facility_id: facilityId,
          type: "inventory",
          transaction_ref: `${refBase}-CR`,
        }, { transaction });
      }

    } else if (action === "return_raw_material") {
      // DR: Raw Material Inventory (product.inventory_account — material coming back)
      const drCode = rawMaterialAcctCode;
      if (drCode) {
        await db.GeneralLedger.create({
          transaction_date: today,
          account_code: String(drCode),
          account_subhead: rawMatAcctRow.parent_code || "0",
          dr: totalCost,
          cr: 0,
          account_description: rawMatAcctRow.description || "Raw Material Inventory",
          transaction_description: narration,
          reference_number: refBase,
          purpose_of_payment: "WIP Return to Raw Material",
          created_by: inserted_by || null,
          facility_id: facilityId,
          type: "inventory",
          transaction_ref: `${refBase}-DR`,
        }, { transaction });
      }

      // CR: WIP account selected in modal (WIP inventory being reduced)
      await db.GeneralLedger.create({
        transaction_date: today,
        account_code: String(account_head_code),
        account_subhead: expenseAcctRow.parent_code || "0",
        dr: 0,
        cr: totalCost,
        account_description: account_head_name || expenseAcctRow.description || "WIP Inventory",
        transaction_description: narration,
        reference_number: refBase,
        purpose_of_payment: "WIP Return to Raw Material",
        created_by: inserted_by || null,
        facility_id: facilityId,
        type: "inventory",
        transaction_ref: `${refBase}-CR`,
      }, { transaction });
    }

    await transaction.commit();
    return res.status(200).json({
      success: true,
      message:
        action === "return_raw_material"
          ? "Material returned to raw material store successfully"
          : "Material written off successfully",
      data: {
        product_id,
        product_name: product?.name || null,
        action,
        quantity: qty,
        unit_cost: unitCost,
        total_cost: totalCost,
        branch: branchName,
        reference: refBase,
        account_head_code: account_head_code || null,
        account_head_name: account_head_name || null,
      },
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Error executing WIP action:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to execute WIP action",
      error: error.message,
    });
  }
};

// Read-only WIP action history for UI tracking/audit.
// Write-off any inventory item (Raw Material / Finished Good / etc.) directly from store_entries.
// GL: DR expense/loss account  |  CR product.inventory_account
exports.inventoryWriteOff = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const {
      facilityId,
      product_id,
      branch_name,
      branchId,
      quantity,
      notes = "",
      account_head_code,
      account_head_name = "",
      inserted_by = "",
    } = req.body || {};

    if (!facilityId || !product_id || !quantity || !account_head_code) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId, product_id, quantity and account_head_code are required",
      });
    }

    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: "quantity must be greater than zero" });
    }

    const parsedBranchId = parseInt(branchId, 10);
    const hasBranchId = Number.isInteger(parsedBranchId) && parsedBranchId > 0;
    const zoneName = branch_name || "for sales";

    // ── Check available stock ──────────────────────────────────────────────
    let stockSql = `SELECT SUM(qty_in) - SUM(qty_out) AS balance
       FROM store_entries
       WHERE product_id = :product_id
         AND facilityId = :facilityId`;
    const stockReplacements = { product_id, facilityId };
    if (hasBranchId) {
      stockSql += ` AND branchId = :branchId
         AND LOWER(TRIM(branch_name)) IN ('for sales', 'for sale')`;
      stockReplacements.branchId = parsedBranchId;
    } else if (branch_name) {
      stockSql += ` AND branch_name = :branch_name`;
      stockReplacements.branch_name = branch_name;
    }

    const [stockRow] = await db.sequelize.query(stockSql, {
      replacements: stockReplacements,
      type: db.sequelize.QueryTypes.SELECT,
      transaction,
    });

    const available = Number(stockRow?.balance || 0);
    if (qty > available) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Insufficient stock. Available: ${available}`,
      });
    }

    // ── Product & Business ────────────────────────────────────────────────
    const product = await db.Product.findOne({
      where: { sku: product_id, facility_id: facilityId },
      attributes: ["name", "sku", "inventory_account", "cost_price"],
      transaction,
    });

    const business = await db.business.findOne({
      where: { id: facilityId },
      attributes: ["business_name", "inv_ev_m", "default_valuation_source", "wip"],
      raw: true,
    });

    // ── Valuation ─────────────────────────────────────────────────────────
    let unitCost = 0;
    const useDefaultCost =
      business?.default_valuation_source !== "system_valuation";

    if (useDefaultCost) {
      unitCost = parseFloat(product?.cost_price || 0) || 0;
    } else {
      const valuationMethod = business?.inv_ev_m || "Weighted Average Cost";
      const methodKey = valuationMethod === "Weighted Average Cost" ? "WAC" : valuationMethod;
      const { calculatedCostPrice } = await exports.getCurrentUnitCost(product_id, facilityId, methodKey);
      unitCost = calculatedCostPrice || 0;
    }
    if (unitCost === 0) unitCost = parseFloat(product?.cost_price || 0) || 0;

    // Fallback: avg from store_entries with cost > 0
    if (unitCost === 0) {
      let avgSql = `SELECT SUM(qty_in * cost_price) / NULLIF(SUM(CASE WHEN qty_in > 0 AND cost_price > 0 THEN qty_in ELSE 0 END), 0) AS avg_cost
         FROM store_entries
         WHERE product_id = :product_id AND facilityId = :facilityId AND cost_price > 0`;
      const avgReplacements = { product_id, facilityId };
      if (hasBranchId) {
        avgSql += ` AND branchId = :branchId`;
        avgReplacements.branchId = parsedBranchId;
      } else if (branch_name) {
        avgSql += ` AND branch_name = :branch_name`;
        avgReplacements.branch_name = branch_name;
      }
      const [avgRow] = await db.sequelize.query(avgSql, {
        replacements: avgReplacements,
        type: db.sequelize.QueryTypes.SELECT,
        transaction,
      });
      unitCost = parseFloat(avgRow?.avg_cost || 0) || 0;
    }

    const totalCost = Number((qty * unitCost).toFixed(2));

    if (totalCost <= 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "Cannot write off: unit cost is ₦0.00 for this item. Please update the product's cost price before proceeding.",
      });
    }

    // ── Reference number ──────────────────────────────────────────────────
    const receiveDate = moment().format("YYYY-MM-DD");
    const sequenceNo  = await getAndUpdateNumber("invwo", facilityId);
    const refBase     = `INVWO/${moment().format("YY")}/${String(sequenceNo).padStart(4, "0")}`;
    const narration   = `Inventory Write-off (Scrap/Loss) — ${product?.name || product_id} | Ref: ${refBase}`;
    const srcBranch   = zoneName;

    // Helper
    const lookupAcct = async (code) => {
      if (!code) return {};
      const [row] = await db.sequelize.query(
        `SELECT code, parent_code, description FROM account_category
         WHERE code = :code AND facility_id = :facilityId LIMIT 1`,
        { replacements: { code: String(code), facilityId }, type: db.sequelize.QueryTypes.SELECT, transaction },
      );
      return row || {};
    };

    const expenseAcctRow  = await lookupAcct(account_head_code);
    const invAcctCode     = product?.inventory_account || business?.wip || null;
    const invAcctRow      = await lookupAcct(invAcctCode);

    // ── STEP 1: History ────────────────────────────────────────────────────
    await db.WipActionHistory.create({
      facility_id:          String(facilityId),
      reference_number:     refBase,
      product_id,
      product_name:         product?.name || null,
      action_type:          "write_off",
      quantity:             qty,
      unit_cost:            unitCost,
      total_cost:           totalCost,
      source_location:      srcBranch,
      destination_location: `Scrap/Loss${account_head_name ? ` (${account_head_name})` : ""}`,
      notes:                notes || null,
      created_by:           inserted_by || null,
    }, { transaction });

    // ── STEP 2: Store Entry — OUT ──────────────────────────────────────────
    await db.StoreEntry.create({
      product_id,
      facilityId,
      qty_in:           0,
      qty_out:          qty,
      cost_price:       unitCost,
      selling_price:    0,
      mark_up:          0,
      markup_mode:      "percentage",
      branch_name:      srcBranch,
      branchId:         hasBranchId ? parsedBranchId : null,
      source:           srcBranch,
      destination:      `Scrap/Loss${account_head_name ? ` (${account_head_name})` : ""}`,
      status:           "Active",
      type:             STORE_ENTRY_TYPE.ADJUSTMENT,
      receive_date:     receiveDate,
      reference_number: refBase,
      inserted_by:      inserted_by || null,
      location:         "Warehouse",
      expiry_date:      null,
      truckNo:          "",
      waybillNo:        "",
      supplier_code:    notes ? String(notes).slice(0, 140) : "",
      batch_id:         null,
      multiplier_id:    null,
      multple:          "1",
    }, { transaction });

    // ── STEP 3: GL Journal Entries ─────────────────────────────────────────
    // DR: Expense / Loss account
    await db.GeneralLedger.create({
      transaction_date:        receiveDate,
      account_code:            String(account_head_code),
      account_subhead:         expenseAcctRow.parent_code || "0",
      dr:                      totalCost,
      cr:                      0,
      account_description:     account_head_name || expenseAcctRow.description || "Scrap/Loss Expense",
      transaction_description: narration,
      reference_number:        refBase,
      purpose_of_payment:      "Inventory Write-off",
      created_by:              inserted_by || null,
      facility_id:             facilityId,
      type:                    "expenses",
      transaction_ref:         `${refBase}-DR`,
      ...(hasBranchId ? { branch_id: parsedBranchId } : {}),
    }, { transaction });

    // CR: Inventory account
    if (invAcctCode) {
      await db.GeneralLedger.create({
        transaction_date:        receiveDate,
        account_code:            String(invAcctCode),
        account_subhead:         invAcctRow.parent_code || "0",
        dr:                      0,
        cr:                      totalCost,
        account_description:     invAcctRow.description || "Inventory",
        transaction_description: narration,
        reference_number:        refBase,
        purpose_of_payment:      "Inventory Write-off",
        created_by:              inserted_by || null,
        facility_id:             facilityId,
        type:                    "inventory",
        transaction_ref:         `${refBase}-CR`,
        ...(hasBranchId ? { branch_id: parsedBranchId } : {}),
      }, { transaction });
    }

    await transaction.commit();
    return res.status(200).json({
      success: true,
      message: "Inventory write-off completed successfully",
      data: { product_id, product_name: product?.name, quantity: qty, unit_cost: unitCost, total_cost: totalCost, reference: refBase },
    });
  } catch (error) {
    await transaction.rollback();
    console.error("inventoryWriteOff error:", error);
    return res.status(500).json({ success: false, message: "Failed to process write-off", error: error.message });
  }
};

exports.getWipActionHistory = async (req, res) => {
  try {
    const { facilityId, actionType, productId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const where = { facility_id: String(facilityId) };
    if (actionType) where.action_type = actionType;
    if (productId) where.product_id = productId;

    const history = await db.WipActionHistory.findAll({
      where,
      order: [["created_at", "DESC"]],
      limit: 500,
    });

    return res.status(200).json({
      success: true,
      data: history,
    });
  } catch (error) {
    console.error("Error fetching WIP action history:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch WIP action history",
      error: error.message,
    });
  }
};

// Get produced goods for markup
exports.getProducedGoods = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Get finished goods that are ready for sale
    const query = `
      SELECT
        p.id as product_id,
        p.sku,
        p.name as item_name,
        p.category,
        p.item_type,
        p.unit_of_measure,
        p.cost_price,
        p.selling_price,

        p.status,
        p.created_at,
        iv.avg_unit_cost as valuation_cost,
        iv.quantity_on_hand as balance,
        iv.valuation_method,
        -- Calculate current quantity from store entries
        COALESCE(SUM(CASE
          WHEN se.transaction_type = 'IN' AND se.destination = 'Ready For Sales'
          THEN se.qty_in
          ELSE 0
        END), 0) -
        COALESCE(SUM(CASE
          WHEN se.transaction_type = 'OUT' AND se.source = 'Ready For Sales'
          THEN se.qty_out
          ELSE 0
        END), 0) as available_quantity
      FROM products p
      LEFT JOIN inventory_valuation iv ON p.id = iv.product_id AND iv.facility_id = :facilityId
      LEFT JOIN store_entries se ON p.sku = se.product_id AND se.facilityId = :facilityId
      WHERE p.facility_id = :facilityId
        AND p.item_type = 'Finished Good'
        AND p.status = 'Active'
      GROUP BY
        p.id, p.sku, p.name, p.category, p.item_type, p.unit_of_measure,
        p.cost_price, p.selling_price,  p.status, p.created_at,
        iv.avg_unit_cost, iv.quantity_on_hand, iv.valuation_method
      HAVING available_quantity > 0
      ORDER BY p.name ASC
    `;

    const producedGoods = await db.sequelize.query(query, {
      replacements: { facilityId },
      type: db.sequelize.QueryTypes.SELECT,
    });

    res.status(200).json({
      success: true,
      data: producedGoods,
    });
  } catch (error) {
    console.error("Error fetching produced goods:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching produced goods data",
      error: error.message,
    });
  }
};

exports.getCurrentUnitCost = async (
  product_id,
  facility_id,
  valuation_method = "WAC",
) => {
  try {
    if (!product_id || !facility_id) {
      return { calculatedCostPrice: 0 };
    }

    // ===================================
    // 1. Get all transactions in order
    // ===================================
    const rows = await db.sequelize.query(
      `
      SELECT qty_in, qty_out, cost_price
      FROM store_entries
      WHERE product_id = :product_id
        AND facilityId = :facility_id
      ORDER BY receive_date ASC, id ASC
      `,
      {
        replacements: { product_id, facility_id },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );

    if (rows.length === 0) return { calculatedCostPrice: 0 };

    // ===================================
    // 2. Rebuild current state (perpetual)
    // ===================================
    let stockBalance = 0;
    let totalCost = 0;
    const fifoLayers = []; // only for FIFO/LIFO

    for (const row of rows) {
      const qtyIn = parseFloat(row.qty_in) || 0;
      const qtyOut = parseFloat(row.qty_out) || 0;
      let costPrice = row.cost_price == null ? 0 : parseFloat(row.cost_price);

      // ——— INCOMING ———
      if (qtyIn > 0) {
        const costToUse =
          costPrice > 0
            ? costPrice
            : stockBalance > 0
              ? totalCost / stockBalance
              : 0;

        if (valuation_method === "FIFO" || valuation_method === "LIFO") {
          fifoLayers.push({ qty: qtyIn, cost: costToUse });
        } else {
          // WAC
          totalCost += qtyIn * costToUse;
        }
        stockBalance += qtyIn;
      }

      // ——— OUTGOING ———
      if (qtyOut > 0) {
        if (valuation_method === "FIFO") {
          let remaining = qtyOut;
          while (remaining > 0 && fifoLayers.length > 0) {
            const layer = fifoLayers[0];
            const take = Math.min(layer.qty, remaining);
            layer.qty -= take;
            remaining -= take;
            if (layer.qty <= 0) fifoLayers.shift();
          }
        } else if (valuation_method === "LIFO") {
          let remaining = qtyOut;
          while (remaining > 0 && fifoLayers.length > 0) {
            const layer = fifoLayers[fifoLayers.length - 1];
            const take = Math.min(layer.qty, remaining);
            layer.qty -= take;
            remaining -= take;
            if (layer.qty <= 0) fifoLayers.pop();
          }
        } else {
          // WAC
          const avg = stockBalance > 0 ? totalCost / stockBalance : 0;
          totalCost -= qtyOut * avg;
        }
        stockBalance -= qtyOut;
        stockBalance = Math.max(0, stockBalance);
        totalCost = Math.max(0, totalCost);
      }
    }

    // ===================================
    // 3. Return current unit cost (never 0 when ledger has positive costs)
    // ===================================
    let unitCost = 0;

    if (stockBalance > 0) {
      if (valuation_method === "WAC") {
        unitCost = totalCost / stockBalance;
      } else if (valuation_method === "FIFO") {
        unitCost = fifoLayers.length > 0 ? fifoLayers[0].cost : 0;
      } else if (valuation_method === "LIFO") {
        unitCost =
          fifoLayers.length > 0 ? fifoLayers[fifoLayers.length - 1].cost : 0;
      }
    }

    if (unitCost <= 0) {
      unitCost = averagePositiveCostFromStoreRows(rows, "in");
    }
    if (unitCost <= 0) {
      unitCost = averagePositiveCostFromStoreRows(rows, "out");
    }
    if (unitCost <= 0) {
      unitCost = lastPositiveCostFromStoreRows(rows);
    }

    return {
      calculatedCostPrice: Number(unitCost.toFixed(2)),
    };
  } catch (error) {
    console.error("getCurrentUnitCost error:", error);
    return { calculatedCostPrice: 0 };
  }
};

exports.getCurrentUnitCostWithMultiplier = async (
  product_id,
  facility_id,
  valuation_method = "WAC",
  multiplier_id = null,
) => {
  try {
    if (!product_id || !facility_id) {
      return { calculatedCostPrice: 0 };
    }

    // ===================================
    // 1. Get all transactions in order
    // ===================================
    const multiplierCondition =
      multiplier_id === null || multiplier_id === undefined
        ? "AND multiplier_id IS NULL"
        : "AND multiplier_id = :multiplier_id";

    const replacements = {
      product_id,
      facility_id,
    };

    if (multiplier_id !== null && multiplier_id !== undefined) {
      replacements.multiplier_id = multiplier_id;
    }

    const rows = await db.sequelize.query(
      `
      SELECT qty_in, qty_out, cost_price
      FROM store_entries
      WHERE product_id = :product_id
        AND facilityId = :facility_id
        ${multiplierCondition}
      ORDER BY receive_date ASC, id ASC
      `,
      {
        replacements,
        type: db.sequelize.QueryTypes.SELECT,
      },
    );

    if (rows.length === 0) return { calculatedCostPrice: 0 };

    // ===================================
    // 2. Rebuild current state (perpetual)
    // ===================================
    let stockBalance = 0;
    let totalCost = 0;
    const fifoLayers = []; // only for FIFO/LIFO

    for (const row of rows) {
      const qtyIn = parseFloat(row.qty_in) || 0;
      const qtyOut = parseFloat(row.qty_out) || 0;
      let costPrice = row.cost_price == null ? 0 : parseFloat(row.cost_price);

      // ——— INCOMING ———
      if (qtyIn > 0) {
        const costToUse =
          costPrice > 0
            ? costPrice
            : stockBalance > 0
              ? totalCost / stockBalance
              : 0;

        if (valuation_method === "FIFO" || valuation_method === "LIFO") {
          fifoLayers.push({ qty: qtyIn, cost: costToUse });
        } else {
          // WAC
          totalCost += qtyIn * costToUse;
        }
        stockBalance += qtyIn;
      }

      // ——— OUTGOING ———
      if (qtyOut > 0) {
        if (valuation_method === "FIFO") {
          let remaining = qtyOut;
          while (remaining > 0 && fifoLayers.length > 0) {
            const layer = fifoLayers[0];
            const take = Math.min(layer.qty, remaining);
            layer.qty -= take;
            remaining -= take;
            if (layer.qty <= 0) fifoLayers.shift();
          }
        } else if (valuation_method === "LIFO") {
          let remaining = qtyOut;
          while (remaining > 0 && fifoLayers.length > 0) {
            const layer = fifoLayers[fifoLayers.length - 1];
            const take = Math.min(layer.qty, remaining);
            layer.qty -= take;
            remaining -= take;
            if (layer.qty <= 0) fifoLayers.pop();
          }
        } else {
          // WAC
          const avg = stockBalance > 0 ? totalCost / stockBalance : 0;
          totalCost -= qtyOut * avg;
        }
        stockBalance -= qtyOut;
        stockBalance = Math.max(0, stockBalance);
        totalCost = Math.max(0, totalCost);
      }
    }

    // ===================================
    // 3. Return current unit cost (never 0 when ledger has positive costs)
    // ===================================
    let unitCost = 0;

    if (stockBalance > 0) {
      if (valuation_method === "WAC") {
        unitCost = totalCost / stockBalance;
      } else if (valuation_method === "FIFO") {
        unitCost = fifoLayers.length > 0 ? fifoLayers[0].cost : 0;
      } else if (valuation_method === "LIFO") {
        unitCost =
          fifoLayers.length > 0 ? fifoLayers[fifoLayers.length - 1].cost : 0;
      }
    }

    if (unitCost <= 0) {
      unitCost = averagePositiveCostFromStoreRows(rows, "in");
    }
    if (unitCost <= 0) {
      unitCost = averagePositiveCostFromStoreRows(rows, "out");
    }
    if (unitCost <= 0) {
      unitCost = lastPositiveCostFromStoreRows(rows);
    }

    return {
      calculatedCostPrice: Number(unitCost.toFixed(2)),
    };
  } catch (error) {
    console.error("getCurrentUnitCost error:", error);
    return { calculatedCostPrice: 0 };
  }
};

// Get By-Product type products
exports.getByProducts = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Use Sequelize model to get By-Product type products
    const { Product } = db;

    if (!Product) {
      return res.status(500).json({
        success: false,
        error: "Product model not available",
      });
    }

    // Build where conditions for By-Product items
    const whereConditions = {
      facility_id: facilityId,
      item_type: "By-Product",
      status: "Active",
    };

    // Query products using Sequelize model
    const products = await Product.findAll({
      where: whereConditions,
      attributes: [
        "id",
        "name",
        "sku",
        "item_type",
        "category",
        "unit_of_measure",
        "inventory_account",
        "cost_price",
        "selling_price",
        "mark_up",
        "markup_mode",
        "taxable",
        "status",
        "image_url",
        "reorder_level",
        "created_at",
        "updated_at",
      ],
      order: [["name", "ASC"]],
    });

    const formattedResults = products.map((product) => ({
      id: product.id,
      item_name: product.name,
      item_code: product.sku,
      sku: product.sku,
      item_type: product.item_type,
      category: product.category,
      unit_of_measure: product.unit_of_measure,
      inventory_account: product.inventory_account || "",
      cost_price: parseFloat(product.cost_price) || 0,
      selling_price: parseFloat(product.selling_price) || 0,
      mark_up: parseFloat(product.mark_up) || 0,
      markup_mode: product.markup_mode || "percentage",
      taxable: product.taxable,
      status: product.status,
      image_url: product.image_url,
      reorder_level: product.reorder_level,
      created_at: product.created_at,
      updated_at: product.updated_at,
    }));

    res.json({
      success: true,
      results: formattedResults,
    });
  } catch (err) {
    console.error("getByProducts Error:", err);
    res.status(500).json({
      success: false,
      error: err.message || "Internal Server Error",
    });
  }
};

const createProductionProductEntry = async (
  req,
  res,
  {
    expectedItemType,
    referencePrefix,
    entryType,
    source,
    successMessage,
    errorMessage,
    creditFromProductionAccount = false,
    creditPurposeOfPayment = "Cost of Production Entry",
  },
) => {
  const transaction = await db.sequelize.transaction();

  try {
    const {
      product_id,
      facilityId,
      quantity,
      cost_price,
      mark_up,
      markup_mode = "percentage",
      taxable,
      vat_policy,
      vat_rate = 7.5, // Default VAT rate
      inserted_by,
      branchId: branchIdRaw,
      notes = "",
      cost_of_production_account_code,
    } = req.body;

    // Validate required fields
    if (!product_id || !facilityId || !quantity || cost_price === undefined) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "product_id, facilityId, quantity, and cost_price are required",
      });
    }

    const branchId = parseInt(branchIdRaw, 10);
    if (!Number.isFinite(branchId) || branchId <= 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "branchId is required",
      });
    }

    const branchValid = await validateBranchIdById(
      facilityId,
      branchId,
      transaction,
    );
    if (!branchValid) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "branchId does not belong to this facility",
      });
    }

    // Get the product details
    const product = await db.Product.findOne({
      where: {
        sku: product_id,
        facility_id: facilityId,
      },
      transaction,
    });

    if (!product) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    if (product.item_type !== expectedItemType) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Selected product must be ${expectedItemType}`,
      });
    }

    const business = await db.business.findOne({
      where: { id: facilityId },
      transaction,
    });

    let creditAcct;

    if (creditFromProductionAccount) {
      const prodCode = String(cost_of_production_account_code || "").trim();
      if (!prodCode) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "cost_of_production_account_code is required",
        });
      }
      creditAcct = await db.AccountCategory.findOne({
        where: { code: prodCode, facility_id: facilityId },
        transaction,
      });
      if (!creditAcct) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Cost of production account (${prodCode}) not found in chart of accounts`,
        });
      }
    } else {
      const wipAccountCode = business?.wip;
      if (!wipAccountCode) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "WIP account is not configured for this facility",
        });
      }
      creditAcct = await db.AccountCategory.findOne({
        where: { code: wipAccountCode, facility_id: facilityId },
        transaction,
      });
      if (!creditAcct) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `WIP account (${wipAccountCode}) not found`,
        });
      }
    }

    const inventoryAccountCode = product.inventory_account;
    if (!inventoryAccountCode) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Inventory account is not configured for ${product.name || product_id}`,
      });
    }

    const inventoryAcct = await db.AccountCategory.findOne({
      where: { code: inventoryAccountCode, facility_id: facilityId },
      transaction,
    });

    if (!inventoryAcct) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Inventory account (${inventoryAccountCode}) not found`,
      });
    }

    const qty = parseFloat(quantity);
    const unitCost = parseFloat(cost_price);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unitCost) || unitCost < 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "quantity and cost_price must be valid positive numbers",
      });
    }

    // GL and inventory valuation always use production cost (qty × unit cost), never selling price.
    const glAmount = Number((qty * unitCost).toFixed(2));

    // Calculate selling price for product pricing / sales (not used for GL).
    let sellingPrice = unitCost;
    const markupValue = parseFloat(mark_up) || 0;

    if (markup_mode === "percentage") {
      sellingPrice = sellingPrice + (sellingPrice * markupValue) / 100;
    } else {
      sellingPrice = sellingPrice + markupValue;
    }

    if (
      taxable === "Taxable" &&
      (vat_policy === "vat_inclusive" || vat_policy === "all")
    ) {
      const vatAmount = sellingPrice * (parseFloat(vat_rate) / 100);
      sellingPrice = sellingPrice + vatAmount;
    }

    const roundedSellingPrice = parseFloat(sellingPrice.toFixed(2));

    // Generate reference number via facility number_generator (prefix = BP / FG).
    const seq = await getAndUpdateNumber(referencePrefix, facilityId);
    const referenceNumber = `${referencePrefix}-${seq}`;
    const receiveDate = moment().format("YYYY-MM-DD");

    // Create store entry - matching the store_entries table structure
    const storeEntry = await db.StoreEntry.create(
      {
        product_id: product_id,
        facilityId: facilityId,
        qty_in: qty,
        qty_out: 0,
        cost_price: unitCost,
        selling_price: 0,
        mark_up: markupValue,
        markup_mode: markup_mode,
        branch_name: "for sales",
        branchId,
        source,
        destination: entryType,
        status: "Active",
        type: STORE_ENTRY_TYPE.PRODUCTION,
        receive_date: receiveDate,
        reference_number: referenceNumber,
        inserted_by: inserted_by,
        location: "Warehouse",
        expiry_date: null,
        truckNo: "",
        waybillNo: "",
        supplier_code: notes ? String(notes).slice(0, 140) : "",
        batch_id: null,
        multiplier_id: null,
        multple: "1",
      },
      { transaction },
    );

    await product.update(
      {
        cost_price: unitCost,
        selling_price: roundedSellingPrice,
        mark_up: markupValue,
        markup_mode: markup_mode,
      },
      { transaction },
    );

    if (glAmount > 0) {
      const narration = `${entryType} entry ${referenceNumber} — ${product.name} (${qty} @ ${unitCost})`;

      await db.GeneralLedger.create(
        {
          transaction_date: receiveDate,
          account_code: inventoryAcct.code,
          account_subhead: inventoryAcct.parent_code || 0,
          dr: glAmount,
          cr: 0,
          account_description: inventoryAcct.description,
          transaction_description: narration,
          reference_number: referenceNumber,
          purpose_of_payment: `${entryType} Production Entry`,
          created_by: inserted_by || null,
          facility_id: facilityId,
          type: "inventory",
          transaction_ref: `${referenceNumber}-DR`,
          branch_id: branchId,
        },
        { transaction },
      );

      await db.GeneralLedger.create(
        {
          transaction_date: receiveDate,
          account_code: creditAcct.code,
          account_subhead: creditAcct.parent_code || 0,
          dr: 0,
          cr: glAmount,
          account_description: creditAcct.description,
          transaction_description: narration,
          reference_number: referenceNumber,
          purpose_of_payment: creditFromProductionAccount
            ? creditPurposeOfPayment
            : `${entryType} Production Entry`,
          created_by: inserted_by || null,
          facility_id: facilityId,
          type: "inventory",
          transaction_ref: `${referenceNumber}-CR`,
          branch_id: branchId,
        },
        { transaction },
      );
    }

    await transaction.commit();

    res.status(201).json({
      success: true,
      message: successMessage,
      data: {
        referenceNumber,
        storeEntry: storeEntry,
        calculatedSellingPrice: roundedSellingPrice,
        costPrice: unitCost,
        glAmount,
        totalCost: glAmount,
        branchId,
        markUp: markupValue,
        markupMode: markup_mode,
        vatIncluded:
          taxable === "Taxable" &&
          (vat_policy === "vat_inclusive" || vat_policy === "all"),
      },
    });
  } catch (error) {
    await transaction.rollback();
    console.error(errorMessage, error);
    res.status(500).json({
      success: false,
      message: errorMessage,
      error: error.message,
    });
  }
};

// Create By-Product Store Entry with markup and VAT calculation
exports.createByProductEntry = async (req, res) => {
  return createProductionProductEntry(req, res, {
    expectedItemType: "By-Product",
    referencePrefix: "BP",
    entryType: "By-Product",
    source: "By-Product Production",
    successMessage: "By-product entry created successfully",
    errorMessage: "Error creating by-product entry",
    creditFromProductionAccount: true,
    creditPurposeOfPayment: "By-Product Production Entry",
  });
};

// Create Finished Good Store Entry with markup and VAT calculation
exports.createFinishedGoodEntry = async (req, res) => {
  return createProductionProductEntry(req, res, {
    expectedItemType: "Finished Good",
    referencePrefix: "FG",
    entryType: "Finished Good",
    source: "Finished Good Production",
    successMessage: "Finished good entry created successfully",
    errorMessage: "Error creating finished good entry",
    creditFromProductionAccount: true,
  });
};

// List By-Product / Finished Good production entry history
exports.getProductionProductEntries = async (req, res) => {
  const facilityId = req.query.facilityId;
  const itemType = String(req.query.item_type || "all").trim();

  if (!facilityId) {
    return res
      .status(400)
      .json({ success: false, message: "facilityId is required" });
  }

  if (
    itemType !== "all" &&
    itemType !== "By-Product" &&
    itemType !== "Finished Good"
  ) {
    return res.status(400).json({
      success: false,
      message: "item_type must be all, By-Product, or Finished Good",
    });
  }

  try {
    const replacements = { facilityId };
    let typeFilter = "";
    if (itemType !== "all") {
      typeFilter = "AND se.type = :itemType";
      replacements.itemType = itemType;
    }

    const query = `
      SELECT
        se.id,
        se.reference_number,
        se.receive_date,
        se.type AS entry_type,
        se.product_id,
        se.qty_in AS quantity,
        se.cost_price,
        se.selling_price,
        se.mark_up,
        se.markup_mode,
        se.branchId,
        se.inserted_by,
        se.supplier_code AS notes,
        p.name AS product_name,
        p.unit_of_measure,
        b.branch_name AS physical_branch_name,
        gl_credit.account_code AS credit_account_code,
        gl_credit.account_description AS credit_account_name,
        gl_credit.cr AS credit_amount,
        gl_dr.account_code AS inventory_account_code,
        gl_dr.account_description AS inventory_account_name,
        gl_dr.dr AS debit_amount
      FROM store_entries se
      INNER JOIN products p
        ON p.sku = se.product_id AND p.facility_id = se.facilityId
      LEFT JOIN branches b
        ON b.id = se.branchId AND b.facilityId = se.facilityId
      LEFT JOIN general_ledger gl_credit
        ON gl_credit.facility_id = se.facilityId
        AND gl_credit.reference_number = se.reference_number
        AND gl_credit.cr > 0
        AND gl_credit.transaction_ref LIKE '%-CR'
      LEFT JOIN general_ledger gl_dr
        ON gl_dr.facility_id = se.facilityId
        AND gl_dr.reference_number = se.reference_number
        AND gl_dr.dr > 0
        AND gl_dr.transaction_ref LIKE '%-DR'
      WHERE se.facilityId = :facilityId
        AND se.qty_in > 0
        AND se.type IN ('By-Product', 'Finished Good')
        AND se.source IN ('By-Product Production', 'Finished Good Production')
        ${typeFilter}
      ORDER BY se.receive_date DESC, se.id DESC
      LIMIT 200
    `;

    const rows = await db.sequelize.query(query, {
      replacements,
      type: db.sequelize.QueryTypes.SELECT,
    });

    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("Error fetching production product entries:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching production entry history",
      error: error.message,
    });
  }
};

// ============================================================================
// MIXTURE — produce a semi-finished good by consuming WIP raw materials.
//
// Workflow:
//  1. Persist a Mixture + MixtureIngredient rows for history/auditing.
//  2. Write StoreEntry rows: qty_out for each consumed ingredient and qty_in
//     for the produced semi-finished good.
//  3. Post a balanced GeneralLedger journal:
//        DR <semi-finished product>.inventory_account   (total cost)
//        CR <business.wip>                              (total cost)
//
// Request body:
//   {
//     facilityId, createdBy,
//     product: { id, sku, name, unit_of_measure, inventory_account },
//     quantity, unit, unitCost, totalIngredientsCost,
//     ingredients: [
//       { id|product_id, sku, name, quantity, unit_cost, unit_of_measure }
//     ],
//     wipAccount   // optional, falls back to business.wip
//   }
// ============================================================================
exports.createMixture = async (req, res) => {
  try {
    const result = await db.sequelize.transaction(async (transaction) => {
      const fail = (status, message) => {
        const err = new Error(message);
        err.status = status;
        throw err;
      };

      const {
        facilityId,
        createdBy,
        product,
        quantity,
        unit,
        unitCost,
        totalIngredientsCost,
        ingredients,
        wipAccount: wipAccountFromReq,
      } = req.body || {};

      if (!facilityId) fail(400, "facilityId is required");
      if (!product || !product.id)
        fail(400, "product (semi-finished good) is required");
      if (!Array.isArray(ingredients) || ingredients.length === 0)
        fail(400, "At least one ingredient is required");

      const qtyProduced = parseFloat(quantity);
      if (!qtyProduced || qtyProduced <= 0)
        fail(400, "quantity must be greater than 0");

      const today = moment().format("YYYY-MM-DD");

      // Resolve facility/business — needed for the WIP account fallback.
      const business = await db.business.findOne({
        where: { id: facilityId },
        transaction,
      });

      // Resolve the semi-finished product (to confirm it exists + grab its
      // inventory account if the client didn't pass one).
      const semiProduct = await db.Product.findOne({
        where: { id: product.id, facility_id: facilityId },
        transaction,
      });
      if (!semiProduct) fail(404, "Semi-finished product not found");

      const inventoryAccountCode =
        product.inventory_account || semiProduct.inventory_account || null;
      const wipAccountCode =
        wipAccountFromReq || product.wip_account || business?.wip || null;

      // Compute totals server-side as a safety check.
      const computedTotalCost = ingredients.reduce(
        (sum, ing) =>
          sum +
          Number(ing.quantity || 0) *
            Number(ing.unit_cost || ing.unitCost || 0),
        0,
      );
      const totalCost =
        Number(totalIngredientsCost) > 0
          ? Number(totalIngredientsCost)
          : computedTotalCost;
      const computedUnitCost = qtyProduced > 0 ? totalCost / qtyProduced : 0;
      const finalUnitCost =
        Number(unitCost) > 0 ? Number(unitCost) : computedUnitCost;

      // Generate reference number using the shared number_generator
      // (prefix "mix" — auto-creates a row in number_generator if missing).
      const mixSeq = await getAndUpdateNumber("mix", facilityId);
      const reference = `MIX/${moment().format("YY")}/${String(mixSeq).padStart(
        4,
        "0",
      )}`;

      // 1) Persist Mixture
      const mixture = await db.Mixture.create(
        {
          id: uuidv4(),
          facility_id: facilityId,
          reference_number: reference,
          product_id: product.id,
          product_sku: product.sku || semiProduct.sku || "",
          product_name: product.name || semiProduct.name,
          quantity_produced: qtyProduced,
          unit_of_measure: unit || semiProduct.unit_of_measure || "",
          total_ingredients_cost: totalCost,
          unit_cost: finalUnitCost,
          inventory_account: inventoryAccountCode,
          wip_account: wipAccountCode,
          notes: JSON.stringify({
            ingredients,
            producedAt: new Date().toISOString(),
          }),
          created_by: createdBy || null,
        },
        { transaction },
      );

      // 2) Persist MixtureIngredient rows
      const ingredientRows = [];
      for (const ing of ingredients) {
        const qty = Number(ing.quantity || 0);
        const uc = Number(ing.unit_cost || ing.unitCost || 0);
        const total = qty * uc;
        const row = await db.MixtureIngredient.create(
          {
            id: uuidv4(),
            mixture_id: mixture.id,
            product_id: ing.product_id || ing.id || "",
            product_sku: ing.sku || "",
            product_name: ing.name || ing.product_name || "",
            quantity: qty,
            unit_cost: uc,
            total_cost: total,
            unit_of_measure: ing.unit_of_measure || "",
          },
          { transaction },
        );
        ingredientRows.push(row);
      }

      // 3) StoreEntry — qty_out for each ingredient (deplete WIP)
      const ingredientIds = (ingredients || [])
        .map((ing) => String(ing.product_id || ing.id || "").trim())
        .filter(Boolean);
      const ingredientSkuById = {};
      if (ingredientIds.length > 0) {
        const ingProducts = await db.Product.findAll({
          where: {
            facility_id: facilityId,
            id: { [Op.in]: ingredientIds },
          },
          attributes: ["id", "sku"],
          transaction,
        });
        for (const p of ingProducts || []) {
          if (p?.id && p?.sku) ingredientSkuById[String(p.id)] = p.sku;
        }
      }

      for (const ing of ingredients) {
        const sku =
          ing.sku ||
          ing.product_sku ||
          ingredientSkuById[String(ing.product_id || ing.id || "").trim()];
        if (!sku) continue;
        const qty = Number(ing.quantity || 0);
        const uc = Number(ing.unit_cost || ing.unitCost || 0);
        await db.StoreEntry.create(
          {
            product_id: sku,
            facilityId: facilityId,
            qty_in: 0,
            qty_out: qty,
            cost_price: uc,
            selling_price: 0,
            mark_up: 0,
            markup_mode: "percentage",
            branch_name: "Work in Progress",
            source: "Work in Progress",
            destination: `Mixture`,
            status: "Active",
            type: STORE_ENTRY_TYPE.CONSUMED,
            receive_date: today,
            reference_number: reference,
            inserted_by: createdBy || "",
            location: "Warehouse",
            expiry_date: null,
            truckNo: "",
            waybillNo: "",
            supplier_code: "",
            batch_id: null,
            multiplier_id: null,
            multple: "1",
          },
          { transaction },
        );
      }

      // 3b) StoreEntry — qty_in for the semi-finished good produced
      const semiSku = product.sku || semiProduct.sku;
      if (semiSku) {
        await db.StoreEntry.create(
          {
            product_id: semiSku,
            facilityId: facilityId,
            qty_in: qtyProduced,
            qty_out: 0,
            cost_price: finalUnitCost,
            selling_price: 0,
            mark_up: 0,
            markup_mode: "percentage",
            branch_name: "Work in Progress",
            source: `Mixture`,
            destination: "Inventory",
            status: "Active",
            type: STORE_ENTRY_TYPE.PRODUCTION,
            receive_date: today,
            reference_number: reference,
            inserted_by: createdBy || "",
            location: "Warehouse",
            expiry_date: null,
            truckNo: "",
            waybillNo: "",
            supplier_code: "",
            batch_id: null,
            multiplier_id: null,
            multple: "1",
          },
          { transaction },
        );
      }

      // 4) GeneralLedger — balanced DR/CR
      if (totalCost > 0) {
        if (!inventoryAccountCode) {
          fail(
            400,
            "Semi-finished product has no inventory_account configured. Set the inventory account on the product before creating a mixture.",
          );
        }
        if (!wipAccountCode) {
          fail(
            400,
            "WIP account is not configured for this facility. Set business.wip or pass wipAccount in the request.",
          );
        }

        const inventoryAcct = await db.AccountCategory.findOne({
          where: { code: inventoryAccountCode, facility_id: facilityId },
          transaction,
        });
        const wipAcct = await db.AccountCategory.findOne({
          where: { code: wipAccountCode, facility_id: facilityId },
          transaction,
        });

        if (!inventoryAcct) {
          fail(
            400,
            `Inventory account (${inventoryAccountCode}) not found for facility`,
          );
        }
        if (!wipAcct) {
          fail(400, `WIP account (${wipAccountCode}) not found for facility`);
        }

        const narration = `Mixture ${reference} — ${semiProduct.name} (${qtyProduced} ${
          unit || semiProduct.unit_of_measure || ""
        })`;

        // DR Inventory (semi-finished good)
        await db.GeneralLedger.create(
          {
            transaction_date: today,
            account_code: inventoryAcct.code,
            account_subhead: inventoryAcct.parent_code || 0,
            dr: totalCost,
            cr: 0,
            account_description: inventoryAcct.description,
            transaction_description: narration,
            reference_number: reference,
            purpose_of_payment: "Mixture Production",
            created_by: createdBy || null,
            facility_id: facilityId,
            type: "inventory",
            transaction_ref: `${reference}-DR`,
          },
          { transaction },
        );

        // CR WIP (split by ingredient used).
        // Business request: one semi-finished DR line, but WIP should be
        // credited per material consumed.
        const glIngredientRows = (ingredientRows || [])
          .map((ing) => ({
            name: ing.product_name || "WIP Item",
            amount: Number(ing.total_cost || 0),
          }))
          .filter((r) => r.amount > 0);

        if (glIngredientRows.length === 0) {
          // Safety fallback if no ingredient value could be resolved.
          await db.GeneralLedger.create(
            {
              transaction_date: today,
              account_code: wipAcct.code,
              account_subhead: wipAcct.parent_code || 0,
              dr: 0,
              cr: totalCost,
              account_description: wipAcct.description,
              transaction_description: `${narration} - WIP Total`,
              reference_number: reference,
              purpose_of_payment: "Mixture Production",
              created_by: createdBy || null,
              facility_id: facilityId,
              type: "inventory",
              transaction_ref: `${reference}-CR-1`,
            },
            { transaction },
          );
        } else {
          // Ensure split CR entries total exactly matches the DR total.
          const splitSum = glIngredientRows.reduce((s, r) => s + r.amount, 0);
          const roundingDiff = Number((totalCost - splitSum).toFixed(2));
          if (roundingDiff !== 0) {
            glIngredientRows[glIngredientRows.length - 1].amount = Number(
              (
                glIngredientRows[glIngredientRows.length - 1].amount +
                roundingDiff
              ).toFixed(2),
            );
          }

          for (let i = 0; i < glIngredientRows.length; i++) {
            const row = glIngredientRows[i];
            await db.GeneralLedger.create(
              {
                transaction_date: today,
                account_code: wipAcct.code,
                account_subhead: wipAcct.parent_code || 0,
                dr: 0,
                cr: row.amount,
                account_description: wipAcct.description,
                transaction_description: `${narration} - ${row.name}`,
                reference_number: reference,
                purpose_of_payment: "Mixture Production",
                created_by: createdBy || null,
                facility_id: facilityId,
                type: "inventory",
                transaction_ref: `${reference}-CR-${i + 1}`,
              },
              { transaction },
            );
          }
        }
      }

      return {
        mixture,
        ingredientRows,
        reference,
        qtyProduced,
        totalCost,
        finalUnitCost,
      };
    });

    return res.status(201).json({
      success: true,
      message: "Mixture created successfully",
      data: {
        mixture: result.mixture,
        ingredients: result.ingredientRows,
        reference: result.reference,
        totals: {
          quantityProduced: result.qtyProduced,
          totalIngredientsCost: result.totalCost,
          unitCost: result.finalUnitCost,
        },
      },
    });
  } catch (error) {
    console.error("Error creating mixture:", error);
    if (error?.status) {
      return res.status(error.status).json({
        success: false,
        message: error.message,
      });
    }
    return res.status(500).json({
      success: false,
      message: "Error creating mixture",
      error: error.message,
    });
  }
};

// List mixtures (history) for a facility
exports.getMixtures = async (req, res) => {
  const facilityId = req.query.facilityId;
  if (!facilityId) {
    return res
      .status(400)
      .json({ success: false, message: "facilityId is required" });
  }
  try {
    const mixtures = await db.Mixture.findAll({
      where: { facility_id: facilityId },
      include: [
        {
          model: db.MixtureIngredient,
          as: "ingredients",
        },
      ],
      order: [["created_at", "DESC"]],
    });
    return res.json({ success: true, data: mixtures });
  } catch (error) {
    console.error("Error fetching mixtures:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error fetching mixtures", error: error.message });
  }
};

function getValuationPeriodBounds(valuationDate, refDate = new Date()) {
  const end = new Date(refDate);
  const y = end.getFullYear();
  const m = end.getMonth();
  const day = end.getDate();
  let start = null;
  if (!valuationDate || valuationDate === "All") {
    return { start: null, end };
  }
  switch (valuationDate) {
    case "Daily":
      start = new Date(y, m, day, 0, 0, 0, 0);
      break;
    case "Weekly": {
      const wd = end.getDay();
      const mondayOffset = wd === 0 ? -6 : 1 - wd;
      start = new Date(y, m, day + mondayOffset, 0, 0, 0, 0);
      break;
    }
    case "Monthly":
      start = new Date(y, m, 1, 0, 0, 0, 0);
      break;
    case "Yearly":
      start = new Date(y, 0, 1, 0, 0, 0, 0);
      break;
    default:
      start = null;
  }
  return { start, end };
}

function formatDateYmd(d) {
  if (!d) return null;
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

exports.getProductUnitCost = async (req, res) => {
  const { sku, facilityId } = req.params;

  if (!sku || !facilityId) {
    return res.status(400).json({ success: false, message: "sku and facilityId are required" });
  }

  try {
    const business = await db.business.findOne({
      where: { id: facilityId },
      attributes: ["inv_ev_m", "default_valuation_source", "valuation_date"],
      raw: true,
    });

    const useDefaultCost =
      business?.default_valuation_source !== "system_valuation";
    const valuationMethod = business?.inv_ev_m || "Weighted Average Cost";
    const methodKey = valuationMethod === "Weighted Average Cost" ? "WAC" : valuationMethod;

    const { start: periodStart, end: periodEnd } = getValuationPeriodBounds(
      business?.valuation_date,
      new Date(),
    );

    let unitCost = 0;

    if (useDefaultCost) {
      const product = await db.Product.findOne({
        where: { sku, facility_id: facilityId },
        attributes: ["cost_price"],
        raw: true,
      });
      unitCost = parseFloat(product?.cost_price || 0) || 0;
    } else {
      const { calculatedCostPrice } = await exports.getCurrentUnitCost(sku, facilityId, methodKey);
      unitCost = calculatedCostPrice || 0;
    }

    return res.status(200).json({
      success: true,
      data: {
        sku,
        unit_cost: unitCost,
        valuation_method: useDefaultCost ? "default_cost" : methodKey,
        default_valuation_source: business?.default_valuation_source ?? null,
        inventory_valuation_method: business?.inv_ev_m ?? null,
        valuation_frequency: business?.valuation_date ?? null,
        valuation_period_start: periodStart ? formatDateYmd(periodStart) : null,
        valuation_period_end: formatDateYmd(periodEnd),
      },
    });
  } catch (error) {
    console.error("getProductUnitCost error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch product unit cost", error: error.message });
  }
};

exports.getSemiFinished = async (req, res) => {
  const facilityId = req.query.facilityId || req.body?.facilityId;

  if (!facilityId) {
    return res.status(400).json({
      success: false,
      message: "facilityId is required",
    });
  }

  try {
    const semiFinishedProducts = await db.sequelize.query(
      `SELECT * FROM products
       WHERE facility_id = :facilityId
       AND item_type = 'Semi Finished'`,
      {
        replacements: { facilityId },
        type: db.Sequelize.QueryTypes.SELECT,
      }
    );

    let templatesByProductId = {};
    if (
      db.SemiFinishedCostingTemplate &&
      db.SemiFinishedCostingTemplateItem
    ) {
      try {
        const templates = await db.SemiFinishedCostingTemplate.findAll({
          where: { facility_id: facilityId },
          include: [
            {
              model: db.SemiFinishedCostingTemplateItem,
              as: "items",
              separate: true,
              order: [["line_index", "ASC"]],
            },
          ],
        });
        for (const t of templates) {
          const entry = {
            template_id: t.id,
            template_name: t.template_name || "Default",
            is_default: !!t.is_default,
            notes: t.notes || null,
            items: (t.items || []).map((it) => ({
              type: it.type,
              description: it.description,
              descriptionCode: it.description_code,
              accountHead: it.account_head,
              quantity: it.quantity != null ? Number(it.quantity) : 0,
              rawMaterialId: it.raw_material_id,
              rawMaterialName: it.raw_material_name,
              rawMaterialSku: it.raw_material_sku,
              otherType: it.other_type,
              rate: it.rate,
              unit_cost: it.unit_cost != null ? Number(it.unit_cost) : 0,
              percentageBasis: it.percentage_basis,
            })),
          };
          if (!templatesByProductId[t.product_id]) {
            templatesByProductId[t.product_id] = [];
          }
          templatesByProductId[t.product_id].push(entry);
        }
      } catch (e) {
        console.warn(
          "getSemiFinished: could not load semi_finished_costing tables:",
          e.message,
        );
      }
    }

    const merged = semiFinishedProducts.map((p) => ({
      ...p,
      semi_finished_costing_templates: templatesByProductId[p.id] || null,
      // Legacy single-array shape (first template only) for older clients
      semi_finished_costing_items:
        templatesByProductId[p.id]?.[0]?.items || null,
    }));

    return res.status(200).json({
      success: true,
      message: "Semi Finished products fetched successfully",
      data: merged,
    });
  } catch (error) {
    console.error("Error fetching Semi Finished products:", error);

    return res.status(500).json({
      success: false,
      message: "Error fetching Semi Finished products",
      error: error.message,
    });
  }
};

