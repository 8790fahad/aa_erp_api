"use strict";

/** Default staff loan receivable is 112104 Staff Advances and Imprests. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `UPDATE loan_setups
       SET receivableHead = '112104'
       WHERE name = 'Default loan receivable'
          OR receivableHead IN ('112200', '112201')`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `UPDATE loan_setups
       SET receivableHead = '112200'
       WHERE name = 'Default loan receivable'
         AND receivableHead = '112104'`,
    );
  },
};
