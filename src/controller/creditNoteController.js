const db = require("../models");
const { Op, QueryTypes } = require("sequelize");
const { getAndUpdateNumber } = require("../services/numberGen");
const moment = require("moment");
const {
  reasonRequiresInventoryProductLines,
  getInventoryExplanationPrompt,
} = require("./creditNoteReasonController");

const PAYMENT_ADJUSTMENT_LABELS = {
  offset_outstanding: "Offset against outstanding invoice",
  refund_bank: "Refund via bank transfer",
  account_adjustment: "Account adjustment",
};

function formatPaymentAdjustmentNote(method) {
  if (method == null || method === "") return "";
  const label =
    PAYMENT_ADJUSTMENT_LABELS[method] ||
    String(method).trim();
  return label ? ` | Method: ${label}` : "";
}

const REFUND_MODE_LABELS = {
  cash: "Cash",
  bank: "Bank Transfer",
  cheque: "Cheque",
};

function formatScenarioAuditNote(body) {
  const {
    reasonCategory,
    adjustmentAmount,
    discount,
    invoiceSnapshot,
  } = body || {};
  let s = "";
  if (reasonCategory && String(reasonCategory).trim()) {
    s += ` | Scenario: ${String(reasonCategory).trim()}`;
  }
  if (
    adjustmentAmount != null &&
    adjustmentAmount !== "" &&
    !Number.isNaN(Number(adjustmentAmount))
  ) {
    s += ` | Adjustment: ${adjustmentAmount}`;
  }
  if (discount && typeof discount === "object") {
    const t = discount.type || "";
    const sc = discount.scope || "";
    const v = discount.value != null ? discount.value : "";
    if (t || sc || v !== "") {
      s += ` | Discount: ${[t, sc, v].filter(Boolean).join(" ")}`;
    }
  }
  if (invoiceSnapshot && typeof invoiceSnapshot === "object") {
    const tx = invoiceSnapshot.totalTax;
    const td = invoiceSnapshot.totalDiscount;
    if (tx != null || td != null) {
      s += ` | Invoice ref: tax ${tx ?? "—"} disc ${td ?? "—"}`;
    }
  }
  return s;
}

function formatRefundModeNote(mode, chequeNo, extras = {}) {
  const {
    refundBankAccountName,
    refundBankAccountId,
    refundAccountHead,
  } = extras;
  const label = REFUND_MODE_LABELS[mode] || String(mode || "").trim();
  if (!label) return "";
  let s = ` | Refund payment: ${label}`;
  if (mode === "cheque" && chequeNo != null && String(chequeNo).trim()) {
    s += ` (No. ${String(chequeNo).trim()})`;
  }
  if (mode === "bank" || mode === "cheque") {
    if (refundBankAccountName && String(refundBankAccountName).trim()) {
      s += ` | ${String(refundBankAccountName).trim()}`;
    } else if (refundBankAccountId) {
      s += ` | Bank account #${refundBankAccountId}`;
    }
  }
  if (mode === "cash" && refundAccountHead && String(refundAccountHead.head || "").trim()) {
    s += ` | Cash: ${String(refundAccountHead.head).trim()}`;
    if (refundAccountHead.description && String(refundAccountHead.description).trim()) {
      s += ` ${String(refundAccountHead.description).trim()}`;
    }
  }
  return s;
}

/**
 * Generate Credit Note Number
 */
const generateCreditNoteNumber = async (facilityId, type) => {
  const prefix = type === "customer" ? "CN-C" : "CN-S";
  const year = moment().format("YY");
  const sequence = await getAndUpdateNumber(
    type === "customer" ? "credit_note_customer" : "credit_note_supplier",
    facilityId
  );
  return `${prefix}-${year}-${String(sequence).padStart(4, "0")}`;
};

/**
 * Get invoices for a customer or supplier
 */
const getInvoicesForEntity = async (facilityId, entityId, type) => {
  const invoiceType = type === "customer" ? "sales" : "purchase";
  
  const invoices = await db.Invoice.findAll({
    where: {
      facility_id: facilityId,
      type: invoiceType,
      ref_number: entityId,
    },
    order: [["transaction_date", "DESC"]],
  });
  
  return invoices;
};

/**
 * Get Chart of Account by code
 */
