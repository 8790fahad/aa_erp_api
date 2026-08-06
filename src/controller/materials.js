const db = require("../models");
const { nurmberGenerator } = require("./account");
const moment = require("moment");
const { v4: uuidv4 } = require("uuid");
exports.InsertMaterials = async (req, res) => {
  const {
    query_type = "insert",
    facilityId = "",
    materials = [],
    customerNo = "",
    customer_name = "",
    discount_type = "",
  } = req.body;

  // console.log(req.body, "=============>body");
  // console.log(req.body, "=============>body");
  try {
    // Step 1: Generate collection_id
    const [results] = await db.sequelize.query(
      `CALL nurmber_generator1(:in_query_type,:facilityId)`,
      {
        replacements: { in_query_type: "rm", facilityId },
      }
    );

    const code = results.rm;
    const collection_id = `RM-${code}`;

    const totalAmount = materials.reduce(
      (acc, material) => acc + Number(material.amount),
      0
    );
    const totalDiscount = materials.reduce(
      (acc, material) => acc + Number(material.discount),
      0
    );

    db.sequelize.query(
      `INSERT INTO materials(collection_id, customerNo, customer_name, date, amount, discount,discount_type, facility_id) VALUES ('${collection_id}','${customerNo}','${customer_name}','${moment().format(
        "YYYY-MM-DD"
      )}','${totalAmount}','${totalDiscount}','${discount_type}','${facilityId}')`,
      {
        replacements: {
          collection_id,
          customerNo,
          customer_name,
          date: moment().format("YYYY-MM-DD"),
          amount: totalAmount,
          discount: totalDiscount,
          discount_type,
          facilityId,
        },
      }
    );

    //    db.sequelize.query(
    //      `INSERT INTO materials(collection_id, customerNo, customer_name, date, amount, discount, facility_id) VALUES ('${collection_id}','${customerNo}','${customer_name}','${moment().format(
    //        "YYYY-MM-DD"
    //      )}','${totalAmount}','${totalDiscount}','${facilityId}')`,
    //      {
    //        replacements: {
    //          collection_id,
    //          customerNo,
    //          customer_name,
    //          date: moment().format("YYYY-MM-DD"),
    //          amount: totalAmount,
    //          discount: totalDiscount,
    //          facilityId,
    //        },
    //      }
    //    );

    // Step 2: Insert materials in sequence
    for (const material of materials) {
      const [results] = await db.sequelize.query(
        `CALL nurmber_generator1(:in_query_type,:facilityId)`,
        {
          replacements: { in_query_type: "ent", facilityId },
        }
      );

      const code = results.ent;
      const entry_id = `ENT-${code}`;
      await db.sequelize.query(
        `CALL material(
          :query_type,
          :entry_id,
          :collection_id,
          :date,
          :material_type,
          :unit,
          :amount,
          :rate,
          :quantity_in,
          :quantity_out,
          :discount,
          :facilityId,
          :product_type,
          :customerNo,
          :status
        )`,
        {
          replacements: {
            query_type,
            entry_id,
            collection_id,
            date: material.date,
            material_type: material.type_of_material,
            unit: material.unit,
            amount: material.amount,
            rate: material.rate,
            quantity_in: material.quantity_in || material.quantity,
            quantity_out: material.quantity_out || 0,
            discount: material.discount,
            facilityId,
            product_type: material.type_of_material,
            customerNo: customerNo || "",
            status: "raw_material",
          },
        }
      );
      await db.sequelize.query(
        `CALL update_number_generator(:query_type, :in_number, :facilityId)`,
        {
          replacements: {
            query_type: "ent",
            in_number: code,
            facilityId,
          },
        }
      );
    }

    // Step 3: Update number generator

    db.sequelize.query(
      `CALL update_number_generator(:query_type, :in_number, :facilityId)`,
      {
        replacements: {
          query_type: "rm",
          in_number: code,
          facilityId,
        },
      }
    );
    // Step 4: Send response
    res.json({ success: true, receiptNo: collection_id });
  } catch (error) {
    console.error("InsertMaterials error:", error);
    res.status(500).json({ success: false, error: error.message || error });
  }
};

exports.getMaterials = async (req, res) => {
  const { query_type = "select", facilityId = "" } = req.body;
  try {
    const [results] = await db.sequelize.query(
      `SELECT * FROM materials WHERE facility_id = :facilityId ORDER BY date DESC`,
      {
        replacements: {
          facilityId,
        },
      }
    );
    res.json({ success: true, results });
  } catch (error) {
    console.error("getMaterials error:", error);
    res.status(500).json({ success: false, error: error.message || error });
  }
};

exports.getDiscountMaterials = async (req, res) => {
  const { query_type = "select", facilityId = "" } = req.body;
  try {
    const [results] = await db.sequelize.query(
      `SELECT * FROM materials WHERE facility_id = :facilityId and discount > 0`,
      {
        replacements: {
          facilityId,
        },
      }
    );

    res.json({ success: true, results });
  } catch (error) {
    console.error("getMaterials error:", error);
    res.status(500).json({ success: false, error: error.message || error });
  }
};

exports.getAllCollectionMaterials = async (req, res) => {
  const { query_type = "select", facilityId = "", status = "" } = req.body;

  console.log(req.body);

  try {
    let sql = `SELECT * FROM materials_collection WHERE facilityId = :facilityId`;
    let replacements = { facilityId };

    if (query_type === "select") {
      sql += ` AND status = :status`;
      replacements.status = status;
    }

    const [results] = await db.sequelize.query(sql, { replacements });

    console.log(results, "qwwwww");

    res.json({ success: true, results });
  } catch (error) {
    console.error("getMaterials error:", error);
    res.status(500).json({ success: false, error: error.message || error });
  }
};

exports.getMaterialsByCustomerNo = async (req, res) => {
  const { customerNo = "", query_type = "get_material_by_customer_id" } =
    req.body;
  try {
    const results = await db.sequelize.query(
      `Call get_material(:customerNo, :query_type)`,
      {
        replacements: {
          customerNo,
          query_type,
        },
      }
    );

    res.json({ success: true, results });
  } catch (error) {
    console.error("getMaterials error:", error);
    res.status(500).json({ success: false, error: error.message || error });
  }
};

