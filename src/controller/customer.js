import { getAndUpdateNumber } from "../services/numberGen";

const db = require("../models");
const { Op } = require("sequelize");
const { parseAmount } = require("../utils/parseAmount");
const { validatePostingDate } = require("../utils/validatePostingDate");
const {
  normalizeNigerianPhone,
  isValidNigerianPhone,
  NIGERIAN_PHONE_HINT,
} = require("../utils/nigerianPhone");
const moment = require("moment");
const { resolveDefaultBranchId, resolveRequiredBranchId } = require("../services/branchResolver");
const { STORE_ENTRY_TYPE } = require("../constants/storeEntryTypes");
let today = moment().format("YYYY-MM-DD");
const {
  Customer,
  Invoice,
  GeneralLedger,
  Account,
  CustomerEntry,
  Business,
} = require("../models");
const { getCustomerLedgerBalances } = require("../utils/customerLedgerBalances");
const {
  isWalkInCustomer,
  normalizeCustomerKind,
  parseCreditLimitValue,
} = require("../utils/customerKind");

// Get customer entries by receiptNo
exports.getCustomerEntriesByReceiptNo = async (req, res) => {
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

    // Fetch customer entries from database
    const entries = await CustomerEntry.findAll({
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
    console.error("Error fetching customer entries by receiptNo:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching customer entries",
      error: error.message,
    });
  }
};

/** Deposit / advance history for a customer (customer_entries, type deposit). */
exports.getCustomerAdvanceHistory = async (req, res) => {
  try {
    const { customerNo, facilityId, limit = 30 } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }
    if (!customerNo || !String(customerNo).trim()) {
      return res.status(400).json({
        success: false,
        message: "customerNo is required",
      });
    }

    const customerKey = String(customerNo).trim();
    const rowLimit = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);

    const entries = await CustomerEntry.findAll({
      where: {
        customerNo: customerKey,
        facilityId,
        type: "deposit",
      },
      order: [["created_at", "DESC"]],
      limit: rowLimit,
      raw: true,
    });

    const results = entries
      .filter((e) => (parseFloat(e.cost) || 0) > 0)
      .map((e) => {
        const amount = parseFloat(e.cost) || 0;
        const linkId = String(e.link_id || "").trim();
        const desc = String(e.description || "");
        // Pure advances store receipt (AD-*) on link_id; applications point at INV-* or say "Advance applied".
        const isApplied =
          /advance applied|payment for invoice/i.test(desc) ||
          /^INV[-_]/i.test(linkId);
        return {
          entry_id: e.entry_id,
          date: e.created_at,
          receipt_no: e.receiptNo || "",
          link_id: linkId,
          description: desc,
          amount,
          mode_of_payment: e.mode_of_payment || "",
          direction: isApplied ? "applied" : "received",
        };
      });

    // Advance liability only — do not net against A/R (receivable) invoice balances.
    const balRows = await db.sequelize.query(
      `SELECT COALESCE(SUM(cr) - SUM(dr), 0) AS available_deposit
       FROM general_ledger
       WHERE LOWER(type) = 'deposit'
         AND facility_id = :facilityId
         AND (
           transaction_ref = :customerNo
           OR transaction_ref LIKE CONCAT(:customerNo, '-%')
         )`,
      {
        replacements: { facilityId, customerNo: customerKey },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );
    const rawAvail = parseFloat(balRows[0]?.available_deposit || 0);
    const availableDeposit = rawAvail > 0 ? rawAvail : 0;

    return res.json({
      success: true,
      results,
      count: results.length,
      available_deposit: availableDeposit,
      customerNo: customerKey,
      facilityId,
    });
  } catch (error) {
    console.error("Error fetching customer advance history:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching customer advance history",
      error: error.message,
    });
  }
};

/** Facility-wide received customer payment history (customer_entries, type deposit). */
exports.getReceivedPaymentHistory = async (req, res) => {
  try {
    const {
      facilityId,
      branchId,
      search = "",
      page = 1,
      pageSize = 10,
      fromDate,
      toDate,
    } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(pageSize, 10) || 10, 1), 100);
    const offset = (pageNum - 1) * limitNum;

    const replacements = { facilityId, limit: limitNum, offset };
    // Group customer deposit receipts (AD-*) into one list row per payment.
    const whereParts = [
      "ce.facilityId = :facilityId",
      "ce.type = 'deposit'",
      "ce.cost > 0",
      "ce.receiptNo LIKE 'AD-%'",
    ];

    if (branchId && String(branchId).trim() && String(branchId) !== "all") {
      const parsedBranchId = parseInt(branchId, 10);
      if (Number.isFinite(parsedBranchId) && parsedBranchId > 0) {
        replacements.branchId = parsedBranchId;
        whereParts.push("ce.branch_id = :branchId");
      }
    }

    if (fromDate && String(fromDate).trim()) {
      whereParts.push("DATE(ce.created_at) >= :fromDate");
      replacements.fromDate = String(fromDate).trim();
    }
    if (toDate && String(toDate).trim()) {
      whereParts.push("DATE(ce.created_at) <= :toDate");
      replacements.toDate = String(toDate).trim();
    }

    const searchTerm = String(search).trim();
    if (searchTerm) {
      whereParts.push(`(
        c.fullname LIKE :search
        OR ce.customerNo LIKE :search
        OR ce.receiptNo LIKE :search
        OR ce.link_id LIKE :search
        OR ce.description LIKE :search
      )`);
      replacements.search = `%${searchTerm}%`;
    }

    const whereSql = whereParts.join(" AND ");

    const countRows = await db.sequelize.query(
      `SELECT COUNT(*) AS total FROM (
         SELECT ce.receiptNo
         FROM customer_entries ce
         LEFT JOIN customers c
           ON ce.customerNo = c.customerNo AND ce.facilityId = c.facilityId
         WHERE ${whereSql}
         GROUP BY ce.receiptNo, ce.customerNo
       ) grouped`,
      {
        replacements,
        type: db.sequelize.QueryTypes.SELECT,
      },
    );
    const totalCount = parseInt(countRows[0]?.total || 0, 10);

    const rows = await db.sequelize.query(
      `SELECT
         ce.receiptNo AS receipt_no,
         ce.customerNo AS customer_no,
         MAX(ce.created_at) AS date,
         MAX(ce.mode_of_payment) AS mode_of_payment,
         MAX(ce.branch_id) AS branch_id,
         MAX(c.fullname) AS customer_name,
         MAX(c.phone) AS customer_phone,
         MAX(c.email) AS customer_email,
         MAX(COALESCE(b.branch_name, '')) AS branch_name,
         MAX(ce.description) AS description,
         SUM(ce.cost) AS amount,
         SUM(
           CASE
             WHEN TRIM(COALESCE(ce.link_id, '')) LIKE 'INV-%' THEN ce.cost
             ELSE 0
           END
         ) AS applied
       FROM customer_entries ce
       LEFT JOIN customers c
         ON ce.customerNo = c.customerNo AND ce.facilityId = c.facilityId
       LEFT JOIN branches b ON ce.branch_id = b.id
       WHERE ${whereSql}
       GROUP BY ce.receiptNo, ce.customerNo
       ORDER BY MAX(ce.created_at) DESC
       LIMIT :limit OFFSET :offset`,
      {
        replacements,
        type: db.sequelize.QueryTypes.SELECT,
      },
    );

    const results = rows.map((e) => {
      const amount = parseFloat(e.amount) || 0;
      const applied = parseFloat(e.applied) || 0;
      return {
        receipt_no: String(e.receipt_no || "").trim(),
        date: e.date,
        customer_no: e.customer_no,
        customer_name: e.customer_name || "",
        customer_phone: e.customer_phone || "",
        customer_email: e.customer_email || "",
        description: e.description || "",
        amount,
        applied,
        remaining: Math.max(0, amount - applied),
        mode_of_payment: e.mode_of_payment || "",
        branch_id: e.branch_id,
        branch_name: e.branch_name || "",
        direction: "received",
      };
    });

    return res.json({
      success: true,
      results,
      count: results.length,
      total: totalCount,
      page: pageNum,
      pageSize: limitNum,
      totalPages: Math.ceil(totalCount / limitNum) || 0,
      facilityId,
    });
  } catch (error) {
    console.error("Error fetching received payment history:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching received payment history",
      error: error.message,
    });
  }
};

