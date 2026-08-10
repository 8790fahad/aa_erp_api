const db = require("../models");
const moment = require("moment");
const productionDemo = require("../data/productionReportingDemoData");
const {
  salesTypesSqlList,
  STORE_ENTRY_TYPE,
} = require("../constants/storeEntryTypes");

/** Normalize mixed utf8mb4 collations before comparing SKU columns. */
const skuEq = (a, b) =>
  `CONVERT(${a} USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(${b} USING utf8mb4) COLLATE utf8mb4_general_ci`;

// Cost of Goods Manufactured (COGM) Report
exports.getCOGMReport = async (req, res) => {
  try {
    const { facilityId, fromDate, toDate } = req.body;

    if (!facilityId || !fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: facilityId, fromDate, toDate",
      });
    }

    const query = `
      SELECT
        po.id as production_order_id,
        po.order_number,
        po.quantity_planned,
        po.quantity_actual,
        po.start_date,
        po.end_date,
        po.status,
        bom.product_name,
        bom.total_cost as bom_total_cost,
        fg.total_cost as actual_cost,
        fg.quantity as actual_quantity,
        fg.cost_per_unit as actual_cost_per_unit,
        (fg.total_cost / fg.quantity) as actual_unit_cost,
        (bom.total_cost * po.quantity_planned) as planned_total_cost,
        (fg.total_cost - (bom.total_cost * po.quantity_planned)) as cost_variance
      FROM production_orders po
      LEFT JOIN bill_of_materials bom ON po.bom_id = bom.id
      LEFT JOIN finished_goods fg ON po.id = fg.production_order_id
      WHERE po.facility_id = :facilityId
        AND po.created_at >= :fromDate
        AND po.created_at <= :toDate
        AND po.status = 'completed'
      ORDER BY po.created_at DESC
    `;

    const cogmData = await db.sequelize.query(query, {
      replacements: { facilityId, fromDate, toDate },
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Calculate summary
    const summary = cogmData.reduce(
      (acc, item) => {
        acc.totalPlannedCost += parseFloat(item.planned_total_cost || 0);
        acc.totalActualCost += parseFloat(item.actual_cost || 0);
        acc.totalVariance += parseFloat(item.cost_variance || 0);
        acc.totalQuantity += parseFloat(item.actual_quantity || 0);
        return acc;
      },
      {
        totalPlannedCost: 0,
        totalActualCost: 0,
        totalVariance: 0,
        totalQuantity: 0,
      }
    );

    summary.averageCostPerUnit =
      summary.totalQuantity > 0
        ? summary.totalActualCost / summary.totalQuantity
        : 0;
    summary.variancePercentage =
      summary.totalPlannedCost > 0
        ? (summary.totalVariance / summary.totalPlannedCost) * 100
        : 0;

    res.status(200).json({
      success: true,
      data: {
        cogmData,
        summary,
        reportPeriod: {
          fromDate,
          toDate,
        },
      },
    });
  } catch (error) {
    console.error("Error generating COGM report:", error);
    res.status(500).json({
      success: false,
      message: "Error generating COGM report",
      error: error.message,
    });
  }
};

// Cost of Goods Sold (COGS) Report
exports.getCOGSReport = async (req, res) => {
  try {
    const { facilityId, fromDate, toDate } = req.body;

    if (!facilityId || !fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: facilityId, fromDate, toDate",
      });
    }

    const query = `
      SELECT
        fgd.id as dispatch_id,
        fgd.dispatch_date,
        fgd.quantity as dispatched_quantity,
        fg.product_name,
        fg.batch_no,
        fg.cost_per_unit,
        (fgd.quantity * fg.cost_per_unit) as total_cogs,
        fgd.customer_id,
        fgd.dispatched_by,
        fgd.notes
      FROM finished_good_dispatches fgd
      LEFT JOIN finished_goods fg ON fgd.finished_good_id = fg.id
      WHERE fgd.facility_id = :facilityId
        AND fgd.dispatch_date >= :fromDate
        AND fgd.dispatch_date <= :toDate
        AND fgd.status = 'dispatched'
      ORDER BY fgd.dispatch_date DESC
    `;

    const cogsData = await db.sequelize.query(query, {
      replacements: { facilityId, fromDate, toDate },
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Calculate summary
    const summary = cogsData.reduce(
      (acc, item) => {
        acc.totalQuantity += parseFloat(item.dispatched_quantity || 0);
        acc.totalCOGS += parseFloat(item.total_cogs || 0);
        return acc;
      },
      {
        totalQuantity: 0,
        totalCOGS: 0,
      }
    );

    summary.averageCOGSPerUnit =
      summary.totalQuantity > 0 ? summary.totalCOGS / summary.totalQuantity : 0;

    res.status(200).json({
      success: true,
      data: {
        cogsData,
        summary,
        reportPeriod: {
          fromDate,
          toDate,
        },
      },
    });
  } catch (error) {
    console.error("Error generating COGS report:", error);
    res.status(500).json({
      success: false,
      message: "Error generating COGS report",
      error: error.message,
    });
  }
};

// Inventory Valuation Report
exports.getInventoryValuationReport = async (req, res) => {
  try {
    const { facilityId, asOfDate, valuationMethod = "FIFO" } = req.body;

    if (!facilityId || !asOfDate) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: facilityId, asOfDate",
      });
    }

    // Raw Materials — AVCO cost computed from actual store_entries receipts.
    // Date filter uses receive_date (transaction date) not createdAt (entry date).
    const rawMaterialsQuery = `
      SELECT
        t.id,
        t.name,
        t.sku,
        t.unit,
        t.reorder_level,
        t.category,
        t.supplier_name,
        t.stock_qty,
        t.avco_cost AS unit_cost,
        t.stock_qty * t.avco_cost AS total_value,
        CASE
          WHEN t.stock_qty <= t.reorder_level       THEN 'Low Stock'
          WHEN t.stock_qty <= t.reorder_level * 1.5 THEN 'Medium Stock'
          ELSE 'Adequate Stock'
        END AS stock_status
      FROM (
        SELECT
          p.id,
          p.name,
          p.sku,
          p.unit_of_measure AS unit,
          p.reorder_level,
          p.category,
          s.supplier_name,
          COALESCE(SUM(se.qty_in), 0) - COALESCE(SUM(se.qty_out), 0) AS stock_qty,
          CASE
            WHEN SUM(CASE WHEN se.qty_in > 0 THEN se.qty_in ELSE 0 END) > 0
            THEN SUM(CASE WHEN se.qty_in > 0 THEN se.qty_in * se.cost_price ELSE 0 END)
                 / SUM(CASE WHEN se.qty_in > 0 THEN se.qty_in ELSE 0 END)
            ELSE COALESCE(p.cost_price, 0)
          END AS avco_cost
        FROM products p
        LEFT JOIN store_entries se
          ON se.product_id = p.sku
          AND se.facilityId = :facilityId
          AND (
            (se.receive_date IS NOT NULL AND se.receive_date <= :asOfDate)
            OR (se.receive_date IS NULL AND DATE(se.createdAt) <= :asOfDate)
          )
        LEFT JOIN suppliersinfo s
          ON p.supplier_id = s.supplier_number
          AND p.facility_id = s.facilityId
        WHERE p.facility_id = :facilityId
          AND p.item_type = 'Raw Material'
        GROUP BY
          p.id, p.name, p.sku, p.unit_of_measure, p.cost_price,
          p.reorder_level, p.category, s.supplier_name
      ) t
      ORDER BY t.name
    `;

    const rawMaterials = await db.sequelize.query(rawMaterialsQuery, {
      replacements: { facilityId, asOfDate },
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Finished Goods — AVCO cost computed from actual store_entries receipts.
    // Uses receive_date for as-of-date filtering (not createdAt).
    // AVCO = SUM(qty_in * cost_price) / SUM(qty_in) across all receipt lines.
    const finishedGoodsQuery = `
      SELECT
        t.id,
        t.product_name,
        t.batch_no,
        t.unit,
        t.category,
        t.status,
        t.quantity,
        t.avco_cost AS cost_per_unit,
        t.quantity * t.avco_cost AS total_value,
        t.warehouse_location,
        t.expiry_date
      FROM (
        SELECT
          p.id,
          p.name AS product_name,
          p.sku AS batch_no,
          p.unit_of_measure AS unit,
          p.category,
          p.item_type AS status,
          COALESCE(SUM(se.qty_in), 0) - COALESCE(SUM(se.qty_out), 0) AS quantity,
          CASE
            WHEN SUM(CASE WHEN se.qty_in > 0 THEN se.qty_in ELSE 0 END) > 0
            THEN SUM(CASE WHEN se.qty_in > 0 THEN se.qty_in * se.cost_price ELSE 0 END)
                 / SUM(CASE WHEN se.qty_in > 0 THEN se.qty_in ELSE 0 END)
            ELSE COALESCE(p.cost_price, 0)
          END AS avco_cost,
          MAX(se.branch_name) AS warehouse_location,
          MAX(se.expiry_date) AS expiry_date
        FROM products p
        LEFT JOIN store_entries se
          ON se.product_id = p.sku
          AND se.facilityId = :facilityId
          AND (
            (se.receive_date IS NOT NULL AND se.receive_date <= :asOfDate)
            OR (se.receive_date IS NULL AND DATE(se.createdAt) <= :asOfDate)
          )
        WHERE p.facility_id = :facilityId
          AND p.item_type IN ('Finished Good', 'By-Product', 'Resalable', 'Semi Finished')
        GROUP BY
          p.id, p.name, p.sku, p.cost_price, p.unit_of_measure,
          p.category, p.item_type
      ) t
      ORDER BY t.product_name
    `;

    const finishedGoods = await db.sequelize.query(finishedGoodsQuery, {
      replacements: { facilityId, asOfDate },
      type: db.sequelize.QueryTypes.SELECT,
    });

    const rawMaterialsTotal = rawMaterials.reduce(
      (sum, item) => sum + parseFloat(item.total_value || 0),
      0
    );
    const finishedGoodsTotal = finishedGoods.reduce(
      (sum, item) => sum + parseFloat(item.total_value || 0),
      0
    );
    const totalInventoryValue = rawMaterialsTotal + finishedGoodsTotal;

    const lowStockItems = rawMaterials.filter(
      (item) => item.stock_status === "Low Stock"
    );

    res.status(200).json({
      success: true,
      data: {
        rawMaterials: {
          items: rawMaterials,
          totalValue: rawMaterialsTotal,
          itemCount: rawMaterials.length,
        },
        finishedGoods: {
          items: finishedGoods,
          totalValue: finishedGoodsTotal,
          itemCount: finishedGoods.length,
        },
        summary: {
          totalInventoryValue,
          rawMaterialsTotal,
          finishedGoodsTotal,
          lowStockItems: lowStockItems.length,
          lowStockAlerts: lowStockItems,
        },
        reportInfo: {
          asOfDate,
          valuationMethod,
          generatedAt: moment().format("YYYY-MM-DD HH:mm:ss"),
        },
      },
    });
  } catch (error) {
    console.error("Error generating inventory valuation report:", error);
    res.status(500).json({
      success: false,
      message: "Error generating inventory valuation report",
      error: error.message,
    });
  }
};

