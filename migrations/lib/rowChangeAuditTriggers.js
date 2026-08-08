"use strict";

/**
 * Shared helpers: install AFTER INSERT/UPDATE/DELETE triggers that
 * snapshot row changes into `row_change_logs` (no stored procedures).
 */

const SKIP_TABLES = new Set([
  "row_change_logs",
  "activity_audits",
  "logs",
  "sequelizemeta",
  "sessions",
]);

const SKIP_TYPES = /^(blob|longblob|mediumblob|tinyblob|longtext)$/i;

const FACILITY_CANDIDATES = [
  "facilityId",
  "facility_id",
  "business_id",
  "facId",
  "fac_id",
];

/** Core business tables that should always be audited when present. */
const DEFAULT_AUDITED_TABLES = [
  "business",
  "users",
  "purchase_requisition",
  "requisition_details",
  "purchase_order",
  "purchase_order_list",
  "suppliersinfo",
  "suppliers",
  "supplier_contacts",
  "customers",
  "customer",
  "transactions",
  "store",
  "store_entries",
  "material_requisitions",
  "goods_transfer",
  "goods_transfer_items",
  "operating_expenses",
  "billing_expenses",
  "supplier_advance_payments",
  "supplier_payments",
];

function quoteIdent(name) {
  return `\`${String(name).replace(/`/g, "``")}\``;
}

function triggerName(table, event) {
  const safe = String(table)
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .slice(0, 40);
  return `aa_rcl_${safe}_${event}`.slice(0, 64);
}

function pickFacilityColumn(columns) {
  return FACILITY_CANDIDATES.find((c) => columns.includes(c)) || null;
}

function pickPkColumns(described) {
  const pks = Object.entries(described)
    .filter(([, meta]) => meta.primaryKey)
    .map(([name]) => name);
  if (pks.length) return pks;
  if (described.id) return ["id"];
  return Object.keys(described).slice(0, 1);
}

function auditableColumns(described) {
  return Object.entries(described)
    .filter(([, meta]) => !SKIP_TYPES.test(String(meta.type || "")))
    .map(([name]) => name)
    .slice(0, 50);
}

function jsonObjectSql(rowAlias, columns) {
  if (!columns.length) return "NULL";
  const parts = columns.map(
    (c) => `'${c.replace(/'/g, "")}', ${rowAlias}.${quoteIdent(c)}`,
  );
  return `JSON_OBJECT(${parts.join(", ")})`;
}

function rowPkSql(rowAlias, pkCols) {
  if (pkCols.length === 1) {
    return `CAST(${rowAlias}.${quoteIdent(pkCols[0])} AS CHAR(191))`;
  }
  return `CONCAT_WS('|', ${pkCols
    .map((c) => `CAST(${rowAlias}.${quoteIdent(c)} AS CHAR(64))`)
    .join(", ")})`;
}

function facilitySql(rowAlias, facilityCol) {
  if (!facilityCol) {
    return "COALESCE(@aa_audit_facility_id, '')";
  }
  return `COALESCE(${rowAlias}.${quoteIdent(facilityCol)}, @aa_audit_facility_id, '')`;
}

async function tableExists(queryInterface, table) {
  const tables = await queryInterface.showAllTables();
  const names = tables.map((t) =>
    (typeof t === "string" ? t : String(t.tableName || t)).toLowerCase(),
  );
  return names.includes(String(table).toLowerCase());
}

async function dropTrigger(sequelize, name) {
  await sequelize.query(`DROP TRIGGER IF EXISTS ${quoteIdent(name)}`);
}

async function installTableTriggers(queryInterface, sequelize, table) {
  if (SKIP_TABLES.has(String(table).toLowerCase())) return false;
  if (!(await tableExists(queryInterface, table))) return false;

  const described = await queryInterface.describeTable(table);
  const columns = auditableColumns(described);
  if (!columns.length) return false;

  const pkCols = pickPkColumns(described);
  const facilityCol = pickFacilityColumn(Object.keys(described));
  const t = quoteIdent(table);

  const defs = [
    {
      event: "ai",
      timing: "AFTER INSERT",
      body: `
        INSERT INTO row_change_logs
          (table_name, action, facility_id, row_pk, user_id, before_data, after_data, created_at)
        VALUES (
          '${table.replace(/'/g, "")}',
          'INSERT',
          ${facilitySql("NEW", facilityCol)},
          ${rowPkSql("NEW", pkCols)},
          NULLIF(CAST(@aa_audit_user_id AS CHAR(50)), ''),
          NULL,
          ${jsonObjectSql("NEW", columns)},
          NOW()
        );
      `,
    },
    {
      event: "au",
      timing: "AFTER UPDATE",
      body: `
        INSERT INTO row_change_logs
          (table_name, action, facility_id, row_pk, user_id, before_data, after_data, created_at)
        VALUES (
          '${table.replace(/'/g, "")}',
          'UPDATE',
          ${facilitySql("NEW", facilityCol)},
          ${rowPkSql("NEW", pkCols)},
          NULLIF(CAST(@aa_audit_user_id AS CHAR(50)), ''),
          ${jsonObjectSql("OLD", columns)},
          ${jsonObjectSql("NEW", columns)},
          NOW()
        );
      `,
    },
    {
      event: "ad",
      timing: "AFTER DELETE",
      body: `
        INSERT INTO row_change_logs
          (table_name, action, facility_id, row_pk, user_id, before_data, after_data, created_at)
        VALUES (
          '${table.replace(/'/g, "")}',
          'DELETE',
          ${facilitySql("OLD", facilityCol)},
          ${rowPkSql("OLD", pkCols)},
          NULLIF(CAST(@aa_audit_user_id AS CHAR(50)), ''),
          ${jsonObjectSql("OLD", columns)},
          NULL,
          NOW()
        );
      `,
    },
  ];

  for (const def of defs) {
    const name = triggerName(table, def.event);
    await dropTrigger(sequelize, name);
    await sequelize.query(`
      CREATE TRIGGER ${quoteIdent(name)}
      ${def.timing} ON ${t}
      FOR EACH ROW
      BEGIN
        ${def.body}
      END
    `);
  }

  return true;
}

async function dropTableTriggers(sequelize, table) {
  for (const event of ["ai", "au", "ad"]) {
    await dropTrigger(sequelize, triggerName(table, event));
  }
}

module.exports = {
  DEFAULT_AUDITED_TABLES,
  SKIP_TABLES,
  tableExists,
  installTableTriggers,
  dropTableTriggers,
};