exports.deposit = (req, res) => {
  const {
    source = "",
    description = "Customer Deposit",
    business_name = "",
    createdAt = "",
    userId = "",
    accountType = "",
    facilityId = "",
    customerName = "",
    version_id = "",
    depositAmount = "",
    store_name = "",
    narration = "",
    receiptNo = "",
    bank_name = "",
    bank_code = "",
    bank_chart_code = "",
    clientAccount = "",
    customerId = "",
    customerHead = "",
    customerSubHead = "",
    transaction_type = "",
  } = req.body;

  // source: obj.source,
  //   description: obj.description || "Customer Deposit",
  //   business_name: activeBusiness.business_name,
  //   createdAt: obj.createdAt,
  //   userId: obj.userId,
  //   accountType: obj.customerCategory || "",
  //   facilityId: obj.facId,
  //   customerName: obj.customerName,
  //   version_id: Date.now(),
  //   depositAmount: obj.amount,
  //   store_name: obj.store || activeBusiness.business_name,
  //   narration: obj.narration,
  //   receiptNo: obj.receiptNo,
  //   bank_name: obj.bank_name,
  //   bank_code: obj.bank_code,
  //   bank_chart_code: obj.bank_chart_code,
  //   clientAccount: obj.clientAccount,
  //   customerId: obj.customerId,
  //   customerHead: obj.customerHead,
  //   customerSubHead: obj.customerSubHead,
  //   transaction_type: obj.transaction_type,
  console.log(req.body, "================================>deposit");
  // db.sequelize
  //   .query("SELECT count(*) + 1 as version_id from account_entries ")
  //   .then((val) => {
  //     let _version_id = val[0][0].version_id;
  //     // CALL customer_deposit(2,'10000',43,'08092015',1,'Deposit from account 2','cash','6c6af0c0-35ea-40d8-a928-b13a9766113a','Cash','Aminu Kano','')
  //     db.sequelize
  //       .query(
  //         `CALL customer_deposit(:clientAccount,:depositAmount,:userId,:receiptsn,:receiptno,:description,:modeOfPayment,
  //           :facilityId,:source,:name,:accountType,:in_date,:address,:phone,:email,:website,:paybles_head,:recievables_head,
  //           :guarantor_name,:guarantor_address,:guarantor_phone,:bank_name,:branch_name,:credit_limit,:version_id,:crm,:business_name)`,
  //         {
  //           replacements: {
  //             depositAmount,
  //             clientAccount,
  //             description,
  //             source,
  //             userId,
  //             receiptsn,
  //             receiptno,
  //             modeOfPayment,
  //             destination: modeOfPayment === "cash" ? "400021" : "400022",
  //             facilityId,
  //             name,
  //             accountType,
  //             in_date: moment().format("YYYY-MM-DD hh:mm:ss"),
  //             address,
  //             phone,
  //             email,
  //             website,
  //             paybles_head: "500021",
  //             recievables_head: "400023",
  //             credit_limit,
  //             version_id: version_id ? version_id : _version_id,
  //             crm,
  //             business_name: store_name ? store_name : business_name,
  //             guarantor_name,
  //             guarantor_address,
  //             guarantor_phone,
  //             bank_name,
  //             branch_name: name,
  //           },
  //         }
  //       )
  // .then(() => {
  const taxesQueue = [];
  const generatedPVCode = `REF/${moment().format("YY")}/${Math.floor(
    Math.random() * 1000,
  )}`;

  // credit
  taxesQueue.push(
    db.sequelize.query(
      `CALL general_ledger(
        :query_type, :entries_date, :amount, :destination_name, :head,
        :account_description, :facility_id, :refrence_number, :cheque_no,
        :created_by, :pv_no, :account_type, :balance_type, :payee, :purpose_of_payment,:account_subhead
      )`,
      {
        replacements: {
          query_type: "net",
          entries_date: moment().format("YYYY-MM-DD"),
          amount: depositAmount,
          destination_name: narration,
          head: customerHead,
          account_description: customerName,
          facility_id: facilityId,
          refrence_number: generatedPVCode,
          cheque_no: null,
          created_by: store_name,
          pv_no: null,
          account_type: "Payable",
          balance_type: "Credit",
          payee: customerName,
          purpose_of_payment: narration,
          account_subhead: customerSubHead,
        },
      },
    ),
  );

  // debit
  taxesQueue.push(
    db.sequelize.query(
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
        :account_subhead
      )`,
      {
        replacements: {
          query_type: "tax",
          entries_date: moment().format("YYYY-MM-DD"),
          amount: depositAmount,
          destination_name: narration,
          head: bank_code,
          account_description: bank_name,
          facility_id: facilityId,
          refrence_number: generatedPVCode,
          cheque_no: null,
          created_by: store_name,
          pv_no: null,
          account_type: "Cash",
          balance_type: "Debit",
          payee: bank_name,
          purpose_of_payment: narration,
          account_subhead: bank_chart_code,
        },
      },
    ),
  );

  Promise.all(taxesQueue)
    .then(() => {
      res.status(200).json({ success: true });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
  //     })
  //     .catch((err) => {
  //       res.status(500).json({ success: false, err });
  //       console.log(err);
  //     });
  // })
  // .catch((err) => {
  //   console.log(err);
  //   res.status(500).json({ success: false, err });
  //   console.log(err);
  // });
};

exports.customerDeposit = async (req, res) => {
  const {
    query_type = "create",
    customer_no = "",
    description = "",
    dr = 0,
    cr = 0,
    facilityId = "",
    mode_of_payment = "",
    receipt_no = "",
  } = req.body;
  console.log(req.body);

  try {
    // Determine the type based on whether dr or cr is provided
    let entryType = "deposit";
    if (dr > 0 && cr <= 0) {
      entryType = "deposit"; // debit entry
    } else if (cr > 0 && dr <= 0) {
      entryType = "deposit"; // credit entry
    } else if (dr > 0 && cr > 0) {
      entryType = "deposit"; // both provided, default to deposit
    }

    // Create the customer entry record using ORM
    const customerEntry = await CustomerEntry.create({
      customerNo: customer_no,
      description: description,
      dr: parseFloat(dr) || 0,
      cr: parseFloat(cr) || 0,
      facilityId: facilityId,
      mode_of_payment: mode_of_payment,
      receiptNo: receipt_no,
      type: entryType, // Set appropriate type based on parameters
      created_by: req.user?.id || "system", // Use current user ID if available
    });

    // Return the created entry with the entry_id (primary key) to mimic the stored procedure behavior
    res.json({
      success: true,
      results: [{ entry_id: customerEntry.entry_id }], // Match the stored procedure's return format
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, error: error.message });
  }
};

function invoiceQuery(
  {
    type = "",
    name = "",
    address = "",
    phone = "",
    item_name = "",
    quantity = 0,
    amount = 0,
    invoice_no = "",
    created_by = "",
    facilityId = "",
    cost = 0,
    query_type = "",
    date_from = today,
    date_to = today,
  },
  success = (f) => f,
  error = (f) => f,
) {
  db.sequelize
    .query(
      `CALL invoice(:query_type,:type,:name,:address,:phone,:item_name,:quantity,:amount,:invoice_no,:created_by,:facilityId,:cost,:date_from,:date_to)`,
      {
        replacements: {
          type,
          name,
          address,
          phone,
          item_name,
          quantity,
          amount,
          invoice_no,
          created_by,
          facilityId,
          cost,
          query_type,
          date_from,
          date_to,
        },
      },
    )
    .then((results) => success(results))
    .catch((err) => error(err));
}

exports.postInvoice = (req, res) => {
  const { newData } = req.body;
  console.log(newData, "LLLLLLLLL");
  for (let i = 0; i < newData.length; i++) {
    let item = newData[i];
    invoiceQuery(
      item,
      () => console.log("success"),
      () => console.log("Err"),
    );
  }
  res.json({ success: true, msg: "Invoice recorded" });
  // res.status(500).json({ success: false, err: "Error Occur" });
};

exports.getInvoice = (req, res) => {
  invoiceQuery(
    req.body,
    (results) => {
      res.json({ success: true, results, msg: "Data" });
    },
    (err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    },
  );
};
exports.CreateCustomer = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  const {
    buildAddressLine,
    syncCustomerContacts,
    syncCustomerAddresses,
  } = require("./customerNormalize");

  try {
    const {
      query_type = "",
      customerNo = "",
      head = "",
      address = "",
      phone = "",
      email = "",
      fullname = "",
      name = "",
      store_name = "",
      status = "active",
      receivable_code = "",
      deposit_code = "", // Customer Deposits / Advance from Customer
      opening_balance = 0,
      obdate = new Date(),
      credit_limit,
      facilityId = "",
      customer_type = "customer",
      created_by,
      opening_balance_equity = "", // Usually "Opening Balance Equity" account

      tin = "",
      branch_id = null,
      entity_type = "business",
      company_name,
      salutation,
      first_name,
      last_name,
      mobile,
      language,
      currency,
      payment_terms,
      tax_rate,
      company_id,
      enable_portal = false,
      remarks,
      billing_address,
      shipping_address,
      contact_persons = [],
    } = req.body;
    const parsedBranchId = await resolveRequiredBranchId(
      facilityId,
      branch_id,
      transaction,
    );
    console.log(req.body, "====");
    const userId = created_by || req.user?.id;
    const displayName = (fullname || name || company_name || "").trim();
    const billing = billing_address || null;
    const shipping = shipping_address || null;
    const addressLine =
      address || (billing ? buildAddressLine(billing) : null) || "";

    if (!parsedBranchId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "A warehouse is required. Set a default warehouse under Admin → Manage Warehouses, or select one on the customer.",
      });
    }

    // === VALIDATION ===
    if (
      !displayName ||
      !facilityId ||
      !receivable_code ||
      !deposit_code ||
      !opening_balance_equity
    ) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "fullname, facilityId, receivable_code, deposit_code, and opening_balance_equity are required",
      });
    }

    const rawPhone = phone || mobile || "";
    if (!String(rawPhone).trim()) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "phone is required",
      });
    }
    if (!isValidNigerianPhone(rawPhone)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: NIGERIAN_PHONE_HINT,
      });
    }
    const normalizedPhone = normalizeNigerianPhone(rawPhone);
    const normalizedMobile = mobile
      ? isValidNigerianPhone(mobile)
        ? normalizeNigerianPhone(mobile)
        : null
      : null;
    if (mobile && String(mobile).trim() && !isValidNigerianPhone(mobile)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Mobile: ${NIGERIAN_PHONE_HINT}`,
      });
    }

    const normalizedEmail = String(email || "")
      .trim()
      .toLowerCase();
    if (normalizedEmail) {
      let skipEmailDup = false;
      if (query_type === "update" && customerNo) {
        const currentRow = await db.Customer.findOne({
          where: { customerNo, facilityId },
          attributes: ["email"],
          transaction,
        });
        const currentEmail = String(currentRow?.email || "")
          .trim()
          .toLowerCase();
        skipEmailDup = Boolean(currentEmail) && currentEmail === normalizedEmail;
      }
      if (!skipEmailDup) {
        const emailDupWhere = {
          facilityId,
          [Op.and]: [
            db.sequelize.where(
              db.sequelize.fn(
                "LOWER",
                db.sequelize.fn("TRIM", db.sequelize.col("email")),
              ),
              normalizedEmail,
            ),
          ],
        };
        if (query_type === "update" && customerNo) {
          emailDupWhere.customerNo = { [Op.ne]: String(customerNo) };
        }
        const emailDuplicate = await db.Customer.findOne({
          where: emailDupWhere,
          transaction,
        });
        if (emailDuplicate) {
          await transaction.rollback();
          const otherName =
            emailDuplicate.fullname ||
            emailDuplicate.company_name ||
            emailDuplicate.customerNo;
          return res.status(409).json({
            success: false,
            field: "email",
            message: `This email is already registered for ${otherName} (${emailDuplicate.customerNo}). Please use a different email.`,
          });
        }
      }
    }

    const duplicateWhere = {
      facilityId,
      phone: normalizedPhone,
      fullname: displayName,
    };
    if (query_type === "update" && customerNo) {
      duplicateWhere.customerNo = { [Op.ne]: customerNo };
    }
    const duplicate = await db.Customer.findOne({
      where: duplicateWhere,
      transaction,
    });
    if (duplicate) {
      await transaction.rollback();
      return res.status(409).json({
        success: false,
        field: "work_phone",
        message:
          "A customer with this phone number and name already exists for this facility",
      });
    }

    const kindFromBody = Object.prototype.hasOwnProperty.call(
      req.body || {},
      "customer_type",
    )
      ? normalizeCustomerKind(customer_type)
      : null;
    const kind = kindFromBody || "customer";
    const resolvedCreditLimit = parseCreditLimitValue(credit_limit, {
      walkIn: kind === "walk-in",
    });

    const profileFields = {
      entity_type:
        kind === "walk-in" || entity_type === "individual"
          ? "individual"
          : "business",
      company_name: company_name || displayName || null,
      salutation: salutation || null,
      first_name: first_name || null,
      last_name: last_name || null,
      mobile: normalizedMobile,
      language: language || "English",
      currency: currency || "NGN - Nigerian Naira",
      payment_terms: payment_terms || "Due on Receipt",
      tax_rate: tax_rate || null,
      company_id: company_id || null,
      enable_portal: Boolean(enable_portal),
      remarks: remarks || null,
    };

    // ====================================================
    // UPDATE EXISTING CUSTOMER
    // ====================================================
    if (query_type === "update") {
      if (!customerNo) {
        await transaction.rollback();
        return res
          .status(400)
          .json({ success: false, message: "customerNo required for update" });
      }

      const customer = await db.Customer.findOne({
        where: { customerNo, facilityId },
        transaction,
      });

      if (!customer) {
        await transaction.rollback();
        return res
          .status(404)
          .json({ success: false, message: "Customer not found" });
      }

      if (!(parsedBranchId || customer.branch_id)) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message:
            "A warehouse is required. Set a default warehouse under Admin → Manage Warehouses, or select one on the customer.",
        });
      }

      const updateKind =
        kindFromBody || normalizeCustomerKind(customer.customer_type);
      const updateCreditLimit = parseCreditLimitValue(credit_limit, {
        walkIn: updateKind === "walk-in",
      });

      await customer.update(
        {
          account_head: head || customer.account_head,
          address: addressLine || customer.address,
          phone: normalizedPhone,
          email: email || customer.email,
          fullname: displayName || customer.fullname,
          store_name: store_name || customer.store_name,
          status: status || customer.status,
          receivable_code: receivable_code || customer.receivable_code,
          receivable_accural_code:
            deposit_code || customer.receivable_accural_code,
          credit_limit: updateCreditLimit,
          customer_type: updateKind,
          tin: tin !== undefined ? tin : customer.tin,
          branch_id: parsedBranchId || customer.branch_id,
          ...profileFields,
          entity_type:
            updateKind === "walk-in" ? "individual" : profileFields.entity_type,
        },
        { transaction },
      );

      await syncCustomerContacts(
        db,
        {
          facilityId,
          customer_no: customerNo,
          primary: {
            salutation,
            first_name,
            last_name,
            email,
            work_phone: normalizedPhone,
            mobile: normalizedMobile,
          },
          contactPersons: contact_persons,
        },
        transaction,
      );

      await syncCustomerAddresses(
        db,
        {
          facilityId,
          customer_no: customerNo,
          billing,
          shipping,
        },
        transaction,
      );

      await transaction.commit();
      return res.json({
        success: true,
        message: "Customer updated successfully",
        customer,
      });
    }

    // ====================================================
    // CREATE NEW CUSTOMER
    // ====================================================
    const numberResult = await getAndUpdateNumber("cus", facilityId);
    const newCustomerNo = `CUS-${numberResult}`;

    const customer = await db.Customer.create(
      {
        customerNo: newCustomerNo,
        facilityId,
        account_head: head,
        fullname: displayName,
        store_name: store_name || "",
        address: addressLine || "",
        phone: normalizedPhone,
        email: email || "",
        tin: tin || "",
        receivable_code,
        receivable_accural_code: deposit_code,
        status: status || "active",
        balance: opening_balance, // We'll set real balance via ledger — not directly
        credit_limit: resolvedCreditLimit,
        customer_type: kind,
        branch_id: parsedBranchId,
        created_by: userId,
        ...profileFields,
      },
      { transaction },
    );

    await syncCustomerContacts(
      db,
      {
        facilityId,
        customer_no: newCustomerNo,
        primary: {
          salutation,
          first_name,
          last_name,
          email,
          work_phone: normalizedPhone,
          mobile: normalizedMobile,
        },
        contactPersons: contact_persons,
      },
      transaction,
    );

    await syncCustomerAddresses(
      db,
      {
        facilityId,
        customer_no: newCustomerNo,
        billing,
        shipping,
      },
      transaction,
    );

    // ====================================================
    // OPENING BALANCE ACCOUNTING (THE MOST IMPORTANT PART)
    // ====================================================
    const OB = parseFloat(opening_balance) || 0;
    const absOB = Math.abs(OB);

    if (OB !== 0) {
      // Fetch required accounts
      const receivableAccount = await db.AccountCategory.findOne({
        where: { code: receivable_code, facility_id: facilityId },
        transaction,
      });
      const depositAccount = await db.AccountCategory.findOne({
        where: { code: deposit_code, facility_id: facilityId },
        transaction,
      });
      const obeAccount = await db.AccountCategory.findOne({
        where: { code: opening_balance_equity, facility_id: facilityId },
        transaction,
      });

      if (!receivableAccount || !depositAccount || !obeAccount) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message:
            "Receivable, Deposit, or Opening Balance Equity account not found",
        });
      }

      const invoiceRef = `OB-${await getAndUpdateNumber("OB", facilityId)}`;
      const transactionDate = obdate
        ? moment(obdate).format("YYYY-MM-DD")
        : moment().format("YYYY-MM-DD");

      if (OB > 0) {
        // CUSTOMER OWES YOU → Increase Accounts Receivable
        // Dr Accounts Receivable    Cr Opening Balance Equity
        await db.GeneralLedger.bulkCreate(
          [
            {
              transaction_date: transactionDate,
              account_code: receivableAccount.code,
              account_subhead: receivableAccount.parent_code || 0,
              account_description: receivableAccount.description,
              dr: absOB,
              cr: 0,
              transaction_description:
                `opening balance for ${displayName}` ||
                receivableAccount.description,
              purpose_of_payment: "Opening Balance",
              reference_number: invoiceRef,
              payee: displayName,
              created_by: userId,
              facility_id: facilityId,
              type: "receivable",
              transaction_ref: newCustomerNo,
            },
            {
              transaction_date: transactionDate,
              account_code: obeAccount.code,
              account_subhead: obeAccount.parent_code || 0,
              account_description: obeAccount.description,
              dr: 0,
              cr: absOB,
              transaction_description:
                `opening balance for ${displayName}` || obeAccount.description,
              purpose_of_payment: "Opening Balance",
              reference_number: invoiceRef,
              created_by: userId,
              facility_id: facilityId,
              type: "equity",
              transaction_ref: "",
            },
          ],
          { transaction },
        );

        // Create Invoice (for aging report)
        await db.Invoice.create(
          {
            ref_number: newCustomerNo,
            invoice_ref: invoiceRef,
            description: "Opening Balance - Customer Owes",
            transaction_date: transactionDate,
            due_date: transactionDate,
            amount: absOB,
            balance: absOB,
            payment_method: "opening_balance",
            user_id: userId,
            created_by: userId,
            facility_id: facilityId,
            type: "sales",
            status: "unpaid",
          },
          { transaction },
        );
      } else if (OB < 0) {
        // YOU OWE CUSTOMER (Advance/Deposit received)
        // Dr Opening Balance Equity    Cr Customer Deposits (Liability)
        await db.GeneralLedger.bulkCreate(
          [
            {
              transaction_date: transactionDate,
              account_code: obeAccount.code,
              account_subhead: obeAccount.parent_code || 0,
              account_description: obeAccount.description,
              dr: absOB,
              cr: 0,
              transaction_description: "Opening Balance Equity - Offset",
              purpose_of_payment:
                `opening balance for ${displayName}` || obeAccount.description,
              reference_number: invoiceRef,
              created_by: userId,
              facility_id: facilityId,
              type: "equity",
              transaction_ref: "",
            },
            {
              transaction_date: transactionDate,
              account_code: depositAccount.code,
              account_subhead: depositAccount.parent_code || 0,
              account_description: depositAccount.description,
              dr: 0,
              cr: absOB,
              transaction_description:
                `opening balance for ${displayName}` || depositAccount.description,
              purpose_of_payment: "Opening Balance",
              reference_number: invoiceRef,
              payee: displayName,
              created_by: userId,
              facility_id: facilityId,
              type: "deposit",
              transaction_ref: newCustomerNo,
            },
          ],
          { transaction },
        );

        // Optional: create a "negative invoice" or receipt record
        // await db.Invoice.create({
        //   ref_number: newCustomerNo,
        //   invoice_ref: invoiceRef,
        //   description: "Opening Balance",
        //   transaction_date: transactionDate,
        //   due_date: transactionDate,
        //   amount: absOB,
        //   balance: absOB,
        //   payment_method: "opening_balance",
        //   user_id: userId,
        //   created_by: userId,
        //   facility_id: facilityId,
        //   type: "sales",
        //   status: "paid",
        // }, { transaction });
      }

      // Customer Entry for ledger tracking
      await db.CustomerEntry.create(
        {
          customerNo: newCustomerNo,
          description: "Opening Balance",
          cost: absOB,
          qty_in: OB > 0 ? 1 : 0,
          qty_out: OB < 0 ? 1 : 0,
          type: "opening_balance",
          link_id: invoiceRef,
          bank_account_id: 0,
          facilityId,
          mode_of_payment: "opening_balance",
          created_by: userId,
          transaction_date: transactionDate,
        },
        { transaction },
      );
    }

    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: "Customer created successfully",
      data: {
        customerNo: newCustomerNo,
        customer,
        opening_balance_applied: OB,
      },
    });
  } catch (error) {
    await transaction.rollback();
    console.error("CreateCustomer Error:", error);
    if (
      error?.name === "SequelizeUniqueConstraintError" ||
      error?.original?.code === "ER_DUP_ENTRY"
    ) {
      const dupMsg = String(
        error?.original?.sqlMessage || error?.message || "",
      ).toLowerCase();
      if (dupMsg.includes("email")) {
        return res.status(409).json({
          success: false,
          field: "email",
          message:
            "This email is already registered for another customer. Please use a different email.",
        });
      }
      return res.status(409).json({
        success: false,
        field: "work_phone",
        message:
          "A customer with this phone number and name already exists for this facility",
      });
    }
    return res.status(500).json({
      success: false,
      message: "Failed to create customer",
      error: error.message,
    });
  }
};

