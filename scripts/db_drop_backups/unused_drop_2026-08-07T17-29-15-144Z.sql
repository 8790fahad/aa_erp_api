-- Backup before dropping unused objects from aa_erp_db
-- 2026-08-07T17:29:15.164Z
SET FOREIGN_KEY_CHECKS=0;

DROP TABLE IF EXISTS `bank_reconciliation`;
CREATE TABLE `bank_reconciliation` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `bank_code` varchar(20) NOT NULL,
  `txn_date` date NOT NULL,
  `description` text NOT NULL,
  `debit` double NOT NULL,
  `credit` double NOT NULL,
  `matched` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL,
  `gl_id` int(11) DEFAULT NULL,
  `facility_id` varchar(50) NOT NULL,
  `user_id` varchar(50) DEFAULT NULL COMMENT 'Acting / owning user id for create-update-delete tracking',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `branch_store_list3`;
CREATE TABLE `branch_store_list3` (
  `item_name` varchar(100) DEFAULT NULL,
  `location_to` varchar(100) DEFAULT NULL,
  `expiring_date` varchar(19) DEFAULT NULL,
  `balance` decimal(33,0) DEFAULT NULL,
  `selling_price` int(11) DEFAULT NULL,
  `location_from` varchar(60) DEFAULT NULL,
  `transaction_date` varchar(20) DEFAULT NULL,
  `user_id` varchar(50) DEFAULT NULL COMMENT 'Acting / owning user id for create-update-delete tracking'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `feedbacks`;
CREATE TABLE `feedbacks` (
  `id` char(36) NOT NULL,
  `userId` varchar(255) DEFAULT NULL,
  `message` varchar(255) DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `user_id` varchar(50) DEFAULT NULL COMMENT 'Acting / owning user id for create-update-delete tracking',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `materials_collection`;
CREATE TABLE `materials_collection` (
  `collection_id` varchar(50) NOT NULL,
  `customer_id` varchar(50) NOT NULL,
  `pass` varchar(50) NOT NULL,
  `customer_name` varchar(100) NOT NULL,
  `date` datetime NOT NULL,
  `status` varchar(50) NOT NULL,
  `facilityId` varchar(50) NOT NULL,
  `user_id` varchar(50) DEFAULT NULL COMMENT 'Acting / owning user id for create-update-delete tracking',
  PRIMARY KEY (`collection_id`,`facilityId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `overview_wo_store`;
CREATE TABLE `overview_wo_store` (
  `drug` varchar(100) DEFAULT NULL,
  `price` bigint(20) DEFAULT NULL,
  `quantity_in_shelf` decimal(33,0) DEFAULT NULL,
  `amount_in_shelf` decimal(44,0) DEFAULT NULL,
  `quantity_sold` decimal(33,0) DEFAULT NULL,
  `amount_sold` decimal(44,0) DEFAULT NULL,
  `expiry_date` varchar(10) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `facilityId` varchar(50) DEFAULT NULL,
  `user_id` varchar(50) DEFAULT NULL COMMENT 'Acting / owning user id for create-update-delete tracking'
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

DROP TABLE IF EXISTS `point_sale_search`;
CREATE TABLE `point_sale_search` (
  `trn_number` varchar(50) DEFAULT NULL,
  `item_name` varchar(100) DEFAULT NULL,
  `balance` decimal(65,0) DEFAULT NULL,
  `location_to` varchar(100) DEFAULT NULL,
  `expiring_date` varchar(19) DEFAULT NULL,
  `selling_price` int(11) DEFAULT NULL,
  `location_from` varchar(60) DEFAULT NULL,
  `transaction_date` varchar(20) DEFAULT NULL,
  `user_id` varchar(50) DEFAULT NULL COMMENT 'Acting / owning user id for create-update-delete tracking'
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

DROP TABLE IF EXISTS `point_sale_table`;
CREATE TABLE `point_sale_table` (
  `trn_number` int(11) DEFAULT NULL,
  `expiring_date` varchar(19) DEFAULT NULL,
  `item_name` varchar(100) DEFAULT NULL,
  `quantity` double DEFAULT NULL,
  `selling_price` varchar(100) DEFAULT NULL,
  `location_to` varchar(100) DEFAULT NULL,
  `location_from` varchar(60) DEFAULT NULL,
  `user_id` varchar(50) DEFAULT NULL COMMENT 'Acting / owning user id for create-update-delete tracking'
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

DROP TABLE IF EXISTS `public_holidays`;
CREATE TABLE `public_holidays` (
  `id` varchar(64) NOT NULL,
  `facilityId` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `holiday_name` varchar(255) NOT NULL,
  `holiday_date` date NOT NULL,
  `description` text DEFAULT NULL,
  `is_recurring` tinyint(1) NOT NULL DEFAULT 0,
  `status` enum('active','inactive') NOT NULL DEFAULT 'active',
  `created_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `user_id` varchar(50) DEFAULT NULL COMMENT 'Acting / owning user id for create-update-delete tracking',
  PRIMARY KEY (`id`),
  KEY `idx_public_holidays_facility_date` (`facilityId`,`holiday_date`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `record_production`;
CREATE TABLE `record_production` (
  `production_id` varchar(50) NOT NULL,
  `customer_id` varchar(50) NOT NULL,
  `customer_name` varchar(50) NOT NULL,
  `date` date NOT NULL,
  `team` varchar(100) NOT NULL,
  `shift` varchar(50) NOT NULL,
  `facilityId` varchar(500) NOT NULL,
  `user_id` varchar(50) DEFAULT NULL COMMENT 'Acting / owning user id for create-update-delete tracking',
  PRIMARY KEY (`production_id`,`facilityId`),
  KEY `customer_id` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP VIEW IF EXISTS `account_head`;
CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `account_head` AS select `a`.`head` AS `head`,`a`.`subhead` AS `subhead`,`a`.`description` AS `description`,`b`.`description` AS `des` from (`account` `a` join `account` `b` on(`a`.`head` = `b`.`subhead`));

DROP VIEW IF EXISTS `inventory_list`;
CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `inventory_list` AS select `p`.`id` AS `id`,`p`.`name` AS `name`,`p`.`sku` AS `sku`,`p`.`facility_id` AS `facility_id`,`p`.`item_type` AS `item_type`,`p`.`category` AS `category`,`p`.`unit_of_measure` AS `unit_of_measure`,`p`.`cost_price` AS `cost_price`,`p`.`selling_price` AS `selling_price`,`p`.`status` AS `status`,`p`.`image_url` AS `image_url`,`p`.`reorder_level` AS `reorder_level`,`se`.`expiry_date` AS `expiry_date`,coalesce(sum(`se`.`qty_in` - `se`.`qty_out`),0) AS `available` from (`products` `p` left join `store_entries` `se` on(`se`.`product_id` = `p`.`sku` and (`se`.`expiry_date` >= curdate() or `se`.`expiry_date` is null))) group by `p`.`id`,`p`.`name`,`se`.`expiry_date` order by `p`.`cost_price`,`p`.`selling_price`,`se`.`expiry_date`;

DROP VIEW IF EXISTS `v_invoice_payment_status`;
CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `v_invoice_payment_status` AS select `i`.`invoice_id` AS `invoice_id`,`i`.`invoice_ref` AS `invoice_ref`,`i`.`ref_number` AS `ref_number`,`i`.`customerNo` AS `customerNo`,`i`.`transaction_date` AS `transaction_date`,`i`.`due_date` AS `due_date`,`i`.`amount` AS `invoice_amount`,coalesce(`p`.`total_paid`,0) AS `total_paid`,`i`.`amount` - coalesce(`p`.`total_paid`,0) AS `balance_due`,case when coalesce(`p`.`total_paid`,0) = 0 then 'Not Deposited' when coalesce(`p`.`total_paid`,0) >= `i`.`amount` then 'Paid' when coalesce(`p`.`total_paid`,0) < `i`.`amount` then 'Deposited' end AS `payment_status`,case when `i`.`amount` - coalesce(`p`.`total_paid`,0) = 0 then 'Settled' when `i`.`due_date` < curdate() then 'Overdue' else 'Not Due Yet' end AS `due_status` from (`invoices` `i` left join (select `general_ledger`.`transaction_ref` AS `transaction_ref`,sum(`general_ledger`.`dr` - `general_ledger`.`cr`) AS `total_paid` from `general_ledger` where `general_ledger`.`type` = 'deposit' group by `general_ledger`.`transaction_ref`) `p` on(`p`.`transaction_ref` = `i`.`customerNo`)) where 1;

DROP VIEW IF EXISTS `vw_ar_ap_aging`;
CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `vw_ar_ap_aging` AS with balances as (select coalesce(`i`.`customerNo`,`i`.`ref_number`) AS `party_id`,'customer' AS `party_type`,sum(`i`.`amount`) AS `invoice_total`,coalesce((select sum(`gl`.`cr`) - sum(`gl`.`dr`) from `general_ledger` `gl` where `gl`.`type` in ('recevable','deposit') and `gl`.`facility_id` = `i`.`facility_id` and `gl`.`transaction_ref` = coalesce(`i`.`customerNo`,`i`.`ref_number`)),0) AS `payments_received`,sum(`i`.`amount`) - coalesce((select sum(`gl`.`cr`) - sum(`gl`.`dr`) from `general_ledger` `gl` where `gl`.`type` in ('recevable','deposit') and `gl`.`facility_id` = `i`.`facility_id` and `gl`.`transaction_ref` = coalesce(`i`.`customerNo`,`i`.`ref_number`)),0) AS `outstanding_balance` from `invoices` `i` where `i`.`type` = 'sales' and `i`.`facility_id` = 'ae9d49ee-3f9c-4f1e-bd6c-d2f18c61269f' group by coalesce(`i`.`customerNo`,`i`.`ref_number`),`i`.`facility_id` union all select `i`.`ref_number` AS `party_id`,'supplier' AS `party_type`,sum(`i`.`amount`) AS `invoice_total`,coalesce((select sum(`gl`.`dr`) - sum(`gl`.`cr`) from `general_ledger` `gl` where `gl`.`transaction_ref` = `i`.`ref_number` and `gl`.`facility_id` = `i`.`facility_id`),0) AS `payments_made`,sum(`i`.`amount`) - coalesce((select sum(`gl`.`dr`) - sum(`gl`.`cr`) from `general_ledger` `gl` where `gl`.`transaction_ref` = `i`.`ref_number` and `gl`.`facility_id` = `i`.`facility_id`),0) AS `outstanding_balance` from `invoices` `i` where `i`.`type` = 'purchase' and `i`.`facility_id` = 'ae9d49ee-3f9c-4f1e-bd6c-d2f18c61269f' group by `i`.`ref_number`,`i`.`facility_id`), invoice_details as (select `i`.`invoice_id` AS `invoice_id`,coalesce(`i`.`customerNo`,`i`.`ref_number`) AS `party_id`,'customer' AS `party_type`,`i`.`amount` AS `invoice_amount`,`i`.`due_date` AS `due_date`,to_days(curdate()) - to_days(`i`.`due_date`) AS `days_overdue` from `invoices` `i` where `i`.`type` = 'sales' union all select `i`.`invoice_id` AS `invoice_id`,`i`.`ref_number` AS `party_id`,'supplier' AS `party_type`,`i`.`amount` AS `invoice_amount`,`i`.`due_date` AS `due_date`,to_days(curdate()) - to_days(`i`.`due_date`) AS `days_overdue` from `invoices` `i` where `i`.`type` = 'purchase')select `b`.`party_id` AS `party_id`,`b`.`party_type` AS `party_type`,`b`.`outstanding_balance` AS `total_outstanding`,sum(case when `b`.`outstanding_balance` > 0 and `id`.`days_overdue` <= 30 then `id`.`invoice_amount` else 0 end) AS `bucket_current`,sum(case when `b`.`outstanding_balance` > 0 and `id`.`days_overdue` between 31 and 60 then `id`.`invoice_amount` else 0 end) AS `bucket_31_60`,sum(case when `b`.`outstanding_balance` > 0 and `id`.`days_overdue` between 61 and 90 then `id`.`invoice_amount` else 0 end) AS `bucket_61_90`,sum(case when `b`.`outstanding_balance` > 0 and `id`.`days_overdue` between 91 and 120 then `id`.`invoice_amount` else 0 end) AS `bucket_91_120`,sum(case when `b`.`outstanding_balance` > 0 and `id`.`days_overdue` > 120 then `id`.`invoice_amount` else 0 end) AS `bucket_over_120`,sum(case when `id`.`days_overdue` > 0 then `id`.`invoice_amount` else 0 end) AS `total_overdue_amount`,sum(case when `id`.`days_overdue` between -30 and 30 then `id`.`invoice_amount` else 0 end) AS `upcoming_or_due_soon` from (`balances` `b` left join `invoice_details` `id` on(`id`.`party_id` = `b`.`party_id` and `id`.`party_type` = `b`.`party_type`)) group by `b`.`party_id`,`b`.`party_type`;

DROP PROCEDURE IF EXISTS `addLog`;
DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `addLog`(IN `in_type` VARCHAR(255), IN `in_name` VARCHAR(255), IN `in_role` VARCHAR(255), IN `in_id_link` VARCHAR(255), IN `in_remark` VARCHAR(255), IN `in_user_id` VARCHAR(255), IN `query_type` VARCHAR(255), IN `in_status` VARCHAR(20), IN `in_amount` DECIMAL(20,3), IN `in_facilityId` VARCHAR(100))
BEGIN
    
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
END $$
DELIMITER ;

DROP FUNCTION IF EXISTS `generate_account_code`;
DELIMITER $$
CREATE DEFINER=`root`@`localhost` FUNCTION `generate_account_code`(p_parent_code VARCHAR(20), p_facility_id VARCHAR(36)) RETURNS varchar(50) CHARSET latin1 COLLATE latin1_swedish_ci
    READS SQL DATA
    DETERMINISTIC
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
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS `getMemoList`;
DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `getMemoList`(IN `_facilityId` VARCHAR(100), IN `_status` VARCHAR(100), IN `query_type` VARCHAR(100), IN `in_user_id` VARCHAR(50), IN `in_memo_id` VARCHAR(20))
BEGIN
    IF query_type = 'list' THEN
        SELECT *
        FROM memo
        WHERE facilityId = _facilityId
          AND (_status = 'all' OR status = _status)
        ORDER BY date DESC;

    ELSEIF query_type = 'voucher' THEN
        SELECT *
        FROM memo
        WHERE facilityId = _facilityId
          AND status IN ('approved', 'Pv Generated')
        ORDER BY date DESC;

    ELSEIF query_type = 're_list' THEN
        SELECT *
        FROM memo
        WHERE facilityId = _facilityId
          AND status = 'reviewed'
        ORDER BY date DESC;
 ELSEIF query_type = 'closed' THEN
        SELECT *
        FROM memo
        WHERE facilityId = _facilityId
          AND status = 'closed'
        ORDER BY date DESC;

    ELSEIF query_type = 'list_by_id' THEN
        SELECT *
        FROM memo
        WHERE facilityId = _facilityId
          AND (_status = 'all' OR status = _status)
          AND memo_id = in_memo_id
        ORDER BY date DESC;

    ELSEIF query_type = 'others' THEN
        SELECT *
        FROM memo
        WHERE facilityId = _facilityId
          AND status IN ('pending', 'Rejected')
          AND user_id = in_user_id
        ORDER BY date DESC;

    ELSEIF query_type = 'initial' THEN
        SELECT m.*,
               (SELECT remark
                FROM logs
                WHERE status = 'returned'
                  AND id_link = m.memo_id
                LIMIT 1) AS last_return_remark
        FROM memo m
        WHERE m.facilityId = _facilityId
          AND m.status IN ('pending', 'returned')
          AND m.user_id = in_user_id
        ORDER BY date DESC;

    ELSEIF query_type = 'review' THEN
        SELECT m.*,
               (SELECT remark
                FROM logs
                WHERE status = 'rejected'
                  AND id_link = m.memo_id
                LIMIT 1) AS last_return_remark
        FROM memo m
        WHERE m.facilityId = _facilityId
          AND (total - amount) > 0
          AND m.status IN ('pending', 'rejected', 'Part Payment')
        ORDER BY date DESC;
    END IF;
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS `getMemoVoucherList`;
DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `getMemoVoucherList`(IN `_facilityId` VARCHAR(100), IN `_status` VARCHAR(50), IN `_dateFrom` DATE, IN `_dateTo` DATE)
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

DROP PROCEDURE IF EXISTS `get_purchase_order`;
DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `get_purchase_order`(IN `in_facilityId` VARCHAR(50), IN `in_status` VARCHAR(50))
    NO SQL
BEGIN
SELECT * FROM purchase_order ;

END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS `report_expenditure`;
DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `report_expenditure`(IN `fromDate` VARCHAR(10), IN `toDate` VARCHAR(10), IN `facId` VARCHAR(50))
BEGIN
    SELECT t.date, t.services, t.amount, @running_total:=@running_total + t.balance AS bal
        FROM
        (SELECT createdAt as date, transaction_source as services, debited as amount, SUM(debited) as balance
         FROM `expenditure_view` WHERE (createdAt BETWEEN fromDate AND toDate) AND (facilityId=facId)
         GROUP BY date, transaction_source, debited) t
        JOIN (SELECT @running_total:=0) r
        ORDER BY t.date;
END $$
DELIMITER ;

SET FOREIGN_KEY_CHECKS=1;