const { Op, Sequelize } = require("sequelize");
const db = require("../models");

const GeneralLedger = db.GeneralLedger;
const AccountCategory = db.AccountCategory;

/**
 * Profit & Loss Summary Report Controller
 *
 * Driven entirely by account_category fields:
 *   - account_nature  : REVENUE | EXPENSE | ASSET
 *   - type            : 'Operating revenue' | 'Operating expenses' | etc.
 *   - subcategory     : 'sales' | 'direct_materials' | 'production_overhead' |
 *                       'admin_expenses' | 'selling_expenses' | 'interest_payable' |
 *                       'bank_charges' | 'other_income' | 'inventory'
 *
 * No parent codes hardcoded — fully driven by nature + subcategory + display flag.
 */
exports.ProfitLossController = async (req, res) => {
  const facilityId =
    req.body?.facilityId || req.query?.facilityId || req.params?.facilityId;
  const dateFrom = req.body?.dateFrom || req.query?.dateFrom;
  const dateTo = req.body?.dateTo || req.query?.dateTo;

  if (!facilityId) {
    return res
      .status(400)
      .json({ success: false, message: "facilityId is required" });
  }
  if (!dateFrom || !dateTo) {
    return res
      .status(400)
      .json({ success: false, message: "dateFrom and dateTo are required" });
  }

  try {
    // ── Current month range (first day of dateTo's month → dateTo) ───────────
    const periodEnd = new Date(dateTo);
    const cmStart = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1)
      .toISOString()
      .split("T")[0];
    const cmEnd = dateTo;

    // =========================================================================
    // HELPER: fetch GL line items using account_category metadata only
    // =========================================================================
    const fetchLines = async (nature, subcategory, direction, from, to) => {
      const amountExpr =
        direction === "cr_minus_dr"
          ? Sequelize.literal("`GeneralLedger`.`cr` - `GeneralLedger`.`dr`")
          : Sequelize.literal("`GeneralLedger`.`dr` - `GeneralLedger`.`cr`");

      const rows = await GeneralLedger.findAll({
        attributes: [
          [Sequelize.col("account_category.code"), "account_code"],
          [Sequelize.col("account_category.description"), "account_name"],
          [Sequelize.col("account_category.subcategory"), "subcategory"],
          [Sequelize.col("account_category.type"), "account_type"],
          [
            Sequelize.col("account_category.account_nature"),
            "account_nature",
          ],
          [Sequelize.fn("SUM", amountExpr), "amount"],
        ],
        include: [
          {
            model: AccountCategory,
            as: "account_category",
            attributes: [],
            where: {
              facility_id: facilityId,
              account_nature: nature,
              subcategory: subcategory,
              is_active: 1,
              display: 1,
            },
            required: true,
          },
        ],
        where: {
          facility_id: facilityId,
          transaction_date: { [Op.between]: [from, to] },
        },
        group: [
          "account_category.code",
          "account_category.description",
          "account_category.subcategory",
          "account_category.type",
          "account_category.account_nature",
        ],
        order: [[Sequelize.col("account_category.description"), "ASC"]],
        raw: true,
      });

      return rows.map((r) => ({
        account_code: r.account_code,
        account_name: r.account_name,
        subcategory: r.subcategory,
        account_type: r.account_type,
        account_nature: r.account_nature,
        amount: parseFloat(r.amount) || 0,
      }));
    };

    // =========================================================================
    // HELPER: fetch stock balance (ASSET / inventory / OPENING|CLOSING)
    // =========================================================================
    const fetchStockBalance = async (
      descPattern,
      cutoffDate,
      inclusive = true
    ) => {
      const dateOp = inclusive
        ? { [Op.lte]: cutoffDate }
        : { [Op.lt]: cutoffDate };

      const row = await GeneralLedger.findOne({
        attributes: [
          [
            Sequelize.fn(
              "COALESCE",
              Sequelize.fn(
                "SUM",
                Sequelize.literal("`GeneralLedger`.`dr` - `GeneralLedger`.`cr`")
              ),
              0
            ),
            "amount",
          ],
        ],
        include: [
          {
            model: AccountCategory,
            as: "account_category",
            attributes: [],
            where: {
              facility_id: facilityId,
              account_nature: "ASSET",
              subcategory: "inventory",
              description: { [Op.like]: `%${descPattern}%` },
              is_active: 1,
            },
            required: true,
          },
        ],
        where: {
          facility_id: facilityId,
          transaction_date: dateOp,
        },
        raw: true,
      });

      return parseFloat(row?.amount) || 0;
    };

    const sumLines = (lines) => lines.reduce((acc, l) => acc + l.amount, 0);

    const mergeLines = (cumLines, curLines) => {
      const cumMap = Object.fromEntries(
        cumLines.map((l) => [l.account_code, l])
      );
      const curMap = Object.fromEntries(
        curLines.map((l) => [l.account_code, l])
      );
      const allCodes = [
        ...new Set([...Object.keys(cumMap), ...Object.keys(curMap)]),
      ].sort();

      return allCodes.map((code) => {
        const base = cumMap[code] ?? curMap[code];
        return {
          account_code: code,
          account_name: base.account_name,
          subcategory: base.subcategory,
          account_type: base.account_type,
          account_nature: base.account_nature,
          cumulative: cumMap[code]?.amount ?? 0,
          current_month: curMap[code]?.amount ?? 0,
        };
      });
    };

    // =========================================================================
    // FETCH ALL SECTIONS — cumulative period (parallel)
    // =========================================================================
    const [
      salesLines,
      openingStock,
      closingStock,
      materialLines,
      manufacturingLines,
      adminLines,
      sellingLines,
      interestLines,
      bankChargeLines,
      otherIncomeLines,
    ] = await Promise.all([
      fetchLines("REVENUE", "sales", "cr_minus_dr", dateFrom, dateTo),
      fetchStockBalance("OPENING", dateFrom, false),
      fetchStockBalance("CLOSING", dateTo, true),
      fetchLines("EXPENSE", "direct_materials", "dr_minus_cr", dateFrom, dateTo),
      fetchLines(
        "EXPENSE",
        "production_overhead",
        "dr_minus_cr",
        dateFrom,
        dateTo
      ),
      fetchLines("EXPENSE", "admin_expenses", "dr_minus_cr", dateFrom, dateTo),
      fetchLines(
        "EXPENSE",
        "selling_expenses",
        "dr_minus_cr",
        dateFrom,
        dateTo
      ),
      fetchLines(
        "EXPENSE",
        "interest_payable",
        "dr_minus_cr",
        dateFrom,
        dateTo
      ),
      fetchLines("EXPENSE", "bank_charges", "dr_minus_cr", dateFrom, dateTo),
      fetchLines("REVENUE", "other_income", "cr_minus_dr", dateFrom, dateTo),
    ]);

    // =========================================================================
    // FETCH ALL SECTIONS — current month (parallel)
    // =========================================================================
    const [
      salesLinesCM,
      openingStockCM,
      closingStockCM,
      materialLinesCM,
      manufacturingLinesCM,
      adminLinesCM,
      sellingLinesCM,
      interestLinesCM,
      bankChargeLinesCM,
      otherIncomeLinesCM,
    ] = await Promise.all([
      fetchLines("REVENUE", "sales", "cr_minus_dr", cmStart, cmEnd),
      fetchStockBalance("OPENING", cmStart, false),
      fetchStockBalance("CLOSING", cmEnd, true),
      fetchLines("EXPENSE", "direct_materials", "dr_minus_cr", cmStart, cmEnd),
      fetchLines(
        "EXPENSE",
        "production_overhead",
        "dr_minus_cr",
        cmStart,
        cmEnd
      ),
      fetchLines("EXPENSE", "admin_expenses", "dr_minus_cr", cmStart, cmEnd),
      fetchLines("EXPENSE", "selling_expenses", "dr_minus_cr", cmStart, cmEnd),
      fetchLines("EXPENSE", "interest_payable", "dr_minus_cr", cmStart, cmEnd),
      fetchLines("EXPENSE", "bank_charges", "dr_minus_cr", cmStart, cmEnd),
      fetchLines("REVENUE", "other_income", "cr_minus_dr", cmStart, cmEnd),
    ]);

    // =========================================================================
    // COMPUTE TOTALS — cumulative
    // =========================================================================
    const cumSales = sumLines(salesLines);
    const cumSalesNet = cumSales - openingStock;
    const cumAdjOutput = cumSalesNet + closingStock;

    const cumTotalMaterials = sumLines(materialLines);
    const cumConvMargin = cumAdjOutput - cumTotalMaterials;

    const cumTotalMfg = sumLines(manufacturingLines);
    const cumTotalAdmin = sumLines(adminLines);
    const cumTotalSelling = sumLines(sellingLines);
    const cumTotalFinancial =
      sumLines(interestLines) + sumLines(bankChargeLines);
    const cumTotalExpenses =
      cumTotalMfg + cumTotalAdmin + cumTotalSelling + cumTotalFinancial;

    const cumOpMargin = cumConvMargin - cumTotalExpenses;
    const cumOtherIncome = sumLines(otherIncomeLines);
    const cumNetMargin = cumOpMargin + cumOtherIncome;

    // =========================================================================
    // COMPUTE TOTALS — current month
    // =========================================================================
    const curSales = sumLines(salesLinesCM);
    const curSalesNet = curSales - openingStockCM;
    const curAdjOutput = curSalesNet + closingStockCM;

    const curTotalMaterials = sumLines(materialLinesCM);
    const curConvMargin = curAdjOutput - curTotalMaterials;

    const curTotalMfg = sumLines(manufacturingLinesCM);
    const curTotalAdmin = sumLines(adminLinesCM);
    const curTotalSelling = sumLines(sellingLinesCM);
    const curTotalFinancial =
      sumLines(interestLinesCM) + sumLines(bankChargeLinesCM);
    const curTotalExpenses =
      curTotalMfg + curTotalAdmin + curTotalSelling + curTotalFinancial;

    const curOpMargin = curConvMargin - curTotalExpenses;
    const curOtherIncome = sumLines(otherIncomeLinesCM);
    const curNetMargin = curOpMargin + curOtherIncome;

    // =========================================================================
    // RESPONSE
    // =========================================================================
    return res.status(200).json({
      success: true,
      data: {
        period: {
          date_from: dateFrom,
          date_to: dateTo,
          facility_id: facilityId,
          current_month: { start: cmStart, end: cmEnd },
        },

        sales_and_stock: {
          sales: {
            lines: mergeLines(salesLines, salesLinesCM),
            cumulative: cumSales,
            current_month: curSales,
          },
          opening_stock: {
            cumulative: openingStock,
            current_month: openingStockCM,
          },
          sales_net: {
            cumulative: cumSalesNet,
            current_month: curSalesNet,
          },
          closing_stock: {
            cumulative: closingStock,
            current_month: closingStockCM,
          },
          adjusted_output: {
            cumulative: cumAdjOutput,
            current_month: curAdjOutput,
          },
        },

        material_consumption: {
          lines: mergeLines(materialLines, materialLinesCM),
          totals: {
            cumulative: cumTotalMaterials,
            current_month: curTotalMaterials,
          },
        },

        conversion_margin: {
          cumulative: cumConvMargin,
          current_month: curConvMargin,
        },

        manufacturing_expenses: {
          lines: mergeLines(manufacturingLines, manufacturingLinesCM),
          totals: { cumulative: cumTotalMfg, current_month: curTotalMfg },
        },

        admin_expenses: {
          lines: mergeLines(adminLines, adminLinesCM),
          totals: { cumulative: cumTotalAdmin, current_month: curTotalAdmin },
        },

        selling_expenses: {
          lines: mergeLines(sellingLines, sellingLinesCM),
          totals: {
            cumulative: cumTotalSelling,
            current_month: curTotalSelling,
          },
        },

        financial_expenses: {
          lines: mergeLines(
            [...interestLines, ...bankChargeLines],
            [...interestLinesCM, ...bankChargeLinesCM]
          ),
          totals: {
            cumulative: cumTotalFinancial,
            current_month: curTotalFinancial,
          },
        },

        total_expenses: {
          cumulative: cumTotalExpenses,
          current_month: curTotalExpenses,
        },

        operating_net_margin: {
          cumulative: cumOpMargin,
          current_month: curOpMargin,
        },

        other_income: {
          lines: mergeLines(otherIncomeLines, otherIncomeLinesCM),
          totals: {
            cumulative: cumOtherIncome,
            current_month: curOtherIncome,
          },
        },

        net_margin: {
          cumulative: cumNetMargin,
          current_month: curNetMargin,
        },
      },
    });
  } catch (error) {
    console.error("Error generating Profit & Loss report:", error);
    return res.status(500).json({
      success: false,
      message: "Error generating Profit & Loss report",
      error: error.message,
    });
  }
};
