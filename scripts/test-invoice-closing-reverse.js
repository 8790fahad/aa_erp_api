#!/usr/bin/env node
/**
 * Prove invoice closing reverse:
 * - Verification invoice with NO payment is reversed
 * - Invoice with any partial payment is kept
 *
 * Usage: node scripts/test-invoice-closing-reverse.js
 */
"use strict";

require("dotenv").config();
const db = require("../src/models");
const {
  voidUnpaidNonCreditSale,
  saleHasAnyPayment,
  collectedAmountFromHistory,
} = require("../src/services/invoiceClosingService");

const FACILITY_ID =
  process.env.TEST_FACILITY_ID || "094c6e1e-dd07-48c4-a344-6e9d58cd7861";
const USER_ID = "4";
const stamp = Date.now();
const UNPAID_CODE = `TEST-CLOSE-UNPAID-${stamp}`.slice(0, 50);
const PARTIAL_CODE = `TEST-CLOSE-PARTIAL-${stamp}`.slice(0, 50);
const CREDIT_CODE = `TEST-CLOSE-CREDIT-${stamp}`.slice(0, 50);

function fail(msg) {
  throw new Error(msg);
}

async function cleanup() {
    try {
      await db.SaleWorkflow.destroy({
        where: {
          facility_id: FACILITY_ID,
          sale_code: { [db.Sequelize.Op.like]: "TEST-CLOSE-%" },
        },
      });
      await db.GeneralLedger.destroy({
        where: {
          facility_id: FACILITY_ID,
          reference_number: { [db.Sequelize.Op.like]: "TEST-CLOSE-%" },
        },
      });
      if (db.Invoice) {
        await db.Invoice.destroy({
          where: {
            facility_id: FACILITY_ID,
            invoice_ref: { [db.Sequelize.Op.like]: "TEST-CLOSE-%" },
          },
        });
      }
    } catch (e) {
      console.warn("cleanup warning:", e.message);
    }
}

