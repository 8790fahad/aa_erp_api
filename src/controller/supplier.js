const db = require("../models");
// Create new supplier bank detail
const {
  SuppliersInfo,
  Invoice,
  GeneralLedger,
  Account,
  SupplierEntry,
  Business,
  SupplierEntries,
} = require("../models");
const createSupplierBankDetail = async (req, res) => {
  try {
    const {
      account_name,
      account_number,
      bank_name,
      //   subhead,
      //   head,
      sort_code,
      bank_code,
      facilityId,
      supplier_number,
      code,
    } = req.body;

    // Validate required fields
    if (!account_name || !account_number || !bank_name) {
      return res.status(400).json({
        message: "Account name, account number, and bank name are required",
        success: false,
      });
    }

    if (!facilityId) {
      return res.status(400).json({
        message: "Facility ID is required",
        success: false,
      });
    }

    // Check if account already exists for this supplier
    const existingAccount = await db.sequelize.query(
      `SELECT account_number FROM supplier_account_information
       WHERE account_number = :account_number
       AND facilityId = :facilityId
       AND status != 'deleted'`,
      {
        replacements: { account_number, facilityId },
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );

    if (existingAccount.length > 0) {
      return res.status(400).json({
        message: "This account number already exists",
        success: false,
      });
    }

    // Create bank detail
    await db.sequelize.query(
      `INSERT INTO supplier_account_information
       (supplier_number, account_name, account_number, bank_name, sort_code,bank_code, facilityId, status, code)
       VALUES (:supplier_number, :account_name, :account_number, :bank_name, :sort_code,:bank_code, :facilityId, 'active', :code)`,
      {
        replacements: {
          supplier_number,
          account_name,
          account_number,
          bank_name,
          sort_code: sort_code || null,
          bank_code,
          facilityId,
          code,
        },
      },
    );

    return res.status(201).json({
      message: "Bank details created successfully",
      success: true,
    });
  } catch (error) {
    console.error("Error creating bank details:", error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
    });
  }
};

// Update supplier bank detail
const updateSupplierBankDetail = async (req, res) => {
  const {
    account_name,
    account_number,
    bank_name,
    bank_code,
    sort_code,
    facilityId,
    supplier_number,
    code,
    original_account_number,
    original_supplier_number,
  } = req.body;

  console.log("Updating bank detail:", req.body);

  if (!original_account_number || !original_supplier_number) {
    return res.status(400).json({
      message:
        "Original account number and supplier number are required to update",
      success: false,
    });
  }

  try {
    // Check if bank detail exists
    const bankDetail = await db.sequelize.query(
      `SELECT * FROM supplier_account_information
       WHERE account_number = :original_account_number
       AND supplier_number = :original_supplier_number
       AND facilityId = :facilityId`,
      {
        replacements: {
          original_account_number,
          original_supplier_number,
          facilityId,
        },
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );

    if (bankDetail.length === 0) {
      return res.status(404).json({
        message: "Bank details not found",
        success: false,
      });
    }

    // Update bank details using composite key
    await db.sequelize.query(
      `UPDATE supplier_account_information
       SET account_name = :account_name,
           account_number = :account_number,
           bank_name = :bank_name,
           sort_code = :sort_code,
           bank_code = :bank_code,
           supplier_number = :supplier_number,
           code = :code
       WHERE account_number = :original_account_number
       AND supplier_number = :original_supplier_number
       AND facilityId = :facilityId`,
      {
        replacements: {
          account_name,
          account_number,
          bank_name,
          sort_code: sort_code || null,
          bank_code: bank_code,
          code,
          supplier_number,
          original_account_number,
          original_supplier_number,
          facilityId,
        },
      },
    );

    return res.status(200).json({
      message: "Bank details updated successfully",
      success: true,
    });
  } catch (error) {
    console.error("Error updating bank details:", error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
    });
  }
};

// Update bank detail status
const updateSupplierBankDetailStatus = async (req, res) => {
  const { bank_detail_id, status, facilityId } = req.body;

  console.log("Updating bank detail status:", { bank_detail_id, status });

  // Validate required fields
  if (!bank_detail_id || !status) {
    return res.status(400).json({
      message: "Both 'bank_detail_id' and 'status' are required",
      success: false,
    });
  }

  try {
    // Update bank detail status
    await db.sequelize.query(
      `UPDATE supplier_account_information
       SET status = :status, updated_at = NOW()
       WHERE id = :bank_detail_id AND facilityId = :facilityId`,
      {
        replacements: { status, bank_detail_id, facilityId },
      },
    );

    return res.status(200).json({
      message: "Bank details status updated successfully",
      success: true,
    });
  } catch (error) {
    console.error("Error updating bank detail status:", error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
    });
  }
};

