const db = require("../models");
const { Op, QueryTypes } = require("sequelize");
const { getAndUpdateNumber } = require("../services/numberGen");

/**
 * Chart rollup: walk parent_code chain to root (validation / hierarchy context).
 */
async function getAccountAncestorCodes(startCode, facilityId, transaction) {
  const ancestors = [];
  let current = startCode;
  for (let depth = 0; depth < 50; depth++) {
    const row = await db.AccountCategory.findOne({
      where: { code: current, facilityId },
      transaction,
      attributes: ["code", "parentCode"],
    });
    if (!row || !row.parentCode) break;
    ancestors.push(row.parentCode);
    current = row.parentCode;
  }
  return ancestors;
}

/**
 * Get account types for dropdown - prefers account_type table, falls back to account_category
 */
exports.getAccountTypesForDropdown = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Prefer account_type table (code, category, type, detail, account_nature)
    let results = [];
    try {
      const accountTypeRows = await db.sequelize.query(
        `SELECT DISTINCT code, category, type, account_nature, normal_balance, fs_section
         FROM account_type
         WHERE facility_id = :facilityId
         AND (is_active = 1 OR is_active IS NULL)
         ORDER BY code, category, type`,
        {
          replacements: { facilityId },
          type: QueryTypes.SELECT,
        },
      );
      if (accountTypeRows && accountTypeRows.length > 0) {
        results = accountTypeRows.map((r) => ({
          ...r,
          level: 2,
        }));
      }
    } catch (e) {
      // account_type table may not exist yet
    }

    // Fallback to account_category
    if (!results || results.length === 0) {
      results = await db.sequelize.query(
        `SELECT DISTINCT COALESCE(type, category) AS type, category, account_nature, code, normal_balance, fs_section, level
         FROM account_category
         WHERE category IS NOT NULL
         AND facility_id = :facilityId
         AND is_active = 1
         AND (level = 2 OR (parent_code IS NOT NULL AND CHAR_LENGTH(parent_code) <= 2))
         ORDER BY category, COALESCE(type, category), code`,
        {
          replacements: { facilityId },
          type: QueryTypes.SELECT,
        },
      );

      if (!results || results.length === 0) {
        results = await db.sequelize.query(
          `SELECT DISTINCT COALESCE(type, category) AS type, category, account_nature, code, normal_balance, fs_section, level
           FROM account_category
           WHERE category IS NOT NULL
           AND facility_id = :facilityId
           AND is_active = 1
           ORDER BY category, COALESCE(type, category), code`,
          {
            replacements: { facilityId },
            type: QueryTypes.SELECT,
          },
        );
      }
    }

    return res.status(200).json({
      success: true,
      results: results,
    });
  } catch (error) {
    console.error("Error fetching account types for dropdown:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching account types",
      error: error.message,
    });
  }
};

/**
 * Get parent accounts for a specific account type (for subaccount selection)
 * Returns parent account candidates under selected account type.
 */
exports.getParentAccountsForAccountType = async (req, res) => {
  try {
    const { parentCode, type, facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const replacements = { facilityId };
    const where = [
      "facility_id = :facilityId",
      "is_active = 1",
    ];

    // Preferred filter: selected account type (e.g. Current assets).
    // The stored value may use underscores ("current_assets") or spaces
    // ("Current Assets"), and may live in `type` or `category`, so normalise
    // both sides (treat "_" and " " as equivalent) before comparing.
    if (type && String(type).trim()) {
      where.push(
        "REPLACE(LOWER(COALESCE(type, category, '')), '_', ' ') = REPLACE(LOWER(:type), '_', ' ')",
      );
      replacements.type = String(type).trim();
    } else if (parentCode && String(parentCode).trim()) {
      // Backward fallback: nature digit filter.
      where.push(
        "CHAR_LENGTH(:parentCode) = 1 AND :parentCode IN ('1','2','3','4','5') AND LEFT(code, 1) = :parentCode",
      );
      replacements.parentCode = String(parentCode).trim();
    }

    const results = await db.sequelize.query(
      `SELECT
         parent_code,
         code as head,
         COALESCE(description, '') as detail,
         COALESCE(type, category) as type,
         description,
         level
       FROM account_category
       WHERE ${where.join(" AND ")}
       ORDER BY level ASC, code ASC, description ASC`,
      {
        replacements,
        type: QueryTypes.SELECT,
      },
    );

    return res.status(200).json({
      success: true,
      results: results,
    });
  } catch (error) {
    console.error("Error fetching parent accounts:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching parent accounts",
      error: error.message,
    });
  }
};

/**
 * Get detail types for a specific account type
 * Prefers account_type table, falls back to account_category
 * Filters by type and optionally by code (from selected Account type)
 * Returns parent_code, head, detail, type
 */
exports.getDetailTypesForAccountType = async (req, res) => {
  try {
    const { type, code, facilityId } = req.query;

    if (!type || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "type and facilityId are required",
      });
    }

    let results = [];
    try {
      const accountTypeReplacements = { type, facilityId };
      let accountTypeWhere = `type = :type AND facility_id = :facilityId AND (is_active = 1 OR is_active IS NULL)`;
      if (code) {
        accountTypeWhere += ` AND code = :code`;
        accountTypeReplacements.code = code;
      }
      const accountTypeRows = await db.sequelize.query(
        `SELECT code as parent_code, code as head, detail, type
         FROM account_type
         WHERE ${accountTypeWhere}
         ORDER BY detail`,
        {
          replacements: accountTypeReplacements,
          type: QueryTypes.SELECT,
        },
      );
      if (accountTypeRows && accountTypeRows.length > 0) {
        results = accountTypeRows;
      }
    } catch (e) {
      // account_type table may not exist yet
    }

    // Fallback to account_category
    if (!results || results.length === 0) {
      const acReplacements = { type, facilityId };
      let acWhere = `COALESCE(type, category) = :type AND detail IS NOT NULL AND facility_id = :facilityId AND is_active = 1`;
      if (code) {
        acWhere += ` AND parent_code = :code`;
        acReplacements.code = code;
      }
      results = await db.sequelize.query(
        `SELECT parent_code, code as head, detail, COALESCE(type, category) AS type
         FROM account_category
         WHERE ${acWhere}
         AND (level = 3 OR (parent_code IS NOT NULL AND CHAR_LENGTH(parent_code) BETWEEN 2 AND 4))
         AND (display = 1 OR display IS NULL)
         ORDER BY detail`,
        {
          replacements: acReplacements,
          type: QueryTypes.SELECT,
        },
      );

      if (!results || results.length === 0) {
        results = await db.sequelize.query(
          `SELECT parent_code, code as head, detail, COALESCE(type, category) AS type
           FROM account_category
           WHERE ${acWhere}
           ORDER BY detail`,
          {
            replacements: acReplacements,
            type: QueryTypes.SELECT,
          },
        );
      }
    }

    return res.status(200).json({
      success: true,
      results: results,
    });
  } catch (error) {
    console.error("Error fetching detail types:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching detail types",
      error: error.message,
    });
  }
};

