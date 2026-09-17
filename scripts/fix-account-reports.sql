-- Fixed account_reports for MariaDB / phpMyAdmin.
-- The phpMyAdmin dump replaced every ";" with "$$", so CREATE PROCEDURE
-- ended at "ORDER BY head" and never included END IF / END. That is the
-- "#1064 near ''" error.
--
-- In phpMyAdmin SQL tab: set the Delimiter box (bottom of the page) to $$
-- then run this whole script.

DELIMITER $$

DROP PROCEDURE IF EXISTS `account_reports`$$

CREATE PROCEDURE `account_reports` (
  IN `in_query_type` VARCHAR(40),
  IN `in_from_date` VARCHAR(20),
  IN `in_to` VARCHAR(20),
  IN `in_facility_id` VARCHAR(50),
  IN `in_code` VARCHAR(20),
  IN `in_account_description` VARCHAR(50),
  IN `in_subhead` VARCHAR(50)
)
BEGIN
  IF in_query_type = 'Trial_Balance' THEN
    SELECT
      a.description,
      gl.account_code,
      gl.account_subhead,
      CASE
        WHEN (SUM(gl.cr) - SUM(gl.dr)) < 0 THEN ROUND(ABS(SUM(gl.cr) - SUM(gl.dr)), 2)
        ELSE 0.00
      END AS debit,
      CASE
        WHEN (SUM(gl.cr) - SUM(gl.dr)) > 0 THEN ROUND(SUM(gl.cr) - SUM(gl.dr), 2)
        ELSE 0.00
      END AS credit
    FROM general_ledger gl
    INNER JOIN `account` a
      ON a.head = gl.account_subhead
     AND a.facilityId = in_facility_id
    WHERE gl.facility_id = in_facility_id
    GROUP BY
      a.description,
      gl.account_code,
      gl.account_subhead,
      a.head
    HAVING debit > 0 OR credit > 0
    ORDER BY a.head;

  ELSEIF in_query_type = 'individual_ledger' THEN
    SELECT
      gl.transaction_date,
      gl.account_code,
      gl.account_description,
      gl.dr AS debit,
      gl.cr AS credit,
      (
        SELECT ROUND(SUM(g2.dr - g2.cr), 2)
        FROM general_ledger g2
        WHERE g2.facility_id = gl.facility_id
          AND g2.account_subhead = gl.account_subhead
          AND (
            g2.transaction_date < gl.transaction_date
            OR (
              g2.transaction_date = gl.transaction_date
              AND g2.transaction_id <= gl.transaction_id
            )
          )
      ) AS balance
    FROM general_ledger gl
    WHERE gl.facility_id = in_facility_id
      AND gl.account_subhead = in_subhead
    ORDER BY gl.transaction_date, gl.transaction_id;

  ELSEIF in_query_type = 'supplier_individual_ledger' THEN
    SELECT
      gl.transaction_date,
      gl.account_code,
      gl.account_description,
      gl.dr AS debit,
      gl.cr AS credit,
      (
        SELECT ROUND(SUM(g2.dr - g2.cr), 2)
        FROM general_ledger g2
        WHERE g2.facility_id = gl.facility_id
          AND g2.account_code = gl.account_code
          AND (
            g2.transaction_date < gl.transaction_date
            OR (
              g2.transaction_date = gl.transaction_date
              AND g2.transaction_id <= gl.transaction_id
            )
          )
      ) AS balance
    FROM general_ledger gl
    WHERE gl.facility_id = in_facility_id
      AND gl.account_code = in_code
    ORDER BY gl.transaction_date, gl.transaction_id;
  END IF;
END$$

DELIMITER ;