// Get supplier bank details
const getSupplierBankDetails = async (req, res) => {
  try {
    const { facilityId, supplier_number } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        message: "facilityId is required",
        success: false,
      });
    }

    let query = `
      SELECT
        sai.id,
        sai.account_name,
        sai.account_number,
        sai.bank_name,
        sai.sort_code,
        sai.bank_code,
        sai.code,
        sai.status,
        sai.facilityId,
        sai.created_at,
        sai.updated_at
      FROM
        supplier_account_information sai
      WHERE
        sai.facilityId = :facilityId
        AND sai.status != 'deleted'
    `;

    let replacements = { facilityId };

    // Add supplier filter if provided
    if (supplier_number) {
      query += ` AND sai.supplier_number = :supplier_number`;
      replacements.supplier_number = supplier_number;
    }

    query += ` ORDER BY sai.created_at DESC`;

    const bankDetails = await db.sequelize.query(query, {
      replacements,
      type: db.Sequelize.QueryTypes.SELECT,
    });

    return res.status(200).json({
      message: "Bank details fetched successfully",
      results: bankDetails,
      success: true,
    });
  } catch (error) {
    console.error("Error fetching bank details:", error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
    });
  }
};

// Get bank details by supplier
const getBankDetailsBySupplier = async (req, res) => {
  try {
    const { facilityId, supplier_number } = req.params;

    if (!facilityId || !supplier_number) {
      return res.status(400).json({
        message: "Both 'facilityId' and 'supplier_number' are required",
        success: false,
      });
    }

    const bankDetails = await db.sequelize.query(
      `
      SELECT
        sai.id,
        sai.account_name,
        sai.account_number,
        sai.bank_name,
        sai.sort_code,
        sai.bank_code,
        sai.code,
        sai.status,
        sai.created_at,
        sai.updated_at
      FROM
        supplier_account_information sai
      WHERE
        sai.facilityId = :facilityId
        AND sai.supplier_number = :supplier_number
        AND sai.status = 'active'
      ORDER BY sai.created_at DESC
      `,
      {
        replacements: { facilityId, supplier_number },
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );

    console.log("Bank details found:", bankDetails.length);

    return res.status(200).json({
      message: "Bank details fetched successfully",
      results: bankDetails,
      success: true,
    });
  } catch (error) {
    console.error("Error fetching bank details by supplier:", error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
    });
  }
};

// Delete bank detail (soft delete)
const deleteSupplierBankDetail = async (req, res) => {
  try {
    const { account_number, supplier_number, facilityId } = req.body;

    if (!account_number || !supplier_number || !facilityId) {
      return res.status(400).json({
        message:
          "Account number, supplier number, and facility ID are required",
        success: false,
      });
    }

    // Check if bank detail exists
    const bankDetail = await db.sequelize.query(
      `SELECT account_number FROM supplier_account_information
       WHERE account_number = :account_number
       AND supplier_number = :supplier_number
       AND facilityId = :facilityId
       AND status != 'deleted'`,
      {
        replacements: { account_number, supplier_number, facilityId },
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );

    if (bankDetail.length === 0) {
      return res.status(404).json({
        message: "Bank details not found",
        success: false,
      });
    }

    // Soft delete bank detail using composite key
    await db.sequelize.query(
      `UPDATE supplier_account_information
       SET status = 'deleted'
       WHERE account_number = :account_number
       AND supplier_number = :supplier_number
       AND facilityId = :facilityId`,
      {
        replacements: { account_number, supplier_number, facilityId },
      },
    );

    return res.status(200).json({
      message: "Bank details deleted successfully",
      success: true,
    });
  } catch (error) {
    console.error("Error deleting bank details:", error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
    });
  }
};

// Get supplier deposit balance
const getSupplierDepositBalance = async (req, res) => {
  try {
    const { supplier_number } = req.params;
    const { facilityId } = req.query;

    // Validate required parameters
    if (!supplier_number) {
      return res.status(400).json({
        message: "Supplier number is required",
        success: false,
      });
    }

    if (!facilityId) {
      return res.status(400).json({
        message: "Facility ID is required",
        success: false,
      });
    }

    // Calculate supplier deposit balance using ORM-style query
    const balanceResult = await db.sequelize.query(
      `SELECT
        COALESCE(SUM(dr), 0) AS debit,
        COALESCE(SUM(cr), 0) AS credit,
        COALESCE(SUM(dr), 0) - COALESCE(SUM(cr), 0) AS balance
      FROM supplier_entries
      WHERE supplier_number = :supplier_number
      AND facilityId = :facilityId`,
      {
        replacements: {
          supplier_number,
          facilityId,
        },
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );

    const balance = balanceResult[0] || { debit: 0, credit: 0, balance: 0 };

    return res.status(200).json({
      message: "Supplier deposit balance calculated successfully",
      success: true,
      data: {
        supplier_number,
        facilityId,
        debit: parseFloat(balance.debit),
        credit: parseFloat(balance.credit),
        balance: parseFloat(balance.balance),
      },
    });
  } catch (error) {
    console.error("Error calculating supplier deposit balance:", error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
    });
  }
};

