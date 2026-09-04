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
const {
  recordActivity,
  pickActor,
} = require("../services/activityAuditService");
const { parseAmount } = require("../utils/parseAmount");
const { validatePostingDate } = require("../utils/validatePostingDate");

/** Available supplier deposit/advance on prepaid (accrued) GL only. */
async function getAvailableSupplierAdvance(facilityId, supplierNo, transaction) {
  const balRows = await db.sequelize.query(
    `SELECT COALESCE(SUM(dr) - SUM(cr), 0) AS available_advance
     FROM general_ledger
     WHERE facility_id = :facilityId
       AND transaction_ref = :supplierNo
       AND LOWER(type) IN ('accrued', 'advance')`,
    {
      replacements: { facilityId, supplierNo },
      type: db.sequelize.QueryTypes.SELECT,
      ...(transaction ? { transaction } : {}),
    },
  );
  return Math.max(0, parseFloat(balRows[0]?.available_advance || 0));
}

/**
 * Resolve Goods in Transit CoA account for a facility.
 * Prefers description match, then known codes (112103 / 100022).
 */
async function resolveGoodsInTransitAccount(facilityId, transaction) {
  const opts = transaction ? { transaction } : {};
  const byDesc = await db.sequelize.query(
    `SELECT code, parent_code, description, category, type, account_nature
     FROM account_category
     WHERE facility_id = :facilityId
       AND is_active = 1
       AND category = 'assets'
       AND LOWER(TRIM(description)) IN (
         'goods in transit',
         'goods-in-transit',
         'goods in-transit'
       )
     ORDER BY code
     LIMIT 1`,
    {
      replacements: { facilityId },
      type: db.sequelize.QueryTypes.SELECT,
      ...opts,
    },
  );
  if (byDesc[0]) {
    return byDesc[0];
  }

  for (const code of ["112103", "100022"]) {
    const acc = await db.AccountCategory.findOne({
      where: { code, facility_id: facilityId },
      ...opts,
    });
    if (acc) return acc;
  }
  return null;
}

/**
 * Expense head for writing off GIT.
 * Prefers Goods in Transit Loss, then Inventory Write-off.
 */
async function resolveGitWriteOffExpenseAccount(
  facilityId,
  preferredCode,
  transaction,
) {
  const opts = transaction ? { transaction } : {};
  if (preferredCode) {
    const preferred = await db.AccountCategory.findOne({
      where: { code: String(preferredCode).trim(), facility_id: facilityId },
      ...opts,
    });
    if (preferred) return preferred;
  }

  const byDesc = await db.sequelize.query(
    `SELECT code, parent_code, description, category, type, account_nature
     FROM account_category
     WHERE facility_id = :facilityId
       AND is_active = 1
       AND category = 'expenses'
       AND LOWER(TRIM(description)) IN (
         'goods in transit loss',
         'goods-in-transit loss',
         'inventory write-off',
         'inventory write off'
       )
     ORDER BY
       CASE LOWER(TRIM(description))
         WHEN 'goods in transit loss' THEN 1
         WHEN 'goods-in-transit loss' THEN 2
         WHEN 'inventory write-off' THEN 3
         WHEN 'inventory write off' THEN 4
         ELSE 9
       END,
       code
     LIMIT 1`,
    {
      replacements: { facilityId },
      type: db.sequelize.QueryTypes.SELECT,
      ...opts,
    },
  );
  if (byDesc[0]) return byDesc[0];

  for (const code of ["800904", "800901"]) {
    const acc = await db.AccountCategory.findOne({
      where: { code, facility_id: facilityId },
      ...opts,
    });
    if (acc) return acc;
  }
  return null;
}

