'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Add new columns to account table
    await queryInterface.sequelize.query(`
      ALTER TABLE account
      ADD COLUMN typeId VARCHAR(10) NULL COMMENT 'Account type ID from account types structure',
      ADD COLUMN detailTypeId VARCHAR(10) NULL COMMENT 'Detail type ID from account types structure',
      ADD COLUMN typeEnumName VARCHAR(100) NULL COMMENT 'Account type enum name',
      ADD COLUMN detailTypeEnumName VARCHAR(100) NULL COMMENT 'Detail type enum name',
      ADD COLUMN typeMnemonic VARCHAR(50) NULL COMMENT 'Account type mnemonic',
      ADD COLUMN detailTypeMnemonic VARCHAR(50) NULL COMMENT 'Detail type mnemonic',
      ADD COLUMN detailType VARCHAR(200) NULL COMMENT 'Detail type name';
    `);
  },

  down: async (queryInterface, Sequelize) => {
    // Remove the columns
    await queryInterface.sequelize.query(`
      ALTER TABLE account
      DROP COLUMN typeId,
      DROP COLUMN detailTypeId,
      DROP COLUMN typeEnumName,
      DROP COLUMN detailTypeEnumName,
      DROP COLUMN typeMnemonic,
      DROP COLUMN detailTypeMnemonic,
      DROP COLUMN detailType;
    `);
  }
};