// controllers/customerController.js
exports.CreateCustomerUpload = async (req, res) => {
  const customers = req.body.customers;
  const { facilityId, created_by } = req.body;
  const transaction = await db.sequelize.transaction();

  if (!Array.isArray(customers) || customers.length === 0) {
    await transaction.rollback();
    return res.status(400).json({
      success: false,
      message: "No customer data provided. Expected 'customers' array.",
    });
  }

  if (!facilityId) {
    await transaction.rollback();
    return res.status(400).json({
      success: false,
      message: "facilityId is required in request body.",
    });
  }

  try {
    const userId = created_by || req.user?.id || null;

    // Pre-fetch common accounts if possible (optimization), but we'll validate per customer
    for (const customer of customers) {
      const {
        fullname = "",
        store_name = "",
        address = "",
        phone = "",
        email = "",
        status = "active",
        credit_limit,
        customer_type = "customer",
        opening_balance = 0, // Can be positive (owed to you) or negative (advance received)
        obdate, // Optional date
        receivable_code, // e.g., "1205100" - Accounts Receivable subhead
        deposit_code, // e.g., "2205100" - Customer Deposits / Advances
        opening_balance_equity, // e.g., "3100000" - Opening Balance Equity
        head, // Account head (receivable_code)
        branch_id = null,
      } = customer;
      const parsedBranchId = await resolveRequiredBranchId(
        facilityId,
        branch_id,
        transaction,
      );
      if (!parsedBranchId) {
        throw new Error(
          `A warehouse is required for customer "${fullname || "Unknown"}". Set a default warehouse or include branch_id.`,
        );
      }

      // === REQUIRED VALIDATIONS ===
      if (
        !fullname ||
        !receivable_code ||
        !deposit_code ||
        !opening_balance_equity
      ) {
        throw new Error(
          `Missing required fields for customer "${
            fullname || "Unknown"
          }": fullname, receivable_code, deposit_code, and opening_balance_equity are required.`,
        );
      }

      if (!String(phone || "").trim()) {
        throw new Error(
          `Phone is required for customer "${fullname}".`,
        );
      }
      if (!isValidNigerianPhone(phone)) {
        throw new Error(
          `Invalid phone for customer "${fullname}": ${NIGERIAN_PHONE_HINT}`,
        );
      }
      const normalizedPhone = normalizeNigerianPhone(phone);

      const duplicate = await db.Customer.findOne({
        where: {
          facilityId,
          phone: normalizedPhone,
          fullname,
        },
        transaction,
      });
      if (duplicate) {
        throw new Error(
          `A customer with phone ${normalizedPhone} and name "${fullname}" already exists.`,
        );
      }

      // === 1. Generate Customer Number ===
      const numberResult = await getAndUpdateNumber(
        "cus",
        facilityId,
        transaction,
      );
      const newCustomerNo = `CUS-${numberResult}`;

      // === 2. Create Customer Record ===
      await db.Customer.create(
        {
          customerNo: newCustomerNo,
          facilityId,
          account_head: head || receivable_code,
          fullname,
          store_name: store_name || "",
          address: address || "",
          phone: normalizedPhone,
          email: email || "",
          receivable_code,
          receivable_accural_code: deposit_code,
          status,
          balance: opening_balance, // We'll set real balance via ledger — not directly
          credit_limit: parseCreditLimitValue(credit_limit, {
            walkIn: normalizeCustomerKind(customer_type) === "walk-in",
          }),
          customer_type: normalizeCustomerKind(customer_type),
          branch_id: parsedBranchId,
          created_by: userId,
        },
        { transaction },
      );

      // === 3. Handle Opening Balance (Double-Entry Accounting) ===
      const OB = parseFloat(opening_balance) || 0;
      const absOB = Math.abs(OB);

      if (OB !== 0) {
        // Fetch account details
        const [receivableAccount, depositAccount, obeAccount] =
          await Promise.all([
            db.AccountCategory.findOne({
              where: { code: receivable_code, facility_id: facilityId },
              transaction,
            }),
            db.AccountCategory.findOne({
              where: { code: deposit_code, facility_id: facilityId },
              transaction,
            }),
            db.AccountCategory.findOne({
              where: { code: opening_balance_equity, facility_id: facilityId },
              transaction,
            }),
          ]);

        if (!receivableAccount || !depositAccount || !obeAccount) {
          throw new Error(
            `One or more accounts not found for customer "${fullname}": receivable (${receivable_code}), deposit (${deposit_code}), or opening balance equity (${opening_balance_equity})`,
          );
        }

        const transactionDate = obdate
          ? moment(obdate).format("YYYY-MM-DD")
          : moment().format("YYYY-MM-DD");

        const reference = `OB-${await getAndUpdateNumber("OB", facilityId)}`;
        const commonFields = {
          transaction_date: transactionDate,
          transaction_description: "Opening Balance",
          purpose_of_payment: "Opening Balance",
          reference_number: reference,
          payee: fullname,
          created_by: userId,
          facility_id: facilityId,
          transaction_ref: newCustomerNo,
        };

        let ledgerEntries = [];

        if (OB > 0) {
          // Customer owes you → Dr Receivable, Cr Opening Balance Equity
          ledgerEntries = [
            {
              ...commonFields,
              account_code: receivableAccount.code,
              account_subhead: receivableAccount.parent_code || 0,
              account_description: receivableAccount.description,
              transaction_description:
                `opening balance for ${fullname}` ||
                receivableAccount.description,
              dr: absOB,
              cr: 0,
              type: "receivable",
              transaction_ref: newCustomerNo,
            },
            {
              ...commonFields,
              account_code: obeAccount.code,
              account_subhead: obeAccount.parent_code || 0,
              account_description: obeAccount.description,
              transaction_description:
                `opening balance for ${fullname}` || obeAccount.description,
              dr: 0,
              cr: absOB,
              type: "equity",
              transaction_ref: "",
            },
          ];

          // Optional: Create unpaid invoice for aging
          await db.Invoice.create(
            {
              ref_number: newCustomerNo,
              invoice_ref: reference,
              description: "Opening Balance - Receivable",
              transaction_date: transactionDate,
              due_date: transactionDate,
              amount: absOB,
              balance: absOB,
              payment_method: "opening_balance",
              user_id: userId,
              created_by: userId,
              facility_id: facilityId,
              type: "sales",
              status: "unpaid",
              customerNo: newCustomerNo,
            },
            { transaction },
          );
        } else if (OB < 0) {
          // Advance received → Dr Opening Balance Equity, Cr Customer Deposit (Liability)
          ledgerEntries = [
            {
              ...commonFields,
              account_code: obeAccount.code,
              account_subhead: obeAccount.parent_code || 0,
              account_description: obeAccount.description,
              transaction_description:
                `opening balance for ${fullname}` || obeAccount.description,
              dr: absOB,
              cr: 0,
              type: "equity",
              transaction_ref: "",
            },
            {
              ...commonFields,
              account_code: depositAccount.code,
              account_subhead: depositAccount.parent_code || 0,
              account_description: depositAccount.description,
              dr: 0,
              transaction_description:
                `opening balance for ${fullname}` || depositAccount.description,
              cr: absOB,
              type: "deposit",
              transaction_ref: newCustomerNo,
            },
          ];
        }

        // Bulk insert GL entries
        if (ledgerEntries.length > 0) {
          await db.GeneralLedger.bulkCreate(ledgerEntries, { transaction });
        }

        // Customer ledger entry (for customer statement)
        await db.CustomerEntry.create(
          {
            customerNo: newCustomerNo,
            description: "Opening Balance",
            cost: absOB,
            qty_in: OB > 0 ? 1 : 0,
            qty_out: OB < 0 ? 1 : 0,
            type: STORE_ENTRY_TYPE.OPENING_BALANCE,
            link_id: reference,
            bank_account_id: 0,
            facilityId,
            mode_of_payment: "opening_balance",
            transaction_date: transactionDate,
            created_by: userId,
          },
          { transaction },
        );
      }
    }

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: `${customers.length} customer(s) uploaded and created successfully.`,
      count: customers.length,
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Bulk Customer Upload Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to upload customers",
      error: error.message,
    });
  }
};
exports.CreateSupplierUpload = async (req, res) => {
  const transaction = await db.sequelize.transaction();

  try {
    const {
      suppliers = [],
      opening_balance_equity,
      facilityId,
      created_by,
    } = req.body;

    // Validation
    if (!Array.isArray(suppliers) || suppliers.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "suppliers array is required and must contain at least one supplier",
      });
    }

    if (!facilityId || !opening_balance_equity) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "facilityId and opening_balance_equity are required at root level",
      });
    }

    const userId = created_by || req.user?.id || null;

    // Fetch shared accounts once (optimization)
    const [apAccounts, obeAccount, advanceAccounts] = await Promise.all([
      db.AccountCategory.findAll({
        where: {
          facility_id: facilityId,
          code: suppliers.map((s) => s.payable_code).filter(Boolean),
        },
        transaction,
      }),
      db.AccountCategory.findOne({
        where: { code: opening_balance_equity, facility_id: facilityId },
        transaction,
      }),
      db.AccountCategory.findAll({
        where: {
          facility_id: facilityId,
          code: suppliers.map((s) => s.payable_accural_code).filter(Boolean),
        },
        transaction,
      }),
    ]);

    if (!obeAccount) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Opening balance equity account not found",
      });
    }

    const apMap = apAccounts.reduce((map, acc) => {
      map[acc.code] = acc;
      return map;
    }, {});

    const advanceMap = advanceAccounts.reduce((map, acc) => {
      map[acc.code] = acc;
      return map;
    }, {});

    const createdSuppliers = [];
    const errors = [];

    for (let i = 0; i < suppliers.length; i++) {
      const item = suppliers[i];
      const index = i + 1; // for error reporting

      try {
        const {
          supplier_name,
          address,
          phone,
          email,
          opening_balance = 0,
          obdate,
          payable_code,
          payable_accural_code,
          branch_id,
        } = item;

        const parsedBranchId =
          branch_id == null || branch_id === "" || branch_id === "all"
            ? null
            : parseInt(branch_id, 10) || null;

        // === REQUIRED VALIDATIONS ===
        if (!supplier_name || !payable_code) {
          errors.push(
            `Supplier #${index}: supplier_name and payable_code are required`,
          );
          continue;
        }

        // Opening balance date is required if opening balance has a value
        const OB = parseFloat(opening_balance) || 0;
        if (OB !== 0 && (!obdate || obdate === "")) {
          errors.push(
            `Supplier #${index}: obdate is required when opening_balance is provided`,
          );
          continue;
        }

        // === 1. Generate Supplier Number ===
        const numberResult = await getAndUpdateNumber(
          "sup",
          facilityId,
          transaction,
        );
        const supplierNo = `SUP-${numberResult}`;

        // Create Supplier
        const supplier = await db.SuppliersInfo.create(
          {
            facilityId,
            supplier_number: supplierNo,
            supplier_name,
            address: address || null,
            phone: phone || null,
            email: email || null,
            status: "active",
            balance: OB,
            payable_code,
            payable_accural_code: payable_accural_code || null,
            branch_id: parsedBranchId,
            date: moment().format("YYYY-MM-DD"),
          },
          { transaction },
        );

        // Opening Balance Logic
        if (OB !== 0) {
          const ap = apMap[payable_code];
          const advance = payable_accural_code
            ? advanceMap[payable_accural_code]
            : null;

          if (OB > 0 && !ap) {
            errors.push(
              `Supplier #${index} (${supplier_name}): Payable account (${payable_code}) not found`,
            );
            await db.SuppliersInfo.destroy({
              where: {
                facilityId: facilityId,
                supplier_number: supplierNo,
              },
              transaction,
            });
            continue;
          }
          if (OB < 0 && !advance) {
            errors.push(
              `Supplier #${index} (${supplier_name}): Advance account (${payable_accural_code}) not found`,
            );
            await db.SuppliersInfo.destroy({
              where: {
                facilityId: facilityId,
                supplier_number: supplierNo,
              },
              transaction,
            });
            continue;
          }

          const transactionDate = obdate
            ? moment(obdate).format("YYYY-MM-DD")
            : moment().format("YYYY-MM-DD");
          const billRef = `OB-${await getAndUpdateNumber("OB", facilityId)}`;

          if (OB > 0) {
            // Credit A/P
            await db.GeneralLedger.create(
              {
                transaction_date: transactionDate,
                account_code: ap.code,
                account_subhead: ap.parent_code || 0,
                account_description: ap.description,
                dr: 0,
                cr: OB,
                transaction_description:
                  `opening balance for ${supplier_name}` || ap.description,
                purpose_of_payment: "opening_balance",
                reference_number: billRef,
                mode_of_payment: "opening_balance",
                created_by: userId,
                facility_id: facilityId,
                type: "payable",
                transaction_ref: supplierNo,
              },
              { transaction },
            );

            // Debit Equity
            await db.GeneralLedger.create(
              {
                transaction_date: transactionDate,
                account_code: obeAccount.code,
                account_subhead: obeAccount.parent_code || 0,
                account_description: obeAccount.description,
                dr: OB,
                cr: 0,
                transaction_description:
                  `opening balance for ${supplier_name}` ||
                  obeAccount.description,
                purpose_of_payment: "opening_balance",
                reference_number: billRef,
                mode_of_payment: "opening_balance",
                created_by: userId,
                facility_id: facilityId,
                type: STORE_ENTRY_TYPE.OPENING_BALANCE,
                transaction_ref: "",
              },
              { transaction },
            );

            // Create Purchase Invoice (OB > 0)
            await db.Invoice.create(
              {
                ref_number: supplierNo,
                invoice_ref: billRef,
                description: "Opening Balance",
                transaction_date: transactionDate,
                due_date: transactionDate,
                amount: OB,
                created_by: userId,
                discount_amount: 0,
                tax_amount: 0,
                facility_id: facilityId,
                type: "purchase",
              },
              { transaction },
            );

            // Supplier Entry (payable)
            await db.SupplierEntry.create(
              {
                supplier_number: supplierNo,
                receiptNo: billRef,
                description: "Opening Balance (Payable)",
                qty_in: 1,
                qty_out: 0,
                cost: OB,
                facilityId,
                mode_of_payment: "opening_balance",
                link_id: billRef,
                transaction_date: transactionDate,
                created_by: userId,
                type: STORE_ENTRY_TYPE.OPENING_BALANCE,
              },
              { transaction },
            );
          } else if (OB < 0) {
            const amount = Math.abs(OB);

            // Debit Advance
            await db.GeneralLedger.create(
              {
                transaction_date: transactionDate,
                account_code: advance.code,
                account_subhead: advance.parent_code || 0,
                account_description: advance.description,
                dr: amount,
                cr: 0,
                transaction_description:
                  `opening balance for ${supplier_name}` || advance.description,
                purpose_of_payment: "opening_balance",
                reference_number: billRef,
                mode_of_payment: "opening_balance",
                created_by: userId,
                facility_id: facilityId,
                type: "payable",
                transaction_ref: supplierNo,
              },
              { transaction },
            );

            // Credit Equity
            await db.GeneralLedger.create(
              {
                transaction_date: transactionDate,
                account_code: obeAccount.code,
                account_subhead: obeAccount.parent_code || 0,
                account_description: obeAccount.description,
                dr: 0,
                cr: amount,
                transaction_description:
                  `opening balance for ${supplier_name}` ||
                  obeAccount.description,
                purpose_of_payment: "opening_balance",
                reference_number: billRef,
                mode_of_payment: "opening_balance",
                created_by: userId,
                facility_id: facilityId,
                type: STORE_ENTRY_TYPE.OPENING_BALANCE,
                transaction_ref: "",
              },
              { transaction },
            );

            // Supplier Entry (advance)
            await db.SupplierEntry.create(
              {
                supplier_number: supplierNo,
                receiptNo: billRef,
                description: "Opening Balance (Advance)",
                qty_in: 0,
                qty_out: 1,
                cost: amount,
                facilityId,
                mode_of_payment: "opening_balance",
                link_id: billRef,
                transaction_date: transactionDate,
                created_by: userId,
                type: STORE_ENTRY_TYPE.OPENING_BALANCE,
              },
              { transaction },
            );
          }
        }

        createdSuppliers.push(supplier);
      } catch (itemError) {
        console.error(`Error processing supplier #${index}:`, itemError);
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Failed at supplier #${index} (${item.supplier_name || "unknown"}): ${itemError.message}`,
          failedAt: index,
          createdBeforeFailure: createdSuppliers.length,
        });
      }
    }

    if (errors.length > 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "Validation failed for some suppliers, no records were created",
        errors,
      });
    }

    await transaction.commit();
    return res.status(201).json({
      success: true,
      message: `Successfully created ${createdSuppliers.length} suppliers`,
      createdCount: createdSuppliers.length,
      createdSuppliers,
    });
  } catch (error) {
    await transaction.rollback();
    console.error("BulkCreateSuppliers error:", error);
    return res.status(500).json({
      success: false,
      message: "Error during bulk supplier creation",
      error: error.message,
    });
  }
};

exports.CreateProductUpload = async (req, res) => {
  const { products, busId } = req.body;

  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({
      success: false,
      message: "No product data provided",
    });
  }

  try {
    for (const product of products) {
      const {
        query_type = "insert",
        item_code = "",
        chart_code = 0,
        item_name = "",
        category = "",
        type = "",
        account_category = "",
        facilityId = "",
        memo_id = "",
      } = product;

      // Step 1: Generate a new item code
      const [rev] = await db.sequelize.query(
        `CALL nurmber_generator1(:in_query_type,:facilityId)`,
        {
          replacements: { in_query_type: "itm", facilityId },
        },
      );

      const itemNo = rev?.itm || ""; // fallback in case rev is empty

      if (!itemNo) {
        throw new Error("Failed to generate item number.");
      }

      let newCode = `ITM/${moment().format("YY")}/${itemNo}`;

      // Step 2: Insert product into product_list
      await db.sequelize.query(
        `CALL product_list(
          :query_type,
          :facilityId,
          :item_name,
          :category,
          :type,
          :chart_code,
          :item_code,
          :account_category,
          :memo_id
        )`,
        {
          replacements: {
            query_type,
            facilityId: busId,
            item_name,
            category,
            type,
            chart_code,
            item_code: newCode,
            account_category,
            memo_id,
          },
        },
      );

      // Step 3: Update number generator
      await db.sequelize.query(
        `CALL update_number_generator(:query_type, :in_number)`,
        {
          replacements: {
            query_type: "itm",
            in_number: itemNo,
          },
        },
      );
    }

    res.status(200).json({
      success: true,
      message: "All products added successfully",
    });
  } catch (err) {
    console.error("Error adding products:", err);
    res.status(500).json({
      success: false,
      message: "An error occurred while adding products",
      error: err.message || err,
    });
  }
};

exports.CreateSupplier = async (req, res) => {
  const {
    query_type = "",
    name = "",
    email = "",
    phone = "",
    address = "",
    facilityId = "",
    supplier_code = "",
    supplier_subhead = "",
    payable_code = "",
    payable_accural_code = "",
    other_payable_code = "",
  } = req.body;

  console.log("Request Body:", req.body);

  try {
    // Step 1: Generate Supplier Number using stored procedure
    let code;
    let supplierNo;
    let supplier;
    let maxRetries = 10;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      const revResult = await db.sequelize.query(
        `CALL nurmber_generator1(:in_query_type,:facilityId)`,
        {
          replacements: { in_query_type: "sup", facilityId },
        },
      );

      console.log("nurmber_generator1 raw result:", revResult);

      if (Array.isArray(revResult) && revResult.length > 0) {
        code = revResult[0]?.sup;
      } else if (revResult && revResult.sup) {
        code = revResult.sup;
      }

      if (!code)
        throw new Error("Supplier number generation failed: no 'sup' field");

      supplierNo = `SUP${String(code).padStart(3, "0")}`;
      console.log("Generated Supplier No:", supplierNo);

      // Check if supplier already exists
      const existingSupplier = await db.SuppliersInfo.findOne({
        where: { facilityId, supplier_number: supplierNo },
      });

      if (existingSupplier) {
        console.log(`Supplier ${supplierNo} already exists, incrementing...`);
        // Update the number generator to get next number
        await db.sequelize.query(
          `CALL update_number_generator(:query_type,:in_number,:facilityId)`,
          {
            replacements: {
              query_type: "sup",
              in_number: code,
              facilityId,
            },
          },
        );
        retryCount++;
        continue;
      }

      // Step 2: Create Supplier using ORM (SuppliersInfo model)
      try {
        supplier = await db.SuppliersInfo.create({
          facilityId: facilityId,
          supplier_number: supplierNo,
          supplier_name: name,
          address: address,
          phone: phone,
          email: email || null,
          status: "active",
          payable_code: payable_code,
          payable_accural_code: payable_accural_code,
          other_payable_code: other_payable_code,
          date: moment().format("YYYY-MM-DD"),
        });
        break; // Success, exit loop
      } catch (createError) {
        if (createError.name === "SequelizeUniqueConstraintError") {
          console.log(
            `Duplicate entry detected for ${supplierNo}, retrying...`,
          );
          // Update the number generator to get next number
          await db.sequelize.query(
            `CALL update_number_generator(:query_type,:in_number,:facilityId)`,
            {
              replacements: {
                query_type: "sup",
                in_number: code,
                facilityId,
              },
            },
          );
          retryCount++;
          continue;
        }
        throw createError; // Re-throw if it's not a duplicate error
      }
    }

    if (retryCount >= maxRetries) {
      throw new Error(
        "Failed to generate unique supplier number after multiple attempts",
      );
    }

    console.log("Supplier created with ORM:", supplier);

    // Step 3: Skipped - Supplier already created via ORM above
    // The customer stored procedure would create a duplicate entry

    // Step 3: Update Number Generator using stored procedure
    await db.sequelize.query(
      `CALL update_number_generator(:query_type,:in_number,:facilityId)`,
      {
        replacements: {
          query_type: "sup",
          in_number: code,
          facilityId,
        },
      },
    );

    res.json({
      success: true,
      supplierNo,
      supplier: supplier,
      message: "Supplier successfully created",
    });
  } catch (err) {
    console.error("CreateSupplier Error:", err);
    res.status(500).json({
      success: false,
      error: err.message || err,
      message: "Error while trying to create supplier",
    });
  }
};

exports.UpdateSupplier = async (req, res) => {
  const {
    query_type = "update_supplier",
    supplier_number = "",
    name = "",
    email = "",
    phone = "",
    address = "",
    facilityId = "",
    supplier_code = "",
    supplier_subhead = "",
  } = req.body;

  console.log("UpdateSupplier Request Body:", req.body);

  try {
    if (!supplier_number) throw new Error("Missing supplier_number for update");

    // Step: Update Supplier
    await db.sequelize.query(
      `CALL customer(
        :query_type,
        :customerNo,
        :account_head,
        :subhead,
        :address,
        :phone,
        :email,
        :fullname,
        :store_name,
        :status,
        :credit_limit,
        :facilityId,
        :customer_type,
        :date
      )`,
      {
        replacements: {
          query_type,
          customerNo: supplier_number,
          account_head: supplier_code,
          subhead: supplier_subhead,
          address,
          phone,
          email,
          fullname: name,
          store_name: "",
          status: "active",
          credit_limit: 0,
          facilityId,
          customer_type: "supplier",
          date: moment().format("YYYY-MM-DD"),
        },
      },
    );

    res.json({
      success: true,
      supplier_number,
      message: "Supplier successfully updated",
    });
  } catch (err) {
    console.error("UpdateSupplier Error:", err);
    res.status(500).json({
      success: false,
      error: err.message || err,
      message: "Error while trying to update supplier",
    });
  }
};

