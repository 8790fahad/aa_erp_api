"use strict";

/**
 * Run pending files in /migrations (same behaviour as run-migrations.js).
 * Called on app boot so schema + audit triggers are created automatically.
 *
 * Disable with AUTO_MIGRATE=false
 */

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const { Sequelize } = require("sequelize");

async function runPendingMigrations({ logging = console.log } = {}) {
  if (String(process.env.AUTO_MIGRATE || "true").toLowerCase() === "false") {
    logging("[migrate] skipped (AUTO_MIGRATE=false)");
    return { ran: [], skipped: true };
  }

  const config = {
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    dialect: process.env.DB_DIALECT || "mysql",
    logging: false,
  };

  if (!config.database || !config.username) {
    logging("[migrate] skipped — DB_NAME / DB_USERNAME not set");
    return { ran: [], skipped: true };
  }

  const sequelize = new Sequelize(
    config.database,
    config.username,
    config.password,
    config,
  );

  const ran = [];
  try {
    await sequelize.authenticate();
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS SequelizeMeta (
        name VARCHAR(255) NOT NULL PRIMARY KEY
      )
    `);

    const migrationsPath = path.join(__dirname, "../../migrations");
    if (!fs.existsSync(migrationsPath)) {
      logging("[migrate] no migrations folder");
      return { ran, skipped: true };
    }

    const [rows] = await sequelize.query(
      "SELECT name FROM SequelizeMeta ORDER BY name",
    );
    const already = new Set(rows.map((r) => r.name));

    const files = fs
      .readdirSync(migrationsPath)
      .filter((f) => f.endsWith(".js"))
      .sort();

    const queryInterface = sequelize.getQueryInterface();

    for (const file of files) {
      if (already.has(file)) continue;
      const full = path.join(migrationsPath, file);
      delete require.cache[require.resolve(full)];
      const migration = require(full);
      if (!migration?.up) continue;

      logging(`[migrate] running ${file}`);
      await migration.up(queryInterface, Sequelize);
      await sequelize.query(
        "INSERT IGNORE INTO SequelizeMeta (name) VALUES (:name)",
        { replacements: { name: file } },
      );
      ran.push(file);
      logging(`[migrate] done ${file}`);
    }

    if (!ran.length) logging("[migrate] database is up to date");
    return { ran, skipped: false };
  } finally {
    await sequelize.close();
  }
}

module.exports = { runPendingMigrations };
