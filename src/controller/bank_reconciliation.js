const db = require("../models");
const { Op } = require("sequelize");
const moment = require("moment");

const statementTxnNet = (txn) => {
  const credit = parseFloat(txn.credit || 0);
  const debit = parseFloat(txn.debit || 0);
  if (credit > 0 || debit > 0) return credit - debit;
  const amt = Math.abs(parseFloat(txn.amount || 0));
  return txn.transaction_type === "credit" ? amt : -amt;
};

const parseStatementBalance = (value) => {
  if (value == null || value === "") return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
};

/** Closing bank balance as at endDate from uploaded statement lines. */
const resolveBankStatementBalance = async (
  bankAccountId,
  facilityId,
  endDate,
  startDate,
) => {
  const include = [
    {
      model: db.bank_statement,
      where: { bank_account_id: bankAccountId, facility_id: facilityId },
      required: true,
    },
  ];

  const allTxns = await db.bank_statement_transaction.findAll({
    include,
    where: { transaction_date: { [Op.lte]: endDate } },
    order: [
      ["transaction_date", "ASC"],
      ["id", "ASC"],
    ],
  });

  if (!allTxns.length) return 0;

  for (let i = allTxns.length - 1; i >= 0; i--) {
    const parsed = parseStatementBalance(allTxns[i].balance);
    if (parsed != null) return parsed;
  }

  const periodStart = startDate || allTxns[0].transaction_date;
  const beforePeriod = allTxns.filter(
    (t) => String(t.transaction_date) < String(periodStart),
  );

  let opening = 0;
  const lastBalBefore = [...beforePeriod]
    .reverse()
    .find((t) => parseStatementBalance(t.balance) != null);

  if (lastBalBefore) {
    opening = parseStatementBalance(lastBalBefore.balance);
    for (const txn of allTxns) {
      if (
        String(txn.transaction_date) > String(lastBalBefore.transaction_date) &&
        String(txn.transaction_date) < String(periodStart)
      ) {
        opening += statementTxnNet(txn);
      }
    }
  } else {
    opening = beforePeriod.reduce((sum, t) => sum + statementTxnNet(t), 0);
  }

  const inPeriod = allTxns.filter(
    (t) =>
      String(t.transaction_date) >= String(periodStart) &&
      String(t.transaction_date) <= String(endDate),
  );

  return opening + inPeriod.reduce((sum, t) => sum + statementTxnNet(t), 0);
};

/** Sum GL lines for a bank account by `type` (charges | interest), one amount per transaction_ref. */
const sumGeneralLedgerByType = async (
  facilityId,
  bankAccountId,
  ledgerType,
  startDate,
  endDate,
) => {
  const bankIdStr = String(bankAccountId);
  const bankIdNum = parseInt(bankAccountId, 10);
  const bankIdWhere = Number.isFinite(bankIdNum)
    ? { [Op.or]: [{ bank_account_id: bankIdStr }, { bank_account_id: bankIdNum }] }
    : { bank_account_id: bankIdStr };

  const rows = await db.GeneralLedger.findAll({
    where: {
      facility_id: String(facilityId),
      type: ledgerType,
      transaction_date: { [Op.between]: [startDate, endDate] },
      ...bankIdWhere,
    },
  });

  const byRef = new Map();
  for (const t of rows) {
    const ref = t.transaction_ref || `id-${t.transaction_id}`;
    const amt = Math.max(parseFloat(t.dr || 0), parseFloat(t.cr || 0));
    if (amt > 0) byRef.set(ref, amt);
  }
  return [...byRef.values()].reduce((sum, v) => sum + v, 0);
};

// Helper function to log reconciliation activities
const logReconciliationActivity = async ({
  type = "Bank Reconciliation",
  name = "",
  role = "",
  id_link = "",
  remark = "",
  user_id = "",
  query_type = "",
  status = "",
  amount = 0,
  facilityId = "",
}) => {
  try {
    // Use the Log model to create log entry
    // Store query_type in the name field if provided, otherwise use name
    const logName = query_type || name || "Bank Reconciliation Activity";

    // Try to use the model, fallback to raw query if model not available
    if (db.logs) {
      await db.logs.create({
        type: type,
        name: logName,
        role: role || null,
        id_link: id_link || "",
        remark: remark || "",
        user_id: user_id || "",
        status: status || "",
        amount: amount || 0,
        facilityId: facilityId || "",
      });
    } else {
      // Fallback to raw query if model not loaded
      await db.sequelize.query(
        `INSERT INTO logs (type, name, role, id_link, remark, user_id, status, amount, facilityId)
                 VALUES (:type, :name, :role, :id_link, :remark, :user_id, :status, :amount, :facilityId)`,
        {
          replacements: {
            type,
            name: logName,
            role: role || null,
            id_link: id_link || "",
            remark: remark || "",
            user_id: user_id || "",
            status: status || "",
            amount: amount || 0,
            facilityId: facilityId || "",
          },
        }
      );
    }
  } catch (error) {
    console.error("Error logging reconciliation activity:", error);
    // Don't throw error - logging failure shouldn't break the main operation
  }
};

exports.postBankReconciliation = (req, res) => {
  const { facilityId, entries = [] } = req.body;
  try {
    if (entries.length === 0) {
      return res.json({ success: false, error: "No entries found" });
    }

    entries.forEach((entry) => {
      db.sequelize.query(
        `INSERT INTO bank_reconciliation (facilityId, bank_code, amount, type) VALUES (:facilityId, :bank_code, :amount, :type)`,
        {
          replacements: {
            facilityId,
            bank_code: entry.bank_code,
            amount: entry.amount,
            type: entry.type,
          },
        }
      );
    });

    db.sequelize
      .query(
        `INSERT INTO bank_reconciliation (facilityId, bankId) VALUES (:facilityId, :bankId)`,
        {
          replacements: {
            facilityId,
            bankId: entries[0].bankId,
          },
        }
      )
      .then((result) => {
        res.json({ success: true, result });
      })
      .catch((error) => {
        res.json({ success: false, error });
      });
  } catch (error) {
    res.json({ success: false, error });
  }
};
exports.bankReconciliation = (req, res) => {
  const { facilityId, bankId } = req.query;
  try {
    db.sequelize
      .query(
        `SELECT * FROM bank_reconciliation WHERE facilityId = :facilityId AND bankId = :bankId`,
        {
          replacements: {
            facilityId,
            bankId,
          },
        }
      )
      .then((result) => {
        res.json({ success: true, result });
      })
      .catch((error) => {
        res.json({ success: false, error });
      });
  } catch (error) {
    res.json({ success: false, error });
  }
};

exports.getBankList = (req, res) => {
  const { facilityId } = req.query;
  try {
    db.sequelize
      .query(`SELECT * FROM bank_list WHERE   facilityId = :facilityId`, {
        replacements: {
          facilityId,
        },
      })
      .then((result) => {
        res.json({ success: true, results: result[0] });
      })
      .catch((error) => {
        res.json({ success: false, error });
      });
  } catch (error) {
    res.json({ success: false, error });
  }
};

/** Create a row in `bank_list` (Settings → bank directory). */
exports.createBankList = async (req, res) => {
  const { bank_name, bank_code, bank_cbn_code, facilityId } = req.body;
  if (!facilityId) {
    return res.status(400).json({ success: false, message: "facilityId is required" });
  }
  if (!bank_name || !String(bank_name).trim()) {
    return res.status(400).json({ success: false, message: "Bank name is required" });
  }
  if (!bank_code || !String(bank_code).trim()) {
    return res.status(400).json({ success: false, message: "Bank code is required" });
  }
  if (!bank_cbn_code || !String(bank_cbn_code).trim()) {
    return res.status(400).json({ success: false, message: "CBN code is required" });
  }
  const bc = String(bank_code).trim();
  const cbn = String(bank_cbn_code).trim();
  const name = String(bank_name).trim();
  try {
    await db.sequelize.query(
      `INSERT INTO bank_list (bank_name, bank_code, bank_cbn_code, facilityId)
       VALUES (:bank_name, :bank_code, :bank_cbn_code, :facilityId)`,
      {
        replacements: {
          bank_name: name,
          bank_code: bc,
          bank_cbn_code: cbn,
          facilityId,
        },
      }
    );
    return res.json({ success: true, message: "Bank added successfully" });
  } catch (err) {
    console.error("createBankList", err);
    if (err.name === "SequelizeUniqueConstraintError" || err.original?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "A bank with this bank code and CBN code already exists for this facility",
      });
    }
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to add bank",
    });
  }
};

/** Update a `bank_list` row (composite key identifies the row). */
exports.updateBankList = async (req, res) => {
  const {
    facilityId,
    bank_name,
    bank_code,
    bank_cbn_code,
    old_bank_code,
    old_bank_cbn_code,
  } = req.body;
  if (!facilityId) {
    return res.status(400).json({ success: false, message: "facilityId is required" });
  }
  if (!old_bank_code || !old_bank_cbn_code) {
    return res.status(400).json({
      success: false,
      message: "old_bank_code and old_bank_cbn_code are required",
    });
  }
  if (!bank_name || !String(bank_name).trim()) {
    return res.status(400).json({ success: false, message: "Bank name is required" });
  }
  if (!bank_code || !String(bank_code).trim()) {
    return res.status(400).json({ success: false, message: "Bank code is required" });
  }
  if (!bank_cbn_code || !String(bank_cbn_code).trim()) {
    return res.status(400).json({ success: false, message: "CBN code is required" });
  }
  const name = String(bank_name).trim();
  const newBc = String(bank_code).trim();
  const newCbn = String(bank_cbn_code).trim();
  const oldBc = String(old_bank_code).trim();
  const oldCbn = String(old_bank_cbn_code).trim();

  try {
    const countRows = await db.sequelize.query(
      `SELECT COUNT(*) AS c FROM bank_accounts
       WHERE bank_code = :old_bc AND facility_id = :facilityId`,
      {
        replacements: { old_bc: oldBc, facilityId },
        type: db.Sequelize.QueryTypes.SELECT,
      }
    );
    const inUse = Number(countRows[0]?.c) > 0;
    if (inUse && (oldBc !== newBc || oldCbn !== newCbn)) {
      return res.status(400).json({
        success: false,
        message:
          "This bank is linked to bank accounts. Change bank name only, or remove links first.",
      });
    }

    const [result] = await db.sequelize.query(
      `UPDATE bank_list
       SET bank_name = :bank_name, bank_code = :new_bc, bank_cbn_code = :new_cbn
       WHERE bank_code = :old_bc AND bank_cbn_code = :old_cbn AND facilityId = :facilityId`,
      {
        replacements: {
          bank_name: name,
          new_bc: newBc,
          new_cbn: newCbn,
          old_bc: oldBc,
          old_cbn: oldCbn,
          facilityId,
        },
      }
    );
    const affected = result?.affectedRows ?? result;
    if (!affected) {
      return res.status(404).json({ success: false, message: "Bank record not found" });
    }
    return res.json({ success: true, message: "Bank updated successfully" });
  } catch (err) {
    console.error("updateBankList", err);
    if (err.original?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "A bank with this bank code and CBN code already exists for this facility",
      });
    }
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to update bank",
    });
  }
};

