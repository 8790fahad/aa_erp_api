/**
 * Sale / journal ledger balance helpers.
 * Multi-line VAT and unit prices often leave a few kobo of float/round drift.
 */

const DEFAULT_TOLERANCE = 2;

/** Balances smaller than this are kobo rounding, not an amount owed. */
const REPORT_DUST = 0.05;

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function snapReportBalance(n) {
  const v = roundMoney(n);
  return Math.abs(v) < REPORT_DUST ? 0 : v;
}

function isProtectedMoneyLine(entry) {
  const type = String(entry.type || "").toLowerCase();
  return (
    type === "receivable" ||
    type === "recevable" ||
    type === "payable" ||
    type === "payables" ||
    type === "payment" ||
    type === "bank" ||
    type === "deposit" ||
    type === "accrued" ||
    type === "advance"
  );
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

/**
 * Round-sum DR/CR and park gaps up to tolerance on a tax or revenue line.
 *
 * Mutates entry.cr when a small gap is fixed. Cash, bank, and party
 * balances are left unchanged.
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

  // Kobo gaps belong on VAT or sales revenue. Never on cash, the bank,
  // or a customer/supplier balance — that is what left ₦0.01 on receivables.
  if (difference > 0 && difference <= LEDGER_BALANCE_TOLERANCE) {
    const creditLine = [...ledgerEntries]
      .filter((e) => Number(e.cr || 0) > 0 && !isProtectedMoneyLine(e))
      .filter((e) => signedDiff > 0 || Number(e.cr || 0) + signedDiff >= 0)
      .sort(
        (a, b) =>
          preferCreditPlug(b) - preferCreditPlug(a) ||
          Number(b.cr || 0) - Number(a.cr || 0),
      )[0];
    if (creditLine) {
      creditLine.cr = roundMoney(Number(creditLine.cr || 0) + signedDiff);
      adjusted = true;
      const sign = signedDiff > 0 ? "+" : "";
      adjustmentNote = `Auto-balanced ${sign}${signedDiff.toFixed(2)} on credit: ${
        creditLine.transaction_description || creditLine.type || "credit"
      }`;
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

/**
 * A settled invoice can still show ₦0.01 because line VAT rounded up.
 * Drop that residue off the receivable (or payable) lines, and off the
 * VAT/revenue credit when that line is in the same set, so the journal
 * stays balanced.
 */
function clearReferenceKoboDust(rows, types = ["receivable", "recevable"]) {
  const wanted = new Set(types.map((t) => String(t).toLowerCase()));
  const groups = new Map();
  for (const row of rows || []) {
    const ref = String(row.reference_number || "").trim();
    if (!ref) continue;
    const key = `${row.facility_id || ""}|${ref}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  for (const group of groups.values()) {
    const partyLines = group.filter((row) =>
      wanted.has(String(row.type || "").toLowerCase()),
    );
    if (!partyLines.length) continue;
    const net = roundMoney(
      partyLines.reduce(
        (sum, row) => sum + Number(row.dr || 0) - Number(row.cr || 0),
        0,
      ),
    );
    if (net === 0 || Math.abs(net) >= REPORT_DUST) continue;

    if (net > 0) {
      const debitLine = partyLines
        .filter((row) => Number(row.dr || 0) >= net)
        .sort((a, b) => Number(b.dr || 0) - Number(a.dr || 0))[0];
      if (!debitLine) continue;
      debitLine.dr = roundMoney(Number(debitLine.dr || 0) - net);
    } else {
      const creditLine = partyLines
        .filter((row) => Number(row.cr || 0) >= Math.abs(net))
        .sort((a, b) => Number(b.cr || 0) - Number(a.cr || 0))[0];
      if (!creditLine) continue;
      creditLine.cr = roundMoney(Number(creditLine.cr || 0) - Math.abs(net));
    }

    const plug = group
      .filter((row) => Number(row.cr || 0) >= Math.abs(net) && !wanted.has(String(row.type || "").toLowerCase()))
      .filter((row) => !isProtectedMoneyLine(row))
      .sort(
        (a, b) =>
          preferCreditPlug(b) - preferCreditPlug(a) ||
          Number(b.cr || 0) - Number(a.cr || 0),
      )[0];
    if (plug) {
      plug.cr = roundMoney(Number(plug.cr || 0) - net);
    }
  }

  return rows;
}

module.exports = {
  DEFAULT_TOLERANCE,
  REPORT_DUST,
  roundMoney,
  snapReportBalance,
  balanceLedgerEntries,
  clearReferenceKoboDust,
};
