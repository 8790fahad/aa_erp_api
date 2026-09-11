const db = require("../models");
const {
  money,
  classifyCollectionMode,
  loadTillSpend,
} = require("../utils/tillCollections");
const { getAndUpdateNumber } = require("../services/numberGen");

const COLLECTION_ENTRY_FILTER = `
  (
    ce.description LIKE 'Sale payment%'
    OR ce.link_id LIKE 'INV-%'
    OR ce.receiptNo LIKE 'INV-%'
    OR ce.receiptNo LIKE 'AD-%'
    OR ce.description LIKE '%advance%'
    OR ce.description LIKE '%Advance%'
    OR ce.description LIKE '%Collection Points advance%'
    OR ce.description LIKE '%Verification Points advance%'
  )
`;

function classifyMode(mode) {
  return classifyCollectionMode(mode);
}

function normalizeBranchId(branchId) {
  if (branchId == null || branchId === "" || branchId === "all") return 0;
  const bid = parseInt(branchId, 10);
  return Number.isFinite(bid) && bid > 0 ? bid : 0;
}

function branchClause(branchIdKey = "branchId") {
  return `AND (:${branchIdKey} = 0 OR ce.branch_id = :${branchIdKey})`;
}

function displayName(user) {
  if (!user) return null;
  return (
    [user.firstname, user.lastname].filter(Boolean).join(" ").trim() ||
    user.username ||
    user.name ||
    null
  );
}

async function resolveUserNames(userIds) {
  const ids = [...new Set((userIds || []).map((id) => String(id).trim()).filter(Boolean))];
  const map = {};
  if (!ids.length || !db.users) return map;
  try {
    const users = await db.users.findAll({
      where: { id: ids },
      attributes: ["id", "firstname", "lastname", "username"],
    });
    users.forEach((u) => {
      map[String(u.id)] = displayName(u) || String(u.id);
    });
  } catch (_) {
    /* ignore */
  }
  return map;
}

/**
 * All business members whose role is Cashier / Cashier 1 / Cashier 2, etc.
 */
