/**
 * Demo production reporting dataset (sample gas manufacturing data).
 */

const REPORT_META = {
  companyName: "Sample Manufacturing Co.",
  reportTitle: "Production Reporting",
  defaultPeriod: {
    fromDate: "2026-01-01",
    toDate: "2026-01-18",
  },
};

const OPERATOR_PRODUCTION_RECORDS = [
  {
    id: "OPR-2026-001",
    date: "2026-01-02",
    shift: "Morning",
    operatorName: "Ibrahim Musa",
    productionLine: "Oxygen Plant A",
    cycleRef: "CYC-O2-0102-A",
    productCode: "Q3-10KG-KN",
    productName: "Q3 (10kg)Kn",
    category: "Oxygen Gas",
    cylsProduced: 420,
    kgProduced: 4200,
    status: "submitted",
  },
  {
    id: "OPR-2026-002",
    date: "2026-01-02",
    shift: "Afternoon",
    operatorName: "Grace Okon",
    productionLine: "Oxygen Plant A",
    cycleRef: "CYC-O2-0102-B",
    productCode: "Q3-10KG-KN",
    productName: "Q3 (10kg)Kn",
    category: "Oxygen Gas",
    cylsProduced: 385,
    kgProduced: 3850,
    status: "submitted",
  },
  {
    id: "OPR-2026-003",
    date: "2026-01-03",
    shift: "Morning",
    operatorName: "Ibrahim Musa",
    productionLine: "Oxygen Plant B",
    cycleRef: "CYC-O2-0103-A",
    productCode: "Q4-9KG-KN",
    productName: "Q4 (9kg)Kn",
    category: "Oxygen Gas",
    cylsProduced: 310,
    kgProduced: 2790,
    status: "submitted",
  },
  {
    id: "OPR-2026-004",
    date: "2026-01-04",
    shift: "Night",
    operatorName: "Samuel Adeyemi",
    productionLine: "Oxygen Plant B",
    cycleRef: "CYC-O2-0104-N",
    productCode: "Q4-9KG-KN",
    productName: "Q4 (9kg)Kn",
    category: "Oxygen Gas",
    cylsProduced: 298,
    kgProduced: 2682,
    status: "submitted",
  },
  {
    id: "OPR-2026-005",
    date: "2026-01-05",
    shift: "Morning",
    operatorName: "Fatima Bello",
    productionLine: "Oxygen Plant A",
    cycleRef: "CYC-O2-0105-A",
    productCode: "Q2-12KG-KN",
    productName: "Q2 (12kg)Kn",
    category: "Oxygen Gas",
    cylsProduced: 22,
    kgProduced: 264,
    status: "submitted",
  },
  {
    id: "OPR-2026-006",
    date: "2026-01-06",
    shift: "Afternoon",
    operatorName: "Grace Okon",
    productionLine: "Acetylene Plant",
    cycleRef: "CYC-C2H2-0106-A",
    productCode: "A2-7KG-KN",
    productName: "A2 (7kg)Kn",
    category: "Acetylene Gas",
    cylsProduced: 28,
    kgProduced: 196,
    status: "submitted",
  },
  {
    id: "OPR-2026-007",
    date: "2026-01-07",
    shift: "Morning",
    operatorName: "Yusuf Danladi",
    productionLine: "Acetylene Plant",
    cycleRef: "CYC-C2H2-0107-M",
    productCode: "A1-5KG-KN",
    productName: "A1 (5kg)Kn",
    category: "Acetylene Gas",
    cylsProduced: 5,
    kgProduced: 45,
    status: "submitted",
  },
  {
    id: "OPR-2026-008",
    date: "2026-01-08",
    shift: "Afternoon",
    operatorName: "Yusuf Danladi",
    productionLine: "Acetylene Plant",
    cycleRef: "CYC-C2H2-0108-A",
    productCode: "A3-6KG-KN",
    productName: "A3 (6kg)Kn",
    category: "Acetylene Gas",
    cylsProduced: 9,
    kgProduced: 54,
    status: "submitted",
  },
  {
    id: "OPR-2026-009",
    date: "2026-01-10",
    shift: "Morning",
    operatorName: "Ibrahim Musa",
    productionLine: "Oxygen Plant A",
    cycleRef: "CYC-O2-0110-M",
    productCode: "Q3-10KG-KN",
    productName: "Q3 (10kg)Kn",
    category: "Oxygen Gas",
    cylsProduced: 512,
    kgProduced: 5120,
    status: "submitted",
  },
  {
    id: "OPR-2026-010",
    date: "2026-01-12",
    shift: "Night",
    operatorName: "Samuel Adeyemi",
    productionLine: "Oxygen Plant B",
    cycleRef: "CYC-O2-0112-N",
    productCode: "Q4-9KG-KN",
    productName: "Q4 (9kg)Kn",
    category: "Acetylene Gas",
    cylsProduced: 265,
    kgProduced: 2385,
    status: "submitted",
  },
  {
    id: "OPR-2026-011",
    date: "2026-01-14",
    shift: "Morning",
    operatorName: "Fatima Bello",
    productionLine: "Specialty",
    cycleRef: "CYC-O2-0114-S",
    productCode: "1KG-KN",
    productName: "(1kg)Kn",
    category: "Oxygen Gas",
    cylsProduced: 1,
    kgProduced: 1,
    status: "submitted",
  },
  {
    id: "OPR-2026-012",
    date: "2026-01-15",
    shift: "Afternoon",
    operatorName: "Grace Okon",
    productionLine: "Acetylene Plant",
    cycleRef: "CYC-C2H2-0115-A",
    productCode: "A2-7KG-KN",
    productName: "A2 (7kg)Kn",
    category: "Acetylene Gas",
    cylsProduced: 31,
    kgProduced: 217,
    status: "submitted",
  },
];

