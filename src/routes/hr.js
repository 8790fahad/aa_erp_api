const passport = require("passport");

// Import HR controllers
const employeesController = require("../controller/employees");
const leavesController = require("../controller/leaves");
const payrollController = require("../controller/payroll");
const attendanceController = require("../controller/attendance");
const performanceController = require("../controller/performance");
const payrollAccounting = require("../controller/payrollAccounting");
const salaryStructuresController = require("../controller/salaryStructures");
const leaveTypesController = require("../controller/leaveTypes");
const loansController = require("../controller/loans");
const allowancesController = require("../controller/allowances");
const payeSettingsController = require("../controller/payeSettings");

// Middleware for authentication
const authenticate = passport.authenticate("jwt", { session: false });

module.exports = (app) => {
  // Require JWT for all HR / payroll endpoints
  app.use("/api/hr", authenticate);

  // Employee Management Routes
  app.post("/api/hr/employees", employeesController.createEmployee);
  app.post("/api/hr/employees/bulk", employeesController.bulkCreateEmployees);
  app.get("/api/hr/employees", employeesController.getAllEmployees);
  app.get("/api/hr/employees/:id", employeesController.getEmployeeById);
  app.put("/api/hr/employees/:id", employeesController.updateEmployee);
  app.put("/api/hr/employees/:id/salary-status", employeesController.updateSalaryStatus);
  app.delete("/api/hr/employees/:id", employeesController.deactivateEmployee);
  app.get(
    "/api/hr/employees/:id/promotion-history",
    employeesController.getPromotionHistory
  );
  app.put(
    "/api/hr/employees/:id/promotion",
    employeesController.updatePromotion
  );

  // Users Management Routes
  app.get("/api/hr/users", employeesController.getHRUsers);

  // Departments Management Routes
  app.get("/api/hr/departments", employeesController.getHRDepartments);

  // Leave Management Routes
  app.post("/api/hr/leaves", leavesController.applyLeave);
  app.get("/api/hr/leaves", leavesController.getAllLeaves);
  app.put("/api/hr/leaves/:id/approve", leavesController.approveLeave);
  app.put("/api/hr/leaves/:id/reject", leavesController.rejectLeave);
  app.put("/api/hr/leaves/:id/cancel", leavesController.cancelLeave);
  app.put("/api/hr/leaves/:id/early-return", leavesController.earlyReturnLeave);
  app.get(
    "/api/hr/leaves/balance/:employeeId",
    leavesController.getLeaveBalance
  );

  // Payroll Management Routes
  // Static payroll paths must be registered before /:month/:year.
  app.post("/api/hr/payroll/run", payrollController.runPayroll);
  app.get(
    "/api/hr/payroll/batches",
    payrollController.getAllPayrollBatches
  );
  app.get(
    "/api/hr/payroll/payslip/:id",
    payrollController.getPayslip
  );
  app.get(
    "/api/hr/payroll/history",
    payrollController.getPayrollHistory
  );
  app.put(
    "/api/hr/payroll/mark-paid",
    payrollController.markPayrollAsPaid
  );
  app.put(
    "/api/hr/payroll/status/:id",
    payrollController.updatePayrollStatus
  );
  app.put(
    "/api/hr/payroll/batch-status",
    payrollController.batchUpdateStatus
  );
  app.get(
    "/api/hr/payroll/:month/:year",
    payrollController.getPayrollByMonth
  );

  // PAYE 2026 Settings
  app.get("/api/hr/paye-settings", payeSettingsController.getPayeSettings);
  app.put("/api/hr/paye-settings", payeSettingsController.savePayeSettings);
  app.get("/api/hr/paye-settings/employees", payeSettingsController.getPayeEmployeePreview);
  app.put("/api/hr/paye-settings/employees/:employeeId", payeSettingsController.saveEmployeePayeProfile);
  app.put("/api/hr/paye-settings/paye-override", payeSettingsController.savePayeOverride);

  // Attendance Routes
  app.post("/api/hr/attendance/record", attendanceController.recordAttendance);
  app.post("/api/hr/attendance/clock-in", attendanceController.clockIn);
  app.post("/api/hr/attendance/clock-out", attendanceController.clockOut);
  app.get(
    "/api/hr/attendance/report",
    attendanceController.getAttendanceReport
  );
  app.post(
    "/api/hr/attendance/manual",
    attendanceController.manualAttendanceEntry
  );
  app.put(
    "/api/hr/attendance/:id/approve",
    attendanceController.approveAttendance
  );
  app.post(
    "/api/hr/attendance/bulk-upload",
    attendanceController.bulkAttendanceUpload
  );

  // Performance Management Routes
  app.post(
    "/api/hr/performance",
    performanceController.createPerformanceReview
  );
  app.get("/api/hr/performance", performanceController.getPerformanceReviews);
  app.get(
    "/api/hr/performance/:id",
    performanceController.getPerformanceReviewById
  );
  app.put(
    "/api/hr/performance/:id/self-review",
    performanceController.updateSelfReview
  );
  app.put(
    "/api/hr/performance/:id/manager-review",
    performanceController.managerReview
  );
  app.get(
    "/api/hr/performance/analytics",
    performanceController.getPerformanceAnalytics
  );

  // Payroll Accounting Routes
  app.get("/api/hr/payroll/accounting/:month/:year", async (req, res) => {
    try {
      const { month, year } = req.params;
      const { facilityId } = req.query;

      if (!facilityId) {
        return res.status(400).json({
          success: false,
          message: "Facility ID is required",
          error: "facilityId query parameter is missing",
        });
      }

      const result = await payrollAccounting.getPayrollAccountingSummary(
        parseInt(month),
        parseInt(year),
        facilityId
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error fetching payroll accounting summary",
        error: error.message,
      });
    }
  });

  app.post("/api/hr/payroll/reverse/:month/:year", async (req, res) => {
    try {
      const { month, year } = req.params;
      const { facilityId } = req.body;

      if (!facilityId) {
        return res.status(400).json({
          success: false,
          message: "Facility ID is required",
          error: "facilityId is missing in request body",
        });
      }

      const result = await payrollAccounting.reversePayrollJournalEntries(
        parseInt(month),
        parseInt(year),
        facilityId
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error reversing payroll journal entries",
        error: error.message,
      });
    }
  });

  // Salary Structures routes
  app.post(
    "/api/hr/salary-structures",
    salaryStructuresController.createSalaryStructure
  );
  app.get(
    "/api/hr/salary-structures",
    salaryStructuresController.getAllSalaryStructures
  );
  app.put(
    "/api/hr/salary-structures/:id",
    salaryStructuresController.updateSalaryStructure
  );
  app.delete(
    "/api/hr/salary-structures/:id",
    salaryStructuresController.deactivateSalaryStructure
  );

  // Allowances & Deductions routes
  app.post("/api/hr/allowances", allowancesController.createAllowance);
  app.post("/api/hr/allowances/bulk", allowancesController.bulkCreateAllowances);
  app.get("/api/hr/allowances", allowancesController.getAllAllowances);
  app.get("/api/hr/allowances/summary", allowancesController.getAllowancesSummary);
  app.get("/api/hr/allowances/:id", allowancesController.getAllowanceById);
  app.put("/api/hr/allowances/:id", allowancesController.updateAllowance);
  app.delete("/api/hr/allowances/:id", allowancesController.deleteAllowance);

  // Leave Types routes
  app.post("/api/hr/leave-types", leaveTypesController.createLeaveType);
  app.get("/api/hr/leave-types", leaveTypesController.getLeaveTypes);
  app.get("/api/hr/leave-types/:id", leaveTypesController.getLeaveTypeById);
  app.put("/api/hr/leave-types/:id", leaveTypesController.updateLeaveType);
  app.delete("/api/hr/leave-types/:id", leaveTypesController.deleteLeaveType);

  // Loan Setup routes
  app.post("/api/hr/loan-setups", loansController.createLoanSetup);
  app.get("/api/hr/loan-setups", loansController.getAllLoanSetups);
  app.put("/api/hr/loan-setups/:id", loansController.updateLoanSetup);

  // Loans Management routes
  app.post("/api/hr/loans", loansController.createLoan);
  app.get("/api/hr/loans", loansController.getAllLoans);
  app.get("/api/hr/loans/next-reference", loansController.getNextLoanReference);
  app.get("/api/hr/loans/employee/:employeeId", loansController.getEmployeeLoans);
  app.put("/api/hr/loans/:id", loansController.updateLoan);
  app.put("/api/hr/loans/:id/status", loansController.updateLoanStatus);
  app.post("/api/hr/loans/:id/repayments", loansController.recordRepayment);
  app.get("/api/hr/loans/:id", loansController.getLoanWithRepayments);
};