async function loadCashierRoleUsers(facilityId) {
  if (!facilityId) return [];
  try {
    const rows = await db.sequelize.query(
      `SELECT
         m.user_id,
         m.role,
         u.firstname,
         u.lastname,
         u.username,
         u.status
       FROM membership m
       LEFT JOIN users u ON CAST(u.id AS CHAR) = CAST(m.user_id AS CHAR)
       WHERE m.business_id = :facilityId
         AND LOWER(COALESCE(m.role, '')) LIKE '%cashier%'
         AND (
           u.id IS NULL
           OR LOWER(COALESCE(u.status, '')) NOT IN ('deleted', 'suspended', 'inactive')
         )
       ORDER BY COALESCE(u.firstname, u.username, m.user_id), COALESCE(u.lastname, '')`,
      {
        replacements: { facilityId: String(facilityId) },
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );

    const seen = new Set();
    const list = [];
    for (const row of rows || []) {
      const id = String(row.user_id || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      list.push({
        cashier_user_id: id,
        cashier_name:
          displayName(row) || String(row.username || id),
        role: row.role || "Cashier",
      });
    }
    return list;
  } catch (err) {
    console.error("loadCashierRoleUsers error:", err.message);
    return [];
  }
}

async function loadExpectedByCashier(facilityId, reconDate, branchId) {
  const replacements = {
    facilityId,
    reconDate,
    branchId: normalizeBranchId(branchId),
  };

  const rows = await db.sequelize.query(
    `SELECT
       ce.created_by AS cashier_user_id,
       LOWER(TRIM(ce.mode_of_payment)) AS mode_of_payment,
       SUM(ce.cost) AS total
     FROM customer_entries ce
     WHERE ce.facilityId = :facilityId
       AND ce.type = 'deposit'
       AND ce.cost > 0
       AND DATE(ce.created_at) = :reconDate
       AND ${COLLECTION_ENTRY_FILTER.replace(/\n/g, " ")}
       ${branchClause()}
     GROUP BY ce.created_by, LOWER(TRIM(ce.mode_of_payment))`,
    {
      replacements,
      type: db.Sequelize.QueryTypes.SELECT,
    },
  );

  const byCashier = {};
  for (const row of rows || []) {
    const cashierId = String(row.cashier_user_id || "").trim();
    if (!cashierId) continue;
    if (!byCashier[cashierId]) {
      byCashier[cashierId] = {
        cashier_user_id: cashierId,
        expected_cash: 0,
        expected_card: 0,
        expected_transfer: 0,
      };
    }
    const side = classifyMode(row.mode_of_payment);
    const total = money(row.total);
    if (side === "cash") byCashier[cashierId].expected_cash += total;
    else if (side === "card") byCashier[cashierId].expected_card += total;
    else if (side === "transfer") byCashier[cashierId].expected_transfer += total;
  }

  Object.values(byCashier).forEach((c) => {
    c.expected_cash = money(c.expected_cash);
    c.expected_card = money(c.expected_card);
    c.expected_transfer = money(c.expected_transfer);
    c.expected_total = money(
      c.expected_cash + c.expected_card + c.expected_transfer,
    );
  });

  return byCashier;
}

async function expectedAfterExpenses(facilityId, reconDate, branchId) {
  const expectedMap = await loadExpectedByCashier(
    facilityId,
    reconDate,
    branchId,
  );
  const tillSpend = await loadTillSpend({
    facilityId,
    fromDate: reconDate,
    toDate: reconDate,
  });
  const expensesByCashier = {};
  for (const line of tillSpend.lines || []) {
    const id = String(line.user_id || "").trim();
    if (!id) continue;
    if (!expensesByCashier[id]) {
      expensesByCashier[id] = { cash: 0, card: 0, transfer: 0 };
    }
    if (line.till_mode === "cash") expensesByCashier[id].cash += line.amount;
    else if (line.till_mode === "card") expensesByCashier[id].card += line.amount;
    else if (line.till_mode === "transfer") {
      expensesByCashier[id].transfer += line.amount;
    }
  }
  const apply = (id, e) => {
    if (!expectedMap[id]) {
      expectedMap[id] = {
        cashier_user_id: id,
        expected_cash: 0,
        expected_card: 0,
        expected_transfer: 0,
        expected_total: 0,
      };
    }
    expectedMap[id].expenses_cash = money(e.cash);
    expectedMap[id].expenses_card = money(e.card);
    expectedMap[id].expenses_transfer = money(e.transfer);
    expectedMap[id].collected_cash = money(expectedMap[id].expected_cash);
    expectedMap[id].collected_card = money(expectedMap[id].expected_card);
    expectedMap[id].collected_transfer = money(
      expectedMap[id].expected_transfer,
    );
    expectedMap[id].expected_cash = money(
      Math.max(0, expectedMap[id].expected_cash - e.cash),
    );
    expectedMap[id].expected_card = money(
      Math.max(0, expectedMap[id].expected_card - e.card),
    );
    expectedMap[id].expected_transfer = money(
      Math.max(0, expectedMap[id].expected_transfer - e.transfer),
    );
    expectedMap[id].expected_total = money(
      expectedMap[id].expected_cash +
        expectedMap[id].expected_card +
        expectedMap[id].expected_transfer,
    );
  };
  Object.keys(expensesByCashier).forEach((id) =>
    apply(id, expensesByCashier[id]),
  );
  Object.values(expectedMap).forEach((c) => {
    if (c.expenses_cash == null) {
      c.expenses_cash = 0;
      c.expenses_card = 0;
      c.expenses_transfer = 0;
      c.collected_cash = money(c.expected_cash);
      c.collected_card = money(c.expected_card);
      c.collected_transfer = money(c.expected_transfer);
    }
  });
  return { expectedMap };
}

async function loadCreditAndDepositByCashier(facilityId, reconDate, branchId) {
  const bid = normalizeBranchId(branchId);
  const byCashier = {};
  const ensure = (id) => {
    const key = String(id || "").trim();
    if (!key) return null;
    if (!byCashier[key]) {
      byCashier[key] = { credit: 0, deposit: 0 };
    }
    return byCashier[key];
  };

  try {
    const creditRows = await db.sequelize.query(
      `SELECT
         COALESCE(
           NULLIF(sw.assigned_cashier_id, ''),
           NULLIF(sw.created_by, ''),
           sw.updated_by
         ) AS cashier_user_id,
         SUM(sw.amount) AS total
       FROM sale_workflows sw
       WHERE sw.facility_id = :facilityId
         AND LOWER(IFNULL(sw.payment_type, '')) IN ('credit', 'credit_split')
         AND LOWER(IFNULL(sw.status, '')) IN (
           'awaiting_credit_approval',
           'credit_approved',
           'invoice_separation',
           'final_invoice',
           'warehouse_picking',
           'dual_signature',
           'goods_released',
           'completed'
         )
         AND sw.amount > 0
         AND DATE(sw.created_at) = :reconDate
         AND (:branchId = 0 OR sw.branch_id = :branchId)
       GROUP BY COALESCE(
         NULLIF(sw.assigned_cashier_id, ''),
         NULLIF(sw.created_by, ''),
         sw.updated_by
       )`,
      {
        replacements: { facilityId, reconDate, branchId: bid },
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );
    for (const row of creditRows || []) {
      const bucket = ensure(row.cashier_user_id);
      if (bucket) bucket.credit += money(row.total);
    }
  } catch (err) {
    console.warn("loadCreditAndDepositByCashier credit:", err.message);
  }

  try {
    const depositRows = await db.sequelize.query(
      `SELECT
         ce.created_by AS cashier_user_id,
         SUM(ce.cost) AS total
       FROM customer_entries ce
       WHERE ce.facilityId = :facilityId
         AND ce.type = 'deposit'
         AND ce.cost > 0
         AND DATE(ce.created_at) = :reconDate
         AND (
           ce.description LIKE 'Advance applied%'
           OR ce.description LIKE 'Deposit applied%'
           OR LOWER(IFNULL(ce.mode_of_payment, '')) IN (
             'advance',
             'apply_deposit',
             'apply deposit'
           )
         )
         ${branchClause()}
       GROUP BY ce.created_by`,
      {
        replacements: { facilityId, reconDate, branchId: bid },
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );
    for (const row of depositRows || []) {
      const bucket = ensure(row.cashier_user_id);
      if (bucket) bucket.deposit += money(row.total);
    }
  } catch (err) {
    console.warn("loadCreditAndDepositByCashier deposit:", err.message);
  }

  Object.values(byCashier).forEach((c) => {
    c.credit = money(c.credit);
    c.deposit = money(c.deposit);
  });
  return byCashier;
}

let cardColumnsReady = false;
async function ensureCardColumns() {
  if (cardColumnsReady) return;
  try {
    const cols = await db.sequelize.query(
      `SELECT COLUMN_NAME AS name
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'collection_reconciliations'
         AND COLUMN_NAME IN ('expected_card', 'received_card', 'variance_card')`,
      { type: db.Sequelize.QueryTypes.SELECT },
    );
    const have = new Set((cols || []).map((c) => String(c.name || c.COLUMN_NAME)));
    const adds = [];
    if (!have.has("expected_card")) {
      adds.push("ADD COLUMN expected_card DECIMAL(18,2) NOT NULL DEFAULT 0");
    }
    if (!have.has("received_card")) {
      adds.push("ADD COLUMN received_card DECIMAL(18,2) NOT NULL DEFAULT 0");
    }
    if (!have.has("variance_card")) {
      adds.push("ADD COLUMN variance_card DECIMAL(18,2) NOT NULL DEFAULT 0");
    }
    if (adds.length) {
      await db.sequelize.query(
        `ALTER TABLE collection_reconciliations ${adds.join(", ")}`,
      );
    }
    cardColumnsReady = true;
  } catch (err) {
    console.warn("ensureCardColumns:", err.message);
  }
}

const CASH_SAFE_COLUMNS = [
  ["cash_from_account", "VARCHAR(50) NULL"],
  ["cash_from_account_name", "VARCHAR(200) NULL"],
  ["safe_account", "VARCHAR(50) NULL"],
  ["safe_account_name", "VARCHAR(200) NULL"],
  ["cash_to_safe_amount", "DECIMAL(18,2) NOT NULL DEFAULT 0"],
  ["shortage_account", "VARCHAR(50) NULL"],
  ["shortage_account_name", "VARCHAR(200) NULL"],
  ["shortage_amount", "DECIMAL(18,2) NOT NULL DEFAULT 0"],
  ["cash_transfer_id", "VARCHAR(50) NULL"],
];

let cashSafeColumnsReady = false;
async function ensureCashSafeColumns() {
  if (cashSafeColumnsReady) return;
  try {
    const cols = await db.sequelize.query(
      `SELECT COLUMN_NAME AS name
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'collection_reconciliations'
         AND COLUMN_NAME IN (${CASH_SAFE_COLUMNS.map(([n]) => `'${n}'`).join(", ")})`,
      { type: db.Sequelize.QueryTypes.SELECT },
    );
    const have = new Set((cols || []).map((c) => String(c.name || c.COLUMN_NAME)));
    const adds = CASH_SAFE_COLUMNS.filter(([n]) => !have.has(n)).map(
      ([n, def]) => `ADD COLUMN ${n} ${def}`,
    );
    if (adds.length) {
      await db.sequelize.query(
        `ALTER TABLE collection_reconciliations ${adds.join(", ")}`,
      );
    }
    cashSafeColumnsReady = true;
  } catch (err) {
    console.warn("ensureCashSafeColumns:", err.message);
  }
}

const LEDGER_TYPES = new Set([
  "expenses",
  "bank",
  "payable",
  "prepayment",
  "accrued",
  "unmatched",
  "tax",
  "deposit",
  "discount",
  "inventory",
  "receivable",
  "revenue",
  "opening_balance",
  "payment",
]);

function ledgerTypeForAccount(account, fallback = "payment") {
  const candidates = [
    account?.type_mnemonic,
    account?.type_details,
    account?.account_type,
    account?.type,
    account?.category,
    fallback,
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate || "")
      .trim()
      .toLowerCase();
    if (normalized === "assets" || normalized === "asset") return "payment";
    if (normalized === "expenses" || normalized === "expense") return "expenses";
    if (normalized && LEDGER_TYPES.has(normalized)) return normalized;
  }
  return fallback;
}

function accountLabel(account, code) {
  return String(account?.description || account?.head || code || "").trim();
}

function clip(value, max) {
  const s = String(value || "").trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

async function findAccountByCode(facilityId, code, transaction) {
  const raw = String(code || "").trim();
  if (!raw || !db.AccountCategory) return null;
  const opts = transaction ? { transaction } : {};
  return db.AccountCategory.findOne({
    where: { code: raw, facilityId: String(facilityId) },
    ...opts,
  });
}

async function nextCashSafeRef(facilityId, transaction) {
  const n = await getAndUpdateNumber("cash_to_safe", facilityId, transaction);
  return `CS-${n}`;
}

function buildLedgerRow({
  account,
  facilityId,
  reconDate,
  transferId,
  createdBy,
  cashierName,
  debit,
  credit,
  description,
  purpose,
}) {
  const typeFallback = Number(debit) > 0 && Number(credit) === 0
    ? "expenses"
    : "payment";
  return {
    transaction_date: reconDate,
    account_code: account.code,
    account_subhead: String(account.parentCode || account.parent_code || 0),
    dr: money(debit),
    cr: money(credit),
    account_description: clip(accountLabel(account, account.code), 300),
    transaction_description: clip(description, 500),
    reference_number: transferId,
    purpose_of_payment: clip(purpose, 150) || "Cash to Safe",
    payee: clip(cashierName, 50),
    bank_account_id: null,
    cheque_no: null,
    mode_of_payment: "cash",
    created_by: createdBy ? String(createdBy) : null,
    facility_id: String(facilityId),
    status: "paid",
    type: ledgerTypeForAccount(
      account,
      Number(debit) > 0 && String(account?.category || "").toLowerCase().includes("expens")
        ? "expenses"
        : typeFallback,
    ),
    transaction_ref: transferId,
  };
}

/**
 * Move received cash from till (cash) to Safe.
 * Shortage posts as its own balanced pair to the selected head:
 *   Dr shortage head / Cr till cash
 * Overage: debit Safe extra; credit variance account.
 */
async function postCashToSafeJournal({
  transaction,
  facilityId,
  reconDate,
  cashierName,
  confirmedBy,
  cashFrom,
  safeAcc,
  varianceAcc,
  receivedCash,
  expectedCash,
  shortageAmount,
  note,
  transferId,
}) {
  const GeneralLedger = db.GeneralLedger;
  if (!GeneralLedger) {
    throw new Error("GeneralLedger model not loaded");
  }
  const toSafe = money(receivedCash);
  const expected = money(expectedCash);
  const shortage =
    shortageAmount != null && shortageAmount !== ""
      ? money(shortageAmount)
      : money(expected - toSafe);
  const overage = money(toSafe - expected);
  const purpose = clip(note || `Cash to Safe — ${cashierName}`, 150);
  const rows = [];

  if (toSafe > 0.05) {
    if (!safeAcc) throw new Error("Select a Safe account");
    if (!cashFrom) throw new Error("Select a cash account");
    const cashCredit = overage > 0.05 ? expected : toSafe;
    rows.push(
      buildLedgerRow({
        account: safeAcc,
        facilityId,
        reconDate,
        transferId,
        createdBy: confirmedBy,
        cashierName,
        debit: toSafe,
        credit: 0,
        description: `Cash to Safe from till — ${cashierName}`,
        purpose,
      }),
    );
    if (cashCredit > 0.05) {
      rows.push(
        buildLedgerRow({
          account: cashFrom,
          facilityId,
          reconDate,
          transferId,
          createdBy: confirmedBy,
          cashierName,
          debit: 0,
          credit: cashCredit,
          description: `Cash to Safe — ${cashierName}`,
          purpose,
        }),
      );
    }
  }

  if (shortage > 0.05) {
    if (!varianceAcc) throw new Error("Select a shortage account");
    if (!cashFrom) throw new Error("Select a cash account");
    rows.push(
      buildLedgerRow({
        account: varianceAcc,
        facilityId,
        reconDate,
        transferId,
        createdBy: confirmedBy,
        cashierName,
        debit: shortage,
        credit: 0,
        description: `Cash shortage — ${cashierName}`,
        purpose: clip(note || `Cash shortage — ${cashierName}`, 150),
      }),
    );
    rows.push(
      buildLedgerRow({
        account: cashFrom,
        facilityId,
        reconDate,
        transferId,
        createdBy: confirmedBy,
        cashierName,
        debit: 0,
        credit: shortage,
        description: `Cash shortage from till — ${cashierName}`,
        purpose: clip(note || `Cash shortage — ${cashierName}`, 150),
      }),
    );
  }

  if (overage > 0.05) {
    if (!varianceAcc) throw new Error("Select an overage account");
    rows.push(
      buildLedgerRow({
        account: varianceAcc,
        facilityId,
        reconDate,
        transferId,
        createdBy: confirmedBy,
        cashierName,
        debit: 0,
        credit: overage,
        description: `Cash overage — ${cashierName}`,
        purpose,
      }),
    );
  }

  if (!rows.length) return;
  const totalDr = rows.reduce((s, r) => s + money(r.dr), 0);
  const totalCr = rows.reduce((s, r) => s + money(r.cr), 0);
  if (Math.abs(totalDr - totalCr) > 0.05) {
    throw new Error(
      `Unbalanced cash-to-safe journal: Dr ${totalDr} Cr ${totalCr}`,
    );
  }
  for (const row of rows) {
    await GeneralLedger.create(row, { transaction });
  }
}

/**
 * GET /api/v1/collection-reconciliation
 * Per-cashier expected collections for a date + saved confirmations.
 */
exports.getSummary = async (req, res) => {
  try {
    const facilityId = req.query.facilityId || req.query.facility_id;
    const reconDate = String(req.query.date || "").trim();
    const branchId = normalizeBranchId(req.query.branchId || req.query.branch_id);

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reconDate)) {
      return res.status(400).json({
        success: false,
        message: "date is required (YYYY-MM-DD)",
      });
    }
    if (!db.CollectionReconciliation) {
      return res.status(500).json({
        success: false,
        message: "CollectionReconciliation model not loaded — run migrations",
      });
    }

    await ensureCardColumns();
    await ensureCashSafeColumns();
    const { expectedMap } = await expectedAfterExpenses(
      facilityId,
      reconDate,
      branchId,
    );
    const creditDepositMap = await loadCreditAndDepositByCashier(
      facilityId,
      reconDate,
      branchId,
    );
    const saved = await db.CollectionReconciliation.findAll({
      where: {
        facility_id: String(facilityId),
        recon_date: reconDate,
        branch_id: branchId,
      },
    });
    const savedByCashier = {};
    saved.forEach((row) => {
      savedByCashier[String(row.cashier_user_id)] = row.toJSON();
    });

    const cashierRoleUsers = await loadCashierRoleUsers(facilityId);
    const cashierRoleIds = new Set(
      cashierRoleUsers.map((c) => String(c.cashier_user_id)),
    );
    const cashierRoleNameMap = {};
    cashierRoleUsers.forEach((c) => {
      cashierRoleNameMap[String(c.cashier_user_id)] = c.cashier_name;
    });

    // Only cashiers who collected, spent from till, or already have a
    // confirmation for this date — not every Cashier-role user.
    const cashierIds = new Set([
      ...Object.keys(expectedMap),
      ...Object.keys(savedByCashier),
      ...Object.keys(creditDepositMap),
    ]);
    const nameMap = await resolveUserNames([...cashierIds]);

    const cashiers = [...cashierIds]
      .map((id) => {
        const expected = expectedMap[id] || {
          cashier_user_id: id,
          expected_cash: 0,
          expected_card: 0,
          expected_transfer: 0,
          expected_total: 0,
        };
        const recon = savedByCashier[id] || null;
        const cashierName =
          recon?.cashier_name ||
          cashierRoleNameMap[id] ||
          nameMap[id] ||
          expected.cashier_name ||
          id;
        const creditDeposit = creditDepositMap[id] || { credit: 0, deposit: 0 };
        return {
          cashier_user_id: id,
          cashier_name: cashierName,
          collected_cash: money(expected.collected_cash || expected.expected_cash),
          collected_card: money(expected.collected_card || expected.expected_card),
          collected_transfer: money(
            expected.collected_transfer || expected.expected_transfer,
          ),
          expenses_cash: money(expected.expenses_cash),
          expenses_card: money(expected.expenses_card),
          expenses_transfer: money(expected.expenses_transfer),
          expected_cash: money(expected.expected_cash),
          expected_card: money(expected.expected_card),
          expected_transfer: money(expected.expected_transfer),
          expected_total: money(
            expected.expected_total ||
              (Number(expected.expected_cash) || 0) +
                (Number(expected.expected_card) || 0) +
                (Number(expected.expected_transfer) || 0),
          ),
          credit_total: money(creditDeposit.credit),
          deposit_total: money(creditDeposit.deposit),
          received_cash: recon ? money(recon.received_cash) : null,
          received_card: recon ? money(recon.received_card) : null,
          received_transfer: recon ? money(recon.received_transfer) : null,
          received_total: recon ? money(recon.received_total) : null,
          variance_cash: recon ? money(recon.variance_cash) : null,
          variance_card: recon ? money(recon.variance_card) : null,
          variance_transfer: recon ? money(recon.variance_transfer) : null,
          variance_total: recon ? money(recon.variance_total) : null,
          status: recon?.status || "open",
          note: recon?.note || null,
          confirmed_by: recon?.confirmed_by || null,
          confirmed_by_name: recon?.confirmed_by_name || null,
          confirmed_at: recon?.confirmed_at || null,
          reconciliation_id: recon?.id || null,
          cash_from_account: recon?.cash_from_account || null,
          cash_from_account_name: recon?.cash_from_account_name || null,
          safe_account: recon?.safe_account || null,
          safe_account_name: recon?.safe_account_name || null,
          cash_to_safe_amount: recon
            ? money(recon.cash_to_safe_amount)
            : null,
          shortage_account: recon?.shortage_account || null,
          shortage_account_name: recon?.shortage_account_name || null,
          shortage_amount: recon ? money(recon.shortage_amount) : null,
          cash_transfer_id: recon?.cash_transfer_id || null,
          is_cashier_role: cashierRoleIds.has(id),
        };
      })
      .filter(
        (c) =>
          c.expected_total > 0 ||
          (Number(c.collected_cash) || 0) > 0 ||
          (Number(c.collected_card) || 0) > 0 ||
          (Number(c.collected_transfer) || 0) > 0 ||
          (Number(c.expenses_cash) || 0) > 0 ||
          (Number(c.expenses_card) || 0) > 0 ||
          (Number(c.expenses_transfer) || 0) > 0 ||
          (Number(c.credit_total) || 0) > 0 ||
          (Number(c.deposit_total) || 0) > 0 ||
          c.status === "confirmed" ||
          c.status === "variance",
      )
      .sort((a, b) =>
        String(a.cashier_name || "").localeCompare(String(b.cashier_name || "")),
      );

    const cashier_options = cashiers.map((c) => ({
      cashier_user_id: c.cashier_user_id,
      cashier_name: c.cashier_name,
      is_cashier_role: !!c.is_cashier_role,
    }));

    const totals = cashiers.reduce(
      (acc, c) => {
        acc.expected_cash += c.expected_cash;
        acc.expected_card += c.expected_card || 0;
        acc.expected_transfer += c.expected_transfer;
        acc.expected_total += c.expected_total;
        acc.credit_total += Number(c.credit_total) || 0;
        acc.deposit_total += Number(c.deposit_total) || 0;
        if (c.status === "confirmed" || c.status === "variance") {
          acc.confirmed_count += 1;
          acc.received_cash += Number(c.received_cash) || 0;
          acc.received_card += Number(c.received_card) || 0;
          acc.received_transfer += Number(c.received_transfer) || 0;
        } else if ((Number(c.expected_total) || 0) > 0.05) {
          acc.open_count += 1;
        }
        return acc;
      },
      {
        expected_cash: 0,
        expected_card: 0,
        expected_transfer: 0,
        expected_total: 0,
        credit_total: 0,
        deposit_total: 0,
        received_cash: 0,
        received_card: 0,
        received_transfer: 0,
        confirmed_count: 0,
        open_count: 0,
      },
    );

    Object.keys(totals).forEach((k) => {
      if (typeof totals[k] === "number" && k.includes("_")) {
        if (!k.endsWith("_count")) totals[k] = money(totals[k]);
      }
    });

    return res.json({
      success: true,
      date: reconDate,
      branch_id: branchId || null,
      cashiers,
      cashier_options,
      summary: totals,
    });
  } catch (error) {
    console.error("collectionReconciliation.getSummary:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to load collection reconciliation",
    });
  }
};

/**
 * GET /api/v1/collection-reconciliation/:cashierUserId/lines
 */
exports.getCashierLines = async (req, res) => {
  try {
    const facilityId = req.query.facilityId || req.query.facility_id;
    const reconDate = String(req.query.date || "").trim();
    const branchId = normalizeBranchId(req.query.branchId || req.query.branch_id);
    const cashierUserId = String(req.params.cashierUserId || "").trim();

    if (!facilityId || !cashierUserId) {
      return res.status(400).json({
        success: false,
        message: "facilityId and cashierUserId are required",
      });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reconDate)) {
      return res.status(400).json({
        success: false,
        message: "date is required (YYYY-MM-DD)",
      });
    }

    const rows = await db.sequelize.query(
      `SELECT
         ce.entry_id,
         ce.receiptNo AS sale_code,
         ce.link_id,
         ce.customerNo AS customer_no,
         COALESCE(c.fullname, ce.customerNo) AS customer_name,
         ce.mode_of_payment,
         ce.cost AS amount,
         ce.description,
         ce.created_at
       FROM customer_entries ce
       LEFT JOIN customers c
         ON c.customerNo = ce.customerNo
        AND c.facilityId = ce.facilityId
       WHERE ce.facilityId = :facilityId
         AND ce.created_by = :cashierUserId
         AND ce.type = 'deposit'
         AND ce.cost > 0
         AND DATE(ce.created_at) = :reconDate
         AND ${COLLECTION_ENTRY_FILTER.replace(/\n/g, " ")}
         ${branchClause()}
       ORDER BY ce.created_at ASC`,
      {
        replacements: {
          facilityId,
          cashierUserId,
          reconDate,
          branchId,
        },
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );

    const lines = (rows || [])
      .map((r) => {
        const side = classifyMode(r.mode_of_payment);
        if (!side) return null;
        return {
          entry_id: r.entry_id,
          sale_code: r.sale_code || r.link_id || null,
          customer_no: r.customer_no,
          customer_name: r.customer_name,
          payment_type: side,
          mode_of_payment: r.mode_of_payment,
          amount: money(r.amount),
          description: r.description,
          created_at: r.created_at,
        };
      })
      .filter(Boolean);

    const tillSpend = await loadTillSpend({
      facilityId,
      fromDate: reconDate,
      toDate: reconDate,
      cashierUserId,
    });
    for (const exp of tillSpend.lines || []) {
      lines.push({
        entry_id: `exp-${exp.id}`,
        sale_code: exp.sale_code,
        customer_no: null,
        customer_name: exp.description || "Till expense",
        payment_type: exp.payment_type,
        mode_of_payment: exp.till_mode,
        amount: -money(exp.amount),
        description: exp.description,
        created_at: exp.transaction_date,
      });
    }

    try {
      const creditRows = await db.sequelize.query(
        `SELECT
           sw.id,
           sw.sale_code,
           sw.customer_no,
           COALESCE(c.fullname, sw.customer_no) AS customer_name,
           sw.payment_type,
           sw.amount,
           sw.created_at
         FROM sale_workflows sw
         LEFT JOIN customers c
           ON c.customerNo = sw.customer_no
          AND c.facilityId = sw.facility_id
         WHERE sw.facility_id = :facilityId
           AND CAST(COALESCE(
             NULLIF(sw.assigned_cashier_id, ''),
             NULLIF(sw.created_by, ''),
             sw.updated_by
           ) AS CHAR) = CAST(:cashierUserId AS CHAR)
           AND LOWER(IFNULL(sw.payment_type, '')) IN ('credit', 'credit_split')
           AND LOWER(IFNULL(sw.status, '')) IN (
             'awaiting_credit_approval',
             'credit_approved',
             'invoice_separation',
             'final_invoice',
             'warehouse_picking',
             'dual_signature',
             'goods_released',
             'completed'
           )
           AND sw.amount > 0
           AND DATE(sw.created_at) = :reconDate
           AND (:branchId = 0 OR sw.branch_id = :branchId)
         ORDER BY sw.created_at ASC`,
        {
          replacements: { facilityId, cashierUserId, reconDate, branchId },
          type: db.Sequelize.QueryTypes.SELECT,
        },
      );
      for (const row of creditRows || []) {
        lines.push({
          entry_id: `credit-${row.id}`,
          sale_code: row.sale_code,
          customer_no: row.customer_no,
          customer_name: row.customer_name,
          payment_type: "credit",
          mode_of_payment: row.payment_type,
          amount: money(row.amount),
          description: "Credit",
          created_at: row.created_at,
        });
      }
    } catch (err) {
      console.warn("collectionReconciliation credit lines:", err.message);
    }

    try {
      const depositRows = await db.sequelize.query(
        `SELECT
           ce.entry_id,
           ce.receiptNo AS sale_code,
           ce.link_id,
           ce.customerNo AS customer_no,
           COALESCE(c.fullname, ce.customerNo) AS customer_name,
           ce.cost AS amount,
           ce.description,
           ce.created_at
         FROM customer_entries ce
         LEFT JOIN customers c
           ON c.customerNo = ce.customerNo
          AND c.facilityId = ce.facilityId
         WHERE ce.facilityId = :facilityId
           AND ce.created_by = :cashierUserId
           AND ce.type = 'deposit'
           AND ce.cost > 0
           AND DATE(ce.created_at) = :reconDate
           AND (
             ce.description LIKE 'Advance applied%'
             OR ce.description LIKE 'Deposit applied%'
             OR LOWER(IFNULL(ce.mode_of_payment, '')) IN (
               'advance',
               'apply_deposit',
               'apply deposit'
             )
           )
           ${branchClause()}
         ORDER BY ce.created_at ASC`,
        {
          replacements: { facilityId, cashierUserId, reconDate, branchId },
          type: db.Sequelize.QueryTypes.SELECT,
        },
      );
      for (const row of depositRows || []) {
        lines.push({
          entry_id: `dep-${row.entry_id}`,
          sale_code: row.sale_code || row.link_id || null,
          customer_no: row.customer_no,
          customer_name: row.customer_name,
          payment_type: "apply_deposit",
          mode_of_payment: "advance",
          amount: money(row.amount),
          description: row.description,
          created_at: row.created_at,
        });
      }
    } catch (err) {
      console.warn("collectionReconciliation deposit lines:", err.message);
    }

    lines.sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    return res.json({
      success: true,
      cashier_user_id: cashierUserId,
      date: reconDate,
      lines,
    });
  } catch (error) {
    console.error("collectionReconciliation.getCashierLines:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to load cashier lines",
    });
  }
};

