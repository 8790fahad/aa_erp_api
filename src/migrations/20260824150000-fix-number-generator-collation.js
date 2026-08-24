"use strict";

/**
 * Align number_generator string columns with connection collation
 * (utf8mb4_unicode_ci) so nurmber_generator1 / update_number_generator
 * stop failing with ER_CANT_AGGREGATE_2COLLATIONS.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE number_generator
        MODIFY prefix VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
        MODIFY facilityId VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE number_generator
        MODIFY prefix VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
        MODIFY facilityId VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci
    `);
  },
};
