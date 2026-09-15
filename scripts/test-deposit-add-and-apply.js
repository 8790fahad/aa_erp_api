/**
 * Smoke-test: add customer deposit, then apply deposit to an invoice.
 * Usage: node scripts/test-deposit-add-and-apply.js
 */
require("dotenv").config();
const http = require("http");
const { QueryTypes } = require("sequelize");
const db = require("../src/models");

const PORT = Number(process.env.PORT || 42844);
const FACILITY =
  process.env.TEST_FACILITY_ID || "094c6e1e-dd07-48c4-a344-6e9d58cd7861";
const USER_ID = process.env.TEST_USER_ID || "4";
const DEPOSIT_AMT = 5000;

function jsonFetch(path, body) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: PORT,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: 30000,
      },
      (res) => {
        let text = "";
        res.on("data", (c) => {
          text += c;
        });
        res.on("end", () => {
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            data = { raw: text };
          }
          resolve({
            status: res.statusCode,
            ok: res.statusCode >= 200 && res.statusCode < 300,
            data,
          });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("request timeout"));
    });
    req.write(payload);
    req.end();
  });
}

async function depositBalance(facilityId, customerNo) {
  const rows = await db.sequelize.query(
    `SELECT
       ROUND(COALESCE(SUM(cr),0) - COALESCE(SUM(dr),0), 2) AS bal
     FROM general_ledger
     WHERE facility_id = :facilityId
       AND type = 'deposit'
       AND transaction_ref = :customerNo`,
    {
      replacements: { facilityId, customerNo },
      type: QueryTypes.SELECT,
    },
  );
  return Number(rows[0]?.bal) || 0;
}

