-- phpMyAdmin: set Delimiter box (bottom of SQL tab) to $$ then run this.

DELIMITER $$

DROP PROCEDURE IF EXISTS `addNewExpenses`$$

CREATE PROCEDURE `addNewExpenses` (
  IN `in_date` VARCHAR(20),
  IN `in_month` VARCHAR(20),
  IN `in_branch_name` VARCHAR(50),
  IN `in_request_no` VARCHAR(20),
  IN `in_particulars` VARCHAR(50),
  IN `in_quantity` VARCHAR(50),
  IN `in_price` VARCHAR(50),
  IN `in_amount` VARCHAR(50),
  IN `in_remarks` VARCHAR(100),
  IN `in_status` VARCHAR(50),
  IN `in_expense` VARCHAR(100),
  IN `in_facilityId` VARCHAR(50),
  IN `in_type_of_expenses` VARCHAR(100)
)
BEGIN
  INSERT INTO expense (
    date, month, branch_name, request_no, particulars,
    quantity, price, amount, remarks, status,
    expense_id, facilityId, type_of_expenses
  )
  VALUES (
    in_date, in_month, in_branch_name, in_request_no, in_particulars,
    in_quantity, in_price, in_amount, in_remarks, in_status,
    in_expense, in_facilityId, in_type_of_expenses
  );
END$$

DELIMITER ;
