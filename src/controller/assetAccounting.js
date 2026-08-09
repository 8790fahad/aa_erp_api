const moment = require("moment");
const db = require("../models");

/**
 * Fixed-asset journal posting via GeneralLedger (same pattern as payroll).
 * Double-entry for Acquisition, Depreciation, and Disposal.
 */

const DEFAULT_PAYMENT_CODE = "112199";
const DEFAULT_GAIN_CODE = "610900";
const DEFAULT_LOSS_CODE = "801900";

// Asset cost (SFP) — 6-digit CoA standard (e.g. 111005 Office Equipment).
const CATEGORY_ASSET_CODES = {
  Land: "111001",
  Buildings: "111002",
  "Land & Building": "111002",
  "Plant and Machinery": "111007",
  "Plant & Machinery": "111007",
  "Motor Vehicles": "111003",
  "Furniture and Fittings": "111004",
  "Furniture & Fittings": "111004",
  "Computer Equipment": "111006",
  "IT Equipment": "111006",
  "Office Equipment": "111005",
  "Other Assets": "111009",
};

// Accumulated depreciation (contra-asset) — 6-digit under Non Current Assets.
const CATEGORY_ACCUM_DEP_CODES = {
  Buildings: "111012",
  "Land & Building": "111012",
  "Plant and Machinery": "111017",
  "Plant & Machinery": "111017",
  "Motor Vehicles": "111013",
  "Furniture and Fittings": "111014",
  "Furniture & Fittings": "111014",
  "Computer Equipment": "111016",
  "IT Equipment": "111016",
  "Office Equipment": "111015",
  "Other Assets": "111019",
};

// Depreciation expense — 6-digit under Operating expenses / Depreciation.
const CATEGORY_DEP_EXPENSE_CODES = {
  Buildings: "801101",
  "Land & Building": "801101",
  "Plant and Machinery": "801105",
  "Plant & Machinery": "801105",
  "Motor Vehicles": "801103",
  "Furniture and Fittings": "801101",
  "Furniture & Fittings": "801101",
  "Computer Equipment": "801104",
  "IT Equipment": "801104",
  "Office Equipment": "801102",
  "Other Assets": "801106",
};

// Nigerian-style capital allowance rates by asset class. `initial` is the
// one-off first-year initial allowance (on cost); `annual` is the recurring
// annual allowance (on the written-down value). These are used ONLY for the
// parallel FIRS tax computation and are NEVER posted to the general ledger.
const CATEGORY_FIRS_RATES = {
  Land: { initial: 0, annual: 0 },
  Buildings: { initial: 0.1, annual: 0.05 },
  "Land & Building": { initial: 0.1, annual: 0.05 },
  "Plant and Machinery": { initial: 0.5, annual: 0.25 },
  "Plant & Machinery": { initial: 0.5, annual: 0.25 },
  "Motor Vehicles": { initial: 0.5, annual: 0.25 },
  "Furniture and Fittings": { initial: 0.5, annual: 0.25 },
  "Furniture & Fittings": { initial: 0.5, annual: 0.25 },
  "Computer Equipment": { initial: 0.5, annual: 0.25 },
  "IT Equipment": { initial: 0.5, annual: 0.25 },
  "Office Equipment": { initial: 0.5, annual: 0.25 },
  "Other Assets": { initial: 0.5, annual: 0.25 },
};

function getFirsRates(category) {
  return CATEGORY_FIRS_RATES[category] || { initial: 0.5, annual: 0.25 };
}

function getAssetAccountCode(category) {
  return CATEGORY_ASSET_CODES[category] || "111009";
}

function getAccumulatedDepreciationAccountCode(category) {
  return CATEGORY_ACCUM_DEP_CODES[category] || "111019";
}

function getDepreciationExpenseAccountCode(category) {
  return CATEGORY_DEP_EXPENSE_CODES[category] || "801106";
}

