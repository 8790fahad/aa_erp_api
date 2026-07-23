const db = require("../models");
const moment = require("moment");
const { QueryTypes } = require("sequelize");

/**
 * Nigerian Tax Compliance Reports Controller
 * Implements FIRS-compliant tax calculations and reports
 */

// VAT Report - FIRS VAT Act Compliance
exports.getVATReport = async (req, res) => {
  try {
    const { facilityId, fromDate, toDate = "2025-09-09" } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
      });
    }

    // Get earliest transaction date if fromDate not provided
    let startDate = fromDate;
    if (!startDate) {
      const earliestQuery = `
        SELECT MIN(transaction_date) as earliest_date
        FROM general_ledger
        WHERE facility_id = :facilityId AND status = 'paid'
      `;
      const earliest = await db.sequelize.query(earliestQuery, {
        replacements: { facilityId },
        type: QueryTypes.SELECT,
      });
      startDate = earliest[0]?.earliest_date || "2025-01-01";
    }

    // Input VAT (VAT on purchases/expenses)
    const inputVATQuery = `
      SELECT
        gl.transaction_date,
        gl.transaction_description,
        gl.reference_number,
        gl.payee,
        gl.dr as gross_amount,
        (gl.dr / 1.075) as net_amount,
        (gl.dr - (gl.dr / 1.075)) as vat_amount,
        'Input VAT' as vat_type
      FROM general_ledger gl
      JOIN account a ON gl.account_code = a.head
      WHERE gl.facility_id = :facilityId
        AND gl.transaction_date BETWEEN :startDate AND :endDate
        AND gl.status = 'paid'
        AND a.account_type = 'Expenses'
        AND gl.dr > 0
        AND gl.transaction_description LIKE '%VAT%'
      ORDER BY gl.transaction_date
    `;

    // Output VAT (VAT on sales/revenue)
    const outputVATQuery = `
      SELECT
        gl.transaction_date,
        gl.transaction_description,
        gl.reference_number,
        gl.payee,
        gl.cr as gross_amount,
        (gl.cr / 1.075) as net_amount,
        (gl.cr - (gl.cr / 1.075)) as vat_amount,
        'Output VAT' as vat_type
      FROM general_ledger gl
      JOIN account a ON gl.account_code = a.head
      WHERE gl.facility_id = :facilityId
        AND gl.transaction_date BETWEEN :startDate AND :endDate
        AND gl.status = 'paid'
        AND a.account_type = 'Revenue'
        AND gl.cr > 0
        AND gl.transaction_description LIKE '%VAT%'
      ORDER BY gl.transaction_date
    `;

    // VAT Account Balances
    const vatAccountQuery = `
      SELECT
        a.head as account_code,
        a.description as account_name,
        COALESCE(SUM(gl.cr - gl.dr), 0) as balance
      FROM account a
      LEFT JOIN general_ledger gl ON a.head = gl.account_code
        AND gl.facility_id = :facilityId
        AND gl.transaction_date <= :endDate
        AND gl.status = 'paid'
      WHERE a.facilityId = :facilityId
        AND a.account_category = 'tax'
        AND a.description LIKE '%VAT%'
        AND a.status = 'activated'
      GROUP BY a.head, a.description
      HAVING COALESCE(SUM(gl.cr - gl.dr), 0) != 0
      ORDER BY a.head
    `;

    const [inputVAT, outputVAT, vatAccounts] = await Promise.all([
      db.sequelize.query(inputVATQuery, {
        replacements: { facilityId, startDate, endDate: toDate },
        type: QueryTypes.SELECT,
      }),
      db.sequelize.query(outputVATQuery, {
        replacements: { facilityId, startDate, endDate: toDate },
        type: QueryTypes.SELECT,
      }),
      db.sequelize.query(vatAccountQuery, {
        replacements: { facilityId, endDate: toDate },
        type: QueryTypes.SELECT,
      }),
    ]);

    // Calculate VAT totals
    const totalInputVAT = inputVAT.reduce(
      (sum, row) => sum + parseFloat(row.vat_amount),
      0
    );
    const totalOutputVAT = outputVAT.reduce(
      (sum, row) => sum + parseFloat(row.vat_amount),
      0
    );
    const netVATPayable = totalOutputVAT - totalInputVAT;

    res.json({
      success: true,
      data: {
        period: { from: startDate, to: toDate },
        facilityId,
        inputVAT: {
          transactions: inputVAT,
          total: totalInputVAT.toFixed(2),
        },
        outputVAT: {
          transactions: outputVAT,
          total: totalOutputVAT.toFixed(2),
        },
        vatAccounts: vatAccounts,
        summary: {
          totalInputVAT: totalInputVAT.toFixed(2),
          totalOutputVAT: totalOutputVAT.toFixed(2),
          netVATPayable: netVATPayable.toFixed(2),
          status:
            netVATPayable > 0 ? "Payable to FIRS" : "Refundable from FIRS",
        },
        compliance: {
          vatRate: "7.5%",
          reportingPeriod: "Monthly",
          dueDate: moment(toDate).add(1, "month").format("YYYY-MM-DD"),
          penaltyRate: "5% per month for late filing",
        },
      },
    });
  } catch (error) {
    console.error("VAT Report Error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating VAT report",
      error: error.message,
    });
  }
};