/** Delete a `bank_list` row if not referenced by bank_accounts. */
exports.deleteBankList = async (req, res) => {
  const { bank_code, bank_cbn_code, facilityId } = req.query;
  if (!facilityId || !bank_code || !bank_cbn_code) {
    return res.status(400).json({
      success: false,
      message: "facilityId, bank_code, and bank_cbn_code are required",
    });
  }
  const bc = String(bank_code).trim();
  const cbn = String(bank_cbn_code).trim();
  try {
    const countRows = await db.sequelize.query(
      `SELECT COUNT(*) AS c FROM bank_accounts
       WHERE bank_code = :bank_code AND facility_id = :facilityId`,
      {
        replacements: { bank_code: bc, facilityId },
        type: db.Sequelize.QueryTypes.SELECT,
      }
    );
    if (Number(countRows[0]?.c) > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete: one or more bank accounts use this bank code",
      });
    }

    const [result] = await db.sequelize.query(
      `DELETE FROM bank_list
       WHERE bank_code = :bank_code AND bank_cbn_code = :bank_cbn_code AND facilityId = :facilityId`,
      {
        replacements: {
          bank_code: bc,
          bank_cbn_code: cbn,
          facilityId,
        },
      }
    );
    const affected = result?.affectedRows ?? result;
    if (!affected) {
      return res.status(404).json({ success: false, message: "Bank record not found" });
    }
    return res.json({ success: true, message: "Bank removed" });
  } catch (err) {
    console.error("deleteBankList", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to delete bank",
    });
  }
};
exports.bankOpeningBalance = (req, res) => {
  const { bank_chart_code, facilityId } = req.query;
  try {
    db.sequelize
      .query(
        `SELECT SUM(dr - cr) as opening_balance FROM general_ledger WHERE account_code = :bank_chart_code AND facility_id = :facilityId`,
        {
          replacements: {
            bank_chart_code,
            facilityId,
          },
        }
      )
      .then((result) => {
        console.log(result);
        res.json({ success: true, result });
      })
      .catch((error) => {
        res.json({ success: false, error });
      });
  } catch (error) {
    res.json({ success: false, error });
  }
};

// Bank Account CRUD Operations
// Bank Account CRUD Operations
exports.createBankAccount = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const {
      account_number,
      bank_code,
      bank_name,
      account_name,
      user_id,
      account_bank_type,
      head, // GL Account Head (e.g., "10101")
      subhead, // GL Account Subhead (optional)
      facilityId,
      opening_balance = 0,
      opening_balance_date,
      opening_balance_equity,
      currency = "NGN",
    } = req.body;
    console.log(req.body, "==========");
    // === VALIDATIONS ===
    if (
      !account_number ||
      !bank_code ||
      !bank_name ||
      !account_bank_type ||
      !facilityId ||
      !user_id ||
      !head
    ) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // Prevent duplicate active account
    const existing = await db.bank_account.findOne({
      where: { account_number, facilityId, status: "active" },
      transaction,
    });
    if (existing) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Bank account with this number already exists",
      });
    }

    // === CREATE BANK ACCOUNT ===
    const bankAccount = await db.bank_account.create(
      {
        account_number: String(account_number).trim(),
        account_name: account_name ? String(account_name).trim() : null,
        bank_code: String(bank_code),
        bank_name: String(bank_name),
        account_bank_type: String(account_bank_type),
        user_id: String(user_id),
        head: head ? String(head) : null,
        subhead: subhead ? String(subhead) : null,
        currency: currency.toUpperCase(),
        facilityId: String(facilityId),
        status: "active",
      },
      { transaction }
    );

    // === OPENING BALANCE LOGIC ===
    const openingBalance = parseFloat(opening_balance) || 0;
    const balanceDate = opening_balance_date || moment().format("YYYY-MM-DD");

    if (openingBalance !== 0 && head) {
      // Find the actual GL Account
      const glAccount = await db.Account.findOne({
        where: { head, facilityId },
        transaction,
      });

      if (!glAccount) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `GL Account not found for head: ${head}`,
        });
      }

      // Find Opening Balance Equity Account
      const equityAccount = await db.Account.findOne({
        where: {
          facilityId,
          head: opening_balance_equity,
        },
        transaction,
      });

      if (!equityAccount) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message:
            "Opening Balance Equity account not found. Please create one.",
        });
      }

      const ref = `OB-${bankAccount.id}-${Date.now()
        .toString(36)
        .toUpperCase()}`;

      // Determine debit/credit based on normal balance (Bank = Debit balance)
      const isPositive = openingBalance >= 0;
      const amount = Math.abs(openingBalance);

      // Bank Account Entry (Normal: Debit balance)
      await db.GeneralLedger.create(
        {
          transaction_date: balanceDate,
          account_code: glAccount.head,
          account_subhead: subhead || glAccount.subhead ||0,
          dr: isPositive ? amount : 0,
          cr: isPositive ? 0 : amount,
          bank_account_id: bankAccount.id,
          mode_of_payment: "bank",
          account_description:
            glAccount.description || bankAccount.account_name,
          transaction_description: `Opening Balance - ${bankAccount.account_name} (${bankAccount.account_number})`,
          reference_number: ref,
          purpose_of_payment: "Opening Balance",
          payee: bankAccount.account_name,
          created_by: user_id,
          facility_id: facilityId,
          status: "paid",
          type: "opening_balance",
          transaction_ref: `${ref}-BANK`,
        },
        { transaction }
      );

      // Equity Counter Entry (Opposite side)
      await db.GeneralLedger.create(
        {
          transaction_date: balanceDate,
          account_code: equityAccount.head,
          account_subhead: equityAccount.subhead ||0,
          dr: isPositive ? 0 : amount,
          cr: isPositive ? amount : 0,
          account_description: equityAccount.description,
          transaction_description: `Opening Balance Equity Offset - ${bankAccount.account_name}`,
          reference_number: ref,
          purpose_of_payment: "Opening Balance",
          payee: "",
          created_by: user_id,
          facility_id: facilityId,
          status: "paid",
          type: "opening_balance",
          transaction_ref: `${ref}-EQUITY`,
        },
        { transaction }
      );
    }

    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: "Bank account created successfully",
      data: bankAccount,
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Error creating bank account:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create bank account",
      error: error.message,
    });
  }
};

// Bulk upload bank accounts (with optional opening balance posting).
// Each row is processed in its own transaction so a single bad row does not
// roll back the whole batch.
exports.bulkCreateBankAccounts = async (req, res) => {
  try {
    const rows = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Request body must be a non-empty array of bank accounts",
      });
    }

    const created = [];
    const failed = [];

    for (let i = 0; i < rows.length; i++) {
      const index = i + 1;
      const item = rows[i] || {};

      const account_name = String(item.account_name || item.bank_name || "").trim();
      const head = item.head != null ? String(item.head).trim() : "";
      const account_number = String(item.account_number || "").trim();
      const account_bank_type = String(item.account_bank_type || "").trim();
      const bank_code = String(item.bank_code || "").trim();
      const bank_name = String(item.bank_name || account_name).trim();
      const user_id = item.user_id;
      const facilityId = item.facilityId;
      const opening_balance_equity = item.opening_balance_equity;
      const currency = item.currency ? String(item.currency).toUpperCase() : "NGN";
      const openingBalance = parseFloat(item.opening_balance) || 0;
      const opening_balance_date =
        item.opening_balance_date || moment().format("YYYY-MM-DD");

      // Per-row validation
      const missing = [];
      if (!account_name) missing.push("Bank Name");
      if (!head) missing.push("Code (GL Account Head)");
      if (!account_number) missing.push("Account Number");
      if (!account_bank_type) missing.push("Account Type");
      if (!facilityId) missing.push("facilityId");
      if (!user_id) missing.push("user_id");

      if (missing.length > 0) {
        failed.push({
          index,
          name: account_name || "unknown",
          error: `Missing required field(s): ${missing.join(", ")}`,
        });
        continue;
      }

      const transaction = await db.sequelize.transaction();
      try {
        const existing = await db.bank_account.findOne({
          where: { account_number, facilityId, status: "active" },
          transaction,
        });
        if (existing) {
          await transaction.rollback();
          failed.push({
            index,
            name: account_name,
            error: `Bank account with number ${account_number} already exists`,
          });
          continue;
        }

        const bankAccount = await db.bank_account.create(
          {
            account_number,
            account_name,
            bank_code,
            bank_name,
            account_bank_type,
            user_id: String(user_id),
            head: head || null,
            currency,
            facilityId: String(facilityId),
            status: "active",
          },
          { transaction }
        );

        if (openingBalance !== 0) {
          const glAccount = await db.Account.findOne({
            where: { head, facilityId },
            transaction,
          });

          if (!glAccount) {
            await transaction.rollback();
            failed.push({
              index,
              name: account_name,
              error: `GL Account not found for code (head): ${head}`,
            });
            continue;
          }

          const equityAccount = await db.Account.findOne({
            where: { facilityId, head: opening_balance_equity },
            transaction,
          });

          if (!equityAccount) {
            await transaction.rollback();
            failed.push({
              index,
              name: account_name,
              error:
                "Opening Balance Equity account not found. Please create one before uploading opening balances.",
            });
            continue;
          }

          const ref = `OB-${bankAccount.id}-${Date.now()
            .toString(36)
            .toUpperCase()}`;
          const isPositive = openingBalance >= 0;
          const amount = Math.abs(openingBalance);

          await db.GeneralLedger.create(
            {
              transaction_date: opening_balance_date,
              account_code: glAccount.head,
              account_subhead: glAccount.subhead || 0,
              dr: isPositive ? amount : 0,
              cr: isPositive ? 0 : amount,
              bank_account_id: bankAccount.id,
              mode_of_payment: "bank",
              account_description:
                glAccount.description || bankAccount.account_name,
              transaction_description: `Opening Balance - ${bankAccount.account_name} (${bankAccount.account_number})`,
              reference_number: ref,
              purpose_of_payment: "Opening Balance",
              payee: bankAccount.account_name,
              created_by: user_id,
              facility_id: facilityId,
              status: "paid",
              type: "opening_balance",
              transaction_ref: `${ref}-BANK`,
            },
            { transaction }
          );

          await db.GeneralLedger.create(
            {
              transaction_date: opening_balance_date,
              account_code: equityAccount.head,
              account_subhead: equityAccount.subhead || 0,
              dr: isPositive ? 0 : amount,
              cr: isPositive ? amount : 0,
              account_description: equityAccount.description,
              transaction_description: `Opening Balance Equity Offset - ${bankAccount.account_name}`,
              reference_number: ref,
              purpose_of_payment: "Opening Balance",
              payee: "",
              created_by: user_id,
              facility_id: facilityId,
              status: "paid",
              type: "opening_balance",
              transaction_ref: `${ref}-EQUITY`,
            },
            { transaction }
          );
        }

        await transaction.commit();
        created.push({
          index,
          id: bankAccount.id,
          name: account_name,
          account_number,
        });
      } catch (rowErr) {
        await transaction.rollback();
        console.error(`Bulk bank account row #${index} failed:`, rowErr);
        failed.push({
          index,
          name: account_name,
          error: rowErr.message || "Unknown error",
        });
      }
    }

    return res.status(201).json({
      success: true,
      message: `Processed ${rows.length} row(s): ${created.length} created, ${failed.length} failed`,
      summary: {
        total: rows.length,
        created: created.length,
        failed: failed.length,
      },
      data: { created, failed },
    });
  } catch (error) {
    console.error("Error in bulk bank account creation:", error);
    return res.status(500).json({
      success: false,
      message: `Bulk bank account creation failed: ${error.message}`,
      error: error.message,
    });
  }
};

exports.getBankAccounts = async (req, res) => {
  try {
    const { facilityId } = req.query;
    if (!facilityId) {
      return res.json({
        success: false,
        message: "facilityId is required",
      });
    }

    const bankAccounts = await db.sequelize.query(
      `SELECT
        bld.*,
        lr.last_reconciled
      FROM bank_list_data bld
      LEFT JOIN (
        SELECT
          bs.bank_account_id,
          MAX(bst.updated_at) as last_reconciled
        FROM bank_statement_transactions bst
        JOIN bank_statements bs ON bst.bank_statement_id = bs.id
        WHERE bst.reconciled = 'matched'
        GROUP BY bs.bank_account_id
      ) lr ON bld.id = lr.bank_account_id
      WHERE bld.facility_id = :facilityId AND bld.status = 'active'`,
      {
        replacements: {
          facilityId,
        },
        type: db.Sequelize.QueryTypes.SELECT,
      }
    );
    console.log(bankAccounts, "==========");
    res.json({
      success: true,
      results: bankAccounts,
    });
  } catch (error) {
    console.error("Error fetching bank accounts:", error);
    res.json({
      success: false,
      message: "Error fetching bank accounts",
      error: error.message,
    });
  }
};

