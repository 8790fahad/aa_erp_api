"use strict";

/**
 * Run one migration file (useful when the full chain fails).
 *
 * Uses flowbooks_api/.env (DB_*) — same as `npm run migrate` — so it hits the
 * same database. Falls back to config/config.json only if DB_NAME is unset.
 *
 * Usage (from flowbooks_api):
 *   node scripts/run-single-migration.js 20260412120000-generate-account-code-nature-six-digit.js
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const Sequelize = require("sequelize");

const migrationFile = process.argv[2];
if (!migrationFile) {
  console.error(
    "Usage: node scripts/run-single-migration.js <migration-filename.js>",
  );
  process.exit(1);
}

const env = process.env.NODE_ENV || "development";
let sequelize;

if (process.env.DB_NAME && process.env.DB_USERNAME) {
  sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USERNAME,
    process.env.DB_PASSWORD || "",
    {
      host: process.env.DB_HOST || "127.0.0.1",
      dialect: process.env.DB_DIALECT || "mysql",
      logging: console.log,
    },
  );
  console.log("Using database from .env:", process.env.DB_NAME);
} else {
  const config = require(path.join(__dirname, "../config/config.json"))[env];
  sequelize = new Sequelize(
    config.database,
    config.username,
    config.password,
    config,
  );
  console.log("Using database from config/config.json:", config.database);
}

const queryInterface = sequelize.getQueryInterface();

const migrationPath = path.join(__dirname, "..", "migrations", migrationFile);
let migration;
try {
  migration = require(migrationPath);
} catch (e) {
  console.error("Could not load migration:", migrationPath, e.message);
  process.exit(1);
}

if (typeof migration.up !== "function") {
  console.error("Migration has no up() export.");
  process.exit(1);
}

(async () => {
  try {
    console.log("Running migration.up:", migrationFile);
    const SequelizeLib = require("sequelize");
    await migration.up(queryInterface, SequelizeLib);
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS SequelizeMeta (
        name VARCHAR(255) NOT NULL PRIMARY KEY
      )
    `);
    await sequelize.query(
      "INSERT IGNORE INTO `SequelizeMeta` (`name`) VALUES (:name)",
      { replacements: { name: migrationFile } },
    );
    console.log("Done. Recorded in SequelizeMeta:", migrationFile);
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
})();