// Withholding Tax (WHT) Report
exports.getWHTReport = async (req, res) => {
  try {
    const { facilityId, fromDate, toDate = "2025-09-09" } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
      });
    }

    // Get earliest transaction date if fromDate not provided
    let startDate = fromDate;
    if (!startDate) {
      const earliestQuery = `
        SELECT MIN(transaction_date) as earliest_date
        FROM general_ledger
        WHERE facility_id = :facilityId AND status = 'paid'
      `;
      const earliest = await db.sequelize.query(earliestQuery, {
        replacements: { facilityId },
        type: QueryTypes.SELECT,
      });
      startDate = earliest[0]?.earliest_date || "2025-01-01";
    }

    // WHT on payments to suppliers/contractors
    const whtQuery = `
      SELECT
        gl.transaction_date,
        gl.transaction_description,
        gl.reference_number,
        gl.payee,
        gl.dr as gross_payment,
        CASE
          WHEN gl.payee LIKE '%contractor%' OR gl.payee LIKE '%supplier%' THEN gl.dr * 0.05
          WHEN gl.payee LIKE '%professional%' OR gl.payee LIKE '%consultant%' THEN gl.dr * 0.10
          ELSE 0
        END as wht_amount,
        CASE
          WHEN gl.payee LIKE '%contractor%' OR gl.payee LIKE '%supplier%' THEN '5%'
          WHEN gl.payee LIKE '%professional%' OR gl.payee LIKE '%consultant%' THEN '10%'
          ELSE '0%'
        END as wht_rate,
        gl.dr - CASE
          WHEN gl.payee LIKE '%contractor%' OR gl.payee LIKE '%supplier%' THEN gl.dr * 0.05
          WHEN gl.payee LIKE '%professional%' OR gl.payee LIKE '%consultant%' THEN gl.dr * 0.10
          ELSE 0
        END as net_payment
      FROM general_ledger gl
      JOIN account a ON gl.account_code = a.head
      WHERE gl.facility_id = :facilityId
        AND gl.transaction_date BETWEEN :startDate AND :endDate
        AND gl.status = 'paid'
        AND a.account_type = 'Expenses'
        AND gl.dr > 0
        AND (gl.payee LIKE '%contractor%' OR gl.payee LIKE '%supplier%' OR gl.payee LIKE '%professional%' OR gl.payee LIKE '%consultant%')
      ORDER BY gl.transaction_date
    `;

    const whtTransactions = await db.sequelize.query(whtQuery, {
      replacements: { facilityId, startDate, endDate: toDate },
      type: QueryTypes.SELECT,
    });

    // Calculate WHT totals
    const totalGrossPayments = whtTransactions.reduce(
      (sum, row) => sum + parseFloat(row.gross_payment),
      0
    );
    const totalWHTDeductions = whtTransactions.reduce(
      (sum, row) => sum + parseFloat(row.wht_amount),
      0
    );
    const totalNetPayments = whtTransactions.reduce(
      (sum, row) => sum + parseFloat(row.net_payment),
      0
    );

    // Group by WHT rate
    const whtByRate = whtTransactions.reduce((acc, row) => {
      const rate = row.wht_rate;
      if (!acc[rate]) {
        acc[rate] = { transactions: [], total: 0, count: 0 };
      }
      acc[rate].transactions.push(row);
      acc[rate].total += parseFloat(row.wht_amount);
      acc[rate].count += 1;
      return acc;
    }, {});

    res.json({
      success: true,
      data: {
        period: { from: startDate, to: toDate },
        facilityId,
        whtTransactions: whtTransactions,
        whtByRate: whtByRate,
        summary: {
          totalGrossPayments: totalGrossPayments.toFixed(2),
          totalWHTDeductions: totalWHTDeductions.toFixed(2),
          totalNetPayments: totalNetPayments.toFixed(2),
          averageWHTRate:
            totalGrossPayments > 0
              ? ((totalWHTDeductions / totalGrossPayments) * 100).toFixed(2) +
                "%"
              : "0%",
        },
        compliance: {
          remittancePeriod: "Monthly",
          dueDate: moment(toDate).add(1, "month").format("YYYY-MM-DD"),
          penaltyRate: "10% of tax due for late remittance",
          interestRate: "21% per annum for late payment",
        },
      },
    });
  } catch (error) {
    console.error("WHT Report Error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating WHT report",
      error: error.message,
    });
  }
};

