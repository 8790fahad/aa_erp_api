const db = require("../models");
const moment = require("moment");
const { QueryTypes, Op } = require("sequelize");
const {
  signedBalance,
  resolveAccountNature,
} = require("../utils/accountBalance");

/** SOFP: treat Assets = Liabilities + Equity as balanced if |difference| ≤ this (₦). Warn only above. */
const SOFP_BALANCE_TOLERANCE_NAIRA = 10;

/**
 * Comprehensive Accounting Reports Controller
 * Implements IFRS-compliant financial reports and Nigerian tax compliance
 */

function getParentCodeFromRow(row) {
  if (!row) return "";
  if (row.parent_code != null) return String(row.parent_code).trim();
  if (row.parentCode != null) return String(row.parentCode).trim();
  return "";
}

/**
 * AaErp CoA (account_category): digits 1–9, then 01–99 per level (101 → 10101 → 1010102).
 * Parent links come from account_category.parent_code (e.g. 10101→101, 101→1); 10107 may attach
 * directly under 101 per CoA, not only via segment chop.
 */

/**
 * Resolve the 3-digit head for BS classification: walk account_category.parent_code when the row
 * exists; otherwise AaErp segment (strip two digits). Does not require the parent row to be
 * present in rowsByCode (missing heads still resolve via parent_code on the child row).
 */
function balanceSheetHead3(accountCode, rowsByCode) {
  const sc = String(accountCode || "").trim();
  if (!sc || !/^\d+$/.test(sc)) return sc;
  let cur = sc;
  let guard = 0;
  while (cur.length > 3 && guard++ < 24) {
    const row = rowsByCode && rowsByCode.get(cur);
    let p = getParentCodeFromRow(row);
    if (!p || p === "0" || p === cur) {
      p = getSegmentParentCode(cur);
    }
    if (!p) break;
    cur = p;
  }
  while (cur.length > 3) {
    cur = cur.slice(0, -2);
  }
  return cur;
}

/**
 * Current vs non-current from 3-digit asset head (code-only; aligns with 101–103 current, 104 fixed, etc.).
 */
function classifyAssetFromHead(head3) {
  const n = parseInt(String(head3), 10);
  if (Number.isNaN(n)) return "Current";
  if (n >= 101 && n <= 103) return "Current";
  if (n === 104) return "Non-Current";
  if (n >= 105 && n <= 149) return "Current";
  if (n >= 150 && n <= 199) return "Non-Current";
  return "Current";
}

/**
 * Current vs long-term from 3-digit liability head (202 = non-current per CoA; 250+ long-term).
 */
function classifyLiabilityFromHead(head3) {
  const n = parseInt(String(head3), 10);
  if (Number.isNaN(n)) return "Current";
  if (n === 202) return "Non-Current";
  if (n >= 200 && n <= 249) return "Current";
  if (n >= 250 && n <= 299) return "Non-Current";
  return "Current";
}

function applyAssetClassification(rows) {
  const list = rows || [];
  const byCode = new Map(
    list.map((r) => [String(r.account_code || "").trim(), r])
  );
  for (const r of list) {
    const head = balanceSheetHead3(r.account_code, byCode);
    r.classification = classifyAssetFromHead(head);
  }
}

function applyLiabilityClassification(rows) {
  const list = rows || [];
  const byCode = new Map(
    list.map((r) => [String(r.account_code || "").trim(), r])
  );
  for (const r of list) {
    const head = balanceSheetHead3(r.account_code, byCode);
    r.classification = classifyLiabilityFromHead(head);
  }
}

/**
 * Core balance sheet data from general_ledger + account_category (single as-of date).
 * Balancing rules: ASSET = Dr−Cr; LIABILITY/EQUITY = Cr−Dr. (Revenue = Cr−Dr on P&L.)
 * BS sections use account_nature (ASSET / LIABILITY / EQUITY) so AaErp CoAs that put
 * liabilities under 9xxxx (not 2xxxx) still balance. No GL status filter — all postings count.
 * Current / non-current uses parent_code + segment head (balanceSheetHead3).
 * @param {{ includeZeroHeadAccounts?: boolean }} [options] — When true (SOFP only), include chart
 *   codes with zero balance when they are valid AaErp heads (odd length: 1,3,5,7…) so parents
 *   like 10101 appear under 101 (10101 → 1010101 chain). Non-zero detection uses ABS(net) so
 *   asset accounts with credit/overdraft balances (e.g. cash 10107) are not dropped.
 */
async function fetchBalanceSheetRows(facilityId, asOfDate, options = {}) {
  const includeZeroHeadAccounts = Boolean(options.includeZeroHeadAccounts);

  const sofpZeroBalanceShapeAssets = `(
    ABS(COALESCE(SUM(gl.dr - gl.cr), 0)) > 0.005
    OR LENGTH(TRIM(ac.code)) = 1
    OR (LENGTH(TRIM(ac.code)) >= 3 AND MOD(LENGTH(TRIM(ac.code)), 2) = 1)
  )`;

  const sofpZeroBalanceShapeCrNormal = `(
    ABS(COALESCE(SUM(gl.cr - gl.dr), 0)) > 0.005
    OR LENGTH(TRIM(ac.code)) = 1
    OR (LENGTH(TRIM(ac.code)) >= 3 AND MOD(LENGTH(TRIM(ac.code)), 2) = 1)
  )`;

  const assetHaving = includeZeroHeadAccounts
    ? `HAVING ${sofpZeroBalanceShapeAssets}`
    : `HAVING ABS(COALESCE(SUM(gl.dr - gl.cr), 0)) > 0.005`;

  const liabilityHaving = includeZeroHeadAccounts
    ? `HAVING ${sofpZeroBalanceShapeCrNormal}`
    : `HAVING ABS(COALESCE(SUM(gl.cr - gl.dr), 0)) > 0.005`;

  const equityHaving = includeZeroHeadAccounts
    ? `HAVING ${sofpZeroBalanceShapeCrNormal}`
    : `HAVING ABS(COALESCE(SUM(gl.cr - gl.dr), 0)) > 0.005`;

  // Exclude balance_switch accounts from digit-based buckets; they are
  // classified by closing net sign (debit → asset, credit → liability).
  const excludeBalanceSwitch = `AND COALESCE(ac.reporting_behavior, 'fixed') != 'balance_switch'`;

  const assetsQuery = `
    SELECT
      ac.code            AS account_code,
      ac.description     AS account_name,
      ac.category,
      COALESCE(ac.type, ac.category) AS type,
      ac.level           AS level,
      ac.parent_code     AS parent_code,
      COALESCE(SUM(gl.dr - gl.cr), 0) AS amount
    FROM account_category ac
    LEFT JOIN general_ledger gl
      ON ac.code = gl.account_code
      AND gl.facility_id = :facilityId
      AND gl.transaction_date <= :asOfDate
    WHERE ac.facility_id = :facilityId
      AND ac.account_nature = 'ASSET'
      AND ac.is_active = 1
      ${excludeBalanceSwitch}
    GROUP BY ac.code, ac.description, ac.category, ac.type, ac.level, ac.parent_code
    ${assetHaving}
    ORDER BY ac.category, ac.code
  `;

  const liabilitiesQuery = `
    SELECT
      ac.code            AS account_code,
      ac.description     AS account_name,
      ac.category,
      COALESCE(ac.type, ac.category) AS type,
      ac.level           AS level,
      ac.parent_code     AS parent_code,
      COALESCE(SUM(gl.cr - gl.dr), 0) AS amount
    FROM account_category ac
    LEFT JOIN general_ledger gl
      ON ac.code = gl.account_code
      AND gl.facility_id = :facilityId
      AND gl.transaction_date <= :asOfDate
    WHERE ac.facility_id = :facilityId
      AND ac.account_nature = 'LIABILITY'
      AND ac.is_active = 1
      ${excludeBalanceSwitch}
    GROUP BY ac.code, ac.description, ac.category, ac.type, ac.level, ac.parent_code
    ${liabilityHaving}
    ORDER BY ac.category, ac.code
  `;

  const equityQuery = `
    SELECT
      ac.code            AS account_code,
      ac.description     AS account_name,
      ac.category,
      COALESCE(ac.type, ac.category) AS type,
      ac.level           AS level,
      ac.parent_code     AS parent_code,
      COALESCE(SUM(gl.cr - gl.dr), 0) AS amount
    FROM account_category ac
    LEFT JOIN general_ledger gl
      ON ac.code = gl.account_code
      AND gl.facility_id = :facilityId
      AND gl.transaction_date <= :asOfDate
    WHERE ac.facility_id = :facilityId
      AND ac.account_nature = 'EQUITY'
      AND ac.is_active = 1
      ${excludeBalanceSwitch}
    GROUP BY ac.code, ac.description, ac.category, ac.type, ac.level, ac.parent_code
    ${equityHaving}
    ORDER BY ac.category, ac.code
  `;

  const balanceSwitchQuery = `
    SELECT
      ac.code            AS account_code,
      ac.description     AS account_name,
      ac.category,
      COALESCE(ac.type, ac.category) AS type,
      ac.level           AS level,
      ac.parent_code     AS parent_code,
      ac.account_nature  AS account_nature,
      ac.alternate_nature AS alternate_nature,
      COALESCE(SUM(gl.dr - gl.cr), 0) AS net_debit
    FROM account_category ac
    LEFT JOIN general_ledger gl
      ON ac.code = gl.account_code
      AND gl.facility_id = :facilityId
      AND gl.transaction_date <= :asOfDate
    WHERE ac.facility_id = :facilityId
      AND ac.is_active = 1
      AND COALESCE(ac.reporting_behavior, 'fixed') = 'balance_switch'
    GROUP BY
      ac.code, ac.description, ac.category, ac.type, ac.level,
      ac.parent_code, ac.account_nature, ac.alternate_nature
    HAVING ABS(COALESCE(SUM(gl.dr - gl.cr), 0)) > 0.005
    ORDER BY ac.category, ac.code
  `;

  const [assets, liabilities, equity, switchRows] = await Promise.all([
    db.sequelize.query(assetsQuery, {
      replacements: { facilityId, asOfDate },
      type: QueryTypes.SELECT,
    }),
    db.sequelize.query(liabilitiesQuery, {
      replacements: { facilityId, asOfDate },
      type: QueryTypes.SELECT,
    }),
    db.sequelize.query(equityQuery, {
      replacements: { facilityId, asOfDate },
      type: QueryTypes.SELECT,
    }),
    db.sequelize.query(balanceSwitchQuery, {
      replacements: { facilityId, asOfDate },
      type: QueryTypes.SELECT,
    }),
  ]);

  // Dual-nature (VAT/clearing): net debit → asset side; net credit → liability.
  for (const row of switchRows || []) {
    const netDebit = parseFloat(row.net_debit) || 0;
    const base = {
      account_code: row.account_code,
      account_name: row.account_name,
      category: row.category,
      type: row.type,
      level: row.level,
      parent_code: row.parent_code,
      reporting_behavior: "balance_switch",
    };
    if (netDebit > 0.005) {
      assets.push({ ...base, amount: netDebit, effective_nature: "ASSET" });
    } else if (netDebit < -0.005) {
      liabilities.push({
        ...base,
        amount: Math.abs(netDebit),
        effective_nature: "LIABILITY",
      });
    }
  }

  applyAssetClassification(assets);
  applyLiabilityClassification(liabilities);

  return { assets, liabilities, equity };
}

function mergeComparativeByCode(currentRows, priorRows) {
  const map = new Map();
  const keyOf = (r) => String(r.account_code || "").trim();
  for (const r of currentRows || []) {
    map.set(keyOf(r), {
      ...r,
      amountCurrent: parseFloat(r.amount) || 0,
      amountPrior: 0,
    });
  }
  for (const r of priorRows || []) {
    const amt = parseFloat(r.amount) || 0;
    const k = keyOf(r);
    const ex = map.get(k);
    if (ex) {
      ex.amountPrior = amt;
    } else {
      map.set(k, {
        ...r,
        amountCurrent: 0,
        amountPrior: amt,
      });
    }
  }
  return Array.from(map.values());
}

/** SOFP detail lines: show only accounts with a non-zero balance in current and/or prior column. */
function sofpMergedRowHasBalance(r) {
  const c = parseFloat(r.amountCurrent);
  const p = parseFloat(r.amountPrior);
  const c0 = Number.isFinite(c) ? c : 0;
  const p0 = Number.isFinite(p) ? p : 0;
  return Math.abs(c0) > 0.005 || Math.abs(p0) > 0.005;
}

function toSofpFlatLineRows(mergedRows) {
  return (mergedRows || []).map((r) => ({
    type: "line",
    label: `${r.account_code} - ${r.account_name || ""}`.trim(),
    note: r.account_code,
    current: parseFloat(r.amountCurrent) || 0,
    prior: parseFloat(r.amountPrior) || 0,
  }));
}

/**
 * AaErp chart numbering: level 1 = one digit 1–9; each deeper level adds two digits (01–99).
 * Same segment rule as hierarchical general ledger (e.g. 101 → 10101 → 1010101).
 */
function getSegmentParentCode(accountCode) {
  const sc = String(accountCode || "").trim();
  if (!sc || sc.length < 3) return null;
  const first = sc.charAt(0);
  if (first < "1" || first > "9") return null;
  if (sc.length === 3) {
    return first;
  }
  return sc.substring(0, sc.length - 2);
}

function compareSofpCodes(a, b) {
  return String(a || "").localeCompare(String(b || ""));
}

/**
 * Single step up the CoA: prefer account_category.parent_code on the row, else segment parent.
 * Matches DB (e.g. 10101→101, 101→1; 1010102→10101).
 */
function resolveParentLinkCode(code, leaves) {
  const row = leaves.get(code);
  const parentFromRow = getParentCodeFromRow(row);
  if (parentFromRow && parentFromRow !== "0" && parentFromRow !== code) {
    return parentFromRow;
  }
  return getSegmentParentCode(code);
}

/** All codes on the path to the root for SOFP: DB parent_code when present, else segment parent. */
function collectAncestorCodesForAccount(code, leaves) {
  const out = new Set();
  let cur = String(code || "").trim();
  let guard = 0;
  while (cur && guard++ < 40) {
    out.add(cur);
    const row = leaves.get(cur);
    let p = getParentCodeFromRow(row);
    if (!p || p === "0" || p === cur) {
      p = getSegmentParentCode(cur);
    }
    if (!p) break;
    cur = String(p).trim();
  }
  return out;
}

/** True if `code` is under `ancestor` in the CoA tree (parent_code first, else segment). */
function isStrictDescendantOfCoa(ancestor, code, leaves) {
  if (!ancestor || !code || code === ancestor) return false;
  let c = code;
  let guard = 0;
  while (c && guard++ < 48) {
    const par = resolveParentLinkCode(c, leaves);
    if (!par) return false;
    if (par === ancestor) return true;
    c = par;
  }
  return false;
}

function sumMergedInSubtree(rootCode, leaves) {
  let cur = 0;
  let pr = 0;
  for (const [c, row] of leaves) {
    if (c === rootCode || isStrictDescendantOfCoa(rootCode, c, leaves)) {
      cur += parseFloat(row.amountCurrent) || 0;
      pr += parseFloat(row.amountPrior) || 0;
    }
  }
  return { current: cur, prior: pr };
}

function countLeafAccountsInSubtree(rootCode, leaves, childrenByParent) {
  let n = 0;
  for (const c of leaves.keys()) {
    if (!(c === rootCode || isStrictDescendantOfCoa(rootCode, c, leaves))) continue;
    if ((childrenByParent.get(c) || []).length === 0) n += 1;
  }
  return n;
}

async function fetchDescriptionsForCodes(facilityId, codes) {
  const uniq = [...new Set(codes.map((c) => String(c).trim()).filter(Boolean))];
  if (!uniq.length) return new Map();
  const rows = await db.AccountCategory.findAll({
    where: { facilityId, code: { [Op.in]: uniq } },
    attributes: ["code", "description"],
    raw: true,
  });
  return new Map(rows.map((r) => [String(r.code), r.description || ""]));
}

async function fetchMetaForCodes(facilityId, codes) {
  const uniq = [...new Set(codes.map((c) => String(c).trim()).filter(Boolean))];
  if (!uniq.length) return new Map();
  const rows = await db.AccountCategory.findAll({
    where: { facilityId, code: { [Op.in]: uniq } },
    attributes: ["code", "description", "parentCode", "level", "type", "category"],
    raw: true,
  });
  return new Map(
    rows.map((r) => [
      String(r.code),
      {
        description: r.description || "",
        parentCode: r.parentCode == null ? "" : String(r.parentCode).trim(),
        level: Number(r.level || 0) || 0,
        type: r.type || r.category || "",
      },
    ])
  );
}

function normalizeSofpTypeLabel(rootDigit, rawType) {
  const s = String(rawType || "").trim().toLowerCase();
  if (!s) {
    if (rootDigit === "1") return "Current assets";
    if (rootDigit === "2") return "Current liabilities";
    if (rootDigit === "3") return "Share capital";
    return "Other";
  }
  if (rootDigit === "1") {
    if (s.includes("non-current") || s.includes("non current") || s.includes("fixed")) {
      return "Non-current assets";
    }
    return "Current assets";
  }
  if (rootDigit === "2") {
    if (s.includes("non-current") || s.includes("non current") || s.includes("long")) {
      return "Non-current liabilities";
    }
    return "Current liabilities";
  }
  if (rootDigit === "3") {
    if (s.includes("share premium")) return "Share premium";
    if (s.includes("retained")) return "Retained earnings";
    if (s.includes("reserve")) return "Other reserves";
    if (s.includes("treasury")) return "Treasury shares";
    if (s.includes("non-controlling") || s.includes("non controlling")) {
      return "Non-controlling interests";
    }
    return "Share capital";
  }
  return String(rawType || "Other");
}