// Production Efficiency Report
exports.getProductionEfficiencyReport = async (req, res) => {
  try {
    const { facilityId, fromDate, toDate } = req.body;

    if (!facilityId || !fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: facilityId, fromDate, toDate",
      });
    }

    const query = `
      SELECT
        po.id as production_order_id,
        po.order_number,
        po.quantity_planned,
        po.quantity_actual,
        po.start_date,
        po.end_date,
        po.status,
        bom.product_name,
        DATEDIFF(po.end_date, po.start_date) as planned_duration,
        DATEDIFF(COALESCE(po.end_date, NOW()), po.start_date) as actual_duration,
        CASE
          WHEN po.status = 'completed' THEN
            CASE
              WHEN po.quantity_actual >= po.quantity_planned THEN 100
              ELSE (po.quantity_actual / po.quantity_planned) * 100
            END
          ELSE 0
        END as quantity_efficiency,
        CASE
          WHEN po.status = 'completed' AND po.end_date IS NOT NULL THEN
            CASE
              WHEN DATEDIFF(po.end_date, po.start_date) <= DATEDIFF(po.end_date, po.start_date) THEN 100
              ELSE GREATEST(0, 100 - ((DATEDIFF(po.end_date, po.start_date) - DATEDIFF(po.end_date, po.start_date)) / DATEDIFF(po.end_date, po.start_date)) * 100)
            END
          ELSE 0
        END as time_efficiency
      FROM production_orders po
      LEFT JOIN bill_of_materials bom ON po.bom_id = bom.id
      WHERE po.facility_id = :facilityId
        AND po.created_at >= :fromDate
        AND po.created_at <= :toDate
      ORDER BY po.created_at DESC
    `;

    const efficiencyData = await db.sequelize.query(query, {
      replacements: { facilityId, fromDate, toDate },
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Calculate summary statistics
    const completedOrders = efficiencyData.filter(
      (item) => item.status === "completed"
    );
    const totalOrders = efficiencyData.length;
    const completionRate =
      totalOrders > 0 ? (completedOrders.length / totalOrders) * 100 : 0;

    const avgQuantityEfficiency =
      completedOrders.length > 0
        ? completedOrders.reduce(
            (sum, item) => sum + parseFloat(item.quantity_efficiency || 0),
            0
          ) / completedOrders.length
        : 0;

    const avgTimeEfficiency =
      completedOrders.length > 0
        ? completedOrders.reduce(
            (sum, item) => sum + parseFloat(item.time_efficiency || 0),
            0
          ) / completedOrders.length
        : 0;

    res.status(200).json({
      success: true,
      data: {
        efficiencyData,
        summary: {
          totalOrders,
          completedOrders: completedOrders.length,
          completionRate,
          avgQuantityEfficiency,
          avgTimeEfficiency,
          overallEfficiency: (avgQuantityEfficiency + avgTimeEfficiency) / 2,
        },
        reportPeriod: {
          fromDate,
          toDate,
        },
      },
    });
  } catch (error) {
    console.error("Error generating production efficiency report:", error);
    res.status(500).json({
      success: false,
      message: "Error generating production efficiency report",
      error: error.message,
    });
  }
};

// Tax Summary Report (FIRS Compliance)
exports.getTaxSummaryReport = async (req, res) => {
  try {
    const { facilityId, fromDate, toDate } = req.body;

    if (!facilityId || !fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: facilityId, fromDate, toDate",
      });
    }

    // VAT on Raw Materials Purchases
    const vatPurchasesQuery = `
      SELECT
        SUM(poi.total_price) as total_purchases,
        SUM(poi.total_price * 0.075) as vat_amount,
        COUNT(DISTINCT po.id) as purchase_orders_count
      FROM purchase_order_items poi
      JOIN purchase_orders po ON poi.po_id = po.id
      WHERE po.facility_id = :facilityId
        AND po.created_at >= :fromDate
        AND po.created_at <= :toDate
        AND po.status = 'completed'
    `;

    const vatPurchases = await db.sequelize.query(vatPurchasesQuery, {
      replacements: { facilityId, fromDate, toDate },
      type: db.sequelize.QueryTypes.SELECT,
    });

    // VAT on Finished Goods Sales (assuming sales are recorded)
    const vatSalesQuery = `
      SELECT
        SUM(fgd.quantity * fg.cost_per_unit) as total_sales,
        SUM(fgd.quantity * fg.cost_per_unit * 0.075) as vat_amount,
        COUNT(DISTINCT fgd.id) as sales_count
      FROM finished_good_dispatches fgd
      JOIN finished_goods fg ON fgd.finished_good_id = fg.id
      WHERE fgd.facility_id = :facilityId
        AND fgd.dispatch_date >= :fromDate
        AND fgd.dispatch_date <= :toDate
        AND fgd.status = 'dispatched'
    `;

    const vatSales = await db.sequelize.query(vatSalesQuery, {
      replacements: { facilityId, fromDate, toDate },
      type: db.sequelize.QueryTypes.SELECT,
    });

    // WHT on Supplier Payments
    const whtQuery = `
      SELECT
        SUM(po.total_amount) as total_payments,
        SUM(po.total_amount * 0.05) as wht_amount,
        COUNT(DISTINCT po.id) as payment_count
      FROM purchase_orders po
      WHERE po.facility_id = :facilityId
        AND po.created_at >= :fromDate
        AND po.created_at <= :toDate
        AND po.status = 'completed'
    `;

    const whtData = await db.sequelize.query(whtQuery, {
      replacements: { facilityId, fromDate, toDate },
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Calculate net VAT payable
    const vatPayable =
      parseFloat(vatSales[0]?.vat_amount || 0) -
      parseFloat(vatPurchases[0]?.vat_amount || 0);

    res.status(200).json({
      success: true,
      data: {
        vatPurchases: {
          totalPurchases: parseFloat(vatPurchases[0]?.total_purchases || 0),
          vatAmount: parseFloat(vatPurchases[0]?.vat_amount || 0),
          purchaseOrdersCount: parseInt(
            vatPurchases[0]?.purchase_orders_count || 0
          ),
        },
        vatSales: {
          totalSales: parseFloat(vatSales[0]?.total_sales || 0),
          vatAmount: parseFloat(vatSales[0]?.vat_amount || 0),
          salesCount: parseInt(vatSales[0]?.sales_count || 0),
        },
        wht: {
          totalPayments: parseFloat(whtData[0]?.total_payments || 0),
          whtAmount: parseFloat(whtData[0]?.wht_amount || 0),
          paymentCount: parseInt(whtData[0]?.payment_count || 0),
        },
        summary: {
          vatPayable,
          whtPayable: parseFloat(whtData[0]?.wht_amount || 0),
          totalTaxLiability:
            vatPayable + parseFloat(whtData[0]?.wht_amount || 0),
        },
        reportPeriod: {
          fromDate,
          toDate,
        },
        taxRates: {
          vat: 7.5,
          wht: 5.0,
        },
      },
    });
  } catch (error) {
    console.error("Error generating tax summary report:", error);
    res.status(500).json({
      success: false,
      message: "Error generating tax summary report",
      error: error.message,
    });
  }
};

// =============================================================================
// Production reporting module (demo dataset)
// =============================================================================

function resolveProductionReportPeriod(body) {
  const fromDate =
    body.fromDate || productionDemo.REPORT_META.defaultPeriod.fromDate;
  const toDate = body.toDate || productionDemo.REPORT_META.defaultPeriod.toDate;
  return { fromDate, toDate };
}

/** Rejected batches must never appear on production reports. */
function appendManufacturingStatusFilter(clauses, statusFilter) {
  if (statusFilter && statusFilter !== "all") {
    if (String(statusFilter).toLowerCase() === "rejected") {
      // Explicit rejected filter still returns nothing — rejected is report-excluded.
      clauses.push("1 = 0");
      return;
    }
    clauses.push("status = :status");
    clauses.push("LOWER(status) <> 'rejected'");
    return;
  }
  clauses.push("LOWER(COALESCE(status, '')) <> 'rejected'");
}

