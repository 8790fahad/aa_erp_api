"use strict";

/**
 * Keep inventory / revenue / cost-of-sales suffixes aligned.
 *
 * generate_account_code used to take the next number in the whole nature
 * (every asset), so a new Rafa inventory account became 120703 instead of
 * 120407. A six-digit group that already has children in the same first four
 * digits now continues that group (120400 → 120407, 610700 → 610706).
 *
 * The data section realigns the Nexifour chart (facility
 * 094c6e1e-dd07-48c4-a344-6e9d58cd7861) and is a no-op everywhere else.
 */

const FACILITY_ID = "094c6e1e-dd07-48c4-a344-6e9d58cd7861";

const REMAP = [
  ["120705", "120105", "IRS Bakers Pride Flour"],
  ["120105", "120106", "IRS DUSA 1"],
  ["120106", "120107", "IRS DUSA 2"],
  ["120107", "120108", "IRS PASTA PHC"],
  ["120108", "120109", "IRS MACCARONI PHC"],
  ["120703", "120407", "Rafa Detergent (45x84)"],
  ["120704", "120408", "Rafa Detergent (22x162)"],
  ["120708", "120703", "Maikwabo Pasta Slim"],
  ["120709", "120704", "Maikwabo Pasta Standard"],
  ["120710", "120705", "Maikwabo Maccaroni"],
  ["400001", "610705", "Maikwabo Maccaroni"],
  ["120902", "120803", "Juicy Orange"],
  ["120903", "120804", "Mangal Cement"],
  ["710900", "610900", "NASCON ALLIES PRODUCT"],
  ["710901", "610901", "Dangote salt"],
  ["610900", "710900", "NASCON ALLIES PRODUCT"],
  ["610901", "710901", "Dangote Salt"],
];

const CODE_COLUMNS = [
  ["general_ledger", "account_code", "facility_id"],
  ["general_ledger", "account_subhead", "facility_id"],
  ["products", "revenue_account", "facility_id"],
  ["products", "inventory_account", "facility_id"],
  ["products", "cogs_head", "facility_id"],
  ["products", "deposit_liability_account", "facility_id"],
  ["mixtures", "inventory_account", "facility_id"],
  ["mixtures", "wip_account", "facility_id"],
  ["finished_goods", "account_code", "facility_id"],
  ["materials", "account_code", "facility_id"],
  ["customers", "account_head", "facilityId"],
  ["requisition_details", "chart_code", "facilityId"],
];

const BUSINESS_COLUMNS = [
  "payable_code",
  "sale_revenue_code",
  "cost_of_sale",
  "receivable_code",
  "wip",
  "abnormal_loss_account",
  "scrap_inventory_account",
  "finished_goods_code",
  "opening_balance_equity",
  "vat_account_code",
  "pro_bono_code",
  "receivable_accural_code",
  "payable_accural_code",
  "other_receivable_code",
  "other_payable_code",
];

const CREATE_FN = `
CREATE FUNCTION generate_account_code(p_parent_code VARCHAR(20), p_facility_id VARCHAR(36))
RETURNS VARCHAR(50)
DETERMINISTIC
READS SQL DATA
BEGIN
  DECLARE next_num INT DEFAULT 1;
  DECLARE new_code VARCHAR(50);
  DECLARE pl INT;
  DECLARE nature_char VARCHAR(1);
  DECLARE prefix VARCHAR(4);
  DECLARE max_code INT DEFAULT 0;
  DECLARE use_group TINYINT DEFAULT 0;

  IF p_parent_code IS NULL OR TRIM(p_parent_code) = '' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'generate_account_code: pass nature 1-5 or a six-digit account code';
  END IF;

  SET p_parent_code = TRIM(p_parent_code);
  SET pl = CHAR_LENGTH(p_parent_code);

  IF pl = 1 AND p_parent_code IN ('1','2','3','4','5') THEN
    SET nature_char = p_parent_code;
  ELSEIF pl = 6 AND p_parent_code REGEXP '^[1-5][0-9]{5}$' THEN
    SET nature_char = LEFT(p_parent_code, 1);
    IF RIGHT(p_parent_code, 2) = '00' THEN
      SET prefix = LEFT(p_parent_code, 4);
      SELECT COALESCE(MAX(CAST(code AS UNSIGNED)), 0)
        INTO max_code
      FROM account_category
      WHERE facility_id = p_facility_id
        AND code REGEXP '^[1-5][0-9]{5}$'
        AND LEFT(code, 4) = prefix
        AND code <> p_parent_code;
      IF max_code > 0 THEN
        SET use_group = 1;
      END IF;
    END IF;
  ELSE
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'generate_account_code: parent must be nature 1-5 or a six-digit code (e.g. 100001)';
  END IF;

  IF use_group = 1 THEN
    SET next_num = max_code + 1;
    IF CHAR_LENGTH(CAST(next_num AS CHAR)) <> 6
       OR LEFT(CAST(next_num AS CHAR), 4) <> prefix THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'generate_account_code: no room left in this account group';
    END IF;
    SET new_code = CAST(next_num AS CHAR);
  ELSE
    SELECT COALESCE(MAX(CAST(SUBSTRING(code, 2, 5) AS UNSIGNED)), 0) + 1
      INTO next_num
    FROM account_category
    WHERE facility_id = p_facility_id
      AND code REGEXP '^[1-5][0-9]{5}$'
      AND LEFT(code, 1) = nature_char;
    IF next_num > 99999 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'generate_account_code: maximum sequence reached for this nature';
    END IF;
    SET new_code = CONCAT(nature_char, LPAD(next_num, 5, '0'));
  END IF;

  RETURN new_code;
END
`.trim();