/**
 * Build SOFP rows by real CoA structure:
 * 1) group by account `type` (or fallback category),
 * 2) within each type, nest by `parent_code`/`code`,
 * 3) preserve account lines (non-zero in current/prior is pre-filtered before this stage).
 */
async function buildSofpSegmentRows(mergedRows, facilityId) {
  const rows = mergedRows || [];
  if (rows.length === 0) return [];

  const normalizedRows = rows
    .map((r) => {
      const code = String(r.account_code || "").trim();
      if (!code) return null;
      return {
        ...r,
        account_code: code,
        account_name: r.account_name || code,
        amountCurrent: parseFloat(r.amountCurrent) || 0,
        amountPrior: parseFloat(r.amountPrior) || 0,
      };
    })
    .filter(Boolean);

  if (!normalizedRows.length) return [];

  const metaMap = await fetchMetaForCodes(
    facilityId,
    normalizedRows.map((r) => r.account_code)
  );

  const byTypeLabel = new Map();
  for (const r of normalizedRows) {
    const rootDigit = String(r.account_code || "").trim().charAt(0);
    const rawType = metaMap.get(r.account_code)?.type || r.account_type || r.category;
    const typeLabel = normalizeSofpTypeLabel(rootDigit, rawType);
    if (!byTypeLabel.has(typeLabel)) byTypeLabel.set(typeLabel, []);
    byTypeLabel.get(typeLabel).push(r);
  }

  const typeOrder = {
    "Non-current assets": 1,
    "Current assets": 2,
    "Non-current liabilities": 1,
    "Current liabilities": 2,
    "Share capital": 1,
    "Share premium": 2,
    "Retained earnings": 3,
    "Other reserves": 4,
    "Treasury shares": 5,
    "Non-controlling interests": 6,
    Other: 99,
  };

  const buildTypeTree = async (typeRows) => {
    const rowByCode = new Map(typeRows.map((r) => [r.account_code, r]));
    const childrenByParent = new Map();
    const rootSet = new Set();
    const missingParentCodes = new Set();
    const parentByCode = new Map();

    for (const r of typeRows) {
      const metaParent = metaMap.get(r.account_code)?.parentCode;
      const rowParent = getParentCodeFromRow(r);
      const metaParentRaw = String(metaParent || "").trim();
      const rowParentRaw = String(rowParent || "").trim();
      const directParent = metaParentRaw || rowParentRaw;
      const parentCode =
        directParent && directParent !== "0" && directParent !== r.account_code
          ? directParent
          : "";

      parentByCode.set(r.account_code, parentCode);

      if (parentCode) {
        if (!childrenByParent.has(parentCode)) childrenByParent.set(parentCode, []);
        childrenByParent.get(parentCode).push(r.account_code);
        if (!rowByCode.has(parentCode)) missingParentCodes.add(parentCode);
        rootSet.delete(r.account_code);
      } else {
        rootSet.add(r.account_code);
      }
    }

    // Expand virtual parents through full CoA chain so report tree organization
    // mirrors chart-of-accounts parent/child structure (not just one missing level).
    let frontier = Array.from(missingParentCodes);
    const seenVirtual = new Set(frontier);
    while (frontier.length) {
      const virtualMeta = await fetchMetaForCodes(facilityId, frontier);
      const nextFrontier = [];
      for (const code of frontier) {
        const parent = String(virtualMeta.get(code)?.parentCode || "").trim();
        const parentCode =
          parent && parent !== "0" && parent !== code ? parent : "";
        if (!parentByCode.has(code) || !parentByCode.get(code)) {
          parentByCode.set(code, parentCode);
        }
        if (!parentCode) continue;
        if (!childrenByParent.has(parentCode)) childrenByParent.set(parentCode, []);
        if (!childrenByParent.get(parentCode).includes(code)) {
          childrenByParent.get(parentCode).push(code);
        }
        if (!rowByCode.has(parentCode) && !seenVirtual.has(parentCode)) {
          missingParentCodes.add(parentCode);
          seenVirtual.add(parentCode);
          nextFrontier.push(parentCode);
        }
      }
      frontier = nextFrontier;
    }

    // Second-pass strict parent-child enforcement from CoA metadata.
    // This makes report tree match account_category parent_code exactly (where possible).
    for (const code of rowByCode.keys()) {
      const metaParent = String(metaMap.get(code)?.parentCode || "").trim();
      if (!metaParent || metaParent === "0" || metaParent === code) continue;
      // Strict metadata linkage for SOFP: keep exact parent_code chain from account_category.
      const parentForLink = metaParent;
      if (parentForLink === code) continue;
      if (!childrenByParent.has(parentForLink)) childrenByParent.set(parentForLink, []);
      if (!childrenByParent.get(parentForLink).includes(code)) {
        childrenByParent.get(parentForLink).push(code);
      }
      parentByCode.set(code, parentForLink);
      if (!rowByCode.has(parentForLink)) missingParentCodes.add(parentForLink);
      rootSet.delete(code);
    }

    for (const [, arr] of childrenByParent) arr.sort(compareSofpCodes);

    const parentDescMap = await fetchDescriptionsForCodes(
      facilityId,
      Array.from(missingParentCodes)
    );

    const virtualRootCodes = Array.from(missingParentCodes)
      .filter((code) => {
        const p = String(parentByCode.get(code) || "").trim();
        return !p || p === "0" || !missingParentCodes.has(p);
      })
      .sort(compareSofpCodes);

    const rootCodes = Array.from(new Set([...virtualRootCodes, ...Array.from(rootSet)])).sort(
      compareSofpCodes
    );

    const buildNode = (code) => {
      const base = rowByCode.get(code);
      const childCodes = childrenByParent.get(code) || [];
      const childNodes = childCodes.map(buildNode).filter(Boolean);
      if (!base && !childNodes.length) return null;

      if (!childNodes.length && base) {
        return {
          type: "line",
          label: `${base.account_code} - ${base.account_name}`,
          note: base.account_code,
          current: base.amountCurrent,
          prior: base.amountPrior,
        };
      }

      const nodeCode = base?.account_code || code;
      const nodeName = base?.account_name || parentDescMap.get(code) || code;
      const baseCurrent = base?.amountCurrent || 0;
      const basePrior = base?.amountPrior || 0;
      const accountCount = childNodes.reduce(
        (n, ch) => n + (ch?.type === "line" ? 1 : ch?.accountCount || 0),
        0
      );
      const totals = childNodes.reduce(
        (acc, ch) => ({
          current: acc.current + (parseFloat(ch.current) || 0),
          prior: acc.prior + (parseFloat(ch.prior) || 0),
        }),
        { current: baseCurrent, prior: basePrior }
      );
      return {
        type: "group",
        parentCode: nodeCode,
        label: `${nodeCode} - ${nodeName}`,
        note: nodeCode,
        current: totals.current,
        prior: totals.prior,
        accountCount: Math.max(accountCount, base ? 1 : 0),
        children: childNodes,
      };
    };

    const children = rootCodes.map(buildNode).filter(Boolean);
    return children;
  };

  const orderedTypeLabels = Array.from(byTypeLabel.keys()).sort((a, b) => {
    const oa = typeOrder[a] ?? 99;
    const ob = typeOrder[b] ?? 99;
    if (oa !== ob) return oa - ob;
    return String(a).localeCompare(String(b));
  });

  const out = [];
  for (const label of orderedTypeLabels) {
    const nodes = await buildTypeTree(byTypeLabel.get(label) || []);
    if (!nodes.length) continue;
    out.push({ type: "section", label, sectionLevel: 2 });
    out.push(...nodes);
  }

  return out;
}

function formatYearLabel(isoDate) {
  if (!isoDate) return "";
  return moment(isoDate).format("YYYY");
}

/** DD/MM/YYYY — matches AaErp report headers (General Ledger, Balance Sheet) */
function formatStatementHeaderDate(isoDate) {
  if (!isoDate) return "";
  return moment(isoDate).format("DD/MM/YYYY");
}

// Trial Balance Report
/**
 * getTrialBalance
 *
 * Corrections over the original:
 *  1. The account_category PK is (code, facility_id). The original LEFT JOIN
 *     matched only on ac.code = gl.account_code without tying ac.facility_id
 *     in the ON clause for the main query — fixed in allAccountsQuery so
 *     accounts from other facilities can never bleed through.
 *  2. Parent-child relationships are resolved entirely from account_category
 *     (parent_code / code) scoped to the facility, not from the DB `level`
 *     column (which is always 2 in this dataset and therefore useless).
 *  3. The root check now also handles NULL / empty parent_code correctly.
 *  4. Rollup is triggered only from true roots (no double-traversal).
 *  5. Grand-total query now also filters account_code IS NOT NULL (parity
 *     with the leaf-sum logic below it).
 *  6. Minor: parseFloat calls are wrapped at entry so arithmetic is safe.
 */

exports.getTrialBalance = async (req, res) => {
  try {
    const { facilityId, asOfDate = "2025-09-09" } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
      });
    }

    // ── 1. Fetch all active accounts with their GL totals ──────────────────
    //
    //  Key fix: both sides of the JOIN are scoped to facilityId.
    //  The original had `WHERE ac.facility_id = :facilityId` but the ON clause
    //  only joined on ac.code = gl.account_code, so a code that exists in
    //  another facility's account_category could still match GL rows.
    //
    const allAccountsQuery = `
      SELECT
        ac.code            AS account_code,
        ac.parent_code     AS parent_code,
        ac.description     AS account_name,
        ac.type            AS type,
        ac.category        AS category,
        ac.account_nature  AS account_nature,
        ac.alternate_nature AS alternate_nature,
        COALESCE(ac.reporting_behavior, 'fixed') AS reporting_behavior,
        ac.level           AS level,
        COALESCE(SUM(gl.dr), 0) AS total_debit,
        COALESCE(SUM(gl.cr), 0) AS total_credit
      FROM account_category ac
      LEFT JOIN general_ledger gl
        ON  gl.account_code    = ac.code
        AND gl.facility_id     = :facilityId
        AND gl.transaction_date <= :asOfDate
      WHERE ac.facility_id = :facilityId
        AND ac.is_active   = 1
      GROUP BY
        ac.code, ac.parent_code, ac.description,
        ac.type, ac.category, ac.account_nature, ac.alternate_nature,
        ac.reporting_behavior, ac.level
    `;

    const allAccounts = await db.sequelize.query(allAccountsQuery, {
      replacements: { facilityId, asOfDate },
      type: QueryTypes.SELECT,
    });

    // ── 2. Find GL entries that have no matching account_category ──────────
    const unmatchedQuery = `
      SELECT
        gl.account_code,
        SUM(gl.dr)  AS total_debit,
        SUM(gl.cr)  AS total_credit,
        COUNT(*)    AS transaction_count
      FROM general_ledger gl
      LEFT JOIN account_category ac
        ON  ac.code        = gl.account_code
        AND ac.facility_id = :facilityId
      WHERE gl.facility_id        = :facilityId
        AND gl.transaction_date  <= :asOfDate
        AND gl.account_code IS NOT NULL
        AND gl.account_code  != ''
        AND ac.code IS NULL
      GROUP BY gl.account_code
      HAVING SUM(gl.dr) > 0 OR SUM(gl.cr) > 0
    `;

    const unmatchedTransactions = await db.sequelize.query(unmatchedQuery, {
      replacements: { facilityId, asOfDate },
      type: QueryTypes.SELECT,
    });

    if (unmatchedTransactions.length > 0) {
      console.warn("Unmatched transactions found:", unmatchedTransactions);
      unmatchedTransactions.forEach((u) => {
        allAccounts.push({
          account_code:   u.account_code,
          parent_code:    null,
          account_name:   `Unmatched Account: ${u.account_code}`,
          type:           "Unmatched",
          category:       "Unmatched",
          account_nature: null,
          level:          99,
          total_debit:    parseFloat(u.total_debit  || 0),
          total_credit:   parseFloat(u.total_credit || 0),
        });
      });
    }

    // ── 3. Build lookup maps ───────────────────────────────────────────────
    //
    //  byCode  : code → row (with parsed numeric totals)
    //  childrenByParent : parentCode → [childCode, ...]
    //
    //  Parent-child relationships come exclusively from account_category
    //  (parent_code / code), scoped to this facility.  We never rely on the
    //  database `level` column for hierarchy depth — it is always 2 in this
    //  dataset and carries no useful depth information.
    //
    const byCode = new Map();
    allAccounts.forEach((row) => {
      const code = String(row.account_code || "").trim();
      if (!code) return;
      byCode.set(code, {
        ...row,
        _code:        code,
        total_debit:  parseFloat(row.total_debit  || 0),
        total_credit: parseFloat(row.total_credit || 0),
      });
    });

    const childrenByParent = new Map();
    byCode.forEach((node) => {
      const parent = String(node.parent_code || "").trim();
      // Skip if: no parent, root sentinel "0", self-reference, or parent not
      // in this facility's chart of accounts.
      if (
        !parent ||
        parent === "0" ||
        parent === node._code ||
        !byCode.has(parent)
      ) return;

      if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
      childrenByParent.get(parent).push(node._code);
    });

    // ── 3b. Re-home balance_switch accounts by net sign ───────────────────
    // Debit balance → Current Assets (112000); credit → Current Liabilities (900200).
    // Display name flips for VAT Control (Recoverable vs Payable).
    const SWITCH_ASSET_PARENT = "112000";
    const SWITCH_LIAB_PARENT = "900200";

    byCode.forEach((node) => {
      if (String(node.reporting_behavior || "fixed") !== "balance_switch") {
        return;
      }
      const net =
        (parseFloat(node.total_debit) || 0) - (parseFloat(node.total_credit) || 0);
      if (Math.abs(net) < 0.005) return;

      const wantAsset = net > 0.005;
      const newParent = wantAsset
        ? byCode.has(SWITCH_ASSET_PARENT)
          ? SWITCH_ASSET_PARENT
          : String(node.parent_code || "").trim()
        : byCode.has(SWITCH_LIAB_PARENT)
          ? SWITCH_LIAB_PARENT
          : String(node.parent_code || "").trim();

      const oldParent = String(node.parent_code || "").trim();
      if (newParent && newParent !== oldParent && byCode.has(newParent)) {
        if (oldParent && childrenByParent.has(oldParent)) {
          childrenByParent.set(
            oldParent,
            childrenByParent.get(oldParent).filter((c) => c !== node._code)
          );
        }
        if (!childrenByParent.has(newParent)) {
          childrenByParent.set(newParent, []);
        }
        if (!childrenByParent.get(newParent).includes(node._code)) {
          childrenByParent.get(newParent).push(node._code);
        }
        node.parent_code = newParent;
      }

      const baseName = String(node.account_name || "");
      // Single generic VAT head — keep name stable for input/output/payable.
      if (/vat/i.test(baseName)) {
        node.account_name = "VAT Recoverable";
      }
    });

    // ── 4. Compute 0-based hierarchy depth (memoised DFS) ─────────────────
    const hierarchyMemo = new Map();
    const computeHierarchy = (code, visited = new Set()) => {
      if (!code) return 0;
      if (hierarchyMemo.has(code)) return hierarchyMemo.get(code);
      if (visited.has(code)) return 0; // cycle guard
      visited.add(code);

      const node = byCode.get(code);
      if (!node) { hierarchyMemo.set(code, 0); return 0; }

      const parentCode = String(node.parent_code || "").trim();
      if (!parentCode || parentCode === "0" || !byCode.has(parentCode)) {
        hierarchyMemo.set(code, 0);
        return 0;
      }
      const depth = computeHierarchy(parentCode, visited) + 1;
      hierarchyMemo.set(code, depth);
      return depth;
    };
    byCode.forEach((_, code) => computeHierarchy(code));

    // ── 5. Keep only accounts with own GL activity OR active descendants ───
    const activityMemo = new Map();
    const hasActivity = (code, seen = new Set()) => {
      if (!code || seen.has(code)) return false;
      if (activityMemo.has(code)) return activityMemo.get(code);
      seen.add(code);

      const row = byCode.get(code);
      if (!row) { activityMemo.set(code, false); return false; }

      const hasOwn =
        row.total_debit  !== 0 ||
        row.total_credit !== 0;

      if (hasOwn) { activityMemo.set(code, true); return true; }

      const kids    = childrenByParent.get(code) || [];
      const kidHas  = kids.some((c) => hasActivity(c, new Set(seen)));
      activityMemo.set(code, kidHas);
      return kidHas;
    };

    const activeAccounts = allAccounts.filter((row) => {
      const code = String(row.account_code || "").trim();
      if (!code) return false;
      if (String(row.type || "").toLowerCase() === "unmatched") return true;
      return hasActivity(code);
    });

    const activeCodesSet = new Set(
      activeAccounts.map((r) => String(r.account_code).trim())
    );

    // ── 6. Bottom-up rollup of debit / credit totals ───────────────────────
    //
    //  Each node accumulates its own GL values plus those of all descendants.
    //  We traverse from roots downward (DFS), memoising results so each node
    //  is computed exactly once regardless of how many ancestors reference it.
    //
    const rollupDebit  = new Map();
    const rollupCredit = new Map();

    const rollup = (code, seen = new Set()) => {
      if (seen.has(code)) return { dr: 0, cr: 0 }; // cycle guard
      seen.add(code);

      const row = byCode.get(code);
      if (!row) return { dr: 0, cr: 0 };

      let dr = row.total_debit;
      let cr = row.total_credit;

      const kids = childrenByParent.get(code) || [];
      for (const kid of kids) {
        if (!activeCodesSet.has(kid)) continue;
        const sub = rollup(kid, seen);
        dr += sub.dr;
        cr += sub.cr;
      }

      rollupDebit.set(code,  dr);
      rollupCredit.set(code, cr);
      return { dr, cr };
    };

    // ── 7. Identify root nodes ─────────────────────────────────────────────
    //
    //  A node is a root if:
    //    • parent_code is absent / null / empty / "0", OR
    //    • its parent is not in the active set (orphan — treat as root)
    //
    const roots = activeAccounts
      .filter((row) => {
        const parent = String(row.parent_code || "").trim();
        return (
          !parent ||
          parent === "0" ||
          !activeCodesSet.has(parent)
        );
      })
      .map((r) => String(r.account_code).trim());

    // Trigger rollup from every root (each DFS call propagates into children)
    roots.forEach((code) => rollup(code));

    // ── 8. Build nested tree for the response ─────────────────────────────
    /** Net balance for trial balance display: DR column OR CR column, never both. */
    const toTrialBalanceColumns = (debit, credit) => {
      const dr = parseFloat(debit) || 0;
      const cr = parseFloat(credit) || 0;
      const net = dr - cr;
      if (Math.abs(net) < 0.005) {
        return { total_debit: 0, total_credit: 0 };
      }
      if (net > 0) {
        return { total_debit: Number(net.toFixed(2)), total_credit: 0 };
      }
      return { total_debit: 0, total_credit: Number(Math.abs(net).toFixed(2)) };
    };

    const buildNode = (code) => {
      const row = byCode.get(code);
      if (!row) return null;

      const kids = (childrenByParent.get(code) || [])
        .filter((k) => activeCodesSet.has(k))
        .sort((a, b) =>
          String(a).localeCompare(String(b), undefined, { numeric: true })
        );

      const rolledDr = rollupDebit.get(code) || 0;
      const rolledCr = rollupCredit.get(code) || 0;
      const { total_debit, total_credit } = toTrialBalanceColumns(
        rolledDr,
        rolledCr
      );

      return {
        account_code:   row.account_code,
        account_name:   row.account_name,
        account_nature: row.account_nature,
        effective_nature: (() => {
          if (row.reporting_behavior !== "balance_switch") {
            return row.account_nature;
          }
          const net = (parseFloat(rolledDr) || 0) - (parseFloat(rolledCr) || 0);
          if (net > 0.005) {
            return (
              (row.account_nature === "ASSET"
                ? row.account_nature
                : row.alternate_nature) || "ASSET"
            );
          }
          if (net < -0.005) {
            return (
              (row.account_nature === "LIABILITY"
                ? row.account_nature
                : row.alternate_nature) || "LIABILITY"
            );
          }
          return row.account_nature;
        })(),
        reporting_behavior: row.reporting_behavior || "fixed",
        category:       row.category,
        type:           row.type,
        hierarchy:      hierarchyMemo.get(code) ?? 0,
        is_header:      kids.length > 0,
        total_debit,
        total_credit,
        children:       kids.map((kid) => buildNode(kid)).filter(Boolean),
      };
    };

    const tree = roots
      .sort((a, b) =>
        String(a).localeCompare(String(b), undefined, { numeric: true })
      )
      .map((code) => buildNode(code))
      .filter(Boolean);

    // ── 9. Grand totals straight from GL (no double-counting) ─────────────
    const grandTotalQuery = `
      SELECT
        COALESCE(SUM(dr), 0) AS total_debit,
        COALESCE(SUM(cr), 0) AS total_credit
      FROM general_ledger
      WHERE facility_id        = :facilityId
        AND transaction_date  <= :asOfDate
        AND account_code IS NOT NULL
        AND account_code != ''
    `;
    const [grandRow] = await db.sequelize.query(grandTotalQuery, {
      replacements: { facilityId, asOfDate },
      type: QueryTypes.SELECT,
    });

    const grandTotalDebit  = parseFloat(grandRow?.total_debit  || 0);
    const grandTotalCredit = parseFloat(grandRow?.total_credit || 0);

    // Leaf-only net balances for display totals (sum of DR / CR columns)
    let displayDebit = 0;
    let displayCredit = 0;
    activeAccounts.forEach((r) => {
      const code = String(r.account_code || "").trim();
      const activeKids = (childrenByParent.get(code) || []).filter(
        (k) => activeCodesSet.has(k)
      );
      if (activeKids.length === 0) {
        const cols = toTrialBalanceColumns(r.total_debit, r.total_credit);
        displayDebit += cols.total_debit;
        displayCredit += cols.total_credit;
      }
    });

    return res.json({
      success: true,
      data: {
        reportDate: asOfDate,
        facilityId,
        tree,
        totals: {
          totalDebit:  displayDebit.toFixed(2),
          totalCredit: displayCredit.toFixed(2),
          difference:  (displayDebit - displayCredit).toFixed(2),
        },
        validation: {
          grandTotalDebit:       grandTotalDebit.toFixed(2),
          grandTotalCredit:      grandTotalCredit.toFixed(2),
          grandDifference:       (grandTotalDebit - grandTotalCredit).toFixed(2),
          unmatchedCount:        unmatchedTransactions.length,
          unmatchedAccountCodes: unmatchedTransactions.map((t) => t.account_code),
        },
      },
    });
  } catch (error) {
    console.error("Trial Balance Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error generating trial balance",
      error: error.message,
    });
  }
};