exports.getCollectionMaterials = async (req, res) => {
  const { customerNo = "", query_type = "get_collection_material" } = req.body;
  try {
    db.sequelize
      .query(`Call get_material(:customerNo, :query_type)`, {
        replacements: {
          customerNo,
          query_type,
        },
      })
      .then((results) => {
        res.json({ success: true, results });
      })
      .catch((error) => {
        console.error("getCollectionMaterials error:", error);
        res.status(500).json({ success: false, error: error.message || error });
      });

    // const [results] = await db.sequelize.query(
    //   `SELECT SUM(quantity_in) - SUM(quantity_out) as quantity, material_type, customerNo, collection_id,rate, entrie_id,type, unit
    //     FROM materials_entries WHERE status = :status AND customerNo = :customerNo GROUP BY material_type,type`,
    //   {
    //     replacements: {
    //       customerNo,
    //       status,
    //     },
    //   }
    // );

    // res.json({ success: true, results });
  } catch (error) {
    console.error("getMaterials error:", error);
    res.status(500).json({ success: false, error: error.message || error });
  }
};

exports.insertCollectionMaterials = async (req, res) => {
  console.log(req.body);
  const {
    query_type = "insert",
    facilityId = "",
    materials = [],
    customerNo = "",
    customerName = "",
    pass = "",
  } = req.body;
  try {
    const [results] = await db.sequelize.query(
      `CALL nurmber_generator1(:in_query_type,:facilityId)`,
      {
        replacements: { in_query_type: "rm", facilityId },
      }
    );

    const code = results.rm;
    const collection_id = `RM-${code}`;
    db.sequelize.query(
      `INSERT INTO materials_collection(collection_id, customer_id,pass, customer_name, date,status, facilityId) VALUES ('${collection_id}','${customerNo}','${pass}','${customerName}','${moment().format(
        "YYYY-MM-DD"
      )}','awaiting_approval','${facilityId}')`,
      {
        replacements: {
          collection_id,
          customerNo,
          pass,
          customer_name: customerName,
          date: moment().format("YYYY-MM-DD"),
          status: "awaiting_approval",
          facilityId,
        },
      }
    );
    let lost_materials = materials.filter(
      (material) => material.quantity_lost > 0
    );

    if (lost_materials.length > 0) {
      console.log("lost_materials", lost_materials);
      for (const material of lost_materials) {
        const [results] = await db.sequelize.query(
          `CALL nurmber_generator1(:in_query_type,:facilityId)`,
          {
            replacements: { in_query_type: "ent", facilityId },
          }
        );

        const code = results.ent;
        const entry_id = `COL-${code}`;
        await db.sequelize.query(
          `CALL material(
          :query_type,
          :entry_id,
          :collection_id,
          :date,
          :material_type,
          :unit,
          :amount,
          :rate,
          :quantity_in,
          :quantity_out,
          :discount,
          :facilityId,
          :product_type,
          :customerNo,
          :status
        )`,
          {
            replacements: {
              query_type,
              entry_id,
              collection_id,
              date: material.date,
              material_type: material.type_of_material,
              unit: material.unit,
              amount: material.amount || 0,
              rate: material.rate || 0,
              quantity_in: 0,
              quantity_out: material.quantity_lost,
              discount: material.discount || 0,
              facilityId,
              product_type: material.type,
              customerNo: customerNo || material.customerNo,
              status: "material_lost",
            },
          }
        );

        await db.sequelize.query(
          `CALL update_number_generator(:query_type, :in_number, :facilityId)`,
          {
            replacements: {
              query_type: "ent",
              in_number: code,
              facilityId,
            },
          }
        );
      }
    }

    for (const material of materials) {
      const [results] = await db.sequelize.query(
        `CALL nurmber_generator1(:in_query_type,:facilityId)`,
        {
          replacements: { in_query_type: "ent", facilityId },
        }
      );

      const code = results.ent;
      const entry_id = `COL-${code}`;
      await db.sequelize.query(
        `CALL material(
          :query_type,
          :entry_id,
          :collection_id,
          :date,
          :material_type,
          :unit,
          :amount,
          :rate,
          :quantity_in,
          :quantity_out,
          :discount,
          :facilityId,
          :product_type,
          :customerNo,
          :status
        )`,
        {
          replacements: {
            query_type,
            entry_id,
            collection_id,
            date: material.date,
            material_type: material.type_of_material,
            unit: material.unit,
            amount: material.amount || 0,
            rate: material.rate || 0,
            quantity_in: 0,
            quantity_out: material.quantity_in || material.quantity,
            discount: material.discount || 0,
            facilityId,
            product_type: material.type,
            customerNo: customerNo || material.customerNo,
            status: "awaiting_approval",
          },
        }
      );

      await db.sequelize.query(
        `CALL update_number_generator(:query_type, :in_number, :facilityId)`,
        {
          replacements: {
            query_type: "ent",
            in_number: code,
            facilityId,
          },
        }
      );
    }
    db.sequelize.query(
      `CALL update_number_generator(:query_type, :in_number, :facilityId)`,
      {
        replacements: {
          query_type: "rm",
          in_number: code,
          facilityId,
        },
      }
    );
    res.json({ success: true, results });
  } catch (error) {
    console.error("insertCollectionMaterials error:", error);
    res.status(500).json({ success: false, error: error.message || error });
  }
};

exports.approveCollection = async (req, res) => {
  const { collection_id = "", facilityId = "" } = req.body;
  try {
    const [results] = await db.sequelize.query(
      `UPDATE materials_collection SET status = 'approved' WHERE collection_id = :collection_id AND facilityId = :facilityId`,
      {
        replacements: {
          collection_id,
          facilityId,
        },
      }
    );

    // update status to approved in materials_entries where collection_id = collection_id and facilityId = facilityId
    await db.sequelize.query(
      `UPDATE materials_entries SET status = 'finished_goods' WHERE collection_id = :collection_id `,
      {
        replacements: {
          collection_id,
        },
      }
    );
    res.json({ success: true, message: "Collection approved successfully" });
  } catch (error) {
    console.error("approveCollection error:", error);
    res.status(500).json({ success: false, error: error.message || error });
  }
};