/**
 * Get account categories formatted for dropdown selection (hierarchical types)
 * Structure: Account Nature (ASSET, LIABILITY) -> Category -> Type -> Detail
 */
exports.getAccountCategoriesForDropdown = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Use SQL query to get all fields needed for table display
      const categories = await db.sequelize.query(
      `SELECT description, code as head, parent_code as subhead, COALESCE(type, category) AS type, account_nature, category
       FROM account_category
       WHERE facility_id = :facilityId
       AND is_active = 1
       ORDER BY category ASC, code ASC`,
      {
        replacements: { facilityId },
        type: QueryTypes.SELECT,
      },
    );

    // Build tree structure from flat list
    const buildTree = (items, parentCode = null) => {
      return items
        .filter((item) => (item.subhead || null) === parentCode)
        .map((item) => ({
          ...item,
          code: item.head,
          parentCode: item.subhead,
          accountNature: item.account_nature,
          children: buildTree(items, item.head),
        }));
    };

    const tree = buildTree(categories);

    // Build hierarchical structure for dropdown
    // Level 1 = Category (category field)
    // Level 2 = Type (type field)
    // Level 3 = Detail (detail field)
    const buildDropdownStructure = (items) => {
      const natureMap = new Map(); // accountNature -> nature object

      items.forEach((item) => {
        const accountNature = item.accountNature;
        const level = item.level;
        const categoryName = item.category;
        const typeName = item.type;
        const detailName = item.detail;
        const code = item.code;
        const parentCode = item.parentCode;

        // Initialize account nature if not exists
        if (!natureMap.has(accountNature)) {
          natureMap.set(accountNature, {
            typeId: accountNature,
            type: accountNature,
            typeMnemonic: accountNature.toLowerCase(),
            accountNature: accountNature,
            children: [],
          });
        }
        const natureObj = natureMap.get(accountNature);

        // Level 1: Category (top level under account nature)
        if (level === 1) {
          const categoryObj = {
            detailTypeId: code,
            detailType: categoryName,
            detailTypeMnemonic: categoryName.toLowerCase().replace(/\s+/g, ""),
            code: code,
            accountNature: accountNature,
            children: [],
          };
          natureObj.children.push(categoryObj);
        }
        // Level 2: Type (under category)
        else if (level === 2 && parentCode) {
          // Find parent category
          const parentCategory = natureObj.children.find(
            (c) => c.code === parentCode,
          );
          if (parentCategory) {
            const typeObj = {
              detailTypeId: code,
              detailType: typeName || categoryName,
              detailTypeMnemonic: (typeName || categoryName)
                .toLowerCase()
                .replace(/\s+/g, ""),
              code: code,
              accountNature: accountNature,
              children: [],
            };
            parentCategory.children.push(typeObj);
          }
        }
        // Level 3: Detail (under type)
        else if (level === 3 && parentCode) {
          // Find parent type by searching through all categories
          for (const category of natureObj.children) {
            const parentType = category.children.find(
              (t) => t.code === parentCode,
            );
            if (parentType) {
              const detailObj = {
                detailTypeId: code,
                detailType: detailName || typeName,
                detailTypeMnemonic: (detailName || typeName)
                  .toLowerCase()
                  .replace(/\s+/g, ""),
                code: code,
                accountNature: accountNature,
              };
              parentType.children.push(detailObj);
              break;
            }
          }
        }
      });

      return Array.from(natureMap.values());
    };

    const dropdownData = buildDropdownStructure(categories);

    return res.status(200).json({
      success: true,
      results: {
        accountTypes: dropdownData,
      },
    });
  } catch (error) {
    console.error("Error fetching account categories for dropdown:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching account categories",
      error: error.message,
    });
  }
};

/**
 * Get all account categories for a facility (hierarchical tree structure)
 */
exports.getAccountCategories = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const categories = await db.sequelize.query(
      `SELECT
        description,
        code AS head,
        parent_code AS subhead,
        COALESCE(type, category) AS type,
        account_nature,
        category,
        subcategory,
        display,
        normal_balance,
        fs_section,
        COALESCE(reporting_behavior, 'fixed') AS reporting_behavior,
        alternate_nature,
        COALESCE(account_role, 'general') AS account_role,
        pl_line,
        is_active
      FROM account_category
      WHERE facility_id = :facilityId
        AND (is_active = 1 OR is_active IS NULL)
      ORDER BY category ASC, code ASC`,
      {
        replacements: { facilityId },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );

    // Convert to tree structure
    const buildTree = (items, parentCode = null) => {
      return items
        .filter((item) => {
          const itemParent = item.subhead || null;
          return itemParent === parentCode;
        })
        .map((item) => {
          const children = buildTree(items, item.head);
          return {
            ...item,
            children: children.length > 0 ? children : [],
            balance: 0,
          };
        });
    };

    const tree = buildTree(categories);

    return res.status(200).json({
      success: true,
      results: tree,
      flat: categories,
    });
  } catch (error) {
    console.error("Error fetching account categories:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching account categories",
      error: error.message,
    });
  }
};

/**
 * Get account types with detail types as a flat table (for Add Account modal)
 * Returns: account_type (category/type), detail_type, code, parent_code, account_nature, level
 */
exports.getAccountTypesWithDetailTypes = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const rows = await db.sequelize.query(
      `SELECT
        code,
        parent_code,
        level,
        category AS account_type,
        COALESCE(type, category) AS type,
        detail AS detail_type,
        description,
        account_nature,
        normal_balance,
        fs_section
       FROM account_category
       WHERE facility_id = :facilityId
         AND is_active = 1
         AND (display = 1 OR display IS NULL)
       ORDER BY code ASC`,
      {
        replacements: { facilityId },
        type: QueryTypes.SELECT,
      },
    );

    return res.status(200).json({
      success: true,
      results: rows,
    });
  } catch (error) {
    console.error("Error fetching account types with detail types:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching account types",
      error: error.message,
    });
  }
};

/**
 * Get a single account category by code
 */
