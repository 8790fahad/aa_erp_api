"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../src/models");

(async () => {
  try {
    const [rows] = await db.sequelize.query(
      `SELECT id, pr_no, document_name, original_name, file_path, mime_type, created_at
       FROM purchase_order_documents
       WHERE file_path LIKE :q OR document_name LIKE :n OR original_name LIKE :n
       ORDER BY id DESC
       LIMIT 10`,
      { replacements: { q: "%1788608846607%", n: "%b2b-invoice%" } },
    );
    console.log("MATCH", JSON.stringify(rows, null, 2));
    const [recent] = await db.sequelize.query(
      `SELECT id, pr_no, document_name, original_name, file_path, mime_type, created_at
       FROM purchase_order_documents
       ORDER BY id DESC
       LIMIT 5`,
    );
    console.log("RECENT", JSON.stringify(recent, null, 2));
  } catch (e) {
    console.log("DB_ERR", e.message);
  } finally {
    await db.sequelize.close();
  }
})();
