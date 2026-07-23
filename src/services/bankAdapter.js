"use strict";
const { postJournalBatch } = require("./postingEngine");

async function postBankCharge({
  facilityId,
  periodId,
  docNo,
  docDate,
  currency,
  fxRate,
  idempotencyKey,
  bankAccountId,
  expenseAccountId,
  amount,
  taxLines = [],
  createdBy,
}) {
  const lines = [
    {
      accountId: expenseAccountId,
      description: "Bank charge",
      debit: Number(amount || 0),
      credit: 0,
    },
    {
      accountId: bankAccountId,
      description: "Bank charge",
      debit: 0,
      credit: Number(amount || 0),
    },
  ];
  for (const t of taxLines) {
    lines.unshift({
      accountId: t.accountId,
      description: t.description || "Tax on bank charge",
      debit: Number(t.amount || 0),
      credit: 0,
    });
  }
  return await postJournalBatch({
    facilityId,
    periodId,
    docNo,
    docType: "BANK_CHARGE",
    docDate,
    currency,
    fxRate,
    sourceModule: "BANK",
    idempotencyKey,
    lines,
    createdBy,
  });
}

async function postBankInterest({
  facilityId,
  periodId,
  docNo,
  docDate,
  currency,
  fxRate,
  idempotencyKey,
  bankAccountId,
  interestIncomeAccountId,
  amount,
  createdBy,
}) {
  const lines = [
    {
      accountId: bankAccountId,
      description: "Bank interest",
      debit: Number(amount || 0),
      credit: 0,
    },
    {
      accountId: interestIncomeAccountId,
      description: "Bank interest income",
      debit: 0,
      credit: Number(amount || 0),
    },
  ];
  return await postJournalBatch({
    facilityId,
    periodId,
    docNo,
    docType: "BANK_INTEREST",
    docDate,
    currency,
    fxRate,
    sourceModule: "BANK",
    idempotencyKey,
    lines,
    createdBy,
  });
}

module.exports = { postBankCharge, postBankInterest };