const getAccountByCode = async (facilityId, accountCode) => {
  const account = await db.AccountCategory.findOne({
    where: {
      facility_id: facilityId,
      code: accountCode,
    },
  });

  if (!account) {
    throw new Error(`Account with code ${accountCode} not found`);
  }

  return account;
};

/**
 * Create Credit Note
 * POST /api/credit-notes
 */
exports.createCreditNote = async (req, res) => {
  const transaction = await db.sequelize.transaction();

  try {
    const {
      facilityId,
      userId,
      type, // "customer" or "supplier"
      customerId,
      supplierId,
      date,
      reference,
      reason,
      inventoryExplanation,
      lineItems,
      subtotal,
      vatAmount,
      totalAmount,
      vatRate,
      paymentAdjustmentMethod,
      refundModeOfPayment,
      refundChequeNumber,
      refundBankAccountId,
      refundBankAccountName,
      refundAccountHead,
      reasonCategory,
      adjustmentAmount,
      discount,
      invoiceSnapshot,
    } = req.body;

    let methodSuffix = formatPaymentAdjustmentNote(paymentAdjustmentMethod);
    const scenarioSuffix = formatScenarioAuditNote({
      reasonCategory,
      adjustmentAmount,
      discount,
      invoiceSnapshot,
    });

    if (paymentAdjustmentMethod === "refund_bank") {
      const allowedRefundModes = ["cash", "bank", "cheque"];
      const mode = allowedRefundModes.includes(refundModeOfPayment)
        ? refundModeOfPayment
        : null;
      if (!mode) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Select a mode of payment for refund via bank transfer",
        });
      }
      if (mode === "cheque") {
        const ch = String(refundChequeNumber || "").trim();
        if (ch.length < 1) {
          await transaction.rollback();
          return res.status(400).json({
            success: false,
            message: "Cheque number is required when mode of payment is Cheque",
          });
        }
      }
      const bankId =
        refundBankAccountId != null
          ? refundBankAccountId
          : req.body.refundBankAccount && req.body.refundBankAccount.id;
      if (mode === "bank" || mode === "cheque") {
        if (!bankId) {
          await transaction.rollback();
          return res.status(400).json({
            success: false,
            message:
              "Bank account is required for bank transfer or cheque refund",
          });
        }
      }
      if (mode === "cash") {
        const head =
          refundAccountHead != null && refundAccountHead.head != null
            ? String(refundAccountHead.head).trim()
            : "";
        if (!head) {
          await transaction.rollback();
          return res.status(400).json({
            success: false,
            message: "Account head is required for cash refund",
          });
        }
      }
      methodSuffix += formatRefundModeNote(mode, refundChequeNumber, {
        refundBankAccountName,
        refundBankAccountId: bankId,
        refundAccountHead,
      });
    }

    if (!facilityId || !userId || !type || !date || !lineItems || lineItems.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    if (reason && reasonRequiresInventoryProductLines(reason, type)) {
      const hasServiceLine = lineItems.some(
        (li) => String(li.lineKind || "").toLowerCase() === "service",
      );
      if (hasServiceLine) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message:
            "This reason applies to inventory (products). Remove or change Service lines to Product.",
        });
      }
      const invNote =
        inventoryExplanation != null ? String(inventoryExplanation).trim() : "";
      if (invNote.length < 5) {
        await transaction.rollback();
        const hint = getInventoryExplanationPrompt(reason, type);
        return res.status(400).json({
          success: false,
          message: hint
            ? `Inventory note required (min 5 characters). ${hint}`
            : "Please add a short inventory explanation (how stock or goods are affected).",
        });
      }
    }

    if (type === "customer" && !customerId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Customer ID is required for customer credit note",
      });
    }

    if (type === "supplier" && !supplierId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Supplier ID is required for supplier credit note",
      });
    }

    // Get business VAT policy
    const business = await db.Business.findOne({
      where: { id: facilityId },
      attributes: ["vat_policy"],
    });

    const vatPolicy = business?.vat_policy || "vat_exclusive";

    // Generate Credit Note Number
    const creditNoteNumber = await generateCreditNoteNumber(facilityId, type);

    // Get customer or supplier account
    let receivablePayableAccount = null;
    let entityId = null;
    let entityName = null;

    if (type === "customer") {
      const customer = await db.Customer.findOne({
        where: { customerNo: customerId, facilityId },
      });
      if (!customer) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: "Customer not found",
        });
      }
      entityId = customerId;
      entityName = customer.fullname || customer.customerNo;

      // Get Accounts Receivable account
      const arAccount = await db.AccountCategory.findOne({
        where: {
          facility_id: facilityId,
          description: { [Op.like]: "%Accounts Receivable%" },
          level: 2,
        },
      });

      if (!arAccount) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Accounts Receivable account not found. Please set it up in Chart of Accounts.",
        });
      }

      receivablePayableAccount = arAccount;
    } else {
      const supplier = await db.SuppliersInfo.findOne({
        where: { supplier_number: supplierId, facilityId },
      });
      if (!supplier) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: "Supplier not found",
        });
      }
      entityId = supplierId;
      entityName = supplier.supplier_name || supplier.supplier_number;

      // Get Accounts Payable account
      const apAccount = await db.AccountCategory.findOne({
        where: {
          facility_id: facilityId,
          description: { [Op.like]: "%Accounts Payable%" },
          level: 2,
        },
      });

      if (!apAccount) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Accounts Payable account not found. Please set it up in Chart of Accounts.",
        });
      }

      receivablePayableAccount = apAccount;
    }

    // Get Sales Returns / Purchase Returns account
    const returnsAccountName =
      type === "customer" ? "Sales Returns" : "Purchase Returns";
    let returnsAccount = await db.AccountCategory.findOne({
      where: {
        facility_id: facilityId,
        description: { [Op.like]: `%${returnsAccountName}%` },
        level: 2,
      },
    });

    // If not found, try Income Adjustment / Expense Adjustment
    if (!returnsAccount) {
      const adjustmentAccountName =
        type === "customer" ? "Income Adjustment" : "Expense Adjustment";
      returnsAccount = await db.AccountCategory.findOne({
        where: {
          facility_id: facilityId,
          description: { [Op.like]: `%${adjustmentAccountName}%` },
          level: 2,
        },
      });
    }

    if (!returnsAccount) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `${returnsAccountName} or Adjustment account not found. Please set it up in Chart of Accounts.`,
      });
    }

    // Get VAT Control account
    let vatAccount = null;
    if (vatAmount > 0) {
      vatAccount = await db.AccountCategory.findOne({
        where: {
          facility_id: facilityId,
          description: { [Op.like]: "%VAT%" },
          level: 2,
        },
      });

      if (!vatAccount) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "VAT Control account not found. Please set it up in Chart of Accounts.",
        });
      }
    }

    const ledgerEntries = [];
    const transactionDate = new Date(date);

    // Calculate amounts based on VAT policy
    let netAmount = subtotal;
    let calculatedVat = 0;

    if (vatPolicy === "vat_exclusive") {
      // VAT is added on top
      calculatedVat = subtotal * (vatRate / 100);
      netAmount = subtotal;
    } else {
      // VAT is included
      netAmount = subtotal / (1 + vatRate / 100);
      calculatedVat = subtotal - netAmount;
    }

    // Create ledger entries
    if (type === "customer") {
      // Customer Credit Note:
      // Dr Sales Returns / Income Adjustment
      // Cr Accounts Receivable (Customer)
      // Cr VAT Control (if applicable)

      // Debit: Sales Returns / Income Adjustment
      ledgerEntries.push({
        facility_id: facilityId,
        transaction_date: transactionDate,
        transaction_ref: entityId, // Use customer ID for ledger filtering
        account_code: returnsAccount.code,
        account_name: returnsAccount.description,
        account_category: returnsAccount.category || "",
        account_subhead: returnsAccount.subhead || 0,
        account_parent_code: returnsAccount.parent_code || 0,
        debit: netAmount,
        credit: 0,
        balance: 0,
        description: `Credit Note ${creditNoteNumber} - ${entityName}${reason ? ` - ${reason}` : ""}${methodSuffix}`,
        transaction_type: "credit_note",
        transaction_category: "customer_credit_note",
        created_by: userId,
        created_at: new Date(),
        updated_at: new Date(),
      });

      // Credit: Accounts Receivable
      ledgerEntries.push({
        facility_id: facilityId,
        transaction_date: transactionDate,
        transaction_ref: entityId, // Use customer ID for ledger filtering
        account_code: receivablePayableAccount.code,
        account_name: receivablePayableAccount.description,
        account_category: receivablePayableAccount.category || "",
        account_subhead: receivablePayableAccount.subhead || 0,
        account_parent_code: receivablePayableAccount.parent_code || 0,
        debit: 0,
        credit: totalAmount,
        balance: 0,
        description: `Credit Note ${creditNoteNumber} - ${entityName}${reference ? ` (Ref: ${reference})` : ""}${methodSuffix}`,
        transaction_type: "credit_note",
        transaction_category: "customer_credit_note",
        created_by: userId,
        created_at: new Date(),
        updated_at: new Date(),
      });

      // Credit: VAT Control (if applicable)
      if (vatAmount > 0 && vatAccount) {
        ledgerEntries.push({
          facility_id: facilityId,
          transaction_date: transactionDate,
          transaction_ref: entityId, // Use customer ID for ledger filtering
          account_code: vatAccount.code,
          account_name: vatAccount.description,
          account_category: vatAccount.category || "",
          account_subhead: vatAccount.subhead || 0,
          account_parent_code: vatAccount.parent_code || 0,
          debit: 0,
          credit: calculatedVat,
          balance: 0,
          description: `Credit Note ${creditNoteNumber} - VAT Reversal${methodSuffix}`,
          transaction_type: "credit_note",
          transaction_category: "customer_credit_note",
          created_by: userId,
          created_at: new Date(),
          updated_at: new Date(),
        });
      }
    } else {
      // Supplier Credit Note:
      // Dr Accounts Payable (Supplier)
      // Cr Purchase Returns / Expense Adjustment
      // Dr VAT Control (if applicable) - VAT is reversed

      // Debit: Accounts Payable
      ledgerEntries.push({
        facility_id: facilityId,
        transaction_date: transactionDate,
        transaction_ref: entityId, // Use supplier ID for ledger filtering
        account_code: receivablePayableAccount.code,
        account_name: receivablePayableAccount.description,
        account_category: receivablePayableAccount.category || "",
        account_subhead: receivablePayableAccount.subhead || 0,
        account_parent_code: receivablePayableAccount.parent_code || 0,
        debit: totalAmount,
        credit: 0,
        balance: 0,
        description: `Credit Note ${creditNoteNumber} - ${entityName}${reference ? ` (Ref: ${reference})` : ""}${methodSuffix}`,
        transaction_type: "credit_note",
        transaction_category: "supplier_credit_note",
        created_by: userId,
        created_at: new Date(),
        updated_at: new Date(),
      });

      // Credit: Purchase Returns / Expense Adjustment
      ledgerEntries.push({
        facility_id: facilityId,
        transaction_date: transactionDate,
        transaction_ref: entityId, // Use supplier ID for ledger filtering
        account_code: returnsAccount.code,
        account_name: returnsAccount.description,
        account_category: returnsAccount.category || "",
        account_subhead: returnsAccount.subhead || 0,
        account_parent_code: returnsAccount.parent_code || 0,
        debit: 0,
        credit: netAmount,
        balance: 0,
        description: `Credit Note ${creditNoteNumber} - ${entityName}${reason ? ` - ${reason}` : ""}${methodSuffix}`,
        transaction_type: "credit_note",
        transaction_category: "supplier_credit_note",
        created_by: userId,
        created_at: new Date(),
        updated_at: new Date(),
      });

      // Debit: VAT Control (if applicable) - VAT reversal
      if (vatAmount > 0 && vatAccount) {
        ledgerEntries.push({
          facility_id: facilityId,
          transaction_date: transactionDate,
          transaction_ref: entityId, // Use supplier ID for ledger filtering
          account_code: vatAccount.code,
          account_name: vatAccount.description,
          account_category: vatAccount.category || "",
          account_subhead: vatAccount.subhead || 0,
          account_parent_code: vatAccount.parent_code || 0,
          debit: calculatedVat,
          credit: 0,
          balance: 0,
          description: `Credit Note ${creditNoteNumber} - VAT Reversal${methodSuffix}`,
          transaction_type: "credit_note",
          transaction_category: "supplier_credit_note",
          created_by: userId,
          created_at: new Date(),
          updated_at: new Date(),
        });
      }
    }

    // Bulk create general ledger entries
    await db.GeneralLedger.bulkCreate(ledgerEntries, { transaction });

    const invExplanation =
      inventoryExplanation != null ? String(inventoryExplanation).trim() : "";

    // Create entry in invoices table to track the credit note
    const invoiceType = type === "customer" ? "sales" : "purchase";
    await db.Invoice.create(
      {
        invoice_ref: creditNoteNumber,
        ref_number: reference || null, // Link to original invoice if provided
        due_date: transactionDate,
        transaction_date: transactionDate,
        tax_amount: calculatedVat,
        discount_amount: 0,
        description: `Credit Note - ${reason || entityName}${
          invExplanation ? ` | Inventory: ${invExplanation}` : ""
        }${methodSuffix}${scenarioSuffix}`,
        amount: -totalAmount, // Negative amount to indicate credit
        created_by: userId,
        facility_id: facilityId,
        type: invoiceType,
      },
      { transaction }
    );

    // Create entry in customer_entries or supplier_entries
    if (type === "customer") {
      // Customer credit note - reduce what customer owes (credit entry)
      await db.CustomerEntry.create(
        {
          customerNo: entityId,
          description: `Credit Note ${creditNoteNumber}${reference ? ` (Ref: ${reference})` : ""} - ${reason || "Credit adjustment"}${methodSuffix}${scenarioSuffix}`,
          qty_in: 0,
          qty_out: totalAmount, // Credit to customer account (reduces receivable)
          cost: totalAmount,
          facilityId: facilityId,
          mode_of_payment: "credit_note",
          receiptNo: creditNoteNumber,
          link_id: reference || null, // Link to original invoice
          type: "discount", // Using 'discount' type for credit adjustments
          created_by: userId,
        },
        { transaction }
      );
    } else {
      // Supplier credit note - reduce what we owe (debit entry)
      await db.SupplierEntry.create(
        {
          supplier_number: entityId,
          description: `Credit Note ${creditNoteNumber}${reference ? ` (Ref: ${reference})` : ""} - ${reason || "Credit adjustment"}${methodSuffix}${scenarioSuffix}`,
          qty_in: totalAmount, // Debit to supplier account (reduces payable)
          qty_out: 0,
          cost: totalAmount,
          facilityId: facilityId,
          mode_of_payment: "credit_note",
          cheque_no: creditNoteNumber,
          link_id: reference || null, // Link to original invoice/bill
          type: "discount", // Using 'discount' type for credit adjustments
          created_by: userId,
        },
        { transaction }
      );
    }

    await transaction.commit();

    res.status(201).json({
      success: true,
      message: "Credit note created successfully",
      data: {
        creditNoteNumber,
        type,
        entityId,
        entityName,
        date,
        reference,
        reason,
        subtotal,
        vatAmount: calculatedVat,
        totalAmount,
        lineItems,
        paymentAdjustmentMethod: paymentAdjustmentMethod || "offset_outstanding",
        refundModeOfPayment:
          paymentAdjustmentMethod === "refund_bank"
            ? refundModeOfPayment || null
            : null,
        refundChequeNumber:
          paymentAdjustmentMethod === "refund_bank" &&
          refundModeOfPayment === "cheque"
            ? String(refundChequeNumber || "").trim() || null
            : null,
        refundBankAccountId:
          paymentAdjustmentMethod === "refund_bank" &&
          ["bank", "cheque"].includes(refundModeOfPayment)
            ? refundBankAccountId ?? req.body.refundBankAccount?.id ?? null
            : null,
        refundAccountHead:
          paymentAdjustmentMethod === "refund_bank" &&
          refundModeOfPayment === "cash"
            ? refundAccountHead || null
            : null,
      },
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Error creating credit note:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create credit note",
      error: error.message,
    });
  }
};

