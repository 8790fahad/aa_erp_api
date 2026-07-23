const db = require("../models");
const { CashTransfer, AccountCategory, GeneralLedger } = db;
const { Op } = require("sequelize");
const moment = require("moment");
const { getAndUpdateNumber } = require("../services/numberGen");

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

const deriveLedgerType = (account) => {
  const candidates = [
    account?.type_mnemonic,
    account?.type_details,
    account?.account_type,
    "payment",
  ];

  for (const candidate of candidates) {
    const normalized = candidate?.toString().trim().toLowerCase();
    if (normalized && LEDGER_TYPES.has(normalized)) {
      return normalized;
    }
  }

  return "payment";
};

const generateUniqueCashTransferId = async (facilityId, transaction) => {
  const MAX_ATTEMPTS = 20;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const nextNumber = await getAndUpdateNumber("cash_transfer", facilityId);
    const candidateId = `CT-${nextNumber}`;
    const existingTransfer = await CashTransfer.findByPk(candidateId, {
      transaction,
    });

    if (!existingTransfer) {
      return candidateId;
    }
  }

  throw new Error("Unable to generate a unique cash transfer number");
};

// Create a new cash transfer
exports.createCashTransfer = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const {
      transfer_from,
      transfer_to,
      amount,
      remarks,
      facilityId,
      created_by,
      date = moment().format("YYYY-MM-DD"),
    } = req.body;

    // Validate required fields
    if (
      !transfer_from ||
      !transfer_to ||
      !amount ||
      !facilityId ||
      !created_by
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: transfer_from, transfer_to, amount, facilityId, created_by",
      });
    }

    // Validate amount is positive
    const transferAmount = parseFloat(amount);
    if (transferAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Amount must be greater than zero",
      });
    }

    // Verify the accounts exist
    const fromAccount = await AccountCategory.findOne({
      where: {
        code: transfer_from,
        facilityId: facilityId,
      },
    });

    if (!fromAccount) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Source account not found",
      });
    }

    const toAccount = await AccountCategory.findOne({
      where: {
        code: transfer_to,
        facilityId: facilityId,
      },
    });

    if (!toAccount) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Destination account not found",
      });
    }

    // Generate unique transfer ID from number generator and guard against collisions.
    const transferId = await generateUniqueCashTransferId(
      facilityId,
      transaction,
    );

    // Create the cash transfer record
    const cashTransfer = await CashTransfer.create(
      {
        transfer_id: transferId,
        from_account: transfer_from,
        to_account: transfer_to,
        amount: transferAmount,
        remarks: remarks || "",
        status: "completed",
        date: date,
        facilityId: facilityId,
        created_by: created_by,
        reference_number: transferId,
        transaction_type: "cash_transfer",
      },
      { transaction },
    );

    console.log("Date of transaction: ", date);

    const formattedDate = moment(date).isValid()
      ? moment(date).format("YYYY-MM-DD")
      : moment().format("YYYY-MM-DD");
    const transferPurpose = remarks?.trim()
      ? remarks.trim()
      : `Cash transfer ${transferId}`;

    const buildLedgerPayload = (account, overrides = {}) => ({
      transaction_date: formattedDate,
      account_code: account.code,
      account_subhead: 0,
      account_description: account.description || account.head,
      reference_number: transferId,
      purpose_of_payment: transferPurpose,
      mode_of_payment: "transfer",
      created_by,
      facility_id: facilityId,
      status: "paid",
      type: deriveLedgerType(account),
      transaction_ref: transferId,
      cheque_no: null,
      ...overrides,
    });

    // Record debit entry for the source account
    await GeneralLedger.create(
      buildLedgerPayload(toAccount, {
        dr: transferAmount,
        cr: 0,
        transaction_description: `Cash transfer from ${fromAccount.description}(${transfer_from}) to ${toAccount.description}(${transfer_to})`,
        payee: toAccount.description || transfer_to,
      }),
      { transaction },
    );

    // Record credit entry for the destination account
    await GeneralLedger.create(
      buildLedgerPayload(fromAccount, {
        dr: 0,
        cr: transferAmount,
        transaction_description: `Cash transfer to ${transfer_to} from ${transfer_from}`,
        payee: fromAccount.description || transfer_from,
      }),
      { transaction },
    );

    await transaction.commit();

    res.status(201).json({
      success: true,
      message: "Cash transfer completed successfully",
      data: cashTransfer,
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Error creating cash transfer:", error);
    res.status(500).json({
      success: false,
      message: "Error creating cash transfer",
      error: error.message,
    });
  }
};

const dedupeCashTransfers = (rows = []) => {
  const seen = new Set();
  const unique = [];

  for (const row of rows) {
    const plain = row?.get ? row.get({ plain: true }) : row;
    const transferId = String(plain?.transfer_id || "").trim();
    if (!transferId || seen.has(transferId)) continue;
    seen.add(transferId);
    unique.push({
      ...plain,
      total: plain.total ?? plain.amount ?? 0,
    });
  }

  return unique;
};