// Income Statement (Profit and Loss Account)
/**
 * INCOME STATEMENT CONTROLLER
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates a P&L report (face + expandable notes) with ZERO hardcoded account
 * codes or labels. All structure is derived at runtime from the `type` and
 * `subcategory` columns of account_category, which are populated from
 * ACCOUNT_TAXONOMY defined in your Chart of Accounts setup.
 *
 * ─── HOW THE TAXONOMY DRIVES THE REPORT ─────────────────────────────────────
 *
 *  ACCOUNT_TAXONOMY shape (relevant slice):
 *
 *  expenses: {
 *    cost_of_sales:          { direct_materials, production_overhead, … }
 *    operating_expenses:     { admin_expenses, selling_expenses, salaries, … }
 *    non_operating_expenses: { interest_payable, bank_charges, … }
 *    taxes:                  { income_tax, deferred_tax, … }
 *  }
 *  revenue: {
 *    operating_revenue:     { sales, service_income, … }
 *    non_operating_revenue: { other_income, interest_income, … }
 *  }
 *
 *  account_category columns used:
 *
 *    type        → taxonomy 2nd-level key (normalised to snake_case at runtime)
 *                  "Operating revenue"         → "operating_revenue"
 *                  "Non-operating revenue"     → "non_operating_revenue"
 *                  "Operating expenses"        → "operating_expenses"
 *                  "Non-operating expenses"    → "non_operating_expenses"
 *                  "Cost of sales"             → "cost_of_sales"
 *                  "Taxes"                     → "taxes"
 *
 *    subcategory → taxonomy 3rd-level key (stored verbatim, e.g. "direct_materials")
 *
 *    display = 0, parent_code ≠ '0'  → NOTE GROUP header (face of report)
 *    display = 1                      → LINE ITEM (inside the note detail)
 *
 * ─── INCOME STATEMENT SECTION ORDER ─────────────────────────────────────────
 *
 *  Turnover              ← operating_revenue   (all subcategories)
 *  Other Income          ← non_operating_revenue (all subcategories)
 *  ───────────────────────────────────────────────────────────────────────────
 *  Cost of Sales         ← cost_of_sales       (all subcategories)
 *  Gross Profit          = Turnover − Cost of Sales
 *  Administrative Costs  ← operating_expenses  (all subcategories)
 *  Operating Profit      = Gross Profit + Other Income − Admin Costs
 *  Interest Payable      ← non_operating_expenses (all subcategories)
 *  Profit Before Tax     = Operating Profit − Interest Payable
 *  Taxation              ← taxes               (all subcategories)
 *  Profit After Tax      = Profit Before Tax − Taxation
 *
 * ─── NOTE NUMBERING ──────────────────────────────────────────────────────────
 *  Note numbers are assigned sequentially (1, 2, 3 …) in IS top-to-bottom
 *  order to any note group that has a non-zero balance in the period.
 *  No number is hardcoded — if a section is empty it gets no note reference.
 */

// ─────────────────────────────────────────────────────────────────────────────
// TAXONOMY KEY NORMALISER
// Converts the free-text `type` column value to the snake_case key used in
// ACCOUNT_TAXONOMY so classification is purely string-based, no switch/case.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * "Non-operating expenses" → "non_operating_expenses"
 * "Cost of sales"          → "cost_of_sales"
 * "Operating revenue"      → "operating_revenue"
 */
