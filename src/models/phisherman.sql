ALTER TABLE `users` ADD `teamId` INT NOT NULL AFTER `departmentId`;

-------------------------------------------------------------------------- 30 july 2035
INSERT INTO `number_generator` (`description`, `prefix`, `code_no`, `facilityId`) VALUES ('Supplier code', 'sup', '2', '');
DROP PROCEDURE `product_list`;
CREATE DEFINER=`root`@`localhost` PROCEDURE `product_list`(IN `query_type` VARCHAR(50), IN `in_facilityId` VARCHAR(50), IN `in_itemName` VARCHAR(100), IN `in_category` VARCHAR(50), IN `in_type` VARCHAR(50), IN `in_chart_code` VARCHAR(50), IN `in_item_code` VARCHAR(100), IN `in_account_category` VARCHAR(255), IN `in_memo_id` VARCHAR(50)) NOT DETERMINISTIC CONTAINS SQL SQL SECURITY DEFINER BEGIN
  -- Insert operation
  IF query_type = 'insert' THEN
    INSERT INTO product_list (facilityId, item_name, category, type, chart_code, item_code, account_category)
    VALUES (in_facilityId, in_itemName, in_category, in_type, in_chart_code, in_item_code, in_account_category);

  -- Update operation
  ELSEIF query_type = 'update' THEN
    UPDATE product_list
    SET
      item_name = in_itemName,
      category = in_category,
      type = in_type,
      chart_code = in_chart_code
    WHERE facilityId = in_facilityId;

  -- Select all products for a facility
  ELSEIF query_type = 'select' THEN
	-- SELECT * FROM `account` WHERE account_category LIKE "%raw material%" ORDER BY `head` ASC;
    SELECT * FROM product_list WHERE facilityId = in_facilityId; -- AND account_category like "%inventory%";
  -- Select specific columns (item_name, category)
  ELSEIF query_type = 'select_revenue' THEN
	SELECT * FROM `account` WHERE account_category LIKE "%finished goods%" ORDER BY `head` ASC;

   ELSEIF query_type = 'select_raw_material' THEN
	SELECT * FROM `account` WHERE account_category LIKE "%raw material%" ORDER BY `head` ASC;

  ELSEIF query_type = 'select_expenses' THEN
	SELECT * FROM `account` WHERE account_type LIKE "%expenses%" ORDER BY `head` ASC;
  ELSEIF query_type = 'select_recievable' THEN
	SELECT * FROM `account` WHERE account_category LIKE "%receivable%" ORDER BY `head` ASC;
  ELSEIF query_type = 'select_administrative_expenses' THEN
	SELECT * FROM `account` WHERE facilityId = in_facilityId  ; -- WHERE account_category LIKE "%administrative expenses%" OR Balance_type LIKE '%Expense%' ORDER BY `head` ASC;

  ELSEIF query_type = 'banks_details' THEN
    SELECT head, subhead, description FROM `account` WHERE account_category LIKE "bank account";

      ELSEIF query_type = 'select-all' THEN
    SELECT head, subhead, description FROM `account`;

  ELSEIF query_type = 'work_in_progress' THEN
    SELECT head, subhead, description FROM `account` WHERE account_category LIKE "WIP";

  ELSEIF query_type = 'cost_of_goods_sold' THEN
    SELECT head, subhead, description FROM `account` WHERE account_category LIKE "cogs";

  ELSEIF query_type = 'select-item' THEN
    SELECT item_name, category FROM product_list WHERE facilityId = in_facilityId;

  ELSEIF query_type = "select_supplier" THEN
  	SELECT * FROM `purchase_requisition` WHERE memo_id = in_memo_id;

  ELSEIF query_type = "team_members" THEN
  	SELECT firstname, lastname, id FROM `users` WHERE role = "operator" and facilityId=in_facilityId;
  ELSEIF query_type = "team_leader" THEN
  	SELECT team_id, name FROM `team_table` WHERE status = "active" AND team_position = "Team Leader";
  ELSEIF query_type = "rate" THEN
SELECT * FROM `rate_table` WHERE status = "active" AND facilityId = in_facilityId
    AND rate_type = "Rate" AND customer_type = in_category;
  ELSEIF query_type = "operator_rate" THEN
  	SELECT * FROM `rate_table` WHERE status = "active" AND facilityId = in_facilityId AND rate_type = "Operator Rate";
  ELSEIF query_type = "operate_rate" THEN
    SELECT date, team_id,team_leader, shift, customer_name, qty_produce, SUM(dr) AS debit, SUM(cr) as credit,
    SUM(dr - cr) as balance FROM `operator_entry_table` GROUP BY team_leader;
  ELSEIF query_type = "details_rate" THEN
  	SELECT * FROM `operator_entry_table` WHERE team_id = in_memo_id;
    ELSEIF query_type = "sales" THEN
    	SELECT head, subhead, description FROM `account` WHERE account_category ="sales";
    ELSEIF query_type = "payable" THEN
    	SELECT head, subhead, description FROM `account` WHERE account_category ="payable";
    ELSEIF query_type = "raw_materials" THEN
    	SELECT head, subhead, description FROM `account` WHERE account_category ="raw material";
    ELSEIF query_type = "team_deposite" THEN
    	SELECT SUM(cr) - SUM(dr) as balance FROM `operator_entry_table`
        WHERE team_id = in_memo_id;
    ELSEIF query_type = "expense_data" THEN
    	SELECT head, subhead, description FROM `account` WHERE account_category ="expense";
	ELSEIF query_type = "factory" THEN
    	SELECT head, subhead, description FROM `account` WHERE account_category ="factory_wages";
	ELSEIF query_type = "wages" THEN
    	SELECT head, subhead, description FROM `account` WHERE account_category ="wages_payable";
    ELSEIF query_type = "inventory" THEN
    	SELECT head, subhead, description FROM `account` WHERE account_category ="inventory";
    ELSEIF query_type = "supplier_entries" THEN
    	SELECT * FROM `supplier_entries` WHERE supplier_number = in_memo_id;
    ELSEIF query_type = "supplier_deposit" THEN
    	SELECT SUM(dr) as debit, SUM(cr) credit, SUM(dr) - SUM(cr) AS balance FROM
        `supplier_entries` WHERE supplier_number = in_memo_id;

  END IF;
END