const PRODUCTION_VS_SALES_ROWS = [
  {
    section: "Oxygen Gas",
    item: "Q2 (12kg)Kn",
    openingCyls: 0,
    openingKg: 0,
    productionCyls: 38,
    productionKg: 456,
    salesCyls: 31,
    salesKg: 372,
    salesAmount: 176683,
    pricePerCyl: 5699,
    pricePerTon: 474954,
    closingCyls: 7,
    closingKg: 84,
    isSubtotal: false,
  },
  {
    section: "Oxygen Gas",
    item: "Q3 (10kg)Kd",
    openingCyls: 0,
    openingKg: 0,
    productionCyls: 0,
    productionKg: 0,
    salesCyls: 0,
    salesKg: 0,
    salesAmount: 0,
    pricePerCyl: 0,
    pricePerTon: 0,
    closingCyls: 0,
    closingKg: 0,
    isSubtotal: false,
  },
  {
    section: "Oxygen Gas",
    item: "Q3 (10kg)Kn",
    openingCyls: 107,
    openingKg: 1070,
    productionCyls: 3272,
    productionKg: 32720,
    salesCyls: 2573,
    salesKg: 25730,
    salesAmount: 14931147,
    pricePerCyl: 5803,
    pricePerTon: 580301,
    closingCyls: 801,
    closingKg: 8010,
    isSubtotal: false,
  },
  {
    section: "Oxygen Gas",
    item: "Q4 (9kg)Kn",
    openingCyls: 41,
    openingKg: 369,
    productionCyls: 1973,
    productionKg: 17757,
    salesCyls: 1519,
    salesKg: 13671,
    salesAmount: 8096623,
    pricePerCyl: 5330,
    pricePerTon: 592248,
    closingCyls: 495,
    closingKg: 4455,
    isSubtotal: false,
  },
  {
    section: "Oxygen Gas",
    item: "(1kg)Kn",
    openingCyls: 0,
    openingKg: 0,
    productionCyls: 1,
    productionKg: 1,
    salesCyls: 1,
    salesKg: 1,
    salesAmount: 4950,
    pricePerCyl: 4950,
    pricePerTon: 4950000,
    closingCyls: 0,
    closingKg: 0,
    isSubtotal: false,
  },
  {
    section: "Oxygen Gas",
    item: "Total - Kn",
    openingCyls: 148,
    openingKg: 1439,
    productionCyls: 5284,
    productionKg: 50934,
    salesCyls: 4124,
    salesKg: 39774,
    salesAmount: 23209403,
    pricePerCyl: 5628,
    pricePerTon: 583532,
    closingCyls: 1303,
    closingKg: 12549,
    isSubtotal: true,
  },
  {
    section: "Acetylene Gas",
    item: "A1 (5kg)Kn",
    openingCyls: 32,
    openingKg: 288,
    productionCyls: 9,
    productionKg: 81,
    salesCyls: 16,
    salesKg: 144,
    salesAmount: 601991,
    pricePerCyl: 37624,
    pricePerTon: 4180493,
    closingCyls: 25,
    closingKg: 225,
    isSubtotal: false,
  },
  {
    section: "Acetylene Gas",
    item: "A2 (7kg)Kn",
    openingCyls: 28,
    openingKg: 196,
    productionCyls: 59,
    productionKg: 413,
    salesCyls: 68,
    salesKg: 476,
    salesAmount: 2711218,
    pricePerCyl: 39871,
    pricePerTon: 5695836,
    closingCyls: 19,
    closingKg: 133,
    isSubtotal: false,
  },
  {
    section: "Acetylene Gas",
    item: "A3 (6kg)Kn",
    openingCyls: 12,
    openingKg: 72,
    productionCyls: 17,
    productionKg: 102,
    salesCyls: 20,
    salesKg: 120,
    salesAmount: 734923,
    pricePerCyl: 36746,
    pricePerTon: 6124358,
    closingCyls: 9,
    closingKg: 54,
    isSubtotal: false,
  },
  {
    section: "Acetylene Gas",
    item: "(2kg)Kn",
    openingCyls: 1,
    openingKg: 2,
    productionCyls: 0,
    productionKg: 0,
    salesCyls: 0,
    salesKg: 0,
    salesAmount: 0,
    pricePerCyl: 0,
    pricePerTon: 0,
    closingCyls: 1,
    closingKg: 2,
    isSubtotal: false,
  },
  {
    section: "Acetylene Gas",
    item: "Total - Kn",
    openingCyls: 73,
    openingKg: 558,
    productionCyls: 85,
    productionKg: 596,
    salesCyls: 104,
    salesKg: 740,
    salesAmount: 4048132,
    pricePerCyl: 38924,
    pricePerTon: 5470449,
    closingCyls: 54,
    closingKg: 414,
    isSubtotal: true,
  },
  {
    section: "Other",
    item: "CO2 Gas",
    openingCyls: 0,
    openingKg: 0,
    productionCyls: 0,
    productionKg: 0,
    salesCyls: 0,
    salesKg: 0,
    salesAmount: 0,
    pricePerCyl: 0,
    pricePerTon: 0,
    closingCyls: 0,
    closingKg: 0,
    isSubtotal: false,
  },
  {
    section: "Other",
    item: "Valves-LPG",
    openingCyls: 9,
    openingKg: 0,
    productionCyls: 0,
    productionKg: 0,
    salesCyls: 0,
    salesKg: 0,
    salesAmount: 0,
    pricePerCyl: 0,
    pricePerTon: 0,
    closingCyls: 9,
    closingKg: 0,
    isSubtotal: false,
  },
  {
    section: "Other",
    item: "Carbide",
    openingCyls: 0,
    openingKg: 4000,
    productionCyls: 0,
    productionKg: 1000,
    salesCyls: 0,
    salesKg: 0,
    salesAmount: 0,
    pricePerCyl: 0,
    pricePerTon: 0,
    closingCyls: 0,
    closingKg: 3000,
    isSubtotal: false,
    note: "Includes 2,500kg calcium carbide",
  },
  {
    section: "Other",
    item: "LPG",
    openingCyls: 0,
    openingKg: 1001,
    productionCyls: 0,
    productionKg: 0,
    salesCyls: 0,
    salesKg: 1001,
    salesAmount: 1121680,
    pricePerCyl: 0,
    pricePerTon: 0,
    closingCyls: 0,
    closingKg: 0,
    isSubtotal: false,
    note: "Includes 1,001kg LPG",
  },
  {
    section: "Other",
    item: "N2 Gas",
    openingCyls: 11,
    openingKg: 0,
    productionCyls: 0,
    productionKg: 0,
    salesCyls: 2,
    salesKg: 0,
    salesAmount: 60000,
    pricePerCyl: 30000,
    pricePerTon: 0,
    closingCyls: 9,
    closingKg: 0,
    isSubtotal: false,
  },
];

