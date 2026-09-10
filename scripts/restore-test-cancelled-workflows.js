#!/usr/bin/env node
"use strict";

require("dotenv").config();
const mysql = require("mysql2/promise");

async function main() {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD || undefined,
    database: process.env.DB_NAME,
  });

  const [rows] = await c.query(
    `SELECT sale_code, payment_type, status, history, notes
     FROM sale_workflows
     WHERE notes LIKE ?
       AND sale_code LIKE 'INV-%'`,
    ["%Test reverse of unpaid verification invoice%"],
  );

  console.log("Restoring", rows.length, "accidentally cancelled invoices");

  for (const row of rows) {
    let history = row.history;
    if (typeof history === "string") {
      try {
        history = JSON.parse(history);
      } catch {
        history = [];
      }
    }
    if (!Array.isArray(history)) history = [];
    const next = history.filter((h) => {
      const note = String(h?.note || "");
      return !note.includes("Test reverse of unpaid verification invoice");
    });
    const status =
      String(row.payment_type).toLowerCase() === "deposit"
        ? "awaiting_payment"
        : "awaiting_cashier_confirm";
    await c.query(
      `UPDATE sale_workflows
       SET status = ?, notes = NULL, hold_overnight = 0, history = ?, updated_at = updated_at
       WHERE sale_code = ? AND notes LIKE ?`,
      [
        status,
        JSON.stringify(next),
        row.sale_code,
        "%Test reverse of unpaid verification invoice%",
      ],
    );
    console.log("restored", row.sale_code, "->", status);
  }

  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