exports.InsertRecordProduction = async (req, res) => {
  const {
    query_type = "insert",
    totalOperatorFee = 0,
    totalProduced = 0,
    totalBangori = 0,
    totalFilter = 0,
    facilityId = "",
    unit = "",
    data = [],
    customerNo = "",
  } = req.body;

  console.log(req.body, "=============> Record Production body");
  console.log(data, "=============> Record Production data");

  try {
    // start transactiond
    const transaction = await db.sequelize.transaction();

    // ----------------------------------------
    // Step 1: Generate a unique collection_id
    // ----------------------------------------
    const [results] = await db.sequelize.query(
      `CALL nurmber_generator1(:in_query_type,:facilityId)`,
      {
        replacements: { in_query_type: "pro", facilityId },
      },
      transaction
    );

    const code = results.pro;
    const production_id = `PRO-${code}`;
    // ----------------------------------------
    // Step 4: Update number generator for RM collection
    // ----------------------------------------
    await db.sequelize.query(
      `CALL update_number_generator(:query_type, :in_number, :facilityId)`,
      {
        replacements: {
          query_type: "pro",
          in_number: code,
          facilityId,
        },
      },
      transaction
    );

    // ----------------------------------------
    // Step 2: Insert record into `record_production` table
    // ----------------------------------------
    await db.sequelize.query(
      `INSERT INTO record_production(production_id, customer_id, customer_name, date, team, shift, facilityId)
        VALUES (:production_id, :customerNo, :customer_name, :date, :team, :shift, :facilityId)`,
      {
        replacements: {
          production_id,
          customerNo: data[0].customerNo,
          customer_name: data[0].customerName,
          date: moment().format("YYYY-MM-DD"),
          team: data[0].name,
          shift: data[0].shift,
          facilityId,
        },
      },
      transaction
    );

    await db.sequelize.query(
      `CALL create_operator_entry(
        :query_type,
        :transaction_id,
        :team_id,
        :shift,
        :customer_id,
        :team_leader,
        :customer_name,
        :type_of_goods,
        :qty_produce,
        :bangori_produces,
        :filter_produce,
        :oprators_rate,
        :dr,
        :cr,
        :date,
        :facilityId
      )`,
      {
        replacements: {
          query_type: "new_insert",
          transaction_id: production_id,
          team_id: data[0].team_id,
          shift: data[0].shift,
          customer_id: data[0].customerNo,
          team_leader: data[0].name,
          customer_name: data[0].customerName,
          type_of_goods: data[0].type_of_material,
          qty_produce: totalProduced,
          bangori_produces: totalBangori,
          filter_produce: totalFilter,
          oprators_rate: data[0].operator_rate,
          dr: data[0].dr || 0,
          cr: totalOperatorFee || 0,
          date: moment().format("YYYY-MM-DD"),
          facilityId,
        },
      },
      transaction
    );

    // ----------------------------------------
    // Step 3: Insert each material entry
    // ----------------------------------------
    for (const record of data) {
      const types = [
        { key: `produced`, label: "produced" },
        { key: "filter", label: "filter" },
        { key: "bangori", label: "bangori" },
      ];

      console.log(types, "=============> types");

      for (const type of types) {
        const value = Number(record[type.key]);

        if (value && value > 0) {
          // -----------------------
          // Insert IN record
          // -----------------------
          const [entryIn] = await db.sequelize.query(
            `CALL nurmber_generator1(:in_query_type,:facilityId)`,
            {
              replacements: { in_query_type: "ent", facilityId },
            },
            transaction
          );
          const entryInCode = entryIn.ent;
          const entry_id_in = `ENT-${entryInCode}`;

          await db.sequelize.query(
            `CALL material(
              :query_type,
              :entry_id,
              :collection_id,
              :date,
              :material_type,
              :unit,
              :amount,
              :rate,
              :quantity_in,
              :quantity_out,
              :discount,
              :facilityId,
              :product_type,
              :customerNo,
              :status
            )`,
            {
              replacements: {
                query_type,
                entry_id: entry_id_in,
                collection_id: production_id,
                date: record.date,
                material_type: record.type_of_material,
                unit: record.unit || unit,
                amount: 0,
                rate: record.rate || 0,
                quantity_in: value,
                quantity_out: 0,
                discount: 0,
                facilityId,
                product_type: type.label,
                customerNo: record.customerNo,
                status: "finished_goods",
              },
            },
            transaction
          );

          await db.sequelize.query(
            `CALL update_number_generator(:query_type, :in_number, :facilityId)`,
            {
              replacements: {
                query_type: "ent",
                in_number: entryInCode,
                facilityId,
              },
            },
            transaction
          );

          // -----------------------
          // Insert OUT (removal) record
          // -----------------------
          const [entryOut] = await db.sequelize.query(
            `CALL nurmber_generator1(:in_query_type,:facilityId)`,
            {
              replacements: { in_query_type: "ent", facilityId },
            },
            transaction
          );
          const entry_id_out = `ENT-${entryOut.ent}`;

          await db.sequelize.query(
            `CALL material(
              :query_type,
              :entry_id,
              :collection_id,
              :date,
              :material_type,
              :unit,
              :amount,
              :rate,
              :quantity_in,
              :quantity_out,
              :discount,
              :facilityId,
              :product_type,
              :customerNo,
              :status
            )`,
            {
              replacements: {
                query_type,
                entry_id: entry_id_out,
                collection_id: production_id,
                date: record.date,
                material_type: record.type_of_material,
                unit: record.unit || unit,
                amount: 0,
                rate: record.rate || 0,
                quantity_in: 0,
                quantity_out: value,
                discount: 0,
                facilityId,
                product_type: type.label, // Optional naming
                customerNo: record.customerNo,
                status: "raw_material",
              },
            },
            transaction
          );

          await db.sequelize.query(
            `CALL update_number_generator(:query_type, :in_number, :facilityId)`,
            {
              replacements: {
                query_type: "ent",
                in_number: entryOut.ent,
                facilityId,
              },
            },
            transaction
          );
        }
      }
    }

    // ----------------------------------------
    // Step 5: Return success response
    // ----------------------------------------
    await transaction.commit();
    res.json({ success: true, production_id });
  } catch (error) {
    console.error("InsertMaterials error:", error);
    if (transaction) await transaction.rollback();
    res.status(500).json({ success: false, error: error.message || error });
  }
};

exports.CreditOperatorRate = async (req, res) => {
  const {
    totalProduced = 0,
    totalBangori = 0,
    totalFilter = 0,
    lead_name = "",
    query_type = "deposit",
    dr = "",
    cr = "",
    team_id = "",
    facilityId = "",
  } = req.body;

  console.log(req.body, "=============> Record Production body");

  try {
    // ----------------------------------------
    // Step 1: Generate a unique collection_id
    // ----------------------------------------
    const [results] = await db.sequelize.query(
      `CALL nurmber_generator1(:in_query_type,:facilityId)`,
      {
        replacements: { in_query_type: "pro", facilityId },
      }
    );

    const code = results.pro;
    const production_id = `PR0-${code}`;

    await db.sequelize.query(
      `CALL create_operator_entry(
        :query_type,
        :transaction_id,
        :team_id,
        :shift,
        :customer_id,
        :team_leader,
        :customer_name,
        :type_of_goods,
        :qty_produce,
        :bangori_produces,
        :filter_produce,
        :oprators_rate,
        :dr,
        :cr,
        :date,
        :facilityId
      )`,
      {
        replacements: {
          query_type,
          transaction_id: production_id,
          team_id: team_id,
          shift: "",
          customer_id: "",
          team_leader: lead_name,
          customer_name: "",
          type_of_goods: "",
          qty_produce: totalProduced,
          bangori_produces: totalBangori,
          filter_produce: totalFilter,
          oprators_rate: dr || 0,
          dr: dr || 0,
          cr: cr || 0,
          date: moment().format("YYYY-MM-DD"),
          facilityId,
        },
      }
    );

    // ----------------------------------------
    // Step 4: Update number generator for RM collection
    // ----------------------------------------

    console.log(code, "===================>code");

    await db.sequelize.query(
      `CALL update_number_generator(:query_type, :in_number, :facilityId)`,
      {
        replacements: {
          query_type: "pro",
          in_number: code,
          facilityId,
        },
      }
    );

    // ----------------------------------------
    // Step 5: Return success response
    // ----------------------------------------
    res.json({ success: true, production_id });
  } catch (error) {
    console.error("InsertMaterials error:", error);
    res.status(500).json({ success: false, error: error.message || error });
  }
};

