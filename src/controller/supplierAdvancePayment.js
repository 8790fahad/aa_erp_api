/**
 * Supplier advance payment — separate from customer.js and from legacy createSupplierPayment.
 * Applies payment to purchase invoices (FIFO or explicit lines); remainder posts as supplier advance (prepaid / accrual).
 */

const db = require("../models");
const { getAndUpdateNumber } = require("../services/numberGen.js");
const {
  SuppliersInfo,
  GeneralLedger,
  Account,
  SupplierEntry,
} = require("../models");

/**
 * Bank/payable lines historically used `account.head`. Chart of accounts lives in
 * `account_category.code`; many facilities have no legacy `account` row per code.
 * Resolve head for GL posting: legacy Account first, then active CoA row.
 */
async function resolvePostingAccountHead(facilityId, headCode) {
  const code = String(headCode || "").trim();
  if (!code) return null;

  const legacy = await Account.findOne({
    where: { head: code, facilityId },
  });
  if (legacy) return legacy;

  let coa = await db.AccountCategory.findOne({
    where: { code, facilityId, isActive: true },
  });
  if (!coa) {
    coa = await db.AccountCategory.findOne({
      where: { code, facilityId },
    });
  }
  if (!coa) return null;

  const parent = coa.parentCode
    ? String(coa.parentCode).trim()
    : code.length >= 6
      ? code.substring(0, 6)
      : code;

  return {
    head: code,
    subhead: parent,
    description: coa.description || code,
  };
}

async function getSupplierLedgerBalance(supplier_number, facilityId) {
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
  return parseFloat(result[0]?.balance || 0);
}

const OUTSTANDING_PURCHASE_INVOICES_SQL = `
  SELECT
    i.invoice_id,
    i.invoice_ref,
    i.ref_number,
    i.transaction_date,
    i.due_date,
    i.amount,
    i.description,
    COALESCE(payments.total_paid, 0) AS total_paid,
    GREATEST(i.amount - COALESCE(payments.total_paid, 0), 0) AS amount_due,
    CASE
      WHEN COALESCE(payments.total_paid, 0) >= i.amount THEN 'Paid'
      WHEN COALESCE(payments.total_paid, 0) > 0 THEN 'Partially Paid'
      ELSE 'Unpaid'
    END AS status
  FROM invoices i
  LEFT JOIN (
    SELECT
      reference_number AS transaction_ref,
      facility_id,
      SUM(
        CASE
          WHEN type = 'bank' THEN cr
          WHEN type = 'payment' THEN dr
          ELSE 0
        END
      ) AS total_paid
    FROM general_ledger
    WHERE type IN ('bank', 'payment')
      AND facility_id = :facilityId
      AND reference_number IS NOT NULL
      AND reference_number != ''
    GROUP BY reference_number, facility_id
  ) payments
    ON payments.transaction_ref = i.invoice_ref
    AND payments.facility_id = i.facility_id
  WHERE i.type = 'purchase'
    AND i.ref_number = :supplierNo
    AND i.facility_id = :facilityId
  ORDER BY i.transaction_date ASC, i.invoice_id ASC
`;

async function loadOutstandingPurchaseInvoices(supplierNo, facilityId) {
  const rows = await db.sequelize.query(OUTSTANDING_PURCHASE_INVOICES_SQL, {
    replacements: { supplierNo, facilityId },
    type: db.sequelize.QueryTypes.SELECT,
  });
  return rows.map((inv) => ({
    ...inv,
    amount_due: parseFloat(inv.amount_due || 0),
    amount: parseFloat(inv.amount || 0),
    total_paid: parseFloat(inv.total_paid || 0),
  }));
}