---------------------------------------------------------------------------------------01/08/2035
DROP PROCEDURE `get_material`;
CREATE DEFINER=`root`@`localhost` PROCEDURE `get_material`(IN `in_customerNo` VARCHAR(50), IN `in_query_type` VARCHAR(100)) NOT DETERMINISTIC CONTAINS SQL SQL SECURITY DEFINER BEGIN
	IF in_query_type = "get_material_by_customer_id" THEN
	SELECT SUM(quantity_in) - SUM(quantity_out) as quantity,rate, material_type, customerNo, collection_id, entrie_id, unit, amount
        FROM materials_entries WHERE status = "raw_material" AND customerNo = in_customerNo GROUP BY material_type;

 ELSEIF in_query_type="get_collection_material" THEN
 SELECT SUM(quantity_in) - SUM(quantity_out) as quantity, material_type, customerNo, collection_id,rate, entrie_id,type, unit    FROM materials_entries WHERE status = 'finished_goods' AND customerNo = in_customerNo GROUP BY material_type,type;



	END IF;
END

DROP PROCEDURE `product_list`;
CREATE DEFINER=`root`@`localhost` PROCEDURE `product_list`(IN `query_type` VARCHAR(50), IN `in_facilityId` VARCHAR(50), IN `in_itemName` VARCHAR(100), IN `in_category` VARCHAR(50), IN `in_type` VARCHAR(50), IN `in_chart_code` VARCHAR(50), IN `in_item_code` VARCHAR(100), IN `in_account_category` VARCHAR(255), IN `in_memo_id` VARCHAR(50)) NOT DETERMINISTIC CONTAINS SQL SQL SECURITY DEFINER BEGIN
  -- Insert operation
  IF query_type = 'insert' THEN
    INSERT INTO product_list (facilityId, item_name, category, type, chart_code, item_code, account_category)
    VALUES (in_facilityId, in_itemName, in_category, in_type, in_chart_code, in_item_code, in_account_category);

  -- Update operation
  ELSEIF query_type = 'update' THEN
    UPDATE product_list
    SET
      item_name = in_itemName,
      category = in_category,
      type = in_type,
      chart_code = in_chart_code
    WHERE facilityId = in_facilityId;

  -- Select all products for a facility
  ELSEIF query_type = 'select' THEN
	-- SELECT * FROM `account` WHERE account_category LIKE "%raw material%" ORDER BY `head` ASC;
    SELECT * FROM product_list WHERE facilityId = in_facilityId; -- AND account_category like "%inventory%";
  -- Select specific columns (item_name, category)
  ELSEIF query_type = 'select_revenue' THEN
	SELECT * FROM `account` WHERE account_category LIKE "%finished goods%" ORDER BY `head` ASC;

   ELSEIF query_type = 'select_raw_material' THEN
	SELECT * FROM `account` WHERE account_category LIKE "%raw material%" ORDER BY `head` ASC;

  ELSEIF query_type = 'select_expenses' THEN
	SELECT * FROM `account` WHERE account_type LIKE "%expenses%" ORDER BY `head` ASC;
  ELSEIF query_type = 'select_recievable' THEN
	SELECT * FROM `account` WHERE account_category LIKE "%receivable%" ORDER BY `head` ASC;
  ELSEIF query_type = 'select_administrative_expenses' THEN
	SELECT * FROM `account` WHERE facilityId = in_facilityId  ; -- WHERE account_category LIKE "%administrative expenses%" OR Balance_type LIKE '%Expense%' ORDER BY `head` ASC;

  ELSEIF query_type = 'banks_details' THEN
    SELECT head, subhead, description FROM `account` WHERE account_category LIKE "bank account";

      ELSEIF query_type = 'select-all' THEN
    SELECT head, subhead, description FROM `account`;

  ELSEIF query_type = 'work_in_progress' THEN
    SELECT head, subhead, description FROM `account` WHERE account_category LIKE "WIP";

  ELSEIF query_type = 'cost_of_goods_sold' THEN
    SELECT head, subhead, description FROM `account` WHERE account_category LIKE "cogs";

  ELSEIF query_type = 'select-item' THEN
    SELECT item_name, category FROM product_list WHERE facilityId = in_facilityId;

  ELSEIF query_type = "select_supplier" THEN
  	SELECT * FROM `purchase_requisition` WHERE memo_id = in_memo_id;

  ELSEIF query_type = "team_members" THEN
  	SELECT firstname, lastname, id FROM `users` WHERE role = "operator" and facilityId=in_facilityId;
  ELSEIF query_type = "team_leader" THEN
  	SELECT team_id, name FROM `team_table` WHERE status = "active" AND team_position = "Team Leader";
  ELSEIF query_type = "rate" THEN
SELECT * FROM `rate_table` WHERE status = "active" AND facilityId = in_facilityId AND rate_type = "customer rate" ;
    -- AND customer_type = in_category AND customer_type = in_category;
  ELSEIF query_type = "operator_rate" THEN
  	SELECT * FROM `rate_table` WHERE status = "active" AND facilityId = in_facilityId AND rate_type = "operator rate";
  ELSEIF query_type = "operate_rate" THEN
    SELECT date, team_id,team_leader, shift, customer_name, qty_produce, SUM(dr) AS debit, SUM(cr) as credit,
    SUM(dr - cr) as balance FROM `operator_entry_table` GROUP BY team_leader;
  ELSEIF query_type = "details_rate" THEN
  	SELECT * FROM `operator_entry_table` WHERE team_id = in_memo_id;
    ELSEIF query_type = "sales" THEN
    	SELECT head, subhead, description FROM `account` WHERE account_category ="sales";
    ELSEIF query_type = "payable" THEN
    	SELECT head, subhead, description FROM `account` WHERE account_category ="payable";
    ELSEIF query_type = "raw_materials" THEN
    	SELECT head, subhead, description FROM `account` WHERE account_category ="raw material";
    ELSEIF query_type = "team_deposite" THEN
    	SELECT SUM(cr) - SUM(dr) as balance FROM `operator_entry_table`
        WHERE team_id = in_memo_id;
    ELSEIF query_type = "expense_data" THEN
    	SELECT head, subhead, description FROM `account` WHERE account_category ="expense";
	ELSEIF query_type = "factory" THEN
    	SELECT head, subhead, description FROM `account` WHERE account_category ="factory_wages";
	ELSEIF query_type = "wages" THEN
    	SELECT head, subhead, description FROM `account` WHERE account_category ="wages_payable";
    ELSEIF query_type = "inventory" THEN
    	SELECT head, subhead, description FROM `account` WHERE account_category ="inventory";
    ELSEIF query_type = "supplier_entries" THEN
    	SELECT * FROM `supplier_entries` WHERE supplier_number = in_memo_id;
    ELSEIF query_type = "supplier_deposit" THEN
    	SELECT SUM(dr) as debit, SUM(cr) credit, SUM(dr) - SUM(cr) AS balance FROM
        `supplier_entries` WHERE supplier_number = in_memo_id;

  END IF;
END

-------------------------------------------------------------------------------------------
------- 04/08/2026
ALTER TABLE `materials_entries` CHANGE `receive_date` `receive_date` DATE NOT NULL;