function resolveAssetCodes(asset = {}, overrides = {}) {
  const category = asset.category;
  return {
    assetCode:
      overrides.assetAccountCode ||
      asset.asset_account_code ||
      getAssetAccountCode(category),
    accumDepCode:
      overrides.accumulatedDepreciationAccountCode ||
      asset.accumulated_depreciation_account_code ||
      getAccumulatedDepreciationAccountCode(category),
    depExpenseCode:
      overrides.depreciationExpenseAccountCode ||
      asset.depreciation_expense_account_code ||
      getDepreciationExpenseAccountCode(category),
    disposalGainCode:
      overrides.disposalGainAccountCode ||
      asset.disposal_account_code ||
      DEFAULT_GAIN_CODE,
    disposalLossCode:
      overrides.disposalLossAccountCode || DEFAULT_LOSS_CODE,
    paymentCode: overrides.paymentAccountCode || DEFAULT_PAYMENT_CODE,
  };
}

function buildGLLine({
  accountCode,
  description,
  debit = 0,
  credit = 0,
  facilityId,
  reference,
  transactionRef,
  createdBy = "ASSET-SYSTEM",
  purpose = "Fixed Asset",
  payee = null,
  type = "journal_entry",
  transactionDate,
  chequeNo = null,
}) {
  return {
    transaction_date: transactionDate
      ? moment(transactionDate).format("YYYY-MM-DD")
      : moment().format("YYYY-MM-DD"),
    account_code: String(accountCode),
    account_subhead: String(accountCode),
    dr: parseFloat((debit || 0).toFixed(2)),
    cr: parseFloat((credit || 0).toFixed(2)),
    account_description: description,
    transaction_description: description,
    reference_number: reference ? String(reference).slice(0, 15) : null,
    purpose_of_payment: purpose,
    payee: payee ? String(payee).slice(0, 50) : "ASSET",
    facility_id: facilityId,
    transaction_ref: String(transactionRef).slice(0, 100),
    type,
    created_by: String(createdBy),
    status: "saved",
    cheque_no: chequeNo || null,
  };
}

async function persistLines(lines) {
  let count = 0;
  for (const line of lines) {
    if (line.dr === 0 && line.cr === 0) continue;
    await db.GeneralLedger.create(line);
    count += 1;
  }
  return count;
}

function makeReference(transactionType, transactionDate) {
  const stamp = moment(transactionDate).format("YYMMDD");
  const rand = Math.random().toString(36).substr(2, 4).toUpperCase();
  return `A${transactionType.slice(0, 3).toUpperCase()}${stamp}${rand}`.slice(
    0,
    15
  );
}

/**
 * Post asset journal entries. Returns journal reference number.
 */
