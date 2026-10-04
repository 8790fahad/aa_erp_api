"use strict";

/**
 * The opening quantities were stored with branchId 0, so they do not
 * appear when Dawanau is selected. Move those lines onto DAWANAU STORE.
 * branch_name stays "for sales" so the stock remains sellable.
 */

const FACILITY_ID = "094c6e1e-dd07-48c4-a344-6e9d58cd7861";

function codeEq(column, valueSql) {
  const side = (expr) => `CONVERT(${expr} USING utf8mb4) COLLATE utf8mb4_general_ci`;
  return `${side(column)} = ${side(valueSql)}`;
}

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    await sequelize.transaction(async (transaction) => {
      const [branch] = await sequelize.query(
        `SELECT id, branch_name AS name
         FROM branches
         WHERE facilityId = :facilityId
           AND UPPER(TRIM(branch_name)) LIKE '%DAWANAU%'
         ORDER BY id ASC
         LIMIT 1`,
        {
          replacements: { facilityId: FACILITY_ID },
          type: sequelize.QueryTypes.SELECT,
          transaction,
        },
      );
      if (!branch?.id) return;
      const storeName = branch.name || "DAWANAU STORE";

      await sequelize.query(
        `UPDATE store_entries
         SET branchId = :branchId,
             source = :storeName,
             destination = :storeName,
             location = :storeName
         WHERE ${codeEq("facilityId", "CAST(:facilityId AS CHAR)")}
           AND reference_number LIKE 'ADJ-P%'
           AND type = 'opening'`,
        {
          replacements: {
            branchId: branch.id,
            storeName,
            facilityId: FACILITY_ID,
          },
          transaction,
        },
      );
    });
  },

  async down() {},
};