exports.getAccountCategory = async (req, res) => {
  try {
    const { code, facilityId } = req.query;

    if (!code || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "code and facilityId are required",
      });
    }

    const category = await db.AccountCategory.findOne({
      where: {
        code,
        facilityId,
        isActive: true,
      },
      include: [
        {
          model: db.AccountCategory,
          as: "children",
          required: false,
        },
        {
          model: db.AccountCategory,
          as: "parent",
          required: false,
        },
      ],
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Account category not found",
      });
    }

    return res.status(200).json({
      success: true,
      result: category,
    });
  } catch (error) {
    console.error("Error fetching account category:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching account category",
      error: error.message,
    });
  }
};

/**
 * Resolve an AccountCategory row by explicit code, then by description(s).
 * Used for production waste postings (abnormal loss, scrap inventory) when
 * the client sends no code or an obsolete code.
 *
 * @param {object} opts
 * @param {string} opts.facilityId
 * @param {string} [opts.code]
 * @param {string[]} [opts.descriptionCandidates]
 * @param {import('sequelize').Transaction} [opts.transaction]
 */
exports.findAccountCategoryForFacility = async ({
  facilityId,
  code,
  descriptionCandidates = [],
  transaction,
}) => {
  const normalizeAccountCode = (value) =>
    String(value || "")
      .replace(/[\t\r\n]/g, "")
      .trim();

  const fac = String(facilityId || "").trim();
  const c = normalizeAccountCode(code);

  if (fac && c) {
    const byCode = await db.AccountCategory.findOne({
      where: { code: c, facility_id: fac, is_active: true },
      transaction,
    });
    if (byCode) return byCode;
  }

  if (!fac) return null;

  for (const label of descriptionCandidates) {
    const lit = String(label || "").trim();
    if (!lit) continue;

    let row = await db.AccountCategory.findOne({
      where: {
        facility_id: fac,
        is_active: true,
        description: db.sequelize.where(
          db.sequelize.fn(
            "LOWER",
            db.sequelize.col("description"),
          ),
          "=",
          lit.toLowerCase(),
        ),
      },
      transaction,
    });
    if (row) return row;

    row = await db.AccountCategory.findOne({
      where: {
        facility_id: fac,
        is_active: true,
        description: { [Op.like]: `%${lit}%` },
      },
      transaction,
    });
    if (row) return row;
  }

  return null;
};

/**
 * GET /account/production-default-accounts?facilityId=
 * Returns resolved chart rows for abnormal loss + scrap inventory (business prefs + fallbacks).
 */
exports.getProductionDefaultAccounts = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const BusinessModel = db.business || db.Business;
    const business = BusinessModel
      ? await BusinessModel.findOne({
          where: { id: facilityId },
          attributes: [
            "id",
            "abnormal_loss_account",
            "scrap_inventory_account",
          ],
        })
      : null;

    const abnormalLossAccount =
      await exports.findAccountCategoryForFacility({
        facilityId,
        code: business?.abnormal_loss_account,
        descriptionCandidates: ["Abnormal Loss"],
        transaction: null,
      });

    const scrapInventoryAccount =
      await exports.findAccountCategoryForFacility({
        facilityId,
        code: business?.scrap_inventory_account,
        descriptionCandidates: ["Scrap Inventory"],
        transaction: null,
      });

    return res.status(200).json({
      success: true,
      abnormalLossAccount: abnormalLossAccount
        ? {
            code: abnormalLossAccount.code,
            description: abnormalLossAccount.description,
          }
        : null,
      scrapInventoryAccount: scrapInventoryAccount
        ? {
            code: scrapInventoryAccount.code,
            description: scrapInventoryAccount.description,
          }
        : null,
      businessDefaults: {
        abnormal_loss_account: business?.abnormal_loss_account || null,
        scrap_inventory_account: business?.scrap_inventory_account || null,
      },
    });
  } catch (error) {
    console.error("Error resolving production default accounts:", error);
    return res.status(500).json({
      success: false,
      message: "Error resolving production default accounts",
      error: error.message,
    });
  }
};

/**
 * Create a new account category
 */

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

/**
 * Chart code: new codes are flat six digits [1-5][00001-99999]. Legacy longer numeric codes use segment depth.
 */
function levelFromAccountCode(code) {
  const s = (code || "").toString().trim();
  if (!s || !/^\d+$/.test(s)) return 1;
  if (/^[1-5]\d{5}(\d{5})*$/.test(s)) {
    if (s.length < 6) return 1;
    return 2 + (s.length - 6) / 5;
  }
  return Math.floor((s.length + 1) / 2);
}

function deriveParentCodeFromCode(code) {
  const normalized = (code || "").toString().trim();
  if (!normalized) return null;
  if (/^[1-5]\d{5}$/.test(normalized)) return null;
  if (/^[1-5]\d{5}(\d{5})+$/.test(normalized)) {
    return normalized.slice(0, -5);
  }
  if (normalized.length >= 3 && /^\d+$/.test(normalized)) {
    return normalized.slice(0, -2);
  }
  return null;
}

/** New accounts: exactly six digits — nature 1–5 + five-digit sequence (100001, 100002, …). */
const NATURE_ACCOUNT_CODE_RE = /^[1-5]\d{5}$/;

function isValidStructuredAccountCode(code) {
  return NATURE_ACCOUNT_CODE_RE.test(String(code || "").trim());
}

/** Bulk upload / template: root codes 1–5 or six-digit [1-5]xxxxx. */
function isAllowedUploadedAccountCode(code) {
  const s = String(code || "").trim();
  if (/^[1-5]$/.test(s)) return true;
  return isValidStructuredAccountCode(s);
}

/** First code digit must match account_nature (same map as bulk upload fallbacks). */
const ACCOUNT_NATURE_TO_PREFIX = {
  ASSET: "1",
  LIABILITY: "2",
  EQUITY: "3",
  REVENUE: "4",
  EXPENSE: "5",
};
const ACCOUNT_NATURE_TO_CATEGORY = {
  ASSET: "assets",
  LIABILITY: "liabilities",
  EQUITY: "equity",
  REVENUE: "revenue",
  EXPENSE: "expenses",
};

function normalizeFsSection(value, accountNature) {
  const s = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_");
  if (s === "pl" || s === "profit_and_loss" || s === "p&l" || s === "pnl") {
    return "profit_and_loss";
  }
  if (s === "off_statement" || s === "off") return "off_statement";
  if (s === "bs" || s === "balance_sheet") return "balance_sheet";
  if (["REVENUE", "EXPENSE"].includes(accountNature)) return "profit_and_loss";
  return "balance_sheet";
}

function normalizeNormalBalance(value, accountNature) {
  const s = String(value || "")
    .toLowerCase()
    .trim();
  if (s === "debit" || s === "credit") return s;
  return ["ASSET", "EXPENSE"].includes(accountNature) ? "debit" : "credit";
}

function normalizeReportingBehavior(value) {
  const s = String(value || "")
    .toLowerCase()
    .trim();
  return s === "balance_switch" ? "balance_switch" : "fixed";
}

