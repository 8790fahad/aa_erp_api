-- phpMyAdmin SQL Dump
-- version 4.8.3
-- https://www.phpmyadmin.net/
--
-- Host: localhost:3306
-- Generation Time: Jul 15, 2020 at 04:20 AM
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
-- Structure for view `revenue_view`
--

CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `revenue_view`  AS  select `a`.`subhead` AS `subHead`,`b`.`description` AS `description`,`b`.`modeOfPayment` AS `modeOfPayment`,`b`.`destination` AS `destination`,`b`.`createdAt` AS `createdAt`,`b`.`debited` AS `debited` from (`account` `a` join `transactions` `b`) where (`a`.`head` = `b`.`destination`) ;

--
-- VIEW  `revenue_view`
-- Data: None
--

COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
