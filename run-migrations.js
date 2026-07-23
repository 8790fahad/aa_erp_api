/**
 * Run migrations in flowbooks_api/migrations (sorted by filename).
 * Skips files already recorded in SequelizeMeta (same idea as sequelize-cli).
 *
 * Uses .env: DB_HOST, DB_USERNAME, DB_PASSWORD, DB_NAME, DB_DIALECT
 *
 * Usage: node run-migrations.js
 */

require("dotenv").config();
const { Sequelize } = require("sequelize");
const path = require("path");
const fs = require("fs");

const config = {
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  host: process.env.DB_HOST,
  dialect: process.env.DB_DIALECT || "mysql",
  logging: console.log,
};

if (!config.database || !config.username) {
  console.error(
    "❌ Set DB_NAME and DB_USERNAME (and DB_HOST, DB_PASSWORD) in flowbooks_api/.env",
  );
  process.exit(1);
}

const sequelize = new Sequelize(
  config.database,
  config.username,
  config.password,
  config,
);

async function ensureSequelizeMeta() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS SequelizeMeta (
      name VARCHAR(255) NOT NULL PRIMARY KEY
    )
  `);
}

async function getRanMigrations() {
  const [rows] = await sequelize.query(
    "SELECT name FROM SequelizeMeta ORDER BY name",
  );
  return new Set(rows.map((r) => r.name));
}

async function recordMigration(name) {
  await sequelize.query(
    "INSERT IGNORE INTO SequelizeMeta (name) VALUES (:name)",
    { replacements: { name } },
  );
}

async function runMigrations() {
  try {
    console.log("🔄 Starting migrations...\n");

    await sequelize.authenticate();
    console.log("✅ Database connection established.\n");

    const migrationsPath = path.join(__dirname, "migrations");
    if (!fs.existsSync(migrationsPath)) {
      console.error("❌ migrations/ folder not found:", migrationsPath);
      process.exit(1);
    }

    const migrationFiles = fs
      .readdirSync(migrationsPath)
      .filter((file) => file.endsWith(".js"))
      .sort();

    await ensureSequelizeMeta();
    const alreadyRan = await getRanMigrations();

    const pending = migrationFiles.filter((f) => !alreadyRan.has(f));

    console.log(`📦 Migration files in folder: ${migrationFiles.length}`);
    migrationFiles.forEach((file) =>
      console.log(
        alreadyRan.has(file) ? `  (done) ${file}` : `  (pending) ${file}`,
      ),
    );
    console.log(`\n▶️  To run now: ${pending.length} pending\n`);

    for (const file of pending) {
      console.log(`\n▶️  Running: ${file}`);
      const migrationPath = path.join(migrationsPath, file);
      delete require.cache[require.resolve(migrationPath)];
      const migration = require(migrationPath);

      if (migration.up) {
        const queryInterface = sequelize.getQueryInterface();
        await migration.up(queryInterface, Sequelize);
        await recordMigration(file);
        console.log(`✅ Completed: ${file}`);
      } else {
        console.log(`⚠️  Skipped: ${file} (no 'up' method found)`);
      }
    }

    if (pending.length === 0) {
      console.log("\n✨ Nothing pending — database is up to date.");
    } else {
      console.log("\n✨ All pending migrations completed successfully!");
    }
    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Migration error:", error);
    await sequelize.close();
    process.exit(1);
  }
}

runMigrations();