exports.updateBankAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      account_number,
      account_name,
      bank_name,
      bank_code,
      user_id,
      account_bank_type,
      head,
      subhead,
      facilityId,
      category,
    } = req.body;

    if (!id) {
      return res.json({
        success: false,
        message: "Bank account ID is required",
      });
    }

    // Find the bank account
    const bankAccount = await db.bank_account.findOne({
      where: {
        id,
        facilityId,
        status: "active",
      },
    });

    if (!bankAccount) {
      return res.json({
        success: false,
        message: "Bank account not found",
      });
    }

    // Check if account number already exists for another account in this facility
    if (account_number && account_number !== bankAccount.account_number) {
      const existingAccount = await db.bank_account.findOne({
        where: {
          account_number,
          facilityId,
          status: "active",
          id: { [Op.ne]: id },
        },
      });

      if (existingAccount) {
        return res.json({
          success: false,
          message: "Bank account with this account number already exists",
        });
      }
    }

    // Update the bank account
    await bankAccount.update({
      account_number: account_number
        ? String(account_number)
        : bankAccount.account_number,
      account_name: account_name
        ? String(account_name)
        : bankAccount.account_name,
      bank_code: bank_code ? String(bank_code) : bankAccount.bank_code,
      user_id: user_id ? String(user_id) : bankAccount.user_id,
      bank_name: bank_name ? String(bank_name) : bankAccount.bank_name,
      account_bank_type: account_bank_type
        ? String(account_bank_type)
        : bankAccount.account_bank_type,
      head: head ? String(head) : bankAccount.head,
      subhead: subhead ? String(subhead) : bankAccount.subhead,
      category: category !== undefined ? category : bankAccount.category,
    });

    res.json({
      success: true,
      message: "Bank account updated successfully",
      data: bankAccount,
    });
  } catch (error) {
    console.error("Error updating bank account:", error);
    res.json({
      success: false,
      message: "Error updating bank account",
      error: error.message,
    });
  }
};

exports.deleteBankAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId } = req.body;

    if (!id) {
      return res.json({
        success: false,
        message: "Bank account ID is required",
      });
    }

    if (!facilityId) {
      return res.json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Find the bank account
    const bankAccount = await db.bank_account.findOne({
      where: {
        id,
        facilityId,
        status: "active",
      },
    });

    if (!bankAccount) {
      return res.json({
        success: false,
        message: "Bank account not found",
      });
    }

    // Update status to inactive instead of deleting
    await bankAccount.update({
      status: "inactive",
    });

    res.json({
      success: true,
      message: "Bank account deactivated successfully",
    });
  } catch (error) {
    console.error("Error deleting bank account:", error);
    res.json({
      success: false,
      message: "Error deleting bank account",
      error: error.message,
    });
  }
};

// Get bank reconciliation transactions list
exports.getBankReconciliationList = async (req, res) => {
  try {
    const { facilityId, bankId, dateFrom, dateTo } = req.query;

    if (!facilityId) {
      return res.json({
        success: false,
        message: "facilityId is required",
      });
    }

    if (!bankId) {
      return res.json({
        success: false,
        message: "bankId is required",
      });
    }

    // Find the bank account using ORM
    const bankAccount = await db.bank_account.findOne({
      where: {
        id: parseInt(bankId) || bankId,
        facilityId: facilityId,
        status: "active",
      },
    });

    if (!bankAccount) {
      return res.json({
        success: false,
        message: "Bank account not found",
      });
    }

    const parsedBankId = parseInt(bankId) || bankId;
    console.log(
      `Fetching transactions for bank account ID: ${parsedBankId} (original: ${bankId})`
    );
    const accountCode =  bankAccount.head;
    // Build where clause for ledger
    const ledgerWhere = {
      account_code: String(accountCode),
      facility_id: facilityId,
    };

    if (dateFrom && dateTo) {
      ledgerWhere.transaction_date = {
        [db.Sequelize.Op.between]: [dateFrom, dateTo]
      };
    }

    // Fetch transactions from general_ledger using ORM
    const ledgerTransactions = await db.GeneralLedger.findAll({
      where: ledgerWhere,
      order: [
        ["transaction_date", "DESC"],
        ["created_at", "DESC"],
      ],
    });

    // Build where clause for bank statements
    const statementWhere = {
      bank_account_id: parsedBankId,
      facility_id: facilityId,
    };

    // Note: If we have dates, we might want to filter the statement_transactions inside the statement
    // but for now let's filter statements by their statement_date if available
    if (dateFrom && dateTo) {
      statementWhere.start_date = {
        [db.Sequelize.Op.lte]: dateTo
      };
      statementWhere.end_date = {
        [db.Sequelize.Op.gte]: dateFrom
      };
    }

    // Fetch uploaded bank statement transactions
    const bankStatements = await db.bank_statement.findAll({
      where: statementWhere,
      include: [
        {
          model: db.bank_statement_transaction,
          as: "transactions",
          required: false,
          where: dateFrom && dateTo ? {
            transaction_date: {
              [db.Sequelize.Op.between]: [dateFrom, dateTo]
            }
          } : undefined
        },
      ],
      order: [["statement_date", "DESC"]],
    });

    console.log(
      `Found ${bankStatements.length} bank statements for account ${parsedBankId}`
    );
    bankStatements.forEach((stmt, idx) => {
      console.log(
        `Statement ${idx + 1}: ${stmt.transactions?.length || 0} transactions`
      );
    });

    // Transform general ledger transactions
    const formattedLedgerTransactions = ledgerTransactions.map((txn) => {
      const debitAmount = parseFloat(txn.dr || 0);
      const creditAmount = parseFloat(txn.cr || 0);
      const isCredit = creditAmount > debitAmount;
      const amount = isCredit ? creditAmount : debitAmount;

      return {
        id: `ledger_${txn.transaction_id}`,
        originalId: txn.transaction_id, // Store actual database ID
        source: "ledger",
        date: txn.transaction_date
          ? new Date(txn.transaction_date).toISOString().split("T")[0]
          : null,
        description:
          txn.transaction_description ||
          txn.purpose_of_payment ||
          "Bank Transaction",
        narration: txn.transaction_description || txn.purpose_of_payment || "",
        amount: amount,
        type: isCredit ? "credit" : "debit",
        reference: txn.reference_number || txn.transaction_ref || "",
        debit: debitAmount,
        credit: creditAmount,
        account_code: txn.account_code,
        account_description: txn.account_description,
        payee: txn.payee,
        cheque_no: txn.cheque_no,
        mode_of_payment: txn.mode_of_payment,
        status: txn.status,
        reconciled: txn.reconciled || "unmatched",
        matched_transaction_id: txn.matched_transaction_id || null,
        created_at: txn.created_at,
        updated_at: txn.updated_at,
      };
    });

    // Transform bank statement transactions
    const formattedStatementTransactions = [];
    bankStatements.forEach((statement) => {
      if (statement.transactions && statement.transactions.length > 0) {
        statement.transactions.forEach((txn) => {
          formattedStatementTransactions.push({
            id: `statement_${txn.id}`,
            originalId: txn.id, // Store actual database ID
            source: "statement",
            statement_id: statement.id,
            statement_date: statement.statement_date,
            date: txn.transaction_date
              ? new Date(txn.transaction_date).toISOString().split("T")[0]
              : null,
            description:
              txn.description || txn.narration || "Bank Statement Transaction",
            narration: txn.narration || txn.description || "",
            amount: parseFloat(txn.amount || 0),
            type: txn.transaction_type || "debit",
            reference: txn.reference || "",
            debit: parseFloat(txn.debit || 0),
            credit: parseFloat(txn.credit || 0),
            balance: txn.balance ? parseFloat(txn.balance) : null,
            reconciled: txn.reconciled || "unmatched",
            matched_transaction_id: txn.matched_transaction_id || null,
            created_at: txn.created_at,
            updated_at: txn.updated_at,
          });
        });
      }
    });

    // Combine and sort all transactions by date (newest first)
    const allTransactions = [
      ...formattedLedgerTransactions,
      ...formattedStatementTransactions,
    ].sort((a, b) => {
      const dateA = a.date ? new Date(a.date) : new Date(0);
      const dateB = b.date ? new Date(b.date) : new Date(0);
      return dateB - dateA;
    });

    console.log(
      `Total transactions: ${allTransactions.length} (${formattedLedgerTransactions.length} ledger, ${formattedStatementTransactions.length} statement)`
    );

    res.json({
      success: true,
      results: allTransactions,
      bankAccount: {
        id: bankAccount.id,
        account_number: bankAccount.account_number,
        account_name: bankAccount.account_name,
        bank_code: bankAccount.bank_code,
        account_bank_type: bankAccount.account_bank_type,
        currency: bankAccount.currency,
        head: bankAccount.head,
        subhead: bankAccount.subhead,
        status: bankAccount.status,
        facilityId: bankAccount.facilityId,
        createdAt: bankAccount.createdAt,
        updatedAt: bankAccount.updatedAt,
      },
      summary: {
        totalTransactions: allTransactions.length,
        ledgerTransactions: formattedLedgerTransactions.length,
        statementTransactions: formattedStatementTransactions.length,
      },
    });
  } catch (error) {
    console.error("Error fetching bank reconciliation list:", error);
    res.json({
      success: false,
      message: "Error fetching bank reconciliation transactions",
      error: error.message,
    });
  }
};

