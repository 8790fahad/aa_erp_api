/**
 * Apply Sales Taxes Migration
 * Creates the sales_taxes junction table for linking sales with applied taxes
 */

const db = require("./src/models");
const fs = require("fs");
const path = require("path");

async function applyMigration() {
  try {
    console.log("🚀 Starting migration: Create sales_taxes table...");

    // Read migration SQL file
    const migrationPath = path.join(
      __dirname,
      "migrations",
      "20251027-create-sales-taxes-table.sql"
    );
    const migrationSQL = fs.readFileSync(migrationPath, "utf8");

    // Split SQL by statement (handle multi-statement)
    const statements = migrationSQL
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));

    // Execute each statement
    for (const statement of statements) {
      if (statement) {
        console.log(`Executing: ${statement.substring(0, 50)}...`);
        await db.sequelize.query(statement);
      }
    }

    console.log("✅ Migration completed successfully!");
    console.log("\nCreated table: sales_taxes");
    console.log("- Stores relationship between sales and applied taxes");
    console.log("- Links to taxes table via tax_id foreign key");
    console.log("- Indexed for fast lookups by sale_reference and facilityId");

    // Verify table creation
    const [tables] = await db.sequelize.query("SHOW TABLES LIKE 'sales_taxes'");
    if (tables.length > 0) {
      console.log("\n✓ Table verification: sales_taxes exists");

      // Show table structure
      const [columns] = await db.sequelize.query("DESCRIBE sales_taxes");
      console.log("\nTable Structure:");
      console.table(columns);
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run migration
applyMigration();
