"use strict";
const { postJournalBatch } = require("./postingEngine");

/**
 * AP Adapters
 * Uses partyId with partyType='vendor' for aging/reconciliation.
 */

async function postAPBill({
  facilityId,
  periodId,
  docNo,
  docDate,
  currency,
  fxRate,
  idempotencyKey,
  vendorId,
  apControlAccountId,
  expenseOrInventoryLines, // [{accountId, amount, description}]
  taxLines = [], // [{accountId, amount, description}]
  createdBy,
}) {
  const lines = [];
  let totalDr = 0;

  for (const l of expenseOrInventoryLines) {
    lines.push({
      accountId: l.accountId,
      description: l.description || "Expense/Inventory",
      debit: Number(l.amount || 0),
      credit: 0,
      partyId: vendorId,
      partyType: "vendor",
    });
    totalDr += Number(l.amount || 0);
  }
  for (const t of taxLines) {
    lines.push({
      accountId: t.accountId,
      description: t.description || "Input VAT",
      debit: Number(t.amount || 0),
      credit: 0,
      partyId: vendorId,
      partyType: "vendor",
    });
    totalDr += Number(t.amount || 0);
  }
  // AP control line
  lines.push({
    accountId: apControlAccountId,
    description: "AP Trade",
    debit: 0,
    credit: totalDr,
    partyId: vendorId,
    partyType: "vendor",
  });

  return await postJournalBatch({
    facilityId,
    periodId,
    docNo,
    docType: "AP_BILL",
    docDate,
    currency,
    fxRate,
    sourceModule: "AP",
    idempotencyKey,
    lines,
    createdBy,
  });
}

async function postAPPayment({
  facilityId,
  periodId,
  docNo,
  docDate,
  currency,
  fxRate,
  idempotencyKey,
  vendorId,
  apControlAccountId,
  bankAccountId,
  amount,
  createdBy,
}) {
  const lines = [
    {
      accountId: apControlAccountId,
      description: "AP settlement",
      debit: Number(amount || 0),
      credit: 0,
      partyId: vendorId,
      partyType: "vendor",
    },
    {
      accountId: bankAccountId,
      description: "Vendor payment",
      debit: 0,
      credit: Number(amount || 0),
      partyId: vendorId,
      partyType: "vendor",
    },
  ];

  return await postJournalBatch({
    facilityId,
    periodId,
    docNo,
    docType: "AP_PAYMENT",
    docDate,
    currency,
    fxRate,
    sourceModule: "AP",
    idempotencyKey,
    lines,
    createdBy,
  });
}

module.exports = { postAPBill, postAPPayment };