function toTaxonomyKeyLegacy(rawType) {
  if (!rawType) return "";
  return rawType
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION CLASSIFIER
// Maps (account_nature, taxonomyKey) → IS section bucket.
// Driven entirely by the ACCOUNT_TAXONOMY second-level keys.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns one of:
 *   "turnover" | "other_income" | "cost_of_sales" |
 *   "operating_expenses" | "interest_and_finance" | "taxes"
 */
function classifySectionLegacy(accountNature, rawType) {
  const key = toTaxonomyKeyLegacy(rawType);

  if (accountNature === "REVENUE") {
    // Any type containing "non_operating" → other income
    if (key.includes("non_operating")) return "other_income";
    // Any type containing "operating" (but not non_operating) → turnover
    if (key.includes("operating"))     return "turnover";
    return "other_income"; // fallback for plain "revenue"
  }

  if (accountNature === "EXPENSE") {
    if (key === "cost_of_sales")          return "cost_of_sales";
    if (key === "operating_expenses")     return "operating_expenses";
    if (key === "non_operating_expenses") return "interest_and_finance";
    if (key === "taxes")                  return "taxes";
    // Anything else under expenses goes to operating
    return "operating_expenses";
  }

  return "other";
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLER
// ─────────────────────────────────────────────────────────────────────────────

exports.getIncomeStatement = async (req, res) => {
  try {
    const { facilityId, fromDate, toDate } = req.body;

    if (!facilityId) {
      return res.status(400).json({ success: false, message: "facilityId is required" });
    }

    // ── 1. Resolve period dates ────────────────────────────────────────────
    let startDate = fromDate;
    if (!startDate) {
      const [row] = await db.sequelize.query(
        `SELECT MIN(transaction_date) AS earliest
         FROM general_ledger
         WHERE facility_id = :facilityId
           AND status      IN ('paid', 'posted')
           AND type        != 'opening_balance'`,
        { replacements: { facilityId }, type: QueryTypes.SELECT }
      );
      startDate = row?.earliest || `${new Date().getFullYear()}-01-01`;
    }
    const endDate = toDate || new Date().toISOString().slice(0, 10);

    // ── 2. Fetch note-group headers (display=0, non-root) ──────────────────
    // These are the accounts that appear as line items on the face of the
    // report, each referencing a Note number.
    const noteGroups = await db.sequelize.query(
      `SELECT
         code,
         parent_code,
         description,
         type          AS account_type,
         subcategory,
         account_nature
       FROM account_category
       WHERE facility_id    = :facilityId
         AND account_nature IN ('REVENUE', 'EXPENSE')
         AND display        = 0
         AND parent_code   != '0'
         AND is_active      = 1
       ORDER BY code ASC`,
      { replacements: { facilityId }, type: QueryTypes.SELECT }
    );

    // ── 3. Fetch all line-item balances for the period ─────────────────────
    // One query: LEFT JOIN so we get all accounts even with zero GL activity.
    // Signed amounts are computed in SQL; we just apply the nature sign in JS.
    const lineItems = await db.sequelize.query(
      `SELECT
         ac.code                              AS account_code,
         ac.parent_code                       AS note_group_code,
         ac.description                       AS account_name,
         ac.subcategory,
         ac.account_nature,
         COALESCE(SUM(gl.cr - gl.dr), 0)     AS cr_net,
         COALESCE(SUM(gl.dr - gl.cr), 0)     AS dr_net
       FROM account_category ac
       LEFT JOIN general_ledger gl
         ON  gl.account_code     = ac.code
         AND gl.facility_id      = :facilityId
         AND gl.transaction_date BETWEEN :startDate AND :endDate
         AND gl.status           IN ('paid', 'posted')
         AND gl.type             != 'opening_balance'
       WHERE ac.facility_id    = :facilityId
         AND ac.account_nature IN ('REVENUE', 'EXPENSE')
         AND ac.display        = 1
         AND ac.is_active      = 1
       GROUP BY
         ac.code, ac.parent_code, ac.description,
         ac.subcategory, ac.account_nature
       ORDER BY ac.code ASC`,
      { replacements: { facilityId, startDate, endDate }, type: QueryTypes.SELECT }
    );

    // ── 4. Build note-group map ────────────────────────────────────────────
    const noteGroupMap = {};
    for (const grp of noteGroups) {
      const taxonomyKey = toTaxonomyKey(grp.account_type);
      noteGroupMap[grp.code] = {
        noteGroupCode : grp.code,
        description   : grp.description,
        accountType   : grp.account_type,
        taxonomyKey,                               // e.g. "operating_expenses"
        subcategory   : grp.subcategory,           // e.g. "direct_materials"
        accountNature : grp.account_nature,
        isSection     : classifySection(grp.account_nature, grp.account_type),
        items         : [],
        total         : 0,
        noteRef       : null,                      // assigned in step 6
      };
    }

    // ── 5. Distribute line items into their note groups ────────────────────
    for (const item of lineItems) {
      const grp = noteGroupMap[item.note_group_code];
      if (!grp) continue;

      // Sign convention (from the IS perspective):
      //   REVENUE positive = income  → use cr_net
      //   EXPENSE positive = cost    → use dr_net
      const amount =
        item.account_nature === "REVENUE"
          ? parseFloat(item.cr_net)
          : parseFloat(item.dr_net);

      if (amount === 0) continue; // suppress zero-balance line items

      grp.items.push({
        accountCode: item.account_code,
        name       : item.account_name,
        amount,
      });
      grp.total += amount;
    }

    // ── 6. Bucket note groups into IS sections ─────────────────────────────
    const sections = {
      turnover            : [],
      other_income        : [],
      cost_of_sales       : [],
      operating_expenses  : [],
      interest_and_finance: [],
      taxes               : [],
    };

    for (const grp of Object.values(noteGroupMap)) {
      const bucket = sections[grp.isSection];
      if (bucket) bucket.push(grp);
    }

    // Sort each section by account code for stable, consistent ordering
    Object.values(sections).forEach((s) =>
      s.sort((a, b) => a.noteGroupCode.localeCompare(b.noteGroupCode))
    );

    // ── 7. Assign Note reference numbers in IS order ───────────────────────
    // Only note groups with a non-zero balance receive a note number.
    // Numbers are sequential (1, 2, 3 …) top-to-bottom through the statement.
    let noteCounter = 1;
    const isOrder = [
      sections.turnover,
      sections.other_income,
      sections.cost_of_sales,
      sections.operating_expenses,
      sections.interest_and_finance,
      sections.taxes,
    ];
    for (const bucket of isOrder) {
      for (const grp of bucket) {
        if (grp.total !== 0) {
          grp.noteRef = noteCounter++;
        }
      }
    }

    // ── 8. Compute IS totals ───────────────────────────────────────────────
    const sum = (bucket) => bucket.reduce((acc, g) => acc + g.total, 0);

    const totalTurnover     = sum(sections.turnover);
    const totalOtherIncome  = sum(sections.other_income);
    const totalCostOfSales  = sum(sections.cost_of_sales);
    const grossProfit       = totalTurnover - totalCostOfSales;
    const totalAdminCosts   = sum(sections.operating_expenses);
    const operatingProfit   = grossProfit + totalOtherIncome - totalAdminCosts;
    const totalInterest     = sum(sections.interest_and_finance);
    const profitBeforeTax   = operatingProfit - totalInterest;
    const totalTaxation     = sum(sections.taxes);
    const profitAfterTax    = profitBeforeTax - totalTaxation;

    // ── 9. EPS — profit after tax ÷ issued shares (from equity share capital GL) ──
    const PAR_VALUE = 1;
    const shareCapital = await fetchShareCapitalForEps(facilityId, endDate);
    const preferenceDividends = await fetchPreferenceDividends(
      facilityId,
      startDate,
      endDate,
    );
    const epsPackage = computeEpsPackage(
      profitAfterTax,
      shareCapital,
      preferenceDividends,
      PAR_VALUE,
    );
    const {
      profitAttributableToOrdinary,
      numberOfShares: numShares,
      epsKobo,
    } = epsPackage;

    // ── 10. Send response ──────────────────────────────────────────────────
    return res.json({
      success: true,
      data: {

        meta: {
          facilityId,
          period  : { from: startDate, to: endDate },
          currency: "NGN",
          title   : "STATEMENT OF PROFIT OR LOSS AND OTHER COMPREHENSIVE INCOME",
        },

        // ── Face of the Income Statement ────────────────────────────────
        // Each `notes` array contains one entry per note group (the rows
        // shown on the face). `noteRef` links to the notes section below.
        incomeStatement: {

          turnover: {
            notes: sections.turnover.map(toFaceRow),
            total: r(totalTurnover),
          },

          otherIncome: {
            notes: sections.other_income.map(toFaceRow),
            total: r(totalOtherIncome),
          },

          costOfSales: {
            notes: sections.cost_of_sales.map(toFaceRow),
            total: r(totalCostOfSales),
          },

          grossProfit: r(grossProfit),

          administrativeCosts: {
            notes: sections.operating_expenses.map(toFaceRow),
            total: r(totalAdminCosts),
          },

          operatingProfit: r(operatingProfit),

          interestPayable: {
            notes: sections.interest_and_finance.map(toFaceRow),
            total: r(totalInterest),
          },

          profitBeforeTax: r(profitBeforeTax),

          taxation: {
            notes: sections.taxes.map(toFaceRow),
            total: r(totalTaxation),
          },

          profitAfterTax: r(profitAfterTax),
        },

        // ── Notes to the Accounts ───────────────────────────────────────
        // One entry per note group that has activity.
        // `items` are the individual account line items (the note detail).
        // Frontend renders these as expandable panels keyed by noteRef.
        notes: buildNotes(isOrder),

        // ── Per Share Data (Kobo) ───────────────────────────────────────
        perShareData: {
          shareCapital: r(epsPackage.shareCapital),
          preferenceDividends: r(epsPackage.preferenceDividends),
          profitAttributableToOrdinary: r(profitAttributableToOrdinary),
          numberOfShares: numShares,
          parValuePerShare: PAR_VALUE,
          earningsPerShareKobo: epsKobo,
          earningsPerShare: {
            label: "Earnings per share",
            valueKobo: epsKobo,
          },
        },

      },
    });

  } catch (err) {
    console.error("Income Statement Error:", err);
    return res.status(500).json({
      success: false,
      message: "Error generating income statement",
      error  : err.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SMALL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Round to 2 dp */
function rLegacy(n) { return parseFloat((n || 0).toFixed(2)); }

/** Shape of one row on the FACE of the income statement */
function toFaceRowLegacy(grp) {
  return {
    noteRef     : grp.noteRef    || null,
    description : grp.description,
    subcategory : grp.subcategory,
    taxonomyKey : grp.taxonomyKey,
    total       : rLegacy(grp.total),
  };
}

/**
 * Build the notes array in IS top-to-bottom order.
 * Only includes note groups that received a noteRef (i.e. have activity).
 */
function buildNotesLegacy(isOrder) {
  return isOrder
    .flat()
    .filter((g) => g.noteRef != null)
    .map((grp) => ({
      noteRef     : grp.noteRef,
      title       : grp.description,
      subcategory : grp.subcategory,
      taxonomyKey : grp.taxonomyKey,
      isSection   : grp.isSection,
      items       : grp.items.map((i) => ({
        accountCode : i.accountCode,
        name        : i.name,
        amount      : rLegacy(i.amount),
      })),
      total: rLegacy(grp.total),
    }));
}

// Balance Sheet (Statement of Financial Position)
/**
 * INCOME STATEMENT CONTROLLER
 * ─────────────────────────────────────────────────────────────────────────────
 * Zero hardcoded account codes. All structure comes from the `type` and
 * `subcategory` columns in account_category, which are populated from
 * ACCOUNT_TAXONOMY in your Chart of Accounts setup.
 *
 * ─── EXACT IS FACE STRUCTURE (matches United Gases screenshot) ───────────────
 *
 *  Turnover                        ← operating_revenue  > (all subcategories)
 *  Cost of Sales                   ← expenses > cost_of_sales > (all subcats)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Gross Profit                    = Turnover − Cost of Sales
 *  Other Income                    ← revenue > non_operating_revenue > (all)
 *  Administrative Costs            ← expenses > operating_expenses > (all subcats)
 *  Impairment Loss                 ← expenses > non_operating_expenses
 *                                      WHERE subcategory = 'impairment_loss'
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Operating Profit before Interest= Gross Profit + Other Income
 *                                    − Admin Costs − Impairment
 *  Interest Payable & Similar      ← expenses > non_operating_expenses
 *                                      WHERE subcategory != 'impairment_loss'
 *                                      (interest_payable, bank_charges,
 *                                       foreign_exchange_loss, etc.)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Profit Before Tax               = Operating Profit − Interest
 *  Taxation                        ← expenses > taxes > (all subcats)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Profit After Tax
 *
 *  Per Share Data (Kobo):
 *    Earnings per share            = (Profit After Tax ÷ Shares) × 100
 *
 * ─── WHY IMPAIRMENT SPLITS FROM interest_and_finance ────────────────────────
 *  Both live under non_operating_expenses in ACCOUNT_TAXONOMY.
 *  But on the IS face, impairment_loss sits ABOVE the operating profit line,
 *  while interest_payable, bank_charges etc. sit BELOW it.
 *  The split is driven by subcategory — no account codes needed.
 *
 * ─── NOTE NUMBERING ──────────────────────────────────────────────────────────
 *  Note numbers (1, 2, 3 …) assigned sequentially top-to-bottom in IS order
 *  to any note group that has a non-zero balance. No numbers are hardcoded.
 */

// ─────────────────────────────────────────────────────────────────────────────
// TAXONOMY KEY NORMALISER
// Converts the free-text `type` column to the snake_case taxonomy key.
// "Non-operating expenses" → "non_operating_expenses"
// "Cost of sales"          → "cost_of_sales"
// ─────────────────────────────────────────────────────────────────────────────
function toTaxonomyKey(rawType) {
  if (!rawType) return "";
  return rawType.trim().toLowerCase().replace(/[-\s]+/g, "_");
}

// ─────────────────────────────────────────────────────────────────────────────
// IS SECTION CLASSIFIER
// Maps (account_nature, taxonomyKey, subcategory) → one of 7 IS buckets.
//
// The key insight: non_operating_expenses is split into TWO buckets
// based on subcategory:
//   subcategory = 'impairment_loss'  → "impairment"    (before op profit)
//   everything else                  → "interest"      (after op profit)
// ─────────────────────────────────────────────────────────────────────────────

// Subcategories under non_operating_expenses that belong ABOVE operating profit.
// Add more here if your taxonomy grows (e.g. 'write_off_losses', 'loss_on_disposal').
const ABOVE_OP_PROFIT_SUBCATS = new Set(["impairment_loss"]);

/**
 * Returns one of:
 *   "turnover" | "other_income" | "cost_of_sales" | "admin_costs" |
 *   "impairment" | "interest" | "taxes"
 * Prefer explicit pl_line when set on the account.
 */
function classifySection(accountNature, rawType, subcategory, plLine) {
  const explicit = String(plLine || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_");
  const PL_LINE_MAP = {
    turnover: "turnover",
    other_income: "other_income",
    cost_of_sales: "cost_of_sales",
    admin_costs: "admin_costs",
    finance: "interest",
    interest: "interest",
    tax: "taxes",
    taxes: "taxes",
    impairment: "impairment",
  };
  if (explicit && PL_LINE_MAP[explicit]) {
    return PL_LINE_MAP[explicit];
  }

  const key = toTaxonomyKey(rawType);

  if (accountNature === "REVENUE") {
    if (key.includes("non_operating")) return "other_income";
    if (key.includes("operating"))     return "turnover";
    return "other_income"; // fallback
  }

  if (accountNature === "EXPENSE") {
    if (key === "cost_of_sales")      return "cost_of_sales";
    if (key === "operating_expenses") return "admin_costs";
    if (key === "taxes")              return "taxes";

    if (key === "non_operating_expenses") {
      // Split by subcategory: impairment goes above op profit, rest goes below
      return ABOVE_OP_PROFIT_SUBCATS.has(subcategory) ? "impairment" : "interest";
    }

    return "admin_costs"; // safe fallback for any unrecognised operating type
  }

  return "other";
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLER
// ─────────────────────────────────────────────────────────────────────────────
exports.getIncomeStatement = async (req, res) => {
  try {
    const { facilityId, fromDate, toDate } = req.body;

    if (!facilityId) {
      return res.status(400).json({ success: false, message: "facilityId is required" });
    }

    // ── 1. Resolve period dates ──────────────────────────────────────────────
    let startDate = fromDate;
    if (!startDate) {
      const [row] = await db.sequelize.query(
        `SELECT MIN(transaction_date) AS earliest
         FROM general_ledger
         WHERE facility_id = :facilityId
           AND type        != 'opening_balance'`,
        { replacements: { facilityId }, type: QueryTypes.SELECT }
      );
      startDate = row?.earliest || `${new Date().getFullYear()}-01-01`;
    }
    const endDate = toDate || new Date().toISOString().slice(0, 10);

    // ── 2. Fetch note-group headers (display=0, non-root) ────────────────────
    // Each of these becomes one line on the FACE of the report with a Note ref.
    const noteGroups = await db.sequelize.query(
      `SELECT
         code,
         parent_code,
         description,
         type          AS account_type,
         subcategory,
         account_nature,
         pl_line
       FROM account_category
       WHERE facility_id    = :facilityId
         AND account_nature IN ('REVENUE', 'EXPENSE')
         AND display        = 0
         AND parent_code   != '0'
         AND is_active      = 1
       ORDER BY code ASC`,
      { replacements: { facilityId }, type: QueryTypes.SELECT }
    );

    // ── 3. Fetch line-item balances for the period (one query) ───────────────
    const lineItems = await db.sequelize.query(
      `SELECT
         ac.code                              AS account_code,
         ac.parent_code                       AS note_group_code,
         ac.description                       AS account_name,
         ac.subcategory,
         ac.account_nature,
         ac.pl_line,
         COALESCE(SUM(gl.cr - gl.dr), 0)     AS cr_net,
         COALESCE(SUM(gl.dr - gl.cr), 0)     AS dr_net
       FROM account_category ac
       LEFT JOIN general_ledger gl
         ON  gl.account_code     = ac.code
         AND gl.facility_id      = :facilityId
         AND gl.transaction_date BETWEEN :startDate AND :endDate
         AND gl.type             != 'opening_balance'
       WHERE ac.facility_id    = :facilityId
         AND ac.account_nature IN ('REVENUE', 'EXPENSE')
         AND ac.display        = 1
         AND ac.is_active      = 1
       GROUP BY
         ac.code, ac.parent_code, ac.description,
         ac.subcategory, ac.account_nature, ac.pl_line
       ORDER BY ac.code ASC`,
      { replacements: { facilityId, startDate, endDate }, type: QueryTypes.SELECT }
    );

    // ── 4. Build note-group map ──────────────────────────────────────────────
    const noteGroupMap = {};
    for (const grp of noteGroups) {
      const subcategory = grp.subcategory || "";
      noteGroupMap[grp.code] = {
        noteGroupCode : grp.code,
        description   : grp.description,
        accountType   : grp.account_type,
        taxonomyKey   : toTaxonomyKey(grp.account_type),
        subcategory,
        accountNature : grp.account_nature,
        isSection     : classifySection(grp.account_nature, grp.account_type, subcategory, grp.pl_line),
        items         : [],
        total         : 0,
        noteRef       : null,
      };
    }

    // ── 5. Assign line items to their note groups ────────────────────────────
    // Flat CoAs (leaf under root only) have no display=0 intermediate groups.
    // In that case treat each leaf as its own face line / note group.
    for (const item of lineItems) {
      let grp = noteGroupMap[item.note_group_code];
      if (!grp) {
        const subcategory = item.subcategory || "";
        const key = item.account_code;
        if (!noteGroupMap[key]) {
          noteGroupMap[key] = {
            noteGroupCode: key,
            description: item.account_name,
            accountType: item.account_type || item.subcategory || "",
            taxonomyKey: toTaxonomyKey(item.account_type || item.subcategory || ""),
            subcategory,
            accountNature: item.account_nature,
            isSection: classifySection(
              item.account_nature,
              item.account_type || item.subcategory || "",
              subcategory,
              item.pl_line,
            ),
            items: [],
            total: 0,
            noteRef: null,
          };
        }
        grp = noteGroupMap[key];
      }

      // Sign convention (IS perspective):
      //   REVENUE: positive = income  → use cr_net
      //   EXPENSE: positive = cost    → use dr_net
      const amount =
        item.account_nature === "REVENUE"
          ? parseFloat(item.cr_net)
          : parseFloat(item.dr_net);

      if (amount === 0) continue;

      grp.items.push({ accountCode: item.account_code, name: item.account_name, amount });
      grp.total += amount;
    }

    // ── 6. Bucket note groups into IS sections ───────────────────────────────
    const sections = {
      turnover    : [],
      other_income: [],
      cost_of_sales: [],
      admin_costs : [],
      impairment  : [],   // ← ABOVE operating profit (impairment_loss subcategory)
      interest    : [],   // ← BELOW operating profit (interest, bank charges, forex, etc.)
      taxes       : [],
    };

    for (const grp of Object.values(noteGroupMap)) {
      const bucket = sections[grp.isSection];
      if (bucket) bucket.push(grp);
    }

    // Stable ordering within each section
    Object.values(sections).forEach((s) =>
      s.sort((a, b) => a.noteGroupCode.localeCompare(b.noteGroupCode))
    );

    // ── 7. Assign sequential Note reference numbers in IS face order ─────────
    // Numbers are only assigned to groups with a non-zero balance.
    // Order matches the face of the report top-to-bottom.
    const IS_ORDER = [
      sections.turnover,
      sections.other_income,
      sections.cost_of_sales,
      sections.admin_costs,
      sections.impairment,
      sections.interest,
      sections.taxes,
    ];

    let noteCounter = 1;
    for (const bucket of IS_ORDER) {
      for (const grp of bucket) {
        if (grp.total !== 0) grp.noteRef = noteCounter++;
      }
    }

    // ── 8. Compute IS totals ─────────────────────────────────────────────────
    const sum = (bucket) => bucket.reduce((acc, g) => acc + g.total, 0);

    const totalTurnover      = sum(sections.turnover);
    const totalCostOfSales   = sum(sections.cost_of_sales);
    const grossProfit        = totalTurnover - totalCostOfSales;

    const totalOtherIncome   = sum(sections.other_income);
    const totalAdminCosts    = sum(sections.admin_costs);
    const totalImpairment    = sum(sections.impairment);

    const operatingProfit    = grossProfit + totalOtherIncome - totalAdminCosts - totalImpairment;

    const totalInterest      = sum(sections.interest);
    const profitBeforeTax    = operatingProfit - totalInterest;

    const totalTaxation      = sum(sections.taxes);
    const profitAfterTax     = profitBeforeTax - totalTaxation;

    // ── 9. EPS — profit after tax ÷ issued shares (from equity share capital GL) ──
    const PAR_VALUE = 1;
    const shareCapital = await fetchShareCapitalForEps(facilityId, endDate);
    const preferenceDividends = await fetchPreferenceDividends(
      facilityId,
      startDate,
      endDate,
    );
    const epsPackage = computeEpsPackage(
      profitAfterTax,
      shareCapital,
      preferenceDividends,
      PAR_VALUE,
    );
    const {
      profitAttributableToOrdinary,
      numberOfShares: numShares,
      epsKobo,
    } = epsPackage;

    // ── 10. Build and return response ────────────────────────────────────────
    return res.json({
      success: true,
      data: {

        meta: {
          facilityId,
          period  : { from: startDate, to: endDate },
          currency: "NGN",
          title   : "STATEMENT OF PROFIT OR LOSS AND OTHER COMPREHENSIVE INCOME",
        },

        // ── Face of the Income Statement ──────────────────────────────────
        // Row order matches the screenshot exactly (top → bottom).
        // The `rows` array is an ordered list — the frontend iterates it
        // sequentially to render each line, subtotal, and section header.
        incomeStatement: {

          // Ordered rows — mirrors the printed report face line by line.
          // `rowType` tells the frontend how to style/render each entry:
          //   "item"     → normal data row with noteRef + amount
          //   "subtotal" → bold single-underline subtotal row
          //   "total"    → bold double-underline total row
          //   "header"   → section label with no amount (e.g. "PROFIT OR LOSS ACCOUNT")
          //   "spacer"   → blank row between sections
          //   "perShare" → shaded per-share data block at the bottom
          rows: [

            // 1. Turnover
            ...sections.turnover.map((g) => toRow("item", g.description, g.noteRef, r(g.total))),

            // 2. Cost of sales  (shown as negative on the face)
            ...sections.cost_of_sales.map((g) => toRow("item", g.description, g.noteRef, r(-g.total))),

            // 3. Gross profit
            toRow("subtotal", "Gross profit", null, r(grossProfit)),

            // 4. Other income
            ...sections.other_income.map((g) => toRow("item", g.description, g.noteRef, r(g.total))),

            // 5. Administrative costs  (negative)
            ...sections.admin_costs.map((g) => toRow("item", g.description, g.noteRef, r(-g.total))),

            // 6. Impairment Loss  (negative)
            ...sections.impairment.map((g) => toRow("item", g.description, g.noteRef, r(-g.total))),

            // 7. Operating profit before interest payable
            toRow("subtotal", "Operating profit before interest payable", null, r(operatingProfit)),

            // 8. Interest payable and similar charges  (negative)
            ...sections.interest.map((g) => toRow("item", g.description, g.noteRef, r(-g.total))),

            // 9. Profit/(Loss) on ordinary activities before taxation
            toRow("subtotal", "Profit/(Loss) on ordinary activities before taxation", null, r(profitBeforeTax)),

            // 10. Section label (no amount column)
            toRow("header", "PROFIT OR LOSS ACCOUNT", null, null),

            // 11. Taxation  (credit = positive relief; debit = charge shown negative)
            ...sections.taxes.map((g) => toRow("item", g.description, g.noteRef, r(g.total))),

            // 12. Profit/(Loss) on ordinary activities after taxation
            toRow("total", "Profit/(Loss) on ordinary activities after taxation", null, r(profitAfterTax)),

          ],

          // ── Computed subtotals (also available individually for API consumers) ──
          totals: {
            turnover              : r(totalTurnover),
            costOfSales           : r(totalCostOfSales),
            grossProfit           : r(grossProfit),
            otherIncome           : r(totalOtherIncome),
            administrativeCosts   : r(totalAdminCosts),
            impairmentLoss        : r(totalImpairment),
            operatingProfit       : r(operatingProfit),
            interestPayable       : r(totalInterest),
            profitBeforeTax       : r(profitBeforeTax),
            taxation              : r(totalTaxation),
            profitAfterTax        : r(profitAfterTax),
          },

          // ── Per Share Data (Kobo) ─────────────────────────────────────
          // Rendered as a shaded block below the double-underline total,
          // matching the salmon/peach highlight in the screenshot.
          perShareData: {
            label            : "Per share data (Kobo):",
            shareCapital     : r(epsPackage.shareCapital),
            preferenceDividends : r(epsPackage.preferenceDividends),
            profitAttributableToOrdinary : r(profitAttributableToOrdinary),
            numberOfShares   : numShares,
            parValuePerShare : PAR_VALUE,
            earningsPerShareKobo: epsKobo,
            earningsPerShare : {
              label     : "Earnings per share",
              valueKobo : epsKobo,
            },
          },
        },

        // ── Notes to the Accounts ─────────────────────────────────────────
        // One entry per note group with activity.
        // Frontend renders these as expandable panels keyed by noteRef.
        notes: buildNotes(IS_ORDER),

      },
    });

  } catch (err) {
    console.error("Income Statement Error:", err);
    return res.status(500).json({
      success: false,
      message: "Error generating income statement",
      error  : err.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Share capital balance for EPS (equity share_capital subcategory or description match). */
async function fetchShareCapitalForEps(facilityId, endDate) {
  const [row] = await db.sequelize.query(
    `SELECT COALESCE(SUM(gl.cr - gl.dr), 0) AS share_capital
     FROM account_category ac
     JOIN general_ledger gl
       ON  gl.account_code = ac.code
       AND gl.facility_id  = :facilityId
       AND gl.transaction_date <= :endDate
     WHERE ac.facility_id    = :facilityId
       AND ac.account_nature = 'EQUITY'
       AND ac.display        = 1
       AND ac.is_active      = 1
       AND (
         ac.subcategory IN ('share_capital', 'ordinary_share_capital')
         OR LOWER(TRIM(ac.description)) LIKE '%share capital%'
         OR LOWER(TRIM(ac.description)) LIKE '%ordinary share%'
       )`,
    {
      replacements: { facilityId: String(facilityId), endDate },
      type: QueryTypes.SELECT,
    },
  );
  return Math.max(0, parseFloat(row?.share_capital || 0));
}

async function fetchPreferenceDividends(facilityId, startDate, endDate) {
  const [row] = await db.sequelize.query(
    `SELECT COALESCE(SUM(gl.dr - gl.cr), 0) AS preference_dividends
     FROM account_category ac
     JOIN general_ledger gl
       ON  gl.account_code = ac.code
       AND gl.facility_id  = :facilityId
       AND gl.transaction_date BETWEEN :startDate AND :endDate
       AND gl.type   != 'opening_balance'
     WHERE ac.facility_id    = :facilityId
       AND ac.subcategory    = 'preference_dividends'
       AND ac.display        = 1
       AND ac.is_active      = 1`,
    {
      replacements: { facilityId: String(facilityId), startDate, endDate },
      type: QueryTypes.SELECT,
    },
  );
  return parseFloat(row?.preference_dividends || 0);
}

function computeEpsPackage(profitAfterTax, shareCapital, preferenceDividends = 0, parValue = 1) {
  const preference = parseFloat(preferenceDividends || 0);
  const profitAttributableToOrdinary = profitAfterTax - preference;
  const numShares =
    shareCapital > 0 && parValue > 0 ? shareCapital / parValue : 0;
  const epsKobo =
    numShares > 0
      ? parseFloat(((profitAttributableToOrdinary / numShares) * 100).toFixed(3))
      : null;
  return {
    shareCapital,
    preferenceDividends: preference,
    profitAttributableToOrdinary,
    numberOfShares: numShares,
    parValuePerShare: parValue,
    epsKobo,
  };
}

function r(n) {
  return parseFloat((n || 0).toFixed(2));
}

/**
 * Builds one ordered row for incomeStatement.rows.
 * @param {"item"|"subtotal"|"total"|"header"} rowType
 * @param {string}      description  Label shown on the report face
 * @param {number|null} noteRef      Note number; null for subtotals/headers
 * @param {number|null} amount       Signed amount (sign already applied by caller)
 */
function toRow(rowType, description, noteRef, amount) {
  return { rowType, description, noteRef: noteRef || null, amount: amount ?? null };
}

/**
 * Notes section — ordered top-to-bottom in IS sequence.
 * Only includes note groups that have a non-zero balance and a noteRef.
 */
function buildNotes(isOrder) {
  return isOrder
    .flat()
    .filter((g) => g.noteRef != null && g.total !== 0)
    .map((grp) => ({
      noteRef     : grp.noteRef,
      title       : grp.description,
      subcategory : grp.subcategory,
      taxonomyKey : grp.taxonomyKey,
      isSection   : grp.isSection,
      items       : grp.items.map((i) => ({
        accountCode : i.accountCode,
        name        : i.name,
        amount      : r(i.amount),
      })),
      total: r(grp.total),
    }));
}

/**
 * Statement of Financial Position — comparative columns from account_category + general_ledger.
 * Major bands: ASSETS / LIABILITIES / EQUITY. Hierarchy is account code + parent_code only (no
 * current/non-current classification split). Detail rows only include accounts with a non-zero
 * balance in the current and/or prior column; section totals still reconcile. Prior period
 * defaults to same calendar day one year earlier if not supplied.
 */
exports.getStatementOfFinancialPosition = async (req, res) => {
  try {
    const { facilityId, asOfDate, asOfDatePrior: priorInput } = req.body;

    if (!facilityId || !asOfDate) {
      return res.status(400).json({
        success: false,
        message: "facilityId and asOfDate are required",
      });
    }

    const asOfDatePrior =
      priorInput || moment(asOfDate).subtract(1, "year").format("YYYY-MM-DD");

    // ── 1. Fetch BS rows (display filter removed — see previous fix) ──────────
    const sofpFetchOpts = { includeZeroHeadAccounts: true };
    const [d1, d2] = await Promise.all([
      fetchBalanceSheetRows(facilityId, asOfDate, sofpFetchOpts),
      fetchBalanceSheetRows(facilityId, asOfDatePrior, sofpFetchOpts),
    ]);

    // ── 2. Fetch net income for BOTH periods ──────────────────────────────────
    // Net income = revenue (cr-dr) − expense (dr-cr) via account_nature.
    // AaErp CoA uses 6xx revenue / 7–8xx expense (not classic 4/5). No status filter.
    const netIncomeQuery = `
      SELECT
        COALESCE(SUM(
          CASE
            WHEN ac.account_nature = 'REVENUE' THEN (gl.cr - gl.dr)
            WHEN ac.account_nature = 'EXPENSE' THEN -(gl.dr - gl.cr)
            ELSE 0
          END
        ), 0) AS net_income
      FROM account_category ac
      LEFT JOIN general_ledger gl
        ON  ac.code        = gl.account_code
        AND gl.facility_id = :facilityId
        AND gl.transaction_date <= :asOfDate
      WHERE ac.facility_id = :facilityId
        AND ac.account_nature IN ('REVENUE', 'EXPENSE')
        AND ac.is_active = 1
    `;

    const [[ni1Raw], [ni2Raw]] = await Promise.all([
      db.sequelize.query(netIncomeQuery, {
        replacements: { facilityId, asOfDate },
        type: QueryTypes.SELECT,
      }),
      db.sequelize.query(netIncomeQuery, {
        replacements: { facilityId, asOfDate: asOfDatePrior },
        type: QueryTypes.SELECT,
      }),
    ]);

    const currentYearEarnings1 = parseFloat(ni1Raw?.net_income || 0);
    const currentYearEarnings2 = parseFloat(ni2Raw?.net_income || 0);

    // ── 3. Totals from raw rows (BEFORE merging — r.amount exists here) ───────
    const sumAllAmt = (rows) =>
      (rows || []).reduce((s, r) => s + parseFloat(r.amount || 0), 0);

    const totalAssets1      = sumAllAmt(d1.assets);
    const totalAssets2      = sumAllAmt(d2.assets);
    const totalLiabilities1 = sumAllAmt(d1.liabilities);
    const totalLiabilities2 = sumAllAmt(d2.liabilities);

    // Equity totals include current year earnings
    const permanentEquity1  = sumAllAmt(d1.equity);
    const permanentEquity2  = sumAllAmt(d2.equity);
    const equity1           = permanentEquity1 + currentYearEarnings1;
    const equity2           = permanentEquity2 + currentYearEarnings2;

    // ── 4. Merge + sort + filter for display ─────────────────────────────────
    const sortCoa = (a, b) =>
      String(a.account_code).localeCompare(String(b.account_code));

    const assetsMerged = mergeComparativeByCode(d1.assets, d2.assets)
      .sort(sortCoa)
      .filter(sofpMergedRowHasBalance);

    const liabilitiesMerged = mergeComparativeByCode(d1.liabilities, d2.liabilities)
      .sort(sortCoa)
      .filter(sofpMergedRowHasBalance);

    const equityMerged = mergeComparativeByCode(d1.equity, d2.equity)
      .sort(sortCoa)
      .filter(sofpMergedRowHasBalance);

    // ── 5. Build segment rows (async tree builder) ────────────────────────────
    const [assetSegmentRows, liabilitySegmentRows, equitySegmentRows] =
      await Promise.all([
        buildSofpSegmentRows(assetsMerged, facilityId),
        buildSofpSegmentRows(liabilitiesMerged, facilityId),
        buildSofpSegmentRows(equityMerged, facilityId),
      ]);

    // Guardrail: if hierarchy building yields nothing for a section but merged rows exist,
    // render flat lines so the statement never shows totals-only.
    const assetRowsFinal =
      assetSegmentRows.length > 0
        ? assetSegmentRows
        : toSofpFlatLineRows(assetsMerged);
    const liabilityRowsFinal =
      liabilitySegmentRows.length > 0
        ? liabilitySegmentRows
        : toSofpFlatLineRows(liabilitiesMerged);
    const equityRowsFinal =
      equitySegmentRows.length > 0
        ? equitySegmentRows
        : toSofpFlatLineRows(equityMerged);

    // ── 6. Append Current Year Earnings as a synthetic equity line ────────────
    // Only add when non-zero in at least one period
    if (Math.abs(currentYearEarnings1) > 0.005 || Math.abs(currentYearEarnings2) > 0.005) {
      equityRowsFinal.push({
        type: "line",
        label: "Current year earnings",
        note: "P&L",
        current: currentYearEarnings1,
        prior:   currentYearEarnings2,
        synthetic: true,           // flag so the UI can style it differently if needed
      });
    }

    // ── 7. Assemble rows array ────────────────────────────────────────────────
    const rows = [];

    rows.push({ type: "section", label: "ASSETS", sectionLevel: 1 });
    for (const line of assetRowsFinal) rows.push(line);
    rows.push({
      type: "subtotal",
      label: "TOTAL ASSETS",
      current: totalAssets1,
      prior: totalAssets2,
      emphasize: true,
      doubleUnderline: true,
    });
    rows.push({ type: "spacer" });

    rows.push({ type: "section", label: "LIABILITIES", sectionLevel: 1 });
    for (const line of liabilityRowsFinal) rows.push(line);
    rows.push({ type: "spacer" });
    rows.push({
      type: "subtotal",
      label: "Total Liabilities",
      current: totalLiabilities1,
      prior: totalLiabilities2,
      emphasize: true,
    });
    rows.push({ type: "spacer" });

    rows.push({ type: "section", label: "EQUITY", sectionLevel: 1 });
    for (const line of equityRowsFinal) rows.push(line);

    // Equity subtotal uses the COMBINED figure (permanent + current year earnings)
    if (
      equityRowsFinal.length > 0 ||
      Math.abs(equity1) > 0.005 ||
      Math.abs(equity2) > 0.005
    ) {
      rows.push({
        type: "subtotal",
        label: "Total Equity",
        current: equity1,
        prior: equity2,
        underline: true,
      });
    }
    rows.push({ type: "spacer" });

    rows.push({
      type: "subtotal",
      label: "TOTAL LIABILITIES + EQUITY",
      current: totalLiabilities1 + equity1,
      prior: totalLiabilities2 + equity2,
      emphasize: true,
      doubleUnderline: true,
    });

    // ── 8. Validation ─────────────────────────────────────────────────────────
    const balanceCheck      = Math.abs(totalAssets1 - (totalLiabilities1 + equity1));
    const balanceCheckPrior = Math.abs(totalAssets2 - (totalLiabilities2 + equity2));

    // Any residual imbalance after including net income points to data issues
    const buildValidationNote = (diff, nye) => {
      if (diff <= SOFP_BALANCE_TOLERANCE_NAIRA) return null;
      const parts = [];
      if (Math.abs(nye) > 0.005)
        parts.push(`Current year earnings of ₦${Math.abs(nye).toLocaleString("en-NG", { minimumFractionDigits: 2 })} have been included in equity`);
      parts.push(`Residual difference of ₦${diff.toLocaleString("en-NG", { minimumFractionDigits: 2 })} — verify opening balances and GL postings`);
      return parts.join(". ");
    };

    return res.json({
      success: true,
      data: {
        asOfDate,
        asOfDatePrior,
        facilityId,
        currencyLabel: "₦",
        yearLabels: {
          current: formatYearLabel(asOfDate),
          prior:   formatYearLabel(asOfDatePrior),
        },
        rows,
        summary: {
          totalAssets:       { current: totalAssets1,      prior: totalAssets2 },
          totalLiabilities:  { current: totalLiabilities1, prior: totalLiabilities2 },
          totalEquity:       { current: equity1,            prior: equity2 },
          currentYearEarnings: { current: currentYearEarnings1, prior: currentYearEarnings2 },
          permanentEquity:   { current: permanentEquity1,  prior: permanentEquity2 },
        },
        validation: {
          balancedCurrent:    balanceCheck <= SOFP_BALANCE_TOLERANCE_NAIRA,
          balancedPrior:      balanceCheckPrior <= SOFP_BALANCE_TOLERANCE_NAIRA,
          differenceCurrent:  balanceCheck,
          differencePrior:    balanceCheckPrior,
          noteCurrent:        buildValidationNote(balanceCheck, currentYearEarnings1),
          notePrior:          buildValidationNote(balanceCheckPrior, currentYearEarnings2),
        },
        meta: {
          reportTitle:             "Statement of Financial Position",
          reportTitleUpper:        "STATEMENT OF FINANCIAL POSITION",
          currentAsOfFormatted:    formatStatementHeaderDate(asOfDate),
          priorAsOfFormatted:      formatStatementHeaderDate(asOfDatePrior),
          periodLine:              `As of ${formatStatementHeaderDate(asOfDate)}`,
          comparativeLine:         `Comparative period end: ${formatStatementHeaderDate(asOfDatePrior)}`,
        },
      },
    });
  } catch (error) {
    console.error("Statement of Financial Position Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error generating statement of financial position",
      error: error.message,
    });
  }
};

// Keep backward compatibility for existing route naming.
exports.getBalanceSheet = exports.getStatementOfFinancialPosition;

// Cash Flow Statement
/**
 * Cash Flow Statement Controller
 * Uses the Indirect Method (as per the United Gases Ltd format):
 *  - Operating Activities: Net Profit + Non-cash adjustments + Working Capital Changes
 *  - Investing Activities: Asset (Fixed/Non-current) purchases and disposals
 *  - Financing Activities: Equity movements, long-term liabilities, dividends
 *
 * All data is derived from account_category (category, type, subcategory, code, parent_code)
 * joined to general_ledger — NO hardcoded values.
 */
exports.getCashFlowStatement = async (req, res) => {
  try {
    const { facilityId, fromDate, toDate } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
      });
    }

    const endDate = toDate || new Date().toISOString().split("T")[0];

    // ── Resolve start date ──────────────────────────────────────────────────
    let startDate = fromDate;
    if (!startDate) {
      const [[earliest]] = await db.sequelize.query(
        `SELECT MIN(transaction_date) AS earliest_date
         FROM general_ledger
         WHERE facility_id = :facilityId`,
        { replacements: { facilityId }, type: QueryTypes.SELECT }
      );
      startDate = earliest?.earliest_date || new Date().getFullYear() + "-01-01";
    }

    // AaErp CoA often leaves subcategory null and tags banks as "Current assets".
    // Match cash/bank by subcategory, type, category, description, or cash hierarchy codes.
    const SQL_IS_CASH_OR_BANK = `(
      LOWER(COALESCE(ac.subcategory, '')) IN (
        'cash','bank','cash and bank','cash & bank','petty cash','overdraft','bank overdraft'
      )
      OR LOWER(COALESCE(ac.type, '')) IN (
        'cash','bank','cash and bank','cash & bank','overdraft'
      )
      OR LOWER(COALESCE(ac.category, '')) IN (
        'cash','bank','cash and cash equivalents'
      )
      OR LOWER(COALESCE(ac.description, '')) LIKE '%cash%'
      OR LOWER(COALESCE(ac.description, '')) LIKE '%bank%'
      OR ac.code IN ('112199', '112200', '112201')
      OR ac.parent_code IN ('112200', '112201')
    )`;

    // ════════════════════════════════════════════════════════════════════════
    // 1. NET PROFIT FOR THE PERIOD
    //    Revenue (cr - dr)  minus  Expense (dr - cr) — no GL status filter
    // ════════════════════════════════════════════════════════════════════════
    const netProfitQuery = `
      SELECT
        ac.account_nature,
        COALESCE(SUM(gl.cr), 0) AS total_cr,
        COALESCE(SUM(gl.dr), 0) AS total_dr
      FROM account_category ac
      LEFT JOIN general_ledger gl
             ON ac.code = gl.account_code
            AND gl.facility_id    = :facilityId
            AND gl.transaction_date BETWEEN :startDate AND :endDate
      WHERE ac.facility_id    = :facilityId
        AND ac.account_nature IN ('REVENUE','EXPENSE')
        AND ac.is_active = 1
      GROUP BY ac.account_nature
    `;

    // ════════════════════════════════════════════════════════════════════════
    // 2. NON-CASH / ADJUSTMENT ITEMS
    // ════════════════════════════════════════════════════════════════════════
    const adjustmentsQuery = `
      SELECT
        ac.code           AS account_code,
        ac.description    AS account_name,
        ac.category,
        ac.type,
        ac.subcategory,
        ac.account_nature,
        COALESCE(SUM(gl.dr), 0) AS debit,
        COALESCE(SUM(gl.cr), 0) AS credit,
        CASE
          WHEN ac.account_nature IN ('EXPENSE','ASSET')
               THEN COALESCE(SUM(gl.dr - gl.cr), 0)
          ELSE COALESCE(SUM(gl.cr - gl.dr), 0)
        END AS net_amount
      FROM account_category ac
      LEFT JOIN general_ledger gl
             ON ac.code = gl.account_code
            AND gl.facility_id    = :facilityId
            AND gl.transaction_date BETWEEN :startDate AND :endDate
      WHERE ac.facility_id = :facilityId
        AND ac.is_active   = 1
        AND (
          LOWER(COALESCE(ac.subcategory, '')) LIKE '%depreciation%'
          OR LOWER(COALESCE(ac.subcategory, '')) LIKE '%amortisation%'
          OR LOWER(COALESCE(ac.subcategory, '')) LIKE '%amortization%'
          OR LOWER(COALESCE(ac.subcategory, '')) LIKE '%provision%'
          OR LOWER(COALESCE(ac.subcategory, '')) LIKE '%prior year%'
          OR LOWER(COALESCE(ac.subcategory, '')) LIKE '%prior-year%'
          OR LOWER(COALESCE(ac.subcategory, '')) LIKE '%disposal%'
          OR LOWER(COALESCE(ac.subcategory, '')) LIKE '%profit on%'
          OR LOWER(COALESCE(ac.subcategory, '')) LIKE '%loss on%'
          OR LOWER(COALESCE(ac.description, '')) LIKE '%depreciat%'
          OR LOWER(COALESCE(ac.description, '')) LIKE '%amortis%'
        )
        /* P&L charges only — exclude BS contra (Accum. Dep) so add-backs are not cancelled */
        AND LOWER(COALESCE(ac.description, '')) NOT LIKE '%accum%'
        AND LOWER(COALESCE(ac.type, '')) NOT LIKE '%accumulat%'
        AND LOWER(COALESCE(ac.subcategory, '')) NOT LIKE '%accumulat%'
        AND ac.account_nature IN ('EXPENSE', 'LIABILITY', 'EQUITY')
      GROUP BY ac.code, ac.description, ac.category, ac.type,
               ac.subcategory, ac.account_nature
      HAVING COALESCE(SUM(gl.dr), 0) > 0 OR COALESCE(SUM(gl.cr), 0) > 0
      ORDER BY ac.category, ac.subcategory, ac.code
    `;

    // ════════════════════════════════════════════════════════════════════════
    // 3. WORKING CAPITAL CHANGES
    // ════════════════════════════════════════════════════════════════════════
    const workingCapitalQuery = `
      SELECT
        ac.code          AS account_code,
        ac.description   AS account_name,
        ac.category,
        ac.type,
        ac.subcategory,
        ac.account_nature,
        ac.parent_code,
        COALESCE(SUM(gl.dr), 0) AS debit,
        COALESCE(SUM(gl.cr), 0) AS credit,
        CASE
          WHEN ac.account_nature = 'ASSET'
               THEN COALESCE(SUM(gl.cr - gl.dr), 0)
          WHEN ac.account_nature = 'LIABILITY'
               THEN COALESCE(SUM(gl.cr - gl.dr), 0)
          ELSE COALESCE(SUM(gl.cr - gl.dr), 0)
        END AS net_amount
      FROM account_category ac
      LEFT JOIN general_ledger gl
             ON ac.code = gl.account_code
            AND gl.facility_id    = :facilityId
            AND gl.transaction_date BETWEEN :startDate AND :endDate
      WHERE ac.facility_id = :facilityId
        AND ac.is_active   = 1
        AND ac.account_nature IN ('ASSET', 'LIABILITY')
        AND LOWER(COALESCE(ac.type, '')) IN (
          'current assets', 'current asset',
          'current liabilities', 'current liability'
        )
        AND NOT ${SQL_IS_CASH_OR_BANK}
        AND LOWER(COALESCE(ac.subcategory, '')) NOT LIKE '%depreciation%'
        AND LOWER(COALESCE(ac.subcategory, '')) NOT LIKE '%amortis%'
        AND LOWER(COALESCE(ac.subcategory, '')) NOT LIKE '%provision%'
        AND LOWER(COALESCE(ac.subcategory, '')) NOT LIKE '%prior year%'
        AND LOWER(COALESCE(ac.subcategory, '')) NOT LIKE '%disposal%'
        AND LOWER(COALESCE(ac.description, '')) NOT LIKE '%accum.%'
        AND LOWER(COALESCE(ac.description, '')) NOT LIKE '%accumulat%'
      GROUP BY ac.code, ac.description, ac.category, ac.type,
               ac.subcategory, ac.account_nature, ac.parent_code
      HAVING COALESCE(SUM(gl.dr), 0) > 0 OR COALESCE(SUM(gl.cr), 0) > 0
      ORDER BY ac.account_nature DESC, ac.category, ac.type, ac.code
    `;

    // ════════════════════════════════════════════════════════════════════════
    // 4. TAX PAID
    // ════════════════════════════════════════════════════════════════════════
    const taxQuery = `
      SELECT
        ac.code        AS account_code,
        ac.description AS account_name,
        ac.category,
        ac.type,
        ac.subcategory,
        COALESCE(SUM(gl.dr), 0) AS debit,
        COALESCE(SUM(gl.cr), 0) AS credit,
        COALESCE(SUM(gl.dr - gl.cr), 0) AS net_amount
      FROM account_category ac
      LEFT JOIN general_ledger gl
             ON ac.code = gl.account_code
            AND gl.facility_id    = :facilityId
            AND gl.transaction_date BETWEEN :startDate AND :endDate
      WHERE ac.facility_id = :facilityId
        AND ac.is_active   = 1
        AND (
          LOWER(COALESCE(ac.subcategory, '')) LIKE '%tax%'
          OR LOWER(COALESCE(ac.type, ''))     LIKE '%tax%'
          OR LOWER(COALESCE(ac.category, '')) LIKE '%tax%'
        )
      GROUP BY ac.code, ac.description, ac.category, ac.type, ac.subcategory
      HAVING COALESCE(SUM(gl.dr), 0) > 0 OR COALESCE(SUM(gl.cr), 0) > 0
      ORDER BY ac.code
    `;

    // ════════════════════════════════════════════════════════════════════════
    // 5. INVESTING ACTIVITIES
    // ════════════════════════════════════════════════════════════════════════
    const investingQuery = `
      SELECT
        ac.code          AS account_code,
        ac.description   AS account_name,
        ac.category,
        ac.type,
        ac.subcategory,
        ac.parent_code,
        COALESCE(SUM(gl.dr), 0) AS debit,
        COALESCE(SUM(gl.cr), 0) AS credit,
        COALESCE(SUM(gl.cr - gl.dr), 0) AS net_amount
      FROM account_category ac
      LEFT JOIN general_ledger gl
             ON ac.code = gl.account_code
            AND gl.facility_id    = :facilityId
            AND gl.transaction_date BETWEEN :startDate AND :endDate
      WHERE ac.facility_id = :facilityId
        AND ac.account_nature = 'ASSET'
        AND ac.is_active      = 1
        AND LOWER(REPLACE(COALESCE(ac.type, ''), ' ', '')) IN (
          'fixedassets', 'fixedasset',
          'non-currentassets', 'non-currentasset',
          'noncurrentassets', 'noncurrentasset',
          'long-termassets', 'longtermassets',
          'investment', 'investments'
        )
        AND LOWER(COALESCE(ac.subcategory, '')) NOT LIKE '%accumulat%'
        AND LOWER(COALESCE(ac.type, ''))        NOT LIKE '%accumulat%'
        AND LOWER(COALESCE(ac.description, '')) NOT LIKE '%accum.%'
        AND LOWER(COALESCE(ac.description, '')) NOT LIKE '%accumulat%'
      GROUP BY ac.code, ac.description, ac.category, ac.type,
               ac.subcategory, ac.parent_code
      HAVING COALESCE(SUM(gl.dr), 0) > 0 OR COALESCE(SUM(gl.cr), 0) > 0
      ORDER BY ac.category, ac.type, ac.code
    `;

    // ════════════════════════════════════════════════════════════════════════
    // 6. FINANCING ACTIVITIES
    // ════════════════════════════════════════════════════════════════════════
    const financingQuery = `
      SELECT
        ac.code          AS account_code,
        ac.description   AS account_name,
        ac.account_nature,
        ac.category,
        ac.type,
        ac.subcategory,
        ac.parent_code,
        COALESCE(SUM(gl.dr), 0) AS debit,
        COALESCE(SUM(gl.cr), 0) AS credit,
        COALESCE(SUM(gl.cr - gl.dr), 0) AS net_amount
      FROM account_category ac
      LEFT JOIN general_ledger gl
             ON ac.code = gl.account_code
            AND gl.facility_id    = :facilityId
            AND gl.transaction_date BETWEEN :startDate AND :endDate
      WHERE ac.facility_id = :facilityId
        AND ac.is_active   = 1
        AND (
          ac.account_nature = 'EQUITY'
          OR (
            ac.account_nature = 'LIABILITY'
            AND LOWER(COALESCE(ac.type, '')) IN (
              'long-term liabilities','long term liabilities',
              'non-current liabilities','non-current liability',
              'noncurrent liabilities','long-term liability',
              'loan','loans','borrowings','borrowing',
              'deferred', 'deferred liability'
            )
          )
          OR LOWER(COALESCE(ac.subcategory, '')) LIKE '%dividend%'
        )
      GROUP BY ac.code, ac.description, ac.account_nature, ac.category,
               ac.type, ac.subcategory, ac.parent_code
      HAVING COALESCE(SUM(gl.dr), 0) > 0 OR COALESCE(SUM(gl.cr), 0) > 0
      ORDER BY ac.account_nature, ac.category, ac.type, ac.code
    `;

    // ════════════════════════════════════════════════════════════════════════
    // 7. OPENING CASH BALANCE
    // ════════════════════════════════════════════════════════════════════════
    const openingCashQuery = `
      SELECT
        ac.code        AS account_code,
        ac.description AS account_name,
        ac.category,
        ac.type,
        ac.subcategory,
        COALESCE(SUM(gl.dr), 0) AS debit,
        COALESCE(SUM(gl.cr), 0) AS credit,
        COALESCE(SUM(gl.dr - gl.cr), 0) AS net_amount
      FROM account_category ac
      LEFT JOIN general_ledger gl
             ON ac.code = gl.account_code
            AND gl.facility_id    = :facilityId
            AND gl.transaction_date < :startDate
      WHERE ac.facility_id = :facilityId
        AND ac.is_active   = 1
        AND ${SQL_IS_CASH_OR_BANK}
      GROUP BY ac.code, ac.description, ac.category, ac.type, ac.subcategory
      ORDER BY ac.code
    `;

    // ════════════════════════════════════════════════════════════════════════
    // 8. CLOSING CASH BALANCE BREAKDOWN (Bank + Overdraft)
    // ════════════════════════════════════════════════════════════════════════
    const closingCashQuery = `
      SELECT
        ac.code        AS account_code,
        ac.description AS account_name,
        ac.category,
        ac.type,
        ac.subcategory,
        COALESCE(SUM(gl.dr), 0) AS debit,
        COALESCE(SUM(gl.cr), 0) AS credit,
        COALESCE(SUM(gl.dr - gl.cr), 0) AS net_amount
      FROM account_category ac
      LEFT JOIN general_ledger gl
             ON ac.code = gl.account_code
            AND gl.facility_id    = :facilityId
            AND gl.transaction_date <= :endDate
      WHERE ac.facility_id = :facilityId
        AND ac.is_active   = 1
        AND ${SQL_IS_CASH_OR_BANK}
      GROUP BY ac.code, ac.description, ac.category, ac.type, ac.subcategory
      ORDER BY ac.code
    `;

    // ── Run all queries in parallel ─────────────────────────────────────────
    const replacements = { facilityId, startDate, endDate };

    const [
      netProfitRows,
      adjustments,
      workingCapital,
      taxRows,
      investing,
      financing,
      openingCash,
      closingCash,
    ] = await Promise.all([
      db.sequelize.query(netProfitQuery, { replacements, type: QueryTypes.SELECT }),
      db.sequelize.query(adjustmentsQuery, { replacements, type: QueryTypes.SELECT }),
      db.sequelize.query(workingCapitalQuery, { replacements, type: QueryTypes.SELECT }),
      db.sequelize.query(taxQuery, { replacements, type: QueryTypes.SELECT }),
      db.sequelize.query(investingQuery, { replacements, type: QueryTypes.SELECT }),
      db.sequelize.query(financingQuery, { replacements, type: QueryTypes.SELECT }),
      db.sequelize.query(openingCashQuery, {
        replacements: { facilityId, startDate },
        type: QueryTypes.SELECT,
      }),
      db.sequelize.query(closingCashQuery, {
        replacements: { facilityId, endDate },
        type: QueryTypes.SELECT,
      }),
    ]);

    // ── Derive Net Profit ────────────────────────────────────────────────────
    let totalRevenue = 0;
    let totalExpense = 0;
    for (const row of netProfitRows) {
      if (row.account_nature === "REVENUE") {
        totalRevenue += parseFloat(row.total_cr) - parseFloat(row.total_dr);
      } else if (row.account_nature === "EXPENSE") {
        totalExpense += parseFloat(row.total_dr) - parseFloat(row.total_cr);
      }
    }
    const netProfit = totalRevenue - totalExpense;

    // ── Sum adjustments ──────────────────────────────────────────────────────
    const totalAdjustments = adjustments.reduce(
      (sum, r) => sum + parseFloat(r.net_amount),
      0
    );

    // ── Cash flow before working capital changes ─────────────────────────────
    const cashBeforeWorkingCapital = netProfit + totalAdjustments;

    // ── Sum working capital ──────────────────────────────────────────────────
    const totalWorkingCapital = workingCapital.reduce(
      (sum, r) => sum + parseFloat(r.net_amount),
      0
    );

    // ── Tax paid ─────────────────────────────────────────────────────────────
    const totalTaxPaid = taxRows.reduce(
      (sum, r) => sum + parseFloat(r.net_amount),
      0
    );

    // ── Net operating cash flow ──────────────────────────────────────────────
    const netOperatingCashFlow =
      cashBeforeWorkingCapital + totalWorkingCapital - totalTaxPaid;

    // ── Net investing cash flow ──────────────────────────────────────────────
    const netInvestingCashFlow = investing.reduce(
      (sum, r) => sum + parseFloat(r.net_amount),
      0
    );

    // ── Net financing cash flow ──────────────────────────────────────────────
    const netFinancingCashFlow = financing.reduce(
      (sum, r) => sum + parseFloat(r.net_amount),
      0
    );

    // ── Net increase / (decrease) in cash ───────────────────────────────────
    const netCashIncrease =
      netOperatingCashFlow + netInvestingCashFlow + netFinancingCashFlow;

    // ── Opening cash balance ─────────────────────────────────────────────────
    const openingCashBalance = openingCash.reduce(
      (sum, r) => sum + parseFloat(r.net_amount),
      0
    );

    // ── Closing cash balance ─────────────────────────────────────────────────
    //    Separate bank balances from overdraft accounts
    const bankBalances = closingCash.filter((r) => {
      const sub = (r.subcategory || "").toLowerCase();
      const name = (r.account_name || "").toLowerCase();
      return !sub.includes("overdraft") && !name.includes("overdraft");
    });
    const overdraftBalances = closingCash.filter((r) => {
      const sub = (r.subcategory || "").toLowerCase();
      const name = (r.account_name || "").toLowerCase();
      return sub.includes("overdraft") || name.includes("overdraft");
    });

    const totalBankBalance = bankBalances.reduce(
      (sum, r) => sum + parseFloat(r.net_amount),
      0
    );
    const totalOverdraft = overdraftBalances.reduce(
      (sum, r) => sum + parseFloat(r.net_amount),
      0
    );
    const closingCashBalance = totalBankBalance + totalOverdraft;

    // ════════════════════════════════════════════════════════════════════════
    // RESPONSE — mirrors the statement structure in the screenshot
    // ════════════════════════════════════════════════════════════════════════
    return res.json({
      success: true,
      data: {
        period: { from: startDate, to: endDate },
        facilityId,

        // ── Section 1: Operating Activities ─────────────────────────────
        operatingActivities: {
          netProfitForPeriod: parseFloat(netProfit.toFixed(2)),

          // "Add: Items not involving movement of cash"
          nonCashAdjustments: {
            items: adjustments,
            total: parseFloat(totalAdjustments.toFixed(2)),
          },

          // Subtotal before working capital
          cashBeforeWorkingCapital: parseFloat(
            cashBeforeWorkingCapital.toFixed(2)
          ),

          // Changes in working capital
          workingCapitalChanges: {
            items: workingCapital,
            total: parseFloat(totalWorkingCapital.toFixed(2)),
          },

          // Tax paid during the year
          taxPaid: {
            items: taxRows,
            total: parseFloat((-Math.abs(totalTaxPaid)).toFixed(2)), // always outflow
          },

          netCashFlow: parseFloat(netOperatingCashFlow.toFixed(2)),
        },

        // ── Section 2: Investing Activities ─────────────────────────────
        investingActivities: {
          items: investing,
          netCashFlow: parseFloat(netInvestingCashFlow.toFixed(2)),
        },

        // ── Section 3: Financing Activities ─────────────────────────────
        financingActivities: {
          items: financing,
          netCashFlow: parseFloat(netFinancingCashFlow.toFixed(2)),
        },

        // ── Summary ──────────────────────────────────────────────────────
        summary: {
          netIncreaseInCash: parseFloat(netCashIncrease.toFixed(2)),
          openingCashBalance: parseFloat(openingCashBalance.toFixed(2)),

          // Represented by (closing position detail)
          representedBy: {
            bankAndCashBalances: {
              items: bankBalances,
              total: parseFloat(totalBankBalance.toFixed(2)),
            },
            bankOverdraft: {
              items: overdraftBalances,
              total: parseFloat(totalOverdraft.toFixed(2)),
            },
            closingCashBalance: parseFloat(closingCashBalance.toFixed(2)),
          },
        },
      },
    });
  } catch (error) {
    console.error("Cash Flow Statement Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error generating cash flow statement",
      error: error.message,
    });
  }
};

/**
 * STATEMENT OF CHANGES IN EQUITY CONTROLLER
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates the SOCE matching the United Gases screenshot format exactly.
 *
 * YOUR DATA (from CoA + GL inspection):
 *
 *  Equity accounts (display=1):
 *    300003  share_capital       → "Share Capital"         OB: 30,000,000
 *    300004  retained_earnings   → "Retained Earnings"     OB: 0 (current P&L)
 *    300005  retained_earnings   → "Retained Earnings"     OB: 65,000,000 (appropriation)
 *    300006  revaluation_reserve → "Revaluation Reserve"   OB: 0
 *    300007  other_reserves      → "Other Reserves"        OB: 5,000,000
 *    300009-300014 other_reserves → "Other Reserves"       OB: 0
 *
 *  GL type values (from ENUM in general_ledger):
 *    opening_balance → Opening Balance row
 *    journal_entry   → used for dividends, adjustments — identified by purpose_of_payment
 *    revenue/expenses/tax/bank/payment/etc → Profit for the Year (via P&L transfer)
 *
 *  COLUMNS (dynamic — only subcategories with activity appear):
 *    Share Capital | Retained Earnings | Revaluation Reserve | Other Reserves | Total
 *
 *  ROW ORDER per period block (screenshot order):
 *    Balance As At 1 January {year}      ← opening_balance type
 *    Prior year adjustment               ← journal_entry WHERE purpose LIKE 'prior%adjust%'
 *    Prior year Dividend paid            ← journal_entry WHERE purpose LIKE 'prior%dividend%'
 *    Dividend paid                       ← journal_entry WHERE purpose LIKE 'dividend%'
 *    Profit for the year                 ← Net of all REVENUE minus EXPENSE GL activity
 *    ─────────────────────────────────────────────────────────────────────────
 *    Balance as at 31 December {year}    ← computed (opening + all movements)
 *
 *  TWO PERIOD BLOCKS: prior year → current year (matches screenshot layout)
 *
 * ─── PROFIT FOR THE YEAR SOURCE ──────────────────────────────────────────────
 *  "Profit for the year" is NOT a GL entry on the equity accounts.
 *  It is the net income (SUM cr-dr on 4xxxxx REVENUE accounts minus
 *  SUM dr-cr on 5xxxxx EXPENSE accounts) for the period, shown under
 *  the `retained_earnings` column only.
 *
 * ─── PURPOSE_OF_PAYMENT KEYWORDS FOR MOVEMENT CLASSIFICATION ─────────────────
 *  When your GL matures to include dividend/adjustment journal entries,
 *  they are classified by matching purpose_of_payment keywords (case-insensitive):
 *    contains "prior" AND "adjust"   → prior_year_adjustment
 *    contains "prior" AND "dividend" → prior_year_dividend
 *    contains "dividend"             → dividend_paid
 *  Everything else on equity accounts → treated as a direct equity movement
 */

// ─────────────────────────────────────────────────────────────────────────────
// SUBCATEGORY → COLUMN LABEL
// Dynamic: only subcategories that have balances appear as columns.
// Order here defines left-to-right column order.
// ─────────────────────────────────────────────────────────────────────────────
const COLUMN_ORDER = [
  "share_capital",
  "share_premium",
  "retained_earnings",
  "revaluation_reserve",
  "other_reserves",
  "treasury_shares",
  "translation_reserve",
  "non_controlling_interests",
  "accumulated_other_comprehensive_income",
];

const COLUMN_LABELS = {
  share_capital                         : "Share Capital",
  share_premium                         : "Share Premium",
  retained_earnings                     : "Retained Earnings",
  revaluation_reserve                   : "Revaluation Reserve",
  other_reserves                        : "Other Reserves",
  treasury_shares                       : "Treasury Shares",
  translation_reserve                   : "Translation Reserve",
  non_controlling_interests             : "Non-Controlling Interests",
  accumulated_other_comprehensive_income: "Other Comprehensive Income",
};

/** Infer SOCE column when CoA subcategory is null (common on AaErp charts). */
function resolveEquitySubcategory(acc) {
  const raw = String(acc.subcategory || "").trim();
  if (raw) return raw;
  const d = String(acc.description || "").toLowerCase();
  if (d.includes("retained")) return "retained_earnings";
  if (d.includes("share premium") || d.includes("share premium")) return "share_premium";
  if (
    d.includes("share capital") ||
    d.includes("owner's capital") ||
    d.includes("owners capital") ||
    d.includes("opening balance equity")
  ) {
    return "share_capital";
  }
  if (d.includes("revaluation")) return "revaluation_reserve";
  return "other_reserves";
}

// SOCE row definitions — order matches screenshot top to bottom
const ROW_DEFINITIONS = [
  { key: "opening_balance",       label: "Balance As At 1 January {year}", isBold: false, isOpening: true  },
  { key: "prior_year_adjustment", label: "Prior year adjustment",           isBold: false                   },
  { key: "prior_year_dividend",   label: "Prior year Dividend paid",        isBold: false                   },
  { key: "dividend_paid",         label: "Dividend paid",                   isBold: false                   },
  { key: "profit_for_year",       label: "Profit for the year",             isBold: false                   },
  { key: "closing_balance",       label: "Balance as at {yearEnd}", isBold: true, isClosing: true },
];

// ─────────────────────────────────────────────────────────────────────────────
// MOVEMENT CLASSIFIER
// Classifies a GL entry on an equity account into a SOCE row key.
// ─────────────────────────────────────────────────────────────────────────────
function classifyMovement(glType, purpose) {
  // Opening balance entries are always the opening row
  if (glType === "opening_balance") return "opening_balance";

  // For journal entries, use purpose_of_payment keywords
  const p = (purpose || "").toLowerCase();
  if (p.includes("prior") && p.includes("adjust")) return "prior_year_adjustment";
  if (p.includes("prior") && p.includes("dividend")) return "prior_year_dividend";
  if (p.includes("dividend")) return "dividend_paid";

  // All other equity movements (transfers, appropriations, etc.)
  return "equity_movement";
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLER
// ─────────────────────────────────────────────────────────────────────────────
exports.getStatementOfChangesInEquity = async (req, res) => {
  try {
    const { facilityId, fromDate, toDate } = req.body;

    if (!facilityId) {
      return res.status(400).json({ success: false, message: "facilityId is required" });
    }

    // ── 1. Resolve period ────────────────────────────────────────────────────
    let endDate = toDate || new Date().toISOString().slice(0, 10);
    let startDate = fromDate;

    if (!startDate) {
      // Default start = opening_balance date for this facility
      const [row] = await db.sequelize.query(
        `SELECT MIN(transaction_date) AS earliest
         FROM general_ledger
         WHERE facility_id = :facilityId
           AND type        = 'opening_balance'`,
        { replacements: { facilityId }, type: QueryTypes.SELECT }
      );
      startDate = row?.earliest || `${new Date().getFullYear()}-01-01`;
    }

    const currentYear    = new Date(startDate).getFullYear();
    const priorYear      = currentYear - 1;
    const priorYearStart = `${priorYear}-01-01`;
    const priorYearEnd   = `${priorYear}-12-31`;

    // ── 2. Fetch all equity accounts (display=1) ─────────────────────────────
    const equityAccounts = await db.sequelize.query(
      `SELECT code, description, subcategory, type AS account_type
       FROM account_category
       WHERE facility_id    = :facilityId
         AND account_nature = 'EQUITY'
         AND display        = 1
         AND is_active      = 1
       ORDER BY code ASC`,
      { replacements: { facilityId }, type: QueryTypes.SELECT }
    );

    // Build lookup: code → { subcategory, description }
    const accountMap = {};
    for (const acc of equityAccounts) {
      accountMap[acc.code] = {
        subcategory: resolveEquitySubcategory(acc),
        description: acc.description,
      };
    }
    const equityCodes = Object.keys(accountMap);

    // ── 3. Fetch all GL movements on equity accounts ─────────────────────────
    // We fetch from priorYearStart so we can show prior year block too.
    // For current period, opening_balance entries on 2026-01-01 serve as the
    // "Balance As At 1 January 2026" row. No status filter.
    const equityGL = equityCodes.length > 0
      ? await db.sequelize.query(
          `SELECT
             transaction_date AS date,
             account_code     AS code,
             dr, cr,
             type             AS gl_type,
             purpose_of_payment AS purpose,
             transaction_description AS tx_desc
           FROM general_ledger
           WHERE facility_id  = :facilityId
             AND account_code IN (:codes)
             AND transaction_date BETWEEN :from AND :to
           ORDER BY transaction_date ASC`,
          {
            replacements: { facilityId, codes: equityCodes, from: priorYearStart, to: endDate },
            type: QueryTypes.SELECT,
          }
        )
      : [];

    // ── 4. Fetch net profit/(loss) for each period ───────────────────────────
    // Profit for the year = SUM(cr-dr) on REVENUE accounts
    //                     - SUM(dr-cr) on EXPENSE accounts
    // We calculate for both prior year and current year periods.
    async function getNetProfit(periodStart, periodEnd) {
      const [row] = await db.sequelize.query(
        `SELECT
           COALESCE(SUM(
             CASE WHEN ac.account_nature = 'REVENUE' THEN (gl.cr - gl.dr)
                  WHEN ac.account_nature = 'EXPENSE' THEN (gl.dr - gl.cr) * -1
                  ELSE 0 END
           ), 0) AS net_profit
         FROM general_ledger gl
         JOIN account_category ac
           ON  ac.code        = gl.account_code
           AND ac.facility_id = gl.facility_id
         WHERE gl.facility_id      = :facilityId
           AND ac.account_nature   IN ('REVENUE', 'EXPENSE')
           AND gl.type             != 'opening_balance'
           AND gl.transaction_date BETWEEN :from AND :to`,
        {
          replacements: { facilityId, from: periodStart, to: periodEnd },
          type: QueryTypes.SELECT,
        }
      );
      return parseFloat(row?.net_profit || 0);
    }

    // Find the retained_earnings subcategory account codes
    const retainedEarningsCodes = equityAccounts
      .filter((a) => resolveEquitySubcategory(a) === "retained_earnings")
      .map((a) => a.code);

    const priorNetProfit   = await getNetProfit(priorYearStart, priorYearEnd);
    const currentNetProfit = await getNetProfit(startDate, endDate);

    // ── 5. Build movement grids ──────────────────────────────────────────────
    // grid[rowKey][subcategory] = net amount (cr - dr)
    function emptyGrid() {
      const g = {};
      for (const r of ROW_DEFINITIONS) g[r.key] = {};
      return g;
    }

    const priorGrid   = emptyGrid();
    const currentGrid = emptyGrid();

    for (const entry of equityGL) {
      const acc   = accountMap[entry.code];
      if (!acc) continue;

      const subcat = acc.subcategory;
      const date   = entry.date.toString().slice(0, 10);
      const net    = parseFloat(entry.cr) - parseFloat(entry.dr); // equity is cr-normal

      // Determine which period
      const isPrior   = date >= priorYearStart && date <= priorYearEnd;
      const isCurrent = date >= startDate      && date <= endDate;
      const grid      = isPrior ? priorGrid : isCurrent ? currentGrid : null;
      if (!grid) continue;

      const rowKey = classifyMovement(entry.gl_type, entry.purpose);

      // Map "equity_movement" to opening_balance (e.g. transfers that aren't opening)
      // If it's not a known SOCE row, put under opening for now
      const targetKey = grid[rowKey] !== undefined ? rowKey : "opening_balance";

      grid[targetKey][subcat] = (grid[targetKey][subcat] || 0) + net;
    }

    // Inject profit for the year into retained_earnings column
    // Prior year profit — only if there are prior year GL entries
    if (priorNetProfit !== 0) {
      priorGrid["profit_for_year"]["retained_earnings"] =
        (priorGrid["profit_for_year"]["retained_earnings"] || 0) + priorNetProfit;
    }
    // Current year profit
    if (currentNetProfit !== 0) {
      currentGrid["profit_for_year"]["retained_earnings"] =
        (currentGrid["profit_for_year"]["retained_earnings"] || 0) + currentNetProfit;
    }

    // ── 6. Compute closing balances ──────────────────────────────────────────
    function computeClosing(grid) {
      const closing = {};
      for (const [key, cols] of Object.entries(grid)) {
        if (key === "closing_balance") continue;
        for (const [subcat, amt] of Object.entries(cols)) {
          closing[subcat] = (closing[subcat] || 0) + amt;
        }
      }
      grid["closing_balance"] = closing;
    }
    computeClosing(priorGrid);
    computeClosing(currentGrid);

    // ── 7. Discover active columns ───────────────────────────────────────────
    const activeSubcats = new Set();
    for (const grid of [priorGrid, currentGrid]) {
      for (const cols of Object.values(grid)) {
        for (const [subcat, amt] of Object.entries(cols)) {
          if (amt !== 0) activeSubcats.add(subcat);
        }
      }
    }

    // Order columns per COLUMN_ORDER, then any extras not in the list
    const orderedSubcats = [
      ...COLUMN_ORDER.filter((k) => activeSubcats.has(k)),
      ...[...activeSubcats].filter((k) => !COLUMN_ORDER.includes(k)),
    ];

    const columns = orderedSubcats.map((k) => ({
      subcategory: k,
      label      : COLUMN_LABELS[k] || k,
    }));

    // ── 8. Build period row arrays ───────────────────────────────────────────
    const formatYearEndLabel = (year, isCurrentPeriod) => {
      if (isCurrentPeriod) {
        return moment(endDate).format("D MMMM YYYY");
      }
      return `31 December ${year}`;
    };

    function buildRows(grid, year, isCurrentPeriod = false) {
      return ROW_DEFINITIONS
        .filter((def) => {
          // Always show opening and closing
          if (def.isOpening || def.isClosing) return true;
          // Show movement rows only when at least one column has a value
          const cols = grid[def.key] || {};
          return Object.values(cols).some((v) => v !== 0);
        })
        .map((def) => {
          const cols  = grid[def.key] || {};
          const values = {};
          let total = 0;
          for (const subcat of orderedSubcats) {
            const amt = cols[subcat] || 0;
            values[subcat] = r(amt);
            total += amt;
          }
          return {
            rowKey   : def.key,
            label    : def.label
              .replace("{year}", String(year))
              .replace("{yearEnd}", formatYearEndLabel(year, isCurrentPeriod)),
            isBold   : def.isBold   || false,
            isOpening: def.isOpening || false,
            isClosing: def.isClosing || false,
            values,          // { subcategory: amount }
            total: r(total), // row total (sum across all columns)
          };
        });
    }

    // Prior year block (for comparative column as in screenshot)
    const priorRows   = buildRows(priorGrid,   priorYear, false);
    // Current year block
    const currentRows = buildRows(currentGrid, currentYear, true);

    // ── 9. Closing position grand total ─────────────────────────────────────
    const closingCols = currentGrid["closing_balance"];
    const grandTotal  = orderedSubcats.reduce((sum, k) => sum + (closingCols[k] || 0), 0);

    // ── 10. Send response ────────────────────────────────────────────────────
    return res.json({
      success: true,
      data: {
        meta: {
          facilityId,
          title   : "STATEMENT OF CHANGES IN EQUITY",
          currency: "NGN",
          period  : { from: startDate, to: endDate },
        },

        // Column definitions — dynamic, only non-zero subcategories shown
        // Frontend renders one column header per entry, plus a "Total" column
        columns,

        // Two period blocks — each is an ordered array of rows.
        // Frontend renders priorYear first, then currentYear, continuously
        // (no visual separator needed — just the opening balance row label changes)
        periods: [
          {
            year     : priorYear,
            dateRange: { from: priorYearStart, to: priorYearEnd },
            rows     : priorRows,
          },
          {
            year     : currentYear,
            dateRange: { from: startDate, to: endDate },
            rows     : currentRows,
          },
        ],

        // Final closing position (bottom line of the statement)
        closingPosition: {
          year  : currentYear,
          values: Object.fromEntries(orderedSubcats.map((k) => [k, r(closingCols[k] || 0)])),
          total : r(grandTotal),
        },
      },
    });

  } catch (err) {
    console.error("SOCE Error:", err);
    return res.status(500).json({
      success : false,
      message : "Error generating statement of changes in equity",
      error   : err.message,
    });
  }
};

// General Ledger Summary with Aged Analysis
exports.getGeneralLedgerSummary = async (req, res) => {
  try {
    const { facilityId, asOfDate = "2025-09-09" } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
      });
    }

    const query = `
      SELECT
        a.head as account_code,
        a.description as account_name,
        a.account_type,
        a.account_category,
        COALESCE(SUM(gl.dr), 0) as total_debit,
        COALESCE(SUM(gl.cr), 0) as total_credit,
        COUNT(gl.transaction_id) as transaction_count,
        MIN(gl.transaction_date) as first_transaction,
        MAX(gl.transaction_date) as last_transaction,
        CASE
          WHEN MAX(gl.transaction_date) < DATE_SUB(:asOfDate, INTERVAL 90 DAY) THEN 'Over 90 Days'
          WHEN MAX(gl.transaction_date) < DATE_SUB(:asOfDate, INTERVAL 60 DAY) THEN '60-90 Days'
          WHEN MAX(gl.transaction_date) < DATE_SUB(:asOfDate, INTERVAL 30 DAY) THEN '30-60 Days'
          WHEN MAX(gl.transaction_date) < DATE_SUB(:asOfDate, INTERVAL 7 DAY) THEN '7-30 Days'
          ELSE 'Current'
        END as age_category
      FROM account a
      LEFT JOIN general_ledger gl ON a.head = gl.account_code
        AND gl.facility_id = :facilityId
        AND gl.transaction_date <= :asOfDate
        AND gl.status = 'paid'
      WHERE a.facilityId = :facilityId
        AND a.status = 'activated'
      GROUP BY a.head, a.description, a.account_type, a.account_category
      HAVING COALESCE(SUM(gl.dr), 0) > 0 OR COALESCE(SUM(gl.cr), 0) > 0
      ORDER BY a.account_type, a.head
    `;

    const results = await db.sequelize.query(query, {
      replacements: { facilityId, asOfDate },
      type: QueryTypes.SELECT,
    });

    // Apply nature balancing rules for net_balance display
    const natureByCode = {};
    try {
      const cats = await db.AccountCategory.findAll({
        where: { facilityId },
        attributes: ["code", "accountNature"],
        raw: true,
      });
      cats.forEach((c) => {
        natureByCode[String(c.code)] = c.account_nature || c.accountNature;
      });
    } catch (_) {
      /* legacy CoA may not have account_category */
    }

    results.forEach((row) => {
      const nature = resolveAccountNature(
        natureByCode[String(row.account_code)] || row.account_type,
        row.account_code,
      );
      row.account_nature = nature;
      row.net_balance = signedBalance(
        nature,
        row.total_debit,
        row.total_credit,
      );
    });

    // Group by age category
    const agedAnalysis = results.reduce((acc, row) => {
      const age = row.age_category;
      if (!acc[age]) {
        acc[age] = { accounts: [], total: 0 };
      }
      acc[age].accounts.push(row);
      acc[age].total += parseFloat(row.net_balance);
      return acc;
    }, {});

    res.json({
      success: true,
      data: {
        asOfDate,
        facilityId,
        summary: results,
        agedAnalysis,
        totals: {
          totalDebit: results
            .reduce((sum, row) => sum + parseFloat(row.total_debit), 0)
            .toFixed(2),
          totalCredit: results
            .reduce((sum, row) => sum + parseFloat(row.total_credit), 0)
            .toFixed(2),
          netBalance: results
            .reduce((sum, row) => sum + parseFloat(row.net_balance), 0)
            .toFixed(2),
        },
      },
    });
  } catch (error) {
    console.error("General Ledger Summary Error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating general ledger summary",
      error: error.message,
    });
  }
};

// General Ledger - Detailed Transaction History
exports.getGeneralLedger = async (req, res) => {
  try {
    const { facilityId, fromDate, toDate } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
      });
    }

    if (!fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        message: "From date and to date are required",
      });
    }

    const query = `
      SELECT
        gl.transaction_date,
        gl.account_code,
        a.description as account_description,
        a.account_type,
        gl.transaction_ref as reference_number,
        gl.purpose_of_payment as narration,
        gl.dr,
        gl.cr,
        gl.created_at,
        gl.updated_at
      FROM general_ledger gl
      LEFT JOIN account a ON gl.account_code = a.head
      WHERE gl.facility_id = :facilityId
        AND gl.transaction_date BETWEEN :fromDate AND :toDate and facilityId = :facilityId
      ORDER BY gl.transaction_date DESC, gl.created_at DESC
    `;

    const results = await db.sequelize.query(query, {
      replacements: { facilityId, fromDate, toDate },
      type: QueryTypes.SELECT,
    });

    // Calculate totals
    const totalDebit = results.reduce(
      (sum, row) => sum + parseFloat(row.dr || 0),
      0
    );
    const totalCredit = results.reduce(
      (sum, row) => sum + parseFloat(row.cr || 0),
      0
    );

    res.json({
      success: true,
      data: {
        generalLedger: results,
        totals: {
          totalDebit: totalDebit.toFixed(2),
          totalCredit: totalCredit.toFixed(2),
          difference: (totalDebit - totalCredit).toFixed(2),
        },
        reportDate: toDate,
        facilityId,
      },
    });
  } catch (error) {
    console.error("General Ledger Error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating general ledger",
      error: error.message,
    });
  }
};