/** Available goods-in-transit pool (deposit reclassified as GIT CoA). */
async function getAvailableSupplierGoodsInTransit(
  facilityId,
  supplierNo,
  transaction,
  gitAccountCode,
) {
  let accountCode = gitAccountCode;
  if (!accountCode) {
    const gitAcc = await resolveGoodsInTransitAccount(facilityId, transaction);
    accountCode = gitAcc?.code || null;
  }

  const balRows = await db.sequelize.query(
    accountCode
      ? `SELECT COALESCE(SUM(dr) - SUM(cr), 0) AS available_git
         FROM general_ledger
         WHERE facility_id = :facilityId
           AND transaction_ref = :supplierNo
           AND account_code = :accountCode
           AND LOWER(type) IN ('goods_in_transit', 'git', 'inventory', 'prepayment')`
      : `SELECT COALESCE(SUM(dr) - SUM(cr), 0) AS available_git
         FROM general_ledger
         WHERE facility_id = :facilityId
           AND transaction_ref = :supplierNo
           AND LOWER(type) IN ('goods_in_transit', 'git')`,
    {
      replacements: {
        facilityId,
        supplierNo,
        ...(accountCode ? { accountCode } : {}),
      },
      type: db.sequelize.QueryTypes.SELECT,
      ...(transaction ? { transaction } : {}),
    },
  );
  return Math.max(0, parseFloat(balRows[0]?.available_git || 0));
}