function normalizeAlternateNature(value) {
  const s = String(value || "")
    .toUpperCase()
    .trim();
  if (["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"].includes(s)) {
    return s;
  }
  return null;
}

function normalizeAccountRole(value) {
  const s = String(value || "")
    .toLowerCase()
    .trim();
  return s || "general";
}

function normalizePlLine(value) {
  if (value === null || value === undefined || value === "") return null;
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_");
}

exports.createAccountCategory = async (req, res) => {
  const transaction = await db.sequelize.transaction();

  try {
    const {
      parentCode = null,
      category,
      subcategory,
      accountType,
      type,
      detail,
      description,
      accountNature,
      normalBalance,
      fsSection = "BS",
      reportingBehavior,
      alternateNature,
      accountRole,
      plLine,
      facilityId,
      openingBalance = 0,
      openingBalanceDate,
      openingBalanceEquity, // e.g., "30101"
      display: displayIn,
      isActive: isActiveIn,
      created_by = "system",
      accountNumber: accountNumberFromClient,
    } = req.body;

    const truthy = (v) =>
      v === true || v === 1 || v === "1" || v === "true";
    const display =
      displayIn === undefined || displayIn === null ? true : truthy(displayIn);
    const isActiveParsed =
      isActiveIn === undefined || isActiveIn === null ? true : truthy(isActiveIn);

    // Required fields (level is derived from final code, not client)
    if (!category || !accountNature || !facilityId || !description) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "category, accountNature, facilityId, and description are required",
      });
    }

    // Generate next hierarchical code using SQL function (or use client-provided account number)
    let code;
    // A code supplied by the client is treated as a manual code: the user may
    // choose any code they want (only uniqueness is enforced). System-generated
    // codes still follow the six-digit nature format.
    const clientCode = (accountNumberFromClient || "")
      .toString()
      .trim();
    const isManualCode = !!(clientCode && /^\d+$/.test(clientCode));
    if (isManualCode) {
      const exists = await db.AccountCategory.findOne({
        where: { code: clientCode, facilityId },
      });
      if (exists) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Account code "${clientCode}" already exists`,
        });
      }
      code = clientCode;
    } else {
      const genParent = parentCode != null ? String(parentCode).trim() : "";
      if (!genParent) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message:
            "Provide accountNumber or parentCode (nature 1–5 or parent account code) to generate the next code.",
        });
      }
      try {
        const result = await db.sequelize.query(
          `SELECT generate_account_code(:parentCode, :facilityId) as code`,
          {
            replacements: {
              parentCode: genParent,
              facilityId: facilityId,
            },
            type: QueryTypes.SELECT,
          },
        );

        if (result && result[0] && result[0].code) {
          code = result[0].code;
        } else {
          code = await db.AccountCategory.generateNextCode(
            genParent,
            facilityId,
          );
        }
      } catch (sqlError) {
        console.log(
          "SQL function not available, using model method:",
          sqlError.message,
        );
        code = await db.AccountCategory.generateNextCode(genParent, facilityId);
      }
    }

    const normalizeParentCodeInput = (v) => {
      const s = (v ?? "").toString().trim();
      if (!s || s === "0" || s === "-" || s === "—" || s === "–") return null;
      return s;
    };

    const level = levelFromAccountCode(code);
    const explicitParentCode = normalizeParentCodeInput(parentCode);
    const parentCodeResolved = explicitParentCode ?? deriveParentCodeFromCode(code);

    // System-generated codes must match the nature prefix. Manual codes are
    // left to the user's choice (nature is still stored via accountNature).
    const expectedDigit = ACCOUNT_NATURE_TO_PREFIX[accountNature];
    if (
      !isManualCode &&
      expectedDigit &&
      String(code).length > 0 &&
      String(code)[0] !== expectedDigit
    ) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Account code must start with ${expectedDigit} for ${accountNature} (e.g. ${expectedDigit}00001).`,
      });
    }

    // Determine normal balance if not provided
    const finalNormalBalance = normalizeNormalBalance(
      normalBalance,
      accountNature,
    );
    const finalFsSection = normalizeFsSection(fsSection, accountNature);
    const finalReportingBehavior = normalizeReportingBehavior(reportingBehavior);
    const finalAlternateNature =
      finalReportingBehavior === "balance_switch"
        ? normalizeAlternateNature(alternateNature) ||
          (accountNature === "LIABILITY" ? "ASSET" : accountNature === "ASSET" ? "LIABILITY" : null)
        : normalizeAlternateNature(alternateNature);
    const finalAccountRole = normalizeAccountRole(accountRole);
    const finalPlLine =
      finalFsSection === "profit_and_loss" ? normalizePlLine(plLine) : normalizePlLine(plLine);

    const normalizedCategory = ACCOUNT_NATURE_TO_CATEGORY[accountNature] || null;
    if (!normalizedCategory) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Invalid accountNature. Must be ASSET, LIABILITY, EQUITY, REVENUE, or EXPENSE.",
      });
    }

    // Create the account
    const accountCategory = await db.AccountCategory.create(
      {
        code,
        description: description.trim(),
        display,
        parentCode: parentCodeResolved || "0",
        level,
        category: normalizedCategory,
        subcategory: subcategory || category || null,
        type: accountType || type || null,
        detail: detail || null,
        accountNature,
        normalBalance: finalNormalBalance,
        fsSection: finalFsSection,
        reportingBehavior: finalReportingBehavior,
        alternateNature: finalAlternateNature,
        accountRole: finalAccountRole,
        plLine: finalPlLine,
        facilityId,
        isActive: isActiveParsed,
      },
      { transaction },
    );

    // If no opening balance → finish
    const openingBalanceAmount = Number(openingBalance);
    if (openingBalanceAmount === 0 || !openingBalanceEquity) {
      await transaction.commit();
      return res.status(201).json({
        success: true,
        message: "Account created successfully",
        data: accountCategory,
      });
    }

    // Find Opening Balance Equity account
    const equityAccount = await db.AccountCategory.findOne({
      where: { code: openingBalanceEquity, facilityId },
      transaction,
    });

    if (!equityAccount) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Opening Balance Equity account not found: ${openingBalanceEquity}`,
      });
    }

    // Calculate Dr/Cr
    let dr = 0,
      cr = 0;
    let equityDr = 0,
      equityCr = 0;
    const absAmount = Math.abs(openingBalanceAmount);

    if (finalNormalBalance === "debit" || finalNormalBalance === "DEBIT") {
      openingBalanceAmount >= 0
        ? ((dr = absAmount), (equityCr = absAmount))
        : ((cr = absAmount), (equityDr = absAmount));
    } else {
      openingBalanceAmount >= 0
        ? ((cr = absAmount), (equityDr = absAmount))
        : ((dr = absAmount), (equityCr = absAmount));
    }

    const ref = `OB-${await getAndUpdateNumber("OB", facilityId)}`;

    // Ledger: New Account
    await db.GeneralLedger.create(
      {
        transaction_date:
          openingBalanceDate || new Date().toISOString().split("T")[0],
        account_code: code,
        account_subhead: parentCodeResolved,
        dr,
        cr,
        account_description: description,
        transaction_description: `Opening Balance - ${description}`,
        reference_number: ref,
        purpose_of_payment: "Opening Balance",
        created_by,
        facility_id: facilityId,
        status: "paid",
        type: "opening_balance",
        transaction_ref: code,
      },
      { transaction },
    );

    // Ledger: Opening Balance Equity (Offset)
    await db.GeneralLedger.create(
      {
        transaction_date:
          openingBalanceDate || new Date().toISOString().split("T")[0],
        account_code: equityAccount.code,
        account_subhead: equityAccount.parentCode,
        dr: equityDr,
        cr: equityCr,
        account_description: equityAccount.description,
        transaction_description: `Offset for ${code} - ${description}`,
        reference_number: ref,
        purpose_of_payment: "Opening Balance Offset",
        created_by,
        facility_id: facilityId,
        status: "paid",
        type: "opening_balance",
        transaction_ref: equityAccount.code,
      },
      { transaction },
    );

    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: "Account + opening balance created successfully",
      data: accountCategory,
      opening_balance_posted: openingBalanceAmount,
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Error creating account category:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create account",
      error: error.message,
    });
  }
};

/**
 * Update an account category
 */
exports.updateAccountCategory = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { code, facilityId } = req.query || req.body;
    const body = req.body || {};

    if (!code || !facilityId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "code and facilityId are required",
      });
    }

    const existing = await db.AccountCategory.findOne({
      where: { code, facilityId },
      transaction,
    });
    if (!existing) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Account category not found",
      });
    }

    const accountNature =
      body.accountNature ||
      body.account_nature ||
      existing.accountNature;

    const updateData = {};

    if (body.description !== undefined) {
      updateData.description = String(body.description).trim();
    }
    if (body.type !== undefined) updateData.type = body.type;
    if (body.category !== undefined) updateData.category = body.category;
    if (body.subcategory !== undefined) updateData.subcategory = body.subcategory;
    if (body.detail !== undefined) updateData.detail = body.detail;
    if (body.accountNature !== undefined || body.account_nature !== undefined) {
      updateData.accountNature =
        body.accountNature || body.account_nature;
    }
    if (body.display !== undefined) {
      updateData.display =
        body.display === true ||
        body.display === 1 ||
        body.display === "1" ||
        body.display === "true";
    }
    if (body.isActive !== undefined || body.is_active !== undefined) {
      const v = body.isActive !== undefined ? body.isActive : body.is_active;
      updateData.isActive =
        v === true || v === 1 || v === "1" || v === "true";
    }

    const normalBalanceIn =
      body.normalBalance !== undefined
        ? body.normalBalance
        : body.normal_balance;
    if (normalBalanceIn !== undefined) {
      updateData.normalBalance = normalizeNormalBalance(
        normalBalanceIn,
        accountNature,
      );
    }

    const fsSectionIn =
      body.fsSection !== undefined ? body.fsSection : body.fs_section;
    if (fsSectionIn !== undefined) {
      updateData.fsSection = normalizeFsSection(fsSectionIn, accountNature);
    }

    const reportingIn =
      body.reportingBehavior !== undefined
        ? body.reportingBehavior
        : body.reporting_behavior;
    if (reportingIn !== undefined) {
      updateData.reportingBehavior = normalizeReportingBehavior(reportingIn);
    }

    const altNatureIn =
      body.alternateNature !== undefined
        ? body.alternateNature
        : body.alternate_nature;
    if (altNatureIn !== undefined) {
      updateData.alternateNature = normalizeAlternateNature(altNatureIn);
    } else if (updateData.reportingBehavior === "balance_switch") {
      const primary = updateData.accountNature || existing.accountNature;
      updateData.alternateNature =
        primary === "LIABILITY"
          ? "ASSET"
          : primary === "ASSET"
            ? "LIABILITY"
            : existing.alternateNature;
    }

    const roleIn =
      body.accountRole !== undefined ? body.accountRole : body.account_role;
    if (roleIn !== undefined) {
      updateData.accountRole = normalizeAccountRole(roleIn);
    }

    const plLineIn = body.plLine !== undefined ? body.plLine : body.pl_line;
    if (plLineIn !== undefined) {
      updateData.plLine = normalizePlLine(plLineIn);
    }

    if (Object.keys(updateData).length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "No updatable fields provided",
      });
    }

    const [updated] = await db.AccountCategory.update(updateData, {
      where: {
        code,
        facilityId,
      },
      returning: true,
      transaction,
    });

    if (updated === 0) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Account category not found",
      });
    }

    const ancestorCodes = await getAccountAncestorCodes(
      code,
      facilityId,
      transaction,
    );

    const accountCategory = await db.AccountCategory.findOne({
      where: { code, facilityId },
      transaction,
    });

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "Account category updated successfully",
      result: accountCategory,
      rollup_parent_codes: ancestorCodes,
    });
  } catch (error) {
    await transaction.rollback().catch(() => {});
    console.error("Error updating account category:", error);
    return res.status(500).json({
      success: false,
      message: "Error updating account category",
      error: error.message,
    });
  }
};

/**
 * Disable (soft delete) an account category - sets isActive to false
 */
exports.disableAccountCategory = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { code, facilityId } = { ...req.body, ...req.query };

    if (!code || !facilityId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "code and facilityId are required",
      });
    }

    // Check if category has active children
    const children = await db.AccountCategory.count({
      where: {
        parentCode: code,
        facilityId,
        isActive: true,
      },
      transaction,
    });

    if (children > 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Cannot disable category with child categories",
      });
    }

    const [updated] = await db.AccountCategory.update(
      { isActive: false },
      {
        where: {
          code,
          facilityId,
        },
        transaction,
      },
    );

    if (updated === 0) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Account category not found",
      });
    }

    const ancestorCodes = await getAccountAncestorCodes(
      code,
      facilityId,
      transaction,
    );

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "Account category disabled successfully",
      rollup_parent_codes: ancestorCodes,
    });
  } catch (error) {
    await transaction.rollback().catch(() => {});
    console.error("Error disabling account category:", error);
    return res.status(500).json({
      success: false,
      message: "Error disabling account category",
      error: error.message,
    });
  }
};

/**
 * Permanent delete an account category.
 * Only allowed when the account code has NO entries in the general_ledger.
 * Runs inside a transaction for atomicity.
 */
exports.deleteAccountCategory = async (req, res) => {
  let transaction;

  try {
    const { code, facilityId } = { ...req.body, ...req.query };

    if (!code || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "code and facilityId are required",
      });
    }

    transaction = await db.sequelize.transaction();

    // Check if account code exists in general_ledger (block delete if used)
    const ledgerCount = await db.GeneralLedger.count({
      where: {
        account_code: code,
        facility_id: facilityId,
      },
      transaction,
    });

    if (ledgerCount > 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Cannot delete account. Code "${code}" has ${ledgerCount} transaction(s) in the general ledger. Use Disable instead.`,
      });
    }

    // Check if category has children
    const children = await db.AccountCategory.count({
      where: {
        parentCode: code,
        facilityId,
      },
      transaction,
    });

    if (children > 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Cannot delete category with child categories",
      });
    }

    const deleted = await db.AccountCategory.destroy({
      where: {
        code,
        facilityId,
      },
      transaction,
    });

    if (deleted === 0) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Account category not found",
      });
    }

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "Account category deleted permanently",
    });
  } catch (error) {
    if (transaction) await transaction.rollback().catch(() => {});
    console.error("Error deleting account category:", error);
    return res.status(500).json({
      success: false,
      message: "Error deleting account category",
      error: error.message,
    });
  }
};