// Company Income Tax (CIT) Computation
exports.getCITComputation = async (req, res) => {
  try {
    const { facilityId, fromDate, toDate = "2025-09-09" } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
      });
    }

    // Get earliest transaction date if fromDate not provided
    let startDate = fromDate;
    if (!startDate) {
      const earliestQuery = `
        SELECT MIN(transaction_date) as earliest_date
        FROM general_ledger
        WHERE facility_id = :facilityId AND status = 'paid'
      `;
      const earliest = await db.sequelize.query(earliestQuery, {
        replacements: { facilityId },
        type: QueryTypes.SELECT,
      });
      startDate = earliest[0]?.earliest_date || "2025-01-01";
    }

    // Revenue (Taxable Income)
    const revenueQuery = `
      SELECT
        COALESCE(SUM(gl.cr - gl.dr), 0) as total_revenue
      FROM general_ledger gl
      JOIN account a ON gl.account_code = a.head
      WHERE gl.facility_id = :facilityId
        AND gl.transaction_date BETWEEN :startDate AND :endDate
        AND gl.status = 'paid'
        AND a.account_type = 'Revenue'
    `;

    // Allowable Deductions
    const deductionsQuery = `
      SELECT
        a.account_category,
        COALESCE(SUM(gl.dr - gl.cr), 0) as amount
      FROM general_ledger gl
      JOIN account a ON gl.account_code = a.head
      WHERE gl.facility_id = :facilityId
        AND gl.transaction_date BETWEEN :startDate AND :endDate
        AND gl.status = 'paid'
        AND a.account_type = 'Expenses'
      GROUP BY a.account_category
      HAVING COALESCE(SUM(gl.dr - gl.cr), 0) > 0
      ORDER BY a.account_category
    `;

    // Capital Allowances (Depreciation)
    const capitalAllowancesQuery = `
      SELECT
        a.description as asset_type,
        COALESCE(SUM(gl.dr - gl.cr), 0) as cost,
        COALESCE(SUM(gl.dr - gl.cr), 0) * 0.20 as annual_allowance
      FROM general_ledger gl
      JOIN account a ON gl.account_code = a.head
      WHERE gl.facility_id = :facilityId
        AND gl.transaction_date <= :endDate
        AND gl.status = 'paid'
        AND a.account_type = 'Assets'
        AND a.account_category IN ('Fixed Assets', 'Equipment', 'Property')
      GROUP BY a.description
      HAVING COALESCE(SUM(gl.dr - gl.cr), 0) > 0
      ORDER BY a.description
    `;

    const [revenue, deductions, capitalAllowances] = await Promise.all([
      db.sequelize.query(revenueQuery, {
        replacements: { facilityId, startDate, endDate: toDate },
        type: QueryTypes.SELECT,
      }),
      db.sequelize.query(deductionsQuery, {
        replacements: { facilityId, startDate, endDate: toDate },
        type: QueryTypes.SELECT,
      }),
      db.sequelize.query(capitalAllowancesQuery, {
        replacements: { facilityId, endDate: toDate },
        type: QueryTypes.SELECT,
      }),
    ]);

    // Calculate CIT
    const totalRevenue = parseFloat(revenue[0]?.total_revenue || 0);
    const totalDeductions = deductions.reduce(
      (sum, row) => sum + parseFloat(row.amount),
      0
    );
    const totalCapitalAllowances = capitalAllowances.reduce(
      (sum, row) => sum + parseFloat(row.annual_allowance),
      0
    );

    const adjustedProfit =
      totalRevenue - totalDeductions - totalCapitalAllowances;
    const citRate = 0.3; // 30% for companies
    const citLiability = Math.max(0, adjustedProfit * citRate);

    // Minimum Tax (1% of gross turnover)
    const minimumTax = totalRevenue * 0.01;
    const finalCITLiability = Math.max(citLiability, minimumTax);

    res.json({
      success: true,
      data: {
        period: { from: startDate, to: toDate },
        facilityId,
        computation: {
          grossRevenue: totalRevenue.toFixed(2),
          allowableDeductions: {
            operatingExpenses: totalDeductions.toFixed(2),
            capitalAllowances: totalCapitalAllowances.toFixed(2),
            total: (totalDeductions + totalCapitalAllowances).toFixed(2),
          },
          adjustedProfit: adjustedProfit.toFixed(2),
          citCalculation: {
            citRate: "30%",
            citOnProfit: citLiability.toFixed(2),
            minimumTax: minimumTax.toFixed(2),
            finalCITLiability: finalCITLiability.toFixed(2),
          },
        },
        breakdown: {
          deductions: deductions,
          capitalAllowances: capitalAllowances,
        },
        compliance: {
          taxYear: moment(toDate).format("YYYY"),
          dueDate: moment(toDate).add(6, "months").format("YYYY-MM-DD"),
          penaltyRate: "10% of tax due for late filing",
          interestRate: "21% per annum for late payment",
          advancePayment: "Monthly installments required",
        },
      },
    });
  } catch (error) {
    console.error("CIT Computation Error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating CIT computation",
      error: error.message,
    });
  }
};