exports.getCustomerById = (req, res) => {
  const {
    query_type = "customer_by_id",
    customer_id = "",
    facilityId = "",
  } = req.query;
  db.sequelize
    .query(
      `CALL customer(
        :query_type,
        :customerNo,
        :account_head,
        :subhead,
        :address,
        :phone,
        :email,
        :fullname,
        :store_name,
        :status,
        :credit_limit,
        :facilityId,
        :customer_type,
        :date
      )`,
      {
        replacements: {
          query_type,
          customerNo: customer_id,
          account_head: "",
          subhead: "",
          address: "",
          phone: "",
          email: "",
          fullname: "",
          store_name: "",
          status: "",
          credit_limit: 0,
          facilityId,
          customer_type: "",
          date: moment().format("YYYY-MM-DD"),
        },
      },
    )
    .then((results) => {
      res.json({ success: true, customer: results });
    })
    .catch((err) => {
      res.status(500).json({ err });
      console.log(err);
    });
};

exports.getCustomerReports = (req, res) => {
  const { query_type = "all", customer_no = "", facilityId = "" } = req.params;
  db.sequelize
    .query("CALL customer_reports(:query_type,:customer_no,:facilityId)", {
      replacements: {
        query_type,
        customer_no,
        facilityId,
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

exports.getCustomerPayment = (req, res) => {
  const { query_type = "single", entry_id = "", facilityId = "" } = req.params;
  db.sequelize
    .query("CALL customer_reports(:query_type,:entry_id,:facilityId)", {
      replacements: {
        query_type,
        entry_id,
        facilityId,
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
// controllers/depositController.ts
// ✅ Reusable balance function
export const getBalance = async (customerNo, facilityId) => {
  const { receivables } = await getCustomerLedgerBalances(
    facilityId,
    customerNo,
  );
  return receivables;
};

export const createDeposit = async (req, res) => {
  const {
    transaction_date,
    amount_paid,
    customer_no,
    mode_of_payment,
    cheque_number,
    facilityId,
    userId,
    narration,
    accountHead, // { head: '10104', description: 'Cash on hand' }
    bankAccount,
    receivable_deposit_code, // liability/prepayment
    receivable_code, // A/R
    branchId = null, // branch the payment is received at (optional)
  } = req.body;
  // Explicit invoices array (even []) = only settle those lines; remainder → advance.
  // Omitted invoices = legacy: auto-apply against open A/R balance, then advance.
  const invoicesProvided = Object.prototype.hasOwnProperty.call(
    req.body,
    "invoices",
  );
  const invoices = Array.isArray(req.body.invoices) ? req.body.invoices : [];
  console.log(
    "[create-customer-deposit] req.body",
    JSON.stringify(req.body, null, 2),
  );

  // Normalize branch id once (0 / "" / "all" => null, otherwise integer)
  const depositBranchId = (() => {
    if (branchId == null || branchId === "" || branchId === "all") return null;
    const n = parseInt(branchId, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  // Validation
  if (!customer_no)
    return res.status(400).json({ error: "customer_no is required" });
  const amountPaidNum = parseAmount(amount_paid);
  if (amountPaidNum == null || amountPaidNum <= 0)
    return res.status(400).json({ error: "Valid amount_paid is required" });
  if (!facilityId)
    return res.status(400).json({ error: "facilityId is required" });
  if (!userId) return res.status(400).json({ error: "userId is required" });
  // if (!accountHead?.head)
  //   return res.status(400).json({ error: "accountHead.head is required" });
  let normalizedTxDate;
  try {
    normalizedTxDate = validatePostingDate(transaction_date || new Date(), {
      field: "transaction_date",
    });
  } catch (dateErr) {
    return res.status(400).json({ error: dateErr.message });
  }
  const transactionDate = new Date(`${normalizedTxDate}T12:00:00`);
  const referenceNumber = `AD-${await getAndUpdateNumber("AD", facilityId)}`;

  try {
    // 1. Find customer
    const customer = await Customer.findOne({
      where: { customerNo: customer_no, facilityId },
    });
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    const customerName = customer.fullname || customer_no;

    // 2. Get current receivable balance (A/R owed by customer)
    const previousBalance =
      parseFloat(await getBalance(customer_no, facilityId)) || 0;

    console.log("[create-customer-deposit] parsed amounts", {
      amount_paid_raw: amount_paid,
      amount_paid_parsed: amountPaidNum,
      previous_balance: previousBalance,
      invoices_count: invoices.length,
      invoices,
    });

    // 3. Resolve cash or bank account for deposit
    let getBankAccount = null;
    let codeData = null;
    if (mode_of_payment === "cash") {
      codeData = accountHead?.head ? { head: accountHead.head } : null;
    } else {
      if (!bankAccount?.id)
        return res
          .status(400)
          .json({ error: "Bank account is required for non-cash payments" });
      getBankAccount = await db.bank_account.findOne({
        where: { id: bankAccount.id, facilityId, status: "active" },
      });
      if (!getBankAccount)
        return res
          .status(404)
          .json({ error: "Bank account not found or inactive" });
      codeData = { head: getBankAccount.head };
    }
    if (!codeData?.head)
      return res
        .status(400)
        .json({
          error: "Account head is required (accountHead.head for cash)",
        });

    // 4. Validate cash/bank account in chart of accounts
    const cashBankAccount = await db.AccountCategory.findOne({
      where: { code: codeData.head, facility_id: facilityId },
    });

    if (!cashBankAccount)
      return res
        .status(404)
        .json({ error: `Cash/Bank account not found: ${codeData.head}` });

    const customerEntryBankAccountId =
      bankAccount?.id || accountHead?.head || codeData?.head || "";

    // 5. Determine receivable & deposit accounts
    const receivableCodeToUse = receivable_code || customer.receivable_code;
    const depositCodeToUse =
      receivable_deposit_code || customer.receivable_accural_code;

    let receivableAccount = null;
    let depositAccount = null;

    if (receivableCodeToUse) {
      receivableAccount = await db.AccountCategory.findOne({
        where: { code: receivableCodeToUse, facility_id: facilityId },
      });
      if (!receivableAccount)
        return res.status(404).json({
          error: `Receivable account not found: ${receivableCodeToUse}`,
        });
    }

    if (depositCodeToUse) {
      depositAccount = await db.AccountCategory.findOne({
        where: { code: depositCodeToUse, facility_id: facilityId },
      });
      if (!depositAccount)
        return res.status(404).json({
          error: `Deposit/Accrual account not found: ${depositCodeToUse}`,
        });
    }

    // 6. Ledger entries
    const ledgerEntries = [];

    let amountAppliedToReceivable = 0;
    let remainingAmount = amountPaidNum;

    // 7. Database transaction
    const result = await db.sequelize.transaction(async (t) => {
      // Case 1: Specific invoice lines → settle only those; leftover → advance
      if (invoices.length > 0) {
        if (!receivableAccount) {
          const err = new Error(
            "Receivable account required to settle specific invoices",
          );
          err.statusCode = 400;
          throw err;
        }

        for (const invoice of invoices) {
          const { invoice_ref, amount_paid: amount_to_apply } = invoice;
          const lineAmount = parseAmount(amount_to_apply) ?? 0;
          const applicationAmount = Math.min(lineAmount, remainingAmount);

          if (applicationAmount > 0) {
            console.log("[create-customer-deposit] invoice application", {
              invoice_ref,
              amount_to_apply_raw: amount_to_apply,
              amount_to_apply_parsed: lineAmount,
              applicationAmount,
              remaining_before: remainingAmount,
            });

            ledgerEntries.push({
              account_code: cashBankAccount.code,
              account_subhead: cashBankAccount.parent_code || 0,
              dr: applicationAmount,
              cr: 0,
              reference_number: invoice_ref,
              bank_account_id: bankAccount?.id,
              account_description: cashBankAccount.description,
              transaction_description: `${narration} ${invoice_ref} from ${customerName}`,
              type: "bank",
              transaction_ref: "",
            });

            ledgerEntries.push({
              account_code: receivableAccount.code,
              account_subhead:
                receivableAccount.subhead ||
                receivableAccount.parent_code ||
                receivableCodeToUse.substring(0, 6) ||
                0,
              dr: 0,
              cr: applicationAmount,
              account_description: receivableAccount.description,
              reference_number: invoice_ref,
              transaction_description: `${narration} ${invoice_ref} - ${customerName}`,
              type: "receivable",
              transaction_ref: customer_no,
            });

            await CustomerEntry.create(
              {
                customerNo: customer_no,
                description: narration || `Payment for invoice ${invoice_ref}`,
                qty_in: 0,
                qty_out: 0,
                cost: applicationAmount,
                amount_paid: applicationAmount,
                facilityId,
                branch_id: depositBranchId,
                mode_of_payment,
                link_id: invoice_ref,
                type: "deposit",
                receiptNo: referenceNumber,
                bank_account_id: customerEntryBankAccountId,
                created_by: userId,
                created_at: new Date(),
              },
              { transaction: t },
            );

            amountAppliedToReceivable += applicationAmount;
            remainingAmount -= applicationAmount;

            if (remainingAmount <= 0) break;
          }
        }
      } else if (!invoicesProvided) {
        // Case 2 (legacy): invoices omitted → auto-apply against open A/R, then advance
        const receivableBalanceDue = Math.max(0, previousBalance);
        amountAppliedToReceivable = Math.min(
          remainingAmount,
          receivableBalanceDue,
        );
        remainingAmount -= amountAppliedToReceivable;

        if (amountAppliedToReceivable > 0) {
          if (!receivableAccount) {
            const err = new Error(
              "Receivable account required to reduce outstanding balance",
            );
            err.statusCode = 400;
            throw err;
          }

          ledgerEntries.push({
            account_code: cashBankAccount.code,
            account_subhead: cashBankAccount.parent_code || 0,
            dr: amountAppliedToReceivable,
            cr: 0,
            reference_number: referenceNumber,
            bank_account_id: bankAccount?.id || null,
            account_description:
              accountHead?.description || cashBankAccount.description,
            transaction_description: `${narration} from ${customerName}`,
            type: "bank",
            transaction_ref: "",
          });

          ledgerEntries.push({
            account_code: receivableAccount.code,
            account_subhead:
              receivableAccount.subhead ||
              receivableAccount.parent_code ||
              receivableCodeToUse.substring(0, 6) ||
              0,
            dr: 0,
            cr: amountAppliedToReceivable,
            reference_number: referenceNumber,
            account_description: receivableAccount.description,
            transaction_description: `${narration} - ${customerName}`,
            type: "receivable",
            transaction_ref: customer_no,
          });

          await CustomerEntry.create(
            {
              customerNo: customer_no,
              description: narration || `Payment received`,
              qty_in: 0,
              qty_out: 0,
              cost: amountAppliedToReceivable,
              amount_paid: amountAppliedToReceivable,
              facilityId,
              branch_id: depositBranchId,
              mode_of_payment,
              type: "deposit",
              receiptNo: referenceNumber,
              bank_account_id: customerEntryBankAccountId,
              created_by: userId,
              created_at: new Date(),
            },
            { transaction: t },
          );
        }
      }
      // Case 3: invoices: [] explicitly → skip A/R auto-apply; full amount → advance below

      // Remaining balance as customer advance / credit
      if (remainingAmount > 0) {
        if (!depositAccount) {
          const err = new Error(
            "Deposit account code required for advance payments",
          );
          err.statusCode = 400;
          throw err;
        }

        // DR: Cash / Bank for remaining amount (use chart row from lookup — same as invoice / A/R lines)
        ledgerEntries.push({
          account_code: cashBankAccount.code,
          account_subhead: cashBankAccount.parent_code || 0,
          dr: remainingAmount,
          cr: 0,
          reference_number: referenceNumber,
          bank_account_id: bankAccount?.id || null,
          account_description:
            accountHead?.description || cashBankAccount.description,
          transaction_description: `Advance deposit received from ${customerName}`,
          type: "bank",
          transaction_ref: "",
        });

        // CR: Deposit for remaining amount
        ledgerEntries.push({
          account_code: depositCodeToUse,
          account_subhead:
            depositAccount.subhead ||
            depositAccount.parent_code ||
            depositCodeToUse.substring(0, 6) ||
            0,
          dr: 0,
          cr: remainingAmount,
          account_description: depositAccount.description,
          reference_number: referenceNumber,
          transaction_description: `Customer advance deposit - ${customerName}`,
          type: "deposit",
          transaction_ref: customer_no,
        });

        // Create CustomerEntry for advance deposit
        await CustomerEntry.create(
          {
            customerNo: customer_no,
            description: narration || `Advance deposit`,
            qty_in: 0,
            qty_out: 0,
            cost: remainingAmount,
            amount_paid: remainingAmount,
            facilityId,
            branch_id: depositBranchId,
            link_id: referenceNumber,
            mode_of_payment,
            type: "deposit",
            receiptNo: referenceNumber,
            bank_account_id: customerEntryBankAccountId,
            created_by: userId,
            created_at: new Date(),
          },
          { transaction: t },
        );
      }

      // Save all ledger entries
      for (const entry of ledgerEntries) {
        await GeneralLedger.create(
          {
            transaction_date: transactionDate,
            account_code: entry.account_code,
            account_subhead: entry.account_subhead || 0,
            dr: entry.dr,
            cr: entry.cr,
            account_description: entry.account_description,
            transaction_description: entry.transaction_description,
            reference_number: entry.reference_number || referenceNumber,
            purpose_of_payment: narration || "Customer Payment/Deposit",
            payee: customerName,
            bank_account_id: bankAccount?.id || null,
            cheque_no: cheque_number || null,
            mode_of_payment,
            created_by: userId,
            facility_id: facilityId,
            branch_id: depositBranchId,
            status: "posted",
            type: entry.type,
            transaction_ref: entry.transaction_ref || "",
          },
          { transaction: t },
        );
      }

      return {
        reference_number: referenceNumber,
        transaction_ref: referenceNumber,
        // invoice_ref: invoice_ref,
        amount_paid: amountPaidNum,
        appliedToReceivable: amountAppliedToReceivable,
        advanceAmount: remainingAmount,
        invoicesSettled: invoices.length > 0 ? invoices.length : 0,
      };
    });

    const advanceAmt = parseFloat(result?.advanceAmount) || 0;
    const appliedAmt = parseFloat(result?.appliedToReceivable) || 0;
    let message = "Customer payment/deposit recorded successfully";
    if (advanceAmt > 0 && appliedAmt > 0) {
      message = `Payment recorded: applied ${appliedAmt.toLocaleString()} to invoices; advance ${advanceAmt.toLocaleString()}`;
    } else if (advanceAmt > 0) {
      message = `Customer advance of ${advanceAmt.toLocaleString()} recorded`;
    } else if (appliedAmt > 0) {
      message = `Payment of ${appliedAmt.toLocaleString()} applied to invoices`;
    }

    return res.status(201).json({
      success: true,
      data: result,
      message,
    });
  } catch (error) {
    console.error("Error creating deposit:", error);
    const status = error?.statusCode || 500;
    return res.status(status).json({
      success: false,
      error:
        status === 400
          ? error.message
          : "Failed to create deposit",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Per-invoice GL settlement for sales invoice balance.
 * - ar_outstanding: open A/R (receivable dr − cr) on the invoice ref
 * - cash_settled: bank/deposit settlements (cash receipt or advance at credit sale)
 * - has_receivable_activity: invoice has receivable GL lines (credit sale path)
 */
const SALES_INVOICE_GL_SETTLEMENT_SUBQUERY = `
        SELECT
          reference_number AS invoice_ref,
          facility_id,
          GREATEST(
            SUM(
              CASE
                WHEN LOWER(type) IN ('receivable', 'recevable') THEN dr - cr
                ELSE 0
              END
            ),
            0
          ) AS ar_outstanding,
          GREATEST(
            SUM(
              CASE
                WHEN LOWER(type) IN ('receivable', 'recevable') THEN dr
                ELSE 0
              END
            ),
            0
          ) AS ar_invoiced,
          GREATEST(
            SUM(
              CASE
                WHEN LOWER(type) IN ('bank', 'deposit') THEN dr - cr
                ELSE 0
              END
            ),
            0
          ) AS cash_settled,
          CASE
            WHEN SUM(
              CASE
                WHEN LOWER(type) IN ('receivable', 'recevable') THEN 1
                ELSE 0
              END
            ) > 0
            THEN 1
            ELSE 0
          END AS has_receivable_activity
        FROM general_ledger
        WHERE facility_id = :facilityId
          AND reference_number IS NOT NULL
          AND reference_number != ''
        GROUP BY reference_number, facility_id`;

/** Shared amount_due expression — alias se_tot, i must exist in outer query. */
const SALES_INVOICE_AMOUNT_DUE_SQL = `GREATEST(COALESCE(se_tot.ar_outstanding, 0), 0)`;

const SALES_INVOICE_TOTAL_PAID_SQL = `
        GREATEST(
          COALESCE(se_tot.ar_invoiced, 0) - COALESCE(se_tot.ar_outstanding, 0),
          0
        )`;

const SALES_INVOICE_STATUS_SQL = `
        CASE
          WHEN (${SALES_INVOICE_AMOUNT_DUE_SQL}) <= 0.001 THEN 'paid'
          WHEN (${SALES_INVOICE_TOTAL_PAID_SQL}) > 0.001 THEN 'partially_paid'
          ELSE 'unpaid'
        END`;

/** Outstanding sales invoices for advance / FIFO (same base query as customerAdvancePaymentAllocate). */
const OUTSTANDING_SALES_INVOICES_SQL = `
      SELECT
        i.invoice_id,
        i.invoice_ref,
        i.ref_number,
        i.transaction_date,
        i.due_date,
        i.amount,
        i.description,
        i.created_by,
        ${SALES_INVOICE_TOTAL_PAID_SQL} AS total_paid,
        ${SALES_INVOICE_AMOUNT_DUE_SQL} AS amount_due,
        ${SALES_INVOICE_STATUS_SQL} AS status
      FROM invoices i
      LEFT JOIN (
        ${SALES_INVOICE_GL_SETTLEMENT_SUBQUERY}
      ) se_tot
        ON se_tot.invoice_ref = i.invoice_ref
        AND se_tot.facility_id = i.facility_id
      WHERE i.type = 'sales'
        AND i.ref_number = :customerNo
        AND i.facility_id = :facilityId
      ORDER BY i.transaction_date ASC, i.invoice_id ASC
    `;

async function loadOutstandingSalesInvoices(customer_no, facilityId) {
  const rows = await db.sequelize.query(OUTSTANDING_SALES_INVOICES_SQL, {
    replacements: { customerNo: customer_no, facilityId },
    type: db.sequelize.QueryTypes.SELECT,
  });
  return rows.map((inv) => ({
    ...inv,
    amount_due: parseFloat(inv.amount_due || 0),
    amount: parseFloat(inv.amount || 0),
    total_paid: parseFloat(inv.total_paid || 0),
  }));
}

/**
 * FIFO/LIFO allocation against outstanding invoices (server-side).
 * Returns { invoices: [{ invoice_ref, amount_paid }], allocation, withDue }
 */
function buildFifoInvoiceAllocations(
  withDueRaw,
  amount_paid,
  allocation_order,
) {
  const order =
    allocation_order === "lifo" || allocation_order === "fifo"
      ? allocation_order
      : "fifo";

  const withDue = withDueRaw.filter((inv) => inv.amount_due > 0).slice();

  if (order === "lifo") {
    withDue.sort(
      (a, b) =>
        new Date(b.transaction_date) - new Date(a.transaction_date) ||
        (b.invoice_id || 0) - (a.invoice_id || 0),
    );
  }

  let pool = parseFloat(amount_paid);
  const invoices = [];
  for (const inv of withDue) {
    if (pool <= 0) break;
    const due = inv.amount_due;
    if (due <= 0) continue;
    const apply = Math.min(pool, due);
    invoices.push({ invoice_ref: inv.invoice_ref, amount_paid: apply });
    pool -= apply;
  }

  const totalApplied = invoices.reduce(
    (s, x) => s + parseFloat(x.amount_paid || 0),
    0,
  );

  const allocation = {
    strategy:
      order === "lifo"
        ? "LIFO_by_transaction_date"
        : "FIFO_by_transaction_date",
    outstanding_snapshot: withDue.map((inv) => ({
      invoice_id: inv.invoice_id,
      invoice_ref: inv.invoice_ref,
      amount_due: inv.amount_due,
      transaction_date: inv.transaction_date,
      status: inv.status,
    })),
    allocated_invoices: invoices,
    total_applied_to_invoices: totalApplied,
    remaining_after_invoices: pool,
  };

  return { invoices, allocation, withDue };
}

/** Ensure client-supplied lines do not exceed current balance due per invoice. */
function validateAdvanceLinesAgainstOutstanding(invoiceLines, dueByRef) {
  for (const row of invoiceLines) {
    const ref = row.invoice_ref;
    const pay = parseFloat(row.amount_paid) || 0;
    if (pay <= 0) continue;
    const due = dueByRef.get(ref);
    if (due === undefined) {
      return {
        error: `Invoice ${ref} is not outstanding for this customer`,
      };
    }
    if (pay > due + 0.02) {
      return {
        error: `Amount for ${ref} cannot exceed balance due (${due})`,
      };
    }
  }
  return { ok: true };
}

/**
 * Customer advance payment — dedicated handler (does not call createDeposit).
 *
 * Flow:
 * 1. `amount_paid` = total cash/bank received.
 * 2. If `invoices[]` has lines → pay each invoice up to that line's amount (and balance due);
 *    if empty → FIFO-allocate from outstanding sales invoices.
 * 3. Sum of per-invoice applications must not exceed `amount_paid`.
 * 4. Whatever is left after those A/R credits → customer advance (deposit liability).
 *
 * Route: POST /api/v1/customer-advance-payment
 */
export const createCustomerAdvancePayment = async (req, res) => {
  console.log(
    "[customer-advance-payment] req.body",
    JSON.stringify(req.body, null, 2),
  );

  let {
    transaction_date,
    amount_paid,
    customer_no,
    mode_of_payment,
    cheque_number,
    facilityId,
    userId,
    narration,
    accountHead,
    bankAccount,
    receivable_deposit_code,
    receivable_code,
    invoices: invoicesFromBody,
    allocation_order,
    pure_advance,
    payment_splits: paymentSplitsFromBody,
    source,
  } = req.body;

  const pureAdvance =
    pure_advance === true ||
    pure_advance === "true" ||
    String(source || "").toLowerCase() === "collection_points";

  const paymentSplits = Array.isArray(paymentSplitsFromBody)
    ? paymentSplitsFromBody
        .map((s) => ({
          mode: String(s?.mode || "").toLowerCase().trim(),
          amount: parseAmount(s?.amount),
          accountHead: s?.accountHead || null,
          bankAccount: s?.bankAccount || null,
        }))
        .filter((s) => s.amount != null && s.amount > 0)
    : [];

  let invoices = Array.isArray(invoicesFromBody) ? invoicesFromBody : [];
  invoices = invoices.filter(
    (x) => x && parseFloat(x.amount_paid) > 0 && x.invoice_ref,
  );

  let allocationMeta = null;

  if (!customer_no)
    return res.status(400).json({ error: "customer_no is required" });

  let amountPaidNum =
    paymentSplits.length > 0
      ? paymentSplits.reduce((s, x) => s + (x.amount || 0), 0)
      : parseAmount(amount_paid);
  if (amountPaidNum == null || amountPaidNum <= 0)
    return res.status(400).json({ error: "Valid amount_paid is required" });
  if (paymentSplits.length > 0) {
    const hasCash = paymentSplits.some((s) => s.mode === "cash");
    const hasBank = paymentSplits.some(
      (s) =>
        s.mode === "bank" ||
        s.mode === "transfer" ||
        s.mode === "bank transfer",
    );
    if (!hasCash || !hasBank) {
      return res.status(400).json({
        error:
          "Cash + Transfer advance requires both a cash and a transfer amount",
      });
    }
    mode_of_payment = "cash+transfer";
  }
  if (!facilityId)
    return res.status(400).json({ error: "facilityId is required" });
  if (!userId) return res.status(400).json({ error: "userId is required" });

  let normalizedTxDate;
  try {
    normalizedTxDate = validatePostingDate(transaction_date || new Date(), {
      field: "transaction_date",
    });
  } catch (dateErr) {
    return res.status(400).json({ error: dateErr.message });
  }
  const transactionDate = new Date(`${normalizedTxDate}T12:00:00`);
  const referenceNumber = `AD-${await getAndUpdateNumber("AD", facilityId)}`;

  try {
    const customer = await Customer.findOne({
      where: { customerNo: customer_no, facilityId },
    });
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    const customerName = customer.fullname || customer_no;
    const previousBalance =
      parseFloat(await getBalance(customer_no, facilityId)) || 0;

    const outstandingRows = await loadOutstandingSalesInvoices(
      customer_no,
      facilityId,
    );
    const dueByRef = new Map(
      outstandingRows.map((r) => [r.invoice_ref, r.amount_due]),
    );

    if (invoices.length === 0 && !pureAdvance) {
      const { invoices: fifoInv, allocation } = buildFifoInvoiceAllocations(
        outstandingRows,
        amountPaidNum,
        allocation_order,
      );
      invoices = fifoInv;
      allocationMeta = allocation;
    } else if (pureAdvance) {
      invoices = [];
      allocationMeta = { mode: "pure_advance", source: source || null };
    } else {
      const check = validateAdvanceLinesAgainstOutstanding(invoices, dueByRef);
      if (check.error) return res.status(400).json({ error: check.error });
    }

    const sumAlloc = invoices.reduce(
      (s, x) => s + (parseFloat(x.amount_paid) || 0),
      0,
    );
    if (sumAlloc > amountPaidNum + 0.02) {
      return res.status(400).json({
        error: "Sum of invoice allocations cannot exceed total amount received",
      });
    }

    const totalOutstandingServer = outstandingRows.reduce(
      (s, r) => s + (parseFloat(r.amount_due) || 0),
      0,
    );
    if (totalOutstandingServer > 0.02 && invoices.length > 0) {
      const requiredOnInvoices = Math.min(
        amountPaidNum,
        totalOutstandingServer,
      );
      if (sumAlloc + 0.02 < requiredOnInvoices) {
        return res.status(400).json({
          error: `Apply the full payment to outstanding invoices (up to each balance due). At least ${requiredOnInvoices.toFixed(2)} required on invoice lines; received ${sumAlloc.toFixed(2)}.`,
        });
      }
    }

    const remainderToAdvance = Math.max(0, amountPaidNum - sumAlloc);
    console.log("[customer-advance-payment] resolved allocation", {
      amount_paid_raw: amount_paid,
      amount_paid_parsed: amountPaidNum,
      previous_balance: previousBalance,
      total_outstanding_server: totalOutstandingServer,
      invoice_lines: invoices,
      sum_applied_to_invoices: sumAlloc,
      remainder_to_advance: remainderToAdvance,
      fifo_or_client_lines: allocationMeta ? "server_fifo" : "client_lines",
      payment_splits: paymentSplits.length,
      pure_advance: pureAdvance,
    });

    const receivableCodeToUse = receivable_code || customer.receivable_code;
    const depositCodeToUse =
      receivable_deposit_code || customer.receivable_accural_code;

    let receivableAccount = null;
    let depositAccount = null;

    if (receivableCodeToUse) {
      receivableAccount = await db.AccountCategory.findOne({
        where: { code: receivableCodeToUse, facility_id: facilityId },
      });
      if (!receivableAccount)
        return res.status(404).json({
          error: `Receivable account not found: ${receivableCodeToUse}`,
        });
    }

    if (depositCodeToUse) {
      depositAccount = await db.AccountCategory.findOne({
        where: { code: depositCodeToUse, facility_id: facilityId },
      });
      if (!depositAccount)
        return res.status(404).json({
          error: `Deposit/Accrual account not found: ${depositCodeToUse}`,
        });
    }

    // Collection Points: Cash + Transfer pure advance (one AD- receipt, two funding legs)
    if (paymentSplits.length > 0 && pureAdvance) {
      if (!depositAccount) {
        return res.status(400).json({
          error: "Deposit account code required for advance payments",
        });
      }

      const resolvedSplits = [];
      for (const split of paymentSplits) {
        const isCash = split.mode === "cash";
        let headCode = null;
        let bankId = null;
        let accountDesc = "";
        if (isCash) {
          headCode = split.accountHead?.head || accountHead?.head;
          accountDesc = split.accountHead?.description || accountHead?.description || "";
          if (!headCode) {
            return res.status(400).json({
              error: "Account head is required for the cash portion",
            });
          }
        } else {
          const bankIdRaw = split.bankAccount?.id || bankAccount?.id;
          if (!bankIdRaw) {
            return res.status(400).json({
              error: "Bank account is required for the transfer portion",
            });
          }
          const ba = await db.bank_account.findOne({
            where: { id: bankIdRaw, facilityId, status: "active" },
          });
          if (!ba) {
            return res
              .status(404)
              .json({ error: "Bank account not found or inactive" });
          }
          headCode = ba.head;
          bankId = ba.id;
          accountDesc = ba.account_name || ba.bank_name || "";
        }
        const acct = await db.AccountCategory.findOne({
          where: { code: headCode, facility_id: facilityId },
        });
        if (!acct) {
          return res
            .status(404)
            .json({ error: `Cash/Bank account not found: ${headCode}` });
        }
        resolvedSplits.push({
          mode: isCash ? "cash" : "bank transfer",
          amount: split.amount,
          account: acct,
          bankId,
          accountDesc,
        });
      }

      const splitResult = await db.sequelize.transaction(async (t) => {
        const narrationText =
          narration ||
          `Verification Points advance (Cash + Transfer) from ${customerName}`;

        for (const split of resolvedSplits) {
          await GeneralLedger.create(
            {
              transaction_date: transactionDate,
              account_code: split.account.code,
              account_subhead: split.account.parent_code || 0,
              dr: split.amount,
              cr: 0,
              account_description:
                split.accountDesc || split.account.description,
              transaction_description: `${narrationText} (${split.mode})`,
              reference_number: referenceNumber,
              purpose_of_payment: narrationText,
              payee: customerName,
              bank_account_id: split.bankId || null,
              cheque_no: cheque_number || null,
              mode_of_payment: split.mode,
              created_by: userId,
              facility_id: facilityId,
              status: "posted",
              type: "bank",
              transaction_ref: "",
            },
            { transaction: t },
          );

          await CustomerEntry.create(
            {
              customerNo: customer_no,
              description: narrationText,
              qty_in: 0,
              qty_out: 0,
              cost: split.amount,
              amount_paid: split.amount,
              facilityId,
              link_id: null,
              mode_of_payment: split.mode,
              type: "deposit",
              receiptNo: referenceNumber,
              bank_account_id: split.bankId || split.account.code,
              created_by: userId,
              created_at: new Date(),
            },
            { transaction: t },
          );
        }

        await GeneralLedger.create(
          {
            transaction_date: transactionDate,
            account_code: depositCodeToUse,
            account_subhead:
              depositAccount.subhead ||
              depositAccount.parent_code ||
              depositCodeToUse.substring(0, 6) ||
              0,
            dr: 0,
            cr: amountPaidNum,
            account_description: depositAccount.description,
            transaction_description: `Customer advance deposit - ${customerName}`,
            reference_number: referenceNumber,
            purpose_of_payment: narrationText,
            payee: customerName,
            bank_account_id: null,
            cheque_no: cheque_number || null,
            mode_of_payment: "cash+transfer",
            created_by: userId,
            facility_id: facilityId,
            status: "posted",
            type: "deposit",
            transaction_ref: customer_no,
          },
          { transaction: t },
        );

        return {
          reference_number: referenceNumber,
          transaction_ref: referenceNumber,
          amount_paid: amountPaidNum,
          appliedToReceivable: 0,
          advanceAmount: amountPaidNum,
          invoicesSettled: 0,
          payment_mode: "cash+transfer",
          splits: resolvedSplits.map((s) => ({
            mode: s.mode,
            amount: s.amount,
          })),
        };
      });

      return res.status(201).json({
        success: true,
        data: splitResult,
        allocation: allocationMeta,
        message: "Customer advance payment recorded successfully",
      });
    }

    let getBankAccount = null;
    let codeData = null;
    if (mode_of_payment === "cash") {
      codeData = accountHead?.head ? { head: accountHead.head } : null;
    } else {
      if (!bankAccount?.id)
        return res
          .status(400)
          .json({ error: "Bank account is required for non-cash payments" });
      getBankAccount = await db.bank_account.findOne({
        where: { id: bankAccount.id, facilityId, status: "active" },
      });
      if (!getBankAccount)
        return res
          .status(404)
          .json({ error: "Bank account not found or inactive" });
      codeData = { head: getBankAccount.head };
    }
    if (!codeData?.head)
      return res
        .status(400)
        .json({
          error: "Account head is required (accountHead.head for cash)",
        });

    const cashBankAccount = await db.AccountCategory.findOne({
      where: { code: codeData.head, facility_id: facilityId },
    });

    if (!cashBankAccount)
      return res
        .status(404)
        .json({ error: `Cash/Bank account not found: ${codeData.head}` });

    const ledgerEntries = [];
    let amountAppliedToReceivable = 0;
    let remainingAmount = amountPaidNum;

    const result = await db.sequelize.transaction(async (t) => {
      // Per-invoice: DR cash/bank, CR A/R for each line amount (capped by what's left of amount_paid).
      // remainingAmount after this loop → posted to customer advance (deposit) below.
      if (invoices.length > 0) {
        if (!receivableAccount)
          return res.status(400).json({
            error: "Receivable account required to settle specific invoices",
          });

        for (const invoice of invoices) {
          const { invoice_ref, amount_paid: amount_to_apply } = invoice;
          const lineAmount = parseAmount(amount_to_apply) ?? 0;
          const applicationAmount = Math.min(lineAmount, remainingAmount);

          if (applicationAmount > 0) {
            console.log("[customer-advance-payment] invoice application", {
              invoice_ref,
              amount_to_apply_raw: amount_to_apply,
              amount_to_apply_parsed: lineAmount,
              applicationAmount,
              remaining_before: remainingAmount,
            });

            ledgerEntries.push({
              account_code: cashBankAccount.code,
              account_subhead: cashBankAccount.parent_code || 0,
              dr: applicationAmount,
              cr: 0,
              reference_number: invoice_ref,
              bank_account_id: bankAccount?.id,
              account_description: cashBankAccount.description,
              transaction_description: `${narration} ${invoice_ref} from ${customerName}`,
              type: "bank",
              transaction_ref: "",
            });

            ledgerEntries.push({
              account_code: receivableAccount.code,
              account_subhead:
                receivableAccount.subhead ||
                receivableAccount.parent_code ||
                receivableCodeToUse.substring(0, 6) ||
                0,
              dr: 0,
              cr: applicationAmount,
              account_description: receivableAccount.description,
              reference_number: invoice_ref,
              transaction_description: `${narration} ${invoice_ref} - ${customerName}`,
              type: "receivable",
              transaction_ref: customer_no,
            });

            await CustomerEntry.create(
              {
                customerNo: customer_no,
                description: narration || `Payment for invoice ${invoice_ref}`,
                qty_in: 0,
                qty_out: 0,
                cost: applicationAmount,
                amount_paid: applicationAmount,
                facilityId,
                mode_of_payment,
                link_id: invoice_ref,
                type: "deposit",
                receiptNo: referenceNumber,
                bank_account_id: bankAccount?.id || accountHead?.head,
                created_by: userId,
                created_at: new Date(),
              },
              { transaction: t },
            );

            amountAppliedToReceivable += applicationAmount;
            remainingAmount -= applicationAmount;

            if (remainingAmount <= 0) break;
          }
        }
      } else if (!pureAdvance) {
        const receivableBalanceDue = Math.max(0, previousBalance);
        amountAppliedToReceivable = Math.min(
          remainingAmount,
          receivableBalanceDue,
        );
        remainingAmount -= amountAppliedToReceivable;

        if (amountAppliedToReceivable > 0) {
          if (!receivableAccount)
            return res.status(400).json({
              error:
                "Receivable account required to reduce outstanding balance",
            });

          ledgerEntries.push({
            account_code: cashBankAccount.code,
            account_subhead: cashBankAccount.parent_code || 0,
            dr: amountAppliedToReceivable,
            cr: 0,
            reference_number: referenceNumber,
            bank_account_id: bankAccount?.id || null,
            account_description:
              accountHead.description || cashBankAccount.description,
            transaction_description: `${narration} from ${customerName}`,
            type: "bank",
            transaction_ref: "",
          });

          ledgerEntries.push({
            account_code: receivableAccount.code,
            account_subhead:
              receivableAccount.subhead ||
              receivableAccount.parent_code ||
              receivableCodeToUse.substring(0, 6) ||
              0,
            dr: 0,
            cr: amountAppliedToReceivable,
            reference_number: referenceNumber,
            account_description: receivableAccount.description,
            transaction_description: `${narration} - ${customerName}`,
            type: "receivable",
            transaction_ref: customer_no,
          });

          await CustomerEntry.create(
            {
              customerNo: customer_no,
              description: narration || `Payment received`,
              qty_in: 0,
              qty_out: 0,
              cost: amountAppliedToReceivable,
              amount_paid: amountAppliedToReceivable,
              facilityId,
              mode_of_payment,
              type: "deposit",
              receiptNo: referenceNumber,
              bank_account_id: bankAccount?.id || accountHead.head,
              created_by: userId,
              created_at: new Date(),
            },
            { transaction: t },
          );
        }
      } else {
        // pure_advance from Collection Points: leave remainingAmount as full deposit
      }

      if (remainingAmount > 0) {
        if (!depositAccount)
          return res.status(400).json({
            error: "Deposit account code required for advance payments",
          });

        ledgerEntries.push({
          account_code: cashBankAccount.code,
          account_subhead: cashBankAccount.parent_code || 0,
          dr: remainingAmount,
          cr: 0,
          reference_number: referenceNumber,
          bank_account_id: bankAccount?.id || accountHead?.head || null,
          account_description:
            accountHead?.description || cashBankAccount.description,
          transaction_description: `Advance deposit received from ${customerName}`,
          type: "bank",
          transaction_ref: "",
        });

        ledgerEntries.push({
          account_code: depositCodeToUse,
          account_subhead:
            depositAccount.subhead ||
            depositAccount.parent_code ||
            depositCodeToUse.substring(0, 6) ||
            0,
          dr: 0,
          cr: remainingAmount,
          account_description: depositAccount.description,
          reference_number: referenceNumber,
          transaction_description: `Customer advance deposit - ${customerName}`,
          type: "deposit",
          transaction_ref: customer_no,
        });

        await CustomerEntry.create(
          {
            customerNo: customer_no,
            description: narration || `Advance deposit`,
            qty_in: 0,
            qty_out: 0,
            cost: remainingAmount,
            amount_paid: remainingAmount,
            facilityId,
            link_id: null,
            mode_of_payment,
            type: "deposit",
            receiptNo: referenceNumber,
            bank_account_id: bankAccount?.id || accountHead?.head,
            created_by: userId,
            created_at: new Date(),
          },
          { transaction: t },
        );
      }

      for (const entry of ledgerEntries) {
        await GeneralLedger.create(
          {
            transaction_date: transactionDate,
            account_code: entry.account_code,
            account_subhead: entry.account_subhead || 0,
            dr: entry.dr,
            cr: entry.cr,
            account_description: entry.account_description,
            transaction_description: entry.transaction_description,
            reference_number: entry.reference_number || referenceNumber,
            purpose_of_payment: narration || "Customer advance payment",
            payee: customerName,
            bank_account_id: bankAccount?.id || null,
            cheque_no: cheque_number || null,
            mode_of_payment,
            created_by: userId,
            facility_id: facilityId,
            status: "posted",
            type: entry.type,
            transaction_ref: entry.transaction_ref || "",
          },
          { transaction: t },
        );
      }

      return {
        reference_number: referenceNumber,
        transaction_ref: referenceNumber,
        amount_paid: amountPaidNum,
        appliedToReceivable: amountAppliedToReceivable,
        advanceAmount: remainingAmount,
        invoicesSettled: invoices.length > 0 ? invoices.length : 0,
      };
    });

    const payload = {
      success: true,
      data: result,
      message: "Customer advance payment recorded successfully",
    };
    if (allocationMeta) payload.allocation = allocationMeta;

    return res.status(201).json(payload);
  } catch (error) {
    console.error("Error in createCustomerAdvancePayment:", error);
    return res.status(500).json({
      error: "Failed to record customer advance payment",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Legacy route: FIFO allocate then record via createCustomerAdvancePayment.
 * Prefer POST /api/v1/customer-advance-payment without `invoices`.
 */
exports.customerAdvancePaymentAllocate = async (req, res) => {
  try {
    const { customer_no, facilityId, amount_paid } = req.body;

    if (!customer_no || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "customer_no and facilityId are required",
      });
    }
    if (
      !amount_paid ||
      isNaN(parseFloat(amount_paid)) ||
      parseFloat(amount_paid) <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid amount_paid is required",
      });
    }

    const reqAdvance = {
      ...req,
      body: {
        ...req.body,
        invoices: [],
      },
    };

    return await createCustomerAdvancePayment(reqAdvance, res);
  } catch (error) {
    console.error("customerAdvancePaymentAllocate:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to allocate customer advance payment",
      error: error.message,
    });
  }
};

exports.getCustomerDeposit = async (req, res) => {
  const { invoice_ref, invoice_id, facility_id } = req.params;
  try {
    const deposit = await Invoice.findOne({
      where: { invoice_ref, invoice_id, facility_id },
    });
    res.json({ success: true, deposit: deposit });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getCustomerBalance = async (req, res) => {
  const { customerNo, facilityId } = req.params;
  try {
    const bals = await getCustomerLedgerBalances(facilityId, customerNo);
    res.json({
      success: true,
      ...bals,
      balance: bals.receivables,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getCustomerDeposit = async (req, res) => {
  const { facilityId, invoice_ref, customerNo } = req.params;
  console.log(
    facilityId,
    invoice_ref,
    customerNo,
    "=====================>params",
  );
  if (!facilityId || !invoice_ref) {
    return res.status(400).json({
      error: "Missing required params: facilityId, invoice_ref",
    });
  }

  try {
    const result = await db.sequelize.query(
      `
      SELECT * FROM customer_entries where customerNo = :customerNo and receiptNo = :link_id and facilityId=:facilityId
      `,
      {
        replacements: { customerNo, facilityId, link_id: invoice_ref },
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );

    const business = await db.sequelize.query(
      `SELECT * FROM business WHERE id = :facilityId`,
      {
        replacements: { facilityId },
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );

    if (!result || result.length === 0) {
      return res.status(404).json({
        error: `No deposit record found for invoice_ref: ${invoice_ref}, facilityId: ${facilityId}`,
      });
    }
    const customer = await db.Customer.findOne({
      where: {
        customerNo: customerNo,
        facilityId: facilityId,
      },
    });
    if (!customer) {
      return res.status(404).json({
        error: `Customer not found for invoice_ref: ${invoice_ref}, facilityId: ${facilityId}`,
      });
    }
    // Get account information based on mode of payment
    let accountInfo = null;
    if (result[0].mode_of_payment === "cash" && result[0].bank_account_id) {
      accountInfo = await db.AccountCategory.findOne({
        where: {
          code: result[0].bank_account_id,
          facilityId: facilityId,
        },
      });
    } else if (result[0].bank_account_id) {
      // Model is defined as \"bank_account\" in Sequelize, so it is registered on db as db.bank_account
      accountInfo = await db.bank_account.findOne({
        where: {
          head: result[0].bank_account_id,
          facilityId: facilityId,
        },
      });
    }

    // Get user information (created by)
    const createdBy = await db.users.findOne({
      where: {
        id: result[0].created_by,
        facilityId: facilityId,
      },
    });

    // 🔑 Call balance function
    const outstandingBalance = await getBalance(customerNo, facilityId);
    console.log(outstandingBalance, "=====================>result");
    return res.status(200).json({
      success: true,

      data: {
        ...result[0],
        createdBy: createdBy
          ? {
              name: `${createdBy.firstname || ""} ${
                createdBy.lastname || ""
              }`.trim(),
              signature: createdBy.signature,
            }
          : null,
        account_info: accountInfo
          ? {
              code: accountInfo.code || accountInfo.head,
              name:
                accountInfo.account_name ||
                accountInfo.description ||
                accountInfo.category,
              account_number: accountInfo.account_number,
              bank_code: accountInfo.bank_code,
            }
          : null,
      },
      customer: {
        customerNo: customer.customerNo,
        fullname: customer.fullname,
        address: customer.address,
      },
      outstanding_balance: outstandingBalance,
      business_address: business[0]?.business_address,
      business_name: business[0]?.business_name,
      business_phone: business[0]?.business_phone,
      invoice_ref,
    });
  } catch (error) {
    console.error("Error fetching deposit details:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// Get all customers for a facility
exports.getCustomerOne = async (req, res) => {
  try {
    const facilityId = String(req.query.facilityId || req.params.facilityId || "").trim();
    const customerNo = String(req.query.customerNo || req.params.customerNo || "").trim();
    if (!facilityId || !customerNo) {
      return res.status(400).json({
        success: false,
        message: "facilityId and customerNo are required",
      });
    }
    const row = await db.Customer.findOne({
      where: { facilityId, customerNo },
    });
    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }
    return res.json({ success: true, data: row.get({ plain: true }) });
  } catch (error) {
    console.error("getCustomerOne:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load customer",
      error: error.message,
    });
  }
};

exports.getCustomersList = async (req, res) => {
  try {
    const { facilityId } = req.params;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const customerWhere = { facilityId: String(facilityId) };
    const rawBranch = req.query?.branchId ?? req.query?.branch_id;
    const filterBranchId = parseInt(rawBranch, 10);
    if (Number.isFinite(filterBranchId) && filterBranchId > 0) {
      customerWhere.branch_id = filterBranchId;
    }

    const customers = await Customer.findAll({
      where: customerWhere,
      order: [["createdAt", "DESC"]],
      attributes: [
        "customerNo",
        "fullname",
        "company_name",
        "company_id",
        "tin",
        "salutation",
        "first_name",
        "last_name",
        "address",
        "phone",
        "mobile",
        "email",
        "customer_type",
        "status",
        "entity_type",
        "credit_limit",
        "receivable_code",
        "receivable_accural_code",
        "branch_id",
        "facilityId",
        "language",
        "currency",
        "payment_terms",
        "tax_rate",
        "enable_portal",
        "remarks",
        "createdAt",
      ],
    });

    const customerNos = customers.map((c) =>
      String((c.get ? c.get({ plain: true }) : c).customerNo),
    );

    const balanceByCustomer = {};
    if (customerNos.length) {
      const balanceRows = await db.sequelize.query(
        `SELECT c.customerNo AS customerNo,
                COALESCE(SUM(CASE
                  WHEN LOWER(COALESCE(gl.type, '')) IN ('receivable', 'recevable')
                  THEN gl.dr - gl.cr ELSE 0 END), 0) AS receivables,
                COALESCE(SUM(CASE
                  WHEN LOWER(COALESCE(gl.type, '')) = 'deposit'
                  THEN gl.cr - gl.dr ELSE 0 END), 0) AS deposit
           FROM customers c
           LEFT JOIN general_ledger gl
             ON gl.facility_id = :facilityId
            AND (
              gl.transaction_ref = c.customerNo
              OR gl.transaction_ref LIKE CONCAT(c.customerNo, '-%')
            )
          WHERE c.facilityId = :facilityId
            AND c.customerNo IN (:customerNos)
          GROUP BY c.customerNo`,
        {
          replacements: { facilityId, customerNos },
          type: db.Sequelize.QueryTypes.SELECT,
        },
      );
      for (const row of balanceRows) {
        if (!row.customerNo) continue;
        balanceByCustomer[String(row.customerNo)] = {
          receivables: Math.max(0, parseFloat(row.receivables) || 0),
          deposit: Math.max(0, parseFloat(row.deposit) || 0),
        };
      }
    }

    const warehouseRows = await db.sequelize.query(
      `SELECT id, branch_name, branch_id AS warehouse_code, is_default
         FROM branches
        WHERE facilityId = :facilityId`,
      {
        replacements: { facilityId },
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );
    const warehouseById = {};
    for (const row of warehouseRows) {
      warehouseById[String(row.id)] = row;
    }

    const results = customers.map((c) => {
      const plain = c.get ? c.get({ plain: true }) : c;
      const bals = balanceByCustomer[String(plain.customerNo)] || {
        receivables: 0,
        deposit: 0,
      };
      const limit = parseCreditLimitValue(plain.credit_limit);
      const receivables = bals.receivables;
      const deposit = bals.deposit;
      const credit_used_percent =
        limit == null
          ? null
          : limit > 0
            ? Number(((receivables / limit) * 100).toFixed(1))
            : receivables > 0
              ? 100
              : 0;
      const wh = warehouseById[String(plain.branch_id)] || null;
      return {
        ...plain,
        receivables,
        unused_credits: deposit,
        deposit,
        unearned_deposit: deposit,
        credit_used_percent,
        warehouse_name: wh?.branch_name || null,
        warehouse_code: wh?.warehouse_code || null,
      };
    });

    return res.status(200).json({
      success: true,
      results,
      count: results.length,
    });
  } catch (error) {
    console.error("Error getting customers list:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching customers list",
      error: error.message,
    });
  }
};

/**
 * Distinct customer numbers that have sales invoices in a given branch.
 * Used by Receive Payment to filter the customer list by branch.
 */
exports.getCustomerNosByBranch = async (req, res) => {
  try {
    const { facilityId, branchId } = req.query;
    if (!facilityId) {
      return res
        .status(400)
        .json({ success: false, message: "facilityId is required" });
    }

    const parsedBranchId = parseInt(branchId, 10);
    if (!Number.isFinite(parsedBranchId) || parsedBranchId <= 0) {
      // No specific branch → no filtering signal
      return res.json({ success: true, results: [] });
    }

    const rows = await db.sequelize.query(
      `SELECT DISTINCT customerNo FROM (
         SELECT ref_number AS customerNo
           FROM invoices
          WHERE facility_id = :facilityId AND branchId = :branchId
            AND ref_number IS NOT NULL
         UNION
         SELECT customerNo
           FROM customer_entries
          WHERE facilityId = :facilityId AND branch_id = :branchId
            AND customerNo IS NOT NULL
       ) AS combined`,
      {
        replacements: { facilityId, branchId: parsedBranchId },
        type: db.Sequelize.QueryTypes.SELECT,
      }
    );

    const customerNos = rows.map((r) => r.customerNo).filter(Boolean);
    return res.json({ success: true, results: customerNos });
  } catch (err) {
    console.error("Error in getCustomerNosByBranch:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch customers by branch" });
  }
};

// Get outstanding invoices for a customer (or all customers in facility) with balance calculation
exports.getOutstandingInvoices = async (req, res) => {
  try {
    const { customerNo, facilityId, userId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const customerKey =
      customerNo && String(customerNo).trim()
        ? String(customerNo).trim()
        : null;
    const customerFilter = customerKey ? "AND i.ref_number = :customerNo" : "";

    // When customerNo is omitted, return all outstanding sales invoices for the facility (AR aging / portfolio view).
    const orderClause = customerKey
      ? "i.transaction_date DESC"
      : "c.fullname ASC, i.transaction_date DESC";

    const query = `
      SELECT
        i.invoice_id,
        i.invoice_ref,
        i.ref_number,
        i.transaction_date,
        i.due_date,
        i.amount,
        i.description,
        i.created_by,
        c.fullname AS customer_name,
        ${SALES_INVOICE_TOTAL_PAID_SQL} AS total_paid,
        ${SALES_INVOICE_AMOUNT_DUE_SQL} AS amount_due,
        ${SALES_INVOICE_STATUS_SQL} AS status
      FROM invoices i
      INNER JOIN customers c
        ON c.customerNo = i.ref_number
        AND c.facilityId = i.facility_id
      LEFT JOIN (
        ${SALES_INVOICE_GL_SETTLEMENT_SUBQUERY}
      ) se_tot
        ON se_tot.invoice_ref = i.invoice_ref
        AND se_tot.facility_id = i.facility_id
      WHERE i.type = 'sales'
        AND i.facility_id = :facilityId
        ${customerFilter}
      ORDER BY ${orderClause};
    `;

    const replacements = { facilityId };
    if (customerKey) {
      replacements.customerNo = customerKey;
    }

    const invoices = await db.sequelize.query(query, {
      replacements,
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Format the results and calculate balance_due (same as amount_due)
    const formattedInvoices = invoices.map((invoice) => ({
      invoice_id: invoice.invoice_id,
      invoice_ref: invoice.invoice_ref,
      ref_number: invoice.ref_number,
      customer_name: invoice.customer_name || null,
      transaction_date: invoice.transaction_date,
      due_date: invoice.due_date,
      amount: parseFloat(invoice.amount || 0),
      tax_amount: parseFloat(invoice.tax_amount || 0),
      discount_amount: parseFloat(invoice.discount_amount || 0),
      description: invoice.description,
      created_by: invoice.created_by,
      total_paid: parseFloat(invoice.total_paid || 0),
      amount_due: parseFloat(invoice.amount_due || 0),
      balance_due: parseFloat(invoice.amount_due || 0), // Alias for compatibility
      status: invoice.status,
    }));

    // Filter to only show invoices with outstanding balance (amount_due > 0)
    const outstandingInvoices = formattedInvoices.filter(
      (inv) => inv.amount_due > 0,
    );

    return res.json({
      success: true,
      results: outstandingInvoices,
      count: outstandingInvoices.length,
      userId: userId || null, // Include userId if provided
    });
  } catch (error) {
    console.error("Error fetching outstanding invoices:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching outstanding invoices",
      error: error.message,
    });
  }
};

// Create Customer Security Deposit
exports.createSecurityDeposit = async (req, res) => {
  const {
    customerNo,
    facilityId,
    amount,
    mode_of_payment,
    bank_account_id,
    reference_number,
    created_by,
    product_id,
    quantity,
    deposit_amount,
    total_amount,
    transaction_date,
    cheque_number,
    line_of_business,
  } = req.body;

  const lineOfBusinessString = String(line_of_business);

  try {
    // Validate required fields
    if (
      !customerNo ||
      !facilityId ||
      !amount ||
      !mode_of_payment ||
      !reference_number ||
      !created_by ||
      !product_id ||
      !quantity ||
      !deposit_amount ||
      !total_amount ||
      !transaction_date
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // Validate payment method
    const validPaymentMethods = ["cash", "cheque", "bank"];
    if (!validPaymentMethods.includes(mode_of_payment)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment method. Must be one of: cash, cheque, bank",
      });
    }

    // Validate bank account for bank/cheque payments
    if (
      (mode_of_payment === "bank" || mode_of_payment === "cheque") &&
      !bank_account_id
    ) {
      return res.status(400).json({
        success: false,
        message: "Bank account is required for bank/cheque payments",
      });
    }

    // Check if reference number already exists
    const existingDeposit = await db.customerSecurityDeposit.findOne({
      where: { reference_number },
    });

    if (existingDeposit) {
      return res.status(400).json({
        success: false,
        message: "Reference number already exists",
      });
    }

    // Verify customer exists
    const customer = await db.Customer.findOne({
      where: { customerNo, facilityId },
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    // Verify product exists
    const product = await db.Product.findOne({
      where: { id: product_id, facility_id: facilityId },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Create the security deposit
    const securityDeposit = await db.customerSecurityDeposit.create({
      customerNo,
      facilityId,
      amount: parseFloat(amount),
      mode_of_payment,
      bank_account_id: bank_account_id || null,
      reference_number,
      created_by,
      product_id: parseInt(product_id),
      quantity: parseInt(quantity),
      deposit_amount: parseFloat(deposit_amount),
      total_amount: parseFloat(total_amount),
      transaction_date,
      cheque_number: cheque_number || null,
      line_of_business: lineOfBusinessString,
      status: "active",
    });

    // // Create accounting entries if needed
    // if (mode_of_payment === 'cash' || mode_of_payment === 'bank' || mode_of_payment === 'cheque') {
    //   // Create general ledger entry for the deposit
    //   await db.GeneralLedger.create({
    //     facility_id: facilityId,
    //     account_head: product.deposit_liability_account || '04', // Use product's deposit liability account
    //     subhead: product.sku || '',
    //     description: `Security deposit for ${product.name} - ${reference_number}`,
    //     debit: parseFloat(total_amount),
    //     credit: 0,
    //     balance: parseFloat(total_amount),
    //     transaction_date,
    //     reference: reference_number,
    //     created_by,
    //     narration: `Customer: ${customer.fullname} - Product: ${product.name} - Qty: ${quantity}`
    //   });

    //   // Create corresponding credit entry for cash/bank
    //   const cashAccount = mode_of_payment === 'cash' ? bank_account_id : bank_account_id;
    //   await db.GeneralLedger.create({
    //     facility_id: facilityId,
    //     account_head: cashAccount,
    //     subhead: '',
    //     description: `Security deposit received - ${reference_number}`,
    //     debit: 0,
    //     credit: parseFloat(total_amount),
    //     balance: -parseFloat(total_amount),
    //     transaction_date,
    //     reference: reference_number,
    //     created_by,
    //     narration: `Customer: ${customer.fullname} - Payment: ${mode_of_payment}`
    //   });
    // }

    res.status(201).json({
      success: true,
      message: "Security deposit created successfully",
      data: {
        id: securityDeposit.id,
        reference_number: securityDeposit.reference_number,
        customerNo: securityDeposit.customerNo,
        amount: securityDeposit.amount,
        status: securityDeposit.status,
        transaction_date: securityDeposit.transaction_date,
      },
    });
  } catch (error) {
    console.error("Error creating security deposit:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Helper function to create product upload (base function)
const createProductUploadBase = async (req, res, itemType) => {
  const { products = [], facilityId, created_by } = req.body;
  const transaction = await db.sequelize.transaction();

  if (!Array.isArray(products) || products.length === 0) {
    await transaction.rollback();
    return res.status(400).json({
      success: false,
      message: "No product data provided. Expected 'products' array.",
    });
  }

  if (!facilityId) {
    await transaction.rollback();
    return res.status(400).json({
      success: false,
      message: "facilityId is required in request body.",
    });
  }

  try {
    const userId = created_by || req.user?.id || null;
    const createdProducts = [];
    const errors = [];

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const index = i + 1;

      try {
        const {
          sku,
          item_name,
          selling_price = 0,
          revenue_account = "",
          cost_price = 0,
          cogs_account = "",
          stock_quantity = 0,
          opening_balance_date = "",
          reorder_level = 0,
          expiry_date = "",
          inventory_account = "",
          unit_of_measure = "pcs",
          quantity = 0, // For WIP
        } = product;

        // Generate SKU if not provided
        const productSku = sku || `PROD-${Date.now()}-${index}`;

        // Create product using Product model
        const newProduct = await db.Product.create(
          {
            name: item_name,
            sku: productSku,
            item_type: itemType,
            facility_id: facilityId,
            selling_price: parseFloat(selling_price) || 0,
            revenue_account: revenue_account || null,
            cost_price: parseFloat(cost_price) || 0,
            cogs_head: cogs_account || null,
            stock_quantity: parseFloat(stock_quantity) || 0,
            reorder_level: parseFloat(reorder_level) || 0,
            inventory_account: inventory_account || null,
            unit_of_measure: unit_of_measure || "pcs",
            status: "Active",
            taxable: product.taxable || "Taxable", // Required by Product model
          },
          { transaction },
        );

        // Create store entry if quantity > 0
        if (itemType === "WIP") {
          const qty = parseFloat(quantity) || 0;
          if (qty > 0) {
            await db.StoreEntry.create(
              {
                product_id: newProduct.id,
                facilityId: facilityId,
                qty_in: qty,
                qty_out: 0,
                cost_price: parseFloat(cost_price) || 0,
                selling_price: parseFloat(selling_price) || 0,
                status: "approved",
                type: STORE_ENTRY_TYPE.OPENING_BALANCE,
                branch_name: "for sales",
                inserted_by: userId,
                receive_date:
                  opening_balance_date || moment().format("YYYY-MM-DD"),
                expiry_date: expiry_date || null,
              },
              { transaction },
            );
          }
        } else if (stock_quantity > 0) {
          await db.StoreEntry.create(
            {
              product_id: newProduct.id,
              facilityId: facilityId,
              qty_in: parseFloat(stock_quantity),
              qty_out: 0,
              cost_price: parseFloat(cost_price) || 0,
              selling_price: parseFloat(selling_price) || 0,
              status: "approved",
              type: STORE_ENTRY_TYPE.OPENING_BALANCE,
              branch_name: "for sales",
              inserted_by: userId,
              receive_date:
                opening_balance_date || moment().format("YYYY-MM-DD"),
              expiry_date: expiry_date || null,
            },
            { transaction },
          );
        }

        createdProducts.push(newProduct);
      } catch (itemError) {
        console.error(`Error processing product #${index}:`, itemError);
        errors.push(
          `Product #${index} (${product.item_name || "unknown"}): ${
            itemError.message
          }`,
        );
      }
    }

    if (createdProducts.length === 0 && errors.length > 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "No products were created",
        errors,
      });
    }

    if (errors.length > 0) {
      await transaction.commit();
      return res.status(207).json({
        success: true,
        message: `Created ${createdProducts.length} products with ${errors.length} failures`,
        createdCount: createdProducts.length,
        failedCount: errors.length,
        createdProducts,
        errors,
      });
    }

    await transaction.commit();
    return res.status(201).json({
      success: true,
      message: `Successfully created ${createdProducts.length} products`,
      createdCount: createdProducts.length,
      createdProducts,
    });
  } catch (error) {
    await transaction.rollback();
    console.error(`BulkCreateProducts (${itemType}) error:`, error);
    return res.status(500).json({
      success: false,
      message: "Error during bulk product creation",
      error: error.message,
    });
  }
};

// Finished Good Product Upload
exports.CreateProductUploadFinishedGood = async (req, res) => {
  return createProductUploadBase(req, res, "Finished Good");
};

// Resalable Product Upload
exports.CreateProductUploadResalable = async (req, res) => {
  return createProductUploadBase(req, res, "Resalable");
};

// // Service Product Upload
// exports.CreateProductUploadService = async (req, res) => {
//   return createProductUploadBase(req, res, "Service");
// };

exports.CreateProductUploadRawMaterial = async (req, res) => {
  const transaction = await db.sequelize.transaction();

  try {
    if (!Array.isArray(req.body) || req.body.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Request body must be a non-empty array of raw materials.",
      });
    }

    const rawMaterials = req.body;
    const {
      facility_id,
      user_id,
      as_of_date = new Date().toISOString().split("T")[0],
    } = req.body[0] || {};

    if (!facility_id || !user_id) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facility_id and user_id are required.",
      });
    }

    const created = [];

    const defaultBranchId = await resolveDefaultBranchId(facility_id, transaction);

    for (let i = 0; i < rawMaterials.length; i++) {
      const item = rawMaterials[i];
      const index = i + 1;

      const {
        item_name: name,
        sku,
        image_url,
        selling_price = 0,
        revenue_account = "",
        cost_price = 0,
        quantity = 0,
        reorder_level = 0,
        inventory_account,
        cogs_head,
        expiry_date = null,
        batch_number = null,
        deposit_liability_account = "",
        status = "Active",
        tags = "",
        notes = "",
        supplier_id = "",
        warehouse_id = "",
        category = "",
        unit = "",
        line_of_business = "",
        opening_balance_equity = "",
        opening_balance_date: item_as_of_date,
      } = item;

      if (!name || !inventory_account || !cogs_head) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Item #${index} (${name || "unknown"}): Missing required fields (item_name, inventory_account, cogs_head)`,
          failedAt: index,
        });
      }

      const itemFacilityId = item.facility_id || facility_id;
      const itemUserId = item.user_id || user_id;
      const finalAsOfDate = item_as_of_date || as_of_date;

      const [inventoryAccount, cogsAccount] = await Promise.all([
        db.AccountCategory.findOne({
          where: { code: inventory_account, facility_id: itemFacilityId },
          transaction,
        }),
        db.AccountCategory.findOne({
          where: { code: cogs_head, facility_id: itemFacilityId },
          transaction,
        }),
      ]);

      if (!inventoryAccount) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Item #${index} (${name}): Inventory account "${inventory_account}" not found`,
          failedAt: index,
        });
      }
      if (!cogsAccount) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Item #${index} (${name}): COGS account "${cogs_head}" not found`,
          failedAt: index,
        });
      }

      const qty_in = quantity;
      const shouldCreateStoreEntry = qty_in > 0;
      const productSku =
        sku ||
        (await numberGenerator({
          query_type: "PRODUCT",
          facility_id: itemFacilityId,
        }));

      const product = await db.Product.create(
        {
          name,
          sku: productSku,
          item_type: "Raw Material",
          image_url: image_url || "",
          facility_id: itemFacilityId,
          selling_price,
          revenue_account,
          cost_price,
          cogs_head,
          supplier_id,
          reorder_level,
          warehouse_id,
          category,
          inventory_account,
          unit_of_measure: unit,
          status,
          deposit_liability_account,
          tags,
          notes,
          line_of_business: line_of_business ? 1 : 0,
          taxable: item.taxable || "Taxable",
        },
        { transaction },
      );

      let storeEntry = null;

      if (shouldCreateStoreEntry) {
        const obRef = `OB-${await getAndUpdateNumber("OB", itemFacilityId)}`;

        storeEntry = await db.StoreEntry.create(
          {
            product_id: product.sku,
            batch_id: batch_number || null,
            qty_in,
            qty_out: 0,
            cost_price: cost_price || 0,
            selling_price: selling_price || 0,
            supplier_code: "",
            branch_name: "Raw Material",
            branchId: defaultBranchId,
            source: "Initial Stock",
            destination: "Raw Material",
            facilityId: itemFacilityId,
            status: "Active",
            inserted_by: itemUserId,
            type: STORE_ENTRY_TYPE.OPENING_BALANCE,
            receive_date: new Date().toISOString().split("T")[0],
            reference_number: obRef,
            truckNo: "",
            waybillNo: "",
            otherInfo: "Bulk initial stock entry",
            expiry_date: expiry_date || null,
          },
          { transaction },
        );

        if (quantity > 0 && cost_price > 0) {
          const amount = cost_price * quantity;
          const narration = `Opening Balance - ${name} - Qty: ${quantity} @ ${cost_price}`;
          const openingBalanceDate = moment(finalAsOfDate).format("YYYY-MM-DD");

          const openingBalanceEquityAccount = opening_balance_equity
            ? await db.AccountCategory.findOne({
                where: {
                  code: opening_balance_equity,
                  facility_id: itemFacilityId,
                },
                transaction,
              })
            : null;

          if (opening_balance_equity && !openingBalanceEquityAccount) {
            await transaction.rollback();
            return res.status(400).json({
              success: false,
              message: `Item #${index} (${name}): Opening balance equity account "${opening_balance_equity}" not found`,
              failedAt: index,
            });
          }

          await db.GeneralLedger.create(
            {
              transaction_date: openingBalanceDate,
              account_code: inventoryAccount.code,
              account_subhead: inventoryAccount.parent_code || 0,
              dr: amount,
              cr: 0,
              account_description: inventoryAccount.description,
              transaction_description: name,
              reference_number: obRef,
              purpose_of_payment: narration,
              created_by: itemUserId,
              facility_id: itemFacilityId,
              type: "OPENING_BALANCE",
              transaction_ref: product.sku,
            },
            { transaction },
          );

          if (openingBalanceEquityAccount) {
            await db.GeneralLedger.create(
              {
                transaction_date: openingBalanceDate,
                account_code: openingBalanceEquityAccount.code,
                account_subhead: openingBalanceEquityAccount.parent_code || 0,
                dr: 0,
                cr: amount,
                account_description: openingBalanceEquityAccount.description,
                transaction_description: name,
                reference_number: obRef,
                purpose_of_payment: narration,
                created_by: itemUserId,
                facility_id: itemFacilityId,
                type: "OPENING_BALANCE",
                transaction_ref: product.sku,
              },
              { transaction },
            );
          }
        }
      }

      created.push({
        index,
        sku: product.sku,
        name,
        productId: product.id,
        storeEntryId: storeEntry?.id || null,
      });
    }

    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: `Successfully created ${created.length} raw materials`,
      data: {
        summary: {
          total: rawMaterials.length,
          successful: created.length,
          failed: 0,
        },
        successful: created,
        failed: [],
      },
    });
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }
    console.error("Error in CreateProductUploadRawMaterial:", error);
    return res.status(500).json({
      success: false,
      message: `Raw material bulk creation failed: ${error.message}`,
      error: error.message,
    });
  }
};

// WIP Product Upload
exports.CreateProductUploadWip = async (req, res) => {
  const transaction = await db.sequelize.transaction();

  try {
    if (!Array.isArray(req.body) || req.body.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Request body must be a non-empty array of WIP items.",
      });
    }

    const wipItems = req.body;
    const { facility_id, user_id, opening_balance_equity } = req.body[0] || {};

    if (!facility_id || !user_id) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facility_id and user_id are required.",
      });
    }

    const created = [];

    const defaultBranchId = await resolveDefaultBranchId(facility_id, transaction);

    for (let i = 0; i < wipItems.length; i++) {
      const item = wipItems[i];
      const index = i + 1;

      const {
        sku,
        quantity = 0,
        cost_price = 0,
        opening_balance_date,
        opening_balance_equity: item_opening_balance_equity,
        wip_account: wip_code,
      } = item;

      if (!sku || sku.trim() === "") {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `WIP item #${index}: Missing required field: sku`,
          failedAt: index,
        });
      }
      if (quantity <= 0) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `WIP item #${index} (${sku}): quantity must be greater than 0`,
          failedAt: index,
        });
      }

      const itemFacilityId = item.facility_id || facility_id;
      const itemUserId = item.user_id || user_id;
      const openingBalanceDate =
        moment(opening_balance_date).format("YYYY-MM-DD");

      const product = await db.Product.findOne({
        where: { sku: sku.trim(), facility_id: itemFacilityId },
        transaction,
      });

      if (!product) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `WIP item #${index}: Product with SKU "${sku.trim()}" not found. Only existing products can be uploaded as WIP.`,
          failedAt: index,
        });
      }

      if (quantity > 0 && cost_price > 0 && !wip_code) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `WIP item #${index} (${product.name}): wip_account is required for opening balance journaling`,
          failedAt: index,
        });
      }

      let inventoryAccount = null;
      if (quantity > 0 && cost_price > 0) {
        inventoryAccount = await db.AccountCategory.findOne({
          where: { code: wip_code, facility_id: itemFacilityId },
          transaction,
        });
        if (!inventoryAccount) {
          await transaction.rollback();
          return res.status(400).json({
            success: false,
            message: `WIP item #${index} (${product.name}): WIP account "${wip_code}" not found`,
            failedAt: index,
          });
        }
      }

      let openingBalanceEquityAccount = null;
      const equityCode = item_opening_balance_equity || opening_balance_equity;
      if (equityCode && quantity > 0 && cost_price > 0) {
        openingBalanceEquityAccount = await db.AccountCategory.findOne({
          where: { code: equityCode, facility_id: itemFacilityId },
          transaction,
        });
        if (!openingBalanceEquityAccount) {
          await transaction.rollback();
          return res.status(400).json({
            success: false,
            message: `WIP item #${index} (${product.name}): Opening balance equity account "${equityCode}" not found`,
            failedAt: index,
          });
        }
      }

      const obRef = `OB-${await getAndUpdateNumber("OB", itemFacilityId)}`;

      const storeEntry = await db.StoreEntry.create(
        {
          product_id: product.sku,
          batch_id: null,
          qty_in: quantity,
          qty_out: 0,
          cost_price,
          selling_price: 0,
          supplier_code: "",
          branch_name: "Work In Progress",
          branchId: defaultBranchId,
          source: "Initial Stock",
          destination: "WIP",
          facilityId: itemFacilityId,
          status: "Active",
          inserted_by: itemUserId,
          type: STORE_ENTRY_TYPE.OPENING_BALANCE,
          receive_date: openingBalanceDate,
          reference_number: obRef,
          truckNo: "",
          waybillNo: "",
          otherInfo: "Bulk WIP opening stock entry",
          expiry_date: null,
        },
        { transaction },
      );

      if (quantity > 0 && cost_price > 0) {
        const amount = cost_price * quantity;
        const narration = `Opening Balance WIP - ${product.name} - Qty: ${quantity} @ ${cost_price}`;
        const ref = obRef;

        await db.GeneralLedger.create(
          {
            transaction_date: openingBalanceDate,
            account_code: inventoryAccount.code,
            account_subhead: inventoryAccount.parent_code || 0,
            dr: amount,
            cr: 0,
            account_description: inventoryAccount.description,
            transaction_description: product.name,
            reference_number: ref,
            purpose_of_payment: narration,
            created_by: itemUserId,
            facility_id: itemFacilityId,
            type: "OPENING_BALANCE",
            transaction_ref: product.sku,
          },
          { transaction },
        );

        if (openingBalanceEquityAccount) {
          await db.GeneralLedger.create(
            {
              transaction_date: openingBalanceDate,
              account_code: openingBalanceEquityAccount.code,
              account_subhead: openingBalanceEquityAccount.parent_code || 0,
              dr: 0,
              cr: amount,
              account_description: openingBalanceEquityAccount.description,
              transaction_description: product.name,
              reference_number: ref,
              purpose_of_payment: narration,
              created_by: itemUserId,
              facility_id: itemFacilityId,
              type: "OPENING_BALANCE",
              transaction_ref: product.sku,
            },
            { transaction },
          );
        }
      }

      created.push({
        index,
        sku: product.sku,
        name: product.name,
        productId: product.id,
        storeEntryId: storeEntry.id,
        quantityAdded: quantity,
        journalCreated: quantity > 0 && cost_price > 0,
      });
    }

    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: `Successfully processed ${created.length} WIP items`,
      data: {
        summary: {
          total: wipItems.length,
          successful: created.length,
          failed: 0,
        },
        successful: created,
        failed: [],
      },
    });
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }
    console.error("Error in CreateProductUploadWip:", error);
    return res.status(500).json({
      success: false,
      message: `WIP bulk upload failed: ${error.message}`,
      error: error.message,
    });
  }
};
exports.CreateProductUploadService = async (req, res) => {
  const transaction = await db.sequelize.transaction();

  try {
    if (!Array.isArray(req.body) || req.body.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Request body must be a non-empty array of service products.",
      });
    }

    const services = req.body;
    const { facilityId, created_by } = services[0] || {};

    if (!facilityId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId is required.",
      });
    }

    const created = [];

    for (let i = 0; i < services.length; i++) {
      const service = services[i];
      const index = i + 1;

      const {
        sku,
        item_name,
        selling_price = 0,
        revenue_account = "",
      } = service;

      if (!sku || !item_name) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Service #${index}: Missing required fields: ${!sku ? "sku " : ""}${!item_name ? "item_name" : ""}`,
          failedAt: index,
        });
      }

      const existingProduct = await db.Product.findOne({
        where: { sku, facility_id: facilityId },
        transaction,
      });

      if (existingProduct) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Service #${index}: Product with SKU "${sku}" already exists`,
          failedAt: index,
        });
      }

      const newProduct = await db.Product.create(
        {
          name: item_name,
          sku,
          item_type: "Service",
          line_of_business: 1,
          facility_id: facilityId,
          selling_price: parseFloat(selling_price) || 0,
          revenue_account: revenue_account || null,
          cost_price: 0,
          cogs_head: null,
          stock_quantity: 0,
          reorder_level: 0,
          inventory_account: null,
          unit_of_measure: "pcs",
          status: "Active",
          taxable: service.taxable || "Taxable",
        },
        { transaction },
      );

      created.push({
        index,
        sku: newProduct.sku,
        name: newProduct.name,
        id: newProduct.id,
      });
    }

    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: `Successfully created ${created.length} service product(s)`,
      data: {
        summary: { successful: created.length, failed: 0 },
        successful: created,
        failed: [],
      },
    });
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }
    console.error("CreateProductUploadService error:", error);
    return res.status(500).json({
      success: false,
      message: `Service product creation failed: ${error.message}`,
      error: error.message,
    });
  }
};
// Get combined suppliers and customers for typeahead
exports.getCombinedSuppliersAndCustomers = async (req, res) => {
  try {
    const { facilityId, search } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Build where clauses for both suppliers and customers
    const supplierWhere = { facilityId };
    const customerWhere = { facilityId };

    // Add search filter if provided
    if (search) {
      const searchFilter = { [db.Sequelize.Op.like]: `%${search}%` };
      supplierWhere[db.Sequelize.Op.or] = [
        { supplier_name: searchFilter },
        { supplier_number: searchFilter },
        { phone: searchFilter },
        { email: searchFilter },
      ];
      customerWhere[db.Sequelize.Op.or] = [
        { fullname: searchFilter },
        { customerNo: searchFilter },
        { phone: searchFilter },
        { email: searchFilter },
      ];
    }

    // Fetch suppliers and customers
    const suppliers = await db.SuppliersInfo.findAll({
      where: supplierWhere,
      attributes: [
        "supplier_number",
        "supplier_name",
        "phone",
        "email",
        "address",
        "status",
        "balance",
        "payable_code",
        "payable_accural_code",
        "facilityId",
      ],
      order: [["supplier_name", "ASC"]],
    });

    const customers = await db.Customer.findAll({
      where: customerWhere,
      attributes: [
        "customerNo",
        "fullname",
        "phone",
        "email",
        "address",
        "customer_type",
        "status",
        "balance",
        "receivable_code",
        "receivable_accural_code",
        "facilityId",
      ],
      order: [["fullname", "ASC"]],
    });

    // Combine and format the results
    const combined = [
      ...suppliers.map((supplier) => ({
        id: supplier.supplier_number,
        name: supplier.supplier_name,
        type: "supplier",
        contact: supplier.phone || supplier.email || supplier.address || "",
        code:
          supplier.payable_code ||
          supplier.payable_accural_code ||
          supplier.supplier_number,
        balance: supplier.balance || 0,
        email: supplier.email,
        phone: supplier.phone,
        address: supplier.address,
        status: supplier.status,
      })),
      ...customers.map((customer) => ({
        id: customer.customerNo,
        name: customer.fullname,
        type: "customer",
        contact: customer.phone || customer.email || customer.address || "",
        code:
          customer.receivable_code ||
          customer.receivable_accural_code ||
          customer.customerNo,
        balance: customer.balance || 0,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
        status: customer.status,
      })),
    ].sort((a, b) => a.name.localeCompare(b.name));

    return res.status(200).json({
      success: true,
      results: combined,
      count: combined.length,
    });
  } catch (error) {
    console.error("Error getting combined suppliers and customers:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching combined suppliers and customers",
      error: error.message,
    });
  }
};