// Valid categories (case-insensitive)
const VALID_CATEGORIES = ["Assets", "Liabilities", "Equity", "Revenue", "Expenses"];
const VALID_CATEGORIES_LOWER = VALID_CATEGORIES.map((c) => c.toLowerCase());

/**
 * Normalize and validate category - must be one of Assets, Liabilities, Equity, Revenue, Expenses
 */
function normalizeCategory(category) {
  if (!category) return null;
  const c = category.toString().trim().toLowerCase();
  const idx = VALID_CATEGORIES_LOWER.indexOf(c);
  return idx >= 0 ? VALID_CATEGORIES[idx] : null;
}

/** Accepts Assets, ASSET, 1–5, etc. */
function normalizeNatureOrCategory(raw) {
  if (!raw) return null;
  const trimmed = raw.toString().trim();
  const fromList = normalizeCategory(trimmed);
  if (fromList) return fromList;
  const upper = trimmed.toUpperCase();
  const enumMap = {
    ASSET: "Assets",
    LIABILITY: "Liabilities",
    EQUITY: "Equity",
    REVENUE: "Revenue",
    EXPENSE: "Expenses",
  };
  if (enumMap[upper]) return enumMap[upper];
  if (/^[1-5]$/.test(trimmed)) {
    const digitMap = {
      1: "Assets",
      2: "Liabilities",
      3: "Equity",
      4: "Revenue",
      5: "Expenses",
    };
    return digitMap[trimmed] || null;
  }
  const lower = trimmed.toLowerCase();
  if (lower === "asset") return "Assets";
  if (lower === "liability") return "Liabilities";
  if (lower === "expense") return "Expenses";
  return null;
}

