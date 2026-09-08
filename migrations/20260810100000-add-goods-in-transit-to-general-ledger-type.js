"use strict";

/**
 * Add goods_in_transit / git to general_ledger.type for supplier deposit → GIT.
 *
 * Production deploy runs this folder (migrations/), not src/migrations/.
 * Reads the live ENUM and appends missing values so we do not drop existing ones.
 *
 * MySQL revalidates the table on MODIFY. Older general_ledger rows can have
 * zero-date timestamps which fail under NO_ZERO_DATE — relax sql_mode briefly.
 */

function parseEnumValues(columnType) {
  const match = String(columnType || "").match(/^enum\((.*)\)$/i);
  if (!match) return [];
  return [...match[1].matchAll(/'((?:\\'|[^'])*)'/g)].map((m) =>
    m[1].replace(/\\'/g, "'"),
  );
}

function quoteEnum(values) {
  return values
    .map((v) => `'${String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`)
    .join(",");
}

module.exports = {
  up: async (queryInterface) => {
    const sequelize = queryInterface.sequelize;
    const dialect = sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const extras = ["goods_in_transit", "git"];

    const [cols] = await sequelize.query(
      `SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'general_ledger'
         AND COLUMN_NAME = 'type'`,
    );
    if (!cols.length) return;

    const existing = parseEnumValues(cols[0].COLUMN_TYPE);
    const missing = extras.filter((v) => !existing.includes(v));
    if (!missing.length) return;

    const next = [...existing, ...missing];
    const nullable = cols[0].IS_NULLABLE === "YES" ? "NULL" : "NOT NULL";
    const def = cols[0].COLUMN_DEFAULT;
    const defaultSql =
      def != null && def !== ""
        ? ` DEFAULT '${String(def).replace(/'/g, "\\'")}'`
        : "";

    await sequelize.query(`SET @__fb_sql_mode := @@SESSION.sql_mode`);
    await sequelize.query(`
      SET SESSION sql_mode = REPLACE(
        REPLACE(@@SESSION.sql_mode, 'NO_ZERO_DATE', ''),
        'NO_ZERO_IN_DATE',
        ''
      )
    `);

    try {
      await sequelize.query(`
        ALTER TABLE general_ledger
          MODIFY COLUMN type ENUM(${quoteEnum(next)}) ${nullable}${defaultSql}
      `);
    } finally {
      await sequelize.query(`SET SESSION sql_mode = @__fb_sql_mode`);
    }
  },

  down: async (queryInterface) => {
    const sequelize = queryInterface.sequelize;
    const dialect = sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const [cols] = await sequelize.query(
      `SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'general_ledger'
         AND COLUMN_NAME = 'type'`,
    );
    if (!cols.length) return;

    const next = parseEnumValues(cols[0].COLUMN_TYPE).filter(
      (v) => v !== "goods_in_transit" && v !== "git",
    );
    if (!next.length) return;

    const nullable = cols[0].IS_NULLABLE === "YES" ? "NULL" : "NOT NULL";
    const def = cols[0].COLUMN_DEFAULT;
    const defaultSql =
      def != null && def !== "" && def !== "goods_in_transit" && def !== "git"
        ? ` DEFAULT '${String(def).replace(/'/g, "\\'")}'`
        : "";

    await sequelize.query(`SET @__fb_sql_mode := @@SESSION.sql_mode`);
    await sequelize.query(`
      SET SESSION sql_mode = REPLACE(
        REPLACE(@@SESSION.sql_mode, 'NO_ZERO_DATE', ''),
        'NO_ZERO_IN_DATE',
        ''
      )
    `);

    try {
      await sequelize.query(`
        ALTER TABLE general_ledger
          MODIFY COLUMN type ENUM(${quoteEnum(next)}) ${nullable}${defaultSql}
      `);
    } finally {
      await sequelize.query(`SET SESSION sql_mode = @__fb_sql_mode`);
    }
  },
};
