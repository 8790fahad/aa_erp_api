const db = require("../models");

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

function money(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

function classifyMode(mode) {
  const m = String(mode || "")
    .toLowerCase()
    .trim();
  if (m === "cash") return "cash";
  if (
    m === "bank" ||
    m === "transfer" ||
    m === "bank transfer" ||
    m === "cheque"
  ) {
    return "transfer";
  }
  return null;
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
        expected_transfer: 0,
      };
    }
    const side = classifyMode(row.mode_of_payment);
    const total = money(row.total);
    if (side === "cash") byCashier[cashierId].expected_cash += total;
    else if (side === "transfer") byCashier[cashierId].expected_transfer += total;
  }

  Object.values(byCashier).forEach((c) => {
    c.expected_cash = money(c.expected_cash);
    c.expected_transfer = money(c.expected_transfer);
    c.expected_total = money(c.expected_cash + c.expected_transfer);
  });

  return byCashier;
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

    const expectedMap = await loadExpectedByCashier(facilityId, reconDate, branchId);
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

    // Always include every Cashier-role user for the business (dropdown + list)
    const cashierRoleUsers = await loadCashierRoleUsers(facilityId);
    const cashierRoleIds = new Set(
      cashierRoleUsers.map((c) => String(c.cashier_user_id)),
    );
    const cashierRoleNameMap = {};
    cashierRoleUsers.forEach((c) => {
      cashierRoleNameMap[String(c.cashier_user_id)] = c.cashier_name;
    });

    const cashierIds = new Set([
      ...cashierRoleIds,
      ...Object.keys(expectedMap),
      ...Object.keys(savedByCashier),
    ]);
    const nameMap = await resolveUserNames([...cashierIds]);

    const cashiers = [...cashierIds]
      .map((id) => {
        const expected = expectedMap[id] || {
          cashier_user_id: id,
          expected_cash: 0,
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
        return {
          cashier_user_id: id,
          cashier_name: cashierName,
          expected_cash: money(expected.expected_cash),
          expected_transfer: money(expected.expected_transfer),
          expected_total: money(expected.expected_total),
          received_cash: recon ? money(recon.received_cash) : null,
          received_transfer: recon ? money(recon.received_transfer) : null,
          received_total: recon ? money(recon.received_total) : null,
          variance_cash: recon ? money(recon.variance_cash) : null,
          variance_transfer: recon ? money(recon.variance_transfer) : null,
          variance_total: recon ? money(recon.variance_total) : null,
          status: recon?.status || "open",
          note: recon?.note || null,
          confirmed_by: recon?.confirmed_by || null,
          confirmed_by_name: recon?.confirmed_by_name || null,
          confirmed_at: recon?.confirmed_at || null,
          reconciliation_id: recon?.id || null,
          is_cashier_role: cashierRoleIds.has(id),
        };
      })
      // Keep Cashier-role users even with 0 collections; still include anyone
      // who collected or already has a confirmation for the day.
      .filter(
        (c) =>
          c.is_cashier_role ||
          c.expected_total > 0 ||
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
        acc.expected_transfer += c.expected_transfer;
        acc.expected_total += c.expected_total;
        if (c.status === "confirmed" || c.status === "variance") {
          acc.confirmed_count += 1;
          acc.received_cash += Number(c.received_cash) || 0;
          acc.received_transfer += Number(c.received_transfer) || 0;
        } else {
          acc.open_count += 1;
        }
        return acc;
      },
      {
        expected_cash: 0,
        expected_transfer: 0,
        expected_total: 0,
        received_cash: 0,
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
 * POST /api/v1/collection-reconciliation/confirm
 * Supervisor confirms hand-in from a cashier.
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
    const receivedTransfer = money(
      body.received_transfer ?? body.receivedTransfer,
    );
    const note = body.note != null ? String(body.note).trim() : null;
    const confirmedBy = body.confirmed_by || body.confirmedBy || body.userId || null;
    const confirmedByName =
      body.confirmed_by_name || body.confirmedByName || body.userName || null;

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

    const expectedMap = await loadExpectedByCashier(facilityId, reconDate, branchId);
    const expected = expectedMap[cashierUserId] || {
      expected_cash: 0,
      expected_transfer: 0,
      expected_total: 0,
    };
    const nameMap = await resolveUserNames([cashierUserId, confirmedBy]);
    const cashierName = nameMap[cashierUserId] || cashierUserId;

    const expectedCash = money(expected.expected_cash);
    const expectedTransfer = money(expected.expected_transfer);
    const expectedTotal = money(expectedCash + expectedTransfer);
    const receivedTotal = money(receivedCash + receivedTransfer);
    const varianceCash = money(receivedCash - expectedCash);
    const varianceTransfer = money(receivedTransfer - expectedTransfer);
    const varianceTotal = money(receivedTotal - expectedTotal);
    const balanced =
      Math.abs(varianceCash) <= 0.05 && Math.abs(varianceTransfer) <= 0.05;
    const status = balanced ? "confirmed" : "variance";

    const payload = {
      facility_id: String(facilityId),
      branch_id: branchId,
      recon_date: reconDate,
      cashier_user_id: cashierUserId,
      cashier_name: cashierName,
      expected_cash: expectedCash,
      expected_transfer: expectedTransfer,
      expected_total: expectedTotal,
      received_cash: receivedCash,
      received_transfer: receivedTransfer,
      received_total: receivedTotal,
      variance_cash: varianceCash,
      variance_transfer: varianceTransfer,
      variance_total: varianceTotal,
      status,
      note: note || null,
      confirmed_by: confirmedBy ? String(confirmedBy) : null,
      confirmed_by_name:
        confirmedByName ||
        (confirmedBy ? nameMap[String(confirmedBy)] : null) ||
        null,
      confirmed_at: new Date(),
    };

    const existing = await db.CollectionReconciliation.findOne({
      where: {
        facility_id: String(facilityId),
        recon_date: reconDate,
        cashier_user_id: cashierUserId,
        branch_id: branchId,
      },
    });

    let row;
    if (existing) {
      await existing.update(payload);
      row = existing;
    } else {
      row = await db.CollectionReconciliation.create(payload);
    }

    return res.json({
      success: true,
      message:
        status === "confirmed"
          ? "Hand-in confirmed — amounts match"
          : "Hand-in saved with variance",
      data: row.toJSON(),
    });
  } catch (error) {
    console.error("collectionReconciliation.confirmHandIn:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to confirm hand-in",
    });
  }
};