const MISCELLANEOUS_CHARGES = [
  { item: "Outlet Keys", amount: 5953 },
  { item: "Transport Charges", amount: 182028 },
  { item: "Handling Charges", amount: 264450 },
];

function filterByDateRange(rows, fromDate, toDate, dateField = "date") {
  if (!fromDate && !toDate) return rows;
  return rows.filter((row) => {
    const d = row[dateField];
    if (!d) return true;
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    return true;
  });
}

function buildProductSummary(operatorRows) {
  const map = new Map();

  for (const row of operatorRows) {
    const key = row.productCode || row.productName;
    const existing = map.get(key) || {
      productCode: row.productCode,
      productName: row.productName,
      category: row.category,
      totalCyls: 0,
      totalKg: 0,
      cycleCount: 0,
      operators: new Set(),
      productionLines: new Set(),
    };
    existing.totalCyls += Number(row.cylsProduced) || 0;
    existing.totalKg += Number(row.kgProduced) || 0;
    existing.cycleCount += 1;
    existing.operators.add(row.operatorName);
    existing.productionLines.add(row.productionLine);
    map.set(key, existing);
  }

  return Array.from(map.values())
    .map((row) => ({
      productCode: row.productCode,
      productName: row.productName,
      category: row.category,
      totalCyls: row.totalCyls,
      totalKg: row.totalKg,
      cycleCount: row.cycleCount,
      operatorCount: row.operators.size,
      productionLines: Array.from(row.productionLines).join(", "),
    }))
    .sort((a, b) => b.totalKg - a.totalKg);
}