// Comprehensive Production Report for Accounting
exports.getProductionReport = async (req, res) => {
  try {
    const { facilityId, fromDate, toDate } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
      });
    }

    if (!fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        message: "From date and to date are required",
      });
    }

    // Production Orders Summary
    const productionOrdersQuery = `
      SELECT
        po.id,
        po.order_number,
        po.quantity_planned,
        po.quantity_actual,
        po.status,
        po.start_date,
        po.end_date,
        po.priority,
        bom.product_name,
        bom.total_cost as bom_total_cost,
        CASE
          WHEN po.status = 'completed' THEN (po.quantity_actual * bom.total_cost)
          ELSE (po.quantity_planned * bom.total_cost)
        END as total_production_cost,
        CASE
          WHEN po.status = 'completed' AND po.end_date IS NOT NULL THEN
            DATEDIFF(po.end_date, po.start_date)
          ELSE NULL
        END as production_days,
        CONCAT(u.firstname, ' ', u.lastname) as created_by_name
      FROM production_orders po
      LEFT JOIN bill_of_materials bom ON po.bom_id = bom.id
      LEFT JOIN users u ON po.created_by = u.id
      WHERE po.facility_id = :facilityId
        AND po.created_at BETWEEN :fromDate AND :toDate
      ORDER BY po.created_at DESC
    `;

    // Material Usage Analysis
    const materialUsageQuery = `
      SELECT
        mi.material_id,
        m.name as material_name,
        m.sku as material_code,
        m.unit,
        SUM(mi.quantity_issued) as total_quantity_issued,
        AVG(mi.unit_cost) as avg_unit_cost,
        SUM(mi.total_cost) as total_material_cost,
        COUNT(DISTINCT mi.production_order_id) as production_orders_count
      FROM material_issuances mi
      LEFT JOIN materials m ON mi.material_id = m.id
      LEFT JOIN production_orders po ON mi.production_order_id = po.id
      WHERE mi.facility_id = :facilityId
        AND mi.issued_date BETWEEN :fromDate AND :toDate
      GROUP BY mi.material_id, m.name, m.sku, m.unit
      ORDER BY total_material_cost DESC
    `;

    // Finished Goods Production
    const finishedGoodsQuery = `
      SELECT
        fg.id,
        fg.product_name,
        fg.batch_no,
        fg.quantity,
        fg.cost_per_unit,
        fg.total_cost,
        fg.status,
        fg.warehouse_location,
        fg.expiry_date,
        po.order_number,
        po.created_at as production_date,
        CONCAT(u.firstname, ' ', u.lastname) as created_by_name
      FROM finished_goods fg
      LEFT JOIN production_orders po ON fg.production_order_id = po.id
      LEFT JOIN users u ON po.created_by = u.id
      WHERE fg.facility_id = :facilityId
        AND fg.created_at BETWEEN :fromDate AND :toDate
      ORDER BY fg.created_at DESC
    `;

    // Production Efficiency Metrics
    const efficiencyQuery = `
      SELECT
        COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_orders,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_orders,
        SUM(CASE WHEN status = 'planned' THEN 1 ELSE 0 END) as planned_orders,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_orders,
        SUM(quantity_planned) as total_planned_quantity,
        SUM(quantity_actual) as total_actual_quantity,
        AVG(CASE
          WHEN status = 'completed' AND quantity_planned > 0 THEN
            (quantity_actual / quantity_planned) * 100
          ELSE 0
        END) as avg_quantity_efficiency,
        SUM(CASE
          WHEN status = 'completed' AND end_date IS NOT NULL AND start_date IS NOT NULL THEN
            DATEDIFF(end_date, start_date)
          ELSE 0
        END) as total_production_days,
        COUNT(CASE WHEN status = 'completed' AND end_date IS NOT NULL AND start_date IS NOT NULL THEN 1 END) as completed_with_dates
      FROM production_orders
      WHERE facility_id = :facilityId
        AND created_at BETWEEN :fromDate AND :toDate
    `;

    // Cost Analysis
    const costAnalysisQuery = `
      SELECT
        'Raw Materials' as cost_category,
        SUM(mi.total_cost) as total_cost,
        COUNT(DISTINCT mi.material_id) as item_count
      FROM material_issuances mi
      WHERE mi.facility_id = :facilityId
        AND mi.issued_date BETWEEN :fromDate AND :toDate

      UNION ALL

      SELECT
        'Finished Goods' as cost_category,
        SUM(fg.total_cost) as total_cost,
        COUNT(DISTINCT fg.id) as item_count
      FROM finished_goods fg
      WHERE fg.facility_id = :facilityId
        AND fg.created_at BETWEEN :fromDate AND :toDate

      UNION ALL

      SELECT
        'Production Orders' as cost_category,
        SUM(CASE
          WHEN po.status = 'completed' THEN (po.quantity_actual * bom.total_cost)
          ELSE (po.quantity_planned * bom.total_cost)
        END) as total_cost,
        COUNT(DISTINCT po.id) as item_count
      FROM production_orders po
      LEFT JOIN bill_of_materials bom ON po.bom_id = bom.id
      WHERE po.facility_id = :facilityId
        AND po.created_at BETWEEN :fromDate AND :toDate
    `;

    // Execute all queries in parallel
    const [
      productionOrders,
      materialUsage,
      finishedGoods,
      efficiencyMetrics,
      costAnalysis
    ] = await Promise.all([
      db.sequelize.query(productionOrdersQuery, {
        replacements: { facilityId, fromDate, toDate },
        type: QueryTypes.SELECT,
      }),
      db.sequelize.query(materialUsageQuery, {
        replacements: { facilityId, fromDate, toDate },
        type: QueryTypes.SELECT,
      }),
      db.sequelize.query(finishedGoodsQuery, {
        replacements: { facilityId, fromDate, toDate },
        type: QueryTypes.SELECT,
      }),
      db.sequelize.query(efficiencyQuery, {
        replacements: { facilityId, fromDate, toDate },
        type: QueryTypes.SELECT,
      }),
      db.sequelize.query(costAnalysisQuery, {
        replacements: { facilityId, fromDate, toDate },
        type: QueryTypes.SELECT,
      })
    ]);

    // Calculate summary statistics
    const summary = {
      totalProductionOrders: efficiencyMetrics[0]?.total_orders || 0,
      completedOrders: efficiencyMetrics[0]?.completed_orders || 0,
      inProgressOrders: efficiencyMetrics[0]?.in_progress_orders || 0,
      plannedOrders: efficiencyMetrics[0]?.planned_orders || 0,
      cancelledOrders: efficiencyMetrics[0]?.cancelled_orders || 0,
      completionRate: efficiencyMetrics[0]?.total_orders > 0
        ? ((efficiencyMetrics[0]?.completed_orders / efficiencyMetrics[0]?.total_orders) * 100).toFixed(2)
        : 0,
      totalPlannedQuantity: efficiencyMetrics[0]?.total_planned_quantity || 0,
      totalActualQuantity: efficiencyMetrics[0]?.total_actual_quantity || 0,
      avgQuantityEfficiency: efficiencyMetrics[0]?.avg_quantity_efficiency?.toFixed(2) || 0,
      avgProductionDays: efficiencyMetrics[0]?.completed_with_dates > 0
        ? (efficiencyMetrics[0]?.total_production_days / efficiencyMetrics[0]?.completed_with_dates).toFixed(2)
        : 0,
      totalMaterialCost: costAnalysis.find(c => c.cost_category === 'Raw Materials')?.total_cost || 0,
      totalFinishedGoodsCost: costAnalysis.find(c => c.cost_category === 'Finished Goods')?.total_cost || 0,
      totalProductionCost: costAnalysis.find(c => c.cost_category === 'Production Orders')?.total_cost || 0
    };

    res.json({
      success: true,
      data: {
        reportPeriod: { fromDate, toDate },
        facilityId,
        summary,
        productionOrders,
        materialUsage,
        finishedGoods,
        costAnalysis,
        generatedAt: moment().format("YYYY-MM-DD HH:mm:ss"),
      },
    });
  } catch (error) {
    console.error("Production Report Error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating production report",
      error: error.message,
    });
  }
};