async function createAssetJournalEntry(
  transactionType,
  asset,
  amount,
  transactionDate,
  facilityId,
  additionalData = {}
) {
  const createdBy = additionalData.createdBy || "ASSET-SYSTEM";
  const codes = resolveAssetCodes(asset, additionalData);
  const reference = makeReference(transactionType, transactionDate);
  const desc = asset.description || "Asset";
  const lines = [];
  let seq = 0;
  const nextRef = (suffix) => `${reference}-${suffix}-${++seq}`;

  switch (transactionType) {
    case "Acquisition": {
      const cost = parseFloat(amount);
      lines.push(
        buildGLLine({
          accountCode: codes.assetCode,
          description: `Asset Acquisition - ${desc}`,
          debit: cost,
          facilityId,
          reference,
          transactionRef: nextRef("DR"),
          createdBy,
          purpose: "Asset Acquisition",
          payee: desc,
          type: "journal_entry",
          transactionDate,
        })
      );
      lines.push(
        buildGLLine({
          accountCode: codes.paymentCode,
          description: `Asset Acquisition Payment - ${desc}`,
          credit: cost,
          facilityId,
          reference,
          transactionRef: nextRef("CR"),
          createdBy,
          purpose: "Asset Acquisition Payment",
          payee: additionalData.paymentAccountName || "Cash/Bank",
          type: "payment",
          transactionDate,
          chequeNo: additionalData.chequeNumber || null,
        })
      );
      break;
    }

    case "Depreciation": {
      const dep = parseFloat(amount);
      lines.push(
        buildGLLine({
          accountCode: codes.depExpenseCode,
          description: `Depreciation Expense - ${desc}`,
          debit: dep,
          facilityId,
          reference,
          transactionRef: nextRef("DR"),
          createdBy,
          purpose: "Depreciation Expense",
          payee: desc,
          type: "expenses",
          transactionDate,
        })
      );
      lines.push(
        buildGLLine({
          accountCode: codes.accumDepCode,
          description: `Accumulated Depreciation - ${desc}`,
          credit: dep,
          facilityId,
          reference,
          transactionRef: nextRef("CR"),
          createdBy,
          purpose: "Accumulated Depreciation",
          payee: desc,
          type: "journal_entry",
          transactionDate,
        })
      );
      break;
    }

    case "Disposal": {
      const accumulatedDepreciation = parseFloat(
        additionalData.accumulatedDepreciation || 0
      );
      const disposalProceeds = parseFloat(additionalData.disposalProceeds || 0);
      const acquisitionCost = parseFloat(asset.acquisition_cost || 0);
      const netBookValue = acquisitionCost - accumulatedDepreciation;
      const gainLoss = disposalProceeds - netBookValue;

      if (disposalProceeds > 0) {
        lines.push(
          buildGLLine({
            accountCode: codes.paymentCode,
            description: `Asset Disposal Proceeds - ${desc}`,
            debit: disposalProceeds,
            facilityId,
            reference,
            transactionRef: nextRef("DR"),
            createdBy,
            purpose: "Asset Disposal Proceeds",
            payee: additionalData.paymentAccountName || "Cash/Bank",
            type: "payment",
            transactionDate,
          })
        );
      }

      if (accumulatedDepreciation > 0) {
        lines.push(
          buildGLLine({
            accountCode: codes.accumDepCode,
            description: `Accumulated Depreciation Removal - ${desc}`,
            debit: accumulatedDepreciation,
            facilityId,
            reference,
            transactionRef: nextRef("DR"),
            createdBy,
            purpose: "Accumulated Depreciation Removal",
            payee: desc,
            type: "journal_entry",
            transactionDate,
          })
        );
      }

      lines.push(
        buildGLLine({
          accountCode: codes.assetCode,
          description: `Asset Disposal - ${desc}`,
          credit: acquisitionCost,
          facilityId,
          reference,
          transactionRef: nextRef("CR"),
          createdBy,
          purpose: "Asset Disposal",
          payee: desc,
          type: "journal_entry",
          transactionDate,
        })
      );

      if (gainLoss !== 0) {
        const isGain = gainLoss > 0;
        lines.push(
          buildGLLine({
            accountCode: isGain ? codes.disposalGainCode : codes.disposalLossCode,
            description: `${isGain ? "Gain" : "Loss"} on Asset Disposal - ${desc}`,
            debit: isGain ? 0 : Math.abs(gainLoss),
            credit: isGain ? Math.abs(gainLoss) : 0,
            facilityId,
            reference,
            transactionRef: nextRef(isGain ? "CR" : "DR"),
            createdBy,
            purpose: `${isGain ? "Gain" : "Loss"} on Asset Disposal`,
            payee: desc,
            type: isGain ? "revenue" : "expenses",
            transactionDate,
          })
        );
      }
      break;
    }

    default:
      throw new Error(`Unsupported asset journal type: ${transactionType}`);
  }

  await persistLines(lines);
  return reference;
}

/**
 * Compute the FIRS capital allowance for a single period WITHOUT touching the
 * general ledger. Returns the period allowance plus the updated cumulative
 * written-down value and allowance-to-date so callers can persist them on the
 * asset. This is a tax-only, parallel figure to book depreciation.
 */