function sumComparisonRows(rows) {
  const dataRows = rows.filter((r) => !r.isSubtotal);
  return dataRows.reduce(
    (acc, row) => {
      acc.openingCyls += row.openingCyls || 0;
      acc.openingKg += row.openingKg || 0;
      acc.productionCyls += row.productionCyls || 0;
      acc.productionKg += row.productionKg || 0;
      acc.salesCyls += row.salesCyls || 0;
      acc.salesKg += row.salesKg || 0;
      acc.salesAmount += row.salesAmount || 0;
      acc.closingCyls += row.closingCyls || 0;
      acc.closingKg += row.closingKg || 0;
      return acc;
    },
    {
      openingCyls: 0,
      openingKg: 0,
      productionCyls: 0,
      productionKg: 0,
      salesCyls: 0,
      salesKg: 0,
      salesAmount: 0,
      closingCyls: 0,
      closingKg: 0,
    },
  );
}

function getOperatorProductionReport({ fromDate, toDate }) {
  const rows = filterByDateRange(
    OPERATOR_PRODUCTION_RECORDS,
    fromDate,
    toDate,
  );
  const summary = rows.reduce(
    (acc, row) => {
      acc.totalCycles += 1;
      acc.totalCyls += row.cylsProduced || 0;
      acc.totalKg += row.kgProduced || 0;
      acc.operators.add(row.operatorName);
      return acc;
    },
    { totalCycles: 0, totalCyls: 0, totalKg: 0, operators: new Set() },
  );

  return {
    meta: REPORT_META,
    rows,
    summary: {
      totalCycles: summary.totalCycles,
      totalCyls: summary.totalCyls,
      totalKg: summary.totalKg,
      operatorCount: summary.operators.size,
    },
    reportPeriod: { fromDate, toDate },
    isDemoData: true,
  };
}