/**
 * Infer account_nature from category name
 */
function inferAccountNature(category) {
  const normalized = normalizeCategory(category);
  if (!normalized) return null;
  const map = {
    Assets: "ASSET",
    Liabilities: "LIABILITY",
    Equity: "EQUITY",
    Revenue: "REVENUE",
    Expenses: "EXPENSE",
  };
  return map[normalized] || null;
}

/**
 * Post opening balance GL lines (same rules as createAccountCategory).
 * Returns an error string or null on success.
 */
async function postOpeningBalanceForUpload({
  facilityId,
  code,
  description,
  parentCodeResolved,
  accountNature,
  openingBalanceAmount,
  openingBalanceDate,
  openingBalanceEquity,
  created_by,
  transaction,
}) {
  const openingBalanceAmountNum = Number(openingBalanceAmount);
  if (
    !openingBalanceEquity ||
    !Number.isFinite(openingBalanceAmountNum) ||
    openingBalanceAmountNum === 0
  ) {
    return null;
  }
  const equityAccount = await db.AccountCategory.findOne({
    where: { code: openingBalanceEquity, facilityId },
    transaction,
  });
  if (!equityAccount) {
    return `Opening Balance Equity account not found: ${openingBalanceEquity}`;
  }
  const finalNormalBalance = ["ASSET", "EXPENSE"].includes(accountNature)
    ? "DEBIT"
    : "CREDIT";
  let dr = 0;
  let cr = 0;
  let equityDr = 0;
  let equityCr = 0;
  const absAmount = Math.abs(openingBalanceAmountNum);
  if (finalNormalBalance === "DEBIT") {
    if (openingBalanceAmountNum >= 0) {
      dr = absAmount;
      equityCr = absAmount;
    } else {
      cr = absAmount;
      equityDr = absAmount;
    }
  } else if (openingBalanceAmountNum >= 0) {
    cr = absAmount;
    equityDr = absAmount;
  } else {
    dr = absAmount;
    equityCr = absAmount;
  }
  const ref = `OB-${await getAndUpdateNumber("OB", facilityId)}`;
  const txDate =
    openingBalanceDate || new Date().toISOString().split("T")[0];
  await db.GeneralLedger.create(
    {
      transaction_date: txDate,
      account_code: code,
      account_subhead: parentCodeResolved,
      dr,
      cr,
      account_description: description,
      transaction_description: `Opening Balance - ${description}`,
      reference_number: ref,
      purpose_of_payment: "Opening Balance",
      created_by,
      facility_id: facilityId,
      status: "paid",
      type: "opening_balance",
      transaction_ref: code,
    },
    { transaction },
  );
  await db.GeneralLedger.create(
    {
      transaction_date: txDate,
      account_code: equityAccount.code,
      account_subhead: equityAccount.parentCode,
      dr: equityDr,
      cr: equityCr,
      account_description: equityAccount.description,
      transaction_description: `Offset for ${code} - ${description}`,
      reference_number: ref,
      purpose_of_payment: "Opening Balance Offset",
      created_by,
      facility_id: facilityId,
      status: "paid",
      type: "opening_balance",
      transaction_ref: equityAccount.code,
    },
    { transaction },
  );
  return null;
}

/**
 * Bulk upload account categories using generate_account_code for number generation
 * Template columns: Nature, Account type, Code, Parent Code, Account Description, …
 * Also accepts legacy: Category, Account Code, Description, Type, Detail type
 */