// Sales Report - invoices with type = "sales"
exports.getSalesReport = async (req, res) => {
  try {
    const { facilityId, fromDate, toDate } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
      });
    }

    const query = `
      SELECT
        invoice_id,
        invoice_ref,
        ref_number,
        transaction_date,
        due_date,
        description,
        amount,
        type,
        created_by,
        created_at
      FROM invoices
      WHERE facility_id = :facilityId
        AND type = 'sales'
        AND DATE(transaction_date) BETWEEN DATE(:fromDate) AND DATE(:toDate)
      ORDER BY transaction_date DESC
    `;

    const rows = await db.sequelize.query(query, {
      replacements: {
        facilityId,
        fromDate: fromDate || moment().startOf("month").format("YYYY-MM-DD"),
        toDate: toDate || moment().format("YYYY-MM-DD"),
      },
      type: QueryTypes.SELECT,
    });

    const totalAmount = rows.reduce(
      (sum, row) => sum + parseFloat(row.amount || 0),
      0
    );
    const totalTax = rows.reduce(
      (sum, row) => sum + parseFloat(row.tax_amount || 0),
      0
    );
    const totalDiscount = rows.reduce(
      (sum, row) => sum + parseFloat(row.discount_amount || 0),
      0
    );

    return res.json({
      success: true,
      data: {
        salesReport: rows,
        totals: {
          totalAmount,
          totalTax,
          totalDiscount,
          count: rows.length,
        },
      },
    });
  } catch (error) {
    console.error("Sales Report Error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating sales report",
      error: error.message,
    });
  }
};

