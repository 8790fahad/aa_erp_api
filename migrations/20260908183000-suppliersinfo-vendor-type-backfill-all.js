"use strict";

/**
 * Existing vendors with no type behave as "all" (visible on inventory, expense, and imprest).
 */
module.exports = {
  up: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const cols = await queryInterface
      .describeTable("suppliersinfo")
      .catch(() => null);
    if (!cols || !cols.vendor_type) return;

    await queryInterface.sequelize.query(
      `UPDATE \`suppliersinfo\`
       SET vendor_type = 'all'
       WHERE vendor_type IS NULL OR vendor_type = ''`,
    );
  },

  down: async () => {
    // Keep assigned types; do not clear vendor_type.
  },
};