/**
 * GET /api/v1/collection-reconciliation/history
 * Cash-to-safe moves and shortage postings.
 */
exports.getHistory = async (req, res) => {
  try {
    const facilityId = req.query.facilityId || req.query.facility_id;
    const fromDate = String(req.query.from || req.query.fromDate || "").trim();
    const toDate = String(req.query.to || req.query.toDate || "").trim();
    const branchId = normalizeBranchId(req.query.branchId || req.query.branch_id);

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
      return res.status(400).json({
        success: false,
        message: "from and to dates are required (YYYY-MM-DD)",
      });
    }
    if (!db.CollectionReconciliation) {
      return res.status(500).json({
        success: false,
        message: "CollectionReconciliation model not loaded — run migrations",
      });
    }

    await ensureCashSafeColumns();
    const where = {
      facility_id: String(facilityId),
      recon_date: { [db.Sequelize.Op.between]: [fromDate, toDate] },
      [db.Sequelize.Op.or]: [
        { cash_transfer_id: { [db.Sequelize.Op.ne]: null } },
        { cash_to_safe_amount: { [db.Sequelize.Op.gt]: 0 } },
        { shortage_amount: { [db.Sequelize.Op.ne]: 0 } },
      ],
    };
    if (branchId) where.branch_id = branchId;

    const rows = await db.CollectionReconciliation.findAll({
      where,
      order: [
        ["recon_date", "DESC"],
        ["confirmed_at", "DESC"],
        ["id", "DESC"],
      ],
    });

    const history = (rows || []).map((row) => {
      const j = row.toJSON();
      return {
        ...j,
        expected_cash: money(j.expected_cash),
        received_cash: money(j.received_cash),
        cash_to_safe_amount: money(j.cash_to_safe_amount),
        shortage_amount: money(j.shortage_amount),
        variance_cash: money(j.variance_cash),
      };
    });

    return res.json({
      success: true,
      from: fromDate,
      to: toDate,
      history,
    });
  } catch (error) {
    console.error("collectionReconciliation.getHistory:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to load cash-to-safe history",
    });
  }
};