exports.getOperatorProductionReport = async (req, res) => {
  try {
    const { facilityId, fromDate: rawFrom, toDate: rawTo, status: statusFilter } = req.body;
    if (!facilityId) {
      return res.status(400).json({ success: false, message: "Missing required field: facilityId" });
    }

    const fromDate = rawFrom || moment().subtract(30, "days").format("YYYY-MM-DD");
    const toDate = rawTo || moment().format("YYYY-MM-DD");

    const opInnerClauses = ["facility_id = :facilityId"];
    appendManufacturingStatusFilter(opInnerClauses, statusFilter);
    const opInnerWhere = opInnerClauses.join(" AND ");

    const query = `
      SELECT
        pr.id,
        pr.production_date,
        pr.production_line,
        pr.batch_no,
        pr.status,
        pr.type,
        pr.data,
        pr.notes,
        CAST(
          COALESCE(
            JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.runMetrics.goodQty')),
            JSON_UNQUOTE(
              JSON_EXTRACT(pr.data,
                CONCAT('$.sessionHistory[',
                  GREATEST(COALESCE(JSON_LENGTH(JSON_EXTRACT(pr.data, '$.sessionHistory')), 0) - 1, 0),
                '].goodQty')
              )
            ),
            JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.products[0].finishedGoods[0].goodQuantity'))
          ) AS DECIMAL(18,4)
        ) AS good_qty,
        CAST(
          COALESCE(
            JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.runMetrics.wasteQty')),
            JSON_UNQUOTE(
              JSON_EXTRACT(pr.data,
                CONCAT('$.sessionHistory[',
                  GREATEST(COALESCE(JSON_LENGTH(JSON_EXTRACT(pr.data, '$.sessionHistory')), 0) - 1, 0),
                '].brokenQty')
              )
            ),
            JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.products[0].finishedGoods[0].wasteQuantity'))
          ) AS DECIMAL(18,4)
        ) AS waste_qty,
        CAST(
          COALESCE(
            JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.runMetrics.yieldPct')),
            JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.products[0].finishedGoods[0].yieldPct'))
          ) AS DECIMAL(10,2)
        ) AS yield_pct,
        JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.runStatus')) AS run_status,
        pr.created_by AS creator_name
      FROM (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY batch_no
          ORDER BY created_at DESC, id DESC
        ) AS _rn
        FROM production_manufacturing_records
        WHERE ${opInnerWhere}
      ) pr
      WHERE pr._rn = 1
        AND DATE(pr.production_date) >= :fromDate
        AND DATE(pr.production_date) <= :toDate
      ORDER BY pr.production_date DESC, pr.created_at DESC
    `;

    const rawRecords = await db.sequelize.query(query, {
      replacements: { facilityId, fromDate, toDate, status: statusFilter || null },
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Parse JSON data field and build flat rows
    const rows = [];
    for (const rec of rawRecords) {
      let parsedData = {};
      try {
        parsedData = typeof rec.data === "string" ? JSON.parse(rec.data) : (rec.data || {});
      } catch (_) { parsedData = {}; }

      const products = parsedData.products || [];

      // Extract product names across all product entries
      const productNames = [];
      for (const prod of products) {
        const fgs = prod.finishedGoods || prod.finishedGood ? [prod] : [];
        const candidates = fgs.length ? fgs : [prod];
        for (const fg of candidates) {
          const n = fg.description || fg.name || fg.productName || prod.description || prod.name || prod.productName;
          if (n && !productNames.includes(n)) productNames.push(n);
        }
      }

      rows.push({
        id: rec.id,
        date: moment(rec.production_date).format("YYYY-MM-DD"),
        batchNo: rec.batch_no || rec.id,
        productionLine: rec.production_line || "—",
        operator: (rec.creator_name || "").trim() || "—",
        products: productNames.join(", ") || "—",
        goodQty: parseFloat(rec.good_qty || 0),
        wasteQty: parseFloat(rec.waste_qty || 0),
        yieldPct: parseFloat(rec.yield_pct || 0),
        status: rec.status,
        runStatus: rec.run_status,
        type: rec.type,
        notes: rec.notes || "",
      });
    }

    const totalGoodQty = rows.reduce((s, r) => s + r.goodQty, 0);
    const totalWasteQty = rows.reduce((s, r) => s + r.wasteQty, 0);
    const totalOutput = totalGoodQty + totalWasteQty;
    const yieldRows = rows.filter((r) => r.yieldPct > 0);
    const avgYieldPct = yieldRows.length
      ? yieldRows.reduce((s, r) => s + r.yieldPct, 0) / yieldRows.length
      : totalOutput > 0 ? (totalGoodQty / totalOutput) * 100 : 0;
    const operators = new Set(rows.map((r) => r.operator).filter((o) => o && o !== "—"));

    // Per-operator aggregation
    const byOperatorMap = {};
    for (const r of rows) {
      const op = r.operator || "—";
      if (!byOperatorMap[op]) {
        byOperatorMap[op] = { operator: op, batches: 0, goodQty: 0, wasteQty: 0, yieldSum: 0, yieldCount: 0 };
      }
      byOperatorMap[op].batches++;
      byOperatorMap[op].goodQty += r.goodQty;
      byOperatorMap[op].wasteQty += r.wasteQty;
      if (r.yieldPct > 0) {
        byOperatorMap[op].yieldSum += r.yieldPct;
        byOperatorMap[op].yieldCount++;
      }
    }
    const byOperator = Object.values(byOperatorMap)
      .map((o) => ({
        operator: o.operator,
        batches: o.batches,
        goodQty: o.goodQty,
        wasteQty: o.wasteQty,
        avgYieldPct: o.yieldCount ? o.yieldSum / o.yieldCount
          : (o.goodQty + o.wasteQty) > 0 ? (o.goodQty / (o.goodQty + o.wasteQty)) * 100 : 0,
      }))
      .sort((a, b) => b.goodQty - a.goodQty);

    // Per-product aggregation
    const byProductMap = {};
    for (const r of rows) {
      const prods = r.products && r.products !== "—"
        ? r.products.split(", ")
        : ["(Unknown)"];
      for (const p of prods) {
        if (!byProductMap[p]) byProductMap[p] = { product: p, batches: 0, goodQty: 0, wasteQty: 0 };
        byProductMap[p].batches++;
        byProductMap[p].goodQty += r.goodQty;
        byProductMap[p].wasteQty += r.wasteQty;
      }
    }
    const byProduct = Object.values(byProductMap).sort((a, b) => b.goodQty - a.goodQty);

    return res.status(200).json({
      success: true,
      data: {
        rows,
        summary: {
          totalBatches: rows.length,
          operatorCount: operators.size,
          totalGoodQty,
          totalWasteQty,
          totalOutput,
          avgYieldPct,
        },
        byOperator,
        byProduct,
        reportPeriod: { fromDate, toDate },
        isDemoData: false,
      },
    });
  } catch (error) {
    console.error("Operator production report error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating operator production report",
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers for Daily Batch Log & Batch Detail
// ─────────────────────────────────────────────────────────────────────────────

function parseBatchData(raw) {
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw || {};
  } catch (_) {
    return {};
  }
}

function computeYieldStatus(actualYieldPct, expectedYieldPct, batchStatus) {
  const actual = parseFloat(actualYieldPct) || 0;
  const expected = parseFloat(expectedYieldPct) || 0;
  if (actual === 0 && batchStatus === "draft") return "pending_review";
  if (expected === 0) return "within_tolerance";
  // Only flag when actual falls BELOW expected by more than 5 percentage points.
  // Exceeding the expected yield is acceptable (good production efficiency).
  if (actual < expected && (expected - actual) > 5) return "variance_flagged";
  return "within_tolerance";
}

function extractBatchSummary(rec) {
  const d = parseBatchData(rec.data);
  const products = d.products || [];
  const sharedCosts = d.sharedCosts || [];

  // Collect product names & quantities
  const productSummaries = [];
  for (const prod of products) {
    const name = prod.description || prod.name || prod.productName || "";
    const fgs = Array.isArray(prod.finishedGoods) ? prod.finishedGoods : [];
    const qty =
      parseFloat(fgs[0]?.goodQuantity || prod.goodQty || prod.qty || 0);
    if (name) productSummaries.push({ name, qty, type: prod.type || "finished_good" });
  }

  // Extract shared raw material (first "Raw Mat." line in sharedCosts)
  const rawMatLine = sharedCosts.find((l) => (l.type || "").toLowerCase().includes("raw"));
  const scaleOutput = parseFloat(d.output || 1) || 1;
  const rawMaterial = rawMatLine
    ? {
        name:   rawMatLine.description || rawMatLine.accountName || rawMatLine.account || "Raw Material",
        // Actual qty = per-unit qty × scale factor (output); fall back to stored actualQty or qtyUse
        qty:    parseFloat(rawMatLine.actualQty || rawMatLine.actual_qty || 0) ||
                (parseFloat(rawMatLine.qty || 0) * scaleOutput) ||
                parseFloat(d.qtyUse || 0),
        unit:   rawMatLine.unit || "Kg",
        amount: parseFloat(rawMatLine.amount || 0),
      }
    : null;

  // Compute total cost (sum of all product totalCost)
  const totalCost = products.reduce((s, p) => {
    const fgs = Array.isArray(p.finishedGoods) ? p.finishedGoods : [];
    const pc = parseFloat(p.totalCost || fgs[0]?.totalCost || 0);
    return s + pc;
  }, 0);

  // Yield metrics
  const rm = d.runMetrics || {};
  const goodQty  = parseFloat(rm.goodQty  || rec.good_qty  || 0);
  const wasteQty = parseFloat(rm.wasteQty || rec.waste_qty || 0);
  const qtyUse   = parseFloat(d.qtyUse || 1) || 1;
  const inputQty = parseFloat(rawMatLine?.actualQty || rawMatLine?.actual_qty || 0) ||
    (parseFloat(rawMatLine?.qty || rawMatLine?.quantity || 0) * qtyUse) ||
    parseFloat(d.qtyUse || 0);

  // Actual total output (Kg) = Σ(fg.goodQuantity × fg.multiplierValue) across all products.
  // This is the real per-batch output, independent of the template d.output value.
  let totalOutputKg = 0;
  for (const prod of products) {
    const fgs = Array.isArray(prod.finishedGoods) ? prod.finishedGoods : [];
    for (const fg of fgs) {
      const fgGoodQty = parseFloat(fg.goodQuantity || fg.qty || fg.quantity || 0);
      // multiplierValue = kg-per-bag (e.g. 10, 25); also stored as "units" in some records
      const mv = parseFloat(fg.multiplierValue || fg.units || 1) || 1;
      totalOutputKg += fgGoodQty * mv;
    }
  }

  // Recipe raw material qty (per-unit, from the template)
  const recipeRawMatQty =
    parseFloat(rawMatLine?.quantity || rawMatLine?.qty || rawMatLine?.expectedQuantity || 0);

  // Total actual raw material consumed (stored as actualQty, else scale × per-unit qty)
  const rawMatActualInputQty =
    parseFloat(rawMatLine?.actualQty || rawMatLine?.actual_qty || 0) ||
    (recipeRawMatQty * qtyUse) || recipeRawMatQty;

  // Actual Yield % = total output (Kg) ÷ total raw material consumed × 100
  // e.g. Batch-01650: (198×25) ÷ 13800 = 35.87%  |  Batch-01633: (4×10+1×25) ÷ 100 = 65%
  const actualYieldPct =
    rawMatActualInputQty > 0 && totalOutputKg > 0
      ? (totalOutputKg / rawMatActualInputQty) * 100
      : goodQty + wasteQty > 0
        ? (goodQty / (goodQty + wasteQty)) * 100
        : 0;

  // Expected Yield % = template output (d.output=65) ÷ per-unit recipe qty (100) × 100 = 65%
  // rm.yieldPct tracks the by-product (Dusa Action Meal) and is always 100 — do not use it.
  const perRunOutput = parseFloat(d.output || 0);
  const expectedYieldPct =
    recipeRawMatQty > 0 && perRunOutput > 0
      ? (perRunOutput / recipeRawMatQty) * 100
      : actualYieldPct || 65;

  const variancePct = expectedYieldPct > 0
    ? ((actualYieldPct - expectedYieldPct) / expectedYieldPct) * 100
    : 0;

  const yieldStatus = computeYieldStatus(actualYieldPct, expectedYieldPct, rec.status);

  return {
    id: rec.id,
    batchNo: rec.batch_no || rec.id,
    date: moment(rec.production_date).format("YYYY-MM-DD"),
    productionLine: rec.production_line || null,
    status: rec.status,
    yieldStatus,
    type: rec.type,
    costingType: d.costingType || rec.type || "job_specific",
    products: productSummaries,
    rawMaterial,
    totalCost,
    goodQty,
    wasteQty,
    inputQty,
    actualQty: goodQty || inputQty,
    actualYieldPct,
    expectedYieldPct,
    variancePct,
    varianceReason: d.varianceReason || null,
    operator: (rec.creator_name || "").trim() || null,
    notes: rec.notes || "",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/production/daily-batch-log
// ─────────────────────────────────────────────────────────────────────────────
exports.getDailyBatchLog = async (req, res) => {
  try {
    const {
      facilityId,
      fromDate: rawFrom,
      toDate: rawTo,
      status: statusFilter,
      yieldStatus: yieldFilter,
      costingType: costingTypeFilter,
      page = 1,
      pageSize = 20,
    } = req.body;

    if (!facilityId) {
      return res.status(400).json({ success: false, message: "facilityId is required" });
    }

    const fromDate = rawFrom || moment().subtract(30, "days").format("YYYY-MM-DD");
    const toDate = rawTo || moment().format("YYYY-MM-DD");

    // Build inner-subquery filters (applied before ROW_NUMBER so ranking only
    // considers rows that match the requested status / costing type).
    const innerClauses = ["facility_id = :facilityId"];
    appendManufacturingStatusFilter(innerClauses, statusFilter);

    const COSTING_TYPE_MAP = {
      job_specific: ["job_specific", "job"],
      joint_shared: ["joint_shared", "joint"],
    };
    const costingTypeValues = costingTypeFilter && COSTING_TYPE_MAP[costingTypeFilter];
    if (costingTypeValues) {
      innerClauses.push(`type IN (${costingTypeValues.map((v) => `'${v}'`).join(",")})`);
    }

    const innerWhere = innerClauses.join(" AND ");

    const query = `
      SELECT
        pr.id, pr.batch_no, pr.production_date, pr.production_line,
        pr.type, pr.status, pr.notes, pr.data, pr.created_by AS creator_name
      FROM (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY batch_no
          ORDER BY created_at DESC, id DESC
        ) AS _rn
        FROM production_manufacturing_records
        WHERE ${innerWhere}
      ) pr
      WHERE pr._rn = 1
        AND DATE(pr.production_date) >= :fromDate
        AND DATE(pr.production_date) <= :toDate
      ORDER BY pr.production_date DESC, pr.created_at DESC
    `;

    const rawRecords = await db.sequelize.query(query, {
      replacements: { facilityId, fromDate, toDate, status: statusFilter || null },
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Build batch summaries
    let batches = rawRecords.map(extractBatchSummary);

    // Apply yield status filter (client-computable but done server-side for accuracy)
    if (yieldFilter && yieldFilter !== "all") {
      batches = batches.filter((b) => b.yieldStatus === yieldFilter);
    }

    // Summary stats
    const flaggedCount = batches.filter((b) => b.yieldStatus === "variance_flagged").length;
    const totalCost = batches.reduce((s, b) => s + b.totalCost, 0);
    const yieldRows = batches.filter((b) => b.actualYieldPct > 0);
    const avgYieldPct = yieldRows.length
      ? yieldRows.reduce((s, b) => s + b.actualYieldPct, 0) / yieldRows.length
      : 0;

    // Paginate
    const total = batches.length;
    const offset = (Number(page) - 1) * Number(pageSize);
    const pagedBatches = batches.slice(offset, offset + Number(pageSize));

    return res.status(200).json({
      success: true,
      data: {
        batches: pagedBatches,
        pagination: { page: Number(page), pageSize: Number(pageSize), total, totalPages: Math.ceil(total / Number(pageSize)) },
        summary: {
          totalBatches: total,
          totalCost,
          avgYieldPct,
          flaggedCount,
        },
        reportPeriod: { fromDate, toDate },
      },
    });
  } catch (error) {
    console.error("Daily batch log error:", error);
    res.status(500).json({ success: false, message: "Error generating daily batch log", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/reports/production/batch-detail
// ─────────────────────────────────────────────────────────────────────────────
exports.getBatchDetail = async (req, res) => {
  try {
    const { facilityId, batchId } = req.body;
    if (!facilityId || !batchId) {
      return res.status(400).json({ success: false, message: "facilityId and batchId are required" });
    }

    const query = `
      SELECT
        pr.id, pr.batch_no, pr.production_date, pr.production_line,
        pr.type, pr.status, pr.notes, pr.data, pr.created_at,
        CONCAT(COALESCE(u.firstname,''), ' ', COALESCE(u.lastname,'')) AS creator_name
      FROM production_manufacturing_records pr
      LEFT JOIN users u ON u.id = pr.created_by
      WHERE pr.facility_id = :facilityId
        AND (pr.id = :batchId OR pr.batch_no = :batchId)
        AND LOWER(COALESCE(pr.status, '')) <> 'rejected'
      LIMIT 1
    `;

    const [rec] = await db.sequelize.query(query, {
      replacements: { facilityId, batchId },
      type: db.sequelize.QueryTypes.SELECT,
    });

    if (!rec) {
      return res.status(404).json({ success: false, message: "Batch not found" });
    }

    const d = parseBatchData(rec.data);
    const rm = d.runMetrics || {};
    const sharedCosts = d.sharedCosts || [];
    const products = d.products || [];

    // Yield metrics
    const goodQty   = parseFloat(rm.goodQty  || 0);
    const wasteQty  = parseFloat(rm.wasteQty || 0);
    const qtyUseDetail = parseFloat(d.qtyUse || 1) || 1;
    const rawMatLineDetail = sharedCosts.find((l) => (l.type || "").toLowerCase().includes("raw"));

    const recipeRawMatQtyDetail =
      parseFloat(rawMatLineDetail?.quantity || rawMatLineDetail?.qty || rawMatLineDetail?.expectedQuantity || 0);
    const rawMatActualInputQtyDetail =
      parseFloat(rawMatLineDetail?.actualQty || rawMatLineDetail?.actual_qty || 0) ||
      (recipeRawMatQtyDetail * qtyUseDetail) || recipeRawMatQtyDetail;
    const inputQty = rawMatActualInputQtyDetail || parseFloat(d.qtyUse || 0);

    // Actual total output (Kg) = Σ(fg.goodQuantity × fg.multiplierValue) across all products
    let totalOutputKgDetail = 0;
    for (const prod of products) {
      const fgs = Array.isArray(prod.finishedGoods) ? prod.finishedGoods : [];
      for (const fg of fgs) {
        const fgGoodQty = parseFloat(fg.goodQuantity || fg.qty || fg.quantity || 0);
        const mv = parseFloat(fg.multiplierValue || fg.units || 1) || 1;
        totalOutputKgDetail += fgGoodQty * mv;
      }
    }

    // Actual Yield % = total output (Kg) ÷ total raw material consumed × 100
    const actualYieldPct =
      rawMatActualInputQtyDetail > 0 && totalOutputKgDetail > 0
        ? (totalOutputKgDetail / rawMatActualInputQtyDetail) * 100
        : goodQty + wasteQty > 0
          ? (goodQty / (goodQty + wasteQty)) * 100
          : 0;

    // Expected Yield % = template output (d.output) ÷ per-unit recipe qty × 100
    // rm.yieldPct tracks the by-product yield (always 100) — do not use it.
    const perRunOutputDetail = parseFloat(d.output || 0);
    const expectedYieldPct =
      recipeRawMatQtyDetail > 0 && perRunOutputDetail > 0
        ? (perRunOutputDetail / recipeRawMatQtyDetail) * 100
        : actualYieldPct || 65;

    const variancePct = expectedYieldPct > 0
      ? ((actualYieldPct - expectedYieldPct) / expectedYieldPct) * 100
      : 0;

    const scaleUnits = qtyUseDetail;

    // Shared cost lines — normalize shape and compute amounts when not stored
    // First pass: get the raw-material subtotal so % lines can be computed
    const rawMatSubtotal = sharedCosts.reduce((sum, line) => {
      if ((line.type || "").toLowerCase().includes("raw")) {
        const storedAmt = parseFloat(line.amount || 0);
        if (storedAmt) return sum + storedAmt;
        // rate × actual qty (per-unit qty × scale output)
        const rate = parseFloat(line.input || line.rate || 0);
        const perUnitQty = parseFloat(line.qty || line.quantity || 0);
        return sum + (rate * perUnitQty * scaleUnits);
      }
      return sum;
    }, 0);

    let runningBase = rawMatSubtotal;
    const sharedCostLines = sharedCosts.map((line) => {
      const storedAmt  = parseFloat(line.amount || 0);
      const lineType   = (line.type || "").toLowerCase();
      const isRaw      = lineType.includes("raw");
      const isCredit   = lineType.includes("by-prod") ||
                         lineType.includes("by_prod") ||
                         lineType.includes("byp") ||
                         storedAmt < 0;
      const isPercent  = (line.otherType || line.other_type || "") === "percentage" ||
                         (line.basis || line.basisType || "") === "%" ||
                         (line.basisLabel || "").includes("%");
      const rate       = parseFloat(line.input || line.rate || 0);
      const perUnitQty = parseFloat(line.qty || line.quantity || 0);
      // For raw material, prefer stored actualQty for the total consumed
      const rawActual  = parseFloat(line.actualQty || line.actual_qty || 0) ||
                         (perUnitQty * scaleUnits);

      let amount = storedAmt;
      if (!amount) {
        if (isRaw) {
          amount = rate * rawActual;
        } else if (isPercent) {
          // perUnitQty stores the percentage value (e.g. 5 for 5%)
          const pct = parseFloat(line.pctValue || line.basisValue || perUnitQty || 0);
          amount = (pct / 100) * runningBase;
        } else if (rate > 0) {
          amount = rate * scaleUnits;
        }
      }

      // Update running base for subsequent % lines — skip raw (already in rawMatSubtotal) and credits
      if (!isCredit && !isRaw) runningBase += amount;

      const description = line.description || line.accountName || line.account || line.accountCode || "";
      return {
        accountCode:  line.account || line.accountCode || "",
        accountName:  line.accountName || line.description || line.account || "",
        description,
        type:         isRaw ? "raw_material" : isCredit ? "by_product" : "other",
        basisType:    isPercent ? "%" : (rate > 0 ? "rate" : "fixed"),
        basisValue:   isPercent ? perUnitQty : (rate || parseFloat(line.basisValue || 0)),
        amount,
        isCredit,
      };
    });

    // Gross = sum of all amounts (credits stored as positive).
    // Net   = gross minus credit amounts → used for proportional cost allocation.
    const totalSharedCost    = sharedCostLines.reduce((s, l) => s + l.amount, 0);
    const netSharedCost      = sharedCostLines.reduce((s, l) => l.isCredit ? s - l.amount : s + l.amount, 0);
    const totalSharedCostPerUnit = scaleUnits > 0 ? totalSharedCost / scaleUnits : 0;

    // Products — normalize shape
    const productItems = products.map((prod) => {
      const fgs = Array.isArray(prod.finishedGoods) ? prod.finishedGoods : [];
      const fg = fgs[0] || {};
      const qtyProduced = parseFloat(fg.goodQuantity || prod.goodQty || prod.qty || 0);
      const multiplierValue = parseFloat(fg.multiplierValue || fg.units || prod.multiplierValue || 1) || 1;

      // Joint/shared batches store per-product cost lines in prod.items (ingredients array).
      // Job-specific batches use prod.rawMaterialLines / prod.otherCostLines.
      const prodItems = Array.isArray(prod.items) ? prod.items : [];

      const rawMaterialLines = [
        ...(prod.rawMaterialLines || []).map((l) => ({
          name: l.description || l.name || l.rawMaterialName || l.productName || "",
          sku:  l.rawMaterialSku || l.sku || "",
          qty:  parseFloat(l.qty || l.quantity || l.qtyUsed || 0),
          rate: parseFloat(l.rate || l.unit_cost || l.costPrice || 0),
          amount: parseFloat(l.amount || 0) || parseFloat(l.qty || l.qtyUsed || 0) * parseFloat(l.rate || l.unit_cost || 0),
          type: "raw_material",
        })),
        ...prodItems
          .filter((l) => (l.type || "").toLowerCase() === "raw_material")
          .map((l) => {
            const qty  = parseFloat(l.qtyUsed || l.quantity || 0);
            const rate = parseFloat(l.unit_cost || l.rate || 0);
            return {
              name: l.rawMaterialName || l.description || "",
              sku:  l.rawMaterialSku  || "",
              qty,
              rate,
              amount: parseFloat(l.amount || 0) || qty * rate,
              type: "raw_material",
            };
          }),
      ];

      const otherCostLines = [
        ...(prod.otherCostLines || prod.otherCosts || []).map((l) => ({
          accountCode: l.account || l.accountCode || "",
          accountName: l.accountName || l.description || "",
          rate: parseFloat(l.rate || 0),
          qty:  parseFloat(l.qty || 0),
          amount: parseFloat(l.amount || 0),
          basisType: l.basisType || "rate",
        })),
        ...prodItems
          .filter((l) => {
            const t = (l.type || "").toLowerCase();
            return t === "other" || t === "overhead";
          })
          .map((l) => {
            const isPercent = (l.otherType || l.other_type || "").toLowerCase() === "percentage";
            const rate = parseFloat(l.unit_cost || l.rate || l.percentageBasis || 0);
            const qty  = parseFloat(l.quantity || l.qty || 0);
            return {
              accountCode: l.descriptionCode || l.accountHead || "",
              accountName: l.description || l.accountName || "",
              rate,
              qty,
              amount: parseFloat(l.amount || 0) || (isPercent ? 0 : qty * rate),
              basisType: isPercent ? "%" : "rate",
            };
          }),
      ];
      const sharedCostAllocated = parseFloat(prod.sharedCostAllocated || 0);
      const totalCost = parseFloat(prod.totalCost || fg.totalCost || 0);
      const costPerUnit = qtyProduced > 0 ? totalCost / qtyProduced : 0;

      // Rounding adjustment: compare sum of line items vs totalCost
      const lineTotal =
        rawMaterialLines.reduce((s, l) => s + l.amount, 0) +
        otherCostLines.reduce((s, l) => s + l.amount, 0) +
        sharedCostAllocated;
      const roundingAdj = totalCost > 0 ? totalCost - lineTotal : 0;

      return {
        productId: prod.productId || prod.product_id || "",
        name: prod.description || prod.name || prod.productName || "(Unnamed)",
        type: prod.type || "finished_good",
        qtyProduced,
        multiplierValue,
        unit: fg.unit || prod.unit || "units",
        rawMaterialLines,
        otherCostLines,
        sharedCostAllocated,
        roundingAdj: Math.abs(roundingAdj) > 0.01 ? roundingAdj : 0,
        totalCost,
        costPerUnit,
        // Markup / selling price (finished goods only)
        markupType: prod.markupType || prod.markup_type || null,
        markupValue: parseFloat(prod.markupValue || prod.markup_value || 0),
        vatPct: parseFloat(prod.vatPct || prod.vat_pct || 0),
        sellingPrice: parseFloat(prod.sellingPrice || prod.selling_price || 0),
      };
    });

    // For joint/shared batches the individual totalCost is often 0.
    // Allocate using NET shared cost (gross minus by-product credits) proportionally
    // by output weight (qty × multiplierValue) — matching the costing page formula.
    const allZeroCost = productItems.every((p) => p.totalCost === 0);
    if (allZeroCost && netSharedCost !== 0) {
      const fgItems = productItems.filter((p) => p.type !== "by_product");
      const totalOutputKg = fgItems.reduce((s, p) => s + p.qtyProduced * p.multiplierValue, 0);
      if (totalOutputKg > 0) {
        for (const p of fgItems) {
          const outputKg = p.qtyProduced * p.multiplierValue;
          p.totalCost   = (outputKg / totalOutputKg) * netSharedCost;
          p.costPerUnit = p.qtyProduced > 0 ? p.totalCost / p.qtyProduced : 0;
          p.proportion  = outputKg / totalOutputKg;
        }
      }
    }

    // Append by-product from templateByProduct if present
    const tbp = d.templateByProduct;
    if (tbp && tbp.productName) {
      const tbpUnits    = parseFloat(tbp.units || 1);
      const tbpUnitCost = parseFloat(tbp.unit_cost || 0);
      const tbpItems    = Array.isArray(tbp.items) ? tbp.items : [];

      // Map template lines into raw/other breakdown (mirror costing page display)
      const tbpRawLines = [];
      const tbpOtherLines = [];
      let tbpRawSubtotal = 0;

      for (const item of tbpItems) {
        const t   = (item.type || "").toLowerCase();
        const qty = parseFloat(item.quantity || 0);
        const rate = parseFloat(item.unit_cost || item.rate || 0);
        const amount = qty * tbpUnits * rate;

        if (t === "raw_material") {
          tbpRawSubtotal += amount;
          tbpRawLines.push({
            name:   item.rawMaterialName || item.description || "",
            sku:    item.rawMaterialSku  || "",
            qty:    qty * tbpUnits,
            rate,
            amount,
            type:  "raw_material",
          });
        } else if (t !== "by_product_credit") {
          const isPercent = (item.otherType || "").toLowerCase() === "percentage";
          const pct       = parseFloat(item.percentageBasis || rate || 0);
          const lineAmt   = isPercent ? (pct / 100) * tbpRawSubtotal : amount;
          tbpOtherLines.push({
            accountName: item.description || item.descriptionCode || item.accountHead || "",
            qty:         qty * tbpUnits,
            rate:        isPercent ? pct : rate,
            amount:      lineAmt,
            basisType:   isPercent ? "%" : "rate",
            type:        "other",
          });
        }
      }

      productItems.push({
        productId: String(tbp.productId || tbp.productSku || "byp"),
        name: tbp.productName,
        type: "by_product",
        qtyProduced: tbpUnits,
        multiplierValue: 1,
        unit: tbp.unitOfMeasure || tbp.unit || "units",
        rawMaterialLines: tbpRawLines,
        otherCostLines:   tbpOtherLines,
        rawSubtotal:      tbpRawSubtotal,
        byProductUnitCost: tbpUnitCost,
        sharedCostAllocated: 0,
        roundingAdj: 0,
        totalCost:   tbpUnitCost * tbpUnits,
        costPerUnit: tbpUnitCost,
        markupType: null,
        markupValue: 0,
        vatPct: 0,
        sellingPrice: 0,
      });
    }

    const summary = extractBatchSummary(rec);

    return res.status(200).json({
      success: true,
      data: {
        batch: {
          id: rec.id,
          batchNo: rec.batch_no || rec.id,
          date: moment(rec.production_date).format("YYYY-MM-DD"),
          productionLine: rec.production_line || null,
          type: rec.type,
          costingType: d.costingType || rec.type,
          status: rec.status,
          yieldStatus: summary.yieldStatus,
          varianceReason: d.varianceReason || null,
          createdAt: rec.created_at,
          rawMaterial: {
            name: rawMatLineDetail?.description || rawMatLineDetail?.accountName || "Raw Material",
            qty:  rawMatActualInputQtyDetail,
            unit: rawMatLineDetail?.unit || "Kg",
          },
        },
        yieldMetrics: {
          inputQty,
          goodQty,
          wasteQty,
          outputQty: totalOutputKgDetail,
          actualYieldPct,
          expectedYieldPct,
          variancePct,
          varianceAmountPerUnit:
            Math.abs(variancePct) > 0 && totalSharedCostPerUnit > 0
              ? (variancePct / 100) * totalSharedCostPerUnit
              : 0,
        },
        sharedCostLines,
        totalSharedCost,
        netSharedCost,
        totalSharedCostPerUnit,
        scaleUnits,
        productItems,
      },
    });
  } catch (error) {
    console.error("Batch detail error:", error);
    res.status(500).json({ success: false, message: "Error fetching batch detail", error: error.message });
  }
};

exports.getProductProductionSummaryReport = async (req, res) => {
  try {
    const { facilityId } = req.body;
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Missing required field: facilityId",
      });
    }
    const { fromDate, toDate } = resolveProductionReportPeriod(req.body);
    res.status(200).json({
      success: true,
      data: productionDemo.getProductProductionSummaryReport({ fromDate, toDate }),
    });
  } catch (error) {
    console.error("Product production summary error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating product production summary report",
      error: error.message,
    });
  }
};

exports.getProductionVsSalesComparisonReport = async (req, res) => {
  try {
    const { facilityId } = req.body;
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Missing required field: facilityId",
      });
    }
    const { fromDate, toDate } = resolveProductionReportPeriod(req.body);
    res.status(200).json({
      success: true,
      data: productionDemo.getProductionVsSalesReport({ fromDate, toDate }),
    });
  } catch (error) {
    console.error("Production vs sales report error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating production vs sales comparison report",
      error: error.message,
    });
  }
};

function rmEntryDateSql() {
  return "DATE(se.createdAt)";
}

/** RM store only — excludes WIP receive legs of material_issue / consumed. */
function rmWarehouseConditionSql() {
  return `LOWER(TRIM(COALESCE(se.branch_name, ''))) IN ('raw material', 'raw materials')`;
}

async function queryRawMaterialsInventory({
  facilityId,
  mode = "snapshot",
  asOfDate,
  fromDate,
  toDate,
}) {
  const entryDateSql = rmEntryDateSql();
  const warehouseSql = rmWarehouseConditionSql();
  const purchaseType = STORE_ENTRY_TYPE.PURCHASE;
  const materialIssueType = STORE_ENTRY_TYPE.MATERIAL_ISSUE;
  const adjustmentType = STORE_ENTRY_TYPE.ADJUSTMENT;
  const openingBalanceType = STORE_ENTRY_TYPE.OPENING_BALANCE;
  const isMovement = mode === "movement";

  if (!isMovement) {
    const snapshotQuery = `
      SELECT
        t.id,
        t.name,
        t.sku,
        t.unit,
        t.quantity AS quantity_on_hand,
        t.avco_cost AS cost_per_unit,
        t.quantity * t.avco_cost AS inventory_value,
        t.quantity AS stock_qty
      FROM (
        SELECT
          p.id,
          p.name,
          p.sku,
          p.unit_of_measure AS unit,
          COALESCE(SUM(
            CASE WHEN ${entryDateSql} <= :asOfDate THEN se.qty_in ELSE 0 END
          ), 0) - COALESCE(SUM(
            CASE WHEN ${entryDateSql} <= :asOfDate THEN se.qty_out ELSE 0 END
          ), 0) AS quantity,
          CASE
            WHEN SUM(CASE WHEN se.qty_in > 0 AND ${entryDateSql} <= :asOfDate THEN se.qty_in ELSE 0 END) > 0
            THEN SUM(CASE WHEN se.qty_in > 0 AND ${entryDateSql} <= :asOfDate THEN se.qty_in * se.cost_price ELSE 0 END)
                 / SUM(CASE WHEN se.qty_in > 0 AND ${entryDateSql} <= :asOfDate THEN se.qty_in ELSE 0 END)
            ELSE COALESCE(p.cost_price, 0)
          END AS avco_cost
        FROM products p
        LEFT JOIN store_entries se
          ON se.product_id = p.sku
          AND se.facilityId = :facilityId
          AND ${warehouseSql}
        WHERE p.facility_id = :facilityId
          AND p.item_type = 'Raw Material'
        GROUP BY
          p.id, p.name, p.sku, p.cost_price, p.unit_of_measure
      ) t
      WHERE t.quantity > 0
      ORDER BY t.name
    `;

    return db.sequelize.query(snapshotQuery, {
      replacements: { facilityId, asOfDate },
      type: db.sequelize.QueryTypes.SELECT,
    });
  }

  const inPeriod = `(${entryDateSql} >= :fromDate AND ${entryDateSql} <= :toDate)`;
  const movementQuery = `
      SELECT
        t.id,
        t.name,
        t.sku,
        t.unit,
        t.opening_quantity,
        t.purchased_quantity,
        t.production_issue_quantity,
        t.adjustments_quantity,
        t.stock_qty AS closing_quantity,
        t.stock_qty
      FROM (
        SELECT
          p.id,
          p.name,
          p.sku,
          p.unit_of_measure AS unit,
          COALESCE(SUM(
            CASE WHEN ${entryDateSql} < :fromDate THEN se.qty_in ELSE 0 END
          ), 0) - COALESCE(SUM(
            CASE WHEN ${entryDateSql} < :fromDate THEN se.qty_out ELSE 0 END
          ), 0)
          + COALESCE(SUM(
            CASE
              WHEN ${inPeriod} AND se.type = '${openingBalanceType}'
              THEN COALESCE(se.qty_in, 0) - COALESCE(se.qty_out, 0)
              ELSE 0
            END
          ), 0) AS opening_quantity,
          COALESCE(SUM(
            CASE
              WHEN ${inPeriod} AND se.type = '${purchaseType}'
              THEN se.qty_in
              ELSE 0
            END
          ), 0) AS purchased_quantity,
          COALESCE(SUM(
            CASE
              WHEN ${inPeriod}
                AND se.type = '${materialIssueType}'
                AND se.qty_out > 0
              THEN se.qty_out
              ELSE 0
            END
          ), 0) AS production_issue_quantity,
          COALESCE(SUM(
            CASE
              WHEN ${inPeriod} AND se.type = '${adjustmentType}'
              THEN COALESCE(se.qty_in, 0) - COALESCE(se.qty_out, 0)
              ELSE 0
            END
          ), 0) AS adjustments_quantity,
          COALESCE(SUM(
            CASE WHEN ${entryDateSql} <= :toDate THEN se.qty_in ELSE 0 END
          ), 0) - COALESCE(SUM(
            CASE WHEN ${entryDateSql} <= :toDate THEN se.qty_out ELSE 0 END
          ), 0) AS stock_qty
        FROM products p
        LEFT JOIN store_entries se
          ON se.product_id = p.sku
          AND se.facilityId = :facilityId
          AND ${warehouseSql}
        WHERE p.facility_id = :facilityId
          AND p.item_type = 'Raw Material'
        GROUP BY
          p.id, p.name, p.sku, p.unit_of_measure
      ) t
      WHERE
        t.stock_qty <> 0
        OR t.opening_quantity <> 0
        OR t.purchased_quantity <> 0
        OR t.production_issue_quantity <> 0
        OR t.adjustments_quantity <> 0
      ORDER BY t.name
    `;

  return db.sequelize.query(movementQuery, {
    replacements: { facilityId, fromDate, toDate },
    type: db.sequelize.QueryTypes.SELECT,
  });
}

const FG_ITEM_TYPES_SQL =
  "'Finished Good', 'By-Product', 'Resalable', 'Semi Finished'";

function fgEntryDateSql() {
  return "DATE(se.createdAt)";
}

function fgSoldConditionSql(inPeriodExpr) {
  // Sales + pro-bono (and legacy sold markers)
  return `
    ${inPeriodExpr}
    AND se.qty_out > 0
    AND (
      se.type IN (${salesTypesSqlList()})
      OR se.destination = 'sold'
      OR LOWER(TRIM(se.source)) = 'for sales'
    )
  `;
}

function fgTransferInConditionSql(inPeriodExpr) {
  return `
    ${inPeriodExpr}
    AND se.qty_in > 0
    AND se.type IN ('${STORE_ENTRY_TYPE.TRANSFER}', '${STORE_ENTRY_TYPE.MATERIAL_ISSUE}')
  `;
}

function fgTransferOutConditionSql(inPeriodExpr) {
  return `
    ${inPeriodExpr}
    AND se.qty_out > 0
    AND se.type IN ('${STORE_ENTRY_TYPE.TRANSFER}', '${STORE_ENTRY_TYPE.MATERIAL_ISSUE}')
  `;
}

/**
 * Snapshot: Qty on Hand / Unit Cost / Inventory Value as of a date.
 * Movement: Opening … Closing over [fromDate, toDate], with transfers and sold (incl. pro-bono).
 */
async function queryFinishedGoodsInventory({
  facilityId,
  mode = "snapshot",
  asOfDate,
  fromDate,
  toDate,
  groupByLocation = false,
  branchId = null,
}) {
  const entryDateSql = fgEntryDateSql();
  const productionType = STORE_ENTRY_TYPE.PRODUCTION;
  const isMovement = mode === "movement";
  const inPeriod = `(${entryDateSql} >= :fromDate AND ${entryDateSql} <= :toDate)`;

  const branchFilter =
    groupByLocation &&
    branchId !== null &&
    branchId !== undefined &&
    branchId !== "" &&
    branchId !== "all"
      ? "AND COALESCE(se.branchId, 0) = :branchId"
      : "";

  const locationSelect = groupByLocation
    ? `
        COALESCE(se.branchId, 0) AS branch_id,
        COALESCE(
          NULLIF(TRIM(MAX(b.branch_name)), ''),
          CASE
            WHEN COALESCE(se.branchId, 0) = 0 THEN 'Unassigned'
            ELSE CONCAT('Branch #', COALESCE(se.branchId, 0))
          END
        ) AS warehouse_location,
      `
    : "";

  const locationJoin = groupByLocation
    ? `
        LEFT JOIN branches b
          ON b.id = se.branchId
          AND b.id <> 0
      `
    : "";

  const locationGroupBy = groupByLocation
    ? ", COALESCE(se.branchId, 0)"
    : "";

  const locationOuterFields = groupByLocation
    ? `
        t.branch_id,
        t.warehouse_location,
      `
    : "";

  if (!isMovement) {
    // Snapshot as of asOfDate
    const snapshotQuery = `
      SELECT
        t.id,
        t.product_name,
        t.batch_no,
        t.unit,
        t.status,
        t.quantity AS quantity_on_hand,
        t.avco_cost AS cost_per_unit,
        t.quantity * t.avco_cost AS inventory_value,
        t.quantity,
        ${locationOuterFields}
        t.expiry_date
      FROM (
        SELECT
          p.id,
          p.name AS product_name,
          p.sku AS batch_no,
          p.unit_of_measure AS unit,
          p.item_type AS status,
          ${locationSelect}
          COALESCE(SUM(
            CASE WHEN ${entryDateSql} <= :asOfDate THEN se.qty_in ELSE 0 END
          ), 0) - COALESCE(SUM(
            CASE WHEN ${entryDateSql} <= :asOfDate THEN se.qty_out ELSE 0 END
          ), 0) AS quantity,
          CASE
            WHEN SUM(CASE WHEN se.qty_in > 0 AND ${entryDateSql} <= :asOfDate THEN se.qty_in ELSE 0 END) > 0
            THEN SUM(CASE WHEN se.qty_in > 0 AND ${entryDateSql} <= :asOfDate THEN se.qty_in * se.cost_price ELSE 0 END)
                 / SUM(CASE WHEN se.qty_in > 0 AND ${entryDateSql} <= :asOfDate THEN se.qty_in ELSE 0 END)
            ELSE COALESCE(p.cost_price, 0)
          END AS avco_cost,
          MAX(se.expiry_date) AS expiry_date
        FROM products p
        LEFT JOIN store_entries se
          ON se.product_id = p.sku
          AND se.facilityId = :facilityId
          ${branchFilter}
        ${locationJoin}
        WHERE p.facility_id = :facilityId
          AND p.item_type IN (${FG_ITEM_TYPES_SQL})
        GROUP BY
          p.id, p.name, p.sku, p.cost_price, p.unit_of_measure, p.item_type
          ${locationGroupBy}
      ) t
      WHERE t.quantity > 0
      ORDER BY ${groupByLocation ? "t.warehouse_location, " : ""}t.product_name
    `;

    const replacements = { facilityId, asOfDate };
    if (branchFilter) replacements.branchId = Number(branchId) || 0;

    return db.sequelize.query(snapshotQuery, {
      replacements,
      type: db.sequelize.QueryTypes.SELECT,
    });
  }

  // Movement report for [fromDate, toDate]
  const movementQuery = `
      SELECT
        t.id,
        t.product_name,
        t.batch_no,
        t.unit,
        t.status,
        t.opening_quantity,
        t.produced_quantity,
        t.transfers_in_quantity,
        t.sold_quantity,
        t.transfers_out_quantity,
        (
          t.quantity
          - t.opening_quantity
          - t.produced_quantity
          - t.transfers_in_quantity
          + t.sold_quantity
          + t.transfers_out_quantity
        ) AS adjustments_quantity,
        t.quantity AS closing_quantity,
        t.quantity,
        t.avco_cost AS cost_per_unit,
        t.quantity * t.avco_cost AS inventory_value,
        ${locationOuterFields}
        t.expiry_date
      FROM (
        SELECT
          p.id,
          p.name AS product_name,
          p.sku AS batch_no,
          p.unit_of_measure AS unit,
          p.item_type AS status,
          ${locationSelect}
          COALESCE(SUM(
            CASE WHEN ${entryDateSql} < :fromDate THEN se.qty_in ELSE 0 END
          ), 0) - COALESCE(SUM(
            CASE WHEN ${entryDateSql} < :fromDate THEN se.qty_out ELSE 0 END
          ), 0) AS opening_quantity,
          COALESCE(SUM(
            CASE
              WHEN ${inPeriod} AND se.type = '${productionType}'
              THEN se.qty_in
              ELSE 0
            END
          ), 0) AS produced_quantity,
          COALESCE(SUM(
            CASE
              WHEN ${fgTransferInConditionSql(inPeriod)}
              THEN se.qty_in
              ELSE 0
            END
          ), 0) AS transfers_in_quantity,
          COALESCE(SUM(
            CASE
              WHEN ${fgSoldConditionSql(inPeriod)}
              THEN se.qty_out
              ELSE 0
            END
          ), 0) AS sold_quantity,
          COALESCE(SUM(
            CASE
              WHEN ${fgTransferOutConditionSql(inPeriod)}
              THEN se.qty_out
              ELSE 0
            END
          ), 0) AS transfers_out_quantity,
          COALESCE(SUM(
            CASE WHEN ${entryDateSql} <= :toDate THEN se.qty_in ELSE 0 END
          ), 0) - COALESCE(SUM(
            CASE WHEN ${entryDateSql} <= :toDate THEN se.qty_out ELSE 0 END
          ), 0) AS quantity,
          CASE
            WHEN SUM(CASE WHEN se.qty_in > 0 AND ${entryDateSql} <= :toDate THEN se.qty_in ELSE 0 END) > 0
            THEN SUM(CASE WHEN se.qty_in > 0 AND ${entryDateSql} <= :toDate THEN se.qty_in * se.cost_price ELSE 0 END)
                 / SUM(CASE WHEN se.qty_in > 0 AND ${entryDateSql} <= :toDate THEN se.qty_in ELSE 0 END)
            ELSE COALESCE(p.cost_price, 0)
          END AS avco_cost,
          MAX(se.expiry_date) AS expiry_date
        FROM products p
        LEFT JOIN store_entries se
          ON se.product_id = p.sku
          AND se.facilityId = :facilityId
          ${branchFilter}
        ${locationJoin}
        WHERE p.facility_id = :facilityId
          AND p.item_type IN (${FG_ITEM_TYPES_SQL})
        GROUP BY
          p.id, p.name, p.sku, p.cost_price, p.unit_of_measure, p.item_type
          ${locationGroupBy}
      ) t
      WHERE
        t.quantity <> 0
        OR t.opening_quantity <> 0
        OR t.produced_quantity <> 0
        OR t.transfers_in_quantity <> 0
        OR t.sold_quantity <> 0
        OR t.transfers_out_quantity <> 0
      ORDER BY ${groupByLocation ? "t.warehouse_location, " : ""}t.product_name
    `;

  const replacements = { facilityId, fromDate, toDate };
  if (branchFilter) replacements.branchId = Number(branchId) || 0;

  return db.sequelize.query(movementQuery, {
    replacements,
    type: db.sequelize.QueryTypes.SELECT,
  });
}

function buildFgLocations(items) {
  return [...new Map(
    (items || [])
      .filter((item) => item.warehouse_location)
      .map((item) => [String(item.branch_id ?? "0"), item.warehouse_location]),
  ).entries()]
    .map(([id, branch_name]) => ({
      branch_id: id === "0" ? 0 : Number(id) || id,
      branch_name,
    }))
    .sort((a, b) => (a.branch_name || "").localeCompare(b.branch_name || ""));
}

function fgReportPayload({
  items,
  mode,
  asOfDate,
  fromDate,
  toDate,
  groupByLocation,
  branchId,
}) {
  const totalValue = items.reduce(
    (sum, item) =>
      sum + parseFloat(item.inventory_value || item.total_value || 0),
    0,
  );
  const payload = {
    items,
    mode,
    view: groupByLocation ? "location" : "summary",
    summary: {
      itemCount: items.length,
      totalValue,
    },
    reportInfo: {
      mode,
      asOfDate: mode === "snapshot" ? asOfDate : toDate,
      fromDate: mode === "movement" ? fromDate : undefined,
      toDate: mode === "movement" ? toDate : undefined,
      openingCutoff: mode === "movement" ? fromDate : undefined,
      branchId: branchId ?? null,
      generatedAt: moment().format("YYYY-MM-DD HH:mm:ss"),
    },
    isDemoData: false,
  };
  if (groupByLocation) {
    payload.locations = buildFgLocations(items);
  }
  return payload;
}

exports.getFGInventoryReport = async (req, res) => {
  try {
    const {
      facilityId,
      mode: rawMode,
      asOfDate,
      fromDate,
      toDate,
    } = req.body;
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Missing required field: facilityId",
      });
    }

    const mode = rawMode === "movement" ? "movement" : "snapshot";
    if (mode === "snapshot" && !asOfDate) {
      return res.status(400).json({
        success: false,
        message: "Missing required field: asOfDate",
      });
    }
    if (mode === "movement" && (!fromDate || !toDate)) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: fromDate, toDate",
      });
    }

    const items = await queryFinishedGoodsInventory({
      facilityId,
      mode,
      asOfDate,
      fromDate,
      toDate,
      groupByLocation: false,
    });

    res.status(200).json({
      success: true,
      data: fgReportPayload({
        items,
        mode,
        asOfDate,
        fromDate,
        toDate,
        groupByLocation: false,
      }),
    });
  } catch (error) {
    console.error("FG inventory report error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating FG inventory report",
      error: error.message,
    });
  }
};