/**
 * Get Credit Notes List
 * POST /api/credit-notes/list
 */
exports.getCreditNotes = async (req, res) => {
  try {
    const { facilityId, type, startDate, endDate, page = 1, limit = 50 } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const where = {
      facility_id: facilityId,
      transaction_type: "credit_note",
    };

    if (type) {
      where.transaction_category =
        type === "customer" ? "customer_credit_note" : "supplier_credit_note";
    }

    if (startDate && endDate) {
      where.transaction_date = {
        [Op.between]: [new Date(startDate), new Date(endDate)],
      };
    }

    const offset = (page - 1) * limit;

    const { count, rows } = await db.GeneralLedger.findAndCountAll({
      where,
      attributes: [
        "transaction_ref",
        "transaction_date",
        "description",
        "debit",
        "credit",
        "account_code",
        "account_name",
        "transaction_category",
        "created_at",
      ],
      order: [["transaction_date", "DESC"], ["created_at", "DESC"]],
      limit: parseInt(limit),
      offset: parseInt(offset),
      distinct: true,
    });

    // Group by credit note number (extracted from description) to get unique credit notes
    const creditNotesMap = new Map();

    rows.forEach((entry) => {
      // Extract credit note number from description (format: "Credit Note CN-C-YY-0001 - ...")
      const match = entry.description?.match(/Credit Note\s+([A-Z]+-\d{2}-\d+)/);
      const creditNoteNumber = match ? match[1] : entry.transaction_ref;

      if (!creditNotesMap.has(creditNoteNumber)) {
        creditNotesMap.set(creditNoteNumber, {
          creditNoteNumber,
          date: entry.transaction_date,
          type: entry.transaction_category === "customer_credit_note" ? "customer" : "supplier",
          description: entry.description,
          totalAmount: 0,
          entries: [],
        });
      }

      const creditNote = creditNotesMap.get(creditNoteNumber);
      creditNote.entries.push(entry);
      creditNote.totalAmount += entry.credit || entry.debit;
    });

    const creditNotes = Array.from(creditNotesMap.values());

    res.status(200).json({
      success: true,
      data: creditNotes,
      pagination: {
        total: creditNotes.length,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching credit notes:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch credit notes",
      error: error.message,
    });
  }
};

/**
 * Search Invoices by Number (facility-wide, sales + purchase)
 * GET /api/credit-notes/search-invoices?facilityId=&invoiceRef=
 * Returns invoices with type (sales|purchase) - sales = customer credit note, purchase = supplier credit note
 */
exports.searchInvoices = async (req, res) => {
  try {
    const { facilityId, invoiceRef, search } = req.query;
    const searchTerm = (invoiceRef || search || "").trim();

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    if (!searchTerm || searchTerm.length < 2) {
      return res.status(200).json({
        success: true,
        data: [],
        message: "Enter at least 2 characters to search",
      });
    }

    const searchLower = searchTerm.toLowerCase();

    const invoices = await db.Invoice.findAll({
      where: {
        facility_id: facilityId,
        amount: { [Op.gt]: 0 },
        [Op.or]: [
          db.sequelize.where(
            db.sequelize.fn("LOWER", db.sequelize.col("invoice_ref")),
            { [Op.like]: `%${searchLower}%` }
          ),
          db.sequelize.where(
            db.sequelize.fn("LOWER", db.sequelize.col("ref_number")),
            { [Op.like]: `%${searchLower}%` }
          ),
        ],
      },
      order: [["transaction_date", "DESC"]],
      attributes: ["invoice_id", "invoice_ref", "ref_number", "type", "due_date", "transaction_date", "amount", "description"],
      limit: 50,
    });

    const formatted = invoices.map((inv) => ({
      id: inv.invoice_id,
      invoice_id: inv.invoice_id,
      invoice_ref: inv.invoice_ref,
      invoiceRef: inv.invoice_ref,
      ref_number: inv.ref_number,
      type: inv.type,
      entityId: inv.ref_number,
      date: inv.transaction_date,
      dueDate: inv.due_date,
      amount: parseFloat(inv.amount),
      description: inv.description,
    }));

    res.status(200).json({
      success: true,
      data: formatted,
    });
  } catch (error) {
    console.error("Error searching invoices:", error);
    res.status(500).json({
      success: false,
      message: "Failed to search invoices",
      error: error.message,
    });
  }
};

/**
 * Get Invoices for Entity (Customer or Supplier)
 * GET /api/credit-notes/invoices/:entityId
 */
exports.getInvoicesForEntity = async (req, res) => {
  try {
    const { entityId } = req.params;
    const { facilityId, type, invoiceRef, search } = req.query;

    if (!facilityId || !entityId || !type) {
      return res.status(400).json({
        success: false,
        message: "facilityId, entityId, and type are required",
      });
    }

    const invoiceSearch = (invoiceRef || search || "").trim().toLowerCase();

    // For customer credit notes, we need sales invoices
    // For supplier credit notes, we need purchase invoices/bills
    const invoiceType = type === "customer" ? "sales" : "purchase";

    const baseInvoiceWhere = {
      facility_id: facilityId,
      type: invoiceType,
      ref_number: entityId,
      amount: { [Op.gt]: 0 }, // Only positive amounts (not credit notes)
    };
    const invoiceWhere = invoiceSearch
      ? {
          [Op.and]: [
            baseInvoiceWhere,
            db.sequelize.where(
              db.sequelize.fn("LOWER", db.sequelize.col("invoice_ref")),
              { [Op.like]: `%${invoiceSearch}%` }
            ),
          ],
        }
      : baseInvoiceWhere;

    // Get invoices from invoices table
    const invoices = await db.Invoice.findAll({
      where: invoiceWhere,
      order: [["transaction_date", "DESC"]],
      attributes: ["invoice_id", "invoice_ref", "ref_number", "due_date", "transaction_date", "amount", "description"],
    });

    // Also get from general_ledger for receivable/payable entries
    const ledgerType = type === "customer" ? "receivable" : "payable";
    const ledgerEntries = await db.GeneralLedger.findAll({
      where: {
        facility_id: facilityId,
        type: ledgerType,
        transaction_ref: entityId,
        [type === "customer" ? "dr" : "cr"]: { [Op.gt]: 0 },
      },
      order: [["transaction_date", "DESC"]],
      attributes: ["transaction_id", "reference_number", "transaction_date", "dr", "cr", "transaction_description", "status"],
      limit: 100,
    });

    // Combine and format results
    const formattedInvoices = invoices.map((inv) => ({
      id: inv.invoice_id,
      invoice_id: inv.invoice_id,
      invoice_ref: inv.invoice_ref,
      invoiceRef: inv.invoice_ref,
      ref_number: inv.ref_number,
      date: inv.transaction_date,
      dueDate: inv.due_date,
      amount: parseFloat(inv.amount),
      description: inv.description,
      source: "invoices",
    }));

    const formattedLedger = ledgerEntries
      .filter((entry) => entry.reference_number) // Only entries with reference numbers
      .map((entry) => ({
        id: entry.transaction_id,
        invoice_id: entry.transaction_id,
        invoice_ref: entry.reference_number,
        invoiceRef: entry.reference_number,
        date: entry.transaction_date,
        amount: parseFloat(type === "customer" ? entry.dr : entry.cr),
        description: entry.transaction_description,
        status: entry.status,
        source: "ledger",
      }));

    // Merge and deduplicate by invoice reference
    let allInvoices = [...formattedInvoices];
    formattedLedger.forEach((ledgerEntry) => {
      if (!allInvoices.find((inv) => inv.invoiceRef === ledgerEntry.invoiceRef)) {
        allInvoices.push(ledgerEntry);
      }
    });

    // Filter by invoice number if search provided (for ledger-sourced entries)
    if (invoiceSearch) {
      allInvoices = allInvoices.filter(
        (inv) =>
          (inv.invoiceRef || "").toLowerCase().includes(invoiceSearch)
      );
    }

    res.status(200).json({
      success: true,
      data: allInvoices,
    });
  } catch (error) {
    console.error("Error fetching invoices for entity:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch invoices",
      error: error.message,
    });
  }
};

