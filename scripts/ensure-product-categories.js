require("dotenv").config();
const db = require("../src/models");

(async () => {
  try {
    const [rows] = await db.sequelize.query(
      "SHOW TABLES LIKE 'product_categories'",
    );
    console.log("exists before:", rows.length > 0);
    if (!rows.length) {
      await db.sequelize.query(`
        CREATE TABLE product_categories (
          id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
          facility_id VARCHAR(50) NOT NULL,
          name VARCHAR(120) NOT NULL,
          description VARCHAR(255) NULL,
          status ENUM('active','inactive') NOT NULL DEFAULT 'active',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY product_categories_facility_name_unique (facility_id, name),
          KEY product_categories_facility_id (facility_id)
        )
      `);
      console.log("created table");
      await db.sequelize.query(`
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
      console.log("seeded from products.category");
    }
    const [count] = await db.sequelize.query(
      "SELECT COUNT(*) AS c FROM product_categories",
    );
    console.log("row count:", count[0].c);
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await db.sequelize.close();
  }
})();
