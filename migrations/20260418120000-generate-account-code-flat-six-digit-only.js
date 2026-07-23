"use strict";

/**
 * generate_account_code — flat six-digit codes only:
 * - Pass nature "1".."5" OR any existing six-digit code [1-5]xxxxx under the same facility.
 * - Always returns the next code [nature][00001–99999] among rows whose code matches ^[1-5][0-9]{5}$.
 * - Removed: appending five digits to a parent (e.g. 10000100001).
 */
module.exports = {
  up: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") {
      console.log(
        "Skipping generate_account_code (flat six-digit) - MySQL/MariaDB only",
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
  DECLARE nature_char VARCHAR(1);

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
  ELSE
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'generate_account_code: parent must be nature 1-5 or a six-digit code (e.g. 100001)';
  END IF;

  SELECT COALESCE(MAX(CAST(SUBSTRING(code, 2, 5) AS UNSIGNED)), 0) + 1
  INTO next_num
  FROM account_category
  WHERE facility_id = p_facility_id
    AND code REGEXP '^[1-5][0-9]{5}$'
    AND LEFT(code, 1) = nature_char;

  SET new_code = CONCAT(nature_char, LPAD(next_num, 5, '0'));
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
      "20260412120000-generate-account-code-nature-six-digit.js",
    ));
    if (prev.up) {
      await prev.up(queryInterface);
    }
  },
};
