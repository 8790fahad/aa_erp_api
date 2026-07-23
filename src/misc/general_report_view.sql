select 
    `description` AS `description`,`facilityId` AS `facilityId`,`Account_head` AS `Account_Head`,`credit` AS `credit`,`debit` AS `debit`,`transaction_id` AS `transaction_id`,`mode` AS `mode`,`day` AS `day`,`pscprim1_hms`.`account`.`subhead` AS `head` 
    from (
        (
            (
                select `description` AS `description`,`facilityId` AS `facilityId`,`transaction_source` AS `Account_head`,`amount` AS `credit`,0 AS `debit`,`transaction_id` AS `transaction_id`,`modeOfPayment` AS `mode`,
                cast(`createdAt` as date) AS `day`,
                NULL AS `head` from `transactions` where `transaction_source` in (select distinct `transaction_source` from `transactions`)
            ) union select `description` AS `description`,`facilityId` AS `facilityId`,`destination` AS `Account_head`,0 AS `credit`,`amount` AS `debit`,`transaction_id` AS `transaction_id`,`modeOfPayment` AS `mode`,cast(`createdAt` as date) AS `day`,NULL AS `head` from `transactions` where `destination` in (select distinct `destination` from `transactions`)
        ) `stmt` join `account`) where (`Account_head` = `account`.`head`) 
order by `transaction_id`