exports.getFGInventoryByLocationReport = async (req, res) => {
  try {
    const {
      facilityId,
      mode: rawMode,
      asOfDate,
      fromDate,
      toDate,
      branchId,
    } = req.body;
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Missing required field: facilityId",
      });
    }
    if (
      branchId === null ||
      branchId === undefined ||
      branchId === "" ||
      branchId === "all"
    ) {
      return res.status(400).json({
        success: false,
        message: "Select a location (branchId is required).",
      });
    }

    const mode = rawMode === "movement" ? "movement" : "snapshot";
    if (mode === "snapshot" && !asOfDate) {
      return res.status(400).json({
        success: false,
        message: "Missing required field: asOfDate",
      });
    }
    if (mode === "movement" && (!fromDate || !toDate)) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: fromDate, toDate",
      });
    }

    const items = await queryFinishedGoodsInventory({
      facilityId,
      mode,
      asOfDate,
      fromDate,
      toDate,
      groupByLocation: true,
      branchId,
    });

    res.status(200).json({
      success: true,
      data: fgReportPayload({
        items,
        mode,
        asOfDate,
        fromDate,
        toDate,
        groupByLocation: true,
        branchId,
      }),
    });
  } catch (error) {
    console.error("FG inventory by location report error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating FG inventory by location report",
      error: error.message,
    });
  }
};