exports.InsertProductionLedger = async (req, res) => {
  let {
    customerNo = "",
    customerName = "",
    subhead = "",
    sale_description = "",
    sales_head = "",
    sale_subhead = "",
  } = req.body.form;
  let {
    amount = "",
    reference_number = "",
    facilityId = "",
    data = [],
  } = req.body;

  console.log(req.body.form, "=============> Record Production body");
  console.log(req.body, "=============> Record Production body");

  try {
    // -----------------------
    // Insert General Ledger Debit
    // -----------------------

    await db.sequelize.query(
      `CALL general_ledger(
          :query_type,
          :entries_date,
          :amount,
          :destination_name,
          :head,
          :account_description,
          :facility_id,
          :refrence_number,
          :cheque_no,
          :created_by,
          :pv_no,
          :account_type,
          :balance_type,
          :payee,
          :purpose_of_payment,
          :account_subhead,
          :bank_account_id,
          :mode_of_payment,
          :type,

        )`,
      {
        replacements: {
          query_type: "tax",
          entries_date: moment().format("YYYY-MM-DD"),
          amount: amount || data.amount_paid,
          destination_name: customerName || data.bank_name,
          head: customerNo || data.bank_code,
          account_description: customerName || data.bank_name,
          facility_id: facilityId || "",
          refrence_number: reference_number || data.receiptNo,
          cheque_no: "",
          created_by: "",
          pv_no: "",
          account_type: "",
          balance_type: "",
          payee: customerName || data.bank_name,
          purpose_of_payment: "",
          account_subhead: subhead || data.bank_chart_code,
        },
      }
    );

    // -----------------------
    // Insert General Ledger credit
    // -----------------------

    await db.sequelize.query(
      `CALL general_ledger(
          :query_type,
          :entries_date,
          :amount,
          :destination_name,
          :head,
          :account_description,
          :facility_id,
          :refrence_number,
          :cheque_no,
          :created_by,
          :pv_no,
          :account_type,
          :balance_type,
          :payee,
          :purpose_of_payment,
          :account_subhead,
          :bank_account_id,
          :mode_of_payment,
          :type
        )`,
      {
        replacements: {
          query_type: "net",
          entries_date: moment().format("YYYY-MM-DD"),
          amount: amount || data.amount_paid,
          destination_name: sale_description || data.customer_name,
          head: sales_head || data.customer_no,
          account_description: sale_description || data.customer_name,
          facility_id: facilityId || "",
          refrence_number: reference_number || data.receiptNo,
          cheque_no: "",
          created_by: "",
          pv_no: "",
          account_type: "",
          balance_type: "",
          payee: customerName || data.customer_name,
          purpose_of_payment: "",
          account_subhead: sale_subhead || data.customerSubhead,
        },
      }
    );

    res.json({ success: true });
  } catch (error) {
    console.error("general_ledger error:", error);
    res.status(500).json({ success: false, error: error.message || error });
  }
};