/**
 * POST /api/v1/collection-reconciliation/confirm
 * Supervisor confirms hand-in and, for cash, moves received cash
 * from the till account to Safe. Shortage posts to a selected account.
 */
exports.confirmHandIn = async (req, res) => {
  try {
    const body = req.body || {};
    const facilityId = body.facilityId || body.facility_id;
    const reconDate = String(body.date || body.recon_date || "").trim();
    const branchId = normalizeBranchId(body.branchId || body.branch_id);
    const cashierUserId = String(
      body.cashierUserId || body.cashier_user_id || "",
    ).trim();
    const receivedCash = money(body.received_cash ?? body.receivedCash);
    const receivedCard = money(body.received_card ?? body.receivedCard);
    const receivedTransfer = money(
      body.received_transfer ?? body.receivedTransfer,
    );
    const toSafeAmt =
      body.cash_to_safe_amount != null || body.cashToSafeAmount != null
        ? money(body.cash_to_safe_amount ?? body.cashToSafeAmount)
        : receivedCash;
    const note = body.note != null ? String(body.note).trim() : null;
    const confirmedBy = body.confirmed_by || body.confirmedBy || body.userId || null;
    const confirmedByName =
      body.confirmed_by_name || body.confirmedByName || body.userName || null;
    const cashFromCode = String(
      body.cash_from_account || body.cashFromAccount || "",
    ).trim();
    const safeCode = String(body.safe_account || body.safeAccount || "").trim();
    const shortageCode = String(
      body.shortage_account || body.shortageAccount || "",
    ).trim();

    if (!facilityId || !cashierUserId) {
      return res.status(400).json({
        success: false,
        message: "facilityId and cashierUserId are required",
      });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reconDate)) {
      return res.status(400).json({
        success: false,
        message: "date is required (YYYY-MM-DD)",
      });
    }
    if (!db.CollectionReconciliation) {
      return res.status(500).json({
        success: false,
        message: "CollectionReconciliation model not loaded — run migrations",
      });
    }

    await ensureCardColumns();
    await ensureCashSafeColumns();
    const { expectedMap } = await expectedAfterExpenses(
      facilityId,
      reconDate,
      branchId,
    );
    const expected = expectedMap[cashierUserId] || {
      expected_cash: 0,
      expected_card: 0,
      expected_transfer: 0,
      expected_total: 0,
    };
    const nameMap = await resolveUserNames([cashierUserId, confirmedBy]);
    const cashierName = nameMap[cashierUserId] || cashierUserId;

    const expectedCash = money(expected.expected_cash);
    const expectedCard = money(expected.expected_card);
    const expectedTransfer = money(expected.expected_transfer);
    const expectedTotal = money(expectedCash + expectedCard + expectedTransfer);
    const receivedTotal = money(receivedCash + receivedCard + receivedTransfer);
    const varianceCash = money(receivedCash - expectedCash);
    const varianceCard = money(receivedCard - expectedCard);
    const varianceTransfer = money(receivedTransfer - expectedTransfer);
    const varianceTotal = money(receivedTotal - expectedTotal);
    const balanced =
      Math.abs(varianceCash) <= 0.05 &&
      Math.abs(varianceCard) <= 0.05 &&
      Math.abs(varianceTransfer) <= 0.05;
    const status = balanced ? "confirmed" : "variance";
    const shortageAmt =
      body.shortage_amount != null || body.shortageAmount != null
        ? money(body.shortage_amount ?? body.shortageAmount)
        : money(expectedCash - toSafeAmt);
    const needsCashProcess =
      expectedCash > 0.05 || toSafeAmt > 0.05 || Math.abs(shortageAmt) > 0.05;

    if (
      shortageAmt >= -0.05 &&
      Math.abs(money(toSafeAmt + Math.max(shortageAmt, 0)) - expectedCash) > 0.05
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Amount to Safe plus shortage must equal cash to retire",
      });
    }

    if (needsCashProcess) {
      if (expectedCash > 0.05 && !cashFromCode) {
        return res.status(400).json({
          success: false,
          message: "Select the cash (till) account to move from",
        });
      }
      if (toSafeAmt > 0.05 && !safeCode) {
        return res.status(400).json({
          success: false,
          message: "Select the Safe account to move cash into",
        });
      }
      if (Math.abs(shortageAmt) > 0.05 && !shortageCode) {
        return res.status(400).json({
          success: false,
          message:
            shortageAmt > 0
              ? "Select an account for the cash shortage"
              : "Select an account for the cash overage",
        });
      }
      if (
        cashFromCode &&
        safeCode &&
        cashFromCode === safeCode &&
        toSafeAmt > 0.05
      ) {
        return res.status(400).json({
          success: false,
          message: "Cash and Safe accounts must be different",
        });
      }
    }

    const existing = await db.CollectionReconciliation.findOne({
      where: {
        facility_id: String(facilityId),
        recon_date: reconDate,
        cashier_user_id: cashierUserId,
        branch_id: branchId,
      },
    });

    if (existing?.cash_transfer_id) {
      return res.status(409).json({
        success: false,
        message: "Cash for this cashier has already been moved to Safe",
      });
    }
    if (
      existing &&
      (existing.status === "confirmed" || existing.status === "variance")
    ) {
      return res.status(409).json({
        success: false,
        message: "This cashier hand-in is already confirmed",
      });
    }

    const t = await db.sequelize.transaction();
    try {
      let cashFromAcc = null;
      let safeAcc = null;
      let varianceAcc = null;
      let transferId = null;

      if (needsCashProcess) {
        if (cashFromCode) {
          cashFromAcc = await findAccountByCode(facilityId, cashFromCode, t);
          if (!cashFromAcc) {
            const err = new Error("Cash account not found");
            err.statusCode = 404;
            throw err;
          }
        }
        if (safeCode) {
          safeAcc = await findAccountByCode(facilityId, safeCode, t);
          if (!safeAcc) {
            const err = new Error("Safe account not found");
            err.statusCode = 404;
            throw err;
          }
        }
        if (shortageCode) {
          varianceAcc = await findAccountByCode(facilityId, shortageCode, t);
          if (!varianceAcc) {
            const err = new Error("Shortage account not found");
            err.statusCode = 404;
            throw err;
          }
        }
        transferId = await nextCashSafeRef(facilityId, t);

        await postCashToSafeJournal({
          transaction: t,
          facilityId,
          reconDate,
          cashierName,
          confirmedBy,
          cashFrom: cashFromAcc,
          safeAcc,
          varianceAcc,
          receivedCash: toSafeAmt,
          expectedCash,
          shortageAmount: shortageAmt,
          note,
          transferId,
        });

        if (toSafeAmt > 0.05 && db.CashTransfer && cashFromAcc && safeAcc) {
          await db.CashTransfer.create(
            {
              transfer_id: transferId,
              from_account: cashFromAcc.code,
              to_account: safeAcc.code,
              amount: toSafeAmt,
              remarks:
                note ||
                `Collection Reconciliation cash to Safe — ${cashierName} (${reconDate})`,
              status: "completed",
              date: reconDate,
              facilityId: String(facilityId),
              created_by: confirmedBy ? String(confirmedBy) : null,
              reference_number: transferId,
              transaction_type: "cash_to_safe",
            },
            { transaction: t },
          );
        }
        if (shortageAmt > 0.05 && db.CashTransfer && cashFromAcc && varianceAcc) {
          await db.CashTransfer.create(
            {
              transfer_id: toSafeAmt > 0.05 ? `${transferId}-SH` : transferId,
              from_account: cashFromAcc.code,
              to_account: varianceAcc.code,
              amount: shortageAmt,
              remarks:
                note ||
                `Collection Reconciliation shortage — ${cashierName} (${reconDate})`,
              status: "completed",
              date: reconDate,
              facilityId: String(facilityId),
              created_by: confirmedBy ? String(confirmedBy) : null,
              reference_number: transferId,
              transaction_type: "cash_shortage",
            },
            { transaction: t },
          );
        }
      }

      const payload = {
        facility_id: String(facilityId),
        branch_id: branchId,
        recon_date: reconDate,
        cashier_user_id: cashierUserId,
        cashier_name: cashierName,
        expected_cash: expectedCash,
        expected_card: expectedCard,
        expected_transfer: expectedTransfer,
        expected_total: expectedTotal,
        received_cash: toSafeAmt,
        received_card: receivedCard,
        received_transfer: receivedTransfer,
        received_total: money(toSafeAmt + receivedCard + receivedTransfer),
        variance_cash: money(toSafeAmt - expectedCash),
        variance_card: varianceCard,
        variance_transfer: varianceTransfer,
        variance_total: money(
          toSafeAmt + receivedCard + receivedTransfer - expectedTotal,
        ),
        status,
        note: note || null,
        confirmed_by: confirmedBy ? String(confirmedBy) : null,
        confirmed_by_name:
          confirmedByName ||
          (confirmedBy ? nameMap[String(confirmedBy)] : null) ||
          null,
        confirmed_at: new Date(),
        cash_from_account: cashFromAcc?.code || null,
        cash_from_account_name: cashFromAcc
          ? accountLabel(cashFromAcc, cashFromCode)
          : null,
        safe_account: safeAcc?.code || null,
        safe_account_name: safeAcc ? accountLabel(safeAcc, safeCode) : null,
        cash_to_safe_amount: toSafeAmt > 0.05 ? toSafeAmt : 0,
        shortage_account: varianceAcc?.code || null,
        shortage_account_name: varianceAcc
          ? accountLabel(varianceAcc, shortageCode)
          : null,
        shortage_amount: Math.abs(shortageAmt) > 0.05 ? shortageAmt : 0,
        cash_transfer_id: transferId,
      };

      let row;
      if (existing) {
        await existing.update(payload, { transaction: t });
        row = existing;
      } else {
        row = await db.CollectionReconciliation.create(payload, {
          transaction: t,
        });
      }

      await t.commit();

      return res.json({
        success: true,
        message: needsCashProcess
          ? shortageAmt > 0.05
            ? "Cash moved to Safe and shortage posted"
            : shortageAmt < -0.05
              ? "Cash moved to Safe and overage posted"
              : "Cash moved to Safe"
          : status === "confirmed"
            ? "Hand-in confirmed — amounts match"
            : "Hand-in saved with variance",
        data: row.toJSON(),
      });
    } catch (inner) {
      await t.rollback();
      const code = inner.statusCode || 500;
      console.error("collectionReconciliation.confirmHandIn post:", inner);
      return res.status(code >= 400 && code < 600 ? code : 500).json({
        success: false,
        message: inner.message || "Failed to confirm hand-in",
      });
    }
  } catch (error) {
    console.error("collectionReconciliation.confirmHandIn:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to confirm hand-in",
    });
  }
};