DROP PROCEDURE `material`;
CREATE DEFINER=`root`@`localhost` PROCEDURE `material`(IN `in_query_type` VARCHAR(20), IN `in_entry_id` VARCHAR(50), IN `in_collection_id` VARCHAR(50), IN `in_date` DATE, IN `in_material_type` VARCHAR(50), IN `in_unit` VARCHAR(50), IN `in_amount` DECIMAL(10,0), IN `in_rate` INT, IN `in_quantity_in` INT, IN `in_quantity_out` INT, IN `in_discount` DOUBLE(10,3), IN `in_facility_id` VARCHAR(50), IN `in_product_type` VARCHAR(50), IN `in_customerNo` VARCHAR(50), IN `in_status` VARCHAR(50)) NOT DETERMINISTIC CONTAINS SQL SQL SECURITY DEFINER BEGIN
    IF in_query_type = 'insert' THEN
        INSERT INTO `materials_entries`(`entrie_id`, `collection_id`, `customerNo`, `material_type`, `quantity_in`, `unit`, `rate`, `quantity_out`, `amount`, `discount`, `type`, `status`, `receive_date`)
        VALUES( in_entry_id, in_collection_id, in_customerNo, in_material_type, in_quantity_in, in_unit, in_rate, in_quantity_out, in_amount, in_discount, in_product_type, in_status, in_date);

    ELSEIF in_query_type = 'select' THEN
        SELECT collection_id, date, unit, material_type, amount, customer_name, quantity FROM materials
        WHERE facility_id = in_facility_id;
    END IF;
END

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `get_users_by_fac`(IN `in_facilityId` VARCHAR(50))
BEGIN
  SELECT
    u.*,
    m.access_to,
    m.functionalities
  FROM
    users u
  LEFT JOIN
    membership m ON u.id = m.user_id
  WHERE
    m.business_id = in_facilityId;
END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `update_membership_permissions`(IN `in_user_id` INT, IN `in_access_to` TEXT, IN `in_functionalities` TEXT, IN `in_business_id` VARCHAR(255))
BEGIN
  -- Simply update without returning status
  UPDATE membership
  SET
    access_to = NULLIF(in_access_to, ''),
    functionalities = NULLIF(in_functionalities, '')
  WHERE
    user_id = in_user_id AND
    business_id = in_business_id;
END$$
DELIMITER ;

--------------------------------------------------------------------------
----------------------------05/08/2026
DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `customer`(IN `in_query_type` VARCHAR(50), IN `in_customer_no` VARCHAR(50), IN `in_account_head` VARCHAR(30), IN `in_sub_head` VARCHAR(50), IN `in_address` VARCHAR(50), IN `in_phone` VARCHAR(20), IN `in_mail` VARCHAR(80), IN `in_fullname` VARCHAR(50), IN `in_store` VARCHAR(50), IN `in_status` VARCHAR(50), IN `in_credit_limit` INT, IN `in_facility_id` VARCHAR(50), IN `in_customer_type` VARCHAR(50), IN `in_date` DATE)
BEGIN
  IF in_query_type = 'create' THEN
    INSERT INTO `customers`(`customerNo`, `account_head`, `subhead`, `address`, `phone`, `email`, `fullname`, `customer_type`,
                            `store_name`, `status`, `credit_limit`, `facilityId`)
    VALUES(in_customer_no,in_account_head,in_sub_head,in_address,in_phone,in_mail,in_fullname,
           in_customer_type,in_store,in_status,in_credit_limit,in_facility_id);

  ELSEIF in_query_type = 'create_supplier' THEN
    INSERT INTO `suppliersinfo`(`facilityId`,  `supplier_number`, `supplier_name`, `date`, `address`, `phone`, `supplier_code`, `supplier_subhead`, `status`, `email`)
    VALUES (in_facility_id, in_customer_no, in_fullname, in_date, in_address, in_phone, in_account_head, in_sub_head, in_status, in_mail);

  ELSEIF in_query_type = 'update_supplier' THEN
    UPDATE `suppliersinfo`
    SET
      supplier_name = in_fullname,
      address = in_address,
      phone = in_phone,
      supplier_code = in_account_head,
      supplier_subhead = in_sub_head,
      status = in_status,
      email = in_mail,
      date = in_date
    WHERE
      supplier_number = in_customer_no AND facilityId = in_facility_id;

  ELSEIF in_query_type = 'customers' THEN
    SELECT
      a.*,
      COALESCE(SUM(b.dr - b.cr), 0) AS balance
    FROM
      customers a
    LEFT JOIN
      customer_entries b
      ON a.customerNo = b.customerNo
    WHERE
      a.facilityId = in_facility_id
    GROUP BY
      a.customerNo ;

  ELSEIF in_query_type = 'customer_by_id' THEN
    SELECT * FROM customers WHERE customerNo = in_customer_no;

  END IF;
END$$
DELIMITER ;