const getBalance = async (supplier_number, facilityId) => {
  const result = await db.sequelize.query(
    `SELECT SUM(cr) - SUM(dr) AS balance
     FROM general_ledger
     WHERE transaction_ref = :supplier_number
       AND facility_id = :facilityId
       AND type IN ('payable', 'payment', 'accrued')`,
    {
      replacements: { supplier_number, facilityId },
      type: db.Sequelize.QueryTypes.SELECT,
    },
  );
  console.log(result, "=====================>getBalance result");
  return parseFloat(result[0]?.balance || 0);
};
const getSupplierBalance = async (req, res) => {
  const { supplier_number, facilityId } = req.params;
  try {
    const balance = await getBalance(supplier_number, facilityId);
    res.json({ success: true, balance: balance });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

const createSupplierPayment = async (req, res) => {
  const {
    transaction_date,
    due_date,
    supplier_name,
    amount_paid,
    documentNumber,
    supplier_number,
    mode_of_payment,
    mod_account_code, // Bank/Cash
    cheque_number,
    facilityId,
    narration,
    payable_code,
    payable_accural_code,
    userId,
    bank_account_id,
    line_of_business,
  } = req.body;

  // Convert line_of_business to string
  const lineOfBusinessString = String(line_of_business);

  console.log(req.body, "payable_accural_code");
  // console.log("Line of Business (original):", line_of_business, typeof line_of_business);
  // console.log("Line of Business (converted):", lineOfBusinessString, typeof lineOfBusinessString);
  console.log(
    "Debug - Accrual Code:",
    payable_accural_code,
    "=========================",
  );

  var payable_accrual_code = payable_accural_code;

  const previousBalance =
    parseFloat(await getBalance(supplier_number, facilityId)) || 0;
  const amountPaidNum = parseFloat(amount_paid);

  console.log(
    "Debug - Previous Balance:",
    previousBalance,
    "=========================",
    payable_accrual_code,
  );

  // 🔹 Input validation
  if (
    !supplier_number ||
    !amount_paid ||
    !mod_account_code ||
    !facilityId ||
    !userId ||
    !bank_account_id ||
    !payable_accural_code ||
    !payable_code
  ) {
    return res.status(400).json({
      error:
        "Missing required fields: supplier_number, amount_paid, mod_account_code, facilityId, userId, bank_account_id, payable_accural_code, or payable_code",
    });
  }

  if (isNaN(amountPaidNum) || amountPaidNum <= 0) {
    return res.status(400).json({
      error: "Invalid amount_paid: must be a positive number",
    });
  }

  try {
    // 🔹 Verify supplier
    const supplier = await SuppliersInfo.findOne({
      where: { supplier_number, facilityId },
    });
    if (!supplier) {
      return res.status(404).json({
        error: `Supplier not found for supplier_number: ${supplier_number}, facilityId: ${facilityId}`,
      });
    }

    // 🔹 Verify accounts
    const bankAccount = await Account.findOne({
      where: { head: mod_account_code, facilityId },
    });
    if (!bankAccount) {
      return res.status(404).json({
        error: `Bank/Cash account not found for mod_account_code: ${mod_account_code}`,
      });
    }

    const payableAccount = supplier.payable_code
      ? await Account.findOne({
          where: { head: supplier.payable_code, facilityId },
        })
      : await Account.findOne({ where: { head: payable_code, facilityId } });
    if (supplier.payable_code && !payableAccount) {
      return res.status(404).json({
        error: `Payable account not found for payable_code: ${payable_code}`,
      });
    }

    const supplierAccrualCode =
      supplier.payable_accural_code || supplier.payable_accrual_code;
    const accruedAccount = supplierAccrualCode
      ? await Account.findOne({
          where: { head: supplierAccrualCode, facilityId },
        })
      : await Account.findOne({
          where: { head: payable_accrual_code, facilityId },
        });
    if (supplierAccrualCode && !accruedAccount) {
      return res.status(404).json({
        error: `Accrued account not found for payable_accrual_code: ${payable_accrual_code}`,
      });
    }

    const referenceNumber =
      documentNumber || `PAY-${Date.now()}${Math.floor(Math.random() * 1000)}`;
    let ledgerEntries = [];

    // 🔹 Bank/Cash entry (Credit - decrease asset for payment)
    ledgerEntries.push({
      account_code: mod_account_code,
      account_subhead: bankAccount.subhead || mod_account_code,
      dr: 0.0,
      cr: amountPaidNum,
      account_description: bankAccount.description || "Bank Account",
      transaction_description: `Supplier Payment - ${
        bankAccount.description || "Bank"
      }`,
      type: "bank",
      bank_account_id: bank_account_id,
      created_by: userId,
    });

    // 🔹 Debug information
    console.log("Debug - Previous Balance:", previousBalance);
    console.log("Debug - Payable Code:", payable_code);
    console.log("Debug - Accrual Code:", payable_accrual_code);

    // 🔹 Handle different balance scenarios
    if (previousBalance > 0 && payable_code && payableAccount) {
      // Scenario 1: We owe the supplier (positive balance)
      const absolutePayable = Math.abs(previousBalance);

      if (amountPaidNum <= absolutePayable) {
        // Payment is less than or equal to what we owe
        // Settle Payable only (Debit - decrease liability)
        ledgerEntries.push({
          account_code: payable_code,
          account_subhead:
            payableAccount.subhead || payable_code.substring(0, 6),
          dr: amountPaidNum,
          cr: 0.0,
          account_description: payableAccount.description || "Accounts Payable",
          transaction_description: `Supplier Payment - ${
            supplier_name || supplier.fullname
          }`,
          type: "payable",
          created_by: userId,
        });
      } else {
        // Payment exceeds what we owe
        // Clear Payable first (Debit - decrease liability)
        ledgerEntries.push({
          account_code: payable_code,
          account_subhead:
            payableAccount.subhead || payable_code.substring(0, 6),
          dr: absolutePayable,
          cr: 0.0,
          account_description: payableAccount.description || "Accounts Payable",
          transaction_description: `Supplier Payment (Payable Settlement) - ${
            supplier_name || supplier.fullname
          }`,
          type: "payable",
          created_by: userId,
        });

        // Remaining amount goes to Accrued (Debit - decrease liability)
        const remaining = amountPaidNum - absolutePayable;
        if (remaining > 0 && payable_accrual_code && accruedAccount) {
          ledgerEntries.push({
            account_code: payable_accrual_code,
            account_subhead:
              accruedAccount.subhead || payable_accrual_code.substring(0, 6),
            dr: remaining,
            cr: 0.0,
            account_description:
              accruedAccount.description || "Accrued Expenses",
            transaction_description: `Supplier Payment (Accrued) - ${
              supplier_name || supplier.fullname
            }`,
            type: "accrued",
            created_by: userId,
          });
        }
      }
    } else if (previousBalance < 0 && payable_code && payableAccount) {
      // Scenario 2: Supplier owes us money (negative balance)
      const absoluteNegativeBalance = Math.abs(previousBalance);

      if (amountPaidNum <= absoluteNegativeBalance) {
        // Payment is less than or equal to what supplier owes us
        // Credit payable to reduce their debt to us
        ledgerEntries.push({
          account_code: payable_code,
          account_subhead:
            payableAccount.subhead || payable_code.substring(0, 6),
          dr: amountPaidNum,
          cr: 0.0,
          account_description: payableAccount.description || "Accounts Payable",
          transaction_description: `Supplier Payment (Debt Offset) - ${
            supplier_name || supplier.fullname
          }`,
          type: "payable",
          created_by: userId,
        });
      } else {
        // Payment exceeds what supplier owes us
        // Clear their debt first
        ledgerEntries.push({
          account_code: payable_code,
          account_subhead:
            payableAccount.subhead || payable_code.substring(0, 6),
          dr: absoluteNegativeBalance,
          cr: 0.0,
          account_description: payableAccount.description || "Accounts Payable",
          transaction_description: `Supplier Payment (Debt Clearance) - ${
            supplier_name || supplier.fullname
          }`,
          type: "payable",
          created_by: userId,
        });

        // Remaining amount goes to accrued
        const remaining = amountPaidNum - absoluteNegativeBalance;
        if (remaining > 0 && payable_accrual_code && accruedAccount) {
          ledgerEntries.push({
            account_code: payable_accrual_code,
            account_subhead:
              accruedAccount.subhead || payable_accrual_code.substring(0, 6),
            dr: remaining,
            cr: 0.0,
            account_description:
              accruedAccount.description || "Accrued Expenses",
            transaction_description: `Supplier Payment (Accrued) - ${
              supplier_name || supplier.fullname
            }`,
            type: "accrued",
            created_by: userId,
          });
        }
      }
    } else if (
      previousBalance === 0 &&
      payable_accrual_code &&
      accruedAccount
    ) {
      // Scenario 3: Balance is exactly zero → entire payment goes to Accrued
      ledgerEntries.push({
        account_code: payable_accrual_code,
        account_subhead:
          accruedAccount.subhead || payable_accrual_code.substring(0, 6),
        dr: amountPaidNum,
        cr: 0.0,
        account_description: accruedAccount.description || "Accrued Expenses",
        transaction_description: `Supplier Payment (Accrued) - ${
          supplier_name || supplier.fullname
        }`,
        type: "accrual",
        created_by: userId,
      });
    } else {
      console.warn(
        `No payable or accrual entry created: previousBalance=${previousBalance}, payable_code=${payable_code}, payable_accrual_code=${payable_accrual_code}`,
      );
      return res.status(400).json({
        error:
          "Unable to process payment: Invalid account configuration or balance state",
      });
    }

    // 🔹 Log ledger entries for debugging
    console.log("Ledger Entries:", JSON.stringify(ledgerEntries, null, 2));

    // 🔹 Save in transaction
    const results = await db.sequelize.transaction(async (t) => {
      const payment = await Invoice.create(
        {
          ref_number: supplier_number,
          invoice_ref: documentNumber,
          due_date: due_date || new Date(),
          transaction_date: transaction_date || new Date(),
          description:
            narration ||
            `Supplier Payment - ${supplier_name || supplier.fullname}`,
          amount: amountPaidNum,
          user_id: userId,
          created_by: userId,
          facility_id: facilityId,
          type: "supplier payment",
          supplierNo: supplier_number,
          created_at: new Date(),
          payment_method: mode_of_payment,
        },
        { transaction: t },
      );

      for (const entry of ledgerEntries) {
        await GeneralLedger.create(
          {
            transaction_date: transaction_date || new Date(),
            account_code: entry.account_code,
            account_subhead: entry.account_subhead,
            dr: entry.dr,
            cr: entry.cr,
            account_description: entry.account_description,
            transaction_description: entry.transaction_description,
            reference_number: supplier_number,
            purpose_of_payment: narration || "Supplier Payment",
            payee: supplier_name || supplier.fullname,
            bank_account_id: bank_account_id,
            cheque_no: cheque_number || null,
            mode_of_payment,
            created_by: userId,
            facility_id: facilityId,
            created_at: new Date(),
            updated_at: new Date(),
            status: "paid",
            type: entry.type, // Use type from ledgerEntries array
            transaction_ref: referenceNumber,
          },
          { transaction: t },
        );
      }

      await SupplierEntry.create(
        {
          supplier_number: supplier_number,
          description:
            narration ||
            `Supplier Payment - ${supplier_name || supplier.fullname}`,
          qty_in: 1,
          qty_out: 0,
          cost: amountPaidNum,
          facilityId,
          mode_of_payment,
          receiptNo: referenceNumber,
          line_of_business: lineOfBusinessString,
          created_by: userId,
          created_at: new Date(),
        },
        { transaction: t },
      );

      return {
        reference_number: referenceNumber,
        payment_id: payment.payment_id,
      };
    });

    return res.status(201).json({
      success: true,
      results,
      supplier_number,
      previousBalance,
      amountPaid: amountPaidNum,
      ledgerEntries: ledgerEntries.map((entry) => ({
        account_code: entry.account_code,
        type: entry.type,
        dr: entry.dr,
        cr: entry.cr,
      })),
    });
  } catch (error) {
    console.error("Error creating supplier payment:", {
      message: error.message,
      stack: error.stack,
      supplier_number,
      facilityId,
      amount_paid: amountPaidNum,
      mod_account_code,
      payable_code,
      payable_accrual_code,
      previousBalance,
    });
    return res.status(500).json({ error: "Internal server error" });
  }
};

const getSupplierDeposit = async (req, res) => {
  const { facilityId, invoice_ref, supplierNo } = req.params;
  if (!facilityId || !invoice_ref) {
    return res.status(400).json({
      error: "Missing required params: facilityId, invoice_ref",
    });
  }

  try {
    const result = await db.sequelize.query(
      `
      SELECT
        i.description,
        i.dr,
        i.transaction_date,
        i.payment_method,
        u.firstname,
        u.lastname,
        u.signature,
        c.supplier_name,
        c.supplier_number,
        c.address
      FROM invoices i
      LEFT JOIN users u
        ON u.id = i.created_by and u.facilityId = i.facility_id
      LEFT JOIN suppliersinfo c
        ON c.supplier_number = i.ref_number and u.facilityId = i.facility_id
      WHERE c.facilityId = :facilityId
        AND i.invoice_ref = :invoice_ref
      LIMIT 1
      `,
      {
        replacements: { facilityId, invoice_ref },
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

    // 🔑 Call balance function
    const outstandingBalance = await getBalance(supplierNo, facilityId);

    return res.status(200).json({
      success: true,
      data: result[0], // ✅ only first row
      outstanding_balance: outstandingBalance,
      business_address: business[0].business_address,
      business_name: business[0].business_name,
      business_phone: business[0].business_phone,
      invoice_ref,
    });
  } catch (error) {
    console.error("Error fetching deposit details:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Get supplier payment receipt data
 */
const getSupplierPaymentReceipt = async (req, res) => {
  try {
    const { ref_number, facilityId, pv_code } = req.query;

    if (!ref_number || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "ref_number and facilityId are required",
      });
    }

    // Get supplier payment entry (most recent one)
    const supplierPayment = await db.SupplierEntry.findOne({
      where: {
        receiptNo: pv_code,
        facilityId,
        type: "payment",
      },
      order: [["entry_id", "DESC"]], // Get the most recent one by entry_id
    });

    // SELECT * FROM `general_ledger` where transaction_ref="969" and facility_id="ae9d49ee-3f9c-4f1e-bd6c-d2f18c61269f";

    const generalLedger = await db.GeneralLedger.findOne({
      where: {
        reference_number: ref_number,
        facility_id: facilityId,
      },
      order: [["transaction_id", "ASC"]],
    });
    // console.log(supplierPayment);
    if (!supplierPayment) {
      return res.status(404).json({
        success: false,
        message: "Payment receipt not found",
      });
    }

    // Get supplier information
    const supplier = await db.SuppliersInfo.findOne({
      where: {
        supplier_number: supplierPayment.supplier_number,
        facilityId,
      },
    });
    // Paid-through account: cash head from GL/entry, otherwise bank account
    let accountInfo = null;
    const mode = String(
      supplierPayment.mode_of_payment || "",
    ).toLowerCase();
    const isCash = mode === "cash";

    const bankLedger = await db.GeneralLedger.findOne({
      where: {
        reference_number: ref_number,
        facility_id: facilityId,
        type: "bank",
      },
      order: [["transaction_id", "ASC"]],
    });

    const cashHeadCode = isCash
      ? supplierPayment.bank_account_id || bankLedger?.account_code || null
      : null;

    if (isCash && cashHeadCode) {
      const headCode = String(cashHeadCode).trim();
      accountInfo = await Account.findOne({
        where: { head: headCode, facilityId },
      });
      if (!accountInfo) {
        accountInfo = await db.AccountCategory.findOne({
          where: {
            code: headCode,
            facilityId,
          },
        });
      }
      if (!accountInfo) {
        accountInfo = {
          code: headCode,
          head: headCode,
          description:
            bankLedger?.account_description || headCode,
        };
      }
    } else {
      const paidThrough =
        supplierPayment.bank_account_id || bankLedger?.bank_account_id;
      if (paidThrough) {
        try {
          accountInfo = await db.bank_account.findOne({
            where: {
              id: paidThrough,
              facilityId: facilityId,
            },
          });
        } catch (error) {
          console.error("Error fetching bank_account:", error);
        }
        if (!accountInfo) {
          accountInfo = await db.AccountCategory.findOne({
            where: {
              code: String(paidThrough),
              facilityId: facilityId,
            },
          });
        }
      }
    }

    // Calculate new balance
    const currentBalance =
      parseFloat(
        await getBalance(supplierPayment.supplier_number, facilityId),
      ) || 0;
    const createdBy = supplierPayment.created_by
      ? await db.users.findOne({
          where: {
            id: supplierPayment.created_by,
            facilityId: facilityId,
          },
        })
      : null;
    const txnDate =
      generalLedger?.transaction_date ||
      supplierPayment.transaction_date ||
      supplierPayment.created_at ||
      null;

    let attachments = [];
    try {
      const [docs] = await db.sequelize.query(
        `SELECT id, document_name, file_path, original_name, file_size, mime_type
         FROM payment_documents
         WHERE facilityId = :facilityId
           AND reference_number IN (:ref, :pv)
         ORDER BY id ASC`,
        {
          replacements: {
            ref: ref_number,
            pv: pv_code || ref_number,
            facilityId,
          },
        },
      );
      attachments = docs || [];
    } catch (_err) {
      attachments = [];
    }

    const receiptData = {
      createdBy: {
        name: [createdBy?.firstname, createdBy?.lastname]
          .filter(Boolean)
          .join(" "),
        signature: createdBy?.signature || null,
      },
      description: supplierPayment.description,
      reference_number: supplierPayment.receiptNo || ref_number,
      transaction_date: txnDate,
      date: txnDate,
      cheque_no: supplierPayment.cheque_no,
      supplier_name: supplier?.supplier_name || supplierPayment.supplier_name,
      supplier_no: supplierPayment.supplier_number,
      supplier_address: supplier?.address || null,
      amount_paid: parseFloat(supplierPayment.cost),
      previous_balance: parseFloat(supplierPayment.previous_balance) || 0,
      new_balance: currentBalance,
      mode_of_payment:
        supplierPayment.payment_method || supplierPayment.mode_of_payment,
      bank_name: supplierPayment.bank_name,
      cheque_number: supplierPayment.cheque_number,
      narration: supplierPayment.narration || supplierPayment.description,
      created_by: supplierPayment.created_by,
      created_at: supplierPayment.created_at,
      attachments,
      // Add account information
      account_info: accountInfo
        ? {
            kind: isCash ? "cash" : "bank",
            code: accountInfo.code || accountInfo.head || cashHeadCode,
            name:
              accountInfo.account_name ||
              accountInfo.description ||
              accountInfo.category,
            account_number: accountInfo.account_number || null,
            bank_code: accountInfo.bank_code || null,
          }
        : null,
    };

    return res.status(200).json({
      success: true,
      data: receiptData,
    });
  } catch (error) {
    console.error("Error fetching payment receipt:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching payment receipt",
      error: error.message,
    });
  }
};
const getSuppliersByBalance = async (req, res) => {
  try {
    const { facilityId, limit: limitParam, page: pageParam } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Parse limit and page as integers with defaults
    const limit = parseInt(limitParam, 10) || 1000;
    const page = parseInt(pageParam, 10) || 1;
    const offset = (page - 1) * limit;
    //  COALESCE(SUM(qty_in * cost), 0) - COALESCE(SUM(qty_out * cost), 0) AS balance
    const suppliers = await db.sequelize.query(
      `SELECT
    s.supplier_name,
    s.supplier_number,
    s.email,
    s.phone,
    COALESCE(gl.balance, 0) AS balance
FROM suppliersinfo s
LEFT JOIN (
    SELECT
        transaction_ref AS supplier_number,
        facility_id,
        SUM(cr) - SUM(dr) AS balance
    FROM general_ledger
    WHERE type in ('payable', 'payment')
      AND facility_id = :facilityId
    GROUP BY transaction_ref, facility_id
) gl
    ON s.supplier_number = gl.supplier_number
   AND s.facilityId = gl.facility_id
WHERE s.facilityId = :facilityId
ORDER BY balance DESC
LIMIT :limit OFFSET :offset;`,
      {
        replacements: {
          facilityId,
          limit: limit,
          offset: offset,
        },
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );
    return res.status(200).json({
      success: true,
      data: suppliers,
    });
  } catch (error) {
    console.error("Error fetching suppliers by balance:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};
// Get supplier bills with payment status (with search & pagination)
const getSupplierBills = async (req, res) => {
  try {
    const {
      facilityId,
      invoice_ref, // kept for backward compatibility
      search, // generic search term (invoice ref, ref number, supplier name)
      page = 1,
      limit = 10,
      onlyUnpaid, // when set, return only Unpaid and Partially Paid (for pay-bills page)
      status, // filter by status: "Unpaid", "Partially Paid", or "Unpaid,Partially Paid" (when onlyUnpaid)
      fromDate,
      toDate,
    } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Normalise pagination values
    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const pageSize = Math.min(100, Math.max(parseInt(limit, 10) || 10, 1));
    const offset = (pageNumber - 1) * pageSize;

    // Build WHERE clause for search
    let whereClause =
      "WHERE i.type = 'purchase' AND i.facility_id = :facilityId";
    const replacements = { facilityId };

    const searchTerm = (search || invoice_ref || "").trim();

    if (searchTerm) {
      whereClause +=
        " AND (i.invoice_ref LIKE :search OR i.ref_number LIKE :search OR COALESCE(s.supplier_name, '') LIKE :search OR COALESCE(i.description, '') LIKE :search)";
      replacements.search = `%${searchTerm}%`;
    }

    // Optional transaction date range filter
    if (fromDate) {
      whereClause += " AND DATE(i.transaction_date) >= :fromDate";
      replacements.fromDate = fromDate;
    }
    if (toDate) {
      whereClause += " AND DATE(i.transaction_date) <= :toDate";
      replacements.toDate = toDate;
    }

    // Base query to fetch invoices with supplier info, payment status, and available advance
    const baseQuery = `
      FROM invoices i
      LEFT JOIN (
        SELECT
          supplier_number,
          facilityId,
          MAX(NULLIF(supplier_name, '')) AS supplier_name
        FROM suppliersinfo
        GROUP BY supplier_number, facilityId
      ) s
        ON s.supplier_number = i.ref_number
        AND s.facilityId = i.facility_id
      LEFT JOIN (
        SELECT
          reference_number AS transaction_ref,
          facility_id,
          -- Old-style: Dr Payable (type='payment') was created for advance settlement.
          -- New-style: only Cr Advance (type='accrued') is created — no Dr Payable round-trip.
          -- Use payment_dr when it exists (old bills + applyAdvanceToBill), else fall back to accrued_cr.
          SUM(CASE WHEN type = 'bank' THEN cr ELSE 0 END) +
          CASE
            WHEN SUM(CASE WHEN type = 'payment' THEN dr ELSE 0 END) > 0
            THEN SUM(CASE WHEN type = 'payment' THEN dr ELSE 0 END)
            ELSE SUM(CASE WHEN type = 'accrued' AND cr > 0 THEN cr ELSE 0 END)
          END AS total_paid
        FROM general_ledger
        WHERE type IN ('bank', 'payment', 'accrued')
          AND facility_id = :facilityId
          AND reference_number IS NOT NULL
          AND reference_number != ''
        GROUP BY reference_number, facility_id
      ) payments
        ON payments.transaction_ref = i.invoice_ref
        AND payments.facility_id = i.facility_id
      LEFT JOIN (
        SELECT
          transaction_ref AS supplier_ref,
          facility_id,
          GREATEST(0, -(SUM(cr) - SUM(dr))) AS available_advance
        FROM general_ledger
        WHERE type IN ('payable', 'payment', 'accrued')
          AND facility_id = :facilityId
          AND transaction_ref IS NOT NULL
          AND transaction_ref != ''
        GROUP BY transaction_ref, facility_id
      ) adv
        ON adv.supplier_ref = i.ref_number
        AND adv.facility_id = i.facility_id
      LEFT JOIN (
        SELECT
          ref_key,
          facilityId,
          COALESCE(
            MAX(CASE
              WHEN type = 'purchase' AND NULLIF(mode_of_payment, '') IS NOT NULL
              THEN mode_of_payment
            END),
            MAX(NULLIF(mode_of_payment, ''))
          ) AS mode_of_payment
        FROM (
          SELECT receiptNo AS ref_key, facilityId, type, mode_of_payment
          FROM supplier_entries
          WHERE facilityId = :facilityId
            AND receiptNo IS NOT NULL
            AND receiptNo != ''
          UNION ALL
          SELECT link_id AS ref_key, facilityId, type, mode_of_payment
          FROM supplier_entries
          WHERE facilityId = :facilityId
            AND link_id IS NOT NULL
            AND link_id != ''
        ) se_src
        GROUP BY ref_key, facilityId
      ) se_mode
        ON se_mode.ref_key = i.invoice_ref
        AND se_mode.facilityId = i.facility_id
      LEFT JOIN (
        SELECT
          reference_number AS transaction_ref,
          facility_id,
          MAX(NULLIF(mode_of_payment, '')) AS mode_of_payment
        FROM general_ledger
        WHERE facility_id = :facilityId
          AND reference_number IS NOT NULL
          AND reference_number != ''
        GROUP BY reference_number, facility_id
      ) gl_mode
        ON gl_mode.transaction_ref = i.invoice_ref
        AND gl_mode.facility_id = i.facility_id
      ${whereClause}
    `;

    const onlyUnpaidBills = onlyUnpaid === "1" || onlyUnpaid === "true";

    const statusLabelMap = {
      paid: "Paid",
      unpaid: "Unpaid",
      partially_paid: "Partially Paid",
      Paid: "Paid",
      Unpaid: "Unpaid",
      "Partially Paid": "Partially Paid",
    };

    // Allowed status filter when onlyUnpaid: Unpaid, Partially Paid
    const allowedStatuses = ["Unpaid", "Partially Paid"];
    let statusList = allowedStatuses;
    if (onlyUnpaidBills && status) {
      const requested = String(status)
        .split(",")
        .map((s) => s.trim())
        .filter((s) => allowedStatuses.includes(s) || allowedStatuses.includes(statusLabelMap[s]));
      const mapped = requested.map((s) => statusLabelMap[s] || s);
      if (mapped.length > 0) statusList = mapped;
    }

    const generalStatus = !onlyUnpaidBills
      ? statusLabelMap[String(status || "").trim()] || ""
      : "";

    const statusInClause = "IN ('" + statusList.join("','") + "')";

    // Inner select (used for both data and count when onlyUnpaid)
    const innerSelect = `
      SELECT
        i.invoice_id,
        i.invoice_ref,
        i.ref_number,
        i.transaction_date,
        i.due_date,
        i.amount as  amount,
        i.description,
        COALESCE(s.supplier_name, 'Unknown Supplier') AS supplier_name,
        COALESCE(payments.total_paid, 0) AS total_paid,
        (i.amount - COALESCE(payments.total_paid, 0)) AS amount_due,
        COALESCE(adv.available_advance, 0) AS available_advance,
        COALESCE(
          NULLIF(se_mode.mode_of_payment, ''),
          NULLIF(gl_mode.mode_of_payment, ''),
          'credit'
        ) AS mode_of_payment,
        CASE
          WHEN COALESCE(payments.total_paid, 0) >= i.amount THEN 'Paid'
          WHEN COALESCE(payments.total_paid, 0) > 0 THEN 'Partially Paid'
          ELSE 'Unpaid'
        END AS status
      ${baseQuery}
    `;

    const useStatusSubquery = onlyUnpaidBills || Boolean(generalStatus);

    const dataQuery = useStatusSubquery
      ? `
      SELECT * FROM (${innerSelect}) AS sub
      WHERE ${
        onlyUnpaidBills
          ? `sub.status ${statusInClause}`
          : "sub.status = :billStatus"
      }
      ORDER BY sub.transaction_date DESC
      LIMIT :limit OFFSET :offset;
    `
      : `
      ${innerSelect}
      ORDER BY i.transaction_date DESC
      LIMIT :limit OFFSET :offset;
    `;

    const countQuery = useStatusSubquery
      ? `
      SELECT COUNT(*) AS total FROM (${innerSelect}) AS sub
      WHERE ${
        onlyUnpaidBills
          ? `sub.status ${statusInClause}`
          : "sub.status = :billStatus"
      };
    `
      : `
      SELECT COUNT(*) AS total
      ${baseQuery};
    `;

    const dataReplacements = {
      ...replacements,
      limit: pageSize,
      offset,
      ...(generalStatus ? { billStatus: generalStatus } : {}),
    };

    const countReplacements = {
      ...replacements,
      ...(generalStatus ? { billStatus: generalStatus } : {}),
    };

    const [bills, countResult] = await Promise.all([
      db.sequelize.query(dataQuery, {
        replacements: dataReplacements,
        type: db.Sequelize.QueryTypes.SELECT,
      }),
      db.sequelize.query(countQuery, {
        replacements: countReplacements,
        type: db.Sequelize.QueryTypes.SELECT,
      }),
    ]);

    const total = Number(countResult?.[0]?.total) || 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return res.status(200).json({
      success: true,
      data: bills,
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages,
      },
    });
  } catch (error) {
    console.error("Error fetching supplier bills:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching supplier bills",
      error: error.message,
    });
  }
};

module.exports = {
  createSupplierBankDetail,
  updateSupplierBankDetail,
  updateSupplierBankDetailStatus,
  getSupplierBankDetails,
  getBankDetailsBySupplier,
  deleteSupplierBankDetail,
  getSupplierDepositBalance,
  getSupplierBalance,
  createSupplierPayment,
  getSupplierDeposit,
  getBalance,
  getSupplierPaymentReceipt,
  getSupplierBills,
  getSuppliersByBalance,
};