// Upload bank statement with transactions
exports.uploadBankStatement = async (req, res) => {
  try {
    const {
      bankAccountId,
      facilityId,
      transactions,
      uploadedBy,
      startDate,
      endDate,
    } = req.body;

    if (!bankAccountId || !facilityId) {
      return res.json({
        success: false,
        message: "bankAccountId and facilityId are required",
      });
    }

    if (
      !transactions ||
      !Array.isArray(transactions) ||
      transactions.length === 0
    ) {
      return res.json({
        success: false,
        message: "Transactions array is required and cannot be empty",
      });
    }

    // Verify bank account exists
    const bankAccount = await db.bank_account.findOne({
      where: {
        id: bankAccountId,
        facilityId: facilityId,
        status: "active",
      },
    });

    if (!bankAccount) {
      return res.json({
        success: false,
        message: "Bank account not found",
      });
    }

    // Get the latest statement date or use current date
    const latestTransaction = transactions.reduce((latest, txn) => {
      const txnDate = new Date(txn.date);
      return !latest || txnDate > latest ? txnDate : latest;
    }, null);

    const statementDate = latestTransaction || new Date();

    // Use endDate as statement_date if provided, otherwise use latest transaction date
    const finalStatementDate =
      endDate || statementDate.toISOString().split("T")[0];

    // Create bank statement record
    const bankStatement = await db.bank_statement.create({
      bank_account_id: parseInt(bankAccountId),
      facility_id: String(facilityId),
      statement_date: finalStatementDate,
      start_date: startDate || null,
      end_date: endDate || null,
      file_name: req.body.fileName || null,
      file_path: req.body.filePath || null,
      total_transactions: transactions.length,
      uploaded_by: uploadedBy || null,
      status: "processed",
    });

    // Create transaction records
    const transactionRecords = transactions.map((txn, index) => {
      // Parse date properly
      let transactionDate = txn.date;
      if (!transactionDate) {
        transactionDate = new Date().toISOString().split("T")[0];
      } else {
        try {
          const parsedDate = new Date(transactionDate);
          if (isNaN(parsedDate.getTime())) {
            // Invalid date, use current date
            transactionDate = new Date().toISOString().split("T")[0];
          } else {
            // Valid date, format it
            transactionDate = parsedDate.toISOString().split("T")[0];
            // Check if date is unreasonably old (before 1970-01-02 means likely invalid)
            if (parsedDate < new Date("1970-01-02")) {
              transactionDate = new Date().toISOString().split("T")[0];
            }
          }
        } catch (e) {
          transactionDate = new Date().toISOString().split("T")[0];
        }
      }

      return {
        bank_statement_id: bankStatement.id,
        transaction_date: transactionDate,
        description: txn.description || txn.narration || "Bank Transaction",
        narration: txn.narration || txn.description || "",
        amount: parseFloat(txn.amount || 0),
        debit: parseFloat(txn.debit || (txn.type === "debit" ? txn.amount : 0)),
        credit: parseFloat(
          txn.credit || (txn.type === "credit" ? txn.amount : 0)
        ),
        transaction_type:
          txn.type || (parseFloat(txn.amount || 0) >= 0 ? "credit" : "debit"),
        reference: txn.reference || txn.reference_number || `REF${index}`,
        balance:
          txn.balance != null && txn.balance !== ""
            ? parseFloat(txn.balance)
            : null,
        row_number: index + 1,
      };
    });

    await db.bank_statement_transaction.bulkCreate(transactionRecords);

    // Log the bank statement upload
    const userId = uploadedBy || req.user?.id || "";
    const totalAmount = transactions.reduce(
      (sum, txn) => sum + Math.abs(parseFloat(txn.amount || 0)),
      0
    );
    await logReconciliationActivity({
      type: "Bank Reconciliation",
      name: "Bank Statement Uploaded",
      role: "",
      id_link: `bank_statement_${bankStatement.id}`,
      remark: `Bank statement uploaded for account ${
        bankAccount.account_number
      } (${
        bankAccount.account_name
      }). Statement Date: ${finalStatementDate}, Total Transactions: ${
        transactions.length
      }, Period: ${startDate || "N/A"} to ${endDate || "N/A"}`,
      user_id: userId,
      query_type: "Bank Statement Upload",
      status: "processed",
      amount: totalAmount,
      facilityId: facilityId,
    });

    console.log(
      `Successfully uploaded bank statement: ${bankStatement.id} with ${transactionRecords.length} transactions for account ${bankAccountId}`
    );

    res.json({
      success: true,
      message: "Bank statement uploaded successfully",
      data: {
        bankStatementId: bankStatement.id,
        totalTransactions: transactions.length,
        bankAccountId: bankAccountId,
      },
    });
  } catch (error) {
    console.error("Error uploading bank statement:", error);
    res.json({
      success: false,
      message: "Error uploading bank statement",
      error: error.message,
    });
  }
};

// Get bank statements for an account
exports.getBankStatements = async (req, res) => {
  try {
    const { facilityId, bankAccountId } = req.query;

    if (!facilityId || !bankAccountId) {
      return res.json({
        success: false,
        message: "facilityId and bankAccountId are required",
      });
    }

    const bankStatements = await db.bank_statement.findAll({
      where: {
        bank_account_id: bankAccountId,
        facility_id: facilityId,
      },
      include: [
        {
          model: db.bank_statement_transaction,
          as: "transactions",
          required: false,
        },
      ],
      order: [
        ["statement_date", "DESC"],
        ["created_at", "DESC"],
      ],
    });

    res.json({
      success: true,
      results: bankStatements,
    });
  } catch (error) {
    console.error("Error fetching bank statements:", error);
    res.json({
      success: false,
      message: "Error fetching bank statements",
      error: error.message,
    });
  }
};

// Get transactions for a specific bank statement
exports.getBankStatementTransactions = async (req, res) => {
  try {
    const { statementId } = req.params;

    if (!statementId) {
      return res.json({
        success: false,
        message: "statementId is required",
      });
    }

    const transactions = await db.bank_statement_transaction.findAll({
      where: {
        bank_statement_id: statementId,
      },
      order: [
        ["transaction_date", "DESC"],
        ["row_number", "ASC"],
      ],
    });

    res.json({
      success: true,
      results: transactions,
    });
  } catch (error) {
    console.error("Error fetching bank statement transactions:", error);
    res.json({
      success: false,
      message: "Error fetching bank statement transactions",
      error: error.message,
    });
  }
};

// Matching Rules CRUD Operations
exports.createMatchingRule = async (req, res) => {
  try {
    const {
      name,
      priority,
      threshold,
      autoApprove,
      conditions,
      facilityId,
      createdBy,
    } = req.body;

    // Validate required fields
    if (
      !name ||
      !conditions ||
      !Array.isArray(conditions) ||
      conditions.length === 0 ||
      !facilityId
    ) {
      return res.json({
        success: false,
        message:
          "Missing required fields: name, conditions (array), and facilityId",
      });
    }

    // Validate conditions structure
    const validConditions = conditions.every(
      (cond) =>
        cond.field &&
        cond.operator &&
        cond.hasOwnProperty("value") &&
        cond.weight
    );

    if (!validConditions) {
      return res.json({
        success: false,
        message:
          "Invalid conditions format. Each condition must have: field, operator, value, and weight",
      });
    }

    // Create new matching rule
    const matchingRule = await db.bank_matching_rule.create({
      name: String(name),
      priority: priority ? parseInt(priority) : 1,
      threshold: threshold ? parseFloat(threshold) : 0.7,
      auto_approve: autoApprove || false,
      conditions: conditions,
      facility_id: String(facilityId),
      created_by: createdBy || null,
      status: "active",
    });

    res.json({
      success: true,
      message: "Matching rule created successfully",
      data: matchingRule,
    });
  } catch (error) {
    console.error("Error creating matching rule:", error);
    res.json({
      success: false,
      message: "Error creating matching rule",
      error: error.message,
    });
  }
};

exports.getMatchingRules = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.json({
        success: false,
        message: "facilityId is required",
      });
    }

    const matchingRules = await db.bank_matching_rule.findAll({
      where: {
        facility_id: facilityId,
        status: "active",
      },
      order: [
        ["priority", "DESC"],
        ["created_at", "DESC"],
      ],
    });

    // Transform rules to match frontend format
    const transformedRules = matchingRules.map((rule) => ({
      id: rule.id.toString(),
      name: rule.name,
      priority: rule.priority,
      threshold: parseFloat(rule.threshold),
      autoApprove: rule.auto_approve,
      conditions: rule.conditions || [],
    }));

    res.json({
      success: true,
      results: transformedRules,
    });
  } catch (error) {
    console.error("Error fetching matching rules:", error);
    res.json({
      success: false,
      message: "Error fetching matching rules",
      error: error.message,
    });
  }
};

exports.getMatchingRuleById = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId } = req.query;

    if (!id) {
      return res.json({
        success: false,
        message: "Rule ID is required",
      });
    }

    if (!facilityId) {
      return res.json({
        success: false,
        message: "facilityId is required",
      });
    }

    const matchingRule = await db.bank_matching_rule.findOne({
      where: {
        id: parseInt(id),
        facility_id: facilityId,
        status: "active",
      },
    });

    if (!matchingRule) {
      return res.json({
        success: false,
        message: "Matching rule not found",
      });
    }

    // Transform rule to match frontend format
    const transformedRule = {
      id: matchingRule.id.toString(),
      name: matchingRule.name,
      priority: matchingRule.priority,
      threshold: parseFloat(matchingRule.threshold),
      autoApprove: matchingRule.auto_approve,
      conditions: matchingRule.conditions || [],
    };

    res.json({
      success: true,
      data: transformedRule,
    });
  } catch (error) {
    console.error("Error fetching matching rule:", error);
    res.json({
      success: false,
      message: "Error fetching matching rule",
      error: error.message,
    });
  }
};

exports.updateMatchingRule = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, priority, threshold, autoApprove, conditions, facilityId } =
      req.body;

    if (!id) {
      return res.json({
        success: false,
        message: "Rule ID is required",
      });
    }

    if (!facilityId) {
      return res.json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Find the matching rule
    const matchingRule = await db.bank_matching_rule.findOne({
      where: {
        id: parseInt(id),
        facility_id: facilityId,
        status: "active",
      },
    });

    if (!matchingRule) {
      return res.json({
        success: false,
        message: "Matching rule not found",
      });
    }

    // Validate conditions if provided
    if (conditions && Array.isArray(conditions) && conditions.length > 0) {
      const validConditions = conditions.every(
        (cond) =>
          cond.field &&
          cond.operator &&
          cond.hasOwnProperty("value") &&
          cond.weight
      );

      if (!validConditions) {
        return res.json({
          success: false,
          message:
            "Invalid conditions format. Each condition must have: field, operator, value, and weight",
        });
      }
    }

    // Update the matching rule
    const updateData = {};
    if (name !== undefined) updateData.name = String(name);
    if (priority !== undefined) updateData.priority = parseInt(priority);
    if (threshold !== undefined) updateData.threshold = parseFloat(threshold);
    if (autoApprove !== undefined)
      updateData.auto_approve = Boolean(autoApprove);
    if (conditions !== undefined) updateData.conditions = conditions;

    await matchingRule.update(updateData);

    res.json({
      success: true,
      message: "Matching rule updated successfully",
      data: matchingRule,
    });
  } catch (error) {
    console.error("Error updating matching rule:", error);
    res.json({
      success: false,
      message: "Error updating matching rule",
      error: error.message,
    });
  }
};

exports.deleteMatchingRule = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId } = req.body;

    if (!id) {
      return res.json({
        success: false,
        message: "Rule ID is required",
      });
    }

    if (!facilityId) {
      return res.json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Find the matching rule
    const matchingRule = await db.bank_matching_rule.findOne({
      where: {
        id: parseInt(id),
        facility_id: facilityId,
        status: "active",
      },
    });

    if (!matchingRule) {
      return res.json({
        success: false,
        message: "Matching rule not found",
      });
    }

    // Update status to inactive instead of deleting
    await matchingRule.update({
      status: "inactive",
    });

    res.json({
      success: true,
      message: "Matching rule deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting matching rule:", error);
    res.json({
      success: false,
      message: "Error deleting matching rule",
      error: error.message,
    });
  }
};