------------------------------------------------------------------------------------------
----------------------------------------07/08/2026
DELIMITER $$
CREATE  PROCEDURE `insertMemo`(IN `in_query_type` VARCHAR(50), IN `in_from_name` VARCHAR(255), IN `in_date` DATE, IN `in_purpose` TEXT, IN `in_memo_id` VARCHAR(255), IN `in_amount` DECIMAL(10,2), IN `in_remark` VARCHAR(255), IN `in_facilityId` VARCHAR(155), IN `in_raise_by` VARCHAR(100), IN `user_id` INT, IN `in_subject` VARCHAR(100), IN `in_details` VARCHAR(500), IN `in_recipient` VARCHAR(100), IN `in_description` VARCHAR(100), IN `in_total` DECIMAL(10,2), IN `in_pr_no` VARCHAR(50), IN `in_reference_number` VARCHAR(20), IN `status` VARCHAR(20), IN `in_supplier_name` VARCHAR(50), IN `in_supplier_code` VARCHAR(50), IN `in_account_code` VARCHAR(50), IN `in_supplier_number` VARCHAR(50))
BEGIN

    IF in_query_type = 'insert' THEN
        INSERT INTO memo (
            from_name,
            date,
            purpose,
            memo_id,
            amount,
            remark,
            status,
            facilityId,
            raise_by,
            user_id,
            subject,
            details,
            recipient,
            description,
            supplier_name,
            supplier_number,
            supplier_code,
            account_code,
            total,
            reference_number,
            pr_no
        )
        VALUES (
            in_from_name,
            in_date,
            in_purpose,
            in_memo_id,
            in_amount,
            in_remark,
            'pending',
            in_facilityId,
            in_raise_by,
            user_id,
            in_subject,
            in_details,
            in_recipient,
            in_description,
            in_supplier_name,
            in_supplier_number,
            in_supplier_code,
            in_account_code,
            in_total,
            in_reference_number,
            in_pr_no
        );

        UPDATE purchase_requisition
            SET
                memo_id = in_memo_id,
                amount = IFNULL(amount,0) + IFNULL(in_amount,0)
            WHERE pr_no = (CONVERT(in_pr_no USING utf8mb4) COLLATE utf8mb4_general_ci)
              AND facilityId = (CONVERT(in_facilityId USING utf8mb4) COLLATE utf8mb4_general_ci);

        SELECT * FROM memo
         WHERE memo_id = (CONVERT(in_memo_id USING utf8mb4) COLLATE utf8mb4_general_ci)
           AND facilityId = (CONVERT(in_facilityId USING utf8mb4) COLLATE utf8mb4_general_ci);

    ELSEIF in_query_type = 'update_insert' THEN
        INSERT INTO memo (
            from_name,
            date,
            purpose,
            memo_id,
            amount,
            remark,
            status,
            facilityId,
            raise_by,
            user_id,
            subject,
            details,
            recipient,
            description,
            supplier_name,
            supplier_number,
            supplier_code,
            account_code,
            total,
            reference_number,
            pr_no
        )
        VALUES (
            in_from_name,
            in_date,
            in_purpose,
            in_memo_id,
            in_amount,
            in_remark,
            'reviewed',
            in_facilityId,
            in_raise_by,
            user_id,
            in_subject,
            in_details,
            in_recipient,
            in_description,
            in_supplier_name,
            in_supplier_number,
            in_supplier_code,
            in_account_code,
            in_total,
            in_reference_number,
            in_pr_no
        );

    ELSEIF in_query_type = 'update' THEN
    UPDATE memo
        SET
            from_name = in_from_name,
            date = in_date,
            purpose = in_purpose,
            amount = in_amount,
            remark = in_remark,
            subject = in_subject,
            details = in_details,
            recipient = in_recipient,
            description = in_description,
            supplier_name = in_supplier_name,
            supplier_number = in_supplier_number,
            supplier_code = in_supplier_code,
            account_code = in_account_code,
            total = in_total,
            reference_number = in_reference_number,
            pr_no = in_pr_no,
            status = IFNULL(status, 'pending')
        WHERE memo_id = (CONVERT(in_memo_id USING utf8mb4) COLLATE utf8mb4_general_ci)
          AND facilityId = (CONVERT(in_facilityId USING utf8mb4) COLLATE utf8mb4_general_ci);

    -- Add SELECT statement for consistent response
    SELECT * FROM memo WHERE memo_id = in_memo_id;

    ELSEIF in_query_type = 'select' THEN
        SELECT * FROM item_list WHERE memo_id = in_memo_id;

    ELSEIF in_query_type = 'new_select' THEN
        SELECT * FROM item_list WHERE memo_id = in_memo_id;

    END IF;
END$$
DELIMITER ;

-------------------------------------------------------------------------------------------------------------------
----------------------------------------------------------18/08/2026
DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `insertMemo`(IN `in_query_type` VARCHAR(50), IN `in_from_name` VARCHAR(255), IN `in_date` DATE, IN `in_purpose` TEXT, IN `in_memo_id` VARCHAR(255), IN `in_amount` DECIMAL(10,2), IN `in_remark` VARCHAR(255), IN `in_facilityId` VARCHAR(155), IN `in_raise_by` VARCHAR(100), IN `user_id` INT, IN `in_subject` VARCHAR(100), IN `in_details` VARCHAR(500), IN `in_recipient` VARCHAR(100), IN `in_description` VARCHAR(100), IN `in_total` DECIMAL(50,2), IN `in_pr_no` VARCHAR(50), IN `in_reference_number` VARCHAR(20), IN `status` VARCHAR(20), IN `in_supplier_name` VARCHAR(50), IN `in_supplier_code` VARCHAR(50), IN `in_account_code` VARCHAR(50), IN `in_supplier_number` VARCHAR(50))
BEGIN

    IF in_query_type = 'insert' THEN
        INSERT INTO memo (
            from_name,
            date,
            purpose,
            memo_id,
            amount,
            remark,
            status,
            facilityId,
            raise_by,
            user_id,
            subject,
            details,
            recipient,
            description,
            supplier_name,
            supplier_number,
            supplier_code,
            account_code,
            total,
            reference_number,
            pr_no
        )
        VALUES (
            in_from_name,
            in_date,
            in_purpose,
            in_memo_id,
            in_amount,
            in_remark,
            'pending',
            in_facilityId,
            in_raise_by,
            user_id,
            in_subject,
            in_details,
            in_recipient,
            in_description,
            in_supplier_name,
            in_supplier_number,
            in_supplier_code,
            in_account_code,
            in_total,
            in_reference_number,
            in_pr_no
        );

        UPDATE purchase_requisition
            SET
                memo_id = in_memo_id,
                amount = IFNULL(amount,0) + IFNULL(in_amount,0)
            WHERE pr_no = in_pr_no;

        SELECT * FROM memo
         WHERE memo_id = (CONVERT(in_memo_id USING utf8mb4) COLLATE utf8mb4_general_ci)
           AND facilityId = (CONVERT(in_facilityId USING utf8mb4) COLLATE utf8mb4_general_ci);

    ELSEIF in_query_type = 'update_insert' THEN
        INSERT INTO memo (
            from_name,
            date,
            purpose,
            memo_id,
            amount,
            remark,
            status,
            facilityId,
            raise_by,
            user_id,
            subject,
            details,
            recipient,
            description,
            supplier_name,
            supplier_number,
            supplier_code,
            account_code,
            total,
            reference_number,
            pr_no
        )
        VALUES (
            in_from_name,
            in_date,
            in_purpose,
            in_memo_id,
            in_amount,
            in_remark,
            'reviewed',
            in_facilityId,
            in_raise_by,
            user_id,
            in_subject,
            in_details,
            in_recipient,
            in_description,
            in_supplier_name,
            in_supplier_number,
            in_supplier_code,
            in_account_code,
            in_total,
            in_reference_number,
            in_pr_no
        );

    ELSEIF in_query_type = 'update' THEN
    UPDATE memo
        SET
            from_name = in_from_name,
            date = in_date,
            purpose = in_purpose,
            amount = in_amount,
            remark = in_remark,
            subject = in_subject,
            details = in_details,
            recipient = in_recipient,
            description = in_description,
            total = in_total,
            reference_number = in_reference_number,
            pr_no = in_pr_no,
            status = IFNULL(status, 'pending')
        WHERE memo_id = in_memo_id;

    -- Add SELECT statement for consistent response
    SELECT * FROM memo WHERE memo_id = in_memo_id;

    ELSEIF in_query_type = 'select' THEN
        SELECT * FROM item_list WHERE memo_id = in_memo_id;

    ELSEIF in_query_type = 'new_select' THEN
        SELECT * FROM item_list WHERE memo_id = in_memo_id;

    END IF;
