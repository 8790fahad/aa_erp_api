"use strict";

/**
 * generate_account_code:
 * - p_parent_code = '1'..'5' (nature): next 6-digit code [nature][00001–99999] for that facility.
 * - else: child of that parent → CONCAT(parent, LPAD(next,5,'0')) among rows with parent_code = parent.
 */
module.exports = {
  up: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") {
      console.log(
        "Skipping generate_account_code (nature six-digit) - MySQL/MariaDB only",
      );
      return;
    }

    await queryInterface.sequelize.query(
      "DROP FUNCTION IF EXISTS generate_account_code",
    );

    const createFn = `
CREATE FUNCTION generate_account_code(p_parent_code VARCHAR(20), p_facility_id VARCHAR(36))
RETURNS VARCHAR(50)
DETERMINISTIC
READS SQL DATA
BEGIN
  DECLARE next_num INT DEFAULT 1;
  DECLARE new_code VARCHAR(50);
  DECLARE pl INT;

  IF p_parent_code IS NULL OR TRIM(p_parent_code) = '' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'generate_account_code: pass nature digit 1-5 or parent account code';
  END IF;

  SET p_parent_code = TRIM(p_parent_code);
  SET pl = CHAR_LENGTH(p_parent_code);

  IF pl = 1 AND p_parent_code IN ('1','2','3','4','5') THEN
    SELECT COALESCE(MAX(CAST(SUBSTRING(code, 2, 5) AS UNSIGNED)), 0) + 1
    INTO next_num
    FROM account_category
    WHERE facility_id = p_facility_id
      AND code REGEXP '^[1-5][0-9]{5}$'
      AND LEFT(code, 1) = p_parent_code;

    SET new_code = CONCAT(p_parent_code, LPAD(next_num, 5, '0'));
  ELSE
    SELECT COALESCE(MAX(CAST(SUBSTRING(code, pl + 1) AS UNSIGNED)), 0) + 1
    INTO next_num
    FROM account_category
    WHERE parent_code = p_parent_code
      AND facility_id = p_facility_id;

    SET new_code = CONCAT(p_parent_code, LPAD(next_num, 5, '0'));
  END IF;

  RETURN new_code;
END
    `.trim();

    await queryInterface.sequelize.query(createFn);
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") {
      return;
    }

    const path = require("path");
    const prev = require(path.join(
      __dirname,
      "20260409120000-update-generate-account-code-five-digit-segments.js",
    ));
    if (prev.up) {
      await prev.up(queryInterface);
    }
  },
};