// Save matched transactions
exports.saveMatch = async (req, res) => {
  try {
    const {
      facilityId,
      bankAccountId,
      bankTransactionId,
      ledgerTransactionId,
      bankAmount: reqBankAmount,
      ledgerAmount: reqLedgerAmount,
      bankDate: reqBankDate,
      ledgerDate: reqLedgerDate,
      createdBy,
      user_id,
    } = req.body;

    if (!facilityId || !bankTransactionId || !ledgerTransactionId) {
      return res.json({
        success: false,
        message:
          "Missing required fields: facilityId, bankTransactionId, ledgerTransactionId",
      });
    }

    // Convert to arrays
    let bankTxnIds = Array.isArray(bankTransactionId) ? bankTransactionId : [bankTransactionId];
    let ledgerTxnIds = Array.isArray(ledgerTransactionId) ? ledgerTransactionId : [ledgerTransactionId];

    const parsedBankTxnIds = bankTxnIds.map(id => {
      const parsed = parseInt(id) || id;
      return typeof parsed === 'string' && parsed.startsWith('statement_') ? parsed.replace('statement_', '') : parsed;
    });

    const parsedLedgerTxnIds = ledgerTxnIds.map(id => {
      const parsed = parseInt(id) || id;
      return typeof parsed === 'string' && parsed.startsWith('ledger_') ? parsed.replace('ledger_', '') : parsed;
    });

    // Get all bank statement transactions
    const bankStatementTxns = await db.bank_statement_transaction.findAll({
      where: {
        id: parsedBankTxnIds,
      },
    });

    if (!bankStatementTxns || bankStatementTxns.length === 0) {
      return res.json({
        success: false,
        message: `Bank statement transactions not found`,
      });
    }

    // Get all general ledger transactions
    const ledgerTxns = await db.GeneralLedger.findAll({
      where: {
        transaction_id: parsedLedgerTxnIds,
        facility_id: facilityId,
      },
    });

    if (!ledgerTxns || ledgerTxns.length === 0) {
      return res.json({
        success: false,
        message: `General ledger transactions not found`,
      });
    }

    // Update bank statement transactions
    for (const bankTxn of bankStatementTxns) {
      await bankTxn.update({
        reconciled: "matched",
        matched_transaction_id: parsedLedgerTxnIds.join(','),
      });
    }

    // Update general ledger transactions
    for (const ledgerTxn of ledgerTxns) {
      await ledgerTxn.update({
        reconciled: "matched",
      });
    }

    // Calculate sum of amounts
    const bankAmount = reqBankAmount !== undefined
      ? parseFloat(reqBankAmount || 0)
      : bankStatementTxns.reduce((sum, txn) => sum + parseFloat(txn.amount || 0), 0);

    const ledgerAmount = reqLedgerAmount !== undefined
      ? parseFloat(reqLedgerAmount || 0)
      : ledgerTxns.reduce((sum, txn) => sum + Math.abs(parseFloat(txn.dr || 0) - parseFloat(txn.cr || 0)), 0);

    // Get dates for discrepancy checking (use first one if multiple)
    const bankDate = reqBankDate || bankStatementTxns[0].date || bankStatementTxns[0].transaction_date;
    const ledgerDate = reqLedgerDate || ledgerTxns[0].date || ledgerTxns[0].transaction_date;

    // Check for discrepancies
    let discrepancyCreated = false;
    const amountDiff = Math.abs(Math.abs(bankAmount) - Math.abs(ledgerAmount));
    const hasAmountMismatch = amountDiff >= 0.01;

    let hasDateMismatch = false;
    let daysDiff = 0;
    if (bankDate && ledgerDate) {
      const bankDateObj = new Date(bankDate);
      const ledgerDateObj = new Date(ledgerDate);
      daysDiff = Math.abs((bankDateObj - ledgerDateObj) / (1000 * 60 * 60 * 24));
      hasDateMismatch = daysDiff > 7;
    }

    // Auto-create discrepancy if mismatches detected
    if (hasAmountMismatch || hasDateMismatch) {
      let discrepancyType = "other";
      if (hasAmountMismatch && hasDateMismatch) {
        discrepancyType = "amount_mismatch";
      } else if (hasAmountMismatch) {
        discrepancyType = "amount_mismatch";
      } else if (hasDateMismatch) {
        discrepancyType = "date_mismatch";
      }

      let description = "";
      if (hasAmountMismatch) {
        description += `Amount mismatch: Bank ${Math.abs(bankAmount).toFixed(2)} vs Ledger ${Math.abs(ledgerAmount).toFixed(2)} (Difference: ${amountDiff.toFixed(2)}). `;
      }
      if (hasDateMismatch) {
        description += `Date mismatch: ${Math.round(daysDiff)} days apart.`;
      }

      try {
        const discrepancy = await db.bank_discrepancy.create({
          facility_id: String(facilityId),
          bank_account_id: parseInt(bankAccountId),
          bank_transaction_id: parsedBankTxnIds[0], // link to first one
          ledger_transaction_id: parsedLedgerTxnIds[0],
          discrepancy_type: discrepancyType,
          description: description.trim(),
          bank_amount: Math.abs(bankAmount),
          ledger_amount: Math.abs(ledgerAmount),
          difference: bankAmount - ledgerAmount,
          severity: "medium",
          status: "open",
          notes: "Auto-created during manual match (Multi-select)",
          created_by: createdBy || user_id || null,
        });

        discrepancyCreated = true;

        const userId = createdBy || user_id || req.user?.id || "";
        await logReconciliationActivity({
          type: "Bank Reconciliation",
          name: "Discrepancy Auto-Created",
          role: "",
          id_link: `discrepancy_${discrepancy.id}`,
          remark: `Discrepancy auto-created during match: ${description.trim()}`,
          user_id: userId,
          query_type: "Discrepancy Auto-Creation",
          status: "open",
          amount: Math.abs(amountDiff),
          facilityId: facilityId,
        });
      } catch (discrepancyError) {
        console.error("Error auto-creating discrepancy:", discrepancyError);
      }
    }

    // Log the reconciliation activity
    const userId = createdBy || user_id || req.user?.id || "";
    await logReconciliationActivity({
      type: "Bank Reconciliation",
      name: "Transaction Matched",
      role: "",
      id_link: `bank_${parsedBankTxnIds.join('_')}_ledger_${parsedLedgerTxnIds.join('_')}`,
      remark: `Matched bank statement transaction(s) (${parsedBankTxnIds.join(',')}) with ledger transaction(s) (${parsedLedgerTxnIds.join(',')}). Bank Amount: ${bankAmount}, Ledger Amount: ${ledgerAmount}`,
      user_id: userId,
      query_type: "Reconciliation Match",
      status: "matched",
      amount: bankAmount,
      facilityId: facilityId,
    });

    console.log(`Successfully matched: Bank Transactions [${parsedBankTxnIds.join(',')}] <-> Ledger Transactions [${parsedLedgerTxnIds.join(',')}]`);

    res.json({
      success: true,
      message: discrepancyCreated
        ? "Match saved successfully, but discrepancies were detected and recorded"
        : "Match saved successfully",
      discrepancyCreated: discrepancyCreated,
      data: {
        bankTransactionId: parsedBankTxnIds,
        ledgerTransactionId: parsedLedgerTxnIds,
      },
    });
  } catch (error) {
    console.error("Error saving match:", error);
    res.json({
      success: false,
      message: "Error saving match",
      error: error.message,
    });
  }
};

exports.getReconciliationReportData = async (req, res) => {
  try {
    const { facilityId, bankAccountId, fromDate, toDate } = req.query;

    if (!facilityId || !bankAccountId) {
      return res.json({
        success: false,
        message: "facilityId and bankAccountId are required",
      });
    }

    const start = fromDate || moment().startOf('month').format("YYYY-MM-DD");
    const end = toDate || moment().endOf('month').format("YYYY-MM-DD");

    // 1. Get Bank Account Details
    const bankAccount = await db.bank_account.findOne({
      where: { id: bankAccountId, facilityId }
    });

    if (!bankAccount) {
      return res.json({ success: false, message: "Bank account not found" });
    }

    // 2. Bank statement closing balance (last Balance column, or computed from lines)
    const bankStatementBalance = await resolveBankStatementBalance(
      bankAccountId,
      facilityId,
      end,
      start,
    );

    // 3. Get Book Balance (GL sum)
    const accountCode = bankAccount.get('head') || bankAccount.head;

    if (!accountCode || String(accountCode) === "undefined" || String(accountCode) === "null") {
      return res.json({
        success: false,
        message: `Bank account "${bankAccount.account_name}" is not linked to any General Ledger account head. Please update the bank account settings.`
      });
    }

    const safeAccountCode = String(accountCode);
    const safeFacilityId = String(facilityId);

    console.log(`Generating report for account_code: ${safeAccountCode}, facilityId: ${safeFacilityId}`);

    const ledgerSum = await db.GeneralLedger.findOne({
      attributes: [[db.sequelize.fn('SUM', db.sequelize.literal('dr - cr')), 'balance']],
      where: {
        account_code: safeAccountCode,
        facility_id: safeFacilityId,
        transaction_date: { [Op.lte]: end }
      }
    });

    const bookBalance = ledgerSum ? parseFloat(ledgerSum.dataValues.balance || 0) : 0;

    // 4. Get Reconciled Entries (Matched pairs)
    // We'll fetch matched statement transactions
    const reconciledEntries = await db.bank_statement_transaction.findAll({
      include: [{
        model: db.bank_statement,
        where: { bank_account_id: bankAccountId, facility_id: facilityId }
      }],
      where: {
        reconciled: 'matched',
        transaction_date: { [Op.between]: [start, end] }
      },
      order: [['transaction_date', 'ASC']]
    });

    // 5. Unreconciled Statement Entries (In Bank but not in App)
    const unrecordedEntries = await db.bank_statement_transaction.findAll({
      include: [{
        model: db.bank_statement,
        where: { bank_account_id: bankAccountId, facility_id: facilityId }
      }],
      where: {
        reconciled: 'unmatched',
        transaction_date: { [Op.between]: [start, end] }
      },
      order: [['transaction_date', 'ASC']]
    });

    // 6. Unreconciled Ledger Entries (In App but not in Bank)
    const unpresentedEntries = await db.GeneralLedger.findAll({
      where: {
        account_code: safeAccountCode,
        facility_id: safeFacilityId,
        reconciled: 'unmatched',
        transaction_date: { [Op.between]: [start, end] }
      },
      order: [['transaction_date', 'ASC']]
    });

    // Charges & interest: general_ledger.type = 'charges' | 'interest' for this bank_account_id
    const interestEarned = await sumGeneralLedgerByType(
      safeFacilityId,
      bankAccountId,
      "interest",
      start,
      end,
    );
    const bankCharges = await sumGeneralLedgerByType(
      safeFacilityId,
      bankAccountId,
      "charges",
      start,
      end,
    );

    let paymentsInBooksNotInBank = 0;
    let depositsInTransit = 0;
    unpresentedEntries.forEach((t) => {
      const dr = parseFloat(t.dr || 0);
      const cr = parseFloat(t.cr || 0);
      if (dr > cr) paymentsInBooksNotInBank += dr - cr;
      else if (cr > dr) depositsInTransit += cr - dr;
    });

    const itemsInBankNotInApp = unrecordedEntries.reduce(
      (sum, t) => sum + statementTxnNet(t),
      0,
    );

    const adjustedBookBalance =
      bookBalance +
      itemsInBankNotInApp +
      interestEarned -
      bankCharges -
      paymentsInBooksNotInBank;

    const adjustedBankBalance =
      bankStatementBalance - depositsInTransit;

    res.json({
      success: true,
      data: {
        bankAccount,
        period: { start, end },
        balances: {
          bankStatement: bankStatementBalance,
          bookBalance: bookBalance,
          adjustedBookBalance,
          adjustedBankBalance,
          adjustedAppBalance: adjustedBookBalance,
          difference: adjustedBookBalance - adjustedBankBalance,
        },
        reconciledEntries,
        unrecordedEntries,
        unpresentedEntries,
        adjustments: {
          interestEarned,
          bankCharges,
          itemsInBankNotInApp,
          paymentsInBooksNotInBank,
          depositsInTransit,
          /** @deprecated use paymentsInBooksNotInBank */
          unclearedPayments: paymentsInBooksNotInBank,
        },
      },
    });

  } catch (error) {
    console.error("Error generating reconciliation report:", error);
    res.json({
      success: false,
      message: "Error generating reconciliation report",
      error: error.message
    });
  }
};