exports.getRMInventoryReport = async (req, res) => {
  try {
    const {
      facilityId,
      mode: rawMode,
      asOfDate,
      fromDate,
      toDate,
    } = req.body;
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Missing required field: facilityId",
      });
    }

    const mode = rawMode === "movement" ? "movement" : "snapshot";
    if (mode === "snapshot" && !asOfDate) {
      return res.status(400).json({
        success: false,
        message: "Missing required field: asOfDate",
      });
    }
    if (mode === "movement" && (!fromDate || !toDate)) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: fromDate, toDate",
      });
    }

    const items = await queryRawMaterialsInventory({
      facilityId,
      mode,
      asOfDate,
      fromDate,
      toDate,
    });

    const totalValue = items.reduce(
      (sum, item) => sum + parseFloat(item.inventory_value || 0),
      0,
    );

    res.status(200).json({
      success: true,
      data: {
        items,
        mode,
        summary: {
          itemCount: items.length,
          totalValue,
        },
        reportInfo: {
          mode,
          asOfDate: mode === "snapshot" ? asOfDate : toDate,
          fromDate: mode === "movement" ? fromDate : undefined,
          toDate: mode === "movement" ? toDate : undefined,
          openingCutoff: mode === "movement" ? fromDate : undefined,
          generatedAt: moment().format("YYYY-MM-DD HH:mm:ss"),
        },
        isDemoData: false,
      },
    });
  } catch (error) {
    console.error("RM inventory report error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating RM inventory report",
      error: error.message,
    });
  }
};

