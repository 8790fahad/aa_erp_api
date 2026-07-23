# Comprehensive Accounting Reports System

## Overview

This system provides comprehensive accounting reports that are compliant with International Financial Reporting Standards (IFRS) and Nigerian Federal Inland Revenue Service (FIRS) requirements. The system generates both financial statements and tax compliance reports based on the `kirmaskngov_inventria_new` database.

## Features

### Financial Statements (IFRS Compliant)

- **Trial Balance**: Complete listing of all accounts with debit and credit balances
- **Income Statement**: Revenue, expenses, and profit/loss analysis
- **Balance Sheet**: Assets, liabilities, and equity statement
- **Cash Flow Statement**: Operating, investing, and financing activities
- **Statement of Changes in Equity**: Movement in equity accounts
- **General Ledger Summary**: Aged analysis of all transactions

### Tax Compliance Reports (FIRS Compliant)

- **VAT Report**: Input/output VAT calculations with 7.5% rate
- **WHT Report**: Withholding tax on payments to contractors and professionals
- **CIT Computation**: Company Income Tax calculation with 30% rate
- **Tax Summary**: Overview of all tax-related accounts and liabilities

## Database Schema

The system uses two main tables:

### `account` Table

- `head`: Account code (primary key)
- `subhead`: Parent account code
- `description`: Account name
- `Balance_type`: Debit/Credit balance type
- `account_type`: Revenue, Expenses, Assets, Liabilities, Equity
- `account_category`: Further classification
- `facilityId`: Facility identifier
- `status`: Activated/Deactivated

### `general_ledger` Table

- `transaction_id`: Unique transaction identifier
- `transaction_date`: Date of transaction
- `account_code`: Reference to account.head
- `dr`: Debit amount
- `cr`: Credit amount
- `transaction_description`: Description of transaction
- `reference_number`: Transaction reference
- `payee`: Payment recipient
- `facility_id`: Facility identifier
- `status`: Transaction status (paid, unpaid, etc.)

## API Endpoints

### Financial Statements

```
POST /api/accounting/trial-balance
POST /api/accounting/income-statement
POST /api/accounting/balance-sheet
POST /api/accounting/cash-flow-statement
POST /api/accounting/statement-of-changes-in-equity
POST /api/accounting/general-ledger-summary
```

### Tax Reports

```
POST /api/tax/vat-report
POST /api/tax/wht-report
POST /api/tax/cit-computation
POST /api/tax/tax-summary
```

## Request Format

All endpoints require a POST request with JSON body:

```json
{
  "facilityId": "ae9d49ee-3f9c-4f1e-bd6c-d2f18c61269f",
  "fromDate": "2025-01-01",
  "toDate": "2025-09-09",
  "asOfDate": "2025-09-09"
}
```

## Response Format

All endpoints return a consistent response format:

```json
{
  "success": true,
  "data": {
    // Report-specific data
  }
}
```

## IFRS Compliance Features

### Accrual Basis Accounting

- All transactions are recorded on accrual basis
- Revenue recognized when performance obligation is satisfied
- Expenses matched to related revenues

### Fair Presentation

- Assets and liabilities properly classified as current/non-current
- Revenue and expenses clearly categorized
- Proper disclosure of accounting policies

### Going Concern

- Financial statements prepared assuming business continuity
- No liquidation or cessation assumptions

### Materiality

- All material transactions included
- Immaterial items appropriately aggregated

## FIRS Compliance Features

### VAT Compliance

- 7.5% VAT rate applied correctly
- Input VAT on purchases tracked
- Output VAT on sales calculated
- Monthly reporting period
- Proper penalty and interest calculations

### Withholding Tax (WHT)

- 5% rate for contractors and suppliers
- 10% rate for professionals and consultants
- Automatic calculation based on payee type
- Monthly remittance requirements

### Company Income Tax (CIT)

- 30% corporate tax rate
- Minimum tax of 1% of gross turnover
- Capital allowances at 20% straight-line
- Proper deduction calculations

## Frontend Components

### Main Component

- `AccountingReports.jsx`: Main container with tabbed interface

### Report Components

- `TrialBalanceReport.jsx`: Trial balance display
- `IncomeStatementReport.jsx`: Income statement with expense categorization
- `BalanceSheetReport.jsx`: Balance sheet with current/non-current classification
- `CashFlowReport.jsx`: Cash flow statement with activity categorization
- `EquityChangesReport.jsx`: Statement of changes in equity
- `GeneralLedgerReport.jsx`: General ledger with aged analysis
- `VATReport.jsx`: VAT compliance report
- `WHTReport.jsx`: Withholding tax report
- `CITReport.jsx`: Company income tax computation
- `TaxSummaryReport.jsx`: Tax summary overview

## Features

### Export Capabilities

- CSV export for all reports
- Print-friendly formatting
- Professional report layouts

### Data Validation

- Trial balance validation (debits = credits)
- Balance sheet validation (assets = liabilities + equity)
- Tax calculation verification

### User Interface

- Responsive design
- Tabbed navigation
- Real-time loading indicators
- Error handling and display

## Installation and Setup

### Backend Setup

1. Ensure the database is properly configured
2. Install required dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```

### Frontend Setup

1. Navigate to the frontend directory
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```

## Testing

Run the test script to verify all endpoints:

```bash
node test-accounting-reports.js
```

## Usage

1. Navigate to Reports > Accounting Reports in the application
2. Select the facility ID and date range
3. Click "Generate Reports"
4. Browse through the different report tabs
5. Export or print reports as needed

## Customization

### Adding New Report Types

1. Create new controller method in `accountingReports.js` or `taxReports.js`
2. Add route in `accountingReports.js`
3. Create frontend component
4. Add to main `AccountingReports.jsx` component

### Modifying Tax Rates

Update the rates in the respective controller files:

- VAT: 7.5% in `taxReports.js`
- WHT: 5% and 10% in `taxReports.js`
- CIT: 30% in `taxReports.js`

### Database Schema Changes

If the database schema changes, update the SQL queries in the controller files accordingly.

## Security Considerations

- All API endpoints require proper authentication
- Facility ID validation prevents cross-facility data access
- Input validation on all parameters
- SQL injection prevention through parameterized queries

## Performance Optimization

- Database queries optimized with proper indexing
- Pagination for large datasets
- Caching for frequently accessed data
- Async/await pattern for better performance

## Troubleshooting

### Common Issues

1. **Empty Reports**: Check facility ID and date range
2. **Database Connection**: Verify database configuration
3. **Missing Data**: Ensure transactions are properly recorded
4. **Calculation Errors**: Verify account classifications

### Debug Mode

Enable debug logging by setting the appropriate environment variable.

## Support

For technical support or feature requests, please contact the development team.

## License

This system is proprietary software. All rights reserved.

