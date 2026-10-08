"use strict";

/**
 * Move the 7.5% VAT out of cost of sales for Taxable products.
 * Each cost-of-sales debit is reduced to the cost after tax, and the
 * same amount is debited to Input VAT. The inventory credit is left as it was.
 * Non-Taxable, Exempted, and Zero Rated lines are not changed.
 * Safe to run again: a line is skipped once its Input VAT row exists.
 */
module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    const [ambiguous] = await sequelize.query(`
      SELECT gl.transaction_id
      FROM general_ledger gl
      INNER JOIN products p
        ON p.facility_id = gl.facility_id
       AND p.taxable = 'Taxable'
       AND gl.transaction_description LIKE CONCAT('COGS [', p.sku, '] %')
      WHERE gl.dr > 0
      GROUP BY gl.transaction_id
      HAVING COUNT(DISTINCT p.sku) > 1
      LIMIT 1
    `);
    if (ambiguous.length) {
      throw new Error(
        `Cost of sales line ${ambiguous[0].transaction_id} matches more than one product`,
      );
    }

    const [missingAccount] = await sequelize.query(`
      SELECT gl.facility_id
      FROM general_ledger gl
      INNER JOIN products p
        ON p.facility_id = gl.facility_id
       AND p.taxable = 'Taxable'
       AND gl.transaction_description LIKE CONCAT('COGS [', p.sku, '] %')
      WHERE gl.dr > 0
        AND NOT EXISTS (
          SELECT 1
          FROM taxes t
          INNER JOIN account_category ac
            ON ac.facility_id = t.facilityId
           AND ac.code = t.account_sub_head
          WHERE t.facilityId = gl.facility_id
            AND t.tax_category = 'Purchase'
            AND t.inclusive_type = 'inclusive'
            AND t.description LIKE 'Input VAT%'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM general_ledger done
          WHERE done.facility_id = gl.facility_id
            AND done.transaction_ref = CONCAT('COGS-VAT-', gl.transaction_id)
        )
      LIMIT 1
    `);
    if (missingAccount.length) {
      throw new Error(
        `No inclusive Input VAT account for facility ${missingAccount[0].facility_id}`,
      );
    }

    const transaction = await sequelize.transaction();
    try {
      await sequelize.query(
        `
        INSERT INTO general_ledger (
          transaction_date,
          account_code,
          account_subhead,
          dr,
          cr,
          account_description,
          transaction_description,
          reference_number,
          purpose_of_payment,
          payee,
          bank_account_id,
          cheque_no,
          mode_of_payment,
          created_by,
          facility_id,
          status,
          reconciled,
          type,
          transaction_ref,
          branch_id,
          user_id
        )
        SELECT
          gl.transaction_date,
          vat.code,
          COALESCE(NULLIF(vat.parent_code, ''), '0'),
          ROUND(gl.dr - (gl.dr / 1.075), 2),
          0,
          vat.description,
          CONCAT('Input VAT removed from ', gl.transaction_description),
          gl.reference_number,
          COALESCE(gl.purpose_of_payment, 'Cost of sales'),
          gl.payee,
          gl.bank_account_id,
          gl.cheque_no,
          gl.mode_of_payment,
          gl.created_by,
          gl.facility_id,
          'posted',
          'unmatched',
          'tax',
          CONCAT('COGS-VAT-', gl.transaction_id),
          gl.branch_id,
          gl.user_id
        FROM general_ledger gl
        INNER JOIN products p
          ON p.facility_id = gl.facility_id
         AND p.taxable = 'Taxable'
         AND gl.transaction_description LIKE CONCAT('COGS [', p.sku, '] %')
        INNER JOIN (
          SELECT
            t.facilityId,
            MIN(ac.code) AS code,
            MIN(ac.parent_code) AS parent_code,
            MIN(ac.description) AS description
          FROM taxes t
          INNER JOIN account_category ac
            ON ac.facility_id = t.facilityId
           AND ac.code = t.account_sub_head
          WHERE t.tax_category = 'Purchase'
            AND t.inclusive_type = 'inclusive'
            AND t.description LIKE 'Input VAT%'
          GROUP BY t.facilityId
        ) vat ON vat.facilityId = gl.facility_id
        WHERE gl.dr > 0
          AND ROUND(gl.dr - (gl.dr / 1.075), 2) > 0
          AND NOT EXISTS (
            SELECT 1
            FROM general_ledger done
            WHERE done.facility_id = gl.facility_id
              AND done.transaction_ref = CONCAT('COGS-VAT-', gl.transaction_id)
          )
        `,
        { transaction },
      );

      await sequelize.query(
        `
        UPDATE general_ledger gl
        INNER JOIN products p
          ON p.facility_id = gl.facility_id
         AND p.taxable = 'Taxable'
         AND gl.transaction_description LIKE CONCAT('COGS [', p.sku, '] %')
        INNER JOIN general_ledger done
          ON done.facility_id = gl.facility_id
         AND done.transaction_ref = CONCAT('COGS-VAT-', gl.transaction_id)
         AND done.transaction_description = CONCAT('Input VAT removed from ', gl.transaction_description)
        SET gl.dr = ROUND(gl.dr - done.dr, 2)
        WHERE gl.dr > done.dr
          AND ROUND(gl.dr - (gl.dr / 1.075), 2) = done.dr
        `,
        { transaction },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    const sequelize = queryInterface.sequelize;
    const transaction = await sequelize.transaction();
    try {
      await sequelize.query(
        `
        UPDATE general_ledger gl
        INNER JOIN general_ledger done
          ON done.facility_id = gl.facility_id
         AND done.transaction_ref = CONCAT('COGS-VAT-', gl.transaction_id)
         AND done.transaction_description = CONCAT('Input VAT removed from ', gl.transaction_description)
        SET gl.dr = ROUND(gl.dr + done.dr, 2)
        WHERE gl.transaction_description LIKE 'COGS [%'
        `,
        { transaction },
      );
      await sequelize.query(
        `
        DELETE FROM general_ledger
        WHERE transaction_ref LIKE 'COGS-VAT-%'
          AND transaction_description LIKE 'Input VAT removed from COGS [%'
        `,
        { transaction },
      );
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
