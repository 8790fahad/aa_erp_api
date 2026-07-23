-- Full inventory valuation seed — United Gases Ltd
-- Facility: 2f93950a-f056-4a70-840a-74dc75c8dd41
-- Creates products from COA (raw materials + finished goods) + opening stock
-- Run after kirmaskngov import; safe to re-run (ON DUPLICATE KEY / skips existing IV-SEED2 refs)

SET NAMES utf8mb4 COLLATE utf8mb4_general_ci;
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;

-- ── Products: Raw Materials (COA 500002 children) ──
INSERT INTO `products` (
  `facility_id`, `name`, `sku`, `item_type`, `image_url`, `selling_price`, `revenue_account`,
  `cost_price`, `supplier_id`, `cogs_head`, `reorder_level`, `warehouse_id`, `category`,
  `unit_of_measure`, `inventory_account`, `mark_up`, `markup_mode`, `status`, `tags`, `notes`,
  `created_at`, `updated_at`, `deposit_liability_account`, `deposit_amount`, `line_of_business`,
  `taxable`, `group_id`, `is_purchased`, `online_enabled`
) VALUES
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'RAW MAT: ACETYLENE', 'RM-500003', 'Raw Material', '', 0.00, '', 1003.00, '', '500002', 25, '', 'Direct Materials', 'kg', '100024', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 1, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'RAW MAT: LPG', 'RM-500004', 'Raw Material', '', 0.00, '', 1004.00, '', '500002', 25, '', 'Direct Materials', 'kg', '100024', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 1, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'RAW MAT: NITROGEN', 'RM-500005', 'Raw Material', '', 0.00, '', 1005.00, '', '500002', 25, '', 'Direct Materials', 'kg', '100024', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 1, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'CONSUMPTION OF RAW MATERIAL, OXYGEN', 'RM-500006', 'Raw Material', '', 0.00, '', 1006.00, '', '500002', 25, '', 'Direct Materials', 'kg', '100024', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 1, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'RESALEABLES', 'RM-500007', 'Raw Material', '', 0.00, '', 1007.00, '', '500002', 25, '', 'Direct Materials', 'kg', '100024', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 1, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'WELDING EQUIPMENTS', 'RM-500008', 'Raw Material', '', 0.00, '', 1008.00, '', '500002', 25, '', 'Direct Materials', 'kg', '100024', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 1, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'PACKING MATERIALS', 'RM-500009', 'Raw Material', '', 0.00, '', 1009.00, '', '500002', 25, '', 'Direct Materials', 'kg', '100024', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 1, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'CALCIUM CARBIDE', 'RM-500010', 'Raw Material', '', 0.00, '', 1010.00, '', '500002', 25, '', 'Direct Materials', 'kg', '100024', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 1, 0)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `cost_price` = IF(`cost_price` = 0, VALUES(`cost_price`), `cost_price`),
  `item_type` = VALUES(`item_type`),
  `inventory_account` = VALUES(`inventory_account`),
  `updated_at` = NOW();