async function main() {
  const out = { steps: [], pass: true };
  const log = (msg, extra) => {
    console.log(msg, extra != null ? extra : "");
    out.steps.push({ msg, extra });
  };

  try {
    // --- fixtures ---
    const business = await db.business.findByPk(FACILITY);
    if (!business) throw new Error(`Business not found: ${FACILITY}`);

    const customers = await db.sequelize.query(
      `SELECT customerNo, fullname, receivable_code, receivable_accural_code
       FROM customers
       WHERE facilityId = :facilityId
       ORDER BY customerNo DESC
       LIMIT 20`,
      { replacements: { facilityId: FACILITY }, type: QueryTypes.SELECT },
    );
    if (!customers.length) throw new Error("No customers for facility");

    const banks = await db.sequelize.query(
      `SELECT id, account_name, account_number, head, status
       FROM bank_accounts
       WHERE facility_id = :facilityId AND status = 'active'
       ORDER BY account_name ASC
       LIMIT 5`,
      { replacements: { facilityId: FACILITY }, type: QueryTypes.SELECT },
    );
    if (!banks.length) throw new Error("No active bank accounts");

    const depositCode =
      customers[0].receivable_accural_code ||
      business.receivable_accural_code;
    const receivableCode =
      customers[0].receivable_code || business.receivable_code;
    if (!depositCode) throw new Error("Missing receivable_accural_code (deposit liability)");
    if (!receivableCode) throw new Error("Missing receivable_code");

    // Prefer a customer that already has a deposit-eligible invoice, else first customer
    const pendingWf = await db.sequelize.query(
      `SELECT sale_code, customer_no, amount, status, payment_type, history
       FROM sale_workflows
       WHERE facility_id = :facilityId
         AND status LIKE 'awaiting%'
       ORDER BY updated_at DESC
       LIMIT 30`,
      { replacements: { facilityId: FACILITY }, type: QueryTypes.SELECT },
    );

    let customer =
      customers.find((c) =>
        pendingWf.some((w) => w.customer_no === c.customerNo),
      ) || customers[0];
    const bank = banks[0];
    const today = new Date().toISOString().slice(0, 10);

    log("Fixtures", {
      facilityId: FACILITY,
      customer: customer.customerNo,
      bankId: bank.id,
      bankName: bank.account_name,
      depositCode,
      receivableCode,
      pendingInvoices: pendingWf.length,
    });

    // --- 1) ADD DEPOSIT ---
    const balBefore = await depositBalance(FACILITY, customer.customerNo);
    log("Deposit balance BEFORE add", balBefore);

    const addRes = await jsonFetch("/api/v1/customer-advance-payment", {
      facilityId: FACILITY,
      userId: USER_ID,
      customer_no: customer.customerNo,
      amount_paid: DEPOSIT_AMT,
      mode_of_payment: "bank transfer",
      transaction_date: today,
      narration: `AUTOTEST deposit ${Date.now()}`,
      bankAccount: { id: bank.id },
      receivable_deposit_code: depositCode,
      receivable_code: receivableCode,
      pure_advance: true,
      source: "collection_points",
      invoices: [],
    });

    if (!addRes.ok && !addRes.data?.success) {
      out.pass = false;
      log("FAIL add deposit", { status: addRes.status, data: addRes.data });
    } else {
      log("OK add deposit", {
        status: addRes.status,
        ref:
          addRes.data?.data?.reference_number ||
          addRes.data?.reference_number ||
          addRes.data?.data?.transaction_ref ||
          addRes.data?.message,
      });
    }

    const balAfterAdd = await depositBalance(FACILITY, customer.customerNo);
    log("Deposit balance AFTER add", balAfterAdd);
    const added = Number((balAfterAdd - balBefore).toFixed(2));
    if (Math.abs(added - DEPOSIT_AMT) > 0.05) {
      out.pass = false;
      log("FAIL deposit balance did not increase by amount", {
        expected: DEPOSIT_AMT,
        got: added,
      });
    } else {
      log("OK deposit balance increased by", added);
    }

    // --- 2) APPLY DEPOSIT ---
    // Prefer existing awaiting invoice; otherwise create a throwaway workflow to exercise apply.
    let target = pendingWf.find((w) => w.customer_no === customer.customerNo);
    let createdTestWf = false;

    if (!target) {
      const testCode = `TEST-DEP-${Date.now().toString().slice(-8)}`;
      const testAmt = 2500;
      await db.SaleWorkflow.create({
        facility_id: FACILITY,
        sale_code: testCode,
        customer_no: customer.customerNo,
        customer_name: customer.fullname || customer.customerNo,
        payment_type: "deposit",
        status: "awaiting_cashier_confirm",
        amount: testAmt,
        history: [
          {
            status: "awaiting_cashier_confirm",
            at: new Date().toISOString(),
            by: USER_ID,
            note: "AUTOTEST workflow for deposit apply",
          },
        ],
        notes: "AUTOTEST — safe to ignore/delete",
        created_by: USER_ID,
        updated_by: USER_ID,
      });
      createdTestWf = true;
      target = {
        sale_code: testCode,
        customer_no: customer.customerNo,
        amount: testAmt,
        status: "awaiting_cashier_confirm",
        payment_type: "deposit",
      };
      log("Created temporary awaiting workflow for apply test", target);
    }

    const applyAmt = Math.min(
      DEPOSIT_AMT,
      Number(target.amount) || DEPOSIT_AMT,
      2500,
    );
    log("Applying deposit to", {
      sale_code: target.sale_code,
      status: target.status,
      amount: target.amount,
      applyAmt,
    });

    const balBeforeApply = await depositBalance(FACILITY, customer.customerNo);
    const applyRes = await jsonFetch("/api/v1/apply-customer-advance", {
      facilityId: FACILITY,
      userId: USER_ID,
      customer_no: customer.customerNo,
      transaction_date: today,
      narration: `AUTOTEST apply ${Date.now()}`,
      applications: [{ invoice_ref: target.sale_code, amount: applyAmt }],
    });

    if (!applyRes.ok && !applyRes.data?.success) {
      out.pass = false;
      log("FAIL apply deposit", {
        status: applyRes.status,
        data: applyRes.data,
      });
    } else {
      log("OK apply deposit", {
        status: applyRes.status,
        message: applyRes.data?.message || applyRes.data?.success,
        data: applyRes.data?.data || applyRes.data?.results,
      });
    }

    const balAfterApply = await depositBalance(FACILITY, customer.customerNo);
    log("Deposit balance AFTER apply", balAfterApply);
    const reduced = Number((balBeforeApply - balAfterApply).toFixed(2));
    if (applyRes.ok || applyRes.data?.success) {
      if (Math.abs(reduced - applyAmt) > 0.05) {
        out.pass = false;
        log("FAIL deposit balance did not decrease by apply amount", {
          expected: applyAmt,
          got: reduced,
        });
      } else {
        log("OK deposit balance decreased by", reduced);
      }

      const wfAfter = await db.sequelize.query(
        `SELECT sale_code, status, payment_type, amount
         FROM sale_workflows
         WHERE facility_id = :facilityId AND sale_code = :saleCode
         LIMIT 1`,
        {
          replacements: {
            facilityId: FACILITY,
            saleCode: target.sale_code,
          },
          type: QueryTypes.SELECT,
        },
      );
      log("Workflow after apply", wfAfter[0] || null);

      // Full apply of 2500 on 2500 invoice should move to invoice_separation
      if (
        Number(target.amount) <= applyAmt + 0.05 &&
        wfAfter[0] &&
        String(wfAfter[0].status) !== "invoice_separation"
      ) {
        out.pass = false;
        log("FAIL expected invoice_separation after full deposit apply", {
          got: wfAfter[0].status,
        });
      } else if (wfAfter[0]) {
        log("OK workflow status after apply", wfAfter[0].status);
      }
    }

    if (createdTestWf) {
      await db.SaleWorkflow.update(
        { status: "cancelled", notes: "AUTOTEST cleaned up" },
        {
          where: {
            facility_id: FACILITY,
            sale_code: target.sale_code,
          },
        },
      );
      log("Marked temporary test workflow cancelled", target.sale_code);
    }

    console.log("\n========== RESULT ==========");
    console.log(out.pass ? "PASS" : "FAIL");
    process.exit(out.pass ? 0 : 1);
  } catch (err) {
    console.error("TEST ERROR:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await db.sequelize.close().catch(() => {});
  }
}

main();
