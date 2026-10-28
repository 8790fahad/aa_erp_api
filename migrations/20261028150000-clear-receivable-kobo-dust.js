"use strict";

/**
 * Inclusive VAT rounded per line was ₦0.01 above the amount the customer
 * paid. The sale balancer parked that kobo on Accounts Receivable, so
 * settled customers showed ₦0.01 DR and open balances ended in .01.
 *
 * Move the kobo off the receivable debit and off Output VAT (or sales
 * revenue) so the customer balance matches cash collected and the
 * journal stays balanced. Safe to run more than once.
 */
module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;

      await sequelize.transaction(async (transaction) => {
      await sequelize.query(
        `DROP TEMPORARY TABLE IF EXISTS tmp_ar_kobo_dust`,
        { transaction },
      );
      await sequelize.query(
        `
        CREATE TEMPORARY TABLE tmp_ar_kobo_dust AS
        SELECT
          facility_id,
          reference_number,
          ROUND(SUM(dr) - SUM(cr), 2) AS dust
        FROM general_ledger
        WHERE LOWER(COALESCE(type, '')) IN ('receivable', 'recevable')
          AND reference_number IS NOT NULL
          AND TRIM(reference_number) <> ''
        GROUP BY facility_id, reference_number
        HAVING dust >= 0.01 AND dust < 0.05
        `,
        { transaction },
      );

      await sequelize.query(
        `
        UPDATE general_ledger vat
        INNER JOIN (
          SELECT transaction_id, dust
          FROM (
            SELECT MIN(g.transaction_id) AS transaction_id, d.dust
            FROM general_ledger g
            INNER JOIN tmp_ar_kobo_dust d
              ON d.facility_id = g.facility_id
             AND d.reference_number = g.reference_number
            WHERE LOWER(COALESCE(g.type, '')) = 'tax'
              AND g.cr >= d.dust
              AND (
                LOWER(g.transaction_description) LIKE '%output vat%'
                OR LOWER(g.transaction_description) LIKE '%vat @%'
              )
            GROUP BY g.facility_id, g.reference_number, d.dust
          ) picked
        ) src ON src.transaction_id = vat.transaction_id
        SET vat.cr = ROUND(vat.cr - src.dust, 2)
        `,
        { transaction },
      );

      await sequelize.query(
        `
        UPDATE general_ledger rev
        INNER JOIN (
          SELECT transaction_id, dust
          FROM (
            SELECT MIN(g.transaction_id) AS transaction_id, d.dust
            FROM general_ledger g
            INNER JOIN tmp_ar_kobo_dust d
              ON d.facility_id = g.facility_id
             AND d.reference_number = g.reference_number
            WHERE LOWER(COALESCE(g.type, '')) = 'revenue'
              AND g.cr >= d.dust
              AND NOT EXISTS (
                SELECT 1
                FROM general_ledger vat
                WHERE vat.facility_id = g.facility_id
                  AND vat.reference_number = g.reference_number
                  AND LOWER(COALESCE(vat.type, '')) = 'tax'
                  AND (
                    LOWER(vat.transaction_description) LIKE '%output vat%'
                    OR LOWER(vat.transaction_description) LIKE '%vat @%'
                  )
              )
            GROUP BY g.facility_id, g.reference_number, d.dust
          ) picked
        ) src ON src.transaction_id = rev.transaction_id
        SET rev.cr = ROUND(rev.cr - src.dust, 2)
        `,
        { transaction },
      );

      await sequelize.query(
        `
        UPDATE general_ledger ar
        INNER JOIN (
          SELECT transaction_id, dust
          FROM (
            SELECT MIN(g.transaction_id) AS transaction_id, d.dust
            FROM general_ledger g
            INNER JOIN tmp_ar_kobo_dust d
              ON d.facility_id = g.facility_id
             AND d.reference_number = g.reference_number
            WHERE LOWER(COALESCE(g.type, '')) IN ('receivable', 'recevable')
              AND g.dr >= d.dust
              AND (
                EXISTS (
                  SELECT 1
                  FROM general_ledger vat
                  WHERE vat.facility_id = g.facility_id
                    AND vat.reference_number = g.reference_number
                    AND LOWER(COALESCE(vat.type, '')) = 'tax'
                    AND vat.cr + d.dust >= d.dust
                    AND (
                      LOWER(vat.transaction_description) LIKE '%output vat%'
                      OR LOWER(vat.transaction_description) LIKE '%vat @%'
                    )
                )
                OR EXISTS (
                  SELECT 1
                  FROM general_ledger rev
                  WHERE rev.facility_id = g.facility_id
                    AND rev.reference_number = g.reference_number
                    AND LOWER(COALESCE(rev.type, '')) = 'revenue'
                    AND rev.cr + d.dust >= d.dust
                )
              )
            GROUP BY g.facility_id, g.reference_number, d.dust
          ) picked
        ) src ON src.transaction_id = ar.transaction_id
        SET ar.dr = ROUND(ar.dr - src.dust, 2)
        `,
        { transaction },
      );

      const [tables] = await sequelize.query(
        `SHOW TABLES LIKE 'customer_entries'`,
        { transaction },
      );
      if (tables.length) {
        await sequelize.query(
          `
          UPDATE customer_entries ce
          INNER JOIN (
            SELECT entry_id, dust
            FROM (
              SELECT MIN(e.entry_id) AS entry_id, d.dust
              FROM customer_entries e
              INNER JOIN tmp_ar_kobo_dust d
                ON d.facility_id = e.facilityId
               AND d.reference_number = e.receiptNo
              WHERE e.type = 'tax'
                AND e.cost >= d.dust
              GROUP BY e.facilityId, e.receiptNo, d.dust
            ) picked
          ) src ON src.entry_id = ce.entry_id
          SET ce.cost = ROUND(ce.cost - src.dust, 2)
          `,
          { transaction },
        );
      }

      await sequelize.query(`DROP TEMPORARY TABLE IF EXISTS tmp_ar_kobo_dust`, {
        transaction,
      });
    });
  },

  async down() {
    // The kobo was not a real receivable. There is nothing to restore.
  },
};
