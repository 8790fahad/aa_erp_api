const passport = require("passport");
const { getJournalEntries } = require("../controller/api/transactionsApi");

module.exports = (app) => {
  const transactions = require("../controller/transactions");
  // const config = require('../config/config')
  // const allowOnly = require('../services/routesHelper').allowOnly;

  // app.get('/transactions/addNewRecord/:facilityId', transactions.addNewRecord);
  app.get(
    "/accounts/approved/list/:facilityId",
    transactions.getApprovedAccounts
  );
  app.post("/transactions/deposit", transactions.deposit);
  // app.get('/transactions/getReceiptDateSN/:facilityId', transactions.getReceiptDateSN);
  app.get(
    "/transactions/getReceiptNo/:facilityId",
    transactions.getAvailReceiptNo
  );
  app.get(
    "/transactions/getNextTransactionID/:facilityId",
    transactions.getNextTransactionID
  );
  app.get(
    "/transactions/balance/:accountNo/:facilityId",
    transactions.getBalance
  );
  app.get("/transactions/all/:facilityId", transactions.getAllTransactions);
  // app.get('/transactions/reports/:from/:to/:facilityId', transactions.getReports);
  // app.get(
  //   '/transactions/reports/:account/:from/:to'/:facilityId,
  //   transactions.getIndividualReport
  // );
  app.post("/transactions/expenditure", transactions.expenditure);
  app.post("/transactions/batch-expenses", transactions.batchExpenses);
  app.post("/transactions/supplier-payment", transactions.supplierPayment);
  app.post(
    "/api/v1/transactions/supplier-payment",
    transactions.supplierPayment
  );
  app.post("/api/v1/transactions/selling", transactions.selling);
  app.post("/api/v1/transactions/batch-selling", transactions.batchSelling);
  // /**
  //  * @swagger
  //  * /api/v1/transactions/create-sale:
  //  *   post:
  //  *     summary: Create a credit sale transaction
  //  *     description: Creates a credit sale with items, taxes, discounts, and generates invoice. Supports prepayment application from customer deposits.
  //  *     tags: [Transactions]
  //  *     requestBody:
  //  *       required: true
  //  *       content:
  //  *         application/json:
  //  *           schema:
  //  *             type: object
  //  *             required:
  //  *               - customer_id
  //  *               - items
  //  *               - facilityId
  //  *               - created_by
  //  *               - txn_type
  //  *             properties:
  //  *               customer_id:
  //  *                 type: string
  //  *                 description: Customer number/ID
  //  *                 example: "CUST001"
  //  *               items:
  //  *                 type: array
  //  *                 description: Array of sale items
  //  *                 items:
  //  *                   type: object
  //  *                   properties:
  //  *                     product_id:
  //  *                       type: string
  //  *                       description: Product ID
  //  *                       example: "PROD123"
  //  *                     item_name:
  //  *                       type: string
  //  *                       description: Item name
  //  *                       example: "Product Name"
  //  *                     quantity_sold:
  //  *                       type: number
  //  *                       description: Quantity sold
  //  *                       example: 5
  //  *                     selling_price:
  //  *                       type: number
  //  *                       description: Selling price per unit
  //  *                       example: 1000.00
  //  *                     amount:
  //  *                       type: number
  //  *                       description: Total amount (quantity * price)
  //  *                       example: 5000.00
  //  *                     multiplier_type:
  //  *                       type: string
  //  *                       description: Unit of measure
  //  *                       example: "pcs"
  //  *                     expiry_date:
  //  *                       type: string
  //  *                       format: date
  //  *                       description: Product expiry date (optional)
  //  *                       example: "2024-12-31"
  //  *               discount_amount:
  //  *                 type: number
  //  *                 description: Total discount amount
  //  *                 default: 0
  //  *                 example: 500.00
  //  *               discount_info:
  //  *                 type: object
  //  *                 description: Discount information (optional)
  //  *                 properties:
  //  *                   discount_id:
  //  *                     type: string
  //  *                     example: "DISC001"
  //  *                   discount_name:
  //  *                     type: string
  //  *                     example: "Summer Sale"
  //  *                   discount_type:
  //  *                     type: string
  //  *                     enum: [Percentage, Fixed]
  //  *                     example: "Percentage"
  //  *                   value:
  //  *                     type: number
  //  *                     example: 10
  //  *               tax_amount:
  //  *                 type: number
  //  *                 description: Total tax amount
  //  *                 default: 0
  //  *                 example: 750.00
  //  *               taxes:
  //  *                 type: array
  //  *                 description: Array of tax objects
  //  *                 items:
  //  *                   type: object
  //  *                   properties:
  //  *                     id:
  //  *                       type: integer
  //  *                       example: 1
  //  *                     name:
  //  *                       type: string
  //  *                       example: "VAT"
  //  *                     description:
  //  *                       type: string
  //  *                       example: "Value Added Tax"
  //  *                     rate:
  //  *                       type: number
  //  *                       example: 7.5
  //  *                     head:
  //  *                       type: string
  //  *                       description: Tax account head
  //  *                       example: "21000"
  //  *                     amount:
  //  *                       type: number
  //  *                       example: 750.00
  //  *                     tax_type:
  //  *                       type: string
  //  *                       enum: [exclusive, inclusive]
  //  *                       example: "exclusive"
  //  *                     rate_type:
  //  *                       type: string
  //  *                       enum: [percentage, fixed]
  //  *                       example: "percentage"
  //  *               txn_type:
  //  *                 type: string
  //  *                 description: Transaction type (must be "Credit Sale")
  //  *                 enum: [Credit Sale]
  //  *                 example: "Credit Sale"
  //  *               facilityId:
  //  *                 type: string
  //  *                 description: Business/Facility ID
  //  *                 example: "BIZ001"
  //  *               created_by:
  //  *                 type: string
  //  *                 description: User ID who created the sale
  //  *                 example: "USER001"
  //  *               receivable_code:
  //  *                 type: string
  //  *                 description: Accounts Receivable account code
  //  *                 example: "10201"
  //  *               receivable_accural_code:
  //  *                 type: string
  //  *                 description: Receivable Accrual account code (optional)
  //  *                 example: "10202"
  //  *               cost_of_sale:
  //  *                 type: string
  //  *                 description: Cost of Sales account code
  //  *                 example: "4001001"
  //  *               sale_revenue_code:
  //  *                 type: string
  //  *                 description: Sales Revenue account code
  //  *                 example: "42011"
  //  *               finished_goods_code:
  //  *                 type: string
  //  *                 description: Finished Goods inventory account code
  //  *                 example: "1030703"
  //  *               transaction_date:
  //  *                 type: string
  //  *                 format: date
  //  *                 description: Transaction date (YYYY-MM-DD). If not provided, uses current date.
  //  *                 example: "2024-01-15"
  //  *               apply_prepayment:
  //  *                 type: boolean
  //  *                 description: Whether to apply customer prepayment/deposit
  //  *                 default: false
  //  *                 example: true
  //  *     responses:
  //  *       200:
  //  *         description: Credit sale processed successfully
  //  *         content:
  //  *           application/json:
  //  *             schema:
  //  *               type: object
  //  *               properties:
  //  *                 success:
  //  *                   type: boolean
  //  *                   example: true
  //  *                 message:
  //  *                   type: string
  //  *                   example: "Credit sale processed successfully"
  //  *                 sale_code:
  //  *                   type: string
  //  *                   description: Generated sale reference number
  //  *                   example: "SALE-12345"
  //  *                 net_amount:
  //  *                   type: number
  //  *                   description: Final amount after discount and taxes
  //  *                   example: 5250.00
  //  *                 cogs_amount:
  //  *                   type: number
  //  *                   description: Total cost of goods sold
  //  *                   example: 3000.00
  //  *                 prepayment_applied:
  //  *                   type: number
  //  *                   description: Amount applied from customer prepayment
  //  *                   example: 1000.00
  //  *                 amount_to_receivable:
  //  *                   type: number
  //  *                   description: Amount added to accounts receivable
  //  *                   example: 4250.00
  //  *                 valuation_method:
  //  *                   type: string
  //  *                   description: Inventory valuation method used
  //  *                   example: "Weighted Average Cost"
  //  *                 subtotal:
  //  *                   type: number
  //  *                   description: Subtotal before discount and taxes
  //  *                   example: 5000.00
  //  *                 discount:
  //  *                   type: number
  //  *                   description: Total discount applied
  //  *                   example: 500.00
  //  *                 tax:
  //  *                   type: number
  //  *                   description: Total tax amount
  //  *                   example: 750.00
  //  *                 tax_type:
  //  *                   type: string
  //  *                   enum: [inclusive, exclusive]
  //  *                   description: Type of tax applied
  //  *                   example: "exclusive"
  //  *                 taxable_amount:
  //  *                   type: number
  //  *                   description: Amount subject to tax
  //  *                   example: 4500.00
  //  *                 ledger_balance_check:
  //  *                   type: object
  //  *                   description: Double-entry bookkeeping balance verification
  //  *                   properties:
  //  *                     debits:
  //  *                       type: string
  //  *                       example: "5250.00"
  //  *                     credits:
  //  *                       type: string
  //  *                       example: "5250.00"
  //  *                     balanced:
  //  *                       type: boolean
  //  *                       example: true
  //  *       400:
  //  *         description: Bad request - Invalid request data
  //  *         content:
  //  *           application/json:
  //  *             schema:
  //  *               type: object
  //  *               properties:
  //  *                 success:
  //  *                   type: boolean
  //  *                   example: false
  //  *                 message:
  //  *                   type: string
  //  *                   example: "Invalid request: Must be Credit Sale with required fields"
  //  *       404:
  //  *         description: Customer not found
  //  *         content:
  //  *           application/json:
  //  *             schema:
  //  *               type: object
  //  *               properties:
  //  *                 success:
  //  *                   type: boolean
  //  *                   example: false
  //  *                 message:
  //  *                   type: string
  //  *                   example: "Customer not found"
  //  *       500:
  //  *         description: Server error
  //  *         content:
  //  *           application/json:
  //  *             schema:
  //  *               type: object
  //  *               properties:
  //  *                 success:
  //  *                   type: boolean
  //  *                   example: false
  //  *                 message:
  //  *                   type: string
  //  *                   example: "Failed to process sale"
  //  */
  app.post("/api/v1/transactions/create-sale", transactions.createSale);
  app.post("/api/v1/transactions/customer-copy", transactions.saveCustomerCopy);
  app.get("/api/v1/transactions/get-sale", transactions.getSaleByCode);
  app.get(
    "/api/v1/transactions/get-all-transactions-data",
    transactions.getAllTransactionsData
  );
  app.get(
    "/api/v1/transactions/sales-line-report",
    transactions.getSalesLineReport
  );
  app.get(
    "/api/v1/transactions/sale-taxes/:saleReference",
    transactions.getSaleTaxes
  );
  app.post("/api/v1/transactions/service", transactions.newServiceTransaction);
  app.post(
    "/api/v1/transactions/new-service/from-deposit",
    transactions.newServiceFromDeposit
  );
  app.post(
    "/api/v1/transactions/new-service/instant-payment",
    transactions.newServiceInstantPayment
  );
  app.get(
    "/api/v1/transactions/daily-sales-report",
    transactions.getDailySalesReport
  );

  app.get(
    "/transactions/pending/:facilityId",
    transactions.getPendingTransactions
  );
  app.put("/transactions/review", transactions.review);
  // app.post('/transactions/review', transactions.review)
  app.get(
    "/transactions/pending/:accountNo/:facilityId",
    transactions.getPatientPaymentPendingTransaction
  );
  app.get(
    "/transactions/reports/general/:facilityId",
    transactions.getGeneralReport
  );
  app.get(
    "/transactions/reports/general/:from/:to/:facilityId",
    transactions.getGeneralReportByDate
  );
  app.get(
    "/transactions/reports/general/:accHead/:from/:to/:facilityId",
    transactions.getGeneralReportByAccHead
  );
  app.get(
    "/transactions/reports/revenue/:from/:to/:facilityId",
    transactions.getRevenueReport
  );
  app.get(
    "/transactions/reports/revenue/:accHead/:from/:to/:facilityId",
    transactions.getRevenueReportByAccHead
  );
  app.get(
    "/transactions/reports/expenditure/:from/:to/:facilityId",
    transactions.getExpenditureReport
  );
  app.get(
    "/transactions/reports/expenditure/:accHead/:from/:to/:facilityId",
    transactions.getExpenditureReportByAccHead
  );
  app.get(
    "/transactions/reports/stmt/:patientId/:from/:to/:facilityId",
    transactions.getClientAccStatement
  );
  app.get(
    "/api/account/get-client-statement",
    transactions.getClientAccStatement2
  );
  app.post(
    "/api/transaction/return-items-transaction",
    transactions.returnItemsTransaction
  );
  app.post(
    "/api/transaction/returned-items-batch",
    transactions.returnBatchTxns
  );
  // app.get('/transactions/reports/stmt/:accHead/:from/:to/:facilityId', transactions.getExpenditureReportByAccHead)

  // transactions setup
  app.post("/transactions/setup/new", transactions.setupNewTransaction);
  app.get(
    "/transactions/setup/list/:facilityId",
    transactions.getTransactionsSetupList
  );
  app.post("/api/v1/transactions/service/new", transactions.deliveryList);
  app.post("/api/v1/transactions/agent-payment", transactions.agentPayment);
  app.get("/account/get-transactions", getJournalEntries);
  app.post("/insert-new-transaction", transactions.insertTransaction);
  app.get("/get-all-transactions", transactions.getAllTransactionsData);
};