// Expenditure Report - invoices with type = "purchase"
exports.getExpenditureReport = async (req, res) => {
  try {
    const { facilityId, fromDate, toDate } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
      });
    }

    const query = `
      SELECT
        invoice_id,
        invoice_ref,
        ref_number,
        transaction_date,
        due_date,
        description,
        amount,
        type,
        created_by,
        created_at
      FROM invoices
      WHERE facility_id = :facilityId
        AND type = 'purchase'
        AND DATE(transaction_date) BETWEEN DATE(:fromDate) AND DATE(:toDate)
      ORDER BY transaction_date DESC
    `;

    const rows = await db.sequelize.query(query, {
      replacements: {
        facilityId,
        fromDate: fromDate || moment().startOf("month").format("YYYY-MM-DD"),
        toDate: toDate || moment().format("YYYY-MM-DD"),
      },
      type: QueryTypes.SELECT,
    });

    const totalAmount = rows.reduce(
      (sum, row) => sum + parseFloat(row.amount || 0),
      0
    );
    const totalTax = rows.reduce(
      (sum, row) => sum + parseFloat(row.tax_amount || 0),
      0
    );
    const totalDiscount = rows.reduce(
      (sum, row) => sum + parseFloat(row.discount_amount || 0),
      0
    );

    return res.json({
      success: true,
      data: {
        expenditureReport: rows,
        totals: {
          totalAmount,
          totalTax,
          totalDiscount,
          count: rows.length,
        },
      },
    });
  } catch (error) {
    console.error("Expenditure Report Error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating expenditure report",
      error: error.message,
    });
  }
};