/**
 * Apply existing customer advance / deposit to open sales invoices.
 * No new cash is received — consumes deposit liability against A/R.
 *
 * POST /api/v1/apply-customer-advance
 * body: {
 *   facilityId, userId, customer_no,
 *   applications: [{ invoice_ref, amount }],
 *   transaction_date?, narration?
 * }
 */
function paymentModesFromHistory(history) {
  const list = Array.isArray(history) ? history : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const raw = list[i]?.payment_modes;
    if (Array.isArray(raw) && raw.length) {
      return raw
        .map((m) => String(m || "").toLowerCase().trim())
        .filter(Boolean);
    }
  }
  return [];
}

function remainderTypeAfterDeposit(modes) {
  const hasCash = modes.includes("cash");
  const hasTransfer = modes.includes("transfer");
  const hasCredit = modes.includes("credit");
  if (hasCredit && (hasCash || hasTransfer)) return "credit_split";
  if (hasCash && hasTransfer) return "split";
  if (hasTransfer) return "transfer";
  if (hasCash) return "cash";
  if (hasCredit) return "credit";
  // Deposit-only: remainder is collected as cash at Verification Points.
  return "cash";
}

exports.applyCustomerAdvanceToInvoices = async (req, res) => {
  const {
    facilityId,
    userId,
    customer_no,
    applications = [],
    narration = "",
  } = req.body;

  if (!facilityId) {
    return res.status(400).json({ success: false, error: "facilityId is required" });
  }
  if (!userId) {
    return res.status(400).json({ success: false, error: "userId is required" });
  }
  if (!customer_no) {
    return res.status(400).json({ success: false, error: "customer_no is required" });
  }
  if (!Array.isArray(applications) || applications.length === 0) {
    return res.status(400).json({
      success: false,
      error: "applications must be a non-empty array of { invoice_ref, amount }",
    });
  }

  let normalizedTxDate;
  try {
    normalizedTxDate = validatePostingDate(
      req.body.transaction_date || new Date(),
      { field: "transaction_date" },
    );
  } catch (dateErr) {
    return res.status(400).json({ success: false, error: dateErr.message });
  }
  const transactionDate = new Date(`${normalizedTxDate}T12:00:00`);

  try {
    const customer = await Customer.findOne({
      where: { customerNo: customer_no, facilityId },
    });
    if (!customer) {
      return res.status(404).json({ success: false, error: "Customer not found" });
    }

    const business = await db.business.findOne({ where: { id: facilityId } });
    const depositCode =
      customer.receivable_accural_code ||
      business?.receivable_accural_code ||
      "";
    const receivableCode =
      customer.receivable_code || business?.receivable_code || "";

    if (!depositCode || !receivableCode) {
      return res.status(400).json({
        success: false,
        error:
          "Customer advance/receivable accounts are not configured (receivable_accural_code / receivable_code)",
      });
    }

    const [depositAccount, receivableAccount] = await Promise.all([
      db.AccountCategory.findOne({
        where: { code: depositCode, facility_id: facilityId },
      }),
      db.AccountCategory.findOne({
        where: { code: receivableCode, facility_id: facilityId },
      }),
    ]);
    if (!depositAccount) {
      return res.status(404).json({
        success: false,
        error: `Deposit/advance account not found: ${depositCode}`,
      });
    }
    if (!receivableAccount) {
      return res.status(404).json({
        success: false,
        error: `Receivable account not found: ${receivableCode}`,
      });
    }

    // Available advance: deposit liability only (not netted against A/R invoices)
    const balRows = await db.sequelize.query(
      `SELECT COALESCE(SUM(cr) - SUM(dr), 0) AS available_deposit
       FROM general_ledger
       WHERE LOWER(type) = 'deposit'
         AND facility_id = :facilityId
         AND (
           transaction_ref = :customerNo
           OR transaction_ref LIKE CONCAT(:customerNo, '-%')
         )`,
      {
        replacements: { facilityId, customerNo: customer_no },
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );
    const availableDeposit = Math.max(
      0,
      parseFloat(balRows[0]?.available_deposit || 0),
    );

    const cleaned = [];
    let totalApply = 0;
    for (const row of applications) {
      const invoice_ref = String(row.invoice_ref || row.invoiceRef || "").trim();
      const amount = parseAmount(row.amount) ?? 0;
      if (!invoice_ref || amount <= 0) continue;
      cleaned.push({ invoice_ref, amount });
      totalApply += amount;
    }
    if (cleaned.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No valid application amounts provided",
      });
    }
    if (totalApply > availableDeposit + 0.01) {
      return res.status(400).json({
        success: false,
        error: `Apply total (${totalApply}) exceeds available advance (${availableDeposit})`,
        available_deposit: availableDeposit,
      });
    }

    const referenceNumber = `AA-${await getAndUpdateNumber("AA", facilityId)}`;
    const customerName = customer.fullname || customer_no;
    const descBase =
      String(narration || "").trim() ||
      `Advance applied to invoices — ${customerName}`;

    const applied = await db.sequelize.transaction(async (t) => {
      let remainingPool = availableDeposit;
      const settled = [];

      for (const { invoice_ref, amount } of cleaned) {
        const applyAmt = Math.min(amount, remainingPool);
        if (applyAmt <= 0) break;

        // DR deposit liability (consume advance)
        await GeneralLedger.create(
          {
            transaction_date: transactionDate,
            account_code: depositAccount.code,
            account_subhead: depositAccount.parent_code || 0,
            dr: applyAmt,
            cr: 0,
            account_description: depositAccount.description,
            transaction_description: `${descBase} — ${invoice_ref}`,
            reference_number: invoice_ref,
            purpose_of_payment: `Apply customer advance — ${invoice_ref}`,
            payee: customerName,
            created_by: userId,
            facility_id: facilityId,
            status: "posted",
            type: "deposit",
            transaction_ref: customer_no,
          },
          { transaction: t },
        );

        // CR A/R (reduce outstanding)
        await GeneralLedger.create(
          {
            transaction_date: transactionDate,
            account_code: receivableAccount.code,
            account_subhead:
              receivableAccount.subhead ||
              receivableAccount.parent_code ||
              0,
            dr: 0,
            cr: applyAmt,
            account_description: receivableAccount.description,
            transaction_description: `${descBase} — ${invoice_ref}`,
            reference_number: invoice_ref,
            purpose_of_payment: `Apply customer advance — ${invoice_ref}`,
            payee: customerName,
            created_by: userId,
            facility_id: facilityId,
            status: "posted",
            type: "receivable",
            transaction_ref: customer_no,
          },
          { transaction: t },
        );

        await CustomerEntry.create(
          {
            customerNo: customer_no,
            description: `Advance applied — ${invoice_ref}`,
            qty_in: 0,
            qty_out: 0,
            cost: applyAmt,
            amount_paid: applyAmt,
            facilityId,
            mode_of_payment: "ADVANCE",
            link_id: invoice_ref,
            type: "deposit",
            receiptNo: referenceNumber,
            bank_account_id: "",
            created_by: userId,
            created_at: new Date(),
          },
          { transaction: t },
        );

        remainingPool -= applyAmt;
        settled.push({ invoice_ref, amount: applyAmt });

        // Move sale workflow after deposit application
        if (db.SaleWorkflow) {
          const wf = await db.SaleWorkflow.findOne({
            where: {
              facility_id: facilityId,
              sale_code: invoice_ref,
            },
            transaction: t,
          });
          if (wf) {
            // wf.amount is outstanding (reduced by deposit); cash/transfer live in history
            const due = Number(wf.amount) || 0;
            const history = Array.isArray(wf.history) ? [...wf.history] : [];
            let collected = 0;
            let creditAlloc = 0;
            for (const h of history) {
              const amt = Number(h?.collection?.amount) || 0;
              if (amt > 0) collected += amt;
              if (h?.credit_allocation?.amount != null) {
                creditAlloc = Number(h.credit_allocation.amount) || 0;
              }
            }
            const remaining = Number(
              (due - collected - creditAlloc - applyAmt).toFixed(2),
            );
            history.push({
              status: wf.status,
              at: new Date().toISOString(),
              by: userId,
              note: `Deposit applied ₦${applyAmt.toFixed(2)} (balance was ₦${due.toFixed(2)})`,
              deposit_application: { amount: applyAmt },
            });

            if (remaining <= 0.05) {
              wf.status = "invoice_separation";
              wf.amount = 0;
              history.push({
                status: "invoice_separation",
                at: new Date().toISOString(),
                by: userId,
                note: "Last payment (deposit) — ready for Invoice Separation",
              });
            } else {
              const modes = paymentModesFromHistory(history);
              const nextType = remainderTypeAfterDeposit(modes);
              wf.amount = Number((due - applyAmt).toFixed(2));
              if (nextType === "credit") {
                wf.status = "awaiting_credit_approval";
                wf.payment_type = "credit";
                history.push({
                  status: "awaiting_credit_approval",
                  at: new Date().toISOString(),
                  by: userId,
                  note: `Deposit partial — ₦${remaining.toFixed(2)} remainder awaits Credit Approval before Separation`,
                  payment_modes: modes,
                });
              } else {
                wf.status = "awaiting_cashier_confirm";
                wf.payment_type = nextType;
                history.push({
                  status: "awaiting_cashier_confirm",
                  at: new Date().toISOString(),
                  by: userId,
                  note: `Deposit partial — ₦${remaining.toFixed(2)} remainder to collect as ${nextType}`,
                  payment_modes: modes,
                });
              }
            }
            wf.history = history;
            if (typeof wf.changed === "function") wf.changed("history", true);
            wf.updated_by = userId;
            await wf.save({ transaction: t });
          }
        }
      }

      return settled;
    });

    const appliedTotal = applied.reduce((s, x) => s + x.amount, 0);
    return res.status(201).json({
      success: true,
      message: `Applied advance of ${appliedTotal.toLocaleString()} to ${applied.length} invoice(s)`,
      data: {
        reference_number: referenceNumber,
        customer_no,
        applied_total: appliedTotal,
        available_before: availableDeposit,
        available_after: Math.max(0, availableDeposit - appliedTotal),
        applications: applied,
      },
    });
  } catch (error) {
    console.error("applyCustomerAdvanceToInvoices:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to apply customer advance",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
