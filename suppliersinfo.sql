-- phpMyAdmin SQL Dump
-- version 5.2.2
-- https://www.phpmyadmin.net/
--
-- Host: localhost:3306
-- Generation Time: Sep 11, 2025 at 02:54 PM
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
-- Table structure for table `suppliersinfo`
--

CREATE TABLE `suppliersinfo` (
  `facilityId` varchar(50) NOT NULL,
  `supplier_number` varchar(10) NOT NULL,
  `supplier_name` varchar(100) DEFAULT NULL,
  `date` datetime NOT NULL DEFAULT current_timestamp(),
  `address` varchar(250) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `supplier_code` varchar(100) NOT NULL,
  `supplier_subhead` varchar(10) NOT NULL,
  `status` varchar(20) DEFAULT NULL,
  `email` varchar(50) DEFAULT NULL
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `suppliersinfo`
--

INSERT INTO `suppliersinfo` (`facilityId`, `supplier_number`, `supplier_name`, `date`, `address`, `phone`, `supplier_code`, `supplier_subhead`, `status`, `email`) VALUES
('ae9d49ee-3f9c-4f1e-bd6c-d2f18c61269f', 'SUP004', 'Cache', '2025-09-01 00:00:00', 'Cache site', '08012345678', '', '', 'active', 'cache@gmail.com'),
('ae9d49ee-3f9c-4f1e-bd6c-d2f18c61269f', 'SUP003', 'Test', '2025-09-01 00:00:00', 'Test site', '07012345678', '502001', '502', 'active', 'test@gmail.com'),
('923077e7-4e68-466a-a831-24f389c534f1', 'SUP007', 'Isah Muhammad Rabi\'u', '2025-09-01 00:00:00', 'kano', '', '502001', '502', 'active', ''),
('923077e7-4e68-466a-a831-24f389c534f1', 'SUP006', 'Mary Dania', '2025-09-01 00:00:00', 'kano', '', '502001', '502', 'active', ''),
('923077e7-4e68-466a-a831-24f389c534f1', 'SUP005', 'Ease Monie', '2025-09-01 00:00:00', 'Online', '', '502001', '502', 'active', ''),
('5823ddc6-557d-4564-a37b-166589664bfe', 'SUP002', 'Staffs', '2025-08-29 00:00:00', 'Kano', '', '502001', '502', 'active', ''),
('5b12ec5d-2932-413c-bc2e-bc30ff986067', 'SUP003', 'Muritala Adewale', '2025-09-01 00:00:00', 'Karkasara, Kano.', '08063847421', '502001', '502', 'active', ''),
('923077e7-4e68-466a-a831-24f389c534f1', 'SUP002', 'Adewale Muritala', '2025-09-01 00:00:00', 'Karkasara, Kano.', '08063847421', '502001', '502', 'active', ''),
('923077e7-4e68-466a-a831-24f389c534f1', 'SUP003', 'Idris Abdulkadir Dangana', '2025-09-01 00:00:00', 'kano', '', '502001', '502', 'active', ''),
('923077e7-4e68-466a-a831-24f389c534f1', 'SUP004', 'Eucharia', '2025-09-01 00:00:00', 'Abuja', '08036122330', '502001', '502', 'active', ''),
('5b12ec5d-2932-413c-bc2e-bc30ff986067', 'SUP002', 'Ahmad Kabir', '2025-08-29 00:00:00', 'Kano', '09129513810', '502001', '502', 'active', ''),
('ae9d49ee-3f9c-4f1e-bd6c-d2f18c61269f', 'SUP005', 'Claude', '2025-09-01 00:00:00', 'Test site', '09012345678', '502001', '502', 'active', 'claude@gmail.com'),
('923077e7-4e68-466a-a831-24f389c534f1', 'SUP008', 'Chima Ebuka', '2025-09-01 00:00:00', 'kano', '', '502001', '502', 'active', ''),
('5b12ec5d-2932-413c-bc2e-bc30ff986067', 'SUP004', 'Brainstorm IT Solution ', '2025-09-01 00:00:00', 'Kano', '', '502001', '502', 'active', ''),
('5b12ec5d-2932-413c-bc2e-bc30ff986067', 'SUP005', 'Mary Dania', '2025-09-01 00:00:00', 'kano', '', '502001', '502', 'active', ''),
('5b12ec5d-2932-413c-bc2e-bc30ff986067', 'SUP006', 'Fahad Ado Muhammad', '2025-09-01 00:00:00', 'kano', '', '502001', '502', 'active', ''),
('5823ddc6-557d-4564-a37b-166589664bfe', 'SUP003', 'Fahad Ado Muhammad', '2025-09-01 00:00:00', 'kano', '', '502001', '502', 'active', ''),
('5823ddc6-557d-4564-a37b-166589664bfe', 'SUP004', 'Mary Dania', '2025-09-01 00:00:00', 'kano', '', '502001', '502', 'active', ''),
('5b12ec5d-2932-413c-bc2e-bc30ff986067', 'SUP007', 'Gidauniya', '2025-09-01 00:00:00', 'kano', '', '502001', '502', 'active', ''),
('5b12ec5d-2932-413c-bc2e-bc30ff986067', 'SUP008', 'Shukuranu Amadu Gaya', '2025-09-01 00:00:00', 'kano', '', '502001', '502', 'active', ''),
('923077e7-4e68-466a-a831-24f389c534f1', 'SUP009', 'Emmanuel Damian', '2025-09-02 00:00:00', 'Abuja', '', '502001', '502', 'active', ''),
('923077e7-4e68-466a-a831-24f389c534f1', 'SUP010', 'NWAFOR EMMANUEL PAUL', '2025-09-02 00:00:00', 'Abuja', '', '502001', '502', 'active', ''),
('5b12ec5d-2932-413c-bc2e-bc30ff986067', 'SUP009', 'Abdulssalam Muhammad Abubakar ', '2025-09-02 00:00:00', 'Kano', '', '502001', '502', 'active', ''),
('923077e7-4e68-466a-a831-24f389c534f1', 'SUP011', 'Mustapha Issa Toyin', '2025-09-02 00:00:00', 'Kano', '07062942291', '502001', '502', 'active', ''),
('923077e7-4e68-466a-a831-24f389c534f1', 'SUP012', 'Abdulssalam Muhammad Abubakar', '2025-09-04 00:00:00', 'Kano', '08147848004', '502001', '502', 'active', ''),
('923077e7-4e68-466a-a831-24f389c534f1', 'SUP013', 'Isah Muhammad Rabiu', '2025-09-04 00:00:00', 'Kano', '07036105884', '502001', '502', 'active', ''),
('5823ddc6-557d-4564-a37b-166589664bfe', 'SUP005', 'Ishaq Ibrahim', '2025-09-09 00:00:00', 'Naibawa Kano\nMabuga A Bagwai', '07035384184', '', '', 'active', 'ibagwai9@gmail.com'),
('9467f017-2bae-4205-a923-22ee04299832', 'SUP002', 'Adewale Muritala Akinyemi', '2025-09-09 00:00:00', 'Floor 1, African Alliance building, Airport Road, Kano state', '08063847421', '502001', '502', 'active', 'adewalemurthador@gmail.com'),
('9467f017-2bae-4205-a923-22ee04299832', 'SUP003', 'Ahmad Ismail', '2025-09-09 00:00:00', 'Kano', '', '', '', 'active', ''),
('9467f017-2bae-4205-a923-22ee04299832', 'SUP004', 'Khadija', '2025-09-09 00:00:00', 'Kano', '', '', '', 'active', ''),
('9053e623-9ea9-4b20-8086-7412c0d64a1c', 'SUP002', 'Mustapha Issa Toyin', '2025-09-10 00:00:00', 'Kano', '07062942291', '502001', '502', 'active', 'mustapha@mylikita.com'),
('9053e623-9ea9-4b20-8086-7412c0d64a1c', 'SUP003', 'Ibrahim Printer', '2025-09-10 00:00:00', 'Zoo road, Kano', '08034845904', '', '', 'active', ''),
('9053e623-9ea9-4b20-8086-7412c0d64a1c', 'SUP004', 'Nura', '2025-09-10 00:00:00', 'Kano', '07030554562', '', '', 'active', ''),
('9467f017-2bae-4205-a923-22ee04299832', 'SUP005', 'Mary Dania', '2025-09-10 00:00:00', 'Kano', '', '', '', 'active', ''),
('9053e623-9ea9-4b20-8086-7412c0d64a1c', 'SUP005', 'MUHAMMAD AROWOSAIYE', '2025-09-10 00:00:00', 'Offa, Kwara', '08183441298', '502001', '502', 'active', ''),
('4e51d935-88d1-4c5c-9237-6ab7bc8af044', 'SUP002', 'Isah Muhammad Rabiu', '2025-09-10 00:00:00', 'Kano', '07036105884', '502001', '502', 'active', 'isah@knowtify.com.ng'),
('4e51d935-88d1-4c5c-9237-6ab7bc8af044', 'SUP003', 'Abdulsalam Abubakar', '2025-09-10 00:00:00', 'Kano', '08147848004', '', '', 'active', 'abdulsalam@knowtify.com.ng'),
('4e51d935-88d1-4c5c-9237-6ab7bc8af044', 'SUP004', 'Muhammad Abdullahi', '2025-09-10 00:00:00', 'Kano', '09130320165', '502001', '502', 'active', ''),
('4e51d935-88d1-4c5c-9237-6ab7bc8af044', 'SUP005', 'Brainstorm IT Solutions Ltd', '2025-09-10 00:00:00', 'Kano', '+2349032818956', '', '', 'active', 'hello@brainstorm.ng');

--
-- Triggers `suppliersinfo`
--
DELIMITER $$
CREATE TRIGGER `after_supplier_edit` AFTER UPDATE ON `suppliersinfo` FOR EACH ROW BEGIN
    IF OLD.supplier_name <> new.supplier_name THEN
        INSERT INTO audit_trail(id,facilityId,	supplier_name, new_supplier_name,source_table)
        VALUES(old.id, old.facilityId, old.supplier_name,new.supplier_name,'suppliersinfo');
    END IF;
END
$$
DELIMITER ;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `suppliersinfo`
--
ALTER TABLE `suppliersinfo`
  ADD PRIMARY KEY (`facilityId`,`supplier_number`);
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