exports.reconcileWithDirectPost = async (req, res) => {
  try {
    const {
      facilityId,
      bankAccountId,
      bankTransactionIds, // Array of bank statement transaction IDs
      type, // 'charge' or 'interest'
      accountCode,
      description,
      date,
      amount,
      createdBy,
      user_id,
    } = req.body;

    if (!facilityId || !bankAccountId || !bankTransactionIds || !type || !accountCode || !amount || !date) {
      return res.json({
        success: false,
        message: "Missing required fields",
      });
    }

    // 1. Get bank account details
    const bankAccount = await db.bank_account.findOne({
      where: { id: parseInt(bankAccountId), facilityId: facilityId }
    });

    if (!bankAccount) {
      return res.json({ success: false, message: "Bank account not found" });
    }

    // 2. Get the target account details (e.g., Interest Income or Bank Charge expense)
    const targetAccount = await db.AccountCategory.findOne({
      where: { code: accountCode, facilityId: facilityId }
    });

    if (!targetAccount) {
      return res.json({ success: false, message: "Selected account head not found" });
    }

    // 3. Process each bank transaction individually
    const transactionRefPrefix = `DP-${type.toUpperCase()}-${Date.now()}`;
    const processedResults = [];

    // Fetch all bank transactions at once for efficiency
    const bankTxns = await db.bank_statement_transaction.findAll({
      where: { id: bankTransactionIds }
    });

    for (const bankTxn of bankTxns) {
      const ledgerAmount = Math.abs(parseFloat(bankTxn.amount || 0));
      const txnDescription = bankTxn.description || description;
      const txnDate = date || bankTxn.transaction_date;
      const transactionRef = `${transactionRefPrefix}-${bankTxn.id}`;

      // Debit side
      let drAccount, drSubhead, drDesc, crAccount, crSubhead, crDesc;

      if (type === 'interest') {
        // Interest: Dr Bank (Increase), Cr Income
        drAccount = bankAccount.subhead || bankAccount.head;
        drSubhead = bankAccount.head;
        drDesc = `${bankAccount.account_name} - ${bankAccount.account_number}`;

        crAccount = targetAccount.code;
        crSubhead = targetAccount.parentCode;
        crDesc = targetAccount.description;
      } else {
        // Charge: Dr Expense, Cr Bank (Decrease)
        drAccount = targetAccount.code;
        drSubhead = targetAccount.parentCode;
        drDesc = targetAccount.description;

        crAccount = bankAccount.subhead || bankAccount.head;
        crSubhead = bankAccount.head;
        crDesc = `${bankAccount.account_name} - ${bankAccount.account_number}`;
      }

      // Create GL records for this specific transaction
      const ledgerEntryDr = await db.GeneralLedger.create({
        transaction_date: txnDate,
        account_code: drAccount,
        account_subhead: drSubhead,
        dr: ledgerAmount,
        cr: 0,
        account_description: drDesc,
        transaction_description: txnDescription,
        reference_number: transactionRef,
        purpose_of_payment: txnDescription,
        bank_account_id: String(bankAccountId),
        created_by: createdBy || user_id || null,
        facility_id: facilityId,
        status: "saved",
        reconciled: "matched",
        type: type === "interest" ? "interest" : "charges",
        transaction_ref: transactionRef,
      });

      const ledgerEntryCr = await db.GeneralLedger.create({
        transaction_date: txnDate,
        account_code: crAccount,
        account_subhead: crSubhead,
        dr: 0,
        cr: ledgerAmount,
        account_description: crDesc,
        transaction_description: txnDescription,
        reference_number: transactionRef,
        purpose_of_payment: txnDescription,
        bank_account_id: String(bankAccountId),
        created_by: createdBy || user_id || null,
        facility_id: facilityId,
        status: "saved",
        reconciled: "matched",
        type: type === "interest" ? "interest" : "charges",
        transaction_ref: transactionRef,
      });

      // Link this specific bank transaction to its GL entry
      const ledgerId = type === 'interest' ? ledgerEntryDr.transaction_id : ledgerEntryCr.transaction_id;

      await bankTxn.update({
        reconciled: "matched",
        matched_transaction_id: String(ledgerId)
      });

      // Log activity for each individual post
      await logReconciliationActivity({
        type: "Bank Reconciliation",
        name: `Direct Post & Match (${type})`,
        id_link: `ledger_${ledgerId}`,
        remark: `Individual direct post for ${type}: ${txnDescription}`,
        user_id: createdBy || user_id || "",
        query_type: "Direct Post Reconciliation",
        status: "matched",
        amount: ledgerAmount,
        facilityId: facilityId,
      });

      processedResults.push({ bankTxnId: bankTxn.id, ledgerId });
    }

    res.json({
      success: true,
      message: `Successfully posted ${bankTxns.length} individual items as ${type}`,
      data: processedResults
    });
  } catch (error) {
    console.error("Error in reconcileWithDirectPost:", error);
    res.json({
      success: false,
      message: "Error during direct post and match",
      error: error.message,
    });
  }
};

// Undo match
exports.undoMatch = async (req, res) => {
  try {
    const {
      facilityId,
      bankTransactionId,
      ledgerTransactionId,
      createdBy,
      user_id,
    } = req.body;

    if (!facilityId || !bankTransactionId || !ledgerTransactionId) {
      return res.json({
        success: false,
        message: "Missing required fields",
      });
    }

    let bankTxnIds = Array.isArray(bankTransactionId) ? bankTransactionId : [bankTransactionId];
    let ledgerTxnIds = Array.isArray(ledgerTransactionId) ? ledgerTransactionId : [ledgerTransactionId];

    const parsedBankTxnIds = bankTxnIds.map(id => {
      const parsed = parseInt(id) || id;
      return typeof parsed === 'string' && parsed.startsWith('statement_') ? parsed.replace('statement_', '') : parsed;
    });

    const parsedLedgerTxnIds = ledgerTxnIds.map(id => {
      const parsed = parseInt(id) || id;
      return typeof parsed === 'string' && parsed.startsWith('ledger_') ? parsed.replace('ledger_', '') : parsed;
    });

    // Get all transactions
    const bankStatementTxns = await db.bank_statement_transaction.findAll({
      where: {
        id: parsedBankTxnIds,
      },
    });

    const ledgerTxns = await db.GeneralLedger.findAll({
      where: {
        transaction_id: parsedLedgerTxnIds,
        facility_id: facilityId,
      },
    });

    // Update bank statement transactions
    for (const txn of bankStatementTxns) {
      await txn.update({
        reconciled: "unmatched",
        matched_transaction_id: null,
      });
    }

    // Update general ledger transactions
    for (const txn of ledgerTxns) {
      await txn.update({
        reconciled: "unmatched",
      });
    }

    // Log the unmatch activity
    const userId = createdBy || user_id || req.user?.id || "";
    const bankAmount = bankStatementTxns.reduce((sum, txn) => sum + parseFloat(txn.amount || 0), 0);

    await logReconciliationActivity({
      type: "Bank Reconciliation",
      name: "Transaction Unmatched",
      role: "",
      id_link: `bank_${parsedBankTxnIds.join('_')}_ledger_${parsedLedgerTxnIds.join('_')}`,
      remark: `Unmatched bank statement transaction(s) (${parsedBankTxnIds.join(',')}) from ledger transaction(s) (${parsedLedgerTxnIds.join(',')}). Bank Amount: ${bankAmount}`,
      user_id: userId,
      query_type: "Reconciliation Unmatch",
      status: "unmatched",
      amount: bankAmount,
      facilityId: facilityId,
    });

    res.json({
      success: true,
      message: "Match undone successfully",
    });
  } catch (error) {
    console.error("Error undoing match:", error);
    res.json({
      success: false,
      message: "Error undoing match",
      error: error.message,
    });
  }
};

// Create discrepancy
exports.createDiscrepancy = async (req, res) => {
  try {
    const {
      facilityId,
      bankAccountId,
      bankTransactionId,
      ledgerTransactionId,
      discrepancyType,
      description,
      bankAmount,
      ledgerAmount,
      severity,
      notes,
      createdBy,
    } = req.body;

    if (!facilityId || !bankAccountId || !description) {
      return res.json({
        success: false,
        message:
          "Missing required fields: facilityId, bankAccountId, description",
      });
    }

    const difference =
      parseFloat(bankAmount || 0) - parseFloat(ledgerAmount || 0);

    const discrepancy = await db.bank_discrepancy.create({
      facility_id: String(facilityId),
      bank_account_id: parseInt(bankAccountId),
      bank_transaction_id: bankTransactionId
        ? parseInt(bankTransactionId)
        : null,
      ledger_transaction_id: ledgerTransactionId
        ? parseInt(ledgerTransactionId)
        : null,
      discrepancy_type: discrepancyType || "other",
      description: String(description),
      bank_amount: parseFloat(bankAmount || 0),
      ledger_amount: parseFloat(ledgerAmount || 0),
      difference: difference,
      severity: severity || "medium",
      status: "open",
      notes: notes || null,
      created_by: createdBy || null,
    });

    // Log the discrepancy creation
    const userId = createdBy || req.user?.id || "";
    await logReconciliationActivity({
      type: "Bank Reconciliation",
      name: "Discrepancy Created",
      role: "",
      id_link: `discrepancy_${discrepancy.id}`,
      remark: `Discrepancy created: ${description}. Type: ${
        discrepancyType || "other"
      }, Severity: ${severity || "medium"}, Bank Amount: ${
        bankAmount || 0
      }, Ledger Amount: ${ledgerAmount || 0}, Difference: ${difference}${
        bankTransactionId ? `, Bank Transaction ID: ${bankTransactionId}` : ""
      }${
        ledgerTransactionId
          ? `, Ledger Transaction ID: ${ledgerTransactionId}`
          : ""
      }`,
      user_id: userId,
      query_type: "Discrepancy Creation",
      status: "open",
      amount: Math.abs(difference),
      facilityId: facilityId,
    });

    res.json({
      success: true,
      message: "Discrepancy recorded successfully",
      data: discrepancy,
    });
  } catch (error) {
    console.error("Error creating discrepancy:", error);
    res.json({
      success: false,
      message: "Error creating discrepancy",
      error: error.message,
    });
  }
};

// Get discrepancies
exports.getDiscrepancies = async (req, res) => {
  try {
    const { facilityId, bankAccountId, status } = req.query;

    if (!facilityId || !bankAccountId) {
      return res.json({
        success: false,
        message: "facilityId and bankAccountId are required",
      });
    }

    const whereClause = {
      facility_id: facilityId,
      bank_account_id: parseInt(bankAccountId),
    };

    if (status) {
      whereClause.status = status;
    }

    const discrepancies = await db.bank_discrepancy.findAll({
      where: whereClause,
      order: [["created_at", "DESC"]],
    });

    res.json({
      success: true,
      results: discrepancies,
    });
  } catch (error) {
    console.error("Error fetching discrepancies:", error);
    res.json({
      success: false,
      message: "Error fetching discrepancies",
      error: error.message,
    });
  }
};

// Update discrepancy status
exports.updateDiscrepancy = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, resolvedBy } = req.body;

    if (!id) {
      return res.json({
        success: false,
        message: "Discrepancy ID is required",
      });
    }

    const discrepancy = await db.bank_discrepancy.findOne({
      where: {
        id: parseInt(id),
      },
    });

    if (!discrepancy) {
      return res.json({
        success: false,
        message: "Discrepancy not found",
      });
    }

    const updateData = {};
    if (status) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;
    if (status === "resolved" && resolvedBy) {
      updateData.resolved_by = resolvedBy;
      updateData.resolved_at = new Date();
    }

    await discrepancy.update(updateData);

    res.json({
      success: true,
      message: "Discrepancy updated successfully",
      data: discrepancy,
    });
  } catch (error) {
    console.error("Error updating discrepancy:", error);
    res.json({
      success: false,
      message: "Error updating discrepancy",
      error: error.message,
    });
  }
};