async function main() {
  const business = await db.business.findByPk(FACILITY_ID);
  if (!business) fail(`Business ${FACILITY_ID} not found`);
  console.log("Facility:", business?.business_name || FACILITY_ID);

  const account = await db.AccountCategory.findOne({
    where: { facilityId: FACILITY_ID },
    attributes: ["code", "parentCode", "description"],
    raw: true,
  });
  if (!account) fail("No chart of account head found");

  await cleanup();

  await db.SaleWorkflow.create({
    facility_id: FACILITY_ID,
    sale_code: UNPAID_CODE,
    customer_no: "TEST-CLOSE",
    customer_name: "Closing reverse test (unpaid)",
    payment_type: "cash",
    status: "awaiting_cashier_confirm",
    amount: 1500,
    created_by: USER_ID,
    history: [
      {
        status: "awaiting_cashier_confirm",
        at: new Date().toISOString(),
        by: USER_ID,
        note: "On verification, unpaid",
      },
    ],
  });

  await db.SaleWorkflow.create({
    facility_id: FACILITY_ID,
    sale_code: CREDIT_CODE,
    customer_no: "TEST-CLOSE",
    customer_name: "Closing reverse test (unapproved credit)",
    payment_type: "credit",
    status: "awaiting_credit_approval",
    amount: 2500,
    created_by: USER_ID,
    history: [
      {
        status: "awaiting_credit_approval",
        at: new Date().toISOString(),
        by: USER_ID,
        note: "On verification credit tab, not approved",
      },
    ],
  });

  await db.SaleWorkflow.create({
    facility_id: FACILITY_ID,
    sale_code: PARTIAL_CODE,
    customer_no: "TEST-CLOSE",
    customer_name: "Closing reverse test (partial)",
    payment_type: "split",
    status: "awaiting_cashier_confirm",
    amount: 4000,
    created_by: USER_ID,
    history: [
      {
        status: "awaiting_cashier_confirm",
        at: new Date().toISOString(),
        by: USER_ID,
        collection: { side: "cash", amount: 1000 },
        note: "Partial cash collected",
      },
    ],
  });

  await db.GeneralLedger.create({
    transaction_date: new Date().toISOString().slice(0, 10),
    account_code: account.code,
    account_subhead: account.parent_code || account.parentCode || "0",
    dr: 1500,
    cr: 0,
    account_description: account.description || "Test",
    transaction_description: `Sale receivable — ${UNPAID_CODE}`,
    reference_number: UNPAID_CODE,
    purpose_of_payment: "Cash Sale",
    payee: "TEST-CLOSE",
    facility_id: FACILITY_ID,
    status: "posted",
    type: "receivable",
    transaction_ref: UNPAID_CODE,
  });

  const unpaidWf = await db.SaleWorkflow.findOne({
    where: { facility_id: FACILITY_ID, sale_code: UNPAID_CODE },
  });
  const partialWf = await db.SaleWorkflow.findOne({
    where: { facility_id: FACILITY_ID, sale_code: PARTIAL_CODE },
  });

  const unpaidPaid = await saleHasAnyPayment({
    facilityId: FACILITY_ID,
    saleCode: UNPAID_CODE,
    workflow: unpaidWf,
  });
  const partialPaid = await saleHasAnyPayment({
    facilityId: FACILITY_ID,
    saleCode: PARTIAL_CODE,
    workflow: partialWf,
  });
  const historyAmt = collectedAmountFromHistory(partialWf.history);

  console.log("Unpaid has payment?", unpaidPaid);
  console.log("Partial has payment?", partialPaid, "history=", historyAmt);

  if (unpaidPaid.paid) fail("Unpaid test invoice was treated as paid");
  if (!partialPaid.paid) fail("Partial test invoice was treated as unpaid");

  const unpaidOut = await voidUnpaidNonCreditSale({
    facilityId: FACILITY_ID,
    saleCode: UNPAID_CODE,
    userId: USER_ID,
    reason: "Test reverse of unpaid verification invoice",
  });
  console.log("Unpaid reverse:", unpaidOut);
  if (!unpaidOut.success) fail("Unpaid invoice was not reversed");

  const unpaidAfter = await db.SaleWorkflow.findOne({
    where: { facility_id: FACILITY_ID, sale_code: UNPAID_CODE },
  });
  if (String(unpaidAfter.status) !== "cancelled") {
    fail(`Expected unpaid workflow cancelled, got ${unpaidAfter.status}`);
  }

  const partialMid = await db.SaleWorkflow.findOne({
    where: { facility_id: FACILITY_ID, sale_code: PARTIAL_CODE },
  });
  console.log("Unpaid id/status:", unpaidWf.id, unpaidAfter.status);
  console.log(
    "Partial id/status/notes:",
    partialWf.id,
    partialMid.status,
    partialMid.notes,
  );
  if (String(partialMid.status) === "cancelled") {
    fail(
      `Partial invoice was cancelled while reversing unpaid (${PARTIAL_CODE})`,
    );
  }

  const voidLines = await db.GeneralLedger.count({
    where: {
      facility_id: FACILITY_ID,
      reference_number: UNPAID_CODE,
      transaction_description: { [db.Sequelize.Op.like]: "VOID:%" },
    },
  });
  if (voidLines < 1) fail("Expected VOID ledger line for unpaid invoice");
  console.log("VOID ledger lines:", voidLines);

  const partialOut = await voidUnpaidNonCreditSale({
    facilityId: FACILITY_ID,
    saleCode: PARTIAL_CODE,
    userId: USER_ID,
    reason: "Test skip of partly paid verification invoice",
  });
  console.log("Partial reverse:", partialOut);
  if (!partialOut.skipped || partialOut.reason !== "has_payment") {
    fail(`Expected partial invoice skipped (has_payment), got ${JSON.stringify(partialOut)}`);
  }

  const partialAfter = await db.SaleWorkflow.findOne({
    where: { facility_id: FACILITY_ID, sale_code: PARTIAL_CODE },
  });
  if (String(partialAfter.status) !== "awaiting_cashier_confirm") {
    fail(
      `Expected partial invoice still on verification, got ${partialAfter.status}`,
    );
  }

  const creditOut = await voidUnpaidNonCreditSale({
    facilityId: FACILITY_ID,
    saleCode: CREDIT_CODE,
    userId: USER_ID,
    reason: "Test reverse of unapproved credit on verification",
  });
  console.log("Credit reverse:", creditOut);
  if (!creditOut.success) fail("Unapproved credit invoice was not reversed");
  const creditAfter = await db.SaleWorkflow.findOne({
    where: { facility_id: FACILITY_ID, sale_code: CREDIT_CODE },
  });
  if (String(creditAfter.status) !== "cancelled") {
    fail(`Expected unapproved credit cancelled, got ${creditAfter.status}`);
  }

  await cleanup();
  console.log(
    "PASS: unpaid (cash + unapproved credit) reverse; partial payments stay on verification.",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.sequelize.close();
    } catch (_) {
      /* ignore */
    }
  });