function computeFirsPeriodAllowance(asset = {}, { periodMonths = 1 } = {}) {
  const cost = parseFloat(asset.acquisition_cost || 0);
  const rates = getFirsRates(asset.category);
  const annualRate =
    asset.firs_allowance_rate !== null &&
    asset.firs_allowance_rate !== undefined &&
    asset.firs_allowance_rate !== ""
      ? parseFloat(asset.firs_allowance_rate) / 100
      : rates.annual;

  const wdv =
    asset.firs_written_down_value !== null &&
    asset.firs_written_down_value !== undefined
      ? parseFloat(asset.firs_written_down_value)
      : cost;
  const allowanceToDate = parseFloat(asset.firs_allowance_to_date || 0);

  if (wdv <= 0 || cost <= 0) {
    return {
      allowance: 0,
      newWrittenDownValue: Math.max(wdv, 0),
      newAllowanceToDate: allowanceToDate,
      annualRate,
    };
  }

  let allowance = 0;
  // One-off initial allowance in the first period an allowance is taken.
  if (allowanceToDate <= 0 && rates.initial > 0) {
    allowance += cost * rates.initial;
  }
  // Recurring annual allowance, prorated to the period length.
  allowance += wdv * annualRate * (periodMonths / 12);

  // Never write the pool below zero.
  allowance = Math.min(allowance, Math.max(wdv, 0));
  allowance = parseFloat(allowance.toFixed(2));

  const newWrittenDownValue = parseFloat(Math.max(wdv - allowance, 0).toFixed(2));
  const newAllowanceToDate = parseFloat((allowanceToDate + allowance).toFixed(2));

  return { allowance, newWrittenDownValue, newAllowanceToDate, annualRate };
}

/**
 * Post ONE summarized depreciation journal grouped by category.
 * Dr Depreciation Expense (per category total) / Cr Accumulated Depreciation
 * (per category total). `categoryTotals` is a map keyed by category label,
 * each value { amount, count }.
 * Returns the shared journal reference (or null when nothing to post).
 */
async function createBulkDepreciationJournal(
  categoryTotals,
  transactionDate,
  facilityId,
  additionalData = {}
) {
  const createdBy = additionalData.createdBy || "ASSET-SYSTEM";
  const reference = makeReference("Depreciation", transactionDate);
  const lines = [];
  let seq = 0;
  const nextRef = (suffix) => `${reference}-${suffix}-${++seq}`;

  const entries = Object.entries(categoryTotals || {}).filter(
    ([, v]) => v && parseFloat(v.amount) > 0
  );
  if (entries.length === 0) return null;

  for (const [category, value] of entries) {
    const amount = parseFloat(parseFloat(value.amount).toFixed(2));
    const expenseCode = getDepreciationExpenseAccountCode(category);
    const accumCode = getAccumulatedDepreciationAccountCode(category);

    lines.push(
      buildGLLine({
        accountCode: expenseCode,
        description: `Depreciation Expense - ${category}`,
        debit: amount,
        facilityId,
        reference,
        transactionRef: nextRef("DR"),
        createdBy,
        purpose: "Depreciation Expense",
        payee: category,
        type: "expenses",
        transactionDate,
      })
    );
    lines.push(
      buildGLLine({
        accountCode: accumCode,
        description: `Accumulated Depreciation - ${category}`,
        credit: amount,
        facilityId,
        reference,
        transactionRef: nextRef("CR"),
        createdBy,
        purpose: "Accumulated Depreciation",
        payee: category,
        type: "journal_entry",
        transactionDate,
      })
    );
  }

  await persistLines(lines);
  return reference;
}

module.exports = {
  createAssetJournalEntry,
  createBulkDepreciationJournal,
  computeFirsPeriodAllowance,
  getFirsRates,
  getAssetAccountCode,
  getAccumulatedDepreciationAccountCode,
  getDepreciationExpenseAccountCode,
  resolveAssetCodes,
  CATEGORY_FIRS_RATES,
  DEFAULT_PAYMENT_CODE,
  DEFAULT_GAIN_CODE,
  DEFAULT_LOSS_CODE,
};