-- ── Products: Finished Goods (COA 400002 children) ──
INSERT INTO `products` (
  `facility_id`, `name`, `sku`, `item_type`, `image_url`, `selling_price`, `revenue_account`,
  `cost_price`, `supplier_id`, `cogs_head`, `reorder_level`, `warehouse_id`, `category`,
  `unit_of_measure`, `inventory_account`, `mark_up`, `markup_mode`, `status`, `tags`, `notes`,
  `created_at`, `updated_at`, `deposit_liability_account`, `deposit_amount`, `line_of_business`,
  `taxable`, `group_id`, `is_purchased`, `online_enabled`
) VALUES
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'CALCIUM CARBIDE', 'FG-400004', 'Finished Good', '', 0.00, '400004', 5604.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'SPINDLE', 'FG-400005', 'Finished Good', '', 0.00, '400005', 5605.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'SPINDLE II KEY', 'FG-400006', 'Finished Good', '', 0.00, '400006', 5606.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'EMPTY DRUM', 'FG-400007', 'Finished Good', '', 0.00, '400007', 5607.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'HANDLING & TRANSPORT CHARGES', 'FG-400008', 'Finished Good', '', 0.00, '400008', 5608.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'TRANSPORT CHARGE', 'FG-400009', 'Finished Good', '', 0.00, '400009', 5609.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'FIXING OF VALVE', 'FG-400010', 'Finished Good', '', 0.00, '400010', 5610.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'ACETONE', 'FG-400011', 'Finished Good', '', 0.00, '400011', 5611.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'DELIVERY ORDER', 'FG-400012', 'Finished Good', '', 0.00, '400012', 5612.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'DISCOUNT (VALUE)', 'FG-400013', 'Finished Good', '', 0.00, '400013', 5613.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'WASTE CARBIDE', 'FG-400014', 'Finished Good', '', 0.00, '400014', 5614.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'MISCELLANEOUS', 'FG-400015', 'Finished Good', '', 0.00, '400015', 5615.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'ADAPTOR', 'FG-400016', 'Finished Good', '', 0.00, '400016', 5616.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'NITROGEN VALVE', 'FG-400017', 'Finished Good', '', 0.00, '400017', 5617.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'OXYGEN GAS O1', 'FG-400018', 'Finished Good', '', 0.00, '400018', 5618.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'OXYGEN GAS O2', 'FG-400019', 'Finished Good', '', 0.00, '400019', 5619.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'OXYGEN GAS O3', 'FG-400020', 'Finished Good', '', 0.00, '400020', 5620.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'OXYGEN GAS O4', 'FG-400021', 'Finished Good', '', 0.00, '400021', 5621.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'OXYGEN MEDICAL O3', 'FG-400022', 'Finished Good', '', 0.00, '400022', 5622.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'OXYGEN MEDICAL B/NOSE', 'FG-400023', 'Finished Good', '', 0.00, '400023', 5623.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'OXYGEN MEDICAL P/INDEX', 'FG-400024', 'Finished Good', '', 0.00, '400024', 5624.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'OXYGEN OTHERS 2M3', 'FG-400025', 'Finished Good', '', 0.00, '400025', 5625.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'OXYGEN OTHERS 3M3', 'FG-400026', 'Finished Good', '', 0.00, '400026', 5626.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'OXYGEN OTHERS 4M3', 'FG-400027', 'Finished Good', '', 0.00, '400027', 5627.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'OXYGEN OTHERS 5M3', 'FG-400028', 'Finished Good', '', 0.00, '400028', 5628.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'OXYGEN VALVE', 'FG-400029', 'Finished Good', '', 0.00, '400029', 5629.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'OXYGEN CYLINDER', 'FG-400030', 'Finished Good', '', 0.00, '400030', 5630.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'GENERAL PACK', 'FG-400031', 'Finished Good', '', 0.00, '400031', 5631.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'ACETYLENE A1', 'FG-400032', 'Finished Good', '', 0.00, '400032', 5632.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'ACETYLENE A2', 'FG-400033', 'Finished Good', '', 0.00, '400033', 5633.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'ACETYLENE A3', 'FG-400034', 'Finished Good', '', 0.00, '400034', 5634.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'ACETYLENE GAS A3X', 'FG-400035', 'Finished Good', '', 0.00, '400035', 5635.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'ACETYLENE OTHERS P/PK', 'FG-400036', 'Finished Good', '', 0.00, '400036', 5636.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'ACETYLENE OTHERS 1KG', 'FG-400037', 'Finished Good', '', 0.00, '400037', 5637.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'ACETYLENE OTHERS 2KG', 'FG-400038', 'Finished Good', '', 0.00, '400038', 5638.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'ACETYLENE OTHERS 2.3KG', 'FG-400039', 'Finished Good', '', 0.00, '400039', 5639.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'ACETYLENE OTHERS 3KG', 'FG-400040', 'Finished Good', '', 0.00, '400040', 5640.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'ACETYLENE OTHERS 4KG', 'FG-400041', 'Finished Good', '', 0.00, '400041', 5641.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'ACETYLENE OTHERS 5KG', 'FG-400042', 'Finished Good', '', 0.00, '400042', 5642.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'ACETYLENE A2C', 'FG-400043', 'Finished Good', '', 0.00, '400043', 5643.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'ACETYLENE CYLINDER', 'FG-400044', 'Finished Good', '', 0.00, '400044', 5644.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'ACETYLENE VALVE II', 'FG-400045', 'Finished Good', '', 0.00, '400045', 5645.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'ARGON GAS', 'FG-400046', 'Finished Good', '', 0.00, '400046', 5646.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'ARGON CYLINDER', 'FG-400047', 'Finished Good', '', 0.00, '400047', 5647.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'CARBON DIOXIDE GAS', 'FG-400048', 'Finished Good', '', 0.00, '400048', 5648.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'NITROGEN GASES N4', 'FG-400049', 'Finished Good', '', 0.00, '400049', 5649.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'NITROGEN REPLACEMENT', 'FG-400050', 'Finished Good', '', 0.00, '400050', 5650.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'CARBON DIOXIDE CYLS', 'FG-400051', 'Finished Good', '', 0.00, '400051', 5651.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'NITROGEN REPLACEMENT', 'FG-400052', 'Finished Good', '', 0.00, '400052', 5652.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'LPG 3KG', 'FG-400053', 'Finished Good', '', 0.00, '400053', 5653.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'LPG 5KG', 'FG-400054', 'Finished Good', '', 0.00, '400054', 5654.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'LPG 6KG', 'FG-400055', 'Finished Good', '', 0.00, '400055', 5655.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'LPG 12.5KG', 'FG-400056', 'Finished Good', '', 0.00, '400056', 5656.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'LPG 25KG', 'FG-400057', 'Finished Good', '', 0.00, '400057', 5657.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'LPG 50KG', 'FG-400058', 'Finished Good', '', 0.00, '400058', 5658.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'LPG 37.5KG', 'FG-400059', 'Finished Good', '', 0.00, '400059', 5659.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'LPG VALVE', 'FG-400060', 'Finished Good', '', 0.00, '400060', 5660.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'LPG OTHERS', 'FG-400061', 'Finished Good', '', 0.00, '400061', 5661.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'LPG CYLS 50KG', 'FG-400062', 'Finished Good', '', 0.00, '400062', 5662.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'LPG CYLS 12.5KG', 'FG-400063', 'Finished Good', '', 0.00, '400063', 5663.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'LPG 25KG CYLINDER', 'FG-400064', 'Finished Good', '', 0.00, '400064', 5664.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'LPG CYLINDER 5KG', 'FG-400065', 'Finished Good', '', 0.00, '400065', 5665.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'LPG CYLS 6KG', 'FG-400066', 'Finished Good', '', 0.00, '400066', 5666.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'LPG CYLS 3KG', 'FG-400067', 'Finished Good', '', 0.00, '400067', 5667.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'SUPREME DOUBLE BURNER (M)', 'FG-400068', 'Finished Good', '', 0.00, '400068', 5668.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'SUPREME DOUBLE BURNER (A)', 'FG-400069', 'Finished Good', '', 0.00, '400069', 5669.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'JUMBO SINGLE BURNER', 'FG-400070', 'Finished Good', '', 0.00, '400070', 5670.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'RUBBER HOSE', 'FG-400071', 'Finished Good', '', 0.00, '400071', 5671.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'LPG REGULATOR', 'FG-400072', 'Finished Good', '', 0.00, '400072', 5672.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'CAMP STOVE', 'FG-400073', 'Finished Good', '', 0.00, '400073', 5673.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'LPG 10KG', 'FG-400074', 'Finished Good', '', 0.00, '400074', 5674.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'LPG 20KG', 'FG-400075', 'Finished Good', '', 0.00, '400075', 5675.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'LPG BAD CYLINDER', 'FG-400076', 'Finished Good', '', 0.00, '400076', 5676.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'OXYGEN REPLACEMENT', 'FG-400077', 'Finished Good', '', 0.00, '400077', 5677.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'OXYGEN BAD CYLINDER', 'FG-400078', 'Finished Good', '', 0.00, '400078', 5678.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'ACETYLENE BAD CYLINDER', 'FG-400079', 'Finished Good', '', 0.00, '400079', 5679.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'NITROGEN BAD CYLINDER', 'FG-400080', 'Finished Good', '', 0.00, '400080', 5680.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'ACETYLENE REPLACEMENT', 'FG-400081', 'Finished Good', '', 0.00, '400081', 5681.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'LESS: DISCOUNT 5%', 'FG-400082', 'Finished Good', '', 0.00, '400082', 5682.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'LESS: DISCOUNT 10%', 'FG-400083', 'Finished Good', '', 0.00, '400083', 5683.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'LESS: DISCOUNT 13%', 'FG-400084', 'Finished Good', '', 0.00, '400084', 5684.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'LESS: DISCOUNT 15%', 'FG-400085', 'Finished Good', '', 0.00, '400085', 5685.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'LESS: DISCOUNT 20%', 'FG-400086', 'Finished Good', '', 0.00, '400086', 5686.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'LESS: DISCOUNT 25%', 'FG-400087', 'Finished Good', '', 0.00, '400087', 5687.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0),
('2f93950a-f056-4a70-840a-74dc75c8dd41', 'LESS DISCOUNT N', 'FG-400088', 'Finished Good', '', 0.00, '400088', 5688.00, '', '500080', 10, '', 'Sales', 'cylinder', '100033', 0.00, 'percentage', 'Active', '', '', NOW(), NOW(), '', 0.00, 0, 'Taxable', NULL, 0, 0)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `cost_price` = IF(`cost_price` = 0, VALUES(`cost_price`), `cost_price`),
  `item_type` = VALUES(`item_type`),
  `revenue_account` = VALUES(`revenue_account`),
  `updated_at` = NOW();