async function columnExists(sequelize, table, column) {
  const rows = await sequelize.query(
    `SELECT COLUMN_NAME AS columnName
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :table
       AND COLUMN_NAME = :column
     LIMIT 1`,
    {
      replacements: { table, column },
      type: sequelize.QueryTypes.SELECT,
    },
  );
  return rows.length > 0;
}

async function replaceCode(
  sequelize,
  table,
  column,
  facilityColumn,
  from,
  to,
  transaction,
) {
  if (!(await columnExists(sequelize, table, column))) return;
  if (!(await columnExists(sequelize, table, facilityColumn))) return;
  await sequelize.query(
    `UPDATE \`${table}\`
     SET \`${column}\` = :to
     WHERE \`${facilityColumn}\` = :facilityId
       AND \`${column}\` = :from`,
    { replacements: { to, from, facilityId: FACILITY_ID }, transaction },
  );
}

async function applyRemap(sequelize, pairs, transaction) {
  const renamed = [];
  for (const [oldCode, , description] of pairs) {
    const found = await sequelize.query(
      `SELECT code
       FROM account_category
       WHERE facility_id = :facilityId
         AND code = :oldCode
         AND description = :description
       LIMIT 1`,
      {
        replacements: {
          facilityId: FACILITY_ID,
          oldCode,
          description,
        },
        type: sequelize.QueryTypes.SELECT,
        transaction,
      },
    );
    if (!found.length) continue;
    const temp = `~${oldCode}`;
    await sequelize.query(
      `UPDATE account_category
       SET code = :temp
       WHERE facility_id = :facilityId
         AND code = :oldCode
         AND description = :description`,
      {
        replacements: {
          temp,
          facilityId: FACILITY_ID,
          oldCode,
          description,
        },
        transaction,
      },
    );
    renamed.push([oldCode, temp]);
  }

  for (const [oldCode, temp] of renamed) {
    await sequelize.query(
      `UPDATE account_category
       SET parent_code = :temp
       WHERE facility_id = :facilityId
         AND parent_code = :oldCode`,
      {
        replacements: { temp, oldCode, facilityId: FACILITY_ID },
        transaction,
      },
    );
    for (const [table, column, facilityColumn] of CODE_COLUMNS) {
      await replaceCode(
        sequelize,
        table,
        column,
        facilityColumn,
        oldCode,
        temp,
        transaction,
      );
    }
    for (const column of BUSINESS_COLUMNS) {
      await replaceCode(
        sequelize,
        "business",
        column,
        "id",
        oldCode,
        temp,
        transaction,
      );
    }
  }

  for (const [oldCode, newCode, description] of pairs) {
    const temp = `~${oldCode}`;
    await sequelize.query(
      `UPDATE account_category
       SET code = :newCode
       WHERE facility_id = :facilityId
         AND code = :temp
         AND description = :description`,
      {
        replacements: {
          newCode,
          temp,
          facilityId: FACILITY_ID,
          description,
        },
        transaction,
      },
    );
    await sequelize.query(
      `UPDATE account_category
       SET parent_code = :newCode
       WHERE facility_id = :facilityId
         AND parent_code = :temp`,
      { replacements: { newCode, temp, facilityId: FACILITY_ID }, transaction },
    );
    for (const [table, column, facilityColumn] of CODE_COLUMNS) {
      await replaceCode(
        sequelize,
        table,
        column,
        facilityColumn,
        temp,
        newCode,
        transaction,
      );
    }
    for (const column of BUSINESS_COLUMNS) {
      await replaceCode(
        sequelize,
        "business",
        column,
        "id",
        temp,
        newCode,
        transaction,
      );
    }
  }
}