exports.getProductionReport = async (req, res) => {
  try {
    const { facilityId, fromDate: rawFrom, toDate: rawTo } = req.body;
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Missing required field: facilityId",
      });
    }

    const fromDate = rawFrom || moment().subtract(30, "days").format("YYYY-MM-DD");
    const toDate = rawTo || moment().format("YYYY-MM-DD");

    const query = `
      SELECT
        pr.id,
        pr.production_date,
        pr.batch_no,
        pr.data,
        CAST(
          COALESCE(
            JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.runMetrics.goodQty')),
            JSON_UNQUOTE(
              JSON_EXTRACT(pr.data,
                CONCAT('$.sessionHistory[',
                  GREATEST(COALESCE(JSON_LENGTH(JSON_EXTRACT(pr.data, '$.sessionHistory')), 0) - 1, 0),
                '].goodQty')
              )
            ),
            JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.products[0].finishedGoods[0].goodQuantity'))
          ) AS DECIMAL(18,4)
        ) AS good_qty,
        CAST(
          COALESCE(
            JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.runMetrics.wasteQty')),
            JSON_UNQUOTE(
              JSON_EXTRACT(pr.data,
                CONCAT('$.sessionHistory[',
                  GREATEST(COALESCE(JSON_LENGTH(JSON_EXTRACT(pr.data, '$.sessionHistory')), 0) - 1, 0),
                '].brokenQty')
              )
            ),
            JSON_UNQUOTE(JSON_EXTRACT(pr.data, '$.products[0].finishedGoods[0].wasteQuantity'))
          ) AS DECIMAL(18,4)
        ) AS waste_qty
      FROM (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY batch_no
          ORDER BY created_at DESC, id DESC
        ) AS _rn
        FROM production_manufacturing_records
        WHERE facility_id = :facilityId
          AND LOWER(COALESCE(status, '')) <> 'rejected'
      ) pr
      WHERE pr._rn = 1
        AND DATE(pr.production_date) >= :fromDate
        AND DATE(pr.production_date) <= :toDate
      ORDER BY pr.production_date DESC
    `;

    const rawRecords = await db.sequelize.query(query, {
      replacements: { facilityId, fromDate, toDate },
      type: db.sequelize.QueryTypes.SELECT,
    });

    const byProductMap = {};
    let totalBatches = 0;
    let totalGoodQty = 0;
    let totalWasteQty = 0;

    for (const rec of rawRecords) {
      totalBatches += 1;
      const goodQty = parseFloat(rec.good_qty || 0);
      const wasteQty = parseFloat(rec.waste_qty || 0);
      totalGoodQty += goodQty;
      totalWasteQty += wasteQty;

      let parsedData = {};
      try {
        parsedData = typeof rec.data === "string" ? JSON.parse(rec.data) : rec.data || {};
      } catch (_) {
        parsedData = {};
      }

      const products = parsedData.products || [];
      const productNames = [];
      for (const prod of products) {
        const candidates = prod.finishedGoods?.length
          ? prod.finishedGoods
          : prod.finishedGood
            ? [prod]
            : [prod];
        for (const fg of candidates) {
          const name =
            fg.description ||
            fg.name ||
            fg.productName ||
            prod.description ||
            prod.name ||
            prod.productName;
          const code = fg.productSku || fg.sku || prod.productSku || prod.sku || "";
          if (name && !productNames.some((p) => p.name === name)) {
            productNames.push({ name, code });
          }
        }
      }

      const targets = productNames.length ? productNames : [{ name: "(Unknown)", code: "" }];
      for (const p of targets) {
        const key = p.code || p.name;
        if (!byProductMap[key]) {
          byProductMap[key] = {
            productCode: p.code || "—",
            productName: p.name,
            batches: 0,
            goodQty: 0,
            wasteQty: 0,
          };
        }
        byProductMap[key].batches += 1;
        byProductMap[key].goodQty += goodQty / targets.length;
        byProductMap[key].wasteQty += wasteQty / targets.length;
      }
    }

    const rows = Object.values(byProductMap).sort((a, b) => b.goodQty - a.goodQty);

    if (!rows.length) {
      return res.status(200).json({
        success: true,
        data: {
          rows: [],
          summary: {
            productCount: 0,
            totalBatches: 0,
            totalGoodQty: 0,
            totalWasteQty: 0,
            totalCyls: 0,
            totalKg: 0,
          },
          reportPeriod: { fromDate, toDate },
          isDemoData: false,
        },
      });
    }

    res.status(200).json({
      success: true,
      data: {
        rows: rows.map((r) => ({
          productCode: r.productCode,
          productName: r.productName,
          batches: r.batches,
          totalCyls: Math.round(r.goodQty),
          totalKg: Math.round(r.goodQty),
          totalGoodQty: r.goodQty,
          totalWasteQty: r.wasteQty,
        })),
        summary: {
          productCount: rows.length,
          totalBatches,
          totalGoodQty,
          totalWasteQty,
          totalCyls: Math.round(totalGoodQty),
          totalKg: Math.round(totalGoodQty),
        },
        reportPeriod: { fromDate, toDate },
        isDemoData: false,
      },
    });
  } catch (error) {
    console.error("Production report error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating production report",
      error: error.message,
    });
  }
};

