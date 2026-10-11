const test = require("node:test");
const assert = require("node:assert/strict");
const {
  payrollPeriodRef,
  loanAmountDue,
  loanOutstanding,
  loanAppliesInPeriod,
  periodDeductionAmount,
  sumPeriodDeductions,
  allocatePeriodDeductions,
  allocateLoanCreditLines,
} = require("./staffLoanDeductions");

const staffLoan = (overrides = {}) => ({
  id: "loan-1",
  amount: 120000,
  profit: 0,
  amountPaid: 0,
  monthlyDeductionAmount: 20000,
  startDate: "2026-03-01",
  repaymentMethod: "Salary Deduction",
  status: "Approved",
  ...overrides,
});

test("period reference stays stable for idempotent payroll deductions", () => {
  assert.equal(payrollPeriodRef(3, 2026), "Payroll 3/2026");
});

test("amount due includes profit charged on the loan", () => {
  assert.equal(loanAmountDue(staffLoan({ amount: 100000, profit: 15000 })), 115000);
  assert.equal(loanOutstanding(staffLoan({ amount: 100000, profit: 15000, amountPaid: 20000 })), 95000);
});

test("salary deduction does not start before the applies-from month", () => {
  const loan = staffLoan({ startDate: "2026-04-01" });
  assert.equal(loanAppliesInPeriod(loan, 3, 2026), false);
  assert.equal(periodDeductionAmount(loan, 3, 2026), 0);
  assert.equal(loanAppliesInPeriod(loan, 4, 2026), true);
  assert.equal(periodDeductionAmount(loan, 4, 2026), 20000);
});

test("legacy loans with no start date apply immediately", () => {
  const loan = staffLoan({ startDate: null });
  assert.equal(loanAppliesInPeriod(loan, 1, 2026), true);
  assert.equal(periodDeductionAmount(loan, 1, 2026), 20000);
});

test("final installment is capped at the outstanding balance", () => {
  const loan = staffLoan({
    amount: 50000,
    profit: 0,
    amountPaid: 40000,
    monthlyDeductionAmount: 20000,
    startDate: "2026-01-01",
  });
  assert.equal(periodDeductionAmount(loan, 4, 2026), 10000);
});

test("a loan with no monthly deduction is not taken from salary", () => {
  const loan = staffLoan({ monthlyDeductionAmount: 0 });
  assert.equal(periodDeductionAmount(loan, 4, 2026), 0);
  assert.deepEqual(allocatePeriodDeductions([loan], 4, 2026, 120000), []);
});

test("multiple staff loans are allocated oldest first and stop at the payroll total", () => {
  const loans = [
    staffLoan({
      id: "older",
      amount: 60000,
      monthlyDeductionAmount: 15000,
      startDate: "2026-01-01",
    }),
    staffLoan({
      id: "newer",
      amount: 40000,
      monthlyDeductionAmount: 10000,
      startDate: "2026-01-01",
    }),
  ];
  const total = sumPeriodDeductions(loans, 2, 2026);
  assert.equal(total, 25000);

  const allocations = allocatePeriodDeductions(loans, 2, 2026, 18000);
  assert.deepEqual(
    allocations.map((item) => ({ loanId: item.loanId, amount: item.amount })),
    [
      { loanId: "older", amount: 15000 },
      { loanId: "newer", amount: 3000 },
    ],
  );
});

test("payroll GL credits the staff receivable and keeps the posted total balanced", () => {
  const lines = allocateLoanCreditLines(
    [
      { accountCode: "100068", amount: 15000 },
      { accountCode: "100069", amount: 5000 },
    ],
    22000,
    "900213",
  );
  assert.deepEqual(lines, [
    { accountCode: "100068", amount: 15000 },
    { accountCode: "100069", amount: 5000 },
    { accountCode: "900213", amount: 2000 },
  ]);
  assert.equal(
    lines.reduce((sum, line) => sum + line.amount, 0),
    22000,
  );
});

test("when repayment rows already exist, GL uses those receivable heads only", () => {
  const lines = allocateLoanCreditLines(
    [{ accountCode: "100068", amount: 20000 }],
    20000,
    "900213",
  );
  assert.deepEqual(lines, [{ accountCode: "100068", amount: 20000 }]);
});