-- ── Opening stock for every inventory product (positive net qty) ──
INSERT INTO `store_entries` (
  `receive_date`, `reference_number`, `qty_in`, `qty_out`, `expiry_date`, `cost_price`, `selling_price`,
  `branch_name`, `inserted_by`, `facilityId`, `truckNo`, `waybillNo`, `supplier_code`, `type`, `source`, `destination`,
  `status`, `product_id`, `batch_id`, `multiplier_id`, `createdAt`, `markup_mode`, `mark_up`, `multple`, `location`, `departmentId`, `branchId`
)
SELECT
  '2026-01-15',
  CONCAT('IV-SEED2-', p.sku),
  CASE p.item_type WHEN 'Raw Material' THEN 50.0000 + (p.id % 350) ELSE 12.0000 + (p.id % 88) END,
  0.0000,
  CASE WHEN p.item_type = 'Finished Good' THEN '2027-06-01 00:00:00' ELSE NULL END,
  p.cost_price,
  NULLIF(p.selling_price, 0),
  CASE p.item_type WHEN 'Raw Material' THEN 'Raw Material' ELSE 'for sales' END,
  'seed-user',
  '2f93950a-f056-4a70-840a-74dc75c8dd41',
  '', '', COALESCE(p.supplier_id, ''),
  CASE p.item_type WHEN 'Raw Material' THEN 'Raw Material' ELSE 'Finished Good' END,
  'Initial Stock',
  CASE p.item_type WHEN 'Raw Material' THEN 'Raw Material' ELSE 'Main Warehouse' END,
  'approved',
  p.sku,
  NULL, NULL,
  '2026-01-15 08:00:00',
  'percentage', 0.00, '1', 'Warehouse', NULL, 20
