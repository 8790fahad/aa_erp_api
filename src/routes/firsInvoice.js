/**
 * FIRS/NRS Invoice Routes — FlowBooks System Integrator / Access Point
 * Auth: OAuth 2.0 client credentials (system-to-system).
 * Access tokens are short-lived Bearer JWTs from POST /api/v1/invoice/oauth/token.
 * Reference: https://einvoice.firs.gov.ng/docs/introduction?version=1.1
 */

const passport = require("passport");
const firsInvoiceController = require("../controller/firsInvoice");
const credentialsController = require("../controller/einvoicingCredentials");
const {
  oauthToken,
  oauthTokenRateLimiter,
  invoiceApiRateLimiter,
  authenticateEInvoicing,
} = require("../middleware/eInvoicingAuth");

const authenticate = authenticateEInvoicing(passport);
const userAuth = passport.authenticate("jwt", { session: false });

module.exports = (app) => {
  app.post("/api/v1/invoice/oauth/token", oauthTokenRateLimiter, oauthToken);

  // Per-business credential management (protected by user login).
  app.get(
    "/api/v1/invoice/credentials",
    userAuth,
    credentialsController.getCredentials,
  );
  app.post(
    "/api/v1/invoice/credentials/rotate",
    userAuth,
    credentialsController.rotateCredentials,
  );

  app.post(
    "/api/v1/invoice/create",
    authenticate,
    invoiceApiRateLimiter,
    firsInvoiceController.createInvoice,
  );

  app.post(
    "/api/v1/invoice/status",
    authenticate,
    invoiceApiRateLimiter,
    firsInvoiceController.lookupInvoiceStatus,
  );

  app.post(
    "/api/v1/invoice/payment/notify",
    authenticate,
    invoiceApiRateLimiter,
    firsInvoiceController.paymentNotify,
  );

  app.post(
    "/api/v1/invoice/transmit/:irn",
    authenticate,
    invoiceApiRateLimiter,
    firsInvoiceController.transmitInvoice,
  );

  /**
   * @swagger
   * components:
   *   schemas:
   *     NrsPostalAddress:
   *       type: object
   *       required: [street_name, city_name, country]
   *       properties:
   *         street_name:
   *           type: string
   *         city_name:
   *           type: string
   *         postal_zone:
   *           type: string
   *         country:
   *           type: string
   *           example: NG
   *     NrsParty:
   *       type: object
   *       required: [party_name, tin, postal_address]
   *       properties:
   *         party_name:
   *           type: string
   *         tin:
   *           type: string
   *         email:
   *           type: string
   *         telephone:
   *           type: string
   *         business_description:
   *           type: string
   *         postal_address:
   *           $ref: '#/components/schemas/NrsPostalAddress'
   *     NrsInvoiceLineItem:
   *       type: object
   *       required: [invoiced_quantity, line_extension_amount, item, price]
   *       properties:
   *         discount_rate:
   *           type: number
   *         discount_amount:
   *           type: number
   *         fee_rate:
   *           type: number
   *         fee_amount:
   *           type: number
   *         invoiced_quantity:
   *           type: number
   *         line_extension_amount:
   *           type: number
   *         hsn_code:
   *           type: string
   *         product_category:
   *           type: string
   *         isic_code:
   *           type: string
   *         service_category:
   *           type: string
   *         item:
   *           type: object
   *           required: [name]
   *           properties:
   *             name:
   *               type: string
   *             description:
   *               type: string
   *             sellers_item_identification:
   *               type: string
   *         price:
   *           type: object
   *           required: [price_amount]
   *           properties:
   *             price_amount:
   *               type: number
   *             base_quantity:
   *               type: number
   *               example: 1
   *             price_unit:
   *               type: string
   *               example: EA
   *     NrsTaxSubtotal:
   *       type: object
   *       properties:
   *         taxable_amount:
   *           type: number
   *         tax_amount:
   *           type: number
   *         tax_category:
   *           type: object
   *           properties:
   *             id:
   *               type: string
   *               enum: [STANDARD_VAT, ZERO_VAT]
   *             percent:
   *               type: number
   *     NrsTaxTotal:
   *       type: object
   *       properties:
   *         tax_amount:
   *           type: number
   *         tax_subtotal:
   *           type: array
   *           items:
   *             $ref: '#/components/schemas/NrsTaxSubtotal'
   *     NrsLegalMonetaryTotal:
   *       type: object
   *       required: [line_extension_amount, tax_exclusive_amount, tax_inclusive_amount, payable_amount]
   *       properties:
   *         line_extension_amount:
   *           type: number
   *         tax_exclusive_amount:
   *           type: number
   *         tax_inclusive_amount:
   *           type: number
   *         payable_amount:
   *           type: number
   *     NrsCreateInvoiceRequest:
   *       type: object
   *       required:
   *         - business_id
   *         - irn
   *         - invoice_kind
   *         - issue_date
   *         - due_date
   *         - issue_time
   *         - invoice_type_code
   *         - payment_status
   *         - tax_point_date
   *         - document_currency_code
   *         - tax_currency_code
   *         - accounting_supplier_party
   *         - invoice_line
   *         - tax_total
   *         - legal_monetary_total
   *       properties:
   *         business_id:
   *           type: string
   *           description: NRS merchant identifier from sandbox onboarding
   *         irn:
   *           type: string
   *           description: InvoiceNo-ServiceId-YYYYMMDD
   *           example: INV-2026-B2B-001-SVC001-20260709
   *         invoice_kind:
   *           type: string
   *           enum: [B2B, B2G, B2C]
   *         issue_date:
   *           type: string
   *           format: date
   *         due_date:
   *           type: string
   *           format: date
   *         issue_time:
   *           type: string
   *           example: "10:30:00"
   *         invoice_type_code:
   *           type: string
   *           description: "381=invoice, 380=credit note, 384=debit note"
   *           example: "381"
   *         payment_status:
   *           type: string
   *           enum: [PENDING, PAID, REJECTED, PARTIAL]
   *         tax_point_date:
   *           type: string
   *           format: date
   *         document_currency_code:
   *           type: string
   *           example: NGN
   *         tax_currency_code:
   *           type: string
   *           example: NGN
   *         accounting_supplier_party:
   *           $ref: '#/components/schemas/NrsParty'
   *         accounting_customer_party:
   *           $ref: '#/components/schemas/NrsParty'
   *         invoice_line:
   *           type: array
   *           minItems: 1
   *           items:
   *             $ref: '#/components/schemas/NrsInvoiceLineItem'
   *         tax_total:
   *           type: array
   *           items:
   *             $ref: '#/components/schemas/NrsTaxTotal'
   *         legal_monetary_total:
   *           $ref: '#/components/schemas/NrsLegalMonetaryTotal'
   *     NrsInvoiceStatusRequest:
   *       type: object
   *       required: [business_id, irn]
   *       properties:
   *         business_id:
   *           type: string
   *         irn:
   *           type: string
   *     NrsPaymentNotifyRequest:
   *       type: object
   *       required: [business_id, irn, payment_status]
   *       properties:
   *         business_id:
   *           type: string
   *         irn:
   *           type: string
   *         payment_status:
   *           type: string
   *           enum: [PENDING, PAID, REJECTED, PARTIAL]
   *           description: amount is required when payment_status is PARTIAL (this installment; cannot exceed payable or remaining balance; auto-PAID when complete)
   *         amount:
   *           type: number
   *           description: This payment installment (required for PARTIAL)
   *     NrsInvoiceResponse:
   *       type: object
   *       properties:
   *         irn:
   *           type: string
   *         issue_date:
   *           type: string
   *           format: date
   *         due_date:
   *           type: string
   *           format: date
   *         sync_date:
   *           type: string
   *           format: date
   *         payment_status:
   *           type: string
   *         transmitted:
   *           type: boolean
   *         delivered:
   *           type: boolean
   *         qr_code_data:
   *           type: string
   */

  /**
   * @swagger
   * /api/v1/invoice/create:
   *   post:
   *     summary: Create Invoice (NRS payload)
   *     description: |
   *       Submit an invoice to FIRS using the **NRS/FIRS e-Invoicing payload structure**.
   *
   *       Reference: [FIRS e-Invoicing API](https://einvoice.firs.gov.ng/docs/introduction?version=1.1)
   *
   *       **IRN:** unique tracking number per invoice (`InvoiceNo-ServiceId-YYYYMMDD`).
   *       Duplicate IRNs for the same business_id are rejected (409).
   *
   *       **Authentication:** OAuth 2.0 Bearer from `POST /api/v1/invoice/oauth/token`
   *       (or user JWT). See [FIRS e-Invoicing](https://einvoice.firs.gov.ng/docs/introduction?version=1.1).
     *     tags: [E-Invoicing]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/NrsCreateInvoiceRequest'
   *           example:
   *             business_id: "YOUR_NRS_BUSINESS_ID"
   *             irn: "INV-2026-B2B-001-SVC001-20260709"
   *             invoice_kind: "B2B"
   *             issue_date: "2026-07-09"
   *             due_date: "2026-08-08"
   *             issue_time: "10:30:00"
   *             invoice_type_code: "381"
   *             payment_status: "PENDING"
   *             tax_point_date: "2026-07-09"
   *             document_currency_code: "NGN"
   *             tax_currency_code: "NGN"
   *             accounting_supplier_party:
   *               party_name: "Brainstorm IT Solutions"
   *               tin: "YOUR_SUPPLIER_TIN"
   *               email: "hello@flowbooks.org"
   *               telephone: "+2348067643479"
   *               business_description: "Software Development"
   *               postal_address:
   *                 street_name: "Plot 5, Brainstorm Close, Victoria Island"
   *                 city_name: "Lagos"
   *                 postal_zone: "101241"
   *                 country: "NG"
   *             accounting_customer_party:
   *               party_name: "AA FOODS NIGERIA LIMITED"
   *               tin: "YOUR_CUSTOMER_TIN"
   *               email: "accounts@aafoods.ng"
   *               telephone: "+2348012345678"
   *               postal_address:
   *                 street_name: "12 Industrial Avenue, Ikeja"
   *                 city_name: "Lagos"
   *                 postal_zone: "100001"
   *                 country: "NG"
   *             invoice_line:
   *               - discount_rate: 0
   *                 discount_amount: 0
   *                 fee_rate: 0
   *                 fee_amount: 0
   *                 invoiced_quantity: 50
   *                 line_extension_amount: 2250000
   *                 hsn_code: "7306"
   *                 product_category: "Construction Materials"
   *                 item:
   *                   name: "Industrial Steel Pipes 6inch"
   *                   description: "Galvanized steel pipes, 6 inch diameter, 6m length"
   *                   sellers_item_identification: "SKU-PIPE-6IN-001"
   *                 price:
   *                   price_amount: 45000
   *                   base_quantity: 1
   *                   price_unit: "EA"
   *               - discount_rate: 0
   *                 discount_amount: 0
   *                 fee_rate: 0
   *                 fee_amount: 0
   *                 invoiced_quantity: 20
   *                 line_extension_amount: 500000
   *                 item:
   *                   name: "Welding Consumables Pack"
   *                   description: "Electrodes and flux pack"
   *                   sellers_item_identification: "SKU-WELD-002"
   *                 price:
   *                   price_amount: 25000
   *                   base_quantity: 1
   *                   price_unit: "EA"
   *             tax_total:
   *               - tax_amount: 206250
   *                 tax_subtotal:
   *                   - taxable_amount: 2750000
   *                     tax_amount: 206250
   *                     tax_category:
   *                       id: "STANDARD_VAT"
   *                       percent: 7.5
   *             legal_monetary_total:
   *               line_extension_amount: 2750000
   *               tax_exclusive_amount: 2750000
   *               tax_inclusive_amount: 2956250
   *               payable_amount: 2956250
   *     responses:
   *       200:
   *         description: Invoice submitted to FIRS successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 message:
   *                   type: string
   *                 data:
   *                   $ref: '#/components/schemas/NrsInvoiceResponse'
   *       400:
   *         description: Invalid NRS payload
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Forbidden — business_id does not match authenticated user
   *       409:
   *         description: Duplicate IRN — each invoice must have a unique tracking number (irn)
   *       500:
   *         description: Server or gateway error
   */

  /**
   * @swagger
   * /api/v1/invoice/status:
   *   post:
   *     summary: Lookup Invoice Status (NRS)
   *     description: |
   *       Retrieve clearance and transmission status for an invoice by **business_id** and **irn**.
     *     tags: [E-Invoicing]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/NrsInvoiceStatusRequest'
   *           example:
   *             business_id: "YOUR_NRS_BUSINESS_ID"
   *             irn: "INV-2026-B2B-001-SVC001-20260709"
   *     responses:
   *       200:
   *         description: Invoice status retrieved
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   $ref: '#/components/schemas/NrsInvoiceResponse'
   *       400:
   *         description: business_id and irn required
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */

  /**
   * @swagger
   * /api/v1/invoice/payment/notify:
   *   post:
   *     summary: Payment Notification (NRS)
   *     description: |
   *       Notify NRS/FIRS of a payment status change for a cleared invoice.
     *     tags: [E-Invoicing]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/NrsPaymentNotifyRequest'
   *           example:
   *             business_id: "YOUR_NRS_BUSINESS_ID"
   *             irn: "INV-2026-B2B-001-SVC001-20260709"
   *             payment_status: "PARTIAL"
   *             amount: 50000
   *     responses:
   *       200:
   *         description: Payment notification sent
   *       400:
   *         description: Invalid parameters (amount required when payment_status is PARTIAL)
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */

  /**
   * @swagger
   * /api/v1/invoice/transmit/{irn}:
   *   post:
   *     summary: Transmit Invoice
   *     description: |
   *       Manually triggers transmission of a specific invoice to NRS by IRN.
   *       Path: `POST /api/v1/invoice/transmit/{IRN}`
   *     tags: [E-Invoicing]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: irn
   *         required: true
   *         schema:
   *           type: string
   *         description: Unique invoice tracking number (IRN)
   *       - in: query
   *         name: business_id
   *         required: false
   *         schema:
   *           type: string
   *         description: NRS business_id (optional if bound on OAuth token)
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               business_id:
   *                 type: string
   *     responses:
   *       200:
   *         description: Invoice transmitted
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 code:
   *                   type: integer
   *                   example: 200
   *                 data:
   *                   type: object
   *                   properties:
   *                     ok:
   *                       type: boolean
   *                       example: true
   *             example:
   *               code: 200
   *               data:
   *                 ok: true
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Invoice not found
   *       500:
   *         description: Server error
   */
};