// Get reconciliation reports data
exports.getReconciliationReports = async (req, res) => {
  try {
    const { facilityId, bankAccountId, startDate, endDate } = req.query;

    if (!facilityId) {
      return res.json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Set default date range to last 6 months if not provided
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate
      ? new Date(startDate)
      : new Date(new Date().setMonth(end.getMonth() - 6));

    // Build where clause
    const whereClause = {
      facility_id: facilityId,
    };

    if (bankAccountId) {
      whereClause.bank_account_id = parseInt(bankAccountId);
    }

    // Get all transactions for the period
    const allTransactions = await db.GeneralLedger.findAll({
      where: {
        ...whereClause,
        transaction_date: {
          [db.Sequelize.Op.between]: [start, end],
        },
      },
      order: [["transaction_date", "ASC"]],
    });

    // Get discrepancies for the period
    const discrepanciesWhere = {
      facility_id: facilityId,
      created_at: {
        [db.Sequelize.Op.between]: [start, end],
      },
    };

    if (bankAccountId) {
      discrepanciesWhere.bank_account_id = parseInt(bankAccountId);
    }

    const discrepancies = await db.bank_discrepancy.findAll({
      where: discrepanciesWhere,
      order: [["created_at", "DESC"]],
    });

    // Calculate monthly data
    const monthlyDataMap = new Map();
    const currentDate = new Date(start);

    while (currentDate <= end) {
      const monthKey = `${currentDate.getFullYear()}-${String(
        currentDate.getMonth() + 1
      ).padStart(2, "0")}`;
      const monthName = currentDate.toLocaleDateString("en-US", {
        month: "short",
      });

      if (!monthlyDataMap.has(monthKey)) {
        monthlyDataMap.set(monthKey, {
          month: monthName,
          matched: 0,
          unmatched: 0,
          discrepancies: 0,
          totalAmount: 0,
        });
      }

      currentDate.setMonth(currentDate.getMonth() + 1);
    }

    // Process transactions by month
    allTransactions.forEach((txn) => {
      if (!txn.transaction_date) return;

      const txnDate = new Date(txn.transaction_date);
      const monthKey = `${txnDate.getFullYear()}-${String(
        txnDate.getMonth() + 1
      ).padStart(2, "0")}`;

      if (monthlyDataMap.has(monthKey)) {
        const monthData = monthlyDataMap.get(monthKey);
        const amount = Math.abs(
          parseFloat(txn.dr || 0) - parseFloat(txn.cr || 0)
        );

        if (txn.reconciled === "matched") {
          monthData.matched++;
        } else if (txn.reconciled === "unmatched") {
          monthData.unmatched++;
        }

        monthData.totalAmount += amount;
      }
    });

    // Process discrepancies by month
    discrepancies.forEach((disc) => {
      if (!disc.created_at) return;

      const discDate = new Date(disc.created_at);
      const monthKey = `${discDate.getFullYear()}-${String(
        discDate.getMonth() + 1
      ).padStart(2, "0")}`;

      if (monthlyDataMap.has(monthKey)) {
        monthlyDataMap.get(monthKey).discrepancies++;
      }
    });

    const monthlyData = Array.from(monthlyDataMap.values());

    // Calculate reconciliation efficiency
    const reconciliationEfficiency = monthlyData.map((month) => {
      const total = month.matched + month.unmatched;
      const efficiency =
        total > 0 ? Math.round((month.matched / total) * 100) : 0;
      return {
        month: month.month,
        efficiency,
      };
    });

    // Calculate discrepancy type breakdown
    const discrepancyTypeCounts = {};
    discrepancies.forEach((disc) => {
      const type = disc.discrepancy_type || "other";
      discrepancyTypeCounts[type] = (discrepancyTypeCounts[type] || 0) + 1;
    });

    const discrepancyTypeData = [
      {
        name: "Amount Mismatch",
        value: discrepancyTypeCounts["amount_mismatch"] || 0,
        color: "#ef4444",
      },
      {
        name: "Missing Deposits",
        value: discrepancyTypeCounts["missing_deposit"] || 0,
        color: "#f97316",
      },
      {
        name: "Duplicate Entries",
        value: discrepancyTypeCounts["duplicate_entry"] || 0,
        color: "#eab308",
      },
      {
        name: "Date Mismatch",
        value: discrepancyTypeCounts["date_mismatch"] || 0,
        color: "#22c55e",
      },
      {
        name: "Unauthorized",
        value: discrepancyTypeCounts["unauthorized_withdrawal"] || 0,
        color: "#8b5cf6",
      },
      {
        name: "Other",
        value: discrepancyTypeCounts["other"] || 0,
        color: "#6b7280",
      },
    ].filter((item) => item.value > 0);

    // Calculate key metrics
    const totalMatched = allTransactions.filter(
      (t) => t.reconciled === "matched"
    ).length;
    const totalUnmatched = allTransactions.filter(
      (t) => t.reconciled === "unmatched"
    ).length;
    const totalTransactions = allTransactions.length;
    const matchRate =
      totalTransactions > 0
        ? ((totalMatched / totalTransactions) * 100).toFixed(1)
        : 0;

    // Calculate average resolution time for resolved discrepancies
    const resolvedDiscrepancies = discrepancies.filter(
      (d) => d.status === "resolved" && d.resolved_at && d.created_at
    );
    let avgResolutionTime = 0;
    if (resolvedDiscrepancies.length > 0) {
      const totalDays = resolvedDiscrepancies.reduce((sum, disc) => {
        const created = new Date(disc.created_at);
        const resolved = new Date(disc.resolved_at);
        const days = (resolved - created) / (1000 * 60 * 60 * 24);
        return sum + days;
      }, 0);
      avgResolutionTime = (totalDays / resolvedDiscrepancies.length).toFixed(1);
    }

    // Calculate exception rate (discrepancies / total transactions)
    const exceptionRate =
      totalTransactions > 0
        ? ((discrepancies.length / totalTransactions) * 100).toFixed(1)
        : 0;

    // Get previous period for comparison (if we have data)
    const previousStart = new Date(start);
    previousStart.setMonth(
      previousStart.getMonth() - (end.getMonth() - start.getMonth() + 1)
    );
    const previousEnd = new Date(start);

    const previousTransactions = await db.GeneralLedger.findAll({
      where: {
        ...whereClause,
        transaction_date: {
          [Op.between]: [previousStart, previousEnd],
        },
      },
    });

    const previousMatched = previousTransactions.filter(
      (t) => t.reconciled === "matched"
    ).length;
    const previousTotal = previousTransactions.length;
    const previousMatchRate =
      previousTotal > 0 ? (previousMatched / previousTotal) * 100 : 0;
    const matchRateChange = parseFloat(matchRate) - previousMatchRate;

    res.json({
      success: true,
      results: {
        monthlyData,
        reconciliationEfficiency,
        discrepancyTypeData,
        keyMetrics: {
          matchRate: parseFloat(matchRate),
          matchRateChange: matchRateChange.toFixed(1),
          avgResolutionTime: parseFloat(avgResolutionTime),
          monthlyVolume: totalTransactions,
          exceptionRate: parseFloat(exceptionRate),
        },
        summary: {
          totalMatched,
          totalUnmatched,
          totalDiscrepancies: discrepancies.length,
          openDiscrepancies: discrepancies.filter(
            (d) => d.status !== "resolved"
          ).length,
          resolvedDiscrepancies: discrepancies.filter(
            (d) => d.status === "resolved"
          ).length,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching reconciliation reports:", error);
    res.json({
      success: false,
      message: "Error fetching reconciliation reports",
      error: error.message,
    });
  }
};

// Get audit trail logs for bank reconciliation
exports.getAuditTrail = async (req, res) => {
  try {
    const { facilityId, bankAccountId, startDate, endDate, userId } = req.query;

    if (!facilityId) {
      return res.json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Build where clause for logs query
    let logsQuery = `
            SELECT
                l.id,
                l.type,
                l.name,
                l.role,
                l.id_link,
                l.remark,
                l.user_id,
                l.status,
                l.amount,
                l.facilityId,
                l.date,
                CONCAT(u.firstname, ' ', u.lastname) AS user_name,
                u.role AS user_role
            FROM logs l
            LEFT JOIN users u ON l.user_id = u.id
            WHERE l.type = 'Bank Reconciliation'
            AND l.facilityId = :facilityId
        `;

    const replacements = { facilityId };

    // Add optional filters
    if (userId) {
      logsQuery += ` AND l.user_id = :userId`;
      replacements.userId = userId;
    }

    if (startDate) {
      logsQuery += ` AND l.date >= :startDate`;
      replacements.startDate = startDate;
    }

    if (endDate) {
      logsQuery += ` AND l.date <= :endDate`;
      replacements.endDate = endDate;
    }

    // Filter by bank account if provided (check id_link for bank account references)
    if (bankAccountId) {
      logsQuery += ` AND (l.id_link LIKE :bankAccountFilter OR l.remark LIKE :bankAccountFilter2)`;
      replacements.bankAccountFilter = `%bank_account_${bankAccountId}%`;
      replacements.bankAccountFilter2 = `%account ${bankAccountId}%`;
    }

    logsQuery += ` ORDER BY l.date DESC LIMIT 500`;

    const logs = await db.sequelize.query(logsQuery, {
      replacements,
      type: db.Sequelize.QueryTypes.SELECT,
    });

    // Transform logs to match frontend format
    const auditEntries = logs.map((log) => {
      // Parse action from name field (which contains query_type) or name
      let action = log.name || "UNKNOWN_ACTION";

      // Map name/query_type to action format
      const actionMap = {
        "Reconciliation Match": "TRANSACTION_MATCHED",
        "Reconciliation Unmatch": "TRANSACTION_UNMATCHED",
        "Discrepancy Creation": "DISCREPANCY_CREATED",
        "Discrepancy Update": "DISCREPANCY_UPDATED",
        "Bank Statement Upload": "BANK_STATEMENT_IMPORTED",
        "Transaction Matched": "TRANSACTION_MATCHED",
        "Transaction Unmatched": "TRANSACTION_UNMATCHED",
        "Discrepancy Created": "DISCREPANCY_CREATED",
        "Discrepancy Updated": "DISCREPANCY_UPDATED",
        "Bank Statement Uploaded": "BANK_STATEMENT_IMPORTED",
      };

      action = actionMap[action] || action.toUpperCase().replace(/\s+/g, "_");

      // Extract entity type and ID from id_link or remark
      let entityType = "transaction";
      let entityId = log.id_link || "";

      if (log.id_link) {
        if (log.id_link.includes("discrepancy_")) {
          entityType = "discrepancy";
          entityId = log.id_link.replace("discrepancy_", "");
        } else if (log.id_link.includes("bank_statement_")) {
          entityType = "account";
          entityId = log.id_link.replace("bank_statement_", "");
        } else if (
          log.id_link.includes("bank_") &&
          log.id_link.includes("_ledger_")
        ) {
          entityType = "transaction";
          entityId = log.id_link;
        }
      }

      // Extract old/new values from status and remark
      let oldValue = null;
      let newValue = null;

      if (log.status) {
        if (action === "TRANSACTION_MATCHED") {
          oldValue = "unmatched";
          newValue = "matched";
        } else if (action === "TRANSACTION_UNMATCHED") {
          oldValue = "matched";
          newValue = "unmatched";
        } else if (action === "DISCREPANCY_UPDATED") {
          // Try to extract status change from remark
          const statusMatch = log.remark?.match(
            /Status changed from (\w+) to (\w+)/i
          );
          if (statusMatch) {
            oldValue = statusMatch[1];
            newValue = statusMatch[2];
          } else {
            newValue = log.status;
          }
        } else {
          newValue = log.status;
        }
      }

      return {
        id: log.id.toString(),
        timestamp: log.date
          ? new Date(log.date).toISOString()
          : new Date().toISOString(),
        user: log.user_name || "Unknown User",
        action: action,
        description: log.remark || log.name || "Bank reconciliation activity",
        entityType: entityType,
        entityId: entityId,
        oldValue: oldValue,
        newValue: newValue,
        ipAddress: null, // IP address not stored in logs table
        userAgent: null, // User agent not stored in logs table
        amount: log.amount || 0,
      };
    });

    // Calculate statistics
    const totalEntries = auditEntries.length;
    const uniqueUsers = [...new Set(auditEntries.map((e) => e.user))];
    const matchedCount = auditEntries.filter(
      (e) => e.action === "TRANSACTION_MATCHED"
    ).length;
    const lastActivity =
      auditEntries.length > 0 ? auditEntries[0].timestamp : null;

    res.json({
      success: true,
      results: {
        auditEntries,
        statistics: {
          totalEntries,
          uniqueUsers: uniqueUsers.length,
          matchedTransactions: matchedCount,
          lastActivity,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching audit trail:", error);
    console.error("Error stack:", error.stack);
    res.json({
      success: false,
      message: "Error fetching audit trail",
      error: error.message,
      details: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};

// Add interest to bank account
exports.addInterest = async (req, res) => {
  try {
    const {
      facilityId,
      bankAccountId,
      amount,
      date,
      description,
      reference,
      createdBy,
      user_id,
      bankStatementId,
    } = req.body;

    if (!facilityId || !bankAccountId || !amount || !date || !description) {
      return res.json({
        success: false,
        message:
          "Missing required fields: facilityId, bankAccountId, amount, date, description",
      });
    }

    // Get bank account details
    const bankAccount = await db.bank_account.findOne({
      where: {
        id: parseInt(bankAccountId),
        facilityId: facilityId,
        status: "active",
      },
    });

    if (!bankAccount) {
      return res.json({
        success: false,
        message: "Bank account not found",
      });
    }

    const interestAmount = parseFloat(amount);
    const transactionDate = date;

    // Get or create bank statement
    let statementId = bankStatementId;
    if (!statementId) {
      // Find the latest bank statement for this account
      const latestStatement = await db.bank_statement.findOne({
        where: {
          bank_account_id: parseInt(bankAccountId),
          facility_id: facilityId,
        },
        order: [
          ["statement_date", "DESC"],
          ["created_at", "DESC"],
        ],
      });

      if (latestStatement) {
        statementId = latestStatement.id;
      } else {
        // Create a new bank statement if none exists
        const newStatement = await db.bank_statement.create({
          bank_account_id: parseInt(bankAccountId),
          facility_id: facilityId,
          statement_date: transactionDate,
          start_date: transactionDate,
          end_date: transactionDate,
          total_transactions: 0,
          uploaded_by: createdBy || user_id || null,
          status: "processed",
        });
        statementId = newStatement.id;
      }
    }

    // Create bank statement transaction for interest
    const bankStatementTxn = await db.bank_statement_transaction.create({
      bank_statement_id: statementId,
      transaction_date: transactionDate,
      description: description,
      narration: description,
      amount: interestAmount,
      debit: 0,
      credit: interestAmount,
      transaction_type: "credit",
      reference: reference || `INT-${Date.now()}`,
      reconciled: "unmatched",
      row_number: null,
    });

    // Update bank statement total transactions
    await db.bank_statement.increment("total_transactions", {
      where: { id: statementId },
    });

    // Create general ledger entries
    // Debit: Bank Account (increase bank balance)
    // Credit: Interest Income (revenue)
    const bankAccountCode = bankAccount.subhead || bankAccount.head || "";
    const transactionRef = `INT-${bankAccountId}-${Date.now()}`;
    const refNumber = reference || `INT${Date.now().toString().slice(-10)}`; // Limit to 15 chars

    // Debit Bank Account
    await db.GeneralLedger.create({
      transaction_date: transactionDate,
      account_code: bankAccountCode || null,
      account_subhead: bankAccount.head || "BANK",
      dr: interestAmount,
      cr: 0,
      account_description:
        `${bankAccount.account_name} - ${bankAccount.account_number}`.substring(
          0,
          300
        ),
      transaction_description: `Bank Interest: ${description}`.substring(
        0,
        500
      ),
      reference_number: refNumber.substring(0, 15),
      purpose_of_payment: description.substring(0, 150),
      payee: bankAccount.account_name || null,
      bank_account_id: String(bankAccountId),
      cheque_no: null,
      mode_of_payment: null,
      created_by: createdBy || user_id || null,
      facility_id: facilityId,
      updated_by: null,
      status: "saved",
      reconciled: "unmatched",
      type: "interest",
      transaction_ref: transactionRef,
    });

    // Credit Interest Income (you may need to configure this account code)
    // For now, using a generic interest income account code
    await db.GeneralLedger.create({
      transaction_date: transactionDate,
      account_code: "0401", // Interest Income account - adjust as needed
      account_subhead: "INTEREST_INCOME",
      dr: 0,
      cr: interestAmount,
      account_description: "Interest Income",
      transaction_description: `Bank Interest: ${description}`.substring(
        0,
        500
      ),
      reference_number: refNumber.substring(0, 15),
      purpose_of_payment: description.substring(0, 150),
      payee: bankAccount.account_name || null,
      bank_account_id: String(bankAccountId),
      cheque_no: null,
      mode_of_payment: null,
      created_by: createdBy || user_id || null,
      facility_id: facilityId,
      updated_by: null,
      status: "saved",
      reconciled: "unmatched",
      type: "interest",
      transaction_ref: transactionRef,
    });

    // Log the activity
    const userId = createdBy || user_id || req.user?.id || "";
    await logReconciliationActivity({
      type: "Bank Reconciliation",
      name: "Interest Added",
      role: "",
      id_link: `interest_${bankStatementTxn.id}`,
      remark: `Interest added to account ${bankAccount.account_number} (${bankAccount.account_name}). Amount: ${interestAmount}, Date: ${transactionDate}, Description: ${description}`,
      user_id: userId,
      query_type: "Interest Addition",
      status: "processed",
      amount: interestAmount,
      facilityId: facilityId,
    });

    res.json({
      success: true,
      message: "Interest added successfully",
      data: {
        transactionId: bankStatementTxn.id,
        statementId: statementId,
        amount: interestAmount,
      },
    });
  } catch (error) {
    console.error("Error adding interest:", error);
    res.json({
      success: false,
      message: "Error adding interest",
      error: error.message,
    });
  }
};

// Add charges to bank account
exports.addCharges = async (req, res) => {
  try {
    const {
      facilityId,
      bankAccountId,
      amount,
      date,
      description,
      reference,
      chargeType,
      createdBy,
      user_id,
      bankStatementId,
    } = req.body;

    if (
      !facilityId ||
      !bankAccountId ||
      !amount ||
      !date ||
      !description ||
      !chargeType
    ) {
      return res.json({
        success: false,
        message:
          "Missing required fields: facilityId, bankAccountId, amount, date, description, chargeType",
      });
    }

    // Get bank account details
    const bankAccount = await db.bank_account.findOne({
      where: {
        id: parseInt(bankAccountId),
        facilityId: facilityId,
        status: "active",
      },
    });

    if (!bankAccount) {
      return res.json({
        success: false,
        message: "Bank account not found",
      });
    }

    const chargeAmount = parseFloat(amount);
    const transactionDate = date;

    // Get or create bank statement
    let statementId = bankStatementId;
    if (!statementId) {
      // Find the latest bank statement for this account
      const latestStatement = await db.bank_statement.findOne({
        where: {
          bank_account_id: parseInt(bankAccountId),
          facility_id: facilityId,
        },
        order: [
          ["statement_date", "DESC"],
          ["created_at", "DESC"],
        ],
      });

      if (latestStatement) {
        statementId = latestStatement.id;
      } else {
        // Create a new bank statement if none exists
        const newStatement = await db.bank_statement.create({
          bank_account_id: parseInt(bankAccountId),
          facility_id: facilityId,
          statement_date: transactionDate,
          start_date: transactionDate,
          end_date: transactionDate,
          total_transactions: 0,
          uploaded_by: createdBy || user_id || null,
          status: "processed",
        });
        statementId = newStatement.id;
      }
    }

    // Create bank statement transaction for charges
    const bankStatementTxn = await db.bank_statement_transaction.create({
      bank_statement_id: statementId,
      transaction_date: transactionDate,
      description: `${chargeType}: ${description}`,
      narration: description,
      amount: chargeAmount,
      debit: chargeAmount,
      credit: 0,
      transaction_type: "debit",
      reference: reference || `CHG-${Date.now()}`,
      reconciled: "unmatched",
      row_number: null,
    });

    // Update bank statement total transactions
    await db.bank_statement.increment("total_transactions", {
      where: { id: statementId },
    });

    // Create general ledger entries
    // Debit: Bank Charges Expense
    // Credit: Bank Account (decrease bank balance)
    const bankAccountCode = bankAccount.subhead || bankAccount.head || "";
    const transactionRef = `CHG-${bankAccountId}-${Date.now()}`;
    const refNumber = reference || `CHG${Date.now().toString().slice(-10)}`; // Limit to 15 chars

    // Debit Bank Charges Expense
    await db.GeneralLedger.create({
      transaction_date: transactionDate,
      account_code: "0601", // Bank Charges Expense account - adjust as needed
      account_subhead: "BANK_CHARGES",
      dr: chargeAmount,
      cr: 0,
      account_description: `Bank Charges - ${chargeType}`.substring(0, 300),
      transaction_description:
        `Bank Charge: ${chargeType} - ${description}`.substring(0, 500),
      reference_number: refNumber.substring(0, 15),
      purpose_of_payment: description.substring(0, 150),
      payee: bankAccount.account_name || null,
      bank_account_id: String(bankAccountId),
      cheque_no: null,
      mode_of_payment: null,
      created_by: createdBy || user_id || null,
      facility_id: facilityId,
      updated_by: null,
      status: "paid",
      reconciled: "unmatched",
      type: "charges",
      transaction_ref: transactionRef,
    });

    // Credit Bank Account
    await db.GeneralLedger.create({
      transaction_date: transactionDate,
      account_code: bankAccountCode || null,
      account_subhead: bankAccount.head || "BANK",
      dr: 0,
      cr: chargeAmount,
      account_description:
        `${bankAccount.account_name} - ${bankAccount.account_number}`.substring(
          0,
          300
        ),
      transaction_description:
        `Bank Charge: ${chargeType} - ${description}`.substring(0, 500),
      reference_number: refNumber.substring(0, 15),
      purpose_of_payment: description.substring(0, 150),
      payee: bankAccount.account_name || null,
      bank_account_id: String(bankAccountId),
      cheque_no: null,
      mode_of_payment: null,
      created_by: createdBy || user_id || null,
      facility_id: facilityId,
      updated_by: null,
      status: "paid",
      reconciled: "unmatched",
      type: "charges",
      transaction_ref: transactionRef,
    });

    // Log the activity
    const userId = createdBy || user_id || req.user?.id || "";
    await logReconciliationActivity({
      type: "Bank Reconciliation",
      name: "Charges Added",
      role: "",
      id_link: `charges_${bankStatementTxn.id}`,
      remark: `Charges added to account ${bankAccount.account_number} (${bankAccount.account_name}). Type: ${chargeType}, Amount: ${chargeAmount}, Date: ${transactionDate}, Description: ${description}`,
      user_id: userId,
      query_type: "Charges Addition",
      status: "processed",
      amount: chargeAmount,
      facilityId: facilityId,
    });

    res.json({
      success: true,
      message: "Charges added successfully",
      data: {
        transactionId: bankStatementTxn.id,
        statementId: statementId,
        amount: chargeAmount,
      },
    });
  } catch (error) {
    console.error("Error adding charges:", error);
    res.json({
      success: false,
      message: "Error adding charges",
      error: error.message,
    });
  }
};

exports.deleteBankStatementTransactions = async (req, res) => {
  try {
    const { transactionIds, facilityId, user_id } = req.body;

    if (!transactionIds || !Array.isArray(transactionIds) || transactionIds.length === 0) {
      return res.json({
        success: false,
        message: "No transactions selected for deletion",
      });
    }

    // Only allow deleting unmatched transactions to prevent data inconsistency
    const result = await db.bank_statement_transaction.destroy({
      where: {
        id: transactionIds,
        reconciled: 'unmatched'
      }
    });

    if (result > 0) {
      await logReconciliationActivity({
        type: "Bank Reconciliation",
        name: "Delete Statement Transactions",
        remark: `Deleted ${result} unmatched statement transactions`,
        user_id: user_id || "",
        facilityId: facilityId,
        status: "deleted"
      });
    }

    res.json({
      success: true,
      message: `Successfully deleted ${result} unmatched bank statement transactions`,
      count: result
    });
  } catch (error) {
    console.error("Error deleting bank transactions:", error);
    res.json({
      success: false,
      message: "Error deleting bank transactions",
      error: error.message
    });
  }
};
