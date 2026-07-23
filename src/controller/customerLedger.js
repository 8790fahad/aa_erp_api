const db = require("../models");
const moment = require("moment");
const { Op } = require("sequelize");

/**
 * Create a new customer with proper ledger setup
 */
exports.createCustomer = async (req, res) => {
  const transaction = await db.sequelize.transaction();

  try {
    const {
      fullname,
      email,
      phone,
      address,
      customer_type = "customers",
      credit_limit = 0,
      facilityId,
      store_name,
      created_by,
    } = req.body;

    // Get user ID from request (you may need to adjust this based on your auth middleware)
    const userId = created_by || req.user?.id || null;

    // Validate required fields
    if (!fullname || !facilityId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Fullname and facilityId are required",
      });
    }

    // Get business details to get account codes
    const business = await db.Business.findByPk(facilityId, { transaction });
    if (!business) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }

    // Generate customer number
    const numberResult = await db.sequelize.query(
      `CALL nurmber_generator1(:in_query_type, :facilityId)`,
      {
        replacements: { in_query_type: "cus", facilityId },
        transaction,
      }
    );

    const customerNo = `${numberResult[0].cus}`;

    // Create customer
    const customer = await db.Customer.create(
      {
        customerNo,
        facilityId,
        fullname,
        store_name: store_name || business.business_name,
        address,
        phone,
        email,
        customer_type,
        status: "active",
        credit_limit: parseFloat(credit_limit) || 0,
        created_by: userId,
      },
      { transaction }
    );

    // Create customer entry for opening balance (if any)
    if (credit_limit > 0) {
      await db.CustomerEntry.create(
        {
          customerNo,
          description: "Opening Balance",
          dr: 0,
          cr: parseFloat(credit_limit),
          facilityId,
          mode_of_payment: "opening_balance",
          receiptNo: `OB-${customerNo}`,
          created_by: userId,
        },
        { transaction }
      );
    }

    // Update number generator
    await db.sequelize.query(
      `CALL update_number_generator(:query_type, :in_number, :facilityId)`,
      {
        replacements: {
          query_type: "cus",
          in_number: numberResult[0].cus,
          facilityId,
        },
        transaction,
      }
    );

    await transaction.commit();

    res.status(201).json({
      success: true,
      message: "Customer created successfully",
      customerNo,
      customer: {
        customerNo,
        fullname,
        email,
        phone,
        address,
        customer_type,
        credit_limit,
        status: "active",
      },
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Create customer error:", error);
    res.status(500).json({
      success: false,
      message: "Error creating customer",
      error: error.message,
    });
  }
};

/**
 * Record customer deposit with proper ledger entries
 */