// Tax Summary Report
exports.getTaxSummary = async (req, res) => {
  try {
    const { facilityId, fromDate, toDate = "2025-09-09" } = req.body;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
      });
    }

    // Get all tax-related accounts
    const taxAccountsQuery = `
      SELECT
        a.head as account_code,
        a.description as account_name,
        a.account_category,
        COALESCE(SUM(gl.cr - gl.dr), 0) as balance
      FROM account a
      LEFT JOIN general_ledger gl ON a.head = gl.account_code
        AND gl.facility_id = :facilityId
        AND gl.transaction_date <= :endDate
        AND gl.status = 'paid'
      WHERE a.facilityId = :facilityId
        AND (a.account_category = 'tax' OR a.description LIKE '%TAX%' OR a.description LIKE '%VAT%')
        AND a.status = 'activated'
      GROUP BY a.head, a.description, a.account_category
      HAVING COALESCE(SUM(gl.cr - gl.dr), 0) != 0
      ORDER BY a.account_category, a.head
    `;

    const taxAccounts = await db.sequelize.query(taxAccountsQuery, {
      replacements: { facilityId, endDate: toDate },
      type: QueryTypes.SELECT,
    });

    // Calculate total tax liability
    const totalTaxLiability = taxAccounts.reduce(
      (sum, row) => sum + parseFloat(row.balance),
      0
    );

    res.json({
      success: true,
      data: {
        period: { from: fromDate, to: toDate },
        facilityId,
        taxAccounts: taxAccounts,
        summary: {
          totalTaxLiability: totalTaxLiability.toFixed(2),
          accountCount: taxAccounts.length,
        },
        compliance: {
          vatRate: "7.5%",
          whtRates: ["5% (Contractors)", "10% (Professionals)"],
          citRate: "30%",
          minimumTaxRate: "1% of gross turnover",
          reportingFrequency: "Monthly",
          nextDueDate: moment(toDate).add(1, "month").format("YYYY-MM-DD"),
        },
      },
    });
  } catch (error) {
    console.error("Tax Summary Error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating tax summary",
      error: error.message,
    });
  }
};

