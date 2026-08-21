"use strict";

/**
 * Backfill products.category from Chart of Accounts brand groups
 * (e.g. BUA PRODUCTS, DANGOTE PRODUCTS → BUA, DANGOTE).
 *
 * Resolution order per product:
 *  1. Parent of revenue_account (preferred)
 *  2. Parent of cogs_head
 *  3. Match product name to a revenue leaf account, then take its parent
 *
 * Only fills blank/null category so manual labels are preserved.
 */
function brandLabelSql(descriptionExpr) {
  return `
    CASE
      WHEN UPPER(TRIM(${descriptionExpr})) LIKE '% PRODUCTS'
      THEN TRIM(
        SUBSTRING(
          TRIM(${descriptionExpr}),
          1,
          CHAR_LENGTH(TRIM(${descriptionExpr})) - 9
        )
      )
      ELSE TRIM(${descriptionExpr})
    END
  `;
}

module.exports = {
  up: async (queryInterface) => {
    const brandFromParent = brandLabelSql("parent.description");

    // 1) Via revenue_account → CoA parent brand
    await queryInterface.sequelize.query(`
      UPDATE products p
      INNER JOIN account_category child
        ON child.facility_id = p.facility_id
       AND CAST(child.code AS CHAR) = CAST(p.revenue_account AS CHAR)
      INNER JOIN account_category parent
        ON parent.facility_id = child.facility_id
       AND CAST(parent.code AS CHAR) = CAST(child.parent_code AS CHAR)
      SET p.category = ${brandFromParent},
          p.updated_at = NOW()
      WHERE (p.category IS NULL OR TRIM(p.category) = '')
        AND p.revenue_account IS NOT NULL
        AND TRIM(p.revenue_account) != ''
        AND parent.description IS NOT NULL
        AND TRIM(parent.description) != ''
    `);

    // 2) Via cogs_head for any still blank
    await queryInterface.sequelize.query(`
      UPDATE products p
      INNER JOIN account_category child
        ON child.facility_id = p.facility_id
       AND CAST(child.code AS CHAR) = CAST(p.cogs_head AS CHAR)
      INNER JOIN account_category parent
        ON parent.facility_id = child.facility_id
       AND CAST(parent.code AS CHAR) = CAST(child.parent_code AS CHAR)
      SET p.category = ${brandFromParent},
          p.updated_at = NOW()
      WHERE (p.category IS NULL OR TRIM(p.category) = '')
        AND p.cogs_head IS NOT NULL
        AND TRIM(p.cogs_head) != ''
        AND parent.description IS NOT NULL
        AND TRIM(parent.description) != ''
    `);

    // 3) Name match against revenue leaf CoA (same facility)
    await queryInterface.sequelize.query(`
      UPDATE products p
      INNER JOIN account_category child
        ON child.facility_id = p.facility_id
       AND LOWER(TRIM(child.description)) = LOWER(TRIM(p.name))
       AND LOWER(IFNULL(child.category, '')) = 'revenue'
      INNER JOIN account_category parent
        ON parent.facility_id = child.facility_id
       AND CAST(parent.code AS CHAR) = CAST(child.parent_code AS CHAR)
      SET p.category = ${brandFromParent},
          p.updated_at = NOW()
      WHERE (p.category IS NULL OR TRIM(p.category) = '')
        AND parent.description IS NOT NULL
        AND TRIM(parent.description) != ''
    `);
  },

  down: async (queryInterface) => {
    // Non-destructive: do not blank categories that may have been set intentionally.
    // No-op down keeps data safe after backfill.
  },
};