exports.recordDeposit = async (req, res) => {
  const transaction = await db.sequelize.transaction();

  try {
    const {
      customerNo,
      amount,
      mode_of_payment = "CASH",
      bank_name = "",
      bank_code = "",
      bank_chart_code = "",
      description = "Customer Deposit",
      remark = "",
      facilityId,
      created_by,
    } = req.body;

    // Get user ID from request
    const userId = created_by || req.user?.id || null;

    // Validate required fields
    if (!customerNo || !amount || !facilityId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "customerNo, amount, and facilityId are required",
      });
    }

    const depositAmount = parseFloat(amount);
    if (depositAmount <= 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Amount must be greater than 0",
      });
    }

    // Get customer details
    const customer = await db.Customer.findOne({
      where: { customerNo, facilityId },
      transaction,
    });

    if (!customer) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    // Get business details for account codes
    const business = await db.Business.findByPk(facilityId, { transaction });
    if (!business) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }

    // Generate receipt number
    const receiptNo = `CD-${moment().format("YYMMDDHHmmss")}`;
    const transactionRef = `TXN-${Date.now()}`;

    // Get customer's current balance
    const customerEntries = await db.CustomerEntry.findAll({
      where: { customerNo, facilityId },
      transaction,
    });

    const totalDebit = customerEntries.reduce(
      (sum, entry) => sum + parseFloat(entry.dr || 0),
      0
    );
    const totalCredit = customerEntries.reduce(
      (sum, entry) => sum + parseFloat(entry.cr || 0),
      0
    );
    const currentBalance = totalDebit - totalCredit;

    // Determine if this is a prepayment (overpayment)
    const isPrepayment = depositAmount > currentBalance;

    // Create customer entry
    const customerEntry = await db.CustomerEntry.create(
      {
        customerNo,
        description: description || "Customer Deposit",
        dr: 0,
        cr: depositAmount,
        facilityId,
        mode_of_payment,
        receiptNo,
        created_by: userId,
      },
      { transaction }
    );

    // Create payment record
    const payment = await db.Payment.create(
      {
        customerNo,
        payment_ref: receiptNo,
        amount: depositAmount,
        payment_date: new Date(),
        mode_of_payment,
        facilityId,
      },
      { transaction }
    );

    // Determine account codes based on business settings
    const cashAccountCode = bank_code || business.payable_code || "1001"; // Default cash account
    const receivableAccountCode = business.receivable_code || "1200"; // Default receivable account
    const prepaymentAccountCode = business.receivable_prepayment_code || "1201"; // Prepayment account

    // Create ledger entries
    const ledgerEntries = [];

    // 1. Debit Cash/Bank account
    ledgerEntries.push({
      transaction_date: moment().format("YYYY-MM-DD"),
      account_code: cashAccountCode,
      account_subhead: bank_chart_code || "CASH",
      dr: depositAmount,
      cr: 0,
      account_description: bank_name || "Cash",
      transaction_description: `${description} - ${customer.fullname}`,
      reference_number: receiptNo,
      purpose_of_payment: description,
      payee: customer.fullname,
      bank_account_id: bank_code,
      mode_of_payment,
      created_by,
      facility_id: facilityId,
      status: "paid",
      type: "bank",
      transaction_ref,
    });

    // 2. Credit Receivable or Prepayment account
    const creditAccountCode = isPrepayment
      ? prepaymentAccountCode
      : receivableAccountCode;
    const creditDescription = isPrepayment
      ? "Customer Prepayment"
      : "Accounts Receivable";

    ledgerEntries.push({
      transaction_date: moment().format("YYYY-MM-DD"),
      account_code: creditAccountCode,
      account_subhead: customerNo,
      dr: 0,
      cr: depositAmount,
      account_description: customer.fullname,
      transaction_description: `${description} - ${customer.fullname}`,
      reference_number: receiptNo,
      purpose_of_payment: description,
      payee: customer.fullname,
      mode_of_payment,
      created_by,
      facility_id: facilityId,
      status: "paid",
      type: isPrepayment ? "prepayment" : "payable",
      transaction_ref,
    });

    // Insert ledger entries
    await db.GeneralLedger.bulkCreate(ledgerEntries, { transaction });

    await transaction.commit();

    res.status(201).json({
      success: true,
      message: "Deposit recorded successfully",
      receiptNo,
      customerNo,
      amount: depositAmount,
      newBalance: currentBalance - depositAmount,
      isPrepayment,
      entry_id: customerEntry.entry_id,
      payment_id: payment.payment_id,
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Record deposit error:", error);
    res.status(500).json({
      success: false,
      message: "Error recording deposit",
      error: error.message,
    });
  }
};

/**
 * Get customer balance and transaction history
 */
