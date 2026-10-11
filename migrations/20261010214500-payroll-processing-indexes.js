"use strict";

/**
 * Speed up payroll run, month lookup, attendance scans, and allowance matching.
 */

const INDEXES = [
  {
    table: "payroll",
    fields: ["facilityId", "month", "year"],
    name: "payroll_facility_month_year",
  },
  {
    table: "payroll",
    fields: ["employeeId", "month", "year"],
    name: "payroll_employee_month_year",
  },
  {
    table: "payroll",
    fields: ["facilityId", "status"],
    name: "payroll_facility_status",
  },
  {
    table: "attendance",
    fields: ["employeeId", "facilityId", "date"],
    name: "attendance_employee_facility_date",
  },
  {
    table: "allowances",
    fields: ["facilityId", "status"],
    name: "allowances_facility_status",
  },
  {
    table: "allowances",
    fields: ["facilityId", "salaryStructureId"],
    name: "allowances_facility_structure",
  },
  {
    table: "allowances",
    fields: ["facilityId", "roleName", "isRoleBased"],
    name: "allowances_facility_role",
  },
  {
    table: "loans",
    fields: ["facilityId", "employeeId", "status"],
    name: "loans_facility_employee_status",
  },
  {
    table: "loan_repayments",
    fields: ["facilityId", "reference"],
    name: "loan_repayments_facility_reference",
  },
];

async function indexExists(queryInterface, table, name) {
  try {
    const indexes = await queryInterface.showIndex(table);
    return (indexes || []).some((idx) => idx.name === name);
  } catch {
    return false;
  }
}

module.exports = {
  async up(queryInterface) {
    for (const index of INDEXES) {
      if (await indexExists(queryInterface, index.table, index.name)) continue;
      try {
        await queryInterface.addIndex(index.table, index.fields, {
          name: index.name,
        });
      } catch (err) {
        console.warn(
          `[payroll-indexes] skipped ${index.name}:`,
          err.message
        );
      }
    }
  },

  async down(queryInterface) {
    for (const index of INDEXES) {
      try {
        await queryInterface.removeIndex(index.table, index.name);
      } catch {
        // table or index may not exist
      }
    }
  },
};