exports.getSalesPerProductReport = async (req, res) => {
  try {
    const {
      facilityId,
      fromDate: rawFrom,
      toDate: rawTo,
      branchId,
      byLocation,
      paymentType: rawPaymentType,
    } = req.body;
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Missing required field: facilityId",
      });
    }

    const fromDate = rawFrom || moment().startOf("month").format("YYYY-MM-DD");
    const toDate = rawTo || moment().format("YYYY-MM-DD");
    const groupByLocation = Boolean(byLocation);
    const hasBranchFilter =
      branchId !== null &&
      branchId !== undefined &&
      branchId !== "" &&
      branchId !== "all";
    const paymentType = String(rawPaymentType || "")
      .toLowerCase()
      .trim();
    const hasPaymentFilter = ["cash", "transfer", "warehouse"].includes(
      paymentType,
    );

    if (groupByLocation && !hasBranchFilter) {
      return res.status(400).json({
        success: false,
        message: "Select a location (branchId is required).",
      });
    }

    const entryDateSql = "DATE(se.createdAt)";
    const branchFilter = hasBranchFilter
      ? "AND COALESCE(se.branchId, 0) = :branchId"
      : "";
    const locationSelect = groupByLocation
      ? `
        COALESCE(se.branchId, 0) AS branch_id,
        COALESCE(
          NULLIF(TRIM(MAX(b.branch_name)), ''),
          CASE
            WHEN COALESCE(se.branchId, 0) = 0 THEN 'Unassigned'
            ELSE CONCAT('Branch #', COALESCE(se.branchId, 0))
          END
        ) AS warehouse_location,
      `
      : "";
    const locationJoin = groupByLocation
      ? `
        LEFT JOIN branches b
          ON b.id = se.branchId
          AND b.id <> 0
      `
      : "";
    const locationGroupBy = groupByLocation ? ", COALESCE(se.branchId, 0)" : "";

    let paymentJoin = "";
    let paymentFilter = "";
    if (hasPaymentFilter) {
      paymentJoin = `
        INNER JOIN sale_workflows sw
          ON sw.facility_id = :facilityId
          AND sw.sale_code COLLATE utf8mb4_unicode_ci
            = se.reference_number COLLATE utf8mb4_unicode_ci
      `;
      if (paymentType === "cash") {
        paymentFilter =
          "AND LOWER(TRIM(sw.payment_type)) IN ('cash', 'split')";
      } else if (paymentType === "transfer") {
        paymentFilter =
          "AND LOWER(TRIM(sw.payment_type)) IN ('transfer', 'bank', 'split')";
      } else {
        paymentFilter = "AND LOWER(TRIM(sw.payment_type)) = 'warehouse'";
      }
    }

    const query = `
      SELECT
        p.sku AS product_code,
        p.name AS product_name,
        ${locationSelect}
        SUM(se.qty_out) AS quantity_sold,
        CASE
          WHEN SUM(se.qty_out) > 0
          THEN SUM(se.qty_out * COALESCE(se.selling_price, 0)) / SUM(se.qty_out)
          ELSE 0
        END AS unit_price,
        SUM(se.qty_out * COALESCE(se.selling_price, 0)) AS gross_sales,
        SUM(
          CASE
            WHEN COALESCE(inv.amount, 0) > 0
            THEN (se.qty_out * COALESCE(se.selling_price, 0))
                 / inv.amount
                 * COALESCE(inv.discount_amount, 0)
            ELSE 0
          END
        ) AS discount,
        SUM(
          CASE
            WHEN COALESCE(inv.amount, 0) > 0
            THEN (se.qty_out * COALESCE(se.selling_price, 0))
                 / inv.amount
                 * COALESCE(inv.tax_amount, 0)
            ELSE 0
          END
        ) AS tax,
        CASE
          WHEN SUM(se.qty_out) > 0
          THEN SUM(
            se.qty_out * COALESCE(NULLIF(se.cost_price, 0), p.cost_price, 0)
          ) / SUM(se.qty_out)
          ELSE COALESCE(MAX(p.cost_price), 0)
        END AS unit_cost,
        SUM(
          se.qty_out * COALESCE(NULLIF(se.cost_price, 0), p.cost_price, 0)
        ) AS cost_of_goods_sold
      FROM store_entries se
      INNER JOIN products p
        ON p.facility_id = :facilityId
        AND ${skuEq("se.product_id", "p.sku")}
      LEFT JOIN invoices inv
        ON inv.facility_id = :facilityId
        AND inv.type = 'sales'
        AND inv.invoice_ref = se.reference_number
      ${paymentJoin}
      ${locationJoin}
      WHERE se.facilityId = :facilityId
        AND se.qty_out > 0
        AND (
          se.type IN (${salesTypesSqlList()})
          OR se.destination = 'sold'
          OR LOWER(TRIM(se.source)) = 'for sales'
        )
        AND ${entryDateSql} BETWEEN DATE(:fromDate) AND DATE(:toDate)
        ${branchFilter}
        ${paymentFilter}
      GROUP BY
        p.id, p.sku, p.name, p.cost_price
        ${locationGroupBy}
      HAVING quantity_sold > 0
      ORDER BY ${groupByLocation ? "warehouse_location, " : ""}gross_sales DESC
    `;

    const replacements = { facilityId, fromDate, toDate };
    if (hasBranchFilter) replacements.branchId = Number(branchId) || 0;

    const rows = await db.sequelize.query(query, {
      replacements,
      type: db.sequelize.QueryTypes.SELECT,
    });

    const mappedRows = rows.map((row) => {
      const quantitySold = parseFloat(row.quantity_sold || 0);
      const unitPrice = parseFloat(row.unit_price || 0);
      const grossSales = parseFloat(row.gross_sales || 0);
      const discount = parseFloat(row.discount || 0);
      const tax = parseFloat(row.tax || 0);
      const netSales = grossSales - discount + tax;
      const unitCost = parseFloat(row.unit_cost || 0);
      const costOfGoodsSold = parseFloat(row.cost_of_goods_sold || 0);
      const grossProfit = netSales - costOfGoodsSold;
      const grossMargin =
        netSales > 0 ? (grossProfit / netSales) * 100 : 0;

      return {
        productCode: row.product_code,
        productName: row.product_name,
        branchId: row.branch_id ?? null,
        warehouseLocation: row.warehouse_location || null,
        quantitySold,
        unitPrice,
        grossSales,
        discount,
        tax,
        netSales,
        unitCost,
        costOfGoodsSold,
        grossProfit,
        grossMargin,
      };
    });

    const summary = mappedRows.reduce(
      (acc, row) => {
        acc.productCount += 1;
        acc.totalQuantity += row.quantitySold;
        acc.totalGrossSales += row.grossSales;
        acc.totalDiscount += row.discount;
        acc.totalTax += row.tax;
        acc.totalNetSales += row.netSales;
        acc.totalCogs += row.costOfGoodsSold;
        acc.totalGrossProfit += row.grossProfit;
        return acc;
      },
      {
        productCount: 0,
        totalQuantity: 0,
        totalGrossSales: 0,
        totalDiscount: 0,
        totalTax: 0,
        totalNetSales: 0,
        totalCogs: 0,
        totalGrossProfit: 0,
      },
    );
    summary.grossMargin =
      summary.totalNetSales > 0
        ? (summary.totalGrossProfit / summary.totalNetSales) * 100
        : 0;

    res.status(200).json({
      success: true,
      data: {
        rows: mappedRows,
        summary,
        view: groupByLocation ? "location" : "summary",
        reportPeriod: {
          fromDate,
          toDate,
          branchId: hasBranchFilter ? Number(branchId) || 0 : null,
          paymentType: hasPaymentFilter ? paymentType : "all",
        },
        isDemoData: false,
      },
    });
  } catch (error) {
    console.error("Sales per product report error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating sales per product report",
      error: error.message,
    });
  }
};

