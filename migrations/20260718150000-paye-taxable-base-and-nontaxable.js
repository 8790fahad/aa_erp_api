"use strict";

/** Expand PAYE base enums for taxable pay; add non-taxable allowances on profiles. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const bases = ["gross", "basic", "bht", "taxable"];

    await queryInterface.changeColumn("paye_settings", "nhfBase", {
      type: Sequelize.ENUM(...bases),
      allowNull: false,
      defaultValue: "basic",
    });
    await queryInterface.changeColumn("paye_settings", "nhisBase", {
      type: Sequelize.ENUM(...bases),
      allowNull: false,
      defaultValue: "basic",
    });
    await queryInterface.changeColumn("paye_settings", "pensionBase", {
      type: Sequelize.ENUM(...bases),
      allowNull: false,
      defaultValue: "taxable",
    });

    await queryInterface.sequelize.query(
      "UPDATE paye_settings SET nhfBase = 'taxable' WHERE nhfBase = 'bht'",
    );
    await queryInterface.sequelize.query(
      "UPDATE paye_settings SET nhisBase = 'taxable' WHERE nhisBase = 'bht'",
    );
    await queryInterface.sequelize.query(
      "UPDATE paye_settings SET pensionBase = 'taxable' WHERE pensionBase = 'bht'",
    );

    const profiles = await queryInterface.describeTable("employee_paye_profiles");
    if (!profiles.nonTaxableAllowances) {
      await queryInterface.addColumn(
        "employee_paye_profiles",
        "nonTaxableAllowances",
        {
          type: Sequelize.DECIMAL(15, 2),
          allowNull: false,
          defaultValue: 0,
          after: "otherAllowances",
        },
      );
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      "UPDATE paye_settings SET nhfBase = 'bht' WHERE nhfBase = 'taxable'",
    );
    await queryInterface.sequelize.query(
      "UPDATE paye_settings SET nhisBase = 'bht' WHERE nhisBase = 'taxable'",
    );
    await queryInterface.sequelize.query(
      "UPDATE paye_settings SET pensionBase = 'bht' WHERE pensionBase = 'taxable'",
    );

    const legacy = ["gross", "basic", "bht"];
    await queryInterface.changeColumn("paye_settings", "nhfBase", {
      type: Sequelize.ENUM(...legacy),
      allowNull: false,
      defaultValue: "basic",
    });
    await queryInterface.changeColumn("paye_settings", "nhisBase", {
      type: Sequelize.ENUM(...legacy),
      allowNull: false,
      defaultValue: "basic",
    });
    await queryInterface.changeColumn("paye_settings", "pensionBase", {
      type: Sequelize.ENUM(...legacy),
      allowNull: false,
      defaultValue: "bht",
    });

    const profiles = await queryInterface.describeTable("employee_paye_profiles");
    if (profiles.nonTaxableAllowances) {
      await queryInterface.removeColumn(
        "employee_paye_profiles",
        "nonTaxableAllowances",
      );
    }
  },
};