/**
 * Facility-scoped custom report definitions (see model AccountingCustomReport).
 */
exports.getAccountingCustomReports = async (req, res) => {
  try {
    const { facilityId } = req.params;
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const rows = await db.AccountingCustomReport.findAll({
      where: { facility_id: facilityId, is_active: true },
      order: [["title", "ASC"]],
    });

    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("getAccountingCustomReports:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Error loading custom reports",
    });
  }
};

/**
 * Create a custom report shortcut (e.g. from Chart of Accounts → Configure Report).
 * Body: facilityId, title, description?, report_type?, config_json?, target_path?, external_app_path?, date_mode?, created_by?
 */
exports.createAccountingCustomReport = async (req, res) => {
  try {
    const {
      facilityId,
      title,
      description,
      report_type,
      config_json,
      target_path,
      external_app_path,
      date_mode,
      created_by,
    } = req.body;

    if (!facilityId || !title || !String(title).trim()) {
      return res.status(400).json({
        success: false,
        message: "facilityId and title are required",
      });
    }

    const row = await db.AccountingCustomReport.create({
      facility_id: facilityId,
      title: String(title).trim(),
      description: description || null,
      report_type: report_type || "link",
      config_json: config_json || null,
      target_path: target_path || null,
      external_app_path: external_app_path || null,
      date_mode: date_mode || "range",
      created_by: created_by || null,
      is_active: true,
    });

    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("createAccountingCustomReport:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Error saving custom report",
    });
  }
};