/** Resolve display profile: created_by (user id) → membership → users.email */
const formatCreatorProfile = (row) => {
  if (!row) return null;
  const first = row.firstname || "";
  const last = row.lastname || "";
  const fullName = `${first} ${last}`.trim();
  return {
    id: row.id || row.user_id,
    user_id: row.user_id,
    username: row.username || null,
    email: row.email || null,
    firstname: row.firstname || null,
    lastname: row.lastname || null,
    name: fullName || row.username || row.email || null,
  };
};

const fetchCreatorsByUserIds = async (userIds, facilityId) => {
  const uniqueIds = [
    ...new Set(userIds.map((id) => String(id || "").trim()).filter(Boolean)),
  ];
  if (!uniqueIds.length || !facilityId) return new Map();

  const rows = await db.sequelize.query(
    `SELECT
      m.user_id,
      u.id,
      u.username,
      u.email,
      u.firstname,
      u.lastname
    FROM membership m
    LEFT JOIN users u ON m.email = u.email
    WHERE m.business_id = :facilityId
      AND m.user_id IN (:userIds)`,
    {
      replacements: { facilityId, userIds: uniqueIds },
      type: db.Sequelize.QueryTypes.SELECT,
    },
  );

  const creatorMap = new Map();
  for (const row of rows) {
    const key = String(row.user_id || "").trim();
    if (key && !creatorMap.has(key)) {
      creatorMap.set(key, formatCreatorProfile(row));
    }
  }
  return creatorMap;
};

const attachCreatorsToTransfers = async (transfers, facilityId) => {
  const plainList = transfers.map((row) =>
    row?.get ? row.get({ plain: true }) : { ...row },
  );
  const creatorMap = await fetchCreatorsByUserIds(
    plainList.map((transfer) => transfer.created_by),
    facilityId,
  );

  return plainList.map((transfer) => ({
    ...transfer,
    creator:
      creatorMap.get(String(transfer.created_by || "").trim()) || null,
  }));
};

// Get all cash transfers with optional filtering
exports.getAllCashTransfers = async (req, res) => {
  try {
    const { facilityId, status = "all", userId } = req.params;
    const dateFrom = req.query?.dateFrom || req.params?.dateFrom;
    const dateTo = req.query?.dateTo || req.params?.dateTo;

    const mapStatusFilter = (rawStatus) => {
      const normalized = String(rawStatus || "all").toLowerCase();
      if (normalized === "all") return null;

      // Keep compatibility with old UI status values.
      const aliases = {
        initial: ["pending", "initial"],
        review: ["reviewed", "review"],
        re_list: ["returned", "re_list"],
        list: ["approved", "completed", "list"],
      };
      return aliases[normalized] || [normalized];
    };

    const whereClause = { facilityId };
    const statusValues = mapStatusFilter(status);
    if (statusValues?.length) {
      whereClause.status = { [Op.in]: statusValues };
    }

    if (dateFrom && dateTo) whereClause.date = { [Op.between]: [dateFrom, dateTo] };
    else if (dateFrom) whereClause.date = { [Op.gte]: dateFrom };
    else if (dateTo) whereClause.date = { [Op.lte]: dateTo };

    let cashTransfers = await CashTransfer.findAll({
      where: whereClause,
      order: [
        ["date", "DESC"],
        ["created_at", "DESC"],
      ],
    });

    // Legacy fallback: some environments have transfer history only in general_ledger.
    if (!cashTransfers.length) {
      const dateFilters = [];
      const replacements = { facilityId };
      if (dateFrom) {
        dateFilters.push("gl.transaction_date >= :dateFrom");
        replacements.dateFrom = `${dateFrom} 00:00:00`;
      }
      if (dateTo) {
        dateFilters.push("gl.transaction_date <= :dateTo");
        replacements.dateTo = `${dateTo} 23:59:59`;
      }

      const statusFilterSql =
        statusValues?.length
          ? `AND COALESCE(ct.status, 'completed') IN (${statusValues
            .map((_, idx) => `:status_${idx}`)
            .join(", ")})`
          : "";

      if (statusValues?.length) {
        statusValues.forEach((value, idx) => {
          replacements[`status_${idx}`] = value;
        });
      }

      const legacyRows = await db.sequelize.query(
        `
        SELECT
          MAX(gl.transaction_date) AS date,
          gl.reference_number AS transfer_id,
          MAX(CASE WHEN gl.cr > 0 THEN gl.account_code END) AS from_account,
          MAX(CASE WHEN gl.dr > 0 THEN gl.account_code END) AS to_account,
          MAX(CASE WHEN gl.dr > 0 THEN gl.dr END) AS amount,
          MAX(CASE WHEN gl.dr > 0 THEN gl.created_by END) AS created_by,
          COALESCE(MAX(ct.status), 'completed') AS status
        FROM general_ledger gl
        LEFT JOIN cash_transfers ct
          ON ct.transfer_id = gl.reference_number AND ct.facilityId = gl.facility_id
        WHERE gl.facility_id = :facilityId
          AND gl.reference_number IS NOT NULL
          AND gl.reference_number <> ''
          AND (
            gl.transaction_ref LIKE 'CT-%'
            OR gl.reference_number LIKE 'CT-%'
            OR gl.transaction_description LIKE 'Cash transfer%'
          )
          ${dateFilters.length ? `AND ${dateFilters.join(" AND ")}` : ""}
          ${statusFilterSql}
        GROUP BY gl.reference_number
        ORDER BY MAX(gl.transaction_date) DESC
        `,
        {
          replacements,
          type: db.Sequelize.QueryTypes.SELECT,
        },
      );

      cashTransfers = legacyRows.map((row) => ({
        ...row,
        total: row.amount,
      }));
    }

    const results = await attachCreatorsToTransfers(
      dedupeCashTransfers(cashTransfers),
      facilityId,
    );

    return res.json({
      success: true,
      results,
      count: results.length,
    });
  } catch (error) {
    console.error("Error fetching cash transfers:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching cash transfers",
      error: error.message,
    });
  }
};