/** Sales aggregated by product supplier (source). */
exports.getSalesBySupplierReport = async (req, res) => {
  try {
    const {
      facilityId,
      fromDate: rawFrom,
      toDate: rawTo,
      paymentType: rawPaymentType,
    } = req.body;
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Missing required field: facilityId",
      });
    }

    const fromDate = rawFrom || moment().startOf("month").format("YYYY-MM-DD");
    const toDate = rawTo || moment().format("YYYY-MM-DD");
    const paymentType = String(rawPaymentType || "")
      .toLowerCase()
      .trim();
    const hasPaymentFilter = ["cash", "transfer", "warehouse"].includes(
      paymentType,
    );

    let paymentJoin = "";
    let paymentFilter = "";
    if (hasPaymentFilter) {
      paymentJoin = `
        INNER JOIN sale_workflows sw
          ON sw.facility_id = :facilityId
          AND sw.sale_code COLLATE utf8mb4_unicode_ci
            = se.reference_number COLLATE utf8mb4_unicode_ci
      `;
      if (paymentType === "cash") {
        paymentFilter =
          "AND LOWER(TRIM(sw.payment_type)) IN ('cash', 'split')";
      } else if (paymentType === "transfer") {
        paymentFilter =
          "AND LOWER(TRIM(sw.payment_type)) IN ('transfer', 'bank', 'split')";
      } else {
        paymentFilter = "AND LOWER(TRIM(sw.payment_type)) = 'warehouse'";
      }
    }

    const query = `
      SELECT
        COALESCE(NULLIF(TRIM(p.supplier_id), ''), 'UNASSIGNED') AS supplier_no,
        COALESCE(
          NULLIF(TRIM(MAX(s.supplier_name)), ''),
          CASE
            WHEN NULLIF(TRIM(p.supplier_id), '') IS NULL THEN 'Unassigned supplier'
            ELSE CONCAT('Supplier ', TRIM(p.supplier_id))
          END
        ) AS supplier_name,
        COUNT(DISTINCT p.id) AS product_count,
        SUM(se.qty_out) AS quantity_sold,
        SUM(se.qty_out * COALESCE(se.selling_price, 0)) AS gross_sales,
        SUM(
          se.qty_out * COALESCE(NULLIF(se.cost_price, 0), p.cost_price, 0)
        ) AS cost_of_goods_sold
      FROM store_entries se
      INNER JOIN products p
        ON p.facility_id = :facilityId
        AND ${skuEq("se.product_id", "p.sku")}
      LEFT JOIN suppliersinfo s
        ON s.facilityId = :facilityId
        AND s.supplier_number = p.supplier_id
      ${paymentJoin}
      WHERE se.facilityId = :facilityId
        AND se.qty_out > 0
        AND (
          se.type IN (${salesTypesSqlList()})
          OR se.destination = 'sold'
          OR LOWER(TRIM(se.source)) = 'for sales'
        )
        AND DATE(se.createdAt) BETWEEN DATE(:fromDate) AND DATE(:toDate)
        ${paymentFilter}
      GROUP BY COALESCE(NULLIF(TRIM(p.supplier_id), ''), 'UNASSIGNED')
      HAVING quantity_sold > 0
      ORDER BY gross_sales DESC
    `;

    const rows = await db.sequelize.query(query, {
      replacements: { facilityId, fromDate, toDate },
      type: db.sequelize.QueryTypes.SELECT,
    });

    const mappedRows = rows.map((row) => {
      const quantitySold = parseFloat(row.quantity_sold || 0);
      const grossSales = parseFloat(row.gross_sales || 0);
      const costOfGoodsSold = parseFloat(row.cost_of_goods_sold || 0);
      const grossProfit = grossSales - costOfGoodsSold;
      const grossMargin =
        grossSales > 0 ? (grossProfit / grossSales) * 100 : 0;
      return {
        supplierNo: row.supplier_no,
        supplierName: row.supplier_name,
        productCount: Number(row.product_count || 0),
        quantitySold,
        grossSales,
        costOfGoodsSold,
        grossProfit,
        grossMargin,
      };
    });

    const summary = mappedRows.reduce(
      (acc, row) => {
        acc.supplierCount += 1;
        acc.totalQuantity += row.quantitySold;
        acc.totalGrossSales += row.grossSales;
        acc.totalCogs += row.costOfGoodsSold;
        acc.totalGrossProfit += row.grossProfit;
        return acc;
      },
      {
        supplierCount: 0,
        totalQuantity: 0,
        totalGrossSales: 0,
        totalCogs: 0,
        totalGrossProfit: 0,
      },
    );
    summary.grossMargin =
      summary.totalGrossSales > 0
        ? (summary.totalGrossProfit / summary.totalGrossSales) * 100
        : 0;

    res.status(200).json({
      success: true,
      data: {
        rows: mappedRows,
        summary,
        reportPeriod: {
          fromDate,
          toDate,
          paymentType: hasPaymentFilter ? paymentType : "all",
        },
        isDemoData: false,
      },
    });
  } catch (error) {
    console.error("Sales by supplier report error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating sales by supplier report",
      error: error.message,
    });
  }
};

