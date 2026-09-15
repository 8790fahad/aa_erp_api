"use strict";

/**
 * Collapse duplicate product category labels:
 *   "Bua Product" / "BUA PRODUCTS" → "Bua" / "BUA"
 *   "IRS Product" → "IRS"
 *   "Olam Product" → "Olam"
 *
 * 1) Normalize products.category (strip trailing Product/Products)
 * 2) Prefer CoA brand casing when a matching "% PRODUCTS" head exists
 * 3) Merge product_categories rows the same way
 *
 * Based on online products dump (IRS/Bua/Olam Product labels).
 */

function stripProductSuffixSql(expr) {
  return `
    CASE
      WHEN UPPER(TRIM(${expr})) LIKE '% PRODUCTS'
      THEN TRIM(SUBSTRING(TRIM(${expr}), 1, CHAR_LENGTH(TRIM(${expr})) - 9))
      WHEN UPPER(TRIM(${expr})) LIKE '% PRODUCT'
      THEN TRIM(SUBSTRING(TRIM(${expr}), 1, CHAR_LENGTH(TRIM(${expr})) - 8))
      ELSE TRIM(${expr})
    END
  `;
}

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    const stripped = stripProductSuffixSql("p.category");

    // 1) Strip trailing " Product" / " Products" on products.category
    await sequelize.query(`
      UPDATE products p
      SET p.category = ${stripped}
      WHERE p.category IS NOT NULL
        AND TRIM(p.category) != ''
        AND (
          UPPER(TRIM(p.category)) LIKE '% PRODUCT'
          OR UPPER(TRIM(p.category)) LIKE '% PRODUCTS'
        )
    `);

    // 2) Align casing with CoA brand heads (… PRODUCTS → brand)
    const coaBrand = stripProductSuffixSql("ac.description");
    await sequelize.query(`
      UPDATE products p
      INNER JOIN account_category ac
        ON ac.facility_id = p.facility_id
       AND ac.is_active = 1
       AND LOWER(IFNULL(ac.category, '')) IN ('assets', 'revenue')
       AND UPPER(TRIM(ac.description)) LIKE '% PRODUCTS'
       AND LOWER(${coaBrand}) = LOWER(TRIM(p.category))
      SET p.category = ${coaBrand}
      WHERE p.category IS NOT NULL
        AND TRIM(p.category) != ''
    `);

    // 3) product_categories: insert canonical names, then deactivate * Product dupes
    const tables = await queryInterface.showAllTables();
    const names = (tables || []).map((t) =>
      String(typeof t === "string" ? t : t.tableName || t.name || "").toLowerCase(),
    );
    if (!names.includes("product_categories")) return;

    const pcStripped = stripProductSuffixSql("pc.name");

    // Ensure canonical name rows exist
    await sequelize.query(`
      INSERT IGNORE INTO product_categories (facility_id, name, status, created_at, updated_at)
      SELECT
        pc.facility_id,
        ${pcStripped} AS canonical_name,
        'active',
        NOW(),
        NOW()
      FROM product_categories pc
      WHERE pc.name IS NOT NULL
        AND TRIM(pc.name) != ''
        AND (
          UPPER(TRIM(pc.name)) LIKE '% PRODUCT'
          OR UPPER(TRIM(pc.name)) LIKE '% PRODUCTS'
        )
        AND ${pcStripped} != ''
        AND LOWER(${pcStripped}) != LOWER(TRIM(pc.name))
    `);

    // Also seed from normalized products.category
    await sequelize.query(`
      INSERT IGNORE INTO product_categories (facility_id, name, status, created_at, updated_at)
      SELECT DISTINCT
        p.facility_id,
        TRIM(p.category),
        'active',
        NOW(),
        NOW()
      FROM products p
      WHERE p.facility_id IS NOT NULL
        AND p.category IS NOT NULL
        AND TRIM(p.category) != ''
        AND LOWER(TRIM(p.category)) NOT IN ('general')
    `);

    // Soft-delete suffix duplicates when canonical exists
    await sequelize.query(`
      UPDATE product_categories pc
      INNER JOIN product_categories canon
        ON canon.facility_id = pc.facility_id
       AND LOWER(TRIM(canon.name)) = LOWER(${pcStripped})
       AND canon.id != pc.id
       AND canon.status = 'active'
      SET pc.status = 'inactive',
          pc.updated_at = NOW()
      WHERE pc.status = 'active'
        AND (
          UPPER(TRIM(pc.name)) LIKE '% PRODUCT'
          OR UPPER(TRIM(pc.name)) LIKE '% PRODUCTS'
        )
    `);

    // Rename remaining active * Product rows that had no collision
    await sequelize.query(`
      UPDATE product_categories pc
      SET pc.name = ${pcStripped},
          pc.updated_at = NOW()
      WHERE pc.status = 'active'
        AND (
          UPPER(TRIM(pc.name)) LIKE '% PRODUCT'
          OR UPPER(TRIM(pc.name)) LIKE '% PRODUCTS'
        )
        AND ${pcStripped} != ''
        AND LOWER(${pcStripped}) != LOWER(TRIM(pc.name))
        AND NOT EXISTS (
          SELECT 1 FROM product_categories other
          WHERE other.facility_id = pc.facility_id
            AND LOWER(TRIM(other.name)) = LOWER(${pcStripped})
            AND other.id != pc.id
        )
    `);
  },

  async down() {
    // Irreversible data normalization — no-op
  },
};