/**
 * Get Credit Note Details
 * GET /api/credit-notes/:creditNoteNumber
 */
exports.getCreditNoteDetails = async (req, res) => {
  try {
    const { creditNoteNumber } = req.params;
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const entries = await db.GeneralLedger.findAll({
      where: {
        facility_id: facilityId,
        description: {
          [Op.like]: `%Credit Note ${creditNoteNumber}%`,
        },
        transaction_type: "credit_note",
      },
      order: [["created_at", "ASC"]],
    });

    if (entries.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Credit note not found",
      });
    }

    // Extract credit note details
    const firstEntry = entries[0];
    const type = firstEntry.transaction_category === "customer_credit_note" ? "customer" : "supplier";

    // Calculate totals
    let subtotal = 0;
    let vatAmount = 0;
    let totalAmount = 0;

    entries.forEach((entry) => {
      if (entry.account_name?.includes("Returns") || entry.account_name?.includes("Adjustment")) {
        subtotal += entry.debit || entry.credit;
      } else if (entry.account_name?.includes("VAT")) {
        vatAmount += entry.debit || entry.credit;
      }
      totalAmount += entry.credit || entry.debit;
    });

    res.status(200).json({
      success: true,
      data: {
        creditNoteNumber,
        type,
        date: firstEntry.transaction_date,
        description: firstEntry.description,
        subtotal,
        vatAmount,
        totalAmount,
        entries,
      },
    });
  } catch (error) {
    console.error("Error fetching credit note details:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch credit note details",
      error: error.message,
    });
  }
};

