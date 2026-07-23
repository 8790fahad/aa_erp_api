"use strict";
const { postJournalBatch } = require("./postingEngine");

/**
 * AR Adapters
 * Assumes control accounts and revenue accounts are validated on the client or config.
 * Lines will include partyId with partyType='customer' to enable aging/reconciliation.
 */

async function postARInvoice({
  facilityId,
  periodId,
  docNo,
  docDate,
  currency,
  fxRate,
  idempotencyKey,
  customerId,
  arControlAccountId,
  revenueLines, // [{accountId, amount, description}]
  taxLines = [], // [{accountId, amount, description}]
  createdBy,
}) {
  const lines = [];
  let totalCr = 0;

  for (const r of revenueLines) {
    lines.push({
      accountId: r.accountId,
      description: r.description || "Revenue",
      debit: 0,
      credit: Number(r.amount || 0),
      partyId: customerId,
      partyType: "customer",
    });
    totalCr += Number(r.amount || 0);
  }
  for (const t of taxLines) {
    lines.push({
      accountId: t.accountId,
      description: t.description || "Output VAT",
      debit: 0,
      credit: Number(t.amount || 0),
      partyId: customerId,
      partyType: "customer",
    });
    totalCr += Number(t.amount || 0);
  }
  // AR control line
  lines.push({
    accountId: arControlAccountId,
    description: "AR Trade",
    debit: totalCr,
    credit: 0,
    partyId: customerId,
    partyType: "customer",
  });

  return await postJournalBatch({
    facilityId,
    periodId,
    docNo,
    docType: "AR_INVOICE",
    docDate,
    currency,
    fxRate,
    sourceModule: "AR",
    idempotencyKey,
    lines,
    createdBy,
  });
}

async function postARReceipt({
  facilityId,
  periodId,
  docNo,
  docDate,
  currency,
  fxRate,
  idempotencyKey,
  customerId,
  arControlAccountId,
  bankAccountId,
  amount,
  createdBy,
}) {
  const lines = [
    {
      accountId: bankAccountId,
      description: "Customer receipt",
      debit: Number(amount || 0),
      credit: 0,
      partyId: customerId,
      partyType: "customer",
    },
    {
      accountId: arControlAccountId,
      description: "AR settlement",
      debit: 0,
      credit: Number(amount || 0),
      partyId: customerId,
      partyType: "customer",
    },
  ];

  return await postJournalBatch({
    facilityId,
    periodId,
    docNo,
    docType: "AR_RECEIPT",
    docDate,
    currency,
    fxRate,
    sourceModule: "AR",
    idempotencyKey,
    lines,
    createdBy,
  });
}

module.exports = { postARInvoice, postARReceipt };








