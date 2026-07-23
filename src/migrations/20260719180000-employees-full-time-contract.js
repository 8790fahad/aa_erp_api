"use strict";

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      "ALTER TABLE `employees` MODIFY COLUMN `contractType` ENUM('Permanent','Full-time','Contract','Intern','Part-time') NOT NULL DEFAULT 'Permanent'",
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      "UPDATE `employees` SET `contractType` = 'Permanent' WHERE `contractType` = 'Full-time'",
    );
    await queryInterface.sequelize.query(
      "ALTER TABLE `employees` MODIFY COLUMN `contractType` ENUM('Permanent','Contract','Intern','Part-time') NOT NULL DEFAULT 'Permanent'",
    );
  },
};
