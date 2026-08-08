#!/usr/bin/env node
/**
 * Apply PRIMARY / UNIQUE / KEY indexes from a phpMyAdmin "Indexes" dump
 * only when they do not already exist. Safe for production re-runs.
 *
 * Usage:
 *   node scripts/add-indexes-if-not-exist.js "/path/to/indexes.sql"
 *   node scripts/add-indexes-if-not-exist.js "/path/to/indexes.sql" --dry-run
 *   node scripts/add-indexes-if-not-exist.js "/path/to/indexes.sql" --table=assets
 *
 * Env: DB_* from aa_erp_api/.env (or DB_HOST, DB_USERNAME, DB_PASSWORD, DB_NAME)
 */
"use strict";

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const sqlPath = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
const tableArg = process.argv.find((a) => a.startsWith("--table="));
const onlyTable = tableArg ? tableArg.slice("--table=".length) : null;

if (!sqlPath) {
  console.error(
    'Usage: node scripts/add-indexes-if-not-exist.js "/path/to/indexes.sql" [--dry-run] [--table=name]',
  );
  process.exit(1);
}

const abs = path.resolve(sqlPath);
if (!fs.existsSync(abs)) {
  console.error("File not found:", abs);
  process.exit(1);
}

/** @typedef {{ table: string, kind: 'PRIMARY'|'UNIQUE'|'INDEX', name: string|null, columns: string, raw: string }} IndexDef */

function parseIndexDump(text) {
  /** @type {IndexDef[]} */
  const out = [];
  // Match ALTER TABLE `name` ... ; blocks (non-greedy until semicolon)
  const alterRe = /ALTER\s+TABLE\s+`([^`]+)`\s*([\s\S]*?);/gi;
  let m;
  while ((m = alterRe.exec(text))) {
    const table = m[1];
    const body = m[2];
    // Skip pure constraint-only alters if they have no ADD KEY/PRIMARY
    const parts = body
      .split(/,\s*(?=ADD\s)/i)
      .map((p) => p.trim())
      .filter(Boolean);

    for (let part of parts) {
      part = part.replace(/^ADD\s+/i, "ADD ").trim();
      if (/^ADD\s+CONSTRAINT\b/i.test(part)) continue; // FKs handled separately if needed

      let kind = null;
      let name = null;
      let columns = null;

      let pm = part.match(
        /^ADD\s+PRIMARY\s+KEY\s*\(([^)]+)\)\s*$/i,
      );
      if (pm) {
        kind = "PRIMARY";
        name = "PRIMARY";
        columns = pm[1].trim();
      }

      if (!kind) {
        pm = part.match(
          /^ADD\s+UNIQUE\s+KEY\s+`([^`]+)`\s*\(([^)]+)\)\s*$/i,
        );
        if (pm) {
          kind = "UNIQUE";
          name = pm[1];
          columns = pm[2].trim();
        }
      }

      if (!kind) {
        pm = part.match(/^ADD\s+KEY\s+`([^`]+)`\s*\(([^)]+)\)\s*$/i);
        if (pm) {
          kind = "INDEX";
          name = pm[1];
          columns = pm[2].trim();
        }
      }

      if (!kind) continue;
      out.push({
        table,
        kind,
        name,
        columns,
        raw: part.replace(/,$/, "").trim(),
      });
    }
  }
  return out;
}

async function tableExists(conn, schema, table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1`,
    [schema, table],
  );
  return rows.length > 0;
}

async function hasPrimaryKey(conn, schema, table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       AND CONSTRAINT_TYPE = 'PRIMARY KEY' LIMIT 1`,
    [schema, table],
  );
  return rows.length > 0;
}

async function hasIndex(conn, schema, table, indexName) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [schema, table, indexName],
  );
  return rows.length > 0;
}

async function main() {
  const text = fs.readFileSync(abs, "utf8");
  let defs = parseIndexDump(text);
  if (onlyTable) {
    defs = defs.filter((d) => d.table === onlyTable);
  }

  console.log(`Parsed ${defs.length} index definition(s) from ${abs}`);
  if (dryRun) console.log("DRY RUN — no changes will be applied\n");

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    user: process.env.DB_USERNAME || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "aa_erp_db",
    multipleStatements: false,
  });

  const schema = process.env.DB_NAME || "aa_erp_db";
  let added = 0;
  let skipped = 0;
  let missingTable = 0;
  let failed = 0;

  const byTable = new Map();
  for (const d of defs) {
    if (!byTable.has(d.table)) byTable.set(d.table, []);
    byTable.get(d.table).push(d);
  }

  for (const [table, indexes] of byTable) {
    const exists = await tableExists(conn, schema, table);
    if (!exists) {
      console.log(`SKIP table (not found): ${table}`);
      missingTable += indexes.length;
      continue;
    }

    for (const idx of indexes) {
      let already = false;
      if (idx.kind === "PRIMARY") {
        already = await hasPrimaryKey(conn, schema, table);
      } else {
        already = await hasIndex(conn, schema, table, idx.name);
      }

      if (already) {
        console.log(`  exists  ${table}.${idx.name || "PRIMARY"}`);
        skipped += 1;
        continue;
      }

      const sql = `ALTER TABLE \`${table}\` ${idx.raw}`;
      console.log(`  ADD     ${table}.${idx.name || "PRIMARY"}`);
      if (dryRun) {
        console.log(`           ${sql}`);
        added += 1;
        continue;
      }

      try {
        await conn.query(sql);
        added += 1;
      } catch (err) {
        failed += 1;
        console.error(
          `  FAIL    ${table}.${idx.name || "PRIMARY"}: ${err.message}`,
        );
      }
    }
  }

  await conn.end();
  console.log("\nDone.");
  console.log({ added, skipped, missingTable, failed, dryRun });
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
