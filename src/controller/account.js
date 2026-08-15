import { getAndUpdateNumber } from "../services/numberGen";
import { getBalance } from "./supplier";
const {
  SuppliersInfo,
  SupplierEntry,
  StoreEntry,
  GeneralLedger,
  Invoice,
  Account,
  Customer,
  CustomerEntry,
} = require("../models");
const db = require("../models");
const moment = require("moment");
const request = require("request");
const { flowbooks_api } = require(".");
const path = require("path");
const fs = require("fs");
const UUIDV4 = require("uuid").v4;
const getTxnVersionId = require("./helpers").getTxnVersionId;
const getStoreVersionId = require("./helpers").getStoreVersionId;
const getAccountEntriesVersionId =
  require("./helpers").getAccountEntriesVersionId;
const { QueryTypes, Op, Sequelize } = require("sequelize");
const { findAccountCategoryForFacility } = require("./accountCategory");
const { STORE_ENTRY_TYPE } = require("../constants/storeEntryTypes");
const {
  fetchEnrichedSalesInvoices,
  aggregateReceivableMetrics,
  sumPaymentsReceivedInPeriod,
  getDateRangeLast30Days,
  getLocalDateStr,
  startOfLocalDay,
} = require("../services/salesInvoiceSettlement");
const {
  buildFinancialDashboardOverview,
} = require("../services/financialDashboard");
const {
  signedBalance,
  signedMovement,
  resolveAccountNature,
} = require("../utils/accountBalance");
const {
  recordActivity,
  pickActor,
} = require("../services/activityAuditService");

exports.getAccountByCategory = (req, res) => {
  const { category } = req.params;
  db.sequelize
    .query("call get_account_by_category(:category)", {
      replacements: {
        category,
      },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ success: false, err }));
};

/** Template by-product totals for GL / store posting (matches UI cost breakdown). */
function computeTemplateByProductPostingAmounts(templateByProduct) {
  const units = Math.max(parseFloat(templateByProduct?.units) || 1, 1);
  const headerUnitCost = parseFloat(templateByProduct?.unit_cost) || 0;
  const items = Array.isArray(templateByProduct?.items)
    ? templateByProduct.items
    : [];

  const parseAmt = (v) => {
    const n = parseFloat(String(v ?? "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  const parseQtyField = (v) => {
    if (v === undefined || v === null || String(v).trim() === "") return null;
    const n = parseFloat(String(v).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  };

  const buildAtScale = (unitScale, useStoredActual) => {
    const rawMaterialLines = [];
    let rawMaterialsTotal = 0;

    for (const item of items) {
      const type = String(item.type || "raw_material").toLowerCase();
      if (type !== "raw_material" && type !== "semi_finished") continue;

      const recipeQty = parseAmt(item.quantity);
      let actualQty = useStoredActual
        ? parseQtyField(item.actualQty ?? item.actual_qty)
        : null;
      if (actualQty == null) actualQty = unitScale * recipeQty;
      const unitCost = parseAmt(item.unit_cost ?? item.rate);
      const exactAmount = Number((actualQty * unitCost).toFixed(4));
      if (exactAmount <= 0 || actualQty <= 0) continue;

      rawMaterialsTotal += exactAmount;
      rawMaterialLines.push({
        item,
        actualQty,
        unitCost,
        exactAmount,
        sku: String(item.rawMaterialSku || item.raw_material_sku || "").trim(),
      });
    }

    let running = rawMaterialsTotal;
    const otherLines = [];
    for (const item of items) {
      const type = String(item.type || "raw_material").toLowerCase();
      if (type === "raw_material" || type === "semi_finished") continue;

      const otherType = String(
        item.otherType || item.other_type || "rate",
      ).toLowerCase();
      let lineBatch = 0;
      if (otherType === "rate") {
        lineBatch = parseAmt(item.rate) * unitScale;
      } else if (otherType === "percentage") {
        const pct = parseAmt(item.quantity);
        const basis = String(
          item.percentageBasis || item.percentage_basis || "all_items",
        ).toLowerCase();
        const base = basis === "raw_material" ? rawMaterialsTotal : running;
        lineBatch = (pct / 100) * base;
      }
      lineBatch = Number(lineBatch.toFixed(4));
      if (lineBatch <= 0) continue;

      if (type === "by_product_credit") {
        running -= lineBatch;
      } else {
        running += lineBatch;
      }
      otherLines.push({ item, type, lineBatch });
    }

    return {
      rawMaterialLines,
      otherLines,
      rawMaterialsTotal,
      associatedCosts: Math.max(0, running),
    };
  };

  const scaled = buildAtScale(units, true);
  const perUnitBasis = buildAtScale(1, false);
  const associatedPerUnit = perUnitBasis.associatedCosts;
  const buildUpCostPerUnit = Number(
    (headerUnitCost + associatedPerUnit).toFixed(4),
  );
  const buildUpTotal = Number((buildUpCostPerUnit * units).toFixed(4));
  const inventoryReceiptTotal = buildUpTotal;

  return {
    units,
    headerUnitCost,
    associatedPerUnit,
    buildUpCostPerUnit,
    buildUpTotal,
    inventoryReceiptTotal,
    inventoryUnitCost: buildUpCostPerUnit,
    costPerUnit: buildUpCostPerUnit,
    totalProduction: buildUpTotal,
    ...scaled,
  };
}

const SALES_STORE_BRANCH_NAME = "for sales";

function parsePositiveBranchId(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function resolvePostingBranchId(...candidates) {
  for (const value of candidates) {
    const id = parsePositiveBranchId(value);
    if (id) return id;
  }
  return 0;
}

exports.completeProduction = async (req, res) => {
  const {
    requestData: {
      costingType,
      costingRecordId,
      batchNo,
      batchId,
      productionDate,
      output, // total output units
      qtyUse = 1, // Qty use multiplier for shared costs
      products = [],
      sharedCosts = [],
      templateByProduct = null,
      departmentId = null, // legacy alias for branchId
      branchId: requestBranchId = null,
    },
    wipCode,
    facilityId: bodyFacilityId,
    branchId: bodyBranchId = null,
    userId: reqUserId,
    journalEntries: clientJournalEntries = [],
    sharedCostingLedgerEntries = [],
    abnormal_loss_account: bodyAbnormalLossAccount,
    scrap_inventory_account: bodyScrapInventoryAccount,
    recyclableWasteStoreLines: bodyRecyclableWasteStoreLines = [],
  } = req.body;
  console.log(req.body, "==========");

  const facility_id = bodyFacilityId;
  const createdBy = reqUserId || req.user?.id;

  if (!facility_id || !batchNo || !createdBy) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields: facilityId, batchNo, or userId",
    });
  }

  if (!wipCode) {
    return res.status(400).json({
      success: false,
      message: "Missing required field: wipCode (WIP account code)",
    });
  }

  // Validate costing type
  if (costingType !== "joint_shared" && costingType !== "job_specific") {
    return res.status(400).json({
      success: false,
      message: "Invalid costing type. Must be 'joint_shared' or 'job_specific'",
    });
  }

  let transaction;
  try {
    transaction = await db.sequelize.transaction();

    // Use provided productionDate or today
    const transactionDate = productionDate
      ? moment(productionDate).format("YYYY-MM-DD")
      : moment().format("YYYY-MM-DD");

    // Generate production reference
    const prodSeq = await getAndUpdateNumber("production", facility_id);
    const productionRef = `PROD-${prodSeq.toString().padStart(6, "0")}`;
    const postingReferenceNumber = batchId || batchNo;
    const narration = `Production Completion - Batch: ${batchNo} | Ref: ${productionRef}`;
    const defaultPostingBranchId = resolvePostingBranchId(
      requestBranchId,
      bodyBranchId,
      departmentId,
    );

    const normalizeAccountCode = (value) =>
      String(value || "")
        .replace(/[\t\r\n]/g, "")
        .trim();

    const skipServerLedgerBuild =
      costingType === "joint_shared" &&
      Array.isArray(sharedCostingLedgerEntries) &&
      sharedCostingLedgerEntries.length > 0;

    let supplementalLedgerEntries = [];

    const resolveSharedCostingLedgerEntries = async (entries) => {
      const normalized = [];
      let totalDr = 0;
      let totalCr = 0;

      const pennyAdjustLedgerRows = (rows) => {
        let dr = rows.reduce((sum, row) => sum + row.dr, 0);
        let cr = rows.reduce((sum, row) => sum + row.cr, 0);
        let diff = Number((dr - cr).toFixed(2));
        if (Math.abs(diff) < 0.01) return rows;

        const tryAdjust = (row) => {
          if (diff > 0 && row.dr > 0) {
            const adjusted = Number((row.dr - diff).toFixed(2));
            if (adjusted > 0) {
              row.dr = adjusted;
              return true;
            }
          }
          if (diff < 0 && row.cr > 0) {
            const adjusted = Number((row.cr + diff).toFixed(2));
            if (adjusted > 0) {
              row.cr = adjusted;
              return true;
            }
          }
          return false;
        };

        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (rows[i].dr > 0 && tryAdjust(rows[i])) break;
        }
        return rows;
      };

      for (const entry of entries) {
        const code = normalizeAccountCode(entry.account_code);
        if (!code) {
          throw new Error(
            "Shared costing ledger entry is missing account_code",
          );
        }
        const dr = Number((parseFloat(entry.dr) || 0).toFixed(2));
        const cr = Number((parseFloat(entry.cr) || 0).toFixed(2));
        if (dr === 0 && cr === 0) continue;

        let account = await db.AccountCategory.findOne({
          where: { code, facility_id },
          transaction,
        });
        if (!account) {
          const refSku = String(entry.transaction_ref || "").trim();
          if (refSku) {
            let product = await db.Product.findOne({
              where: { sku: refSku, facility_id },
              attributes: ["inventory_account", "sku", "name", "item_name"],
              transaction,
            });
            if (!product) {
              product = await db.Product.findOne({
                where: {
                  facility_id,
                  [Op.or]: [{ name: refSku }, { item_name: refSku }],
                },
                attributes: ["inventory_account", "sku", "name", "item_name"],
                transaction,
              });
            }
            const invCode = normalizeAccountCode(product?.inventory_account);
            if (invCode) {
              account = await db.AccountCategory.findOne({
                where: { code: invCode, facility_id },
                transaction,
              });
            }
          }
        }
        if (!account) {
          throw new Error(
            `Account not found for shared costing ledger: ${code}`,
          );
        }

        totalDr += dr;
        totalCr += cr;
        normalized.push({
          account_code: account.code,
          dr,
          cr,
          account_description: account.description,
          transaction_description:
            entry.transaction_description || "Shared Costing Production",
          type: entry.type || "inventory",
          transaction_ref: entry.transaction_ref || postingReferenceNumber,
        });
      }

      pennyAdjustLedgerRows(normalized);

      totalDr = normalized.reduce((sum, row) => sum + row.dr, 0);
      totalCr = normalized.reduce((sum, row) => sum + row.cr, 0);

      if (Math.abs(totalDr - totalCr) >= 0.02) {
        throw new Error(
          `Shared costing ledger entries out of balance (Dr ${totalDr} vs Cr ${totalCr})`,
        );
      }

      return normalized;
    };

    const parsePostingQty = (v) => {
      if (v === undefined || v === null || String(v).trim() === "") {
        return null;
      }
      const n = parseFloat(String(v).replace(/,/g, ""));
      return Number.isFinite(n) ? n : null;
    };

    /**
     * GL / store material line: Actual Qty × Rate ÷ Basis.
     * Rate = unit_cost; Basis = explicit line basis (defaults to 1).
     * Actual qty prefers payload actual_qty, then expected, then recipe×output fallback.
     */
    const computeMaterialLinePosting = ({
      actualQty: actualRaw,
      expectedQty: expectedRaw,
      rate,
      basis,
      fallbackActualQty,
    }) => {
      const rateVal = parseFloat(rate || 0) || 0;
      const basisParsed = parsePostingQty(basis);
      const basisVal = basisParsed != null && basisParsed > 0 ? basisParsed : 1;

      let actualQty = parsePostingQty(actualRaw);
      if (actualQty == null) {
        actualQty = parsePostingQty(expectedRaw);
      }
      if (actualQty == null && fallbackActualQty != null) {
        actualQty = fallbackActualQty;
      }
      if (actualQty == null) actualQty = 0;

      const exactAmount = Number(((actualQty * rateVal) / basisVal).toFixed(4));
      return {
        actualQty,
        exactAmount,
        exactQuantityUsed: actualQty,
      };
    };

    /**
     * Batch production cost from Actual Qty × rate (materials) + scaled other/fixed lines.
     * costPerUnit = totalBatchCost ÷ goodQty (good qty only — waste excluded from denominator).
     */
    const computeProductionCostFromIngredients = (
      ingredients = [],
      goodQty = 0,
    ) => {
      const qtyScale = goodQty > 0 ? goodQty : 1;

      const isMaterialLine = (ing) => {
        const t = String(ing?.type || "raw_material").toLowerCase();
        return t === "raw_material" || t === "semi_finished";
      };

      let rawMaterialsBatchTotal = 0;
      for (const ing of ingredients.filter(isMaterialLine)) {
        const unitCostValue = parseFloat(ing.unit_cost || 0) || 0;
        if (unitCostValue <= 0) continue;

        const recipeQty = parseFloat(ing.quantity || 0) || 0;
        const fallbackActual =
          recipeQty > 0 && goodQty > 0 ? recipeQty * goodQty : 0;

        const { exactAmount } = computeMaterialLinePosting({
          actualQty:
            ing.actual_qty ?? ing.actualQty ?? ing.qtyUsed ?? ing.qty_used,
          expectedQty: ing.expected_qty ?? ing.expectedQty,
          rate: unitCostValue,
          basis:
            ing.basis ?? ing.rate_basis ?? ing.rateBasis ?? ing.line_basis ?? 1,
          fallbackActualQty: fallbackActual,
        });

        rawMaterialsBatchTotal += exactAmount;
      }

      let runningBatch = rawMaterialsBatchTotal;

      const nonRawLines = ingredients.filter(
        (ing) => ing.type === "by_product_credit" || ing.type === "other",
      );

      const getLineBatchAmount = (ing, runningBatchTotal) => {
        const t = String(
          ing.otherType || ing.other_type || "rate",
        ).toLowerCase();
        if (t === "rate") {
          const perUnit =
            parseFloat(ing.rate || 0) || parseFloat(ing.amount || 0) || 0;
          return perUnit * qtyScale;
        }
        if (t === "percentage") {
          const pct = parseFloat(ing.quantity || 0) || 0;
          const basis = String(
            ing.percentageBasis || ing.percentage_basis || "all_items",
          ).toLowerCase();
          if (basis === "raw_material") {
            return (pct / 100) * rawMaterialsBatchTotal;
          }
          if (basis === "all_items") {
            return (pct / 100) * runningBatchTotal;
          }
        }
        return 0;
      };

      let totalBatchCost = runningBatch;
      for (const ing of nonRawLines) {
        const lineBatch = getLineBatchAmount(ing, runningBatch);
        if (ing.type === "by_product_credit") {
          runningBatch -= lineBatch;
          totalBatchCost -= lineBatch;
        } else {
          runningBatch += lineBatch;
          totalBatchCost += lineBatch;
        }
      }

      totalBatchCost = Number(totalBatchCost.toFixed(4));
      const costPerUnit =
        goodQty > 0
          ? Number((totalBatchCost / goodQty).toFixed(4))
          : totalBatchCost;

      return { costPerUnit, totalBatchCost };
    };

    const ledgerEntries = [];
    /** Deferred until after WIP stock check — eager create() would deduct qty_out before assert. */
    const pendingStoreEntries = [];
    const queueStoreEntry = (data, options = { transaction }) => {
      pendingStoreEntries.push({ data, options });
    };
    /** Aggregated WIP consumption by SKU for stock availability check. */
    const wipConsumptionBySku = new Map();

    const trackWipConsumption = (sku, qty, label = "", source = "") => {
      const key = String(sku || "").trim();
      const amount = parseFloat(qty) || 0;
      if (!key || amount <= 0) return;
      const existing = wipConsumptionBySku.get(key) || {
        qty: 0,
        label: "",
        sources: [],
      };
      existing.qty = Number((existing.qty + amount).toFixed(4));
      if (!existing.label && label) existing.label = String(label);
      if (source) {
        existing.sources.push({
          source: String(source),
          qty: Number(amount.toFixed(4)),
        });
      }
      wipConsumptionBySku.set(key, existing);
    };

    /**
     * Live WIP on-hand for one SKU — same formula as /inventory/wip
     * (Work in Progress branch, non-expired rows, COALESCE qty).
     * Checked one SKU at a time so shortages are reported accurately.
     */
    const getWipOnHandForSku = async (sku) => {
      const rows = await db.sequelize.query(
        `SELECT IFNULL(
           SUM(COALESCE(se.qty_in, 0) - COALESCE(se.qty_out, 0)),
           0
         ) AS balance
         FROM store_entries se
         INNER JOIN products p
           ON p.sku = se.product_id
           AND p.facility_id = se.facilityId
         WHERE se.product_id = :sku
           AND se.facilityId = :facilityId
           AND se.branch_name = 'Work in Progress'
           AND (se.expiry_date IS NULL OR se.expiry_date >= CURDATE())
           AND COALESCE(p.status, 'Active') = 'Active'`,
        {
          replacements: { sku, facilityId: facility_id },
          type: db.sequelize.QueryTypes.SELECT,
          transaction,
        },
      );
      return Number(parseFloat(rows?.[0]?.balance || 0).toFixed(4));
    };

    const assertWipStockAvailable = async () => {
      if (wipConsumptionBySku.size === 0) return;

      const shortages = [];
      // Check each SKU individually (one-by-one) so logs and errors match UI Available.
      for (const [sku, { qty, label, sources }] of wipConsumptionBySku.entries()) {
        const available = await getWipOnHandForSku(sku);
        const requested = Number(qty.toFixed(4));
        console.log(
          `[WIP stock check] SKU=${sku} label="${label || ""}" requested=${requested} available=${available} sources=${JSON.stringify(sources || [])}`,
        );
        if (requested > available + 0.0001) {
          const name = label || sku;
          const sourceHint =
            Array.isArray(sources) && sources.length > 1
              ? ` [from: ${sources.map((s) => `${s.source}=${s.qty}`).join(", ")}]`
              : "";
          shortages.push(
            `${name} (SKU ${sku}): requested ${requested}, available in WIP ${available}${sourceHint}`,
          );
        }
      }

      if (shortages.length > 0) {
        const err = new Error(
          `Insufficient WIP stock to complete batch. ${shortages.join("; ")}`,
        );
        err.statusCode = 400;
        err.code = "INSUFFICIENT_STOCK";
        err.details = shortages;
        throw err;
      }
    };

    const BusinessModel = db.business || db.Business;
    const businessRow = BusinessModel
      ? await BusinessModel.findOne({
          where: { id: facility_id },
          attributes: ["abnormal_loss_account", "scrap_inventory_account"],
          transaction,
        })
      : null;

    const clientHasAbnormalJournal = (clientJournalEntries || []).some((e) =>
      String(e.transaction_description || "").includes("Abnormal waste"),
    );
    const syntheticJournalEntries = [];

    /**
     * Map client `products[].waste` (type-specific shape) to a flat line for posting / journal helpers.
     * Legacy: FG-shaped line (includes goodQuantity). Current: sparse object by wasteType + optional `scrap`.
     */
    const normalizeExplicitWasteForPosting = (raw) => {
      if (!raw || typeof raw !== "object") return null;
      const wq =
        parseFloat(raw.wasteQuantity ?? raw.waste_quantity ?? raw.qty ?? 0) ||
        0;
      if (wq <= 0) return null;

      const typeNorm = (() => {
        const t = String(raw.wasteType ?? raw.waste_type ?? "")
          .trim()
          .toLowerCase();
        if (t === "abnorm" || t === "abnormal") return "abnormal";
        if (t === "recycled" || t === "recycle" || t === "recyclable") {
          return "recyclable";
        }
        return "normal";
      })();

      const sku = String(
        raw.sku ?? raw.finished_good_sku ?? raw.fg_sku ?? "",
      ).trim();

      // Legacy client line (same shape as a finished-good row)
      if (
        Object.prototype.hasOwnProperty.call(raw, "goodQuantity") ||
        Object.prototype.hasOwnProperty.call(raw, "good_quantity")
      ) {
        return {
          ...raw,
          sku: sku || String(raw.sku || "").trim(),
          wasteType: typeNorm,
          waste_type: typeNorm,
        };
      }

      let costPerU =
        parseFloat(
          raw.cost_per_unit ?? raw.costPerUnit ?? raw.scrap_cost_per_unit ?? 0,
        ) || 0;
      let wasteGl =
        Number(
          (
            parseFloat(raw.waste_gl_amount ?? raw.wasteGlAmount ?? 0) || 0
          ).toFixed(2),
        ) || 0;
      let amount = parseFloat(raw.amount ?? 0) || 0;

      if (
        typeNorm === "recyclable" &&
        raw.scrap &&
        typeof raw.scrap === "object"
      ) {
        const sc = raw.scrap;
        const fromScrap = parseFloat(
          raw.scrap_cost_per_unit ?? sc.cost_per_unit ?? 0,
        );
        if (Number.isFinite(fromScrap) && fromScrap > 0) costPerU = fromScrap;
      }

      if (wasteGl <= 0 && wq > 0 && costPerU > 0) {
        wasteGl = Number((wq * costPerU).toFixed(2));
      }
      if (amount <= 0 && wasteGl > 0) amount = wasteGl;
      if (amount <= 0 && wq > 0 && costPerU > 0) {
        amount = Number((wq * costPerU).toFixed(2));
      }

      return {
        ...raw,
        sku,
        wasteQuantity: wq,
        waste_quantity: wq,
        qty: wq,
        goodQuantity: 0,
        wasteType: typeNorm,
        waste_type: typeNorm,
        cost_per_unit: costPerU,
        waste_gl_amount: wasteGl,
        amount,
        wasteReason: raw.wasteReason ?? raw.waste_reason ?? "",
      };
    };

    /** Synthetic abnormal Dr loss / Cr WIP when the client did not send those journals. */
    const appendSyntheticAbnormalFromFinishedGood = async (fgLine, fgSku) => {
      const wq =
        parseFloat(fgLine.wasteQuantity ?? fgLine.waste_quantity ?? 0) || 0;
      const cpu = parseFloat(fgLine.cost_per_unit || 0) || 0;
      let wasteAmt = Number(
        (parseFloat(fgLine.waste_gl_amount || 0) || 0).toFixed(2),
      );
      if (wasteAmt <= 0 && wq > 0 && cpu > 0) {
        wasteAmt = Number((wq * cpu).toFixed(2));
      }
      if (wasteAmt <= 0) return;
      // If payload carried a per-unit loss but waste qty > 1, scale to waste qty × unit cost.
      if (wq > 1 && cpu > 0 && Math.abs(wasteAmt - cpu) < 0.02) {
        wasteAmt = Number((wq * cpu).toFixed(2));
      }

      const fgSkuSafe = String(fgSku || "").trim() || "FG";
      const wasteDescBase = `Abnormal waste - ${fgSkuSafe} Batch: ${postingReferenceNumber}`;

      let expCode =
        normalizeAccountCode(bodyAbnormalLossAccount) ||
        normalizeAccountCode(businessRow?.abnormal_loss_account) ||
        "";
      let expAccount = expCode
        ? await db.AccountCategory.findOne({
            where: { code: expCode, facility_id },
            transaction,
          })
        : null;
      if (!expAccount) {
        expAccount = await findAccountCategoryForFacility({
          facilityId: facility_id,
          code: null,
          descriptionCandidates: ["Abnormal Loss"],
          transaction,
        });
      }
      if (!expAccount) {
        throw new Error(
          "Abnormal waste requires an Abnormal Loss account (business setting or chart).",
        );
      }
      expCode = normalizeAccountCode(expAccount.code);

      syntheticJournalEntries.push(
        {
          account_code: expCode,
          dr: wasteAmt,
          cr: 0,
          transaction_description: wasteDescBase,
          type: "expenses",
          transaction_ref: postingReferenceNumber,
        },
        {
          account_code: wipCode,
          dr: 0,
          cr: wasteAmt,
          transaction_description: wasteDescBase,
          type: "production",
          transaction_ref: postingReferenceNumber,
        },
      );
    };

    let totalFGValue = 0; // Debit: Finished Goods Inventory
    let totalWasteDebitValue = 0; // Debit: Abnormal loss / scrap inventory (waste output)
    let totalByProductValue = 0; // Debit: By-Product Inventory
    let totalWIPMaterialsValue = 0; // Credit: WIP (raw materials consumed)
    let totalExpensesApplied = 0; // Credit: Overhead/Labor/Waste expenses

    // ===================================================================
    // 1. PROCESS EACH PRODUCT (per-item costs + finished goods output)
    // ===================================================================
    for (const item of products) {
      const {
        units,
        finishedGoods,
        ingredients = [],
        waste: productWaste,
      } = item;
      /** When set with positive waste qty, `waste` is one object (type-specific or legacy FG-shaped). Embedded waste on finishedGoods is ignored. Legacy: waste as array uses first element. */
      const explicitWasteRaw = (() => {
        if (productWaste == null) return null;
        if (Array.isArray(productWaste)) {
          if (!productWaste.length) return null;
          const first = productWaste[0];
          if (!first || typeof first !== "object") return null;
          const wq =
            parseFloat(
              first.wasteQuantity ?? first.waste_quantity ?? first.qty ?? 0,
            ) || 0;
          return wq > 0 ? first : null;
        }
        if (typeof productWaste === "object") {
          const wq =
            parseFloat(
              productWaste.wasteQuantity ??
                productWaste.waste_quantity ??
                productWaste.qty ??
                0,
            ) || 0;
          return wq > 0 ? productWaste : null;
        }
        return null;
      })();
      const explicitWasteLine =
        normalizeExplicitWasteForPosting(explicitWasteRaw);

      // Normalize finishedGoods to an array - frontend now sends either:
      // - finishedGoods: { ... }  (single object)
      // - finishedGoods: [ { ... }, ... ]  (array, backward compatibility)
      const finishedGoodsList = Array.isArray(finishedGoods)
        ? finishedGoods
        : finishedGoods
          ? [finishedGoods]
          : [];

      // Good output qty: match UI / alternate clients (camelCase + snake_case + fallbacks).
      const getFgGoodQuantity = (fg) => {
        const pick = (...candidates) => {
          for (const v of candidates) {
            if (v !== undefined && v !== null && String(v).trim() !== "") {
              const q = parseFloat(v);
              if (Number.isFinite(q) && q > 0) return q;
            }
          }
          return 0;
        };
        return pick(
          fg.goodQuantity,
          fg.good_quantity,
          fg.qty,
          fg.quantity,
          fg.productQty,
          fg.product_qty,
          fg.units,
        );
      };

      /** Good qty for costing (excludes normal waste from total quantity when only `quantity` is sent). */
      const resolveGoodQtyForLine = (fg) => {
        const pick = (...candidates) => {
          for (const v of candidates) {
            if (v !== undefined && v !== null && String(v).trim() !== "") {
              const q = parseFloat(v);
              if (Number.isFinite(q) && q > 0) return q;
            }
          }
          return 0;
        };

        const hasExplicitGood =
          fg.goodQuantity !== undefined &&
          fg.goodQuantity !== null &&
          String(fg.goodQuantity).trim() !== "";
        if (hasExplicitGood) {
          return pick(fg.goodQuantity, fg.good_quantity);
        }

        const q = getFgGoodQuantity(fg);
        const wasteType = String(fg.wasteType ?? fg.waste_type ?? "normal")
          .trim()
          .toLowerCase();
        const wasteQty =
          parseFloat(fg.wasteQuantity ?? fg.waste_quantity ?? 0) || 0;
        if ((wasteType === "normal" || wasteType === "") && wasteQty > 0) {
          return Math.max(0, q - wasteQty);
        }
        return q;
      };

      // Total good output for this production line (all FG rows, with or without waste).
      // Ingredients are posted once against this total — not repeated per finished-good row.
      let totalFgGoodQtyForIngredients = 0;
      for (const fg of finishedGoodsList) {
        if (!fg.sku || fg.cost_per_unit == null) continue;
        totalFgGoodQtyForIngredients += resolveGoodQtyForLine(fg);
      }
      const unitsFallback = parseFloat(units || 0) || 0;
      if (totalFgGoodQtyForIngredients <= 0 && unitsFallback > 0) {
        totalFgGoodQtyForIngredients = unitsFallback;
      }

      const explicitWasteQty =
        explicitWasteLine &&
        (explicitWasteLine.wasteType === "abnormal" ||
          explicitWasteLine.wasteType === "recyclable")
          ? parseFloat(
              explicitWasteLine.wasteQuantity ??
                explicitWasteLine.waste_quantity ??
                0,
            ) || 0
          : 0;
      // Abnormal/recyclable: scale ingredients + unit cost to good + waste output.
      const outputQtyForPosting =
        explicitWasteQty > 0
          ? totalFgGoodQtyForIngredients + explicitWasteQty
          : totalFgGoodQtyForIngredients;

      const { costPerUnit: recipeCostPerUnit, totalBatchCost: itemBatchCost } =
        computeProductionCostFromIngredients(ingredients, outputQtyForPosting);

      const journalOutputDenominator = outputQtyForPosting;
      const journalUnitCost =
        itemBatchCost > 0 && journalOutputDenominator > 0
          ? Number((itemBatchCost / journalOutputDenominator).toFixed(4))
          : recipeCostPerUnit;

      let expenseFallbackProduct = null;

      // ---- Finished Goods Output ----
      for (const fg of finishedGoodsList) {
        const {
          sku,
          cost_per_unit,
          multiplier_id,
          expiry_date,
          mark_up = 0,
          markup_mode = "percentage",
          selling_price,
        } = fg;
        if (!sku || cost_per_unit == null) continue;

        let fgGoodQty = resolveGoodQtyForLine(fg);
        if (!fgGoodQty) continue;

        // FG Dr = payload unit cost × good qty (same rate as waste journal lines).
        const payloadCostPerUnit = parseFloat(cost_per_unit);
        const costPerUnit =
          Number.isFinite(payloadCostPerUnit) && payloadCostPerUnit > 0
            ? payloadCostPerUnit
            : journalUnitCost > 0
              ? journalUnitCost
              : recipeCostPerUnit;
        if (costPerUnit <= 0) continue;

        const payloadFgAmount = Number((parseFloat(fg.amount) || 0).toFixed(4));
        const totalCost =
          payloadFgAmount > 0
            ? payloadFgAmount
            : Number((fgGoodQty * costPerUnit).toFixed(4));
        const fgQtyStore = fgGoodQty;

        if (totalCost <= 0) continue;

        totalFGValue += totalCost;

        const product = await db.Product.findOne({
          where: { sku, facility_id },
          attributes: [
            "name",
            "inventory_account",
            "item_type",
            "cogs_head",
            "revenue_account",
          ],
          transaction,
        });
        if (!product) throw new Error(`Product not found: ${sku}`);

        if (!expenseFallbackProduct) {
          expenseFallbackProduct = product;
        }

        // Strictly use product inventory code for FG posting.
        const fgAccountCode = normalizeAccountCode(product.inventory_account);
        if (!fgAccountCode) {
          throw new Error(
            `Product inventory_account is missing for SKU: ${sku}`,
          );
        }

        const fgAccount = await db.AccountCategory.findOne({
          where: { code: fgAccountCode, facility_id },
          transaction,
        });

        if (!fgAccount) {
          throw new Error(
            `FG account not found for product inventory code: ${fgAccountCode}`,
          );
        }

        const fgBranchId = resolvePostingBranchId(
          fg.branchLocationId,
          fg.branch_location_id,
          fg.branchId,
          defaultPostingBranchId,
        );
        if (!fgBranchId || fgBranchId <= 0) {
          throw Object.assign(
            new Error(
              `Branch / location is required for finished good store entry (SKU: ${sku}). Select a branch on the finished-good row or production write-up.`,
            ),
            { statusCode: 400 },
          );
        }


        // Store Entry: Receive into FG
        queueStoreEntry({
          receive_date: transactionDate,
          po_no: "PRODUCTION",
          reference_number: postingReferenceNumber,
          batch_id: batchNo,
          qty_in: fgQtyStore,
          qty_out: 0,
          expiry_date: expiry_date || null,
          cost_price: costPerUnit,
          mark_up: parseFloat(mark_up) || 0,
          markup_mode: markup_mode || "percentage",
          selling_price:
            parseFloat(selling_price) || parseFloat(costPerUnit) || 0,
          inserted_by: createdBy,
          facilityId: facility_id,
          branch_name: SALES_STORE_BRANCH_NAME,
          branchId: fgBranchId,
          destination: "Finished Goods",
          source: "Production",
          status: "approved",
          activation: "active",
          type: STORE_ENTRY_TYPE.PRODUCTION,
          product_id: sku,
          multiplier_id: multiplier_id || null,
        });

        // Waste on finished-good rows (legacy). When `item.waste` is sent, waste is processed after this loop.
        if (!explicitWasteLine) {
          // Waste (non-good): abnormal/recyclable material cost is already in ingredient consumption
          // (Cost Breakdown scales to good + waste). No separate waste GL here.
          const wasteQty =
            parseFloat(fg.wasteQuantity ?? fg.waste_quantity ?? 0) || 0;
          if (wasteQty > 0) {
            // normal: absorbed in FG CPU; abnormal/recyclable: no supplemental GL
          }
        }

        // Ledger: Dr Finished Goods
        ledgerEntries.push({
          account_code: fgAccount.code,
          dr: totalCost,
          cr: 0,
          account_description: fgAccount.description,
          transaction_description: `${
            product.name || sku
          } - Production Completion`,
          type: "inventory",
          transaction_ref: sku,
          branch_id: fgBranchId,
        });
      } // End of finished goods loop

      // Explicit waste: Dr loss/scrap inventory = unit_cost × waste qty; Cr WIP (same amount).
      if (
        explicitWasteLine &&
        (explicitWasteLine.wasteType === "abnormal" ||
          explicitWasteLine.wasteType === "recyclable")
      ) {
        const wq =
          parseFloat(
            explicitWasteLine.wasteQuantity ??
              explicitWasteLine.waste_quantity ??
              0,
          ) || 0;
        const cpu =
          parseFloat(explicitWasteLine.cost_per_unit || 0) ||
          journalUnitCost ||
          0;
        let wasteAmt = Number(
          (
            parseFloat(explicitWasteLine.amount || 0) ||
            parseFloat(explicitWasteLine.waste_gl_amount || 0) ||
            (wq > 0 && cpu > 0 ? wq * cpu : 0)
          ).toFixed(4),
        );

        if (wq > 0 && wasteAmt > 0) {
          const fgSkuRef = String(explicitWasteLine.sku || "").trim() || "FG";
          const batchRef = postingReferenceNumber;

          if (explicitWasteLine.wasteType === "abnormal") {
            let expCode = normalizeAccountCode(
              explicitWasteLine.abnormal_loss_account_code ??
                explicitWasteLine.abnormalLossAccountCode ??
                bodyAbnormalLossAccount ??
                businessRow?.abnormal_loss_account ??
                "",
            );
            let expAccount = expCode
              ? await db.AccountCategory.findOne({
                  where: { code: expCode, facility_id },
                  transaction,
                })
              : null;
            if (!expAccount) {
              expAccount = await findAccountCategoryForFacility({
                facilityId: facility_id,
                code: null,
                descriptionCandidates: ["Abnormal Loss"],
                transaction,
              });
            }
            if (!expAccount) {
              throw new Error(
                "Abnormal waste requires an Abnormal Loss account (business setting or chart).",
              );
            }

            const wasteDesc = `Abnormal waste - ${fgSkuRef} Batch: ${batchRef}`;
            ledgerEntries.push({
              account_code: expAccount.code,
              dr: wasteAmt,
              cr: 0,
              account_description: expAccount.description,
              transaction_description: wasteDesc,
              type: "expenses",
              transaction_ref: batchRef,
            });
            totalWasteDebitValue += wasteAmt;
          } else if (explicitWasteLine.wasteType === "recyclable") {
            const scrapMeta = explicitWasteLine.scrap || {};
            let scrapInvCode = normalizeAccountCode(
              scrapMeta.inventory_account_code ??
                scrapMeta.inventoryAccountCode ??
                bodyScrapInventoryAccount ??
                businessRow?.scrap_inventory_account ??
                "",
            );
            let scrapAccount = scrapInvCode
              ? await db.AccountCategory.findOne({
                  where: { code: scrapInvCode, facility_id },
                  transaction,
                })
              : null;
            if (!scrapAccount) {
              scrapAccount = await findAccountCategoryForFacility({
                facilityId: facility_id,
                code: scrapInvCode || null,
                descriptionCandidates: ["Scrap Inventory"],
                transaction,
              });
            }
            if (!scrapAccount) {
              throw new Error(
                "Recyclable waste requires a scrap/by-product inventory account on the product record.",
              );
            }

            const wasteDesc = `Recyclable scrap - ${fgSkuRef} Batch: ${batchRef}`;
            ledgerEntries.push({
              account_code: scrapAccount.code,
              dr: wasteAmt,
              cr: 0,
              account_description: scrapAccount.description,
              transaction_description: wasteDesc,
              type: "inventory",
              transaction_ref: fgSkuRef,
            });
            totalWasteDebitValue += wasteAmt;
          }
        }
      }

      // ---- Ingredients once per production item (all FG lines, with or without waste) ----
      // Scaled by total output (good, or good + abnormal/recyclable waste).
      for (const ing of ingredients) {
        const {
          type,
          amount,
          descriptionCode,
          rawMaterialSku,
          unit_cost,
          quantity: recipeQtyPerFg,
        } = ing;

        const amt = Number((parseFloat(amount) || 0).toFixed(4));
        const payloadLineAmount = Number(
          (parseFloat(ing.amount) || 0).toFixed(4),
        );

        if (type === "raw_material" && rawMaterialSku) {
          const unitCostValue = parseFloat(unit_cost || 0);
          if (unitCostValue <= 0) continue;

          const recipeQty = parseFloat(recipeQtyPerFg || 0);
          const fallbackActual =
            recipeQty > 0 && outputQtyForPosting > 0
              ? recipeQty * outputQtyForPosting
              : 0;

          const { exactAmount: computedAmount, exactQuantityUsed } =
            computeMaterialLinePosting({
              actualQty:
                ing.actual_qty ?? ing.actualQty ?? ing.qtyUsed ?? ing.qty_used,
              expectedQty: ing.expected_qty ?? ing.expectedQty,
              rate: unitCostValue,
              basis:
                ing.basis ??
                ing.rate_basis ??
                ing.rateBasis ??
                ing.line_basis ??
                1,
              fallbackActualQty: fallbackActual,
            });

          const exactAmount =
            payloadLineAmount > 0 ? payloadLineAmount : computedAmount;

          if (exactAmount <= 0) continue;

          let qtyForStore = exactQuantityUsed;
          if (qtyForStore <= 0 && unitCostValue > 0) {
            qtyForStore = Number((exactAmount / unitCostValue).toFixed(4));
          }
          if (qtyForStore <= 0) continue;

          totalWIPMaterialsValue += exactAmount;

          const rmProduct = await db.Product.findOne({
            where: { sku: rawMaterialSku, facility_id },
            attributes: ["name"],
            transaction,
          });

          trackWipConsumption(
            rawMaterialSku,
            qtyForStore,
            rmProduct?.name || ing.description || rawMaterialSku,
            "product_ingredient",
          );

          queueStoreEntry({
            receive_date: transactionDate,
            po_no: "PRODUCTION",
            reference_number: postingReferenceNumber,
            batch_id: batchNo,
            qty_in: 0,
            qty_out: qtyForStore,
            cost_price: unitCostValue,
            inserted_by: createdBy,
            facilityId: facility_id,
            branch_name: "Work in Progress",
            destination: "Finished Goods",
            source: "Work in Progress",
            status: "approved",
            activation: "active",
            type: STORE_ENTRY_TYPE.CONSUMED,
            product_id: rawMaterialSku,
          });

          const wipAccount = await db.AccountCategory.findOne({
            where: { code: wipCode, facility_id },
            transaction,
          });
          if (!wipAccount) throw new Error("WIP account not configured");

          ledgerEntries.push({
            account_code: wipAccount.code,
            dr: 0,
            cr: exactAmount,
            account_description: wipAccount.description,
            transaction_description: `${
              rmProduct?.name || rawMaterialSku
            } - Material Consumption`,
            type: "inventory",
            transaction_ref: rawMaterialSku,
          });
        } else if (type === "by_product_credit" && descriptionCode) {
          if (amt <= 0) continue;

          const payloadLineAmount = Number(
            (parseFloat(ing.amount) || 0).toFixed(4),
          );
          const exactAmount =
            payloadLineAmount > 0
              ? payloadLineAmount
              : amt * outputQtyForPosting;
          totalByProductValue += exactAmount;

          const bpAccount = await db.AccountCategory.findOne({
            where: { code: descriptionCode, facility_id },
            transaction,
          });
          if (!bpAccount)
            throw new Error(`By-product account not found: ${descriptionCode}`);

          ledgerEntries.push({
            account_code: bpAccount.code,
            dr: exactAmount,
            cr: 0,
            account_description: bpAccount.description,
            transaction_description: "By-Product from Production",
            type: "inventory",
            transaction_ref: descriptionCode,
          });
        } else if (type === "other" && descriptionCode) {
          const otherInputType = String(
            ing.otherType || ing.other_type || "rate",
          ).toLowerCase();
          const rateVal = parseFloat(ing.rate || 0) || 0;
          let exactAmount = 0;
          if (otherInputType === "rate" && rateVal > 0) {
            exactAmount = Number((rateVal * outputQtyForPosting).toFixed(4));
          } else {
            if (amt <= 0) continue;
            const payloadLineAmount = Number(
              (parseFloat(ing.amount) || 0).toFixed(4),
            );
            exactAmount =
              payloadLineAmount > 0
                ? payloadLineAmount
                : amt * outputQtyForPosting;
          }
          if (exactAmount <= 0) continue;
          totalExpensesApplied += exactAmount;

          const resolveAccountByCode = async (code) => {
            const cleanCode = normalizeAccountCode(code);
            if (!cleanCode) return null;
            return db.AccountCategory.findOne({
              where: { code: cleanCode, facility_id },
              transaction,
            });
          };

          const fallbackExpenseCode = normalizeAccountCode(
            expenseFallbackProduct?.cogs_head ||
              expenseFallbackProduct?.revenue_account,
          );
          let expAccount = await resolveAccountByCode(descriptionCode);
          if (!expAccount && fallbackExpenseCode) {
            expAccount = await resolveAccountByCode(fallbackExpenseCode);
          }
          if (!expAccount) {
            throw new Error(
              `Expense account not found: ${
                normalizeAccountCode(descriptionCode) ||
                fallbackExpenseCode ||
                "N/A"
              }`,
            );
          }

          ledgerEntries.push({
            account_code: expAccount.code,
            dr: 0,
            cr: exactAmount,
            account_description: expAccount.description,
            transaction_description:
              ing.description || "Applied Manufacturing Cost",
            type: "expenses",
            transaction_ref: descriptionCode,
          });
        }
      } // End of ingredients loop for this production item
    } // End of products loop

    // ===================================================================
    // 2. PROCESS SHARED COSTS (joint costs allocated across all products)
    // Only for joint_shared costing type
    // ===================================================================
    if (
      costingType === "joint_shared" &&
      sharedCosts &&
      sharedCosts.length > 0
    ) {
      const qtyUseValue = parseFloat(qtyUse || 1);

      for (const cost of sharedCosts) {
        const {
          type,
          amount,
          descriptionCode,
          rawMaterialSku,
          quantity,
          unit_cost,
        } = cost;

        const amt = Number((parseFloat(amount) || 0).toFixed(4));

        if (type === "raw_material" && rawMaterialSku) {
          const unitCostValue = parseFloat(unit_cost || 0);
          if (unitCostValue <= 0) continue;

          const rawMaterialQty = parseFloat(quantity || 0);
          const fallbackActual = rawMaterialQty * qtyUseValue;

          const { exactAmount, exactQuantityUsed } = computeMaterialLinePosting(
            {
              actualQty:
                cost.actual_qty ??
                cost.actualQty ??
                cost.qtyUsed ??
                cost.qty_used,
              expectedQty: cost.expected_qty ?? cost.expectedQty,
              rate: unitCostValue,
              basis:
                cost.basis ??
                cost.rate_basis ??
                cost.rateBasis ??
                cost.line_basis ??
                1,
              fallbackActualQty: fallbackActual,
            },
          );

          if (exactAmount <= 0 || exactQuantityUsed <= 0) continue;

          totalWIPMaterialsValue += exactAmount;

          trackWipConsumption(
            rawMaterialSku,
            exactQuantityUsed,
            cost.description || rawMaterialSku,
            "shared_cost",
          );

          queueStoreEntry({
            receive_date: transactionDate,
            po_no: "PRODUCTION",
            reference_number: postingReferenceNumber,
            batch_id: batchNo,
            qty_in: 0,
            qty_out: exactQuantityUsed, // quantity * qtyUse
            cost_price: unitCostValue, // Rate/Basis as cost
            inserted_by: createdBy,
            facilityId: facility_id,
            branch_name: "Work in Progress",
            destination: "Finished Goods",
            source: "Work in Progress",
            status: "approved",
            activation: "active",
            type: STORE_ENTRY_TYPE.CONSUMED,
            product_id: rawMaterialSku,
          });

          const wipAccount = await db.AccountCategory.findOne({
            where: { code: wipCode, facility_id },
            transaction,
          });
          if (!wipAccount) throw new Error(`WIP account not found: ${wipCode}`);

          ledgerEntries.push({
            account_code: wipAccount.code,
            dr: 0,
            cr: exactAmount,
            account_description: wipAccount.description,
            transaction_description: `${cost.description} - Shared Material Consumption`,
            type: "inventory",
            transaction_ref: wipCode,
          });
        } else if (type === "by_product_credit") {
          if (amt <= 0) continue;
          // Template by-product posts inventory + joint-pool transfer in section 2a.
          if (templateByProduct && typeof templateByProduct === "object") {
            continue;
          }
          // For by-product: amount * qtyUse
          const exactAmount = amt * qtyUseValue;
          totalByProductValue += exactAmount;
          const bpAccount = await db.AccountCategory.findOne({
            where: { code: descriptionCode, facility_id },
            transaction,
          });

          ledgerEntries.push({
            account_code: bpAccount.code,
            dr: exactAmount,
            cr: 0,
            account_description: bpAccount.description,
            transaction_description: "Shared By-Product Credit",
            type: "inventory",
            transaction_ref: descriptionCode,
          });
        } else if (type === "other") {
          if (amt <= 0) continue;
          // For other: amount * qtyUse
          const exactAmount = amt * qtyUseValue;
          totalExpensesApplied += exactAmount;
          const resolveAccountByCode = async (code) => {
            const cleanCode = normalizeAccountCode(code);
            if (!cleanCode) return null;
            return db.AccountCategory.findOne({
              where: { code: cleanCode, facility_id },
              transaction,
            });
          };

          // Shared-cost fallback: use business COGS/default expense code if provided in payload line.
          let expAccount = await resolveAccountByCode(descriptionCode);
          if (!expAccount) {
            // In shared mode there is no single product context; keep strict error if line code is invalid.
            throw new Error(`Expense account not found: ${descriptionCode}`);
          }

          ledgerEntries.push({
            account_code: expAccount.code,
            dr: 0,
            cr: exactAmount,
            account_description: expAccount.description,
            transaction_description:
              cost.description || "Shared Manufacturing Cost",
            type: "expenses",
            transaction_ref: descriptionCode,
          });
        }
      }
    }

    // ===================================================================
    // 2a. TEMPLATE BY-PRODUCT (associated costs + inventory receipt + store)
    // ===================================================================
    let totalTemplateByProductValue = 0;
    if (
      costingType === "joint_shared" &&
      templateByProduct &&
      typeof templateByProduct === "object"
    ) {
      const templateDeptId =
        templateByProduct.branchLocationId ??
        templateByProduct.branch_location_id ??
        departmentId ??
        null;
      const templateBranchId = resolvePostingBranchId(
        templateByProduct.branchLocationId,
        templateByProduct.branch_location_id,
        templateDeptId,
        defaultPostingBranchId,
      );
      const posting = computeTemplateByProductPostingAmounts(templateByProduct);
      const wipAccount = await db.AccountCategory.findOne({
        where: { code: wipCode, facility_id },
        transaction,
      });
      if (!wipAccount) throw new Error(`WIP account not found: ${wipCode}`);

      const resolvePostingAccount = async (code) => {
        const cleanCode = normalizeAccountCode(code);
        if (!cleanCode) return null;
        return db.AccountCategory.findOne({
          where: { code: cleanCode, facility_id },
          transaction,
        });
      };

      for (const line of posting.rawMaterialLines) {
        const sku = line.sku;
        if (!sku) {
          throw new Error(
            "Template by-product raw material line is missing SKU",
          );
        }

        totalWIPMaterialsValue += line.exactAmount;

        trackWipConsumption(
          sku,
          line.actualQty,
          line.item?.description || sku,
          "template_by_product",
        );

        queueStoreEntry({
          receive_date: transactionDate,
          po_no: "PRODUCTION",
          reference_number: postingReferenceNumber,
          batch_id: batchNo,
          qty_in: 0,
          qty_out: line.actualQty,
          cost_price: line.unitCost,
          inserted_by: createdBy,
          facilityId: facility_id,
          branch_name: "Work in Progress",
          destination: "By-Product",
          source: "Work in Progress",
          status: "approved",
          activation: "active",
          type: STORE_ENTRY_TYPE.CONSUMED,
          product_id: sku,
          departmentId: templateDeptId,
        });

        ledgerEntries.push({
          account_code: wipAccount.code,
          dr: 0,
          cr: line.exactAmount,
          account_description: wipAccount.description,
          transaction_description: `${line.item.description || sku} - Template By-Product Material`,
          type: "inventory",
          transaction_ref: sku,
        });
      }

      for (const line of posting.otherLines) {
        const descriptionCode = normalizeAccountCode(
          line.item.descriptionCode ||
            line.item.description_code ||
            line.item.accountHead ||
            line.item.account_head,
        );
        if (!descriptionCode) {
          throw new Error(
            `Template by-product line "${line.item.description || "other"}" is missing account code`,
          );
        }

        if (line.type === "by_product_credit") {
          continue;
        }

        totalExpensesApplied += line.lineBatch;
        const expAccount = await resolvePostingAccount(descriptionCode);
        if (!expAccount) {
          throw new Error(
            `Template by-product expense account not found: ${descriptionCode}`,
          );
        }
        ledgerEntries.push({
          account_code: expAccount.code,
          dr: 0,
          cr: line.lineBatch,
          account_description: expAccount.description,
          transaction_description:
            line.item.description || "Template By-Product Cost",
          type: "expenses",
          transaction_ref: descriptionCode,
        });
      }

      const bpSku = String(
        templateByProduct.productSku ||
          templateByProduct.item_code ||
          templateByProduct.product_sku ||
          "",
      ).trim();
      if (!bpSku) {
        throw new Error("Template by-product product SKU is required");
      }

      const bpProduct = await db.Product.findOne({
        where: { sku: bpSku, facility_id },
        attributes: [
          "name",
          "sku",
          "inventory_account",
          "cost_price",
          "selling_price",
          "mark_up",
          "markup_mode",
        ],
        transaction,
      });
      if (!bpProduct) {
        throw new Error(`Template by-product product not found: ${bpSku}`);
      }

      const invAccountCode = normalizeAccountCode(bpProduct.inventory_account);
      if (!invAccountCode) {
        throw new Error(
          `Template by-product inventory_account is missing for SKU: ${bpSku}`,
        );
      }

      const invAccount = await resolvePostingAccount(invAccountCode);
      if (!invAccount) {
        throw new Error(
          `Template by-product inventory account not found: ${invAccountCode}`,
        );
      }

      const totalCost = skipServerLedgerBuild
        ? Number((posting.units * posting.headerUnitCost).toFixed(2))
        : posting.inventoryReceiptTotal;
      if (totalCost > 0) {
        totalTemplateByProductValue = totalCost;
        totalByProductValue += totalCost;

        const unitCostPosted =
          posting.units > 0
            ? Number((totalCost / posting.units).toFixed(4))
            : posting.inventoryUnitCost;

        queueStoreEntry({
          receive_date: transactionDate,
          po_no: "PRODUCTION",
          reference_number: postingReferenceNumber,
          batch_id: batchNo,
          qty_in: posting.units,
          qty_out: 0,
          cost_price: unitCostPosted,
          selling_price:
            parseFloat(bpProduct.selling_price) || unitCostPosted,
          mark_up: parseFloat(bpProduct.mark_up) || 0,
          markup_mode: bpProduct.markup_mode || "percentage",
          inserted_by: createdBy,
          facilityId: facility_id,
          branch_name: SALES_STORE_BRANCH_NAME,
          branchId: templateBranchId,
          destination: "By-Product",
          source: "Production",
          status: "approved",
          activation: "active",
          type: STORE_ENTRY_TYPE.PRODUCTION,
          product_id: bpSku,
        });

        ledgerEntries.push({
          account_code: invAccount.code,
          dr: totalCost,
          cr: 0,
          account_description: invAccount.description,
          transaction_description: `${bpProduct.name || bpSku} - Template By-Product Receipt`,
          type: "inventory",
          transaction_ref: bpSku,
          branch_id: templateBranchId > 0 ? templateBranchId : null,
        });
      }
    }

    // ===================================================================
    // 2b. Recyclable store only (no waste GL — ingredients already consumed for waste qty)
    // ===================================================================
    let journalExtrasDebit = 0;
    let journalExtrasCredit = 0;
    let journalExtrasWipCredit = 0; // ALL WIP credits from client entries
    let wasteWipCredit = 0; // WIP credits that are WASTE offsets only
    let nonWasteExtrasDebit = 0;
    const wipClientNorm = normalizeAccountCode(wipCode);

    const findFgLineBySku = (skuWant) => {
      const want = String(skuWant || "").trim();
      if (!want) return null;
      for (const prod of products) {
        const fgLists = [];
        const fgMain = Array.isArray(prod.finishedGoods)
          ? prod.finishedGoods
          : prod.finishedGoods
            ? [prod.finishedGoods]
            : [];
        fgLists.push(fgMain);
        if (Array.isArray(prod.waste) && prod.waste.length > 0) {
          fgLists.push(prod.waste);
        } else if (prod.waste && typeof prod.waste === "object") {
          fgLists.push([prod.waste]);
        }
        for (const list of fgLists) {
          for (const fg of list) {
            if (String(fg.sku || "").trim() === want) return fg;
          }
        }
      }
      return null;
    };

    const allClientJournalEntries = [
      ...(clientJournalEntries || []),
      ...syntheticJournalEntries,
    ];

    for (const entry of allClientJournalEntries) {
      const normCode = normalizeAccountCode(entry.account_code);
      const dr = Number((parseFloat(entry.dr) || 0).toFixed(2));
      const cr = Number((parseFloat(entry.cr) || 0).toFixed(2));
      if (!normCode && dr === 0 && cr === 0) continue;

      const desc = String(entry.transaction_description || "");
      const isAbnormalLine = desc.includes("Abnormal waste");
      const isScrapLine = desc.includes("Recyclable scrap");

      // Abnormal/recyclable client lines are posted server-side from products[].waste — skip duplicates.
      if (isAbnormalLine || isScrapLine) {
        continue;
      }

      let account = normCode
        ? await db.AccountCategory.findOne({
            where: { code: normCode, facility_id },
            transaction,
          })
        : null;

      if (!account) {
        if (isAbnormalLine && normCode !== wipClientNorm) {
          account = await findAccountCategoryForFacility({
            facilityId: facility_id,
            code: normalizeAccountCode(bodyAbnormalLossAccount),
            descriptionCandidates: [],
            transaction,
          });
          if (!account && businessRow?.abnormal_loss_account) {
            account = await findAccountCategoryForFacility({
              facilityId: facility_id,
              code: normalizeAccountCode(businessRow.abnormal_loss_account),
              descriptionCandidates: [],
              transaction,
            });
          }
          if (!account) {
            account = await findAccountCategoryForFacility({
              facilityId: facility_id,
              code: null,
              descriptionCandidates: ["Abnormal Loss"],
              transaction,
            });
          }
        } else if (isScrapLine && normCode !== wipClientNorm) {
          account = await findAccountCategoryForFacility({
            facilityId: facility_id,
            code: normalizeAccountCode(
              bodyScrapInventoryAccount ||
                businessRow?.scrap_inventory_account ||
                normCode,
            ),
            descriptionCandidates: ["Scrap Inventory"],
            transaction,
          });
        } else if (normCode === wipClientNorm) {
          account = await db.AccountCategory.findOne({
            where: { code: wipClientNorm, facility_id },
            transaction,
          });
        }
      }

      if (!account) {
        throw new Error(
          normCode
            ? `Account not found for code: ${normCode}`
            : `Could not resolve account for journal line (${entry.transaction_description || "supplemental production"})`,
        );
      }

      const resolvedCode = normalizeAccountCode(account.code);

      let drUse = dr;
      let crUse = cr;
      if (isAbnormalLine) {
        const m = desc.match(/Abnormal waste -\s*(\S+)\s+Batch:/i);
        const skuJ = m?.[1];
        if (skuJ) {
          const fgHit = findFgLineBySku(skuJ);
          if (fgHit) {
            const wq =
              parseFloat(fgHit.wasteQuantity ?? fgHit.waste_quantity ?? 0) || 0;
            const cpuJ = parseFloat(fgHit.cost_per_unit || 0) || 0;
            let target = Number(
              (parseFloat(fgHit.waste_gl_amount || 0) || 0).toFixed(2),
            );
            if (target <= 0 && wq > 0 && cpuJ > 0) {
              target = Number((wq * cpuJ).toFixed(2));
            }
            if (wq > 1 && cpuJ > 0 && Math.abs(target - cpuJ) < 0.02) {
              target = Number((wq * cpuJ).toFixed(2));
            }
            if (target > 0) {
              if (dr > 0 && resolvedCode !== wipClientNorm) {
                drUse = target;
              }
              if (cr > 0 && resolvedCode === wipClientNorm) {
                crUse = target;
              }
            }
          }
        }
      }

      journalExtrasDebit += drUse;
      journalExtrasCredit += crUse;

      const isWasteWipCredit =
        (isAbnormalLine || isScrapLine) &&
        resolvedCode === wipClientNorm &&
        crUse > 0;

      if (resolvedCode === wipClientNorm && crUse > 0) {
        journalExtrasWipCredit += crUse;
      }
      if (isWasteWipCredit) {
        wasteWipCredit += crUse;
      }

      const isWasteDr =
        (isAbnormalLine || isScrapLine) &&
        drUse > 0 &&
        resolvedCode !== wipClientNorm;
      if (!isWasteDr) {
        nonWasteExtrasDebit += drUse;
      }

      const ledgerTarget = skipServerLedgerBuild
        ? supplementalLedgerEntries
        : ledgerEntries;

      ledgerTarget.push({
        account_code: account.code,
        dr: drUse,
        cr: crUse,
        account_description: account.description,
        transaction_description: entry.transaction_description || narration,
        type: entry.type || "expenses",
        transaction_ref: entry.transaction_ref || batchNo,
      });

      if (
        isScrapLine &&
        dr > 0 &&
        normCode !== wipClientNorm &&
        !(bodyRecyclableWasteStoreLines && bodyRecyclableWasteStoreLines.length)
      ) {
        const skuMatch = entry.transaction_description?.match(
          /Recyclable scrap - ([^\s]+) Batch:/,
        );
        const scrapSku = skuMatch?.[1] || null;

        let scrapQty = 0;
        if (scrapSku) {
          for (const prod of products) {
            const fgList = Array.isArray(prod.finishedGoods)
              ? prod.finishedGoods
              : prod.finishedGoods
                ? [prod.finishedGoods]
                : [];
            const wasteList = Array.isArray(prod.waste)
              ? prod.waste
              : prod.waste && typeof prod.waste === "object"
                ? [prod.waste]
                : [];
            for (const fg of [...fgList, ...wasteList]) {
              if (fg.sku === scrapSku) {
                scrapQty =
                  parseFloat(fg.wasteQuantity || 0) ||
                  Number((dr / (parseFloat(fg.cost_per_unit) || 1)).toFixed(4));
                break;
              }
            }
            if (scrapQty > 0) break;
          }
        }

        const scrapProduct = scrapSku
          ? await db.Product.findOne({
              where: { sku: scrapSku, facility_id },
              attributes: ["sku", "name"],
              transaction,
            })
          : null;

        if (scrapProduct && scrapQty > 0) {
          const byProductEntry = await db.Product.findOne({
            where: {
              inventory_account: resolvedCode,
              facility_id,
            },
            attributes: ["sku", "name"],
            transaction,
          });

          if (byProductEntry) {
            queueStoreEntry({
              receive_date: transactionDate,
              po_no: "PRODUCTION",
              reference_number: postingReferenceNumber,
              batch_id: batchNo,
              qty_in: scrapQty,
              qty_out: 0,
              cost_price: dr / (scrapQty || 1),
              selling_price: dr / (scrapQty || 1),
              mark_up: 0,
              markup_mode: "percentage",
              inserted_by: createdBy,
              facilityId: facility_id,
              branch_name: SALES_STORE_BRANCH_NAME,
              branchId: defaultPostingBranchId,
              destination: "By-Product",
              source: "Production",
              status: "approved",
              activation: "active",
              type: STORE_ENTRY_TYPE.PRODUCTION,
              product_id: byProductEntry.sku,
            });
          }
        }
      }
    }

    if (bodyRecyclableWasteStoreLines && bodyRecyclableWasteStoreLines.length) {
      for (const rw of bodyRecyclableWasteStoreLines) {
        const scrapSku = String(rw.scrap_sku || "").trim();
        const qty = parseFloat(rw.quantity || 0) || 0;
        const costTotal = Number(
          (parseFloat(rw.cost_amount || 0) || 0).toFixed(4),
        );
        if (!scrapSku || qty <= 0 || costTotal <= 0) continue;

        const scrapProduct = await db.Product.findOne({
          where: { sku: scrapSku, facility_id },
          attributes: ["sku", "name", "inventory_account"],
          transaction,
        });
        if (!scrapProduct) {
          throw new Error(
            `Recyclable waste: stock product not found for SKU ${scrapSku}`,
          );
        }

        const prodInv = normalizeAccountCode(
          scrapProduct.inventory_account || "",
        );
        const postedInv = normalizeAccountCode(rw.inventory_account_code || "");
        if (postedInv && prodInv && postedInv !== prodInv) {
          throw new Error(
            `Recyclable waste: posting account ${postedInv} does not match product ${scrapSku} inventory_account ${prodInv}.`,
          );
        }
        if (!prodInv) {
          throw new Error(
            `Recyclable waste: product ${scrapSku} has no inventory_account; cannot align GL and stock.`,
          );
        }

        const unitCost = Number((costTotal / qty).toFixed(4));
        const rwBranchId = resolvePostingBranchId(
          rw.branchLocationId,
          rw.branch_location_id,
          rw.branchId,
          departmentId,
          defaultPostingBranchId,
        );
        let sellingPrice = parseFloat(rw.selling_price);
        if (!Number.isFinite(sellingPrice) || sellingPrice < 0) {
          sellingPrice = unitCost;
        }
        const scrapMarkUpParsed = parseFloat(rw.mark_up);
        const markUpStored = Number.isFinite(scrapMarkUpParsed)
          ? scrapMarkUpParsed
          : 0;
        const modeRaw = String(rw.markup_mode || "percentage").toLowerCase();
        const markupModeStored = modeRaw === "fixed" ? "fixed" : "percentage";

        queueStoreEntry({
          receive_date: transactionDate,
          po_no: "PRODUCTION",
          reference_number: postingReferenceNumber,
          batch_id: batchNo,
          qty_in: qty,
          qty_out: 0,
          cost_price: unitCost,
          selling_price: sellingPrice,
          mark_up: markUpStored,
          markup_mode: markupModeStored,
          inserted_by: createdBy,
          facilityId: facility_id,
          branch_name: SALES_STORE_BRANCH_NAME,
          branchId: rwBranchId,
          destination: "By-Product",
          source: "Production",
          status: "approved",
          activation: "active",
          type: STORE_ENTRY_TYPE.PRODUCTION,
          product_id: scrapProduct.sku,
        });
      }
    }

    // ===================================================================
    // 3. BALANCING ENTRY (if needed) — or client preview ledger (joint_shared)
    // ===================================================================
    let balancingAmount = 0;
    let totalDebits = 0;
    let totalCreditsSoFar = 0;

    if (skipServerLedgerBuild) {
      const clientLedger = await resolveSharedCostingLedgerEntries(
        sharedCostingLedgerEntries,
      );
      ledgerEntries.length = 0;
      ledgerEntries.push(...clientLedger, ...supplementalLedgerEntries);

      const pennyAdjustCombinedLedger = (rows) => {
        let dr = rows.reduce((sum, row) => sum + (parseFloat(row.dr) || 0), 0);
        let cr = rows.reduce((sum, row) => sum + (parseFloat(row.cr) || 0), 0);
        let diff = Number((dr - cr).toFixed(2));
        if (Math.abs(diff) < 0.01) return;

        for (let i = rows.length - 1; i >= 0; i -= 1) {
          const row = rows[i];
          if (diff > 0 && parseFloat(row.dr) > 0) {
            row.dr = Number((parseFloat(row.dr) - diff).toFixed(2));
            return;
          }
          if (diff < 0 && parseFloat(row.cr) > 0) {
            row.cr = Number((parseFloat(row.cr) + diff).toFixed(2));
            return;
          }
        }
      };

      pennyAdjustCombinedLedger(ledgerEntries);

      const combinedDr = ledgerEntries.reduce(
        (sum, row) => sum + (parseFloat(row.dr) || 0),
        0,
      );
      const combinedCr = ledgerEntries.reduce(
        (sum, row) => sum + (parseFloat(row.cr) || 0),
        0,
      );
      if (Math.abs(combinedDr - combinedCr) >= 0.02) {
        throw new Error(
          `Shared costing ledger out of balance after supplemental entries (Dr ${combinedDr} vs Cr ${combinedCr})`,
        );
      }
      totalDebits = Number(combinedDr.toFixed(4));
      totalCreditsSoFar = Number(combinedCr.toFixed(4));
    } else {
      totalDebits = Number(
        (
          totalFGValue +
          totalWasteDebitValue +
          totalByProductValue +
          nonWasteExtrasDebit
        ).toFixed(4),
      );
      totalCreditsSoFar = Number(
        (
          totalWIPMaterialsValue +
          totalExpensesApplied +
          journalExtrasWipCredit -
          wasteWipCredit
        ).toFixed(4),
      );
      balancingAmount = Number((totalDebits - totalCreditsSoFar).toFixed(4));

      if (Math.abs(balancingAmount) >= 0.01) {
        const wipAccount = await db.AccountCategory.findOne({
          where: { code: wipCode, facility_id },
          transaction,
        });
        if (!wipAccount) throw new Error(`WIP account not found: ${wipCode}`);

        ledgerEntries.push({
          account_code: wipAccount.code,
          dr: balancingAmount < 0 ? Math.abs(balancingAmount) : 0,
          cr: balancingAmount > 0 ? balancingAmount : 0,
          account_description: wipAccount.description,
          transaction_description: "Production Completion - Balancing Transfer",
          type: "inventory",
          transaction_ref: wipCode,
        });
      }
    }

    // ===================================================================
    // 4. FINALIZE
    // ===================================================================
    await db.ProductionRecord.update(
      {
        status: "completed",
        completed_at: new Date(),
        production_ref: productionRef,
        data: JSON.stringify(req.body),
      },
      { where: { id: batchNo, facility_id }, transaction },
    );

    // Keep isolated tables in sync so completed batches no longer appear in draft queues.
    if (db.ProductionCostingRecord) {
      const resolvedBatchNo = batchId || batchNo;

      if (costingRecordId) {
        await db.ProductionCostingRecord.update(
          {
            status: "completed",
            data: JSON.stringify(req.body),
          },
          {
            where: {
              facility_id,
              id: costingRecordId,
              batch_no: resolvedBatchNo,
            },
            transaction,
          },
        );
      } else {
        const costingRowsToComplete = await db.ProductionCostingRecord.findAll({
          attributes: ["id"],
          where: { batch_no: resolvedBatchNo, facility_id },
          transaction,
        });
        const costingIds = costingRowsToComplete
          .map((row) => row.id)
          .filter(Boolean);

        await db.ProductionCostingRecord.update(
          {
            status: "completed",
            data: JSON.stringify(req.body),
          },
          {
            where: {
              id: costingIds.length ? { [Op.in]: costingIds } : batchNo,
              facility_id,
            },
            transaction,
          },
        );
      }
    }

    console.log(ledgerEntries);
    const ledgerRecords = ledgerEntries.map((e) => {
      const rawType = e.type;
      const glType =
        String(rawType || "").toLowerCase() === "production"
          ? "inventory"
          : rawType || "expenses";
      return {
        transaction_date: transactionDate,
        account_code: e.account_code,
        account_subhead: 0,
        dr: e.dr,
        cr: e.cr,
        account_description: e.account_description,
        transaction_description: e.transaction_description,
        reference_number: postingReferenceNumber,
        purpose_of_payment: narration,
        created_by: createdBy,
        facility_id,
        type: glType,
        transaction_ref: e.transaction_ref,
        branch_id: e.branch_id ?? null,
      };
    });

    // Hard balance check before posting to General Ledger
    const totalDr = Number(
      ledgerRecords
        .reduce((sum, row) => sum + (parseFloat(row.dr) || 0), 0)
        .toFixed(4),
    );
    const totalCr = Number(
      ledgerRecords
        .reduce((sum, row) => sum + (parseFloat(row.cr) || 0), 0)
        .toFixed(4),
    );
    const balanceDiff = Number((totalDr - totalCr).toFixed(4));

    if (Math.abs(balanceDiff) > 0.01) {
      throw new Error(
        `Journal not balanced for batch ${batchNo}: total debit (${totalDr}) does not equal total credit (${totalCr}). Difference: ${balanceDiff}`,
      );
    }

    // Block completion when requested material qty exceeds WIP on hand.
    await assertWipStockAvailable();

    await db.GeneralLedger.bulkCreate(ledgerRecords, { transaction });
    await Promise.all(
      pendingStoreEntries.map(({ data, options }) =>
        db.StoreEntry.create(data, options),
      ),
    );
    await transaction.commit();

    return res.json({
      success: true,
      message: "Production completed successfully",
      data: {
        production_ref: productionRef,
        batch_no: batchNo,
        finished_goods_value: totalFGValue,
        by_product_value: totalByProductValue,
        template_by_product_value: totalTemplateByProductValue,
        total_output_value: totalDebits,
        wip_materials_consumed: totalWIPMaterialsValue,
        expenses_applied: totalExpensesApplied,
        balancing_wip_transfer: balancingAmount,
        journal_balance_check: Number(
          (
            totalDebits -
            (totalCreditsSoFar +
              (balancingAmount > 0 ? balancingAmount : -balancingAmount))
          ).toFixed(4),
        ), // should be 0
      },
    });
  } catch (err) {
    console.error("Production Completion Error:", err);
    if (transaction) await transaction.rollback().catch(() => {});
    const statusCode =
      err.statusCode || (err.code === "INSUFFICIENT_STOCK" ? 400 : 500);
    return res.status(statusCode).json({
      success: false,
      message:
        statusCode === 400
          ? err.message
          : "Failed to complete production",
      error: err.message,
      code: err.code || undefined,
      details: err.details || undefined,
    });
  }
};

exports.getChartOfAccountsForFacility = async (req, res) => {
  try {
    const { facilityId } = req.params;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const accounts = await db.AccountCategory.findAll({
      where: { facilityId },
      order: [["code", "ASC"]],
    });

    return res.status(200).json({
      success: true,
      results: accounts,
      count: accounts.length,
    });
  } catch (error) {
    console.error("Error fetching chart of accounts:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching chart of accounts",
      error: error.message,
    });
  }
};

/**
 * Get reviewed memos with their items using ORM
 * Combines the functionality of:
 * - /account/get-memo/:facilityId/reviewed/:userId/re_list
 * - /account/memo-item-list
 *
 * @route GET /account/get-reviewed-memos-with-items/:facilityId/:userId
 * @param {string} facilityId - The facility ID
 * @param {string} userId - The user ID
 * @returns {Object} JSON response with memos and their associated items
 */
exports.getReviewedMemosWithItems = async (req, res) => {
  try {
    const { facilityId, userId } = req.params;
    const { dateFrom, dateTo, memo_id } = req.query;

    console.log("📥 Get Reviewed Memos With Items Request:", {
      facilityId,
      userId,
      dateFrom,
      dateTo,
      memo_id,
    });

    // Validate required parameters
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Build where clause for memos
    // We want to show all memos that are still usable for bills,
    // but hide memos that have already been fully processed/closed.
    const whereClause = {
      facilityId: facilityId,
      // Only approved memos may be converted to expense bills
      status: "approved",
    };

    // Add optional filters
    if (memo_id) {
      whereClause.memo_id = memo_id;
    }

    if (dateFrom && dateTo) {
      whereClause.date = {
        [Op.between]: [dateFrom, dateTo],
      };
    } else if (dateFrom) {
      whereClause.date = {
        [Op.gte]: dateFrom,
      };
    } else if (dateTo) {
      whereClause.date = {
        [Op.lte]: dateTo,
      };
    }

    // Fetch memos with their items and supplier using ORM
    const memos = await db.Memo.findAll({
      where: whereClause,
      include: [
        {
          model: db.ItemList,
          as: "items",
          required: false, // LEFT JOIN - include memos even without items
          attributes: [
            "item_list_id",
            "memo_id",
            "item_name",
            "description",
            "unit_cost",
            "quantity",
            "item_code",
            "item_subhead",
            // "createdAt",
          ],
        },
        {
          model: db.SuppliersInfo,
          as: "supplier",
          required: false, // LEFT JOIN - include memos even without supplier
          attributes: ["supplier_name", "supplier_number"],
          where: { facilityId }, // Match facility for composite key
        },
      ],
      attributes: [
        "from_name",
        "date",
        "purpose",
        "memo_id",
        "amount",
        "remark",
        "status",
        "facilityId",
        "raise_by",
        "user_id",
        "subject",
        "details",
        "recipient",
        "description",
        "total",
        "pr_no",
        "reference_number",
        "priority",
        "supplier_name",
        "supplier_code",
        "supplier_number",
        "createdAt",
        // "updatedAt",
      ],
      order: [["date", "DESC"]],
    });
    // Transform the data to include item count, total item cost, and supplier
    const memosWithMetadata = memos.map((memo) => {
      const memoData = memo.toJSON();
      const items = memoData.items || [];
      const supplier = memoData.supplier;

      // Use supplier_name from joined supplier or from memo
      const supplier_name =
        memoData.supplier_name || (supplier && supplier.supplier_name) || null;

      // Calculate total item cost
      const totalItemCost = items.reduce((sum, item) => {
        return (
          sum + parseFloat(item.unit_cost || 0) * parseInt(item.quantity || 1)
        );
      }, 0);

      const { supplier: _s, ...rest } = memoData;
      return {
        ...rest,
        supplier_name,
        item_count: items.length,
        total_item_cost: totalItemCost.toFixed(2),
      };
    });

    console.log(`✅ Found ${memos.length} reviewed memos with items`);

    res.json({
      success: true,
      count: memos.length,
      results: memosWithMetadata,
    });
  } catch (err) {
    console.error("❌ Error in getReviewedMemosWithItems:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch reviewed memos with items",
      error: err.message,
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
    });
  }
};

/**
 * Close a memo by updating its status to "closed"
 * Used when a reviewed memo has been fully processed (e.g. converted to an expense)
 *
 * @route POST /account/close-memo
 * @body {string} memo_id     - The memo ID
 * @body {string} facilityId  - The facility ID
 * @body {string} [user_id]   - The user performing the action (optional, for logging)
 */
exports.closeMemo = async (req, res) => {
  try {
    const { memo_id, facilityId } = req.body;

    if (!memo_id || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "memo_id and facilityId are required",
      });
    }

    const [affectedCount] = await db.Memo.update(
      { status: "closed" },
      {
        where: {
          memo_id,
          facilityId,
        },
      },
    );

    if (affectedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Memo not found or already closed",
      });
    }

    return res.json({
      success: true,
      message: "Memo closed successfully",
    });
  } catch (error) {
    console.error("❌ Error closing memo:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to close memo",
      error: error.message,
    });
  }
};
/**
 * Get approved purchase requisitions with their items using ORM
 * Combines the functionality of:
 * - /account/get-purchase-requisition (query_type: 'select-grn')
 * - /account/purchase/getPr (query_type: 'select-exp')
 *
 * @route GET /account/get-approved-prs-with-items/:facilityId/:userId
 * @param {string} facilityId - The facility ID
 * @param {string} userId - The user ID (optional, for filtering)
 * @returns {Object} JSON response with purchase requisitions and their associated items
 */
exports.getApprovedPRsWithItems = async (req, res) => {
  try {
    const { facilityId, userId } = req.params;
    const { dateFrom, dateTo, pr_no } = req.query;

    console.log("📥 Get Approved PRs With Items Request:", {
      facilityId,
      userId,
      dateFrom,
      dateTo,
      pr_no,
    });

    // Validate required parameters
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Build where clause for purchase requisitions
    const whereClause = {
      facilityId: facilityId,
      status: "Approved",
    };

    // Add optional filters
    if (pr_no) {
      whereClause.pr_no = pr_no;
    }

    if (dateFrom && dateTo) {
      whereClause.date = {
        [Op.between]: [dateFrom, dateTo],
      };
    } else if (dateFrom) {
      whereClause.date = {
        [Op.gte]: dateFrom,
      };
    } else if (dateTo) {
      whereClause.date = {
        [Op.lte]: dateTo,
      };
    }

    // Fetch purchase requisitions with their items using ORM
    const prs = await db.PurchaseRequisition.findAll({
      where: whereClause,
      include: [
        {
          model: db.RequisitionDetail,
          as: "requisition_details",
          required: false, // LEFT JOIN - include PRs even without items
          include: [
            {
              model: db.Product,
              as: "product",
              required: false,
              attributes: [
                "name",
                "sku",
                "inventory_account",
                "unit_of_measure",
                "cogs_head",
                "revenue_account",
              ],
            },
          ],
          attributes: [
            "id",
            "pr_no",
            "item_code",
            "item_name",
            "chart_code",
            "est_cost",
            "unit_category",
            "unit_measure",
            "quantity",
            "approved_qty",
            "created_at",
          ],
        },
      ],
      attributes: [
        "pr_no",
        "po_no",
        "memo_id",
        "requisitor",
        "branch",
        "branch_id",
        "user_id",
        "reason",
        "supplier_name",
        "supplier_code",
        "account_code",
        "status",
        "amount",
        "total",
        "date",
        "facilityId",
        "created_at",
      ],
      order: [["date", "DESC"]],
    });

    // Transform the data to include item count and total item cost
    const prsWithMetadata = prs.map((pr) => {
      const prData = pr.toJSON();
      const items = prData.requisition_details || [];

      // Map items to include product information and rename for consistency
      const mappedItems = items.map((item) => ({
        id: item.id,
        item_code: item.item_code,
        item_name: item.product?.name || item.item_name,
        quantity: item.approved_qty ?? item.quantity,
        requested_qty: item.quantity,
        approved_qty: item.approved_qty,
        unit_measure: item.unit_measure,
        unit_cost: item.est_cost,
        inventory_account: item.product?.inventory_account,
        uom: item.product?.unit_of_measure,
        cogs_head: item.product?.cogs_head,
        revenue_account: item.product?.revenue_account,
      }));

      // Calculate total item cost
      const totalItemCost = mappedItems.reduce((sum, item) => {
        return (
          sum + parseFloat(item.unit_cost || 0) * parseInt(item.quantity || 1)
        );
      }, 0);

      return {
        ...prData,
        items: mappedItems,
        item_count: mappedItems.length,
        total_item_cost: totalItemCost.toFixed(2),
        // Remove the requisition_details key to avoid duplication
        requisition_details: undefined,
      };
    });

    console.log(`✅ Found ${prs.length} approved PRs with items`);

    res.json({
      success: true,
      count: prs.length,
      results: prsWithMetadata,
    });
  } catch (err) {
    console.error("❌ Error in getApprovedPRsWithItems:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch approved PRs with items",
      error: err.message,
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
    });
  }
};

/** Update a purchase requisition's status (e.g. dismiss it from the billing drawer). */
/**
 * Retroactively apply an existing supplier advance to a bill that was saved
 * without the settlement running (e.g., PB-75 created before the getBalance fix).
 * POST /account/apply-advance-to-bill
 * body: { invoice_ref, facilityId }
 */
exports.applyAdvanceToBill = async (req, res) => {
  const { invoice_ref, facilityId } = req.body;
  if (!invoice_ref || !facilityId)
    return res.status(400).json({ success: false, message: "invoice_ref and facilityId are required" });

  let t;
  try {
    t = await db.sequelize.transaction();

    // 1. Load the invoice
    const invoice = await db.Invoice.findOne({
      where: { invoice_ref, facility_id: facilityId, type: "purchase" },
      transaction: t,
    });
    if (!invoice) {
      await t.rollback();
      return res.status(404).json({ success: false, message: `Invoice ${invoice_ref} not found` });
    }

    const billAmount = parseFloat(invoice.amount || 0);
    const supplierNo = invoice.ref_number;

    // 2. Check if a payment GL entry already exists for this invoice (already settled)
    const existingPayment = await db.sequelize.query(
      `SELECT SUM(CASE WHEN type='bank' THEN cr WHEN type='payment' THEN dr ELSE 0 END) AS total_paid
       FROM general_ledger
       WHERE type IN ('bank','payment') AND facility_id = :facilityId AND reference_number = :invoice_ref`,
      { replacements: { facilityId, invoice_ref }, type: db.sequelize.QueryTypes.SELECT, transaction: t },
    );
    const alreadyPaid = parseFloat(existingPayment[0]?.total_paid || 0);
    if (alreadyPaid >= billAmount) {
      await t.rollback();
      return res.json({ success: false, message: `${invoice_ref} is already fully paid (total_paid=${alreadyPaid})` });
    }

    const remaining = billAmount - alreadyPaid;

    // 3. Get current supplier advance balance (negative = advance available)
    const currentBalance = parseFloat(await getBalance(supplierNo, facilityId)) || 0;
    if (currentBalance >= 0) {
      await t.rollback();
      return res.json({ success: false, message: `No advance available for supplier ${supplierNo}. Balance=${currentBalance}` });
    }

    const availableAdvance = Math.abs(currentBalance);
    const settleAmount = Math.min(remaining, availableAdvance);
    if (settleAmount <= 0) {
      await t.rollback();
      return res.json({ success: false, message: "Nothing to settle" });
    }

    // 4. Get supplier's payable and advance accounts
    const supplier = await db.SuppliersInfo.findOne({
      where: { supplier_number: supplierNo, facilityId },
      transaction: t,
    });
    if (!supplier) throw new Error(`Supplier not found: ${supplierNo}`);

    const payableCode = supplier.payable_code;
    const accrualCode = supplier.payable_accural_code || supplier.payable_accrual_code;
    if (!payableCode || !accrualCode) throw new Error("Supplier missing payable_code or payable_accrual_code");

    const [payableAccount, advanceAccount] = await Promise.all([
      db.AccountCategory.findOne({ where: { code: payableCode, facility_id: facilityId }, transaction: t }),
      db.AccountCategory.findOne({ where: { code: accrualCode, facility_id: facilityId }, transaction: t }),
    ]);
    if (!payableAccount) throw new Error(`Payable account not found: ${payableCode}`);
    if (!advanceAccount) throw new Error(`Advance account not found: ${accrualCode}`);

    const today = moment().format("YYYY-MM-DD");

    // 5. Dr Payable (close the bill using advance)
    await db.GeneralLedger.create({
      transaction_date: invoice.transaction_date || today,
      account_code: payableAccount.code,
      account_subhead: payableAccount.parent_code || 0,
      dr: settleAmount,
      cr: 0,
      account_description: payableAccount.description,
      transaction_description: `Advance applied to ${invoice_ref}`,
      reference_number: invoice_ref,
      purpose_of_payment: `Advance settlement - ${invoice_ref}`,
      payee: supplier.supplier_name || supplierNo,
      created_by: invoice.created_by || invoice.user_id,
      facility_id: facilityId,
      status: "paid",
      type: "payment",
      transaction_ref: supplierNo,
    }, { transaction: t });

    // 6. Cr Advance Account (reduce advance balance)
    await db.GeneralLedger.create({
      transaction_date: invoice.transaction_date || today,
      account_code: advanceAccount.code,
      account_subhead: advanceAccount.parent_code || 0,
      dr: 0,
      cr: settleAmount,
      account_description: advanceAccount.description,
      transaction_description: `Advance consumed for ${invoice_ref}`,
      reference_number: invoice_ref,
      purpose_of_payment: `Advance settlement - ${invoice_ref}`,
      payee: supplier.supplier_name || supplierNo,
      created_by: invoice.created_by || invoice.user_id,
      facility_id: facilityId,
      status: "paid",
      type: "accrued",
      transaction_ref: supplierNo,
    }, { transaction: t });

    await t.commit();

    await recordActivity({
      facilityId,
      userId: pickActor(req) || invoice.created_by || invoice.user_id,
      action: "apply",
      entityType: "supplier_advance",
      entityId: invoice_ref,
      entityLabel: supplier.supplier_name || supplierNo,
      after: {
        invoice_ref,
        settled_amount: settleAmount,
        remaining_payable: Math.max(0, remaining - settleAmount),
        supplier_number: supplierNo,
      },
      remark: `Advance applied to ${invoice_ref}`,
    });

    return res.json({
      success: true,
      message: `Advance of ₦${settleAmount.toLocaleString()} successfully applied to ${invoice_ref}`,
      invoice_ref,
      settled_amount: settleAmount,
      remaining_payable: Math.max(0, remaining - settleAmount),
    });
  } catch (err) {
    if (t) await t.rollback().catch(() => {});
    console.error("applyAdvanceToBill:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.updatePRStatus = async (req, res) => {
  try {
    const { pr_no, status, facilityId } = req.body;
    if (!pr_no || !status || !facilityId) {
      return res
        .status(400)
        .json({
          success: false,
          message: "pr_no, status and facilityId are required",
        });
    }
    const allowed = [
      "Approved",
      "Pending",
      "Dismissed",
      "Converted",
      "Cancelled",
      "Draft",
    ];
    if (!allowed.includes(status)) {
      return res
        .status(400)
        .json({
          success: false,
          message: `Invalid status. Allowed: ${allowed.join(", ")}`,
        });
    }
    const existing = await db.PurchaseRequisition.findOne({
      where: { pr_no, facilityId },
    });
    const [updated] = await db.PurchaseRequisition.update(
      { status },
      { where: { pr_no, facilityId } },
    );
    if (updated === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Purchase requisition not found" });
    }
    await recordActivity({
      facilityId,
      userId: pickActor(req),
      action: "status_change",
      entityType: "purchase_requisition",
      entityId: pr_no,
      entityLabel: pr_no,
      before: { status: existing?.status },
      after: { status },
      remark: `PR status updated to ${status}`,
    });
    return res.json({
      success: true,
      message: `PR ${pr_no} status updated to ${status}`,
    });
  } catch (err) {
    console.error("updatePRStatus:", err);
    return res
      .status(500)
      .json({
        success: false,
        message: "Failed to update PR status",
        error: err.message,
      });
  }
};

exports.creatAccHead = (req, res) => {
  const { head, subHead, description, facilityId, price } = req.body;
  // console.log(head, subHead, description)
  const stmt =
    "call new_acc_head(:head,:subHead,:description,:balance,:facilityId,:price)";
  db.sequelize
    .query(stmt, {
      replacements: {
        head,
        subHead,
        description,
        balance: 0,
        facilityId,
        price: price ? price : "",
      },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

const handleTran = async (arr = [], facilityId, insertedBy = "System") => {
  if (!facilityId) {
    throw new Error("facilityId is required");
  }
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error("No transfer items supplied");
  }

  const resolveBranchId = async (branchName, explicitId, transaction) => {
    const parsed = parseInt(explicitId, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    if (!branchName) return 0;
    const branch = await db.Branch.findOne({
      where: { branch_name: branchName, facilityId },
      attributes: ["id"],
      transaction,
    });
    return branch?.id || 0;
  };

  const getInventoryBranchName = async (productSku, branchId, transaction) => {
    if (!branchId) return "for sales";
    const existing = await db.StoreEntry.findOne({
      where: {
        facilityId,
        product_id: productSku,
        branchId,
      },
      attributes: ["branch_name"],
      order: [["id", "DESC"]],
      transaction,
    });
    return existing?.branch_name || "for sales";
  };

  const getBranchStockBalance = async (productSku, branchId, transaction) => {
    if (!branchId) return 0;
    const rows = await db.sequelize.query(
      `SELECT COALESCE(SUM(qty_in), 0) - COALESCE(SUM(qty_out), 0) AS balance
       FROM store_entries
       WHERE facilityId = :facilityId
         AND product_id = :productSku
         AND branchId = :branchId`,
      {
        replacements: { facilityId, productSku, branchId },
        type: QueryTypes.SELECT,
        transaction,
      },
    );
    return parseFloat(rows[0]?.balance || 0);
  };

  const transaction = await db.sequelize.transaction();

  try {
    const today = moment().format("YYYY-MM-DD");

    for (const row of arr) {
      const {
        storeFrom = "",
        storeTo = "",
        quantity = 0,
        item_name = "",
        product_id = "",
        supplier_code = "",
        price = 0,
        cost = 0,
        markup = 0.1,
        expiry_date = "1111-11-11",
        branchFromId = 0,
        branchToId = 0,
      } = row;

      const qty = parseFloat(quantity) || 0;
      if (!storeFrom || !storeTo) {
        throw new Error("storeFrom and storeTo are required");
      }
      if (storeFrom === storeTo) {
        throw new Error("Source and destination locations must differ");
      }
      if (qty <= 0) {
        throw new Error("Transfer quantity must be greater than zero");
      }

      const skuCandidates = [product_id, item_name, supplier_code]
        .map((v) => String(v || "").trim())
        .filter(Boolean);

      let product = null;
      let sku = "";
      for (const candidate of skuCandidates) {
        product = await db.Product.findOne({
          where: { sku: candidate, facility_id: facilityId },
          attributes: ["sku", "name", "cost_price", "selling_price"],
          transaction,
        });
        if (product) {
          sku = product.sku;
          break;
        }
      }
      if (!product) {
        throw new Error(
          `Product not found: ${skuCandidates[0] || "unknown item"}`,
        );
      }

      const fromBranchId = await resolveBranchId(
        storeFrom,
        branchFromId,
        transaction,
      );
      const toBranchId = await resolveBranchId(
        storeTo,
        branchToId,
        transaction,
      );

      if (!fromBranchId) {
        throw new Error(`Unknown source branch: ${storeFrom}`);
      }
      if (!toBranchId) {
        throw new Error(`Unknown destination branch: ${storeTo}`);
      }

      const available = await getBranchStockBalance(
        sku,
        fromBranchId,
        transaction,
      );
      if (qty > available + 0.0001) {
        throw new Error(
          `${product.name || sku}: transfer qty (${qty}) exceeds available (${available}) at ${storeFrom}`,
        );
      }

      const fromInventoryBranch = await getInventoryBranchName(
        sku,
        fromBranchId,
        transaction,
      );
      const toInventoryBranch = await getInventoryBranchName(
        sku,
        toBranchId,
        transaction,
      );

      const transferRef = `TRF/${moment().format("YY")}/${UUIDV4()
        .slice(0, 8)
        .toUpperCase()}`;
      const parsedExpiry =
        !expiry_date ||
        expiry_date === "0000-00-00" ||
        expiry_date === "1111-11-11"
          ? null
          : moment(expiry_date).format("YYYY-MM-DD");
      const costPrice = parseFloat(cost) || parseFloat(product.cost_price) || 0;
      const sellingPrice =
        parseFloat(price) || parseFloat(product.selling_price) || 0;
      const markUp = parseFloat(markup) || 0.1;
      const narration = `Transferred from ${storeFrom} to ${storeTo}`;
      const baseEntry = {
        receive_date: today,
        reference_number: transferRef,
        cost_price: costPrice,
        selling_price: sellingPrice,
        mark_up: markUp,
        markup_mode: "percentage",
        inserted_by: insertedBy,
        facilityId,
        expiry_date: parsedExpiry,
        location: "Warehouse",
        truckNo: "",
        waybillNo: "",
        supplier_code: sku,
        multple: "1",
        batch_id: null,
        multiplier_id: null,
      };

      await db.StoreEntry.create(
        {
          ...baseEntry,
          product_id: sku,
          qty_in: 0,
          qty_out: qty,
          branch_name: fromInventoryBranch,
          branchId: fromBranchId,
          source: storeFrom,
          destination: storeTo,
          status: "Active",
          type: STORE_ENTRY_TYPE.TRANSFER,
        },
        { transaction },
      );

      await db.StoreEntry.create(
        {
          ...baseEntry,
          product_id: sku,
          qty_in: qty,
          qty_out: 0,
          branch_name: toInventoryBranch,
          branchId: toBranchId,
          source: storeFrom,
          destination: storeTo,
          status: "Active",
          type: STORE_ENTRY_TYPE.TRANSFER,
          supplier_code: narration,
        },
        { transaction },
      );
    }

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

exports.goodTransfer = async (req, res) => {
  try {
    const { facilityId, data } = req.body;
    const insertedBy =
      req.user?.fullname || req.user?.username || req.user?.id || "System";

    await handleTran(data, facilityId, insertedBy);
    return res.json({
      status: true,
      message: "Transfer completed successfully",
    });
  } catch (err) {
    console.error("goodTransfer error:", err);
    return res.status(500).json({
      status: false,
      message: err.message || "Transfer failed",
      err: err.message,
    });
  }
};

exports.getLogs = (req, res) => {
  const { id, facilityId } = req.query;

  db.sequelize
    .query(
      `SELECT * FROM logs WHERE id_link = :id AND facilityId = :facilityId`,
      {
        replacements: { id, facilityId },
        type: QueryTypes.SELECT, // 👈 only return rows
      },
    )
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getSignature = (req, res) => {
  const { user_id } = req.query;

  db.sequelize
    .query(`SELECT signature FROM users WHERE id = :user_id`, {
      replacements: { user_id },
      type: QueryTypes.SELECT, // 👈 only return rows
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getLogMemo = (req, res) => {
  const { id, facilityId } = req.query;
  console.log(id);
  db.sequelize
    .query(
      `SELECT * FROM logs WHERE status IN ("approved", "Review") AND id_link =:id and and facilityId=:facilityId`,
      {
        replacements: {
          id,
          facilityId,
        },
      },
    )
    .then((results) => {
      res.json({ success: true, results: results });
    })
    .catch((err) => res.status(500).json({ err }));
};

exports.getSupplierStatement = (req, res) => {
  const { id, dateFrom, dateTo } = req.params;
  const stmt = "call get_supplierr_statement(:id,:dateFrom,:dateTo)";
  db.sequelize
    .query(stmt, {
      replacements: {
        id,
        dateFrom,
        dateTo,
      },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

// Get supplier balance from general ledger using transaction_ref
exports.getSupplierBalanceFromLedger = async (req, res) => {
  try {
    const { supplierNo, facilityId } = req.params;

    if (!supplierNo || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "supplierNo and facilityId are required",
      });
    }

    const result = await db.sequelize.query(
      `SELECT
        transaction_ref AS supplier_number,
        SUM(cr) - SUM(dr) AS balance
      FROM general_ledger
      WHERE type in ('payable', 'payment','accrued')
        AND facility_id = :facilityId
        AND transaction_ref = :supplierNo
      GROUP BY transaction_ref`,
      {
        replacements: { supplierNo, facilityId },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );

    const balance = result.length > 0 ? parseFloat(result[0].balance || 0) : 0;

    return res.status(200).json({
      success: true,
      balance: balance,
      supplier_number: supplierNo,
    });
  } catch (error) {
    console.error("Error getting supplier balance from ledger:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get customer balance from general ledger using transaction_ref
exports.getCustomerBalanceFromLedger = async (req, res) => {
  try {
    const { customerNo, facilityId } = req.params;

    if (!customerNo || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "customerNo and facilityId are required",
      });
    }

    const result = await db.sequelize.query(
      `SELECT
        SUM(cr) - SUM(dr) AS balance
      FROM general_ledger
      WHERE LOWER(type) IN ('receivable', 'recevable', 'deposit')
        AND facility_id = :facilityId
        AND transaction_ref = :customerNo
      GROUP BY transaction_ref`,
      {
        replacements: { customerNo, facilityId },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );

    const balance = result.length > 0 ? parseFloat(result[0].balance || 0) : 0;

    return res.status(200).json({
      success: true,
      balance: balance,
      customer_number: customerNo,
    });
  } catch (error) {
    console.error("Error getting customer balance from ledger:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.getAccountStatement = (req, res) => {
  const { id, dateFrom, dateTo } = req.params;
  // console.log(head, subHead, description)
  const stmt = "call get_supplierr_statement(:id,:dateFrom,:dateTo)";
  db.sequelize
    .query(stmt, {
      replacements: {
        id,
        dateFrom,
        dateTo,
      },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};
exports.getAccHead = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query("call get_all_acc_heads(:facilityId)", {
      replacements: { facilityId },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};
exports.getReceipt = (req, res) => {
  const { from, to, facilityId } = req.query;
  db.sequelize
    .query("call get_receipt_no(:facilityId,:from_date,:to_date)", {
      replacements: {
        facilityId: facilityId,
        from_date: from,
        to_date: to,
      },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};
exports.generate_item_code = (req, res) => {
  const { facilityId, description } = req.params;
  db.sequelize
    .query("call generate_item_code(:facilityId,:description)", {
      replacements: {
        facilityId,
        description,
      },
    })
    .then((results) => {
      let item_code = results.length && results[0].item_code;
      res.json({ item_code });
    })
    .catch((err) => res.status(500).json({ err }));
};

exports.getRevAccHeads = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query("call get_rev_acc_heads(:facilityId)", {
      replacements: { facilityId },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getDepositAccHead = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query("call get_deposit_acc_head(:facilityId)", {
      replacements: { facilityId },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getExpensesAccHead = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query("call get_expenses_acc_heads(:facilityId)", {
      replacements: { facilityId },
    })
    .then((results) => {
      // let expensesHeads = [];
      // for (let i = 0; i < results.length; i++) {
      //   expensesHeads.push(results[i].head);
      // }
      res.json({ success: true, results });
    })
    .catch((err) => res.status(500).json({ success: false, err }));
};

exports.transfer = (req, res) => {
  const { from, to, amount, comment, facilityId } = req.body;
  db.sequelize
    .query("call transfer(:from,:to,:amount,:comment,:facilityId)", {
      replacements: { from, to, amount, comment, facilityId },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};
exports.moveMoneyToPettyCash = (req, res) => {
  console.log(req.body);
  const {
    amount,
    facilityId,
    userId,
    receiptno,
    receiptsn,
    from,
    to,
    descr,
    recipient,
  } = req.body;
  db.sequelize
    .query(
      "call move_money(:amount,:userId,:facilityId,:receiptno,:receiptsn,:date,:descr,:fromAcc,:toAcc)",
      {
        replacements: {
          userId,
          amount,
          facilityId,
          receiptno,
          receiptsn,
          date: moment().format("YYYY-MM-DD hh:mm:ss"),
          descr,
          fromAcc: from,
          toAcc: to,
          recipient,
        },
      },
    )
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};
exports.getTotalSalesByUser = (req, res) => {
  const { userId, facilityId } = req.params;
  const {} = req.params;
  const today = moment().format("YYYY-MM-DD");
  db.sequelize
    .query("call get_total_sales(:userId, :today, :facilityId)", {
      replacements: { userId, today, facilityId },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getAmountReceived = (req, res) => {
  const { userId, facilityId } = req.params;
  const today = moment().format("YYYY-MM-DD");
  db.sequelize
    .query("call get_amount_received(:userId, :today, :facilityId)", {
      replacements: { userId, today, facilityId },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getAmountHandedOver = (req, res) => {
  const { userId, facilityId } = req.params;
  const today = moment().format("YYYY-MM-DD");
  db.sequelize
    .query("call get_amount_handed_over(:userId, :today, :facilityId)", {
      replacements: { userId, today, facilityId },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getAccChart = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query("call get_acc_chart(:facilityId)", {
      replacements: { facilityId },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => {
      console.log(err);
      res.status(500).json({ err });
    });
};

exports.getChartDescendant = (req, res) => {
  const { store, code } = req.params;
  db.sequelize
    .query("call get_chart_descendant(:store, :code)", {
      replacements: { store, code },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => {
      console.log(err);
      res.status(500).json({ err });
    });
};

exports.updateClientAcc = (req, res) => {
  const { facilityId, amount, accNo } = req.body;
  db.sequelize
    .query("CALL update_client_account(:accNo,:amount,:facilityId)", {
      replacements: {
        amount,
        accNo,
        facilityId,
      },
    })
    .then((results1) => {
      res.json({ success: true, results1 });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};

exports.updatePurchaseStatus = (req, res) => {
  console.log(req.body);
  const { PONo } = req.body.formTitle;
  const { rawData, supplier_info } = req.body;
  console.log(req.body);
  db.sequelize
    .query(
      `call purchase_status_update(:status,:po_id,:processed_by,:supplier)`,
      {
        replacements: {
          status: "Disburse",
          po_id: PONo,
          processed_by: req.body.userId,
          supplier: supplier_info,
        },
      },
    )
    .then(
      rawData.forEach((item) => {
        db.sequelize.query(
          "CALL new_expense(:facId,:description,:source,:destination,:receiptsn,:receiptno,:payment_mode,:userId,:amount,:client_acct,:in_date, :transaction_type, :batch_narration)",
          {
            replacements: {
              amount: item.amount,
              description: item.description,
              source: item.source,
              userId: item.userId,
              receiptsn: item.receiptsn,
              receiptno: item.receiptno,
              payment_mode: item.modeOfPayment,
              destination: item.destination,
              facId: item.facilityId,
              client_acct: item.collectedBy,
              in_date: moment().format("YYYY-MM-DD hh:mm:ss"),
              transaction_type: "Purchase Order Payment",
              batch_narration: item.batchNarration ? item.batchNarration : "",
            },
          },
        );
      }),
    )
    .then((results1) => {
      res.json({ success: true, results1 });
      // db.sequelize.query('')
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getDrugCountWithoutAStore = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT drug, cost_price, markUp, cost_price + markUp as price,(cost_price + markUp) * dispensary_balance as amount_in_shelf,
      dispensary_balance as quantity_in_shelf,expiry_date FROM drugpurchaserecords WHERE facilityId="${facilityId}"`,
    )
    .then((results) => {
      db.sequelize
        .query(
          `SELECT SUM((cost_price + markUp) * quantity) AS totalamountinshelf
            FROM drugpurchaserecords WHERE facilityId="${facilityId}"`,
        )
        .then((resp) => {
          res.json({
            success: true,
            results: { data: results[0], total: resp[0][0] },
          });
        })
        .catch((err) => res.json({ success: false, err }));
    })
    .catch((err) => res.json({ success: false, err }));
};

exports.getFactoryInventory = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT drug, sum(qty_in - qty_out) as quantity_in_shelf
        FROM drugs where source='dispensary' AND facilityId="${facilityId}"
        GROUP BY drug`,
    )
    .then((results) => {
      db.sequelize
        .query(
          `SELECT SUM(qty_in - qty_out) AS totalquantity
            FROM drugs WHERE source='dispensary' AND facilityId="${facilityId}"`,
        )
        .then((resp) => {
          res.json({
            success: true,
            results: { data: results[0], total: resp[0][0] },
          });
        })
        .catch((err) => res.json({ success: false, err }));
    })
    .catch((err) => res.json({ success: false, err }));
};

exports.getOverviewWithoutStore = (req, res) => {
  const { from, to, facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT * FROM overview_wo_store WHERE facilityId="${facilityId}" AND
        date(created_at) BETWEEN date("${from}") AND date("${to}")`,
    )
    .then((results) => {
      db.sequelize
        .query(
          `SELECT SUM(amount_in_shelf) AS totalamountinshelf,
            sum(amount_sold) as totalamountsold
            FROM overview_wo_store WHERE facilityId="${facilityId}" AND
            date(created_at) BETWEEN date("${from}") AND date("${to}")`,
        )
        .then((resp) => {
          res.json({
            success: true,
            results: { data: results[0], totals: resp[0][0] },
          });
        })
        .catch((err) => res.json({ success: false, err }));
    })
    .catch((err) => res.json({ success: false, err }));
};

exports.getOverview = (req, res) => {
  const { from, to, facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT *,sum(amount_bought) as totalamountbought,sum(amount_in_store) as totalamountinstore,
        sum(amount_in_shelf) as totalamountinshelf,sum(amount_sold) as totalamountsold FROM overview
        WHERE facilityId="${facilityId}" AND ((purchase_date BETWEEN date("${from}") AND date("${to}")) OR
        (sales_date BETWEEN date("${from}") AND date("${to}"))) GROUP BY drug`,
    )
    .then((results) => {
      db.sequelize
        .query(
          `SELECT sum(amount_bought) as totalamountbought,sum(amount_in_store) as totalamountinstore,
            sum(amount_in_shelf) as totalamountinshelf,sum(amount_sold) as totalamountsold FROM overview
            WHERE facilityId="${facilityId}" AND ((purchase_date BETWEEN date("${from}") AND date("${to}")) OR
            (sales_date BETWEEN date("${from}") AND date("${to}")))`,
        )
        .then((resp) => {
          res.json({
            success: true,
            results: { data: results[0], totals: resp[0] },
          });
        })
        .catch((err) => res.json({ success: false, err }));
    })
    .catch((err) => res.json({ success: false, err }));
};

exports.getExpenses = (req, res) => {
  const { from, to, facilityId } = req.params;

  db.sequelize
    .query(
      `SELECT Acct_source,debit,createdAt,narration,modeOfPayment,client_acct
        FROM trial_balance
        WHERE facilityId="${facilityId}" AND parent_account='Expenses'
        AND Acct_source != 'Drug Purchase' AND transaction_type != 'Purchase Order Payment'
        AND date(createdAt) BETWEEN date('${from}') AND date('${to}')
        ORDER BY createdAt desc`,
    )
    .then((results) => {
      res.json({
        success: true,
        results: results[0],
      });
    })
    .catch((err) => res.json({ success: false, err }));
};

exports.getDailySummary = (req, res) => {
  const { from, to, facilityId } = req.params;

  db.sequelize
    .query(
      `SELECT sum(credit)-sum(debit) as totalAmount FROM trial_balance  WHERE acct IN (SELECT head FROM account WHERE subhead='20000')
        AND facilityId="${facilityId}" AND date(createdAt)
        BETWEEN date("${from}") AND date("${to}")`,
    )
    .then((results) => {
      db.sequelize
        .query(
          ` SELECT sum(debit) as total FROM trial_balance
              WHERE facilityId="${facilityId}" AND acct = '30001'
              AND date(createdAt) BETWEEN date('${from}') AND date('${to}')
              ORDER BY createdAt desc`,
        )
        .then((results1) => {
          db.sequelize
            .query(
              `SELECT sum(debit) as total FROM trial_balance
                WHERE facilityId="${facilityId}" AND parent_account='Expenses'
                AND date(createdAt) BETWEEN date('${from}') AND date('${to}')
                ORDER BY createdAt desc`,
            )
            .then((results2) => {
              db.sequelize
                .query(
                  `SELECT acct, sum(debit)-sum(credit) petty, sum(debit) amount FROM trial_balance
                    WHERE facilityId="${facilityId}"
                    AND acct in ('400021', '400022', '400025')
                    AND date(createdAt) BETWEEN date('${from}') AND date('${to}')
                    AND acct != '500011'
                    GROUP BY acct ORDER BY createdAt desc`,
                )
                .then((results3) => {
                  // db.sequelize
                  //   .query(
                  //     `SELECT sum(debit) as total FROM trial_balance
                  //       WHERE description like 'Returned Drugs%' AND date(createdAt) BETWEEN date("${from}")
                  //       AND date("${to}") AND facilityId="${facilityId}"`,
                  //   )
                  // .then((results4) => {
                  db.sequelize
                    .query(
                      `SELECT sum(debit) as total FROM trial_balance
                            where acct = '400023' and modeOfPayment	!='cash' and debit!=0
                            AND date(createdAt) BETWEEN date("${from}") AND date("${to}") AND facilityId="${facilityId}"`,
                    )
                    .then((results5) => {
                      res.json({
                        success: true,
                        results: {
                          totalSales: results[0][0].totalAmount,
                          // totalReturned: results4[0][0].total,
                          totalPurchases: results1[0][0].total,
                          totalExpenses: results2[0][0].total,
                          totalReceivable: results5[0][0].total,
                          total: results3[0],
                        },
                      });
                    })
                    .catch((err) => res.json({ success: false, err }));
                  // })
                  // .catch((err) => res.json({ success: false, err }));
                })
                .catch((err) => res.status(500).json({ success: false, err }));
            })
            .catch((err) => res.status(500).json({ success: false, err }));
        })
        .catch((err) => res.status(500).json({ success: false, err }));
    })
    .catch((err) => res.status(500).json({ success: false, err }));
};

exports.getUserDailySummary = (req, res) => {
  const { username, from, to, facilityId } = req.params;

  db.sequelize
    .query(
      `SELECT sum(credit)-sum(debit) as totalAmount FROM trial_balance  WHERE acct IN ('20001')
      AND facilityId="${facilityId}" AND enteredBy="${username}" AND date(createdAt)
        BETWEEN date("${from}") AND date("${to}")`,
    )
    .then((results) => {
      db.sequelize
        .query(
          `SELECT sum(debit) as total FROM trial_balance
            WHERE facilityId="${facilityId}" AND acct = '30001' AND enteredBy="${username}"
            AND date(createdAt) BETWEEN date('${from}') AND date('${to}')
            ORDER BY createdAt desc`,
        )
        .then((results1) => {
          db.sequelize
            .query(
              `SELECT sum(debit) as total FROM trial_balance
                WHERE facilityId="${facilityId}" AND parent_account='Expenses'
                AND enteredBy="${username}"
                AND date(createdAt) BETWEEN date('${from}') AND date('${to}')
                ORDER BY createdAt desc`,
            )
            .then((results2) => {
              db.sequelize
                .query(
                  `SELECT acct, sum(debit)-sum(credit) petty, sum(debit) amount FROM trial_balance
                    WHERE facilityId="${facilityId}" AND enteredBy="${username}"
                    AND acct in ('400021', '400022', '400025')
                    AND date(createdAt) BETWEEN date('${from}') AND date('${to}')
                    AND acct != '500011'
                    GROUP BY acct ORDER BY createdAt desc`,
                )
                .then((results3) => {
                  // db.sequelize
                  //   .query(
                  //     `SELECT sum(debit) as total FROM trial_balance
                  //       WHERE description like 'Returned Drugs%' AND enteredBy="${username}" AND date(createdAt) BETWEEN date("${from}")
                  //       AND date("${to}") AND facilityId="${facilityId}"`,
                  //   )
                  //   .then((results4) => {
                  db.sequelize
                    .query(
                      `SELECT sum(debit) as total FROM trial_balance
                            where acct = '400023' and modeOfPayment	!='cash' and debit!=0 AND enteredBy="${username}"
                            AND date(createdAt) BETWEEN date("${from}") AND date("${to}") AND facilityId="${facilityId}"`,
                    )
                    .then((results5) => {
                      res.json({
                        success: true,
                        results: {
                          totalSales: results[0][0].totalAmount,
                          // totalReturned: results4[0][0].total,
                          totalPurchases: results1[0][0].total,
                          totalExpenses: results2[0][0].total,
                          totalReceivable: results5[0][0].total,
                          total: results3[0],
                        },
                      });
                    })
                    .catch((err) => res.json({ success: false, err }));
                  // })
                  // .catch((err) => res.json({ success: false, err }));
                })
                .catch((err) => res.status(500).json({ success: false, err }));
            })
            .catch((err) => res.status(500).json({ success: false, err }));
        })
        .catch((err) => res.status(500).json({ success: false, err }));
    })
    .catch((err) => res.status(500).json({ success: false, err }));
};

exports.getDailySales = async (req, res) => {
  const { from, to, facilityId } = req.params;

  try {
    // Query from transactions table (legacy)
    const transactionsQuery = `
      SELECT createdAt as date, description, SUM(credit-debit) as amount, acct, receiptDateSN
      FROM transactions WHERE acct = '20001'
      AND description not like 'Returned Drugs%'
      AND facilityId = :facilityId AND date(createdAt)
      BETWEEN date(:from) AND date(:to)
      GROUP BY description, receiptDateSN, createdAt, acct
      ORDER BY createdAt DESC
    `;

    const transactionsResults = await db.sequelize.query(transactionsQuery, {
      replacements: { facilityId, from, to },
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Query total from transactions table
    const transactionsTotalQuery = `
      SELECT SUM(credit-debit) as totalAmount FROM transactions
      WHERE acct = '20001' AND description not like 'Returned Drugs%'
      AND facilityId = :facilityId AND date(createdAt)
      BETWEEN date(:from) AND date(:to)
    `;

    const transactionsTotal = await db.sequelize.query(transactionsTotalQuery, {
      replacements: { facilityId, from, to },
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Query from invoices table (new system)
    const invoicesQuery = `
      SELECT
        transaction_date as date,
        description,
        amount,
        invoice_ref,
        ref_number
      FROM invoices
      WHERE type = 'sales'
      AND facility_id = :facilityId
      AND date(transaction_date) BETWEEN date(:from) AND date(:to)
      ORDER BY transaction_date DESC
    `;

    const invoicesResults = await db.sequelize.query(invoicesQuery, {
      replacements: { facilityId, from, to },
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Query total from invoices table
    const invoicesTotalQuery = `
      SELECT SUM(amount) as totalAmount FROM invoices
      WHERE type = 'sales'
      AND facility_id = :facilityId
      AND date(transaction_date) BETWEEN date(:from) AND date(:to)
    `;

    const invoicesTotal = await db.sequelize.query(invoicesTotalQuery, {
      replacements: { facilityId, from, to },
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Combine results
    const combinedData = [
      ...transactionsResults.map((r) => ({
        date: r.date,
        description: r.description,
        amount: parseFloat(r.amount || 0),
        source: "transactions",
      })),
      ...invoicesResults.map((r) => ({
        date: r.date,
        description: r.description || `Invoice ${r.invoice_ref}`,
        amount: parseFloat(r.amount || 0),
        source: "invoices",
      })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    const transTotal = parseFloat(transactionsTotal[0]?.totalAmount || 0);
    const invTotal = parseFloat(invoicesTotal[0]?.totalAmount || 0);
    const combinedTotal = transTotal + invTotal;

    res.json({
      success: true,
      data: combinedData,
      results: combinedData,
      total: combinedTotal,
    });
  } catch (err) {
    console.error("Error in getDailySales:", err);
    res.json({ success: false, err: err.message });
  }
};

exports.getAllReceivables = (req, res) => {
  const { facilityId, from, to } = req.params;

  db.sequelize
    .query(
      `SELECT a.createdAt AS date,a.description, a.debit AS amount, b.accName as customer
        FROM transactions AS a JOIN customers AS b ON a.client_acct=b.accountNo
        WHERE a.facilityId=b.facilityId AND  a.facilityId="${facilityId}" AND acct = '400023' AND modeOfPayment	!='cash'
          AND debit!=0 AND date(a.createdAt) BETWEEN date('${from}') AND date('${to}')`,
    )
    .then((results) => {
      db.sequelize
        .query(
          `SELECT sum(debit) as total FROM transactions
            where acct = '400023' and modeOfPayment	!='cash' and debit!=0
            AND date(createdAt) BETWEEN date("${from}") AND date("${to}") AND facilityId="${facilityId}"`,
        )
        .then((response) => {
          res.json({
            success: true,
            data: results[0],
            total: response[0][0].total,
          });
        })
        .catch((err) => res.json({ success: false, err }));
    })
    .catch((err) => res.json({ success: false, err }));
};

exports.getTotalProfit = (req, res) => {
  const { from, to, facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT SUM(amount) as total,sum(profit) as totalprofit from transaction_view2
      WHERE facilityId="${facilityId}" AND date(date) BETWEEN date("${from}") AND date("${to}")`,
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.json({ success: false, err }));
};

exports.getProfit = (req, res) => {
  const { from, to, facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT date,drug,profit,quantity, amount FROM transaction_view2
      WHERE facilityId="${facilityId}" AND date(date) BETWEEN date("${from}") AND date("${to}")`,
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.json({ success: false, err }));
};

exports.getSupplierTotalAmount = (req, res) => {
  const { from, to, facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT sum(a.quantity * a.cost_price) as amount,b.supplier_name as supplier
        FROM drugpurchaserecords a JOIN suppliersinfo b ON a.supplier=b.id
        WHERE a.facilityId="${facilityId}" AND date(a.created_at)
        BETWEEN date("${from}") AND date('${to}')
        GROUP BY a.supplier
        ORDER by amount`,
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.json({ success: false, err }));
};

exports.getSupplierBreakdown = (req, res) => {
  const { from, to, supplier, facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT created_at, b.supplier_name,drug,quantity,(cost_price*quantity) AS amount
        FROM drugpurchaserecords a JOIN suppliersinfo b ON a.supplier=b.id
        WHERE a.facilityId="${facilityId}" AND supplier='${supplier}' AND date(created_at) BETWEEN date('${from}') AND date('${to}')
        ORDER BY date desc`,
    )
    .then((results) => {
      db.sequelize
        .query(
          `
      SELECT sum(cost_price*quantity) as total FROM drugpurchaserecords
        WHERE facilityId="${facilityId}" AND supplier='${supplier}' AND date(created_at) BETWEEN date('${from}') AND date('${to}')
        ORDER BY created_at desc
        `,
        )
        .then((resp) => {
          // console.log(resp[0][0].total);
          res.json({
            success: true,
            results: { data: results[0], total: resp[0][0].total },
          });
        })
        .catch((err) => res.json({ success: false, err }));
    })
    .catch((err) => res.json({ success: false, err }));
};

exports.getAllSupplierBreakdown = (req, res) => {
  const { from, to, supplier, facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT created_at, b.supplier_name,drug,quantity,(cost_price*quantity) AS amount
        FROM drugpurchaserecords a JOIN suppliersinfo b ON a.supplier=b.id
        WHERE a.facilityId="${facilityId}"  AND date(created_at) BETWEEN date('${from}') AND date('${to}')
        ORDER BY date desc`,
    )
    .then((results) => {
      db.sequelize
        .query(
          `
      SELECT sum(cost_price*quantity) as total FROM drugpurchaserecords
        WHERE facilityId="${facilityId}" AND date(created_at) BETWEEN date('${from}') AND date('${to}')
        ORDER BY created_at desc
        `,
        )
        .then((resp) => {
          // console.log(resp[0][0].total);
          res.json({
            success: true,
            results: { data: results[0], total: resp[0][0].total },
          });
        })
        .catch((err) => res.json({ success: false, err }));
    })
    .catch((err) => res.json({ success: false, err }));
};

exports.recordClientDeposit = (req, res) => {
  const { facilityId } = req.body;

  db.sequelize
    .query("")
    .then((results) => {
      res.json({
        success: true,
        results,
      });
    })
    .catch((err) => res.json({ success: false, err }));
};

exports.getAssets = (req, res) => {
  const { facilityId } = req.params;

  db.sequelize
    .query(
      `SELECT head, description FROM account WHERE subhead = '40001' AND facilityId="${facilityId}"`,
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.saveAssetRegister = (req, res) => {
  const {
    facilityId,
    userId,
    code,
    description,
    cost,
    rate,
    daily_rate,
    purchase_date,
    percentage_rate,
    nbv_yearly,
    years,
    nbv_monthly,
    endDate,
    receiptno,
    receiptsn,
  } = req.body;

  db.sequelize
    .query(
      `call save_asset_register(:facId, :userId, :code, :desc, :cost, :rate, :daily_rate,
        :purchase_date, :end_date, :percentage_rate, :nbv_yearly, :years, :nbv_monthly,
        :in_date, :source, :receiptno, :receiptsn, :mode)`,
      {
        replacements: {
          facId: facilityId,
          userId,
          code,
          desc: description,
          cost,
          rate,
          daily_rate,
          purchase_date,
          percentage_rate,
          nbv_yearly,
          years,
          nbv_monthly,
          end_date: endDate,
          in_date: moment().format("YYYY-MM-DD hh:mm:ss"),
          source: "400022",
          receiptno,
          receiptsn,
          mode: "Bank",
        },
      },
    )
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

function getCodeForAcc(acc, facId, cb) {
  db.sequelize
    .query(
      `SELECT head FROM account WHERE facilityId="${facId}"
    AND description='Asset Depreciation'`,
    )
    .then((results) => {
      cb(results[0][0].head);
    })
    .catch((err) => {
      console.log(err);
    });
}

exports.runAssetDepreciation = (req, res) => {
  const {
    facilityId,
    userId,
    code,
    description,
    cost,
    source_acct,
    receiptno,
    receiptsn,
    mode,
    nbv,
  } = req.body;

  getCodeForAcc("Asset Depreciation", facilityId, (accHead) => {
    db.sequelize
      .query(
        `CALL run_asset_deduction(:facId, :userId, :code, :desc, :cost,:in_date, :source,
      :receiptno, :receiptsn, :mode, :nbv)`,
        {
          replacements: {
            facId: facilityId,
            userId,
            code,
            desc: description,
            cost,
            nbv,
            in_date: moment().format("YYYY-MM-DD hh:mm:ss"),
            source: accHead,
            receiptno,
            receiptsn,
            mode: "Bank",
          },
        },
      )
      .then((results1) => {
        res.json({ success: true, results: results1[0] });
      })
      .catch((err) => {
        console.log(err);
        res.status(500).json({ success: false, err });
      });
  });

  // db.sequelize.query(`SELECT head FROM account WHERE facilityId=${facilityId}
  //   AND description=`)
  // .then(results => {
  //   let assetDepAcc = results[0][0].head

  // })
  // .catch((err) => {
  //   console.log(err);
  //   res.status(500).json({ success: false, err });
  // });
};

exports.getAllAssets = (req, res) => {
  const { facilityId } = req.params;

  db.sequelize
    .query(`SELECT * FROM asset_schedule WHERE facilityId="${facilityId}"`)
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getSupplierDebtors = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT  supplier_name as supplier, balance as amount FROM suppliersinfo WHERE balance > 0
        AND facilityId="${facilityId}"`,
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getSupplierCreditors = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT supplier_name as supplier, abs(balance) as amount FROM suppliersinfo WHERE balance < 0
        AND facilityId="${facilityId}"`,
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

// Creditors report rows for suppliersinfo model
// Balance is derived from general_ledger movements: SUM(dr) - SUM(cr)
// Payables only: net balance < 0 (amounts owed to supplier). Debit / prepayment nets excluded.
exports.getSupplierCreditorsReport = async (req, res) => {
  try {
    const { facilityId } = req.params;
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const query = `
      SELECT
        c.supplier_number,
        c.supplier_name,
        c.address,
        c.phone,
        c.email,
        COALESCE(gl.balance, 0) AS balance,
        ABS(COALESCE(gl.balance, 0)) AS amount
      FROM suppliersinfo c
      LEFT JOIN (
        SELECT
          transaction_ref AS supplierNo,
          COALESCE(SUM(dr), 0) - COALESCE(SUM(cr), 0) AS balance
        FROM general_ledger
        WHERE facility_id = :facilityId
        GROUP BY transaction_ref
      ) gl ON c.supplier_number = gl.supplierNo
      WHERE c.facilityId = :facilityId
        AND COALESCE(gl.balance, 0) < 0
      ORDER BY c.supplier_name ASC
    `;

    const rows = await db.sequelize.query(query, {
      replacements: { facilityId },
      type: QueryTypes.SELECT,
    });

    return res.json({
      success: true,
      results: rows,
      count: rows.length,
    });
  } catch (err) {
    console.error("Error fetching supplier creditors report:", err);
    return res.status(500).json({
      success: false,
      message: "Error fetching supplier creditors report",
      error: err.message,
    });
  }
};

exports.getCustomerDebtors = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT  accName as account, abs(balance) as amount FROM customers WHERE balance < 0
        AND accName!='Instant Payment' AND facilityId="${facilityId}"`,
    )
    .then((results) => {
      // res.json({ success: true, results: results[0] });
      db.sequelize
        .query(
          `SELECT SUM(abs(balance)) as total FROM customers WHERE balance < 0
            AND accName!='Instant Payment' AND facilityId="${facilityId}"`,
        )
        .then((resp) => {
          res.json({
            success: true,
            data: results[0],
            total: resp[0][0].total,
          });
        })
        .catch((err) => {
          console.log(err);
          res.status(500).json({ success: false, err });
        });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getCustomerCreditors = async (req, res) => {
  try {
    const { facilityId } = req.params;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Get customers with calculated balance from CustomerEntry
    // Balance is calculated as: SUM(qty_in * cost) - SUM(qty_out * cost)
    // Customers with positive balance (balance > 0) are creditors (they owe us money)
    // Using raw query with proper joins to calculate balance
    const query = `
      SELECT
        COALESCE(c.fullname, c.store_name) as account,
        ABS(
          COALESCE(SUM(ce.qty_in * ce.cost), 0) -
          COALESCE(SUM(ce.qty_out * ce.cost), 0)
        ) as amount
      FROM customers c
      LEFT JOIN customer_entries ce ON c.customerNo = ce.customerNo AND c.facilityId = ce.facilityId
      WHERE c.facilityId = :facilityId
        AND (c.fullname != 'Instant Payment' OR c.fullname IS NULL)
      GROUP BY c.customerNo, c.facilityId, c.fullname, c.store_name
      HAVING (
        COALESCE(SUM(ce.qty_in * ce.cost), 0) -
        COALESCE(SUM(ce.qty_out * ce.cost), 0)
      ) > 0
    `;

    const customers = await db.sequelize.query(query, {
      replacements: { facilityId },
      type: QueryTypes.SELECT,
    });

    // Calculate total - sum all individual amounts from the customers query
    const total = customers.reduce((sum, customer) => {
      return sum + (parseFloat(customer.amount) || 0);
    }, 0);

    res.json({
      success: true,
      data: customers,
      total: total,
    });
  } catch (err) {
    console.error("Error fetching customer creditors:", err);
    res.status(500).json({
      success: false,
      message: "Error fetching customer creditors",
      error: err.message,
    });
  }
};

exports.getReturnedDrugsReport = (req, res) => {
  const { facilityId, from, to } = req.params;
  let convertedFrom = moment(from).format("YYYY-MM-DD");
  let convertedTo = moment(to).format("YYYY-MM-DD");
  db.sequelize
    .query(
      `SELECT createdAt as date, description, debit as amount FROM transactions
        WHERE description like 'Returned Drugs%' AND debit != 0
        AND date(createdAt) BETWEEN date("${convertedFrom}") AND date("${convertedTo}") AND facilityId="${facilityId}"`,
    )
    .then((data) => {
      db.sequelize
        .query(
          `SELECT sum(debit) as total FROM transactions
            WHERE description like 'Returned Drugs%' AND debit != 0
            AND date(createdAt) BETWEEN date("${convertedFrom}") AND date("${convertedTo}") AND facilityId="${facilityId}"`,
        )
        .then((results) => {
          res.json({ success: true, data: data[0], total: results[0][0] });
        })
        .catch((err) => res.json({ success: false, err }));
    })
    .catch((err) => res.json({ success: false, err }));
};

exports.getSupplierPaymentSummary = (req, res) => {
  const { facilityId, from, to } = req.params;
  db.sequelize
    .query(
      `SELECT a.createdAt as date, description,modeOfPayment,acct,createdAt,credit AS amount, b.supplier_name
        FROM transactions a JOIN suppliersinfo b ON a.client_acct = b.id WHERE description = 'Supplier Payment'
        AND acct in ('400021','400022', '400025') AND date(a.createdAt) BETWEEN date("${from}") AND date("${to}") AND a.facilityId="${facilityId}"`,
    )
    .then((data) => {
      db.sequelize
        .query(
          `SELECT sum(credit) as total FROM transactions WHERE description = 'Supplier Payment'
          AND acct in ('400021','400022', '400025') AND date(createdAt) BETWEEN date("${from}") AND date("${to}") AND facilityId="${facilityId}"`,
        )
        .then((results) => {
          res.json({ success: true, data: data[0], total: results[0][0] });
        })
        .catch((err) => res.json({ success: false, err }));
    })
    .catch((err) => res.json({ success: false, err }));
  //
};

// exports.getTrialBalance = (req, res) => {
//   const { facilityId, from, to } = req.body;

//   db.sequelize
//     .query(
//       `SELECT Acct_source, sum(debit) as debit, sum(credit) as credit FROM trial_balance
//         GROUP BY Acct_source ORDER BY Acct_source
//         WHERE date(a.createdAt)
//         BETWEEN date("${from}") AND date("${to}") AND a.facilityId="${facilityId}"`,
//     )
//     .then((data) => {
//       db.sequelize
//         .query(
//           `SELECT sum(debit), sum(credit) FROM trial_balance
//             WHERE date(createdAt) BETWEEN date("${from}") AND date("${to}") AND facilityId="${facilityId}"`,
//         )
//         .then((results) => {
//           res.json({ success: true, data: data[0], total: results[0][0] });
//         })
//         .catch((err) => res.json({ success: false, err }));
//     })
//     .catch((err) => res.json({ success: false, err }));
// };

exports.getNextAccChartCode = (req, res) => {
  const { facilityId, subhead } = req.params;
  db.sequelize
    .query(
      `SELECT ifnull(max(head), 0) + 1 as nextCode FROM account where subhead="${subhead}"
        AND facilityId="${facilityId}"`,
    )
    .then((results) => {
      let nextCode = results[0][0].nextCode;
      res.json({
        success: true,
        results: nextCode === 1 ? parseInt(subhead) + 1 : nextCode,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getMainHeads = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT head, description FROM account WHERE facilityId="${facilityId}"
        AND subhead=10000`,
    )
    .then((results) => {
      res.json({
        success: true,
        results: results[0],
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getTrialBalance = (req, res) => {
  const { facilityId, from, to } = req.params;

  db.sequelize
    .query(
      `SELECT * FROM trialbalance WHERE facilityId="${facilityId}"
        AND date BETWEEN date("${from}") AND date("${to}")`,
    )
    .then((results) => {
      res.json({
        success: true,
        results: results[0],
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getFinancialStatement = (req, res) => {
  const { facilityId, from, to } = req.params;

  db.sequelize
    .query(
      `SELECT * FROM trialbalance WHERE facilityId="${facilityId}"
        AND date BETWEEN date("${from}") AND date("${to}")`,
    )
    .then((results) => {
      res.json({
        success: true,
        results: results[0],
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getProfitLossStatement = (req, res) => {
  const { facilityId, from, to } = req.params;

  db.sequelize
    .query(
      `SELECT * FROM trialbalance WHERE subhead like '200%' OR subhead like '300%'
        AND facilityId="${facilityId}" AND date BETWEEN date("${from}") AND date("${to}")`,
    )
    .then((results) => {
      res.json({
        success: true,
        results: results[0],
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getFinancialPosition = (req, res) => {
  const { facilityId, from, to } = req.params;

  db.sequelize
    .query(
      `SELECT * FROM trialbalance WHERE subhead like '400%' OR subhead like '500%'
        AND facilityId="${facilityId}" AND date BETWEEN date("${from}") AND date("${to}")`,
    )
    .then((results) => {
      db.sequelize.query(`
        SELECT sum(debit) as retained FROM trialbalance
          WHERE subhead like '200%' OR subhead like '300%'
          AND facilityId="${facilityId}" AND date BETWEEN date("${from}") AND date("${to}")
      `);
      res.json({
        success: true,
        results: results[0],
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getFinancialStatement2 = (req, res) => {
  const { facilityId, from, to } = req.params;

  db.sequelize
    .query(
      `SELECT head, description FROM account WHERE facilityId="${facilityId}"
        AND subhead=10000`,
    )
    .then((results1) => {
      let mainHeads = results1[0];
      db.sequelize
        .query(
          `SELECT * FROM trialbalance WHERE facilityId="${facilityId}"
            AND date BETWEEN date("${from}") AND date("${to}")`,
        )
        .then((results2) => {
          let trialbal = results2[0];
          let final = {};

          trialbal.forEach((item) => {
            let head = mainHeads.find(
              (i) =>
                item.toString().substr(0, 1) === i.head.toString().substr(0, 1),
            );
          });

          // mainHeads.forEach(head => {
          //   let first = head.head.toString().substr(0,1)
          //   if(Object.keys(final).includes(head.description)){

          //   } else {
          //     final[head.description] = []
          //   }
          // })
          // res.json({
          //   success: true,
          //   results: results[0],
          // });
        })
        .catch((err) => {
          console.log(err);
          res.status(500).json({ success: false, err });
        });

      // res.json({
      //   success: true,
      //   results: results[0],
      // });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getRevenueAccHeads = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT * FROM account WHERE subhead LIKE '2000%' AND facilityId="${facilityId}"`,
    )
    .then((results) => {
      res.json({
        success: true,
        results: results[0],
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.updateAccChart = (req, res) => {
  const { head, subHead, description, price, facilityId } = req.body;
  // console.log(req.body)
  // head: 'Cotton Seed Cake',
  // subHead: '20000',
  // description: '20001',
  // price: '8000',
  // userId: 'admin-user',
  // facilityId: 'd8d7a732-1832-4e25-9a98-e68ddc3f0b26'

  db.sequelize
    .query(
      `UPDATE account SET price="${price}", description="${head}", subhead="${subHead}" WHERE head="${description}" AND facilityId="${facilityId}"`,
    )
    .then((results) => {
      res.json({
        success: true,
        results: results[0],
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getCustomerDebtorsForFactory = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT  accName as account, balance,contactPhone,accountNo,guarantor_name, guarantor_phone FROM customers WHERE accName!='Instant Payment' AND facilityId="${facilityId}"`,
    )
    .then((results) => {
      // res.json({ success: true, results: results[0] });
      db.sequelize
        .query(
          `SELECT SUM(balance) as total FROM customers WHERE accName!='Instant Payment' AND facilityId="${facilityId}"`,
        )
        .then((resp) => {
          res.json({
            success: true,
            data: results[0],
            total: resp[0][0].total,
          });
        })
        .catch((err) => {
          console.log(err);
          res.status(500).json({ success: false, err });
        });
    });
};

exports.getFactoryInventoryAll = (req, res) => {
  const { facilityId, from, to, drug } = req.params;
  db.sequelize
    .query(
      `SELECT drug, qty_in, shift,created_at FROM drugs
      WHERE facilityId="${facilityId}" and qty_in !=0 and drug ="${drug}"
      and DATE(created_at) between DATE("${from}") and DATE("${to}")`,
    )
    .then((results) => {
      res.json({
        success: true,
        results: results[0],
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.addPurchaseOrder = (req, res) => {
  console.log(req.body);
  const { tableData, facilityId } = req.body;

  moveItemsToStore(
    tableData,
    () => {
      res.json({
        success: true,
        // results: results,
      });
    },
    () => {
      res.status(500).json({ success: false });
    },
    facilityId,
  );
};

// const addPu

// exports.addPurchaseOrder = (req, res) => {
//   console.log(req.body);

//   const {
//     date,
//     type,
//     vendor = "",
//     client = "",
//     total,
//     exchange_type = "-",
//     exchange_rate = "0",
//     supplier_code = "0",
//     process_by,
//     reference_no = "",
//     truckNo = "",
//     waybillNo = "",
//     supplierTotalAmt = 0,
//   } = req.body.formTitle;

//   const { version_id } = req.body;
//   db.sequelize.query("call nurmber_generator1('po')").then((resp) => {
//     // let PONo = req.body.po_id;
//     // let version_id = req.body.version_id;
//     let PONo = resp[0].po_id;
//     let alt_version_id = UUIDV4();
//     // console.log(PONo);
//     db.sequelize
//       .query(
//         `call add_purchase_order(:in_po_no,:in_date,:in_type,:in_vendor,:in_client,:in_total_amount,
//           :in_status,:in_facilityId,:in_exchange_type,:in_exchange_rate,:supplier_code,:process_by,
//           :version_id)`,
//         {
//           replacements: {
//             in_po_no: PONo,
//             in_date: date
//               ? moment(date).format("YYYY-MM-DD")
//               : moment().format("YYYY-MM-DD"),
//             in_type: type ? type : "",
//             in_vendor: vendor,
//             in_client: client,
//             in_total_amount: total,
//             in_status: "finished purchase",
//             in_facilityId: req.body.facilityId,
//             in_exchange_type: exchange_type ? exchange_type : "-",
//             in_exchange_rate: exchange_rate ? exchange_rate : "0",
//             supplier_code: supplier_code ? supplier_code : 0,
//             process_by: process_by ? process_by : "",
//             version_id: version_id ? version_id : alt_version_id,
//           },
//         }
//       )
//       .then(
//         req.body.tableData.forEach((item) => {
//           let k_version_id = UUIDV4();
//           db.sequelize.query(
//             `call add_purchase_order_list(:in_exchange_rate, :in_item_name,:in_specification,
//               :in_quantity_available,:in_propose_quantity,:in_price,:in_propose_amount,:in_exchange_type,
//               :in_po_id,:in_type,:in_identifier,:in_facilityId,:date,:in_status,:remark,:remarks_id,
//               :item_category,:in_expired_status,:in_item_code,:version_id,:supplier_code,
//                 :reference_no,:truckNo,:waybillNo,:in_total)`,
//             {
//               replacements: {
//                 in_exchange_rate: item.exchange_rate ? item.exchange_rate : 0, // not neccessary
//                 in_item_name: item.item_name ? item.item_name : "",
//                 in_specification: item.specification ? item.specification : "", // not neccessary
//                 in_quantity_available: item.quantity_available
//                   ? item.quantity_available
//                   : 0, // not neccessary
//                 in_propose_quantity: item.propose_quantity
//                   ? item.propose_quantity
//                   : 0,
//                 in_price: item.price ? item.price : 0,
//                 in_propose_amount: item.cost
//                   ? parseInt(item.cost)* parseInt(item.quantity)
//                   : 0,
//                 in_exchange_type: item.exchange_type ? item.exchange_type : "", // not neccessary
//                 in_po_id: PONo, // generated
//                 in_type: item.type ? item.type : "",
//                 in_identifier: "update",
//                 in_facilityId: req.body.facilityId,
//                 date: moment().format("YYYY-MM-DD"),
//                 in_status: "new order",
//                 remark: item.remarks ? item.remarks : "", // not neccessary
//                 remarks_id: item.remarks_id ? item.remarks_id : "0", // not neccessary
//                 item_category: item.item_category ? item.item_category : "",
//                 in_expired_status: item.expired_status
//                   ? item.expired_status
//                   : "false", // not neccessary
//                 in_item_code: item.item_code ? item.item_code : "",
//                 version_id: version_id ? version_id : k_version_id,
//                 supplier_code: item.supplier_code ? item.supplier_code : "0",
//                 reference_no: item.reference_no,
//                 truckNo: item.truckNo ? item.truckNo : "",
//                 waybillNo: item.waybillNo ? item.waybillNo : "",
//                 in_total: supplierTotalAmt ? supplierTotalAmt : 0,
//               },
//             }
//           );
//         })
//       )
//       .then((results) => {
//         let receive_date = moment().format("YYYY-MM-DD");
//         let branch_name = "";
//         let query_type = "received";

//         const itemsList = req.body.tableData.map((item) => ({
//           receive_date: receive_date,
//           item_name: item.item_name,
//           po_no: PONo,
//           qty_in: item.propose_quantity,
//           qty_out: 0,
//           store_type: "",
//           grm_no: 0,
//           query_type,
//           expiry_date: item.expiry_date ? item.expiry_date : "",
//           unit_price: item.price ? item.price : 0,
//           mark_up: item.mark_up ? item.mark_up : 0,
//           selling_price: item.price,
//           cost_price: item.cost,
//           transfer_from: "Purchase Order",
//           status: "finished purchase",
//           transfer_to: item.branch_name ? item.branch_name : "STORE",
//           branch_name: item.branch_name ? item.branch_name : "",
//           facilityId: req.body.facilityId,
//           trn_no: 0,
//           uniqueId: item.uniqueId ? item.uniqueId : "",
//           item_category: item.item_category ? item.item_category : "",
//           in_item_code: item.barcode ? item.barcode : "",
//           in_item_code: item.item_code ? item.item_code : "",
//           receivedTo: item.receivedTo ? item.receivedTo : "",
//           storeId: item.storeId ? item.storeId : "",
//           version_id: item._id ? item._id : alt_version_id,
//           truckNo: item.truckNo ? item.truckNo : "",
//           waybillNo: item.waybillNo ? item.waybillNo : "",
//           otherInfo: item.otherInfo ? item.otherInfo : "",
//           supplier_code: item.supplier_code ? item.supplier_code : "",
//           supplier_name: item.supplier_name ? item.supplier_name : "",
//           reorder: item.reorder ? item.reorder : 0,
//         }));

//         moveItemsToStore(itemsList, () => {
//           console.log("moved items to store");

//           db.sequelize.query("call nurmber_generator1('trn')").then((resp) => {
//             let trn = resp[0].trn;
//             // const trn = UUIDV4();
//             let newItemsList = itemsList.map((i) => ({
//               ...i,
//               qty_in: 0,
//               qty_out: i.qty_in,
//             }));

//             moveItemsToPOS(itemsList, req.body.facilityId, trn, () => {
//               res.json({
//                 success: true,
//                 results,
//                 PONo,
//                 msg: "moved items to store",
//               });
//             });
//           });
//         });
//       })
//       .catch((err) => {
//         console.log(err);
//         res.status(500).json({ success: false, err });
//       });
//   });
// };

const moveItemsToStore = (
  list = [],
  callback = (f) => f,
  error = (f) => f,
  facilityId,
) => {
  const receive_date = moment().format("YYYY-MM-DD");

  const stmt = `CALL add_new_store(:receive_date, :item_name, :po_no, :qty_in, :qty_out, :store_type, :grm_no,
    :query_type, :expiry_date, :unit_price, :mark_up, :selling_price, :transfer_from, :status,
    :transfer_to, :branch_name, :facilityId, :trn_no, :uniqueId, :item_category, :in_item_code, :version_id, :req_no,
    :truckNo, :waybillNo, :otherInfo, :cost_price, :supplier_code, :supplier_name, :reorder, :receiptNo,
    :userId)`;

  const updateStmt = `CALL update_inventory_new(:facilityId, :item_name, :supplier_name, :available, :unit_price)`;

  let completed = 0;

  list.forEach((item) => {
    db.sequelize
      .query(stmt, {
        replacements: {
          receive_date,
          item_name: item.item_name,
          po_no: 0,
          qty_in: item.quantity ? item.quantity : 0,
          qty_out: item.qty_out ? item.qty_out : 0,
          store_type: item.store_type || "",
          grm_no: item.grm_no ? item.grm_no : 0,
          query_type: item.query_type,
          expiry_date:
            item.expiry_date === "0000-00-00" ||
            item.expiry_date === "" ||
            item.expiry_date === null ||
            item.expiry_date === undefined
              ? "1111-11-11"
              : moment(item.expiry_date).format("YYYY-MM-DD"),
          unit_price: item.cost ? item.cost : 0,
          mark_up: item.mark_up ? item.mark_up : 0,
          selling_price: item.price ? item.price : 0,
          cost_price: item.cost_price ? item.cost_price : 0,
          transfer_from: item.transfer_from || "",
          status: item.status || "",
          transfer_to: item.transfer_to || "",
          branch_name: item.branch_name,
          facilityId: facilityId,
          trn_no: 0,
          uniqueId: item.uniqueId ? item.uniqueId : "",
          item_category: item.item_category ? item.item_category : "",
          in_item_code: item.item_code ? item.item_code : "",
          req_no: item.requisition_no ? item.requisition_no : 0,
          version_id: item.version_id || "",
          truckNo: item.truckNo ? item.truckNo : "",
          waybillNo: item.waybillNo ? item.waybillNo : "",
          otherInfo: item.otherInfo ? item.otherInfo : "",
          supplier_code: item.supplier_code ? item.supplier_code : "",
          supplier_name: item.supplier_name ? item.supplier_name : "",
          reorder: item.reorder ? item.reorder : 0,
          receiptNo: item.receiptNo ? item.receiptNo : "",
          userId: item.userId ? item.userId : "",
        },
      })
      .then(() => {
        return db.sequelize.query(updateStmt, {
          replacements: {
            facilityId,
            item_name: item.item_name,
            supplier_name: item.supplier_name,
            available: item.quantity,
            unit_price: item.price ? item.price : 0,
          },
        });
      })
      .then(() => {
        console.log(`Success: ${item.item_name} added and inventory updated.`);
        completed++;
        if (completed === list.length) {
          callback();
        }
      })
      .catch((err) => {
        console.error(`Error processing ${item.item_name}:`, err);
        error(err);
      });
  });
};

const moveItemsToPOS = (
  list = [],
  facilityId = "",
  trn_no,
  callback = (f) => f,
  error = (f) => f,
) => {
  console.log(list);
  getStoreVersionId((version_id) => {
    let stm = `call add_new_store(:receive_date,:item_name, :po_no, :qty_in,:qty_out,:store_type,:grm_no,
      :query_type,:expiry_date,:unit_price,:mark_up,:selling_price,:transfer_from,:status,
      :transfer_to,:branch_name,:facilityId,:trn_no,:uniqueId,:item_category,:in_item_code,:version_id,
      :requisition_no,:truckNo,:waybillNo,:otherInfo,:cost_price, :supplier_code, :supplier_name,
      :reorder, :receiptNo,:userId)`;

    // list.forEach((item, i) => {
    for (let k = 0; k < list.length; k++) {
      let item = list[k];
      db.sequelize
        .query(stm, {
          replacements: {
            receive_date: item.receive_date ? item.receive_date : "",
            item_name: item.item_name ? item.item_name : "",
            po_no: 0,
            qty_in: item.qty_in ? item.qty_in : 0,
            qty_out: item.qty_out ? item.qty_out : 0,
            store_type: item.store_type ? item.store_type : null,
            grm_no: item.grm_no ? item.grm_no : 0,
            query_type: "transfer",
            expiry_date: item.expiry_date ? item.expiry_date : "",
            unit_price: item.unit_price ? item.unit_price : 0,
            mark_up: item.mark_up ? item.mark_up : 0,
            selling_price: item.selling_price ? item.selling_price : 0,
            cost_price: item.cost_price ? item.cost_price : 0,
            transfer_from: item.transfer_to,
            status: item.status ? item.status : null,
            transfer_to:
              item.receivedTo && item.receivedTo !== ""
                ? item.receivedTo
                : item.transfer_to + "-POS",
            branch_name: item.branch_name ? item.branch_name : "",
            facilityId: facilityId,
            trn_no: 0,
            uniqueId: item.uniqueId ? item.uniqueId : null,
            item_category: item.item_category ? item.item_category : null,
            in_item_code: item.item_code ? item.item_code : "",
            version_id: `${item.version_id}-2`,
            requisition_no: item.requisition_no ? item.requisition_no : 0,
            truckNo: item.truckNo ? item.truckNo : "",
            waybillNo: item.waybillNo ? item.waybillNo : "",
            otherInfo: item.otherInfo ? item.otherInfo : "",
            supplier_code: item.supplier_code ? item.supplier_code : "",
            supplier_name: item.supplier_name ? item.supplier_name : "",
            reorder: item.reorder ? item.reorder : 0,
            receiptNo: item.receiptNo ? item.receiptNo : "",
            userId: item.userId ? item.userId : "",
          },
        })
        .then((resp) => {
          console.log("success", resp);
        })
        .catch((err) => {
          console.log("error", err);
        });
    }
    // });
    callback();
  });
};

exports.customStoreProcess = (req, res) => {
  const { query_type = null, facilityId = null } = req.body;
  console.log(req.body);
  // good_transfer on transfer
  // service_transaction for sales
  //  const stmt2 = 'CALL custom_store_process(:query_type,:in_agent_id,:in_qty_in,:in_qty_out,:in_transaction_due,:in_store_keeper,:facility_id,:price,:expiry_date,:item_code)'
  if (query_type === "create") {
    dispatchTransfer(
      req.body,
      (report) => res.status(500).json(report),
      (report) => res.status(200).json(report),
    );
  } else if (query_type === "update") {
    dispatchTransfer(
      req.body,
      (report) => console.log(500).json(report),
      (report) => console.log(report),
    );
  }
};

const dispatchTransfer = (req = {}, error = (f) => f, done = (f) => f) => {
  const stmt =
    "call good_transfer(:item_code,:quantity,:expiry_date,:price,:storeFrom,:storeTo,:facilityId,:item_name,:today,:cost,:markup,:supplierName,:supplier_code)";
  const { query_type = null, facilityId = null } = req;
  req.data.forEach((data, i) => {
    const {
      price = 0,
      agent = {},
      store = {},
      item = {},
      qtyRecived = null,
      qtyReturned = null,
    } = data;
    console.log({ agent, store, item, qtyRecived, qtyReturned });
    const _qty = query_type === "create" ? qtyRecived : qtyReturned;
    db.sequelize
      .query(stmt, {
        replacements: {
          query_type,
          item_code: item.item_code,
          item_name: item.item_name,
          in_agent_id: agent.admin,
          quantity: _qty,
          in_qty_out: query_type === "update" ? qtyReturned : 0,
          today: moment().format("YYYY-MM-DD"),
          cost: parseInt(_qty) * parseFloat(item.selling_price),
          in_store_keeper: store.username,
          facilityId,
          supplier_code: item.supplier_code,
          price,
          markup: item.markup || 0,
          supplierName:
            query_type === "create"
              ? `Transfered from ${store.busName}`
              : `Transfered from ${agent.branch_name}`,
          supplier_code: item.supplier_code,
          storeFrom: store.busName,
          storeTo: agent.branch_name,
          expiry_date: moment(item.expiry_date).format("YYYY-MM-DD"),
        },
      })
      .then((result) => {
        count_orror = 1;
        // call good_transfer
        // call store_entries()
        // . then proceed (call add_new_store in case of return)
        // .catch delete (rollback record)

        console.log({ result });
      })
      .catch((err) => {
        error({ error: err });
      });
    if (i === req.data.length - 1) {
      done({ success: "Done" });
    }
    // else{
    //   res.status(500).json({success:false, error:sever_error,count_sucess})
    // }
  });
};

exports.addExpenses = (req, res) => {
  const {
    date,
    month,
    branch_name,
    request_no,
    particulars,
    quantity,
    price,
    amount,
    remarks,
    status,
    expense_id,
    facilityId,
    type_of_expenses,
  } = req.body;
  console.log(req.body);
  db.sequelize
    .query(
      `CALL addNewExpenses(:date,:month,:branch_name,:request_no,:particulars,:quantity,:price,:amount,:remarks,:status,:expense_id,:facilityId,:type_of_expenses)`,
      {
        replacements: {
          date,
          month,
          branch_name,
          request_no,
          particulars,
          quantity,
          price,
          amount,
          remarks,
          status,
          expense_id,
          facilityId,
          type_of_expenses,
        },
      },
    )
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      console.log(err);
      res.json({ success: false, err });
    });
};

exports.getAllExpenses = (req, res) => {
  const { from, to } = req.params;
  db.sequelize
    .query(`CALL getAllExpenses(:date_from,:date_to)`, {
      replacements: {
        date_from: from,
        date_to: to,
      },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.json({ success: false, err }));
};

exports.getNextId = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT ifnull(max(po_id), 0) + 1 as po_id FROM purchase_order WHERE facilityId="${facilityId}"`,
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.json({ success: false, err }));
};

exports.getAllExpensesByID = (req, res) => {
  console.log(req.params);
  const { request_no } = req.params;
  db.sequelize
    .query(
      `SELECT id,request_no, particulars,branch_name, month, date,status,quantity,price,amount,remarks FROM expense WHERE request_no="${request_no}" ORDER BY insert_at desc`,
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.json({ success: false, err }));
};

exports.getBankAccountTable = (req, res) => {
  db.sequelize
    .query(`SELECT * FROM bank_account_creation_table`)
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.json({ success: false, err }));
};

exports.getBanks = (req, res) => {
  const { facilityId } = req.params;

  db.sequelize
    .query(
      `SELECT head, subhead, description FROM \`account\` WHERE account_category LIKE 'bank account' AND facilityId = :facilityId`,
      {
        replacements: { facilityId },
        type: db.sequelize.QueryTypes.SELECT,
      },
    )
    .then((results) => {
      res.json({
        success: true,
        results: results,
        message: "Bank accounts retrieved successfully",
      });
    })
    .catch((err) => {
      console.error("Error fetching bank accounts:", err);
      res.status(500).json({
        success: false,
        error: "Failed to retrieve bank accounts",
        details: err.message,
      });
    });
};

exports.updateExpensesStatus = (req, res) => {
  const { status } = req.body;
  const { request_no } = req.params;
  db.sequelize
    .query(`Call update_expenses_status(:status,:request_no)`, {
      replacements: {
        status,
        request_no,
      },
    })
    .then((results) => {
      res.json({
        success: true,
        results: results,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};
exports.updateExpenseReq = (req, res) => {
  const {
    date,
    month,
    branch_name,
    request_no,
    particulars,
    quantity,
    price,
    amount,
    remarks,
  } = req.body;
  const { id } = req.params;
  db.sequelize
    .query(
      `UPDATE expense SET price="${price}", date="${date}", month="${month}", branch_name="${branch_name}", request_no="${request_no}", particulars="${particulars}", quantity="${quantity}", amount="${amount}", remarks="${remarks}" WHERE id="${id}"`,
    )
    .then((results) => {
      res.json({
        success: true,
        results: results[0],
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};
exports.bankAccountCreationForm = (req, res) => {
  const {
    bankName,
    accoutName,
    AccountNumber,
    accountShortCode,
    purpose,
    description,
    vendorName,
  } = req.body;
  db.sequelize
    .query(
      `INSERT INTO bank_account_creation_table(bank_name, account_name,account_number,account_short_code,purpose,description,vendor_name)
      VALUES("${bankName}","${accoutName}","${AccountNumber}","${accountShortCode}","${purpose}","${description}","${vendorName}");`,
    )
    .then((results) => {
      res.json({
        success: true,
        results: results[0],
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getAllPurchaseOrder = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query(`call get_all_purchase_order(:facilityId)`, {
      replacements: {
        facilityId,
      },
    })
    .then((results) => res.json({ success: true, results: results }))
    .catch((err) => res.json({ success: false, err }));
};

exports.getDisbursePurchaseOrder = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT * FROM purchase_order where status in ("Disburse","ManagementApproved","unfinished purchase") ORDER BY insected_by DESC `,
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.json({ success: false, err }));
};

exports.getAllPurchaseOrderPending = (req, res) => {
  db.sequelize
    .query(`call get_all_purchase_order_pending()`)
    .then((results) => res.json({ success: true, results: results }))
    .catch((err) => res.json({ success: false, err }));
};

exports.getAllPurchaseOrderPendingNew = (req, res) => {
  db.sequelize
    .query(`SELECT * FROM purchase_requisition WHERE status = 'approved'`)
    .then((results) => res.json({ success: true, results: results }))
    .catch((err) => res.json({ success: false, err }));
};

exports.getAllPurchaseOrderManage = (req, res) => {
  db.sequelize
    .query(
      `SELECT * FROM purchase_order where status in ("BackToAuditor", "ManagementApproved","Reviewer")`,
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.json({ success: false, err }));
};

exports.getPendingPurchaseOrder = (req, res) => {
  const { query_type = "" } = req.query;
  const { from_date = "" } = req.query;
  const { to_date = "" } = req.query;

  db.sequelize
    .query(`call get_pending_purchase_order(:query_type,:from_date,:to_date)`, {
      replacements: {
        query_type,
        from_date: from_date ? from_date : null,
        to_date: to_date ? to_date : null,
      },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.json({ success: false, err }));
};

exports.getBadge = (req, res) => {
  const { id } = req.params;
  let arr = id.split(",");
  console.log(id);
  db.sequelize
    .query(
      `SELECT COUNT(po_id) as num FROM purchase_order where status in (${arr})`,
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.json({ success: false, err }));
};

exports.nurmberGenerator = (req, res) => {
  const { query_type = "", facilityId = "" } = req.params;
  db.sequelize
    .query(`call nurmber_generator1(:in_query_type,:facilityId) `, {
      replacements: {
        in_query_type: query_type,
        facilityId,
      },
    })
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.json({ success: false, err }));
};

exports.deleteExpenses = async (req, res) => {
  const { id } = req.params;
  try {
    const rows = await db.sequelize.query(
      `SELECT id, request_no, amount, facilityId, status FROM expense WHERE id = :id LIMIT 1`,
      { replacements: { id }, type: db.sequelize.QueryTypes.SELECT },
    );
    const before = rows[0] || { id };
    await db.sequelize.query(`DELETE FROM expense WHERE id = :id`, {
      replacements: { id },
    });
    await recordActivity({
      facilityId: before.facilityId || req.body?.facilityId || "unknown",
      userId: pickActor(req),
      action: "delete",
      entityType: "expense",
      entityId: id,
      entityLabel: before.request_no || String(id),
      before,
      remark: "Expense deleted",
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ err });
  }
};

exports.sendTo = (req, res) => {
  const { status, po_no, facilityId, generalRemarks } = req.body;
  console.log(req.body);
  db.sequelize
    .query(
      `call send_back(:status,:po_id,:facilityId,:procesed,:remark,:date)`,
      {
        replacements: {
          status: status,
          po_id: po_no,
          facilityId: facilityId,
          procesed: req.body.userId,
          remark: generalRemarks ? generalRemarks : "",
          date: moment().format("YYYY-MM-DD"),
        },
      },
    )
    .then((results) => {
      res.json({
        success: true,
        results: results,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getExpensesByApproved = (req, res) => {
  const { status = "Reviewed" } = req.body;
  db.sequelize
    .query(
      `SELECT id,request_no,branch_name,particulars,type_of_expenses, month, date,status, SUM(amount) as total FROM expense WHERE status="${status}" GROUP by request_no,type_of_expenses ORDER BY insert_at desc`,
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.json({ success: false, err }));
};

exports.getExpensesByAudited = (req, res) => {
  db.sequelize
    .query(
      `SELECT request_no,branch_name,particulars, month, date,status,type_of_expenses, SUM(amount) as total FROM expense WHERE status in ("Audited","Reviewer Rejected", "Acct_Management") GROUP by request_no ORDER BY insert_at desc`,
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.json({ success: false, err }));
};

exports.updatePurchaseToPending = (req, res) => {
  console.log(req.body);
  const { status, total, facilityId, tableData, po_no, exchange_rate } =
    req.body;
  console.log(req.body);
  db.sequelize
    .query(
      // `update purchase_order set processed_by="${req.body.userId}",  exchange_rate="${exchange_rate}", status="${status}" ,total_amount="${total}" where po_id="${po_no}" and facilityId="${facilityId}"`
      `call update_pur_order(:exchange_rate,:status,:total,:po_no,:in_processed_by)`,
      {
        replacements: {
          exchange_rate,
          status,
          total,
          po_no,
          in_processed_by: req.body.userId,
        },
      },
    )
    .then(
      tableData.forEach((item) => {
        db.sequelize.query(
          "call update_purchase_order(:item_name,:price,:propose_quantity,:propose_amount,:quantity_available,:exchange_rate,:exchange_type,:specification,:po_id,:facilityId,:identifier,:type,:id,:item_category)",
          {
            replacements: {
              item_name: item.item_name,
              price: item.price,
              propose_quantity: item.propose_quantity,
              propose_amount: item.propose_amount,
              quantity_available: item.quantity_available,
              exchange_rate: item.exchange_rate,
              exchange_type: item.exchange_type,
              specification: item.specification,
              po_id: item.po_id,
              facilityId: facilityId,
              identifier: item.identifier,
              type: item.type,
              id: item.id ? item.id : null,
              item_category: item.item_category,
            },
          },
        );
      }),
    )
    .then((results) => {
      res.json({
        success: true,
        results: results,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};
exports.getExpensesByPending = (req, res) => {
  db.sequelize
    .query(
      `SELECT request_no,branch_name,particulars,type_of_expenses, month, date,status, SUM(amount) as total FROM expense WHERE status in ("Pending", "Admin Resend", "Rejected")  GROUP by request_no,type_of_expenses ORDER BY insert_at desc`,
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.json({ success: false, err }));
};

exports.addExpensesRemark = (req, res) => {
  const {
    remarks_id,
    request_no,
    remarks,
    remarks_by,
    date,
    general_remarks,
    facilityId,
  } = req.body;
  console.log(req.body);
  db.sequelize
    .query(
      `call addExpensesRemarks(:remarks_id,:request_no,:remarks,:remarks_by,:date,:general_remarks,:facilityId)`,
      {
        replacements: {
          remarks_id: remarks_id ? remarks_id : "0",
          request_no: request_no ? request_no : "",
          remarks: remarks ? remarks : "",
          remarks_by: remarks_by ? remarks_by : "",
          date: date ? date : "",
          general_remarks: general_remarks ? general_remarks : "",
          facilityId,
        },
      },
    )
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.addExpensesRemarkGeneral = (req, res) => {
  const {
    remarks_id,
    request_no,
    remarks,
    remarks_by,
    date,
    general_remarks,
    facilityId,
  } = req.body;
  console.log(req.body);
  db.sequelize
    .query(
      `call addExpensesRemarks(:remarks_id,:request_no,:remarks,:remarks_by,:date,:general_remarks,:facilityId)`,
      {
        replacements: {
          remarks_id: remarks_id ? remarks_id : "0",
          request_no: request_no ? request_no : "",
          remarks: remarks ? remarks : "",
          remarks_by: remarks_by ? remarks_by : "",
          date: date ? date : "",
          general_remarks: general_remarks ? general_remarks : "",
          facilityId,
        },
      },
    )
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.auditedPurchaseOrderPending = (req, res) => {
  db.sequelize
    .query(`call audited_purchase_order_pending()`)
    .then((results) => res.json({ success: true, results: results }))
    .catch((err) => res.json({ success: false, err }));
};
exports.getGRN = (req, res) => {
  db.sequelize
    .query(`select max(ifnull(grn,0))+1 as grn from purchase_order_list`)
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.json({ success: false, err }));
};

exports.deleteBankAccount = (req, res) => {
  const { id } = req.params;
  console.log(id);
  const stmt = `DELETE FROM bank_account_creation_table
  WHERE id="${id}"`;
  db.sequelize
    .query(stmt)
    .then((results) => res.json({ success: true }))
    .catch((err) => res.status(500).json({ err }));
};
exports.updateBankAccount = (req, res) => {
  console.log(req.body);
  db.sequelize
    .query(
      `UPDATE bank_account_creation_table SET bank_name = "${req.body.bankName}",account_name = "${req.body.accoutName}",account_number = "${req.body.AccountNumber}",account_short_code = "${req.body.accountShortCode}",purpose = "${req.body.purpose}",description = "${req.body.description}",vendor_name = "${req.body.vendorName}" WHERE id = "${req.body.id}" and facilityId="${req.body.facilityId}"`,
    )
    .then((results) => {
      res.json({
        success: true,
        results: results,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.updateAuditedFile = (req, res) => {
  db.sequelize
    .query(
      `update purchase_order set auditor_remark="${req.body.auditorRemark}",processed_by="${req.body.userId}", status="Disburse" where po_id="${req.body.PONo}"`,
    )
    .then(() => {
      req.body.tableData.forEach((item) => {
        db.sequelize.query(
          `update purchase_order_list set auditor_remark="${item.auditor_remark}" where po_id='${item.po_id}' and facilityId="${item.facilityId}"`,
        );
      });
    })
    .then((results) => {
      res.json({
        success: true,
        results: results,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getBankAccountTable = (req, res) => {
  db.sequelize
    .query(`SELECT * FROM bank_account_creation_table`)
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.json({ success: false, err }));
};

exports.getSupplier = (req, res) => {
  const { id, status } = req.params;

  db.sequelize
    .query(`call good_received(:status,:id)`, {
      replacements: {
        status: status,
        id: id,
      },
    })
    .then((results) => {
      res.json({ success: true, results: results });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

// async function getItemCode(description, facilityId) {
//   try {
//     // console.log(description, facilityId);
//     return await db.sequelize.query(
//       "call generate_item_code(:facilityId,:description)",
//       {
//         replacements: {
//           facilityId,
//           description,
//         },
//       }
//     );
//     // console.log(response, "ff");
//     // return response;
//   } catch (error) {
//     return error;
//   }
// }

async function numberGenerator(
  { query_type = "", facilityId = "" },
  callback = (f) => f,
  error = (f) => f,
) {
  db.sequelize
    .query("CALL nurmber_generator1(:query_type,:facilityId)", {
      replacements: {
        query_type,
        facilityId,
      },
    })
    .then(callback)
    .catch(error);
}

async function numberGeneratorUpdate(
  { query_type = "", in_number = null, facilityId = "" },
  callback = (f) => f,
  error = (f) => f,
) {
  db.sequelize
    .query("CALL update_number_generator(:query_type,:in_number,:facilityId)", {
      replacements: {
        query_type,
        in_number,
        facilityId,
      },
    })
    .then((results) => callback(results))
    .catch((err) => error(err));
}

async function addLog(
  {
    type = "",
    name = "",
    role = "",
    id_link = "",
    remark = "",
    user_id = "",
    query_type = "",
    status = "",
    amount = 0,
    facilityId = "",
  },
  callback = (f) => f,
  error = (f) => f,
) {
  // Direct INSERT — no stored procedure required
  db.sequelize
    .query(
      `INSERT INTO logs
        (type, name, amount, role, id_link, remark, user_id, status, facilityId, date)
       VALUES
        (:type, :name, :amount, :role, :id_link, :remark, :user_id, :status, :facilityId, NOW())`,
      {
        replacements: {
          type: String(type || "").slice(0, 250),
          name: name != null ? String(name).slice(0, 250) : null,
          amount: amount != null ? amount : null,
          role: role != null ? String(role).slice(0, 250) : null,
          id_link: String(id_link || "").slice(0, 250),
          remark: String(remark || "").slice(0, 250),
          user_id: String(user_id || "0").slice(0, 250),
          status: String(status || "REQUESTED").slice(0, 100),
          facilityId: String(facilityId || "").slice(0, 100),
        },
      },
    )
    .then(callback)
    .catch(error);
}

exports.insertApprovedMemo = (req, res) => {
  const {
    type = "",
    name = "",
    role = "",
    id_link = "",
    remark = "",
    user_id = "",
    amount = null,
    query_type = "",
    status = "",
    review_by = "",
    verify_by = "",
    description = "",
    approve_by = "",
    amount1 = null,
    total = null,
    paid_amount = null,
    facilityId,
  } = req.body;
  if (facilityId === "") {
    return res
      .status(500)
      .json({ success: false, err: "Facility ID is required" });
  }
  console.log(req.body, "==================================BODY");
  addLog(
    {
      type: type,
      name: name,
      amount: amount,
      role: role,
      id_link: id_link,
      remark: remark,
      user_id: user_id,
      query_type: query_type,
      status: status,
      facilityId: facilityId,
    },
    (resp) => {
      db.sequelize
        .query(
          `UPDATE memo
           SET amount = :amount,
               remark = :remark,
               approve_by = :approve_by,
               status = :status,
               review_by = :review_by,
               role = :role,
               description = :description,
               verify_by = :verify_by
           WHERE memo_id = :id_link and facilityId = :facilityId`,
          {
            replacements: {
              amount:
                query_type === "rejected"
                  ? 0
                  : (parseFloat(amount1) || 0) + (parseFloat(amount) || 0),
              remark,
              facilityId,
              approve_by:
                query_type === "rejected"
                  ? null
                  : status === "approved" || status === "completed"
                    ? approve_by || name
                    : null,
              role,
              review_by:
                status === "reviewed" ||
                status === "verified" ||
                status === "approved" ||
                status === "completed"
                  ? (review_by ?? name)
                  : null,
              verify_by:
                status === "verified" ||
                status === "approved" ||
                status === "completed"
                  ? (verify_by ?? name)
                  : null,
              description,
              id_link,
              status:
                status === "reviewed"
                  ? parseFloat(total) -
                      (parseFloat(amount) + parseFloat(amount1)) ===
                    0
                    ? status
                    : "Part Payment"
                  : status,
            },
          },
        )
        .then((results) => {
          res.json({ success: true, itemInfo: results[0] });
        })
        .catch((err) => {
          res.status(500).json({ success: false, err });
          console.log(err);
        });
    },
    (err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    },
  );
};

// exports.insertUpdateMemoData = (req, res) => {
//   const {
//     prefix,
//     from_name = "",
//     date = "",
//     amount = 0,
//     remark = "",
//     purpose = "",
//     raise_by = "",
//     user_id = "",
//     facilityId,
//     subject = "",
//     details = "",
//     recipient = "",
//     description = "",
//     query_type = "",
//     total = "",
//     pr_no = "",
//     reference_number = "",
//   } = req.body;

//   console.log(req.body, "==================================BODY");

//   numberGenerator({ query_type: "mm" }, (rev) => {
//     let code = rev[0].mm;
//     let _code = code;
//     let newCode = `${prefix}/${moment().format("YY")}/${code}`;

//     db.sequelize
//       .query(
//         `call insertMemo(:query_type,:from_name, :date, :purpose, :memo_id, :amount, :remark, :facilityId,:raise_by,:user_id,:subject,:details,:recipient,:description,:total,:pr_no,:reference_number)`,
//         {
//           replacements: {
//             query_type,
//             from_name,
//             date,
//             purpose,
//             memo_id: newCode,
//             amount,
//             remark,
//             facilityId,
//             raise_by,
//             user_id,
//             subject,
//             details,
//             recipient,
//             description,
//             total,
//             pr_no,
//             reference_number,
//           },
//         }
//       )
//       .then((results) => {
//         numberGeneratorUpdate(
//           { query_type: "mm", in_number: _code },
//           (rev) => {
//             res.json({
//               success: true,
//               results: results,
//               rev,
//               message: "Memo added successfully",
//             });
//           }
//         );
//       })
//       .catch((err) => {
//         console.log(err);
//         res.status(500).json({
//           success: false,
//           err,
//           message: "Error while trying to add memo",
//         });
//       });
//   });
// };

exports.insertUpdateMemoData = (req, res) => {
  const {
    prefix,
    from_name = "",
    date = "",
    amount = 0,
    amount1 = 0,
    remark = "",
    purpose = "",
    raise_by = "",
    user_id = "",
    facilityId,
    subject = "",
    details = "",
    recipient = "",
    description = "",
    query_type = "",
    total = "",
    pr_no = "",
    reference_number = "",
    approve_by = "",
    review_by = "",
    verify_by = "",
    priority = "Medium",
    role = "",
    status = "",
    name = "",
    supplier_name = "",
    supplier_code = "",
    supplier_number = "",
    account_code = "",
  } = req.body;

  console.log("📥 Incoming Body:", req.body);

  db.sequelize
    .query(
      `CALL insertMemo(
        :query_type,
        :from_name,
        :date,
        :purpose,
        :memo_id,
        :amount,
        :remark,
        :facilityId,
        :raise_by,
        :user_id,
        :subject,
        :details,
        :recipient,
        :description,
        :total,
        :pr_no,
        :reference_number,
        :status,
        :supplier_name,
        :supplier_code,
        :account_code,
        :supplier_number
      )`,
      {
        replacements: {
          query_type,
          from_name,
          date,
          purpose,
          memo_id: reference_number, // used as memo_id here
          amount,
          remark,
          facilityId,
          raise_by,
          user_id,
          subject,
          details,
          recipient,
          description,
          total,
          pr_no,
          reference_number,
          status,
          supplier_name: supplier_name || "",
          supplier_code: supplier_code || "",
          account_code: account_code || "",
          supplier_number: supplier_number || "",
        },
      },
    )
    .then(() => {
      // ✅ Log the action
      return addLog({
        type: "memo",
        name,
        role,
        id_link: reference_number,
        remark,
        user_id,
        query_type: "review",
        status,
        facilityId,
      });
    })
    .then(() => {
      res.json({
        success: true,
        message: "Memo inserted and updated successfully",
        memo_id: reference_number,
      });
    })
    .catch((err) => {
      console.error("❌ Error during insert/update of memo:", err);
      res.status(500).json({
        success: false,
        error: err.message || err,
        message: "Error during insert/update of memo",
      });
    });
};

exports.insertMemo = async (req, res) => {
  let files = req.files?.memo_documents?.map((i) => i.filename);
  console.log(files);

  try {
    let memoData;
    try {
      memoData = JSON.parse(req.body.memo_data);
    } catch (e) {
      console.error("Failed to parse memo data:", e);
      return res.status(400).json({ error: "Invalid memo data format" });
    }

    const {
      prefix,
      from_name = "",
      date = "",
      busName = "",
      amount = 0,
      remark = "",
      purpose = "",
      raise_by = "",
      user_id = "",
      facilityId,
      subject = "",
      details = "",
      recipient = "",
      description = "",
      query_type = "",
      total = "",
      expenses = [],
      justificationPoints = [],
      pr_no = null,
      reference_number = null,
      status = "REQUESTED",
      priority = "Medium",
      supplier_name = "",
      supplier_code = "",
      supplier_number = "",
      account_code = "",
    } = memoData;
    console.log("Parsed Memo Data:", expenses);
    const memo_documents = req?.files?.memo_documents || [];
    const { document_names = [] } = req.body;

    try {
      const generatedNumber = await getAndUpdateNumber("mm", facilityId);
      let code = parseInt(generatedNumber, 10);
      if (!Number.isFinite(code)) {
        throw new Error(
          `Invalid memo number generated for facility ${facilityId}: ${generatedNumber}`,
        );
      }

      // Keep sequence ahead of any memo_ids created outside the generator
      const [[{ maxn }]] = await db.sequelize.query(
        `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(memo_id, '/', -1) AS UNSIGNED)), 0) AS maxn
         FROM memo
         WHERE facilityId COLLATE utf8mb4_unicode_ci = :facilityId
           AND memo_id LIKE 'MEMO/%'`,
        { replacements: { facilityId } },
      );
      if (Number(maxn) >= code) {
        code = Number(maxn) + 1;
        await db.sequelize.query(
          `UPDATE number_generator
           SET code_no = :next
           WHERE prefix = 'mm' AND facilityId = :facilityId`,
          { replacements: { next: code + 1, facilityId } },
        );
      }

      const newCode = `MEMO/${moment().format("YY")}/${code}`;
      const transaction = await db.sequelize.transaction();

      try {
        console.log("Generating memo with code:", newCode);

        const memoStatus =
          String(query_type || "").toLowerCase() === "update_insert"
            ? "reviewed"
            : "pending";

        // Direct SQL — no stored procedure
        await db.sequelize.query(
          `INSERT INTO memo (
            from_name, date, purpose, memo_id, amount, remark, status,
            facilityId, raise_by, user_id, subject, details, recipient,
            description, supplier_name, supplier_number, supplier_code,
            account_code, total, reference_number, pr_no, priority
          ) VALUES (
            :from_name, :date, :purpose, :memo_id, :amount, :remark, :status,
            :facilityId, :raise_by, :user_id, :subject, :details, :recipient,
            :description, :supplier_name, :supplier_number, :supplier_code,
            :account_code, :total, :reference_number, :pr_no, :priority
          )`,
          {
            replacements: {
              from_name,
              date: date || moment().format("YYYY-MM-DD"),
              purpose,
              memo_id: newCode,
              amount: parseFloat(amount) || 0,
              remark: remark || "",
              status: memoStatus,
              facilityId,
              raise_by,
              user_id,
              subject,
              details: details || purpose || "",
              recipient: recipient || "Managing Director",
              description: description || "",
              supplier_name: supplier_name || "",
              supplier_number: supplier_number || "",
              supplier_code: supplier_code || "",
              account_code: account_code || "",
              total: parseFloat(total) || 0,
              reference_number: reference_number || "",
              pr_no: pr_no || null,
              priority: priority || "Medium",
            },
            transaction,
          },
        );

        if (pr_no) {
          await db.sequelize.query(
            `UPDATE purchase_requisition
             SET memo_id = :memo_id,
                 amount = IFNULL(amount, 0) + IFNULL(:amount, 0)
             WHERE pr_no COLLATE utf8mb4_unicode_ci = :pr_no
               AND facilityId COLLATE utf8mb4_unicode_ci = :facilityId`,
            {
              replacements: {
                memo_id: newCode,
                amount: parseFloat(amount) || 0,
                pr_no,
                facilityId,
              },
              transaction,
            },
          );
        }

        // Insert expenses
        if (expenses && expenses.length > 0) {
          const expensePromises = expenses.map((expense) => {
            return db.sequelize.query(
              `INSERT INTO item_list (
                  memo_id,
                  item_name,
                  description,
                  unit_cost,
                  quantity,
                  item_code,
                  item_subhead,
                  facilityId
                )
                VALUES (
                  :memo_id,
                  :item_name,
                  :description,
                  :unit_cost,
                  :quantity,
                  :item_code,
                  :item_subhead,
                  :facilityId
                )`,
              {
                replacements: {
                  memo_id: newCode,
                  item_name: expense.item,
                  description: expense.description,
                  unit_cost: expense.unitCost,
                  quantity: expense.quantity || 1,
                  item_code: expense.item_code,
                  item_subhead: expense.chart_code,
                  facilityId,
                },
                transaction,
              },
            );
          });

          await Promise.all(expensePromises);
        }
        if (justificationPoints && justificationPoints.length > 0) {
          const justificationPromises = justificationPoints.map((item) => {
            return db.sequelize.query(
              `INSERT INTO justification (
                memo_id,
                text,
                facilityId
                )
                VALUES (
                :memo_id,
                :text,
                :facilityId
                )`,
              {
                replacements: {
                  memo_id: newCode,
                  text: item.text,
                  facilityId,
                },
                transaction,
              },
            );
          });
          await Promise.all(justificationPromises);
        }
        // Insert uploaded documents
        if (memo_documents && memo_documents.length > 0) {
          for (let i = 0; i < memo_documents.length; i++) {
            const file = memo_documents[i];
            const customName = Array.isArray(document_names)
              ? document_names[i]
              : document_names;

            await db.sequelize.query(
              `INSERT INTO memo_documents
              (memo_id, document_name, file_path, original_name, file_size, mime_type, facilityId)
              VALUES (:memo_id, :document_name, :file_path, :original_name, :file_size, :mime_type, :facilityId)`,
              {
                replacements: {
                  memo_id: newCode,
                  document_name: customName || file.originalname,
                  file_path: file.filename,
                  original_name: file.originalname,
                  file_size: file.size,
                  mime_type: file.mimetype,
                  facilityId,
                },
                transaction,
              },
            );
          }
        }

        await transaction.commit();

        // Logging should not fail a successful business transaction.
        try {
          await addLog(
            {
              type: "Memo",
              name: subject,
              amount: amount,
              role: raise_by,
              id_link: newCode,
              remark: remark,
              user_id: user_id,
              query_type: query_type,
              status: status,
              facilityId: facilityId,
            },
            () => console.log("Log entry added"),
            (err) => console.error("Error adding log:", err),
          );
        } catch (logErr) {
          console.error("Memo created but log insert failed:", logErr);
        }

        res.json({
          success: true,
          results: [{ memo_id: newCode }],
          rev: [{ mm: code }],
          message: "Memo, expenses and documents added successfully",
        });
      } catch (txError) {
        await transaction.rollback();
        throw txError;
      }
    } catch (error) {
      console.error("Error in memo insertion:", error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: "Error while trying to add memo",
      });
    }
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: "Server error occurred",
    });
  }
};

exports.updateMemoNew = async (req, res) => {
  try {
    // Parse memo data from request
    let memoData;
    try {
      memoData = JSON.parse(req.body.memo_data);
    } catch (e) {
      console.error("Failed to parse memo data:", e);
      return res.status(400).json({ error: "Invalid memo data format" });
    }

    const {
      memo_id,
      from_name = "",
      date = "",
      busName = "",
      amount = 0,
      remark = "",
      purpose = "",
      raise_by = "",
      user_id = "",
      facilityId,
      subject = "",
      details = "",
      recipient = "",
      priority = "Medium",
      description = "",
      total = "",
      expenses = [],
      pr_no = null,
      reference_number = null,
      status = "",
      justificationPoints = [],
      existing_document_ids = [], // IDs of docs still kept by user
      supplier_name = "",
      supplier_code = "",
      supplier_number = "",
      account_code = "",
    } = memoData;

    const memo_documents = req?.files?.memo_documents || [];
    const { document_names = [] } = req.body;

    console.log(memoData, "=== UPDATE MEMO DATA ===");
    console.log(memo_documents, "=== NEW DOCUMENTS UPLOADED ===");

    await db.sequelize.query(
      `CALL insertMemo(
        'update',
        :from_name,
        :date,
        :purpose,
        :memo_id,
        :amount,
        :remark,
        :facilityId,
        :raise_by,
        :user_id,
        :subject,
        :details,
        :recipient,
        :description,
        :total,
        :pr_no,
        :reference_number,
        :status,
        :supplier_name,
        :supplier_code,
        :account_code,
        :supplier_number
      )`,
      {
        replacements: {
          from_name,
          date,
          purpose,
          memo_id,
          amount,
          remark,
          facilityId,
          raise_by,
          user_id,
          subject,
          details,
          recipient,
          description,
          total,
          pr_no,
          reference_number: reference_number || "",
          status,
          supplier_name: supplier_name || "",
          supplier_code: supplier_code || "",
          account_code: account_code || "",
          supplier_number: supplier_number || "",
        },
      },
    );

    await db.sequelize.query(
      `DELETE FROM item_list WHERE memo_id = :memo_id and facilityId=:facilityId`,
      {
        replacements: { memo_id, facilityId },
      },
    );

    if (expenses && expenses.length > 0) {
      await Promise.all(
        expenses.map((expense) => {
          return db.sequelize.query(
            `INSERT INTO item_list (
                memo_id,
                item_name,
                description,
                unit_cost,
                quantity,
                item_code,
                item_subhead,
                facilityId
              ) VALUES (
                :memo_id,
                :item_name,
                :description,
                :unit_cost,
                :quantity,
                :item_code,
                :item_subhead,
                :facilityId
              )`,
            {
              replacements: {
                memo_id,
                item_name: expense.item,
                description: expense.description,
                unit_cost: expense.unitCost,
                quantity: expense.quantity || 0,
                item_code: expense.item_code,
                item_subhead: expense.chart_code,
                facilityId,
              },
            },
          );
        }),
      );
    }

    const [existingDocs] = await db.sequelize.query(
      `SELECT transaction_id, file_path FROM memo_documents WHERE memo_id = :memo_id and facilityId=:facilityId`,
      { replacements: { memo_id, facilityId } },
    );

    await db.sequelize.query(
      `DELETE FROM justification WHERE memo_id = :memo_id and facilityId=:facilityId`,
      {
        replacements: { memo_id, facilityId },
      },
    );
    if (justificationPoints && justificationPoints.length > 0) {
      const justificationPromises = justificationPoints.map((item) => {
        return db.sequelize.query(
          `INSERT INTO justification (
                memo_id,
                text,
                facilityId
                )
                VALUES (
                :memo_id,
                :text,
                :facilityId
                )`,
          {
            replacements: {
              memo_id: memo_id,
              text: item.text,
              facilityId,
            },
          },
        );
      });
      await Promise.all(justificationPromises);
    }
    const docsToDelete = existingDocs.filter(
      (doc) => !existing_document_ids.includes(doc.transaction_id),
    );

    for (const doc of docsToDelete) {
      // Delete from DB
      await db.sequelize.query(
        `DELETE FROM memo_documents WHERE transaction_id = :id and facilityId=:facilityId`,
        {
          replacements: { id: doc.transaction_id, facilityId },
        },
      );

      // Delete file from filesystem
      const filePath = path.join(
        __dirname,
        "../../public/uploads",
        doc.file_path,
      );
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    for (let i = 0; i < memo_documents.length; i++) {
      const file = memo_documents[i];
      const customName = Array.isArray(document_names)
        ? document_names[i]
        : document_names;

      await db.sequelize.query(
        `INSERT INTO memo_documents
        (memo_id, document_name, file_path, original_name, file_size, mime_type, facilityId)
        VALUES (:memo_id, :document_name, :file_path, :original_name, :file_size, :mime_type, :facilityId)`,
        {
          replacements: {
            memo_id,
            document_name: customName || file.originalname,
            file_path: file.filename,
            original_name: file.originalname,
            file_size: file.size,
            mime_type: file.mimetype,
            facilityId,
          },
        },
      );
    }

    await addLog(
      {
        type: "Memo Update",
        name: subject,
        amount: amount,
        role: raise_by,
        id_link: memo_id,
        remark: remark,
        user_id: user_id,
        query_type: "update",
        status: status,
        facilityId: facilityId,
      },
      () => console.log("Log entry for memo update added"),
      (err) => console.error("Failed to add log:", err),
    );

    res.json({
      success: true,
      results: [{ memo_id }],
      message: "Memo updated successfully",
    });
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: "Server error occurred",
    });
  }
};

exports.memoItemList = async (req, res) => {
  try {
    const {
      query_type = "",
      from_name = "",
      date = "",
      purpose = "",
      memo_id = "",
      amount = 0,
      remark = "",
      facilityId = "",
      raise_by = "",
      user_id = "",
      subject = "",
      details = "",
      recipient = "",
      description = "",
      total = 0,
      pr_no = "",
      reference_number = "",
      status = "",
      supplier_name = "",
      supplier_code = "",
      supplier_number = "",
      account_code = "",
    } = req.body;

    console.log("📥 Incoming Body:", req.body);

    const qt = String(query_type || "").toLowerCase();

    // Select paths: direct SQL — insertMemo/getDocument SPs mix collations with app connection
    if (qt === "select" || qt === "new_select") {
      if (!memo_id) {
        return res.status(400).json({
          success: false,
          message: "memo_id is required",
        });
      }

      const [results] = await db.sequelize.query(
        `SELECT * FROM item_list
         WHERE memo_id COLLATE utf8mb4_general_ci = CONVERT(:memo_id USING utf8mb4) COLLATE utf8mb4_general_ci
         ${
           facilityId
             ? "AND facilityId COLLATE utf8mb4_general_ci = CONVERT(:facilityId USING utf8mb4) COLLATE utf8mb4_general_ci"
             : ""
         }`,
        {
          replacements: facilityId ? { memo_id, facilityId } : { memo_id },
        },
      );

      const [attachments] = await db.sequelize.query(
        `SELECT * FROM memo_documents
         WHERE memo_id COLLATE utf8mb4_general_ci = CONVERT(:memo_id USING utf8mb4) COLLATE utf8mb4_general_ci`,
        { replacements: { memo_id } },
      );

      return res.json({
        success: true,
        message: "Memo processed successfully",
        results: results || [],
        attachments: attachments || [],
      });
    }

    // insertMemo expects 22 args (no priority)
    const results = await db.sequelize.query(
      `CALL insertMemo(
        :query_type,
        :from_name,
        :date,
        :purpose,
        :memo_id,
        :amount,
        :remark,
        :facilityId,
        :raise_by,
        :user_id,
        :subject,
        :details,
        :recipient,
        :description,
        :total,
        :pr_no,
        :reference_number,
        :status,
        :supplier_name,
        :supplier_code,
        :account_code,
        :supplier_number
      )`,
      {
        replacements: {
          query_type,
          from_name,
          date,
          purpose,
          memo_id,
          amount,
          remark,
          facilityId,
          raise_by,
          user_id,
          subject,
          details,
          recipient,
          description,
          total,
          pr_no,
          reference_number,
          status,
          supplier_name: supplier_name || "",
          supplier_code: supplier_code || "",
          account_code: account_code || "",
          supplier_number: supplier_number || "",
        },
      },
    );

    const [attachments] = await db.sequelize.query(
      `SELECT * FROM memo_documents
       WHERE memo_id COLLATE utf8mb4_general_ci = CONVERT(:memo_id USING utf8mb4) COLLATE utf8mb4_general_ci`,
      { replacements: { memo_id } },
    );

    console.log("✅ Query Results:", results);

    return res.json({
      success: true,
      message: "Memo processed successfully",
      results,
      attachments: attachments || [],
    });
  } catch (err) {
    console.error("❌ Error inserting memo:", err);
    return res.status(500).json({
      success: false,
      message: "Error while trying to add memo",
      error: err.message || err,
    });
  }
};

exports.updateMemo = async (req, res) => {
  try {
    const {
      query_type = "update",
      memo_id = "",
      from_name = "",
      date = "",
      purpose = "",
      raise_by = "",
      user_id = null,
      facilityId,
      subject = "",
      details = "",
      recipient = "",
      description = "",
      name = "",
      role = "",
      amount = 0,
      remark = "",
      total = "",
      pr_no = "",
      reference_number = "",
      expenses = [],
      status = "",
      priority = "Medium",
      supplier_name = "",
      supplier_code = "",
      supplier_number = "",
      account_code = "",
    } = req.body;

    const [results] = await db.sequelize.query(
      `CALL insertMemo(
        :query_type,
        :from_name,
        :date,
        :purpose,
        :memo_id,
        :amount,
        :remark,
        :facilityId,
        :raise_by,
        :user_id,
        :subject,
        :details,
        :recipient,
        :description,
        :total,
        :pr_no,
        :reference_number,
        :status,
        :supplier_name,
        :supplier_code,
        :account_code,
        :supplier_number
      )`,
      {
        replacements: {
          query_type,
          from_name,
          date,
          purpose,
          memo_id,
          amount,
          remark,
          facilityId,
          raise_by,
          user_id,
          subject,
          details,
          recipient,
          description,
          total,
          pr_no,
          reference_number,
          status,
          supplier_name: supplier_name || "",
          supplier_code: supplier_code || "",
          account_code: account_code || "",
          supplier_number: supplier_number || "",
        },
      },
    );

    /** ------------------------------
     *  Logging
     * ------------------------------ */
    if (!name || !role || !memo_id || !user_id) {
      console.error("⚠️ Missing required parameters for addLog");
    } else {
      try {
        await addLog({
          type: "memo",
          name,
          role,
          id_link: memo_id,
          remark,
          user_id,
          query_type,
          status: "updated",
        });
        console.log("✅ Log added successfully");
      } catch (logError) {
        console.error("❌ Error adding log:", logError);
      }
    }

    /** ------------------------------
     *  Expenses update/insert
     * ------------------------------ */
    if (expenses.length > 0) {
      const expensePromises = expenses.map((expense) => {
        if (expense.item_list_id) {
          // Update existing expense
          return db.sequelize.query(
            `UPDATE item_list
             SET item_name = :item_name, unit_cost = :unit_cost, quantity = :quantity
             WHERE item_list_id = :item_list_id`,
            {
              replacements: {
                item_list_id: expense.item_list_id,
                item_name: expense.item_name,
                unit_cost: expense.unit_cost,
                quantity: expense.quantity,
              },
            },
          );
        } else {
          // Insert new expense
          return db.sequelize.query(
            `INSERT INTO item_list (
              memo_id,
              item_name,
              description,
              unit_cost,
              quantity,
              item_code,
              item_subhead
            ) VALUES (
              :memo_id,
              :item_name,
              :description,
              :unit_cost,
              :quantity,
              :item_code,
              :item_subhead
            )`,
            {
              replacements: {
                memo_id,
                item_name: expense.item_name,
                description: expense.description,
                unit_cost: expense.unit_cost,
                quantity: expense.quantity,
                item_code: expense.item_code,
                item_subhead: expense.item_subhead,
              },
            },
          );
        }
      });

      await Promise.all(expensePromises);

      return res.json({
        success: true,
        message: "Memo and expenses updated successfully",
        results,
      });
    }

    /** ------------------------------
     *  No expenses response
     * ------------------------------ */
    return res.json({
      success: true,
      message: "Memo updated successfully (no expenses to update)",
      results,
    });
  } catch (err) {
    console.error("❌ Error updating memo:", err);
    return res.status(500).json({
      success: false,
      message: "Error while trying to update memo",
      error: err.message || err,
    });
  }
};

exports.getJustification = (req, res) => {
  const { memo_id, facilityId } = req.query;

  db.sequelize
    .query(
      `SELECT * FROM justification where memo_id=:memo_id and facilityId=:facilityId`,
      {
        replacements: {
          memo_id,
          facilityId,
        },
      },
    )
    .then((results) => {
      res.json({
        success: true,
        results: results[0],
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({
        success: false,
        err,
        message: "Error While trying to add product name",
      });
    });
};
exports.productName = (req, res) => {
  const { product_name = "", product_type = "", store = "" } = req.body;

  db.sequelize
    .query(`call product_name(:product_name, :product_type, :store)`, {
      replacements: {
        product_name,
        product_type,
        store,
      },
    })
    .then((results) => {
      console.log(results, "Phisherman did!");

      res.json({
        success: true,
        results: results,
        message: "Product name added successfully!",
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({
        success: false,
        err,
        message: "Error While trying to add product name",
      });
    });
};

exports.addProductionData = async (req, res) => {
  const { name = "", store = "", raw_materials = [], expenses = [] } = req.body;

  if (!name || !store || !raw_materials.length || !expenses.length) {
    return res.status(400).json({
      success: false,
      message:
        "Invalid data. 'name', 'store', 'raw_materials', and 'expenses' are required.",
    });
  }

  try {
    // Save production and get production_id
    const [results] = await db.sequelize.query(
      `CALL add_production(:name, :store)`,
      { replacements: { name, store } },
    );
    const production_id = results.production_id;

    if (!production_id) {
      throw new Error("Production ID not generated.");
    }

    // Insert raw materials
    for (const material of raw_materials) {
      await db.sequelize.query(
        `CALL add_raw_material(:production_id, :material_name, :item_name, :quantity, :price)`,
        {
          replacements: {
            production_id,
            material_name: material.name,
            item_name: name,
            quantity: material.quantity,
            price: material.price,
          },
        },
      );
    }

    // Insert expenses
    for (const expense of expenses) {
      await db.sequelize.query(
        `CALL add_expense(:production_id, :expense_name, :item_name, :amount)`,
        {
          replacements: {
            production_id,
            expense_name: expense.name,
            item_name: name,
            amount: expense.amount,
          },
        },
      );
    }

    res.json({
      success: true,
      message: "Production data added successfully!",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Error while adding production data",
      error: err.message,
    });
  }
};

exports.getProducts = (req, res) => {
  const { store = "" } = req.params;
  db.sequelize
    .query(`SELECT * FROM product where store=:store`, {
      replacements: {
        store: store,
      },
    })
    .then((results) => {
      console.log(results, "Phisherman did!");

      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getProductionDetailsById = async (req, res) => {
  try {
    const { production_id } = req.params;

    if (!production_id) {
      return res.status(400).json({
        success: false,
        message: "Production ID is required.",
      });
    }

    const results = await db.sequelize.query(
      `CALL get_production_details_by_id(:production_id)`,
      { replacements: { production_id } },
    );

    if (!results.length) {
      return res.status(404).json({
        success: false,
        message: "No production found for the given ID.",
      });
    }

    // Transform results into structured JSON
    const production = results.reduce((acc, row) => {
      const {
        production_id,
        production_name,
        store,
        created_at,
        material_name,
        material_quantity,
        material_price,
        expense_name,
        expense_amount,
      } = row;

      if (!acc.production_id) {
        acc.production_id = production_id;
        acc.production_name = production_name;
        acc.store = store;
        acc.created_at = created_at;
        acc.raw_materials = [];
        acc.expenses = [];
      }

      // Add raw materials if not already present
      if (
        material_name &&
        !acc.raw_materials.some((material) => material.name === material_name)
      ) {
        acc.raw_materials.push({
          name: material_name,
          quantity: material_quantity,
          price: material_price,
        });
      }

      // Add expenses if not already present
      if (
        expense_name &&
        !acc.expenses.some((expense) => expense.name === expense_name)
      ) {
        acc.expenses.push({
          name: expense_name,
          amount: expense_amount,
        });
      }

      return acc;
    }, {});

    res.json({
      success: true,
      data: production,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Error while fetching production details",
      error: err.message,
    });
  }
};

exports.getAllProductionsByStore = async (req, res) => {
  try {
    const { store } = req.params;

    if (!store) {
      return res.status(400).json({
        success: false,
        message: "Store name is required.",
      });
    }

    const results = await db.sequelize.query(
      `CALL get_all_productions_by_store(:store)`,
      { replacements: { store } },
    );

    if (!results.length) {
      return res.status(404).json({
        success: false,
        message: "No productions found for the given store.",
      });
    }

    // Transform results into structured JSON
    const productions = results.reduce((acc, row) => {
      const {
        production_id,
        production_name,
        store,
        created_at,
        material_name,
        material_quantity,
        material_price,
        expense_name,
        expense_amount,
      } = row;

      // Find or create the production object
      let production = acc.find((prod) => prod.production_id === production_id);
      if (!production) {
        production = {
          production_id,
          production_name,
          store,
          created_at,
          raw_materials: [],
          expenses: [],
        };
        acc.push(production);
      }

      // Add raw materials if not already present
      if (
        material_name &&
        !production.raw_materials.some(
          (material) => material.name === material_name,
        )
      ) {
        production.raw_materials.push({
          name: material_name,
          quantity: material_quantity,
          price: material_price,
        });
      }

      // Add expenses if not already present
      if (
        expense_name &&
        !production.expenses.some((expense) => expense.name === expense_name)
      ) {
        production.expenses.push({
          name: expense_name,
          amount: expense_amount,
        });
      }

      return acc;
    }, []);

    res.json({
      success: true,
      data: productions,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Error while fetching productions",
      error: err.message,
    });
  }
};

/**
 * Memo list without stored procedures (avoids collation errors from getMemoList).
 * Mirrors former getMemoList query_type branches.
 */
async function fetchMemoList({
  facilityId,
  status = "all",
  query_type = "list",
  userId = "",
  memo_id = "0",
} = {}) {
  const qt = String(query_type || "list").trim();
  const replacements = {
    facilityId,
    status: status || "all",
    userId: userId || "",
    memo_id: memo_id && String(memo_id) !== "0" ? String(memo_id) : null,
  };

  let sql;
  switch (qt) {
    case "voucher":
      sql = `
        SELECT *
        FROM memo
        WHERE facilityId COLLATE utf8mb4_unicode_ci = :facilityId
          AND status IN ('approved', 'Pv Generated')
        ORDER BY date DESC`;
      break;
    case "re_list":
      sql = `
        SELECT *
        FROM memo
        WHERE facilityId COLLATE utf8mb4_unicode_ci = :facilityId
          AND status = 'reviewed'
        ORDER BY date DESC`;
      break;
    case "closed":
      sql = `
        SELECT *
        FROM memo
        WHERE facilityId COLLATE utf8mb4_unicode_ci = :facilityId
          AND status = 'closed'
        ORDER BY date DESC`;
      break;
    case "list_by_id":
      sql = `
        SELECT *
        FROM memo
        WHERE facilityId COLLATE utf8mb4_unicode_ci = :facilityId
          AND (:status = 'all' OR status = :status)
          AND memo_id COLLATE utf8mb4_unicode_ci = :memo_id
        ORDER BY date DESC`;
      break;
    case "others":
      sql = `
        SELECT *
        FROM memo
        WHERE facilityId COLLATE utf8mb4_unicode_ci = :facilityId
          AND status IN ('pending', 'Rejected')
          AND user_id COLLATE utf8mb4_unicode_ci = :userId
        ORDER BY date DESC`;
      break;
    case "initial":
      sql = `
        SELECT m.*,
               (
                 SELECT l.remark
                 FROM logs l
                 WHERE l.status = 'returned'
                   AND l.id_link COLLATE utf8mb4_unicode_ci = m.memo_id COLLATE utf8mb4_unicode_ci
                 LIMIT 1
               ) AS last_return_remark
        FROM memo m
        WHERE m.facilityId COLLATE utf8mb4_unicode_ci = :facilityId
          AND m.status IN ('pending', 'returned')
          AND m.user_id COLLATE utf8mb4_unicode_ci = :userId
        ORDER BY m.date DESC`;
      break;
    case "review":
      sql = `
        SELECT m.*,
               (
                 SELECT l.remark
                 FROM logs l
                 WHERE l.status = 'rejected'
                   AND l.id_link COLLATE utf8mb4_unicode_ci = m.memo_id COLLATE utf8mb4_unicode_ci
                 LIMIT 1
               ) AS last_return_remark
        FROM memo m
        WHERE m.facilityId COLLATE utf8mb4_unicode_ci = :facilityId
          AND (IFNULL(m.total, 0) - IFNULL(m.amount, 0)) > 0
          AND m.status IN ('pending', 'rejected', 'Part Payment')
        ORDER BY m.date DESC`;
      break;
    case "list":
    default:
      sql = `
        SELECT *
        FROM memo
        WHERE facilityId COLLATE utf8mb4_unicode_ci = :facilityId
          AND (:status = 'all' OR status = :status)
        ORDER BY date DESC`;
      break;
  }

  return db.sequelize.query(sql, {
    replacements,
    type: QueryTypes.SELECT,
  });
}

exports.getMemos = async (req, res) => {
  try {
    const { facilityId, status, userId, query_type } = req.params;
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }
    const results = await fetchMemoList({
      facilityId,
      status,
      userId,
      query_type,
      memo_id: "0",
    });
    return res.json({ success: true, results });
  } catch (err) {
    console.error("getMemos:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch memos",
      err: err.message,
    });
  }
};

exports.getVoucherMemos = async (req, res) => {
  try {
    const { facilityId, status } = req.params;
    const { dateFrom, dateTo } = req.query;
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const replacements = {
      facilityId,
      status: status || "approved",
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
    };

    let sql = `
      SELECT *
      FROM memo
      WHERE facilityId COLLATE utf8mb4_unicode_ci = :facilityId
        AND status IN ('approved', 'Pv Generated')`;
    if (dateFrom && dateTo) {
      sql += ` AND date BETWEEN :dateFrom AND :dateTo`;
    } else if (dateFrom) {
      sql += ` AND date >= :dateFrom`;
    } else if (dateTo) {
      sql += ` AND date <= :dateTo`;
    }
    sql += ` ORDER BY date DESC`;

    const results = await db.sequelize.query(sql, {
      replacements,
      type: QueryTypes.SELECT,
    });
    return res.json({ success: true, results });
  } catch (err) {
    console.error("getVoucherMemos:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch voucher memos",
      err: err.message,
    });
  }
};

exports.getMemosByID = async (req, res) => {
  try {
    const {
      facilityId = "",
      status = "",
      userId = "",
      query_type = "",
      memo_id = "",
    } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const results = await fetchMemoList({
      facilityId,
      status,
      userId,
      query_type: query_type || "list_by_id",
      memo_id,
    });
    return res.json({ success: true, results });
  } catch (err) {
    console.error("getMemosByID:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch memo",
      err: err.message,
    });
  }
};
export const getMemoDataById = async (req, res) => {
  try {
    const { facilityId, memo_id } = req.query;

    const [
      businessResult,
      memoResult,
      userResult,
      itemListResult,
      justificationData,
      logData,
    ] = await Promise.all([
      db.sequelize.query(
        `SELECT business_name FROM business WHERE id = :facilityId`,
        { replacements: { facilityId } },
      ),
      db.sequelize.query(
        `SELECT date, priority, subject, purpose, memo_id, user_id
         FROM memo
         WHERE facilityId = :facilityId AND memo_id = :memo_id`,
        { replacements: { facilityId, memo_id } },
      ),
      // userResult is queried only if memo exists
    ]);

    // If memo not found → return early
    if (!memoResult[0] || memoResult[0].length === 0) {
      return res.status(404).json({
        success: false,
        message: "Memo not found",
      });
    }

    const memo = memoResult[0][0];

    const [
      userResultFull,
      itemListResultFull,
      justificationDataFull,
      logDataFull,
    ] = await Promise.all([
      db.sequelize.query(
        `SELECT
          CONCAT(u.firstname, ' ', u.lastname) AS fullName,
          d.departmentName,
          u.role,
          u.email
        FROM users u
        JOIN Departments d ON u.departmentId = d.id
        WHERE u.id = :userId`,
        { replacements: { userId: memo.user_id } },
      ),
      db.sequelize.query(
        `SELECT
          description AS name,
          quantity AS qty,
          unit_cost AS unitPrice,
          (quantity * unit_cost) AS total
        FROM item_list
        WHERE memo_id = :memo_id AND facilityId = :facilityId`,
        { replacements: { memo_id, facilityId } },
      ),
      db.sequelize.query(
        `SELECT text
         FROM justification
         WHERE memo_id = :memo_id AND facilityId = :facilityId`,
        { replacements: { memo_id, facilityId } },
      ),
      db.sequelize.query(
        `SELECT
          l.user_id,
          l.remark,
          CONCAT(u.firstname, ' ', u.lastname) AS person_name,
          u.role,
          l.status,
          l.date
        FROM logs l
        JOIN users u ON l.user_id = u.id
        WHERE l.type = 'memo'
          AND l.id_link = :id_link
          AND l.facilityId = :facilityId`,
        {
          replacements: {
            id_link: `${memo_id}`,
            facilityId,
          },
        },
      ),
    ]);

    const reviewByLog =
      logDataFull[0]
        ?.filter((log) => log.status === "reviewed")
        .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;

    const approvedByLog =
      logDataFull[0]
        ?.filter((log) => log.status === "approved")
        .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;

    return res.json({
      success: true,
      data: {
        company: businessResult[0][0]?.business_name || "N/A",
        memoId: memo.memo_id,
        date: memo.date ? moment(memo.date).format("MMMM Do, YYYY") : "N/A",
        priority: memo.priority || "Medium",
        classification: "CONFIDENTIAL",
        to: {
          name: "Managing Director",
          title: "Chief Executive Officer",
          department: "Executive Office",
        },
        from: {
          name: userResultFull[0][0]?.fullName || "N/A",
          title: userResultFull[0][0]?.role || "N/A",
          department: userResultFull[0][0]?.departmentName || "N/A",
          email: userResultFull[0][0]?.email || "N/A",
        },
        subject: memo.subject || "N/A",
        description: memo.purpose || "N/A",

        expenses: [
          {
            category: "Computing Equipment",
            items:
              itemListResultFull[0]?.map((item) => ({
                name: item.name,
                qty: item.qty,
                unitPrice: item.unitPrice,
                total: item.total,
              })) || [],
          },
        ],

        grandTotal:
          Number(
            itemListResultFull[0]?.reduce((sum, item) => sum + item.total, 0),
          ) || 0,

        justification: justificationDataFull[0]?.map((j) => j.text) || [],

        finalRemarks: approvedByLog?.remark || "N/A",

        reviewedBy: {
          name: reviewByLog?.person_name || "N/A",
          title: reviewByLog?.role || "N/A",
          date: reviewByLog?.date
            ? moment(reviewByLog.date).format("DD/MM/YYYY")
            : "N/A",
        },

        approvedBy: {
          name: approvedByLog?.person_name || "N/A",
          title: approvedByLog?.role || "N/A",
          date: approvedByLog?.date
            ? moment(approvedByLog.date).format("DD/MM/YYYY")
            : "N/A",
        },
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, err: err.message });
  }
};

// exports.getMemos = (req, res) => {
//   const { facilityId, status } = req.params;
//   console.log(facilityId);
//   db.sequelize
//     .query(
//       `SELECT * FROM memo where facilityId=:facilityId and status=:status`,
//       {
//         replacements: {
//           facilityId: facilityId,
//           status,
//         },
//       }
//     )
//     .then((results) => {
//       res.json({ success: true, results: results[0] });
//     })
//     .catch((err) => {
//       console.log(err);
//       res.status(500).json({ success: false, err });
//     });
// };
exports.getMemoById = (req, res) => {
  const { facilityId, status } = req.params;
  const { memo_id } = req.query;

  db.sequelize
    .query(
      `
      SELECT
        m.*,
        md.document_name,
        md.file_path,
        md.original_name,
        md.file_size,
        md.mime_type,
        md.transaction_id as transaction_id,
        md.created_at AS document_created_at
      FROM memo m
      LEFT JOIN memo_documents md
        ON m.memo_id = md.memo_id
      WHERE m.facilityId = :facilityId
        AND m.status = :status
        AND m.memo_id = :memo_id
      `,
      {
        replacements: {
          facilityId,
          status,
          memo_id,
        },
      },
    )
    .then(([results]) => {
      res.json({
        success: true,
        memo: results.length > 0 ? results[0] : null,
        documents: results
          .filter((r) => r.document_name) // filter out rows with no documents
          .map((r) => ({
            transaction_id: r.transaction_id,
            document_name: r.document_name,
            file_path: r.file_path,
            original_name: r.original_name,
            file_size: r.file_size,
            mime_type: r.mime_type,
            created_at: r.document_created_at,
          })),
      });
    })
    .catch((err) => {
      console.error(err);
      res.status(500).json({ success: false, err });
    });
};

exports.createPv = (req, res) => {
  const {
    prefix,
    date = "",
    busName = "",
    amount = 0,
    purpose = "",
    facilityId,
    document = "",
    mode_of_payment = "",
    query_type = "insert",
    memo_id = "",
  } = req.body;
  const pdfData = req.file || "aa";
  console.log(pdfData);
  numberGenerator(
    { query_type: "pv" },
    (rev) => {
      let code = rev[0].pv;
      console.log(code, rev);
      let _code = code + 1;
      let newCode = `BIT/${prefix}/${moment().format("YY")}/${code}`;
      console.log(newCode);
      let pv_number = newCode;
      db.sequelize
        .query(
          `call createPv(:query_type, :mode_of_payment,:amount,:date,:document,:pv_number,:purpose,:memo_id,:facilityId)`,
          {
            replacements: {
              query_type,
              mode_of_payment,
              amount,
              date,
              document: pdfData,
              pv_number,
              purpose,
              memo_id,
              facilityId,
            },
          },
        )
        .then((results) => {
          numberGeneratorUpdate(
            { query_type: "pv", in_number: _code },
            (rev) => {
              res.json({
                success: true,
                results: results,
                rev,
                message: "Added",
              });
            },
          );
        })
        .catch((err) => {
          console.log(err);
          res.status(500).json({
            success: false,
            err,
            message: "Error While trying to create pv",
          });
        });
    },
    (err) => {
      console.log(err);
    },
  );
};

exports.getPv = (req, res) => {
  const { pv } = req.query;
  console.log(pv);
  db.sequelize
    .query(`SELECT * FROM pv_collection WHERE memo_id = :memo_id`, {
      replacements: { memo_id: pv },
    })
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getPvAndMemo = (req, res) => {
  const { facilityId, status } = req.params;
  const { memo_id } = req.query;
  console.log(memo_id);
  db.sequelize
    .query(
      `SELECT m.*, p.* FROM memo m JOIN pv_collection p ON m.memo_id = p.memo_id WHERE m.facilityId = :facilityId
      AND m.memo_id = :memo_id;`,
      {
        replacements: {
          memo_id: memo_id,
          facilityId: facilityId,
          status: status,
        },
      },
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getSupplier2 = (req, res) => {};

exports.getSupplier2 = (req, res) => {
  const { id, status, facilityId } = req.params;
  db.sequelize
    .query(`call good_received(:status,:id)`, {
      replacements: {
        status: status,
        id: id,
      },
    })
    .then(async (results) => {
      // res.json({ success: true, results: results });
      let finalArr = [];

      if (results.length) {
        results.forEach(async (item) => {
          // let itemC = await getItemCode(item.item_name, facilityId);
          // console.log(itemC, "itemCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC");
          finalArr.push({
            ...item,
            status: "finished purchase",
            renew: item.propose_quantity,
            amount:
              item.type === "International"
                ? parseFloat(item.price) *
                  parseFloat(item.propose_quantity) *
                  parseFloat(item.exchange_rate)
                : parseFloat(item.price) * parseFloat(item.propose_quantity),
            date: "",
            uniqueId: `1234567890`,
          });
        });
      }
      res.json({ success: true, results: finalArr });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getItems = (req, res) => {
  const { facilityId } = req.params;

  db.sequelize
    .query(`call get_items(:in_facilityId) `, {
      replacements: {
        in_facilityId: facilityId,
      },
    })
    .then((results) => {
      res.json({ success: true, results: results });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getStoreList = (req, res) => {
  db.sequelize
    .query(`call store_transfer()`)
    .then((results) => {
      res.json({ success: true, results: results });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.productSearch = (req, res) => {
  let item_name = req.query.item_name || "";
  const { facilityId } = req.params;
  db.sequelize
    .query(`Call search_main_store('%${item_name}%')`)
    .then((results) => {
      res.json({ success: true, itemInfo: results });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};

exports.pointOfSaleSearch = (req, res) => {
  let item_name = req.query.item_name || "";
  const { facilityId, branch } = req.params;
  db.sequelize
    .query(
      `SELECT distinct  item_name,trn_number,balance,location_to,expiring_date,selling_price,location_from,transaction_date FROM point_sale_search WHERE balance>0 AND (item_name like '%${item_name}%' ) and location_from="${branch}" group by item_name`,
    )
    .then((results) => {
      res.json({ success: true, itemInfo: results[0] });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};

exports.branchStoreSearch = (req, res) => {
  let item_name = req.query.item_name || "";
  const { facilityId, branch } = req.params;
  db.sequelize
    .query(`Call search_branch_store(:location_from,'%${item_name}%')`, {
      replacements: {
        location_from: branch,
      },
    })
    .then((results) => {
      res.json({ success: true, itemInfo: results });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.addNewStore = (req, res) => {
  console.log(req.body);
  // console.log(req.body,"Here");

  // db.sequelize
  //   .query(
  //     `call update_purchase_order_status(:status,:grn,:poNo,:facilityId)`,
  //     {
  //       replacements: {
  //         status: req.body.header.status,
  //         grn: req.body.header.grn,
  //         poNo: req.body.header.poNo,
  //         facilityId: req.body.facilityId,
  //       },
  //     }
  //   )
  //   .then(

  moveItemsToStore(req.body.newArray, () => {
    res.json({ success: true, msg: "Items moved to store" });
  });

  // )
  // .then(db.sequelize.query(`call update_number_generator(:grn,:in_grm_no)`,{
  //   replacements:{
  //     grn:"grn",
  //     in_grm_no:req.body.header.grn
  //   }
  // }))
  // .then((results) => res.json({ results }))
  // .catch((err) => {
  //   res.status(500).json({ err });
  //   console.log(err);
  // });
};

exports.updateApprovedQty = (req, res) => {
  const { appoveQty } = req.body;
  const { id } = req.params;

  db.sequelize
    .query(
      `UPDATE purchase_order_list SET received_qty=received_qty+${appoveQty}, identifier="Remain Qty" where id="${id}" `,
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getAllPurchaseOrderApproved = (req, res) => {
  db.sequelize
    .query(`SELECT * FROM purchase_order where status="received"`)
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.json({ success: false, err }));
};

exports.updateGRNStatus = (req, res) => {
  const { status } = req.body;
  const { po_id } = req.params;
  db.sequelize
    .query(
      `UPDATE purchase_order SET status="${status}" WHERE po_id="${po_id}" `,
    )
    .then((results) => {
      res.json({
        success: true,
        results: results[0],
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getUnfinishedPurchase = (req, res) => {
  const { po_id, query_type } = req.params;
  db.sequelize
    .query(` call good_received(:query_type,:po_id)`, {
      replacements: {
        query_type,
        po_id,
      },
    })
    .then((results) => res.json({ success: true, results: results }))
    .catch((err) => res.json({ success: false, err }));
};

const toBool = (v) =>
  v === true || v === 1 || v === "1" || v === "true" || v === "yes";

exports.createBranches = async (req, res) => {
  const data = req.body.data || {};
  const { branch_name, state, address, crm = "" } = data;
  // facilityId is sent at the top level of the payload; fall back to data for safety
  const facilityId = req.body.facilityId || data.facilityId;
  const isDefault = toBool(data.is_default);

  if (!facilityId) {
    return res
      .status(400)
      .json({ success: false, message: "facilityId is required" });
  }
  if (!branch_name) {
    return res
      .status(400)
      .json({ success: false, message: "branch_name is required" });
  }

  // Legacy NOT NULL columns (no DB defaults) — supply safe values so the
  // trimmed modal (branch_name, state, address, crm) can insert successfully.
  const branch_id = `BR-${Date.now().toString(36).toUpperCase()}`;

  const transaction = await db.sequelize.transaction();
  try {
    const [{ branch_count }] = await db.sequelize.query(
      `SELECT COUNT(*) AS branch_count FROM branches WHERE facilityId = :facilityId`,
      {
        replacements: { facilityId },
        type: db.Sequelize.QueryTypes.SELECT,
        transaction,
      },
    );
    const finalIsDefault = isDefault || Number(branch_count) === 0;

    // Only one default branch per facility. First branch becomes default.
    if (finalIsDefault) {
      await db.sequelize.query(
        `UPDATE branches SET is_default = 0 WHERE facilityId = :facilityId`,
        {
          replacements: { facilityId },
          type: db.Sequelize.QueryTypes.UPDATE,
          transaction,
        },
      );
    }

    const results = await db.sequelize.query(
      `INSERT INTO branches
        (branch_id, branch_name, state, address, facilityId, crm, store_type, admin, created_by, admin_name, is_default)
        VALUES
        (:branch_id, :branch_name, :state, :address, :facilityId, :crm, :store_type, :admin, :created_by, :admin_name, :is_default)`,
      {
        replacements: {
          branch_id,
          branch_name,
          state: state || "",
          address: address || "",
          facilityId,
          crm: crm || "",
          store_type: "",
          admin: "",
          created_by: req.body.created_by || "",
          admin_name: "",
          is_default: finalIsDefault ? 1 : 0,
        },
        type: db.Sequelize.QueryTypes.INSERT,
        transaction,
      },
    );

    await transaction.commit();
    return res.json({ success: true, results });
  } catch (err) {
    await transaction.rollback();
    return res.status(500).json({ success: false, err });
  }
};

exports.updateBranches = async (req, res) => {
  const data = req.body.data || {};
  const { id, branch_name, state, address, crm = "" } = data;
  const facilityId = req.body.facilityId || data.facilityId;
  const isDefault = toBool(data.is_default);

  if (!id) {
    return res
      .status(400)
      .json({ success: false, message: "Branch id is required" });
  }
  if (!facilityId) {
    return res
      .status(400)
      .json({ success: false, message: "facilityId is required" });
  }
  if (!branch_name) {
    return res
      .status(400)
      .json({ success: false, message: "branch_name is required" });
  }

  const transaction = await db.sequelize.transaction();
  try {
    const currentBranch = await db.sequelize.query(
      `SELECT id, is_default FROM branches WHERE id = :id AND facilityId = :facilityId LIMIT 1`,
      {
        replacements: { id, facilityId },
        type: db.Sequelize.QueryTypes.SELECT,
        transaction,
      },
    );

    if (!currentBranch.length) {
      await transaction.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Branch not found" });
    }

    const isCurrentlyDefault = toBool(currentBranch[0].is_default);
    if (isCurrentlyDefault && !isDefault) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "A business must have one default branch. Set another branch as default before removing this one.",
      });
    }

    // Only one default branch per facility: clear others first when setting.
    if (isDefault) {
      await db.sequelize.query(
        `UPDATE branches SET is_default = 0 WHERE facilityId = :facilityId AND id <> :id`,
        {
          replacements: { facilityId, id },
          type: db.Sequelize.QueryTypes.UPDATE,
          transaction,
        },
      );
    }

    const results = await db.sequelize.query(
      `UPDATE branches
        SET branch_name = :branch_name, state = :state, address = :address, crm = :crm, is_default = :is_default
        WHERE id = :id AND facilityId = :facilityId`,
      {
        replacements: {
          id,
          branch_name,
          state: state || "",
          address: address || "",
          crm: crm || "",
          is_default: isDefault ? 1 : 0,
          facilityId,
        },
        type: db.Sequelize.QueryTypes.UPDATE,
        transaction,
      },
    );

    await transaction.commit();
    return res.json({ success: true, results });
  } catch (err) {
    await transaction.rollback();
    return res.status(500).json({ success: false, err });
  }
};

exports.getAllBranches = (req, res) => {
  db.sequelize
    .query(`SELECT * FROM branches`)
    .then((results) => {
      res.json({
        success: true,
        results: results[0],
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getBranches = (req, res) => {
  const { facilityId } = req.query;
  db.sequelize
    .query(
      `SELECT *, branch_name as storeName FROM branches WHERE facilityId = :facilityId`,
      {
        replacements: { facilityId },
        type: db.Sequelize.QueryTypes.SELECT,
      },
    )
    .then((results) => {
      res.json({
        success: true,
        results: results,
      });
    })
    .catch((err) => {
      console.error(err);
      res.status(500).json({ success: false, err });
    });
};

exports.deleteBranche = async (req, res) => {
  const { id, facilityId } = req.params;

  if (!id || !facilityId) {
    return res
      .status(400)
      .json({ success: false, message: "id and facilityId are required" });
  }

  const transaction = await db.sequelize.transaction();
  try {
    const branch = await db.sequelize.query(
      `SELECT id, is_default FROM branches WHERE id = :id AND facilityId = :facilityId LIMIT 1`,
      {
        replacements: { id, facilityId },
        type: db.Sequelize.QueryTypes.SELECT,
        transaction,
      },
    );

    if (!branch.length) {
      await transaction.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Branch not found" });
    }

    if (toBool(branch[0].is_default)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "You cannot delete the default branch. Set another branch as default first.",
      });
    }

    const results = await db.sequelize.query(
      `DELETE FROM branches WHERE id = :id AND facilityId = :facilityId`,
      {
        replacements: { id, facilityId },
        type: db.Sequelize.QueryTypes.DELETE,
        transaction,
      },
    );

    await transaction.commit();
    return res.json({ success: true, results });
  } catch (err) {
    await transaction.rollback();
    return res.status(500).json({ success: false, err });
  }
};

exports.getBranchLocation = (req, res) => {
  const {
    branch_location = "Show All Stores",
    facilityId,
    branch_id = "",
    // item_category = "",
  } = req.params;
  db.sequelize
    .query(`call get_branch_store(:branch_location, :facilityId, :branch_id)`, {
      replacements: {
        branch_location: branch_location,
        facilityId,
        branch_id,
        // item_category,
      },
    })
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ err });
    });
};

exports.getNewProduct = (req, res) => {
  const {
    branch_location = "Show All Stores",
    facilityId,
    branch_id = "",
    // item_category = "",
  } = req.params;
  db.sequelize
    .query(
      `SELECT
    se.*,
    p.name AS item_name,
    p.taxable,
    p.sku AS item_code,

    p.category,
    p.unit_of_measure
FROM store_entries se
LEFT JOIN products p ON se.product_id = p.sku
WHERE se.branch_name in ("Finished Good","Resalable") and p.item_type in ("Finished Good","Resalable")
    AND se.mark_up = '0.00'
    AND se.facilityId = :facilityId;`,
      {
        replacements: {
          branch_location: branch_location,
          facilityId,
          branch_id,
          // item_category,
        },
      },
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ err });
    });
};

exports.getReadyForSalesItems = async (req, res) => {
  try {
    const { facilityId } = req.params;
    const { attachSalesLimitInfo } = require("../services/salesLimits");

    // Get business setting for allow_sales_without_stock
    const business = await db.business.findOne({
      where: { id: facilityId },
      attributes: ["allow_sales_without_stock"],
    });

    const allowSalesWithoutStock = business?.allow_sales_without_stock || false;

    const balanceCondition = allowSalesWithoutStock
      ? ""
      : "WHERE sd.`balance` > 0";

    // All sales-floor stock for the facility — no branch filter.
    // Same SKU appears once per branchId with its own balance.
    const query = `
      SELECT
        sd.\`sku\`,
        sd.\`item_name\`,
        sd.\`uom_category\`,
        sd.\`uom\`,
        sd.\`product_id\`,
        sd.\`facilityId\`,
        sd.\`branchId\`,
        sd.\`selling_price\`,
        sd.\`expiry_date\`,
        sd.\`multiplier_type\`,
        sd.\`multiplier_id\`,
        sd.\`balance\`,
        sd.\`unit_of_measure\`,
        sd.\`branch_name\`,
        sd.\`taxable\`,
        p.\`daily_sales_limit\`,
        p.\`weekly_sales_limit\`,
        p.\`monthly_sales_limit\`,
        b.\`branch_name\` AS \`location_name\`,
        CONCAT(
          sd.\`product_id\`, '-',
          COALESCE(sd.\`expiry_date\`, 'NULL'), '-',
          COALESCE(sd.\`multiplier_id\`, 'NULL'), '-',
          sd.\`selling_price\`, '-',
          COALESCE(sd.\`branchId\`, '0')
        ) AS \`id\`
      FROM \`sales_dep\` sd
      LEFT JOIN \`products\` p
        ON p.\`sku\` = sd.\`product_id\`
        AND p.\`facility_id\` = sd.\`facilityId\`
      LEFT JOIN \`branches\` b
        ON b.\`id\` = sd.\`branchId\`
        AND (b.\`facilityId\` = sd.\`facilityId\` OR b.\`facilityId\` IS NULL)
      ${balanceCondition ? balanceCondition + " AND" : "WHERE"} sd.\`facilityId\` = :facilityId
        AND sd.\`branchId\` IS NOT NULL
        AND (sd.\`expiry_date\` IS NULL OR sd.\`expiry_date\` >= CURDATE())
      ORDER BY
        COALESCE(b.\`branch_name\`, ''),
        sd.\`item_name\`,
        sd.\`branchId\`,
        sd.\`expiry_date\`
    `;

    const results = await db.sequelize.query(query, {
      replacements: { facilityId },
      type: db.Sequelize.QueryTypes.SELECT,
    });

    await attachSalesLimitInfo(results, facilityId);

    res.json({ success: true, results });
  } catch (err) {
    console.error("Error fetching ready for sales items:", err);
    res.status(500).json({ success: false, err: err.message });
  }
};

exports.getReadyForSalesByBranch = async (req, res) => {
  try {
    const { facilityId } = req.params;
    const { branchId } = req.query;
    const { attachSalesLimitInfo } = require("../services/salesLimits");

    // Get business setting for allow_sales_without_stock
    const business = await db.business.findOne({
      where: { id: facilityId },
      attributes: ["allow_sales_without_stock"],
    });

    const allowSalesWithoutStock = business?.allow_sales_without_stock || false;

    const balanceClause = allowSalesWithoutStock
      ? ""
      : "WHERE sd.`balance` > 0";

    // Default: all branches, one row per (product, branch). Optional
    // branchId query param still supported for callers that need it.
    let query = `
      SELECT
        sd.\`sku\`,
        sd.\`item_name\`,
        sd.\`uom_category\`,
        sd.\`uom\`,
        sd.\`product_id\`,
        sd.\`facilityId\`,
        sd.\`branchId\`,
        sd.\`selling_price\`,
        sd.\`expiry_date\`,
        sd.\`multiplier_type\`,
        sd.\`multiplier_id\`,
        sd.\`balance\`,
        sd.\`unit_of_measure\`,
        sd.\`branch_name\`,
        sd.\`taxable\`,
        p.\`daily_sales_limit\`,
        p.\`weekly_sales_limit\`,
        p.\`monthly_sales_limit\`,
        b.\`branch_name\` AS \`location_name\`,
        CONCAT(
          sd.\`product_id\`, '-',
          COALESCE(sd.\`expiry_date\`, 'NULL'), '-',
          COALESCE(sd.\`multiplier_id\`, 'NULL'), '-',
          sd.\`selling_price\`, '-',
          COALESCE(sd.\`branchId\`, '0')
        ) AS \`id\`
      FROM \`sales_dep\` sd
      LEFT JOIN \`products\` p
        ON p.\`sku\` = sd.\`product_id\`
        AND p.\`facility_id\` = sd.\`facilityId\`
      LEFT JOIN \`branches\` b
        ON b.\`id\` = sd.\`branchId\`
        AND (b.\`facilityId\` = sd.\`facilityId\` OR b.\`facilityId\` IS NULL)
      ${balanceClause ? balanceClause + " AND" : "WHERE"} sd.\`facilityId\` = :facilityId
        AND sd.\`branchId\` IS NOT NULL
        AND (sd.\`expiry_date\` IS NULL OR sd.\`expiry_date\` >= CURDATE())
    `;

    const replacements = { facilityId };

    if (branchId && branchId !== "all") {
      query += ` AND sd.\`branchId\` = :branchId`;
      replacements.branchId = branchId;
    }

    query += ` ORDER BY COALESCE(b.\`branch_name\`, ''), sd.\`item_name\`, sd.\`branchId\`, sd.\`expiry_date\``;

    const results = await db.sequelize.query(query, {
      replacements,
      type: db.Sequelize.QueryTypes.SELECT,
    });

    await attachSalesLimitInfo(results, facilityId);

    res.json({ success: true, results });
  } catch (err) {
    console.error("Error fetching ready for sales items by branch:", err);
    res.status(500).json({ success: false, err: err.message });
  }
};

// Get service products for sales
exports.getServiceProducts = async (req, res) => {
  try {
    const { facilityId } = req.params;
    const { attachSalesLimitInfo } = require("../services/salesLimits");
    const results = await db.sequelize.query(
      `SELECT
    p.id,
    p.name AS item_name,
    p.sku as item_code,
    p.category,
    p.unit_of_measure,
    p.selling_price,
    p.cost_price,
    p.mark_up,
    p.markup_mode,
    p.item_type,
    p.status,
    p.taxable,
    p.daily_sales_limit,
    p.weekly_sales_limit,
    p.monthly_sales_limit,
    p.created_at,
    p.updated_at,
    'available' AS balance,
    p.unit_of_measure AS uom,
    p.sku AS product_id
FROM products p
WHERE p.facility_id = :facilityId
    AND p.item_type = 'Service'
    AND p.status = 'Active'
ORDER BY p.name ASC;`,
      {
        replacements: { facilityId },
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );
    await attachSalesLimitInfo(results, facilityId);
    res.json({ success: true, results });
  } catch (err) {
    console.log(err);
    res.status(500).json({ err: err.message || err });
  }
};

// Update service product pricing
exports.updateServicePricing = (req, res) => {
  const { facilityId, productId } = req.params;
  const { sellingPrice, costPrice, markUp, markupMode } = req.body;

  if (!facilityId || !productId) {
    return res.status(400).json({
      success: false,
      message: "facilityId and productId are required",
    });
  }

  // Build dynamic update query
  const updateFields = [];
  const replacements = { facilityId, productId };

  if (sellingPrice !== undefined) {
    updateFields.push("selling_price = :sellingPrice");
    replacements.sellingPrice = sellingPrice;
  }

  if (costPrice !== undefined) {
    updateFields.push("cost_price = :costPrice");
    replacements.costPrice = costPrice;
  }

  if (markUp !== undefined) {
    updateFields.push("mark_up = :markUp");
    replacements.markUp = markUp;
  }

  if (markupMode !== undefined) {
    updateFields.push("markup_mode = :markupMode");
    replacements.markupMode = markupMode;
  }

  if (updateFields.length === 0) {
    return res.status(400).json({
      success: false,
      message: "No fields to update",
    });
  }

  updateFields.push("updated_at = NOW()");

  const updateQuery = `
    UPDATE products
    SET ${updateFields.join(", ")}
    WHERE facility_id = :facilityId
      AND id = :productId
      AND item_type = 'Service'
  `;

  db.sequelize
    .query(updateQuery, { replacements })
    .then((results) => {
      if (results[1] > 0) {
        res.json({
          success: true,
          message: "Service pricing updated successfully",
          affectedRows: results[1],
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Service product not found or no changes made",
        });
      }
    })
    .catch((err) => {
      console.error("Error updating service pricing:", err);
      res.status(500).json({
        success: false,
        message: "Error updating service pricing",
        error: err.message,
      });
    });
};

// Get taxes for facility
exports.getTaxes = async (req, res) => {
  try {
    const { facilityId } = req.params;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Find existing taxes for the facility
    let taxes = await db.Tax.findAll({
      where: {
        facilityId: facilityId,
      },
      order: [["description", "ASC"]],
      attributes: [
        "id",
        "description",
        "rate_type",
        "rate",
        "tax_type",
        "account_sub_head",
        "head",
        "created_at",
      ],
    });

    // If no taxes exist, create a default VAT tax
    if (!taxes || taxes.length === 0) {
      const defaultVAT = await db.Tax.create({
        description: "VAT",
        rate_type: "percentage",
        rate: "7.5",
        tax_type: "exclusive",
        account_sub_head: "2000000",
        head: "2000000",
        facilityId: facilityId,
        taxes_created_by: "SYSTEM",
      });

      // Fetch the newly created tax
      taxes = [defaultVAT];
    }

    // If no VAT tax exists, create one
    const hasVAT = taxes.some((tax) =>
      tax.description.toLowerCase().includes("vat"),
    );

    if (!hasVAT) {
      const defaultVAT = await db.Tax.create({
        description: "VAT",
        rate_type: "percentage",
        rate: "7.5",
        tax_type: "exclusive",
        account_sub_head: "2000000",
        head: "2000000",
        facilityId: facilityId,
        taxes_created_by: "SYSTEM",
      });

      taxes.push(defaultVAT);
    }

    res.json({
      success: true,
      results: taxes.map((tax) => tax.toJSON()),
    });
  } catch (err) {
    console.error("Error fetching taxes:", err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

exports.getBranchLocation2 = (req, res) => {
  const { branch_location, facilityId } = req.params;
  db.sequelize
    .query(`call get_branch_store2(:branch_location)`, {
      replacements: {
        branch_location: branch_location,
      },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};
exports.getInventory = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query(`call get_inventory()`)
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};
exports.getInventory2 = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query(`call newInventory()`)
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.transferItemToPos = (req, res) => {
  console.log(req.body);
  const {
    newArray,
    facilityId,
    trn,
    userId,
    phone = "0",
    customer_bank = "",
    customer_acc_no = "",
    transaction_amount = "0",
    business_bank = "",
    business_bank_acc_no = "",
    _rev = "",
    truckNo = "",
    waybillNo = "",
    receiptNo = "",
    itemList = "",
    txn_type = "",
  } = req.body;

  db.sequelize
    .query(`call update_number_generator(:query_ty,:trn_no,:facilityId)`, {
      replacements: {
        query_ty: "trn",
        trn_no: trn,
        facilityId,
      },
    })
    .then((results) => {
      moveItemsToPOS(newArray, facilityId, trn, () => {
        // res.json({ success: true, results });
        newArray.forEach((item) => {
          getAccountEntriesVersionId((n_version_id) => {
            db.sequelize.query(
              `CALL service_transaction(:description,:accNo,:amount,:receiptsn,:receiptno,:modeOfPayment,
                :accNo,:facilityId,:sourceAcct,:userId,:serviceHead,:transactionType,:in_date,
                :payables_head,:recievables_head,:bank,:txn_date,:in_discount,:in_discount_head,
                :account_name, :branch_name,:quantity,:version_id,:phone,:customer_bank,:customer_acc_no,
                :transaction_amount,:business_bank,:business_bank_acc_no,:amountPaid,:truckNo,:waybillNo,
                :itemList,:txn_type)`,
              {
                replacements: {
                  drug_code: item.item_code ? item.item_code : "",
                  drug: item.item_name ? item.item_name : "",
                  cost: item.cost ? item.cost : "",
                  expiry: item.expiry ? item.expiry : "",
                  generic: item.generic ? item.generic : "",
                  unit_of_issue: item.unit_of_issue ? item.unit_of_issue : "",
                  quantity: item.qty_out ? item.qty_out : "",
                  userId: userId,
                  supplierId: item.supplierId ? item.supplierId : "",
                  description: item.item_name ? item.item_name : "",
                  source: item.transfer_to ? item.transfer_to : "",
                  amount: item.amount ? item.amount : "",
                  receiptsn: item.receiptsn ? item.receiptsn : "",
                  receiptno: item.receiptno ? item.receiptno : "",
                  modeOfPayment: item.modeOfPayment ? item.modeOfPayment : "",
                  destination: item.destination ? item.destination : "",
                  facilityId: facilityId ? facilityId : "",
                  selling_price: item.selling_price ? item.selling_price : "",
                  accNo: item.accountNo ? item.accountNo : "",
                  transactionType: item.transactionType
                    ? item.transactionType
                    : "",
                  sourceAcct:
                    item.modeOfPayment &&
                    item.modeOfPayment.toLowerCase() === "cash"
                      ? "400021"
                      : "400022",
                  serviceHead: "20025",
                  in_date: moment().format("YYYY-MM-DD hh:mm:ss"),
                  bank: item.bank ? item.bank : "",
                  txn_date: moment().format("YYYY-MM-DD"),
                  in_discount: item.discount ? item.discount : 0,
                  in_discount_head: "30002",
                  payables_head: "500021",
                  recievables_head: "400023",
                  account_name: item.account_name ? item.account_name : "",
                  branch_name: item.branch_name ? item.branch_name : "",
                  quantity: item.quantity ? item.quantity : "",
                  version_id: item.version_id ? item.version_id : n_version_id,
                  phone,
                  customer_bank,
                  customer_acc_no,
                  transaction_amount,
                  business_bank,
                  business_bank_acc_no,
                  amountPaid:
                    item.amountPaid && item.amount !== "" ? item.amountPaid : 0,
                  truckNo: truckNo ? truckNo : "",
                  waybillNo: waybillNo ? waybillNo : "",
                  itemList,
                  txn_type,
                },
              },
            );
            // .catch((err) => {
            //   console.log(err);
            //   res.status(500).json({ success: false, err });
            // });
          });
        });

        res.json({ success: true, results });
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ err });
    });
};

exports.addSaleDepartmentItems = (req, res) => {
  console.log(req.body);
  const {
    trn,
    item_name,
    qty_in,
    expiring_date,
    selling_price,
    location_from,
    receive_date,
    query_type,
    qty_out = 0,
    status = "",
    req_no = "",
    supplier_code = "",
    supplier_name = "",
    receiptNo = "",
    userId = "",
  } = req.body;
  console.log(req.body, "=====================>body");
  db.sequelize
    .query(
      `Call store_entries(
          :item_name,
          :qty_in,
          // :expiry_date,
          :selling_price,
          :transaction_date,
          :item_category,
          :item_code,
          :version_id,
          :facilityId,
          :qty_out,
          :req_no,
          // :waybill_no,
          :userId,
          :cost_price
        )`,
      {
        replacements: {
          item_name: item_name,
          qty_in: qty_in ? qty_in : 0,
          // expiry_date: expiring_date,
          selling_price: selling_price ? selling_price : 0,
          transaction_date: receive_date,
          item_category: "",
          item_code: "",
          version_id,
          facilityId,
          qty_out: qty_out ? qty_out : 0,
          status: status ? status : "",
          req_no: req_no ? req_no : "",
          // waybill_no: "",
          userId,
          cost_price: 0,
        },
      },
    )
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getItemsBySubHead = (req, res) => {
  const { subhead } = req.params;
  db.sequelize
    .query(
      `SELECT description,expired_status,item_code from item_description where subhead=${subhead}`,
    )
    .then((results) => {
      res.json({
        success: true,
        results: results[0],
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getSpecification = (req, res) => {
  const { item_name, facilityId } = req.params;
  console.log(req.params);
  db.sequelize
    .query(`call get_specification(:item_name,:facilityId)`, {
      replacements: {
        item_name,
        facilityId,
      },
    })
    .then((results) => {
      res.json({
        success: true,
        results: results[0],
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getAllitems = (req, res) => {
  const { subhead = 0, facilityId } = req.params;

  db.sequelize
    .query(`Call get_item_category(:subhead, :facilityId )`, {
      replacements: {
        subhead,
        facilityId,
      },
    })
    .then((results) => {
      res.json({
        success: true,
        results: results,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};
exports.getItemsItemQty = (req, res) => {
  const { item } = req.params;

  db.sequelize
    .query(`Call getQTY(:item  )`, {
      replacements: {
        item,
      },
    })
    .then((results) => {
      res.json({
        success: true,
        results: results[0].qty,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.creatNewItemDescription = (req, res) => {
  const {
    head,
    subHead,
    description,
    facilityId,
    price,
    item_code,
    prefix,
    group_code,
  } = req.body;
  console.log(req.body);
  const stmt =
    "call new_item_description(:head,:subHead,:description,:balance,:facilityId,:price,:item_code,:prefix,:group_code)";
  db.sequelize
    .query(stmt, {
      replacements: {
        head,
        subHead,
        description,
        balance: 0,
        facilityId,
        price: price ? price : "",
        item_code: item_code ? item_code : "",
        prefix: prefix ? prefix : "",
        group_code: group_code ? group_code : "",
      },
    })
    .then((results) => res.json({ results }))
    .catch((err) => {
      console.log(err);
      res.status(500).json({ err });
    });
};

exports.getAllitemsHead = (req, res) => {
  db.sequelize
    .query(
      `SELECT head, subhead, description, prefix, group_code FROM item_description`,
    )
    .then((results) => {
      res.json({
        success: true,
        results: results[0],
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getItemChart = (req, res) => {
  db.sequelize
    .query(
      `SELECT head as title,subhead,description,price,prefix,group_code FROM item_description`,
    )
    .then((results) => {
      res.json({
        success: true,
        results: results[0],
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getNextItemChartCode = (req, res) => {
  const { facilityId, subhead } = req.params;
  db.sequelize
    .query(
      `SELECT ifnull(max(head), 0) + 1 as nextCode FROM item_description where subhead="${subhead}"
        AND facilityId="${facilityId}"`,
    )
    .then((results) => {
      let nextCode = results[0][0].nextCode;
      res.json({
        success: true,
        results: nextCode === 1 ? parseInt(subhead) + 1 : nextCode,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getRemarksID = (req, res) => {
  db.sequelize
    .query(`select ifnull(max(id),0)+1 as remarks_id from purchase_order_list`)
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.json({ success: false, err }));
};

exports.getRemarksForExpID = (req, res) => {
  db.sequelize
    .query(`select ifnull(max(id),0)+1 as expense_id from expense`)
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => {
      console.log(err);
      res.json({ success: false, err });
    });
};

exports.getMaxRemarks = (req, res) => {
  const { request_no } = req.params;
  db.sequelize
    .query(
      `select remarks_id,remarks,request_no,date, general_remarks FROM remarks where id in (select max(id) from remarks where request_no ="${request_no}" GROUP by remarks_id)`,
    )
    .then((results) => {
      res.json({
        success: true,
        results: results[0],
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.addNewBranchReq = (req, res) => {
  const { tableData, facilityId } = req.body;
  console.log(req.body);
  db.sequelize
    .query(
      "select ifnull(max(id),0)+1 as requisition_no from branch_requisition",
    )
    .then((resp) => {
      let requisitionNo = resp[0][0].requisition_no;
      tableData.forEach((item) => {
        db.sequelize.query(
          `call add_new_branch_requisition(:item_name,:qty,:branch_name,:request_at,:req_status,:requisition_no,:facilityId,:item_category)`,
          {
            replacements: {
              item_name: item.item_name ? item.item_name : "",
              qty: item.qty ? item.qty : 0,
              branch_name: item.branch_name ? item.branch_name : "",
              request_at: item.request_at ? item.request_at : "",
              req_status: item.req_status ? item.req_status : "pending",
              requisition_no: requisitionNo,
              item_category: item.item_category ? item.item_category : "",
              facilityId,
            },
          },
        );
      });
      res.json({
        success: true,
        // results: results,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getAllBranchReq = (req, res) => {
  db.sequelize
    .query(
      `SELECT item_name, branch_name, qty as quantity, req_status, request_at FROM branch_requisition where req_status = "pending"`,
    )
    .then((results) => {
      res.json({
        success: true,
        results: results[0],
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

// exports.getRequisitionId = (req, res) => {
//   db.sequelize
//     .query(
//       `select ifnull(max(id),0)+1 as requisition_no from branch_requisition`
//     )
//     .then((results) => res.json({ success: true, results: results[0] }))
//     .catch((err) => {
//       console.log(err);
//       res.json({ success: false, err });
//     });
// };

exports.getAllBranchReqByReqNo = (req, res) => {
  const { req_status, requisition_no, query_type } = req.params;
  db.sequelize
    .query(
      `call get_request_list(:in_req_status,:in_requisition_no, :query_type)`,
      {
        replacements: {
          in_req_status: req_status ? req_status : null,
          in_requisition_no: requisition_no ? requisition_no : null,
          query_type,
        },
      },
    )
    .then((results) => {
      res.json({
        success: true,
        results: results,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.updateBranchReqByReqNo = (req, res) => {
  const {
    req_status,
    items,
    query_type = "",
    role = "",
    requisition_no = "",
  } = req.body;
  // console.log(req.body)

  items.forEach((i) => {
    db.sequelize.query(
      `call update_request_status_by_req_no(:in_status,:requisition, :item_name)`,
      {
        replacements: {
          in_status: req_status,
          requisition: requisition_no,
          item_name: i.item_name,
          query_type,
          role,
        },
      },
    );
  });

  // .then((results) => {
  res.json({
    success: true,
    // results: results,
  });
  // })
  // .catch((err) => {
  //   console.log(err);
  //   res.status(500).json({ success: false, err });
  // });
};

exports.updateSingleBranchReqByReqNo = (req, res) => {
  const {
    req_status,
    requisition_no,
    item_name = "",
    query_type = "",
  } = req.body;
  console.log(req.body);

  db.sequelize
    .query(
      `call update_request_status(:in_status,:requisition, :item_name, :query_type)`,
      {
        replacements: {
          in_status: req_status,
          requisition: requisition_no,
          item_name: item_name,
          query_type,
        },
      },
    )
    .then((results) => {
      res.json({
        success: true,
        // results: results,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getNextStatus = (req, res) => {
  const { curr_status, user_role } = req.query;

  db.sequelize
    .query("CALL get_status_update(:user_role, :curr_status)", {
      replacements: {
        user_role,
        curr_status,
      },
    })
    .then((results) => {
      res.json({
        success: true,
        results: results,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getAllBranchItemByReqNo = (req, res) => {
  const { requisition_no } = req.params;
  db.sequelize
    .query(
      `SELECT item_name, qty as quantity,branch_name,requisition_no FROM branch_requisition where requisition_no ="${requisition_no}" and req_status="pending"`,
    )
    .then((results) => {
      res.json({
        success: true,
        results: results[0],
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.updateReqStatus = (req, res) => {
  const { status, requisition_no } = req.params;
  let item_name = req.query.item_name || "";
  let approved_qty = req.query.approved_qty || "";

  db.sequelize
    .query(
      `UPDATE branch_requisition SET req_status ="${status}",approved_qty ="${approved_qty}"  where requisition_no="${requisition_no}" and item_name="${item_name}"`,
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => {
      console.log(err);
      res.json({ success: false, err });
    });
};

exports.updatePayableCode = async (req, res) => {
  const { head, user_id, facilityId } = req.params;
  const { query_type } = req.query;

  try {
    // Validate required parameters
    if (!query_type || !head || !facilityId || !user_id) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required parameters: query_type, head, facilityId, user_id",
      });
    }

    // Create update object based on query_type
    const updateFields = {};

    switch (query_type) {
      case "Payable":
        updateFields.payable_code = head;
        break;
      case "Receivable":
        updateFields.receivable_code = head;
        break;
      case "Finished Goods":
        updateFields.finished_goods_code = head;
        break;
      case "Cost Of Service":
        updateFields.cost_of_sale = head;
        break;
      case "Work in Progress":
        updateFields.wip = head;
        break;
      case "Sales Revenue":
        updateFields.sale_revenue_code = head;
        break;
      case "Advance to Payables":
        updateFields.payable_accural_code = head;
        break;
      case "Unearned Deposits Receivable":
        updateFields.receivable_accural_code = head;
        break;
      case "Other Receivable":
        updateFields.other_receivable_code = head;
        break;
      case "Opening Balance Equity":
        updateFields.opening_balance_equity = head;
        break;
      case "Pro Bono":
        updateFields.pro_bono_code = head;
        break;
      case "Abnormal Loss":
        updateFields.abnormal_loss_account = head;
        break;
      case "Scrap Inventory":
        updateFields.scrap_inventory_account = head;
        break;
      default:
        return res.status(400).json({
          success: false,
          message: `Invalid query_type: ${query_type}`,
        });
    }

    // Update business settings using ORM
    const [updatedRowsCount] = await db.business.update(updateFields, {
      where: {
        id: facilityId,
      },
    });

    if (updatedRowsCount === 0) {
      // console.log()
      return res.status(404).json({
        success: false,
        message: "Business not found or no changes made",
      });
    }

    // Fetch updated business profile
    const updatedBusiness = await db.business.findOne({
      where: {
        id: facilityId,
      },
      attributes: [
        "id",
        "business_name",
        "business_type",
        "business_logo",
        "primary_color",
        "secondary_color",
        "business_phone",
        "prefix",
        "payable_code",
        "other_payable_code",
        "receivable_code",
        "cost_of_sale",
        "payable_accural_code",
        "other_receivable_code",
        "receivable_accural_code",
        "sale_revenue_code",
        "abnormal_loss_account",
        "scrap_inventory_account",
      ],
    });

    if (!updatedBusiness) {
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }

    res.json({
      success: true,
      results: updatedBusiness,
    });
  } catch (err) {
    console.error("updatePayableCode Error:", err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};

exports.updateInventoryValMethod = async (req, res) => {
  try {
    const { method, user_id, facilityId } = req.params;
    const { valuation_date } = req.body;

    // Validate method
    const validMethods = ["Weighted Average Cost", "LIFO", "FIFO"];
    if (!validMethods.includes(method)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid inventory valuation method. Must be one of: Weighted Average Cost, LIFO, FIFO",
      });
    }

    // Validate valuation_date if provided
    const validValuationDates = ["All", "Daily", "Weekly", "Monthly", "Yearly"];
    if (valuation_date && !validValuationDates.includes(valuation_date)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid valuation date. Must be one of: All, Daily, Weekly, Monthly, Yearly",
      });
    }

    // Prepare update object
    const updateData = { inv_ev_m: method };
    if (valuation_date) {
      updateData.valuation_date = valuation_date;
    }

    // Update the business record using the Business model
    const [updatedRowsCount] = await db.business.update(updateData, {
      where: { id: facilityId },
      returning: true,
    });

    if (updatedRowsCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }

    // Get the updated business record with membership data
    const updatedBusiness = await db.sequelize.query(
      `SELECT
        b.id,
        b.business_name,
        b.business_type,
        b.business_logo,
        b.primary_color,
        b.secondary_color,
        b.business_phone,
        b.prefix,
        b.payable_code,
        b.receivable_code,
        b.cost_of_sale,
        b.payable_accural_code,
        b.receivable_accural_code,
        b.sale_revenue_code,
        b.inv_ev_m,
        b.valuation_date,
        m.access_to,
        m.functionalities
      FROM membership m
      INNER JOIN business b ON m.business_id = b.id
      WHERE m.user_id = :user_id AND b.id = :facilityId`,
      {
        replacements: { user_id, facilityId },
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );

    res.json({
      success: true,
      results: updatedBusiness[0] || updatedBusiness,
      message: "Inventory valuation method updated successfully",
    });
  } catch (err) {
    console.error("Error updating inventory valuation method:", err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error:
        process.env.NODE_ENV === "development"
          ? err.message
          : "Something went wrong",
    });
  }
};
exports.updateCostingMethod = async (req, res) => {
  try {
    const { method, user_id, facilityId } = req.params;
    console.log(method, user_id, facilityId);
    // Validate method
    const validMethods = ["process_costing", "job_product_costing"];
    if (!validMethods.includes(method)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid costing method. Must be one of: process_costing, job_product_costing",
      });
    }

    // Update the business record using the Business model
    const [updatedRowsCount] = await db.business.update(
      { costing_method: method },
      {
        where: { id: facilityId },
        returning: true,
      },
    );

    if (updatedRowsCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }

    // Get the updated business record with membership data
    const updatedBusiness = await db.sequelize.query(
      `SELECT
        b.id,
        b.business_name,
        b.business_type,
        b.business_logo,
        b.primary_color,
        b.secondary_color,
        b.business_phone,
        b.prefix,
        b.payable_code,
        b.receivable_code,
        b.cost_of_sale,
        b.payable_accural_code,
        b.receivable_accural_code,
        b.sale_revenue_code,
        b.inv_ev_m,
        b.costing_method,
        m.access_to,
        m.functionalities
      FROM membership m
      INNER JOIN business b ON m.business_id = b.id
      WHERE m.user_id = :user_id AND b.id = :facilityId`,
      {
        replacements: { user_id, facilityId },
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );

    res.json({
      success: true,
      results: updatedBusiness[0] || updatedBusiness,
      message: "Costing method updated successfully",
    });
  } catch (err) {
    console.error("Error updating costing method:", err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error:
        process.env.NODE_ENV === "development"
          ? err.message
          : "Something went wrong",
    });
  }
};

exports.updateDepreciationMethod = async (req, res) => {
  try {
    const { method, user_id, facilityId } = req.params;
    const decodedMethod = decodeURIComponent(method);
    const validMethods = ["Straight Line", "Reducing Balance"];
    if (!validMethods.includes(decodedMethod)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid depreciation method. Must be one of: Straight Line, Reducing Balance",
      });
    }

    const updatePayload = { depreciation_method: decodedMethod };

    // Optional auto-run settings (from body)
    if (req.body && typeof req.body === "object") {
      if (req.body.auto_depreciation_enabled !== undefined) {
        updatePayload.auto_depreciation_enabled =
          req.body.auto_depreciation_enabled === true ||
          req.body.auto_depreciation_enabled === "true" ||
          req.body.auto_depreciation_enabled === 1 ||
          req.body.auto_depreciation_enabled === "1";
      }
      if (req.body.auto_depreciation_frequency) {
        const freq = String(req.body.auto_depreciation_frequency).toLowerCase();
        if (!["monthly", "quarterly", "yearly"].includes(freq)) {
          return res.status(400).json({
            success: false,
            message: "auto_depreciation_frequency must be monthly, quarterly, or yearly",
          });
        }
        updatePayload.auto_depreciation_frequency = freq;
      }
      if (req.body.auto_depreciation_day !== undefined) {
        const day = parseInt(req.body.auto_depreciation_day, 10);
        if (Number.isNaN(day) || day < 1 || day > 28) {
          return res.status(400).json({
            success: false,
            message: "auto_depreciation_day must be between 1 and 28",
          });
        }
        updatePayload.auto_depreciation_day = day;
      }
    }

    const [updatedRowsCount] = await db.business.update(updatePayload, {
      where: { id: facilityId },
      returning: true,
    });

    if (updatedRowsCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }

    const updatedBusiness = await db.sequelize.query(
      `SELECT
        b.id,
        b.business_name,
        b.business_type,
        b.business_logo,
        b.primary_color,
        b.secondary_color,
        b.business_phone,
        b.prefix,
        b.payable_code,
        b.receivable_code,
        b.cost_of_sale,
        b.payable_accural_code,
        b.receivable_accural_code,
        b.sale_revenue_code,
        b.inv_ev_m,
        b.costing_method,
        b.depreciation_method,
        b.auto_depreciation_enabled,
        b.auto_depreciation_frequency,
        b.auto_depreciation_day,
        b.auto_depreciation_last_run,
        m.access_to,
        m.functionalities
      FROM membership m
      INNER JOIN business b ON m.business_id = b.id
      WHERE m.user_id = :user_id AND b.id = :facilityId`,
      {
        replacements: { user_id, facilityId },
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );

    res.json({
      success: true,
      results: updatedBusiness[0] || updatedBusiness,
      message: "Depreciation settings updated successfully",
    });
  } catch (err) {
    console.error("Error updating depreciation method:", err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error:
        process.env.NODE_ENV === "development"
          ? err.message
          : "Something went wrong",
    });
  }
};

/**
 * POST /account/update-invoice-closing/:facilityId/:user_id
 * body: { invoice_closing_enabled, invoice_closing_time, invoice_closing_timezone? }
 */
exports.updateInvoiceClosingSettings = async (req, res) => {
  try {
    const { facilityId, user_id } = req.params;
    const body = req.body || {};

    const updatePayload = {};

    if (body.invoice_closing_enabled !== undefined) {
      updatePayload.invoice_closing_enabled =
        body.invoice_closing_enabled === true ||
        body.invoice_closing_enabled === "true" ||
        body.invoice_closing_enabled === 1 ||
        body.invoice_closing_enabled === "1";
    }

    if (body.invoice_closing_time !== undefined) {
      const time = String(body.invoice_closing_time || "").trim();
      if (!/^\d{1,2}:\d{2}$/.test(time)) {
        return res.status(400).json({
          success: false,
          message: "invoice_closing_time must be HH:mm (e.g. 17:00)",
        });
      }
      const [hRaw, mRaw] = time.split(":");
      const h = Math.min(23, Math.max(0, parseInt(hRaw, 10)));
      const m = Math.min(59, Math.max(0, parseInt(mRaw, 10)));
      updatePayload.invoice_closing_time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }

    if (body.invoice_closing_timezone !== undefined) {
      const tz = String(body.invoice_closing_timezone || "").trim();
      if (tz.length < 3 || tz.length > 64) {
        return res.status(400).json({
          success: false,
          message: "invoice_closing_timezone is invalid",
        });
      }
      updatePayload.invoice_closing_timezone = tz;
    }

    if (Object.keys(updatePayload).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No invoice closing settings provided",
      });
    }

    const [updatedRowsCount] = await db.business.update(updatePayload, {
      where: { id: facilityId },
    });

    if (updatedRowsCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }

    const updatedBusiness = await db.sequelize.query(
      `SELECT
        b.id,
        b.business_name,
        b.business_type,
        b.business_logo,
        b.primary_color,
        b.secondary_color,
        b.business_phone,
        b.prefix,
        b.payable_code,
        b.receivable_code,
        b.cost_of_sale,
        b.payable_accural_code,
        b.receivable_accural_code,
        b.sale_revenue_code,
        b.inv_ev_m,
        b.costing_method,
        b.depreciation_method,
        b.auto_depreciation_enabled,
        b.auto_depreciation_frequency,
        b.auto_depreciation_day,
        b.auto_depreciation_last_run,
        b.invoice_closing_enabled,
        b.invoice_closing_time,
        b.invoice_closing_timezone,
        b.invoice_closing_last_run,
        m.access_to,
        m.functionalities
      FROM membership m
      INNER JOIN business b ON m.business_id = b.id
      WHERE m.user_id = :user_id AND b.id = :facilityId`,
      {
        replacements: { user_id, facilityId },
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );

    await recordActivity({
      facilityId,
      userId: user_id,
      action: "update",
      entityType: "business_settings",
      entityId: facilityId,
      entityLabel: "Invoice closing time",
      after: updatePayload,
      remark: "Invoice payment validity / daily closing settings updated",
    });

    return res.json({
      success: true,
      results: updatedBusiness[0] || updatedBusiness,
      message: "Invoice closing settings updated successfully",
    });
  } catch (err) {
    console.error("Error updating invoice closing settings:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error:
        process.env.NODE_ENV === "development"
          ? err.message
          : "Something went wrong",
    });
  }
};

/**
 * POST /account/run-invoice-closing/:facilityId
 * Manual trigger for today's unpaid non-credit reverse (owner/admin).
 */
exports.runInvoiceClosingNow = async (req, res) => {
  try {
    const { facilityId } = req.params;
    const userId = req.body?.userId || pickActor(req) || "manual";
    if (!facilityId) {
      return res.status(400).json({ success: false, message: "facilityId is required" });
    }

    const {
      reverseUnpaidNonCreditInvoicesForFacility,
      getNowPartsInTimezone,
    } = require("../services/invoiceClosingService");

    const business = await db.business.findByPk(facilityId);
    if (!business) {
      return res.status(404).json({ success: false, message: "Business not found" });
    }

    const summary = await reverseUnpaidNonCreditInvoicesForFacility({
      facilityId,
      userId,
      reason:
        req.body?.reason ||
        `Manually reversed unpaid non-credit invoices after closing time ${business.invoice_closing_time || "17:00"}`,
    });

    const parts = getNowPartsInTimezone(
      business.invoice_closing_timezone || "Africa/Lagos",
    );
    await db.business.update(
      { invoice_closing_last_run: parts.date },
      { where: { id: facilityId } },
    );

    return res.json({
      success: true,
      message: `Reversed ${summary.reversed} of ${summary.candidates} unpaid non-credit invoice(s)`,
      data: summary,
    });
  } catch (err) {
    console.error("runInvoiceClosingNow:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to run invoice closing",
    });
  }
};

exports.updateDefaultValuationSource = async (req, res) => {
  try {
    const { source, facilityId, user_id } = req.params;

    const validSources = ["default_cost", "system_valuation"];
    if (!validSources.includes(source)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid source. Must be one of: default_cost, system_valuation",
      });
    }

    const [updatedRowsCount] = await db.business.update(
      { default_valuation_source: source },
      {
        where: { id: facilityId },
        returning: true,
      },
    );

    if (updatedRowsCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }

    const updatedBusiness = await db.sequelize.query(
      `SELECT
        b.id,
        b.business_name,
        b.business_type,
        b.business_logo,
        b.primary_color,
        b.secondary_color,
        b.payable_code,
        b.receivable_code,
        b.cost_of_sale,
        b.inv_ev_m,
        b.costing_method,
        b.default_valuation_source,
        m.access_to,
        m.functionalities
      FROM membership m
      INNER JOIN business b ON m.business_id = b.id
      WHERE m.user_id = :user_id AND b.id = :facilityId`,
      {
        replacements: { user_id, facilityId },
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );

    res.json({
      success: true,
      results: updatedBusiness[0] || updatedBusiness,
      message: "Default valuation source updated successfully",
    });
  } catch (err) {
    console.error("Error updating default valuation source:", err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error:
        process.env.NODE_ENV === "development"
          ? err.message
          : "Something went wrong",
    });
  }
};

/** Toggle: set selling_price on Finished Good / Resalable / By-Product supplier-bill stock-in (for sales zone). */
exports.updatePriceSetupResalableOnPurchase = async (req, res) => {
  try {
    const { enabled, facilityId } = req.params;

    const enableFlag =
      enabled === "true" || enabled === "1" || enabled === "yes";

    const [updatedRowsCount] = await db.business.update(
      { price_setup_resalable_on_purchase: enableFlag },
      {
        where: { id: facilityId },
        returning: true,
      },
    );

    if (updatedRowsCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }

    const updatedBusiness = await db.business.findOne({
      where: { id: facilityId },
    });

    res.json({
      success: true,
      results: updatedBusiness,
      message: `Selling price setup on supplier bill ${
        enableFlag ? "enabled" : "disabled"
      } successfully`,
    });
  } catch (err) {
    console.error("Error updating price_setup_resalable_on_purchase:", err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error:
        process.env.NODE_ENV === "development"
          ? err.message
          : "Something went wrong",
    });
  }
};

const parseEnableFlag = (enabled) =>
  enabled === "true" || enabled === "1" || enabled === "yes" || enabled === true;

/** Toggle: enable production correction tools for the business. */
exports.updateEnableProductionCorrection = async (req, res) => {
  try {
    const { enabled, facilityId } = req.params;
    const enableFlag = parseEnableFlag(enabled);

    const [updatedRowsCount] = await db.business.update(
      { enable_production_correction: enableFlag },
      { where: { id: facilityId }, returning: true },
    );

    if (updatedRowsCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }

    const updatedBusiness = await db.business.findOne({
      where: { id: facilityId },
    });

    return res.json({
      success: true,
      results: updatedBusiness,
      message: `Production correction ${
        enableFlag ? "enabled" : "disabled"
      } successfully`,
    });
  } catch (err) {
    console.error("Error updating enable_production_correction:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error:
        process.env.NODE_ENV === "development"
          ? err.message
          : "Something went wrong",
    });
  }
};

/** Toggle: enable Material Requisition for the business. */
exports.updateEnableMaterialRequisition = async (req, res) => {
  try {
    const { enabled, facilityId } = req.params;
    const enableFlag = parseEnableFlag(enabled);

    const [updatedRowsCount] = await db.business.update(
      { enable_material_requisition: enableFlag },
      { where: { id: facilityId }, returning: true },
    );

    if (updatedRowsCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }

    const updatedBusiness = await db.business.findOne({
      where: { id: facilityId },
    });

    return res.json({
      success: true,
      results: updatedBusiness,
      message: `Material requisition ${
        enableFlag ? "enabled" : "disabled"
      } successfully`,
    });
  } catch (err) {
    console.error("Error updating enable_material_requisition:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error:
        process.env.NODE_ENV === "development"
          ? err.message
          : "Something went wrong",
    });
  }
};

/**
 * Correct production date on manufacturing (+ costing) records.
 * Requires business.enable_production_correction.
 */
exports.updateProductionCorrectionDate = async (req, res) => {
  const {
    facilityId,
    batchId,
    batchNo,
    productionDate,
  } = req.body || {};

  if (!facilityId || (!batchId && !batchNo) || !productionDate) {
    return res.status(400).json({
      success: false,
      message: "facilityId, batchId/batchNo, and productionDate are required",
    });
  }

  const parsedDate = moment(productionDate, "YYYY-MM-DD", true);
  if (!parsedDate.isValid()) {
    return res.status(400).json({
      success: false,
      message: "productionDate must be YYYY-MM-DD",
    });
  }

  let transaction;
  try {
    const business = await db.business.findOne({
      where: { id: facilityId },
      attributes: ["id", "enable_production_correction"],
    });
    if (!business) {
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }
    if (!business.enable_production_correction) {
      return res.status(403).json({
        success: false,
        message: "Production correction is disabled for this business",
      });
    }

    transaction = await db.sequelize.transaction();
    const nextDate = parsedDate.format("YYYY-MM-DD");
    const orClauses = [];
    if (batchId) {
      orClauses.push({ id: batchId });
      orClauses.push({ batch_no: batchId });
    }
    if (batchNo) {
      orClauses.push({ batch_no: batchNo });
      orClauses.push({ id: batchNo });
    }

    let mfgUpdated = 0;
    if (db.ProductionManufacturingRecord) {
      const [count] = await db.ProductionManufacturingRecord.update(
        { production_date: nextDate, updated_at: new Date() },
        {
          where: {
            facility_id: facilityId,
            [Op.or]: orClauses,
          },
          transaction,
        },
      );
      mfgUpdated = count;
    }

    let costingUpdated = 0;
    if (db.ProductionCostingRecord) {
      const [count] = await db.ProductionCostingRecord.update(
        { production_date: nextDate, updated_at: new Date() },
        {
          where: {
            facility_id: facilityId,
            [Op.or]: orClauses,
          },
          transaction,
        },
      );
      costingUpdated = count;
    }

    const batchKeys = [
      ...new Set(
        [batchId, batchNo]
          .map((v) => String(v || "").trim())
          .filter(Boolean),
      ),
    ];

    let storeUpdated = 0;
    let ledgerUpdated = 0;
    if (batchKeys.length) {
      const [seResult] = await db.sequelize.query(
        `UPDATE store_entries
         SET receive_date = :nextDate
         WHERE facilityId = :facilityId
           AND (
             reference_number IN (:batchKeys)
             OR batch_id IN (:batchKeys)
           )
           AND type IN ('production', 'consumed')`,
        {
          replacements: { nextDate, facilityId, batchKeys },
          type: db.sequelize.QueryTypes.UPDATE,
          transaction,
        },
      );
      storeUpdated = seResult?.affectedRows || 0;

      const purposeLikes = batchKeys.map((k) => `%Batch: ${k}%`);
      const [glResult] = await db.sequelize.query(
        `UPDATE general_ledger
         SET transaction_date = :nextDate
         WHERE facility_id = :facilityId
           AND (
             reference_number IN (:batchKeys)
             OR ${purposeLikes
               .map((_, i) => `purpose_of_payment LIKE :purpose${i}`)
               .join(" OR ")}
           )`,
        {
          replacements: {
            nextDate,
            facilityId,
            batchKeys,
            ...Object.fromEntries(
              purposeLikes.map((p, i) => [`purpose${i}`, p]),
            ),
          },
          type: db.sequelize.QueryTypes.UPDATE,
          transaction,
        },
      );
      ledgerUpdated = glResult?.affectedRows || 0;
    }

    if (
      mfgUpdated === 0 &&
      costingUpdated === 0 &&
      storeUpdated === 0 &&
      ledgerUpdated === 0
    ) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Production batch not found",
      });
    }

    await transaction.commit();
    return res.json({
      success: true,
      message: "Production date updated",
      data: {
        production_date: nextDate,
        manufacturing_updated: mfgUpdated,
        costing_updated: costingUpdated,
        store_entries_updated: storeUpdated,
        ledger_entries_updated: ledgerUpdated,
      },
    });
  } catch (err) {
    console.error("Error updating production correction date:", err);
    if (transaction) await transaction.rollback().catch(() => {});
    return res.status(500).json({
      success: false,
      message: "Failed to update production date",
      error: err.message,
    });
  }
};

// Toggle/enable online ordering for a business
exports.updateOnlineOrdering = async (req, res) => {
  try {
    const { enabled, facilityId, user_id } = req.params;

    const enableFlag =
      enabled === "true" || enabled === "1" || enabled === "yes";

    const [updatedRowsCount] = await db.business.update(
      { enable_online_ordering: enableFlag },
      {
        where: { id: facilityId },
        returning: true,
      },
    );

    if (updatedRowsCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }

    // Return updated business (lightweight)
    const updatedBusiness = await db.business.findOne({
      where: { id: facilityId },
    });

    res.json({
      success: true,
      results: updatedBusiness,
      message: `Online ordering ${
        enableFlag ? "enabled" : "disabled"
      } successfully`,
    });
  } catch (err) {
    console.error("Error updating online ordering setting:", err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error:
        process.env.NODE_ENV === "development" ? err.message : "Server error",
    });
  }
};

const tinyLinkService = require("../services/tinyLinkService");

const MARKETPLACE_BASE_URL =
  process.env.MARKETPLACE_BASE_URL ||
  (process.env.NODE_ENV === "development"
    ? "http://localhost:5173"
    : "https://flowbooks.org");

const sanitizeLinkUser = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 30);

// Check if a marketplace link username is available
exports.checkMarketplaceLinkUser = async (req, res) => {
  try {
    const { link_user: rawLinkUser, facilityId } = req.query;
    const linkUser = sanitizeLinkUser(rawLinkUser);

    if (!linkUser || linkUser.length < 3) {
      return res.json({
        success: true,
        available: false,
        message:
          "Handle must be at least 3 characters (letters, numbers, _ or -)",
      });
    }

    const { Op } = require("sequelize");
    const where = { link_user: linkUser };
    if (facilityId) {
      where.id = { [Op.ne]: facilityId };
    }

    const existing = await db.business.findOne({
      where,
      attributes: ["id", "business_name"],
    });

    return res.json({
      success: true,
      available: !existing,
      link_user: linkUser,
      message: existing
        ? "This storefront handle is already taken"
        : "Storefront handle is available",
    });
  } catch (err) {
    console.error("Error checking marketplace link user:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// Save marketplace link username for a business
exports.generateMarketplaceLink = async (req, res) => {
  try {
    const { facilityId } = req.params;
    const linkUser = sanitizeLinkUser(req.body?.link_user);

    if (!linkUser || linkUser.length < 3) {
      return res.status(400).json({
        success: false,
        message:
          "Handle must be at least 3 characters (letters, numbers, _ or -)",
      });
    }

    const business = await db.business.findOne({
      where: { id: facilityId },
    });

    if (!business) {
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }

    if (!business.enable_online_ordering) {
      return res.status(400).json({
        success: false,
        message: "Enable Online Store before generating a marketplace link",
      });
    }

    const { Op } = require("sequelize");
    const taken = await db.business.findOne({
      where: {
        link_user: linkUser,
        id: { [Op.ne]: facilityId },
      },
      attributes: ["id"],
    });

    if (taken) {
      return res.status(409).json({
        success: false,
        message:
          "This storefront handle is already taken. Please choose another.",
      });
    }

    const handleChanged = business.link_user !== linkUser;

    await db.business.update(
      {
        link_user: linkUser,
        ...(handleChanged ? { marketplace_tiny_link: null } : {}),
      },
      { where: { id: facilityId } },
    );

    const updatedBusiness = await db.business.findOne({
      where: { id: facilityId },
    });

    const storefrontLink = `${MARKETPLACE_BASE_URL}/i/${linkUser}`;

    return res.json({
      success: true,
      results: updatedBusiness,
      storefrontLink,
      link_user: linkUser,
      message: "Storefront handle saved successfully",
    });
  } catch (err) {
    console.error("Error saving marketplace storefront handle:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error:
        process.env.NODE_ENV === "development" ? err.message : "Server error",
    });
  }
};

const MARKETPLACE_SOCIAL_KEYS = [
  "instagram",
  "facebook",
  "x",
  "linkedin",
  "whatsapp",
  "telegram",
];

const emptyMarketplaceSocialMedia = () =>
  Object.fromEntries(MARKETPLACE_SOCIAL_KEYS.map((key) => [key, []]));

const sanitizeSocialHandle = (value, key) => {
  let next = String(value || "").trim();
  if (!next) return "";

  if (key === "whatsapp") {
    next = next.replace(/[^\d+]/g, "");
    if (next.startsWith("+")) {
      next = next.slice(1).replace(/\D/g, "");
    } else {
      next = next.replace(/\D/g, "");
    }
    return next.slice(0, 20);
  }

  if (key === "linkedin") {
    next = next.replace(/^https?:\/\/(www\.)?linkedin\.com\//i, "");
    next = next.replace(/^@+/, "");
    return next.slice(0, 120);
  }

  next = next.replace(/^@+/, "");
  next = next.replace(/^https?:\/\/(www\.)?/i, "");

  if (key === "instagram") {
    next = next.replace(/^instagram\.com\//i, "");
  } else if (key === "facebook") {
    next = next.replace(/^facebook\.com\//i, "");
  } else if (key === "x") {
    next = next.replace(/^(twitter\.com|x\.com)\//i, "");
  } else if (key === "telegram") {
    next = next.replace(/^t\.me\//i, "");
  }

  return next.replace(/\/+$/, "").slice(0, 80);
};

const normalizeMarketplaceSocialMedia = (input) => {
  const base = emptyMarketplaceSocialMedia();
  if (!input || typeof input !== "object") {
    return base;
  }

  for (const key of MARKETPLACE_SOCIAL_KEYS) {
    const raw = input[key];
    const values = Array.isArray(raw) ? raw : raw ? [raw] : [];

    const seen = new Set();
    base[key] = values
      .map((item) => sanitizeSocialHandle(item, key))
      .filter((item) => {
        if (!item || seen.has(item)) return false;
        seen.add(item);
        return true;
      });
  }

  return base;
};

// Update marketplace social media handles for storefront
exports.updateMarketplaceSocialMedia = async (req, res) => {
  try {
    const { facilityId } = req.params;
    const enableFlag = Boolean(req.body?.enable_marketplace_social_media);
    const socialMedia = normalizeMarketplaceSocialMedia(
      req.body?.marketplace_social_media,
    );

    const business = await db.business.findOne({
      where: { id: facilityId },
    });

    if (!business) {
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }

    if (!business.enable_online_ordering) {
      return res.status(400).json({
        success: false,
        message: "Enable Online Store before configuring social media handles",
      });
    }

    await db.business.update(
      {
        enable_marketplace_social_media: enableFlag,
        marketplace_social_media: socialMedia,
      },
      { where: { id: facilityId } },
    );

    const updatedBusiness = await db.business.findOne({
      where: { id: facilityId },
    });

    return res.json({
      success: true,
      results: updatedBusiness,
      marketplace_social_media: socialMedia,
      message: "Social media handles saved successfully",
    });
  } catch (err) {
    console.error("Error updating marketplace social media:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error:
        process.env.NODE_ENV === "development" ? err.message : "Server error",
    });
  }
};

// Generate external tiny link for storefront URL (requires storefront handle first)
exports.generateMarketplaceTinyLink = async (req, res) => {
  try {
    const { facilityId } = req.params;

    const business = await db.business.findOne({
      where: { id: facilityId },
    });

    if (!business) {
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }

    if (!business.enable_online_ordering) {
      return res.status(400).json({
        success: false,
        message: "Enable Online Store before generating a marketplace link",
      });
    }

    if (!business.link_user) {
      return res.status(400).json({
        success: false,
        message: "Set up your storefront handle before generating a tiny link",
      });
    }

    const storefrontLink = `${MARKETPLACE_BASE_URL}/i/${business.link_user}`;
    const longUrl = req.body?.url || storefrontLink;
    const domain = req.body?.domain || "tinyurl.com";
    const alias = req.body?.alias || business.link_user || null;
    const force =
      req.body?.force === true || req.body?.force === "true" || Boolean(alias);

    if (business.marketplace_tiny_link && !force) {
      const updatedBusiness = await db.business.findOne({
        where: { id: facilityId },
      });

      return res.json({
        success: true,
        results: updatedBusiness,
        tinyLink: business.marketplace_tiny_link,
        storefrontLink,
        message: "Tiny link already exists",
      });
    }

    const tinyLink = await tinyLinkService.createTinyLink({
      url: longUrl,
      domain,
      alias,
      facilityId,
    });

    await db.business.update(
      { marketplace_tiny_link: tinyLink },
      { where: { id: facilityId } },
    );

    const updatedBusiness = await db.business.findOne({
      where: { id: facilityId },
    });

    return res.json({
      success: true,
      results: updatedBusiness,
      tinyLink,
      storefrontLink,
      message: "Tiny link generated successfully",
    });
  } catch (err) {
    console.error("Error generating marketplace tiny link:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to generate tiny link",
      error:
        process.env.NODE_ENV === "development" ? err.message : "Server error",
    });
  }
};

/** Set default receipt type for sales: pdf (standard) or terminal (80mm thermal). */
exports.updateDefaultReceiptType = async (req, res) => {
  try {
    const { receiptType, facilityId, user_id } = req.params;
    const normalized = String(receiptType || "").toLowerCase();

    if (!["pdf", "terminal"].includes(normalized)) {
      return res.status(400).json({
        success: false,
        message: "receiptType must be 'pdf' or 'terminal'",
      });
    }

    const [updatedRowsCount] = await db.business.update(
      { default_receipt_type: normalized },
      { where: { id: facilityId } },
    );

    if (updatedRowsCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }

    const updatedBusiness = await db.business.findOne({
      where: { id: facilityId },
    });

    res.json({
      success: true,
      results: updatedBusiness,
      message: `Default receipt type set to ${normalized}`,
    });
  } catch (err) {
    console.error("Error updating default receipt type:", err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error:
        process.env.NODE_ENV === "development" ? err.message : "Server error",
    });
  }
};

exports.updateVATPolicy = async (req, res) => {
  try {
    const { policy, user_id, facilityId } = req.params;
    console.log(policy, user_id, facilityId);

    // Validate policy
    const validPolicies = ["vat_exclusive", "vat_inclusive", "all"];
    if (!validPolicies.includes(policy)) {
      return res.status(400).json({
        success: false,
        message: `Invalid VAT policy. Must be one of: ${validPolicies.join(
          ", ",
        )}`,
      });
    }

    // Update the business record using the Business model
    const [updatedRowsCount] = await db.business.update(
      { vat_policy: policy },
      {
        where: { id: facilityId },
        returning: true,
      },
    );

    if (updatedRowsCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Business not found or no changes made",
      });
    }

    // Get the updated business record with membership data
    const updatedBusiness = await db.sequelize.query(
      `SELECT
        b.id,
        b.business_name,
        b.business_type,
        b.business_logo,
        b.primary_color,
        b.secondary_color,
        b.business_phone,
        b.prefix,
        b.payable_code,
        b.receivable_code,
        b.vat_policy,
        b.cost_of_sale,
        b.payable_accural_code,
        b.receivable_accural_code,
        b.sale_revenue_code,
        b.inv_ev_m,
        b.costing_method,
        b.vat_policy,
        m.access_to,
        m.functionalities
      FROM membership m
      INNER JOIN business b ON m.business_id = b.id
      WHERE m.user_id = :user_id AND b.id = :facilityId`,
      {
        replacements: { user_id, facilityId },
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );

    res.json({
      success: true,
      results: updatedBusiness[0] || updatedBusiness,
      message: "VAT policy updated successfully",
    });
  } catch (err) {
    console.error("Error updating VAT policy:", err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error:
        process.env.NODE_ENV === "development"
          ? err.message
          : "Something went wrong",
    });
  }
};

exports.updateAllowSalesWithoutStock = async (req, res) => {
  try {
    const { enabled, user_id, facilityId } = req.params;
    console.log(enabled, user_id, facilityId);

    // Validate enabled value (should be "0" or "1")
    const isEnabled = enabled === "1" || enabled === "true" || enabled === true;

    // Update the business record using the Business model
    const [updatedRowsCount] = await db.business.update(
      { allow_sales_without_stock: isEnabled },
      {
        where: { id: facilityId },
        returning: true,
      },
    );

    if (updatedRowsCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Business not found or no changes made",
      });
    }

    // Get the updated business record with membership data
    const updatedBusiness = await db.sequelize.query(
      `SELECT
        b.id,
        b.business_name,
        b.business_type,
        b.business_logo,
        b.primary_color,
        b.secondary_color,
        b.business_phone,
        b.prefix,
        b.payable_code,
        b.receivable_code,
        b.vat_policy,
        b.cost_of_sale,
        b.payable_accural_code,
        b.receivable_accural_code,
        b.sale_revenue_code,
        b.inv_ev_m,
        b.costing_method,
        b.allow_sales_without_stock,
        m.access_to,
        m.functionalities
      FROM membership m
      INNER JOIN business b ON m.business_id = b.id
      WHERE m.user_id = :user_id AND b.id = :facilityId`,
      {
        replacements: { user_id, facilityId },
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );

    res.json({
      success: true,
      results: updatedBusiness[0] || updatedBusiness,
      message: "Allow sales without stock setting updated successfully",
    });
  } catch (err) {
    console.error("Error updating allow sales without stock:", err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error:
        process.env.NODE_ENV === "development"
          ? err.message
          : "Something went wrong",
    });
  }
};

exports.updatePayeAutoCalculation = async (req, res) => {
  try {
    const { enabled, user_id, facilityId } = req.params;
    const isEnabled = enabled === "1" || enabled === "true" || enabled === true;

    const [updatedRowsCount] = await db.business.update(
      { paye_auto_calculation: isEnabled },
      { where: { id: facilityId } },
    );

    if (updatedRowsCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Business not found or no changes made",
      });
    }

    const updatedBusiness = await db.sequelize.query(
      `SELECT
        b.id,
        b.business_name,
        b.business_type,
        b.business_logo,
        b.primary_color,
        b.secondary_color,
        b.business_phone,
        b.prefix,
        b.payable_code,
        b.receivable_code,
        b.vat_policy,
        b.cost_of_sale,
        b.payable_accural_code,
        b.receivable_accural_code,
        b.sale_revenue_code,
        b.inv_ev_m,
        b.costing_method,
        b.allow_sales_without_stock,
        b.paye_auto_calculation,
        m.access_to,
        m.functionalities
      FROM membership m
      INNER JOIN business b ON m.business_id = b.id
      WHERE m.user_id = :user_id AND b.id = :facilityId`,
      {
        replacements: { user_id, facilityId },
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );

    res.json({
      success: true,
      results: updatedBusiness[0] || updatedBusiness,
      message: "PAYE auto calculation setting updated successfully",
    });
  } catch (err) {
    console.error("Error updating PAYE auto calculation:", err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error:
        process.env.NODE_ENV === "development"
          ? err.message
          : "Something went wrong",
    });
  }
};

exports.updateSeal = (req, res) => {
  const { businessId } = req.params;
  const { seal } = req.body;

  if (seal === undefined) {
    return res.status(400).json({
      success: false,
      message: "Seal field is required (can be null to remove)",
    });
  }

  const query = `
    UPDATE business
    SET seal = :seal
    WHERE id = :businessId
  `;

  db.sequelize
    .query(query, {
      replacements: {
        seal: seal, // Can be Base64 string OR null
        businessId: businessId,
      },
      type: db.Sequelize.QueryTypes.UPDATE,
    })
    .then(([rowsUpdated]) => {
      // rowsUpdated is number of affected rows
      if (rowsUpdated === 0) {
        return res.status(404).json({
          success: false,
          message: "No business found with that ID",
        });
      }

      res.json({
        success: true,
        message: seal
          ? "Business seal updated successfully"
          : "Business seal removed successfully",
      });
    })
    .catch((err) => {
      console.error("Error updating business seal:", err);
      res.status(500).json({
        success: false,
        message: "Server error. Could not update seal.",
        err: err.message,
      });
    });
};

exports.updateStamp = (req, res) => {
  const { businessId } = req.params;
  const { stamp } = req.body;

  if (stamp === undefined) {
    return res.status(400).json({
      success: false,
      message: "Stamp field is required (can be null to remove)",
    });
  }

  const query = `
    UPDATE business
    SET stamp = :stamp
    WHERE id = :businessId
  `;

  db.sequelize
    .query(query, {
      replacements: {
        stamp: stamp,
        businessId: businessId,
      },
      type: db.Sequelize.QueryTypes.UPDATE,
    })
    .then(([rowsUpdated]) => {
      // rowsUpdated is number of affected rows
      if (rowsUpdated === 0) {
        return res.status(404).json({
          success: false,
          message: "No business found with that ID",
        });
      }

      res.json({
        success: true,
        message: stamp
          ? "Business stamp updated successfully"
          : "Business stamp removed successfully",
      });
    })
    .catch((err) => {
      console.error("Error updating business stamp:", err);
      res.status(500).json({
        success: false,
        message: "Server error. Could not update stamp.",
        err: err.message,
      });
    });
};

exports.updateLogo = (req, res) => {
  const { businessId } = req.params;
  const { business_logo } = req.body;

  if (business_logo === undefined) {
    return res.status(400).json({
      success: false,
      message: "Logo field is required (can be null to remove)",
    });
  }

  const query = `
    UPDATE business
    SET business_logo = :business_logo
    WHERE id = :businessId
  `;

  db.sequelize
    .query(query, {
      replacements: {
        business_logo: business_logo, // Can be Base64 string OR null
        businessId: businessId,
      },
      type: db.Sequelize.QueryTypes.UPDATE,
    })
    .then(([rowsUpdated]) => {
      // rowsUpdated is number of affected rows
      if (rowsUpdated === 0) {
        return res.status(404).json({
          success: false,
          message: "No business found with that ID",
        });
      }

      res.json({
        success: true,
        message: business_logo
          ? "Business logo updated successfully"
          : "Business logo removed successfully",
      });
    })
    .catch((err) => {
      console.error("Error updating business logo:", err);
      res.status(500).json({
        success: false,
        message: "Server error. Could not update logo.",
        err: err.message,
      });
    });
};

exports.updateDocumentHeaderStyle = (req, res) => {
  const { businessId } = req.params;
  const style = String(req.body?.document_header_style || "")
    .trim()
    .toLowerCase();

  if (!["text", "logo"].includes(style)) {
    return res.status(400).json({
      success: false,
      message: "document_header_style must be 'text' or 'logo'",
    });
  }

  db.sequelize
    .query(
      `UPDATE business SET document_header_style = :style WHERE id = :businessId`,
      {
        replacements: { style, businessId },
        type: db.Sequelize.QueryTypes.UPDATE,
      },
    )
    .then(([rowsUpdated]) => {
      if (rowsUpdated === 0) {
        return res.status(404).json({
          success: false,
          message: "No business found with that ID",
        });
      }
      res.json({
        success: true,
        message: "Document header style updated successfully",
        results: { document_header_style: style },
      });
    })
    .catch((err) => {
      console.error("Error updating document header style:", err);
      res.status(500).json({
        success: false,
        message: "Server error. Could not update document header style.",
        err: err.message,
      });
    });
};

exports.updateInvoiceNotes = (req, res) => {
  const { businessId } = req.params;
  const customer_notes =
    req.body?.customer_notes !== undefined
      ? String(req.body.customer_notes)
      : undefined;
  const terms_conditions =
    req.body?.terms_conditions !== undefined
      ? String(req.body.terms_conditions)
      : undefined;

  if (customer_notes === undefined && terms_conditions === undefined) {
    return res.status(400).json({
      success: false,
      message: "customer_notes or terms_conditions is required",
    });
  }

  const sets = [];
  const replacements = { businessId };
  if (customer_notes !== undefined) {
    sets.push("customer_notes = :customer_notes");
    replacements.customer_notes = customer_notes;
  }
  if (terms_conditions !== undefined) {
    sets.push("terms_conditions = :terms_conditions");
    replacements.terms_conditions = terms_conditions;
  }

  db.sequelize
    .query(
      `UPDATE business SET ${sets.join(", ")} WHERE id = :businessId`,
      {
        replacements,
        type: db.Sequelize.QueryTypes.UPDATE,
      },
    )
    .then(([rowsUpdated]) => {
      if (rowsUpdated === 0) {
        return res.status(404).json({
          success: false,
          message: "No business found with that ID",
        });
      }
      res.json({
        success: true,
        message: "Invoice notes updated successfully",
        results: {
          ...(customer_notes !== undefined ? { customer_notes } : {}),
          ...(terms_conditions !== undefined ? { terms_conditions } : {}),
        },
      });
    })
    .catch((err) => {
      console.error("Error updating invoice notes:", err);
      res.status(500).json({
        success: false,
        message: "Server error. Could not update invoice notes.",
        err: err.message,
      });
    });
};

exports.updateDashboardWidgets = (req, res) => {
  const { businessId } = req.params;
  const { dashboard_widgets } = req.body;

  if (dashboard_widgets === undefined) {
    return res.status(400).json({
      success: false,
      message: "dashboard_widgets field is required",
    });
  }

  // Validate that dashboard_widgets is a valid JSON string or object
  let widgetsJson;
  try {
    widgetsJson =
      typeof dashboard_widgets === "string"
        ? dashboard_widgets
        : JSON.stringify(dashboard_widgets);
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: "dashboard_widgets must be valid JSON",
    });
  }

  const query = `
    UPDATE business
    SET dashboard_widgets = :dashboard_widgets
    WHERE id = :businessId
  `;

  db.sequelize
    .query(query, {
      replacements: {
        dashboard_widgets: widgetsJson,
        businessId: businessId,
      },
      type: db.Sequelize.QueryTypes.UPDATE,
    })
    .then(([rowsUpdated]) => {
      if (rowsUpdated === 0) {
        return res.status(404).json({
          success: false,
          message: "No business found with that ID",
        });
      }

      // Fetch the updated business record with membership data
      const { user_id } = req.body;

      let query;
      let replacements;

      if (user_id) {
        // Join with membership table if user_id is provided
        query = `
          SELECT
            b.*,
            m.access_to,
            m.functionalities
          FROM business b
          LEFT JOIN membership m ON m.business_id = b.id AND m.user_id = :user_id
          WHERE b.id = :businessId
        `;
        replacements = { businessId, user_id };
      } else {
        // Fallback to simple query if user_id is not provided
        query = `SELECT * FROM business WHERE id = :businessId`;
        replacements = { businessId };
      }

      return db.sequelize.query(query, {
        replacements,
        type: db.Sequelize.QueryTypes.SELECT,
      });
    })
    .then((businessRecords) => {
      if (!businessRecords || businessRecords.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Business not found after update",
        });
      }

      const updatedBusiness = businessRecords[0];

      // Parse dashboard_widgets if it's a string
      if (typeof updatedBusiness.dashboard_widgets === "string") {
        try {
          updatedBusiness.dashboard_widgets = JSON.parse(
            updatedBusiness.dashboard_widgets,
          );
        } catch (e) {
          // If parsing fails, keep as string
        }
      }

      res.json({
        success: true,
        message: "Dashboard widgets updated successfully",
        business: updatedBusiness,
      });
    })
    .catch((err) => {
      console.error("Error updating dashboard widgets:", err);
      res.status(500).json({
        success: false,
        message: "Server error. Could not update dashboard widgets.",
        err: err.message,
      });
    });
};

exports.getAccByHead = (req, res) => {
  const { head, facilityId } = req.params;

  db.sequelize
    .query(`call get_account_by_head(:head, :facilityId)`, {
      replacements: {
        head,
        facilityId,
      },
    })
    .then((results) => res.json({ success: true, results: results }))
    .catch((err) => {
      console.log(err);
      res.json({ success: false, err });
    });
};

exports.addNewAdditionExpenses = (req, res) => {
  const { trans_date, PONo, description, expenses_amnt, facilityId } = req.body;
  db.sequelize
    .query(
      `INSERT INTO other_expenses(trans_date,PONo,description,amount,facilityId) VALUES
  ("${trans_date}","${PONo}","${description}","${expenses_amnt}","${facilityId}")`,
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => {
      console.log(err);
      res.json({ success: false, err });
    });
};

exports.updatePatientDetailsEdit = (req, res) => {
  const {
    accName,
    contactAddress,
    contactPhone,
    credit_limit,
    guarantor_name,
    guarantor_address,
    guarantor_phone,
    balance,
  } = req.body;
  const { accountNo, facilityId } = req.params;

  db.sequelize
    .query(
      `call update_customer(:accName,
        :contactAddress,
        :credit_limit,
        :contactPhone,
        :guarantor_name,
        :guarantor_address,
        :guarantor_phone,
        :balance,
        :accountNo,
        :facilityId)`,
      {
        replacements: {
          accName,
          contactAddress,
          credit_limit,
          contactPhone,
          guarantor_name,
          guarantor_address,
          guarantor_phone,
          balance: balance,
          accountNo,
          facilityId,
        },
      },
    )
    .then((results) => {
      res.json({
        success: true,
        results,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};
exports.getPatientDetailsEdit = (req, res) => {
  const { accountNo, facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT * FROM customers WHERE accName!='Instant Payment' AND accountNo="${accountNo}"  AND facilityId="${facilityId}"`,
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.updateOtherExpense = (req, res) => {
  const { description, amount } = req.body;
  const { id, PONo } = req.params;
  db.sequelize
    .query(`call update_other_expenses(:description,:amount,:id,:PONo)`, {
      replacements: {
        description: description,
        PONo: PONo,
        amount: amount,
        id: id,
      },
    })
    .then((results) => {
      res.json({
        success: true,
        results: results,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getRequisitionSummary = (req, res) => {
  const { from, to, branch } = req.params;
  const { query_type = "", req_no = "" } = req.query;

  db.sequelize
    .query(
      `call getBranchRequisitionList(:from_date,:to_date,:in_branch_name,:query_type,:req_no)`,
      {
        replacements: {
          from_date: from,
          to_date: to,
          in_branch_name: branch,
          query_type,
          req_no,
        },
      },
    )
    .then((results) => {
      res.json({
        success: true,
        results: results,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

/**
 * Purchase requisition queries — direct SQL/ORM (no stored procedure).
 */
async function runPurchaseRequisitionQuery({
  query_type = "",
  branch = "",
  branch_id = "",
  date = null,
  reason = "",
  facilityId,
  requisitor = "",
  user_id = "",
  supplier_name = "",
  supplier_code = "",
  total = null,
  pr_no = "",
  po_no = "",
  account_code = "",
  transaction = null,
}) {
  const qt = String(query_type || "").trim();
  const opts = transaction ? { transaction } : {};

  if (qt === "insert") {
    await db.PurchaseRequisition.create(
      {
        pr_no,
        po_no: po_no || null,
        branch: branch || "",
        branch_id: branch_id || null,
        date: date || moment().format("YYYY-MM-DD"),
        reason: reason || null,
        facilityId,
        requisitor: requisitor || "",
        user_id: user_id || "",
        supplier_name: supplier_name || null,
        supplier_code: supplier_code || null,
        total: total != null ? total : 0,
        amount: 0,
        status: "Pending",
        account_code: account_code || "",
        created_at: new Date(),
      },
      opts,
    );
    return [{ pr_no, status: "Pending" }];
  }

  if (qt === "select" || qt === "select-pending") {
    const rows = await db.PurchaseRequisition.findAll({
      where: { facilityId, status: "Pending" },
      order: [
        ["date", "DESC"],
        ["created_at", "DESC"],
      ],
      ...opts,
      raw: true,
    });
    return rows;
  }

  if (qt === "select-history" || qt === "select-all") {
    const rows = await db.PurchaseRequisition.findAll({
      where: { facilityId },
      order: [
        ["date", "DESC"],
        ["created_at", "DESC"],
      ],
      ...opts,
      raw: true,
    });
    return rows;
  }

  if (qt === "select-approved") {
    const rows = await db.PurchaseRequisition.findAll({
      where: {
        facilityId,
        status: { [Op.in]: ["Approved", "Pending Payment"] },
      },
      order: [
        ["date", "DESC"],
        ["created_at", "DESC"],
      ],
      ...opts,
      raw: true,
    });
    return rows;
  }

  if (qt === "select-grn") {
    const rows = await db.PurchaseRequisition.findAll({
      where: { facilityId, status: "Approved" },
      order: [
        ["date", "DESC"],
        ["created_at", "DESC"],
      ],
      ...opts,
      raw: true,
    });
    return rows;
  }

  if (qt === "select-pending-payment") {
    const rows = await db.sequelize.query(
      `SELECT *
       FROM purchase_requisition
       WHERE facilityId = :facilityId
         AND status = 'Pending Payment'
         AND IFNULL(total, 0) - IFNULL(amount, 0) > 0
       ORDER BY date DESC, created_at DESC`,
      {
        replacements: { facilityId },
        type: QueryTypes.SELECT,
        ...opts,
      },
    );
    return rows;
  }

  if (qt === "select-individual" || qt === "select-pr") {
    const where =
      qt === "select-individual"
        ? { facilityId, pr_no }
        : { pr_no };
    const rows = await db.PurchaseRequisition.findAll({
      where,
      ...opts,
      raw: true,
    });
    return rows;
  }

  if (qt === "select-exp") {
    // Explicit COLLATE avoids utf8mb4_general_ci vs unicode_ci join errors
    const rows = await db.sequelize.query(
      `SELECT
         a.item_code,
         COALESCE(b.name, a.item_name) AS item_name,
         b.inventory_account,
         a.unit_measure,
         a.quantity,
         a.approved_qty,
         a.id,
         a.est_cost,
         a.unit_category,
         a.chart_code,
         b.unit_of_measure AS uom,
         b.cogs_head,
         b.revenue_account
       FROM requisition_details a
       LEFT JOIN products b
         ON a.item_code COLLATE utf8mb4_unicode_ci = b.sku COLLATE utf8mb4_unicode_ci
        AND (
          b.facility_id IS NULL
          OR a.facilityId COLLATE utf8mb4_unicode_ci = b.facility_id COLLATE utf8mb4_unicode_ci
        )
       WHERE a.pr_no COLLATE utf8mb4_unicode_ci = :pr_no COLLATE utf8mb4_unicode_ci
         AND (
           :facilityId = ''
           OR a.facilityId COLLATE utf8mb4_unicode_ci = :facilityId COLLATE utf8mb4_unicode_ci
         )
       ORDER BY a.id ASC`,
      {
        replacements: { pr_no, facilityId: facilityId || "" },
        type: QueryTypes.SELECT,
        ...opts,
      },
    );
    return rows;
  }

  if (qt === "update") {
    await db.PurchaseRequisition.update(
      { status: "Approved", po_no: po_no || null },
      { where: { pr_no }, ...opts },
    );
    return [{ pr_no, status: "Approved", po_no }];
  }

  if (qt === "update-pending") {
    await db.PurchaseRequisition.update(
      { status: "Pending Payment", po_no: po_no || null },
      { where: { pr_no }, ...opts },
    );
    return [{ pr_no, status: "Pending Payment", po_no }];
  }

  throw new Error(`Unsupported purchase requisition query_type: ${qt || "(empty)"}`);
}

exports.getRequisition = async (req, res) => {
  const {
    branch = "",
    branch_id = "",
    date = null,
    reason = "",
    requisitor = "",
    user_id = "",
    facilityId,
    supplier_name = "",
    supplier_code = "",
    query_type = "",
    total = null,
    pr_no = "",
    po_no = "",
    account_code = "",
  } = req.body;

  try {
    if (!facilityId && !["select-exp", "select-pr"].includes(String(query_type))) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const results = await runPurchaseRequisitionQuery({
      query_type,
      branch,
      branch_id,
      date,
      reason,
      facilityId,
      requisitor,
      user_id,
      supplier_name,
      supplier_code,
      total,
      pr_no,
      po_no,
      account_code,
    });

    return res.json({
      success: true,
      results,
      message: "Requisition fetched successfully",
    });
  } catch (err) {
    console.error("getRequisition:", err);
    return res.status(500).json({
      success: false,
      err: err.message,
      message: err.message || "Error while trying to fetch requisition",
    });
  }
};

exports.insertRequisition = async (req, res) => {
  const {
    branch = "",
    branch_id = "",
    date = null,
    reason = "",
    requisitor = "",
    user_id = "",
    facilityId,
    supplier_name = "",
    supplier_code = "",
    query_type = "insert",
    total = null,
    pr_no = "",
    expenses = [],
    po_no = "",
    account_code = "",
  } = req.body;

  const transaction = await db.sequelize.transaction();

  try {
    if (!facilityId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const code = await getAndUpdateNumber("pr", facilityId);
    const newCode = pr_no || `PR/${moment().format("YY")}/${code}`;

    const requisitionResult = await runPurchaseRequisitionQuery({
      query_type: query_type || "insert",
      branch,
      branch_id,
      date: date || moment().format("YYYY-MM-DD"),
      reason,
      facilityId,
      requisitor,
      user_id,
      supplier_name,
      supplier_code,
      total,
      pr_no: newCode,
      po_no,
      account_code: account_code || "",
      transaction,
    });

    if (expenses && expenses.length > 0) {
      for (const expense of expenses) {
        await db.RequisitionDetail.create(
          {
            facilityId,
            pr_no: newCode,
            item_code: expense.item_code || expense.code || "",
            chart_code: expense.chart_code || "",
            item_name: expense.item || expense.item_name || "",
            est_cost: expense.estCost || expense.est_cost || 0,
            unit_category: expense.category || expense.unit_category || "",
            unit_measure: expense.unit || expense.unit_measure || expense.uom || "",
            quantity: expense.quantity || 0,
            created_at: new Date(),
          },
          { transaction },
        );
      }
    }

    await transaction.commit();

    await recordActivity({
      facilityId,
      userId: pickActor(req) || user_id || requisitor,
      action: "create",
      entityType: "purchase_requisition",
      entityId: newCode,
      entityLabel: newCode,
      after: {
        pr_no: newCode,
        supplier_code,
        total,
        reason,
        line_count: expenses?.length || 0,
      },
      remark: reason || "Purchase requisition created",
    });

    return res.json({
      success: true,
      results: requisitionResult,
      pr_no: newCode,
      message: "Requisition created successfully",
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Error creating requisition:", error);
    return res.status(500).json({
      success: false,
      error: error.message,
      message: "Error while trying to create requisition",
    });
  }
};

exports.updateRequisition = async (req, res) => {
  const {
    branch = "",
    branch_id = "",
    date = null,
    reason = "",
    requisitor = "",
    user_id = "",
    facilityId,
    supplier_name = "",
    supplier_code = "",
    query_type = "",
    total = null,
    pr_no = "",
    account_code = "",
    items = [],
  } = req.body;

  try {
    if (!pr_no) {
      return res.status(400).json({
        success: false,
        message: "pr_no is required",
      });
    }

    let newCode = "";
    if (query_type === "update" || query_type === "update-pending") {
      const code = await getAndUpdateNumber("po", facilityId);
      newCode = `PO/${moment().format("YY")}/${code}`;
    }

    const results = await runPurchaseRequisitionQuery({
      query_type,
      branch,
      branch_id,
      date,
      reason,
      facilityId,
      requisitor,
      user_id,
      supplier_name,
      supplier_code,
      total,
      pr_no,
      po_no: newCode,
      account_code: account_code || "",
    });

    if (Array.isArray(items) && items.length > 0 && pr_no && facilityId) {
      for (const item of items) {
        const approvedQty = parseFloat(item.approved_qty);
        if (!Number.isFinite(approvedQty)) continue;

        const where = { pr_no, facilityId };
        if (item.id) where.id = item.id;
        else if (item.item_code) where.item_code = item.item_code;
        else continue;

        await db.RequisitionDetail.update(
          { approved_qty: approvedQty },
          { where },
        );
      }
    }

    if (query_type !== "select") {
      await recordActivity({
        facilityId,
        userId: pickActor(req) || user_id || requisitor,
        action: "update",
        entityType: "purchase_requisition",
        entityId: pr_no,
        entityLabel: pr_no,
        after: {
          pr_no,
          po_no: newCode || undefined,
          query_type,
          supplier_code,
          total,
          status: query_type,
        },
        remark: "Purchase requisition updated",
      });
    }

    return res.json({
      success: true,
      results,
      po_no: newCode || undefined,
      message:
        query_type === "select"
          ? "Requisition fetched successfully"
          : "Requisition updated successfully",
    });
  } catch (err) {
    console.error("updateRequisition:", err);
    return res.status(500).json({
      success: false,
      err: err.message,
      message: "Error while trying to update requisition",
    });
  }
};

exports.generateGoodReceive1 = async (req, res) => {
  const generatedPVCode = `REF/${moment().format("YY")}/${Math.floor(
    Math.random() * 1000,
  )}`;
  const {
    branch,
    branch_id,
    query_type = "good_recieved_goods",
    cost_price = 0,
    destination = "",
    facilityId,
    grn_no = "",
    chart_code = "",
    item_name = "",
    items = [],
    mode_of_payment = "",
    note_description = "",
    pv_no = "",
    user_id = "",
    version_id = "",
    qty_in = 0,
    qty_out = 0,
    reference_number = generatedPVCode,
    requisitor = "",
    source = "",
    store_id = "",
    supplier_code = "",
    supplier_name = "",
    total = 0,
    truck_no = "",
    waybill = "",
    account_type = "",
    balance_type = "",
    cheque_number = "",
    branch_name = "",
    waybill_no = "",
    bank_name = "",
    account_number = "",
    imageId = "",
    date = moment().format("YYYY-MM-DD"),
    item_description = "",
    payment_type = "",
    payment_mode = "",
    payment_description = "",
    purpose_of_payment = "",
    purpose = "",
    store_type = "",
    account_code = "",
    pr_no = "",
  } = req.body;

  console.log("Request body: ", req.body);

  console.log(items, "=====================>items");

  try {
    const itemPromises = [];
    let grn_no;
    await new Promise((resolve, reject) => {
      numberGenerator({ query_type: "grn" }, (res) => {
        if (res) {
          grn_no = res[0].grn;
          resolve();
        } else {
          reject("Failed to generate number");
        }
      });
    });
    console.log(req.body.items);
    numberGeneratorUpdate(
      { query_type: "grn", in_number: grn_no },
      (rev) => {},
    );
    const grnCode = `GRN/${moment().format("YY")}/${grn_no}`;

    // Use for...of to await number generation sequentially
    for (const item of items) {
      const rev = await new Promise((resolve, reject) => {
        numberGenerator({ query_type: "str" }, (res) => {
          if (res) resolve(res);
          else reject("Failed to generate number");
        });
      });

      const newCode = `STR/${moment().format("YY")}/${rev[0].str_id}`;

      // Update number generator
      await new Promise(async (resolve, reject) => {
        await numberGeneratorUpdate(
          { query_type: "str", in_number: rev[0].str_id },
          (updateRes) => {
            resolve(updateRes);
            // if (updateRes && updateRes[0]?.success) {

            // } else {
            //   reject(new Error("Failed to update number"));
            // }
          },
        );
      });

      // Add DB store call to promise list
      itemPromises.push(
        db.sequelize.query(
          `CALL store_entries(
            :query_type,
            :item_name,
            :qty_in,
            :selling_price,
            :transaction_date,
            :item_category,
            :item_code,
            :version_id,
            :facilityId,
            :qty_out,
            :req_no,
            :user_id,
            :cost_price,
            :supplier_code,
            :supplier_name,
            :sales_type,
            :store_name,
            :mark_up,
            :truck_no,
            :waybill_no,
            :reorder_level,
            :inserted_by,
            :branch_name,
            :po_no,
            :expire_date,
            :unit_price,
            :reference_number,
            :subhead,
            :category,
            :unit
          )`,
          {
            replacements: {
              item_name: item?.item_name || "",
              qty_in: item?.quantity || 0,
              qty_out: item?.qty_out || 0,
              store_type: store_type,
              grn_no: grnCode,
              query_type,
              unit_price: parseInt(item?.est_cost) || 0,
              mark_up: 0.0,
              selling_price: item?.selling_price || 0,
              status: "Pending",
              branch_name,
              facilityId,
              item_category: item?.item_category || "",
              trn_no: null,
              item_code: item?.item_code || "",
              version_id,
              req_no: grn_no,
              truck_no,
              waybill_no,
              reorder_level: item?.reorder_level || 0,
              cost_price: parseInt(item?.est_cost) || 0,
              receipt_no: null,
              user_id: user_id,
              supplier_code: supplier_code,
              supplier_name: supplier_name,
              item_subhead: item?.chart_code || "",
              transaction_date: date,
              sales_type: "",
              store_name: branch_name,
              inserted_by: user_id,
              po_no: pr_no,
              expire_date: item?.expire_date || null,
              reference_number,
              subhead: item?.chart_code || "",
              category: item?.item_category || "",
              unit: item?.unit || "",
            },
          },
        ),
      );
    }

    // Ledger entries

    // credit

    itemPromises.push(
      db.sequelize.query(
        `CALL general_ledger(
            :query_type, :entries_date, :amount, :destination_name, :head,
            :account_description, :facility_id, :refrence_number, :cheque_no,
            :created_by, :pv_no, :account_type, :balance_type, :payee, :purpose_of_payment,:account_subhead
          )`,
        {
          replacements: {
            query_type: "net",
            entries_date: date,
            amount: total,
            destination_name: supplier_name,
            head: supplier_code,
            account_description: supplier_name,
            facility_id: facilityId,
            refrence_number: reference_number,
            cheque_no: cheque_number || null,
            created_by: requisitor,
            pv_no,
            account_type,
            balance_type,
            payee: supplier_name,
            purpose_of_payment: purpose || "",
            account_subhead: account_code || "",
          },
        },
      ),
    );

    for (const item of items) {
      itemPromises.push(
        db.sequelize.query(
          `CALL general_ledger(
              :query_type, :entries_date, :amount, :destination_name, :head,
              :account_description, :facility_id, :refrence_number, :cheque_no,
              :created_by, :pv_no, :account_type, :balance_type, :payee, :purpose_of_payment,:account_subhead
            )`,
          {
            replacements: {
              query_type: "tax",
              entries_date: date,
              amount: Number(item.est_cost) * Number(item.quantity),
              destination_name: item.item_name,
              head: item.item_code,
              account_description: item.item_name,
              facility_id: facilityId,
              refrence_number: reference_number,
              cheque_no: cheque_number || null,
              created_by: requisitor,
              pv_no,
              account_type,
              balance_type,
              payee: supplier_name,
              purpose_of_payment: purpose || "",
              account_subhead: item.chart_code || "",
            },
          },
        ),
      );
      // itemPromises.push(
      //   db.sequelize.query(
      //     `CALL general_ledger(
      //       :query_type, :entries_date, :amount, :destination_name, :head,
      //       :account_description, :facility_id, :refrence_number, :cheque_no,
      //       :created_by, :pv_no, :account_type, :balance_type, :payee, :purpose_of_payment,:account_subhead
      //     )`,
      //     {
      //       replacements: {
      //         query_type: "tax",
      //         entries_date: date,
      //         amount: item.est_cost,
      //         destination_name: item_description,
      //         head: chart_code,
      //         account_description: item_description,
      //         facility_id: facilityId,
      //         refrence_number: reference_number,
      //         cheque_no: cheque_number || null,
      //         created_by: requisitor,
      //         pv_no,
      //         account_type,
      //         balance_type,
      //         payee: supplier_name,
      //         // purpose_of_payment,
      //         purpose_of_payment: purpose || "",
      //         account_subhead: account_subhead || "",
      //       },
      //     }
      //   )
      // );
    }

    await Promise.all(itemPromises);

    return res.json({
      success: true,
      message: "Good receive added successfully",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Error while trying to add good receive",
      error: err,
    });
  }
};
exports.generateGoodReceive = async (req, res) => {
  const generatedPVCode = `REF/${moment().format("YY")}/${Math.floor(
    Math.random() * 1000,
  )}`;
  const {
    branch,
    branch_id,
    query_type = "good_recieved_goods",
    cost_price = 0,
    destination = "",
    facilityId,
    grn_no = "",
    chart_code = "",
    item_name = "",
    items = [],
    mode_of_payment = "",
    note_description = "",
    pv_no = "",
    user_id = "",
    version_id = "",
    qty_in = 0,
    qty_out = 0,
    reference_number = generatedPVCode,
    requisitor = "",
    source = "",
    store_id = "",
    supplier_code = "",
    supplier_name = "",
    total = 0,
    truck_no = "",
    waybill = "",
    account_type = "",
    balance_type = "",
    cheque_number = "",
    branch_name = "",
    waybill_no = "",
    bank_name = "",
    account_number = "",
    imageId = "",
    date = moment().format("YYYY-MM-DD"),
    item_description = "",
    payment_type = "",
    payment_mode = "",
    payment_description = "",
    purpose_of_payment = "",
    purpose = "",
    store_type = "",
    account_code = "",
    pr_no = "",
    additionalCostItem = "",
    additionalCostValue = 0,
    remark = "",
  } = req.body;

  console.log("Request body: ", req.body);

  console.log(items, "=====================>items");

  try {
    const itemPromises = [];
    let grn_no;
    await new Promise((resolve, reject) => {
      numberGenerator({ query_type: "grn" }, (res) => {
        if (res) {
          grn_no = res[0].grn;
          resolve();
        } else {
          reject("Failed to generate number");
        }
      });
    });
    console.log(req.body.items);
    numberGeneratorUpdate(
      { query_type: "grn", in_number: grn_no },
      (rev) => {},
    );
    const grnCode = `GRN/${moment().format("YY")}/${grn_no}`;

    // Use for...of to await number generation sequentially
    for (const item of items) {
      const rev = await new Promise((resolve, reject) => {
        numberGenerator({ query_type: "str" }, (res) => {
          if (res) resolve(res);
          else reject("Failed to generate number");
        });
      });

      const newCode = `STR/${moment().format("YY")}/${rev[0].str_id}`;

      // Update number generator
      await new Promise(async (resolve, reject) => {
        await numberGeneratorUpdate(
          { query_type: "str", in_number: rev[0].str_id },
          (updateRes) => {
            resolve(updateRes);
            // if (updateRes && updateRes[0]?.success) {

            // } else {
            //   reject(new Error("Failed to update number"));
            // }
          },
        );
      });

      // Add DB store call to promise list
      itemPromises.push(
        db.sequelize.query(
          `CALL store_entries(
            :query_type,
            :item_name,
            :qty_in,
            :selling_price,
            :transaction_date,
            :item_category,
            :item_code,
            :version_id,
            :facilityId,
            :qty_out,
            :req_no,
            :user_id,
            :cost_price,
            :supplier_code,
            :supplier_name,
            :sales_type,
            :store_name,
            :mark_up,
            :truck_no,
            :waybill_no,
            :reorder_level,
            :inserted_by,
            :branch_name,
            :po_no,
            :expire_date,
            :unit_price,
            :reference_number,
            :subhead,
            :category,
            :unit
          )`,
          {
            replacements: {
              item_name: item?.item_name || "",
              qty_in: item?.quantity || 0,
              qty_out: item?.qty_out || 0,
              store_type: store_type,
              grn_no: grnCode,
              query_type,
              unit_price: parseInt(item?.est_cost) || 0,
              mark_up: 0.0,
              selling_price: item?.selling_price || 0,
              status: "Pending",
              branch_name,
              facilityId,
              item_category: item?.item_category || "",
              trn_no: null,
              item_code: item?.item_code || "",
              version_id,
              req_no: grn_no,
              truck_no,
              waybill_no,
              reorder_level: item?.reorder_level || 0,
              cost_price: parseInt(item?.est_cost) || 0,
              receipt_no: null,
              user_id: user_id,
              supplier_code: supplier_code,
              supplier_name: supplier_name,
              item_subhead: item?.chart_code || "",
              transaction_date: date,
              sales_type: "",
              store_name: branch_name,
              inserted_by: user_id,
              po_no: pr_no,
              expire_date: item?.expire_date || null,
              reference_number,
              subhead: item?.chart_code || "",
              category: item?.item_category || "",
              unit: item?.unit || "",
            },
          },
        ),
      );
    }

    // Ledger entries

    // credit

    itemPromises.push(
      db.sequelize.query(
        `CALL general_ledger(
            :query_type, :entries_date, :amount, :destination_name, :head,
            :account_description, :facility_id, :refrence_number, :cheque_no,
            :created_by, :pv_no, :account_type, :balance_type, :payee, :purpose_of_payment,:account_subhead
          )`,
        {
          replacements: {
            query_type: "net",
            entries_date: date,
            amount: total,
            destination_name: supplier_name,
            head: supplier_code,
            account_description: supplier_name,
            facility_id: facilityId,
            refrence_number: reference_number,
            cheque_no: cheque_number || null,
            created_by: requisitor,
            pv_no,
            account_type,
            balance_type,
            payee: supplier_name,
            purpose_of_payment: purpose || "",
            account_subhead: account_code || "",
          },
        },
      ),
    );

    for (const item of items) {
      itemPromises.push(
        db.sequelize.query(
          `CALL general_ledger(
              :query_type, :entries_date, :amount, :destination_name, :head,
              :account_description, :facility_id, :refrence_number, :cheque_no,
              :created_by, :pv_no, :account_type, :balance_type, :payee, :purpose_of_payment,:account_subhead
            )`,
          {
            replacements: {
              query_type: "tax",
              entries_date: date,
              amount: Number(item.est_cost) * Number(item.quantity),
              destination_name: item.item_name,
              head: item.item_code,
              account_description: item.item_name,
              facility_id: facilityId,
              refrence_number: reference_number,
              cheque_no: cheque_number || null,
              created_by: requisitor,
              pv_no,
              account_type,
              balance_type,
              payee: supplier_name,
              purpose_of_payment: purpose || "",
              account_subhead: item.chart_code || "",
            },
          },
        ),
      );
      // itemPromises.push(
      //   db.sequelize.query(
      //     `CALL general_ledger(
      //       :query_type, :entries_date, :amount, :destination_name, :head,
      //       :account_description, :facility_id, :refrence_number, :cheque_no,
      //       :created_by, :pv_no, :account_type, :balance_type, :payee, :purpose_of_payment,:account_subhead
      //     )`,
      //     {
      //       replacements: {
      //         query_type: "tax",
      //         entries_date: date,
      //         amount: item.est_cost,
      //         destination_name: item_description,
      //         head: chart_code,
      //         account_description: item_description,
      //         facility_id: facilityId,
      //         refrence_number: reference_number,
      //         cheque_no: cheque_number || null,
      //         created_by: requisitor,
      //         pv_no,
      //         account_type,
      //         balance_type,
      //         payee: supplier_name,
      //         // purpose_of_payment,
      //         purpose_of_payment: purpose || "",
      //         account_subhead: account_subhead || "",
      //       },
      //     }
      //   )
      // );
    }

    await Promise.all(itemPromises);

    return res.json({
      success: true,
      message: "Good receive added successfully",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Error while trying to add good receive",
      error: err,
    });
  }
};

exports.directPurchaseConsumables = async (req, res) => {
  const {
    data = [],
    facilityId,
    supplier_advance,
    user_id,
    supplier_no,
    terms,
    remark,
    transaction_date,
    due_date,
    tax_amount = 0,
    taxes = [],
    apply_prepayment = false,
    target_department = null, // branch_name selected by user on the frontend
    target_branch_id = 0, // branchId integer sent directly from frontend
  } = req.body;
  // === VALIDATIONS ===

  console.log(req.body, "=====================>req.body");
  if (!facilityId)
    return res
      .status(400)
      .json({ success: false, message: "facilityId is required" });
  if (!supplier_no)
    return res
      .status(400)
      .json({ success: false, message: "supplier_no is required" });
  if (!Array.isArray(data) || data.length === 0)
    return res
      .status(400)
      .json({ success: false, message: "data must be a non-empty array" });

  const userId = user_id;
  let transaction;

  try {
    transaction = await db.sequelize.transaction();

    // === GET SUPPLIER ===
    const supplier = await db.SuppliersInfo.findOne({
      where: { supplier_number: supplier_no, facilityId },
      transaction,
    });
    if (!supplier) throw new Error(`Supplier not found: ${supplier_no}`);
    const supplier_name =
      supplier.supplier_name || supplier.name || supplier_no;

    // === RESOLVE PAYABLE ACCOUNTS (from supplier record only) ===
    let payableAccount = null;
    let accruedAccount = null;
    let supplierAdvanceAccount = null;

    if (supplier.payable_code) {
      payableAccount = await db.AccountCategory.findOne({
        where: { code: supplier.payable_code, facility_id: facilityId },
        transaction,
      });
      if (!payableAccount) {
        throw new Error(
          `Account category not found for supplier payable_code: ${supplier.payable_code}`,
        );
      }
    }

    const supplierAccrualCode =
      supplier.payable_accural_code || supplier.payable_accrual_code;
    if (supplierAccrualCode) {
      accruedAccount = await db.AccountCategory.findOne({
        where: { code: supplierAccrualCode, facility_id: facilityId },
        transaction,
      });
      if (!accruedAccount) {
        throw new Error(
          `Account category not found for supplier payable accrual code: ${supplierAccrualCode}`,
        );
      }
    }

    if (!payableAccount && !accruedAccount) {
      throw new Error(
        "Supplier must have payable_code or payable accrual code (payable_accrual_code) set on the supplier record",
      );
    }

    // === RESOLVE SUPPLIER ADVANCE ACCOUNT ===
    if (supplier_advance) {
      supplierAdvanceAccount = await db.AccountCategory.findOne({
        where: { code: supplier_advance, facility_id: facilityId },
        transaction,
      });
      if (!supplierAdvanceAccount) {
        console.warn(
          `Supplier advance account not found: ${supplier_advance}. Advance settlement will not use advance account.`,
        );
      }
    }

    // === GET BUSINESS VAT POLICY & PURCHASE / SALES PRICE SETUP ===
    const business = await db.business.findOne({
      where: { id: facilityId },
      attributes: ["vat_policy", "price_setup_resalable_on_purchase"],
      transaction,
    });
    const vatPolicy = business?.vat_policy || "vat_exclusive";
    const priceSetupResalableOnPurchase =
      !!business?.price_setup_resalable_on_purchase;
    /** Sellable product types land in the sales floor zone (`for sales`). */
    const salesFloorItemTypes = new Set([
      "Resalable",
      "Finished Good",
      "By-Product",
    ]);

    // === GENERATE CODES ===
    const pvCode = `PB-${await getAndUpdateNumber("direct_p", facilityId)}`;
    const dpCode = `DP/${moment().format("YY")}/${pvCode}`;
    const narration = remark || `Direct Purchase - ${dpCode}`;

    let totalPurchaseAmount = 0;
    let totalSettledUsingAdvance = 0;
    const ledgerEntries = [];
    const storeEntryPromises = [];

    // branchId = physical warehouse/location from the frontend; branch_name = store zone
    const targetBranchId = parseInt(target_branch_id, 10) || 0;

    // === PARSE TAX AMOUNT ===
    const totalTaxAmount = parseFloat(tax_amount || 0);
    const taxArray = Array.isArray(taxes) ? taxes : [];

    // === GET CURRENT SUPPLIER BALANCE (once) ===
    let currentBalance =
      parseFloat(await getBalance(supplier_no, facilityId)) || 0;
    console.log(currentBalance, "=====================>currentBalance");
    console.log(
      `Supplier starting balance: ${currentBalance} ${
        currentBalance > 0
          ? "(We owe supplier)"
          : currentBalance < 0
            ? "(We have advance with supplier)"
            : "(Zero balance)"
      }`,
    );

    // === PROCESS EACH ITEM ===
    const accountToUse = payableAccount || accruedAccount;
    /** One consolidated CR per supplier liability account per invoice (PB-xx). */
    const supplierPayableCreditAgg = new Map();
    const addSupplierPayableCredit = (accountCat, amount) => {
      if (!accountCat || !(amount > 0)) return;
      const key = `${accountCat.code}|${String(accountCat.parent_code ?? 0)}`;
      const prev = supplierPayableCreditAgg.get(key);
      const add = parseFloat(Number(amount).toFixed(2));
      if (prev) {
        prev.cr = parseFloat((prev.cr + add).toFixed(2));
      } else {
        supplierPayableCreditAgg.set(key, {
          account: accountCat,
          cr: add,
        });
      }
    };
    const processedItems = []; // Store item info for payable entry creation
    let totalTaxableAmount = 0; // Track total of only taxable items

    for (const item of data) {
      const qty = parseFloat(item.quantity || item.qty || 0);
      const cost = parseFloat(item.cost || 0);
      const itemTotal = qty * cost;

      if (qty <= 0 || cost <= 0 || itemTotal <= 0) continue;

      const sku = item.sku || item.item_code;
      if (!sku) throw new Error(`Missing sku/item_code`);

      totalPurchaseAmount += itemTotal;

      // === PRODUCT & INVENTORY ACCOUNT ===
      const product = await db.Product.findOne({
        where: { sku, facility_id: facilityId },
        attributes: [
          "inventory_account",
          "item_type",
          "name",
          "taxable",
          "selling_price",
        ],
        transaction,
      });
      if (!product) throw new Error(`Product not found: ${sku}`);

      const inventoryAccount = await db.AccountCategory.findOne({
        where: { code: product.inventory_account, facility_id: facilityId },
        transaction,
      });
      if (!inventoryAccount) throw new Error(`Inventory account not found`);

      // Check if item is taxable
      const isTaxable = product.taxable === "Taxable";
      if (isTaxable) {
        totalTaxableAmount += itemTotal;
      }

      // Store item info for payable entry creation later
      processedItems.push({
        itemTotal,
        productName: product.name,
        sku,
        isTaxable,
      });

      // === 1. Store Entry (Stock In) ===
      // Physical location = selected warehouse (branchId). Sellable goods use
      // zone `for sales` so they appear in Make Sale / sales_dep immediately.
      const isSalesFloorItem = salesFloorItemTypes.has(product.item_type);
      const storeZone = isSalesFloorItem
        ? SALES_STORE_BRANCH_NAME
        : target_department || product.item_type || "Main Warehouse";
      const storeDestination = isSalesFloorItem
        ? "Sales"
        : target_department || "Main Warehouse";

      let salesSellingPrice = null;
      if (priceSetupResalableOnPurchase && isSalesFloorItem) {
        const fromMaster = parseFloat(product.selling_price);
        salesSellingPrice =
          Number.isFinite(fromMaster) && fromMaster > 0 ? fromMaster : cost;
      }

      storeEntryPromises.push(
        db.StoreEntry.create(
          {
            receive_date: moment(
              item.transaction_date || transaction_date || new Date(),
            ).format("YYYY-MM-DD"),
            po_no: "DIRECT",
            reference_number: pvCode,
            qty_in: qty,
            qty_out: 0,
            cost_price: cost,
            ...(salesSellingPrice != null
              ? { selling_price: salesSellingPrice }
              : {}),
            expiry_date: item.expiry_date || null,
            inserted_by: userId,
            facilityId,
            transaction_ref: pvCode,
            supplier_code: supplier_no,
            supplier_name,
            branch_name: storeZone,
            branchId: targetBranchId,
            destination: storeDestination,
            source: `Direct Purchase`,
            status: "approved",
            activation: "active",
            type: STORE_ENTRY_TYPE.PURCHASE,
            product_id: sku,
          },
          { transaction },
        ),
      );

      // === 2. Supplier Purchase Entry ===
      await db.SupplierEntry.create(
        {
          supplier_number: supplier_no,
          description: product.name,
          cost: cost,
          qty_in: 0,
          qty_out: qty,
          link_id: sku, // Use SKU as link_id
          receiptNo: pvCode, // Use receiptNo as the reference number
          facilityId,
          mode_of_payment: "credit",
          type: "purchase",
          created_by: userId,
        },
        { transaction },
      );

      // === 3. Inventory Valuation ===
      await db.InventoryValuation.create(
        {
          product_id: sku,
          facility_id: facilityId,
          quantity_on_hand: qty,
          cost: cost,
          total_value: itemTotal,
        },
        { transaction },
      );

      // === 4. Dr Inventory ===
      // For vat_inclusive taxable items, inventory will be adjusted after tax calculation
      // to record at base price (excluding tax)
      ledgerEntries.push({
        account_code: inventoryAccount.code,
        dr: itemTotal,
        cr: 0,
        account_description: inventoryAccount.description,
        transaction_description: `purchase of ${product.name}`,
        type: "inventory",
        transaction_ref: "",
        _itemIndex: processedItems.length - 1, // Track for adjustment
        _isTaxable: isTaxable, // Track for adjustment
      });
    }

    if (totalPurchaseAmount === 0) throw new Error("No valid items to process");

    // === CALCULATE TOTAL AMOUNT (ITEMS + TAXES) BASED ON VAT POLICY ===
    // For vat_inclusive: totalPurchaseAmount already includes tax, so grandTotal = totalPurchaseAmount
    // For vat_exclusive: tax is added on top, so grandTotal = totalPurchaseAmount + totalTaxAmount
    // For "all": only add exclusive VAT (inclusive VAT is already in totalPurchaseAmount)
    let grandTotal;
    if (vatPolicy === "all" && taxArray.length > 0) {
      // Separate inclusive and exclusive taxes
      const exclusiveTaxes = taxArray.filter(
        (tax) =>
          tax.tax_type === "exclusive" ||
          (tax.tax_type === undefined && tax.inclusive_type === "exclusive"),
      );
      const exclusiveTaxAmount = exclusiveTaxes.reduce((sum, tax) => {
        return sum + parseFloat(tax.amount || 0);
      }, 0);
      // Grand total = Subtotal + Exclusive VAT only
      grandTotal = totalPurchaseAmount + exclusiveTaxAmount;
    } else if (vatPolicy === "vat_inclusive") {
      grandTotal = totalPurchaseAmount;
    } else {
      grandTotal = totalPurchaseAmount + totalTaxAmount;
    }
    console.log(
      `Balance Calculation: vatPolicy=${vatPolicy}, totalPurchaseAmount=${totalPurchaseAmount}, totalTaxableAmount=${totalTaxableAmount}, totalTaxAmount=${totalTaxAmount}, grandTotal=${grandTotal}, currentBalance=${currentBalance}`,
    );

    // Warn if tax is provided but no taxable items found
    if (totalTaxAmount > 0 && totalTaxableAmount === 0) {
      console.warn(
        `Warning: Tax amount (${totalTaxAmount}) provided but no taxable items found. Tax will not be allocated.`,
      );
    }

    // === CREATE TAX ACCOUNT MAPPING (once, before item loop) ===
    // Note: Tax amounts are already calculated on frontend based on vat_policy
    // - For vat_inclusive: tax amounts represent extracted tax from item prices
    // - For vat_exclusive: tax amounts represent tax added on top of item prices
    const taxAccountMap = new Map();
    if (totalTaxAmount > 0 && taxArray.length > 0) {
      for (const tax of taxArray) {
        const taxHead = tax.head || tax.account_sub_head;
        if (!taxHead) continue;

        const taxAccount = await db.AccountCategory.findOne({
          where: { code: taxHead, facility_id: facilityId },
          transaction,
        });

        if (taxAccount) {
          const taxValue = parseFloat(tax.amount || 0);
          taxAccountMap.set(taxHead, {
            account: taxAccount,
            amount: taxValue,
            description: tax.description || tax.name || "Tax",
          });
        }
      }
    }

    // === CREATE PAYABLE ENTRIES AND TAX ENTRIES FOR EACH ITEM ===
    for (const processedItem of processedItems) {
      let itemTotalTax = 0; // Total tax for this item across all tax types

      // === CREATE TAX ENTRIES FOR THIS ITEM (if taxable) ===
      if (
        processedItem.isTaxable &&
        totalTaxableAmount > 0 &&
        taxAccountMap.size > 0
      ) {
        for (const [taxHead, taxInfo] of taxAccountMap.entries()) {
          // Calculate proportional tax for this item and this tax type
          const itemTaxProportion =
            (processedItem.itemTotal / totalTaxableAmount) * taxInfo.amount;

          if (itemTaxProportion > 0) {
            itemTotalTax += itemTaxProportion;

            // Determine if this tax is inclusive or exclusive
            const tax = taxArray.find(
              (t) => (t.head || t.account_sub_head) === taxHead,
            );
            const taxType =
              tax?.tax_type === "inclusive" ||
              (tax?.tax_type === undefined &&
                tax?.inclusive_type === "inclusive")
                ? "Inclusive"
                : tax?.tax_type === "exclusive" ||
                    (tax?.tax_type === undefined &&
                      tax?.inclusive_type === "exclusive")
                  ? "Exclusive"
                  : vatPolicy === "vat_inclusive"
                    ? "Inclusive"
                    : "Exclusive";

            // Dr Input VAT / Tax Account (per item)
            ledgerEntries.push({
              account_code: taxInfo.account.code,
              dr: itemTaxProportion,
              cr: 0,
              account_description: taxInfo.account.description,
              transaction_description: `${taxInfo.description} @${tax?.rate || ""}% (${taxType}) on purchase of ${processedItem.productName}`,
              type: "tax",
              transaction_ref: "",
            });

            // Create Supplier Entry for tax (per item)
            // receiptNo: pvCode (reference number)
            // link_id: tax id (tax ID from tax object)
            await db.SupplierEntry.create(
              {
                supplier_number: supplier_no,
                description: `${taxInfo.description} @${tax?.rate || ""}% (${taxType}) on purchase of ${processedItem.productName}`,
                cost: itemTaxProportion,
                qty_in: 0,
                qty_out: 0,
                link_id: tax?.id || tax?.tax_id || null, // Use tax ID as link_id
                receiptNo: pvCode, // Use receiptNo as the reference number
                facilityId,
                mode_of_payment: "credit",
                type: "tax",
                created_by: userId,
              },
              { transaction },
            );
          }
        }
      }

      // Calculate total for this item (item amount + tax) based on VAT policy
      // For vat_inclusive: itemTotal already includes tax, so payable = itemTotal
      // For vat_exclusive: itemTotal is base price, so payable = itemTotal + itemTotalTax
      // For "all": check each tax's individual inclusive_type
      let itemTotalWithTax;
      if (
        vatPolicy === "all" &&
        processedItem.isTaxable &&
        taxAccountMap.size > 0
      ) {
        // Separate inclusive and exclusive taxes for this item
        let itemInclusiveTax = 0;
        let itemExclusiveTax = 0;

        for (const [taxHead, taxInfo] of taxAccountMap.entries()) {
          const tax = taxArray.find(
            (t) => (t.head || t.account_sub_head) === taxHead,
          );
          if (!tax) continue;

          const isTaxInclusive =
            tax.tax_type === "inclusive" ||
            (tax.tax_type === undefined && tax.inclusive_type === "inclusive");

          const itemTaxProportion =
            (processedItem.itemTotal / totalTaxableAmount) * taxInfo.amount;

          if (isTaxInclusive) {
            itemInclusiveTax += itemTaxProportion;
          } else {
            itemExclusiveTax += itemTaxProportion;
          }
        }

        // For "all" policy: itemTotal includes inclusive tax, so add only exclusive tax
        itemTotalWithTax = processedItem.itemTotal + itemExclusiveTax;
      } else if (vatPolicy === "vat_inclusive") {
        itemTotalWithTax = processedItem.itemTotal; // Tax already included in itemTotal
      } else {
        itemTotalWithTax = processedItem.itemTotal + itemTotalTax; // Add tax on top
      }

      // === CREATE PAYABLE ENTRY FOR THIS ITEM ===
      const payableEntry = {
        account_code: accountToUse.code,
        dr: 0,
        cr: itemTotalWithTax,
        account_description: accountToUse.description,
        transaction_description: `Purchase of ${processedItem.productName} - ${pvCode}`,
        type: "payable",
        transaction_ref: supplier_no,
        itemAmount: itemTotalWithTax, // Track for advance settlement
      };

      addSupplierPayableCredit(accountToUse, itemTotalWithTax);
    }

    const purchaseItemNamesList = processedItems
      .map((p) => p.productName)
      .filter(Boolean)
      .join(", ");

    // === COMPUTE ADVANCE SETTLEMENT AMOUNTS (before pushing Cr Payable) ===
    // Net entries: Dr Inventory + Cr Advance (for covered amount) + Cr Payable (for uncovered remainder only)
    let totalSettledFromAdvance = 0;
    let remainingAdvance = 0;

    if (apply_prepayment && currentBalance < 0) {
      if (!supplierAdvanceAccount) {
        throw new Error(
          "Supplier advance account is required for advance settlement. Please provide supplier_advance code.",
        );
      }
      const availableAdvance = Math.abs(currentBalance);
      totalSettledFromAdvance = parseFloat(Math.min(grandTotal, availableAdvance).toFixed(2));
      remainingAdvance = availableAdvance - totalSettledFromAdvance;
      currentBalance = remainingAdvance > 0 ? -remainingAdvance : 0;
      console.log(
        `Advance Settlement: availableAdvance=${availableAdvance}, totalSettledFromAdvance=${totalSettledFromAdvance}, remainingAdvance=${remainingAdvance}`,
      );
    }

    const remainingPayable = parseFloat((grandTotal - totalSettledFromAdvance).toFixed(2));

    // Cr Payable — only for the uncovered portion (skip entirely when fully covered by advance)
    if (remainingPayable > 0) {
      const coverageRatio = remainingPayable / grandTotal;
      for (const [, agg] of supplierPayableCreditAgg) {
        if (!(agg.cr > 0)) continue;
        const acc = agg.account;
        const adjustedCr = parseFloat((agg.cr * coverageRatio).toFixed(2));
        if (adjustedCr <= 0) continue;
        ledgerEntries.push({
          account_code: acc.code,
          account_subhead: acc.parent_code || 0,
          dr: 0,
          cr: adjustedCr,
          account_description: acc.description,
          transaction_description: purchaseItemNamesList
            ? `Direct Purchase - Credit ${acc.description} - ${pvCode}: ${purchaseItemNamesList}`
            : `Direct Purchase - Credit ${acc.description} - ${pvCode}`,
          type: "payable",
          transaction_ref: supplier_no,
        });
      }
    }

    // Cr Advance to Suppliers — direct settlement entry (no Dr Payable round-trip)
    if (totalSettledFromAdvance > 0) {
      ledgerEntries.push({
        account_code: supplierAdvanceAccount.code,
        account_subhead: supplierAdvanceAccount.parent_code || 0,
        dr: 0,
        cr: totalSettledFromAdvance,
        account_description: supplierAdvanceAccount.description,
        transaction_description: `Advance applied to ${pvCode}${purchaseItemNamesList ? `: ${purchaseItemNamesList}` : ""}`,
        type: "accrued",
        transaction_ref: supplier_no,
      });

      await db.SupplierEntry.create(
        {
          supplier_number: supplier_no,
          description: `Advance used for purchase ${pvCode}`,
          cost: totalSettledFromAdvance,
          qty_in: 1,
          qty_out: 0,
          receiptNo: pvCode,
          link_id: pvCode,
          facilityId,
          mode_of_payment: "advance",
          type: "payment",
          created_by: userId,
        },
        { transaction },
      );
    }

    // === ADJUST INVENTORY ENTRIES FOR VAT_INCLUSIVE ===
    // For vat_inclusive and "all" policy with inclusive taxes, inventory should be recorded at base price (excluding tax)
    // Adjust inventory entries to subtract tax portion
    if (
      vatPolicy === "vat_inclusive" ||
      (vatPolicy === "all" &&
        taxArray.some(
          (tax) =>
            tax.tax_type === "inclusive" ||
            (tax.tax_type === undefined && tax.inclusive_type === "inclusive"),
        ))
    ) {
      let itemIndex = 0;
      for (const processedItem of processedItems) {
        if (
          processedItem.isTaxable &&
          totalTaxableAmount > 0 &&
          taxAccountMap.size > 0
        ) {
          // Calculate tax for this item
          let itemTax = 0;
          for (const [taxHead, taxInfo] of taxAccountMap.entries()) {
            const itemTaxProportion =
              (processedItem.itemTotal / totalTaxableAmount) * taxInfo.amount;
            itemTax += itemTaxProportion;
          }

          // Find and adjust the corresponding inventory entry
          const inventoryEntry = ledgerEntries.find(
            (entry) =>
              entry.type === "inventory" &&
              entry._itemIndex === itemIndex &&
              entry._isTaxable === true,
          );

          if (inventoryEntry && itemTax > 0) {
            // Adjust inventory to base price (excluding tax)
            inventoryEntry.dr = processedItem.itemTotal - itemTax;
          }
        }
        itemIndex++;
      }
    }

    totalSettledUsingAdvance = totalSettledFromAdvance;
    const newPayableAmount = grandTotal - totalSettledFromAdvance;
    console.log(
      `Final Calculation: newPayableAmount=${newPayableAmount}, netIncrease=${newPayableAmount}`,
    );

    // === FINAL: Update supplier balance once ===
    const netIncrease = grandTotal - totalSettledFromAdvance;
    console.log(
      `Updating supplier balance: currentBalance=${currentBalance}, netIncrease=${netIncrease}, newBalance=${
        currentBalance + netIncrease
      }`,
    );
    await db.SuppliersInfo.increment(
      { balance: netIncrease },
      { where: { supplier_number: supplier_no, facilityId }, transaction },
    );

    await Promise.all(storeEntryPromises);

    // === Save all ledger entries ===
    for (const entry of ledgerEntries) {
      // Remove temporary properties before saving
      const { _itemIndex, _isTaxable, itemAmount, ...cleanEntry } = entry;

      await db.GeneralLedger.create(
        {
          transaction_date: moment(transaction_date || new Date()).format(
            "YYYY-MM-DD",
          ),
          account_code: cleanEntry.account_code,
          account_subhead: cleanEntry.account_subhead || 0,
          dr: cleanEntry.dr,
          cr: cleanEntry.cr,
          account_description: cleanEntry.account_description,
          transaction_description: cleanEntry.transaction_description,
          reference_number: pvCode,
          purpose_of_payment: narration,
          payee: supplier_name,
          created_by: userId,
          facility_id: facilityId,
          status:
            totalSettledUsingAdvance >= grandTotal
              ? "paid"
              : totalSettledUsingAdvance > 0
                ? "partial"
                : "unpaid",
          type: cleanEntry.type,
          transaction_ref: cleanEntry.transaction_ref,
        },
        { transaction },
      );
    }

    // Get final balance from suppliersinfo table (more reliable than recalculating from ledger)
    // The balance was already updated above, so we read it directly
    const updatedSupplier = await db.SuppliersInfo.findOne({
      where: { supplier_number: supplier_no, facilityId },
      attributes: ["balance"],
      transaction,
    });
    const finalBalance = parseFloat(updatedSupplier?.balance || 0);

    // === Create Invoice ===
    // amount = payable amount (what we owe the supplier)
    // When vat_policy is "all", grandTotal already uses taxes from req.body (taxes array)
    // with each tax's inclusive_type/tax_type: inclusive tax is in totalPurchaseAmount,
    // exclusive tax is added on top.
    await db.Invoice.create(
      {
        ref_number: supplier_no,
        invoice_ref: pvCode,
        due_date:
          due_date ||
          moment()
            .add(terms || 30, "days")
            .format("YYYY-MM-DD"),
        transaction_date: transaction_date || moment().format("YYYY-MM-DD"),
        description: narration,
        amount: Number(grandTotal.toFixed(2)),
        payment_method: "credit",
        user_id: userId,
        created_by: userId,
        facility_id: facilityId,
        branchId: targetBranchId || null,
        type: "purchase",
        status: totalSettledUsingAdvance >= grandTotal ? "paid" : "unpaid",
      },
      { transaction },
    );

    await transaction.commit();

    return res.json({
      success: true,
      message: "Direct purchase completed successfully",
      data: {
        reference: pvCode,
        total_amount: grandTotal,
        subtotal: totalPurchaseAmount,
        tax_amount: totalTaxAmount,
        settled_using_advance: totalSettledUsingAdvance,
        new_payable_amount: newPayableAmount,
        final_supplier_balance: finalBalance,
        advance_was_used: totalSettledUsingAdvance > 0,
        supplier_name,
      },
    });
  } catch (err) {
    if (transaction) await transaction.rollback().catch(() => {});
    console.error("Direct Purchase Error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to process direct purchase",
      error: err.message,
    });
  }
};

// Get expense bill by invoice_ref
exports.getExpenseBill = async (req, res) => {
  try {
    const { invoice_ref, facilityId } = req.query;

    if (!invoice_ref || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "invoice_ref and facilityId are required",
      });
    }

    // Get business vat_policy
    const business = await db.business.findOne({
      where: { id: facilityId },
      attributes: ["vat_policy"],
    });
    const vatPolicy = business?.vat_policy || "vat_exclusive";

    // Get invoice data
    const invoice = await db.Invoice.findOne({
      where: {
        invoice_ref: invoice_ref,
        facility_id: facilityId,
        type: "purchase",
      },
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Expense bill not found",
      });
    }

    // Get supplier data
    const supplier = await db.SuppliersInfo.findOne({
      where: {
        supplier_number: invoice.ref_number,
        facilityId: facilityId,
      },
      attributes: ["supplier_name", "supplier_number", "address"],
    });

    // Get items from supplier_entries using receiptNo (for purchase entries)
    // link_id contains the SKU for purchase entries
    const items = await db.sequelize.query(
      `SELECT
        se.*,
        p.id as product_id,
        p.name as product_name,
        p.sku as product_sku,
        p.item_type as product_item_type,
        p.cost_price as product_cost_price,
        p.selling_price as product_selling_price,
        p.unit_of_measure as product_unit_of_measure,
        p.category as product_category,
        p.image_url as product_image_url,
        p.taxable as product_taxable
      FROM supplier_entries se
      LEFT JOIN products p ON p.sku = se.link_id AND p.facility_id = se.facilityId
      WHERE se.receiptNo = :receiptNo
        AND se.facilityId = :facilityId
        AND se.type = 'purchase'`,
      {
        type: db.sequelize.QueryTypes.SELECT,
        replacements: {
          receiptNo: invoice.invoice_ref,
          facilityId: facilityId,
        },
      },
    );

    // Get tax entries from supplier_entries using receiptNo
    // link_id contains the tax ID for tax entries - use it to fetch tax details from taxes table
    const taxEntries = await db.sequelize.query(
      `SELECT
        se.*,
        t.id as tax_id,
        t.description as tax_description,
        t.rate as tax_rate,
        t.account_sub_head as tax_account_sub_head,
        t.inclusive_type as tax_inclusive_type,
        t.rate_type as tax_rate_type
      FROM supplier_entries se
      LEFT JOIN taxes t ON CAST(t.id AS CHAR) = CAST(se.link_id AS CHAR) AND t.facilityId = se.facilityId
      WHERE se.receiptNo = :receiptNo
        AND se.facilityId = :facilityId
        AND se.type = 'tax'`,
      {
        type: db.sequelize.QueryTypes.SELECT,
        replacements: {
          receiptNo: invoice.invoice_ref,
          facilityId: facilityId,
        },
      },
    );

    // Calculate total VAT amount from tax entries
    const totalVatAmount = taxEntries.reduce((sum, entry) => {
      return sum + parseFloat(entry.cost || 0);
    }, 0);

    // Format the response
    const billData = {
      invoice_ref: invoice.invoice_ref,
      ref_number: invoice.ref_number,
      transaction_date: invoice.transaction_date,
      due_date: invoice.due_date,
      amount: invoice.amount,
      balance: invoice.balance,
      description: invoice.description,
      terms: invoice.terms || null,
      remark: invoice.description,
      supplier_name: supplier?.supplier_name || null,
      supplier_code: supplier?.supplier_number || null,
      supplier_number: invoice.ref_number,
      supplier_address: supplier?.address || null,
      items: items.map((item) => ({
        item_name: item.description || item.product_name || "N/A",
        sku: item.product_sku || "N/A",
        quantity: item.qty_out || item.qty_in || 0,
        cost: item.cost || item.product_cost_price || 0,
        total:
          parseFloat(item.qty_out || item.qty_in || 0) *
          parseFloat(item.cost || item.product_cost_price || 0),
        unit_measure: item.product_unit_of_measure || "pcs",
        item_type: item.product_item_type || "N/A",
        taxable: item.product_taxable || "Not Taxable",
        product: item.product_id
          ? {
              id: item.product_id,
              name: item.product_name,
              sku: item.product_sku,
              cost_price: item.product_cost_price,
              selling_price: item.product_selling_price,
              category: item.product_category,
              image_url: item.product_image_url,
            }
          : null,
      })),
      total_vat_amount: totalVatAmount,
      vat_policy: vatPolicy,
      taxes: taxEntries.map((entry) => {
        const inclusiveType =
          entry.tax_inclusive_type || entry.inclusive_type || "exclusive";
        return {
          id: entry.tax_id || entry.link_id,
          name: entry.tax_description || entry.description || "Input VAT",
          description:
            entry.tax_description || entry.description || "Input VAT",
          rate: entry.tax_rate || entry.rate || "0",
          amount: parseFloat(entry.cost || 0),
          cost: parseFloat(entry.cost || 0),
          inclusive_type: inclusiveType,
          tax_type: inclusiveType === "inclusive" ? "inclusive" : "exclusive", // Map inclusive_type to tax_type for compatibility
          rate_type: entry.tax_rate_type || entry.rate_type || "percentage",
          account_sub_head:
            entry.tax_account_sub_head || entry.account_sub_head,
        };
      }),
    };

    return res.json({
      success: true,
      message: "Expense bill retrieved successfully",
      data: billData,
    });
  } catch (error) {
    console.error("Error fetching expense bill:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch expense bill",
      error: error.message,
    });
  }
};

exports.directPurchaseExpenses = async (req, res) => {
  const {
    data = [],
    facilityId,
    user_id,
    supplier_no,
    terms,
    remark,
    transaction_date,
    due_date,
    tax_amount = 0,
    taxes = [],
    apply_prepayment = false,
    mode_of_payment = "credit", // credit | cash | bank | cheque
    bankAccount = {},
    accountHead = {},
    cheque_number,
  } = req.body;

  const isCashLike = ["cash", "bank", "cheque"].includes(mode_of_payment);

  // === VALIDATIONS ===
  if (!facilityId)
    return res
      .status(400)
      .json({ success: false, message: "facilityId is required" });
  if (!supplier_no)
    return res
      .status(400)
      .json({ success: false, message: "supplier_no is required" });
  if (!Array.isArray(data) || data.length === 0)
    return res
      .status(400)
      .json({ success: false, message: "data must be a non-empty array" });

  const userId = user_id;
  let transaction;

  try {
    transaction = await db.sequelize.transaction();

    // === SUPPLIER ===
    const supplier = await db.SuppliersInfo.findOne({
      where: { supplier_number: supplier_no, facilityId },
      transaction,
    });
    if (!supplier) throw new Error(`Supplier not found: ${supplier_no}`);
    const supplier_name =
      supplier.supplier_name || supplier.name || supplier_no;

    // === PAYABLE ACCOUNTS (from supplier record only) ===
    let payableAccount = null;
    let accruedAccount = null;

    if (supplier.payable_code) {
      payableAccount = await db.AccountCategory.findOne({
        where: { code: supplier.payable_code, facility_id: facilityId },
        transaction,
      });
      if (!payableAccount) {
        throw new Error(
          `Account category not found for supplier payable_code: ${supplier.payable_code}`,
        );
      }
    }

    const supplierAccrualCode =
      supplier.payable_accural_code || supplier.payable_accrual_code;
    if (supplierAccrualCode) {
      accruedAccount = await db.AccountCategory.findOne({
        where: { code: supplierAccrualCode, facility_id: facilityId },
        transaction,
      });
      if (!accruedAccount) {
        throw new Error(
          `Account category not found for supplier payable accrual code: ${supplierAccrualCode}`,
        );
      }
    }

    if (!payableAccount && !accruedAccount) {
      throw new Error(
        "Supplier must have payable_code or payable accrual code (payable_accrual_code) set on the supplier record",
      );
    }

    // === GET BUSINESS VAT POLICY ===
    const business = await db.business.findOne({
      where: { id: facilityId },
      attributes: ["vat_policy"],
      transaction,
    });
    const vatPolicy = business?.vat_policy || "vat_exclusive";

    // === CODES & NARRATION ===
    const pvCode = `EP-${await getAndUpdateNumber("direct_p", facilityId)}`;
    const dpCode = `DE/${moment().format("YY")}/${pvCode}`;
    const narration = remark || `Direct Expense - ${dpCode}`;

    // === CASH/BANK/CHEQUE PAYMENT ACCOUNT (when not credit) ===
    let paymentAccount = null;
    let paymentName = "";
    let bankAcc = null;
    if (isCashLike) {
      if (mode_of_payment === "cash") {
        if (!accountHead?.head) {
          throw new Error("accountHead.head is required for cash payment");
        }
        paymentAccount = await db.AccountCategory.findOne({
          where: { code: accountHead.head, facility_id: facilityId },
          transaction,
        });
        if (!paymentAccount) {
          throw new Error(`Cash account not found: ${accountHead.head}`);
        }
        paymentName = paymentAccount.description || "Cash in Hand";
      } else {
        if (!bankAccount?.id) {
          throw new Error("bankAccount.id is required for bank/cheque payment");
        }
        if (mode_of_payment === "cheque" && !cheque_number) {
          throw new Error("cheque_number is required for cheque payment");
        }
        bankAcc = await db.bank_account.findOne({
          where: { id: bankAccount.id, facilityId, status: "active" },
          transaction,
        });
        if (!bankAcc) throw new Error("Bank account not found or inactive");
        if (!bankAcc.head) {
          throw new Error(
            `Bank account '${bankAcc.account_name}' has no GL head assigned`,
          );
        }
        paymentAccount = await db.AccountCategory.findOne({
          where: { code: bankAcc.head, facility_id: facilityId },
          transaction,
        });
        if (!paymentAccount) {
          throw new Error(
            `GL account not found for bank head: ${bankAcc.head}`,
          );
        }
        paymentName = bankAcc.account_name || paymentAccount.description;
      }
    }

    let totalExpenseAmount = 0;
    let totalSettledUsingAdvance = 0;
    const ledgerEntries = [];
    /** One consolidated CR per supplier liability account per invoice (EP-xx). */
    const supplierPayableCreditAgg = new Map();
    const addSupplierPayableCredit = (accountCat, amount) => {
      if (!accountCat || !(amount > 0)) return;
      const key = `${accountCat.code}|${String(accountCat.parent_code ?? 0)}`;
      const prev = supplierPayableCreditAgg.get(key);
      const add = parseFloat(Number(amount).toFixed(2));
      if (prev) {
        prev.cr = parseFloat((prev.cr + add).toFixed(2));
      } else {
        supplierPayableCreditAgg.set(key, {
          account: accountCat,
          cr: add,
        });
      }
    };

    // === CURRENT SUPPLIER BALANCE (Live) ===
    let currentBalance =
      parseFloat(await getBalance(supplier_no, facilityId)) || 0;

    console.log(
      `Starting supplier balance: ${currentBalance} (${
        currentBalance > 0
          ? "We owe"
          : currentBalance < 0
            ? "Advance exists"
            : "Zero"
      })`,
    );

    const expenseLineDescriptions = [];

    // === PROCESS EACH EXPENSE ITEM ===
    for (const item of data) {
      const qty = parseFloat(item.quantity || item.qty || 1);
      const cost = parseFloat(item.cost || 0);
      const itemTotal = qty * cost;

      if (itemTotal <= 0) continue;

      const head = item.head || item.account_head;
      if (!head) throw new Error(`Account head missing for expense item`);

      totalExpenseAmount += itemTotal;

      // Find Expense Account
      const expenseAccount = await db.AccountCategory.findOne({
        where: { code: head, facility_id: facilityId },
        transaction,
      });
      if (!expenseAccount)
        throw new Error(`Expense account not found: ${head}`);

      const description =
        item.description || expenseAccount.description || "Expense";
      expenseLineDescriptions.push(description);

      // === AUTO-SETTLE USING ADVANCE IF AVAILABLE (credit bills only) ===
      let settledThisItem = 0;
      if (!isCashLike && currentBalance < 0) {
        const availableAdvance = Math.abs(currentBalance);
        settledThisItem = Math.min(itemTotal, availableAdvance);
        currentBalance += settledThisItem; // Reduce advance (make less negative)
      }

      const newPayableAmount = itemTotal - settledThisItem;
      totalSettledUsingAdvance += settledThisItem;

      // === 1. Supplier Entry - Expense Record ===
      // Use SKU if available (for products), otherwise use account head
      const linkId = item.sku || item.item_code || head;
      await db.SupplierEntry.create(
        {
          supplier_number: supplier_no,
          description: description || expenseAccount.description,
          cost: cost,
          qty_in: 0,
          qty_out: qty,
          link_id: linkId, // Use SKU if available, otherwise use account head
          receiptNo: pvCode, // Use receiptNo as the reference number
          facilityId,
          mode_of_payment: isCashLike ? mode_of_payment : "credit",
          type: "purchase",
          item_name: description,
          account_head: head,
          created_by: userId,
          transaction_date: moment(transaction_date || new Date()).format(
            "YYYY-MM-DD",
          ),
        },
        { transaction },
      );

      // === 2. Debit Expense Account ===
      ledgerEntries.push({
        account_code: expenseAccount.code,
        account_subhead: expenseAccount.parent_code || 0,
        dr: itemTotal,
        cr: 0,
        account_description: expenseAccount.description,
        transaction_description: description,
        type: "expenses",
        _taxable: item.taxable === "Taxable",
      });

      // === 3. If advance was used → Credit Payable (consume advance) ===
      // Advances only apply on credit bills.
      if (!isCashLike && settledThisItem > 0) {
        const accountToUse = accruedAccount || payableAccount;
        addSupplierPayableCredit(accountToUse, settledThisItem);

        await db.SupplierEntry.create(
          {
            supplier_number: supplier_no,
            description: `Advance used for expense: ${description}`,
            cost: settledThisItem,
            qty_in: 1,
            qty_out: 0,
            link_id: pvCode,
            receiptNo: pvCode, // Use receiptNo as the reference number
            facilityId,
            mode_of_payment: "advance",
            type: "payment",
            created_by: userId,
          },
          { transaction },
        );
        await db.SuppliersInfo.increment(
          { balance: settledThisItem },
          { where: { supplier_number: supplier_no, facilityId }, transaction },
        );
      }

      // === 4. Credit New Payable (remaining) — merged into one A/P line per account at end ===
      if (!isCashLike && newPayableAmount > 0) {
        const accountToUse = payableAccount || accruedAccount;
        addSupplierPayableCredit(accountToUse, newPayableAmount);
      }
    }

    if (totalExpenseAmount === 0) throw new Error("No valid expense items");

    // === PARSE TAX AMOUNT & TAXABLE ITEMS ===
    const totalTaxAmount = parseFloat(tax_amount || 0);
    const taxArray = Array.isArray(taxes) ? taxes : [];
    const taxableItems = data.filter((item) => item.taxable === "Taxable");
    const totalTaxableAmount = taxableItems.reduce((sum, item) => {
      const qty = parseFloat(item.quantity || item.qty || 1);
      const cost = parseFloat(item.cost || 0);
      return sum + qty * cost;
    }, 0);

    // === CALCULATE GRAND TOTAL (EXPENSE + TAXES) BASED ON VAT POLICY ===
    let grandTotal;
    if (vatPolicy === "vat_exclusive") {
      grandTotal = totalExpenseAmount + totalTaxAmount;
    } else if (vatPolicy === "vat_inclusive") {
      grandTotal = totalExpenseAmount;
    } else if (vatPolicy === "all" && taxArray.length > 0) {
      const exclusiveTaxAmount = taxArray
        .filter(
          (tax) => (tax.inclusive_type || "").toLowerCase() === "exclusive",
        )
        .reduce((sum, tax) => sum + parseFloat(tax.amount || 0), 0);
      grandTotal = totalExpenseAmount + exclusiveTaxAmount;
    } else {
      grandTotal = totalExpenseAmount + totalTaxAmount;
    }

    // Warn if tax is provided but no taxable items found
    if (totalTaxAmount > 0 && totalTaxableAmount === 0) {
      console.warn(
        `Warning: Tax amount (${totalTaxAmount}) provided but no taxable items found. Tax will not be allocated.`,
      );
    }

    // === CREATE TAX ACCOUNT MAPPING ===
    // vat_inclusive: skip (tax embedded in expense amounts)
    // vat_exclusive: create entries for all taxes
    // all: create entries for all taxes (each labeled by its own inclusive_type)
    const taxAccountMap = new Map();
    if (
      vatPolicy !== "vat_inclusive" &&
      totalTaxAmount > 0 &&
      taxArray.length > 0
    ) {
      for (const tax of taxArray) {
        const taxHead = tax.head || tax.account_sub_head;
        if (!taxHead) continue;

        const taxAccount = await db.AccountCategory.findOne({
          where: { code: taxHead, facility_id: facilityId },
          transaction,
        });

        if (taxAccount) {
          const taxValue = parseFloat(tax.amount || 0);
          taxAccountMap.set(taxHead, {
            account: taxAccount,
            amount: taxValue,
            description: tax.description || tax.name || "Input VAT",
          });
        }
      }
    }

    // === CREATE TAX ENTRIES FOR EACH TAXABLE ITEM ===
    if (
      vatPolicy !== "vat_inclusive" &&
      totalTaxableAmount > 0 &&
      taxAccountMap.size > 0
    ) {
      for (const item of taxableItems) {
        const qty = parseFloat(item.quantity || item.qty || 1);
        const cost = parseFloat(item.cost || 0);
        const itemTotal = qty * cost;

        if (itemTotal <= 0) continue;

        for (const [taxHead, taxInfo] of taxAccountMap.entries()) {
          const itemTaxProportion =
            (itemTotal / totalTaxableAmount) * taxInfo.amount;

          if (itemTaxProportion > 0) {
            const tax = taxArray.find(
              (t) => (t.head || t.account_sub_head) === taxHead,
            );

            let taxType;
            if (vatPolicy === "vat_exclusive") {
              taxType = "Exclusive";
            } else if (vatPolicy === "all") {
              const incType = (tax?.inclusive_type || "").toLowerCase();
              taxType = incType === "inclusive" ? "Inclusive" : "Exclusive";
            } else {
              taxType = "Exclusive";
            }

            const itemDescription =
              item.description || item.item_name || "Expense";

            ledgerEntries.push({
              account_code: taxInfo.account.code,
              account_subhead: taxInfo.account.parent_code || 0,
              dr: itemTaxProportion,
              cr: 0,
              account_description: taxInfo.account.description,
              transaction_description: `${taxInfo.description} @${tax?.rate || ""}% (${taxType}) on purchase of ${itemDescription}`,
              type: "tax",
              transaction_ref: "",
            });

            await db.SupplierEntry.create(
              {
                supplier_number: supplier_no,
                description: `${taxInfo.description} @${tax?.rate || ""}% (${taxType}) on purchase of ${itemDescription}`,
                cost: itemTaxProportion,
                qty_in: 0,
                qty_out: 0,
                link_id: tax?.id || tax?.tax_id || null,
                receiptNo: pvCode,
                facilityId,
                mode_of_payment: "credit",
                type: "tax",
                created_by: userId,
              },
              { transaction },
            );
          }
        }
      }
    }

    // === CREDIT A/P FOR EXCLUSIVE TAX (ledger balancing) — credit bills only ===
    // For vat_exclusive (and exclusive taxes in "all"), we debit Input VAT but the A/P
    // credits above only cover the expense amount. The supplier is owed expense + tax,
    // so we must credit A/P for the tax amount to balance the ledger.
    if (!isCashLike && vatPolicy !== "vat_inclusive") {
      let taxToCredit = 0;
      if (vatPolicy === "vat_exclusive") {
        taxToCredit = totalTaxAmount;
      } else if (vatPolicy === "all" && taxArray.length > 0) {
        taxToCredit = taxArray
          .filter(
            (tax) => (tax.inclusive_type || "").toLowerCase() === "exclusive",
          )
          .reduce((sum, tax) => sum + parseFloat(tax.amount || 0), 0);
      } else {
        taxToCredit = totalTaxAmount;
      }

      if (taxToCredit > 0) {
        const accountToUse = payableAccount || accruedAccount;
        addSupplierPayableCredit(accountToUse, taxToCredit);
      }
    }

    const expenseLineNamesList = expenseLineDescriptions
      .filter(Boolean)
      .join(", ");

    if (isCashLike && paymentAccount) {
      // Immediate payment: Cr Cash/Bank for the bill total (expense + exclusive VAT).
      ledgerEntries.push({
        account_code: paymentAccount.code,
        account_subhead: paymentAccount.parent_code || 0,
        dr: 0,
        cr: grandTotal,
        account_description: paymentAccount.description || paymentName,
        transaction_description: expenseLineNamesList
          ? `Direct Expense - Paid via ${String(mode_of_payment).toUpperCase()} (${paymentName}) - ${pvCode}: ${expenseLineNamesList}`
          : `Direct Expense - Paid via ${String(mode_of_payment).toUpperCase()} (${paymentName}) - ${pvCode}`,
        type: "payment",
        bank_account_id: bankAcc?.id || bankAccount?.id || null,
        mode_of_payment,
        cheque_no: cheque_number || null,
        transaction_ref: supplier_no,
      });
    } else {
      for (const [, agg] of supplierPayableCreditAgg) {
        if (!(agg.cr > 0)) continue;
        const acc = agg.account;
        ledgerEntries.push({
          account_code: acc.code,
          account_subhead: acc.parent_code || 0,
          dr: 0,
          cr: agg.cr,
          account_description: acc.description,
          transaction_description: expenseLineNamesList
            ? `Direct Expense - Credit ${acc.description} - ${pvCode}: ${expenseLineNamesList}`
            : `Direct Expense - Credit ${acc.description} - ${pvCode}`,
          type: "payable",
          transaction_ref: supplier_no,
        });
      }
    }

    // === ADJUST EXPENSE DEBITS FOR INCLUSIVE TAXES ===
    // Inclusive tax is already embedded in the expense price, so the expense
    // debit must be reduced by the inclusive tax portion to keep entries balanced.
    if (
      vatPolicy === "all" &&
      totalTaxableAmount > 0 &&
      taxAccountMap.size > 0
    ) {
      const inclusiveTaxTotal = taxArray
        .filter(
          (tax) => (tax.inclusive_type || "").toLowerCase() === "inclusive",
        )
        .reduce((sum, tax) => sum + parseFloat(tax.amount || 0), 0);

      if (inclusiveTaxTotal > 0) {
        for (const entry of ledgerEntries) {
          if (entry.type === "expenses" && entry._taxable) {
            const proportion = entry.dr / totalTaxableAmount;
            entry.dr = parseFloat(
              (entry.dr - proportion * inclusiveTaxTotal).toFixed(2),
            );
          }
        }
      }
    }

    // === FINAL: Update supplier balance once (atomic) — credit bills only ===
    const netIncreaseInLiability = isCashLike
      ? 0
      : grandTotal - totalSettledUsingAdvance;
    if (!isCashLike && netIncreaseInLiability !== 0) {
      await db.SuppliersInfo.increment(
        { balance: netIncreaseInLiability },
        { where: { supplier_number: supplier_no, facilityId }, transaction },
      );
    }

    // === SAVE LEDGER ENTRIES ===
    for (const entry of ledgerEntries) {
      await db.GeneralLedger.create(
        {
          transaction_date: moment(transaction_date || new Date()).format(
            "YYYY-MM-DD",
          ),
          account_code: entry.account_code,
          account_subhead: entry.account_subhead || 0,
          dr: entry.dr,
          cr: entry.cr,
          account_description: entry.account_description,
          transaction_description: entry.transaction_description,
          reference_number: pvCode,
          purpose_of_payment: narration,
          payee: supplier_name,
          created_by: userId,
          facility_id: facilityId,
          status:
            isCashLike || totalSettledUsingAdvance >= grandTotal
              ? "paid"
              : totalSettledUsingAdvance > 0
                ? "partial"
                : "unpaid",
          type: entry.type,
          transaction_ref: entry.transaction_ref || "",
          bank_account_id: entry.bank_account_id || null,
          mode_of_payment: entry.mode_of_payment || null,
          cheque_no: entry.cheque_no || null,
        },
        { transaction },
      );
    }

    const finalBalance =
      parseFloat(await getBalance(supplier_no, facilityId)) || 0;

    // === CREATE INVOICE ===
    await db.Invoice.create(
      {
        ref_number: supplier_no,
        invoice_ref: pvCode,
        due_date: isCashLike
          ? transaction_date || moment().format("YYYY-MM-DD")
          : due_date ||
            moment()
              .add(terms || 30, "days")
              .format("YYYY-MM-DD"),
        transaction_date: transaction_date || moment().format("YYYY-MM-DD"),
        description: narration,
        amount: Number(grandTotal.toFixed(2)),
        payment_method: isCashLike ? mode_of_payment : "credit",
        user_id: userId,
        created_by: userId,
        facility_id: facilityId,
        type: "purchase",
        status:
          isCashLike || totalSettledUsingAdvance >= grandTotal
            ? "paid"
            : "unpaid",
      },
      { transaction },
    );

    await transaction.commit();

    return res.json({
      success: true,
      message: "Direct expense recorded successfully",
      data: {
        reference: pvCode,
        invoice_ref: pvCode,
        total_expense: totalExpenseAmount,
        tax_amount: totalTaxAmount,
        total_amount: grandTotal,
        settled_using_advance: totalSettledUsingAdvance,
        new_payable_amount: grandTotal - totalSettledUsingAdvance,
        final_supplier_balance: finalBalance,
        advance_was_used: totalSettledUsingAdvance > 0,
        supplier_name,
      },
    });
  } catch (err) {
    if (transaction) await transaction.rollback().catch(() => {});
    console.error("Direct Expense Error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to process expense",
      error: err.message,
    });
  }
};

exports.directExpenses = async (req, res) => {
  const {
    data = [],
    facilityId,
    user_id,
    remark,
    transaction_date,
    bankAccount = {}, // { id, account_name, ... } for bank/cheque
    accountHead = {}, // { head: "104" } for cash
    mode_of_payment, // "cash" | "bank" | "cheque"
    cheque_number,
    skip_invoice, // when true (e.g. imprest UI), do not create a purchase `invoices` row
  } = req.body;
  console.log(req.body);
  // === VALIDATIONS ===
  if (!facilityId)
    return res
      .status(400)
      .json({ success: false, message: "facilityId is required" });
  if (!Array.isArray(data) || data.length === 0)
    return res
      .status(400)
      .json({ success: false, message: "data must be a non-empty array" });
  if (!["cash", "bank", "cheque"].includes(mode_of_payment))
    return res.status(400).json({
      success: false,
      message: "mode_of_payment must be cash, bank, or cheque",
    });

  const { validatePostingDate } = require("../utils/validatePostingDate");
  try {
    validatePostingDate(transaction_date || new Date(), {
      field: "transaction_date",
    });
  } catch (dateErr) {
    return res.status(400).json({ success: false, message: dateErr.message });
  }

  const userId = user_id || req.user?.id;
  let transaction;

  try {
    transaction = await db.sequelize.transaction();

    // === GENERATE REFERENCE CODE ===
    const refCodeResult = await getAndUpdateNumber("direct_p", facilityId); // unique counter
    // Handle case where getAndUpdateNumber returns an object (error case)
    if (typeof refCodeResult === "object" && refCodeResult.message) {
      throw new Error(
        refCodeResult.message || "Failed to generate reference number",
      );
    }
    const refCode =
      typeof refCodeResult === "number"
        ? refCodeResult
        : parseInt(refCodeResult) || Date.now();
    const refCodeString = String(refCode); // Ensure it's a string for link_id
    const reference = `DE/${moment().format("YY")}/${refCodeString}`;
    const narration = remark || `Direct Expense - ${reference}`;

    // === VALIDATE ALL LINES UPFRONT (no silent skips) ===
    const normalizedLines = [];
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      const qty = parseFloat(item.quantity || item.qty || 1);
      const rate = parseFloat(item.cost || item.rate || 0);
      const amount = qty * rate;
      const head = item.head || item.item_type || item.account_head;
      if (!head) {
        throw new Error(
          `Line ${i + 1}: account head is required (item: ${
            item.item_name || item.description || "N/A"
          })`,
        );
      }
      if (!(qty > 0) || !(rate > 0) || !(amount > 0)) {
        throw new Error(
          `Line ${i + 1}: quantity and unit cost must be greater than zero`,
        );
      }
      normalizedLines.push({ item, qty, rate, amount, head });
    }

    let totalExpenseAmount = 0;
    let totalVatAmount = 0;
    const ledgerEntries = [];

    const businessDe = await db.business.findOne({
      where: { id: facilityId },
      attributes: ["vat_policy"],
      transaction,
    });
    const vatPolicy = businessDe?.vat_policy || "vat_exclusive";

    const computeExclusiveVatForLine = (lineAmount, taxRow) => {
      if (!taxRow) return 0;
      const inc = String(taxRow.inclusive_type || "").toLowerCase();
      if (inc === "inclusive") return 0;
      const rt = String(taxRow.rate_type || "").toLowerCase();
      const rateNum =
        parseFloat(String(taxRow.rate || "0").replace(/,/g, "")) || 0;
      if (rt === "percentage" || rt.includes("percent") || rt === "") {
        return Math.round(lineAmount * rateNum * 0.01 * 100) / 100;
      }
      return Math.round(rateNum * 100) / 100;
    };

    const isTaxInclusiveType = (taxRow) => {
      if (!taxRow) return false;
      const inc = String(taxRow.inclusive_type || "").toLowerCase();
      if (inc === "inclusive") return true;
      if (inc === "exclusive") return false;
      return String(taxRow.tax_type || "").toLowerCase() === "inclusive";
    };

    const extractInclusiveVatFromGross = (gross, taxRow) => {
      if (!taxRow || !isTaxInclusiveType(taxRow)) return 0;
      const rt = String(taxRow.rate_type || "").toLowerCase();
      const rateNum =
        parseFloat(String(taxRow.rate || "0").replace(/,/g, "")) || 0;
      if (rt === "percentage" || rt.includes("percent") || rt === "") {
        const net = gross / (1 + rateNum * 0.01);
        return Math.round((gross - net) * 100) / 100;
      }
      return 0;
    };

    let totalPaymentAmount = 0;
    const perLineVatAmounts = [];
    /** Human-readable tax name + rate for receipt (`lines_json`) */
    const lineTaxReceiptLabels = [];

    // === PROCESS EACH EXPENSE ITEM (VAT aligned with expense bill / vat_policy) ===
    for (let i = 0; i < normalizedLines.length; i++) {
      const { item, qty, rate, amount, head } = normalizedLines[i];
      const lineTxDate =
        item.transaction_date || item.payment_date || transaction_date;
      totalExpenseAmount += amount;

      // Find Expense Account
      const expenseAccount = await db.AccountCategory.findOne({
        where: { code: head, facility_id: facilityId },
        transaction,
      });
      if (!expenseAccount)
        throw new Error(`Expense account not found: ${head}`);

      const desc =
        item.description ||
        item.item_name ||
        expenseAccount.description ||
        "Direct Expense";

      let taxRow = null;
      if (item.tax_id != null && String(item.tax_id).trim() !== "") {
        const tid = parseInt(item.tax_id, 10);
        if (!Number.isNaN(tid)) {
          taxRow = await db.Tax.findOne({
            where: { id: tid, facilityId },
            transaction,
          });
          if (!taxRow)
            throw new Error(
              `Line ${i + 1}: tax not found or not for this facility (id: ${tid})`,
            );
        }
      }

      const legacyTaxable =
        item.taxable === "Taxable" ||
        item.taxable === true ||
        String(item.taxable || "").toLowerCase() === "taxable";

      let descForEntry = desc;
      if (taxRow) {
        const rtRaw = String(taxRow.rate_type || "").toLowerCase();
        const rateLabel =
          rtRaw.includes("percent") ||
          taxRow.rate_type === "percentage" ||
          rtRaw === ""
            ? `${taxRow.rate}%`
            : `${taxRow.rate}`;
        const inc =
          String(taxRow.inclusive_type || "").toLowerCase() === "inclusive"
            ? "Inc"
            : "Exc";
        descForEntry = `${desc} [Tax: ${taxRow.description} ${rateLabel} · ${inc}]`;
      } else if (legacyTaxable) {
        descForEntry = `${desc} [Taxable]`;
      }

      let expenseDebit = amount;
      let vatDebit = 0;

      if (taxRow) {
        const taxIncl = isTaxInclusiveType(taxRow);
        if (vatPolicy === "vat_inclusive") {
          if (!taxIncl) {
            expenseDebit = amount;
            vatDebit = computeExclusiveVatForLine(amount, taxRow);
          } else {
            expenseDebit = amount;
            vatDebit = 0;
          }
        } else if (vatPolicy === "vat_exclusive") {
          if (!taxIncl) {
            expenseDebit = amount;
            vatDebit = computeExclusiveVatForLine(amount, taxRow);
          } else {
            vatDebit = extractInclusiveVatFromGross(amount, taxRow);
            expenseDebit = Math.round((amount - vatDebit) * 100) / 100;
          }
        } else {
          if (taxIncl) {
            vatDebit = extractInclusiveVatFromGross(amount, taxRow);
            expenseDebit = Math.round((amount - vatDebit) * 100) / 100;
          } else {
            expenseDebit = amount;
            vatDebit = computeExclusiveVatForLine(amount, taxRow);
          }
        }
      }

      if (!taxRow) {
        totalPaymentAmount += amount;
      } else if (!isTaxInclusiveType(taxRow)) {
        totalPaymentAmount +=
          amount + computeExclusiveVatForLine(amount, taxRow);
      } else {
        totalPaymentAmount += amount;
      }

      const lineGlRef = `${refCodeString}-EXP-${i + 1}`;

      ledgerEntries.push({
        account_code: expenseAccount.code,
        account_subhead: expenseAccount.parent_code || null,
        dr: expenseDebit,
        cr: 0,
        account_description: expenseAccount.description || "Expense",
        transaction_description: descForEntry,
        type: "expenses",
        transaction_ref: lineGlRef,
        transaction_date: lineTxDate,
      });

      /** Same as expense bills / PV: prefer `head`, else `account_sub_head` for GL code */
      const vatGlCode =
        taxRow && String(taxRow.head || taxRow.account_sub_head || "").trim();

      if (vatDebit > 0 && taxRow && vatGlCode) {
        const vatAccount = await db.AccountCategory.findOne({
          where: { code: vatGlCode, facility_id: facilityId },
          transaction,
        });
        if (!vatAccount)
          throw new Error(
            `Line ${i + 1}: input VAT GL account not found for tax "${taxRow.description}" (code: ${vatGlCode})`,
          );
        totalVatAmount += vatDebit;
        ledgerEntries.push({
          account_code: vatAccount.code,
          account_subhead: vatAccount.parent_code || null,
          dr: vatDebit,
          cr: 0,
          account_description: vatAccount.description || "Input VAT",
          transaction_description: `Input VAT — ${taxRow.description} (${taxRow.rate}%)`,
          type: "tax",
          transaction_ref: `${refCodeString}-VAT-${i + 1}`,
          transaction_date: lineTxDate,
        });
      } else if (vatDebit > 0 && taxRow && !vatGlCode) {
        throw new Error(
          `Line ${i + 1}: tax "${taxRow.description}" has no VAT GL code — set Head or Account sub head in Tax setup`,
        );
      }

      lineTaxReceiptLabels[i] = taxRow
        ? (() => {
            const rt = String(taxRow.rate_type || "").toLowerCase();
            const rateStr =
              rt === "percentage" || rt.includes("percent") || rt === ""
                ? `${String(taxRow.rate ?? "")
                    .replace(/,/g, "")
                    .trim()}%`
                : String(taxRow.rate ?? "").trim();
            const inc = isTaxInclusiveType(taxRow);
            const name = String(taxRow.description || "Tax").trim();
            return `${name} (${rateStr}) · ${inc ? "Inc" : "Exc"}`;
          })()
        : null;

      perLineVatAmounts.push(vatDebit);
    }

    if (totalExpenseAmount === 0)
      throw new Error("No valid expense items found");

    // === DETERMINE PAYMENT SOURCE ACCOUNT ===
    let paymentAccount = null;
    let paymentHead = null;
    let paymentName = "";
    let bankAcc = null;

    if (mode_of_payment === "cash") {
      if (!accountHead?.head)
        throw new Error("accountHead.head is required for cash payment");
      paymentHead = accountHead.head;

      paymentAccount = await db.AccountCategory.findOne({
        where: { code: paymentHead, facility_id: facilityId },
        transaction,
      });
      if (!paymentAccount)
        throw new Error(`Cash account not found: ${paymentHead}`);
      paymentName = paymentAccount.description || "Cash in Hand";
    } else if (["bank", "cheque"].includes(mode_of_payment)) {
      if (!bankAccount?.id)
        throw new Error("bankAccount.id is required for bank/cheque payment");

      bankAcc = await db.bank_account.findOne({
        where: { id: bankAccount.id, facilityId, status: "active" },
        transaction,
      });
      if (!bankAcc) throw new Error("Bank account not found or inactive");
      if (!bankAcc.head)
        throw new Error(
          `Bank account '${bankAcc.account_name}' has no GL head assigned`,
        );

      paymentHead = bankAcc.head;
      paymentName = bankAcc.account_name;

      paymentAccount = await db.AccountCategory.findOne({
        where: { code: bankAcc.head, facility_id: facilityId },
        transaction,
      });
      if (!paymentAccount)
        throw new Error(`GL account not found for bank head: ${bankAcc.head}`);
    }

    // === Credit Cash/Bank Account (Instant Payment) ===
    ledgerEntries.push({
      account_code: paymentAccount.code,
      account_subhead: paymentAccount.parent_code || null,
      dr: 0,
      cr: totalPaymentAmount,
      account_description: paymentAccount.description || paymentName,
      transaction_description: `${narration} - Paid via ${mode_of_payment.toUpperCase()}`,
      bank_account_id: bankAccount?.id || bankAcc?.head || null,
      mode_of_payment: mode_of_payment,
      type: "payment",
      cheque_no: cheque_number,
      transaction_ref: `${refCodeString}-PAY`,
      transaction_date,
    });

    // === SAVE TO GENERAL LEDGER ===
    for (const entry of ledgerEntries) {
      const glRef =
        entry.transaction_ref ||
        `${refCodeString}-${String(entry.type || "entry").toUpperCase()}`;
      await db.GeneralLedger.create(
        {
          transaction_date: moment(
            entry.transaction_date || transaction_date || undefined,
          ).format("YYYY-MM-DD"),
          account_code: entry.account_code,
          account_subhead: entry.account_subhead || 0,
          dr: entry.dr,
          cr: entry.cr,
          account_description: entry.account_description,
          transaction_description: entry.transaction_description,
          reference_number: refCodeString,
          purpose_of_payment: narration,
          payee: null,
          created_by: userId,
          facility_id: facilityId,
          status: "paid",
          bank_account_id: entry.bank_account_id,
          mode_of_payment: entry.mode_of_payment,
          type: entry.type,
          transaction_ref: glRef,
        },
        { transaction },
      );
    }

    if (!skip_invoice) {
      await db.Invoice.create(
        {
          ref_number: refCodeString,
          invoice_ref: refCodeResult,
          due_date: moment(transaction_date || undefined).format("YYYY-MM-DD"),
          transaction_date: moment(transaction_date || undefined).format(
            "YYYY-MM-DD",
          ),
          description: narration,
          amount: totalPaymentAmount,
          payment_method: mode_of_payment,
          user_id: userId,
          created_by: userId,
          facility_id: facilityId,
          type: "purchase",
        },
        { transaction },
      );
    }

    // Imprest / direct-expense history (GL + optional invoice + impress row)
    const linesSnapshot = data.map((row, idx) => ({
      ...row,
      _line_index: idx + 1,
      _amount: normalizedLines[idx] ? normalizedLines[idx].amount : null,
      _vat_amount:
        perLineVatAmounts[idx] != null ? perLineVatAmounts[idx] : null,
      _tax_detail: lineTaxReceiptLabels[idx] || null,
    }));

    let createdByName = null;
    if (userId != null) {
      try {
        const creator = await db.users.findOne({
          where: { id: userId },
          transaction,
          attributes: ["firstname", "lastname", "username", "email"],
        });
        if (creator) {
          const full = [creator.firstname, creator.lastname]
            .filter(Boolean)
            .join(" ")
            .trim();
          createdByName = full || creator.username || creator.email || null;
        }
      } catch (_) {
        /* ignore lookup failure */
      }
    }

    await db.Impress.create(
      {
        facility_id: facilityId,
        ref_number: refCodeString,
        reference_display: reference,
        user_id: userId != null ? String(userId) : null,
        transaction_date: moment(transaction_date || undefined).format(
          "YYYY-MM-DD",
        ),
        remark: narration,
        mode_of_payment,
        cheque_number: cheque_number || null,
        total_expense: totalExpenseAmount,
        total_vat: totalVatAmount,
        total_payment: totalPaymentAmount,
        line_count: normalizedLines.length,
        lines_json: linesSnapshot,
        payment_meta_json: {
          payment_head: paymentHead,
          cash_account_head:
            mode_of_payment === "cash" ? accountHead?.head || null : null,
          cash_account_description:
            mode_of_payment === "cash"
              ? paymentAccount?.description || paymentName || null
              : null,
          bank_account_id: bankAccount?.id || null,
          bank_account_name:
            bankAcc?.account_name ||
            (mode_of_payment === "cash" ? null : paymentName) ||
            null,
          bank_institution: bankAcc?.account_bank_type || null,
          bank_code: bankAcc?.bank_code || null,
          bank_account_number: bankAcc?.account_number || null,
          payment_account_label: paymentName || null,
          gl_payment_code: paymentHead || null,
          vat_policy: vatPolicy,
          created_by_name: createdByName,
          created_by_id: userId != null ? String(userId) : null,
        },
      },
      { transaction },
    );

    await transaction.commit();

    return res.json({
      success: true,
      message: "Direct expense recorded and paid instantly",
      data: {
        reference,
        ref_code: refCodeString,
        total_amount: totalPaymentAmount,
        expense_amount: totalExpenseAmount,
        vat_amount: totalVatAmount,
        vat_policy: vatPolicy,
        mode_of_payment,
        payment_via: mode_of_payment === "cash" ? "Cash" : paymentName,
        payment_account_head: paymentHead,
        items_processed: normalizedLines.length,
        transaction_date: moment(transaction_date || undefined).format(
          "YYYY-MM-DD",
        ),
        impress_ref: refCodeString,
      },
    });
  } catch (err) {
    console.error("Direct Expenses Error:", err);
    if (transaction && !transaction.finished) {
      await transaction.rollback().catch(console.error);
    }
    return res.status(500).json({
      success: false,
      message: "Failed to record direct expense",
      error: err.message,
    });
  }
};

/**
 * Turn impress.lines_json into a plain array of line objects (MySQL JSON / Sequelize quirks).
 */
function normalizeLinesJsonValue(v) {
  if (v == null) return [];
  let x = v;
  if (Buffer.isBuffer(x)) {
    try {
      x = JSON.parse(x.toString("utf8"));
    } catch {
      return [];
    }
  }
  if (typeof x === "string" && x.trim() !== "") {
    try {
      x = JSON.parse(x);
      if (typeof x === "string" && x.trim() !== "") {
        try {
          x = JSON.parse(x);
        } catch {
          /* single-level string */
        }
      }
    } catch {
      return [];
    }
  }
  if (Array.isArray(x)) {
    if (x.length === 1 && Array.isArray(x[0])) x = x[0];
    return x.filter((row) => row != null && typeof row === "object");
  }
  if (typeof x === "object") {
    if (Array.isArray(x.lines))
      return x.lines.filter((row) => row != null && typeof row === "object");
    return Object.values(x).filter(
      (row) => row != null && typeof row === "object",
    );
  }
  return [];
}

/** Parse MySQL/Sequelize JSON columns that may arrive as strings. */
function normalizeImpressJsonFields(plain) {
  if (!plain || typeof plain !== "object") return plain;
  const out = { ...plain };
  out.lines_json = normalizeLinesJsonValue(out.lines_json);
  const pm = out.payment_meta_json;
  if (pm == null) {
    /* keep null */
  } else if (typeof pm === "string" && pm.trim() !== "") {
    try {
      out.payment_meta_json = JSON.parse(pm);
    } catch {
      out.payment_meta_json = {};
    }
  } else if (Buffer.isBuffer(pm)) {
    try {
      out.payment_meta_json = JSON.parse(pm.toString("utf8"));
    } catch {
      out.payment_meta_json = {};
    }
  } else if (typeof pm !== "object") {
    out.payment_meta_json = {};
  }
  return out;
}

/** List imprest / direct-expense history (impress table). */
exports.listImpress = async (req, res) => {
  try {
    const { facilityId, limit = 50, offset = 0 } = req.query;
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const off = Math.max(parseInt(offset, 10) || 0, 0);
    const { count, rows } = await db.Impress.findAndCountAll({
      where: { facility_id: facilityId },
      order: [["created_at", "DESC"]],
      limit: lim,
      offset: off,
    });
    const results = rows.map((r) =>
      normalizeImpressJsonFields(r.get ? r.get({ plain: true }) : r),
    );
    return res.json({
      success: true,
      results,
      total: count,
      limit: lim,
      offset: off,
    });
  } catch (err) {
    console.error("listImpress:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to list imprest history",
      error: err.message,
    });
  }
};

/** Single imprest row by ref_number (for receipt screen). */
exports.getImpressOne = async (req, res) => {
  try {
    const { facilityId, ref } = req.query;
    if (!facilityId || ref == null || String(ref).trim() === "") {
      return res.status(400).json({
        success: false,
        message: "facilityId and ref are required",
      });
    }
    const row = await db.Impress.findOne({
      where: {
        facility_id: facilityId,
        ref_number: String(ref).trim(),
      },
    });
    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Imprest record not found",
      });
    }
    let plain = normalizeImpressJsonFields(row.get({ plain: true }));
    const pm = { ...(plain.payment_meta_json || {}) };

    if (!pm.created_by_name && plain.user_id) {
      try {
        const creator = await db.users.findOne({
          where: { id: plain.user_id },
          attributes: ["firstname", "lastname", "username", "email"],
        });
        if (creator) {
          const full = [creator.firstname, creator.lastname]
            .filter(Boolean)
            .join(" ")
            .trim();
          pm.created_by_name =
            full || creator.username || creator.email || null;
        }
      } catch (_) {
        /* ignore */
      }
    }

    if (pm.bank_account_id && (!pm.bank_code || !pm.bank_institution)) {
      try {
        const ba = await db.bank_account.findOne({
          where: {
            id: pm.bank_account_id,
            facilityId,
            status: "active",
          },
        });
        if (ba) {
          pm.bank_institution = pm.bank_institution || ba.account_bank_type;
          pm.bank_code = pm.bank_code || ba.bank_code;
          pm.bank_account_number = pm.bank_account_number || ba.account_number;
          pm.bank_account_name = pm.bank_account_name || ba.account_name;
        }
      } catch (_) {
        /* ignore */
      }
    }

    if (
      plain.mode_of_payment === "cash" &&
      pm.cash_account_head &&
      !pm.cash_account_description
    ) {
      try {
        const ac = await db.AccountCategory.findOne({
          where: { code: pm.cash_account_head, facility_id: facilityId },
        });
        if (ac)
          pm.cash_account_description =
            ac.description || pm.payment_account_label || null;
      } catch (_) {
        /* ignore */
      }
    }

    plain = { ...plain, payment_meta_json: pm };
    return res.json({ success: true, data: plain });
  } catch (err) {
    console.error("getImpressOne:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

/** Delete one imprest record and related direct-expense ledger entries. */
exports.deleteImpress = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { id } = req.params;
    const { facilityId } = req.query;

    if (!id) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "id is required",
      });
    }
    if (!facilityId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const row = await db.Impress.findOne({
      where: { id, facility_id: facilityId },
      transaction,
    });

    if (!row) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Imprest record not found",
      });
    }

    const refNumber = String(row.ref_number || "").trim();

    // Remove direct-expense GL lines tied to this imprest reference.
    if (refNumber) {
      await db.GeneralLedger.destroy({
        where: {
          facility_id: facilityId,
          reference_number: refNumber,
        },
        transaction,
      });

      // Defensive cleanup in case an invoice was created for this reference.
      await db.Invoice.destroy({
        where: {
          facility_id: facilityId,
          ref_number: refNumber,
        },
        transaction,
      });
    }

    await db.Impress.destroy({
      where: { id, facility_id: facilityId },
      transaction,
    });

    await transaction.commit();
    return res.json({
      success: true,
      message: "Imprest record deleted successfully",
    });
  } catch (err) {
    await transaction.rollback();
    console.error("deleteImpress:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to delete imprest record",
      error: err.message,
    });
  }
};

/** Update transaction_date for one imprest record. */
exports.updateImpressDate = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { id } = req.params;
    const { facilityId, transaction_date } = req.body || {};

    if (!id) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "id is required",
      });
    }
    if (!facilityId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }
    if (!transaction_date || !String(transaction_date).trim()) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "transaction_date is required",
      });
    }

    const parsedDate = new Date(transaction_date);
    if (Number.isNaN(parsedDate.getTime())) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Invalid transaction_date",
      });
    }

    const row = await db.Impress.findOne({
      where: { id, facility_id: facilityId },
      transaction,
    });

    if (!row) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Imprest record not found",
      });
    }

    await db.Impress.update(
      { transaction_date: moment(parsedDate).format("YYYY-MM-DD") },
      { where: { id, facility_id: facilityId }, transaction },
    );

    await transaction.commit();
    return res.json({
      success: true,
      message: "Imprest date updated successfully",
    });
  } catch (err) {
    await transaction.rollback();
    console.error("updateImpressDate:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to update imprest date",
      error: err.message,
    });
  }
};

exports.paySupplierBills = async (req, res) => {
  const {
    facilityId,
    payment_date,
    mode_of_payment, // cash | bank | cheque
    bankAccount, // { id }
    accountHead, // { head: "104" }
    cheque_number,
    remark = "Supplier Bill Payment",
    narration, // User-provided narration for transaction_description
    bills = [], // array of { invoice_ref, amount_to_pay }
  } = req.body;
  console.log(req.body, "=============> req.body");
  const userId = req.user?.id || req.body.user_id;

  // === VALIDATIONS ===
  if (!facilityId)
    return res
      .status(400)
      .json({ success: false, message: "facilityId is required" });
  if (!payment_date)
    return res
      .status(400)
      .json({ success: false, message: "payment_date is required" });
  if (!["cash", "bank", "cheque"].includes(mode_of_payment))
    return res
      .status(400)
      .json({ success: false, message: "Invalid mode_of_payment" });
  if (!Array.isArray(bills) || bills.length === 0)
    return res
      .status(400)
      .json({ success: false, message: "bills array is required" });

  // Validate payment source
  if (mode_of_payment === "cash") {
    if (!accountHead?.head?.trim())
      return res.status(400).json({
        success: false,
        message: "Account Head is required for cash payments",
      });
  } else if (["bank", "cheque"].includes(mode_of_payment)) {
    if (!bankAccount?.id)
      return res.status(400).json({
        success: false,
        message: "Bank Account is required for bank/cheque payments",
      });
  }

  if (mode_of_payment === "cheque" && !cheque_number)
    return res.status(400).json({
      success: false,
      message: "cheque_number is required for cheque payments",
    });

  // Validate narration is required
  if (!narration || !narration.trim()) {
    return res.status(400).json({
      success: false,
      message: "narration/description is required for payment",
    });
  }

  const { validatePostingDate, PostingDateValidationError } = require("../utils/validatePostingDate");
  let normalizedPaymentDate;
  try {
    normalizedPaymentDate = validatePostingDate(payment_date, {
      field: "payment_date",
    });
  } catch (dateErr) {
    return res.status(400).json({
      success: false,
      message: dateErr.message,
      error: dateErr.message,
    });
  }

  let transaction;
  try {
    transaction = await db.sequelize.transaction();

    // Generate Payment Voucher Number
    const pvCodeResult = `PR-${await getAndUpdateNumber("direct_p", facilityId)}`;
    if (typeof pvCodeResult === "object" && pvCodeResult.message) {
      throw new Error(
        pvCodeResult.message || "Failed to generate payment voucher number",
      );
    }
    const pvCode =
      typeof pvCodeResult === "number"
        ? pvCodeResult
        : parseInt(pvCodeResult) || Date.now();
    const pvCodeString = String(pvCode);

    const paymentRef = `PAY/${moment().format("YY")}/${pvCodeString}`;
    const paymentNarration =
      narration || remark || `Supplier Payment - ${paymentRef}`;

    let totalPaymentAmount = 0;
    const ledgerEntries = [];
    const paymentRecords = []; // To return which bills were paid

    // Determine Payment Source Account (Cash or Bank)
    let paymentAccount = null;
    let paymentAccountName = "Cash/Bank";
    let paymentHead = null;

    if (mode_of_payment === "cash") {
      paymentHead = accountHead.head.trim();
      paymentAccount = await db.AccountCategory.findOne({
        where: { code: paymentHead, facility_id: facilityId },
        transaction,
      });
      if (!paymentAccount)
        throw new Error(`Cash account not found: ${paymentHead}`);
      paymentAccountName = paymentAccount.description || "Cash in Hand";
    } else if (["bank", "cheque"].includes(mode_of_payment)) {
      const bankAcc = await db.bank_account.findOne({
        where: { id: bankAccount.id, facilityId, status: "active" },
        transaction,
      });
      if (!bankAcc || !bankAcc.head)
        throw new Error("Bank account invalid or missing GL head");

      paymentHead = bankAcc.head;
      paymentAccountName = bankAcc.account_name;

      paymentAccount = await db.AccountCategory.findOne({
        where: { code: bankAcc.head, facility_id: facilityId },
        transaction,
      });
      if (!paymentAccount)
        throw new Error(`GL account not found for bank head: ${bankAcc.head}`);
    }
    const supplierData = [];
    // Process each bill
    for (const bill of bills) {
      const { invoice_ref, amount_to_pay } = bill;
      if (!invoice_ref || !amount_to_pay || parseFloat(amount_to_pay) <= 0) {
        continue; // skip invalid
      }

      const amountPayable = parseFloat(amount_to_pay);
      totalPaymentAmount += amountPayable;

      const invoice = await db.Invoice.findOne({
        where: {
          invoice_ref,
          facility_id: facilityId,
          type: "purchase",
        },
        transaction,
      });

      if (!invoice) throw new Error(`Invoice ${invoice_ref} not found`);

      const invoiceAmount = parseFloat(invoice.amount || 0);
      const alreadyPaid = parseFloat(invoice.total_paid || invoice.amount_paid || 0);
      // Prefer balance field when present
      const amountDue = Math.max(
        0,
        parseFloat(invoice.balance != null ? invoice.balance : invoiceAmount - alreadyPaid),
      );
      if (amountPayable > amountDue + 0.01) {
        throw new Error(
          `Overpayment blocked for ${invoice_ref}: paying ${amountPayable.toFixed(2)} but due is ${amountDue.toFixed(2)}`,
        );
      }

      const supplier_no = invoice.ref_number;
      supplierData.push(supplier_no);
      // Update Supplier Balance (inside transaction)
      await db.SuppliersInfo.decrement(
        { balance: amountPayable },
        { where: { supplier_number: supplier_no, facilityId }, transaction },
      );

      const supplier = await db.SuppliersInfo.findOne({
        where: { supplier_number: supplier_no, facilityId },
        transaction,
      });

      if (!supplier?.payable_code)
        throw new Error(`No payable head for supplier ${supplier_no}`);

      // Find Accounts Payable Account
      const payableAcc = await db.AccountCategory.findOne({
        where: { code: supplier.payable_code, facility_id: facilityId },
        transaction,
      });
      if (!payableAcc)
        throw new Error(`Payable account not found: ${supplier.payable_code}`);

      // Debit: Accounts Payable (Reduce Liability)
      // Use narration in transaction_description if provided, otherwise use default
      const transactionDesc = narration
        ? `${narration} - Invoice ${invoice_ref}`
        : `Payment for Invoice ${invoice_ref}`;

      ledgerEntries.push({
        account_code: payableAcc.code,
        account_subhead: payableAcc.parent_code || null,
        dr: amountPayable,
        reference_number: invoice_ref,
        cr: 0,
        account_description: payableAcc.description,
        transaction_description: transactionDesc,
        type: "payable",
        bank_account_id: mode_of_payment !== "cash" ? bankAccount?.id : null,
        transaction_ref: supplier_no,
      });

      // Create Supplier Payment Entry
      await db.SupplierEntry.create(
        {
          supplier_number: supplier_no,
          description: `${narration} - Ref: ${invoice_ref}`,
          cost: amountPayable,
          qty_in: 1,
          qty_out: 0,
          link_id: invoice_ref,
          facilityId,
          mode_of_payment,
          bank_account_id: bankAccount?.id || accountHead?.head || null,
          cheque_no: mode_of_payment === "cheque" ? cheque_number : null,
          type: "payment",
          receiptNo: pvCodeString,
          reference: paymentRef,
          transaction_date: moment(payment_date).format("YYYY-MM-DD"),
          created_by: userId,
        },
        { transaction },
      );

      paymentRecords.push({
        invoice_ref,
        amount_paid: amountPayable,
        supplier_no,
      });
      // Credit: Payment Source (Cash or Bank)
      // Use narration in transaction_description if provided, otherwise use default
      const paymentDesc = narration
        ? `${narration} - Invoice ${invoice_ref}`
        : `Supplier Bill Payment - Invoice ${invoice_ref}`;

      ledgerEntries.push({
        account_code: paymentAccount.code,
        account_subhead: paymentAccount.parent_code || null,
        dr: 0,
        cr: amount_to_pay,
        reference_number: invoice_ref,
        account_description: paymentAccount.description,
        transaction_description: paymentDesc,
        type: "bank",
        bank_account_id: bankAccount?.id || accountHead.head,
        transaction_ref: pvCodeString,
      });
    }

    if (totalPaymentAmount <= 0) {
      await transaction.rollback();
      return res
        .status(400)
        .json({ success: false, message: "No valid payments to process" });
    }

    // Save All Ledger Entries
    for (const entry of ledgerEntries) {
      await db.GeneralLedger.create(
        {
          transaction_date: normalizedPaymentDate,
          account_code: entry.account_code,
          account_subhead: entry.account_subhead || 0,
          dr: entry.dr,
          cr: entry.cr,
          bank_account_id: entry.bank_account_id || null,
          account_description: entry.account_description,
          transaction_description: entry.transaction_description,
          reference_number: entry.reference_number,
          purpose_of_payment: narration,
          payee: "Multiple Suppliers",
          created_by: userId,
          facility_id: facilityId,
          status: "paid",
          type: entry.type,
          transaction_ref: entry.transaction_ref,
          mode_of_payment,
          cheque_no: mode_of_payment === "cheque" ? cheque_number : null,
        },
        { transaction },
      );
    }

    await transaction.commit();

    return res.json({
      success: true,
      message: "Supplier bills paid successfully",
      data: {
        dataBills: bills,
        payment_ref: paymentRef,
        pv_code: pvCodeString,
        total_payment_amount: totalPaymentAmount,
        bills_paid_count: paymentRecords.length,
        mode_of_payment,
        payment_via: paymentAccountName,
        payment_account_head: paymentHead,
        payment_date: normalizedPaymentDate,
        narration,
        bills: paymentRecords,
      },
    });
  } catch (err) {
    console.error("Pay Supplier Bills Error:", err);
    if (transaction)
      await transaction
        .rollback()
        .catch((e) => console.error("Rollback failed:", e));

    const { PostingDateValidationError } = require("../utils/validatePostingDate");
    const isClientError =
      err instanceof PostingDateValidationError ||
      err?.name === "PostingDateValidationError";

    const message =
      err?.message ||
      (typeof err === "string" ? err : null) ||
      "Failed to process payment";

    return res.status(isClientError ? 400 : 500).json({
      success: false,
      message,
      error: message,
    });
  }
};

exports.directConsumables = async (req, res) => {
  const {
    data = [],
    facilityId,
    user_id,
    supplier_no,
    remark,
    transaction_date,
    bankAccount = {}, // { id, account_name, ... }
    accountHead = {}, // { head: "104" } for cash
    mode_of_payment, // "cash" | "bank" | "cheque"
  } = req.body;
  console.log(req.body);
  // === VALIDATIONS ===
  if (!facilityId)
    return res
      .status(400)
      .json({ success: false, message: "facilityId is required" });
  if (!supplier_no)
    return res
      .status(400)
      .json({ success: false, message: "supplier_no is required" });
  if (!Array.isArray(data) || data.length === 0)
    return res
      .status(400)
      .json({ success: false, message: "data must be a non-empty array" });
  if (!["cash", "bank", "cheque"].includes(mode_of_payment))
    return res.status(400).json({
      success: false,
      message: "mode_of_payment must be cash, bank, or cheque",
    });

  const userId = user_id || req.user?.id;
  let transaction;

  try {
    transaction = await db.sequelize.transaction();

    // === SUPPLIER ===
    const supplier = await db.SuppliersInfo.findOne({
      where: { supplier_number: supplier_no, facilityId },
      transaction,
    });
    if (!supplier) throw new Error(`Supplier not found: ${supplier_no}`);
    const supplier_name =
      supplier.supplier_name || supplier.name || supplier_no;

    // === REFERENCE ===
    const refCode = await getAndUpdateNumber("direct_p", facilityId);
    const reference = `DC/${moment().format("YY")}/${refCode}`;
    const narration = remark || `Direct Consumables Purchase - ${reference}`;

    let totalAmount = 0;
    const ledgerEntries = [];
    const storeEntryPromises = [];

    // === PROCESS EACH CONSUMABLE ITEM ===
    for (const item of data) {
      const qty = parseFloat(item.quantity || item.qty || 0);
      const cost = parseFloat(item.cost || 0);
      const amount = qty * cost;

      if (qty <= 0 || cost <= 0) continue;

      const sku = item.sku || item.item_code;
      if (!sku) throw new Error(`SKU/item_code is required for all items`);

      totalAmount += amount;

      const product = await db.Product.findOne({
        where: { sku, facility_id: facilityId },
        attributes: ["id", "name", "inventory_account", "item_type"],
        transaction,
      });
      if (!product) throw new Error(`Product not found: ${sku}`);

      const inventoryAccount = await db.AccountCategory.findOne({
        where: { code: product.inventory_account, facility_id: facilityId },
        transaction,
      });
      if (!inventoryAccount)
        throw new Error(
          `Inventory account not found for head: ${product.inventory_account}`,
        );

      const itemName = item.description || product.name || sku;

      // 1. Store Entry (Stock In)
      storeEntryPromises.push(
        db.StoreEntry.create(
          {
            receive_date: moment(transaction_date || undefined).format(
              "YYYY-MM-DD",
            ),
            po_no: "DIRECT",
            reference_number: refCode,
            qty_in: qty,
            qty_out: 0,
            expiry_date: item.expiry_date || item.expiryDate || null,
            cost_price: cost,
            selling_price: 0,
            mark_up: 0,
            branch_name: product.item_type,
            inserted_by: userId,
            facilityId,

            transaction_ref: refCode,
            item_category: product.item_type || "Consumable",
            supplier_code: supplier_no,
            supplier_name,
            source: `Direct Purchase - ${supplier_name}`,
            destination: "Warehouse",
            status: "approved",
            activation: "active",
            type: STORE_ENTRY_TYPE.PURCHASE,
            product_id: sku,
          },
          { transaction },
        ),
      );

      // 2. Supplier Entry (Audit Trail - Paid Instantly)
      await db.SupplierEntry.create(
        {
          supplier_number: supplier_no,
          description: itemName,
          cost: cost,
          qty_in: 0,
          qty_out: qty,
          link_id: refCode,
          facilityId,
          mode_of_payment: mode_of_payment,
          type: "purchase",
          bank_account_id: 0,
          receiptNo: refCode,
          created_by: userId,
          transaction_date: moment(transaction_date || undefined).format(
            "YYYY-MM-DD",
          ),
        },
        { transaction },
      );

      // // 3. Update Inventory Valuation (Moving Average or FIFO - here we use simple upsert)
      // await db.InventoryValuation.create(
      //   {
      //     product_id: sku,
      //     facility_id: facilityId,
      //     quantity_on_hand: qty,
      //     avg_unit_cost: cost,
      //     total_value: amount,

      //   },
      //   { transaction }
      // );

      // 4. Debit Inventory Account
      ledgerEntries.push({
        account_code: inventoryAccount.code,
        account_subhead: inventoryAccount.parent_code || 0,
        dr: amount,
        cr: 0,
        account_description: inventoryAccount.description || "Inventory",
        transaction_description: `${narration} - ${itemName}`,
        type: "inventory",
      });
    }

    if (totalAmount === 0)
      throw new Error("No valid consumable items to process");

    // === DETERMINE PAYMENT SOURCE (Cash or Bank) ===
    let paymentAccount = null;
    let paymentHead = null;
    let paymentName = "Cash/Bank";

    if (mode_of_payment === "cash") {
      if (!accountHead?.head)
        throw new Error("accountHead.head required for cash payment");
      paymentHead = accountHead.head;

      paymentAccount = await db.AccountCategory.findOne({
        where: { code: paymentHead, facility_id: facilityId },
        transaction,
      });
      if (!paymentAccount)
        throw new Error(`Cash account not found: ${paymentHead}`);
      paymentName = paymentAccount.description || "Cash in Hand";
    } else if (["bank", "cheque"].includes(mode_of_payment)) {
      if (!bankAccount?.id)
        throw new Error("bankAccount.id required for bank/cheque payment");

      const bankAcc = await db.bank_account.findOne({
        where: { id: bankAccount.id, facilityId, status: "active" },
        transaction,
      });
      if (!bankAcc) throw new Error("Bank account not found or inactive");
      if (!bankAcc.head)
        throw new Error(
          `Bank account '${bankAcc.account_name}' has no GL head`,
        );

      paymentHead = bankAcc.head;
      paymentName = bankAcc.account_name;

      paymentAccount = await db.AccountCategory.findOne({
        where: { code: bankAcc.head, facility_id: facilityId },
        transaction,
      });
      if (!paymentAccount)
        throw new Error(`GL account not found for head: ${bankAcc.head}`);
    }

    // === Credit Cash/Bank (Instant Payment) ===
    ledgerEntries.push({
      account_code: paymentAccount.code,
      account_subhead: paymentAccount.parent_code || 0,
      dr: 0,
      cr: totalAmount,
      account_description: paymentAccount.description || paymentName,
      transaction_description: `${narration} - Paid via ${mode_of_payment.toUpperCase()}`,
      type: "bank",
    });

    // === SAVE TO GENERAL LEDGER ===
    for (const entry of ledgerEntries) {
      await db.GeneralLedger.create(
        {
          transaction_date: moment(transaction_date || undefined).format(
            "YYYY-MM-DD",
          ),
          account_code: entry.account_code,
          account_subhead: entry.account_subhead || 0,
          dr: entry.dr,
          cr: entry.cr,
          account_description: entry.account_description,
          transaction_description: entry.transaction_description,
          reference_number: refCode,
          purpose_of_payment: narration,
          payee: supplier_name,
          created_by: userId,
          facility_id: facilityId,
          status: "paid",
          type: entry.type,
          transaction_ref: supplier_no,
        },
        { transaction },
      );
    }
    await db.SupplierEntry.create(
      {
        supplier_number: supplier_no,
        description: `Payment`,
        cost: totalAmount,
        qty_in: 1,
        qty_out: 0,
        link_id: refCode,
        facilityId,
        mode_of_payment: mode_of_payment,
        type: "payment",
        bank_account_id: bankAccount?.id || accountHead?.head || null,
        receiptNo: refCode,
        created_by: userId,
        transaction_date: moment(transaction_date || undefined).format(
          "YYYY-MM-DD",
        ),
      },
      { transaction },
    );
    // === RECORD AS PAID INVOICE (Optional - for reporting) ===
    await db.Invoice.create(
      {
        ref_number: supplier_no,
        invoice_ref: refCode,
        due_date: moment(transaction_date || undefined).format("YYYY-MM-DD"),
        transaction_date: moment(transaction_date || undefined).format(
          "YYYY-MM-DD",
        ),
        description: narration,
        amount: totalAmount,
        payment_method: mode_of_payment,
        user_id: userId,
        created_by: userId,
        facility_id: facilityId,
        type: "purchase",
        status: "paid",
      },
      { transaction },
    );

    await Promise.all(storeEntryPromises);
    await transaction.commit();

    return res.json({
      success: true,
      message: "Direct consumables purchased and paid instantly",
      data: {
        reference,
        ref_code: refCode,
        total_amount: totalAmount,
        mode_of_payment,
        payment_via: paymentName,
        payment_account_head: paymentHead,
        supplier_name,
        items_processed: data.length,
        stock_added: data.filter((i) => parseFloat(i.quantity || 0) > 0).length,
        transaction_date: moment(transaction_date || undefined).format(
          "YYYY-MM-DD",
        ),
      },
    });
  } catch (err) {
    console.error("Direct Consumables Error:", err);
    if (transaction && !transaction.finished) {
      await transaction.rollback().catch(console.error);
    }
    return res.status(500).json({
      success: false,
      message: "Failed to process direct consumables purchase",
      error: err.message,
    });
  }
};

exports.supplierPayment = async (req, res) => {
  const { data, facilityId, userId } = req.body;

  console.log("Request body:", req.body);

  // ✅ Validate that data is an object
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return res.status(400).json({
      success: false,
      message: "Invalid request: data must be a single object.",
    });
  }

  // ✅ Validate required fields
  if (!data?.supplier_number || !data?.amount_paid || !facilityId) {
    return res.status(400).json({
      success: false,
      message:
        "Missing required fields: supplier_number, amount_paid, or facilityId.",
    });
  }

  // ✅ Validate amount
  const amountPaid = parseFloat(data.amount_paid);
  if (isNaN(amountPaid) || amountPaid <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid amount_paid: must be a positive number.",
    });
  }

  const transaction = await db.sequelize.transaction();

  try {
    // Generate reference code
    const generatedPVCode = `REF/${moment().format("YY")}/${Math.floor(
      Math.random() * 1000,
    )}`;

    // ✅ Create supplier entry using ORM
    const supplierEntry = await db.SupplierEntry.create(
      {
        supplier_number: data.supplier_number,
        description:
          data?.remark ||
          `Supplier Payment - ${data?.supplier_name || data.supplier_number}`,
        qty_in: 1,
        qty_out: 0,
        cost: amountPaid,
        dr: amountPaid, // Debit entry for supplier payment
        cr: 0,
        facilityId: facilityId,
        mode_of_payment: data?.mode_of_payment || "Cash",
        receiptNo: generatedPVCode,
        created_by: userId || "SYSTEM",
        bank_account_id: data?.bank_account_id || null,
      },
      { transaction },
    );

    // ✅ Create journal entries for proper accounting using raw SQL to avoid model issues
    const transactionDate = data?.date || moment().format("YYYY-MM-DD");

    // 1. Debit Supplier Account (Accounts Payable)
    await db.sequelize.query(
      `INSERT INTO general_ledger (
        transactionDate, accountCode, accountSubhead, dr, cr,
        accountDescription, transactionDescription, referenceNumber,
        purposeOfPayment, payee, bank_account_id, mode_of_payment,
        created_by, facilityId, status, transactionType, transaction_ref
      ) VALUES (
        :transaction_date, :account_code, :account_subhead, :dr, :cr,
        :account_description, :transaction_description, :reference_number,
        :purpose_of_payment, :payee, :bank_account_id, :mode_of_payment,
        :created_by, :facility_id, :status, :type, :transaction_ref
      )`,
      {
        replacements: {
          transaction_date: transactionDate,
          account_code: data?.supplier_code || "SUPPLIER_PAYABLE",
          account_subhead: data.supplier_number,
          dr: amountPaid,
          cr: 0,
          account_description:
            data?.supplier_name || `Supplier ${data.supplier_number}`,
          transaction_description: `Supplier Payment - ${
            data?.remark || "Payment to supplier"
          }`,
          reference_number: generatedPVCode,
          purpose_of_payment: data?.remark || "Supplier Payment",
          payee: data?.supplier_name || `Supplier ${data.supplier_number}`,
          bank_account_id: data?.bank_account_id || null,
          mode_of_payment: data?.mode_of_payment || "Cash",
          created_by: userId || "SYSTEM",
          facility_id: facilityId,
          status: "paid",
          type: "payable",
          transaction_ref: generatedPVCode,
        },
        transaction: transaction,
      },
    );

    // 2. Credit Bank/Cash Account
    await db.sequelize.query(
      `INSERT INTO general_ledger (
        transactionDate, accountCode, accountSubhead, dr, cr,
        accountDescription, transactionDescription, referenceNumber,
        purposeOfPayment, payee, bank_account_id, mode_of_payment,
        created_by, facilityId, status, transactionType, transaction_ref
      ) VALUES (
        :transaction_date, :account_code, :account_subhead, :dr, :cr,
        :account_description, :transaction_description, :reference_number,
        :purpose_of_payment, :payee, :bank_account_id, :mode_of_payment,
        :created_by, :facility_id, :status, :type, :transaction_ref
      )`,
      {
        replacements: {
          transaction_date: transactionDate,
          account_code: data?.bank_code || "CASH_ACCOUNT",
          account_subhead: data?.bank_chart_code || "CASH",
          dr: 0,
          cr: amountPaid,
          account_description: data?.bank_name || "Cash Account",
          transaction_description: `Supplier Payment - ${
            data?.remark || "Payment to supplier"
          }`,
          reference_number: generatedPVCode,
          purpose_of_payment: data?.remark || "Supplier Payment",
          payee: data?.supplier_name || `Supplier ${data.supplier_number}`,
          bank_account_id: data?.bank_account_id || null,
          mode_of_payment: data?.mode_of_payment || "Cash",
          created_by: userId || "SYSTEM",
          facility_id: facilityId,
          status: "paid",
          type: "bank",
          transaction_ref: generatedPVCode,
        },
        transaction: transaction,
      },
    );

    // Commit transaction
    await transaction.commit();

    return res.json({
      success: true,
      message: "Supplier payment saved successfully.",
      data: {
        entry_id: supplierEntry.entry_id,
        reference_no: generatedPVCode,
        amount_paid: amountPaid,
        supplier_number: data.supplier_number,
        journal_entries: 2, // Two journal entries created
      },
    });
  } catch (err) {
    // Rollback transaction on error
    await transaction.rollback();
    console.error("Supplier payment error:", err);
    return res.status(500).json({
      success: false,
      message: "Error while trying to add supplier payment.",
      error: err.message,
    });
  }
};

exports.getRequisitionByPr = async (req, res) => {
  const {
    branch = "",
    branch_id = "",
    date = null,
    reason = "",
    requisitor = "",
    user_id = "",
    facilityId,
    supplier_name = "",
    supplier_code = "",
    query_type = "",
    total = null,
    pr_no = "",
    account_code = "",
  } = req.body;

  try {
    const results = await runPurchaseRequisitionQuery({
      query_type,
      branch,
      branch_id,
      date,
      reason,
      facilityId,
      requisitor,
      user_id,
      supplier_name,
      supplier_code,
      total,
      pr_no,
      po_no: null,
      account_code,
    });
    return res.json({ success: true, results });
  } catch (err) {
    console.error("getRequisitionByPr:", err);
    return res.status(500).json({ success: false, err: err.message });
  }
};

exports.getChartCodeAndCategory = (req, res) => {
  const { item_code } = req.query;
  db.sequelize
    .query(
      `SELECT chart_code, account_category FROM product_list WHERE item_code = "${item_code}"`,
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.addPurchaseOrderNew = (req, res) => {
  console.log(req.body);

  const {
    date,
    type = "0",
    vendor,
    client = "",
    total,
    exchange_type,
    exchange_rate,
    supplier_code = 0,
    process_by,
    reference_no = "",
    truckNo = "",
    waybillNo = "",
    supplierTotalAmt = 0,
  } = req.body.formTitle;
  const { version_id, facilityId = "" } = req.body;

  db.sequelize
    .query(`call nurmber_generator1('po',"${facilityId}")`)
    .then((resp) => {
      let PONo = resp[0].po_id;
      // let version_id = UUIDV4();
      db.sequelize
        .query("SELECT count(*) as version_id from purchase_order")
        .then((val) => {
          // let version_id = val[0][0].version_id;
          db.sequelize
            .query(
              `call add_purchase_order(:in_po_no,:in_date,:in_type,:in_vendor,:in_client,:in_total_amount,
            :in_status,:in_facilityId,:in_exchange_type,:in_exchange_rate,:supplier_code,:barcode,:process_by,
            :version_id)`,
              {
                replacements: {
                  in_po_no: PONo,
                  in_date: date,
                  in_type: type ? type : "0",
                  in_vendor: vendor,
                  in_client: client,
                  in_total_amount: total,
                  in_status: "Disburse",
                  in_facilityId: req.body.facilityId,
                  in_exchange_type: exchange_type ? exchange_type : "",
                  in_exchange_rate: exchange_rate ? exchange_rate : "",
                  supplier_code: supplier_code ? supplier_code : 0,
                  process_by: process_by,
                  version_id: version_id ? version_id : Date.now(),
                },
              },
            )
            .then(
              req.body.tableData.forEach((item) => {
                db.sequelize.query(
                  `call add_purchase_order_list (:in_exchange_rate, :in_item_name,:in_specification,
                :in_quantity_available,:in_propose_quantity,:in_price,:in_propose_amount,:in_exchange_type,
                :in_po_id,:in_type,:in_identifier,:in_facilityId,:date,:in_status,:remark,:remarks_id,
                :item_category,:in_expired_status,:in_item_code,:version_id,:supplier_code,
                :reference_no,:truckNo,:waybillNo,:in_total)`,
                  {
                    replacements: {
                      in_exchange_rate: item.exchange_rate
                        ? item.exchange_rate
                        : 0,
                      in_item_name: item.item_name,
                      in_specification: item.specification,
                      in_quantity_available: item.quantity_available
                        ? item.quantity_available
                        : 0,
                      in_propose_quantity: item.propose_quantity,
                      in_price: item.price,
                      in_propose_amount: item.propose_amount,
                      in_exchange_type: item.exchange_type,
                      in_po_id: PONo,
                      in_type: item.type ? item.type : "0",
                      in_identifier: "update",
                      in_facilityId: req.body.facilityId,
                      date: moment().format("YYYY-MM-DD"),
                      in_status: "new order",
                      remark: item.remarks,
                      remarks_id: item.remarks_id ? item.remarks_id : "0",
                      item_category: item.item_category,
                      in_expired_status: item.expired_status
                        ? item.expired_status
                        : "false",
                      in_item_code: item.item_code ? item.item_code : "0",
                      version_id: version_id,
                      supplier_code: item.supplier_code
                        ? item.supplier_code
                        : "0",
                      reference_no: item.reference_no ? item.reference_no : "",
                      truckNo: item.truckNo ? item.truckNo : "",
                      waybillNo: item.waybillNo ? item.waybillNo : "",
                      in_total: supplierTotalAmt ? supplierTotalAmt : 0,
                    },
                  },
                );
              }),
            )
            .then((results) => {
              res.json({ success: true, results, PONo });
            })
            .catch((err) => {
              console.log(err);
              res.status(500).json({ success: false, err });
            });
        });
    });
};

exports.addPurchaseOrderNewx = (req, res) => {
  const { branch_name } = req.body;

  db.sequelize
    .query(
      `SELECT item_name, balance, selling_price FROM branch_store_list3
        WHERE location_from="${branch_name}"`,
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getBranchItemList = (req, res) => {
  const { branch_name = "" } = req.query;

  db.sequelize
    .query("CALL get_branch_item_list(:branch_name)", {
      replacements: {
        branch_name,
      },
    })
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getBranchItemDetail = (req, res) => {
  const { branch_name, query_type } = req.query;

  if (query_type === "head") {
    db.sequelize
      .query(
        `SELECT item_name, balance, selling_price FROM branch_store_list2
        WHERE location_from="${branch_name}"`,
      )
      .then((results) => {
        res.json({ success: true, results: results[0] });
      })
      .catch((err) => {
        console.log(err);
        res.status(500).json({ success: false, err });
      });
  } else if (query_type === "branch") {
    db.sequelize
      .query(
        `SELECT item_name, balance, selling_price, item_code, expiring_date,trn_number FROM branch_store_list2
        WHERE location_from="${branch_name}"`,
      )
      .then((results) => {
        res.json({ success: true, results: results[0] });
      })
      .catch((err) => {
        console.log(err);
        res.status(500).json({ success: false, err });
      });
  }
};
exports.deleteStock = (req, res) => {
  const {
    receive_date = null,
    item_name = null,
    po_no = null,
    qty_in = null,
    qty_out = null,
    store_type = null,
    grm_no = null,
    query_type = "delete",
    expiry_date = null,
    unit_price = null,
    mark_up = null,
    selling_price = null,
    transfer_from = null,
    status = null,
    transfer_to = null,
    branch_name = null,
    facilityId = null,
    trn_no = null,
    uniqueId = null,
    item_category = null,
    item_code = null,
    version_id = null,
    req_no = null,
    truckNo = null,
    waybillNo = null,
    otherInfo = null,
    cost_price = null,
    supplier_code = null,
    supplier_name = null,
    reorder = null,
    receiptNo = null,
    userId = null,
  } = req.body;
  const stmt = `call add_new_store(:receive_date, :item_name, :po_no, :qty_in,:qty_out,:store_type,:grm_no,
    :query_type,:expiry_date,:unit_price,:mark_up,:selling_price,:transfer_from,:status,
    :transfer_to,:branch_name,:facilityId,:trn_no,:uniqueId,:item_category,:item_code,:version_id, :req_no,
    :truckNo, :waybillNo, :otherInfo, :cost_price, :supplier_code, :supplier_name,:reorder,:receiptNo,
    :userId)`;

  db.sequelize
    .query(stmt, {
      replacements: {
        receive_date,
        item_name,
        po_no: 0,
        qty_in,
        qty_out,
        store_type,
        grm_no,
        query_type,
        expiry_date,
        unit_price,
        mark_up,
        selling_price,
        transfer_from,
        status,
        transfer_to,
        branch_name,
        facilityId,
        trn_no,
        uniqueId,
        item_category,
        item_code,
        version_id,
        req_no,
        truckNo,
        waybillNo,
        otherInfo,
        cost_price,
        supplier_code,
        supplier_name,
        reorder,
        receiptNo,
        userId,
      },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};
// `a`.`subhead` AS `id`,
//   `a`.`head` AS `parent_id`,
exports.getAccountStatement = (req, res) => {
  const stmt =
    "SELECT parent_id as head, id as subhead, description,account_type, parent,  balance FROM `sfp` where parent_id is not null";
  db.sequelize
    .query(stmt)
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

// controllers/accountTypeController.js

// const { Op } = require('sequelize');

exports.getAccountTypes = async (req, res) => {
  try {
    const { facilityId } = req.params; // or req.query.facilityId if you prefer

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Use Account directly since it's imported at the top
    const rows = await Account.findAll({
      where: {
        facilityId,
        status: "activated",
        display: 1,
      },
      attributes: [
        "head",
        "subhead",
        "description",
        "account_type",
        "type_details",
        "type_mnemonic",
        "detail_type_mnemonic",
        "show",
      ],
      order: [
        ["head", "ASC"],
        ["subhead", "ASC"],
      ],
      raw: true, // Important: gives plain objects, not Sequelize instances
    });

    const typeMap = new Map();

    rows.forEach((row) => {
      const {
        head,
        subhead,
        description,
        account_type,
        type_details,
        type_mnemonic,
        detail_type_mnemonic,
        show,
      } = row;

      // Skip header/group rows — these are not real accounts
      // if (show === 1 || subhead === "0") return;

      const cleanHead = String(head || "").trim();
      const cleanSubhead = String(subhead || "0").trim();

      // Extract numeric typeId (e.g., head = "11" → typeId = "10" for Income)
      const typeIdMatch = cleanHead.match(/^\d+/);
      const typeId = typeIdMatch
        ? (parseInt(typeIdMatch[0], 10) - 1).toString()
        : "0";

      // Create parent type if not exists
      if (!typeMap.has(account_type)) {
        typeMap.set(account_type, {
          typeId,
          head: cleanHead,
          subhead: cleanSubhead,
          show: show || 0,
          type: account_type,
          typeMnemonic: type_mnemonic || "",
          typeEnumName: type_details || "",
          children: [],
        });
      }

      const parent = typeMap.get(account_type);

      // Only add real detail accounts (subhead ≠ "0")
      if (cleanSubhead !== "0" && cleanSubhead) {
        parent.children.push({
          head: cleanHead,
          subhead: cleanSubhead,
          show: show || 0,
          detailTypeId: cleanHead, // e.g., "1001", "11001", "3002"
          detailType: description || cleanHead,
          detailTypeMnemonic: detail_type_mnemonic || "",
          detailTypeEnumName: type_details || "",
        });
      }
    });

    // Convert to array and sort by typeId numerically
    const accountTypes = Array.from(typeMap.values()).sort(
      (a, b) => parseInt(a.typeId) - parseInt(b.typeId),
    );

    // Optional: sort children by detailTypeId (account number)
    accountTypes.forEach((type) => {
      type.children.sort((a, b) =>
        a.detailTypeId.localeCompare(b.detailTypeId, undefined, {
          numeric: true,
        }),
      );
    });

    res.json({
      success: true,
      results: {
        accountTypes: accountTypes,
      },
      accountTypes: accountTypes, // Also include for backward compatibility
    });
  } catch (err) {
    console.error("Error in getAccountTypes:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch account types",
      error: err.message,
    });
  }
};

exports.getHierarchicalGeneralLedger = async (req, res) => {
  try {
    const { facilityId, fromDate, toDate } = req.body;

    if (!facilityId || !fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        message: "facilityId, fromDate and toDate are required",
      });
    }

    // Fetch all accounts for this facility, ordered by code
    const allAccounts = await db.AccountCategory.findAll({
      where: {
        facilityId: facilityId,
        isActive: true,
      },
      order: [["code", "ASC"]],
      raw: true,
    });

    // Do NOT early-return when AccountCategory is empty - build hierarchy from ledger data
    // Create a map of accounts by code for quick lookup
    const accountMap = {};
    allAccounts.forEach((acc) => {
      accountMap[acc.code] = acc;
    });

    // Get top-level categories (level 1) - these will be our main groups
    const topLevelCategories = allAccounts.filter((acc) => acc.level === 1);

    // Fetch transactions from DB using transaction_date:
    // 1. Beginning Balance: ONLY transaction_date < fromDate (strictly BEFORE range start; excludes fromDate and everything after)
    // 2. Period transactions: transaction_date BETWEEN fromDate AND toDate (within range only; nothing after toDate)
    // Normalize dates to YYYY-MM-DD to avoid format/locale issues
    const fromDateStr = moment(fromDate, [
      "YYYY-MM-DD",
      "YYYY/MM/DD",
      "DD/MM/YYYY",
      "MM/DD/YYYY",
    ]).format("YYYY-MM-DD");
    const toDateStr = moment(toDate, [
      "YYYY-MM-DD",
      "YYYY/MM/DD",
      "DD/MM/YYYY",
      "MM/DD/YYYY",
    ]).format("YYYY-MM-DD");

    const [openingBalanceTxns, periodTxns] = await Promise.all([
      // Beginning balance = all transactions BEFORE the range (transaction_date < fromDate)
      GeneralLedger.findAll({
        where: {
          facility_id: facilityId,
          transaction_date: { [Op.lt]: fromDateStr }, // Strictly before range; excludes fromDate onward
        },
        order: [
          ["account_code", "ASC"],
          ["transaction_id", "ASC"],
        ],
        raw: true,
      }),
      // Period transactions only: within range; nothing after toDate
      // Order by transaction_date, transaction_id to match SQL: SUM(dr-cr) OVER (ORDER BY transaction_date, transaction_id)
      GeneralLedger.findAll({
        where: {
          facility_id: facilityId,
          transaction_date: { [Op.between]: [fromDateStr, toDateStr] },
        },
        order: [
          ["transaction_date", "ASC"],
          ["transaction_id", "ASC"],
        ],
        raw: true,
      }),
    ]);

    const allTransactions = [...openingBalanceTxns, ...periodTxns];

    // Normalize account_code to string (DB may return number for VARCHAR with numeric content)
    // Support both account_code and accountCode (Sequelize/driver may use either)
    const safeAccountCode = (v) =>
      v != null && v !== "" ? String(v).trim() : "";
    const getAccountCodeFromTxn = (t) =>
      safeAccountCode(t?.account_code ?? t?.accountCode);

    // Validate that all transactions in the period have matching debits/credits
    // Group by transaction_ref to ensure double-entry balance (periodTxns from DB already filtered by BETWEEN)
    const transactionGroups = {};
    periodTxns.forEach((t) => {
      const ref = t.transaction_ref || t.reference_number || "UNKNOWN";
      if (!transactionGroups[ref]) {
        transactionGroups[ref] = { debits: 0, credits: 0, count: 0 };
      }
      transactionGroups[ref].debits += parseFloat(t.dr || 0);
      transactionGroups[ref].credits += parseFloat(t.cr || 0);
      transactionGroups[ref].count++;
    });

    // Log unbalanced transactions for debugging
    const unbalancedTransactions = Object.entries(transactionGroups).filter(
      ([ref, group]) => Math.abs(group.debits - group.credits) > 0.01,
    );
    if (unbalancedTransactions.length > 0) {
      console.warn(
        "Unbalanced transactions found:",
        unbalancedTransactions.map(([ref, group]) => ({
          ref,
          debits: group.debits,
          credits: group.credits,
          difference: group.debits - group.credits,
        })),
      );
    }

    // Beginning Balance = nature-signed sum for transactions before fromDate
    // Assets/Expenses: Dr − Cr | Liabilities/Equity/Revenue: Cr − Dr
    const openingBalances = {};
    openingBalanceTxns.forEach((t) => {
      const code = getAccountCodeFromTxn(t);
      if (code) {
        const nature = resolveAccountNature(
          accountMap[code]?.accountNature || accountMap[code]?.account_nature,
          code,
        );
        openingBalances[code] =
          (openingBalances[code] || 0) +
          signedMovement(nature, t.dr, t.cr);
      }
    });

    // Helper function to get top-level category code for any account code
    const getTopLevelCode = (code) => {
      if (!code) return null;
      // Top level codes are single digit (1, 2, 3, 4, 5)
      const firstChar = code.charAt(0);
      if (firstChar >= "1" && firstChar <= "9") {
        return firstChar;
      }
      return null;
    };

    // Build fallback names from ledger for account_codes that have transactions but may not be in AccountCategory
    const accountNameFromLedger = {};
    allTransactions.forEach((t) => {
      const code = getAccountCodeFromTxn(t);
      if (code && !accountNameFromLedger[code] && t.account_description) {
        accountNameFromLedger[code] = t.account_description;
      }
    });

    // Helper function to get account name for a code (chart of accounts first, then ledger description, then code)
    const getAccountName = (code) => {
      const account = accountMap[code];
      if (account) {
        return (
          account.description ||
          account.detail ||
          account.type ||
          account.category ||
          code
        );
      }
      return accountNameFromLedger[code] || code;
    };

    // Build a map of account_code → account_subhead (parent_code) from all transactions
    // This is the authoritative parent link from the GL entries themselves
    const subheadFromLedger = {};
    allTransactions.forEach((t) => {
      const code = getAccountCodeFromTxn(t);
      const subhead =
        t.account_subhead != null ? String(t.account_subhead).trim() : "";
      if (code && subhead && subhead !== "0" && subhead !== code) {
        subheadFromLedger[code] = subhead;
      }
    });

    // Resolve the group (parent) code for a given account_code:
    // 1. Use AccountCategory.parentCode if available
    // 2. Fall back to account_subhead from the ledger entry
    // 3. Fall back to the first-character nature digit (top-level group)
    const getGroupCode = (code) => {
      const acc = accountMap[code];
      if (
        acc &&
        acc.parentCode &&
        acc.parentCode !== "0" &&
        acc.parentCode !== code
      ) {
        return String(acc.parentCode).trim();
      }
      if (subheadFromLedger[code]) {
        return subheadFromLedger[code];
      }
      // Last resort: use first digit as nature group
      const firstChar = code ? code.charAt(0) : "";
      return firstChar >= "1" && firstChar <= "9" ? firstChar : null;
    };

    // Build hierarchy structure grouped by parent_code
    const groups = {}; // parentCode -> { code, name, accounts[] }

    // Process each account that might have transactions
    const accountsWithActivity = new Set();
    allTransactions.forEach((t) => {
      const code = getAccountCodeFromTxn(t);
      if (code) {
        accountsWithActivity.add(code);
      }
    });
    // Also include accounts with opening balances
    Object.keys(openingBalances).forEach((code) => {
      if (Math.abs(openingBalances[code]) > 0.01) {
        accountsWithActivity.add(code);
      }
    });

    // Process each account code that has activity
    accountsWithActivity.forEach((accountCode) => {
      const groupCode = getGroupCode(accountCode);
      if (!groupCode) return; // Skip if can't determine parent group

      // Initialize group structure
      if (!groups[groupCode]) {
        groups[groupCode] = {
          code: groupCode,
          name: getAccountName(groupCode) || `Account Group ${groupCode}`,
          accounts: [],
        };
      }

      // Get period transactions for this account (from DB: transaction_date BETWEEN fromDate AND toDate)
      const accountTxns = periodTxns.filter(
        (t) => getAccountCodeFromTxn(t) === accountCode,
      );

      // Skip if no transactions and no opening balance
      if (
        accountTxns.length === 0 &&
        (openingBalances[accountCode] || 0) === 0
      ) {
        return;
      }

      // Get opening balance, defaulting to 0 if not found
      const beginningBalance = openingBalances[accountCode] || 0;
      let runningBalance = beginningBalance;
      const nature = resolveAccountNature(
        accountMap[accountCode]?.accountNature ||
          accountMap[accountCode]?.account_nature,
        accountCode,
      );

      // Get period transactions and sort by transaction_date then transaction_id (chronological order for correct running balance)
      const transactions = [];
      accountTxns
        .sort((a, b) => {
          const dateA = a.transaction_date
            ? moment(a.transaction_date).valueOf()
            : 0;
          const dateB = b.transaction_date
            ? moment(b.transaction_date).valueOf()
            : 0;
          if (dateA !== dateB) return dateA - dateB;
          const idA = a.transaction_id ?? 0;
          const idB = b.transaction_id ?? 0;
          return idA - idB;
        })
        .forEach((t) => {
          const debit = parseFloat(t.dr || 0);
          const credit = parseFloat(t.cr || 0);

          // Nature-based running balance (Assets/Expenses: Dr−Cr; L/E/R: Cr−Dr)
          runningBalance =
            Math.round(
              (runningBalance + signedMovement(nature, debit, credit)) * 100,
            ) / 100;

          transactions.push({
            date: moment(t.transaction_date).format("YYYY-MM-DD"),
            type: formatTransactionType(t.type),
            ref:
              t.reference_number ||
              (t.transaction_ref ? t.transaction_ref.split("-")[0] : "") ||
              "",
            description:
              t.transaction_description ||
              t.purpose_of_payment ||
              t.account_description ||
              "",
            debit,
            credit,
            balance: runningBalance,
          });
        });

      // Only add account if it has transactions or non-zero balance
      if (transactions.length > 0 || Math.abs(beginningBalance) > 0.01) {
        const accountData = {
          code: accountCode,
          name: getAccountName(accountCode),
          account_nature: nature,
          beginningBalance, // Separate beginning balance
          transactions, // Only period transactions, sorted by date ASC
          finalBalance: runningBalance,
        };

        // Add account to parent group
        groups[groupCode].accounts.push(accountData);
      }
    });

    // Sort accounts within each group by code
    Object.keys(groups).forEach((groupCode) => {
      groups[groupCode].accounts.sort((a, b) => {
        const aNum = parseInt(a.code) || 0;
        const bNum = parseInt(b.code) || 0;
        if (aNum !== 0 && bNum !== 0) {
          return aNum - bNum;
        }
        return a.code.localeCompare(b.code);
      });
    });

    // Calculate group totals
    Object.keys(groups).forEach((groupCode) => {
      const group = groups[groupCode];
      let groupTotalDebit = 0;
      let groupTotalCredit = 0;
      let groupTotalBalance = 0;

      group.accounts.forEach((account) => {
        const accountDebit = account.transactions.reduce(
          (sum, t) => sum + (t.debit || 0),
          0,
        );
        const accountCredit = account.transactions.reduce(
          (sum, t) => sum + (t.credit || 0),
          0,
        );
        groupTotalDebit += accountDebit;
        groupTotalCredit += accountCredit;
        groupTotalBalance += account.finalBalance || 0;
      });

      group.totals = {
        totalDebit: groupTotalDebit,
        totalCredit: groupTotalCredit,
        totalBalance: groupTotalBalance,
      };
    });

    // Convert groups to array format, sorted by Level 2 code
    const accountHierarchy = Object.keys(groups)
      .sort((a, b) => {
        // Sort numerically if possible, otherwise alphabetically
        const aNum = parseInt(a) || 0;
        const bNum = parseInt(b) || 0;
        if (aNum !== 0 && bNum !== 0) {
          return aNum - bNum;
        }
        return a.localeCompare(b);
      })
      .map((groupCode) => {
        const group = groups[groupCode];
        return {
          head: groupCode,
          name: group.name,
          code: groupCode,
          accounts: group.accounts,
          totals: group.totals, // Group totals
        };
      })
      .filter((group) => group.accounts.length > 0);

    // Calculate total debits and credits for validation
    // Only count actual period transactions (exclude opening balances)
    let totalPeriodDebits = 0;
    let totalPeriodCredits = 0;
    let totalPeriodTransactions = 0;

    accountHierarchy.forEach((head) => {
      head.accounts.forEach((account) => {
        account.transactions.forEach((t) => {
          // Exclude opening balance entries from totals
          if (t.type !== "Opening Balance") {
            totalPeriodDebits += parseFloat(t.debit || 0);
            totalPeriodCredits += parseFloat(t.credit || 0);
            totalPeriodTransactions++;
          }
        });
      });
    });

    return res.json({
      success: true,
      data: {
        accountHierarchy,
        fromDate,
        toDate,
        facilityId,
        // Include validation totals for debugging
        validation: {
          totalDebits: totalPeriodDebits,
          totalCredits: totalPeriodCredits,
          difference: Math.abs(totalPeriodDebits - totalPeriodCredits),
          totalTransactions: totalPeriodTransactions,
        },
      },
    });
  } catch (error) {
    console.error("Hierarchical General Ledger Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error generating hierarchical general ledger",
      error: error.message,
    });
  }
};

// Get Payable Ledger Report
exports.getPayableLedger = async (req, res) => {
  try {
    const { facilityId, fromDate, toDate, supplierId } = req.body;

    if (!facilityId || !fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        message: "facilityId, fromDate and toDate are required",
      });
    }

    if (!supplierId) {
      return res.status(400).json({
        success: false,
        message: "supplierId is required",
      });
    }

    // Build where clause for transaction_ref
    // transaction_ref can be in format "supplierId" or "supplierId-xxx"
    const whereClause = {
      facility_id: facilityId,
      transaction_date: {
        [Op.between]: [fromDate, toDate],
      },
      [Op.or]: [
        { transaction_ref: supplierId },
        { transaction_ref: { [Op.like]: `${supplierId}-%` } },
      ],
    };

    // Fetch transactions
    const transactions = await GeneralLedger.findAll({
      where: whereClause,
      order: [
        ["transaction_date", "ASC"],
        ["created_at", "ASC"],
      ],
      raw: true,
    });

    // Calculate opening balance (transactions before fromDate)
    const openingBalanceTxns = await GeneralLedger.findAll({
      where: {
        facility_id: facilityId,
        transaction_date: { [Op.lt]: fromDate },
        [Op.or]: [
          { transaction_ref: supplierId },
          { transaction_ref: { [Op.like]: `${supplierId}-%` } },
        ],
      },
      order: [
        ["transaction_date", "ASC"],
        ["created_at", "ASC"],
      ],
      raw: true,
    });

    let openingBalance = 0;
    openingBalanceTxns.forEach((t) => {
      openingBalance += parseFloat(t.dr || 0) - parseFloat(t.cr || 0);
    });

    // Calculate balance forward date (day before fromDate)
    const balanceForwardDate = moment(fromDate)
      .subtract(1, "days")
      .format("YYYY-MM-DD");

    // Process transactions with running balance
    let runningBalance = openingBalance;
    const processedTransactions = transactions.map((t) => {
      const debit = parseFloat(t.dr || 0);
      const credit = parseFloat(t.cr || 0);
      runningBalance += debit - credit;

      return {
        date: moment(t.transaction_date).format("YYYY-MM-DD"),
        ref: t.reference_number || t.transaction_ref || "",
        description: `${t.transaction_description} - ${t.purpose_of_payment} - ${t.account_description}`,
        debit: debit,
        credit: credit,
        balance: runningBalance,
      };
    });

    // Calculate totals
    const totalDebit = transactions.reduce(
      (sum, t) => sum + parseFloat(t.dr || 0),
      0,
    );
    const totalCredit = transactions.reduce(
      (sum, t) => sum + parseFloat(t.cr || 0),
      0,
    );

    res.json({
      success: true,
      data: {
        supplierId,
        openingBalance,
        balanceForward: openingBalance, // Alias for balance forward
        balanceForwardDate, // Date of balance forward
        finalBalance: runningBalance,
        transactions: processedTransactions,
        totals: {
          totalDebit,
          totalCredit,
          netBalance: totalDebit - totalCredit,
        },
        fromDate,
        toDate,
        facilityId,
      },
    });
  } catch (error) {
    console.error("Payable Ledger Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error generating payable ledger",
      error: error.message,
    });
  }
};

// Get Receivable Ledger Report
exports.getReceivableLedger = async (req, res) => {
  try {
    const { facilityId, fromDate, toDate, customerId } = req.body;

    if (!facilityId || !fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        message: "facilityId, fromDate and toDate are required",
      });
    }

    // Build where clause for transaction_ref
    // transaction_ref can be in format "customerId" or "customerId-xxx"
    const whereClause = {
      facility_id: facilityId,
      transaction_date: {
        [Op.between]: [fromDate, toDate],
      },
    };
    if (customerId) {
      whereClause[Op.or] = [
        { transaction_ref: customerId },
        { transaction_ref: { [Op.like]: `${customerId}-%` } },
      ];
    }

    // Fetch transactions
    const transactions = await GeneralLedger.findAll({
      where: whereClause,
      order: [
        ["transaction_date", "ASC"],
        ["created_at", "ASC"],
      ],
      raw: true,
    });

    // Calculate opening balance (transactions before fromDate)
    const openingBalanceWhere = {
      facility_id: facilityId,
      transaction_date: { [Op.lt]: fromDate },
    };
    if (customerId) {
      openingBalanceWhere[Op.or] = [
        { transaction_ref: customerId },
        { transaction_ref: { [Op.like]: `${customerId}-%` } },
      ];
    }
    const openingBalanceTxns = await GeneralLedger.findAll({
      where: openingBalanceWhere,
      order: [
        ["transaction_date", "ASC"],
        ["created_at", "ASC"],
      ],
      raw: true,
    });

    let openingBalance = 0;
    openingBalanceTxns.forEach((t) => {
      openingBalance += parseFloat(t.dr || 0) - parseFloat(t.cr || 0);
    });

    // Calculate balance forward date (day before fromDate)
    const balanceForwardDate = moment(fromDate)
      .subtract(1, "days")
      .format("YYYY-MM-DD");

    // Process transactions with running balance
    let runningBalance = openingBalance;
    const processedTransactions = transactions.map((t) => {
      const debit = parseFloat(t.dr || 0);
      const credit = parseFloat(t.cr || 0);
      runningBalance += debit - credit;
      const txRef = String(t.transaction_ref || "").trim();
      const parsedCustomerId = txRef.includes("-")
        ? txRef.split("-")[0]
        : txRef;

      return {
        date: moment(t.transaction_date).format("YYYY-MM-DD"),
        reference_number: t.reference_number || "",
        ref: txRef,
        customerId: parsedCustomerId || null,
        description:
          t.transaction_description ||
          t.purpose_of_payment ||
          t.account_description ||
          "",
        debit: debit,
        credit: credit,
        balance: runningBalance,
      };
    });

    // Calculate totals
    const totalDebit = transactions.reduce(
      (sum, t) => sum + parseFloat(t.dr || 0),
      0,
    );
    const totalCredit = transactions.reduce(
      (sum, t) => sum + parseFloat(t.cr || 0),
      0,
    );

    res.json({
      success: true,
      data: {
        customerId,
        openingBalance,
        balanceForward: openingBalance, // Alias for balance forward
        balanceForwardDate, // Date of balance forward
        finalBalance: runningBalance,
        transactions: processedTransactions,
        totals: {
          totalDebit,
          totalCredit,
          netBalance: totalDebit - totalCredit,
        },
        fromDate,
        toDate,
        facilityId,
      },
    });
  } catch (error) {
    console.error("Receivable Ledger Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error generating receivable ledger",
      error: error.message,
    });
  }
};

/**
 * Party balances for customers + suppliers from general_ledger.
 * Balance = SUM(dr) - SUM(cr); matches receivable/payable ledgers (incl. ref suffixes).
 * DR (balance > 0) → receivables/debtors; CR (balance < 0) → payables/creditors.
 */
async function fetchPartyBalancesByDrCr(facilityId, asAtDate = null) {
  const parties = await db.sequelize.query(
    `
    SELECT
      party_type,
      party_id,
      party_name,
      address,
      phone,
      email,
      balance
    FROM (
      SELECT
        'customer' AS party_type,
        c.customerNo AS party_id,
        COALESCE(
          NULLIF(TRIM(c.fullname), ''),
          NULLIF(TRIM(c.company_name), ''),
          NULLIF(TRIM(CONCAT(IFNULL(c.first_name, ''), ' ', IFNULL(c.last_name, ''))), ''),
          c.customerNo
        ) AS party_name,
        c.address,
        c.phone,
        c.email,
        COALESCE((
          SELECT COALESCE(SUM(gl.dr), 0) - COALESCE(SUM(gl.cr), 0)
          FROM general_ledger gl
          WHERE gl.facility_id = :facilityId
            AND (:asAtDate IS NULL OR gl.transaction_date <= :asAtDate)
            AND (
              gl.transaction_ref = c.customerNo
              OR gl.transaction_ref LIKE CONCAT(c.customerNo, '-%')
            )
        ), 0) AS balance
      FROM customers c
      WHERE c.facilityId = :facilityId

      UNION ALL

      SELECT
        'supplier' AS party_type,
        s.supplier_number AS party_id,
        s.supplier_name AS party_name,
        s.address,
        s.phone,
        s.email,
        COALESCE((
          SELECT COALESCE(SUM(gl.dr), 0) - COALESCE(SUM(gl.cr), 0)
          FROM general_ledger gl
          WHERE gl.facility_id = :facilityId
            AND (:asAtDate IS NULL OR gl.transaction_date <= :asAtDate)
            AND (
              gl.transaction_ref = s.supplier_number
              OR gl.transaction_ref LIKE CONCAT(s.supplier_number, '-%')
            )
        ), 0) AS balance
      FROM suppliersinfo s
      WHERE s.facilityId = :facilityId
    ) parties
    WHERE ABS(COALESCE(balance, 0)) > 0.0001
    ORDER BY party_name ASC
    `,
    {
      replacements: { facilityId, asAtDate: asAtDate || null },
      type: QueryTypes.SELECT,
    },
  );

  const mapDebtorRow = (row) => ({
    party_type: row.party_type,
    party_id: row.party_id,
    party_name: row.party_name,
    customerNo: row.party_id,
    Name: row.party_name,
    fullname: row.party_name,
    address: row.address,
    phone: row.phone,
    email: row.email,
    balance: parseFloat(row.balance || 0) || 0,
  });

  const mapCreditorRow = (row) => {
    const balance = parseFloat(row.balance || 0) || 0;
    return {
      party_type: row.party_type,
      party_id: row.party_id,
      party_name: row.party_name,
      supplier_number: row.party_id,
      supplier_name: row.party_name,
      address: row.address,
      phone: row.phone,
      email: row.email,
      balance,
      amount: Math.abs(balance),
    };
  };

  const debtorRows = parties
    .filter((row) => (parseFloat(row.balance || 0) || 0) > 0)
    .map(mapDebtorRow);
  const creditorRows = parties
    .filter((row) => (parseFloat(row.balance || 0) || 0) < 0)
    .map(mapCreditorRow);

  return { parties, debtorRows, creditorRows };
}

// Get Debtors Report (customers + suppliers with net DR / receivable balances)
exports.getDebtorsReport = async (req, res) => {
  try {
    const { facilityId, asAtDate } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const { debtorRows } = await fetchPartyBalancesByDrCr(
      facilityId,
      asAtDate || null,
    );

    const totalBalance = debtorRows.reduce(
      (sum, row) => sum + (parseFloat(row.balance || 0) || 0),
      0,
    );

    return res.json({
      success: true,
      data: {
        asAtDate: asAtDate || null,
        rows: debtorRows,
        totalBalance,
      },
    });
  } catch (error) {
    console.error("Debtors Report Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error generating debtors report",
      error: error.message,
    });
  }
};

/**
 * Single API: customers + suppliers split by ledger net.
 * Debtors / Receivables: net DR (SUM(dr)-SUM(cr) > 0).
 * Creditors / Payables: net CR (SUM(dr)-SUM(cr) < 0).
 */
exports.getDebtorsCreditorsCombinedReport = async (req, res) => {
  try {
    const { facilityId, asAtDate } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const asAt = asAtDate || null;
    const { debtorRows, creditorRows } = await fetchPartyBalancesByDrCr(
      facilityId,
      asAt,
    );

    const debtorsTotalBalance = debtorRows.reduce(
      (sum, row) => sum + (parseFloat(row.balance || 0) || 0),
      0,
    );
    const creditorsTotalBalance = creditorRows.reduce(
      (sum, row) => sum + (parseFloat(row.balance || 0) || 0),
      0,
    );

    return res.json({
      success: true,
      data: {
        asAtDate: asAt,
        debtors: {
          rows: debtorRows,
          totalBalance: debtorsTotalBalance,
          count: debtorRows.length,
        },
        creditors: {
          rows: creditorRows,
          totalBalance: creditorsTotalBalance,
          count: creditorRows.length,
        },
      },
    });
  } catch (error) {
    console.error("Debtors/Creditors combined report error:", error);
    return res.status(500).json({
      success: false,
      message: "Error generating debtors and creditors report",
      error: error.message,
    });
  }
};

// Get outstanding payable invoices for all suppliers (or one supplier)
exports.getOutstandingPayableInvoices = async (req, res) => {
  try {
    const { facilityId, supplierNo } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const supplierKey =
      supplierNo && String(supplierNo).trim()
        ? String(supplierNo).trim()
        : null;
    const supplierFilter = supplierKey ? "AND i.ref_number = :supplierNo" : "";
    const orderClause = supplierKey
      ? "i.transaction_date DESC"
      : "s.supplier_name ASC, i.transaction_date DESC";

    const query = `
      SELECT
        i.invoice_id,
        i.invoice_ref,
        i.ref_number,
        i.transaction_date,
        i.due_date,
        i.amount,
        i.description,
        COALESCE(s.supplier_name, i.ref_number) AS supplier_name,
        LEAST(GREATEST(COALESCE(payments.total_paid, 0), 0), i.amount) AS total_paid,
        GREATEST(i.amount - LEAST(GREATEST(COALESCE(payments.total_paid, 0), 0), i.amount), 0) AS amount_due,
        CASE
          WHEN LEAST(GREATEST(COALESCE(payments.total_paid, 0), 0), i.amount) >= i.amount THEN 'paid'
          WHEN GREATEST(COALESCE(payments.total_paid, 0), 0) > 0 THEN 'partially_paid'
          ELSE 'unpaid'
        END AS status
      FROM invoices i
      LEFT JOIN suppliersinfo s
        ON s.supplier_number = i.ref_number
        AND s.facilityId = i.facility_id
      LEFT JOIN (
        SELECT
          reference_number AS invoice_ref,
          facility_id,
          SUM(
            CASE
              WHEN type = 'bank' THEN cr
              WHEN type = 'payment' THEN dr
              ELSE 0
            END
          ) AS total_paid
        FROM general_ledger
        WHERE type IN ('bank', 'payment')
          AND facility_id = :facilityId
          AND reference_number IS NOT NULL
          AND reference_number != ''
        GROUP BY reference_number, facility_id
      ) payments
        ON payments.invoice_ref = i.invoice_ref
        AND payments.facility_id = i.facility_id
      WHERE i.type = 'purchase'
        AND i.facility_id = :facilityId
        ${supplierFilter}
      ORDER BY ${orderClause};
    `;

    const replacements = { facilityId };
    if (supplierKey) {
      replacements.supplierNo = supplierKey;
    }

    const rows = await db.sequelize.query(query, {
      replacements,
      type: QueryTypes.SELECT,
    });

    const outstanding = rows
      .map((row) => ({
        invoice_id: row.invoice_id,
        invoice_ref: row.invoice_ref,
        ref_number: row.ref_number,
        supplier_name: row.supplier_name || null,
        transaction_date: row.transaction_date,
        due_date: row.due_date,
        amount: parseFloat(row.amount || 0),
        description: row.description,
        total_paid: parseFloat(row.total_paid || 0),
        amount_due: parseFloat(row.amount_due || 0),
        balance_due: parseFloat(row.amount_due || 0),
        status: row.status,
      }))
      .filter((inv) => inv.amount_due > 0);

    return res.json({
      success: true,
      results: outstanding,
      count: outstanding.length,
    });
  } catch (error) {
    console.error("Outstanding Payable Invoices Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching outstanding payable invoices",
      error: error.message,
    });
  }
};

// Get Invoice Dashboard Summary
exports.getInvoiceDashboardSummary = async (req, res) => {
  try {
    const { facilityId, from, to } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Convert date format from DD-MM-YYYY to YYYY-MM-DD if needed
    const convertDate = (dateStr) => {
      if (!dateStr) return null;
      const parts = dateStr.split("-");
      if (parts.length === 3) {
        // Check if already in YYYY-MM-DD format
        if (parts[0].length === 4) {
          return dateStr;
        }
        // Convert from DD-MM-YYYY to YYYY-MM-DD
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
      return dateStr;
    };

    const today = new Date();
    const oneYearAgo = new Date(today);
    oneYearAgo.setFullYear(today.getFullYear() - 1);
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);

    // Use provided dates or fallback to default range
    const fromDate = from
      ? convertDate(from)
      : oneYearAgo.toISOString().split("T")[0];
    const toDate = to ? convertDate(to) : today.toISOString().split("T")[0];

    // Query for all invoices using the provided structure
    const allInvoicesQuery = `
      SELECT
        invoice_id,
        ref_number,
        invoice_ref,
        due_date,
        transaction_date,
        description,
        amount,
        created_by,
        facility_id,
        type,
        created_at,
        customerNo
      FROM invoices
      WHERE type = 'sales'
        AND facility_id = :facilityId
        AND DATE(transaction_date) BETWEEN DATE(:fromDate) AND DATE(:toDate)
      ORDER BY transaction_date DESC
    `;

    const allInvoices = await db.sequelize.query(allInvoicesQuery, {
      replacements: {
        facilityId,
        fromDate,
        toDate,
      },
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Query for payments from general_ledger
    const paymentsQuery = `
      SELECT
        reference_number AS invoice_ref,
        facility_id,
        SUM(dr) - SUM(cr) AS total_paid
      FROM general_ledger
      WHERE type IN ('bank', 'deposit')
        AND facility_id = :facilityId
        AND reference_number IS NOT NULL
        AND reference_number != ''
      GROUP BY reference_number, facility_id
    `;

    const payments = await db.sequelize.query(paymentsQuery, {
      replacements: { facilityId },
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Create a map for quick payment lookup
    const paymentMap = new Map();
    payments.forEach((payment) => {
      paymentMap.set(payment.invoice_ref, parseFloat(payment.total_paid || 0));
    });

    // Enrich invoices with payment data
    const enrichedInvoices = allInvoices.map((invoice) => {
      const totalPaid = paymentMap.get(invoice.invoice_ref) || 0;
      const amount = parseFloat(invoice.amount || 0);
      const amountDue = amount - totalPaid;
      let status = "unpaid";
      if (totalPaid >= amount) {
        status = "paid";
      } else if (totalPaid > 0) {
        status = "partially_paid";
      }

      return {
        ...invoice,
        total_paid: totalPaid,
        amount_due: amountDue,
        status: status,
      };
    });

    // Query for deposit status of paid invoices (last 30 days)
    const depositStatusQuery = `
      SELECT
        reference_number AS invoice_ref,
        facility_id,
        SUM(CASE WHEN type = 'bank' THEN dr - cr ELSE 0 END) AS deposited_amount,
        SUM(CASE WHEN type = 'deposit' THEN dr - cr ELSE 0 END) AS not_deposited_amount
      FROM general_ledger
      WHERE type IN ('bank', 'deposit')
        AND facility_id = :facilityId
        AND transaction_date >= :thirtyDaysAgo
        AND reference_number IS NOT NULL
        AND reference_number != ''
      GROUP BY reference_number, facility_id
    `;

    const depositStatuses = await db.sequelize.query(depositStatusQuery, {
      replacements: {
        facilityId,
        thirtyDaysAgo: thirtyDaysAgo.toISOString().split("T")[0],
      },
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Create a map for quick lookup
    const depositMap = new Map();
    depositStatuses.forEach((dep) => {
      depositMap.set(dep.invoice_ref, {
        deposited: parseFloat(dep.deposited_amount || 0),
        notDeposited: parseFloat(dep.not_deposited_amount || 0),
      });
    });

    // Separate sales and purchase invoices (all are sales based on query, but keeping structure)
    const salesInvoices = enrichedInvoices.filter(
      (inv) => inv.type === "sales",
    );
    const purchaseInvoices = []; // Empty since we're only querying sales invoices

    // Initialize counters
    let unpaidTotal = 0;
    let unpaidOverdue = 0;
    let unpaidNotDueYet = 0;
    let paidTotal = 0;
    let paidNotDeposited = 0;
    let paidDeposited = 0;

    // Process each invoice for INVOICES section breakdown
    enrichedInvoices.forEach((invoice) => {
      const amount = parseFloat(invoice.amount || 0);
      const totalPaid = parseFloat(invoice.total_paid || 0);
      const balanceDue = parseFloat(invoice.amount_due || 0);
      const dueDate = invoice.due_date ? new Date(invoice.due_date) : null;
      const paymentStatus = (invoice.status || "unpaid").toLowerCase().trim();
      const transactionDate = invoice.transaction_date
        ? new Date(invoice.transaction_date)
        : null;

      // Calculate days past due for overdue determination
      let daysPastDue = 0;
      if (dueDate) {
        daysPastDue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
      }
      const isOverdue = daysPastDue > 0;

      // Unpaid section (last 365 days - already filtered in query)
      if (balanceDue > 0) {
        unpaidTotal += balanceDue;

        if (isOverdue) {
          unpaidOverdue += balanceDue;
        } else {
          unpaidNotDueYet += balanceDue;
        }
      }

      // Paid section (last 30 days) - count invoices with payment status 'paid' or 'partially_paid' within last 30 days
      if (
        transactionDate &&
        transactionDate >= thirtyDaysAgo &&
        totalPaid > 0
      ) {
        paidTotal += totalPaid;

        // Check deposit status
        const depositInfo = depositMap.get(invoice.invoice_ref) || {
          deposited: 0,
          notDeposited: 0,
        };

        // If we have deposit info, use it; otherwise assume deposited if fully paid
        if (depositInfo.deposited > 0 || depositInfo.notDeposited > 0) {
          paidDeposited += depositInfo.deposited;
          paidNotDeposited += depositInfo.notDeposited;
        } else {
          // If fully paid but no deposit info, assume deposited
          if (paymentStatus === "paid") {
            paidDeposited += totalPaid;
          } else {
            // For partially paid without deposit info, split or assume not deposited
            paidNotDeposited += totalPaid;
          }
        }
      }
    });

    // Calculate breakdown by type - use amount for invoice totals
    const salesTotal = salesInvoices.reduce(
      (sum, inv) => sum + parseFloat(inv.amount || 0),
      0,
    );
    const purchasesTotal = purchaseInvoices.reduce(
      (sum, inv) => sum + parseFloat(inv.amount || 0),
      0,
    );

    // Calculate Accounts Payable from purchase invoices (outstanding amounts only)
    const accountsPayableTotal = purchaseInvoices
      .filter((inv) => parseFloat(inv.amount_due || 0) > 0)
      .reduce((sum, inv) => sum + parseFloat(inv.amount_due || 0), 0);

    // Calculate Accounts Receivable from sales invoices (outstanding amounts only)
    const accountsReceivableTotal = salesInvoices
      .filter((inv) => parseFloat(inv.amount_due || 0) > 0)
      .reduce((sum, inv) => sum + parseFloat(inv.amount_due || 0), 0);

    return res.status(200).json({
      success: true,
      results: {
        totalInvoices: enrichedInvoices.length,
        unpaid: {
          total: unpaidTotal,
          overdue: unpaidOverdue,
          notDueYet: unpaidNotDueYet,
        },
        paid: {
          total: paidTotal,
          notDeposited: paidNotDeposited,
          deposited: paidDeposited,
        },
        breakdown: {
          sales: salesTotal,
          purchases: purchasesTotal,
        },
        // Include invoice arrays for aging calculations
        salesInvoices: salesInvoices,
        purchaseInvoices: purchaseInvoices,
        // Include calculated totals for A/P and A/R
        accountsPayable: accountsPayableTotal,
        accountsReceivable: accountsReceivableTotal,
      },
    });
  } catch (error) {
    console.error("Error fetching invoice dashboard summary:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching invoice dashboard summary",
      error: error.message,
    });
  }
};

// Get Sales Invoices for Dashboard Chart
exports.getSalesInvoicesForChart = async (req, res) => {
  try {
    const { from, to, facilityId } = req.params;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Convert date format from DD-MM-YYYY to YYYY-MM-DD
    const convertDate = (dateStr) => {
      if (!dateStr) return null;
      const parts = dateStr.split("-");
      if (parts.length === 3) {
        // Check if already in YYYY-MM-DD format
        if (parts[0].length === 4) {
          return dateStr;
        }
        // Convert from DD-MM-YYYY to YYYY-MM-DD
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
      return dateStr;
    };

    const fromDate = convertDate(from);
    const toDate = convertDate(to);

    // Query sales invoices within date range
    const salesQuery = `
      SELECT
        invoice_id,
        ref_number,
        invoice_ref,
        due_date,
        transaction_date,
        description,
        amount,
        created_by,
        facility_id,
        type,
        created_at,
        customerNo
      FROM invoices
      WHERE type = 'sales'
        AND facility_id = :facilityId
        AND DATE(transaction_date) BETWEEN DATE(:fromDate) AND DATE(:toDate)
      ORDER BY transaction_date DESC
    `;

    const salesInvoices = await db.sequelize.query(salesQuery, {
      replacements: { facilityId, fromDate, toDate },
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Calculate total
    const totalAmount = salesInvoices.reduce(
      (sum, inv) => sum + parseFloat(inv.amount || 0),
      0,
    );

    // Format results for chart
    const results = salesInvoices.map((inv) => ({
      date: inv.transaction_date,
      description: inv.description || `Invoice ${inv.invoice_ref}`,
      amount: parseFloat(inv.amount || 0),
      invoice_ref: inv.invoice_ref,
      ref_number: inv.ref_number,
      customerNo: inv.customerNo,
    }));

    return res.status(200).json({
      success: true,
      results: results,
      data: results,
      total: totalAmount,
      count: salesInvoices.length,
    });
  } catch (error) {
    console.error("Error fetching sales invoices for chart:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching sales invoices",
      error: error.message,
    });
  }
};

// Get Accounts Payable Dashboard Summary
exports.getAccountsPayableDashboardSummary = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const today = new Date();

    // Query for Purchase Invoices with payment matching
    const purchaseInvoicesQuery = `
      SELECT
        i.invoice_id,
        i.invoice_ref,
        i.ref_number,
        i.transaction_date,
        i.due_date,
        i.amount,
        i.description,
        COALESCE(s.supplier_name, 'Unknown Supplier') AS supplier_name,
        COALESCE(payments.total_paid, 0) AS total_paid,
        (i.amount - COALESCE(payments.total_paid, 0)) AS amount_due,
        CASE
          WHEN COALESCE(payments.total_paid, 0) >= i.amount THEN 'Paid'
          WHEN COALESCE(payments.total_paid, 0) > 0 THEN 'Partially Paid'
          ELSE 'Unpaid'
        END AS status
      FROM invoices i
      LEFT JOIN suppliersinfo s
        ON s.supplier_number = i.ref_number
        AND s.facilityId = i.facility_id
      LEFT JOIN (
        SELECT
          reference_number AS transaction_ref,
          facility_id,
          SUM(
            CASE
              WHEN type = 'bank'    THEN cr
              WHEN type = 'payment' THEN dr
              ELSE 0
            END
          ) AS total_paid
        FROM general_ledger
        WHERE type IN ('bank', 'payment')
          AND facility_id = :facilityId
          AND reference_number IS NOT NULL
          AND reference_number != ''
        GROUP BY reference_number, facility_id
      ) payments
        ON payments.transaction_ref = i.invoice_ref
        AND payments.facility_id = i.facility_id
      WHERE i.type = 'purchase'
        AND i.facility_id = :facilityId
      ORDER BY i.transaction_date DESC
    `;

    const purchaseInvoices = await db.sequelize.query(purchaseInvoicesQuery, {
      replacements: { facilityId },
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Calculate totals and breakdown
    let totalPayable = 0;
    let unpaid = 0;
    let partiallyPaid = 0;
    let overdue = 0;

    // Calculate aging buckets
    const aging = {
      current: 0,
      days1to30: 0,
      days31to60: 0,
      days61to90: 0,
      days91Plus: 0,
    };

    purchaseInvoices.forEach((invoice) => {
      const amountDue = parseFloat(invoice.amount_due || 0);
      if (amountDue <= 0) return; // Skip paid invoices

      totalPayable += amountDue;
      const paymentStatus = (invoice.status || "unpaid").toLowerCase().trim();

      // Status breakdown - only count outstanding amounts
      if (paymentStatus === "unpaid") {
        unpaid += amountDue;
      } else if (
        paymentStatus === "partially paid" ||
        paymentStatus === "partial"
      ) {
        partiallyPaid += amountDue;
      }

      // Aging calculation based on days past due_date
      const dueDate = invoice.due_date ? new Date(invoice.due_date) : null;
      if (dueDate) {
        const daysPastDue = Math.floor(
          (today - dueDate) / (1000 * 60 * 60 * 24),
        );

        // CURRENT: Not overdue (daysPastDue <= 0)
        if (daysPastDue <= 0) {
          aging.current += amountDue;
        }
        // 1-30 DAYS: 1 to 30 days overdue
        else if (daysPastDue >= 1 && daysPastDue <= 30) {
          aging.days1to30 += amountDue;
        }
        // 31-60 DAYS: 31 to 60 days overdue
        else if (daysPastDue >= 31 && daysPastDue <= 60) {
          aging.days31to60 += amountDue;
        }
        // 61-90 DAYS: 61 to 90 days overdue
        else if (daysPastDue >= 61 && daysPastDue <= 90) {
          aging.days61to90 += amountDue;
        }
        // 90+ DAYS: More than 90 days overdue
        else {
          aging.days91Plus += amountDue;
        }

        // Overdue calculation (60+ days past due)
        if (daysPastDue > 60) {
          overdue += amountDue;
        }
      } else {
        // If no due_date, treat as current (not overdue)
        aging.current += amountDue;
      }
    });

    return res.status(200).json({
      success: true,
      results: {
        totalPayable,
        breakdown: {
          unpaid,
          partiallyPaid,
          overdue,
        },
        aging,
        invoices: purchaseInvoices,
      },
    });
  } catch (error) {
    console.error("Error fetching accounts payable dashboard summary:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching accounts payable dashboard summary",
      error: error.message,
    });
  }
};

// Get Accounts Receivable Dashboard Summary
exports.getAccountsReceivableDashboardSummary = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const today = new Date();

    // Query for Sales Invoices with payment matching
    const salesInvoicesQuery = `
      SELECT
        i.invoice_id,
        i.invoice_ref,
        i.ref_number,
        i.transaction_date,
        i.due_date,
        i.amount,
        i.description,
        i.created_by,
        COALESCE(se_tot.total_paid, 0) AS total_paid,
        (i.amount - COALESCE(se_tot.total_paid, 0)) AS amount_due,
        CASE
          WHEN COALESCE(se_tot.total_paid, 0) >= i.amount THEN 'paid'
          WHEN COALESCE(se_tot.total_paid, 0) > 0 THEN 'partially_paid'
          ELSE 'unpaid'
        END AS status
      FROM invoices i
      LEFT JOIN (
        SELECT
          reference_number AS invoice_ref,
          facility_id,
          SUM(dr) - SUM(cr) AS total_paid
        FROM general_ledger
        WHERE type IN ('bank', 'deposit')
          AND facility_id = :facilityId
          AND reference_number IS NOT NULL
          AND reference_number != ''
        GROUP BY reference_number, facility_id
      ) se_tot
        ON se_tot.invoice_ref = i.invoice_ref
        AND se_tot.facility_id = i.facility_id
      WHERE i.type = 'sales'
        AND i.facility_id = :facilityId
      ORDER BY i.transaction_date DESC
    `;

    const salesInvoices = await db.sequelize.query(salesInvoicesQuery, {
      replacements: { facilityId },
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Calculate totals and breakdown
    let totalReceivable = 0;
    let unpaid = 0;
    let partiallyPaid = 0;
    let overdue = 0;

    // Calculate aging buckets
    const aging = {
      current: 0,
      days1to30: 0,
      days31to60: 0,
      days61to90: 0,
      days91Plus: 0,
    };

    salesInvoices.forEach((invoice) => {
      const amountDue = parseFloat(invoice.amount_due || 0);
      if (amountDue <= 0) return; // Skip fully paid invoices

      totalReceivable += amountDue;
      const paymentStatus = (invoice.status || "unpaid").toLowerCase();

      // Status breakdown - only count outstanding amounts
      if (paymentStatus === "unpaid") {
        unpaid += amountDue;
      } else if (
        paymentStatus === "partially_paid" ||
        paymentStatus === "partial"
      ) {
        partiallyPaid += amountDue;
      }

      // Aging calculation based on days past due_date
      const dueDate = invoice.due_date ? new Date(invoice.due_date) : null;
      if (dueDate) {
        const daysPastDue = Math.floor(
          (today - dueDate) / (1000 * 60 * 60 * 24),
        );

        // CURRENT: Not overdue (daysPastDue <= 0)
        if (daysPastDue <= 0) {
          aging.current += amountDue;
        }
        // 1-30 DAYS: 1 to 30 days overdue
        else if (daysPastDue >= 1 && daysPastDue <= 30) {
          aging.days1to30 += amountDue;
        }
        // 31-60 DAYS: 31 to 60 days overdue
        else if (daysPastDue >= 31 && daysPastDue <= 60) {
          aging.days31to60 += amountDue;
        }
        // 61-90 DAYS: 61 to 90 days overdue
        else if (daysPastDue >= 61 && daysPastDue <= 90) {
          aging.days61to90 += amountDue;
        }
        // 90+ DAYS: More than 90 days overdue
        else {
          aging.days91Plus += amountDue;
        }

        // Overdue calculation (60+ days past due)
        if (daysPastDue > 60) {
          overdue += amountDue;
        }
      } else {
        // If no due_date, treat as current (not overdue)
        aging.current += amountDue;
      }
    });

    return res.status(200).json({
      success: true,
      results: {
        totalReceivable,
        breakdown: {
          unpaid,
          partiallyPaid,
          overdue,
        },
        aging,
        invoices: salesInvoices,
      },
    });
  } catch (error) {
    console.error(
      "Error fetching accounts receivable dashboard summary:",
      error,
    );
    return res.status(500).json({
      success: false,
      message: "Error fetching accounts receivable dashboard summary",
      error: error.message,
    });
  }
};

// Helper: Extract parent head group
function getHeadGroupName(head) {
  const map = {
    1: "Cash and cash equivalents",
    10: "Owner's Equity",
    13: "Expenses",
    3: "Current assets",
    6: "Accounts Payable (A/P)",
  };
  return map[head] || `Group ${head}`;
}

function formatTransactionType(type) {
  const map = {
    opening_balance: "Opening Balance",
    expenses: "Expense",
    payment: "Payment",
    inventory: "Inventory",
    payable: "Payable",
    bank: "Bank",
  };
  return map[type] || type.charAt(0).toUpperCase() + type.slice(1);
}

/**
 * Get Expenses by Category for Dashboard
 * Fetches expense transactions from general_ledger joined with account_category
 * Groups by expense category/type
 */
exports.getExpensesByCategory = async (req, res) => {
  try {
    const { from, to, facilityId } = req.params;

    // Convert DD-MM-YYYY to YYYY-MM-DD if needed
    const convertDate = (dateStr) => {
      if (!dateStr) return null;
      // Check if it's in DD-MM-YYYY format
      if (dateStr.match(/^\d{2}-\d{2}-\d{4}$/)) {
        const [day, month, year] = dateStr.split("-");
        return `${year}-${month}-${day}`;
      }
      return dateStr;
    };

    const fromDate =
      convertDate(from) || moment().subtract(1, "year").format("YYYY-MM-DD");
    const toDate = convertDate(to) || moment().format("YYYY-MM-DD");

    // Query expenses from general_ledger where type = 'expenses'
    // Group by account_description to show individual expense items
    const expensesQuery = `
      SELECT
        gl.account_code,
        gl.account_description,
        gl.transaction_date,
        gl.dr AS debit,
        gl.cr AS credit,
        gl.type AS transaction_type,
        gl.transaction_description,
        COALESCE(ac.description, gl.account_description, 'Other Expenses') AS category_name,
        COALESCE(ac.description, gl.account_description, 'Other') AS account_name
      FROM general_ledger gl
      LEFT JOIN account_category ac ON gl.account_code = ac.code AND ac.facility_id = ?
      WHERE gl.facility_id = ?
        AND DATE(gl.transaction_date) BETWEEN DATE(?) AND DATE(?)
        AND gl.type = 'expenses'
      ORDER BY gl.transaction_date DESC
    `;

    const expenses = await db.sequelize.query(expensesQuery, {
      replacements: [facilityId, facilityId, fromDate, toDate],
      type: QueryTypes.SELECT,
    });

    // expenses is an array of results
    const expenseRows = Array.isArray(expenses) ? expenses : [];

    // Group expenses by category
    const categoryMap = {};
    const colors = [
      "#3b82f6", // blue
      "#14b8a6", // teal
      "#ef4444", // red
      "#f97316", // orange
      "#8b5cf6", // purple
      "#ec4899", // pink
      "#10b981", // emerald
      "#f59e0b", // amber
      "#6366f1", // indigo
      "#84cc16", // lime
    ];
    let colorIndex = 0;

    let totalExpenses = 0;

    expenseRows.forEach((expense) => {
      const categoryKey =
        expense.category_name || expense.account_name || "Other Expenses";
      const amount =
        parseFloat(expense.debit || 0) - parseFloat(expense.credit || 0);

      // Only count positive expense amounts (debits exceed credits)
      if (amount > 0) {
        totalExpenses += amount;

        if (!categoryMap[categoryKey]) {
          categoryMap[categoryKey] = {
            name: categoryKey,
            amount: 0,
            color: colors[colorIndex % colors.length],
            code: expense.account_code,
            transactions: [],
          };
          colorIndex++;
        }
        categoryMap[categoryKey].amount += amount;
        categoryMap[categoryKey].transactions.push({
          date: expense.transaction_date,
          description: expense.transaction_description,
          amount: amount,
        });
      }
    });

    // Convert to array and sort by amount
    const categorizedExpenses = Object.values(categoryMap)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10); // Top 10 categories

    return res.status(200).json({
      success: true,
      total: totalExpenses,
      categories: categorizedExpenses,
      results: expenseRows,
    });
  } catch (error) {
    console.error("Error fetching expenses by category:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching expenses by category",
      error: error.message,
    });
  }
};

/**
 * Get Cash Flow Dashboard Data
 * Fetches bank transactions from general_ledger where type='bank'
 * Calculates monthly balance, projected balance, and current balance
 */
exports.getCashFlowDashboard = async (req, res) => {
  try {
    const { facilityId } = req.params;
    const { from, to } = req.query;

    // Convert DD-MM-YYYY to YYYY-MM-DD if needed
    const convertDate = (dateStr) => {
      if (!dateStr) return null;
      if (dateStr.match(/^\d{2}-\d{2}-\d{4}$/)) {
        const [day, month, year] = dateStr.split("-");
        return `${year}-${month}-${day}`;
      }
      return dateStr;
    };

    // Default to last 12 months
    const fromDate =
      convertDate(from) || moment().subtract(12, "months").format("YYYY-MM-DD");
    const toDate = convertDate(to) || moment().format("YYYY-MM-DD");

    // Query all bank transactions (type='bank') for cash flow
    const bankTransactionsQuery = `
      SELECT
        gl.transaction_id,
        gl.transaction_date,
        gl.account_code,
        gl.account_description,
        gl.dr AS debit,
        gl.cr AS credit,
        gl.transaction_description,
        gl.reference_number,
        gl.mode_of_payment,
        gl.bank_account_id,
        DATE_FORMAT(gl.transaction_date, '%Y-%m') AS month_key,
        DATE_FORMAT(gl.transaction_date, '%b %Y') AS month_label
      FROM general_ledger gl
      WHERE gl.facility_id = ?
        AND gl.type = 'bank'
        AND DATE(gl.transaction_date) BETWEEN DATE(?) AND DATE(?)
      ORDER BY gl.transaction_date ASC
    `;

    const bankTransactions = await db.sequelize.query(bankTransactionsQuery, {
      replacements: [facilityId, fromDate, toDate],
      type: QueryTypes.SELECT,
    });

    // bankTransactions is an array of results
    const bankTxnRows = Array.isArray(bankTransactions) ? bankTransactions : [];

    // Query current bank balance (all bank transactions up to today)
    const currentBalanceQuery = `
      SELECT
        COALESCE(SUM(gl.dr), 0) - COALESCE(SUM(gl.cr), 0) AS current_balance
      FROM general_ledger gl
      WHERE gl.facility_id = ?
        AND gl.type = 'bank'
        AND DATE(gl.transaction_date) <= CURDATE()
    `;

    const balanceResults = await db.sequelize.query(currentBalanceQuery, {
      replacements: [facilityId],
      type: QueryTypes.SELECT,
    });

    // balanceResults is an array with one row
    const balanceRow =
      Array.isArray(balanceResults) && balanceResults.length > 0
        ? balanceResults[0]
        : {};
    const currentBalance = parseFloat(balanceRow?.current_balance || 0);

    // Group by month and calculate running balance
    const monthlyData = {};
    let runningBalance = 0;

    bankTxnRows.forEach((txn) => {
      const monthKey = txn.month_key;
      const monthLabel = txn.month_label;
      const netAmount =
        parseFloat(txn.debit || 0) - parseFloat(txn.credit || 0);

      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = {
          month: monthLabel,
          monthKey: monthKey,
          inflow: 0,
          outflow: 0,
          netChange: 0,
          balance: 0,
        };
      }

      if (netAmount > 0) {
        monthlyData[monthKey].inflow += netAmount;
      } else {
        monthlyData[monthKey].outflow += Math.abs(netAmount);
      }
      monthlyData[monthKey].netChange += netAmount;
    });

    // Convert to array and calculate running balance
    const sortedMonths = Object.keys(monthlyData).sort();
    const monthlyBalance = sortedMonths.map((monthKey, index) => {
      if (index === 0) {
        // For first month, estimate opening balance
        runningBalance = currentBalance;
        // Work backwards to get approximate opening balance
        for (let i = sortedMonths.length - 1; i >= 0; i--) {
          runningBalance -= monthlyData[sortedMonths[i]].netChange;
        }
      }
      runningBalance += monthlyData[monthKey].netChange;
      return {
        month: monthlyData[monthKey].month,
        monthKey: monthKey,
        inflow: monthlyData[monthKey].inflow,
        outflow: monthlyData[monthKey].outflow,
        netChange: monthlyData[monthKey].netChange,
        balance: runningBalance,
      };
    });

    // Calculate projected balance (simple projection for next 3 months)
    const avgNetChange =
      monthlyBalance.length > 0
        ? monthlyBalance.reduce((sum, m) => sum + m.netChange, 0) /
          monthlyBalance.length
        : 0;

    const projectedBalance = [];
    let projectedRunningBalance = currentBalance;

    for (let i = 1; i <= 3; i++) {
      const projectedMonth = moment().add(i, "months");
      projectedRunningBalance += avgNetChange;
      projectedBalance.push({
        month: projectedMonth.format("MMM YYYY"),
        monthKey: projectedMonth.format("YYYY-MM"),
        balance: projectedRunningBalance,
        projected: true,
      });
    }

    // Calculate threshold (1.5x average monthly outflow)
    const avgMonthlyOutflow =
      monthlyBalance.length > 0
        ? monthlyBalance.reduce((sum, m) => sum + m.outflow, 0) /
          monthlyBalance.length
        : 0;
    const threshold = avgMonthlyOutflow * 1.5;

    // Calculate totals
    const totalInflow = monthlyBalance.reduce((sum, m) => sum + m.inflow, 0);
    const totalOutflow = monthlyBalance.reduce((sum, m) => sum + m.outflow, 0);

    return res.status(200).json({
      success: true,
      results: {
        currentBalance: currentBalance,
        totalInflow: totalInflow,
        totalOutflow: totalOutflow,
        threshold: threshold,
        monthlyBalance: monthlyBalance,
        projectedBalance: projectedBalance,
        transactions: bankTxnRows,
      },
    });
  } catch (error) {
    console.error("Error fetching cash flow dashboard:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching cash flow dashboard",
      error: error.message,
    });
  }
};

// ===================== SAVED REPORTS =====================

exports.saveAccountReport = async (req, res) => {
  try {
    const {
      report_name,
      account_codes,
      from_date,
      to_date,
      facility_id,
      created_by,
      only_children,
      report_type,
      summary_presentation,
    } = req.body;

    if (!report_name || !account_codes || !facility_id) {
      return res.status(400).json({
        success: false,
        message: "report_name, account_codes, and facility_id are required",
      });
    }

    const report = await db.SavedReport.create({
      report_name,
      account_codes,
      from_date: from_date || null,
      to_date: to_date || null,
      facility_id,
      created_by,
      only_children: Boolean(only_children),
      report_type: report_type === "summary" ? "summary" : "full",
      summary_presentation:
        report_type === "summary" && summary_presentation
          ? String(summary_presentation)
          : null,
    });

    return res.json({ success: true, message: "Report saved", result: report });
  } catch (error) {
    console.error("Error saving report:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getSavedReports = async (req, res) => {
  try {
    const { facilityId } = req.params;
    if (!facilityId) {
      return res
        .status(400)
        .json({ success: false, message: "facilityId is required" });
    }

    const reports = await db.SavedReport.findAll({
      where: { facility_id: facilityId },
      order: [["created_at", "DESC"]],
    });

    return res.json({ success: true, results: reports });
  } catch (error) {
    console.error("Error fetching saved reports:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteSavedReport = async (req, res) => {
  try {
    const { id, facilityId } = req.params;
    await db.SavedReport.destroy({ where: { id, facility_id: facilityId } });
    return res.json({ success: true, message: "Report deleted" });
  } catch (error) {
    console.error("Error deleting saved report:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAccountLedgerReport = async (req, res) => {
  try {
    const { facilityId, fromDate, toDate, accountCodes } = req.body;

    if (
      !facilityId ||
      !fromDate ||
      !toDate ||
      !accountCodes ||
      !accountCodes.length
    ) {
      return res.status(400).json({
        success: false,
        message: "facilityId, fromDate, toDate, and accountCodes are required",
      });
    }

    const fromDateStr = moment(fromDate).format("YYYY-MM-DD");
    const toDateStr = moment(toDate).format("YYYY-MM-DD");
    const { Op } = db.Sequelize;
    const selectedCodes = Array.from(
      new Set(
        (accountCodes || []).map((c) => String(c || "").trim()).filter(Boolean),
      ),
    );

    // Expand selected codes to include all descendants in AccountCategory.
    const allFacilityAccounts = await db.AccountCategory.findAll({
      where: { facilityId },
      attributes: [
        "code",
        "parentCode",
        "description",
        "category",
        "accountNature",
      ],
      raw: true,
    });
    const accountMetaByCode = new Map();
    const childrenByParent = new Map();
    allFacilityAccounts.forEach((acc) => {
      const parent = String(acc.parent_code || acc.parentCode || "").trim();
      const code = String(acc.code || "").trim();
      if (!code) return;
      accountMetaByCode.set(code, {
        code,
        parent_code: parent || null,
        description: acc.description || acc.category || code,
        account_nature: acc.account_nature || acc.accountNature || null,
      });
      if (!parent) return;
      if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
      childrenByParent.get(parent).push(code);
    });
    const expandedCodes = new Set(selectedCodes);
    const queue = [...selectedCodes];
    while (queue.length > 0) {
      const current = queue.shift();
      const children = childrenByParent.get(String(current).trim()) || [];
      children.forEach((childCode) => {
        if (!expandedCodes.has(childCode)) {
          expandedCodes.add(childCode);
          queue.push(childCode);
        }
      });
    }
    const accountCodesForQuery = Array.from(expandedCodes);

    // Query account_category for account details
    const accounts = await db.AccountCategory.findAll({
      where: { code: { [Op.in]: accountCodesForQuery }, facilityId },
      order: [["code", "ASC"]],
      raw: true,
    });

    // Also try the legacy chart_of_account / sfp table if some codes are missing
    const foundCodes = new Set(accounts.map((a) => String(a.code)));
    const missingCodes = accountCodesForQuery.filter(
      (c) => !foundCodes.has(String(c)),
    );

    if (missingCodes.length > 0) {
      // Try to find missing accounts from the general_ledger descriptions
      const legacyAccounts = await db.GeneralLedger.findAll({
        where: {
          account_code: { [Op.in]: missingCodes },
          facility_id: facilityId,
        },
        attributes: [
          "account_code",
          [
            db.sequelize.fn("MAX", db.sequelize.col("account_description")),
            "description",
          ],
        ],
        group: ["account_code"],
        raw: true,
      });

      legacyAccounts.forEach((la) => {
        if (!foundCodes.has(String(la.account_code))) {
          accounts.push({
            code: la.account_code,
            description: la.description || la.account_code,
            accountNature: null,
          });
          foundCodes.add(String(la.account_code));
        }
      });

      // For any still missing, add a placeholder so they appear in the report
      missingCodes.forEach((code) => {
        if (!foundCodes.has(String(code))) {
          accounts.push({
            code,
            description: code,
            accountNature: null,
          });
        }
      });
    }

    // Sort accounts by the order they were requested
    const codeOrder = {};
    accountCodesForQuery.forEach((c, i) => {
      codeOrder[String(c)] = i;
    });
    accounts.sort(
      (a, b) =>
        (codeOrder[String(a.code)] ?? 999) - (codeOrder[String(b.code)] ?? 999),
    );

    const [transactions, openingBalances] = await Promise.all([
      db.GeneralLedger.findAll({
        where: {
          account_code: { [Op.in]: accountCodesForQuery },
          facility_id: facilityId,
          transaction_date: { [Op.between]: [fromDateStr, toDateStr] },
        },
        order: [
          ["account_code", "ASC"],
          ["transaction_date", "ASC"],
        ],
        raw: true,
      }),
      db.GeneralLedger.findAll({
        where: {
          account_code: { [Op.in]: accountCodesForQuery },
          facility_id: facilityId,
          transaction_date: { [Op.lt]: fromDateStr },
        },
        attributes: [
          "account_code",
          [db.sequelize.fn("SUM", db.sequelize.col("dr")), "total_dr"],
          [db.sequelize.fn("SUM", db.sequelize.col("cr")), "total_cr"],
        ],
        group: ["account_code"],
        raw: true,
      }),
    ]);

    const openingMap = {};
    openingBalances.forEach((ob) => {
      const code = String(ob.account_code);
      const nature = resolveAccountNature(
        accountMetaByCode.get(code)?.account_nature ||
          accounts.find((a) => String(a.code) === code)?.accountNature ||
          accounts.find((a) => String(a.code) === code)?.account_nature,
        code,
      );
      openingMap[code] = signedBalance(
        nature,
        ob.total_dr,
        ob.total_cr,
      );
    });

    const result = accounts.map((acc) => {
      const code = String(acc.code);
      const nature = resolveAccountNature(
        acc.accountNature ||
          acc.account_nature ||
          accountMetaByCode.get(code)?.account_nature,
        code,
      );
      const accTxns = transactions.filter(
        (t) => String(t.account_code) === code,
      );
      const openingBalance = openingMap[code] || 0;

      let runningBalance = openingBalance;
      const rows = accTxns.map((t) => {
        runningBalance += signedMovement(nature, t.dr, t.cr);
        return { ...t, running_balance: runningBalance };
      });

      const totalDr = accTxns.reduce((s, t) => s + parseFloat(t.dr || 0), 0);
      const totalCr = accTxns.reduce((s, t) => s + parseFloat(t.cr || 0), 0);

      return {
        account_code: code,
        description: acc.description || acc.category || code,
        account_nature: nature,
        opening_balance: openingBalance,
        closing_balance: Number(
          (openingBalance + signedMovement(nature, totalDr, totalCr)).toFixed(
            4,
          ),
        ),
        total_debit: totalDr,
        total_credit: totalCr,
        transactions: rows,
      };
    });

    return res.json({
      success: true,
      results: result,
      meta: {
        requested_codes: selectedCodes,
        fetched_codes: accountCodesForQuery,
        requested_accounts: selectedCodes.map((code) => {
          const meta = accountMetaByCode.get(String(code));
          return {
            code: String(code),
            description: meta?.description || String(code),
            parent_code: meta?.parent_code || null,
          };
        }),
        fetched_accounts: accountCodesForQuery.map((code) => {
          const match = accounts.find((a) => String(a.code) === String(code));
          const meta = accountMetaByCode.get(String(code));
          return {
            code: String(code),
            description:
              match?.description || meta?.description || String(code),
            parent_code: match?.parent_code || meta?.parent_code || null,
          };
        }),
        includes_child_codes:
          accountCodesForQuery.length > selectedCodes.length,
      },
    });
  } catch (error) {
    console.error("Error generating account ledger report:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getFinancialDashboardOverview = async (req, res) => {
  try {
    const { facilityId, from, to, asOf } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const convertDate = (dateStr) => {
      if (!dateStr) return null;
      const parts = dateStr.split("-");
      if (parts.length === 3) {
        if (parts[0].length === 4) return dateStr;
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
      return dateStr;
    };

    const today = asOf
      ? moment(convertDate(asOf), "YYYY-MM-DD").toDate()
      : new Date();
    const { fromDate: last30From, toDate: last30To } =
      getDateRangeLast30Days(today);

    const overview = await buildFinancialDashboardOverview(db.sequelize, {
      facilityId,
      from,
      to,
    });

    const salesInvoices = await fetchEnrichedSalesInvoices(
      db.sequelize,
      facilityId,
    );
    const receivableMetrics = aggregateReceivableMetrics(salesInvoices, today);
    const paidLast30Days = await sumPaymentsReceivedInPeriod(
      db.sequelize,
      facilityId,
      last30From,
      last30To,
    );

    const purchaseInvoices = await db.sequelize.query(
      `
        SELECT
          i.amount,
          COALESCE(payments.total_paid, 0) AS total_paid,
          (i.amount - COALESCE(payments.total_paid, 0)) AS amount_due,
          i.due_date
        FROM invoices i
        LEFT JOIN (
          SELECT
            reference_number AS transaction_ref,
            facility_id,
            SUM(
              CASE
                WHEN type = 'bank' THEN cr
                WHEN type = 'payment' THEN dr
                ELSE 0
              END
            ) AS total_paid
          FROM general_ledger
          WHERE type IN ('bank', 'payment')
            AND facility_id = :facilityId
            AND reference_number IS NOT NULL
            AND reference_number != ''
          GROUP BY reference_number, facility_id
        ) payments
          ON payments.transaction_ref = i.invoice_ref
          AND payments.facility_id = i.facility_id
        WHERE i.type = 'purchase'
          AND i.facility_id = :facilityId
      `,
      {
        replacements: { facilityId },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );

    let billsUnpaid = 0;
    let billsOverdue = 0;
    purchaseInvoices.forEach((invoice) => {
      const amountDue = parseFloat(invoice.amount_due || 0);
      if (amountDue <= 0) return;
      billsUnpaid += amountDue;
      const dueDate = invoice.due_date
        ? startOfLocalDay(invoice.due_date)
        : null;
      if (dueDate && startOfLocalDay(today) > dueDate) {
        billsOverdue += amountDue;
      }
    });

    const billsPaidLast30 = await db.sequelize.query(
      `
        SELECT COALESCE(SUM(gl.cr), 0) AS total_paid
        FROM general_ledger gl
        INNER JOIN invoices i
          ON i.invoice_ref = gl.reference_number
          AND i.facility_id = gl.facility_id
          AND i.type = 'purchase'
        WHERE gl.facility_id = :facilityId
          AND LOWER(gl.type) IN ('bank', 'payment')
          AND gl.cr > 0
          AND DATE(gl.transaction_date) BETWEEN DATE(:fromDate) AND DATE(:toDate)
      `,
      {
        replacements: { facilityId, fromDate: last30From, toDate: last30To },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );

    overview.invoicesSummary = {
      notDueYet: receivableMetrics.notDueYet,
      overdue: receivableMetrics.overdue,
      totalOutstanding: receivableMetrics.totalReceivable,
      paidLast30Days,
      asOfDate: getLocalDateStr(today),
    };

    overview.billsToPay = {
      unpaid: billsUnpaid,
      overdue: billsOverdue,
      notDueYet: Math.max(0, billsUnpaid - billsOverdue),
      paidLast30Days: parseFloat(billsPaidLast30[0]?.total_paid || 0),
      asOfDate: getLocalDateStr(today),
    };

    return res.status(200).json({
      success: true,
      results: overview,
    });
  } catch (error) {
    console.error("Error fetching financial dashboard overview:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching financial dashboard overview",
      error: error.message,
    });
  }
};
