-- phpMyAdmin SQL Dump
-- version 4.8.3
-- https://www.phpmyadmin.net/
--
-- Host: localhost:3306
-- Generation Time: Jul 15, 2020 at 04:19 AM
-- Server version: 5.7.31
-- PHP Version: 7.2.7

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET AUTOCOMMIT = 0;
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `mylikita`
--

-- --------------------------------------------------------

--
-- Structure for view `general_report`
--

CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `general_report`  AS  select `stmt`.`description` AS `description`,`stmt`.`facilityId` AS `facilityId`,`stmt`.`Account_head` AS `Account_Head`,`stmt`.`credit` AS `credit`,`stmt`.`debit` AS `debit`,`stmt`.`transaction_id` AS `transaction_id`,`stmt`.`mode` AS `mode`,`stmt`.`day` AS `day`,`account`.`subhead` AS `head` from (((select `transactions`.`description` AS `description`,`transactions`.`facilityId` AS `facilityId`,`transactions`.`transaction_source` AS `Account_head`,`transactions`.`amount` AS `credit`,0 AS `debit`,`transactions`.`transaction_id` AS `transaction_id`,`transactions`.`modeOfPayment` AS `mode`,cast(`transactions`.`createdAt` as date) AS `day`,NULL AS `head` from `transactions` where `transactions`.`transaction_source` in (select distinct `transactions`.`transaction_source` from `transactions`)) union select `transactions`.`description` AS `description`,`transactions`.`facilityId` AS `facilityId`,`transactions`.`destination` AS `Account_head`,0 AS `credit`,`transactions`.`amount` AS `debit`,`transactions`.`transaction_id` AS `transaction_id`,`transactions`.`modeOfPayment` AS `mode`,cast(`transactions`.`createdAt` as date) AS `day`,NULL AS `head` from `transactions` where `transactions`.`destination` in (select distinct `transactions`.`destination` from `transactions`)) `stmt` join `account`) where (`stmt`.`Account_head` = `account`.`head`) order by `stmt`.`transaction_id` ;

--
-- VIEW  `general_report`
-- Data: None
--

COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
