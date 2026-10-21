const test = require("node:test");
const assert = require("node:assert/strict");
const { balanceLedgerEntries, roundMoney } = require("./ledgerBalance");

test("screenshot case: 0.02 gap is auto-balanced onto VAT credit", () => {
  // Debits 322567.70, Credits 322567.68 — same shape as the salt invoice error.
  const entries = [
    { type: "receivable", transaction_description: "AR", dr: 322567.7, cr: 0 },
    {
      type: "revenue",
      transaction_description: "Sales revenue",
      dr: 0,
      cr: 300000,
    },
    {
      type: "tax",
      transaction_description: "Output VAT @7.5%",
      dr: 0,
      cr: 22567.68,
    },
  ];

  const result = balanceLedgerEntries(entries, { tolerance: 2 });

  assert.equal(result.adjusted, true);
  assert.equal(result.balanced, true);
  assert.equal(result.difference, 0);
  assert.equal(result.totalDebits, 322567.7);
  assert.equal(result.totalCredits, 322567.7);
  assert.equal(entries[2].cr, 22567.7);
  assert.match(result.adjustmentNote, /Output VAT/i);
});

test("exact 0.02 float drift after raw sum still balances", () => {
  // Floating-point: 322567.70 - 322567.68 can be slightly over 0.02 in raw JS.
  const raw = Math.abs(322567.7 - 322567.68);
  assert.ok(raw > 0.02 || raw === 0.02);

  const entries = [
    { type: "receivable", transaction_description: "AR", dr: 322567.7, cr: 0 },
    { type: "revenue", transaction_description: "Sales", dr: 0, cr: 322567.68 },
  ];
  const result = balanceLedgerEntries(entries, { tolerance: 2 });
  assert.equal(result.balanced, true);
  assert.equal(roundMoney(result.totalDebits - result.totalCredits), 0);
});

test("gap of 2.00 is allowed and fixed", () => {
  const entries = [
    { type: "receivable", transaction_description: "AR", dr: 100, cr: 0 },
    { type: "revenue", transaction_description: "Sales", dr: 0, cr: 98 },
  ];
  const result = balanceLedgerEntries(entries, { tolerance: 2 });
  assert.equal(result.balanced, true);
  assert.equal(result.adjusted, true);
  assert.equal(entries[1].cr, 100);
});

test("gap above 2.00 is rejected", () => {
  const entries = [
    { type: "receivable", transaction_description: "AR", dr: 100, cr: 0 },
    { type: "revenue", transaction_description: "Sales", dr: 0, cr: 97.99 },
  ];
  const result = balanceLedgerEntries(entries, { tolerance: 2 });
  assert.equal(result.balanced, false);
  assert.equal(result.adjusted, false);
  assert.equal(result.difference, 2.01);
});

test("credits higher by kobo are fixed onto AR debit", () => {
  const entries = [
    { type: "receivable", transaction_description: "AR", dr: 99.99, cr: 0 },
    { type: "revenue", transaction_description: "Sales", dr: 0, cr: 100 },
  ];
  const result = balanceLedgerEntries(entries, { tolerance: 2 });
  assert.equal(result.balanced, true);
  assert.equal(result.adjusted, true);
  assert.equal(entries[0].dr, 100);
});

test("already balanced entries stay untouched", () => {
  const entries = [
    { type: "receivable", transaction_description: "AR", dr: 50, cr: 0 },
    { type: "revenue", transaction_description: "Sales", dr: 0, cr: 50 },
  ];
  const result = balanceLedgerEntries(entries, { tolerance: 2 });
  assert.equal(result.balanced, true);
  assert.equal(result.adjusted, false);
  assert.equal(result.difference, 0);
  assert.equal(entries[0].dr, 50);
  assert.equal(entries[1].cr, 50);
});
