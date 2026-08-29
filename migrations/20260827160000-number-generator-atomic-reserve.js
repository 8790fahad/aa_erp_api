"use strict";

/**
 * Make document-number allocation race-free.
 *
 * Before: nurmber_generator1 only peeked (SELECT MAX(code_no)+1) and callers
 * reserved afterwards via update_number_generator, so two concurrent requests
 * read the same max and issued the same number. Nothing caught it either --
 * number_generator had no indexes at all.
 *
 * After: nurmber_generator1 claims a number in a single statement whose row
 * lock serialises concurrent callers, and hands it back through LAST_INSERT_ID,
 * which is session-scoped and therefore unreadable by any other connection.
 *
 * code_no now consistently means "last number issued". numberGen.js previously
 * treated it as "next number to issue", so series it owned skip one number once.
 * update_number_generator becomes GREATEST-based so the legacy
 * peek-then-reserve call sites keep working untouched: their follow-up call is
 * now a no-op, and it can never rewind a counter into already-issued numbers.
 */

// Aliases the original procedure returned, one per prefix branch. Call sites
// read the result by these names (e.g. `results.rm` in materials.js), so every
// one of them has to keep resolving. `exp` returned `po_id` by copy-paste; both
// are emitted now.
const RESULT_ALIASES = [
  "code_no",
  "grn",
  "mm",
  "trn",
  "po",
  "po_id",
  "exp",
  "pv",
  "pr",
  "mr",
  "itm",
  "inv",
  "str_id",
  "cus",
  "rm",
  "ent",
  "pro",
  "tem",
  "user",
  "rate",
  "sup",
];

const selectAllAliases = RESULT_ALIASES.map(
  (alias) => `reserved AS \`${alias}\``,
).join(",\n    ");

const CREATE_RESERVE_PROC = `
CREATE PROCEDURE nurmber_generator1(
  IN in_query_type VARCHAR(50),
  IN in_facilityId VARCHAR(100)
)
  MODIFIES SQL DATA
BEGIN
  DECLARE reserved INT;

  -- One statement claims the number whether or not the counter row exists yet.
  -- Fresh row -> 1; existing row -> code_no + 1 under an exclusive row lock.
  -- Requires UNIQUE(prefix, facilityId) for the ON DUPLICATE KEY branch.
  INSERT INTO number_generator (description, prefix, code_no, facilityId)
  VALUES (in_query_type, in_query_type, LAST_INSERT_ID(1), in_facilityId)
  ON DUPLICATE KEY UPDATE code_no = LAST_INSERT_ID(code_no + 1);

  SET reserved = LAST_INSERT_ID();

  SELECT
    ${selectAllAliases};
END
`;

const CREATE_UPDATE_PROC = `
CREATE PROCEDURE update_number_generator(
  IN in_query_type VARCHAR(50),
  IN in_number INT,
  IN in_facilityId VARCHAR(100)
)
  MODIFIES SQL DATA
BEGIN
  -- GREATEST, not assignment: nurmber_generator1 has already advanced the
  -- counter, so the legacy follow-up call must not pull it back down and hand
  -- the same number out twice.
  UPDATE number_generator
     SET code_no = GREATEST(code_no, in_number)
   WHERE prefix = in_query_type
     AND facilityId = in_facilityId;
END
`;

/** Original peek-only body, restored by down(). */
const RESTORE_LEGACY_PROCS = `
CREATE PROCEDURE nurmber_generator1(
  IN in_query_type VARCHAR(50),
  IN in_facilityId VARCHAR(100)
)
  NO SQL
BEGIN
  SELECT IFNULL(MAX(code_no), 0) + 1 AS code_no
    FROM number_generator
   WHERE prefix = in_query_type
     AND facilityId = in_facilityId;
END
`;

module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;

    // Collapse any duplicate counters to their highest value before the unique
    // index goes on, so the migration cannot fail half-applied.
    await sequelize.query(`
      DELETE dup FROM number_generator dup
      JOIN (
        SELECT prefix, facilityId, MAX(code_no) AS keep_code
        FROM number_generator
        GROUP BY prefix, facilityId
        HAVING COUNT(*) > 1
      ) top
        ON top.prefix = dup.prefix
       AND top.facilityId = dup.facilityId
       AND dup.code_no < top.keep_code
    `);

    const [existing] = await sequelize.query(`
      SHOW INDEX FROM number_generator
      WHERE Key_name = 'uq_number_generator_prefix_facility'
    `);
    if (existing.length === 0) {
      await sequelize.query(`
        ALTER TABLE number_generator
          ADD UNIQUE INDEX uq_number_generator_prefix_facility (prefix, facilityId)
      `);
    }

    await sequelize.query("DROP PROCEDURE IF EXISTS nurmber_generator1");
    await sequelize.query(CREATE_RESERVE_PROC);

    await sequelize.query("DROP PROCEDURE IF EXISTS update_number_generator");
    await sequelize.query(CREATE_UPDATE_PROC);
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.query("DROP PROCEDURE IF EXISTS nurmber_generator1");
    await sequelize.query(RESTORE_LEGACY_PROCS);

    await sequelize.query("DROP PROCEDURE IF EXISTS update_number_generator");
    await sequelize.query(`
      CREATE PROCEDURE update_number_generator(
        IN in_query_type VARCHAR(50),
        IN in_number INT,
        IN in_facilityId VARCHAR(100)
      )
        NO SQL
      BEGIN
        UPDATE number_generator
           SET code_no = in_number
         WHERE prefix = in_query_type
           AND facilityId = in_facilityId;
      END
    `);

    await sequelize.query(`
      ALTER TABLE number_generator
        DROP INDEX uq_number_generator_prefix_facility
    `);
  },
};