async function getBillAmountDue(facilityId, invoiceRef, transaction) {
  const rows = await db.sequelize.query(
    `SELECT
       i.amount,
       COALESCE(payments.total_paid, 0) AS total_paid,
       GREATEST(i.amount - COALESCE(payments.total_paid, 0), 0) AS amount_due
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
         AND reference_number = :invoiceRef
       GROUP BY reference_number, facility_id
     ) payments
       ON payments.transaction_ref = i.invoice_ref
      AND payments.facility_id = i.facility_id
     WHERE i.invoice_ref = :invoiceRef
       AND i.facility_id = :facilityId
       AND i.type = 'purchase'
     LIMIT 1`,
    {
      replacements: { facilityId, invoiceRef },
      type: db.sequelize.QueryTypes.SELECT,
      ...(transaction ? { transaction } : {}),
    },
  );
  return rows[0] || null;
}

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
        mode_of_payment: inv.mode_of_payment || "credit",
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
    payment_splits: paymentSplitsFromBody,
  } = req.body;

  const facility = facilityId || facilityID;
  const supplierNoResolved = supplier_number || supplierNo;

  const paymentSplits = Array.isArray(paymentSplitsFromBody)
    ? paymentSplitsFromBody
        .map((s) => ({
          mode: String(s?.mode || "")
            .toLowerCase()
            .trim(),
          amount: parseFloat(s?.amount) || 0,
          accountHead: s?.accountHead || null,
          bankAccount: s?.bankAccount || null,
        }))
        .filter((s) => s.amount > 0)
    : [];
  const isSplitPayment =
    paymentSplits.length > 0 ||
    ["cash+transfer", "split", "cash_transfer"].includes(
      String(mode_of_payment || "")
        .toLowerCase()
        .trim(),
    );

  let invoices = Array.isArray(invoicesFromBody) ? invoicesFromBody : [];
  invoices = invoices.filter(
    (x) => x && parseFloat(x.amount_paid) > 0 && x.invoice_ref,
  );

  let allocationMeta = null;

  if (!supplierNoResolved) {
    return res.status(400).json({ error: "supplier_number is required" });
  }
  const amountPaidNum =
    isSplitPayment && paymentSplits.length > 0
      ? paymentSplits.reduce((s, x) => s + x.amount, 0)
      : parseFloat(amount_paid);
  if (!amountPaidNum || isNaN(amountPaidNum) || amountPaidNum <= 0) {
    return res.status(400).json({ error: "Valid amount_paid is required" });
  }
  if (isSplitPayment) {
    if (paymentSplits.length === 0) {
      return res.status(400).json({
        error: "payment_splits with amounts are required for Cash + Transfer",
      });
    }
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
          "Cash + Transfer requires both a cash and a transfer amount",
      });
    }
    if (
      amount_paid != null &&
      Math.abs(parseFloat(amount_paid) - amountPaidNum) > 0.02
    ) {
      return res.status(400).json({
        error: "payment_splits total must equal amount_paid",
      });
    }
    mode_of_payment = "cash+transfer";
  }
  if (!facility) {
    return res.status(400).json({ error: "facilityId is required" });
  }
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

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
    let modCode = mod_account_code;
    let bankAccountRow = null;
    let resolvedSplits = [];

    if (isSplitPayment) {
      for (const split of paymentSplits) {
        const isCash = split.mode === "cash";
        let headCode = null;
        let bankId = null;
        let accountDesc = "";
        if (isCash) {
          headCode = split.accountHead?.head || accountHead?.head;
          if (!headCode) {
            return res.status(400).json({
              error: "Cash account is required for the cash portion",
            });
          }
          bankId = headCode;
          accountDesc = split.accountHead?.description || "";
        } else {
          const bankIdRaw = split.bankAccount?.id || bankAccount?.id;
          if (!bankIdRaw) {
            return res.status(400).json({
              error: "Bank account is required for the transfer portion",
            });
          }
          const ba = await db.bank_account.findOne({
            where: { id: bankIdRaw, facilityId: facility, status: "active" },
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
        const acct = await resolvePostingAccountHead(facility, headCode);
        if (!acct) {
          return res.status(404).json({
            error: `Cash/Bank account not found for code: ${headCode}`,
          });
        }
        resolvedSplits.push({
          mode: isCash ? "cash" : "bank",
          amount: split.amount,
          account: acct,
          bankId,
          accountDesc,
          headCode,
        });
      }
      // Primary ids used on payable/advance legs (first split)
      resolvedBankAccountId = resolvedSplits[0]?.bankId || null;
      modCode = resolvedSplits[0]?.headCode || null;
      bankAccountRow = resolvedSplits[0]?.account || null;
    } else {
      if (!resolvedBankAccountId) {
        return res.status(400).json({
          error:
            "bank_account_id or bankAccount.id / accountHead.head is required",
        });
      }

      if (!modCode && accountHead?.head) {
        modCode = accountHead.head;
      }
      if (!modCode && bankAccount?.id) {
        const bankRow = await db.bank_account.findOne({
          where: {
            id: bankAccount.id,
            facilityId: facility,
            status: "active",
          },
        });
        modCode = bankRow?.head;
      }
      if (!modCode) {
        return res.status(400).json({
          error:
            "Could not resolve payment account (mod_account_code / accountHead / bankAccount)",
        });
      }

      bankAccountRow = await resolvePostingAccountHead(facility, modCode);
      if (!bankAccountRow) {
        return res.status(404).json({
          error: `Bank/Cash account not found for code: ${modCode} (add to Chart of Accounts or legacy account table)`,
        });
      }
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
      // Credit bank/cash (money out) — one leg per split, or single total
      if (resolvedSplits.length > 0) {
        for (const split of resolvedSplits) {
          ledgerEntries.push({
            account_code: split.headCode,
            account_subhead:
              split.account.subhead ||
              split.account.parent_code ||
              String(split.headCode).substring(0, 6),
            dr: 0,
            cr: split.amount,
            account_description:
              split.accountDesc || split.account.description || "Bank/Cash",
            transaction_description: `${narration || "Supplier advance payment"} (${split.mode}) — ${supplierName}`,
            type: "bank",
            reference_number: referenceNumber,
            bank_account_id: split.bankId,
            mode_of_payment: split.mode,
          });
        }
      } else {
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
          mode_of_payment: mode_of_payment || "cash",
        });
      }

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
            mode_of_payment: entry.mode_of_payment || mode_of_payment || "cash",
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

    await recordActivity({
      facilityId: facility,
      userId: pickActor(req) || userId,
      action: "create",
      entityType: "supplier_payment",
      entityId: result.reference_number,
      entityLabel: supplierName,
      after: result,
      remark: narration || "Supplier advance payment recorded",
      meta: {
        supplier_number: supplierNoResolved,
        bills: invoices.map((i) => i.invoice_ref),
      },
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
    let availableGit = 0;
    if (filterBySupplier) {
      availableAdvance = await getAvailableSupplierAdvance(
        facilityId,
        filterBySupplier,
      );
      availableGit = await getAvailableSupplierGoodsInTransit(
        facilityId,
        filterBySupplier,
      );
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
      available_deposit: availableAdvance,
      available_goods_in_transit: availableGit,
      available_git: availableGit,
    });
  } catch (error) {
    console.error("getSupplierAdvanceHistory:", error);
    return res.status(500).json({ success: false, message: "Error fetching supplier advance history" });
  }
};

/**
 * POST /api/v1/apply-supplier-advance
 * Apply existing supplier deposit/advance to one or more unpaid purchase bills.
 * body: {
 *   facilityId, userId, supplier_no,
 *   applications: [{ invoice_ref, amount }],
 *   transaction_date?, narration?
 * }
 */
exports.applySupplierAdvanceToBills = async (req, res) => {
  const {
    facilityId,
    userId,
    supplier_no,
    supplierNo,
    applications = [],
    narration = "",
    source = "deposit",
  } = req.body;

  const supplierNumber = String(supplier_no || supplierNo || "").trim();
  const actor = userId || pickActor(req);
  const applySource =
    String(source || "deposit").toLowerCase() === "goods_in_transit" ||
    String(source || "").toLowerCase() === "git"
      ? "goods_in_transit"
      : "deposit";
  const consumeType =
    applySource === "goods_in_transit" ? "goods_in_transit" : "accrued";
  const sourceLabel =
    applySource === "goods_in_transit" ? "goods in transit" : "deposit";

  if (!facilityId) {
    return res.status(400).json({ success: false, error: "facilityId is required" });
  }
  if (!actor) {
    return res.status(400).json({ success: false, error: "userId is required" });
  }
  if (!supplierNumber) {
    return res.status(400).json({ success: false, error: "supplier_no is required" });
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
    const supplier = await SuppliersInfo.findOne({
      where: { supplier_number: supplierNumber, facilityId },
    });
    if (!supplier) {
      return res.status(404).json({ success: false, error: "Supplier not found" });
    }

    const payableCode = supplier.payable_code;
    const accrualCode =
      supplier.payable_accural_code || supplier.payable_accrual_code;
    if (!payableCode || !accrualCode) {
      return res.status(400).json({
        success: false,
        error:
          "Supplier missing payable_code or payable_accural_code (advance account)",
      });
    }

    const [payableAccount, advanceAccount] = await Promise.all([
      db.AccountCategory.findOne({
        where: { code: payableCode, facility_id: facilityId },
      }),
      db.AccountCategory.findOne({
        where: { code: accrualCode, facility_id: facilityId },
      }),
    ]);
    if (!payableAccount) {
      return res.status(404).json({
        success: false,
        error: `Payable account not found: ${payableCode}`,
      });
    }
    if (!advanceAccount) {
      return res.status(404).json({
        success: false,
        error: `Advance account not found: ${accrualCode}`,
      });
    }

    let sourceAccount = advanceAccount;
    if (applySource === "goods_in_transit") {
      const gitAccount = await resolveGoodsInTransitAccount(facilityId);
      if (!gitAccount) {
        return res.status(404).json({
          success: false,
          error:
            "Goods in Transit account not found in Chart of Accounts. Please add it under Current Assets.",
        });
      }
      sourceAccount = gitAccount;
    }

    const availablePool =
      applySource === "goods_in_transit"
        ? await getAvailableSupplierGoodsInTransit(
            facilityId,
            supplierNumber,
            null,
            sourceAccount.code,
          )
        : await getAvailableSupplierAdvance(facilityId, supplierNumber);

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
    if (availablePool <= 0) {
      return res.status(400).json({
        success: false,
        error: `No available ${sourceLabel} for supplier ${supplierNumber}`,
        available_deposit:
          applySource === "deposit" ? 0 : undefined,
        available_goods_in_transit:
          applySource === "goods_in_transit" ? 0 : undefined,
      });
    }
    if (totalApply > availablePool + 0.01) {
      return res.status(400).json({
        success: false,
        error: `Apply total (${totalApply}) exceeds available ${sourceLabel} (${availablePool})`,
        available_deposit:
          applySource === "deposit" ? availablePool : undefined,
        available_goods_in_transit:
          applySource === "goods_in_transit" ? availablePool : undefined,
      });
    }

    const referenceNumber = `SAD-${await getAndUpdateNumber("SAD", facilityId)}`;
    const supplierName = supplier.supplier_name || supplierNumber;
    const descBase =
      String(narration || "").trim() ||
      `${sourceLabel === "deposit" ? "Deposit" : "Goods in transit"} applied to bills — ${supplierName}`;

    const applied = await db.sequelize.transaction(async (t) => {
      let remainingPool = availablePool;
      const settled = [];

      for (const { invoice_ref, amount } of cleaned) {
        const invoice = await db.Invoice.findOne({
          where: {
            invoice_ref,
            facility_id: facilityId,
            type: "purchase",
          },
          transaction: t,
        });
        if (!invoice) {
          throw Object.assign(new Error(`Bill ${invoice_ref} not found`), {
            status: 404,
          });
        }
        if (invoice.ref_number !== supplierNumber) {
          throw Object.assign(
            new Error(
              `Bill ${invoice_ref} does not belong to supplier ${supplierNumber}`,
            ),
            { status: 400 },
          );
        }

        const bill = await getBillAmountDue(facilityId, invoice_ref, t);
        const amountDue = parseFloat(bill?.amount_due || 0);
        if (amountDue <= 0.009) {
          throw Object.assign(
            new Error(`Bill ${invoice_ref} is already fully paid`),
            { status: 400 },
          );
        }

        const applyAmt = Math.min(amount, remainingPool, amountDue);
        if (applyAmt <= 0) break;

        // Dr Payable (settle bill)
        await GeneralLedger.create(
          {
            transaction_date: transactionDate,
            account_code: payableAccount.code,
            account_subhead: payableAccount.parent_code || 0,
            dr: applyAmt,
            cr: 0,
            account_description: payableAccount.description,
            transaction_description: `${descBase} — ${invoice_ref}`,
            reference_number: invoice_ref,
            purpose_of_payment: `Apply supplier ${sourceLabel} — ${invoice_ref}`,
            payee: supplierName,
            created_by: actor,
            facility_id: facilityId,
            status: "paid",
            type: "payment",
            transaction_ref: supplierNumber,
          },
          { transaction: t },
        );

        // Cr Advance / GIT CoA (consume source)
        await GeneralLedger.create(
          {
            transaction_date: transactionDate,
            account_code: sourceAccount.code,
            account_subhead: sourceAccount.parent_code || 0,
            dr: 0,
            cr: applyAmt,
            account_description: sourceAccount.description,
            transaction_description: `${descBase} — ${invoice_ref}`,
            reference_number: invoice_ref,
            purpose_of_payment: `Apply supplier ${sourceLabel} — ${invoice_ref}`,
            payee: supplierName,
            created_by: actor,
            facility_id: facilityId,
            status: "paid",
            type: consumeType,
            transaction_ref: supplierNumber,
          },
          { transaction: t },
        );

        await SupplierEntry.create(
          {
            supplier_number: supplierNumber,
            description: `${sourceLabel === "deposit" ? "Deposit" : "GIT"} applied - ${invoice_ref}`,
            qty_in: 0,
            qty_out: 1,
            cost: applyAmt,
            facilityId,
            mode_of_payment:
              applySource === "goods_in_transit" ? "GIT" : "ADVANCE",
            receiptNo: referenceNumber,
            cheque_no: invoice_ref,
            type: "payment",
            link_id: invoice_ref,
            created_by: actor,
            created_at: new Date(),
          },
          { transaction: t },
        );

        remainingPool -= applyAmt;
        settled.push({ invoice_ref, amount: applyAmt });
      }

      return settled;
    });

    const appliedTotal = applied.reduce((s, x) => s + x.amount, 0);

    await recordActivity({
      facilityId,
      userId: actor,
      action: "apply",
      entityType: "supplier_advance",
      entityId: referenceNumber,
      entityLabel: supplierName,
      after: {
        reference_number: referenceNumber,
        supplier_no: supplierNumber,
        source: applySource,
        applied_total: appliedTotal,
        applications: applied,
      },
      remark: descBase,
    });

    return res.status(201).json({
      success: true,
      message: `Applied ${sourceLabel} of ${appliedTotal.toLocaleString()} to ${applied.length} bill(s)`,
      data: {
        reference_number: referenceNumber,
        supplier_no: supplierNumber,
        source: applySource,
        applied_total: appliedTotal,
        available_before: availablePool,
        available_after: Math.max(0, availablePool - appliedTotal),
        applications: applied,
      },
    });
  } catch (error) {
    console.error("applySupplierAdvanceToBills:", error);
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      error:
        status === 500 ? "Failed to apply supplier deposit" : error.message,
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * POST /api/v1/move-supplier-deposit-to-git
 * Reclassify supplier deposit/advance into goods-in-transit pool.
 * body: { facilityId, userId, supplier_no, amount, transaction_date?, narration? }
 */
exports.moveSupplierDepositToGoodsInTransit = async (req, res) => {
  const {
    facilityId,
    userId,
    supplier_no,
    supplierNo,
    amount,
    narration = "",
  } = req.body;

  const supplierNumber = String(supplier_no || supplierNo || "").trim();
  const actor = userId || pickActor(req);
  const moveAmt = parseAmount(amount) ?? 0;

  if (!facilityId) {
    return res.status(400).json({ success: false, error: "facilityId is required" });
  }
  if (!actor) {
    return res.status(400).json({ success: false, error: "userId is required" });
  }
  if (!supplierNumber) {
    return res.status(400).json({ success: false, error: "supplier_no is required" });
  }
  if (moveAmt <= 0) {
    return res.status(400).json({ success: false, error: "amount must be greater than 0" });
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
    const supplier = await SuppliersInfo.findOne({
      where: { supplier_number: supplierNumber, facilityId },
    });
    if (!supplier) {
      return res.status(404).json({ success: false, error: "Supplier not found" });
    }

    const accrualCode =
      supplier.payable_accural_code || supplier.payable_accrual_code;
    if (!accrualCode) {
      return res.status(400).json({
        success: false,
        error: "Supplier missing payable_accural_code (advance account)",
      });
    }

    const advanceAccount = await db.AccountCategory.findOne({
      where: { code: accrualCode, facility_id: facilityId },
    });
    if (!advanceAccount) {
      return res.status(404).json({
        success: false,
        error: `Advance account not found: ${accrualCode}`,
      });
    }

    const gitAccount = await resolveGoodsInTransitAccount(facilityId);
    if (!gitAccount) {
      return res.status(404).json({
        success: false,
        error:
          "Goods in Transit account not found in Chart of Accounts. Please add it under Current Assets (e.g. 112103).",
      });
    }

    const availableDeposit = await getAvailableSupplierAdvance(
      facilityId,
      supplierNumber,
    );
    if (moveAmt > availableDeposit + 0.01) {
      return res.status(400).json({
        success: false,
        error: `Amount (${moveAmt}) exceeds available deposit (${availableDeposit})`,
        available_deposit: availableDeposit,
      });
    }

    const referenceNumber = `GIT-${await getAndUpdateNumber("GIT", facilityId)}`;
    const supplierName = supplier.supplier_name || supplierNumber;
    const desc =
      String(narration || "").trim() ||
      `Move deposit to goods in transit — ${supplierName}`;

    await db.sequelize.transaction(async (t) => {
      // Reduce deposit pool (Cr advance / deposit CoA)
      await GeneralLedger.create(
        {
          transaction_date: transactionDate,
          account_code: advanceAccount.code,
          account_subhead: advanceAccount.parent_code || 0,
          dr: 0,
          cr: moveAmt,
          account_description: advanceAccount.description,
          transaction_description: desc,
          reference_number: referenceNumber,
          purpose_of_payment: "Move supplier deposit to goods in transit",
          payee: supplierName,
          created_by: actor,
          facility_id: facilityId,
          status: "posted",
          type: "accrued",
          transaction_ref: supplierNumber,
        },
        { transaction: t },
      );

      // Increase GIT pool (Dr Goods in Transit CoA)
      await GeneralLedger.create(
        {
          transaction_date: transactionDate,
          account_code: gitAccount.code,
          account_subhead: gitAccount.parent_code || 0,
          dr: moveAmt,
          cr: 0,
          account_description: gitAccount.description,
          transaction_description: desc,
          reference_number: referenceNumber,
          purpose_of_payment: "Move supplier deposit to goods in transit",
          payee: supplierName,
          created_by: actor,
          facility_id: facilityId,
          status: "posted",
          type: "goods_in_transit",
          transaction_ref: supplierNumber,
        },
        { transaction: t },
      );

      await SupplierEntry.create(
        {
          supplier_number: supplierNumber,
          description: `Deposit -> Goods in transit (${formatAmount(moveAmt)})`,
          qty_in: 0,
          qty_out: 0,
          cost: moveAmt,
          facilityId,
          mode_of_payment: "GIT",
          receiptNo: referenceNumber,
          type: "payment",
          link_id: referenceNumber,
          created_by: actor,
          created_at: new Date(),
        },
        { transaction: t },
      );
    });

    const [depositAfter, gitAfter] = await Promise.all([
      getAvailableSupplierAdvance(facilityId, supplierNumber),
      getAvailableSupplierGoodsInTransit(
        facilityId,
        supplierNumber,
        null,
        gitAccount.code,
      ),
    ]);

    await recordActivity({
      facilityId,
      userId: actor,
      action: "move",
      entityType: "supplier_advance",
      entityId: referenceNumber,
      entityLabel: supplierName,
      after: {
        reference_number: referenceNumber,
        supplier_no: supplierNumber,
        amount: moveAmt,
        available_deposit: depositAfter,
        available_goods_in_transit: gitAfter,
      },
      remark: desc,
    });

    return res.status(201).json({
      success: true,
      message: `Moved ${moveAmt.toLocaleString()} from deposit to goods in transit`,
      data: {
        reference_number: referenceNumber,
        supplier_no: supplierNumber,
        amount: moveAmt,
        available_deposit: depositAfter,
        available_goods_in_transit: gitAfter,
      },
    });
  } catch (error) {
    console.error("moveSupplierDepositToGoodsInTransit:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to move deposit to goods in transit",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Write off goods-in-transit (lost/damaged/never received).
 * Dr expense (Goods in Transit Loss / Inventory Write-off) | Cr GIT CoA.
 * POST /api/v1/write-off-supplier-git
 */
exports.writeOffSupplierGoodsInTransit = async (req, res) => {
  const {
    facilityId,
    userId,
    supplier_no,
    supplierNo,
    amount,
    narration = "",
    expense_code,
    expenseCode,
    write_off_account,
  } = req.body;

  const supplierNumber = String(supplier_no || supplierNo || "").trim();
  const actor = userId || pickActor(req);
  const writeAmt = parseAmount(amount) ?? 0;
  const preferredExpense =
    expense_code || expenseCode || write_off_account || null;

  if (!facilityId) {
    return res.status(400).json({ success: false, error: "facilityId is required" });
  }
  if (!actor) {
    return res.status(400).json({ success: false, error: "userId is required" });
  }
  if (!supplierNumber) {
    return res.status(400).json({ success: false, error: "supplier_no is required" });
  }
  if (writeAmt <= 0) {
    return res.status(400).json({ success: false, error: "amount must be greater than 0" });
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
    const supplier = await SuppliersInfo.findOne({
      where: { supplier_number: supplierNumber, facilityId },
    });
    if (!supplier) {
      return res.status(404).json({ success: false, error: "Supplier not found" });
    }

    const gitAccount = await resolveGoodsInTransitAccount(facilityId);
    if (!gitAccount) {
      return res.status(404).json({
        success: false,
        error:
          "Goods in Transit account not found in Chart of Accounts. Please add it under Current Assets.",
      });
    }

    const expenseAccount = await resolveGitWriteOffExpenseAccount(
      facilityId,
      preferredExpense,
    );
    if (!expenseAccount) {
      return res.status(404).json({
        success: false,
        error:
          "Write-off expense account not found. Add Goods in Transit Loss (800904) or Inventory Write-off (800901).",
      });
    }

    const availableGit = await getAvailableSupplierGoodsInTransit(
      facilityId,
      supplierNumber,
      null,
      gitAccount.code,
    );
    if (writeAmt > availableGit + 0.01) {
      return res.status(400).json({
        success: false,
        error: `Amount (${writeAmt}) exceeds available goods in transit (${availableGit})`,
        available_goods_in_transit: availableGit,
      });
    }

    const referenceNumber = `GWO-${await getAndUpdateNumber("GWO", facilityId)}`;
    const supplierName = supplier.supplier_name || supplierNumber;
    const desc =
      String(narration || "").trim() ||
      `Write-off goods in transit — ${supplierName}`;

    await db.sequelize.transaction(async (t) => {
      // Dr expense / loss
      await GeneralLedger.create(
        {
          transaction_date: transactionDate,
          account_code: expenseAccount.code,
          account_subhead: expenseAccount.parent_code || 0,
          dr: writeAmt,
          cr: 0,
          account_description: expenseAccount.description,
          transaction_description: desc,
          reference_number: referenceNumber,
          purpose_of_payment: "Write-off supplier goods in transit",
          payee: supplierName,
          created_by: actor,
          facility_id: facilityId,
          status: "posted",
          type: "expenses",
          transaction_ref: supplierNumber,
        },
        { transaction: t },
      );

      // Cr GIT CoA (clear asset)
      await GeneralLedger.create(
        {
          transaction_date: transactionDate,
          account_code: gitAccount.code,
          account_subhead: gitAccount.parent_code || 0,
          dr: 0,
          cr: writeAmt,
          account_description: gitAccount.description,
          transaction_description: desc,
          reference_number: referenceNumber,
          purpose_of_payment: "Write-off supplier goods in transit",
          payee: supplierName,
          created_by: actor,
          facility_id: facilityId,
          status: "posted",
          type: "goods_in_transit",
          transaction_ref: supplierNumber,
        },
        { transaction: t },
      );

      await SupplierEntry.create(
        {
          supplier_number: supplierNumber,
          description: `GIT write-off (${formatAmount(writeAmt)}) - ${expenseAccount.description}`,
          qty_in: 0,
          qty_out: 1,
          cost: writeAmt,
          facilityId,
          mode_of_payment: "WRITE_OFF",
          receiptNo: referenceNumber,
          type: "payment",
          link_id: referenceNumber,
          created_by: actor,
          created_at: new Date(),
        },
        { transaction: t },
      );
    });

    const gitAfter = await getAvailableSupplierGoodsInTransit(
      facilityId,
      supplierNumber,
      null,
      gitAccount.code,
    );

    await recordActivity({
      facilityId,
      userId: actor,
      action: "write_off",
      entityType: "supplier_advance",
      entityId: referenceNumber,
      entityLabel: supplierName,
      after: {
        reference_number: referenceNumber,
        supplier_no: supplierNumber,
        amount: writeAmt,
        expense_code: expenseAccount.code,
        git_account: gitAccount.code,
        available_goods_in_transit: gitAfter,
      },
      remark: desc,
    });

    return res.status(201).json({
      success: true,
      message: `Wrote off ${writeAmt.toLocaleString()} goods in transit`,
      data: {
        reference_number: referenceNumber,
        supplier_no: supplierNumber,
        amount: writeAmt,
        expense_code: expenseAccount.code,
        expense_description: expenseAccount.description,
        git_account: gitAccount.code,
        available_goods_in_transit: gitAfter,
      },
    });
  } catch (error) {
    console.error("writeOffSupplierGoodsInTransit:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to write off goods in transit",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

function formatAmount(n) {
  return Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
