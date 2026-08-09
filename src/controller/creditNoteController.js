const db = require("../models");
const { Op, QueryTypes } = require("sequelize");
const { getAndUpdateNumber } = require("../services/numberGen");
const moment = require("moment");
const {
  reasonRequiresInventoryProductLines,
  getInventoryExplanationPrompt,
  getReasonByCategory,
  reasonRequiresInventoryRestock,
} = require("./creditNoteReasonController");
const {
  recordActivity,
  pickActor,
} = require("../services/activityAuditService");
const {
  applyCreditNoteInventoryMovement,
} = require("../services/creditNoteInventoryService");

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
 * Generate Credit Note Number via number_generator
 * prefixes: credit_note_customer → CN-C-YY-#### | credit_note_supplier → CN-S-YY-####
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

const isValidReservedCreditNoteNumber = (value, type) => {
  const expected = type === "customer" ? "CN-C" : "CN-S";
  return new RegExp(`^${expected}-\\d{2}-\\d{4}$`).test(String(value || "").trim());
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
      creditNoteNumber: requestedCreditNoteNumber,
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
    } else if (
      reasonCategory &&
      getReasonByCategory(reasonCategory, type)?.inventoryRelated
    ) {
      const catDef = getReasonByCategory(reasonCategory, type);
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
        return res.status(400).json({
          success: false,
          message:
            catDef?.inventoryExplanationPrompt ||
            "Please add a short inventory explanation (how stock or goods are affected).",
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
    const BusinessModel = db.Business || db.business;
    const business = BusinessModel
      ? await BusinessModel.findOne({
          where: { id: facilityId },
          attributes: ["vat_policy"],
        })
      : null;

    const vatPolicy = business?.vat_policy || "vat_exclusive";

    // Prefer number reserved by UI via /get-and-update; otherwise allocate now
    let creditNoteNumber = String(requestedCreditNoteNumber || "").trim();
    if (!isValidReservedCreditNoteNumber(creditNoteNumber, type)) {
      creditNoteNumber = await generateCreditNoteNumber(facilityId, type);
    }

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

      // Get Accounts Receivable account (A/R naming / levels vary by CoA)
      let arAccount = await db.AccountCategory.findOne({
        where: {
          facility_id: facilityId,
          description: { [Op.like]: "%Accounts Receivable%" },
          display: 1,
        },
        order: [["level", "ASC"]],
      });
      if (!arAccount) {
        arAccount = await db.AccountCategory.findOne({
          where: {
            facility_id: facilityId,
            description: { [Op.like]: "%Accounts receivable%" },
            display: 1,
          },
          order: [["level", "ASC"]],
        });
      }
      if (!arAccount) {
        arAccount = await db.AccountCategory.findOne({
          where: {
            facility_id: facilityId,
            description: { [Op.like]: "%A/R%" },
            display: 1,
          },
          order: [["level", "ASC"]],
        });
      }
      if (!arAccount) {
        arAccount = await db.AccountCategory.findOne({
          where: {
            facility_id: facilityId,
            account_role: "receivable",
            display: 1,
          },
          order: [["level", "ASC"]],
        });
      }

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

      // Get Accounts Payable account (A/P naming / levels vary by CoA)
      let apAccount = await db.AccountCategory.findOne({
        where: {
          facility_id: facilityId,
          description: { [Op.like]: "%Accounts Payable%" },
        },
        order: [["level", "ASC"]],
      });
      if (!apAccount) {
        apAccount = await db.AccountCategory.findOne({
          where: {
            facility_id: facilityId,
            description: { [Op.like]: "%Accounts payable%" },
          },
          order: [["level", "ASC"]],
        });
      }
      if (!apAccount) {
        apAccount = await db.AccountCategory.findOne({
          where: {
            facility_id: facilityId,
            description: { [Op.like]: "%A/P%" },
          },
          order: [["level", "ASC"]],
        });
      }
      if (!apAccount) {
        apAccount = await db.AccountCategory.findOne({
          where: {
            facility_id: facilityId,
            description: { [Op.like]: "%Trade Payable%" },
          },
          order: [["level", "ASC"]],
        });
      }

      if (!apAccount) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Accounts Payable account not found. Please set it up in Chart of Accounts.",
        });
      }

      receivablePayableAccount = apAccount;
    }

    // Resolve offset accounts from line items (Zoho-style) or CoA fallbacks
    const lineAccountCodes = [
      ...new Set(
        (lineItems || [])
          .map((li) => String(li?.account?.code || li?.account?.head || "").trim())
          .filter(Boolean),
      ),
    ];
    const lineAccountsByCode = {};
    if (lineAccountCodes.length) {
      const found = await db.AccountCategory.findAll({
        where: {
          facility_id: facilityId,
          code: { [Op.in]: lineAccountCodes },
        },
      });
      for (const acc of found) {
        lineAccountsByCode[String(acc.code)] = acc;
      }
    }

    const usableLines = (lineItems || [])
      .map((li, idx) => {
        const code = String(li?.account?.code || li?.account?.head || "").trim();
        const amt = Number(li?.amount) || 0;
        return {
          idx,
          code,
          amount: amt,
          account: code ? lineAccountsByCode[code] : null,
          description: String(li?.description || "").trim(),
        };
      })
      .filter((l) => l.account && l.amount > 0);

    // Fallback single returns/adjustment account when lines lack chart codes
    const returnsAccountName =
      type === "customer" ? "Sales Returns" : "Purchase Returns";
    let returnsAccount = null;
    if (!usableLines.length) {
      returnsAccount = await db.AccountCategory.findOne({
        where: {
          facility_id: facilityId,
          description: { [Op.like]: `%${returnsAccountName}%` },
        },
        order: [["level", "ASC"]],
      });

      if (!returnsAccount) {
        const adjustmentAccountName =
          type === "customer" ? "Income Adjustment" : "Expense Adjustment";
        returnsAccount = await db.AccountCategory.findOne({
          where: {
            facility_id: facilityId,
            description: { [Op.like]: `%${adjustmentAccountName}%` },
          },
          order: [["level", "ASC"]],
        });
      }

      if (!returnsAccount && type === "customer") {
        returnsAccount = await db.AccountCategory.findOne({
          where: {
            facility_id: facilityId,
            description: { [Op.like]: "%Discount Allowed%" },
          },
          order: [["level", "ASC"]],
        });
      }

      if (!returnsAccount && type === "supplier") {
        returnsAccount = await db.AccountCategory.findOne({
          where: {
            facility_id: facilityId,
            description: { [Op.like]: "%Inventory%" },
          },
          order: [["level", "ASC"]],
        });
      }

      if (!returnsAccount && type === "supplier") {
        returnsAccount = await db.AccountCategory.findOne({
          where: {
            facility_id: facilityId,
            description: { [Op.like]: "%Cost of Sales%" },
          },
          order: [["level", "ASC"]],
        });
      }

      if (!returnsAccount) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message:
            type === "customer"
              ? "Sales Returns, Income Adjustment, or Discount Allowed account not found. Please set it up in Chart of Accounts."
              : "Select a line account, or set up Purchase Returns / Inventory in Chart of Accounts.",
        });
      }
    }

    // Get VAT Control account
    let vatAccount = null;
    if (vatAmount > 0) {
      vatAccount = await db.AccountCategory.findOne({
        where: {
          facility_id: facilityId,
          description: { [Op.like]: "%VAT%" },
        },
        order: [["level", "ASC"]],
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

    const purpose = `Credit Note ${creditNoteNumber}`;
    const glType = type === "customer" ? "discount" : "payable";
    const refNum = String(creditNoteNumber).slice(0, 100);

    const pushGl = (account, dr, cr, desc, lineKey) => {
      const parent =
        account.parentCode ?? account.parent_code ?? account.code ?? "0";
      ledgerEntries.push({
        facility_id: facilityId,
        transaction_date: transactionDate,
        transaction_ref: `${creditNoteNumber}-${lineKey}`,
        reference_number: refNum,
        account_code: account.code,
        account_description: account.description,
        account_subhead: String(parent),
        dr: Number(Number(dr).toFixed(2)),
        cr: Number(Number(cr).toFixed(2)),
        transaction_description: String(desc).slice(0, 500),
        purpose_of_payment: purpose.slice(0, 150),
        payee: String(entityName || entityId || "").slice(0, 50),
        mode_of_payment: "credit_note",
        bank_account_id: "",
        type: glType,
        status: "saved",
        created_by: userId,
      });
    };

    const offsetDesc = (lineDesc) =>
      `Credit Note ${creditNoteNumber} - ${entityName}${
        lineDesc ? ` - ${lineDesc}` : reason ? ` - ${reason}` : ""
      }${methodSuffix}`;

    // Create ledger entries — prefer Zoho line accounts when present
    if (type === "customer") {
      // Dr line accounts (or Sales Returns) / Cr Accounts Receivable
      if (usableLines.length) {
        usableLines.forEach((line, i) => {
          pushGl(
            line.account,
            line.amount,
            0,
            offsetDesc(line.description),
            `L${i + 1}`,
          );
        });
      } else {
        pushGl(
          returnsAccount,
          netAmount,
          0,
          offsetDesc(""),
          "DR",
        );
      }

      pushGl(
        receivablePayableAccount,
        0,
        totalAmount,
        `Credit Note ${creditNoteNumber} - ${entityName}${reference ? ` (Ref: ${reference})` : ""}${methodSuffix}`,
        "AR",
      );

      if (vatAmount > 0 && vatAccount) {
        pushGl(
          vatAccount,
          0,
          calculatedVat,
          `Credit Note ${creditNoteNumber} - VAT Reversal${methodSuffix}`,
          "VAT",
        );
      }
    } else {
      // Dr Accounts Payable / Cr line accounts (or Purchase Returns / Inventory)
      pushGl(
        receivablePayableAccount,
        totalAmount,
        0,
        `Credit Note ${creditNoteNumber} - ${entityName}${reference ? ` (Ref: ${reference})` : ""}${methodSuffix}`,
        "AP",
      );

      if (usableLines.length) {
        usableLines.forEach((line, i) => {
          pushGl(
            line.account,
            0,
            line.amount,
            offsetDesc(line.description),
            `L${i + 1}`,
          );
        });
      } else {
        pushGl(
          returnsAccount,
          0,
          netAmount,
          offsetDesc(""),
          "CR",
        );
      }

      if (vatAmount > 0 && vatAccount) {
        pushGl(
          vatAccount,
          calculatedVat,
          0,
          `Credit Note ${creditNoteNumber} - VAT Reversal${methodSuffix}`,
          "VAT",
        );
      }
    }

    // Return inward / purchase return — update stock (+ reverse COGS into ledgerEntries)
    let inventoryMovement = { storeRows: 0, cogsReversed: 0 };
    try {
      const effectiveReason =
        reason ||
        getReasonByCategory(reasonCategory, type)?.value ||
        "";
      if (
        reasonRequiresInventoryRestock(effectiveReason, type) ||
        getReasonByCategory(reasonCategory, type)?.restockInventory
      ) {
        inventoryMovement = await applyCreditNoteInventoryMovement({
          facilityId,
          userId,
          type,
          reason: effectiveReason,
          reasonCategory,
          creditNoteNumber,
          transactionDate,
          lineItems,
          entityId,
          entityName,
          inventoryExplanation,
          transaction,
          pushGl,
        });
      }
    } catch (invErr) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: invErr.message || "Failed to update inventory for return",
      });
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
          bank_account_id: "",
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
          receiptNo: creditNoteNumber,
          cheque_no: creditNoteNumber,
          link_id: reference || null, // Link to original invoice/bill
          type: "discount", // Using 'discount' type for credit adjustments
          bank_account_id: "",
          created_by: userId,
        },
        { transaction }
      );
    }

    // Zoho Refund path: settle immediately via cash/bank and close the note
    let creditsAppliedOnCreate = 0;
    let creditsRemainingOnCreate = totalAmount;
    let docStatusOnCreate = "open";

    if (paymentAdjustmentMethod === "refund_bank") {
      const mode = ["cash", "bank", "cheque"].includes(refundModeOfPayment)
        ? refundModeOfPayment
        : "bank";
      const bankId =
        refundBankAccountId != null
          ? refundBankAccountId
          : req.body.refundBankAccount?.id;

      let moneyAccount = null;
      let bankAccountIdForGl = "";

      if (mode === "cash") {
        const head = String(refundAccountHead?.head || "").trim();
        moneyAccount = await db.AccountCategory.findOne({
          where: { facility_id: facilityId, code: head },
        });
        if (!moneyAccount) {
          await transaction.rollback();
          return res.status(400).json({
            success: false,
            message: `Cash account ${head} not found in Chart of Accounts`,
          });
        }
      } else {
        const [banks] = await db.sequelize.query(
          `SELECT id, head, account_name, account_number
           FROM bank_accounts
           WHERE facility_id = :facilityId AND id = :id
           LIMIT 1`,
          {
            replacements: { facilityId, id: bankId },
            transaction,
          },
        );
        const bank = banks?.[0];
        if (!bank?.head) {
          await transaction.rollback();
          return res.status(400).json({
            success: false,
            message:
              "Bank account must be linked to a chart account (head) for refund posting",
          });
        }
        moneyAccount = await db.AccountCategory.findOne({
          where: { facility_id: facilityId, code: String(bank.head) },
        });
        if (!moneyAccount) {
          await transaction.rollback();
          return res.status(400).json({
            success: false,
            message: `Bank GL account ${bank.head} not found in Chart of Accounts`,
          });
        }
        bankAccountIdForGl = String(bank.id);
      }

      const refundDesc = `Refund ${creditNoteNumber} - ${entityName} via ${mode}`;
      const moneyParent = String(
        moneyAccount.parentCode ?? moneyAccount.parent_code ?? moneyAccount.code ?? "0",
      );
      const controlParent = String(
        receivablePayableAccount.parentCode ??
          receivablePayableAccount.parent_code ??
          receivablePayableAccount.code ??
          "0",
      );

      // Customer: Dr AR, Cr Bank/Cash — reverse open credit and pay out
      // Vendor:   Cr AP, Dr Bank/Cash — reverse open credit and pay out
      if (type === "customer") {
        await db.GeneralLedger.bulkCreate(
          [
            {
              facility_id: facilityId,
              transaction_date: transactionDate,
              transaction_ref: `${creditNoteNumber}-REFUND-AR`,
              reference_number: refNum,
              account_code: receivablePayableAccount.code,
              account_description: receivablePayableAccount.description,
              account_subhead: controlParent,
              dr: Number(Number(totalAmount).toFixed(2)),
              cr: 0,
              transaction_description: refundDesc.slice(0, 500),
              purpose_of_payment: `Refund ${creditNoteNumber}`.slice(0, 150),
              payee: String(entityName || entityId || "").slice(0, 50),
              mode_of_payment: mode,
              bank_account_id: bankAccountIdForGl,
              type: "discount",
              status: "saved",
              created_by: userId,
            },
            {
              facility_id: facilityId,
              transaction_date: transactionDate,
              transaction_ref: `${creditNoteNumber}-REFUND-CASH`,
              reference_number: refNum,
              account_code: moneyAccount.code,
              account_description: moneyAccount.description,
              account_subhead: moneyParent,
              dr: 0,
              cr: Number(Number(totalAmount).toFixed(2)),
              transaction_description: refundDesc.slice(0, 500),
              purpose_of_payment: `Refund ${creditNoteNumber}`.slice(0, 150),
              payee: String(entityName || entityId || "").slice(0, 50),
              mode_of_payment: mode,
              bank_account_id: bankAccountIdForGl,
              type: "discount",
              status: "saved",
              created_by: userId,
            },
          ],
          { transaction },
        );

        await db.CustomerEntry.create(
          {
            customerNo: entityId,
            description: refundDesc.slice(0, 255),
            qty_in: totalAmount,
            qty_out: 0,
            cost: totalAmount,
            facilityId,
            mode_of_payment: mode,
            receiptNo: creditNoteNumber,
            link_id: "REFUND",
            type: "discount",
            bank_account_id: bankAccountIdForGl,
            created_by: userId,
          },
          { transaction },
        );
      } else {
        await db.GeneralLedger.bulkCreate(
          [
            {
              facility_id: facilityId,
              transaction_date: transactionDate,
              transaction_ref: `${creditNoteNumber}-REFUND-CASH`,
              reference_number: refNum,
              account_code: moneyAccount.code,
              account_description: moneyAccount.description,
              account_subhead: moneyParent,
              dr: Number(Number(totalAmount).toFixed(2)),
              cr: 0,
              transaction_description: refundDesc.slice(0, 500),
              purpose_of_payment: `Refund ${creditNoteNumber}`.slice(0, 150),
              payee: String(entityName || entityId || "").slice(0, 50),
              mode_of_payment: mode,
              bank_account_id: bankAccountIdForGl,
              type: "payable",
              status: "saved",
              created_by: userId,
            },
            {
              facility_id: facilityId,
              transaction_date: transactionDate,
              transaction_ref: `${creditNoteNumber}-REFUND-AP`,
              reference_number: refNum,
              account_code: receivablePayableAccount.code,
              account_description: receivablePayableAccount.description,
              account_subhead: controlParent,
              dr: 0,
              cr: Number(Number(totalAmount).toFixed(2)),
              transaction_description: refundDesc.slice(0, 500),
              purpose_of_payment: `Refund ${creditNoteNumber}`.slice(0, 150),
              payee: String(entityName || entityId || "").slice(0, 50),
              mode_of_payment: mode,
              bank_account_id: bankAccountIdForGl,
              type: "payable",
              status: "saved",
              created_by: userId,
            },
          ],
          { transaction },
        );

        await db.SupplierEntry.create(
          {
            supplier_number: entityId,
            description: refundDesc.slice(0, 255),
            qty_in: 0,
            qty_out: totalAmount,
            cost: totalAmount,
            facilityId,
            mode_of_payment: mode,
            receiptNo: creditNoteNumber,
            cheque_no: creditNoteNumber,
            link_id: "REFUND",
            type: "payment",
            bank_account_id: bankAccountIdForGl,
            created_by: userId,
          },
          { transaction },
        );
      }

      await db.CreditNoteApplication.create(
        {
          facility_id: facilityId,
          credit_note_number: creditNoteNumber,
          invoice_ref: "REFUND",
          amount: totalAmount,
          created_by: userId,
        },
        { transaction },
      );

      creditsAppliedOnCreate = totalAmount;
      creditsRemainingOnCreate = 0;
      docStatusOnCreate = "closed";
    }

    await transaction.commit();

    await recordActivity({
      facilityId,
      userId: pickActor(req) || userId,
      action: "create",
      entityType: type === "supplier" ? "vendor_credit" : "credit_note",
      entityId: creditNoteNumber,
      entityLabel: entityName || entityId,
      after: {
        creditNoteNumber,
        type,
        entityId,
        totalAmount,
        status: docStatusOnCreate,
        paymentAdjustmentMethod,
        inventoryStoreRows: inventoryMovement.storeRows,
        cogsReversed: inventoryMovement.cogsReversed,
      },
      remark: reason || "Credit note created",
    });

    res.status(201).json({
      success: true,
      message:
        paymentAdjustmentMethod === "refund_bank"
          ? "Credit note created and refunded successfully"
          : inventoryMovement.storeRows > 0
            ? `Credit note created; inventory updated (${inventoryMovement.storeRows} line${
                inventoryMovement.storeRows === 1 ? "" : "s"
              })`
            : "Credit note created successfully",
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
        creditsApplied: creditsAppliedOnCreate,
        creditsRemaining: creditsRemainingOnCreate,
        status: docStatusOnCreate,
        paymentAdjustmentMethod: paymentAdjustmentMethod || "offset_outstanding",
        inventoryUpdated: inventoryMovement.storeRows > 0,
        inventoryStoreRows: inventoryMovement.storeRows,
        cogsReversed: inventoryMovement.cogsReversed,
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
 * Zoho-style list: Credit Notes (CN-C*) and Vendor Credits (CN-S*) from invoices + applications.
 * POST /api/credit-notes/list
 * body: { facilityId, type?: customer|supplier, status?: open|closed|all, search?, page?, limit? }
 */
exports.getCreditNotes = async (req, res) => {
  try {
    const {
      facilityId,
      type,
      status = "all",
      search = "",
      startDate,
      endDate,
      page = 1,
      limit = 50,
    } = req.body || {};

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const prefix =
      type === "supplier" || type === "vendor"
        ? "CN-S%"
        : type === "customer"
          ? "CN-C%"
          : "CN-%";
    const invType =
      type === "supplier" || type === "vendor"
        ? "purchase"
        : type === "customer"
          ? "sales"
          : null;

    const where = {
      facility_id: facilityId,
      invoice_ref: { [Op.like]: prefix },
      amount: { [Op.lt]: 0 },
    };
    if (invType) where.type = invType;
    if (startDate && endDate) {
      where.transaction_date = {
        [Op.between]: [startDate, endDate],
      };
    }
    if (search && String(search).trim()) {
      const q = `%${String(search).trim()}%`;
      where[Op.and] = [
        {
          [Op.or]: [
            { invoice_ref: { [Op.like]: q } },
            { ref_number: { [Op.like]: q } },
            { description: { [Op.like]: q } },
          ],
        },
      ];
    }

    const invoices = await db.Invoice.findAll({
      where,
      order: [
        ["transaction_date", "DESC"],
        ["invoice_id", "DESC"],
      ],
    });

    const cnNumbers = invoices.map((i) => i.invoice_ref);
    const apps =
      cnNumbers.length === 0
        ? []
        : await db.CreditNoteApplication.findAll({
            where: {
              facility_id: facilityId,
              credit_note_number: { [Op.in]: cnNumbers },
            },
          });

    const appliedMap = {};
    for (const a of apps) {
      const k = a.credit_note_number;
      appliedMap[k] = (appliedMap[k] || 0) + (parseFloat(a.amount) || 0);
    }

    const mapped = [];
    for (const inv of invoices) {
      const totalAmount = Math.abs(parseFloat(inv.amount) || 0);
      const creditsApplied = appliedMap[inv.invoice_ref] || 0;
      const creditsRemaining = Math.max(0, totalAmount - creditsApplied);
      const docStatus = creditsRemaining <= 0.009 ? "closed" : "open";
      const isCustomer = inv.type === "sales";

      let entityId = "";
      let entityName = "";
      if (isCustomer) {
        const ce = await db.CustomerEntry.findOne({
          where: { facilityId, receiptNo: inv.invoice_ref },
          order: [["created_at", "DESC"]],
        });
        entityId = ce?.customerNo || "";
        if (entityId) {
          const c = await db.Customer.findOne({
            where: { facilityId, customerNo: entityId },
          });
          entityName = c?.fullname || entityId;
        }
      } else {
        const se = await db.SupplierEntry.findOne({
          where: { facilityId, cheque_no: inv.invoice_ref },
          order: [["created_at", "DESC"]],
        });
        entityId = se?.supplier_number || "";
        if (entityId) {
          const s = await db.SuppliersInfo.findOne({
            where: { facilityId, supplier_number: entityId },
          });
          entityName = s?.supplier_name || entityId;
        }
      }

      mapped.push({
        creditNoteNumber: inv.invoice_ref,
        reference: inv.ref_number || "",
        type: isCustomer ? "customer" : "supplier",
        date: inv.transaction_date,
        description: inv.description || "",
        totalAmount,
        creditsApplied,
        creditsRemaining,
        status: docStatus,
        entityId,
        entityName: entityName || entityId || "—",
        vatAmount: parseFloat(inv.tax_amount) || 0,
        createdBy: inv.created_by,
        createdAt: inv.created_at,
        invoiceId: inv.invoice_id,
      });
    }

    const filtered =
      status === "open" || status === "closed"
        ? mapped.filter((m) => m.status === status)
        : mapped;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(200, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;
    const pageRows = filtered.slice(offset, offset + limitNum);

    return res.status(200).json({
      success: true,
      data: pageRows,
      pagination: {
        total: filtered.length,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(filtered.length / limitNum) || 1,
      },
      meta: {
        openCount: mapped.filter((m) => m.status === "open").length,
        closedCount: mapped.filter((m) => m.status === "closed").length,
      },
    });
  } catch (error) {
    console.error("Error fetching credit notes:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch credit notes",
      error: error.message,
    });
  }
};

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
    const invoiceType = type === "customer" ? "sales" : "purchase";

    const baseInvoiceWhere = {
      facility_id: facilityId,
      type: invoiceType,
      ref_number: entityId,
      amount: { [Op.gt]: 0 },
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

    const invoices = await db.Invoice.findAll({
      where: invoiceWhere,
      order: [["transaction_date", "DESC"]],
      attributes: [
        "invoice_id",
        "invoice_ref",
        "ref_number",
        "type",
        "due_date",
        "transaction_date",
        "amount",
        "description",
      ],
      limit: 100,
    });

    let allInvoices = invoices.map((inv) => ({
      id: inv.invoice_id,
      invoice_id: inv.invoice_id,
      invoiceRef: inv.invoice_ref,
      invoice_ref: inv.invoice_ref,
      ref_number: inv.ref_number,
      type: inv.type,
      entityId: inv.ref_number,
      date: inv.transaction_date,
      dueDate: inv.due_date,
      amount: parseFloat(inv.amount),
      description: inv.description,
    }));

    if (invoiceSearch) {
      allInvoices = allInvoices.filter((inv) =>
        (inv.invoiceRef || "").toLowerCase().includes(invoiceSearch),
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
 * Get Credit Note / Vendor Credit details (Zoho detail pane)
 * GET /api/credit-notes/:creditNoteNumber?facilityId=
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

    const invoice = await db.Invoice.findOne({
      where: {
        facility_id: facilityId,
        invoice_ref: creditNoteNumber,
        amount: { [Op.lt]: 0 },
      },
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Credit note not found",
      });
    }

    const isCustomer = invoice.type === "sales";
    let entityId = "";
    let entityName = "";

    if (isCustomer) {
      const ce = await db.CustomerEntry.findOne({
        where: { facilityId, receiptNo: creditNoteNumber },
        order: [["created_at", "DESC"]],
      });
      entityId = ce?.customerNo || "";
      if (entityId) {
        const c = await db.Customer.findOne({
          where: { facilityId, customerNo: entityId },
        });
        entityName = c?.fullname || entityId;
      }
    } else {
      const se = await db.SupplierEntry.findOne({
        where: { facilityId, cheque_no: creditNoteNumber },
        order: [["created_at", "DESC"]],
      });
      entityId = se?.supplier_number || "";
      if (entityId) {
        const s = await db.SuppliersInfo.findOne({
          where: { facilityId, supplier_number: entityId },
        });
        entityName = s?.supplier_name || entityId;
      }
    }

    const applications = await db.CreditNoteApplication.findAll({
      where: { facility_id: facilityId, credit_note_number: creditNoteNumber },
      order: [["created_at", "DESC"]],
    });

    const creditsApplied = applications.reduce(
      (s, a) => s + (parseFloat(a.amount) || 0),
      0,
    );
    const totalAmount = Math.abs(parseFloat(invoice.amount) || 0);
    const creditsRemaining = Math.max(0, totalAmount - creditsApplied);

    const glEntries = await db.GeneralLedger.findAll({
      where: {
        facility_id: facilityId,
        [Op.or]: [
          { reference_number: String(creditNoteNumber).slice(0, 100) },
          { transaction_ref: { [Op.like]: `${creditNoteNumber}%` } },
          {
            transaction_description: {
              [Op.like]: `%Credit Note ${creditNoteNumber}%`,
            },
          },
        ],
      },
      order: [["transaction_id", "ASC"]],
      limit: 50,
    });

    return res.status(200).json({
      success: true,
      data: {
        creditNoteNumber,
        type: isCustomer ? "customer" : "supplier",
        date: invoice.transaction_date,
        reference: invoice.ref_number || "",
        reason: invoice.description || "",
        description: invoice.description || "",
        entityId,
        entityName: entityName || entityId || "—",
        subtotal: totalAmount - (parseFloat(invoice.tax_amount) || 0),
        vatAmount: parseFloat(invoice.tax_amount) || 0,
        totalAmount,
        creditsApplied,
        creditsRemaining,
        status: creditsRemaining <= 0.009 ? "closed" : "open",
        applications: applications.map((a) => ({
          id: a.id,
          invoiceRef: a.invoice_ref,
          amount: parseFloat(a.amount) || 0,
          date: a.created_at,
          createdBy: a.created_by,
        })),
        entries: glEntries.map((e) => ({
          account_code: e.account_code,
          account_description: e.account_description,
          dr: parseFloat(e.dr) || 0,
          cr: parseFloat(e.cr) || 0,
          transaction_description: e.transaction_description,
          transaction_date: e.transaction_date,
          reference_number: e.reference_number,
        })),
      },
    });
  } catch (error) {
    console.error("Error fetching credit note details:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch credit note details",
      error: error.message,
    });
  }
};

/**
 * Apply credit note / vendor credit to invoice(s) — Zoho "Apply to Invoices / Bills"
 * POST /api/credit-notes/apply
 * body: { facilityId, userId, creditNoteNumber, applications: [{ invoiceRef, amount }] }
 */
exports.applyCreditNote = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { facilityId, userId, creditNoteNumber, applications } = req.body || {};

    if (
      !facilityId ||
      !userId ||
      !creditNoteNumber ||
      !Array.isArray(applications) ||
      applications.length === 0
    ) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "facilityId, userId, creditNoteNumber, and applications[] are required",
      });
    }

    const invoice = await db.Invoice.findOne({
      where: {
        facility_id: facilityId,
        invoice_ref: creditNoteNumber,
        amount: { [Op.lt]: 0 },
      },
      transaction,
    });

    if (!invoice) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Credit note not found",
      });
    }

    const isCustomer = invoice.type === "sales";
    const existingApps = await db.CreditNoteApplication.findAll({
      where: { facility_id: facilityId, credit_note_number: creditNoteNumber },
      transaction,
    });
    const alreadyApplied = existingApps.reduce(
      (s, a) => s + (parseFloat(a.amount) || 0),
      0,
    );
    const totalAmount = Math.abs(parseFloat(invoice.amount) || 0);
    let remaining = Math.max(0, totalAmount - alreadyApplied);

    const applyTotal = applications.reduce(
      (s, a) => s + (parseFloat(a.amount) || 0),
      0,
    );
    if (applyTotal <= 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Application amounts must be positive",
      });
    }
    if (applyTotal > remaining + 0.009) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Cannot apply ${applyTotal}: only ${remaining.toFixed(2)} credits remaining`,
      });
    }

    let entityId = "";
    let entityName = "";
    if (isCustomer) {
      const ce = await db.CustomerEntry.findOne({
        where: { facilityId, receiptNo: creditNoteNumber },
        transaction,
      });
      entityId = ce?.customerNo || "";
      const c = entityId
        ? await db.Customer.findOne({
            where: { facilityId, customerNo: entityId },
            transaction,
          })
        : null;
      entityName = c?.fullname || entityId;
    } else {
      const se = await db.SupplierEntry.findOne({
        where: {
          facilityId,
          [Op.or]: [
            { receiptNo: creditNoteNumber },
            { cheque_no: creditNoteNumber },
          ],
        },
        transaction,
      });
      entityId = se?.supplier_number || invoice.ref_number || "";
      const s = entityId
        ? await db.SuppliersInfo.findOne({
            where: { facilityId, supplier_number: entityId },
            transaction,
          })
        : null;
      entityName = s?.supplier_name || entityId;
    }

    let balanceAccount = await db.AccountCategory.findOne({
      where: {
        facility_id: facilityId,
        description: {
          [Op.like]: isCustomer ? "%Accounts receivable%" : "%Accounts Payable%",
        },
      },
      order: [["level", "ASC"]],
      transaction,
    });
    if (!balanceAccount && isCustomer) {
      balanceAccount = await db.AccountCategory.findOne({
        where: {
          facility_id: facilityId,
          description: { [Op.like]: "%A/R%" },
        },
        order: [["level", "ASC"]],
        transaction,
      });
    }
    if (!balanceAccount && !isCustomer) {
      balanceAccount = await db.AccountCategory.findOne({
        where: {
          facility_id: facilityId,
          description: { [Op.like]: "%A/P%" },
        },
        order: [["level", "ASC"]],
        transaction,
      });
    }
    if (!balanceAccount) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `${isCustomer ? "Accounts Receivable" : "Accounts Payable"} account not found`,
      });
    }

    const parent = String(
      balanceAccount.parentCode ?? balanceAccount.parent_code ?? balanceAccount.code ?? "0",
    );
    const today = new Date();
    const cnRef = String(creditNoteNumber).slice(0, 100);
    const savedApps = [];

    for (const app of applications) {
      const invRef = String(app.invoiceRef || app.invoice_ref || "").trim();
      const amt = parseFloat(app.amount);
      if (!invRef || !Number.isFinite(amt) || amt <= 0) continue;

      const targetInv = await db.Invoice.findOne({
        where: {
          facility_id: facilityId,
          invoice_ref: invRef,
          amount: { [Op.gt]: 0 },
          type: isCustomer ? "sales" : "purchase",
        },
        transaction,
      });
      if (!targetInv) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: `Invoice/bill ${invRef} not found`,
        });
      }

      const purpose = `Apply ${creditNoteNumber} to ${invRef}`.slice(0, 150);
      const desc = `Applied credit ${creditNoteNumber} to ${invRef} — ${entityName}`.slice(0, 500);

      if (isCustomer) {
        await db.GeneralLedger.bulkCreate(
          [
            {
              facility_id: facilityId,
              transaction_date: today,
              transaction_ref: `${creditNoteNumber}-APPLY-${invRef}`.slice(0, 100),
              reference_number: cnRef,
              account_code: balanceAccount.code,
              account_description: balanceAccount.description,
              account_subhead: parent,
              dr: Number(amt.toFixed(2)),
              cr: 0,
              transaction_description: desc,
              purpose_of_payment: purpose,
              payee: String(entityName || entityId).slice(0, 50),
              mode_of_payment: "credit_note",
              bank_account_id: "",
              type: "receivable",
              status: "saved",
              created_by: userId,
            },
            {
              facility_id: facilityId,
              transaction_date: today,
              transaction_ref: `${invRef}-CN-${creditNoteNumber}`.slice(0, 100),
              reference_number: String(invRef).slice(0, 100),
              account_code: balanceAccount.code,
              account_description: balanceAccount.description,
              account_subhead: parent,
              dr: 0,
              cr: Number(amt.toFixed(2)),
              transaction_description: desc,
              purpose_of_payment: purpose,
              payee: String(entityName || entityId).slice(0, 50),
              mode_of_payment: "credit_note",
              bank_account_id: "",
              type: "receivable",
              status: "saved",
              created_by: userId,
            },
          ],
          { transaction },
        );

        await db.CustomerEntry.create(
          {
            customerNo: entityId,
            description: desc.slice(0, 255),
            qty_in: 0,
            qty_out: amt,
            cost: amt,
            facilityId,
            mode_of_payment: "credit_note",
            receiptNo: creditNoteNumber,
            link_id: invRef,
            type: "discount",
            bank_account_id: "",
            created_by: userId,
          },
          { transaction },
        );
      } else {
        // Move unapplied vendor credit onto the bill:
        // CR A/P against the credit note, DR A/P (type=payment) against the bill
        // so outstanding-bill queries pick up the settlement.
        await db.GeneralLedger.bulkCreate(
          [
            {
              facility_id: facilityId,
              transaction_date: today,
              transaction_ref: entityId || `${creditNoteNumber}-APPLY`,
              reference_number: cnRef,
              account_code: balanceAccount.code,
              account_description: balanceAccount.description,
              account_subhead: parent,
              dr: 0,
              cr: Number(amt.toFixed(2)),
              transaction_description: desc,
              purpose_of_payment: purpose,
              payee: String(entityName || entityId).slice(0, 50),
              mode_of_payment: "credit_note",
              bank_account_id: "",
              type: "payable",
              status: "saved",
              created_by: userId,
            },
            {
              facility_id: facilityId,
              transaction_date: today,
              transaction_ref: entityId || `${invRef}-CN`,
              reference_number: String(invRef).slice(0, 100),
              account_code: balanceAccount.code,
              account_description: balanceAccount.description,
              account_subhead: parent,
              dr: Number(amt.toFixed(2)),
              cr: 0,
              transaction_description: desc,
              purpose_of_payment: purpose,
              payee: String(entityName || entityId).slice(0, 50),
              mode_of_payment: "credit_note",
              bank_account_id: "",
              type: "payment",
              status: "saved",
              created_by: userId,
            },
          ],
          { transaction },
        );

        await db.SupplierEntry.create(
          {
            supplier_number: entityId,
            description: desc.slice(0, 255),
            qty_in: amt,
            qty_out: 0,
            cost: amt,
            facilityId,
            mode_of_payment: "credit_note",
            receiptNo: creditNoteNumber,
            cheque_no: creditNoteNumber,
            link_id: invRef,
            type: "discount",
            bank_account_id: "",
            created_by: userId,
          },
          { transaction },
        );
      }

      const row = await db.CreditNoteApplication.create(
        {
          facility_id: facilityId,
          credit_note_number: creditNoteNumber,
          invoice_ref: invRef,
          amount: amt,
          created_by: userId,
        },
        { transaction },
      );
      savedApps.push({
        id: row.id,
        invoiceRef: invRef,
        amount: amt,
      });
      remaining -= amt;
    }

    await transaction.commit();

    await recordActivity({
      facilityId,
      userId: pickActor(req) || userId,
      action: "apply",
      entityType: "credit_note_application",
      entityId: creditNoteNumber,
      entityLabel: creditNoteNumber,
      after: {
        applications: savedApps,
        creditsRemaining: Math.max(0, remaining),
        status: remaining <= 0.009 ? "closed" : "open",
      },
      remark: "Credit note applied to invoice(s)",
    });

    return res.status(200).json({
      success: true,
      message: "Credits applied successfully",
      data: {
        creditNoteNumber,
        applications: savedApps,
        creditsRemaining: Math.max(0, remaining),
        status: remaining <= 0.009 ? "closed" : "open",
      },
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Error applying credit note:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to apply credit note",
      error: error.message,
    });
  }
};