function buildFifoPurchaseAllocations(withDueRaw, amount_paid, allocation_order) {
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

function validateLinesAgainstOutstanding(invoiceLines, dueByRef) {
  for (const row of invoiceLines) {
    const ref = row.invoice_ref;
    const pay = parseFloat(row.amount_paid) || 0;
    if (pay <= 0) continue;
    const due = dueByRef.get(ref);
    if (due === undefined) {
      return { error: `Bill ${ref} is not outstanding for this supplier` };
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
 * GET /api/v1/get-outstanding-supplier-invoices?supplierNo=&facilityId=
 */
exports.getOutstandingSupplierPurchaseInvoices = async (req, res) => {
  try {
    const { supplierNo, facilityId } = req.query;
    if (!supplierNo || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "supplierNo and facilityId are required",
      });
    }
    const rows = await loadOutstandingPurchaseInvoices(supplierNo, facilityId);
    const outstanding = rows.filter((r) => r.amount_due > 0.000001);
    return res.json({
      success: true,
      results: outstanding.map((inv) => ({
        invoice_id: inv.invoice_id,
        invoice_ref: inv.invoice_ref,
        ref_number: inv.ref_number,
        transaction_date: inv.transaction_date,
        due_date: inv.due_date,
        amount: inv.amount,
        description: inv.description,
        total_paid: inv.total_paid,
        amount_due: inv.amount_due,
        balance_due: inv.amount_due,
        status: inv.status,
      })),
      count: outstanding.length,
    });
  } catch (error) {
    console.error("getOutstandingSupplierPurchaseInvoices:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * POST /api/v1/supplier-advance-payment
 * Body: amount_paid, supplier_number, facilityId, userId, payable_code, payable_accural_code,
 * mod_account_code (optional if accountHead/bankAccount sent), bank_account_id,
 * narration, mode_of_payment, transaction_date, cheque_number,
 * invoices[] optional, allocation_order optional.
 */
exports.createSupplierAdvancePayment = async (req, res) => {
  console.log(
    "[supplier-advance-payment] req.body",
    JSON.stringify(req.body, null, 2),
  );

  let {
    transaction_date,
    amount_paid,
    supplier_number,
    supplierNo,
    mode_of_payment,
    cheque_number,
    facilityId,
    facilityID,
    userId,
    narration,
    accountHead,
    bankAccount,
    payable_code,
    payable_accural_code,
    invoices: invoicesFromBody,
    allocation_order,
    mod_account_code,
    bank_account_id,
    line_of_business = "General",
  } = req.body;

  const facility = facilityId || facilityID;
  const supplierNoResolved = supplier_number || supplierNo;

  let invoices = Array.isArray(invoicesFromBody) ? invoicesFromBody : [];
  invoices = invoices.filter(
    (x) => x && parseFloat(x.amount_paid) > 0 && x.invoice_ref,
  );

  let allocationMeta = null;

  if (!supplierNoResolved) {
    return res.status(400).json({ error: "supplier_number is required" });
  }
  if (!amount_paid || isNaN(amount_paid) || parseFloat(amount_paid) <= 0) {
    return res.status(400).json({ error: "Valid amount_paid is required" });
  }
  if (!facility) {
    return res.status(400).json({ error: "facilityId is required" });
  }
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  const amountPaidNum = parseFloat(amount_paid);
  const transactionDate = transaction_date
    ? new Date(transaction_date)
    : new Date();
  const lineOfBusinessString = String(line_of_business);

  try {
    const supplier = await SuppliersInfo.findOne({
      where: { supplier_number: supplierNoResolved, facilityId: facility },
    });
    if (!supplier) {
      return res.status(404).json({ error: "Supplier not found" });
    }

    const supplierName = supplier.supplier_name || supplierNoResolved;

    let resolvedBankAccountId =
      bank_account_id ||
      bankAccount?.id ||
      (accountHead?.head ? accountHead.head : null);

    if (!resolvedBankAccountId) {
      return res.status(400).json({
        error: "bank_account_id or bankAccount.id / accountHead.head is required",
      });
    }

    let modCode = mod_account_code;
    if (!modCode && accountHead?.head) {
      modCode = accountHead.head;
    }
    if (!modCode && bankAccount?.id) {
      const bankRow = await db.bank_account.findOne({
        where: { id: bankAccount.id, facilityId: facility, status: "active" },
      });
      modCode = bankRow?.head;
    }
    if (!modCode) {
      return res.status(400).json({
        error: "Could not resolve payment account (mod_account_code / accountHead / bankAccount)",
      });
    }

    const bankAccountRow = await resolvePostingAccountHead(facility, modCode);
    if (!bankAccountRow) {
      return res.status(404).json({
        error: `Bank/Cash account not found for code: ${modCode} (add to Chart of Accounts or legacy account table)`,
      });
    }

    const payableCodeUse =
      payable_code || supplier.payable_code;
    const accrualCodeUse =
      payable_accural_code ||
      supplier.payable_accural_code ||
      supplier.payable_accrual_code;

    if (!payableCodeUse || !accrualCodeUse) {
      return res.status(400).json({
        error:
          "payable_code and payable_accural_code are required (or set on supplier record)",
      });
    }

    const payableAccount = await resolvePostingAccountHead(
      facility,
      payableCodeUse,
    );
    const accruedAccount = await resolvePostingAccountHead(
      facility,
      accrualCodeUse,
    );

    if (!payableAccount) {
      return res.status(404).json({
        error: `Payable account not found: ${payableCodeUse}`,
      });
    }
    if (!accruedAccount) {
      return res.status(404).json({
        error: `Payable accrual / advance account not found: ${accrualCodeUse}`,
      });
    }

    const outstandingRows = await loadOutstandingPurchaseInvoices(
      supplierNoResolved,
      facility,
    );
    const dueByRef = new Map(
      outstandingRows.map((r) => [r.invoice_ref, r.amount_due]),
    );

    if (invoices.length === 0) {
      const { invoices: fifoInv, allocation } = buildFifoPurchaseAllocations(
        outstandingRows,
        amountPaidNum,
        allocation_order,
      );
      invoices = fifoInv;
      allocationMeta = allocation;
    } else {
      const check = validateLinesAgainstOutstanding(invoices, dueByRef);
      if (check.error) {
        return res.status(400).json({ error: check.error });
      }
    }

    const sumAlloc = invoices.reduce(
      (s, x) => s + (parseFloat(x.amount_paid) || 0),
      0,
    );
    if (sumAlloc > amountPaidNum + 0.02) {
      return res.status(400).json({
        error:
          "Sum of bill allocations cannot exceed total amount paid",
      });
    }

    const totalOutstandingServer = outstandingRows.reduce(
      (s, r) => s + (parseFloat(r.amount_due) || 0),
      0,
    );
    if (totalOutstandingServer > 0.02 && invoices.length > 0) {
      const requiredOnBills = Math.min(amountPaidNum, totalOutstandingServer);
      if (sumAlloc + 0.02 < requiredOnBills) {
        return res.status(400).json({
          error: `Apply the full payment to outstanding bills (up to each balance due). At least ${requiredOnBills.toFixed(2)} required on bill lines; received ${sumAlloc.toFixed(2)}.`,
        });
      }
    }

    const remainderToAdvance = Math.max(0, amountPaidNum - sumAlloc);
    console.log("[supplier-advance-payment] resolved allocation", {
      amount_paid_total: amountPaidNum,
      invoice_lines: invoices,
      sum_applied_to_bills: sumAlloc,
      remainder_to_advance: remainderToAdvance,
      fifo_or_client_lines: allocationMeta ? "server_fifo" : "client_lines",
    });

    const previousBalance = await getSupplierLedgerBalance(
      supplierNoResolved,
      facility,
    );

    let seqNum = Date.now();
    try {
      seqNum = await getAndUpdateNumber("SAP", facility);
    } catch (e) {
      console.warn("supplierAdvancePayment numberGen:", e.message);
    }
    const referenceNumber = `SAP-${seqNum}`;

    const ledgerEntries = [];
    let amountAppliedToPayable = 0;
    let remainingAmount = amountPaidNum;

    const result = await db.sequelize.transaction(async (t) => {
      // Credit bank (money out) — total payment
      ledgerEntries.push({
        account_code: modCode,
        account_subhead: bankAccountRow.subhead || modCode.substring(0, 6),
        dr: 0,
        cr: amountPaidNum,
        account_description: bankAccountRow.description || "Bank",
        transaction_description: `${narration || "Supplier advance payment"} — ${supplierName}`,
        type: "bank",
        reference_number: referenceNumber,
        bank_account_id: resolvedBankAccountId,
      });

      if (invoices.length > 0) {
        for (const inv of invoices) {
          const { invoice_ref, amount_paid: amtApply } = inv;
          const applicationAmount = Math.min(
            parseFloat(amtApply) || 0,
            remainingAmount,
          );
          if (applicationAmount <= 0) continue;

          ledgerEntries.push({
            account_code: payableCodeUse,
            account_subhead:
              payableAccount.subhead || payableCodeUse.substring(0, 6),
            dr: applicationAmount,
            cr: 0,
            account_description: payableAccount.description || "Accounts Payable",
            transaction_description: `${narration || "Payment"} ${invoice_ref} — ${supplierName}`,
            type: "payment",
            reference_number: invoice_ref,
            bank_account_id: resolvedBankAccountId,
          });

          amountAppliedToPayable += applicationAmount;
          remainingAmount -= applicationAmount;
          if (remainingAmount <= 0) break;
        }
      } else {
        const applyGeneral = Math.min(
          remainingAmount,
          Math.max(0, previousBalance > 0 ? previousBalance : 0),
        );
        if (applyGeneral > 0) {
          ledgerEntries.push({
            account_code: payableCodeUse,
            account_subhead:
              payableAccount.subhead || payableCodeUse.substring(0, 6),
            dr: applyGeneral,
            cr: 0,
            account_description: payableAccount.description || "Accounts Payable",
            transaction_description: `${narration || "Supplier payment"} — ${supplierName}`,
            type: "payment",
            reference_number: referenceNumber,
            bank_account_id: resolvedBankAccountId,
          });
          amountAppliedToPayable += applyGeneral;
          remainingAmount -= applyGeneral;
        }
      }

      let advancePosted = 0;
      if (remainingAmount > 0) {
        advancePosted = remainingAmount;
        ledgerEntries.push({
          account_code: accrualCodeUse,
          account_subhead:
            accruedAccount.subhead || accrualCodeUse.substring(0, 6),
          dr: remainingAmount,
          cr: 0,
          account_description:
            accruedAccount.description || "Supplier advance / prepaid",
          transaction_description: `Supplier advance — ${supplierName}`,
          type: "accrued",
          reference_number: referenceNumber,
          bank_account_id: resolvedBankAccountId,
        });
      }

      // Do not insert into `invoices`: advance payments are recorded via general_ledger + supplier_entry only.

      for (const entry of ledgerEntries) {
        // Only payable-side entries belong to the supplier's ledger.
        // The bank/cash credit entry (type='bank') should NOT carry the
        // supplier ID as transaction_ref — it belongs to the cash/bank ledger only.
        const entryTransactionRef =
          entry.type === "bank" ? "" : supplierNoResolved;

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
            purpose_of_payment: narration || "Supplier advance payment",
            payee: supplierName,
            bank_account_id: entry.bank_account_id,
            cheque_no: cheque_number || null,
            mode_of_payment: mode_of_payment || "cash",
            created_by: userId,
            facility_id: facility,
            status: "paid",
            type: entry.type,
            transaction_ref: entryTransactionRef,
            created_at: new Date(),
            updated_at: new Date(),
          },
          { transaction: t },
        );
      }

      await SupplierEntry.create(
        {
          supplier_number: supplierNoResolved,
          description: narration || `Supplier advance payment — ${supplierName}`,
          qty_in: 1,
          qty_out: 0,
          cost: amountPaidNum,
          facilityId: facility,
          mode_of_payment: mode_of_payment || "cash",
          receiptNo: referenceNumber,
          type: "payment",
          line_of_business: lineOfBusinessString,
          created_by: userId,
          created_at: new Date(),
        },
        { transaction: t },
      );

      return {
        reference_number: referenceNumber,
        amount_paid: amountPaidNum,
        appliedToPayable: amountAppliedToPayable,
        advanceAmount: advancePosted,
        billsSettled: invoices.length,
      };
    });

    const payload = {
      success: true,
      data: result,
      message: "Supplier advance payment recorded successfully",
    };
    if (allocationMeta) payload.allocation = allocationMeta;

    return res.status(201).json(payload);
  } catch (error) {
    console.error("createSupplierAdvancePayment:", error);
    return res.status(500).json({
      error: "Failed to record supplier advance payment",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/** Payment history — all suppliers or filtered by supplierNo. */
exports.getSupplierAdvanceHistory = async (req, res) => {
  try {
    const { supplierNo, facilityId, limit = 100 } = req.query;
    if (!facilityId) return res.status(400).json({ success: false, message: "facilityId is required" });

    const rowLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
    const filterBySupplier = supplierNo && String(supplierNo).trim();

    const rows = await db.sequelize.query(
      `SELECT
         se.entry_id,
         se.supplier_number,
         COALESCE(si.supplier_name, se.supplier_number) AS supplier_name,
         se.description,
         se.cost              AS amount,
         se.transaction_date  AS date,
         se.created_at,
         se.type,
         se.mode_of_payment,
         se.receiptNo         AS receipt_no,
         se.link_id
       FROM supplier_entries se
       LEFT JOIN suppliersinfo si ON si.supplier_number = se.supplier_number AND si.facilityId = se.facilityId
       WHERE se.facilityId = :facilityId
         ${filterBySupplier ? "AND se.supplier_number = :supplierNo" : ""}
         AND (se.type = 'payment' OR se.type IS NULL OR se.type = '')
       ORDER BY se.created_at DESC
       LIMIT :rowLimit`,
      {
        replacements: { facilityId, ...(filterBySupplier ? { supplierNo: filterBySupplier } : {}), rowLimit },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );

    let availableAdvance = 0;
    if (filterBySupplier) {
      const balRows = await db.sequelize.query(
        `SELECT COALESCE(SUM(cr) - SUM(dr), 0) AS available_advance
         FROM general_ledger
         WHERE facility_id = :facilityId AND transaction_ref = :supplierNo
           AND LOWER(type) IN ('payable', 'advance')`,
        { replacements: { facilityId, supplierNo: filterBySupplier }, type: db.sequelize.QueryTypes.SELECT },
      );
      availableAdvance = Math.max(0, parseFloat(balRows[0]?.available_advance || 0));
    }

    return res.json({
      success: true,
      results: rows.map((r) => ({
        entry_id:        r.entry_id,
        supplier_no:     r.supplier_number || "",
        supplier_name:   r.supplier_name || r.supplier_number || "",
        date:            r.date || r.created_at,
        receipt_no:      r.receipt_no || "",
        description:     r.description || "",
        amount:          parseFloat(r.amount) || 0,
        mode_of_payment: r.mode_of_payment || "",
        type:            r.type || "",
      })),
      count:             rows.length,
      available_advance: availableAdvance,
    });
  } catch (error) {
    console.error("getSupplierAdvanceHistory:", error);
    return res.status(500).json({ success: false, message: "Error fetching supplier advance history" });
  }
};
