"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("paye_settings", {
      id: {
        type: Sequelize.CHAR(36).BINARY,
        allowNull: false,
        primaryKey: true,
      },
      facilityId: {
        type: Sequelize.CHAR(36).BINARY,
        allowNull: false,
      },
      assessmentYear: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      rentReliefRate: {
        type: Sequelize.DECIMAL(8, 4),
        allowNull: false,
        defaultValue: 20,
      },
      rentReliefCap: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 500000,
      },
      nhfRate: {
        type: Sequelize.DECIMAL(8, 4),
        allowNull: false,
        defaultValue: 2.5,
      },
      nhfBase: {
        type: Sequelize.ENUM("gross", "basic", "bht"),
        allowNull: false,
        defaultValue: "basic",
      },
      nhisRate: {
        type: Sequelize.DECIMAL(8, 4),
        allowNull: false,
        defaultValue: 5,
      },
      nhisBase: {
        type: Sequelize.ENUM("gross", "basic", "bht"),
        allowNull: false,
        defaultValue: "basic",
      },
      pensionRate: {
        type: Sequelize.DECIMAL(8, 4),
        allowNull: false,
        defaultValue: 8,
      },
      pensionBase: {
        type: Sequelize.ENUM("gross", "basic", "bht"),
        allowNull: false,
        defaultValue: "bht",
      },
      taxBands: {
        type: Sequelize.JSON,
        allowNull: false,
      },
      autoCalculation: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      createdBy: {
        type: Sequelize.CHAR(36).BINARY,
        allowNull: true,
      },
      updatedBy: {
        type: Sequelize.CHAR(36).BINARY,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
      },
    });

    await queryInterface.addIndex("paye_settings", ["facilityId", "assessmentYear"], {
      unique: true,
      name: "paye_settings_facility_year_unique",
    });

    await queryInterface.createTable("employee_paye_profiles", {
      id: {
        type: Sequelize.CHAR(36).BINARY,
        allowNull: false,
        primaryKey: true,
      },
      employeeId: {
        type: Sequelize.CHAR(36).BINARY,
        allowNull: false,
        unique: true,
      },
      facilityId: {
        type: Sequelize.CHAR(36).BINARY,
        allowNull: false,
      },
      payEntryFrequency: {
        type: Sequelize.ENUM("monthly", "annual"),
        allowNull: false,
        defaultValue: "monthly",
      },
      basicSalary: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      },
      housingAllowance: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      },
      transportAllowance: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      },
      otherAllowances: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      },
      bonus: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      },
      annualRent: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      },
      appliesRent: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      appliesNHF: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      appliesNHIS: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      appliesPension: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
      },
    });

    const payrollTable = await queryInterface.describeTable("payroll");
    if (!payrollTable.computedPaye) {
      await queryInterface.addColumn("payroll", "computedPaye", {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: true,
        comment: "Formula-driven PAYE before manual override",
      });
    }
    if (!payrollTable.payeOverride) {
      await queryInterface.addColumn("payroll", "payeOverride", {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: true,
        comment: "Manual monthly PAYE when auto-calculation is off",
      });
    }
  },

  async down(queryInterface) {
    const payrollTable = await queryInterface.describeTable("payroll");
    if (payrollTable.payeOverride) {
      await queryInterface.removeColumn("payroll", "payeOverride");
    }
    if (payrollTable.computedPaye) {
      await queryInterface.removeColumn("payroll", "computedPaye");
    }
    await queryInterface.dropTable("employee_paye_profiles");
    await queryInterface.dropTable("paye_settings");
  },
};