END$$
DELIMITER ;

-------------------------------------------------------------------------------------------------------------
-------------------------------------------------------------------------------------------19/08/2026

ALTER TABLE `taxes` ADD CONSTRAINT `fk_head` FOREIGN KEY (`head`) REFERENCES `account`(`head`) ON DELETE RESTRICT ON UPDATE RESTRICT; ALTER TABLE `taxes` ADD CONSTRAINT `fk_sub_head` FOREIGN KEY (`account_sub_head`) REFERENCES `account`(`subhead`) ON DELETE RESTRICT ON UPDATE RESTRICT;


CREATE TABLE `memo_documents` (
  `id` int(11) NOT NULL,
  `memo_id` varchar(50) DEFAULT NULL,
  `document_name` varchar(255) NOT NULL,
  `file_path` varchar(255) NOT NULL,
  `original_name` varchar(255) NOT NULL,
  `file_size` int(11) NOT NULL,
  `mime_type` varchar(100) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `transaction_id` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE `memo_documents`
  ADD PRIMARY KEY (`id`),
  ADD KEY `fk_memo_id` (`memo_id`),
  ADD KEY `fk_transaction_id` (`transaction_id`);

ALTER TABLE `memo_documents`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=9;

  ALTER TABLE `memo_documents`
  ADD CONSTRAINT `fk_transaction_id` FOREIGN KEY (`transaction_id`) REFERENCES `transactions_data` (`id`) ON DELETE CASCADE;


---------------------------------------------------------------------------------------------------
--------------------------------------------------------------------------------------20/08/2026
DROP TABLE supplier_account_information;

CREATE TABLE supplier_account_information (
  id INT AUTO_INCREMENT PRIMARY KEY,
  supplier_number VARCHAR(50),
  account_name VARCHAR(45) NOT NULL,
  account_number VARCHAR(20) NOT NULL,
  bank_name VARCHAR(45) NOT NULL,
  status VARCHAR(100) DEFAULT 'active',
  subhead VARCHAR(50) NOT NULL,
  head VARCHAR(50) NOT NULL,
  sort_code VARCHAR(100),
  facilityId VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Add indexes for better performance
  INDEX idx_supplier_number (supplier_number),
  INDEX idx_facility (facilityId),
  INDEX idx_status (status),
  UNIQUE KEY unique_account (supplier_number, account_number, facilityId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;



CREATE TABLE `supplier_account_information` (
  `id` int(11) NOT NULL,
  `supplier_number` varchar(50) DEFAULT NULL,
  `account_name` varchar(45) NOT NULL,
  `account_number` varchar(20) NOT NULL,
  `bank_name` varchar(45) NOT NULL,
  `status` varchar(100) DEFAULT 'active',
  `sort_code` varchar(100) DEFAULT NULL,
  `bank_code` int(11) NOT NULL,
  `code` int(11) NOT NULL,
  `facilityId` varchar(100) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE `supplier_account_information`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_account` (`supplier_number`,`account_number`,`facilityId`),
  ADD KEY `idx_supplier_number` (`supplier_number`),
  ADD KEY `idx_facility` (`facilityId`),
  ADD KEY `idx_status` (`status`);

  ALTER TABLE `supplier_account_information`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;
COMMIT;



-------------------------------------------------------------------------------------------------------------------
---------------------------------------------------21/08/2026------------------------------------------------------

ALTER TABLE `supplier_account_information` CHANGE `bank_code` `bank_code` VARCHAR(50) NOT NULL, CHANGE `code` `code` VARCHAR(50) NOT NULL;

DROP PROCEDURE IF EXISTS `insertMemo`
DELIMITER $$
CREATE  PROCEDURE `insertMemo`(
    IN `in_query_type` VARCHAR(50),
    IN `in_from_name` VARCHAR(255),
    IN `in_date` DATE,
    IN `in_purpose` TEXT,
    IN `in_memo_id` VARCHAR(255),
    IN `in_amount` DECIMAL(10,2),
    IN `in_remark` VARCHAR(255),
    IN `in_facilityId` VARCHAR(155),
    IN `in_raise_by` VARCHAR(100),
    IN `user_id` VARCHAR(100),
    IN `in_subject` VARCHAR(100),
    IN `in_details` VARCHAR(500),
    IN `in_recipient` VARCHAR(100),
    IN `in_description` VARCHAR(100),
    IN `in_total` DECIMAL(50,2),
    IN `in_pr_no` VARCHAR(50),
    IN `in_reference_number` VARCHAR(20),
    IN `status` VARCHAR(20),
    IN `in_priority` VARCHAR(20),
    IN `in_supplier_name` VARCHAR(50),
    IN `in_supplier_code` VARCHAR(50),
    IN `in_account_code` VARCHAR(50),
    IN `in_supplier_number` VARCHAR(50)
)
BEGIN

    IF in_query_type = 'insert' THEN
        INSERT INTO memo (
            from_name,
            date,
            purpose,
            memo_id,
            amount,
            remark,
            status,
            facilityId,
            raise_by,
            user_id,
            subject,
            details,
            recipient,
            description,
            supplier_name,
            supplier_number,
            supplier_code,
            account_code,
            total,
            reference_number,
            pr_no
        )
        VALUES (
            in_from_name,
            in_date,
            in_purpose,
            in_memo_id,
            in_amount,
            in_remark,
            'pending',
            in_facilityId,
            in_raise_by,
            user_id,
            in_subject,
            in_details,
            in_recipient,
            in_description,
            IFNULL(in_supplier_name, ''),
            IFNULL(in_supplier_number, ''),
            IFNULL(in_supplier_code, ''),
            IFNULL(in_account_code, ''),
            in_total,
            in_reference_number,
            in_pr_no
        );

        UPDATE purchase_requisition
            SET
                memo_id = in_memo_id,
                amount = IFNULL(amount,0) + IFNULL(in_amount,0)
            WHERE pr_no = in_pr_no;

        SELECT * FROM memo WHERE memo_id = in_memo_id;

    ELSEIF in_query_type = 'update_insert' THEN
        INSERT INTO memo (
            from_name,
            date,
            purpose,
            memo_id,
            amount,
            remark,
            status,
            facilityId,
            raise_by,
            user_id,
            subject,
            details,
            recipient,
            description,
            supplier_name,
            supplier_number,
            supplier_code,
            account_code,
            total,
            reference_number,
            pr_no
        )
        VALUES (
            in_from_name,
            in_date,
            in_purpose,
            in_memo_id,
            in_amount,
            in_remark,
            'reviewed',
            in_facilityId,
            in_raise_by,
            user_id,
            in_subject,
            in_details,
            in_recipient,
            in_description,
            IFNULL(in_supplier_name, ''),
            IFNULL(in_supplier_number, ''),
            IFNULL(in_supplier_code, ''),
            IFNULL(in_account_code, ''),
            in_total,
            in_reference_number,
            in_pr_no
        );

    ELSEIF in_query_type = 'update' THEN
        UPDATE memo
            SET
                from_name = in_from_name,
                date = in_date,
                purpose = in_purpose,
                amount = in_amount,
                remark = in_remark,
                subject = in_subject,
                details = in_details,
                recipient = in_recipient,
                description = in_description,
                supplier_name = IFNULL(in_supplier_name, ''),
                supplier_number = IFNULL(in_supplier_number, ''),
                supplier_code = IFNULL(in_supplier_code, ''),
                account_code = IFNULL(in_account_code, ''),
                total = in_total,
                reference_number = in_reference_number,
                pr_no = in_pr_no,
                status = IFNULL(status, 'pending')
        WHERE memo_id = in_memo_id;

        -- Add SELECT statement for consistent response
        SELECT * FROM memo WHERE memo_id = in_memo_id;

    ELSEIF in_query_type = 'select' THEN
        SELECT * FROM item_list
         WHERE memo_id = (CONVERT(in_memo_id USING utf8mb4) COLLATE utf8mb4_general_ci)
           AND facilityId = (CONVERT(in_facilityId USING utf8mb4) COLLATE utf8mb4_general_ci);

    ELSEIF in_query_type = 'new_select' THEN
        SELECT * FROM item_list
         WHERE memo_id = (CONVERT(in_memo_id USING utf8mb4) COLLATE utf8mb4_general_ci)
           AND facilityId = (CONVERT(in_facilityId USING utf8mb4) COLLATE utf8mb4_general_ci);

    END IF;
END$$
DELIMITER ;

ALTER TABLE `memo` CHANGE `supplier_name` `supplier_name` VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL, CHANGE `supplier_code` `supplier_code` VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL, CHANGE `supplier_number` `supplier_number` VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL, CHANGE `account_code` `account_code` VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL;

ALTER TABLE `memo_documents` ADD `facilityId` VARCHAR(255) NOT NULL AFTER `transaction_id`;


-------------------------------------------------------------------------------------------------------------------
---------------------------------------------------21/08/2026------------------------------------------------------

CREATE PROCEDURE getDocument(
    IN query_type VARCHAR(50),
    IN in_id VARCHAR(100),
    IN facilityId VARCHAR(100)
)
BEGIN
    IF query_type = 'byId' THEN
        SELECT * FROM memo_documents WHERE memo_id = in_id;
    ELSEIF query_type = 'byFacility' THEN
        SELECT * FROM memo_documents WHERE facilityId = facilityId;
    END IF;
END;


-------------------------------------------------------------------------------------------------------------------
---------------------------------------------------26/08/2026------------------------------------------------------
DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `business_settings`(IN `query_type` VARCHAR(20), IN `in_head` VARCHAR(20), IN `in_facilityid` VARCHAR(50))
BEGIN
IF query_type = 'Payable' THEN
update business set payable_code = in_head where id = in_facilityid;

ELSEIF query_type = 'Receivable' THEN
update business set receivable_code = in_head where id = in_facilityid;

ELSEIF query_type = 'Cost Of Service' THEN
update business set cost_of_sale = in_head where id = in_facilityid;

ELSEIF query_type = 'Sales Revenue' THEN
update business set sale_revenue_code = in_head where id = in_facilityid;

ELSEIF query_type = 'Accural' THEN
update business set accural_code = in_head where id = in_facilityid;

ELSEIF query_type = 'Prepayment' THEN
update business set prepayment_code = in_head where id = in_facilityid;

ELSEIF query_type = 'Inventory Valuation Method' THEN
update business set inv_ev_m = in_head where id = in_facilityid;

END IF;
 SELECT * FROM business where id=in_facilityid;
END$$
DELIMITER ;

----- Added the columns "prepayment_code" and "accural_code" to the business table on 26/08/2026

prepayment_code,accural_code
-- Drop if exists to avoid conflicts
DROP PROCEDURE IF EXISTS `get_business_profile`;

DELIMITER $$

CREATE DEFINER=`root`@`localhost` PROCEDURE `get_business_profile`(
    IN `in_user_id` VARCHAR(50)
)
BEGIN
    SELECT
        b.id,
        b.business_name,
        b.business_type,
        b.business_logo,
        b.primary_color,
        b.secondary_color,
        b.business_phone,
        b.prefix,
        b.payable_code,
        b.prepayment_code,
        b.receivable_code,
        b.cost_of_sale,
        b.accrual_code,
        b.sale_revenue_code,
        b.inv_ev_m,
        m.access_to,
        m.functionalities
    FROM membership m
    INNER JOIN business b ON m.business_id = b.id
    WHERE m.user_id = in_user_id;
END$$

DELIMITER ;


DROP PROCEDURE IF EXISTS `business_settings`;
DELIMITER //
CREATE DEFINER=`root`@`localhost` PROCEDURE `business_settings`(
    IN `query_type` VARCHAR(20),
    IN `in_head` VARCHAR(20),
    IN `in_facilityid` VARCHAR(50),
    IN `in_user_id` VARCHAR(50)
)
NOT DETERMINISTIC
CONTAINS SQL
SQL SECURITY DEFINER
BEGIN
    IF query_type = 'Payable' THEN
        UPDATE business
        SET payable_code = in_head
        WHERE id = in_facilityid;

    ELSEIF query_type = 'Receivable' THEN
        UPDATE business
        SET receivable_code = in_head
        WHERE id = in_facilityid;

    ELSEIF query_type = 'Cost Of Service' THEN
        UPDATE business
        SET cost_of_sale = in_head
        WHERE id = in_facilityid;

    ELSEIF query_type = 'Sales Revenue' THEN
        UPDATE business
        SET sale_revenue_code = in_head
        WHERE id = in_facilityid;

    ELSEIF query_type = 'Accrual' THEN
        UPDATE business
        SET accrual_code = in_head
        WHERE id = in_facilityid;

    ELSEIF query_type = 'Prepayment' THEN
        UPDATE business
        SET prepayment_code = in_head
        WHERE id = in_facilityid;
    END IF;

    SELECT
        b.*,
        m.access_to,
        m.functionalities
    FROM membership m
    INNER JOIN business b ON m.business_id = b.id
    WHERE m.user_id = in_user_id;
END;
//
DELIMITER ;



-------------------------------------------------------------------------------------------------------------------
---------------------------------------------------27/08/2026------------------------------------------------------

ALTER TABLE `logs` ADD `facilityId` VARCHAR(100) NOT NULL AFTER `date`;

DROP PROCEDURE IF EXISTS `addLog`;
DELIMITER //
CREATE PROCEDURE `addLog`(
    IN `in_type` VARCHAR(255),
    IN `in_name` VARCHAR(255),
    IN `in_role` VARCHAR(255),
    IN `in_id_link` VARCHAR(255),
    IN `in_remark` VARCHAR(255),
    IN `in_user_id` VARCHAR(255),
    IN `query_type` VARCHAR(255),
    IN `in_status` VARCHAR(20),
    IN `in_amount` DECIMAL(20,3),
    IN `in_facilityId` VARCHAR(100)
)
NOT DETERMINISTIC
CONTAINS SQL
SQL SECURITY DEFINER
BEGIN
    -- Regardless of query_type, we insert into logs
    INSERT INTO logs (
        type,
        name,
        amount,
        role,
        id_link,
        remark,
        user_id,
        status,
        facilityId
    )
    VALUES (
        in_type,
        in_name,
        in_amount,
        in_role,
        in_id_link,
        in_remark,
        in_user_id,
        in_status,
        in_facilityId
    );
END;
//
DELIMITER ;

ALTER TABLE `taxes` ADD `tax-type` ENUM('inclusive','exclusive') NOT NULL DEFAULT 'inclusive' AFTER `rate`;


ALTER TABLE `business` CHANGE `prepayment_code` `receivable_prepayment_code` VARCHAR(100) CHARACTER SET latin1 COLLATE latin1_swedish_ci NULL DEFAULT NULL, CHANGE `accural_code` `receivable_accural_code` VARCHAR(100) CHARACTER SET latin1 COLLATE latin1_swedish_ci NULL DEFAULT NULL;

ALTER TABLE `business` ADD `payable_accural_code` VARCHAR(100) NOT NULL AFTER `receivable_accural_code`, ADD `payable_prepayment_code` VARCHAR(100) NOT NULL AFTER `payable_accural_code`;

ALTER TABLE `business` CHANGE `payable_accural_code` `payable_accural_code` VARCHAR(100) CHARACTER SET latin1 COLLATE latin1_swedish_ci NULL, CHANGE `payable_prepayment_code` `payable_prepayment_code` VARCHAR(100) CHARACTER SET latin1 COLLATE latin1_swedish_ci NULL;

DROP PROCEDURE `get_business_profile`;
CREATE DEFINER=`root`@`localhost` PROCEDURE `get_business_profile`(IN `in_user_id` VARCHAR(50)) NOT DETERMINISTIC CONTAINS SQL SQL SECURITY DEFINER BEGIN
    SELECT
        b.id,
        b.business_name,
        b.business_type,
        b.business_logo,
        b.primary_color,
        b.secondary_color,
        b.business_phone,
        b.prefix,
        b.payable_code,
        b.payable_prepayment_code,
        b.receivable_code,
        b.cost_of_sale,
        b.payable_accural_code,
        b.receivable_prepayment_code,
        b.receivable_accural_code,
        b.sale_revenue_code,
        b.inv_ev_m,
        m.access_to,
        m.functionalities
    FROM membership m
    INNER JOIN business b ON m.business_id = b.id
    WHERE m.user_id = in_user_id;
END

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `business_settings`(IN `query_type` VARCHAR(50), IN `in_head` VARCHAR(50), IN `in_facilityid` VARCHAR(50), IN `in_user_id` VARCHAR(50))
BEGIN
    IF query_type = 'Payable' THEN
        UPDATE business SET payable_code = in_head WHERE id = in_facilityid;

    ELSEIF query_type = 'Receivable' THEN
        UPDATE business SET receivable_code = in_head WHERE id = in_facilityid;

    ELSEIF query_type = 'Cost Of Service' THEN
        UPDATE business SET cost_of_sale = in_head WHERE id = in_facilityid;

    ELSEIF query_type = 'Sales Revenue' THEN
        UPDATE business SET sale_revenue_code = in_head WHERE id = in_facilityid;

    ELSEIF query_type = 'Payable Accural' THEN
        UPDATE business SET payable_accural_code = in_head WHERE id = in_facilityid;

    ELSEIF query_type = 'Payable Prepayment' THEN
        UPDATE business SET payable_prepayment_code = in_head WHERE id = in_facilityid;

    ELSEIF query_type = 'Receivable Accural' THEN
        UPDATE business SET receivable_accural_code = in_head WHERE id = in_facilityid;

    ELSEIF query_type = 'Receivable Prepayment' THEN
        UPDATE business SET receivable_prepayment_code = in_head WHERE id = in_facilityid;

    ELSEIF query_type = 'Inventory Valuation Method' THEN
        UPDATE business SET inv_ev_m = in_head WHERE id = in_facilityid;
    END IF;

    SELECT
        b.id,
        b.business_name,
        b.business_type,
        b.business_logo,
        b.primary_color,
        b.secondary_color,
        b.business_phone,
        b.prefix,
        b.payable_code,
        b.payable_prepayment_code,
        b.receivable_code,
        b.cost_of_sale,
        b.payable_accural_code,
        b.receivable_prepayment_code,
        b.receivable_accural_code,
        b.sale_revenue_code,
        b.inv_ev_m,
        m.access_to,
        m.functionalities
    FROM membership m
    INNER JOIN business b ON m.business_id = b.id
    WHERE m.user_id = in_user_id and id = in_facilityid;
END$$
DELIMITER ;




-------------------------------------------------------------------------------------------------------------------
---------------------------------------------------03/09/2026------------------------------------------------------

ALTER TABLE `users` ADD `signature` LONGTEXT NOT NULL AFTER `teamId`;
ALTER TABLE business ADD COLUMN seal LONGTEXT NULL;



-------------------------------------------------------------------------------------------------------------------
---------------------------------------------------03/09/2026------------------------------------------------------

DROP PROCEDURE `get_business_profile`;
DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `get_business_profile`(IN `in_user_id` VARCHAR(50))
BEGIN
    SELECT
        b.id,
        b.business_name,
        b.business_type,
        b.business_logo,
        b.primary_color,
        b.secondary_color,
        b.business_phone,
        b.prefix,
        b.payable_code,
        b.payable_prepayment_code,
        b.receivable_code,
        b.cost_of_sale,
        b.payable_accural_code,
        b.receivable_prepayment_code,
        b.receivable_accural_code,
        b.sale_revenue_code,
        b.inv_ev_m,
        b.seal,
        m.access_to,
        m.functionalities
    FROM membership m
    INNER JOIN business b ON m.business_id = b.id
    WHERE m.user_id = in_user_id;
END$$
DELIMITER ;



-------------------------------------------------------------------------------------------------------------------
---------------------------------------------------08/09/2026------------------------------------------------------

ALTER TABLE `users` CHANGE `signature` `signature` LONGTEXT CHARACTER SET latin1 COLLATE latin1_swedish_ci NULL;

ALTER TABLE `business` ADD `stamp` LONGTEXT NULL AFTER `seal`;




-------------------------------------------------------------------------------------------------------------------
---------------------------------------------------11/09/2026------------------------------------------------------

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `customer`(IN `in_query_type` VARCHAR(50), IN `in_customer_no` VARCHAR(50), IN `in_account_head` VARCHAR(30), IN `in_sub_head` VARCHAR(50), IN `in_address` VARCHAR(250), IN `in_phone` VARCHAR(20), IN `in_mail` VARCHAR(80), IN `in_fullname` VARCHAR(50), IN `in_store` VARCHAR(50), IN `in_status` VARCHAR(50), IN `in_credit_limit` INT, IN `in_facility_id` VARCHAR(50), IN `in_customer_type` VARCHAR(50), IN `in_date` DATE)
BEGIN
    IF in_query_type = 'create' THEN
        INSERT INTO `customers`(
            `customerNo`, `account_head`, `subhead`, `address`, `phone`, `email`,
            `fullname`, `customer_type`, `store_name`, `status`, `credit_limit`, `facilityId`
        )
        VALUES(
            in_customer_no, in_account_head, in_sub_head, in_address, in_phone,
            in_mail, in_fullname, in_customer_type, in_store, in_status, in_credit_limit, in_facility_id
        );

    ELSEIF in_query_type = 'create_supplier' THEN
        INSERT INTO `suppliersinfo`(
            `facilityId`, `supplier_number`, `supplier_name`, `date`, `address`,
            `phone`, `supplier_code`, `supplier_subhead`, `status`, `email`
        )
        VALUES(
            in_facility_id, in_customer_no, in_fullname, in_date, in_address,
            in_phone, in_account_head, in_sub_head, in_status, in_mail
        );

    ELSEIF in_query_type = 'update' THEN
        UPDATE `customers`
        SET
            `address`        = in_address,
            `phone`          = in_phone,
            `email`          = in_mail,
            `fullname`       = in_fullname,
            `customer_type`  = in_customer_type
        WHERE `customerNo` = in_customer_no
          AND `facilityId` = in_facility_id;

    ELSEIF in_query_type = 'customers' THEN
        SELECT
          a.*,
          COALESCE(SUM(b.dr - b.cr), 0) AS balance
        FROM
          customers a
        LEFT JOIN
          customer_entries b
            ON a.customerNo = b.customerNo
        WHERE a.facilityId = in_facility_id
        GROUP BY a.customerNo;

    ELSEIF in_query_type = 'customer_by_id' THEN
        SELECT *
        FROM customers
        WHERE customerNo = in_customer_no;

    END IF;
END$$
DELIMITER ;


DELIMITER $$

CREATE PROCEDURE getMemoVoucherList(
    IN _facilityId VARCHAR(100),
    IN _status VARCHAR(50),
    IN _dateFrom DATE,
    IN _dateTo DATE
)
BEGIN
    SELECT *
    FROM memo
    WHERE facilityId = _facilityId
      AND (
          _status = 'all'
          OR status = _status
          OR (_status = '' AND status IN ('approved', 'Pv Generated'))
      )
      AND (
          (_dateFrom IS NULL OR date >= _dateFrom)
          AND (_dateTo IS NULL OR date <= _dateTo)
      )
    ORDER BY date DESC;
END $$

DELIMITER ;




-------------------------------------------------------------------------------------------------------------------
---------------------------------------------------18/09/2026------------------------------------------------------

ALTER TABLE `leave_balances` CHANGE `leaveType` `leaveType` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL;

ALTER TABLE `leave_balances` ADD CONSTRAINT `leave_type` FOREIGN KEY (`leaveType`) REFERENCES `leave_types`(`code`) ON DELETE NO ACTION ON UPDATE NO ACTION;



-------------------------------------------------------------------------------------------------------------------
---------------------------------------------------19/09/2026------------------------------------------------------

DELETE s1 FROM supplier_account_information s1 INNER JOIN supplier_account_information s2 WHERE s1.account_number = s2.account_number AND s1.facilityId = s2.facilityId AND s1.id < s2.id;

--
ALTER TABLE `business` ADD `costing_method` ENUM('','process_costing','job_product_costing') NOT NULL;
ALTER TABLE `business` ADD `vat_policy` ENUM('vat_inclusive','vat_exclusive') NOT NULL AFTER `costing_method`;
get_business_profile

ALTER TABLE products
ADD COLUMN taxable ENUM('Taxable', 'Not Taxable') NOT NULL;
ALTER TABLE `taxes`
  DROP `tax_type`;

ALTER TABLE `material_requisition_items` CHANGE `quantity_requested` `quantity_requested` DECIMAL(15,4) NOT NULL DEFAULT '0.00', CHANGE `quantity_approved` `quantity_approved` DECIMAL(15,4) NULL DEFAULT '0.00', CHANGE `quantity_issued` `quantity_issued` DECIMAL(15,4) NULL DEFAULT '0.00';
ALTER TABLE `business` ADD `pro_bono_code` VARCHAR(100) NULL AFTER `vat_policy`;

ALTER TABLE `customer_entries` CHANGE `type` `type` ENUM('deposit','discount','sales','tax','service','opening_balance','pro-bono') CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL;



ALTER TABLE `products` ADD `group_id` VARCHAR(100) NULL AFTER `taxable`;

ALTER TABLE `production_records` ADD `type` ENUM('job_specific','joint_shared') NOT NULL AFTER `data`;
ALTER TABLE `store_entries` ADD `multple` VARCHAR(100) NOT NULL AFTER `mark_up`, ADD `location` VARCHAR(100) NOT NULL AFTER `multple`;
ALTER TABLE business ADD `tin` VARCHAR(100) NULL;
ALTER TABLE customers ADD `tin` VARCHAR(100) NULL;
ALTER TABLE suppliersinfo ADD `tin` VARCHAR(100) NULL;
ALTER TABLE `invoices` ADD `project_id` VARCHAR(100) NULL AFTER `customerNo`;
ALTER TABLE `general_ledger` ADD `project_id` VARCHAR(100) NULL;


ALTER TABLE `business` CHANGE `vat_policy` `vat_policy` ENUM('vat_inclusive','vat_exclusive','all') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL;
ALTER TABLE `supplier_entries` ADD `receiptNo` VARCHAR(100) NOT NULL AFTER `cheque_no`;