exports.InsertCollectionProductionLedger = async (req, res) => {
  const {
    facilityId = "",
    transaction_date,
    reference_number,
    cheque,
    user_id = "",
    supplier_code = "",
    mode_of_payment = "",
    bank_account_id = "",
    // Ledger entry collections
    salesEntries = [],
    payableEntries = [],
    rawMaterialEntries = [],
    factoryWagesData = [],
    wagesPayableData = [],
    inventoryEntries = [],
    expenditureEntry = [],
    supplierEntryData = [],
    // Single ledger entries
    customerEntries,
    supplierEntry,
    bankEntry,
    expenditureEntryData,
    // Optional catch-all array for backwards compatibility
    data = [],
  } = req.body;

  if (!facilityId) {
    return res
      .status(400)
      .json({ success: false, message: "facilityId is required" });
  }

  const normalizedTransactionDate =
    transaction_date || moment().format("YYYY-MM-DD");

  const transaction = await db.sequelize.transaction();

  try {
    const normalizeEntry = (entry = {}) => {
      const amount =
        parseFloat(entry.amount ?? entry.total ?? entry.value ?? 0) || 0;
      if (!amount) return null;

      const accountDescription =
        entry.account_description ??
        entry.accountDescription ??
        entry.description ??
        "";

      const accountHead =
        entry.account_head ??
        entry.accountHead ??
        entry.account_code ??
        entry.head ??
        supplier_code ??
        "";

      if (!accountHead) return null;

      return {
        amount,
        accountDescription,
        accountHead,
        accountSubhead:
          entry.account_subhead ??
          entry.accountSubhead ??
          entry.subhead ??
          entry.account_code_subhead ??
          "",
        queryType:
          entry.query_type ??
          entry.queryType ??
          entry.type ??
          entry.transactionType ??
          "net",
        transactionType: entry.type ?? entry.transactionType ?? null,
        purposeOfPayment:
          entry.purpose_of_payment ?? entry.purposeOfPayment ?? "",
        payee: entry.payee ?? accountDescription,
        modeOfPayment: entry.mode_of_payment ?? entry.modeOfPayment ?? "",
        bankAccountId:
          entry.bank_account_id ?? entry.bankAccountId ?? bank_account_id ?? "",
        accountType: entry.account_type ?? entry.accountType ?? "",
        balanceType: entry.balance_type ?? entry.balanceType ?? "",
        referenceNumber: entry.reference_number ?? reference_number ?? "",
        chequeNo: entry.cheque ?? entry.cheque_no ?? cheque ?? "",
        transactionDate:
          entry.transactionDate ??
          entry.transaction_date ??
          normalizedTransactionDate,
        createdBy: entry.created_by ?? user_id ?? "SYSTEM",
        mode: entry.mode ?? entry.modeOfPayment ?? mode_of_payment ?? "",
      };
    };

    const allEntries = [];

    const appendEntries = (entries) => {
      if (Array.isArray(entries)) {
        entries.forEach((entry) => {
          const normalized = normalizeEntry(entry);
          if (normalized) allEntries.push(normalized);
        });
      } else if (entries && typeof entries === "object") {
        const normalized = normalizeEntry(entries);
        if (normalized) allEntries.push(normalized);
      }
    };

    appendEntries(salesEntries);
    appendEntries(payableEntries);
    appendEntries(rawMaterialEntries);
    appendEntries(factoryWagesData);
    appendEntries(wagesPayableData);
    appendEntries(inventoryEntries);
    appendEntries(expenditureEntry);
    appendEntries(supplierEntryData);
    appendEntries(customerEntries);
    appendEntries(supplierEntry);
    appendEntries(bankEntry);
    appendEntries(expenditureEntryData);
    appendEntries(data);

    // if (!allEntries.length) {
    //   await transaction.rollback();
    //   return res.status(400).json({
    //     success: false,
    //     message: "No ledger entries supplied",
    //   });
    // }

    for (const entry of allEntries) {
      await db.sequelize.query(
        `CALL general_ledger(
          :query_type,
          :entries_date,
          :amount,
          :destination_name,
          :head,
          :account_description,
          :facility_id,
          :refrence_number,
          :cheque_no,
          :created_by,
          :pv_no,
          :account_type,
          :balance_type,
          :payee,
          :purpose_of_payment,
          :account_subhead,
          :bank_account_id,
          :mode_of_payment,
          :type
        )`,
        {
          replacements: {
            query_type: entry.queryType,
            entries_date: entry.transactionDate,
            amount: entry.amount,
            destination_name: entry.accountDescription,
            head: entry.accountHead,
            account_description: entry.accountDescription,
            facility_id: facilityId,
            refrence_number: entry.referenceNumber,
            cheque_no: entry.chequeNo,
            created_by: entry.createdBy,
            pv_no: "",
            account_type: entry.accountType,
            balance_type: entry.balanceType,
            payee: entry.payee,
            purpose_of_payment: entry.purposeOfPayment,
            account_subhead: entry.accountSubhead,
            bank_account_id: entry.bankAccountId,
            mode_of_payment: entry.modeOfPayment || entry.mode || "",
            type: entry.transactionType,
          },
          transaction,
        }
      );
    }

    // Commit transaction
    await transaction.commit();

    console.log(allEntries, "Ledger entries inserted successfully");

    res.json({
      success: true,
      message: "Ledger entries inserted successfully",
      entries_processed: allEntries.length,
    });
  } catch (error) {
    // Rollback transaction on error
    if (
      transaction &&
      transaction.finished !== "commit" &&
      transaction.finished !== "rollback"
    ) {
      try {
        await transaction.rollback();
      } catch (rollbackErr) {
        console.error("Rollback failed:", rollbackErr);
      }
    }

    console.error("general_ledger error:", error);
    res.status(500).json({
      success: false,
      error: error.message || error,
      message: "Failed to insert ledger entries",
    });
  }
};

exports.InsertDepositLedger = async (req, res) => {
  let { facilityId = "", data = [] } = req.body;

  // Generate unique UUIDs for the transaction
  const debitId = uuidv4();
  const creditId = uuidv4();

  try {
    // -----------------------
    // Insert General Ledger Debit (Customer Account)
    // -----------------------

    await db.sequelize.query(
      `INSERT INTO general_ledger (
          id,
          transactionDate,
          accountCode,
          accountSubhead,
          debitAmount,
          creditAmount,
          accountDescription,
          transactionDescription,
          referenceNumber,
          purposeOfPayment,
          createdBy,
          facilityId,
          createdAt,
          updatedAt,
          status,
          transactionType,
          transactionRef
        ) VALUES (
          :id,
          :transaction_date,
          :account_code,
          :account_subhead,
          :dr,
          :cr,
          :account_description,
          :transaction_description,
          :reference_number,
          :purpose_of_payment,
          :created_by,
          :facility_id,
          :created_at,
          :updated_at,
          :status,
          :type,
          :transaction_ref
        )`,
      {
        replacements: {
          id: debitId,
          transaction_date: moment().format("YYYY-MM-DD"),
          account_code: data.wages_account_head || null, // Use NULL to avoid foreign key constraint
          account_subhead: data.wages_account_subhead || "CUSTOMER_DEPOSIT",
          dr: data.amount_paid || 0,
          cr: 0,
          account_description: data.wages_account_name || "Customer Deposit",
          transaction_description: `Customer Deposit - ${data.wages_account_name}`,
          reference_number: data.receipt_no || "",
          purpose_of_payment: data.narration || "",
          created_by: "",
          facility_id: facilityId || "",
          created_at: moment().format("YYYY-MM-DD HH:mm:ss"),
          updated_at: moment().format("YYYY-MM-DD HH:mm:ss"),
          status: "paid",
          type: "bank",
          transaction_ref: data.receipt_no || "",
        },
      }
    );

    // -----------------------
    // Insert General Ledger Credit (Bank Account)
    // -----------------------

    await db.sequelize.query(
      `INSERT INTO general_ledger (
          id,
          transactionDate,
          accountCode,
          accountSubhead,
          debitAmount,
          creditAmount,
          accountDescription,
          transactionDescription,
          referenceNumber,
          purposeOfPayment,
          createdBy,
          facilityId,
          createdAt,
          updatedAt,
          status,
          transactionType,
          transactionRef
        ) VALUES (
          :id,
          :transaction_date,
          :account_code,
          :account_subhead,
          :dr,
          :cr,
          :account_description,
          :transaction_description,
          :reference_number,
          :purpose_of_payment,
          :created_by,
          :facility_id,
          :created_at,
          :updated_at,
          :status,
          :type,
          :transaction_ref
        )`,
      {
        replacements: {
          id: creditId,
          transaction_date: moment().format("YYYY-MM-DD"),
          account_code: data.bank_code || null, // Use NULL to avoid foreign key constraint
          account_subhead: data.bank_chart_code || "BANK_ACCOUNT",
          dr: 0,
          cr: data.amount_paid || 0,
          account_description: data.bank_name || "Bank Account",
          transaction_description: `Customer Deposit Payment - ${data.bank_name}`,
          reference_number: data.receipt_no || "",
          purpose_of_payment: data.narration || "",
          created_by: "",
          facility_id: facilityId || "",
          created_at: moment().format("YYYY-MM-DD HH:mm:ss"),
          updated_at: moment().format("YYYY-MM-DD HH:mm:ss"),
          status: "paid",
          type: "bank",
          transaction_ref: data.receipt_no || "",
        },
      }
    );

    res.json({
      success: true,
      message: "Deposit ledger entries created successfully",
      results: [
        {
          debit_id: debitId,
          credit_id: creditId,
          transaction_ref: data.receipt_no || "",
          amount: data.amount_paid || 0,
          customer_name: data.wages_account_name || "",
          transaction_date: moment().format("YYYY-MM-DD"),
        },
      ],
    });
  } catch (error) {
    console.error("InsertDepositLedger error:", error);
    res.status(500).json({ success: false, error: error.message || error });
  }
};