exports.getCustomerBalance = async (req, res) => {
  try {
    const { customerNo, facilityId } = req.params;

    if (!customerNo || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "customerNo and facilityId are required",
      });
    }

    // Get customer details with creator and business information
    const customer = await db.Customer.findOne({
      where: { customerNo, facilityId },
      include: [
        {
          model: db.User,
          as: "creator",
          attributes: ["id", "firstname", "lastname", "email"],
        },
        {
          model: db.Business,
          as: "business",
          attributes: [
            "id",
            "business_name",
            "business_address",
            "primary_color",
          ],
        },
      ],
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    // Get customer entries (transactions) with creator information
    const customerEntries = await db.CustomerEntry.findAll({
      where: { customerNo, facilityId },
      order: [["created_at", "DESC"]],
      include: [
        {
          model: db.User,
          as: "creator",
          attributes: ["id", "firstname", "lastname", "email"],
        },
      ],
    });

    // Calculate balance
    const totalDebit = customerEntries.reduce(
      (sum, entry) => sum + parseFloat(entry.dr || 0),
      0
    );
    const totalCredit = customerEntries.reduce(
      (sum, entry) => sum + parseFloat(entry.cr || 0),
      0
    );
    const balance = totalDebit - totalCredit;

    // Get payments
    const payments = await db.Payment.findAll({
      where: { customerNo, facilityId },
      order: [["payment_date", "DESC"]],
    });

    res.json({
      success: true,
      customer: {
        customerNo: customer.customerNo,
        fullname: customer.fullname,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
        customer_type: customer.customer_type,
        credit_limit: customer.credit_limit,
        status: customer.status,
        created_by: customer.created_by,
        creator: customer.creator
          ? {
              id: customer.creator.id,
              name: `${customer.creator.firstname} ${customer.creator.lastname}`,
              email: customer.creator.email,
            }
          : null,
        business: customer.business
          ? {
              id: customer.business.id,
              name: customer.business.business_name,
              address: customer.business.business_address,
              primary_color: customer.business.primary_color,
            }
          : null,
      },
      balance: {
        total_debit: totalDebit,
        total_credit: totalCredit,
        current_balance: balance,
        is_overdue: balance > 0,
      },
      transactions: customerEntries.map((entry) => ({
        entry_id: entry.entry_id,
        description: entry.description,
        debit: entry.dr,
        credit: entry.cr,
        mode_of_payment: entry.mode_of_payment,
        receipt_no: entry.receiptNo,
        created_at: entry.created_at,
        created_by: entry.created_by,
        creator: entry.creator
          ? {
              id: entry.creator.id,
              name: `${entry.creator.firstname} ${entry.creator.lastname}`,
              email: entry.creator.email,
            }
          : null,
      })),
      payments: payments.map((payment) => ({
        payment_id: payment.payment_id,
        payment_ref: payment.payment_ref,
        amount: payment.amount,
        payment_date: payment.payment_date,
        mode_of_payment: payment.mode_of_payment,
      })),
    });
  } catch (error) {
    console.error("Get customer balance error:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving customer balance",
      error: error.message,
    });
  }
};

/**
 * Get all customers with their balances
 */
exports.getAllCustomers = async (req, res) => {
  try {
    const { facilityId, page = 1, limit = 50 } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Get customers with pagination
    const customers = await db.Customer.findAndCountAll({
      where: { facilityId },
      limit: parseInt(limit),
      offset,
      order: [["created_at", "DESC"]],
    });

    // Calculate balances for each customer
    const customersWithBalance = await Promise.all(
      customers.rows.map(async (customer) => {
        const entries = await db.CustomerEntry.findAll({
          where: { customerNo: customer.customerNo, facilityId },
        });

        const totalDebit = entries.reduce(
          (sum, entry) => sum + parseFloat(entry.dr || 0),
          0
        );
        const totalCredit = entries.reduce(
          (sum, entry) => sum + parseFloat(entry.cr || 0),
          0
        );
        const balance = totalDebit - totalCredit;

        return {
          ...customer.toJSON(),
          balance: {
            total_debit: totalDebit,
            total_credit: totalCredit,
            current_balance: balance,
            is_overdue: balance > 0,
          },
        };
      })
    );

    res.json({
      success: true,
      customers: customersWithBalance,
      pagination: {
        current_page: parseInt(page),
        total_pages: Math.ceil(customers.count / parseInt(limit)),
        total_customers: customers.count,
        per_page: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Get all customers error:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving customers",
      error: error.message,
    });
  }
};

/**
 * Create invoice (credit sale) - placeholder for future implementation
 */
exports.createInvoice = async (req, res) => {
  // This would be implemented when sales module is ready
  res.status(501).json({
    success: false,
    message: "Invoice creation not yet implemented",
  });
};