exports.uploadAccountCategories = async (req, res) => {
  const transaction = await db.sequelize.transaction();

  try {
    const {
      accounts = [],
      facilityId,
      openingBalanceEquity = "",
      created_by = "system",
    } = req.body;

    if (!Array.isArray(accounts) || accounts.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "No account data provided. Provide array of accounts.",
      });
    }

    if (!facilityId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const created = [];
    const errors = [];
    const usedCodesInBatch = new Set();

    const cellBool = (v, defaultVal = true) => {
      if (v === undefined || v === null || v === "") return defaultVal;
      const s = String(v).trim().toLowerCase();
      if (["0", "false", "no", "inactive", "n", "off"].includes(s)) return false;
      if (["1", "true", "yes", "active", "y", "on"].includes(s)) return true;
      const n = Number(v);
      if (!Number.isNaN(n)) return n !== 0;
      return defaultVal;
    };

    const obEquityTrim = (openingBalanceEquity || "").toString().trim();
    const anyOpeningBalance = accounts.some((r) => {
      const ob = Number(
        String(r.opening_balance ?? r.openingBalance ?? 0).replace(/,/g, ""),
      );
      return Number.isFinite(ob) && ob !== 0;
    });
    if (anyOpeningBalance && !obEquityTrim) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "Configure opening balance equity on the business (or pass openingBalanceEquity) when any row has a non-zero Opening balance.",
      });
    }
    if (anyOpeningBalance) {
      const eq = await db.AccountCategory.findOne({
        where: { code: obEquityTrim, facilityId },
        transaction,
      });
      if (!eq) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Opening Balance Equity account not found for code: ${obEquityTrim}`,
        });
      }
    }

    for (let i = 0; i < accounts.length; i++) {
      const row = accounts[i];
      let userProvidedCode = (row.account_code ?? row.code ?? "")
        .toString()
        .trim();
      // Treat dash as empty (Code column only — not Parent Code)
      if (userProvidedCode === "-" || userProvidedCode === "—" || userProvidedCode === "–") {
        userProvidedCode = "";
      }
      const natureOrCategoryRaw = (row.nature ?? row.category ?? "")
        .toString()
        .trim();
      const type =
        (row.account_type ?? row.type ?? "").toString().trim() || null;
      const detail =
        (
          row.detail_type ??
          row.detail ??
          row.sub_class_category ??
          row.subClassCategory ??
          ""
        )
          .toString()
          .trim() || null;
      const description = (row.description || "").toString().trim();
      let accountNature = (row.account_nature || row.accountNature || "")
        .toString()
        .toUpperCase()
        .trim();

      const normalizedCategory =
        normalizeNatureOrCategory(natureOrCategoryRaw);
      if (!accountNature && normalizedCategory) {
        accountNature = inferAccountNature(normalizedCategory);
      }

      if (!natureOrCategoryRaw || !description) {
        errors.push({
          row: i + 1,
          message: `Row ${i + 1}: Nature (or category) and Account Description are required`,
        });
        continue;
      }

      if (!normalizedCategory) {
        errors.push({
          row: i + 1,
          message: `Row ${i + 1}: Invalid Nature "${natureOrCategoryRaw}". Must be one of: ${VALID_CATEGORIES.join(", ")} (or ASSET, LIABILITY, … / 1–5).`,
        });
        continue;
      }

      if (!accountNature) {
        accountNature = inferAccountNature(normalizedCategory);
      }
      if (!accountNature) {
        errors.push({
          row: i + 1,
          message: `Row ${i + 1}: Could not determine account nature from Nature/Category.`,
        });
        continue;
      }

      const validNatures = [
        "ASSET",
        "LIABILITY",
        "EQUITY",
        "REVENUE",
        "EXPENSE",
      ];
      if (!validNatures.includes(accountNature)) {
        errors.push({
          row: i + 1,
          message: `Row ${i + 1}: account_nature must be one of: ${validNatures.join(", ")}`,
        });
        continue;
      }

      let code;
      let parentCode;

      if (userProvidedCode) {
        // User-provided code: must be unique
        if (usedCodesInBatch.has(userProvidedCode)) {
          errors.push({
            row: i + 1,
            message: `Row ${i + 1}: Account Code "${userProvidedCode}" is duplicated. Must be unique.`,
          });
          continue;
        }
        const existing = await db.AccountCategory.findOne({
          where: { code: userProvidedCode, facilityId },
          transaction,
        });
        if (existing) {
          errors.push({
            row: i + 1,
            message: `Row ${i + 1}: Account Code "${userProvidedCode}" already exists. Must be unique.`,
          });
          continue;
        }
        if (!isAllowedUploadedAccountCode(userProvidedCode)) {
          errors.push({
            row: i + 1,
            message: `Row ${i + 1}: Account code must be nature 1–5 (root) or six digits (e.g. 100001).`,
          });
          continue;
        }
        code = userProvidedCode;
        usedCodesInBatch.add(code);
        // Keep explicit parent_code from template when provided; otherwise derive
        const explicitParentCode =
          (
            row.parent_code ??
            row.parentCode ??
            row.subhead ??
            ""
          )
            .toString()
            .trim() || null;
        if (
          explicitParentCode &&
          explicitParentCode !== "0" &&
          explicitParentCode !== "-" &&
          explicitParentCode !== "—" &&
          explicitParentCode !== "–"
        ) {
          parentCode = explicitParentCode;
        } else {
          parentCode = deriveParentCodeFromCode(code);
        }
      } else {
        parentCode =
          (
            row.parent_code ??
            row.parentCode ??
            row.subhead ??
            ""
          )
            .toString()
            .trim() || null;
        if (parentCode === "-" || parentCode === "—" || parentCode === "–") {
          parentCode = null;
        }
        if (!parentCode) {
          parentCode = ACCOUNT_NATURE_TO_PREFIX[accountNature] || null;
        }
        if (!parentCode) {
          errors.push({
            row: i + 1,
            message: `Row ${i + 1}: Set Account Code or parent_code, or use a valid category row.`,
          });
          continue;
        }
        try {
          const result = await db.sequelize.query(
            `SELECT generate_account_code(:parentCode, :facilityId) as code`,
            {
              replacements: {
                parentCode,
                facilityId,
              },
              type: QueryTypes.SELECT,
              transaction,
            },
          );
          code = result?.[0]?.code;
        } catch (sqlErr) {
          code = await db.AccountCategory.generateNextCode(
            parentCode,
            facilityId,
          );
        }
      }

      const level = levelFromAccountCode(code);

      if (!code) {
        errors.push({
          row: i + 1,
          message: `Row ${i + 1}: Failed to generate account code`,
        });
        continue;
      }

      const normalBalance =
        row.normal_balance ||
        row.normalBalance ||
        (["ASSET", "EXPENSE"].includes(accountNature) ? "DEBIT" : "CREDIT");
      const fsSection =
        row.fs_section ||
        row.fsSection ||
        (accountNature === "REVENUE" || accountNature === "EXPENSE"
          ? "PL"
          : "BS");

      const display =
        row.display === undefined || row.display === null || row.display === ""
          ? true
          : cellBool(row.display, true);
      const isActive =
        row.isActive === undefined ||
        row.isActive === null ||
        row.isActive === ""
          ? cellBool(row.status, true)
          : cellBool(row.isActive, true);

      const openingBalanceNum = Number(
        String(row.opening_balance ?? row.openingBalance ?? 0).replace(
          /,/g,
          "",
        ),
      );
      const openingBalanceDate = (
        row.opening_balance_date ??
        row.openingBalanceDate ??
        ""
      )
        .toString()
        .trim();

      try {
        const ac = await db.AccountCategory.create(
          {
            code,
            description,
            display,
            parentCode: parentCode || "0",
            level,
            category: normalizedCategory,
            type,
            detail,
            accountNature,
            normalBalance: normalBalance.toUpperCase(),
            fsSection: fsSection.toUpperCase(),
            facilityId,
            isActive,
          },
          { transaction },
        );
        created.push(ac);

        const parentCodeResolved = deriveParentCodeFromCode(code);
        const obErr = await postOpeningBalanceForUpload({
          facilityId,
          code,
          description,
          parentCodeResolved,
          accountNature,
          openingBalanceNum,
          openingBalanceDate,
          obEquityTrim,
          created_by,
          transaction,
        });
        if (obErr) {
          errors.push({ row: i + 1, message: `Row ${i + 1}: ${obErr}` });
        }
      } catch (createErr) {
        errors.push({
          row: i + 1,
          message: `Row ${i + 1}: ${createErr.message || "Create failed"}`,
        });
      }
    }

    // Transactional mode (all-or-nothing): any row error aborts whole batch.
    if (errors.length > 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "Upload failed. No accounts were imported because one or more rows had errors.",
        imported: 0,
        total: accounts.length,
        rolledBack: true,
        errors,
      });
    }

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: `${created.length} account(s) created successfully`,
      imported: created.length,
      total: accounts.length,
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Error uploading account categories:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to upload accounts",
      error: error.message,
    });
  }
};

/**
 * Download chart of accounts template: headers A–I, sample rows, then blank rows.
 */
exports.downloadAccountCategoryTemplate = async (req, res) => {
  try {
    const headers =
      "Nature,Account type,Code,Parent Code,Account Description,Opening balance,Opening balance date,status,display";
    const escape = (v) => `"${(v || "").toString().replace(/"/g, '""')}"`;
    const sample = [
      [
        "Assets",
        "Cash and cash equivalents",
        "100001",
        "",
        "Main operating bank",
        "0",
        "",
        "active",
        "1",
      ],
      [
        "Assets",
        "Cash and cash equivalents",
        "100002",
        "",
        "Petty cash",
        "0",
        "",
        "active",
        "1",
      ],
      [
        "Assets",
        "Current assets",
        "100003",
        "",
        "Trade receivables",
        "0",
        "",
        "active",
        "1",
      ],
      [
        "Liabilities",
        "Current liabilities",
        "200001",
        "",
        "Accounts payable",
        "0",
        "",
        "active",
        "1",
      ],
      [
        "Equity",
        "Equity",
        "300001",
        "",
        "Owner's equity",
        "0",
        "",
        "active",
        "1",
      ],
      [
        "Revenue",
        "Operating revenue",
        "400001",
        "",
        "Sales",
        "0",
        "",
        "active",
        "1",
      ],
      [
        "Expenses",
        "Operating expenses",
        "500001",
        "",
        "Rent expense",
        "0",
        "",
        "active",
        "1",
      ],
    ];
    const sampleLines = sample.map((row) =>
      [
        escape(row[0]),
        escape(row[1]),
        row[2],
        row[3],
        escape(row[4]),
        row[5],
        row[6],
        row[7],
        row[8],
      ].join(","),
    );
    const emptyLine = Array(9).fill("").join(",");
    const csv = [
      headers,
      ...sampleLines,
      ...Array.from({ length: 30 }, () => emptyLine),
    ].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${"chart_of_accounts_template.csv"}"`,
    );
    return res.status(200).send(csv);
  } catch (error) {
    console.error("Error generating template:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate template",
    });
  }
};