exports.InsertMaterialLedger = async (req, res) => {
  const {
    amount = "",
    reference_number = "",
    facilityId = "",
    data = [],
  } = req.body;

  console.log(req.body.form, "=============> Record Production body");
  console.log(req.body, "=============> Record Production body");

  try {
    // -----------------------
    // Insert General Ledger Credit
    // -----------------------

    await db.sequelize.query(
      `CALL general_ledger(
          :query_type,
          :entries_date,
          :amount,
          :destination_name,
          :head,
          :account_description,
          :facility_id,
          :refrence_number,
          :cheque_no,
          :created_by,
          :pv_no,
          :account_type,
          :balance_type,
          :payee,
          :purpose_of_payment,
          :account_subhead,
          :bank_account_id,
          :mode_of_payment,
          :type
        )`,
      {
        replacements: {
          query_type: data.query_type_1 || data.second_query_type,
          entries_date: moment().format("YYYY-MM-DD"),
          amount: data.totalAmount || 0,
          destination_name: data.rawMaterialDescription || "",
          head: data.rawMaterialCode || "",
          account_description: data.rawMaterialDescription || "",
          facility_id: facilityId || "",
          refrence_number: data.receiptNo || "",
          cheque_no: "",
          created_by: "",
          pv_no: "",
          account_type: "",
          balance_type: "",
          payee: data.rawMaterialDescription || "",
          purpose_of_payment: "",
          account_subhead: data.rawMaterialChartCode || "",
        },
      }
    );

    // -----------------------
    // Insert General Ledger Debit
    // -----------------------

    await db.sequelize.query(
      `CALL general_ledger(
          :query_type,
          :entries_date,
          :amount,
          :destination_name,
          :head,
          :account_description,
          :facility_id,
          :refrence_number,
          :cheque_no,
          :created_by,
          :pv_no,
          :account_type,
          :balance_type,
          :payee,
          :purpose_of_payment,
          :account_subhead,
          :bank_account_id,
          :mode_of_payment,
          :type
        )`,
      {
        replacements: {
          query_type: data.query_type_2 || data.first_query_type,
          entries_date: moment().format("YYYY-MM-DD"),
          amount: data.totalAmount || 0,
          destination_name: data.payableDescription || "",
          head: data.payableCode || "",
          account_description: data.payableDescription || "",
          facility_id: facilityId || "",
          refrence_number: data.receiptNo || "",
          cheque_no: "",
          created_by: "",
          pv_no: "",
          account_type: "",
          balance_type: "",
          payee: data.payableDescription || "",
          purpose_of_payment: "",
          account_subhead: data.payableChartCode || "",
        },
      }
    );

    res.json({ success: true });
  } catch (error) {
    console.error("general_ledger error:", error);
    res.status(500).json({ success: false, error: error.message || error });
  }
};