function getProductProductionSummaryReport({ fromDate, toDate }) {
  const operatorRows = filterByDateRange(
    OPERATOR_PRODUCTION_RECORDS,
    fromDate,
    toDate,
  );
  const rows = buildProductSummary(operatorRows);
  const summary = rows.reduce(
    (acc, row) => {
      acc.productCount += 1;
      acc.totalCyls += row.totalCyls || 0;
      acc.totalKg += row.totalKg || 0;
      acc.totalCycles += row.cycleCount || 0;
      return acc;
    },
    { productCount: 0, totalCyls: 0, totalKg: 0, totalCycles: 0 },
  );

  return {
    meta: REPORT_META,
    rows,
    summary,
    reportPeriod: { fromDate, toDate },
    isDemoData: true,
  };
}

function getProductionVsSalesReport({ fromDate, toDate }) {
  const rows = PRODUCTION_VS_SALES_ROWS;
  const comparisonTotals = sumComparisonRows(rows);
  const miscTotal = MISCELLANEOUS_CHARGES.reduce(
    (sum, item) => sum + item.amount,
    0,
  );

  return {
    meta: {
      ...REPORT_META,
      reportHeading: `PRODUCTION AND SALES FROM ${formatPeriodLabel(fromDate, toDate)}`,
    },
    rows,
    miscellaneous: MISCELLANEOUS_CHARGES,
    summary: {
      ...comparisonTotals,
      miscellaneousTotal: miscTotal,
      grandTotal: comparisonTotals.salesAmount + miscTotal,
      productionVsSalesVarianceCyls:
        comparisonTotals.productionCyls - comparisonTotals.salesCyls,
      productionVsSalesVarianceKg:
        comparisonTotals.productionKg - comparisonTotals.salesKg,
    },
    reportPeriod: { fromDate, toDate },
    isDemoData: true,
  };
}

function formatPeriodLabel(fromDate, toDate) {
  const fmt = (d) => {
    if (!d) return "";
    const date = new Date(`${d}T00:00:00`);
    const day = date.getDate();
    const suffix =
      day === 1 || day === 21 || day === 31
        ? "ST"
        : day === 2 || day === 22
          ? "ND"
          : day === 3 || day === 23
            ? "RD"
            : "TH";
    const month = date.toLocaleString("en-GB", { month: "short" }).toUpperCase();
    return `${day}${suffix} ${month}`;
  };
  if (fromDate && toDate) return `${fmt(fromDate)} - ${fmt(toDate)} 2026`;
  return "SELECTED PERIOD";
}

function getSalesPerProductReport({ fromDate, toDate }) {
  const rows = PRODUCTION_VS_SALES_ROWS.filter((r) => !r.isSubtotal && r.salesAmount > 0).map(
    (row) => ({
      productCode: row.item.replace(/\s/g, "-").toUpperCase(),
      productName: row.item,
      category: row.section,
      unit: "cyl",
      quantitySold: row.salesCyls,
      salesAmount: row.salesAmount,
      avgUnitPrice: row.pricePerCyl,
      transactionCount: row.salesCyls > 0 ? 1 : 0,
    }),
  );
  const summary = rows.reduce(
    (acc, row) => {
      acc.productCount += 1;
      acc.totalQuantity += row.quantitySold || 0;
      acc.totalSales += row.salesAmount || 0;
      acc.transactionCount += row.transactionCount || 0;
      return acc;
    },
    { productCount: 0, totalQuantity: 0, totalSales: 0, transactionCount: 0 },
  );
  return { rows, summary, reportPeriod: { fromDate, toDate }, isDemoData: true };
}

module.exports = {
  REPORT_META,
  OPERATOR_PRODUCTION_RECORDS,
  PRODUCTION_VS_SALES_ROWS,
  MISCELLANEOUS_CHARGES,
  getOperatorProductionReport,
  getProductProductionSummaryReport,
  getProductionVsSalesReport,
  getSalesPerProductReport,
};