/**
 * Generate next account category code
 */
exports.generateAccountCategoryCode = async (req, res) => {
  try {
    const { parentCode, facilityId } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const genParent =
      parentCode === null || parentCode === undefined
        ? ""
        : String(parentCode).trim();
    if (!genParent) {
      return res.status(400).json({
        success: false,
        message:
          "parentCode is required: nature digit 1–5 or any six-digit code under that nature (e.g. 1 or 100001) to get the next number.",
      });
    }

    // Use SQL function generate_account_code (takes parent_code and facility_id)
    try {
      const result = await db.sequelize.query(
        `SELECT generate_account_code(:parentCode, :facilityId) as code`,
        {
          replacements: {
            parentCode: genParent,
            facilityId: facilityId,
          },
          type: QueryTypes.SELECT,
        },
      );

      if (result && result[0] && result[0].code) {
        return res.status(200).json({
          success: true,
          code: result[0].code,
        });
      }
    } catch (sqlError) {
      // If SQL function doesn't exist, fallback to model method
      console.log(
        "SQL function not available, using model method:",
        sqlError.message,
      );

      // Fallback to model method
      const code = await db.AccountCategory.generateNextCode(
        genParent,
        facilityId,
      );

      return res.status(200).json({
        success: true,
        code,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to generate account code",
    });
  } catch (error) {
    console.error("Error generating account category code:", error);
    return res.status(500).json({
      success: false,
      message: "Error generating account category code",
      error: error.message,
    });
  }
};

/**
 * Lightweight uniqueness check for an account code within a facility.
 * Used by the Add Account modal so users can type a custom code and get
 * immediate "available / already in use" feedback before submitting.
 */
exports.checkAccountCategoryCode = async (req, res) => {
  try {
    const code = String(req.query.code || "").trim();
    const facilityId = String(req.query.facilityId || "").trim();

    if (!code || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "code and facilityId are required",
      });
    }

    const existing = await db.AccountCategory.findOne({
      where: { code, facilityId },
      attributes: ["code", "description"],
    });

    return res.status(200).json({
      success: true,
      available: !existing,
      existing: existing
        ? { code: existing.code, description: existing.description }
        : null,
    });
  } catch (error) {
    console.error("Error checking account category code:", error);
    return res.status(500).json({
      success: false,
      message: "Error checking account category code",
      error: error.message,
    });
  }
};
