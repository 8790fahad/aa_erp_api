const db = require("../models");
const account = require("../routes/account");

// controllers/accountController.js
const moment = require("moment");
const { getAndUpdateNumber } = require("../services/numberGen");
// const db = require("../models");

const NORMAL_BALANCE = {
  "Current assets": "debit",
  "Cash and cash equivalents": "debit",
  "Fixed assets": "debit",
  "Non-current assets": "debit",

  "Current liabilities": "credit",
  "Non-current liabilities": "credit",
  "Credit Card": "credit",

  "Owner's equity": "credit",
};

module.exports.create_chart_of_acct = async (req, res) => {
  const transaction = await db.sequelize.transaction();

  try {
    const {
      parentCode,
      level,
      category,
      normalBalance,
      fsSection,
      type,
      accountNature,
      detail,
      facilityId,
      description,
      openingBalance,
      openingBalanceDate,
      accountNumber,
      display = 0,
      openingBalanceEquity,
    } = req.body;
    console.log(req.body);
    if (
      !parentCode ||
      !detail ||
      !facilityId ||
      !description ||
      !openingBalance ||
      !openingBalanceDate ||
      !openingBalanceEquity
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }
    const subhead = head.slice(0, -2);
    console.log(subhead);
    // 1️⃣ Create the chart of account
    const account = await db.Account.create(
      {
        head,
        description,
        account_type,
        subhead,
        type_details,
        type_mnemonic,
        detail_type_mnemonic,
        facilityId,
        display,
        show: 1,
      },
      { transaction }
    );

    // 2️⃣ If no opening balance → finish
    if (Number(opening_balance) === 0) {
      await transaction.commit();
      return res.status(201).json({ success: true, account });
    }

    // 3️⃣ Determine normal side
    const normal = NORMAL_BALANCE[account_type];

    if (!normal) {
      await transaction.rollback();
      return res.status(200).json({
        success: true,
        message: `Account created successfully`,
        account,
      });
    }

    // 4️⃣ Fetch Account and Opening Balance Equity account

    const openingBalanceEquityRecord = await db.Account.findOne({
      where: { head: openingBalanceEquity, facilityId },
    });

    if (!openingBalanceEquityRecord) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Opening Balance Equity account not found: ${opening_balance_equity}`,
      });
    }

    // 5️⃣ Compute double-entry amounts
    let dr = 0;
    let cr = 0;
    let equityDr = 0;
    let equityCr = 0;

    if (normal === "debit") {
      if (opening_balance >= 0) {
        dr = opening_balance;
        equityCr = opening_balance;
      } else {
        cr = Math.abs(opening_balance);
        equityDr = Math.abs(opening_balance);
      }
    } else {
      if (opening_balance >= 0) {
        cr = opening_balance;
        equityDr = opening_balance;
      } else {
        dr = Math.abs(opening_balance);
        equityCr = Math.abs(opening_balance);
      }
    }

    const today = opening_balance_date;
    const ref = `OB-${await getAndUpdateNumber("OB", facilityId)}`;

    // 6️⃣ Ledger Entry 1 → Account Itself
    await db.GeneralLedger.create(
      {
        transaction_date: today,
        account_code: head,
        account_subhead: subhead,
        dr,
        cr,
        account_description: description,
        transaction_description: `Opening balance for ${description}`,
        reference_number: ref,
        purpose_of_payment: "Opening Balance",
        payee: "",
        created_by,
        facility_id: facilityId,
        status: "paid",
        type: "opening_balance",
        transaction_ref: head,
      },
      { transaction }
    );

    // 7️⃣ Ledger Entry 2 → Opening Balance Equity
    await db.GeneralLedger.create(
      {
        transaction_date: today,
        account_code: openingBalanceEquityRecord.head,
        account_subhead: openingBalanceEquityRecord.subhead,
        dr: equityDr,
        cr: equityCr,
        account_description: openingBalanceEquityRecord.description,
        transaction_description: `Opening balance offset for ${description}`,
        reference_number: ref,
        purpose_of_payment: "Opening Balance",
        payee: "",
        created_by,
        facility_id: facilityId,
        status: "paid",
        type: "opening_balance",
        transaction_ref: openingBalanceEquityRecord.head,
      },
      { transaction }
    );

    // 8️⃣ Commit
    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: "Account created with opening balance (double-entry)",
      account,
    });
  } catch (err) {
    console.error("Error creating account:", err);
    await transaction.rollback();
    return res.status(500).json({
      success: false,
      message: "Failed to create account",
      error: err.message,
    });
  }
};

/** Map account_category row to legacy chart_of_acct shape (head / subhead). */
function mapCategoryToChartRow(row) {
  const plain = typeof row.toJSON === "function" ? row.toJSON() : row;
  return {
    ...plain,
    head: plain.code,
    description: plain.description,
    subhead: plain.parentCode,
    parent: plain.code,
    account_type: plain.type || plain.category || "",
    account_category: plain.category || "",
  };
}

async function applyAccountTypeFields(head, facilityId, fields) {
  const {
    typeId,
    detailTypeId,
    typeEnumName,
    detailTypeEnumName,
    typeMnemonic,
    detailTypeMnemonic,
    detailType,
  } = fields;
  if (!typeId && !detailTypeId) return;
  await db.sequelize.query(
    `UPDATE account
     SET typeId = :typeId,
         detailTypeId = :detailTypeId,
         typeEnumName = :typeEnumName,
         detailTypeEnumName = :detailTypeEnumName,
         typeMnemonic = :typeMnemonic,
         detailTypeMnemonic = :detailTypeMnemonic,
         detailType = :detailType
     WHERE head = :head AND facilityId = :facilityId`,
    {
      replacements: {
        head,
        facilityId,
        typeId: typeId || null,
        detailTypeId: detailTypeId || null,
        typeEnumName: typeEnumName || null,
        detailTypeEnumName: detailTypeEnumName || null,
        typeMnemonic: typeMnemonic || null,
        detailTypeMnemonic: detailTypeMnemonic || null,
        detailType: detailType || null,
      },
    },
  );
}

module.exports.chart_of_acct = async (req, res) => {
  const {
    subhead = 0,
    description = "",
    head = 0,
    facilityId = "",
    store = "",
    code = "",
    account_type = "",
    account_category = "",
    bank_code = "",
    account_number = "",
    bank_name = "",
    bank_cbn_code = "",
    account_bank_type = "",
    rate_type = "",
    tax_type = "",
    rate = 0,
    typeId = "",
    detailTypeId = "",
    typeEnumName = "",
    detailTypeEnumName = "",
    typeMnemonic = "",
    detailTypeMnemonic = "",
    detailType = "",
  } = req.body;

  const { query_type = "" } = req.query;

  console.log({ store, facilityId, query_type });

  try {
    let results = [];

    if (query_type === "select" || query_type === "select-all" || !query_type) {
      if (!facilityId) {
        return res
          .status(400)
          .json({ success: false, message: "facilityId is required" });
      }
      const rows = await db.AccountCategory.findAll({
        where: { facilityId, isActive: 1 },
        order: [["code", "ASC"]],
      });
      results = rows.map(mapCategoryToChartRow);
    } else if (query_type === "account_category") {
      const rows = await db.AccountCategory.findAll({
        where: facilityId ? { facilityId, isActive: 1 } : { isActive: 1 },
        attributes: ["id", "description", "code", "category"],
        order: [["code", "ASC"]],
      });
      results = rows.map((r) => {
        const plain = r.toJSON();
        return { id: plain.id, name: plain.description || plain.code };
      });
    } else if (query_type === "create") {
      if (!facilityId || !head) {
        return res.status(400).json({
          success: false,
          message: "head and facilityId are required",
        });
      }
      const account = await db.Account.create({
        head: String(head),
        subhead: subhead ? String(subhead) : null,
        description: description || null,
        facilityId,
        account_type: account_type || null,
        type_details: account_category || null,
        status: "activated",
        show: "true",
        display: 1,
      });
      await applyAccountTypeFields(String(head), facilityId, {
        typeId,
        detailTypeId,
        typeEnumName,
        detailTypeEnumName,
        typeMnemonic,
        detailTypeMnemonic,
        detailType,
      });
      results = [account];
    } else if (query_type === "update") {
      if (!facilityId || !head) {
        return res.status(400).json({
          success: false,
          message: "head and facilityId are required",
        });
      }
      await db.Account.update(
        {
          description: description || undefined,
          account_type: account_type || undefined,
          type_details: account_category || undefined,
        },
        { where: { head: String(head), facilityId } },
      );
      await applyAccountTypeFields(String(head), facilityId, {
        typeId,
        detailTypeId,
        typeEnumName,
        detailTypeEnumName,
        typeMnemonic,
        detailTypeMnemonic,
        detailType,
      });
      results = [{ head, facilityId, description, account_type }];
    } else if (query_type === "delete") {
      if (!facilityId || !head) {
        return res.status(400).json({
          success: false,
          message: "head and facilityId are required",
        });
      }
      await db.Account.update(
        { status: "deactivated" },
        { where: { head: String(head), facilityId } },
      );
      results = [{ head, facilityId, status: "deactivated" }];
    } else {
      return res.status(400).json({
        success: false,
        message: `Unsupported query_type: ${query_type}`,
      });
    }

    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error(err);
    return res.status(400).json({ success: false, message: err.message });
  }
};

module.exports.generateChartOfAccount = async (req, res) => {
  const {
    parent_code = null,
    business_name = null,
    parent_description = null,
    facilityId = "",
    typeId = null,
    detailTypeId = null,
  } = req.body;
  console.log(req.body);
  try {
    // Always ensure facilityId is provided
    if (!facilityId) {
      return res
        .status(400)
        .json({ success: false, message: "facilityId is required" });
    }

    let effectiveParentCode = null;

    // Priority 1: If detailTypeId is provided, use it directly as the parent code
    // detailTypeId already contains the account code (e.g., "1010", "5525")
    if (detailTypeId && detailTypeId !== "" && detailTypeId !== null) {
      effectiveParentCode = detailTypeId;
    }
    // Priority 2: If typeId is provided, use it to determine base code
    else if (typeId !== null && typeId !== undefined && typeId !== "") {
      // Account type base codes mapping (typeId -> base code)
      const accountTypeBaseCodes = {
        0: 1000, // Cash and cash equivalents
        1: 1200, // Accounts receivable (A/R)
        2: 1500, // Current assets
        3: 1400, // Fixed assets
        4: 1600, // Non-current assets
        5: 2000, // Accounts payable (A/P)
        6: 2015, // Credit card
        7: 2500, // Current liabilities
        8: 2800, // Non-current liabilities
        9: 3000, // Owner's equity
        10: 4000, // Income
        11: 5000, // Cost of sales
        12: 6000, // Expenses
        13: 6700, // Other income
        14: 6800, // Other expense
      };

      const typeIdStr = String(typeId);
      const baseCode = accountTypeBaseCodes[typeIdStr];

      if (baseCode) {
        effectiveParentCode = baseCode;
      } else {
        // If typeId doesn't match known types, use it as parent_code
        effectiveParentCode = typeId;
      }
    }
    // Priority 3: Legacy logic - use parent_code if provided
    else if (
      parent_code !== null &&
      parent_code !== undefined &&
      parent_code !== ""
    ) {
      effectiveParentCode =
        business_name === parent_description
          ? ""
          : String(parent_code).trim();
    }

    const code = await db.AccountCategory.generateNextCode(
      effectiveParentCode,
      facilityId,
    );

    res.json({ success: true, code });
  } catch (err) {
    console.error("Error generating account code:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports.budget = (req, res) => {
  const {
    year = "",
    description = "",
    type = 0,
    facilityId = "",
    amount = 0,
    budget_code = "",
    administrative_code = "",
    economic_code = "",
    geo_code = "",
  } = req.body;
  const { query_type = "" } = req.query;

  db.sequelize
    .query(
      `CALL budget(
        :query_type,
        :year,
        :facilityId,
        :type,
        :description,
        :amount,
        :budget_code,
        :administrative_code,
        :economic_code,
        :geo_code
      )`,
      {
        replacements: {
          query_type,
          year,
          facilityId,
          type,
          description,
          amount,
          budget_code,
          administrative_code,
          economic_code,
          geo_code,
        },
      }
    )
    .then((resp) => res.status(200).json({ success: true, results: resp }))
    .catch((err) => res.status(500).json(console.log(err)));
};

module.exports.CreateAccountUpload = async (req, res) => {
  const accounts = req.body.accounts;
  const facilityId = req.body.facilityId;

  if (!Array.isArray(accounts) || accounts.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "No account data provided" });
  }

  const updatedAccounts = accounts.map((account) => ({
    ...account,
    facilityId: account.facilityId || facilityId,
  }));

  console.log(
    "Updated Accounts:",
    updatedAccounts,
    "================> Updated accounts"
  );

  try {
    for (const account of updatedAccounts) {
      const {
        head = "",
        subhead = "",
        description = "",
        facilityId: rowFacilityId = "",
        account_type = "",
        account_category = "",
        typeId = "",
        detailTypeId = "",
        typeEnumName = "",
        detailTypeEnumName = "",
        typeMnemonic = "",
        detailTypeMnemonic = "",
        detailType = "",
      } = account;

      const fid = rowFacilityId || facilityId;
      if (!fid || !head) {
        throw new Error("Each account requires head and facilityId");
      }

      await db.Account.findOrCreate({
        where: { head: String(head), facilityId: fid },
        defaults: {
          head: String(head),
          subhead: subhead ? String(subhead) : null,
          description: description || null,
          facilityId: fid,
          account_type: account_type || null,
          type_details: account_category || null,
          status: "activated",
          show: "true",
          display: 1,
        },
      });

      await applyAccountTypeFields(String(head), fid, {
        typeId,
        detailTypeId,
        typeEnumName,
        detailTypeEnumName,
        typeMnemonic,
        detailTypeMnemonic,
        detailType,
      });
    }

    res.status(200).json({
      success: true,
      message: "All accounts added successfully",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Error occurred while adding accounts",
      error: err.message || err,
    });
  }
};