exports.InsertConsumptionRecord = async (req, res) => {
  const { query_type = "", facilityId = "", data = [] } = req.body;

  console.log(data, "=============> data");

  try {
    // ----------------------------------------
    // Step 1: Log each material consumption
    // ----------------------------------------
    for (const record of data) {
      const consumedQty = Number(record.consumed);
      if (!consumedQty || consumedQty <= 0) continue;

      await db.sequelize.query(
        `CALL add_consumption(
          :query_type,
          :date,
          :type,
          :unit,
          :rate,
          :unit_consume,
          :total_amount,
          :shift,
          :facilityId
        )`,
        {
          replacements: {
            query_type,
            date: record.date,
            type: record.energy,
            unit: record.unit,
            rate: record.rate,
            unit_consume: record.consumed,
            total_amount: record.rate * record.consumed,
            shift: record.shift,
            facilityId,
          },
        }
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error("InsertConsumptionRecord error:", error);
    res.status(500).json({ success: false, error: error.message || error });
  }
};

exports.getRecordProduction = async (req, res) => {
  const { facilityId = "" } = req.body;
  try {
    const [results] = await db.sequelize.query(
      `SELECT * FROM record_production WHERE facilityId = :facilityId`,
      {
        replacements: {
          facilityId,
        },
      }
    );

    res.json({ success: true, results });
  } catch (error) {
    console.error("getMaterials error:", error);
    res.status(500).json({ success: false, error: error.message || error });
  }
};

exports.getMaterialById = async (req, res) => {
  const { id } = req.params;
  try {
    const [results] = await db.sequelize.query(
      `SELECT * FROM materials WHERE id = :id and facilityId=:facilityId`,
      {
        replacements: {
          id,
          facilityId,
        },
      }
    );

    res.json({ success: true, results });
  } catch (error) {
    console.error("getMaterialById error:", error);
    res.status(500).json({ success: false, error: error.message || error });
  }
};

exports.getMaterialByCollectionId = async (req, res) => {
  const { collection_id, facilityId } = req.params;
  try {
    const [results] = await db.sequelize.query(
      `SELECT * FROM materials_entries WHERE collection_id = :collection_id and facilityId = :facilityId`,
      {
        replacements: {
          collection_id,
          facilityId,
        },
      }
    );

    res.json({ success: true, results });
  } catch (error) {
    console.error("getMaterialByCollectionId error:", error);
    res.status(500).json({ success: false, error: error.message || error });
  }
};

exports.getProductionById = async (req, res) => {
  const { collection_id, facilityId } = req.params;
  try {
    const [results] = await db.sequelize.query(
      `SELECT * FROM materials_entries WHERE status = 'finished_goods' AND collection_id = :collection_id and facilityId=:facilityId`,
      {
        replacements: {
          collection_id,
          facilityId,
        },
      }
    );

    res.json({ success: true, results });
  } catch (error) {
    console.error("getProductionById error:", error);
    res.status(500).json({ success: false, error: error.message || error });
  }
};

exports.InsertTeamSetup = async (req, res) => {
  const { facilityId = "", data = [] } = req.body;

  console.log("Incoming Team Setup Data:", req.body);

  try {
    // Step 1: Generate unique `team_id` for this group
    const [codeGen] = await db.sequelize.query(
      `CALL nurmber_generator1(:in_query_type,:facilityId)`,
      {
        replacements: { in_query_type: "tem", facilityId },
      }
    );

    const generatedCode = codeGen.tem;
    const team_id = `TEM-${generatedCode}`;

    // Step 2: Insert each team member
    for (const member of data) {
      await db.sequelize.query(
        `INSERT INTO team_table (
          team_id,
          user_id,
          name,
          team_position,
          status,
          facilityId
        ) VALUES (
          :team_id,
          :user_id,
          :name,
          :team_position,
          :status,
          :facilityId
        )`,
        {
          replacements: {
            team_id,
            user_id: member.user_id,
            name: `${member.firstname} ${member.lastname}`,
            team_position: member.team_position,
            status: member.status,
            facilityId,
          },
        }
      );
    }

    // Step 3: Update number generator
    await db.sequelize.query(
      `CALL update_number_generator(:query_type, :in_number, :facilityId)`,
      {
        replacements: {
          query_type: "tem",
          in_number: generatedCode,
          facilityId,
        },
      }
    );

    // Step 4: Respond
    res.json({
      success: true,
      message: "Team setup successfully saved.",
      team_id,
    });
  } catch (error) {
    console.error("InsertTeamSetup error:", error);
    res.status(500).json({ success: false, error: error.message || error });
  }
};

exports.getTeamSetup = async (req, res) => {
  const { facilityId } = req.body;
  try {
    const [results] = await db.sequelize.query(
      `SELECT * FROM team_table WHERE facilityId = :facilityId and status = 'active' and team_position = 'Team Leader'`,
      {
        replacements: {
          facilityId,
        },
      }
    );

    res.json({ success: true, results });
  } catch (error) {
    console.error("getTeamSetup error:", error);
    res.status(500).json({ success: false, error: error.message || error });
  }
};

exports.getTeamMembers = async (req, res) => {
  const { teamId } = req.body;
  try {
    const [results] = await db.sequelize.query(
      `SELECT * FROM team_table WHERE team_id = :teamId AND status = 'active'`,
      { replacements: { teamId } }
    );
    res.json({ success: true, results });
  } catch (error) {
    console.error("getTeamMembers error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.deleteTeam = async (req, res) => {
  const { team_id, facilityId } = req.query;

  try {
    const [results] = await db.sequelize.query(
      `DELETE FROM team_table WHERE team_id = :team_id AND facilityId = :facilityId`,
      {
        replacements: { team_id, facilityId },
      }
    );

    res.json({ success: true, message: "Team deleted successfully", results });
  } catch (error) {
    console.error("Team delete error:", error);
    res.status(500).json({ success: false, error: error.message || error });
  }
};

exports.updateTeamMembers = async (req, res) => {
  const { teamId, facilityId, data = [] } = req.body;

  if (!teamId || !facilityId || !Array.isArray(data)) {
    return res.status(400).json({
      success: false,
      message: "teamId, facilityId, and data are required.",
    });
  }

  const transaction = await db.sequelize.transaction();

  try {
    // Delete existing members for this team
    await db.sequelize.query(
      `DELETE FROM team_table WHERE team_id = :teamId AND facilityId = :facilityId`,
      {
        replacements: { teamId, facilityId },
        transaction,
      }
    );

    // Insert new members
    for (const member of data) {
      await db.sequelize.query(
        `INSERT INTO team_table
          (team_id, name, user_id, team_position, status, facilityId)
         VALUES
          (:teamId, :name, :user_id, :team_position, :status, :facilityId)`,
        {
          replacements: {
            teamId,
            name: member.name || member.member || null,
            user_id: member.user_id || member.userId || null,
            team_position: member.team_position || member.position || null,
            status: member.status || "",
            facilityId,
          },
          transaction,
        }
      );
    }

    await transaction.commit();

    res.json({ success: true, message: "Team updated successfully." });
  } catch (error) {
    await transaction.rollback();
    console.error("updateTeamMembers error:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while updating team members.",
      error: error.message || error,
    });
  }
};

exports.InsertRateSetup = async (req, res) => {
  const { facilityId = "", data = [] } = req.body;

  console.log("Incoming Rate Setup Data:", req.body);

  try {
    // Step 1: Generate unique `rate_id` for this group

    // Step 2: Insert each team member
    for (const member of data) {
      const [codeGen] = await db.sequelize.query(
        `CALL nurmber_generator1(:in_query_type,:facilityId)`,
        {
          replacements: { in_query_type: "rate", facilityId },
        }
      );

      const generatedCode = codeGen.rate;
      const rate_id = `RATE-${generatedCode}`;
      await db.sequelize.query(
        `INSERT INTO rate_table (
          rate_id,
          rate,
          amount,
          rate_type,
          customer_type,
          status,
          facilityId
        ) VALUES (
          :rate_id,
          :rate,
          :amount,
          :rate_type,
          :customer_type,
          :status,
          :facilityId
        )`,
        {
          replacements: {
            rate_id,
            rate: member.rate,
            amount: member.amount,
            rate_type: member.rate_type,
            customer_type: member.customer_type,
            status: member.status,
            facilityId,
          },
        }
      );
      await db.sequelize.query(
        `CALL update_number_generator(:query_type, :in_number,:facilityId)`,
        {
          replacements: {
            query_type: "rate",
            in_number: generatedCode,
            facilityId,
          },
        }
      );
    }

    // Step 3: Update number generator

    // Step 4: Respond
    res.json({
      success: true,
      message: "Rate setup successfully saved.",
    });
  } catch (error) {
    console.error("InsertRateSetup error:", error);
    res.status(500).json({ success: false, error: error.message || error });
  }
};

exports.EditRateSetup = async (req, res) => {
  const {
    facilityId = "",
    rate_id,
    rate = "",
    amount = 0,
    rate_type = "",
    customer_type = "",
    status = "",
  } = req.body;

  console.log("Incoming Edit Rate Data:", req.body);

  try {
    if (!rate_id || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: rate_id and facilityId",
      });
    }

    const [result] = await db.sequelize.query(
      `UPDATE rate_table
       SET
         rate = :rate,
         amount = :amount,
         rate_type = :rate_type,
         customer_type = :customer_type,
         status = :status
       WHERE rate_id = :rate_id AND facilityId = :facilityId`,
      {
        replacements: {
          rate,
          amount,
          rate_type,
          customer_type,
          status,
          rate_id,
          facilityId,
        },
      }
    );

    res.json({
      success: true,
      message: "Rate setup successfully updated.",
    });
  } catch (error) {
    console.error("EditRateSetup error:", error);
    res.status(500).json({ success: false, error: error.message || error });
  }
};

exports.getRateSetup = async (req, res) => {
  const { facilityId } = req.body;
  try {
    const [results] = await db.sequelize.query(
      `SELECT * FROM rate_table WHERE facilityId = :facilityId `,
      {
        replacements: {
          facilityId,
        },
      }
    );

    res.json({ success: true, results });
  } catch (error) {
    console.error("getRateSetup error:", error);
    res.status(500).json({ success: false, error: error.message || error });
  }
};

exports.deleteRate = async (req, res) => {
  const { rate_id, facilityId } = req.query;

  try {
    const [results] = await db.sequelize.query(
      `DELETE FROM rate_table WHERE rate_id = :rate_id AND facilityId = :facilityId`,
      {
        replacements: { rate_id, facilityId },
      }
    );

    res.json({ success: true, message: "Rate deleted successfully", results });
  } catch (error) {
    console.error("Rate delete error:", error);
    res.status(500).json({ success: false, error: error.message || error });
  }
};

// ==================== DISCOUNT OPERATIONS ====================

exports.InsertDiscountSetup = async (req, res) => {
  const {
    facilityId = "",
    discountName = "",
    discountType = "",
    value = 0,
    status = "active",
    discountAccountHead = "",
    minOrderAmount = 0,
    customerType = "",
  } = req.body;

  console.log("Incoming Discount Setup Data:", req.body);

  try {
    if (!facilityId || !discountName || !discountType || !discountAccountHead) {
      return res.status(400).json({
        success: false,
        message:
          "facilityId, discountName, discountType and discountAccountHead are required",
      });
    }

    const numericValue = parseFloat(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return res.status(400).json({
        success: false,
        message: "value must be a number greater than 0",
      });
    }
    if (discountType === "Percentage" && numericValue > 100) {
      return res.status(400).json({
        success: false,
        message: "Percentage discount cannot exceed 100",
      });
    }

    const minOrder = parseFloat(minOrderAmount) || 0;
    if (minOrder < 0) {
      return res.status(400).json({
        success: false,
        message: "minOrderAmount cannot be negative",
      });
    }

    await db.sequelize.query(
      `INSERT INTO discount_table (
        discount_name,
        discount_type,
        value,
        status,
        discount_account_head,
        facilityId,
        min_order_amount,
        customer_type,
        created_at,
        updated_at
      ) VALUES (
        :discount_name,
        :discount_type,
        :value,
        :status,
        :discount_account_head,
        :facilityId,
        :min_order_amount,
        :customer_type,
        NOW(),
        NOW()
      )`,
      {
        replacements: {
          discount_name: String(discountName).trim(),
          discount_type: discountType,
          value: numericValue,
          status: status === "disabled" ? "disabled" : "active",
          discount_account_head: discountAccountHead,
          facilityId,
          min_order_amount: minOrder,
          customer_type: customerType ? String(customerType).trim() : null,
        },
      },
    );

    res.json({
      success: true,
      message: "Discount setup successfully saved.",
    });
  } catch (error) {
    console.error("InsertDiscountSetup error:", error);
    const msg = String(error.message || error);
    if (msg.includes("uq_discount_name_per_facility")) {
      return res.status(409).json({
        success: false,
        message: "A discount with this name already exists for this business",
      });
    }
    if (msg.includes("fk_discount_account_head")) {
      return res.status(400).json({
        success: false,
        message: "Invalid discount account head for this business",
      });
    }
    res.status(500).json({ success: false, error: error.message || error });
  }
};

exports.EditDiscountSetup = async (req, res) => {
  const {
    facilityId = "",
    discountId,
    discountName = "",
    discountType = "",
    value = 0,
    status = "",
    discountAccountHead = "",
    minOrderAmount = 0,
    customerType = "",
  } = req.body;

  console.log("Incoming Edit Discount Data:", req.body);

  try {
    if (!discountId || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: discountId and facilityId",
      });
    }

    const numericValue = parseFloat(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return res.status(400).json({
        success: false,
        message: "value must be a number greater than 0",
      });
    }
    if (discountType === "Percentage" && numericValue > 100) {
      return res.status(400).json({
        success: false,
        message: "Percentage discount cannot exceed 100",
      });
    }

    const minOrder = parseFloat(minOrderAmount) || 0;
    if (minOrder < 0) {
      return res.status(400).json({
        success: false,
        message: "minOrderAmount cannot be negative",
      });
    }

    const [result] = await db.sequelize.query(
      `UPDATE discount_table
       SET
         discount_name = :discount_name,
         discount_type = :discount_type,
         value = :value,
         status = :status,
         discount_account_head = :discount_account_head,
         min_order_amount = :min_order_amount,
         customer_type = :customer_type,
         updated_at = NOW()
       WHERE discount_id = :discount_id AND facilityId = :facilityId`,
      {
        replacements: {
          discount_name: String(discountName).trim(),
          discount_type: discountType,
          value: numericValue,
          status: status === "disabled" ? "disabled" : "active",
          discount_account_head: discountAccountHead,
          min_order_amount: minOrder,
          customer_type: customerType ? String(customerType).trim() : null,
          discount_id: discountId,
          facilityId,
        },
      },
    );

    res.json({
      success: true,
      message: "Discount setup successfully updated.",
      results: result,
    });
  } catch (error) {
    console.error("EditDiscountSetup error:", error);
    const msg = String(error.message || error);
    if (msg.includes("uq_discount_name_per_facility")) {
      return res.status(409).json({
        success: false,
        message: "A discount with this name already exists for this business",
      });
    }
    if (msg.includes("fk_discount_account_head")) {
      return res.status(400).json({
        success: false,
        message: "Invalid discount account head for this business",
      });
    }
    res.status(500).json({ success: false, error: error.message || error });
  }
};

exports.getDiscountSetup = async (req, res) => {
  const { facilityId } = req.body;
  try {
    const [results] = await db.sequelize.query(
      `SELECT
         discount_id,
         discount_name,
         discount_type,
         value,
         status,
         facilityId,
         discount_account_head,
         min_order_amount,
         customer_type,
         created_at,
         updated_at
       FROM discount_table
       WHERE facilityId = :facilityId
       ORDER BY discount_name ASC`,
      {
        replacements: {
          facilityId,
        },
      },
    );

    res.json({ success: true, results });
  } catch (error) {
    console.error("getDiscountSetup error:", error);
    res.status(500).json({ success: false, error: error.message || error });
  }
};

exports.deleteDiscount = async (req, res) => {
  const { discountId, facilityId } = req.query;

  try {
    const [results] = await db.sequelize.query(
      `DELETE FROM discount_table WHERE discount_id = :discountId AND facilityId = :facilityId`,
      {
        replacements: { discountId, facilityId },
      }
    );

    res.json({
      success: true,
      message: "Discount deleted successfully",
      results,
    });
  } catch (error) {
    console.error("Discount delete error:", error);
    res.status(500).json({ success: false, error: error.message || error });
  }
};
