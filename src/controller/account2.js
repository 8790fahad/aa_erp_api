const moment = require("moment");
const db = require("../models");

exports.getPurchaseOrderReport = (req, res) => {
  let today = moment().format("YYYY-MM-DD");
  const { from = today, to = today } = req.query;

  db.sequelize
    .query("CALL get_purchase_order_report(:from,:to)", {
      replacements: {
        from,
        to,
      },
    })
    .then((results) => {
      res.json({ results });
    })
    .catch((err) => {
      res.status(500).json({ err });
      console.log(err);
    });
};

exports.getPurchaseOrderTransactionSummary = (req, res) => {
  const { receipt_no = "" } = req.query;

  db.sequelize
    .query("CALL get_purchase_order_tx_summary(:receipt_no)", {
      replacements: {
        receipt_no,
      },
    })
    .then((results) => {
      res.json({ results });
    })
    .catch((err) => {
      res.status(500).json({ err });
      console.log(err);
    });
};

exports.getCustomerDetails = async (req, res) => {
  const {
    customer = "",
    customerNo = "",
    query_type = "select",
    storeName = "Show All Stores",
    account_head = "",
    subhead = "",
    address = "",
    phone = "",
    email = "",
    fullname = "",
    store_name = "",
    status = "",
    credit_limit = 0,
    facilityId = "",
    customer_type = "",
  } = req.query;

  try {
    let results = [];

    switch (query_type) {
      case "customers": {
        const facilityForQuery = customer || facilityId;
        if (!facilityForQuery) {
          return res.status(400).json({
            success: false,
            error: "Missing facility identifier",
            message: "Provide customer (facility id) in the query string",
          });
        }
        // Get all customers with balance calculation using SQL query
        const customerBalanceQuery = `
          SELECT
  c.customerNo,
  c.fullname,
  c.address,
  c.phone,
  c.email,
  COALESCE(gl.balance, 0) AS balance
FROM customers c
LEFT JOIN (
  SELECT
    transaction_ref AS customerNo,
    COALESCE(SUM(dr), 0) - COALESCE(SUM(cr), 0) AS balance
  FROM general_ledger
  WHERE facility_id = :facilityId
  GROUP BY transaction_ref
) gl ON c.customerNo = gl.customerNo
WHERE c.facilityId = :facilityId
ORDER BY c.fullname ASC;

        `;

        results = await db.sequelize.query(customerBalanceQuery, {
          replacements: { facilityId: facilityForQuery },
          type: db.sequelize.QueryTypes.SELECT,
        });
        break;
      }

      case "customer_by_id":
        // Get specific customer by ID
        const customerById = await db.Customer.findOne({
          where: {
            customerNo: customerNo,
            facilityId: facilityId,
          },
        });
        results = customerById ? [customerById] : [];
        break;

      case "create":
        // Create new customer
        const newCustomer = await db.Customer.create({
          customerNo: customerNo,
          account_head: account_head,
          subhead: subhead,
          address: address,
          phone: phone,
          email: email,
          fullname: fullname,
          store_name: store_name,
          status: status || "pending",
          credit_limit: credit_limit,
          facilityId: customer || facilityId,
          customer_type: customer_type,
          created_by: "SYSTEM",
        });
        results = [newCustomer];
        break;

      case "update":
        // Update existing customer
        const updatedCustomer = await db.Customer.update(
          {
            address: address,
            phone: phone,
            email: email,
            fullname: fullname,
            customer_type: customer_type,
          },
          {
            where: {
              customerNo: customerNo,
              facilityId: customer || facilityId,
            },
            returning: true,
          }
        );
        results = updatedCustomer[1]; // Sequelize returns [count, updatedRows]
        break;

      default:
        // Default: get all customers
        results = await db.Customer.findAll({
          where: {
            facilityId: customer || facilityId,
          },
        });
    }

    res.json({ success: true, results });
  } catch (err) {
    console.error("getCustomerDetails error:", err);
    res.status(500).json({
      success: false,
      error: err.message,
      message: "Error fetching customer details",
    });
  }
};

exports.getAllExpenditure = (req, res) => {
  const { query_type = "" } = req.query;
  const {
    account_name = "",
    facilityId = 0,
    account_number = 0,
    bank_name = "",
    bank_code = 0,
    account_type = "",
  } = req.body;
  console.log(req.query);

  db.sequelize
    .query(
      `
    CALL new_expenditure(
      :query_type,
      :facilityId,
      :account_name,
      :account_number,
      :bank_name,
      :bank_code,
      :account_type
    )`,
      {
        replacements: {
          query_type,
          facilityId,
          account_name,
          account_number,
          bank_name,
          bank_code,
          account_type,
        },
      }
    )
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      res.status(500).json({ err });
      console.log(err);
    });
};

exports.taxes = (req, res) => {
  console.log("body", req.body);
  const {
    query_type = "select",
    tax_name = "",
    rate = "",
    rate_type = "",
    tax_type = "",
    id = "",
  } = req.body;

  db.sequelize
    .query(
      `CALL taxes (
        :query_type,
        :tax_name,
        :rate,
        :rate_type,
        :tax_type,
        :id
      )`,
      {
        replacements: {
          query_type,
          id,
          tax_name,
          rate,
          rate_type,
          tax_type,
        },
      }
    )
    .then((results) => {
      res.json({
        success: true,
        results,
      });
    })
    .catch((err) => {
      res.json({
        success: false,
        err,
      });
      console.log(err);
    });
};

exports.CreateNewBanks = async (req, res) => {
  const { query_type = "" } = req.query;
  const { store, facilityId, banks = [] } = req.body;

  if (!Array.isArray(banks) || banks.length === 0) {
    return res
      .status(400)
      .json({ error: "Banks array is required and cannot be empty" });
  }

  try {
    const results = [];

    for (const bank of banks) {
      const {
        account_name = "",
        account_number = "",
        bank_name = "",
        bank_code = "",
        account_type = "",
      } = bank;

      const result = await db.sequelize.query(
        `
        CALL new_expenditure(
          :query_type,
          :facilityId,
          :account_name,
          :account_number,
          :bank_name,
          :bank_code,
          :account_type
        )`,
        {
          replacements: {
            query_type,
            facilityId,
            account_name,
            account_number,
            bank_name,
            bank_code,
            account_type,
          },
        }
      );

      results.push(result);
    }

    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
    console.log(err);
  }
};

exports.getUserStatusRoles = (req, res) => {
  const { roles = "" } = req.query;

  db.sequelize
    .query("CALL get_status_roles(:in_roles)", {
      replacements: { in_roles: roles },
    })
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      res.status(500).json({ err });
      console.log(err);
    });
};

exports.getAllReport = (req, res) => {
  let today = moment().format("YYYY-MM-DD");
  const {
    from = today,
    to = today,
    facilityId = "",
    query_type = "",
  } = req.query;

  db.sequelize
    .query(
      "CALL reports_dashboard(:in_date_from,:in_date_to,:in_facilityid,:query_type)",
      {
        replacements: {
          in_date_from: from,
          in_date_to: to,
          in_facilityid: facilityId,
          query_type,
        },
      }
    )
    .then((results) => {
      res.json({ results });
    })
    .catch((err) => {
      res.status(500).json({ err });
      console.log(err);
    });
};