async function alignMovedRows(sequelize, transaction) {
  const fixes = [
    ["120105", "120100", 4, null, "IRS Bakers Pride Flour"],
    ["120106", "120100", 4, null, "IRS DUSA 1"],
    ["120107", "120100", 4, null, "IRS DUSA 2"],
    ["120108", "120100", 4, null, "IRS PASTA PHC"],
    ["120109", "120100", 4, null, "IRS MACCARONI PHC"],
    ["120407", "120400", 4, null, "Rafa Detergent (45x84)"],
    ["120408", "120400", 4, null, "Rafa Detergent (22x162)"],
    ["120703", "120700", 4, null, "Maikwabo Pasta Slim"],
    ["120704", "120700", 4, null, "Maikwabo Pasta Standard"],
    ["120705", "120700", 4, null, "Maikwabo Maccaroni"],
    ["120803", "120800", 2, null, "Juicy Orange"],
    ["120804", "120800", 2, null, "Mangal Cement"],
    ["120900", "112300", 4, null, "NASCON ALLIES PRODUCT"],
    ["120901", "120900", 4, null, "Dangote salt"],
    ["610705", "610700", 4, "turnover", "Maikwabo Maccaroni"],
    ["610900", "4", 3, "turnover", "NASCON ALLIES PRODUCT"],
    ["610901", "610900", 4, "turnover", "Dangote salt"],
    ["710900", "700000", 3, "cost_of_sales", "NASCON ALLIES PRODUCT"],
    ["710901", "710900", 4, "cost_of_sales", "Dangote Salt"],
  ];

  for (const [code, parent, level, plLine, description] of fixes) {
    await sequelize.query(
      `UPDATE account_category
       SET parent_code = :parent,
           level = :level,
           pl_line = COALESCE(:plLine, pl_line)
       WHERE facility_id = :facilityId
         AND code = :code
         AND description = :description`,
      {
        replacements: {
          parent,
          level,
          plLine,
          code,
          description,
          facilityId: FACILITY_ID,
        },
        transaction,
      },
    );
  }

  await sequelize.query(
    `UPDATE account_category
     SET description = 'Rafa Detergent (125x36pcs)'
     WHERE facility_id = :facilityId
       AND code = '610404'
       AND description = 'Rafa Detergent (120x36pcs)'`,
    { replacements: { facilityId: FACILITY_ID }, transaction },
  );

  await sequelize.query(
    `UPDATE account_category
     SET description = 'Mangal Product'
     WHERE facility_id = :facilityId
       AND code = '710800'
       AND description = 'Mangal  Product'`,
    { replacements: { facilityId: FACILITY_ID }, transaction },
  );

  await sequelize.query(
    `UPDATE account_category
     SET subcategory = 'inventory'
     WHERE facility_id = :facilityId
       AND code IN ('120803', '120804')
       AND subcategory = 'other_current_assets'`,
    { replacements: { facilityId: FACILITY_ID }, transaction },
  );
}

async function installFunction(sequelize) {
  const dialect = sequelize.getDialect();
  if (dialect !== "mysql" && dialect !== "mariadb") return;
  await sequelize.query("DROP FUNCTION IF EXISTS generate_account_code");
  await sequelize.query(CREATE_FN);
}

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    await installFunction(sequelize);
    await sequelize.transaction(async (transaction) => {
      await applyRemap(sequelize, REMAP, transaction);
      await alignMovedRows(sequelize, transaction);
    });
  },

  async down(queryInterface) {
    const sequelize = queryInterface.sequelize;
    const reversed = REMAP.map(([oldCode, newCode, description]) => [
      newCode,
      oldCode,
      description,
    ]);
    await sequelize.transaction(async (transaction) => {
      await applyRemap(sequelize, reversed, transaction);
    });

    const dialect = sequelize.getDialect();
    if (dialect === "mysql" || dialect === "mariadb") {
      const path = require("path");
      const prev = require(path.join(
        __dirname,
        "20260418120000-generate-account-code-flat-six-digit-only.js",
      ));
      if (prev.up) await prev.up(queryInterface);
    }
  },
};
