/**
 * Sale / journal ledger balance helpers.
 * Multi-line VAT and unit prices often leave a few kobo of float/round drift.
 */

const DEFAULT_TOLERANCE = 2;

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function sumSide(entries, key) {
  return roundMoney(
    (entries || []).reduce((sum, entry) => sum + Number(entry[key] || 0), 0),
  );
}

function preferCreditPlug(entry) {
  const type = String(entry.type || "").toLowerCase();
  const desc = String(entry.transaction_description || "").toLowerCase();
  if (type === "tax" || desc.includes("vat")) return 3;
  if (type === "revenue" || desc.includes("sales revenue")) return 2;
  if (Number(entry.cr || 0) > 0) return 1;
  return 0;
}

function preferDebitPlug(entry) {
  const type = String(entry.type || "").toLowerCase();
  if (type === "receivable") return 3;
  if (type === "bank" || type === "payment") return 2;
  if (Number(entry.dr || 0) > 0) return 1;
  return 0;
}

/**
 * Round-sum DR/CR, auto-fix gaps up to tolerance onto a tax/revenue/AR plug
 * line, and report whether the batch is acceptable.
 *
 * Mutates entry.dr / entry.cr when a small gap is fixed.
 *
 * @param {Array<{dr?:number,cr?:number,type?:string,transaction_description?:string}>} ledgerEntries
 * @param {{tolerance?: number}} [options]
 * @returns {{
 *   totalDebits: number,
 *   totalCredits: number,
 *   difference: number,
 *   balanced: boolean,
 *   adjusted: boolean,
 *   adjustmentNote: string|null,
 * }}
 */
function balanceLedgerEntries(ledgerEntries, options = {}) {
  const tolerance = Number(options.tolerance);
  const LEDGER_BALANCE_TOLERANCE = Number.isFinite(tolerance)
    ? tolerance
    : DEFAULT_TOLERANCE;

  let totalDebits = sumSide(ledgerEntries, "dr");
  let totalCredits = sumSide(ledgerEntries, "cr");
  let signedDiff = roundMoney(totalDebits - totalCredits);
  let difference = Math.abs(signedDiff);
  let adjusted = false;
  let adjustmentNote = null;

  if (difference > 0 && difference <= LEDGER_BALANCE_TOLERANCE) {
    if (signedDiff > 0) {
      const creditLine = [...ledgerEntries]
        .filter((e) => Number(e.cr || 0) > 0)
        .sort(
          (a, b) =>
            preferCreditPlug(b) - preferCreditPlug(a) ||
            Number(b.cr || 0) - Number(a.cr || 0),
        )[0];
      if (creditLine) {
        creditLine.cr = roundMoney(Number(creditLine.cr || 0) + signedDiff);
        adjusted = true;
        adjustmentNote = `Auto-balanced +${signedDiff.toFixed(2)} onto credit: ${
          creditLine.transaction_description || creditLine.type || "credit"
        }`;
      }
    } else {
      const debitLine = [...ledgerEntries]
        .filter((e) => Number(e.dr || 0) > 0)
        .sort(
          (a, b) =>
            preferDebitPlug(b) - preferDebitPlug(a) ||
            Number(b.dr || 0) - Number(a.dr || 0),
        )[0];
      if (debitLine) {
        debitLine.dr = roundMoney(
          Number(debitLine.dr || 0) + Math.abs(signedDiff),
        );
        adjusted = true;
        adjustmentNote = `Auto-balanced +${Math.abs(signedDiff).toFixed(
          2,
        )} onto debit: ${
          debitLine.transaction_description || debitLine.type || "debit"
        }`;
      }
    }

    totalDebits = sumSide(ledgerEntries, "dr");
    totalCredits = sumSide(ledgerEntries, "cr");
    signedDiff = roundMoney(totalDebits - totalCredits);
    difference = Math.abs(signedDiff);
  }

  return {
    totalDebits,
    totalCredits,
    difference,
    balanced: difference <= LEDGER_BALANCE_TOLERANCE,
    adjusted,
    adjustmentNote,
  };
}

module.exports = {
  DEFAULT_TOLERANCE,
  roundMoney,
  balanceLedgerEntries,
};
