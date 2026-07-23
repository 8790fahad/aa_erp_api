"use strict";
const db = require("../models");

/**
 * Posting Engine MVP
 * - Validates double entry (sum Dr == sum Cr)
 * - Validates COA (accounts exist and are allowed)
 * - Checks that target period is open
 * - Enforces idempotency via unique idempotencyKey on batch
 * - Locks posted journals (locked=true) and sets postedAt
 */
async function postJournalBatch({
  facilityId,
  periodId,
  docNo,
  docType,
  docDate,
  currency,
  fxRate,
  sourceModule,
  idempotencyKey,
  lines,
  createdBy,
}) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error("No journal lines supplied");
  }

  // Validate period is open
  const period = await db.Period.findOne({ where: { id: periodId, facilityId } });
  if (!period) throw new Error("Invalid accounting period");
  if (period.status !== "open") throw new Error("Accounting period is not open");

  // Validate double entry
  let totalDr = 0;
  let totalCr = 0;

  for (const [idx, line] of lines.entries()) {
    if (!line.accountId) throw new Error(`Line ${idx + 1}: accountId required`);
    const account = await db.Account.findOne({ where: { id: line.accountId, facilityId } });
    if (!account) throw new Error(`Line ${idx + 1}: account not found`);
    // Optional: Block manual postings to control accounts
    if (account.is_control === true) {
      throw new Error(`Line ${idx + 1}: manual postings blocked to control account ${account.id}`);
    }
    const dr = Number(line.debit || 0);
    const cr = Number(line.credit || 0);
    if (dr < 0 || cr < 0) throw new Error(`Line ${idx + 1}: negative debit/credit not allowed`);
    totalDr += dr;
    totalCr += cr;
  }

  // Floating minor differences can be tolerated with small epsilon if desired
  if (totalDr.toFixed(2) !== totalCr.toFixed(2)) {
    throw new Error(`Unbalanced journal: Dr=${totalDr} Cr=${totalCr}`);
  }

  // Idempotency: unique idempotencyKey enforces no duplicates
  const existing = await db.GLJournalBatch.findOne({
    where: { idempotencyKey, facilityId },
  });
  if (existing) {
    // Return existing batch (idempotent)
    return existing.get({ plain: true });
  }

  // Create batch + lines atomically
  return await db.sequelize.transaction(async (t) => {
    const batch = await db.GLJournalBatch.create(
      {
        facilityId,
        periodId,
        docNo,
        docType,
        docDate,
        currency,
        fxRate,
        sourceModule,
        idempotencyKey,
        status: "draft",
        created_by: createdBy,
      },
      { transaction: t }
    );

    const lineRows = lines.map((l, i) => ({
      batchId: batch.id,
      lineNo: i + 1,
      accountId: l.accountId,
      description: l.description || null,
      debit: Number(l.debit || 0),
      credit: Number(l.credit || 0),
      costCenter: l.costCenter || null,
      productLine: l.productLine || null,
      taxCode: l.taxCode || null,
      sourceId: l.sourceId || null,
      sourceLineId: l.sourceLineId || null,
    }));

    await db.GLJournalLine.bulkCreate(lineRows, { transaction: t });

    // Post & lock
    batch.status = "posted";
    batch.postedAt = new Date();
    batch.locked = true;
    await batch.save({ transaction: t });

    return batch.get({ plain: true });
  });
}

/**
 * Reversal: generates reversing entry for a posted batch (period must be open)
 */
async function reverseJournalBatch({ batchId, periodId, facilityId, createdBy }) {
  const original = await db.GLJournalBatch.findOne({
    where: { id: batchId, facilityId },
    include: [{ model: db.GLJournalLine, as: "lines" }],
  });
  if (!original) throw new Error("Original batch not found");
  if (original.status !== "posted" || original.locked !== true) {
    throw new Error("Only posted & locked batches can be reversed");
  }

  const period = await db.Period.findOne({ where: { id: periodId, facilityId } });
  if (!period || period.status !== "open") {
    throw new Error("Target reversal period is not open");
  }

  const reverseLines = original.lines.map((l) => ({
    accountId: l.accountId,
    description: `Reversal of ${original.docNo} line ${l.lineNo}`,
    debit: Number(l.credit || 0),
    credit: Number(l.debit || 0),
    costCenter: l.costCenter,
    productLine: l.productLine,
    taxCode: l.taxCode,
    sourceId: original.id,
    sourceLineId: l.id,
  }));

  const reversed = await postJournalBatch({
    facilityId,
    periodId,
    docNo: `${original.docNo}-REV`,
    docType: `${original.docType}-REV`,
    docDate: new Date(),
    currency: original.currency,
    fxRate: original.fxRate,
    sourceModule: "GL_REVERSAL",
    idempotencyKey: `REV:${original.id}`,
    lines: reverseLines,
    createdBy,
  });

  // mark original as reversed (do not unlock)
  await db.GLJournalBatch.update(
    { status: "reversed" },
    { where: { id: original.id } }
  );

  return reversed;
}

module.exports = {
  postJournalBatch,
  reverseJournalBatch,
};