// Get a specific cash transfer by ID
exports.getCashTransferById = async (req, res) => {
  try {
    const { transferId, facilityId } = req.params;

    const cashTransfer = await CashTransfer.findOne({
      where: {
        transfer_id: transferId,
        facilityId: facilityId,
      },
    });

    if (!cashTransfer) {
      return res.status(404).json({
        success: false,
        message: "Cash transfer not found",
      });
    }

    const [result] = await attachCreatorsToTransfers(
      [cashTransfer],
      facilityId,
    );

    res.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error("Error fetching cash transfer:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching cash transfer",
      error: error.message,
    });
  }
};

// Update a cash transfer (for status updates or remarks only)
exports.updateCashTransfer = async (req, res) => {
  try {
    const { transferId, facilityId } = req.params;
    const { status, remarks, logStatus } = req.body;

    const cashTransfer = await CashTransfer.findOne({
      where: {
        transfer_id: transferId,
        facilityId: facilityId,
      },
    });

    if (!cashTransfer) {
      return res.status(404).json({
        success: false,
        message: "Cash transfer not found",
      });
    }

    // Only allow updating specific fields (status, remarks)
    const updateData = {};
    if (status) updateData.status = status;
    if (remarks) updateData.remarks = remarks;
    if (logStatus) updateData.status = logStatus; // For consistency with frontend

    const updatedCashTransfer = await cashTransfer.update(updateData);

    res.json({
      success: true,
      message: "Cash transfer updated successfully",
      data: updatedCashTransfer,
    });
  } catch (error) {
    console.error("Error updating cash transfer:", error);
    res.status(500).json({
      success: false,
      message: "Error updating cash transfer",
      error: error.message,
    });
  }
};

// Delete a cash transfer (soft delete by changing status)
exports.deleteCashTransfer = async (req, res) => {
  try {
    const { transferId, facilityId } = req.params;

    const cashTransfer = await CashTransfer.findOne({
      where: {
        transfer_id: transferId,
        facilityId: facilityId,
      },
    });

    if (!cashTransfer) {
      return res.status(404).json({
        success: false,
        message: "Cash transfer not found",
      });
    }

    // Instead of hard delete, mark as cancelled
    await cashTransfer.update({ status: "cancelled" });

    res.json({
      success: true,
      message: "Cash transfer cancelled successfully",
    });
  } catch (error) {
    console.error("Error deleting cash transfer:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting cash transfer",
      error: error.message,
    });
  }
};

// Get cash transfers by account
exports.getCashTransfersByAccount = async (req, res) => {
  try {
    const { accountId, facilityId } = req.params;

    const cashTransfers = await CashTransfer.findAll({
      where: {
        [Op.or]: [{ from_account: accountId }, { to_account: accountId }],
        facilityId: facilityId,
      },
      order: [["date", "DESC"]],
    });

    res.json({
      success: true,
      results: cashTransfers,
      count: cashTransfers.length,
    });
  } catch (error) {
    console.error("Error fetching cash transfers by account:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching cash transfers by account",
      error: error.message,
    });
  }
};

// Search cash transfers
exports.searchCashTransfers = async (req, res) => {
  try {
    const { facilityId, searchTerm } = req.params;

    const cashTransfers = await CashTransfer.findAll({
      where: {
        facilityId: facilityId,
        [Op.or]: [
          { transfer_id: { [Op.like]: `%${searchTerm}%` } },
          { remarks: { [Op.like]: `%${searchTerm}%` } },
          { from_account: { [Op.like]: `%${searchTerm}%` } },
          { to_account: { [Op.like]: `%${searchTerm}%` } },
        ],
      },
      order: [["date", "DESC"]],
    });

    res.json({
      success: true,
      results: cashTransfers,
      count: cashTransfers.length,
    });
  } catch (error) {
    console.error("Error searching cash transfers:", error);
    res.status(500).json({
      success: false,
      message: "Error searching cash transfers",
      error: error.message,
    });
  }
};
