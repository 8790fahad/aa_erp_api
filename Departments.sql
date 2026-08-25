-- phpMyAdmin SQL Dump
-- version 5.2.2
-- https://www.phpmyadmin.net/
--
-- Host: localhost:3306
-- Generation Time: Sep 11, 2025 at 03:38 PM
-- Server version: 10.11.13-MariaDB
-- PHP Version: 8.3.22

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `kirmaskngov_aa_erp`
--

-- --------------------------------------------------------

--
-- Table structure for table `Departments`
--

CREATE TABLE `Departments` (
  `id` int(11) NOT NULL,
  `departmentName` varchar(255) NOT NULL,
  `departmentCode` varchar(255) DEFAULT NULL,
  `facilityId` varchar(255) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `headOfDepartment` char(36) CHARACTER SET latin1 COLLATE latin1_bin DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `status` enum('active','inactive') DEFAULT 'active'
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `Departments`
--

INSERT INTO `Departments` (`id`, `departmentName`, `departmentCode`, `facilityId`, `description`, `headOfDepartment`, `createdAt`, `updatedAt`, `status`) VALUES
(10, 'Human Resources', 'HR1', 'ae9d49ee-3f9c-4f1e-bd6c-d2f18c61269f', 'Manage salary and payment', '4', '2025-07-18 14:17:52', '2025-07-18 14:33:52', 'inactive'),
(11, 'Human Resources', 'HR001', 'ae9d49ee-3f9c-4f1e-bd6c-d2f18c61269f', 'Payment of salaries', '4', '2025-07-18 14:34:24', '2025-07-18 14:57:16', 'inactive'),
(12, 'Human Resources', 'HR001', 'ae9d49ee-3f9c-4f1e-bd6c-d2f18c61269f', 'Payment of salaries payemet', '4', '2025-07-18 14:34:39', '2025-07-18 14:57:21', 'inactive'),
(13, 'Human Resources', 'HR001', 'ae9d49ee-3f9c-4f1e-bd6c-d2f18c61269f', 'Payment of salaries payemet', '4', '2025-07-18 14:45:18', '2025-07-18 14:57:24', 'inactive'),
(14, 'Human Resources', 'HR001', 'ae9d49ee-3f9c-4f1e-bd6c-d2f18c61269f', 'Payment of salaries payemet rr', '4', '2025-07-18 14:46:05', '2025-07-18 14:57:26', 'inactive'),
(15, 'Human Resources', 'HR001', 'ae9d49ee-3f9c-4f1e-bd6c-d2f18c61269f', 'Payment of salaries payemet', '4', '2025-07-18 14:47:08', '2025-07-18 15:17:59', 'active'),
(16, 'Bitcoops', 'BIT', '9467f017-2bae-4205-a923-22ee04299832', 'For General Supply', 'USER-27', '2025-07-22 14:15:19', '2025-08-05 13:53:02', 'inactive'),
(17, 'Operation Department', 'OPR/001', '923077e7-4e68-466a-a831-24f389c534f1', 'managing Operations', 'USER-13', '2025-07-23 11:41:15', '2025-07-23 11:41:15', 'active'),
(18, 'Procurement Depertment', 'PR/001', '923077e7-4e68-466a-a831-24f389c534f1', 'General Purchase', 'USER-12', '2025-07-23 11:43:51', '2025-07-23 11:43:51', 'active'),
(19, 'Finance Department', 'ACC/001', '923077e7-4e68-466a-a831-24f389c534f1', 'All financial Affairs', 'USER-10', '2025-07-23 11:45:31', '2025-08-05 13:55:15', 'active'),
(20, 'Business development Depertment', 'BD/001', '923077e7-4e68-466a-a831-24f389c534f1', 'Business development', 'USER-35', '2025-07-23 12:11:53', '2025-07-23 12:11:53', 'active'),
(21, 'Procurement', 'PRC', '5823ddc6-557d-4564-a37b-166589664bfe', 'Procurement', 'USER-26', '2025-08-05 10:08:09', '2025-08-05 10:08:09', 'active'),
(22, 'Finance', 'Fin', '5823ddc6-557d-4564-a37b-166589664bfe', 'Finance Department', 'USER-10', '2025-08-05 10:09:15', '2025-08-05 10:09:15', 'active'),
(23, 'Procument', 'PRO', '9467f017-2bae-4205-a923-22ee04299832', 'For General supply', 'USER-27', '2025-08-05 13:53:30', '2025-08-05 13:53:30', 'active'),
(24, 'Finance', 'FIN', '9467f017-2bae-4205-a923-22ee04299832', 'All Finance Affairs', 'USER-10', '2025-08-05 13:55:12', '2025-08-05 13:55:12', 'active'),
(25, 'Technical', 'TECH', '9467f017-2bae-4205-a923-22ee04299832', 'For technical activities', '', '2025-08-05 13:56:18', '2025-08-05 13:56:18', 'active'),
(26, 'Procurement', 'PRO', '9053e623-9ea9-4b20-8086-7412c0d64a1c', 'General Supply', 'USER-28', '2025-08-05 14:49:43', '2025-08-05 14:49:43', 'active'),
(27, 'Finance', 'FIN', '9053e623-9ea9-4b20-8086-7412c0d64a1c', 'All financial affairs', 'USER-10', '2025-08-05 14:50:08', '2025-08-05 14:50:08', 'active'),
(28, 'Research & Development', 'R&D', '5823ddc6-557d-4564-a37b-166589664bfe', 'Research and Development Dept.', '', '2025-08-05 15:06:02', '2025-08-05 15:06:02', 'active'),
(29, 'Finance Department', 'FIN', '5b12ec5d-2932-413c-bc2e-bc30ff986067', 'All financial affairs ', 'USER-10', '2025-08-08 13:56:40', '2025-08-08 13:56:40', 'active'),
(30, 'Procurement Department', 'PRO', '5b12ec5d-2932-413c-bc2e-bc30ff986067', 'All purchases', 'USER-12', '2025-08-08 13:57:41', '2025-08-08 13:57:41', 'active'),
(31, 'Procurement Department', 'PRD001', '673ffaf7-93b4-4fac-9ba0-1d9c08ce35d9', 'For the purchase of the company items', 'USER-25', '2025-08-14 13:13:00', '2025-08-14 13:13:00', 'active'),
(32, 'Finance', 'FN002', '673ffaf7-93b4-4fac-9ba0-1d9c08ce35d9', 'Finacial management', 'USER-44', '2025-08-14 14:33:47', '2025-08-14 14:33:47', 'active'),
(33, 'Business Operations', 'OPR', '5823ddc6-557d-4564-a37b-166589664bfe', 'Business Operations', 'USER-26', '2025-08-15 10:08:32', '2025-08-15 10:08:32', 'active'),
(34, 'Finance Department', 'FD001', '673ffaf7-93b4-4fac-9ba0-1d9c08ce35d9', 'FINANCIAL ACTIVITY OF THE COMPANY', 'USER-10', '2025-08-16 15:12:01', '2025-08-16 15:12:01', 'active'),
(35, 'Human Resources Management', 'HR001', '673ffaf7-93b4-4fac-9ba0-1d9c08ce35d9', 'EMPLOYMENT OF THE STAFF', 'USER-45', '2025-08-16 15:13:55', '2025-08-16 15:13:55', 'active'),
(36, 'Finance Department', 'FIN', '4e51d935-88d1-4c5c-9237-6ab7bc8af044', 'All Financial Affairs', 'USER-10', '2025-08-19 13:09:50', '2025-08-19 13:09:50', 'active'),
(37, 'Operation Department', 'OPR-001', '4e51d935-88d1-4c5c-9237-6ab7bc8af044', 'Managing Operations', 'USER-49', '2025-08-19 13:15:23', '2025-08-19 13:15:23', 'active'),
(38, 'Procurement Department', 'PR-001', '4e51d935-88d1-4c5c-9237-6ab7bc8af044', 'General Purchased', 'USER-31', '2025-08-19 13:18:02', '2025-08-19 13:18:02', 'active'),
(39, 'Business Development Department ', 'BD-001', '4e51d935-88d1-4c5c-9237-6ab7bc8af044', 'Business Development', 'USER-35', '2025-08-19 13:19:52', '2025-08-19 13:19:52', 'active');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `Departments`
--
ALTER TABLE `Departments`
  ADD PRIMARY KEY (`id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `Departments`
--
ALTER TABLE `Departments`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=40;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