FROM products p
WHERE p.facility_id = '2f93950a-f056-4a70-840a-74dc75c8dd41'
  AND p.status = 'Active'
  AND p.item_type IN ('Raw Material', 'Finished Good', 'By-Product', 'Resalable', 'Semi Finished')
  AND NOT EXISTS (
    SELECT 1 FROM store_entries se
    WHERE se.product_id = p.sku
      AND se.facilityId = '2f93950a-f056-4a70-840a-74dc75c8dd41'
      AND se.reference_number = CONCAT('IV-SEED2-', p.sku)
  );

-- Top up zero net qty (adds second receipt where stock still 0)
INSERT INTO `store_entries` (
  `receive_date`, `reference_number`, `qty_in`, `qty_out`, `expiry_date`, `cost_price`, `selling_price`,
  `branch_name`, `inserted_by`, `facilityId`, `truckNo`, `waybillNo`, `supplier_code`, `type`, `source`, `destination`,
  `status`, `product_id`, `batch_id`, `multiplier_id`, `createdAt`, `markup_mode`, `mark_up`, `multple`, `location`, `departmentId`, `branchId`
)
SELECT
  '2026-02-01',
  CONCAT('IV-TOPUP-', p.sku),
  CASE p.item_type WHEN 'Raw Material' THEN 30.0000 + (p.id % 200) ELSE 10.0000 + (p.id % 50) END,
  0.0000, NULL, p.cost_price, NULLIF(p.selling_price, 0),
  CASE p.item_type WHEN 'Raw Material' THEN 'Raw Material' ELSE 'for sales' END,
  'seed-user', '2f93950a-f056-4a70-840a-74dc75c8dd41', '', '', '',
  CASE p.item_type WHEN 'Raw Material' THEN 'Raw Material' ELSE 'Finished Good' END,
  'Initial Stock', 'Main Warehouse', 'approved', p.sku, NULL, NULL,
  '2026-02-01 09:00:00', 'percentage', 0.00, '1', 'Warehouse', NULL, 20
FROM products p
WHERE p.facility_id = '2f93950a-f056-4a70-840a-74dc75c8dd41'
  AND p.status = 'Active'
  AND p.item_type IN ('Raw Material', 'Finished Good', 'By-Product', 'Resalable', 'Semi Finished')
  AND (
    SELECT COALESCE(SUM(se.qty_in), 0) - COALESCE(SUM(se.qty_out), 0)
    FROM store_entries se
    WHERE se.product_id = p.sku AND se.facilityId = p.facility_id
      AND DATE(se.createdAt) <= '2026-06-03'
  ) <= 0
  AND NOT EXISTS (
    SELECT 1 FROM store_entries se
    WHERE se.product_id = p.sku AND se.facilityId = p.facility_id
      AND se.reference_number = CONCAT('IV-TOPUP-', p.sku)
  );

COMMIT;
-- Raw materials: 8 | Finished goods: 85