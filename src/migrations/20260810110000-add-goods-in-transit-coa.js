"use strict";

/**
 * Ensure each facility has a Goods in Transit asset account in CoA.
 * YAMMUSA-style CoA: 112103 under Current Assets (112000).
 * Default inventria CoA: 100022 under Inventory (100004).
 */
module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(`
      INSERT INTO account_category
        (description, display, code, parent_code, level, category, type,
         account_nature, facility_id, is_active, created_at, updated_at, subcategory,
         normal_balance, fs_section, reporting_behavior, account_role)
      SELECT
        'Goods in Transit',
        1,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM account_category ac2
            WHERE ac2.facility_id = b.id AND ac2.code = '112000'
          ) THEN '112103'
          ELSE '100022'
        END,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM account_category ac2
            WHERE ac2.facility_id = b.id AND ac2.code = '112000'
          ) THEN '112000'
          WHEN EXISTS (
            SELECT 1 FROM account_category ac2
            WHERE ac2.facility_id = b.id AND ac2.code = '100004'
          ) THEN '100004'
          WHEN EXISTS (
            SELECT 1 FROM account_category ac2
            WHERE ac2.facility_id = b.id AND ac2.code = '100001'
          ) THEN '100001'
          ELSE '1'
        END,
        3,
        'assets',
        'Current assets',
        'ASSET',
        b.id,
        1,
        NOW(),
        NOW(),
        'Goods in Transit',
        'debit',
        'balance_sheet',
        'fixed',
        'general'
      FROM business b
      WHERE NOT EXISTS (
        SELECT 1 FROM account_category ac
        WHERE ac.facility_id = b.id
          AND (
            LOWER(TRIM(ac.description)) IN (
              'goods in transit',
              'goods-in-transit',
              'goods in-transit'
            )
            OR ac.code IN ('112103', '100022')
          )
      )
      AND EXISTS (
        SELECT 1 FROM account_category ac3 WHERE ac3.facility_id = b.id
      );
    `);
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(`
      DELETE FROM account_category
      WHERE code IN ('112103', '100022')
        AND LOWER(TRIM(description)) = 'goods in transit';
    `);
  },
};
